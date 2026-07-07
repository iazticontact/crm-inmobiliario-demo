# P53 — FINAL ASSISTANT MASTER REBUILD

**Estado:** ✅ CODE COMPLETE / ⛔ UI QA BLOCKED (sesión no-interactiva; checklist listo)
**Fecha:** 2026-07

## 1. Baseline
`main` limpio, HEAD `c82de44` (P51C: n8n vivo parcheado, strict activo 7/7). No existe P52.

## 2. Diagnóstico sistémico
La capa meta/strict/n8n ya estaba cerrada (P50-P51C). La **clase de fallo restante**: el sistema no
distinguía **guía de producto** de **lectura de datos** — `¿qué muestra el dashboard?` contenía la señal
débil «muestra» y disparaba un listado; no existía catálogo de módulos, ni onboarding, ni «no entiendo», ni
navegación, ni herencia de tema por módulo. Categorías A-S auditadas en `P53_ASSISTANT_FULL_ROUTE_MAP.md`.

## 3. Arquitectura final
Consolidada en `docs/ASSISTANT_ARCHITECTURE.md`. Decisión única por turno (`AssistantTurnDecision`,
**unificada**, no duplicada: se extendió el tipo existente con `module` y `shouldExplainProduct`) con
prioridad: **meta > guía de producto > pragmática > datos > ambiguo**.

## 4. Catálogo central de módulos (`crm-module-catalog.ts`, nuevo, PURO)
12 módulos (Dashboard, Clientes, Cartera, Operaciones, Comisiones, Facturación, Calendario, Tareas,
Trámites, Documentos, Configuración, Asistente) con: aliases plegados, navegación, propósito, qué muestra,
acciones, qué puede hacer el Asistente, límites y si procede ofrecer datos. `resolveModuleFromText` (alias
más largo gana). Facturación deja explícito que el Asistente **no lee facturas**.

## 5. Decision router
`decideTurn` añade 4 turnos de guía: `user_confused`, `onboarding`, `navigation_help`,
`module_explanation` (señales: «no entiendo/estoy perdido», «soy nuevo/por dónde empiezo», «dónde está/cómo
llego a», «qué muestra/resume/significa · para qué sirve · qué es este · explícame · cómo se usa»). La señal
«qué hay en <entidad>» y «muéstrame» siguen siendo LECTURA (sin regresión).

## 6-8. Product guide / contexto / generadores
- Turnos de guía → generadores del catálogo (**nunca** leen): `explainModule`, `onboardingAnswer`,
  `confusedAnswer`, `navigationAnswer`. `how_it_works` con módulo resuelto usa el catálogo.
- Contexto por módulo: «no entiendo» hereda el **módulo** del hilo; un módulo nombrado en el mensaje GANA
  al del contexto (cambio de tema sin arrastre); corrección → recovery sin repetir.
- Calidad: generadores seguros (`isSafeAnswer`), ≤2 preguntas, longitud acotada (evals G).

## 9. Local-first / tiempo real
Sin cambios de lecturas (P47-P48 intactos): RLS del usuario, datos frescos, vacío ≠ error, sin UUID/SQL.
**Fix real de esta fase**: la puntuación inicial española (`¿¡`) rompía los anclajes de inicio —
`«¿Y el de Malasaña?»` no activaba el conector de seguimiento (ni «¡Hola!» el saludo). Corregido en
`assistant-pragmatics` y `intent` (descubierto por la nueva eval del router).

## 10-11. n8n / strict
Sin cambios necesarios (ya correcto de P51C): 15/15 tools reenvían `x-nowcrm-turn-policy`, contrato en el
system prompt, workflow activo. **Re-verificado en vivo en esta fase**: `EXPECT_STRICT=1` → **7/7 OK**
(F sin token → 403 `turn_policy_required`; A con token → 200; facturación → 403).

## 12. QA UI/staging
⛔ BLOCKED (no puedo escribir en el chat). Checklist de 20 categorías en
`P53_ASSISTANT_UI_STAGING_QA_RESULTS.md` + Flujo 12 en `URGENT_VALIDATOR_TEST_CASES.md`.

## 13. Evals — 27 suites TODO VERDE
Nuevas (por propiedades, sin hardcodear producción):
- `assistant-product-guide`: catálogo completo (12), explicaciones seguras, resolución de aliases,
  4 formas de explicación × 6 módulos NO leen, el bug «qué muestra el dashboard» explícito, onboarding/
  confusión/navegación no leen, herencia y cambio de módulo, contraste de lecturas, metamórfico, calidad.
- `assistant-decision-router`: corpus mixto → decisión completa; invariante no-datos ⇒ sin tools;
  prioridades meta>módulo y guía>entidad; facturación; context kinds; escritura solo write_prepare.
(Las suites pedidas `context-kinds`/`response-quality`/`n8n-strict` quedan cubiertas dentro de estas dos y
de `turn-policy-strict` + verificación en vivo; documentado para no duplicar.)

## 14. Scans
`from('documents')`=0 · `from('invoices')` en agents=0 · facturación bloqueada en endpoint (403 verificado
en vivo) · `.env.local` no trackeado · sin secretos en código/logs · sin UUID/SQL en respuestas (guard).

## 15. No regresiones
Las 25 suites previas siguen verdes (turn, pragmatics, intent, context, error, permissions, strict,
n8n-contract, legacy, local-answers, real-estate m²/habs/baños, comisiones P46, facturación, safe-return…).
Build completo OK. Strict en vivo re-verificado.

## 16-17. Archivos / migraciones
**Nuevos:** `crm-module-catalog.ts`, 2 evals, `ASSISTANT_ARCHITECTURE.md`, `P53_ASSISTANT_FULL_ROUTE_MAP.md`,
`P53_ASSISTANT_UI_STAGING_QA_RESULTS.md`, este informe.
**Modificados:** `assistant-turn.ts`, `local-answers.ts`, `assistant-pragmatics.ts`, `intent.ts`,
`URGENT_VALIDATOR_TEST_CASES.md`. **Migraciones:** 0. **n8n:** sin cambios (verificado).

## 18. Qué NO se hizo
No se tocó n8n (ya correcto). No se amplió escritura. No se tocó Facturación/RLS/legacy. No se ejecutó la
QA de chat (sin acceso interactivo).

## 19. Riesgos restantes
- La detección de guía es heurística (diccionarios); frases muy retorcidas caen a ambiguo → aclaración o
  cerebro general (nunca lectura a ciegas).
- La QA de chat en UI queda pendiente del operador (20 casos, ~10 min).

## 20. Cómo validar con el jefe
Ejecutar el checklist de `P53_ASSISTANT_UI_STAGING_QA_RESULTS.md`. Los 4 imprescindibles: «¿qué muestra el
dashboard?» (explica, no lista), «soy nuevo» (tour), «no entiendo» (simplifica el tema), «muéstrame los
clientes» (lista real).

---

**P53 CODE COMPLETE — GUÍA DE PRODUCTO POR CATÁLOGO, ROUTER CON PRIORIDAD META>GUÍA>DATOS, CONTEXTO POR
MÓDULO SIN ARRASTRE, N8N/STRICT RE-VERIFICADOS EN VIVO (7/7) Y 27 SUITES VERDES. / UI QA BLOCKED: falta la
sesión de chat real (checklist de 20 casos listo).**
