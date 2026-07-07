# P54 — FINAL AGENT PERFECTION PASS

**Estado:** ✅ CODE COMPLETE / ⛔ UI QA BLOCKED (solo falta el chat real; tarjeta de 20 pruebas lista)
**Fecha:** 2026-07

## 1. Baseline
`main` limpio, HEAD `566b35d` (P53). Strict activo, n8n parcheado, 27 suites verdes de partida.

## 2. Qué NO se reconstruyó (regla de la fase)
Ni router, ni catálogo, ni generadores duplicados. n8n sin tocar (re-verificado). Strict sin tocar
(re-verificado). Facturación intacta. 0 migraciones.

## 3. Microfallos encontrados (auditoría de generadores)
1. **`confusedAnswer` rompía mayúsculas**: lowercaseaba la primera letra de `shows` → «**kPIs** del día»
   visible justo en el módulo que más confunde (Dashboard). Corregido (reformulado con «Ahí verás: …»).
2. **`smalltalkAnswer` = «¡A ti!»**: correcto tras «gracias» pero raro tras «perfecto/genial/de acuerdo»
   (el detector cubre todos). Sustituido por un reconocimiento neutro.
3. **`explainModule` sin formato**: líneas planas → ahora cabecera + bullets `• Dónde/Muestra/Puedes
   (/Ten en cuenta)` + UN solo cierre. Y el cierre «…datos actuales de dashboard» (gramática torpe con
   nombres de módulo) → «¿Quieres que te muestre tus datos actuales?».

## 4-5. Tono / clasificación
Sin cambios de clasificación (P53 intacto). Solo copy/formato de los 3 puntos anteriores. Reglas de calidad
del enunciado ahora **protegidas por eval**: explicación 2-6 bullets + 1 cierre; ≤1 pregunta final;
longitud 40-900; sin «workspace»/UUID/SQL/tecnicismos; confusión no vuelca listas ni cambia de tema.

## 6. QA runner (nuevo, permanente)
`scripts/assistant-qa-runner.mts` — QA conversacional sin red/auth/secretos contra la lógica REAL
(`decideTurn` + permisos + generadores): 20 categorías con turnType/shouldReadData/tools y PASS/FAIL +
muestras de respuesta. **Resultado: 20/20 PASS.**
Uso: `npx tsx --tsconfig tsconfig.json scripts/assistant-qa-runner.mts`

## 7. Evals
Nueva `assistant-final-quality` (propiedades A-O del enunciado: explicaciones no leen, lecturas leen,
no-entiendo simplifica sin listas y conserva mayúsculas, corrección/queja sin tools, cambio de módulo sin
arrastre, calidad de TODOS los generadores —longitud/≤1 pregunta/seguros/sin tecnicismos—, bullets 2-6,
facturación redirige, social sin tools, ambiguo aclara, puntuación española, coloquiales).
**Total: 28 suites TODO VERDE.**

## 8. Strict / n8n verification (en vivo, esta fase)
`EXPECT_STRICT=1 … verify-tool-policy` contra staging real → **7/7 OK** (sin token 403
`turn_policy_required`; token válido 200; factura 403 `tool_forbidden_for_assistant`).

## 9. Scans
`from('documents')`=0 · `from('invoices')` en agents=0 · `.env.local` no trackeado · sin secretos en
código/logs · UUID/SQL en respuestas=0 (guard + evals) · legacy bloqueado por env.

## 10. QA UI
⛔ BLOCKED (sesión no-interactiva). **`docs/P54_FINAL_AGENT_QA_CARD.md`**: tarjeta compacta de 20 pruebas
copiar/pegar con esperado y qué capturar si falla.

## 11. No regresiones
Las 27 suites previas siguen verdes (turn, guía, pragmática, intent, contexto, permisos, strict, n8n,
legacy, local-answers, real-estate, comisiones P46, facturación, safe-return, móvil P47…). Build completo OK.

## 12-13. Archivos / migraciones
**Nuevos:** `assistant-final-quality.evals.ts`, `scripts/assistant-qa-runner.mts`, `P54_FINAL_AGENT_QA_CARD.md`,
este informe. **Modificados:** `crm-module-catalog.ts` (formato + fixes), `assistant-pragmatics.ts`
(smalltalk). **Migraciones: 0.**

## 14. Riesgos restantes
- QA de chat en UI pendiente del operador (~10 min con la tarjeta).
- La detección sigue siendo heurística: lo muy retorcido cae a ambiguo → aclaración (nunca lectura a ciegas).

## 15. Cómo validar con el jefe
Abrir el Asistente en staging y seguir `P54_FINAL_AGENT_QA_CARD.md` (20 pruebas, en orden). Los 4 críticos:
#3 (explica, no lista), #9 (simplifica el mismo tema), #12 (lista real), #17 (cambio de módulo sin arrastre).

---

**P54 CODE COMPLETE — AGENTE PULIDO: RESPUESTAS NATURALES Y FORMATEADAS, MICROBUGS DE COPY CORREGIDOS
(«kPIs», «¡A ti!», cierres torpes), REGLAS DE CALIDAD PROTEGIDAS POR EVAL, QA RUNNER 20/20, STRICT/N8N
RE-VERIFICADOS EN VIVO (7/7) Y 28 SUITES VERDES. / UI QA BLOCKED: falta solo el chat real (tarjeta lista).**
