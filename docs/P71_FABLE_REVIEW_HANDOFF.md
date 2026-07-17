# P71 — Handoff para auditoría independiente (Fable)

> Documento autocontenido para auditar P71 de principio a fin **sin** depender de la conversación previa.
> Rama: `p71/conversation-state-core`. Base: `553ed64` (P70 RC). No hay merge, push a main ni deploy.
> No usa este documento para afirmar que todo está perfecto: incluye limitaciones y puntos a auditar.

## 1. Problema original
El asistente conversacional no mantenía el hilo: tras «busca el cliente X», preguntas como «¿qué operaciones
tiene?», «¿y sus inmuebles?», «la ficha del primero», «¿y la semana que viene?» o «cambia el precio… (sin
decir de qué inmueble)» se perdían, se contestaban de forma genérica o se enviaban a n8n, que alucinaba. No
había memoria estructurada compartida ni composición de entidad + referencia + periodo.

## 2. Causa raíz confirmada
El motor **local-first** (`tryLocalAnswer`) es la ruta dominante para lecturas desde P47, pero era **ciego a
la memoria**: no leía ni escribía estado conversacional; solo n8n mantenía una «entidad activa» aislada.
Verificable por arqueología git: `git log -S activeEntity -- src/lib/agents/local-answers.ts` vacío antes de
P71; `saveActiveEntity` nació como «persist … from n8n». Por eso referencias/pronombres/ordinales/periodos se
perdían en la ruta que más se usa.

## 3. Arquitectura P70 anterior
- Ruta: navegador → `/api/assistant/v2` → **local-first** (lecturas deterministas con RLS) o **n8n** (cerebro).
- Plano de acciones P65/P66: `parseActionIntent` (NL→acción registrada) → `handleChatAction` →
  `/api/agent/action` **prepare→confirm→execute→verify** (idempotencia + optimistic lock + verificación).
- Automatizaciones P68/P69 (opt-in con preview + cron n8n). Findings P67. UI estructurada (contrato validado).
- Memoria: `assistant_agent_memory` guardaba solo la «entidad activa» (id+label), leída/escrita por n8n.

## 4. Arquitectura P71 actual
Estado conversacional **único por hilo** (`ConversationState` v2), cargado en la route y **leído y escrito por
local-first** (y alimentado también por n8n). Sobre él, cuatro mecanismos GENERALES (nada de frases):
1. **Resolución estructural de referencias** (pronombre/posesivo/demostrativo/ordinal/extremo/elisión) → id o
   criterio; el llamador **reconsulta la BD** (nunca responde del estado).
2. **TemporalScope** composicional (hoy/semana/mes/últimos N/entre/desde + continuación «¿y la siguiente?»).
3. **PendingIntent con slots derivados del action registry** (acción incompleta → pregunta el slot que falta →
   combina turnos → **preview**, nunca ejecuta).
4. **QueryScope composicional** (`entityScope` + `temporalScope` + capability se combinan, no se pisan).

## 5. Flujo completo de un turno
```
mensaje
 → route: carga ConversationState (upgrade v1→v2 si procede)
 → tryLocalAnswer(state):
     1. ¿pendingIntent activo? → completar/cancelar (→ preview, nunca ejecuta)
     2. handleTemporalFollowup → si hay periodo (+ opcional entidad) reconsulta agenda/relación acotada
     3. handleContextualFollowup → si hay referencia, resuelve id y RECONSULTA la fuente
     4. decideTurn (P50) → META/conceptual no leen; datos sí
     5. acción (parseActionIntent): completa → preview; incompleta → crea pendingIntent (registry)
     6. enrutado de datos por entidad (lecturas RLS)
 → emite stateUpdate (referencias, módulo, periodo, última consulta) — NUNCA datos de negocio
 → route: applyStateUpdate + saveConversationState (fail-soft)   |  o n8n si local no resuelve
```
Regla dura: **la memoria ayuda a entender; la BD es la única fuente de datos del turno.**

## 6. Cómo comparten estado local-first y n8n
La route (`src/app/api/assistant/v2/route.ts`) **carga** `ConversationState` una vez y lo pasa a local-first.
Si resuelve local-first, persiste `applyStateUpdate(state, local.stateUpdate)`. Si va a n8n, tras la respuesta
persiste el módulo/entidad que n8n resolvió en el **mismo** `ConversationState` (para que un turno posterior
manejado por local-first herede continuidad). **Matiz honesto:** n8n *escribe* al estado compartido (vía la
route) pero su prompt **no consume** `temporalScope`/`pendingIntent` (son mecanismos de local-first); n8n sigue
recibiendo la «entidad activa» por la memoria previa. No se ha modificado el contrato de n8n.

## 7. ConversationState y versiones
`src/lib/agents/conversation-state.ts`. v2 = {version, activeGoal, activeModule, activeCapability,
activeEntities[], previousEntities[], referents[], pendingIntent, temporalScope, lastDataQuery,
lastAssistantResult}. Validación runtime (un estado corrupto nunca rompe el turno). Persistencia reutilizando
`assistant_agent_memory` (memory_type='conversation_state', JSON en metadata, TTL en expires_at). **Sin
migración de BD.** `upgradeConversationState(raw)` adapta v1→v2 conservando módulo/entidades/referentes seguros
e inicializando pendingIntent/temporalScope=null; descarta solo lo irrecuperable. Métricas seguras (sin PII):
`[conversation-state.load] { outcome: loaded_v2 | upgraded | reset_invalid | empty }`.

## 8. Entity/referent resolution
`conversation-references.ts` (léxico general del español, no frases). It3: un demostrativo **temporal**
(«este mes», «esta semana») ya **no** se confunde con referencia a entidad. La resolución del **nombre** de la
entidad (`conversation-pending.ts::extractEntityNeedle`) es **NO destructiva**: un label que empieza por un
sustantivo de tipo (Chalet/Piso/Local/Ático…) conserva todos sus tokens; el resolver real del workspace
(`searchProperties` ranker por tokens, `searchClients` ilike) desambigua (varios candidatos → pregunta).

## 9. QueryScope composicional
`conversation-scope.ts`: `ConversationQueryScope = {module, capability, entityScope, temporalScope, filters,
ordering, aggregation, limit}`. `resolveQueryScope` arma cada dimensión por separado (entidad por
referencia/elisión, periodo por el motor temporal, capability por sustantivo de módulo, agregado por
«cuántos/suma/media»). La composición **emerge**: entidad + capability + periodo → consulta relacional acotada.
En `local-answers` se materializa para `cliente + (citas|tareas) + periodo` reconsultando la BD; si la entidad
no tiene relaciones en el periodo → **empty REAL** (nunca fallback global).

## 10. PendingIntent y slots
`conversation-pending.ts`. Esquema de slots **derivado del registry** (`ASSISTANT_ACTIONS.allowedFields`, con
auto-verificación en dev de que cada campo escrito está permitido). Cubre las 21 acciones, texto libre
(nombre/título/notas/zona) y `calendar.create` multi-slot (fecha+hora). Dos entradas: (a) `parseActionIntent`
devuelve un prepare incompleto → `buildPendingFromIntent`; (b) forma desiderativa («quiero cambiar…») →
`detectIncompleteAction`. `completePendingAction` combina turnos, permite **corrección** con marcador
(«mejor 320.000»), registra **provenance** por slot (`__prov`) y produce una intención completa → preview
(prepare→confirm→execute→verify). Cancela por «cancela/déjalo», por objetivo nuevo (el wrapper limpia) o por
expiración (6 min). Una **pregunta de capacidad** («¿puedo cambiar el precio?») no abre intención.

## 11. TemporalScope
`conversation-temporal.ts`. `{start,end,timezone:'Europe/Madrid',granularity,interpretation,sourceTurnId,
confidence}`. Absolutas (día/semana/mes/relative_days/range) y continuación por desplazamiento de la
granularidad previa. La continuidad temporal es de **lectura**: nunca secuestra una acción (`parseActionIntent`)
ni un comando de automatización — una fecha dentro de una acción alimenta slots, no una lectura temporal.

## 12. Freshness y grounding
El estado guarda solo ids/refs/periodo, **jamás el valor**. Cada continuación reconstruye y ejecuta una
consulta real (workspace-scoped). Tras una mutación, la siguiente lectura ve el valor nuevo (read-after-write).
Probado en E2E real (ver §17-18): leer → mutar fixture → releer mismo hilo → **valor nuevo** (sin arrastrar el
viejo) → otra pestaña → aislamiento de workspace → restaurar.

## 13. Cambios exactos por archivo
**Nuevos (P71):** `conversation-state.ts`, `conversation-references.ts`, `conversation-temporal.ts` (It1/It2),
`conversation-pending.ts` (It2, reescrito It3), `conversation-scope.ts` (It3).
**Modificados (It3, working tree):**
- `conversation-state.ts` (+38): `upgradeConversationState` + `StateLoadOutcome` + métrica de carga.
- `conversation-references.ts` (+7): demostrativo temporal excluido.
- `conversation-pending.ts` (reescrito): slots del registry, needle no destructivo, corrección + provenance,
  `buildPendingFromIntent`, cobertura 21 acciones + calendar multi-slot + texto libre.
- `conversation-scope.ts` (nuevo): `ConversationQueryScope` + `resolveQueryScope` + `isEntityTemporalComposite`.
- `local-answers.ts` (+82/-…): scoped readers con rango temporal; composición entidad+periodo + continuidad de
  scope en `handleTemporalFollowup`; bloque de acción crea pendingIntent al ser imperativo-incompleto.
**Tests nuevos:** `scripts/p71-it3-unit.mts`, `scripts/p71-it3-suite.mts` (+ `p71-conversation-suite.mts`,
`p71-realtime-e2e.mts`, `p71-conversation-probe.mts` de iteraciones previas).
**No tocados:** action registry, action/automation API, n8n, UI contract, RLS, Facturación, scheduler.

## 14. Decisiones de diseño
- Reutilizar `assistant_agent_memory` (JSON versionado) → sin migración de BD.
- Slots **derivados del registry** (una sola fuente de verdad de campos permitidos).
- Reutilizar los parsers de P70 (sin duplicar): precio/teléfono/fecha/hora/estado/etapa/prioridad.
- Resolución de nombre liberal + desambiguación en el resolver real (no recortar tokens en el parser).
- Continuidad temporal estrictamente de lectura (guardas `parseActionIntent` + verbos de comando).
- Composición solo para `cliente + (citas|tareas)` (las entidades naturalmente temporales del dominio).

## 15. Alternativas descartadas
- Migración de BD / tabla nueva de estado → innecesaria con JSON versionado.
- Reconstruir el nombre de la acción y re-parsear con `parseActionIntent` en la completación → frágil (el
  original desiderativo no siempre re-parsea); se optó por ensamblar el `AssistantActionIntent` directamente.
- Descartar todo estado v1 al bumpear versión → sustituido por `upgradeConversationState` (adaptador seguro).
- Un planner de readers totalmente genérico para todo scope → sobre-ingeniería; se materializó la composición
  donde aporta valor real (cliente+periodo) reusando los scoped readers.

## 16. Garantías P70 preservadas
prepare→confirm→execute→verify, idempotencia, optimistic lock, previews opt-in, scheduler, UI estructurada,
findings, RLS/aislamiento de workspace, Facturación aislada, contrato n8n, rate limits — todos verdes (§18).
Completar slots produce **preview**, jamás ejecución; un «sí» solo confirma con preview/pending válido.

## 17. Tests nuevos
- `p71-it3-unit.mts` (puro, sin BD): upgrade v1→v2 (6), scope composicional (3), pendingIntent del registry +
  needle no destructivo + texto libre + calendar multi-slot + capacidad + corrección (6).
- `p71-it3-suite.mts` (BD real, entidades dinámicas): composición entidad+periodo (scoped, empty real),
  resolución no destructiva, registry multiturno (calendar, texto libre) y **held-out** (frases nuevas:
  informal, sin tildes, coloquial, cambio de tema).
- `p71-realtime-e2e.mts` (sin mocks): freshness read→mutate→re-read→aislamiento→restore.

## 18. Resultados completos (ejecutados en esta iteración)
| Gate | Resultado |
|---|---|
| tsc / lint | verdes |
| P71 unit It3 | **15/15** |
| P71 suite composicional It3 (+held-out) | **10/10** |
| P71 suite conversacional It2 | **12/12** |
| P71 real-time E2E | **7/7** |
| Sonda multiturno | **10/10** (0 delegaciones a n8n) |
| Parser P70 | **48/48** |
| Benchmark P70 | **99.89%** · held-out **100%** · **gates 100%** (1 fallo NO-P71, ver §20) |
| P65 / P66 / P69 | 10/10 · 11/11 · 8/8 |
| UI contract / action catalog / automation catalog | 15/15 · 46/46 · 33/33 |
| Grants / mutation / red-team | 12/12 · 7/7 · 78/78 |
| build (`next build`) | **OK** (exit 0) |

## 19. Held-out utilizado
Bloque `D` de `p71-it3-suite.mts` (frases no usadas para ajustar el código): «y este mes q tiene?» (informal,
sujeto omitido), «cuantas operaciones tiene» (sin tildes), «oye súbele el precio a un piso» (coloquial,
incompleto), «déjalo, mejor dime qué inmuebles tengo» (cambio de tema). Held-out del benchmark P70: 250
escenarios sembrados (`p70-release-2026-07-15`), 100%.

## 20. Incidentes reales ya corregidos (durante esta iteración)
- **Temporal secuestraba acciones/automatización** (It2): «activa la agenda de la mañana», «agéndame una visita
  mañana» → resueltos con guardas `parseActionIntent` + verbos de comando. Action catalog 46/46.
- **Needle destructivo** (riesgo It2): un nombre que empieza por tipo perdía el primer token → resuelto
  (extractEntityNeedle no destructivo + resolver real).
- **Demostrativo temporal** («este mes» tratado como referencia) → excluido.
- **Fallback de texto libre demasiado ansioso** (usaba el mensaje de la entidad como el nombre) → solo aplica
  si el turno no llenó otro slot.
- **bm-0304** (`muéstrame la configuración de la auditoría`): el workspace demo tiene **2 reglas duplicadas**
  `data_quality_watch` (07-15, ambas deshabilitadas) creadas por ejecuciones previas del automation-catalog
  E2E; el handler **desambigua correctamente** («¿a cuál te refieres?»). **No es P71** (esa ruta no se toca).
  No se borraron filas de la BD compartida (bloqueado por política; correcto). Reproducible: limpiar duplicados
  o esperar cleanup restaura el 100%.

## 21. Limitaciones / riesgos conocidos
1. **Nombre explícito + periodo** («las citas de <NombreNoActivo> la semana que viene»): la composición solo
   opera con entidad ya en estado (pronombre/posesivo/elisión/entidad activa). Un nombre explícito nuevo
   necesitaría una búsqueda previa; hoy cae al flujo normal (no muestra datos globales falsos).
2. **Calendar desiderativo** («quiero agendar una cita»): el pending de calendar solo se abre desde la forma
   imperativa (`agéndame/crea una cita`, que aporta tipo/título). La desiderativa pura cae al flujo normal.
3. **Free-text con token verbal**: un nombre que contenga una palabra tipo verbo de acción (p. ej. «…Actualiza»)
   puede fallar el heurístico de «respuesta breve». Edge poco frecuente.
4. **Composición temporal** solo para entidades cliente (citas/tareas). Property/operation no son temporales.
5. n8n no consume temporalScope/pendingIntent (§6).

## 22. Puntos que Fable debe auditar especialmente
- ¿Alguna rama trata «mensaje concreto → respuesta concreta»? (buscar if/regex orientados a ejemplos).
- Composición: ¿`temporalScope` alguna vez borra `entityScope` o viceversa? ¿empty real sin fallback global?
- PendingIntent: ¿algún camino ejecuta sin preview? ¿un «sí» confirma sin pending/preview válido?
- Freshness: ¿alguna respuesta de datos usa `lastResults`/labels como valor en vez de reconsultar?
- Seguridad: fugas de UUID/JSON/secretos/stacks; RLS/aislamiento; Facturación aislada.
- Upgrade v1→v2: ¿algún estado inseguro pasa el validador? ¿fail-soft correcto?
- Anti-sobreajuste: nombres demo, frases del incidente, listas manuales que deberían venir del registry.

## 23. Comandos reproducibles
```
# tipos / lint
npx tsc --noEmit
npx eslint src/lib/agents/conversation-*.ts src/lib/agents/local-answers.ts
# unit + suites P71
npx tsx --tsconfig tsconfig.json scripts/p71-it3-unit.mts
npx tsx --tsconfig tsconfig.json scripts/p71-it3-suite.mts
npx tsx --tsconfig tsconfig.json scripts/p71-conversation-suite.mts
npx tsx --tsconfig tsconfig.json scripts/p71-realtime-e2e.mts
npx tsx --tsconfig tsconfig.json scripts/p71-conversation-probe.mts
# regresión P70
npx tsx --tsconfig tsconfig.json scripts/p70-parser-tests.mts
npx tsx --tsconfig tsconfig.json scripts/p70-run-benchmark.mts
npx tsx --tsconfig tsconfig.json scripts/p65-action-e2e.mjs
npx tsx --tsconfig tsconfig.json scripts/p66-chat-action-e2e.mts
npx tsx --tsconfig tsconfig.json scripts/p69-automation-chat-e2e.mts
npx tsx --tsconfig tsconfig.json scripts/p70-ui-contract-e2e.mts
npx tsx --tsconfig tsconfig.json scripts/p70-action-catalog-e2e.mts
npx tsx --tsconfig tsconfig.json scripts/p70-automation-catalog-e2e.mts
npx tsx --tsconfig tsconfig.json scripts/p70-grants-check.mjs
npx tsx --tsconfig tsconfig.json scripts/p70-mutation-check.mts
npx tsx --tsconfig tsconfig.json scripts/p70-red-team.mts
```

## 24. Commit final de la rama
`P71 compositional context closure` en `p71/conversation-state-core` (ver hash en el checkpoint del chat).
Historia: `553ed64` (P70 RC) → `4ee8f04` (It1 core) → `bee1797` (It2 pending+temporal) → It3 (este commit).

## 25. Confirmación de main y staging intactos
`main` y `origin/main` en `553ed64` (sin cambios). Sin push a main, sin merge, sin deploy. La única escritura a
datos compartidos son los **fixtures QA de los E2E**, creados y **restaurados/limpiados** en el propio test
(read-after-write + revert verificado). No se borraron filas preexistentes de la BD compartida.
