# FASE S9.1 — Assistant Pro: cobertura CRM total (DNI era solo un ejemplo)

> **Fecha:** 2026-06-17 · **Base:** `9dfc03d` (S9) → este commit ·
> **Alcance:** confirmar/completar que el asistente lee TODO el CRM real (no solo
> DNI), con tools potentes por dominio, memoria contextual y tono de empleado.
> Sin tocar executor/confirm, n8n, schema, RLS ni `service_role` frontend.

---

## 1. Aclaración
El bug del DNI fue un EJEMPLO. El objetivo es lectura total: columnas, metadata/
campos personalizados, contacto, fiscal, notas, relaciones (operaciones,
expedientes, tareas, calendario, actividad, propiedades) y documentos (metadata).

## 2. Diagnóstico de gaps tras S8/S9
Auditado: la mayor parte de la cobertura YA estaba tras S8 (el modelo recibe
`result.data`) y S9 (clientes con metadata + field-exact + perfil + cliente
activo). Gap real restante: **documentos** ("¿qué documentos tiene X?") no tenía
tool. Operaciones/expedientes/propiedades **ya** llegan completas al modelo
(readers con `select('*')` + dispatch que devuelve `data: rows` + compactToolData).

## 3. Matriz de cobertura por tabla (estado tras S9.1)
| Tabla | Campos clave (incl. metadata) | Llega al modelo | Tool(s) |
|---|---|---|---|
| clients | name, company, email, phone, status, notes, **metadata: document_id(DNI/NIF), address, city_area(zona), nationality, client_type, preferred_language**, created/updated | **Sí** (selects incluyen metadata; compactToolData) | search_clients, get_client_context, get_client_field_exact, get_latest_client, list_clients, hot_leads |
| opportunities | title, stage, value, probability, expected_close_date, source, notes, vertical, metadata | **Sí** (`select('*')` + data) | list_opportunities, get_client_context (por cliente) |
| service_cases | title, case_type, status, priority, due_date, notes, metadata | **Sí** | list_service_cases, get_client_context |
| tasks | title, status, priority, due_date, notes, metadata | **Sí** | pending_tasks, get_client_context |
| calendar_events | title, type, date, start_at, location, status, notes, metadata | **Sí** | upcoming_events, get_client_context |
| activities | type, title, description, created_at | **Sí** | recent_activity, get_client_context |
| properties | `select('*')` (title/address/type/status/price…) | **Sí** | list_properties |
| documents | title, type, mime_type, size, created_at (METADATA, sin contenido) | **Sí (metadata)** | **list_client_documents (S9.1)** |
| workspace_settings | vertical, business_name, tone… | parcial (settings UI) | — (no expuesto al chat; futuro) |

**Campos NUNCA al usuario:** workspace_id, UUIDs, lead_score/score, raw JSON técnico.

## 4. Tools — añadidas / estado
- **S9.1 nueva:** `list_client_documents` (metadata-only, honesta: no lee contenido).
- **S9:** get_client_field_exact (campo exacto por alias), get_latest_client (cliente activo).
- **S8:** compactToolData (data al modelo), get_client_context (perfil 360).
- **Existentes (cubren dominios):** search_clients, list_clients, hot_leads,
  select_client_by_ordinal, latest/oldest_clients, list_opportunities,
  list_service_cases, list_properties, pending_tasks, upcoming_events,
  recent_activity, recent_conversations, list_pending_items, workspace_overview,
  crm_overview, recommended_actions, automation_recommendations + prepare_* (acciones).

> Decisión de diseño (alineada con el prompt): **cobertura amplia con tools
> potentes**, no 40 tools duplicadas. `get_client_context` agrega TODO lo de un
> cliente (operaciones/expedientes/tareas/citas/actividad) en una sola llamada;
> las list_* devuelven filas completas para detalle. Tools de detalle por entidad
> (get_opportunity_detail, etc.) quedan como roadmap — hoy no aportan cobertura
> nueva porque la data completa ya llega por las list_* + get_client_context.

## 5. Exact field retrieval universal
`get_client_field_exact` resuelve por alias (accent-insensitive): identidad/fiscal
(dni/nif/cif/documento/tax_id/fiscal_id/vat_id/document_number/id_number/nie),
contacto (email/correo/mail, teléfono/movil/whatsapp), empresa, dirección, zona/
área/ciudad, presupuesto, nacionalidad, idioma, tipo. Orden: columna → metadata.
Valor exacto o "No consta"; varios clientes → pide cuál; nunca inventa.

## 6. Memoria contextual (active entity)
Cliente activo por hilo: la página captura `referencedClientId` cuando una tool
resuelve un cliente único (search_clients/get_latest_client/get_client_field_exact/
get_client_context) y lo reenvía en cada turno; el agente inyecta "CLIENTE ACTIVO"
→ "su DNI", "este cliente", "él/ella" usan ese cliente. **Pendiente futuro:**
active entity para operación/expediente/tarea/cita (hoy "mueve esta operación"
se resuelve por nombre vía deterministic-db-actions; el pronombre puro requiere
trackear activeOpportunity — documentado, no implementado para no tocar página+v2).

## 7. Personalidad de empleado IA
Reforzado: empleado, no plantilla — varía respuestas y cierres; directo si piden
un dato, completo si piden ficha; no termina siempre con "¿algo más?"; nunca
"estoy operativo" ni "no tengo acceso"; usa el lead score solo internamente
(jamás lo muestra). Mantiene el tono cercano de España de H14.

## 8. Documentos / Storage / facturas (estado real)
Módulo documentos REAL: bucket `client-files` + tabla `documents` (metadata).
**Clasificación: (A/B) puede listar archivos y su metadata; (C/D) NO** — sin
extracción ni RAG. `list_client_documents` lista títulos/tipos y dice que no lee
el contenido. Facturación real = módulo dormido (no se finge). Plan RAG completo
en `ASSISTANT_DOCUMENTS_STORAGE_RAG_PLAN.md`.

## 9. Qué puede leer ahora / qué no
- **Sí:** todos los campos de cliente (incl. DNI y personalizados de metadata),
  operaciones, expedientes, tareas, citas, actividad, propiedades, y el LISTADO de
  documentos adjuntos.
- **No todavía:** el CONTENIDO de los documentos/PDF (sin índice) y facturación real.

## 10. Seguridad multi-tenant
Todo `.eq('workspace_id')` (+ `client_id`) bajo RLS con la sesión; metadata solo
del cliente resuelto; límites por query; sin query global; data capada
(compactToolData); sin `service_role` frontend; UUID/score/workspace_id nunca al
usuario; active entity por hilo/usuario.

## 11. Qué NO se tocó
Executor/confirm · acciones confirmadas · n8n · WhatsApp/Meta · Google ·
Storage (solo lectura de metadata de documents) · facturación · schema/migraciones
· RLS · deps · `git reset`.

## 12. Evals
`ASSISTANT_CRM_INTELLIGENCE_EVALS.md`: +bloque S9.1 (documentos honestos, cobertura
por dominio, personalidad/no plantilla, aliases de campos). Total > 90 casos
acumulados S8+S9+S9.1.

## 13. Tests manuales
No se ejecutó el agente OpenAI desde aquí. Tools deterministas validadas contra el
schema real (documents columns confirmadas en código; clients.metadata verificado
en S9). Smoke navegador pendiente (Oier).

## 14. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅
(`✓ Compiled successfully`, 46 rutas).

## 15. Próximo paso / roadmap
- Smoke navegador (cliente real): DNI, ficha completa, documentos, operaciones, etc.
- Futuro: active entity para operación/expediente; tools de detalle por entidad si
  se piden; extracción + embeddings + RAG de documentos (plan documentado).

## Veredicto
**S9.1 PARCIAL SEGURO — cobertura CRM amplia y honesta.** El asistente lee todos
los campos de cliente (incl. metadata/DNI), las relaciones completas y el listado
de documentos; operaciones/expedientes/propiedades ya llegaban completas al modelo
(S8). Tono de empleado reforzado. Lo único que NO lee es el contenido de archivos
(sin RAG) — declarado con honestidad. Falta smoke navegador (Oier) para firmar.
