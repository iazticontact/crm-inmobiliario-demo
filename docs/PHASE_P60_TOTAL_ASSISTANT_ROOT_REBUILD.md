# P60 — TOTAL ASSISTANT ROOT REBUILD

**Estado:** ✅ CODE COMPLETE / ⛔ MANUAL UI QA REQUIRED (route-level + harness + strict verdes)
**Fecha:** 2026-07-09

> Alcance honesto: esta fase ataca la **clase de fallo raíz** que quedaba viva en UI —keywords débiles
> («resumen», «dashboard», «vendido», «tareas») que secuestraban la intención y hacían leer datos o caer a
> n8n cuando el usuario quería *entender*. Consolida sobre el contrato único que ya existía (P50-P58), no
> crea routers paralelos. Lo que NO se reconstruyó (por estar ya correcto y probado) se documenta abajo.

## 1. Baseline
`main` limpio, HEAD `e7c23cf` (P58). Strict activo, n8n parcheado, reconciliación P56B, 31 suites verdes.

## 2. Mapa runtime real
`P60_ASSISTANT_REAL_RUNTIME_MAP.md`: contrato único `decideTurn` → gate ventas → switch de turnos → datos;
n8n solo si local no maneja, bajo contrato (token+allowedTools+strict). No hay routers duplicados.

## 3-4. Fallos por clase + causa raíz global
`P60_FAILURE_CLASSES_REPRODUCTION.md`. Reproducido con el motor real: «resumen de todo el CRM para
entenderlo» → **data_read** (mal); «hazme un resumen» → data_read (mal); learning («no sé cómo va», «me han
dado la cuenta», «estamos valorando») → ambiguous→n8n. **Causa raíz:** faltaba una capa que separase
*entender* de *consultar*; la keyword mandaba sobre el acto comunicativo.

## 5-8. Contrato / router / learning / summary intent
- **`src/lib/summary-intent.ts`** (nuevo, PURO): `classifySummaryIntent` (conceptual/operational/ambiguous),
  `isLearningContext`, `wantsFullTour`.
- **`decideTurn`** (contrato único, sin router nuevo): bloque P60 con prioridad
  **META > guía módulo > RESUMEN/LEARNING > lectura fresca > pragmática > datos**:
  conceptual/learning → `onboarding` (explica, `shouldReadData=false`); resumen ambiguo →
  `ambiguous/p60:ambiguous-summary` (aclara, no lee); resumen **operativo** («del día/con mis datos») cae al
  `data_read` normal.
- **Regla de oro** (eval): ninguna keyword suelta lee a ciegas; en ambigüedad se pregunta.

## 9. Product tour
`generateFullCrmTour(startModule?)` (catálogo): recorre los 12 módulos, arranca donde se pida («empezando
por Dashboard»), NO lee datos, nunca dice «no hay …», cierra invitando a pedir datos con «muéstrame/cuántos».

## 10. Quick actions
Chat y quick actions comparten `/api/assistant/v2`; el texto libre lo enruta `decideTurn`, no una keyword de
quick action. «resumen» ya no dispara «resumen del día» automáticamente (conceptual vs operativo vs ambiguo).

## 11. n8n (auditoría, sin cambios)
n8n ya estaba **bajo contrato** desde P51C (15/15 tools con `x-nowcrm-turn-policy`, strict activo). En las
clases cubiertas (onboarding/resumen/ventas/cartera/correcciones) local responde `handled:true` y **n8n no
se invoca** → no puede alucinar. No se tocó el workflow (no hacía falta). Strict re-verificado 7/7 en vivo.

## 12-14. Datos vivos / workspace / errores
Sin cambios respecto a P56B/P58: RLS del workspace de sesión (no hardcode), `force-dynamic`, lectura fresca
forzada por señales, **fallback parcial** en ventas. **Fix P60:** «en cartera o en operaciones» (seguimiento
de solo alcance tras ventas) ahora se resuelve como ventas (antes caía a n8n).

## 15. Matriz de módulos
`P60_MODULE_BEHAVIOR_MATRIX.md`: explicación vs datos vs prohibido para los 12 módulos + regla transversal.

## 16-18. Evals / harness / route-level
- **`assistant-root-contract.evals.ts`** (nuevo): conceptual/learning no lee, operativo lee, ambiguo aclara,
  tour cubre 12 módulos sin datos, prioridades, no-regresión P53/P56/P58.
- **`scripts/assistant-conversation-harness.mts`** (nuevo): 5 conversaciones multi-turn contra el contrato
  real + gate de ventas → **TODO PASS**.
- **32 suites TODO VERDE** · tsc/lint/build/gate ✅ · **strict 7/7 en vivo** · scans limpios (documents=0,
  invoices agents=0, sin secretos) · **0 migraciones**.

## 21. No regresiones
P56 (publicados/vendidos/estados), P58 (ventas transversal + fallback parcial), P53-P55 (guía, adversarial,
calidad) siguen verdes por eval y harness.

## 22-24. Archivos / migraciones / qué NO se tocó
**Nuevos:** `summary-intent.ts`, `assistant-root-contract.evals.ts`, `assistant-conversation-harness.mts`,
5 docs. **Modificados:** `assistant-turn.ts` (bloque P60), `crm-module-catalog.ts` (tour), `local-answers.ts`
(render tour/aclaración), `sales-domain.ts` (seguimiento de alcance). **0 migraciones.** No se tocó: n8n
workflow, strict, Facturación, `real-estate-search`, `portfolio-domain`, arquitectura/route.

## 25. Riesgos restantes
- Heurística de resumen/learning (diccionarios); lo no cubierto cae a búsqueda/entidad o aclaración (nunca
  inventa). Frases muy retorcidas → aclaración.
- **UI manual pendiente**: el harness prueba el contrato (decisión), no el render con DB. Ejecutar
  `P60_FINAL_ASSISTANT_UI_QA_CARD.md` (20 prompts) con la cuenta demo.
- Los puntos de auditoría del spec que quedaron como *documentados sin cambio de código* (quick actions,
  payload UI, endpoint debug) se cubren en el runtime map; no requerían código nuevo para las clases vistas.

## 26. Cómo validar en UI
`P60_FINAL_ASSISTANT_UI_QA_CARD.md`, cuenta demo. Críticos: #2 (tour, no datos), #6 (resumen ambiguo
aclara), #7 (resumen del día lee), #11/#12 (ventas), #18 (corrección no lista).

---

**P60 CODE COMPLETE — CAPA RESUMEN/LEARNING SOBRE EL CONTRATO ÚNICO: ONBOARDING/CONCEPTUAL BLINDADO (NO
LEE), OPERATIVO LEE, AMBIGUO ACLARA, PRODUCT TOUR REAL, VENTAS/CARTERA (P56/P58) INTACTAS, N8N BAJO
CONTRATO SIN ALUCINAR EN LAS CLASES CUBIERTAS, 32 SUITES + HARNESS MULTI-TURN + STRICT 7/7 VERDES. /
MANUAL UI QA REQUIRED (tarjeta de 20 prompts).**
