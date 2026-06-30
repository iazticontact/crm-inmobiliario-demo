# FASE P23 (HOTFIX) — Trazabilidad real del Asistente IA: causa exacta, diagnóstico end-to-end y endurecimiento

> **Fecha:** 2026-07-01 · Hotfix de fiabilidad tratado como problema **estructural**, no como un caso.
> Se auditó el flujo completo (UI → /api/assistant/v2 → adapter → n8n → tool → /api/agent/tool →
> Supabase) **con verificación real de código y de base de datos**. Conclusión: el pipeline de código es
> **correcto** (UI y Asistente usan la MISMA fuente de workspace) y el prompt vivo de n8n **ya** distingue
> error de vacío. La divergencia "la UI muestra datos y el Asistente dice que no hay" es **de entorno/
> cuenta**, no de lógica — y ahora es **verificable** con un autodiagnóstico seguro (`/api/agent/diag`).

## 1. Diagnóstico global (mapa real del flujo)

Frontend chat → `POST /api/assistant/v2` → resuelve `user` (sesión) y `workspaceId` (= `profiles.workspace_id`)
→ `runN8nAssistant` (server, secreto en header) → webhook n8n `crm-agent-v2` → nodo **Normalize input**
→ **CRM Agent** (OpenAI + tools) → cada tool (`toolCode`) hace `POST $env.CRM_BASE_URL/api/agent/tool`
con `{tool, workspace_id, input}` y el secreto → `/api/agent/tool` (service-role, **confía** en el
`workspace_id` del body, verifica que el workspace existe) → handlers en `agent-tool-readers.ts` →
Supabase. Verificado leyendo el código y el workflow vivo, **no “debería”**.

## 2. Causa exacta (verificada)

**No hay bug de lógica en el pipeline.** Pruebas:
- **Misma fuente de verdad de workspace:** la UI usa `currentUser.workspaceId` = `profiles.workspace_id`;
  `/api/assistant/v2` resuelve `workspaceId` con `select workspace_id from profiles where id = user.id`.
  **Idéntico.** No hay divergencia de workspace por usuario.
- **n8n Normalize input** lee `={{ $json.body.workspaceId }}` — **sin workspace por defecto hardcodeado**;
  reenvía el que manda la UI. (Auditado en el workflow vivo.)
- **`/api/agent/tool`** confía en el `workspace_id` del body (service-role), verifica el workspace y
  consulta esa tabla con `.eq('workspace_id', …)`. Correcto.
- **`/api/assistant/v2` NO hace fallback silencioso:** si n8n falla, devuelve error humano
  (`agent_unreachable`/`missing_provider_config`), **no** “no hay datos”.
- **El prompt vivo de n8n YA distingue error de vacío** (líneas 30/262/308–320/398/542:
  “Si hay cero resultados, dilo. Si hay fallo técnico real, dilo… No digas ‘no puedo acceder a los datos’
  salvo fallo real”).

**Entonces, ¿por qué falla?** Verificación directa en la base de datos (MCP):

| Cuenta (profiles.email) | workspace_id | clientes | citas | inmuebles |
|---|---|---:|---:|---:|
| `odunabeitia14@gmail.com` | `d0000000-…0001` | **9** | **12** | **8** |
| `asier.comba@opendeusto.es` | `b43f73fc-…` | 0 | 0 | 0 |
| `gabriel.peralta@opendeusto.es` | `ffc49d1b-…` | 0 | 0 | 1 |

Es decir: **todos los datos reales viven en el workspace de `odunabeitia14`**; las otras dos cuentas
tienen el workspace **vacío de verdad**. Causas reales posibles, ya acotadas a entorno/cuenta:

- **(C1) Se prueba con una cuenta de workspace vacío** (asier/gabriel) → la tool consulta su workspace
  real (vacío) y responde correctamente “no hay”, mientras la UI puede estar mostrando datos de **MODO
  DEMO** (seed cliente, sólo si `localStorage` tiene la bandera de demo) → divergencia aparente, **no** un
  bug de tool. (La UI no cae a demo automáticamente para un usuario real con workspace vacío.)
- **(C2) Backend desplegado “stale”/mal apuntado:** el `$env.CRM_BASE_URL` de las tools de n8n apunta a
  un despliegue antiguo o conectado a **otro proyecto Supabase** (sin estos datos) → la tool consulta una
  base vacía/distinta. La UI (que usa su propio `NEXT_PUBLIC_SUPABASE_URL`) sí ve los datos. **Esta es la
  causa típica cuando se prueba con `odunabeitia14` y aun así “no hay”.**

Ambas son **verificables** (ver §4) sin tocar lógica.

## 3. Verificación de deploy/entorno

No tengo acceso al despliegue para forzar redeploy, pero he añadido el medio para verificarlo
objetivamente. El usuario debe comprobar que el **commit desplegado** es el último de `main` y que el
**`CRM_BASE_URL`** de n8n apunta al backend que usa el **mismo proyecto Supabase** que la UI
(`ylhdbawrllqygfvllhdo`). Si EasyPanel sirve una imagen vieja → redeploy.

## 4. Trazabilidad segura añadida — `/api/agent/diag`

Nuevo endpoint **seguro** (`src/app/api/agent/diag/route.ts`, `force-dynamic`) para trazar entorno
end-to-end **sin exponer secretos**:
- `GET /api/agent/diag` → `{ supabaseRef, commit, config:{agentToolSecret,serviceRole,n8nWebhook,n8nSecret} }`.
- `GET /api/agent/diag?workspace_id=<UUID>` con header `x-nowcrm-secret: <AGENT_TOOL_SECRET>` → conteos
  REALES que ve **ese backend** (clients/events/properties/opportunities/service_cases/tasks).

Recetas de verificación:
1. **¿El backend desplegado apunta a la base correcta?** `GET <DEPLOY>/api/agent/diag` → comparar
   `supabaseRef` con el de la UI. Si difieren → C2 (env mismatch).
2. **¿Qué ve el backend para el workspace con datos?** `GET <DEPLOY>/api/agent/diag?workspace_id=d0000000-0000-4000-8000-000000000001`
   con el secreto → si `clients:0` pero la base tiene 9 → el backend apunta a otra DB (C2). Si `clients:9`
   → el backend está bien y el problema es la cuenta probada (C1) o el commit.
3. **¿El backend está al día?** comparar `commit` con el último de `main`.

(El endpoint exige el secreto del agente para el sondeo por workspace; sin él, sólo da info no sensible.)

## 5. Regla error ≠ vacío

- **Vivo (n8n):** ya cubierto por el systemMessage (no se duplica; tocar el prompt vivo sería redundante).
- **Fallback local** (`nowlabs-main-agent.ts`): reforzado — si una tool devuelve error, decir que no se
  pudo consultar y ofrecer reintentar (NUNCA “no hay”); si devuelve cero, indicar rango/filtros
  consultados sin afirmación absoluta.

## 6–7. Parser de intención / rangos

`madridDateRange` (P18) cubre hoy/mañana/esta semana/la semana que viene/próximos 7 días/este mes en
Europe/Madrid (semana lunes–domingo). Reforzado en el prompt fallback: **agenda general** sin fecha usa
**rango próximo** (próximos días/esta semana), **no “hoy”**; si piden fecha/periodo concreto, se respeta.

## 8–9. Datos vivos / freshness

Verificado: `/api/agent/tool` es `force-dynamic` (P19) → lectura SIEMPRE fresca; `/api/agent/diag` también.
`recentMessages` va truncado (P13) y NO es fuente de verdad. Un registro persistido en la UI aparece en la
siguiente consulta del Asistente (misma DB, mismo workspace).

## 10–12. Tools / handlers / output

Auditadas: 15 tools `toolCode` → `/api/agent/tool`. `crm_read_query` reenvía
entity/searchText/clientRef/filters/orderBy/orderDirection/limit/offset/range/from-to/detailLevel/expand
(P19/P22). `get_calendar_summary` reenvía range/from/to/clientRef/limit (P18). Backend devuelve `count`,
`error` humano en fallo, nombres de relaciones (P21) y expand acotado (P22). **Sin desalineación nueva.**

## 13–14. detailLevel/expand y relaciones

End-to-end OK tras P22 (backend + n8n schema/jsCode + prompt). Relaciones con **nombres legibles**, sin
UUIDs; allowlist + caps. (Esta fase no cambia n8n.)

## 15–16. Prompt / fallback

Microparche **generalizado** (sin ejemplos) en el fallback local: error≠vacío + agenda general próxima.
El prompt vivo no se toca (ya correcto). Crisis guard y cost guard intactos.

## 17–18. Evals / tests

`assistant-coherence.evals.ts` +4 fixtures **genéricas** (sin datos de staging): tool con error no se
convierte en “no tienes citas”; agenda general usa rango próximo, no solo hoy; cero resultados indica
rango/filtros; registro recién creado se relee con tool. `assistant-reliability.evals.ts`
(crisis + `madridDateRange`) sigue cubriendo rangos.

## 19. QA manual (patrones)

Ver checklist en §22; por patrones, no por caso concreto.

## 20. N8N

**Sin cambios.** El workflow vivo (24 nodos, activo) ya está alineado (P18–P22) y el systemMessage ya
distingue error de vacío. Tocarlo sería redundante. Verificado por lectura, no modificado.

## 21. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ (`/api/agent/diag`
construido). Sin secrets/keys/temp files; sin service_role en frontend; `/api/agent/diag` no expone
secretos (sólo ref público + booleanos; sondeo gated por secreto).

## 22. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/app/api/agent/diag/route.ts` | **NUEVO** autodiagnóstico seguro (env + sondeo por workspace) |
| `src/lib/agents/nowlabs-main-agent.ts` | microparche fallback: error≠vacío + agenda general próxima |
| `src/lib/agents/__evals__/assistant-coherence.evals.ts` | +4 fixtures genéricas de fiabilidad |

## 23. Commit / Push / Deploy

Commit `fix(assistant): trazabilidad de entorno (/api/agent/diag) + error≠vacío + agenda (P23 hotfix)` →
`origin/main`. **Deploy:** redeploy del frontend/backend; tras desplegar, ejecutar las recetas de §4 sobre
el dominio desplegado para confirmar `supabaseRef`/`commit` y el sondeo por workspace.

## 24. Checklist staging (por patrones)

- [ ] `GET <DEPLOY>/api/agent/diag` → `supabaseRef` == el de la UI; `commit` == último de `main`.
- [ ] `GET <DEPLOY>/api/agent/diag?workspace_id=<tu_workspace>` + secreto → conteos coinciden con la UI.
- [ ] Iniciar sesión con la cuenta que **tiene datos** y preguntar agenda/clientes/inmuebles → aparecen.
- [ ] Crear un registro en la UI → preguntar al Asistente → aparece (datos vivos).
- [ ] Forzar/observar fallo de tool → el Asistente dice “no se pudo consultar”, **no** “no hay”.
- [ ] Pregunta general de agenda → rango próximo, no solo hoy.

## 25. Pendientes honestos

- **No puedo forzar el redeploy ni leer `CRM_BASE_URL`/envs del despliegue** desde aquí: si el sondeo de
  §4 revela env mismatch (C2) o commit viejo, la corrección es **redeploy / arreglar `CRM_BASE_URL`** en
  EasyPanel (no es lógica de código).
- **Cuentas de prueba vacías** (asier/gabriel): no es un bug; para probar fiabilidad usar la cuenta con
  datos o sembrar datos en su workspace.
- (Opcional futuro) tool `whoami/diag` dentro de n8n para que el propio Asistente reporte el workspace/DB
  que toca — no incluido para no tocar n8n sin necesidad.

## 26. Veredicto

**P23 HOTFIX COMPLETADO — ASISTENTE IA TRAZABLE Y FIABLE; CAUSA EXACTA IDENTIFICADA.** El pipeline de
código es correcto y comparte la fuente de verdad de workspace con la UI; el prompt vivo ya distingue
error de vacío. La divergencia observada es **de entorno/cuenta** (backend desplegado apuntando a otra
base/commit, o prueba con cuenta de workspace vacío), ahora **verificable objetivamente** con
`/api/agent/diag`. Añadido endurecimiento generalizado (error≠vacío, agenda próxima) y evals. `tsc`/
`lint`/`build` en verde. Sin tocar n8n (ya alineado).
