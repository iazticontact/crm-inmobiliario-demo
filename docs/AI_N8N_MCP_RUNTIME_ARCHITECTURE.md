# AI · n8n · MCP · Runtime Architecture — CRM Inmobiliario

> **Fecha:** 2026-06-15 · **HEAD:** `07b7b8a` · **Tipo:** arquitectura definitiva
> (no implementa integraciones grandes). Política transversal:
> [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md).
> Relacionado: [AI_ASSISTANT_LONG_TERM_ARCHITECTURE.md](AI_ASSISTANT_LONG_TERM_ARCHITECTURE.md),
> [N8N_AUTOMATION_STRATEGY.md](N8N_AUTOMATION_STRATEGY.md),
> [STAGING_HOSTINGER_STRATEGY.md](STAGING_HOSTINGER_STRATEGY.md),
> [PRODUCT_ARCHITECTURE_AUDIT.md](PRODUCT_ARCHITECTURE_AUDIT.md).

Este documento responde, de forma definitiva y accionable, **dónde vive el cerebro
del asistente** y cómo encajan **OpenAI, Supabase, Storage/RAG, n8n y MCP**, para
no acabar con un chatbot if/else ni con "n8n como cerebro".

---

## 0. Respuesta corta (TL;DR)

| Pregunta | Respuesta |
|---|---|
| ¿Dónde vive el cerebro? | En el **backend del CRM (Next.js)**: `/api/assistant/v2` → agente OpenAI + **tools internas** → Supabase (RLS) → `PreparedAction` → `/api/assistant/confirm`. |
| ¿Es n8n el cerebro? | **NO.** n8n es el **brazo de automatización externo** (downstream), llamado server-side. No decide lógica de negocio ni permisos. |
| ¿Qué es MCP? | **Herramienta de desarrollo/control** para Claude/Codex (ver Supabase/GitHub/n8n al construir). **No es runtime del producto.** |
| ¿OpenAI? | **Razonamiento y lenguaje.** No es la fuente de verdad ni el ejecutor. |
| ¿Supabase? | **Fuente de verdad** (datos + RLS + Auth + Storage futuro). |
| ¿Qué funciona en local? | Todo el CRM + asistente (con `OPENAI_API_KEY`). n8n/WhatsApp solo de forma simulada (dormidos). |
| ¿Qué necesita VPS? | n8n real, WhatsApp Meta, dominios/SSL, rendimiento. |

**Estado actual del código (verificado):** el cerebro ya es un agente OpenAI real
(`nowlabs-main-agent.ts`, 28 tools), el executor (`/api/assistant/confirm`) está
hardened con RLS, y el **puente CRM→n8n ya existe y está protegido**
(`assistant-n8n-hook.ts` + `/api/n8n/trigger`), **dormido** hasta configurar
`N8N_BASE_URL` en el servidor.

---

## 1. Las cuatro capas (no confundirlas nunca)

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. RUNTIME DEL CRM (cerebro)  — Next.js en VPS                      │
│    /api/assistant/v2 · /api/assistant/confirm · /api/agent/tool     │
│    nowlabs-main-agent.ts (OpenAI) · tools internas · RLS            │
│    → DECIDE, PREPARA, EJECUTA-CON-CONFIRMACIÓN. Es el cerebro.      │
├──────────────────────────────────────────────────────────────────┤
│ 2. SUPABASE (verdad)  — cloud ylhdbawrllqygfvllhdo                  │
│    Postgres + RLS + Auth + (futuro) Storage/embeddings             │
│    → FUENTE DE DATOS. Última línea de seguridad (RLS).             │
├──────────────────────────────────────────────────────────────────┤
│ 3. n8n (brazo externo)  — self-host en VPS, dormido hoy            │
│    webhooks · WhatsApp Meta · email · PDF · recordatorios · cron   │
│    → EJECUTA AUTOMATIZACIÓN EXTERNA. No decide negocio. Downstream.│
├──────────────────────────────────────────────────────────────────┤
│ 4. MCP (desarrollo/control)  — solo en la máquina de dev          │
│    Claude/Codex ↔ Supabase/GitHub/n8n al CONSTRUIR                  │
│    → HERRAMIENTA DE DESARROLLO. NUNCA en el runtime del producto.  │
└──────────────────────────────────────────────────────────────────┘
```

OpenAI atraviesa la capa 1 como **motor de razonamiento** (no es una capa de
infraestructura propia; es una API que el runtime consume).

---

## 2. Cerebro del asistente — runtime del CRM (capa 1)

**Vive en el backend del CRM (Next.js), no en n8n, no en OpenAI, no en el front.**

Flujo actual (verificado en código):
```
Usuario CRM
 → Assistant UI (/assistant)
 → POST /api/assistant/v2           (auth cookie + RLS; resuelve workspace)
 → nowlabs-main-agent.ts            (OpenAI Responses API + 28 tools)
     ├─ READ tools  → /api/agent/tool (gate AGENT_TOOL_SECRET, service_role server,
     │                 todas .eq(workspace_id))  → Supabase
     └─ si no produce acción → fallback determinista (deterministic-fallback.ts /
                                deterministic-db-actions.ts) que resuelve IDs reales
                                con RLS, nunca inventa
 → PreparedAction (NO escribe)
 → ConfirmCard en la UI (Confirmar / Cancelar)
 → POST /api/assistant/confirm      (auth cookie; preparedAction = hints NO
                                      confiables, re-validados; allowlist de tipo;
                                      UUID-en-workspace; parsers estrictos)
 → Supabase write (cliente cookie-bound → RLS última línea)
 → activity log (best-effort, no rompe la acción)
 → (opcional) fireAssistantN8nHook(...)  → n8n  [downstream, fail-soft]
```

**Por qué NO es if/else:** el razonamiento lo hace un agente OpenAI con tools; el
fallback determinista es **red de seguridad**, no el cerebro, y **resuelve datos
reales con RLS** (no respuestas hardcodeadas). La lógica de negocio vive en las
tools/executor del CRM, versionadas y testeables — no en un workflow de n8n ni en
un árbol de condicionales.

**Reglas de oro del runtime:**
- PREPARE nunca escribe; CONFIRM solo tras confirmación del usuario.
- Todo `.eq(workspace_id)` + RLS. `service_role` solo server-side.
- Si no hay datos reales → "No encuentro datos reales en este workspace" (nunca inventa).
- Demo no persiste.

---

## 3. Supabase — fuente de verdad (capa 2)

- Datos estructurados por workspace con **RLS**: `clients, properties,
  opportunities, service_cases, tasks, calendar_events, activities, profiles,
  workspaces, workspace_members` (hoy 10 tablas). Futuro: `invoices`,
  `documents`, `conversations`/`messages`, embeddings.
- Auth (sesión cookie) es la **única** señal de identidad; el workspace se
  resuelve server-side desde `profiles`.
- Storage (futuro) vivirá aquí: buckets privados + RLS + signed URLs.
- **n8n nunca sustituye a RLS.** Aunque n8n escriba (vía service role en su
  propio backend o llamando a la API del CRM), el modelo de permisos correcto es
  **a través del CRM/Supabase**, no decidido por el workflow.

---

## 4. n8n — brazo de automatización externa (capa 3)

**Resumen aquí; estrategia completa en [N8N_AUTOMATION_STRATEGY.md](N8N_AUTOMATION_STRATEGY.md).**

- **Sí:** webhooks, WhatsApp Meta API, email, PDF, recordatorios, sync externas,
  notificaciones, cron, procesos largos, integración con terceros.
- **No:** ser el cerebro, sustituir RLS, decidir permisos, guardar sin validar
  workspace, inventar datos, ejecutar acciones peligrosas sin confirmación,
  almacenar secretos en workflows inseguros, mezclar workspaces.
- **El CRM llama a n8n server-side**, nunca desde el frontend. Ya implementado:
  - `assistant-n8n-hook.ts`: fire-and-forget **después** de un write confirmado;
    fail-soft (nunca lanza, nunca hace rollback), SSRF-guard, body whitelisteado.
  - `/api/n8n/trigger`: requiere sesión, **URL destino jamás del body**, slug
    allowlist server-side, re-validación de host, respuestas sanitizadas.
- **Dirección inversa (n8n→CRM):** n8n entra al CRM por **webhooks autenticados**
  (p. ej. WhatsApp entrante) que validan secreto + workspace antes de escribir.

---

## 5. MCP — herramienta de desarrollo/control (capa 4)

- MCP conecta **Claude/Codex** a herramientas **al desarrollar**: Supabase MCP
  (inspeccionar tablas/RLS/advisors, SQL de solo lectura), GitHub, e incluso n8n
  para ayudar a crear/auditar workflows.
- **No forma parte del runtime del producto.** Un cliente final nunca usa MCP; el
  CRM en VPS no depende de MCP para funcionar.
- Reglas: `.mcp.json` **gitignored** (verificado, no trackeado); **no imprimir
  secretos**; **no tocar legacy** (`ktsgfukjgldeylfzrayr`, NowLabs/CostaDelSol);
  cambios de schema solo por el flujo de migraciones, nunca "en caliente".

---

## 6. Storage / RAG documental (futuro)

```
Usuario pregunta ("resume el expediente de X", "busca el contrato de reserva")
 → Assistant UI → /api/assistant/v2 → agente
 → tools estructuradas (Supabase) +
 → documents (metadata, por entity: client_id/opportunity_id/service_case_id/invoice_id)
 → Storage signed access (bucket privado, por workspace)
 → text chunks + embeddings → vector search (por workspace)
 → respuesta CON FUENTES citadas (sin leakage cross-workspace)
 → acción confirmada si procede
```
- **El permission model vive en CRM/Supabase** (RLS + signed URLs + audit), no en
  n8n. n8n solo ayuda en lo **asíncrono**: extracción/OCR, resumen, notificación,
  envío de documentos.
- No implementar ahora. Detalle de fases en
  [AI_ASSISTANT_LONG_TERM_ARCHITECTURE.md](AI_ASSISTANT_LONG_TERM_ARCHITECTURE.md) §6-§7.

---

## 7. WhatsApp Meta API (futuro, oficial)

```
Cliente escribe WhatsApp
 → Meta WhatsApp Business (Cloud) API
 → n8n webhook (recibe, normaliza, firma)
 → POST webhook CRM (secreto + workspace validados server-side)
 → (si se decide) guarda conversación/mensaje (tablas conversations/messages)
 → agente CRM responde o PREPARA respuesta (reglas + plantillas Meta)
 → n8n envía WhatsApp (plantilla aprobada / ventana 24h)
 → activity en CRM
```
- **Solo Meta oficial.** Nada de proveedores unofficial, nada de fake.
- Fases (resumen; detalle en [PRODUCT_DECISION_WHATSAPP_META.md](PRODUCT_DECISION_WHATSAPP_META.md)):
  1) actividad/resumen de contacto sin inbox · 2) logging de mensajes clave ·
  3) inbox espejo (tablas reales) · 4) asistente responde con confirmaciones/reglas.
- El nav "WhatsApp" está **oculto** del cliente hasta Fase 3 (ya aplicado, `07b7b8a`).

---

## 8. Facturación con IA + n8n (futuro)

- Módulo propio (tabla `invoices` + estados borrador/emitida/enviada/pagada/
  vencida/anulada + vínculos cliente/operación/expediente + activity).
- **IA prepara la factura; el usuario confirma** (mismo patrón PREPARE→CONFIRM).
- **n8n** envía email/PDF tras la confirmación (downstream).
- **Fiscalidad/legal (Veri\*factu/AEAT) antes de producción real** — decisión
  legal previa, no de implementación. Detalle:
  [PRODUCT_DECISION_BILLING_INVOICING.md](PRODUCT_DECISION_BILLING_INVOICING.md).

---

## 9. Calendario

- **Interno = core** (ya funciona: `calendar_events` + RLS). Visitas, llamadas,
  reuniones, vencimientos. El asistente ya lee eventos y puede reprogramar.
- **Google Calendar = addon opcional** (no bloquea el producto). n8n puede ayudar
  a sincronizar/notificar más adelante. Detalle:
  [PRODUCT_DECISION_CALENDAR.md](PRODUCT_DECISION_CALENDAR.md).

---

## 10. Deployment — qué corre dónde

| Componente | Local (dev) | VPS (staging/prod) |
|---|---|---|
| CRM Next.js + asistente | ✅ (lento en OneDrive) | ✅ (PM2 + Nginx + SSL) |
| OpenAI | ✅ (env) | ✅ (env server) |
| Supabase cloud | ✅ | ✅ (mismo o proyecto prod dedicado) |
| n8n | ⚠️ simulado/dormido (`N8N_BASE_URL` vacío) | ✅ self-host (subdominio `n8n.`, auth, backups) |
| WhatsApp Meta | ❌ | ✅ (vía n8n + Meta) |
| MCP | ✅ (solo dev) | ❌ (no en runtime) |

Detalle de servidores, subdominios, SSL y backups en
[STAGING_HOSTINGER_STRATEGY.md](STAGING_HOSTINGER_STRATEGY.md).

---

## 11. Seguridad (no negociable)

- `service_role` y `AGENT_TOOL_SECRET` **solo server-side**; jamás en frontend.
- CRM→n8n **solo server-side**, SSRF-guard + slug allowlist + secreto a URL
  validada (ya implementado).
- n8n→CRM por webhooks **autenticados** (secreto + workspace) antes de escribir.
- RLS en todas las lecturas/escrituras; demo no persiste; sin mocks en real.
- Secretos en `.env` del server, nunca en Git ni en workflows; sin legacy.

---

## 12. Qué implementar AHORA vs. esperar

- **AHORA:** nada de integraciones grandes. Cerrar smoke navegador + staging.
  (El runtime del asistente y el puente n8n ya existen y están hardened.)
- **ESPERAR (con diseño ya hecho):** n8n real, workflows, WhatsApp Meta, Storage,
  RAG, facturación, Google Calendar. Orden en el roadmap técnico:
  [PHASE_2E2_NEXT_PHASES_ROADMAP.md](PHASE_2E2_NEXT_PHASES_ROADMAP.md).

---

## 13. Veredicto
**AI/N8N/MCP ARCHITECTURE READY.** El cerebro está en el sitio correcto (runtime
CRM), n8n y MCP tienen papeles claros y separados, y los puentes de seguridad ya
existen. Siguiente: smoke navegador + staging; después, activar n8n en VPS y
construir workflows por fases.
