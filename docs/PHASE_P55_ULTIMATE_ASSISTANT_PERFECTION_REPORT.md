# P55 — ULTIMATE ASSISTANT PERFECTION & ZERO-KNOWN-BUG PASS

**Estado:** ✅ CODE COMPLETE / ⛔ UI QA PENDING (solo falta el chat real; tarjeta de 20 prompts lista)
**Fecha:** 2026-07

## 1-3. Baseline / estado inicial / qué estaba bien
`main` limpio, HEAD `43341de` (P54). Ya bien de P53/P54: router único, catálogo de 12 módulos, meta/recovery,
strict activo (7/7), n8n parcheado, 28 suites verdes, QA runner 20/20, generadores pulidos.

## 4. Fallos reales encontrados (sondeo adversarial de 22 frases contra la lógica real)
Ninguno de seguridad (el fallback `ambiguous` nunca lee), pero **7 fallos de clasificación** en frases muy
comunes que degradaban la UX a «ambiguo → n8n» o a clase incorrecta:
1. «qué puede hacer este asistente» (3ª persona) → ambiguo (debía ser capability).
2. «qué son los trámites» → ambiguo (debía explicar).
3. «qué hace facturación» → data_read redirect frío (debía explicar el módulo).
4. «ahora cartera» / «vale, y clientes» (cambio de tema con solo el módulo) → ambiguo.
5. «te has liado» → ambiguo (debía ser corrección).
6. «no listes datos» (instrucción de comportamiento) → ambiguo (debía ser meta).
7. «explícame el CRM» → respondía «¿qué pantalla estás viendo?» (debía dar la visión general).

## 5. Fallos descartados (documentados, no bugs)
- «cómo va el dashboard ahora» / «enséñame eso» / «dime lo de antes» / «qué hay» → ambiguo/lectura genérica
  que deriva al cerebro general (n8n pregunta o responde); comportamiento honesto, sin lectura a ciegas.

## 6. Cambios (todos generales, sin hardcodear frases sueltas)
- `assistant-pragmatics`: CAPABILITY_SELF acepta 3ª persona («qué puede hacer este asistente/bot/copiloto»).
- `assistant-turn`: EXPLAIN_PRODUCT += «qué son los/las…» y «qué hace…» (con exclusión de «hace falta»);
  USER_CORRECTION += «te has liado/equivocado»; ASSISTANT_META += instrucción «no (me) listes/muestres/des
  datos»; **module-switch**: mensaje ≤3 palabras que solo nombra un módulo → explicarlo (nunca leer a ciegas).
- `local-answers`: module_explanation sin módulo + palabra general (crm/aplicación/programa…) → visión
  general (onboarding) en vez de «¿qué pantalla?».

## 7-9. Evals / QA runner
Nueva **`assistant-adversarial.evals.ts`**: blinda los 7 fixes + invariantes anti-regresión (lecturas siguen
leyendo; «hace falta» excluido; mixto explica primero; contexto «y eso qué significa» hereda módulo).
**29 suites TODO VERDE.** QA runner: **20/20 PASS**.

## 10-11. Strict / n8n / scans
Strict re-verificado EN VIVO contra staging: **7/7 OK** (sin token 403 · token válido 200 · factura 403).
`from('documents')`=0 · `from('invoices')` en agents=0 · `.env.local` no trackeado · sin secretos.

## 12. Validaciones
tsc ✅ · lint 0 warnings ✅ · build ✅ · deploy-gate ✅ · 29 suites ✅ · runner 20/20 ✅ · strict 7/7 ✅.

## 13-14. QA UI / archivos
⛔ UI QA pendiente (sesión no-interactiva) → **`P55_FINAL_REAL_CHAT_QA_CARD.md`** (20 prompts exactos con
columna PASS/FAIL, ejecutable en 5-10 min). **Modificados:** assistant-turn, assistant-pragmatics,
local-answers. **Nuevos:** eval adversarial, QA card, este informe. **Migraciones: 0.**

## 15-16. Qué NO se tocó / riesgos
No se tocó: n8n, strict, Facturación, router/arquitectura, catálogo (estructura), legacy. Riesgo restante:
heurística — lo muy retorcido cae a ambiguo → aclaración/cerebro general (nunca lectura a ciegas); QA de
chat manual pendiente.

## 17. Cómo validar en 5 minutos
Abrir el Asistente en staging → seguir `P55_FINAL_REAL_CHAT_QA_CARD.md` (20 prompts en orden). Críticos:
#4 (explica, no lista), #6 (cambio de tema limpio), #9/#11 (datos reales), #16 («no listes datos»), #19
(facturación redirige).

---

**P55 CODE COMPLETE — 7 FALLOS REALES DE CLASIFICACIÓN ENCONTRADOS POR SONDEO ADVERSARIAL Y CORREGIDOS DE
FORMA GENERAL, BLINDADOS POR EVAL (29 SUITES VERDES), RUNNER 20/20, STRICT/N8N RE-VERIFICADOS EN VIVO (7/7).
/ UI QA PENDING: tarjeta final de 20 prompts lista para ejecutar en 5-10 minutos.**
