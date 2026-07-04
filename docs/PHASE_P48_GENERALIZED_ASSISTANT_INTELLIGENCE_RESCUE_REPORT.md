# P48 — GENERALIZED ASSISTANT INTELLIGENCE RESCUE

**Estado:** COMPLETADO
**Fecha:** 2026-07
**Objetivo:** convertir el Asistente en un producto fiable ante lenguaje natural real — intención general, contexto conversacional, local-first para lecturas básicas, sin contradicciones, errores honestos y validación por propiedades (no frases hardcodeadas).

---

## 1. Baseline
`main`, árbol limpio, HEAD `a502ecf` (P47).

## 2-3. Problema sistémico + causa raíz
El P47 resolvió clientes/inmuebles con un layer local, pero con **detectores ad-hoc** por consulta. El problema de fondo no era una frase: faltaba **arquitectura general**:
- sin clasificador de intención reutilizable (cada intención era un `detect*` propio);
- sin política de **contexto** (un follow-up de confirmación podía reconsultar y contradecir un resultado válido);
- sin política de **errores** unificada (riesgo de "no hay datos" cuando en realidad hubo error);
- cobertura local-first limitada a 2 entidades (clientes, inmuebles).

## 4. Arquitectura nueva (módulos PUROS + un motor)
| Módulo | Rol |
|---|---|
| `src/lib/agents/intent.ts` | **Clasificador general** por diccionarios de señales (entidad + acción + marcadores de seguimiento). Devuelve `{entity, action, confidence, followUpType, needsContext, shouldUseLocal, shouldUseN8n, blockedReason, searchTerm}`. Tolerante a acentos/mayúsculas/plurales; desempate por posición del sustantivo. |
| `src/lib/agents/assistant-errors.ts` | **Política de errores**: 17 códigos → mensaje humano + siguiente paso. `isSafeAnswer` (guard "no UUID/SQL/stack/técnico"). `readFailedCodeFor(entity)`. |
| `src/lib/agents/context-policy.ts` | **Anti-contradicción**: `decideFollowUp` (confirmar previo / conservar previo ante error / aclarar / consulta fresca). success beats later transient error; error no borra resultado válido; empty ≠ error. |
| `src/lib/agents/local-answers.ts` | **Motor local-first** que orquesta lo anterior y enruta a los readers RLS por entidad. |

## 5. Intent detection (general, sin hardcodear frases)
- Diccionarios de señales por entidad (clients, properties, operations, commissions, calendar, tasks, service_cases, documents, invoicing, help). Se puntúa cada entidad y gana la de más peso; **empate → el sustantivo que aparece antes** ("documentos de un cliente" = documentos).
- Acciones: list / search / count / detail / summary. Seguimientos: confirm / reference / filter / detail / correction.
- Enrutado: lecturas básicas → `shouldUseLocal`; escrituras y ambigüedad → `shouldUseN8n`; Facturación → `blockedReason='invoicing_isolated'`.

## 6. Contexto conversacional
- La ruta ya reenvía `lastResults` por conversación y los últimos mensajes del hilo. El motor deduce el **tema previo** (`classifyIntent(recentContext)`) para heredarlo en seguimientos ("y el de Malasaña?" → inmuebles).
- Devuelve `referencedList` (lista estructurada, sin mostrarse como texto) para resolver ordinales/seguimientos en el cliente.

## 7. Local-first routing
Cubre **clientes, inmuebles, operaciones, citas, tareas, trámites, documentos (metadata)** y **ayuda**, con la sesión RLS del usuario (sin n8n, sin OpenAI, sin service_role). **Comisiones** y **Facturación** → redirección honesta al módulo correspondiente (Facturación sigue aislada; el Asistente no consulta `invoices`). Si n8n cae, estas lecturas básicas siguen funcionando.

## 8. Política de errores
Cada fallo de lectura → código por entidad (`CLIENTS_READ_FAILED`, `PROPERTIES_READ_FAILED`, …) con mensaje humano + siguiente paso + log seguro server-side. Nunca stack/SQL/UUID. Se distingue **vacío honesto** ("No hay clientes registrados todavía") de **error** ("No he podido consultar… Código: X").

## 9. Anti-contradicción
- Un **follow-up de confirmación** con éxito previo se responde **desde el resultado anterior** (sin reconsultar → imposible contradecir).
- Si un seguimiento reconsulta y falla habiendo resultado válido → se conserva el previo con prefacio honesto ("…no he podido revalidarlo, pero no lo sustituyo por un error").
- Seguimiento sin contexto → **pedir aclaración**, no error genérico.

## 10. Búsqueda inmobiliaria generalizada
Se apoya en el motor P47 (`real-estate-search.ts`): tipo/operación/zona/precio/superficie(m²)/habitaciones/baños, plurales/abreviaturas/acentos, exactos vs cercanos. El clasificador pasa el mensaje completo al buscador (el motor extrae los filtros), en vez de detectores por frase.

## 11. Formato de respuestas
Formateadores por entidad (clientes, inmuebles, operaciones, citas, tareas, trámites, documentos): total + lista breve con bullets, **sin UUIDs ni nombres de campo/tabla**, con pregunta de seguimiento útil.

## 12-13. Evals generales (no hardcoded)
Runner temporal (`npx tsx`, borrado) — **19 suites TODO VERDE ✅**. Nuevas suites por **propiedades**:
- `assistant-intent`: equivalencia (muchas formas → misma entidad), **metamórfico** (acentos/mayúsculas/plurales invariantes), aislamiento de Facturación, escrituras no-local, local-first, follow-up hereda tema.
- `assistant-context`: `decideFollowUp` (confirmar/conservar/aclarar/fresco), error no borra resultado válido, empty ≠ error.
- `assistant-error-policy`: todos los códigos con mensaje+nextStep, `isSafeAnswer` rechaza UUID/SQL/stack/técnico y acepta texto limpio.
El código NO hardcodea las frases de los evals: son diccionarios + reglas; los evals protegen **propiedades generales**.

## 14. No regresiones
P46 (comisiones), Facturación aislada, documentos `entity_files`, propiedades móvil y el motor P47 siguen verdes. `from('documents')`=0, `from('invoices')` en Asistente=0.

## 15. Validaciones
| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ 0 warnings |
| `npm run build` | ✅ (49 páginas) |
| `node --check scripts/check-agent-deploy.mjs` | ✅ |
| Evals (19 suites) | ✅ TODO VERDE |
| scans documents/invoices/service_role/UUID | ✅ 0 |

## 16. Riesgos restantes
- Las consultas **complejas/creativas** siguen en n8n (el local-first cubre lecturas básicas); si n8n cae, esas quedan degradadas a un error honesto.
- El contexto conversacional depende de que el cliente reenvíe `lastResults`; en un hilo nuevo sin historial no hay seguimiento (se pide aclaración, no error).
- Comisiones vía Asistente es una **redirección** al módulo (no un desglose calculado), decisión documentada para no duplicar la lógica del ciclo económico.

## 17. Archivos
**Nuevos:** `intent.ts`, `assistant-errors.ts`, `context-policy.ts`, `__evals__/assistant-intent.evals.ts`, `assistant-context.evals.ts`, `assistant-error-policy.evals.ts`, este informe.
**Modificados:** `local-answers.ts` (motor general), `app/api/assistant/v2/route.ts` (contexto + referencedList), `docs/URGENT_VALIDATOR_TEST_CASES.md`. **Migraciones:** 0.

## 18. Qué NO se hizo
Sin tocar n8n · Asistente sin leer facturas · sin service_role frontend · sin secretos · sin migraciones · sin RLS · sin ampliar acciones de escritura. No se hardcodearon frases; se arregló la clase de fallos.

---

**P48 COMPLETADO — ASISTENTE ROBUSTO, LOCAL-FIRST, CON CONTEXTO, SIN CONTRADICCIONES, SIN HARDCODEAR FRASES Y VALIDADO CON EVALS GENERALES/METAMÓRFICAS/ADVERSARIALES.**
