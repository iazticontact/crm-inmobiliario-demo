# Phase 2E-2 H9 — Smoke certification (Assistant CRM intelligence)

> **Fecha:** 2026-06-16 · **HEAD probado:** `0f9e4c6` · QA del agente IA.
> **No se implementaron features.** El smoke de navegador lo ejecuta Oier
> (requiere sesión real; el agente no se puede invocar sin cookie de sesión y
> consumiría créditos OpenAI). Aquí se certifica la **mitad automatizable** y se
> deja el checklist.

## 1. Estado / validaciones
- Git: HEAD `0f9e4c6`, working tree limpio.
- Env (seguro): ref `ylhdbawrllqygfvllhdo` OK, OpenAI key + agent secret presentes
  (no impresos), `.env.local` no trackeado, legacy ausente.
- `tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).
- Dev server: `http://localhost:3000` responde **HTTP 200**.

## 2. Baseline Supabase (read-only, pre-smoke)
| Tabla | Count |
|---|---|
| clients | 8 |
| properties | 7 |
| opportunities | 7 |
| service_cases | 5 |
| tasks | 10 |
| calendar_events | 8 |
| activities | 14 |
| **assistant_threads** | **0** |
| **assistant_messages** | **0** |

## 3. Hallazgo clave (estado del smoke)
`assistant_threads = 0` y `assistant_messages = 0`, y todos los counts CRM en
baseline → **el smoke de navegador AÚN NO se ha ejecutado.** Si se hubiera hecho:
- usar el asistente crearía hilos/mensajes (threads/messages > 0);
- confirmar "crear operación" subiría `opportunities` (7→8);
- confirmar "abrir expediente" subiría `service_cases` (5→6);
- las acciones confirmadas subirían `activities`.
No se certifica "SMOKE OK" sobre resultados que no existen (no se inventan).

## 4. Readiness técnico verificado (a nivel BD/código)
- **Persistencia:** tablas `assistant_threads`/`assistant_messages` con RLS;
  insert+select como rol `authenticated` verificado en H8 (rollback). Listas para
  recibir hilos/mensajes reales.
- **recent_activity (H9):** la tool lee `public.activities`; verificado que el
  usuario ve **14 actividades** bajo RLS → "qué ha pasado recientemente" devolverá
  datos reales (ya no Inbox vacío).
- **Cobertura de tools:** ~40 tools cubren clients/operaciones/expedientes/tasks/
  calendar/activities/summary + prepare/confirm (ver H9 report).
- **Off-topic policy:** activa en el system prompt.

## 5–9. READ / recent_activity / acciones / negativos / demo / counts-after
**PENDIENTE de ejecución en navegador (Oier).** Checklist exacto = §11 abajo +
`docs/ASSISTANT_CRM_INTELLIGENCE_EVALS.md` (46 evals). Tras ejecutarlo, se
reconsultan counts y se compara con §2 para certificar persistencia/acciones.

## 10. Bugs
Ninguno a nivel automatizado (validaciones verdes, readiness OK). Bugs de runtime
del agente solo se podrán observar durante el smoke de navegador.

## 11. Checklist de smoke (Oier) — orden recomendado
1. Login real → `/assistant` → "Nueva consulta" (Consulta interna lista).
2. "Resumen del CRM" → responde con datos reales y tono majo.
3. "Qué ha pasado recientemente" → **debe listar actividades reales** (no "nada").
4. **Recarga la página** → la consulta y sus mensajes **siguen ahí**; ábrela.
5. Crea una **segunda** consulta → ambas en la lista.
6. READ: operaciones abiertas / expedientes / tareas / eventos / "busca a Lucía" /
   "qué necesita atención" / "resumen de Lucía" / "estado del pipeline".
7. Acción: "Crea una operación para Lucía Herrera" → card → Cancelar (no escribe) →
   repetir → Confirmar (aparece + activity). Luego abrir expediente / mover etapa /
   tarea a alta (una de cada).
8. Negativos: cliente inexistente / "borra este cliente" / "receta de tortilla"
   (off-topic, reconduce sin tools) / "dime todo lo que sabes" (sin dump).
9. Demo: logout → "Ver demo" → asistente crear+confirmar → **no persiste**.
10. Pásame counts/consola → certifico.

## 12. Veredicto
**H9 SMOKE — READINESS TÉCNICA OK; EJECUCIÓN DE NAVEGADOR PENDIENTE (counts =
baseline).** No bloqueado: sin issues técnicos conocidos; falta correr el smoke
real para certificar persistencia y acciones end-to-end.
