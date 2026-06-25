# FASE P12.1 — QA final del Asistente IA: inteligencia útil, coherencia CRM y backend sólido

> **Fecha:** 2026-06-25 · QA de cierre del Asistente IA sobre P12 (`43a1466`): auditoría de UI +
> backend + prompts/deterministas, limpieza de **vocabulario antiguo residual** (expediente, etapas
> granulares, "Ganada"), **borrado de inmueble desde la ficha** (cierra el pendiente de P12), quick
> actions finales y evals ampliados. Sin tocar n8n / Agent V2 runtime / `/api/agent/tool` / Google
> Calendar / Auth / RLS / Storage. Requiere redeploy del front.

---

## 1. Diagnóstico

Tras P12 quedaban rastros de **vocabulario genérico/antiguo** en superficies del agente que no se
habían tocado por estar en rutas de servidor / acciones deterministas:
- **`/api/assistant/confirm`**: mensajes visibles "**Expediente** creado/actualizado" (×4).
- **`deterministic-db-actions.ts`**: respuesta que listaba **etapas granulares** ("nuevo, contactado,
  cualificado, visita programada, oferta, negociación, **ganada** o perdida"), `STAGE_LABEL.won =
  'Ganada'`, y "**expediente**" (×6).
- **Quick actions** P12 (6) no incluían "Próximas citas" ni "Comisiones pendientes" con el copy de §4.
- **Borrado de inmueble desde la ficha**: pendiente honesto de P12.
- Fallback local (`internalAssistantIntro`) describía "facturas, cobros, NIE" (genérico).

## 2. Auditoría UI/UX

| Elemento | Estado |
|---|---|
| Header "Asistente IA" + subtítulo | ✅ limpio (sin "Copiloto") |
| Cards de modo | ✅ (en producción solo "Asistente IA") |
| Lista de conversaciones | ✅ (colapsa < lg en móvil) |
| Chat central | ✅ protagonista; loading "Asistente IA consultando el CRM…"; error humano |
| Panel derecho | ✅ 3 bloques útiles (Qué puedes pedir / Acciones seguras / Contexto disponible) |
| Quick actions | ✅ 7 reales (ver §5), sin botones muertos |
| Empty state | ✅ ejemplos actuales |
| Acciones preparadas | ✅ tarjetas Confirmar/Cancelar |
| WhatsApp / "Aplicar" muertos | ✅ 0 (eliminados en P12) |

## 3. Auditoría backend / acciones

- **Escrituras con confirmación:** crear/actualizar operación, trámite, tarea, cita → todas pasan por
  `preparedAction` + `/api/assistant/confirm` (no escriben directo).
- **Valores válidos contra constraints:** `tasks.status` → normalizado a `done` en (a) `detectTaskStatus`
  (deterministic) y (b) la ruta confirm (`completed/complete/closed/finished → done`). `service_cases.
  status` = free text (sin constraint). Operación cerrada = estado interno `won`, UI/respuestas dicen
  **"Vendida/Alquilada"**.
- **Agente n8n = read-only** (consulta datos reales vía tools); las escrituras nacen del frontend con
  confirmación. `ASSISTANT_PROVIDER=n8n` en real; fallback local solo offline/respaldo.
- **Sin `service_role` frontend · sin UUID visible · errores claros.**

## 4. Cambios de copy (vocabulario final)

| Antes (visible) | Ahora |
|---|---|
| "Expediente creado/actualizado" (confirm route) | **"Trámite creado/actualizado"** |
| "Dime a qué etapa… nuevo, contactado… ganada o perdida" | **"Dime a qué estado… Nueva, En gestión, Reserva, Vendida/Alquilada o Perdida"** |
| `STAGE_LABEL.won = 'Ganada'` | **'Vendida/Alquilada'** (+ etapas granulares → "En gestión") |
| "expediente(s)" en respuestas deterministas (×6) | **"trámite(s)"** |
| Intro local: "facturas, cobros, NIE" | **"clientes, inmuebles, operaciones, trámites, citas, comisiones y vencimientos"** |

`detectStage` ahora reconoce los **estados comerciales** que dice el usuario ("vendida/alquilada/
cerrada"→won, "reserva"→reserved, "en gestión"→managing) además de las etapas legacy.

## 5. Quick actions finales

7 acciones reales (clic = consulta al Asistente, sin botones muertos): **Resumen del día · Inmuebles
activos · Operaciones abiertas · Comisiones pendientes · Vencimientos · Próximas citas · Buscar
cliente**. Prompts con vocabulario final (p. ej. "¿Qué comisiones tengo pendientes de cobro?",
"¿Qué vencimientos tengo próximos o vencidos?").

## 6. Panel derecho final

1. **Qué puedes pedir** — las 7 acciones reales (clicables).
2. **Acciones seguras** — "Las acciones que modifican datos requieren confirmación."
3. **Contexto disponible** — Clientes · Inmuebles · Operaciones · Trámites · Citas · Comisiones.

## 7. Vocabulario final

Usa: clientes, inmuebles, cartera activa, vendidos/alquilados, operaciones, trámites, citas, tareas,
comisiones, vencimientos, pendiente/cobrada, En gestión/Reserva/Vendida-Alquilada/Perdida. **No** usa
(visible): Copiloto, pipeline, lead, expediente, probabilidad, stage, won/lost, listed, score,
completed (para tareas). El `lead score` solo existe en el modo **Inbox** (interno, gateado por
`NEXT_PUBLIC_NOWLABS_INTERNAL`), nunca en el Asistente IA de producción.

## 8. Evals manuales (fixture + a verificar en staging)

`src/lib/agents/__evals__/assistant-coherence.evals.ts` ampliado a **12 casos** (P10 + P12.1). No hay
runner (ejecutar el LLM real es costoso/flaky); es la fuente de verdad para QA manual en staging. Datos
del workspace de ejemplo verificados por MCP (soportan las pruebas): 9 clientes · 3 inmuebles activos ·
3 operaciones abiertas · 3 comisiones pendientes · 3 citas esta semana · 5 trámites abiertos.

| # | Pregunta | Esperado |
|---|---|---|
| 1 | "Hola" | Saludo natural y breve; sin parrafada. |
| 2 | "Dame un resumen del día" | Citas + vencimientos + operaciones importantes. |
| 3 | "¿Qué inmuebles activos tengo?" | Inmuebles activos (no histórico). |
| 4 | "¿Qué operaciones abiertas tengo?" | Estados humanos (En gestión/Reserva…). |
| 5 | "¿Qué comisiones pendientes?" | Pendiente/cobrada/prevista; nunca "facturación". |
| 6 | "¿Qué citas tengo esta semana?" | Citas reales. |
| 7 | "Completa la tarea X" | Prepara acción + confirmación; escribe `done`. |
| 8 | "¿Qué trámites están vencidos?" | Trámites/tareas por vencer. |
| 9 | (sin datos) | Dice que no consta; **no inventa**. |
| 10 | "Crea una operación para X" | Prepara acción + confirmación (no escribe directo). |

## 9. completed → done verificado

3 rutas garantizan `done`: `updateTask` (`normalizeTaskStatus`), `detectTaskStatus` (deterministic) y
`/api/assistant/confirm` (`update_task` normaliza antes de escribir). Scan: **0** writes de `'completed'`
a `tasks.status`.

## 10. Borrado de inmueble desde la ficha (cierra pendiente P12)

`/opportunities/properties/[id]`: botón **"Eliminar"** (acción secundaria/peligrosa, rosa). Reutiliza
`deleteProperty` y el mismo criterio:
- **Con operaciones vinculadas** (`linkedOps`) → **bloqueo guiado** ("…archívalo o revisa sus
  operaciones. No se ha borrado nada.").
- **Sin operaciones** → **confirmación fuerte** (borra fotos/documentos) → vuelve a **Cartera**
  (`router.push('/opportunities')`).
- No borra clientes ni operaciones; modo demo no persiste.

## 11. Rendimiento

0 N+1, sin dependencias nuevas, sin Storage/signed URLs en el Asistente. El borrado en ficha usa
`linkedOps` ya memoizado (sin query extra). UI no bloquea.

## 12. Responsive

Móvil 390: chat full-width, input y chips accesibles; conversaciones < lg y ayuda < xl colapsan; sin
overflow horizontal. Drawer de conversaciones en móvil = pendiente documentado.

## 13. Seguridad

RLS · workspace-scoped · sin `service_role` frontend · sin secretos · sin UUID visible · confirmación
antes de escritura · borrado seguro sin tocar datos relacionados sin aviso.

## 14. Qué NO se tocó

n8n / workflows · Agent V2 runtime · `/api/agent/tool` · tools/enums del agente · Google Calendar ·
Auth · Storage/RLS · secretos/env · enum interno `AssistantMode='copilot'` · modo Inbox (interno).

## 15. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅. **Scans:** Copiloto
visible **0** · pipeline/expediente/probabilidad/stage/listed/won/lost visibles **0** · `completed`
write **0** · `service_role` frontend **0** (solo comentarios) · UUID visible **0** · botón muerto **0**
· WhatsApp CTA/Aplicar muertos **0** · mock en modo real **0**.

## 16. Archivos

| Archivo | Cambio |
|---|---|
| `src/app/(saas)/assistant/page.tsx` | quick actions finales (7), intro real-estate, panel slice 7 |
| `src/app/(saas)/opportunities/properties/[id]/page.tsx` | **borrado seguro desde la ficha** |
| `src/app/api/assistant/confirm/route.ts` | "Expediente"→"Trámite" en mensajes visibles |
| `src/lib/agents/deterministic-db-actions.ts` | estados comerciales (STAGE_LABEL + detectStage), expediente→trámite |
| `src/lib/agents/__evals__/assistant-coherence.evals.ts` | +5 casos (P12.1) |

## 17–19. Commit / Push / Redeploy

Commit `polish(assistant): QA final, vocabulario y borrado de inmueble desde ficha (P12.1)` →
`origin/main`. **Requiere redeploy del front.**

## 20. Checklist de staging

- [ ] "Hola" → respuesta natural y corta.
- [ ] "Dame un resumen del día" → citas + vencimientos + operaciones.
- [ ] "¿Qué inmuebles activos tengo?" → activos, sin histórico mezclado.
- [ ] "¿Qué operaciones abiertas tengo?" → estados humanos.
- [ ] "¿Qué comisiones pendientes?" → pendiente/cobrada/prevista, nunca "facturación".
- [ ] "¿Qué citas tengo esta semana?" → citas reales.
- [ ] "Completa la tarea X" → confirmación → `done` (sin error de constraint).
- [ ] "¿Qué trámites están vencidos?" → trámites/tareas, dice "trámite" no "expediente".
- [ ] Sin datos → no inventa.
- [ ] "Crea una operación para X" → prepara + confirmación.
- [ ] Ficha de inmueble: "Eliminar" con operaciones → bloqueo; sin operaciones → borra + vuelve a Cartera.
- [ ] Móvil 390: chat usable, sin overflow.

## 21. Pendientes honestos

- **Fallback local** (offline/respaldo) conserva el flujo genérico de cita/factura/propuesta (no usa
  términos prohibidos, pero es menos "inmobiliario" que n8n). En producción responde **n8n** (prompt ya
  alineado). Reescribir el fallback completo a inmobiliario sería una micro-fase aparte.
- **Drawer de conversaciones en móvil** (la lista se oculta < lg; el chat activo y "Nueva consulta"
  siguen disponibles).
- **Modo Inbox** mantiene "Lead Score" (interno, gateado), fuera del Asistente IA de producción.
- No hay **runner de evals** automático (fixture para QA manual / runner futuro).

## Veredicto

**P12.1 COMPLETADO — ASISTENTE IA FINAL QA Y BACKEND COHERENTE.** El Asistente habla el vocabulario
inmobiliario final en **todas** sus superficies (incluidas las respuestas deterministas y los mensajes
de la ruta de confirmación, donde quedaba "Expediente"/"Ganada"/etapas granulares); las quick actions
son 7 acciones reales y útiles; las escrituras pasan por confirmación con valores válidos (tareas
siempre `done`); el borrado de inmueble está disponible **también desde la ficha** con bloqueo/
confirmación; y los evals están ampliados a 12 casos para QA de staging. Sin tocar n8n/Agent V2 runtime/
tools/Google Calendar/Auth/RLS/Storage. `tsc`/`lint`/`build` en verde, scans limpios, datos del ejemplo
verificados por MCP. **Requiere redeploy del front.** Listo para firmar el Asistente si staging
responde bien.
