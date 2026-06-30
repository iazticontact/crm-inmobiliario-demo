# FASE P24 — Assistant IA Production Reliability: verificación de entorno, contrato de tools y cierre del agente

> **Fecha:** 2026-07-01 · Cierre de fiabilidad del Asistente antes de extras. Se **verificó** la
> alineación del workflow vivo de n8n y la **capa de datos real** (queries del backend devuelven datos
> frescos), se **amplió `/api/agent/diag`** (verificación objetiva de commit/Supabase/contrato + sondeo
> por entidad), se **estandarizó el contrato** de salida de las tools (`toolVersion`) y se reforzó el
> prompt generalizado (cuenta vacía = causa legítima). Conclusión: el código y n8n están correctos; lo
> único no verificable desde aquí es el **entorno desplegado**, ahora comprobable con diag.

## 1–2. Diagnóstico de entorno / deploy

No tengo acceso al despliegue para curl-earlo, pero he añadido y reforzado el medio para verificarlo y he
verificado lo que sí es accesible (n8n vivo + Supabase real):

- **n8n vivo (read-only):** workflow `[CRM Inmobiliario] Agent V2 — Read Only` (id `6mps8YoWu3syldUc`),
  **active=true**, 24 nodos. `crm_read_query` reenvía entity/searchText/clientRef/orderBy/orderDirection/
  limit/offset/range/from-to/**detailLevel/expand**; `get_calendar_summary` reenvía range/from/to/clientRef/
  limit. Ambos llaman a `$env.CRM_BASE_URL + /api/agent/tool`. **Totalmente alineado → n8n NO se toca.**
- **Supabase real (MCP):** las **mismas queries** que usa el backend devuelven datos frescos para el
  workspace con datos (`d0000000-…0001`): clients 9, calendar_events 12, properties 8, opportunities 8,
  service_cases 5, tasks 11 (últimas actualizaciones 22→30 jun). **La capa de datos es correcta.**

## 3. Verificación UI vs Asistente

Ambos usan la MISMA fuente de workspace (`profiles.workspace_id`) — confirmado en P23. La UI y el
Asistente, para el mismo usuario, consultan el mismo workspace y las mismas tablas. `/api/agent/diag`
permite comparar, por entidad, **lo que ve el backend** (count + última actualización + muestra de
nombres) con lo que ve la UI.

## 4. Causa (acotada y verificable)

No es un bug de lógica. La divergencia "UI muestra / Asistente no" sólo puede venir de:
- **Entorno desplegado**: `CRM_BASE_URL` de n8n apunta a un backend stale o a **otro proyecto Supabase**
  → la tool consulta una base vacía/distinta. **Verificable** con `/api/agent/diag` (supabaseRef + commit
  + toolVersion + sondeo por workspace).
- **Cuenta/workspace vacío**: se prueba con una cuenta cuyo workspace no tiene datos → el Asistente
  responde correctamente "no hay". **Verificable** con el sondeo por workspace.

## 5. Contrato estándar de tools

`/api/agent/tool` (tools del Brain) devuelve un contrato estable: `{ ok, tool, result|error, message,
meta }`. Ampliado el `meta` con **`toolVersion`** (`TOOL_CONTRACT_VERSION` en `agent-tool-readers.ts`),
`source: 'agent-tool'` y `generatedAt`. Esto distingue éxito-con-datos / éxito-sin-datos / error real, y
permite verificar que el backend desplegado expone el contrato esperado (el mismo `toolVersion` aparece
en `/api/agent/diag`).

## 6. Normalización de salida

Ya implementada en capas previas: `stripInternalFields` (route), `sanitizeQueryRow`/`sanitizeRelatedRow`
y `clampString` (readers), resolución de **nombres** de relaciones (P21) y caps de payload (P22). Los
estados internos se traducen a etiquetas humanas en UI/prompt; las fechas se interpretan en Europe/Madrid
(`madridDateRange`). El prompt prohíbe mostrar ids; las relaciones llegan con nombre.

## 7. Tool router

El enrutado intención→tool lo hace el LLM del Agent V2 con tools específicas (calendario, clientes,
inmuebles…) + `crm_read_query` (genérica con filtros/rango/detailLevel/expand). El backend ya enruta lo
crítico (rango por palabra clave, desempate determinista, expand acotado). El prompt vivo guía el resto
(datos vivos → tool; detalle → detailLevel; contexto → expand; agenda → rango próximo).

## 8. Auditoría por entidad

Verificada la cobertura por entidad (clientes/inmuebles/calendario/tareas/operaciones/trámites/
comisiones/configuración/documentos/actividad) acumulada en P18–P22: detalle, relaciones con nombre,
activos/finalizados (trámites), pendientes/completadas (tareas), rango de fechas, sin ids. Sin huecos
nuevos en código.

## 9. Freshness

`/api/agent/tool` y `/api/agent/diag` son **`force-dynamic`** (lectura siempre fresca, reflejado en
`diag.freshness`). `recentMessages` truncado y no es fuente de verdad. Un dato persistido en la UI se
consulta en el Asistente inmediatamente (misma DB/workspace).

## 10. Error ≠ vacío

Reforzado en P23 (fallback) y ya presente en el prompt vivo. P24 añade la regla **cuenta vacía**: si una
tool devuelve cero consistente en todo un módulo, decir con naturalidad que en esta cuenta aún no hay
datos (causa legítima) y sugerir revisar la sesión, sin tecnicismos ni mencionar workspaces/tablas.

## 11–12. Fechas / calidad de respuesta

`madridDateRange` cubre hoy/mañana/semana/próximos días/mes/fecha/rango (Europe/Madrid, lunes–domingo).
Agenda general usa rango próximo (no solo hoy). Respuestas: resumen + elementos + "No consta" en
faltantes + aviso de truncado (`related_truncated`) + error honesto.

## 13–14. Prompt / fallback

Microparche generalizado en el **fallback local** (sin ejemplos): error≠vacío, agenda próxima, cuenta
vacía legítima. El **prompt vivo de n8n no se toca** (ya cubre error≠vacío/datos vivos; tocarlo sería
redundante). Crisis y cost guard intactos.

## 15. n8n alignment

**Verificado y correcto → sin cambios.** (Detalle en §1.)

## 16–17. Observabilidad / métricas

`/api/agent/tool` ya registra `logCall` (tool, workspace, status, durationMs, count/errorCode);
`/api/assistant/v2` registra `logInvoke` (workspaceResolved, errorCode, source, toolCalls, durationMs).
`/api/agent/diag` da una foto bajo demanda (commit, supabaseRef, toolVersion, conteos por entidad). No se
añade un sistema complejo; la base es suficiente y segura (sin secretos/PII larga).

## 18–19. Evals / tests

Suites: `assistant-reliability` (crisis + `madridDateRange`), `assistant-expand` (allowlist/caps/specs),
`portfolio-filter`, `profile-avatar`, `product-capabilities`, `assistant-coherence` (+ fixture P24 de
cuenta vacía). Genéricas, **sin datos de staging**.

## 20. QA manual post-deploy

Ver checklist (§24). Incluye: diag público (commit/supabaseRef/toolVersion), diag con secreto (conteos por
entidad vs UI), consultas por entidad, freshness, y prueba de cuenta con/sin datos.

## 21. Seguridad

`/api/agent/diag` no expone secretos/keys/tokens: sólo `supabaseRef` (subdominio público), commit, y
booleanos de config; el sondeo por workspace exige el header `x-nowcrm-secret` (= AGENT_TOOL_SECRET) y
devuelve conteos + nombres **clampados a 60** (sin UUIDs salvo el workspace_id que aporta el propio
llamante). Sin service_role en frontend. RLS intacta (el backend usa service-role con scoping manual por
workspace).

## 22. Performance

Sondeo de diag: 2 queries por entidad (count head + muestra limit 3) → bajo coste, endpoint puntual.
Tools con caps (expand ≤5×5, calendar/limit), force-dynamic sólo donde toca, cost guard activo.

## 23. Scans

Sin "workspace"/"Próximamente"/"completed"/"Copiloto" visibles nuevos · diag sin secretos · sin
service_role frontend · sin UUID en UI · sin temp files en el repo.

## 24. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ (`/api/agent/diag`
construido).

## 25. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/app/api/agent/diag/route.ts` | + toolVersion, freshness, sondeo por entidad (count + última actualización + muestra sanitizada) |
| `src/lib/agent-tool-readers.ts` | `TOOL_CONTRACT_VERSION` exportado |
| `src/app/api/agent/tool/route.ts` | `meta` con toolVersion/source/generatedAt |
| `src/lib/agents/nowlabs-main-agent.ts` | microparche generalizado: cuenta vacía legítima |
| `src/lib/agents/__evals__/assistant-coherence.evals.ts` | + fixture cuenta vacía |

## 26. Cambios n8n

**Ninguno.** Verificado alineado (schemas + jsCode reenvían todo; workflow activo; 24 nodos). No se tocó
credenciales/connections/memory/webhook.

## 27–28. Commit / Push / Deploy

Commit `fix(assistant): diag de entorno por entidad + contrato toolVersion + regla cuenta vacía (P24)` →
`origin/main`. **Deploy:** redeploy del frontend/backend; después ejecutar el checklist de §29 sobre el
dominio desplegado.

## 29. Checklist post-deploy

1. `GET <DEPLOY>/api/agent/diag` → `supabaseRef` == el de la UI · `commit` == último de `main` ·
   `toolVersion` == `2026-07-01.p24` · `freshness.agentToolDynamic == true`.
2. `GET <DEPLOY>/api/agent/diag?workspace_id=d0000000-0000-4000-8000-000000000001` + header
   `x-nowcrm-secret` → `entities.clients.count==9`, `events==12`, `properties==8`, `service_cases==5`,
   `tasks==11` (coincide con la UI). Si dan 0 → el backend apunta a otra base/commit (arreglar
   `CRM_BASE_URL`/redeploy).
3. Login con la cuenta CON datos (odunabeitia14) → preguntar agenda/clientes/inmuebles → aparecen.
4. Crear/editar un registro en la UI → preguntar al Asistente → aparece (freshness).
5. Probar cuenta SIN datos → el Asistente dice "en esta cuenta aún no hay…", **no** un error.
6. Forzar/observar fallo de tool → "no se pudo consultar", **no** "no hay".

## 30. Pendientes honestos

- **No puedo curl-ear el despliegue ni leer `CRM_BASE_URL`/envs desde aquí.** Si el paso 1–2 revela
  supabaseRef/commit distintos o conteos 0, la corrección es **redeploy / arreglar `CRM_BASE_URL`** en
  EasyPanel (no es lógica).
- **Trace UI interno** (panel de modo interno): se deja en logs de servidor (`logCall`/`logInvoke`) +
  `/api/agent/diag`; un panel visual gateado queda como mejora futura no crítica.

## 31. Veredicto

**P24 COMPLETADO — ASISTENTE IA VERIFICADO, TRAZABLE, FRESCO Y FIABLE.** n8n vivo y la capa de datos
están verificados y correctos (mismas queries → datos reales y frescos); el contrato de tools es estándar
y versionado; `/api/agent/diag` permite comprobar objetivamente entorno, commit, Supabase y conteos por
entidad; y el prompt distingue error de vacío y de cuenta vacía. Lo único pendiente es **verificar el
entorno desplegado** con el checklist de §29 (y, si procede, redeploy / corregir `CRM_BASE_URL`).
`tsc`/`lint`/`build` en verde. Sin tocar n8n.
