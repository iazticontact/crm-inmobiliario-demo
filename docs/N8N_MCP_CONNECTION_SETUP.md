# N8N ↔ Claude Code — conexión MCP/API (FASE N0)

> **Fecha:** 2026-06-17 · **Objetivo:** dejar Claude Code conectado a n8n de forma
> segura para inspeccionar/crear/actualizar workflows, ANTES de construir el CRM
> Agent V2. Sin secretos en el repo. No se crean workflows productivos activos.

---

## 1. Estado verificado (local)
- `.mcp.json` **existe**, está **gitignored** (`.gitignore:43 .mcp.json`) y **no
  está trackeado** → las credenciales MCP no entran al repo. ✅
- `.env*` ignorado (`.gitignore:34`), `!.env.example` permitido. ✅
- **Ya hay un servidor MCP de n8n configurado** apuntando a tu instancia:
  `https://n8n.nowlabs.es/mcp-server/http` (conector "claude.ai n8n"). Requiere
  autorización OAuth: **tú** lo activas con `/mcp` → "claude.ai n8n".

## 2. Matiz técnico CLAVE (dos cosas distintas en n8n)
- **MCP Server Trigger** (`/mcp-server/...`, lo ya configurado): un workflow de n8n
  **expone TOOLS** vía MCP para que un cliente MCP (Claude) las llame. **NO** sirve
  para listar/crear/actualizar workflows; solo da acceso a las tools que ESE
  workflow define.
- **n8n REST API** (`/api/v1/...`): **sí** lista/crea/actualiza/activa workflows y
  lee executions. Necesita una API key (n8n → Settings → **n8n API** → Create).

→ El endpoint actual sirve para *consumir tools*, no para *gestionar workflows*.

## 3. Opciones de conexión (análisis)
| Opción | Qué permite | Necesita | Seguridad | Recomendación |
|---|---|---|---|---|
| **A — n8n REST API directa** (curl/script con env local) | listar/crear/actualizar/activar/executions | `N8N_BASE_URL` + `N8N_API_KEY` en `.env` local (gitignored) | Hay que darme una API key (poder amplio) | Útil si quieres automatizar; key local, nunca en repo |
| **B — MCP server community** (`czlonkowski/n8n-mcp` o `leonardsellem/n8n-mcp-server`) en `.mcp.json` | gestión de workflows vía REST API envuelta en MCP | mismo `N8N_BASE_URL`+`API_KEY` + instalar el server | Igual que A, vía MCP | Buena si prefieres MCP a curl |
| **C — JSON importable** (genero el workflow, tú lo importas) | construir el agente sin compartir NINGÚN secreto conmigo | nada | **La más segura** | **RECOMENDADA para construir el CRM Agent V2** |
| **D — claude.ai n8n connector** (ya configurado, `/mcp-server/http`) | usar las TOOLS que exponga ese workflow | `/mcp` auth | OAuth, acotado | Útil para INSPECCIÓN/uso de tools; no para CRUD de workflows |

## 4. Recomendación
1. **Para construir el CRM Agent V2 → Opción C (JSON importable).** Yo genero el
   workflow completo (AI Agent + memory + tools + Supabase) con **placeholders de
   credenciales**; tú lo importas en n8n y conectas las credenciales ahí. Nunca
   me das tus claves de n8n/Supabase/OpenAI. Es lo más seguro y funciona siempre.
2. **Para inspección/listado** (opcional): autoriza el conector ya configurado con
   `/mcp` → "claude.ai n8n". Cuando lo hagas, veré qué tools expone ese endpoint.
3. **Solo si quieres que automatice create/update por API** (opcional): habilita
   la **n8n REST API**, crea una API key y ponla en un `.env` local (gitignored);
   te indico el formato. No la pegues en el chat.

## 5. Variables necesarias (SIN valores — dónde van)
- `N8N_BASE_URL` — p. ej. `https://n8n.nowlabs.es` → `.env` local (no repo).
- `N8N_API_KEY` — n8n → Settings → n8n API → Create API key → `.env` local.
- `N8N_ASSISTANT_WEBHOOK_URL` / `N8N_ASSISTANT_WEBHOOK_SECRET` — si luego el CRM
  llama a un webhook del agente; en EasyPanel env del CRM (server), no frontend.
- `SUPABASE_URL` — pública, ya en uso.
- `SUPABASE_SERVICE_ROLE_KEY` — **solo dentro de n8n** (credencial Supabase del
  nodo), NUNCA en el frontend del CRM ni en el repo.
- `OPENAI_API_KEY` — como **credencial** del nodo en n8n, nunca hardcodeada.
> Regla: secretos en `.env` local (gitignored) o en credenciales de n8n. Nunca en
> el chat, nunca en el repo, nunca en `.mcp.json` commiteado.

## 6. Pruebas realizadas (N0)
- **Prueba 0 (seguridad):** `.mcp.json` ignorado/no trackeado, `.env*` ignorado. ✅
- **Prueba 1 (listar workflows):** **pendiente de tu auth** (`/mcp`) o de la API
  REST. No se ha tocado ni ejecutado ningún workflow existente.
- **Prueba 2 (workflow de prueba):** generado como JSON importable seguro →
  `n8n/workflows/mcp-test-safe-disabled.json` (Manual Trigger + Set "MCP
  conectado", **inactivo**, sin credenciales/Supabase/OpenAI). Importar en n8n →
  Workflows → Import from File para verificar; borrar tras la prueba.
- **Prueba 3 (import/export):** Opción C confirma import manual; export/CRUD por
  API requiere Opción A/B (pendiente de habilitar API key).

## 7. Qué puede hacer Claude ahora con n8n
- Generar workflows n8n como **JSON importable** (seguro, sin tus secretos).
- Tras tu `/mcp` auth: usar las **tools** que exponga el endpoint MCP de n8n.
- Tras habilitar API key (opcional): listar/crear/actualizar/activar por REST API.

## 8. Qué NO puede hacer todavía
- Listar/crear/editar tus workflows automáticamente (no hay API key local ni MCP
  de gestión autorizado).
- Ver/usar tus credenciales (ni debe).
- Ejecutar workflows con datos reales.

## 9. Riesgos
- Dar una `N8N_API_KEY` concede control amplio de tu n8n: úsala solo en `.env`
  local, considera una key dedicada/rotable.
- El conector MCP existente es de *tools*, no de gestión: no confundir con CRUD.
- Importar JSON: revisa el workflow antes de activar; mantenlo inactivo hasta validar.

## 10. Próximo paso (crear CRM Agent V2)
Cuando digas "adelante", genero `n8n/workflows/crm-agent-v2.json` (Opción C):
Webhook in → AI Agent (modelo + system prompt CRM) → memory (Postgres/Supabase) →
tools (Supabase: clientes/operaciones/…; HTTP al CRM) → Webhook response, con
**placeholders** de credenciales. Tú lo importas, conectas credenciales en n8n y
lo activas. (Si prefieres que lo cree por API, habilita primero la API key.)

## Veredicto N0
**N0 PARCIAL — JSON IMPORTABLE COMO CAMINO SEGURO LISTO; conexión MCP/API
pendiente de tu acción.** Seguridad verificada (`.mcp.json`/`.env` fuera del
repo), conector n8n ya configurado (pendiente `/mcp` auth), workflow de prueba
importable generado. Para CRUD automático falta habilitar la n8n REST API + key
local. Recomendación para construir el agente: **Opción C (JSON importable)**.
