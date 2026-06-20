# FASE N4 — Agent V2: memoria pro + cobertura CRM total + personalidad premium

> **Fecha:** 2026-06-21 · HEAD previo `06e0860` · Workflow n8n `6mps8YoWu3syldUc`
> (ACTIVO, `gpt-4.1-mini`@0.2). Toca runtime CRM (`src/`) + **migración** → requiere
> **redeploy del CRM**. Sin tocar `.env.local`/`.mcp.json`/secretos, workflows antiguos,
> Google/WhatsApp, escrituras de negocio, ni SQL libre. Memoria escrita por el SERVIDOR,
> nunca por el LLM.

---

## 1. Estado inicial
Agent V2 ya era el cerebro de `/assistant` (N3) y funcionaba (N3.1: `search_clients`
arreglado por prompt-recovery). Quedaban: memoria de trabajo persistente, exponer al
agente la cobertura completa del CRM, refinar personalidad/routing y una suite de evals.

## 2. Diseño de memoria (3 capas)
- **Corta:** Window Memory de n8n (`sessionKey = workspaceId:userId:threadId`). Sin cambios.
- **De trabajo (NUEVA):** tabla `public.assistant_agent_memory` — entidad activa y previa
  del hilo, **escrita por el servidor** (`/api/assistant/v2`, autenticado, RLS), nunca por
  el LLM. Guarda SOLO una **referencia** (`entity_type`+`entity_id`+`label`), **nunca DNI/
  email/teléfono**. Helper `src/lib/agents/assistant-agent-memory.ts`
  (`loadThreadMemory`/`saveActiveEntity`, fail-soft). El route fija `activeEntity` (UI
  enfocada → si no, la guardada) y expone `activeEntity.previous` para "el anterior".
- **Larga controlada (DISEÑADA):** `memory_type ∈ {preference, rule, summary}` ya existe en
  la tabla; pendiente sembrar reglas de workspace ("Operaciones=opportunities", tono…) e
  inyectarlas por payload. No se implementa el wiring en esta fase (el prompt ya las cubre).

### Tabla `assistant_agent_memory` (migración `20260621_n4`)
RLS por **workspace + usuario** (`current_workspace_ids()` + `auth.uid()`), índices,
unique parcial `(thread_id,user_id) where active_entity`, trigger `set_updated_at`,
GRANT a `authenticated` + `service_role`, `anon` sin DML. Aplicada por MCP; verificado:
4 policies, RLS on, 4 grants authenticated, service_role SELECT, anon 0.

## 3. Auditoría de cobertura CRM (matriz)
| Entidad | Tabla | Lectura por el agente | Estado |
|---|---|---|---|
| Cliente (ficha 360) | clients | `get_client_360` (incluye metadata/DNI/zona + tareas/citas/actividad/docs por cliente) | ✅ |
| Cliente (búsqueda) | clients | `search_clients` (nombre/empresa/email/tel) · fallback `crm_read_query(clients)` | ✅ |
| Cliente (último/nuevo) | clients | `get_latest_client` (fija activo) | ✅ |
| Operaciones (de cliente) | opportunities | `get_client_opportunities(clientId)` | ✅ |
| Operaciones (pipeline) | opportunities | `pipeline_summary` · `get_open_operations` | ✅ |
| Expedientes (de cliente) | service_cases | `get_client_service_cases(clientId)` | ✅ |
| Expedientes (abiertos) | service_cases | `get_open_service_cases` | ✅ |
| Tareas | tasks | `get_pending_tasks` · `crm_read_query(tasks)` | ✅ |
| Calendario | calendar_events | `get_calendar_summary` · `crm_read_query(calendar_events)` | ✅ |
| Actividad | activities | `get_recent_activity` · `crm_read_query(activities)` | ✅ |
| Propiedades | properties | `search_properties` · `crm_read_query(properties)` | ✅ |
| Documentos (metadata) | documents | `get_documents_metadata` (sin contenido/RAG) | ✅ |
| **Cualquier entidad por texto/filtro** | 8 tablas | **`crm_read_query`** (entity + **searchText** + clientRef + filters + dateRange) | ✅ (mejorado N4) |
| Overview | varias | `get_crm_overview` (KPIs) | ✅ |

**Conclusión:** el servidor ya cubría las 8 entidades; el único gap era que la tool n8n
`crm_read_query` solo enviaba `entity`. **Cerrado en N4.**

## 4. Gaps cerrados / tools mejoradas
- **`crm_read_query` (n8n toolCode):** ahora envía `searchText`, `clientRef` y `filters`
  (status/stage/type/priority/city/…). El reader server ya lo soportaba (ilike seguro,
  workspace-scoped, sin SQL libre). ⇒ **búsqueda por texto y filtros en las 8 entidades.**
- **`/api/agent/tool` — anti-fuga `lead_score`:** sanitizador `stripInternalFields` que
  **elimina recursivamente `lead_score`** del resultado antes de salir del endpoint
  (defensa en profundidad: el agente no puede mostrarlo ni aunque se lo pidan). El cálculo
  interno de `hot_leads` usa su propia query, no se ve afectado.
- **Memoria de entidad activa/previa** (sección 2).

## 5. Diseñado (no implementado, próxima fase)
Readers/tools 360 por entidad (`get_property_360`, `get_operation_360`, …) — hoy
`crm_read_query`+`search_*`+`get_client_360` ya cubren el detalle. Memoria larga de
preferencias por workspace (tabla lista; falta sembrar+inyectar). Captura de entidad
resuelta por el agente (requiere poblar `activeEntityUpdate` en el workflow).

## 6. Prompt final (quirúrgico, NO infinito)
Pasó de 4422 → **~4815 chars** (compacto). Añadido en N4: que `crm_read_query` acepta
`searchText`/`clientRef`; "el anterior" → `activeEntity.previous`; no cerrar con preguntas
de relleno ("¿en qué puedo ayudarte?") ni "estoy operativo"; **lead score interno: nunca
mostrarlo aunque lo pidan**. Ya tenía: recuperación ante fallo de tool, ruteo de cliente,
JUICIO CONVERSACIONAL, límites de módulo (factura/PDF/escrituras), No consta, sin UUIDs.

## 7. Modelo y coste
**`gpt-4.1-mini`**, temperature **0.2**. Sin model-routing (innecesario ahora). Barato y
fiable para 2 usuarios. Sin GPT-5 ni experimentales.

## 8. Evals
Suite formal `docs/evals/agent-v2-crm-evals.json` — **105 casos / 26 categorías**
(saludos, identidad, ayuda, cliente por nombre, último, follow-up "su", anterior, ficha,
campos exactos, operaciones, expedientes, tareas, calendario, pipeline, propiedades,
documentos, PDF, factura, crítica, pausa, despedida, recuperación, no-invención, no-UUID,
no-score, no-cross-data). Runner `docs/evals/run-agent-evals.mjs`: dry-run sin env, llama
al webhook, **redacta DNI/email/tel**, nunca imprime secretos; checks built-in de fuga de
score/UUID.

## 9. Resultados (en vivo contra el webhook)
Ejecutadas ~50 cases reales: **greeting/identity/help/client_by_name/latest/followup
(30/30)**, previous_client 4/4 (memoria "el anterior" OK), invoice/pdf/criticism/
error_recovery/no_uuids/no_invention/no_cross_data verdes, **no_score corregido**
(el agente rehúsa el valor: "es una métrica interna que no se expone"). 0 errores
genéricos falsos, sin inventar, sin V1. (PII redactada en todos los logs.)

## 10. Seguridad
Sin secretos/PII en el diff (DNI/email/tel redactados; runner no imprime secretos).
Memoria: solo referencias, RLS workspace+usuario, escrita por servidor. `lead_score`
nunca llega al LLM (strip server-side + prompt). `.env.local`/`.mcp.json` intactos. Sin
service_role en frontend, sin SQL libre, sin escrituras de negocio.

## 11. Validaciones
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Migración aplicada+verificada (RLS/
grants). Workflow read-back (active, gpt-4.1-mini, 15 toolCode, searchText). Backup
`n8n/workflows/crm-agent-v2-readonly.json` sincronizado.

## 12. Archivos tocados
- NUEVO `supabase/migrations/20260621_n4_assistant_agent_memory.sql`
- NUEVO `src/lib/agents/assistant-agent-memory.ts`
- `src/app/api/assistant/v2/route.ts` (memoria activeEntity + import)
- `src/app/api/agent/tool/route.ts` (`stripInternalFields` anti lead_score)
- `src/lib/agents/n8n-assistant-client.ts` (activeEntity.previous en el tipo)
- NUEVO `docs/evals/agent-v2-crm-evals.json` (105) + `docs/evals/run-agent-evals.mjs`
- `n8n/workflows/crm-agent-v2-readonly.json` (backup) + docs

## 13. Próximos pasos
1. **Redeploy del CRM** (memoria + strip lead_score + N3.1 search_clients).
2. Probar desde `/assistant`: "Dame datos sobre Oier" → ficha; "su DNI/email"; "vuelve al
   de antes"; "busca operaciones sobre <texto>"; "qué lead score tiene" (debe rehusar).
3. (Futuro) readers 360 por entidad, memoria larga de preferencias, poblar
   `activeEntityUpdate` en el workflow para capturar entidades resueltas por el agente.

## Veredicto
**N4 COMPLETADO — AGENT V2 PRO MEMORY + FULL CRM INTELLIGENCE.** Memoria de trabajo
persistente (entidad activa/previa, sin PII, RLS, server-side) implementada y probada;
cobertura CRM al 100% de lectura (8 entidades vía `crm_read_query` con searchText/filtros +
readers dedicados); personalidad/routing afinados sin inflar el prompt; `lead_score`
blindado (strip server + prompt); suite de 105 evals + runner. `gpt-4.1-mini`@0.2.
tsc/lint/build verdes. **Requiere redeploy del CRM.**
