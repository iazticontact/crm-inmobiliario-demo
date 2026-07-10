# P63 — PORTFOLIO / INMUEBLES RUNTIME CLOSURE

**Estado:** ✅ CODE COMPLETE / ⛔ UI E2E BLOCKED — TEST_SESSION_MISSING
**Fecha:** 2026-07-10

## 0. N8N Preflight — ✅ OK
Workflow activo `6mps8YoWu3syldUc` (HTTP 200, 15/15 tools con policy header, contrato presente), backup en
temp. **n8n sin cambios**: el secuestro por Tareas era 100% local (clasificador + gate), no de n8n.

## 1-2. Baseline + reproducción
`main` limpio, HEAD `e26f4f7` (P62). Incidente **reproducido exactamente** contra el motor real:
«Pues nada, lístame todo lo que tengo en inmuebles» → `handleAgenda(tasks)` → «Tareas pendientes: no…».

## 3. CAUSA RAÍZ (doble, la palabra «todo»)
1. **`intent.ts`**: el vocab de tasks incluía la palabra española **`'todo'`** — «lístame **TODO** lo que
   tengo en inmuebles» puntuaba entity=tasks. Cualquier frase con «todo» quedaba sesgada a Tareas.
2. **Gate de agenda (P61)**: `to ?do` en el regex de tareas hacía match con «todo».
Ambas eliminadas: tasks = `tarea|recordatorio|to-do|checklist|pendiente` (nunca «todo»).

## 4-9. Fixes (clase completa, no frases)
- **Prioridad de módulo explícito**: si el mensaje menciona vocab de inmuebles, los gates de agenda NO
  aplican (`mentionsPortfolio` guard) — invariante `portfolioPromptMustNeverSelectTasks` protegida por eval.
- **Listado completo**: `parseStatusIntent` reconoce «todo lo que tengo en inmuebles / todo lo de cartera /
  lístame…todo…pisos» → `all` (lista TODOS los estados, sin excluir vendidos, con etiquetas traducidas).
- **Estados como señal de Cartera**: `publicado/anunciado/reservado/archivado` en el vocab de properties →
  «muéstrame los publicados» resuelve Cartera sin decir «inmueble». (sold/rented siguen en sales-domain.)
- **Gate ambiguo + estado**: «todo lo de propiedades» (sin verbo) → handler de properties por routing.
- Correcciones «no te he pedido tareas» → meta sin leer; cambios de módulo tareas↔inmuebles sin arrastre.

## Validación
- `scripts/p63-real-portfolio-incident-check.mts` (motor real, mock realista): **TODO PASS** (explica,
  lista 8 con estados, publicados vía listed, vendidos vía sales, reread mantiene Cartera, 0 Tareas).
- Nueva eval `assistant-portfolio-runtime` (invariante anti-secuestro, 9 prompts × entidad+decisión).
- **35 suites TODO VERDE** · incidentes P61/P62 PASS · harness PASS · QA runner PASS.
- tsc/lint/build/gate ✅ · **strict 7/7 en vivo** ✅ · **reconciliación en vivo**: endpoint desplegado
  devuelve 8 inmuebles (6 sold / 1 listed / 1 rented) = BD exacta.

## Archivos / qué NO
**Modificados:** `intent.ts` (vocab), `local-answers.ts` (guards + gate estado), `portfolio-domain.ts`
(all), `assistant-turn.ts` (sin cambio neto tras revert), eval P63 + incident script + este doc.
**0 migraciones.** n8n sin tocar (auditado). Playwright: **BLOCKED — TEST_SESSION_MISSING**.

## Validación manual (3 min, cuenta demo)
1. «lístame todo lo que tengo en inmuebles» → 8 inmuebles con estados (JAMÁS tareas).
2. «resúmeme mis inmuebles» → cartera. 3. «muéstrame los publicados» → San Pedro 66.
4. «¿y vendidos?» → 6 + operaciones. 5. «no te he pedido tareas» → repara sin listar.

---
**P63 CODE COMPLETE — SECUESTRO POR TAREAS ELIMINADO DE RAÍZ (la palabra «todo» ya no es señal de tasks en
ningún nivel), MÓDULO EXPLÍCITO SIEMPRE GANA, LISTADO COMPLETO POR ESTADOS, 35 SUITES + 3 INCIDENTES +
STRICT 7/7 + RECONCILIACIÓN EN VIVO VERDES. / UI E2E BLOCKED: TEST_SESSION_MISSING.**
