# Claude Code ↔ n8n — gestión de workflows por MCP/API (FASE N0.2)

> **Fecha:** 2026-06-18 · **Objetivo:** que Claude Code CREE/LISTE/EDITE workflows
> en tu n8n (no solo genere JSON). Sin secretos en el repo.

---

## 1. Diagnóstico (verificado en vivo)
- **`.mcp.json` YA está bien configurado y es seguro:** tiene el servidor MCP
  **`n8n-mcp`** (community, `cmd /c npx -y n8n-mcp`) con `env` por **indirección de
  variables**: `N8N_API_URL=${N8N_API_URL}` y `N8N_API_KEY=${N8N_API_KEY}`. Es decir
  **NO hay ningún secreto dentro del archivo** (lee de variables de entorno). Sigue
  gitignored y no trackeado. ✅
- **`/mcp-server/http` (conector `claude.ai n8n` → nowlabs.es) NO sirve** para
  gestionar la instancia: es un **MCP Server Trigger** (expone las tools de UN
  workflow), no la API de administración. Para crear/listar/editar workflows hace
  falta la **REST API** (que es justo lo que usa `n8n-mcp`).
- **REST API de tu instancia EasyPanel está VIVA y habilitada:**
  `GET https://primer-proyecto-prueba-n8n.hvdnby.easypanel.host/api/v1/workflows`
  responde (no es timeout) → el host está arriba y `/api/v1` existe.
- **Bloqueante actual:** la `N8N_API_KEY` que había en el entorno (JWT de 289
  caracteres, sin espacios) da **401 en ambas instancias** (EasyPanel y nowlabs.es)
  con `X-N8N-API-KEY` y con `Authorization: Bearer`. → **clave expirada/revocada**
  (o de una instancia que ya no existe). Hay que generar una nueva.

## 2. Opción elegida
**Opción B — `n8n-mcp` (community MCP server)**, ya presente en `.mcp.json`. Da a
Claude Code: documentación/validación de nodos n8n **+** gestión de workflows
(list/get/create/update/activate) vía la REST API. Es el camino correcto y ya está
montado; solo falta una API key válida + reinicio.
- Opción A (MCP Server Trigger) → descartada (no gestiona la instancia).
- Opción C (curl directo a `/api/v1`) → válida como respaldo manual; de hecho la usé
  para diagnosticar. `n8n-mcp` es mejor para trabajo continuo.
- Opción D (JSON importable) → solo backup (ya generado en N1/N1.1).

## 3. Qué configuré yo
- `N8N_API_URL` (NO es secreto) puesto vía `setx` →
  `https://primer-proyecto-prueba-n8n.hvdnby.easypanel.host` (persistente para
  nuevos procesos).
- **No toqué `.mcp.json`** (ya estaba correcto con indirección de env).
- **No** puse ninguna API key (no la tengo y no debes pegármela en el chat).

## 4. Pasos EXACTOS para ti (en tu máquina)
1. Abre tu n8n de EasyPanel:
   `https://primer-proyecto-prueba-n8n.hvdnby.easypanel.host`
2. **Settings → n8n API → Create an API key.** Cópiala. (Debe ser de ESTA instancia,
   la misma a la que apunta `N8N_API_URL`.)
3. En una terminal (NO la pegues en el chat), guárdala como variable de usuario:
   ```
   setx N8N_API_KEY "PEGA_AQUI_TU_API_KEY"
   ```
   (Y si quieres reconfirmar la URL: `setx N8N_API_URL "https://primer-proyecto-prueba-n8n.hvdnby.easypanel.host"`)
4. **Cierra del todo y reabre VS Code / Claude Code.** Esto es imprescindible: el
   `${VAR}` de `.mcp.json` y el servidor `n8n-mcp` solo cargan en un proceso NUEVO.
5. Avísame y verifico la conexión (listar workflows) y hago las pruebas seguras.

> Seguridad: la API key queda en tu entorno de usuario de Windows (registro), no en
> el repo ni en el chat. Si prefieres no usar `setx`, puedes ponerla en una variable
> de sesión, pero entonces no persiste entre reinicios de Claude Code.

## 5. Pruebas realizadas (N0.2)
- **PRUEBA 0 (seguridad):** `.mcp.json`/`.env.local` gitignored y no trackeados. ✅
- **PRUEBA conexión REST (en vivo):** EasyPanel y nowlabs.es responden a
  `/api/v1/workflows` → **401** con la key actual (expirada). Host y API OK; falta
  key válida.
- **PRUEBA 1 (list) / 2 (create) / 3 (update) / 4 (read):** **PENDIENTES** — requieren
  key válida + reinicio para que carguen las tools de `n8n-mcp`. No se ejecutó nada
  sobre tus workflows existentes (ARIZAN, HOLA MUNDO, My workflow): **intactos**.

## 6. Capacidades que tendrá Claude Code (tras key + reinicio)
Con `n8n-mcp` + key válida: listar workflows, leer detalle, **crear** workflow
(desactivado), **actualizar** workflow, activar/desactivar, validar nodos, y conocer
la documentación de nodos n8n. **No** borraré nada sin tu aprobación; **no** tocaré
tus workflows antiguos.

## 7. Limitaciones / riesgos
- Una API key de n8n da **control de gestión** de la instancia: trátala como secreto;
  considera una key dedicada y rótala si hace falta.
- El reinicio de Claude Code es obligatorio para cargar el MCP.
- Si tras la key sigue 401: revisa que la key sea de ESA instancia y esté activa
  (Settings → n8n API).

## 8. Siguiente fase
Una vez conectado: **crear el CRM Agent V2 directamente en n8n** vía `n8n-mcp`
(list → create workflow inactivo → update), usando el diseño ya documentado
(`N8N_AGENT_V2_WORKFLOW_SPEC.md`) y el endpoint read-only `/api/agent/tool`. El JSON
importable de N1/N1.1 queda como backup.

## Veredicto N0.2
**N0.2 PARCIAL — FALTA API KEY VÁLIDA + REINICIO.** El método correcto (`n8n-mcp`)
ya está configurado de forma segura, la REST API de tu instancia está viva, y
`N8N_API_URL` ya apunta a EasyPanel. Solo falta que crees una API key nueva, la
guardes con `setx`, y reinicies Claude Code.
