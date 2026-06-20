# FASE N2.7 — El 503 del `/api/agent/tool` NO era `endpoint_disabled` sino un GRANT que faltaba a `service_role`

> **Fecha:** 2026-06-20 · Proyecto Supabase `crm-inmobiliario-demo` (ref
> `ylhdbawrllqygfvllhdo`) · Deploy CRM staging
> `https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host`. Diagnóstico por probe
> directo + Supabase MCP. Fix = **una migración de GRANT** (sin tocar schema/RLS/datos,
> sin tocar env, sin redeploy del CRM, sin tocar n8n).

---

## 1. Punto de partida (hipótesis de N2.6, refutada)
N2.6 dejó la tool de n8n llegando al CRM y el CRM devolviendo **503**. Se asumió
`endpoint_disabled` (faltaría `AGENT_TOOL_SECRET`/`SUPABASE_SERVICE_ROLE_KEY`/
`NEXT_PUBLIC_SUPABASE_URL` en el deploy). **Era incorrecto.**

## 2. Diagnóstico real (verificado, no asumido)
La condición `endpoint_disabled` está en `src/app/api/agent/tool/route.ts:270` y se
dispara **solo si falta** alguna de las 3 env vars; corre **antes** del check de secreto.

| Prueba | Resultado | Conclusión |
|---|---|---|
| `.env.local` local | las 3 vars SET (no vacías) | local OK |
| `POST /api/agent/tool` a staging **sin** secreto | **401 `unauthorized`** (no 503) | **endpoint HABILITADO** en staging → las 3 env existen |
| `GET /api/agent/tool` a staging | 405 (route existe) · `GET /` 307 (app viva) | deploy correcto y vivo |
| Deploy URL (capturado de n8n) | `crm-...-staging.hvdnby.easypanel.host` | n8n apunta bien |
| `NEXT_PUBLIC_SUPABASE_URL` de staging (público, del cliente) | `ylhdbawrllqygfvllhdo.supabase.co` | mismo proyecto canónico, **correcto** |
| `POST` a staging **con** secreto de `.env.local` | **503 `workspace_lookup_failed`** (no 401) | el secreto **coincide**; el 503 es **posterior** al auth |
| Probe PostgREST directo con `SUPABASE_SERVICE_ROLE_KEY` | **403 `42501 permission denied for table workspaces`** | el rol `service_role` **no tiene privilegios de tabla** |
| MCP: grants de `service_role` en las 12 tablas public | **SELECT = false en las 12** | causa raíz confirmada |

**El 503 era `workspace_lookup_failed` (route.ts:326)**, no `endpoint_disabled`. La query
`from('workspaces')...` con la service role key fallaba con `42501 permission denied`.

## 3. Causa raíz
El rol **`service_role` no tenía privilegios DML (SELECT/INSERT/UPDATE/DELETE) sobre
NINGUNA tabla del schema `public`** (solo REFERENCES/TRIGGER/TRUNCATE). La migración
`20260615_2e2_grant_authenticated_table_privileges.sql` concedió DML a `authenticated`
pero **dejó `service_role` sin tocar "porque ya bypassa RLS"** — supuesto **falso**:
`service_role` salta las **policies RLS** pero **no** los **privilegios de tabla**. Sin
GRANT, toda query de `service_role` da `42501` *antes* de evaluar RLS.

Como **`/api/agent/tool` es el ÚNICO consumidor de `service_role`** (el resto del CRM usa
anon/authenticated + RLS), el bug solo afectaba a este endpoint → por eso nadie lo había
visto. No es env, no es deploy, no es el secreto, no es n8n: es un **GRANT de BD que
faltaba**.

## 4. Fix aplicado (migración, idempotente)
Restaurados los privilegios estándar de `service_role` en `public` (lo que Supabase
concede por defecto y aquí faltaba). Aplicado en runtime vía MCP **y** versionado en
`supabase/migrations/20260620_n27_grant_service_role_table_privileges.sql`:
```sql
grant usage on schema public to service_role;
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
```
**No cambia** tablas, columnas, datos, seed, policies RLS, Auth, Storage ni API keys. El
endpoint sigue **read-only por código** (mutaciones → 410) y **workspace-scoped**.

## 5. Verificación end-to-end (PROBADO)
- MCP: `service_role` ahora tiene **SELECT en 12/12** tablas.
- Staging `POST /api/agent/tool` `get_crm_overview` → **HTTP 200**, `ok:true`, 9 clientes.
- Staging `get_latest_client` → **HTTP 200**, devuelve el cliente con
  `metadata.document_id` (el DNI).
- **Cadena completa por n8n** (`exec #1255`, workflow activado solo para la prueba y
  **dejado `active=false`**): `status success`, **sin error de schema**, el agente llamó
  `get_latest_client`, recibió los datos y respondió con el DNI correcto. **El Agent V2
  funciona de punta a punta.**

## 6. Entrega (lo que pedía la fase)
1. **Causa exacta del 503:** `workspace_lookup_failed` — la query de `service_role`
   fallaba con `42501 permission denied` por falta de GRANT (NO `endpoint_disabled`).
2. **Env que falta / condición que falla:** **ninguna env** falta. Falla un **privilegio
   de BD**: `service_role` sin DML en las tablas de `public`.
3. **Qué variable debe estar en EasyPanel CRM:** **ninguna nueva.** Las 3
   (`AGENT_TOOL_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`) ya
   estaban bien en staging. El fix es de BD (un GRANT), compartido por todos los deploys
   del mismo proyecto.
4. **¿Requiere redeploy del CRM?** **No.** Es un cambio en la BD; surte efecto al instante
   para local y staging (ambos apuntan a `ylhdbawrllqygfvllhdo`). Sí conviene aplicar la
   migración en cualquier proyecto futuro recreado desde migraciones.
5. **Comando de test seguro** (no imprime secretos):
   ```bash
   SEC=$(grep -E '^AGENT_TOOL_SECRET=' .env.local | cut -d= -f2-)
   curl -s -X POST "https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host/api/agent/tool" \
     -H "Content-Type: application/json" -H "x-nowcrm-secret: $SEC" \
     -d '{"tool":"get_crm_overview","workspace_id":"d0000000-0000-4000-8000-000000000001","input":{}}' \
     -w "\nHTTP %{http_code}\n"
   # Esperado: HTTP 200, {"ok":true,...}
   ```

## 7. Qué NO se tocó
Schema de tablas, columnas, datos, seed, **policies RLS**, Auth, Storage, API keys,
`.env.local`, `.mcp.json`, runtime del CRM (`src/`), workflows antiguos. El workflow de
n8n se activó **solo** para la prueba E2E y se **dejó `active=false`**. `anon` sigue sin
DML. No se imprimió ningún secreto.

## Veredicto
**N2.7 COMPLETADO — CRM TOOL ENDPOINT ACTIVO.** El 503 no era `endpoint_disabled` sino
`workspace_lookup_failed` por un **GRANT que le faltaba a `service_role`** (la migración
de 2E-2 lo omitió deliberadamente por un supuesto erróneo sobre RLS vs privilegios).
Restaurados los grants (migración versionada). Verificado: staging responde 200 con datos
y el **Agent V2 de n8n devuelve el DNI del último cliente de punta a punta**. Sin cambios
de env, sin redeploy, sin tocar schema/RLS.
