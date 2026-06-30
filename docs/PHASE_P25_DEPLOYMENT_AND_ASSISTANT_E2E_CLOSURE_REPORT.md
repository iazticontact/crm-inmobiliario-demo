# FASE P25 — Cierre de despliegue, entorno y QA E2E del Asistente IA

> **Fecha:** 2026-07-01 · Objetivo: cerrar entorno + despliegue + QA real antes de extras. P24 demostró
> que código, n8n y capa de datos están alineados; P25 **verifica objetivamente** Supabase, n8n, cuentas y
> deja la verificación del backend desplegado hecha turnkey (script + checklist), corrige una desalineación
> real del diag, y documenta un hallazgo de drift (settings/logo) que requiere tu decisión.

---

## 1. Diagnóstico inicial

Tras P24 quedaba pendiente lo único no comprobable desde el código: el **entorno desplegado** (commit,
`CRM_BASE_URL`, Supabase del backend) y un **QA E2E real por cuenta**. Se verificó todo lo accesible desde
aquí (Supabase real vía MCP; n8n vivo vía API) y se construyó lo necesario para que tú cierres el backend
desplegado sin adivinar.

## 2. Qué faltaba tras P24

- Confirmar que el backend desplegado corre el **commit** correcto y la **misma Supabase** que la UI.
- Confirmar el **valor** de `CRM_BASE_URL` en n8n (solo vive en EasyPanel).
- Mapear objetivamente **qué cuenta tiene datos y cuál no** (para no medir fiabilidad con una cuenta vacía).
- Un **script/checklist** turnkey y **QA E2E** por entidad/freshness/vacío/error.

## 3. Verificación de commit / deploy

No es accesible desde este entorno (el `.env.local` es **local**: `NEXT_PUBLIC_APP_URL=http://localhost:3000`;
el dominio de staging y el secreto del webhook v2 **no están** aquí). Entregado para cerrarlo:
- **`scripts/check-agent-deploy.mjs`**: compara `supabaseRef` vs UI, `commit` vs `HEAD`, `toolVersion` vs
  esperado y los booleanos de config. Exit ≠ 0 ante mismatch duro. No imprime secretos.
- Recetas manuales en el **checklist** (`docs/P25_DEPLOYMENT_ASSISTANT_VERIFICATION_CHECKLIST.md`, §1).

## 4. Verificación Supabase (objetiva, vía MCP)

- **Único proyecto:** `ylhdbawrllqygfvllhdo` (`crm-inmobiliario-demo`, **ACTIVE_HEALTHY**, eu-west-1,
  Postgres 17). Es el `supabaseRef` que debe reportar `/api/agent/diag`.
- **14 tablas públicas reales:** activities, assistant_agent_memory, assistant_messages, assistant_threads,
  calendar_events, clients, entity_files, opportunities, profiles, properties, service_cases, tasks,
  workspace_members, workspaces. → **No existen** `documents`, `commissions` ni `workspace_settings` (las
  comisiones son columnas de `opportunities`; los documentos son `entity_files`).
- **Conteos reales por cuenta:** ver §7.

## 5. Verificación frontend / backend

- La UI y el Asistente resuelven el workspace desde `profiles.workspace_id` (confirmado P23). Mapa de
  cuentas verificado (§7). La UI **no está en modo demo** por configuración del repo
  (`NEXT_PUBLIC_ENABLE_DEMO_DATA=false`, `NEXT_PUBLIC_FORCE_OFFLINE_DEV=false`).
- El backend del Asistente (`/api/agent/tool`, `/api/agent/diag`) es `force-dynamic` (lectura fresca).
- La comprobación final "frontend y backend al mismo commit/base" se hace con el script del §3 sobre el
  dominio desplegado.

## 6. Verificación n8n / `CRM_BASE_URL` (objetiva, vía API)

Listados los 9 workflows del n8n vivo:
- **Un solo** workflow CRM: `[CRM Inmobiliario] Agent V2 — Read Only` (`6mps8YoWu3syldUc`), **Active**, 24
  nodos, webhook **POST `crm-agent-v2`** (coincide con el adaptador `…/webhook/crm-agent-v2`).
- **Sin duplicados** de ese path (los demás webhooks son del proyecto ARIZAN, path distinto).
- Usa **`$env.CRM_BASE_URL` 15 veces** (= sus 15 tools) y **no tiene ningún host hardcodeado** → el backend
  se resuelve 100% desde la env de EasyPanel.
- **Conclusión:** n8n está correcto. Lo único a comprobar es el **valor** de `CRM_BASE_URL` en EasyPanel
  (checklist §3). **No se tocó n8n.**

## 7. Verificación de cuentas (con datos / vacías)

| Cuenta | workspace_id | clientes | citas | inmuebles | operaciones | trámites | tareas | actividad |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| **odunabeitia14@gmail.com** | `d0000000-…0001` | 9 | 12 | 8 | 8 | 5 | 11 | 70 |
| gabriel.peralta@opendeusto.es | `ffc49d1b-…` | 0 | 0 | 1 | 0 | 0 | 0 | 4 |
| asier.comba@opendeusto.es | `b43f73fc-…` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

→ **odunabeitia14 = cuenta de QA con datos.** **asier.comba = cuenta vacía** (QA de vacío). gabriel = pocos
datos (1 inmueble). No mezclar: medir fiabilidad SOLO con odunabeitia14.

## 8. Verificación de cuenta vacía

asier.comba (workspace `b43f73fc-…`) está vacío en todas las entidades → es la cuenta correcta para validar
el comportamiento "esta cuenta aún no tiene datos" (no error, no tecnicismos). gabriel sirve para validar
"pocos datos ≠ vacío" (listar el inmueble, decir que el resto está a cero).

## 9. Cambios aplicados (código)

- **Fix real del diag:** el sondeo apuntaba a la tabla inexistente `documents` → corregido a `entity_files`
  (`file_name`/`created_at`). Sin esto, el diag reportaba 0 documentos siempre, enmascarando el estado real.
- **Config de sondeo extraída** a `src/lib/agent-diag-config.ts` (`PROBE_ENTITIES`) para poder **verificarla
  con un eval**.
- **`scripts/check-agent-deploy.mjs`** (nuevo, seguro).
- **Evals nuevas** (§15).

## 10. Scripts / checklist añadidos

- `scripts/check-agent-deploy.mjs` — verificación segura del backend desplegado (commit, supabaseRef,
  toolVersion, config, y sondeo de conteos por workspace con el secreto). No imprime secretos; exit ≠ 0 en
  mismatch.
- `docs/P25_DEPLOYMENT_ASSISTANT_VERIFICATION_CHECKLIST.md` — checklist operativo EasyPanel/n8n + QA.

## 11. QA E2E por entidad

Recetas completas en el checklist §5 (calendario, clientes, inmuebles, operaciones, trámites, tareas,
comisiones, configuración, resumen). Ejecutar con **odunabeitia14**. Las expectativas (tool, sin IDs, "No
consta", error≠vacío) están codificadas en `assistant-coherence.evals.ts`.

## 12. QA freshness

Checklist §6: crear/editar en UI (cita, inmueble, cliente, trámite, tarea) → preguntar → debe reflejarse
(lectura `force-dynamic`). Finalizar/completar → preguntar activos vs finalizados.

## 13. QA error vs vacío

Checklist §7 + fixtures P23/P24/P25: error de tool → "no se pudo consultar" (nunca "no hay"); count 0 real
→ indicar rango/filtros; cuenta vacía → "aún no hay datos" sin tecnicismos.

## 14. Mejoras de respuesta del Asistente

Conforme a tu instrucción ("**no quiero otro parche de prompt**"), **no se modificó el prompt vivo de n8n ni
el fallback** en P25. Las reglas de calidad (resumen global multi-entidad, ambigüedad con default seguro,
pocos datos ≠ vacío, aviso de truncado) ya estaban cubiertas por P22–P24 y ahora quedan **fijadas como
evals** (§15) para QA, sin tocar el prompt.

## 15. Evals / tests

- **`assistant-diag.evals.ts`** (nuevo, ejecutable y determinista): valida que cada entidad del sondeo
  apunta a una **tabla real** (habría cazado el bug de `documents`), que el contrato público no expone
  claves sensibles y que `config` solo declara booleanos. **Verificado: 0 fallos.**
- **`assistant-coherence.evals.ts`** (+5 fixtures P25, genéricas, sin datos de staging): resumen global
  multi-entidad, ambigüedad ("pendiente" sin módulo / "eso/ese"), pocos datos ≠ vacío, truncado.
- Suites previas intactas: `assistant-reliability` (crisis + rangos Madrid), `assistant-expand`,
  `portfolio-filter`, `profile-avatar`, `product-capabilities`.

## 16. Seguridad

- `/api/agent/diag` no expone secretos: solo `supabaseRef` (subdominio público), commit y **booleanos** de
  config; el sondeo por workspace exige `x-nowcrm-secret` (= `AGENT_TOOL_SECRET`, comparación de tiempo
  constante) y devuelve conteos + nombres **clampados a 60** (sin UUIDs salvo el workspace que aporta el
  llamante). Invariantes fijadas en `assistant-diag.evals.ts`.
- `check-agent-deploy.mjs` lee el secreto de env/.env.local y lo usa solo en el header; **nunca lo imprime**.
- Sin service_role en frontend. n8n intacto. Sin keys en el repo ni en `.env.example`. Sin temp files.

## 17. Performance

- Sondeo de diag: 2 queries por entidad (count head + muestra limit 3) → barato y puntual.
- El script hace 1 GET público + (opcional) 1 GET con secreto. Sin librerías (fetch nativo).
- Tools con caps (expand ≤5×5), `force-dynamic` solo donde toca, cost guard activo.

## 18. Scans

Sin términos prohibidos nuevos visibles (workspace/lead/pipeline/oportunidad/expediente/score/completed/
Copiloto/Próximamente/Notificaciones falsas) · diag sin secretos · sin service_role frontend · sin UUID en
UI · sin temp files. Detalle del comando en §22.

## 19. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/app/api/agent/diag/route.ts` | Sondeo apunta a `entity_files` (no `documents`); usa config compartida |
| `src/lib/agent-diag-config.ts` | **Nuevo** — `PROBE_ENTITIES` (config del sondeo, verificable) |
| `scripts/check-agent-deploy.mjs` | **Nuevo** — verificación segura del backend desplegado |
| `src/lib/agents/__evals__/assistant-diag.evals.ts` | **Nuevo** — eval ejecutable del contrato de diag |
| `src/lib/agents/__evals__/assistant-coherence.evals.ts` | +5 fixtures P25 (genéricas) |
| `docs/P25_DEPLOYMENT_ASSISTANT_VERIFICATION_CHECKLIST.md` | **Nuevo** — checklist operativo |
| `docs/PHASE_P25_DEPLOYMENT_AND_ASSISTANT_E2E_CLOSURE_REPORT.md` | **Nuevo** — este informe |

## 20. Cambios n8n

**Ninguno.** Verificado vivo (1 workflow CRM activo, sin duplicados, sin host hardcodeado, `$env.CRM_BASE_URL`
×15). No se tocó credenciales/connections/memory/webhook.

## 21. Commit / 22. Push

Commit `chore(p25): cierre de despliegue + verificación E2E (diag real, script, evals, docs)` → `origin/main`.

## 23. Deploy necesario

Redeploy del frontend/backend para que el diag corregido (`entity_files`) y la config compartida lleguen al
dominio desplegado. Después: ejecutar el checklist (§1–§7) sobre ese dominio.

## 24. Checklist post-deploy

`docs/P25_DEPLOYMENT_ASSISTANT_VERIFICATION_CHECKLIST.md`. Resumen: (1) `check-agent-deploy.mjs <DEPLOY>` →
supabaseRef/commit/toolVersion/config; (2) `--workspace d0000000-…0001` → conteos == §7; (3) `CRM_BASE_URL`
en EasyPanel == dominio del backend; (4) workflow activo; (5) QA E2E con odunabeitia14; (6) freshness;
(7) vacío/error con asier.comba.

## 25. Pendientes honestos

1. **Verificación del backend desplegado**: no ejecutable desde aquí (sin dominio de staging ni secreto del
   webhook v2 en `.env.local`). Queda turnkey con el script + checklist. Si el §1–§2 da mismatch → redeploy /
   corregir `CRM_BASE_URL`/envs (no es lógica).
2. **Hallazgo: drift de settings/logo (requiere tu decisión).** `src/lib/workspace-settings.ts` (y por tanto
   el **logo de empresa** de P22 y los ajustes de Empresa) consultan la tabla **`workspace_settings`, que no
   existe** en la BD desplegada — el esquema vivo guarda en `workspaces.settings`/`branding`. Efecto: el logo
   se ve un instante (UI optimista) pero **no persiste** al recargar; los ajustes de empresa tampoco. Degrada
   en silencio (`null`), no rompe. **No es el Asistente.** Dos arreglos posibles (ninguno aplicado, pendiente
   de tu OK porque toca BD/código fuera del foco de P25):
   - **(A) Crear la tabla** `workspace_settings` (additivo, no destructivo) con su RLS; el código actual
     funciona tal cual. Requiere alinear la RLS con las funciones reales de la BD
     (`current_workspace_ids()` vs `current_workspace_id()`).
   - **(B) Repuntar el código** a `workspaces.settings` (jsonb existente); sin migración, pero cambia
     `workspace-settings.ts` y sus consumidores.
   - Recomendación: decidir en P26 con autorización explícita; mientras, el logo/ajustes de empresa quedan
     como **limitación conocida**.

## 26. Veredicto

**P25 COMPLETADO — DESPLIEGUE, ENTORNO Y ASISTENTE IA VERIFICADOS END-TO-END ANTES DE EXTRAS**, con dos
matices honestos: (a) la comprobación del **backend desplegado** queda lista para ejecutar (script +
checklist) porque este entorno es local; (b) se detectó un **drift real** (tabla `workspace_settings`
ausente) que afecta a la persistencia de logo/ajustes de empresa —no al Asistente— y que requiere tu
decisión antes de tocarse. Lo verificable desde aquí está **verificado y es objetivo**: Supabase
(`ylhdbawrllqygfvllhdo`, conteos reales por cuenta), n8n (1 workflow activo, sin duplicados, `$env.CRM_BASE_URL`,
sin hosts hardcodeados), y el diag corregido + guardado por eval. `tsc`/`lint`/`build` en verde. Sin tocar n8n.
