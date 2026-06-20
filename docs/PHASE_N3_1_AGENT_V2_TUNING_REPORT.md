# FASE N3.1 — Afinado del Agent V2: arreglo de "Dame datos sobre Oier" + modelo + recuperación

> **Fecha:** 2026-06-21 · Workflow n8n `6mps8YoWu3syldUc` (ACTIVO) · Deploy CRM
> `crm-inmobiliario-crm-staging.hvdnby.easypanel.host`. Toca runtime CRM (`src/`) →
> **requiere redeploy** para el arreglo definitivo de `search_clients` (ya mitigado por
> prompt sin redeploy). Sin tocar `.env.local`, `.mcp.json`, secretos, schema/RLS,
> workflows antiguos. Sin SQL libre, sin service_role en n8n, sin escrituras.

---

## 1. Causa exacta del fallo "Dame datos sobre Oier"
**`search_clients` devolvía HTTP 410 (`tool_retired`).** En
`src/app/api/agent/tool/route.ts`, `search_clients` estaba **a la vez** en
`ALLOWED_TOOLS`/`BRAIN_TOOLS` (tool real, N1.1) **y** en `RETIRED_TOOLS` (entrada vieja).
La comprobación de retiradas corre **antes** → `search_clients` siempre respondía 410,
ensombreciendo la tool real. Flujo del fallo: el agente llamaba `search_clients(query="Oier")`
→ CRM 410 → el `toolCode` lo capturaba como `crm_unreachable` → el agente decía
"no puedo acceder a los datos". Verificado por probe directo al endpoint:
`search_clients`→410, mientras `get_client_360`/`crm_read_query`/`get_latest_client`/
`get_crm_overview`→200.

## 2. Tool que falló / no se invocó
`search_clients` (se invocaba pero el endpoint la rechazaba con 410). No era memoria/
threadId (la continuidad de hilo funciona), ni 401/403, ni el normalizador del CRM.

## 3. Cambios aplicados
### a) Runtime CRM (requiere redeploy)
- **`search_clients` eliminado de `RETIRED_TOOLS`** (sigue en `ALLOWED_TOOLS`+`BRAIN_TOOLS`).
  Con esto `search_clients(query)` despacha al reader `searchClients` (ilike sobre
  name/company/email/phone, workspace-scoped, ≥2 chars) y devuelve candidatos con `id`.

### b) Workflow n8n (ya en vivo, sin redeploy)
- **Modelo:** ya estaba en **`gpt-4.1-mini`** (temp **0.2**) — coincide con el objetivo de
  la fase; no hubo que cambiarlo. Tools `toolCode` y cabeceras `x-nowcrm-secret` intactas.
- **Prompt (ajuste quirúrgico, 3245→4422 chars):** añadidas reglas de RECUPERACIÓN y de
  consulta de cliente, y endurecida la prohibición de "no puedo acceder":
  - Para "dame datos / info / quién es X": `search_clients(query=X)` → 1 candidato claro →
    `get_client_360` (ficha breve); varios → candidatos + pregunta; ninguno →
    "No encuentro ningún cliente con X". Sin resultados **no** es "no puedo acceder".
  - **Recuperación ante fallo/vacío:** si `search_clients` falla, usar
    `crm_read_query(entity=clients)` (**devuelve el id**) y filtrar por nombre; con ese id,
    `get_client_360` / `get_client_opportunities` / `get_client_service_cases`; "el último/
    nuevo cliente" → `get_latest_client`. Solo avisar de error si **todas** las vías fallan.
  - Prohibido "no tengo acceso directo" **y** "no puedo acceder a los datos" salvo fallo
    real de sistema tras agotar alternativas.
  > Efecto colateral muy útil: con la recuperación por `crm_read_query`, el agente
  > **ya funciona aunque `search_clients` siga 410** (mientras llega el redeploy).

## 4. Modelo → gpt-4.1-mini
Sí, el modelo en uso es **`gpt-4.1-mini`** (temp 0.2). (Ya estaba puesto; se confirmó y
preservó en el PUT del prompt.)

## 5. Prompt tocado
**Sí**, ajuste quirúrgico (reglas de recuperación + ruteo de cliente + guard de error).
No se hizo infinito; el bloque JUICIO CONVERSACIONAL y los límites de módulo ya estaban.

## 6. Evals (contra el webhook de producción, PII redactada)
| # | Caso | Resultado |
|---|---|---|
| 1 | Hola | "Hola, ¿en qué puedo ayudarte hoy?" ✅ |
| 2 | Quién eres | empleado interno, breve ✅ |
| 4 | **Dame datos sobre Oier** | **encuentra a Oier Duñabeitia Berezo y da sus datos ✅ (antes fallaba)** |
| 5 | DNI de Oier | da el DNI real ✅ |
| 6 | su email y teléfono | email+tel (memoria de hilo) ✅ |
| 7 | ficha completa | empresa/email/tel/dirección(Bilbao)/DNI/nacionalidad ✅ |
| 8 | qué operaciones tiene | "no tiene operaciones registradas" (honesto, no error) ✅ |
| 12 | leer su PDF | lista metadata, no contenido (honesto) ✅ |
| 13 | hazme una factura | "esta versión solo consulta… te doy datos fiscales" ✅ |
(9 pausa / 10 "a qué me esperas" / 11 "funcionas mal" ya validados en N3 con el mismo
bloque conversacional, sin cambios.) **0 errores genéricos falsos**, usa tools, no inventa,
nada de V1.

## 7. Errores pendientes
- Ninguno funcional en los evals. `search_clients` directo sigue 410 **hasta el redeploy**;
  el agente lo suple por `crm_read_query`. Tras el redeploy, `search_clients` será el camino
  primario (más directo) y la recuperación queda como red de seguridad.
- gpt-4.1-mini llama a tools con bastante fiabilidad (mejor que gpt-4o-mini en pruebas).

## 8. ¿Requiere redeploy?
**Sí**, del CRM, para el arreglo definitivo de `search_clients` (cambia `src/`). El agente
ya responde bien sin él gracias a la recuperación por prompt.

## 9. Validaciones / seguridad
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Workflow leído por API (`active=true`,
gpt-4.1-mini, 15 toolCode, cabeceras intactas). Backup `n8n/workflows/crm-agent-v2-readonly.json`
sincronizado. Sin secretos ni PII real en el diff (DNI/email/tel redactados en este informe).

## Veredicto
**N3.1 COMPLETADO — AGENT V2 FIABLE EN /ASSISTANT.** Causa real: `search_clients` retirada
por error (410) ensombrecía la tool viva. Arreglado en runtime (quitada de `RETIRED_TOOLS`;
requiere redeploy) y mitigado YA por prompt (recuperación vía `crm_read_query`, que devuelve
id y permite ficha/operaciones). Modelo `gpt-4.1-mini`@0.2. Evals verdes incluido "Dame
datos sobre Oier". V1 sigue retirado. Próximo: **redeploy del CRM** para el camino directo
de `search_clients`.
