# P49 — ASSISTANT PRAGMATICS RESCUE

**Estado:** COMPLETADO
**Fecha:** 2026-07
**Objetivo:** que el Asistente entienda el **acto comunicativo** antes que la entidad. Mencionar "cliente/trámite/factura" NO debe disparar una lectura si el usuario pregunta una capacidad, cómo funciona algo, o habla de una acción futura.

---

## 1. Baseline
`main`, árbol limpio, HEAD `9d6d02c` (P48).

## 2. Diagnóstico
El Asistente detectaba una **entidad** y ejecutaba una lectura aunque el usuario no pidiera datos: preguntas de capacidad ("¿tienes acceso a los clientes?"), de funcionamiento ("¿cómo funciona la cartera?") o de futuro ("si creo un cliente, ¿podrás verlo?") acababan en un listado mecánico. Parecía tonto.

## 3. Por qué P48 no bastaba
P48 aportó un clasificador de **entidad/acción** sólido, pero el orden era: entidad → lectura. Faltaba una capa previa de **pragmática** (¿qué tipo de acto hace el usuario?). La presencia de una entidad activaba el enrutado de datos aunque la intención fuese conceptual.

## 4. Nueva capa pragmática (`src/lib/agents/assistant-pragmatics.ts`, PURA)
`classifyPragmatics(message)` → `{ speechAct, confidence, shouldReadData, shouldWriteData, shouldUseLastContext, shouldExplainCapability, shouldAskClarification, reason }`.
Actos: greeting, smalltalk, capability_question, permission_or_can_you_question, how_it_works_question, hypothetical_future_question, help_request, data_read_request, data_write_request, confirmation_request, correction, follow_up_filter, follow_up_detail, ambiguous, unsupported.
Diccionarios de patrones + **orden de prioridad** (no hardcodea frases). Generadores de respuesta por módulo (contenido = datos): `capabilityAnswer`, `howItWorksAnswer`, `futureAnswer`, `greetingAnswer`, `smalltalkAnswer`.

## 5. Orden de enrutado nuevo (en `local-answers.tryLocalAnswer`)
1. Normalizar. 2. **Pragmática (speechAct)**. 3. Si capacidad/cómo-funciona/futuro/ayuda/saludo → **responder sin leer**. 4. Si escritura → derivar (n8n/determinista). 5. Resto (lectura/confirmación/corrección/seguimiento/ambiguo) → enrutado de datos P48 (entidad/acción) → local-first → n8n. 6. Política de contexto/anti-contradicción. 7. Formato.
**Prioridad: speechAct > detección de entidad.**

## 6. Capability questions
"¿tienes acceso a…?", "¿puedes acceder/crear…?", "¿qué puedes hacer?" → explican la capacidad (qué puede/no puede, bajo qué condición, qué debe hacer el usuario) **sin listar datos**. Facturación → redirección al módulo (el Asistente general no lee facturas).

## 7. How-it-works questions
"¿cómo funciona la cartera?", "¿para qué sirve el módulo de comisiones?" → explicación breve del módulo (qué hace, qué datos usa, qué puede/no puede el Asistente, siguiente paso). No consulta datos.

## 8. Data reads
Solo se ejecuta lectura si el acto es de datos: verbos de listado/búsqueda/conteo, interrogativo + "tener/haber", o petición **cortés** de lectura ("¿puedes mostrarme…?" = imperativo educado → sí lee). Una petición cortés de lectura se distingue de una pregunta de habilidad ("¿puedes acceder…?" → capacidad).

## 9. Follow-ups
Confirmación/corrección/detalle/filtro siguen usando la política de contexto de P48 (confirmar previo, conservar ante error, aclarar sin contexto). Un follow-up de **capacidad** sobre una entidad del contexto explica la capacidad; no repite la lista.

## 10. Error prevention
Muchos errores venían de **leer cuando no tocaba**. Al no ejecutar lectura en actos conceptuales, desaparece el "no puedo acceder…" en esos casos. Cuando SÍ se lee y falla, sigue la política de errores/anti-contradicción de P48 (código seguro, vacío ≠ error, no borrar resultado válido).

## 11. Botones rápidos y panel
El panel de capacidades y las respuestas de "¿qué puedes hacer?" explican sin ejecutar consultas. Los intents de lectura básicos siguen yendo a local-first.

## 12. Evals generales (no hardcoded)
Runner temporal (`npx tsx`, borrado) — **20 suites TODO VERDE ✅**. Nueva `assistant-pragmatics` por **propiedades**:
- capacidad/permiso (varias entidades) → **no** lee; how-it-works → explica, no lee; futuro/hipotético → condicional, no lee; lecturas reales → sí leen; petición cortés → lee; facturación capacidad → redirige; saludo/gracias → no leen; "saludo + consulta" → lee; **invariancia metamórfica** (acentos/mayúsculas); generadores seguros (`isSafeAnswer`); ambigüedad → no lee.
El código no hardcodea las frases de los evals (diccionarios + reglas; los evals protegen propiedades).

## 13. Validaciones
| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ 0 warnings |
| `npm run build` | ✅ |
| `node --check scripts/check-agent-deploy.mjs` | ✅ |
| Evals (20 suites) | ✅ TODO VERDE |
| `from('documents')` en `src` | 0 |
| `from('invoices')` en la ruta activa del Asistente (agents + assistant/v2 local-first) | 0 |
| service_role en frontend / módulos nuevos | 0 |
| UUID/SQL en respuestas (guard `isSafeAnswer` + evals) | 0 |

## 14. Archivos
**Nuevos:** `src/lib/agents/assistant-pragmatics.ts`, `src/lib/agents/__evals__/assistant-pragmatics.evals.ts`, este informe.
**Modificados:** `src/lib/agents/local-answers.ts` (pragmática primero), `docs/URGENT_VALIDATOR_TEST_CASES.md`. **Migraciones:** 0.

## 15. Qué NO se hizo
Sin tocar n8n · sin ampliar acciones de escritura · sin service_role frontend · sin secretos · sin migraciones · sin leer facturas en la ruta activa.

## 16. Riesgos restantes
- El **cerebro legacy V1** (`src/lib/assistant-tools.ts`, opt-in vía `ASSISTANT_PROVIDER=openai/v1/local`) todavía consulta `invoices`; predata la aislación y **no** es la ruta por defecto (n8n + local-first), que no lee facturas. Queda como deuda documentada, fuera del alcance de P49.
- La distinción "¿puedes X?" petición-cortés vs capacidad es heurística; casos muy retorcidos pueden clasificarse como ambiguos (se derivan al cerebro general, no producen error de lectura).

## 17. Validación para el jefe
`docs/URGENT_VALIDATOR_TEST_CASES.md` → categoría "Preguntas sobre capacidades y funcionamiento": preguntar capacidad, preguntar cómo funciona, preguntar por el futuro, y comprobar que **no** aparece un listado mecánico; y que una lectura real sí devuelve datos.

---

**P49 COMPLETADO — EL ASISTENTE YA DISTINGUE ENTRE PREGUNTAR CAPACIDADES, PEDIR EXPLICACIÓN Y LEER DATOS, SIN RESPUESTAS MECÁNICAS NI HARDCODEAR FRASES.**
