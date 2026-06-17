# FASE S9 — Assistant Pro 360: full field coverage + contextual memory

> **Fecha:** 2026-06-17 · **Base:** `b98079b` (S8) → este commit ·
> **Alcance:** que el asistente lea TODOS los campos del cliente (incl. DNI/NIF y
> campos personalizados en `metadata`), recuerde el cliente activo del hilo, y
> nunca diga "no tengo acceso". Sin tocar executor/confirm, n8n, schema, RLS ni
> `service_role` frontend.

---

## 1. Bug real observado
Usuario crea un cliente (Oier Duñabeitia Berezo) y conversa:
1. "Hay un nuevo cliente que he registrado, ¿cuál es?" → el asistente lo identifica.
2. "Necesito su DNI" → "No tengo registrado el DNI" (FALSO: el DNI existe).
3. "¿No tienes acceso a ese campo?" → "No tengo acceso directo a los datos…" (FALSO).
4. "Pásame la ficha completa de este cliente" → "¿A qué cliente te refieres?" (perdió el contexto).

## 2. Causa exacta nº1 — el DNI no llegaba al modelo
El DNI se guarda al crear el cliente en **`clients.metadata.document_id`** (jsonb).
Verificado en BD: el cliente real tiene
`metadata = { document_id: "<DNI>", address: "<dirección>", city_area:
"<zona>", nationality: "<nacionalidad>", … }` (valores reales redactados).
Pero las listas de columnas de las tools de cliente — `CLIENT_COLUMNS`
(assistant-tools) y `CLIENT_COLS` (agente) — **NO incluían `metadata`**. Las tools
nunca seleccionaban metadata → el DNI nunca entraba en `result.data` → el modelo
no lo veía → "no consta".

## 3. Causa exacta nº2 — pérdida de contexto
El flujo de cliente activo SÍ existe: la página manda `lastReferencedClientId/
Name` en cada petición y los reenvía; el agente inyecta "CLIENTE ACTIVO EN
CONVERSACIÓN". Pero solo se guarda cuando el agente devuelve `referencedClientId`.
"¿cuál es el nuevo cliente?" se respondía con una tool de **lista** que no fijaba
un cliente único → nada que guardar → el turno siguiente ("su DNI") iba sin
cliente activo → "¿a qué cliente?".

## 4. Causa nº3 — respuestas falsas de "no tengo acceso"
El prompt no prohibía explícitamente "no tengo acceso directo"; el modelo, sin el
dato y sin contexto, improvisaba esa frase (inaceptable: sí tiene tools).

## 5. Auditoría schema/metadata (clients)
Columnas reales: id, workspace_id, name, company, email, phone, channel, status,
lead_score, notes, assigned_to, **metadata (jsonb)**, created_at, updated_at,
deleted_at. **No** hay columnas dedicadas de DNI/NIF/budget/zona → viven en
`metadata` (claves del formulario: `document_id`, `address`, `city_area`,
`nationality`, `client_type`, `preferred_language`).

## 6. Cambios aplicados
**A) Cobertura de metadata (DNI y campos personalizados).**
`CLIENT_COLUMNS` y `CLIENT_COLS` ahora incluyen `metadata` (+ `updated_at`). Mapas
`CLIENT_FIELD_SPECS` (canónico → etiqueta + columnas + claves de metadata) y
`FIELD_ALIASES` (dni/nif/cif/correo/… → canónico) con `resolveClientField()` y
`describeClientMetadata()` (accent-insensitive). DNI/NIF se resuelve desde
`document_id`/`dni`/`nif`/`cif`/`tax_id`/… 

**B) `get_client_context` = perfil completo + campos personalizados.**
Ahora añade líneas "DNI/NIF: …", "Dirección: …", "Zona: …", etc. desde metadata, y
`metadata` viaja en `data`. Nulls → "No consta".

**C) Tool nueva `get_client_field_exact`.**
Resuelve cliente (client_id activo o nombre) + campo por alias (columnas +
metadata) → valor EXACTO o "No consta [campo] registrado de X". Varios candidatos
→ pide cuál. No inventa.

**D) Tool nueva `get_latest_client`.**
"nuevo/último cliente registrado" → el más reciente (created_at desc), **fija el
cliente activo** (referencedClientId) para el hilo. limit opcional para "los
últimos N".

**E) Prompt / tool routing.**
- "nuevo/último cliente" → get_latest_client.
- "DNI/NIF/CIF/email/teléfono de X o su DNI" → get_client_field_exact (usa client
  activo si lo hay).
- "este cliente / su / él / ella / el mismo" → cliente activo (no preguntar a quién).
- **PROHIBIDO** "no tengo acceso directo"; siempre tool antes de negar; "No consta"
  solo DESPUÉS de comprobar; nunca UUID/score; nunca inventar.

## 7. Tool suite (estado)
Cobertura amplia con herramientas potentes (no 50 sueltas):
- Clientes: search_clients, get_client_context (perfil 360), get_client_field_exact,
  get_latest_client, list_clients, hot_leads, select_client_by_ordinal, latest/oldest.
- Operaciones/Expedientes/Tareas/Calendario/Actividad/Propiedades: list_*, +
  get_client_context agrega TODO lo del cliente (operaciones/expedientes/tareas/
  citas/actividad). Acciones con confirmación intactas (prepare_* + executor).
- Roadmap por dominio (detalle por operación/expediente, búsquedas avanzadas,
  documentos) documentado; no se sobre-implementa.

## 8. Documentos / Storage / RAG
Auditado: existe módulo (bucket `client-files` + metadata por documento), **sin
extracción/embeddings/RAG**. El asistente NO finge leer PDFs. Detalle y plan en
`ASSISTANT_DOCUMENTS_STORAGE_RAG_PLAN.md`.

## 9. Qué puede leer ahora / qué no
- **Sí:** todos los campos del cliente incl. DNI/NIF/dirección/zona/nacionalidad
  (metadata), operaciones, expedientes, tareas, citas, actividad, propiedades.
- **No todavía:** contenido de documentos/PDF (no hay índice), facturación real.

## 10. Seguridad multi-tenant
Todo `.eq('workspace_id')` (+ `client_id`) bajo RLS con la sesión del usuario;
metadata solo del cliente resuelto; límites por query; sin query global; sin base
completa en el prompt (data capada por compactToolData); sin `service_role`
frontend; UUID/score/workspace_id nunca al usuario.

## 11. Qué NO se tocó
Executor de escritura · `/api/assistant/confirm` · acciones confirmadas · n8n ·
WhatsApp/Meta · Google · Storage (solo auditado) · schema/migraciones · RLS ·
deps · `git reset`.

## 12. Evals
`ASSISTANT_CRM_INTELLIGENCE_EVALS.md`: +24 casos S9 (bug real reproducido,
campos metadata/DNI, memoria contextual, cliente nuevo, documentos honestos),
sobre los 35 de S8 → cobertura amplia con tool esperada y respuesta esperada.

## 13. Tests manuales
No se ejecutó el agente OpenAI desde aquí (requiere runtime + navegador). Tools
deterministas validadas contra el cliente real (DNI en `metadata.document_id`
confirmado por consulta a BD). **Smoke navegador pendiente (Oier)** con los casos
S9-1..S9-5 sobre Oier Duñabeitia Berezo.

## 14. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅
(`✓ Compiled successfully`, 46 rutas).

## 15. Roadmap siguiente
list_client_documents (metadata-only) honesto · detalle por operación/expediente ·
extracción + embeddings + RAG de documentos (plan en doc) · campos metadata
adicionales si el formulario crece.

## Veredicto
**S9 PARCIAL SEGURO — el asistente lee campos personalizados (DNI/metadata) y
mantiene el cliente activo del hilo.** Causas raíz (metadata fuera de los selects,
cliente activo no fijado, prompt sin prohibir "no tengo acceso") corregidas.
Validaciones verdes. Falta el smoke en navegador (Oier) con el cliente real para
firmar "Pro 360".
