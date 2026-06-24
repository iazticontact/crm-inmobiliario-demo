# FASE P10 — Asistente IA coherente con el CRM final

> **Fecha:** 2026-06-24 · Alineación del Asistente/Agent V2 al vocabulario y conceptos del CRM actual
> (Clientes, Cartera/Inmuebles, Operaciones, Trámites, Citas, Comisiones). **Solo prompt + copy +
> evals**: sin tocar contrato de tools, RLS, n8n, rutas ni Storage. Requiere redeploy.

## 1. Auditoría (antes de tocar)
- **Agent V2** (`src/lib/agents/nowlabs-main-agent.ts`): system prompt + descripciones de tools +
  **plantillas de respuesta deterministas** usaban "expediente", "oportunidad", "pipeline", "lead",
  "probabilidad", "propiedad" — incluido el **texto literal que ve el usuario** ("X oportunidad(es)",
  "✅ Expediente abierto", "📁 Expedientes", "Score: X"…).
- **Capacidades** (`assistant-capabilities.ts`): "Operaciones / pipeline", "Expedientes",
  "Propiedades", "probabilidad".
- **UI Asistente** (`assistant/page.tsx`): títulos de acción "Expediente…", toast "expediente",
  bloque "Probabilidad" en la tarjeta de acción.
- **Contrato que NO se puede cambiar** (y no se cambió): nombres de tools (`list_opportunities`,
  `create_service_case`, `update_property_status`…), args (`opportunity_id`, `case_id`…), enums de
  estado de la DB (`new/contacted/.../won/lost`, `open/documentation_pending/...`), `lead_score`
  interno, y la lógica del router determinista.
- **Evals**: no existe runner (sin jest/vitest; ejecutar el LLM sería costoso/flaky).
- **n8n**: no requería cambios → no se tocó.

## 2. Vocabulario sustituido (texto, no contrato)
| Antiguo | Nuevo |
|---|---|
| oportunidad / pipeline | **operación** (abierta/cerrada por estado comercial) |
| expediente | **trámite** |
| propiedad | **inmueble** (cartera; activo vs histórico) |
| lead / lead score / probabilidad (visible) | **cliente potencial** / prioridad cualitativa (score NUNCA visible) |
| "facturación" para comisiones | **comisión** = control interno |

## 3. Qué entiende ahora el Asistente (bloque "CONCEPTOS Y VOCABULARIO" nuevo en el prompt)
- **Inmueble**: ACTIVO (En preparación / Publicado / Reservado) vs HISTÓRICO (Vendido / Alquilado /
  Archivado; no se borra, sale de la cartera activa). Responde "¿está vendido o activo?" por su estado.
- **Operación**: ABIERTA (Nueva / En gestión / Reserva) o CERRADA (Vendida/Alquilada) o Perdida.
- **Trámite**: gestión con estado, vencimiento y **documentos**.
- **Cita**: vinculada a cliente / inmueble / operación / trámite.
- **Comisión**: prevista / pendiente / cobrada, control interno — **nunca** "facturación".
- **Términos prohibidos** al usuario: pipeline, lead, expediente, probabilidad, oportunidad; el lead
  score es interno.

## 4. Cambios concretos
**`nowlabs-main-agent.ts`** (system prompt + tools + respuestas):
- IDENTIDAD, ALCANCE, "QUÉ PUEDES HACER", "SECCIONES DEL CRM" reescritos al modelo inmobiliario +
  bloque **CONCEPTOS Y VOCABULARIO**. Añadidas secciones **Cartera/Inmuebles** y **Comisiones**.
- **Descripciones de tools** (texto, no nombres/args/enums): `list_opportunities` (operaciones por
  estado), `list_service_cases` (trámites), `list_properties` (activo vs histórico + `rented`),
  `create_opportunity` (operación), `create_service_case` (trámite), `create_property` (inmueble; enum
  property_type/operation_type alineado a claves es-ES `piso/venta`… — columnas free-text),
  `update_*`, `get_client_context`, `workspace_overview`, `list_pending_items`, `recommended_actions`,
  `hot_leads` (sin "lead/score" visible).
- **Plantillas de respuesta deterministas** (lo que ve el usuario): "X operación(es)", "X trámite(s)",
  "X inmueble(s)", "✅ Operación/Trámite/Inmueble creado/actualizado…", "📁 Trámites:", "🏠 Tienes X
  inmueble(s)". `hot_leads` deja de imprimir "Score: X" → prioridad cualitativa.
- **Router**: solo se **añadió** vocabulario nuevo (operacion/tramite/inmueble) a la detección de
  acciones; no se quitó ningún término antiguo (sigue reconociendo al usuario que diga "pipeline").

**`assistant-capabilities.ts`**: capacidades a Operaciones / Trámites / Inmuebles (cartera) +
**nueva capacidad Comisiones**; planificación y formato de ficha con "Trámites".

**`assistant/page.tsx`** (copilot): títulos de acción "Trámite…", toast "trámite", eliminado el
bloque visible "Probabilidad" (la tool de crear operación ya no envía probability desde P6.10).

## 5. Evals (nuevo)
`src/lib/agents/__evals__/assistant-coherence.evals.ts`: fixture con las **7 preguntas** + tool
esperada + vocabulario que DEBE / NO DEBE aparecer (inmuebles activos, operaciones en gestión,
trámites que vencen, citas de hoy, comisiones pendientes, ¿vendido o activo?, resumen de cliente).
Como no hay runner, sirve de fuente de verdad para QA manual y para un runner futuro.

## 6. Qué NO se tocó
n8n (workflows) · routes (`/api/assistant/*`, `/api/agent/tool`) · RLS · Auth · Storage · Google
Calendar · Dashboard · Cartera · Calendario · **nombres/args de tools** · **enums de estado** ·
**lógica del router** · `lead_score` (interno).

## 7. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅. Scan del **texto de
salida** del agente: 0 "oportunidad/expediente/propiedad/probabilidad/pipeline/score" visible. Solo
quedan, a propósito: nombres de tools, args, enums de estado y un **regex de entrada** que sigue
reconociendo "pipeline" si lo teclea el usuario.

## 8. Checklist de staging (QA manual de los evals)
- [ ] "¿Qué inmuebles tengo activos?" → lista inmuebles activos (no histórico); dice "inmueble",
      nunca "propiedad/pipeline".
- [ ] "¿Qué operaciones están en gestión?" → operaciones En gestión; dice "operación", nunca
      "oportunidad/pipeline".
- [ ] "¿Qué trámites vencen?" → trámites por vencer/vencidos; dice "trámite", nunca "expediente".
- [ ] "¿Qué citas tengo hoy?" → citas de hoy.
- [ ] "¿Qué comisiones tengo pendientes?" → comisión pendiente (control interno), nunca "facturación".
- [ ] "¿Este inmueble está vendido o activo?" → responde por estado (activo/histórico).
- [ ] "Enséñame el resumen de Roberto Díaz" → ficha 360 con Operaciones · Trámites · Tareas · Citas ·
      Actividad; sin lead score.
- [ ] Crear/actualizar operación o trámite → confirma y responde con vocabulario nuevo, sin F5.

## 9. Pendientes honestos
- **Modo Inbox** del Asistente (sub-feature WhatsApp/conversaciones) conserva un "Lead Score" de
  conversación (`leadScores`/`leadScoreColor`) — está **gateado a `assistantMode === 'inbox'`** (el
  copilot inmobiliario muestra "Estado operativo"). Se deja fuera de alcance por ser otra superficie;
  alinearlo sería una micro-fase aparte.
- No hay **runner de evals** automático: los evals son un fixture para QA manual / runner futuro
  (ejecutar el LLM real en CI sería costoso y flaky).
- El **router** sigue reconociendo "pipeline/oportunidad/expediente" como ENTRADA del usuario (para no
  romper a quien los teclee); el agente RESPONDE siempre con el vocabulario nuevo.

## Veredicto
**P10 COMPLETADO — ASISTENTE COHERENTE CON EL CRM FINAL.** El Asistente entiende y habla el
vocabulario actual (cliente, inmueble, cartera, operación, trámite, cita, comisión, histórico),
distingue activos vs histórico y abiertas vs cerradas, trata comisiones como control interno y nunca
muestra lead score ni términos antiguos en sus respuestas. Sin tocar el contrato de tools, n8n, RLS,
rutas ni el resto de módulos. `tsc`/`lint`/`build` en verde + fixture de evals. Requiere redeploy.
