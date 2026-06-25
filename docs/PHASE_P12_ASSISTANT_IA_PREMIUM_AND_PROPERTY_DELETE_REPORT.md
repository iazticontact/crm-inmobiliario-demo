# FASE P12 — Asistente IA Premium + borrado seguro de inmuebles + limpieza de naming

> **Fecha:** 2026-06-25 · Cierre de calidad antes de dejar el Asistente final: **borrado seguro de
> inmuebles**, renombrado **"Copiloto" → "Asistente IA"** en todo lo visible, **rediseño del panel
> lateral** del Asistente (fuera bloques inútiles y botón muerto), y **fix del bug latente de tareas**
> (`completed` → `done`). Sin tocar n8n/Agent V2 runtime/Google Calendar/Auth/RLS/Storage. Requiere
> redeploy del front.

---

## 1. Diagnóstico

- **Naming:** "Copiloto"/"Copiloto del CRM"/"Copiloto activo" visibles en Asistente, Topbar, Settings,
  Dashboard, ficha de cliente y onboarding. El producto debe decir **"Asistente IA"**.
- **Panel lateral del Asistente:** bloque **"WhatsApp Business…"** (canal inexistente) y **"Recomendación
  IA" con botón "Aplicar"** que solo llamaba a una acción vaga → percibido como **botón muerto**.
- **Borrado de inmuebles:** **no existía**. Las FKs `property_id` en `opportunities`, `service_cases`,
  `tasks`, `calendar_events` son **ON DELETE SET NULL** (no bloquean ni cascadean), y `entity_files`
  (fotos/documentos) es **polimórfico sin FK** → un borrado directo dejaría operaciones desvinculadas
  en silencio y archivos huérfanos.
- **Bug de tareas:** `deterministic-db-actions.ts` y la ruta `/api/assistant/confirm` escribían
  `status: 'completed'`, que **viola el constraint `tasks_status_check (pending|done)`** → "completar
  tarea" desde el agente fallaría.

## 2. Borrado seguro de inmuebles

Helper nuevo `deleteProperty(workspaceId, id)` (`vertical-queries.ts`): borra **primero** fotos/
documentos con `deleteEntityFilesFor(ws, 'property', id)` (evita huérfanos) y luego el inmueble (DELETE
RLS-protegido, sin `service_role`). UI en **Cartera › Inmuebles** (papelera discreta por tarjeta):
- **Con operaciones vinculadas → BLOQUEO guiado** (`ConfirmDialog`): *"No puedes eliminar este inmueble;
  tiene N operaciones vinculadas. Archívalo o revisa sus operaciones. No se ha borrado nada."* + botón
  **"Ver operaciones"** (lleva a la pestaña Operaciones). Usa el contador `ops` ya calculado (sin query
  extra).
- **Sin operaciones → confirmación fuerte** (`destructive`): *"Se eliminará «…» y sus fotos y documentos
  asociados. Esta acción no se puede deshacer. No se elimina ningún cliente. Para conservar el histórico,
  normalmente es mejor archivar."* → borra archivos + inmueble, actualiza la UI sin F5, toast.
- **Prioriza Archivar:** "Archivar" sigue siendo la acción principal (select de estado); Eliminar es la
  acción secundaria peligrosa (papelera rosa). Modo demo: no persiste.
- **Verificado (MCP):** en el workspace de ejemplo, 6/7 inmuebles tienen operaciones → **bloqueados**;
  solo "Piso - Av. del Puerto 8" (0 operaciones) es eliminable. No se borran clientes ni operaciones.

## 3. Naming: Copiloto → Asistente IA

Sustituido en **todo lo visible**: Asistente (header, modo, estado, panel, empty state), `Topbar`,
`Settings` (3 sitios + tarjeta), `Dashboard` (botón + paso de onboarding), **ficha de cliente** (botón),
`onboarding`, `brand.ts` (app/assistant description), y una línea del **system prompt** del agente
("Soy el Asistente IA conectado a tu CRM"). El identificador **interno** del modo (`'copilot'`, enum
`AssistantMode`) se mantiene (no es visible; cambiarlo rompería persistencia/canales). De paso:
`Settings` "expedientes" → **"trámites"**.

## 4. Rediseño visual del Asistente

- **Cabecera:** título "Asistente IA" + subtítulo **"Consulta datos del CRM y prepara acciones con
  confirmación."** (sin "Copiloto"). KPI central "IA en modo / Copiloto activo" → **"Estado / Conectado"**
  (detalle "Datos reales del workspace").
- **Panel derecho premium (3 bloques limpios):**
  - **"Qué puedes pedir"** — 6 acciones **clicables y reales** (lanzan la consulta al Asistente; sin
    botones muertos): Resumen del día · Operaciones abiertas · Inmuebles activos · Vencimientos ·
    Comisiones · Buscar cliente.
  - **"Acciones seguras"** — *"Las acciones que modifican datos se preparan y requieren tu confirmación
    antes de guardarse."*
  - **"Contexto disponible"** — pills: Clientes · Inmuebles · Operaciones · Trámites · Citas · Comisiones
    + "Conectado a los datos reales de tu workspace."
- **Responsive (390):** el panel de conversaciones se oculta < `lg` y el panel de ayuda < `xl`; el chat
  (`flex-1 min-w-0`) ocupa todo el ancho en móvil. Input y acciones rápidas siempre accesibles.

## 5. Qué se eliminó por inútil

- Bloque **"WhatsApp Business (Meta Cloud API) es la siguiente fase…"** del panel del Asistente IA.
- Bloque **"Recomendación IA" + botón "Aplicar"** (botón muerto).
- Consts muertas asociadas (`capabilities`, `inboxCapabilities`).

## 6. Quick actions finales

Copilot reducido de **9 → 6** chips útiles con vocabulario actual (Resumen del día, Operaciones
abiertas, Inmuebles activos, Vencimientos, Comisiones, Buscar cliente). Ejemplos del empty state
alineados a P12: "¿Qué comisiones tengo pendientes?", "Resume la cartera activa", "¿Qué vencimientos
tengo esta semana?", "Busca el inmueble de Calle Mayor", "Prepara una cita con Roberto Díaz", "¿Qué
operaciones están en gestión?".

## 7. Chat UX

Placeholder **"Pregunta por clientes, inmuebles, citas, comisiones…"**; empty state "Tu Asistente IA,
listo cuando quieras 👋"; botón de envío con estado de carga (`isTyping`); "Qué puedes pedir" del panel
y los chips inferiores comparten los mismos prompts (coherencia). Burbujas/timeline sin cambios (ya
premium).

## 8. Acciones preparadas / confirmación

Las tarjetas de acción preparada (cita/factura/operación/trámite/tarea) ya existían y se conservan:
muestran qué se cambia, la entidad y **Confirmar/Cancelar**. Se añadió la nota explícita "Acciones
seguras". El label visible de etapa `won` en el preview pasó de "Ganada" → **"Vendida/Alquilada"**
(coherente con el modelo comercial). No se promete ninguna automatización inexistente.

## 9. Fix completed → done (tareas)

- `deterministic-db-actions.ts`: `detectTaskStatus` "completada/hecha/terminada/finalizada" → **`'done'`**
  (antes `'completed'`).
- `/api/assistant/confirm/route.ts` (`update_task`): normaliza el status entrante
  (`completed/complete/closed/finished → done`, `open/todo → pending`) **antes de escribir** → ninguna
  ruta de confirmación puede romper el constraint. (El agente n8n es **read-only**; las escrituras pasan
  por confirmación.)

## 10. Rendimiento

Sin queries nuevas (el borrado usa el `ops` ya calculado; `deleteProperty` reutiliza
`deleteEntityFilesFor`). Sin N+1, sin signed URLs nuevas, sin dependencias. `useMemo`/listas existentes
intactas.

## 11. Responsive

Móvil 390: chat a pantalla completa, input y chips accesibles; paneles laterales colapsan
(conversaciones < lg, ayuda < xl). Desktop/1440: layout de 3 columnas intacto.

## 12. Seguridad

RLS intacta · workspace-scoped · **sin `service_role` en frontend** (las apariciones del scan son
strings de diagnóstico de configuración, no uso) · sin UUID visible · `deleteProperty` no toca clientes
ni operaciones (FKs SET NULL + bloqueo de negocio) · borrados siempre con confirmación.

## 13. Qué NO se tocó

n8n / workflows · Agent V2 runtime · `/api/agent/tool` · lógica sensible de `/api/assistant/*` (solo la
normalización de status del task, requerida) · Google Calendar · Auth · Storage/RLS policies ·
secretos/env · facturación/impuestos · enum interno `AssistantMode='copilot'` · contrato de tools.

## 14. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅. **Scans:** Copiloto
visible **0** (solo comentarios) · Aplicar/WhatsApp-CTA muertos **0** · `completed` como write de
tasks.status **0** · pipeline/expediente/probabilidad/stage/listed/won/lost visibles **0** ·
`service_role` frontend **0** · UUID visible **0** · botones muertos **0**. MCP: borrado bloquea 6/7
inmuebles del ejemplo (con operaciones).

## 15. Archivos

| Archivo | Cambio |
|---|---|
| `src/lib/vertical-queries.ts` | `deleteProperty` (borra entity_files + inmueble) |
| `src/app/(saas)/opportunities/page.tsx` | UI borrado seguro (papelera + 2 ConfirmDialog: bloqueo/confirmación) |
| `src/app/(saas)/assistant/page.tsx` | naming, header, panel derecho (3 bloques), quick actions 6, placeholder, responsive, label won |
| `src/app/api/assistant/confirm/route.ts` | normaliza status de tarea (completed→done) |
| `src/lib/agents/deterministic-db-actions.ts` | detectTaskStatus → 'done' |
| `src/lib/agents/nowlabs-main-agent.ts` | 1 línea de copy del prompt (copiloto→Asistente IA) |
| `Topbar.tsx`, `settings/page.tsx`, `dashboard/page.tsx`, `clients/[id]/page.tsx`, `onboarding/page.tsx`, `brand.ts` | naming Copiloto → Asistente IA (+ expedientes→trámites en settings) |

## 16–19. Commit / Push / Redeploy

Commit `feat(assistant,cartera): Asistente IA premium + borrado seguro de inmuebles (P12)` → `origin/main`.
**Requiere redeploy del front.**

## 20. Checklist de staging

- [ ] No aparece "Copiloto" en ninguna pantalla (Asistente, Topbar, Settings, Dashboard, ficha cliente,
      onboarding).
- [ ] Asistente: panel derecho con "Qué puedes pedir" (6 clicables) / "Acciones seguras" / "Contexto
      disponible". Sin WhatsApp ni "Aplicar".
- [ ] "Hola" responde natural; "¿qué comisiones tengo pendientes?" / "qué inmuebles activos tengo" /
      "qué vencimientos tengo" responden con vocabulario correcto.
- [ ] Completar tarea desde el Asistente → queda en `done` (no error de constraint).
- [ ] Inmuebles: borrar inmueble **con** operaciones → bloqueo guiado ("Ver operaciones").
- [ ] Inmuebles: borrar inmueble **sin** vínculos → confirmación fuerte → borra inmueble + fotos/docs.
- [ ] Archivar / reactivar inmueble siguen funcionando; no se borran clientes.
- [ ] Móvil 390: chat usable a pantalla completa; paneles laterales colapsados.
- [ ] Regresión: Clientes, Calendario, Cartera, Dashboard sin cambios.

## 21. Pendientes honestos

- **Conversaciones del Asistente en móvil:** la lista se oculta < lg (el chat activo y "Nueva consulta"
  siguen disponibles); un **drawer/acordeón** para cambiar de conversación en móvil queda como
  micro-ajuste futuro.
- **Borrar inmueble desde la ficha** (`/opportunities/properties/[id]`): el borrado seguro vive en la
  tarjeta de Cartera; replicarlo en la ficha es trivial (mismo helper) y queda pendiente.
- El **enum interno `'copilot'`** permanece (no visible); renombrarlo sería un refactor de persistencia
  fuera de alcance.

## Veredicto

**P12 COMPLETADO — ASISTENTE IA PREMIUM Y BORRADO SEGURO DE INMUEBLES.** El producto ya no dice
"Copiloto" en ninguna pantalla; el Asistente IA tiene un panel lateral limpio y útil (acciones reales
clicables, sin WhatsApp de relleno ni botón "Aplicar" muerto), copy premium y chat usable también en
móvil; los inmuebles se pueden **eliminar de forma segura** (bloqueo si hay operaciones, confirmación
fuerte con limpieza de fotos/documentos, nunca borra clientes ni operaciones); y el bug de tareas
(`completed`→`done`) está corregido en la preparación y en la escritura. Sin tocar n8n/Agent V2/Google
Calendar/Auth/RLS/Storage. `tsc`/`lint`/`build` en verde, scans limpios, datos del ejemplo verificados
por MCP. **Requiere redeploy del front.**
