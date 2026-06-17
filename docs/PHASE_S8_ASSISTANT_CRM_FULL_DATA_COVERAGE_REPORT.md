# FASE S8 — Assistant CRM intelligence & exact field retrieval

> **Fecha:** 2026-06-17 · **Base:** `be6ee21` → este commit ·
> **Alcance:** que el Asistente IA lea el CRM real y devuelva datos exactos
> (email, teléfono, operaciones, expedientes, tareas, citas) de forma segura
> (workspace-scoped/RLS, sin inventar). Sin tocar el executor de escritura,
> `/api/assistant/confirm`, n8n, schema, RLS ni `service_role` frontend.

---

## 1. Problema observado (usuario)
Al pedir datos concretos (p. ej. el email de un cliente) el asistente no respondía
correctamente o parecía no consultar la base.

## 2. Diagnóstico exacto (causa raíz)
El agente OpenAI (`nowlabs-main-agent.ts`) tiene un loop de tools. Al devolver el
resultado de una tool al modelo hacía:

```
input.push({ type: 'function_call_output', call_id, output: result.text })
```

**Solo enviaba `result.text` (resumen humano), nunca `result.data`.** Y el
resumen de clientes (`fmtClient` y el texto inline de `search_clients`) era
`"Nombre (empresa) · estado · score X · canal"` — **sin email ni teléfono** (y
filtrando "score", que además está prohibido mostrar). Resultado:

> El modelo **nunca recibía** el email/teléfono del cliente → no podía
> responder "¿cuál es el email de X?" (y arriesgaba inventarlo).

Segundo gap: `get_client_context` (la "ficha completa") leía la tabla **legacy
`invoices`** por `client_name`, **no** las tablas reales (`opportunities`,
`service_cases`, `tasks`, `calendar_events`, `activities`). La ficha estaba
incompleta y desactualizada.

> Nota: el atajo determinista (preRoute → `buildFormatPrompt`) SÍ pasaba `data`
> al modelo; por eso algunas consultas "de lista" funcionaban y otras (que caen
> al loop completo) no. Esa inconsistencia confirmaba el bug.

## 3. Tools auditadas (antes)
`crm_overview, list_clients, search_clients, select_client_by_ordinal,
get_client_context, hot_leads, list_opportunities, list_service_cases,
list_properties, pending/overdue_invoices, upcoming_events, pending_tasks,
recent_activity, recent_messages, workspace_overview, list_pending_items,
prepare_* (booking/task/invoice), + acciones de escritura`. Cobertura de
**lectura** amplia, pero (a) el modelo no recibía la `data` estructurada en el
loop, y (b) la ficha de cliente no incluía las entidades reales.

## 4. Matriz de cobertura (resumen)
| Área | Tabla | Campos clave | Cobertura ahora |
|---|---|---|---|
| Clientes | clients | name, email, phone, status, channel, notes, created_at (budget/zona en metadata) | search_clients + get_client_context (email/phone EN texto y data) |
| Operaciones | opportunities | title, stage, value, probability, expected_close_date, notes | list_opportunities + get_client_context (por cliente) |
| Expedientes | service_cases | title, case_type, status, priority, due_date | list_service_cases + get_client_context |
| Tareas | tasks | title, status, priority, due_date | pending_tasks + get_client_context |
| Calendario | calendar_events | title, type, date, start_at, location, status | upcoming_events + get_client_context |
| Actividad | activities | type, title, description, created_at | recent_activity + get_client_context |
| Propiedades | properties | (list_properties) | list_properties |

## 5. Cambios aplicados
**A) Raíz — el modelo ahora recibe la data estructurada (loop).**
`nowlabs-main-agent.ts`: nuevo `compactToolData()` (strip `workspace_id`/
`created_by`, máx 25 filas, cap 7 000 chars) y el `function_call_output` ahora
envía `result.text` + un bloque `[DATOS_JSON internos …]` con los valores
exactos. El modelo puede leer email/teléfono/fechas/etapas de CUALQUIER tool.

**B) Texto de cliente con contacto, sin score.**
`fmtClient` (assistant-tools) y el texto inline de `search_clients` (agente)
ahora incluyen **email + teléfono** y **omiten "score"**.

**C) `get_client_context` = perfil completo real.**
Reescrito para leer, por `client_id` (workspace-scoped/RLS):
`opportunities + service_cases + tasks + calendar_events + activities` además del
contacto. Nulls → "No consta". Devuelve texto por secciones + `data` completa.
Se eliminó la lectura legacy de `invoices`.

**D) Prompt + tool descriptions.**
- Regla "INTEGRIDAD DE DATOS": para datos reales SIEMPRE tool; valores exactos;
  null = "No consta"; **nunca** inventar; **nunca** mostrar UUID ni "score".
- Mapa de tools: añadido "email/teléfono de X → get_client_context (campo exacto;
  si null → No consta)" y "operaciones/expedientes/tareas/citas de X →
  get_client_context".
- Descripción de `get_client_context` actualizada (perfil completo, no facturas).
- `buildFormatPrompt` de `get_client_context` y `search_clients` reescritos: sin
  "score", sin facturas; formatean el perfil real y responden el campo exacto.

## 6. Entity resolution
`search_clients` busca por nombre/empresa/email/teléfono/notas (ilike) con
fallback a la primera palabra; 1 match → ficha; varios → candidatos + "¿a cuál?";
0 → "no encontrado". `select_client_by_ordinal` para "el primero/último".
"ese cliente/sus datos" usa el CLIENTE ACTIVO del hilo. "uno al azar" → uno real
de los resultados. Sin inventar, sin score, sin UUID.

## 7. Ejemplos que ahora responde
- "¿Cuál es el email de [cliente]?" → email exacto, o "No consta email registrado".
- "Dame todos los datos de [cliente]." → contacto + operaciones + expedientes +
  tareas + citas + actividad.
- "¿Qué operaciones/expedientes/tareas/citas tiene [cliente]?" → del cliente.
- "Busca clientes de [zona]" / "Busca a Ana" → candidatos reales.
- Campo null → "No consta ... registrado" (no inventa).

## 8. Query audit / seguridad multi-tenant
Todas las lecturas: `.eq('workspace_id', workspaceId)` (+ `.eq('client_id', id)`)
bajo RLS, con el cliente server anon de la ruta (la sesión del usuario), límites
por query, sin query global, sin `public.conversations/messages`, sin
`service_role` en frontend, sin cargar toda la base en el prompt (solo lo que la
tool devuelve, capado). UUIDs solo para chaining interno, nunca al usuario.

## 9. Evals
`docs/ASSISTANT_CRM_INTELLIGENCE_EVALS.md` ampliado con **35 casos S8**
(clientes/operaciones/expedientes/tareas/calendario/actividad/ambiguos/negativos/
acciones), cada uno con tool esperada y respuesta esperada + "no inventar / no
UUID / no score".

## 10. Tests manuales
No se ejecutó el agente OpenAI desde aquí (requiere `OPENAI_API_KEY` runtime y
navegador). Los tools son deterministas y se validan con el seed real (8 clientes,
operaciones/expedientes/tareas/eventos/actividad). **Smoke en navegador pendiente
(Oier)** con los 35 evals tras desplegar.

## 11. Qué NO se tocó
Executor de escritura · `/api/assistant/confirm` · acciones confirmadas (create/
update task, create/move operation, update service case) · n8n · WhatsApp/Meta ·
Google · Storage/PDF · facturación (módulo legacy dejado tal cual, solo se dejó de
usar en la ficha de cliente) · schema/migraciones · RLS · deps · `git reset`.

## 12. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅
(`✓ Compiled successfully`, 46 rutas).

## 13. Smoke staging (pendiente, Oier — tras redeploy)
Ejecutar los 35 evals; verificar email/teléfono exactos, perfil completo, "No
consta" en nulls, sin UUID, sin score, acciones con confirmación.

## 14. Riesgos pendientes
- El agente requiere `OPENAI_API_KEY` en runtime (ya configurada por Oier).
- `budget`/`preferred_area`/`source` de cliente viven en `metadata` (no columnas
  dedicadas); si se quieren exponer, mapear desde metadata (futuro).
- Tablas legacy `invoices` siguen existiendo (módulo dormido); no se usan en la ficha.

## 15. Próximo paso
Redeploy en EasyPanel + smoke de los 35 evals en el navegador.

## Veredicto
**S8 PARCIAL SEGURO — el asistente ya recibe y devuelve datos reales exactos del
CRM.** Causa raíz (solo se enviaba el resumen al modelo, sin email/teléfono ni la
data) corregida; ficha de cliente ahora completa con entidades reales; prompt y
formato sin score/UUID y con "No consta". Validaciones verdes. Falta el smoke en
navegador (Oier) tras desplegar para firmar "cobertura completa".
