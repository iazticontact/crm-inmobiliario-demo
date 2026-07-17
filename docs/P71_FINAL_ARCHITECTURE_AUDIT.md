# P71 — Auditoría final independiente de arquitectura

> Auditor: revisor independiente (Fable). Base auditada: `553ed64...59cf00e` en `p71/conversation-state-core`.
> Método: reconstrucción del flujo desde el código (no desde el handoff), lectura completa de los módulos
> P71 + route + turn/context policies + contrato n8n + harnesses, y verificación en vivo.

## 1. Flujo real de un turno (reconstruido del código)

`POST /api/assistant/v2` (route.ts):
1. Supabase (sesión del usuario, RLS) → auth → workspace del perfil (nunca del body).
2. Guardas: crisis → respuesta segura; rate-limit; input guard. `uiAction` (botón) → `executeUiAction`
   (server resuelve fila/token; JAMÁS sigue al cerebro) → fin.
3. `loadConversationState(threadId, userId)` → validación runtime (v2) / upgrade (v1) / vacío.
4. `tryLocalAnswer(message, {recentContext, lastResults, state, turnId})`:
   a. **pendingIntent** activo → cancelar (`detectExplicitCancel`) o completar (`completePendingAction`,
      slots del registry) → si completa: `handleChatAction` → plano P65 prepare → **preview** (nunca ejecuta);
      si sigue faltando → pregunta SOLO el slot ausente. Un turno con acción propia completa u objetivo nuevo
      NO se fuerza como complemento (cae al flujo normal; el wrapper limpia el pending).
   b. **handleTemporalFollowup** → si hay periodo (absoluto o shift del previo) y módulo temporal heredable:
      reconsulta agenda; si hay entidad referida/activa/última-relacional → consulta RELACIONAL acotada
      (cliente+periodo). Guardas: nunca sobre acciones (`parseActionIntent`) ni comandos de automatización.
   c. **handleContextualFollowup** → referencia estructural (pronombre/posesivo/demostrativo/ordinal/extremo/
      «otra vez»/elisión 3ª persona) → ancla del estado → RECONSULTA por id (client 360/ops/tasks/events/
      properties o detalle por tabla). Ambiguo → pregunta. Verbos mutadores → no corre.
   d. **decideTurn (P50)** → meta/conceptual/social/onboarding NO leen. Confirmación de vacío P61.
   e. **Acciones**: `parseActionIntent` completa → `handleChatAction` (P65/P66 prepare/confirm/cancel/modify/
      status). Incompleta imperativa → `buildPendingFromIntent` (registry) → pending+pregunta. Desiderativa →
      `detectIncompleteAction`. Preguntas de capacidad NO abren intención.
   f. Automatizaciones P69/P70 (preview opt-in, confirmación con marcador vivo, gestión), ventas P58,
      agenda P61/P63 (ahora con rango temporal opcional), resumen P64, findings P67, enrutado por entidad.
   g. Política de contexto P48: `confirm_prior` → **reconsulta** (P71 reinterpreta en el call-site);
      `ask_clarify` → lectura fresca si el mensaje nombra entidad; `keep_prior_on_error` → conserva el
      resultado previo con prefacio honesto SOLO si la reconsulta falló.
5. Local resuelto → persiste `applyStateUpdate(state, stateUpdate)` (fail-soft) → respuesta + UI validada.
6. No resuelto → n8n con `activeEntity` + `recentMessages` + turn policy firmado; a la vuelta se persisten
   entidad/módulo resueltos en el MISMO ConversationState. n8n caído → error honesto (sin fallback legacy).

### Por ruta (estado→capability→readers→persistencia→freshness→ambigüedad→fallo)
| Ruta | Estado que recibe | Decide | Lee | Persiste | Freshness |
|---|---|---|---|---|---|
| social/onboarding/explicación | state (no lo usa para leer) | decideTurn | NADA | lastAssistantResult=explanation | n/a |
| lectura local | state completo | intent+context | readers RLS | módulo+entidades+lastDataQuery | consulta en el turno |
| referencia | state.activeEntities/lastDataQuery | ancla→id | RECONSULTA por id | entidad+lastDataQuery | siempre reconsulta |
| temporal | state.temporalScope(+entidad) | shift/absoluto | agenda/relacional acotada | temporalScope+lastDataQuery | siempre reconsulta |
| acción incompleta | state.pendingIntent | registry slots | (solo candidatos al preparar) | pendingIntentUpdate | preview desde BD viva |
| acción completa | — | parseActionIntent | plano P65 | clearPendingIntent | prepare valida contra fila real |
| confirmación | pending action en BD | fila+token server | execute+verify | — | read-after-write verificado |
| automatización | marcador [AUTO:] del hilo | detectAutomationType | endpoint P68 | — | recalcula next_run |
| n8n | activeEntity (NO temporal/pending) | prompt del workflow | tools con turn policy | entidad+módulo v. route | tools releen |
| fallo parcial | prior (lastResults) | context-policy | — | — | «keep prior» SOLO con prefacio honesto |

## 2. Verificaciones exigidas
- **local-first y n8n comparten estado**: SÍ en escritura (la route persiste ambos caminos sobre el mismo
  registro). PARCIAL en lectura para n8n (ver H4).
- **Ninguna ruta dominante ciega al estado**: local-first (dominante) lee y escribe. ✓
- **pendingIntent no secuestra**: turno con acción completa u objetivo nuevo escapa; wrapper limpia. ✓
- **temporalScope no secuestra acciones**: guarda `parseActionIntent` + verbos de comando; una fecha dentro
  de una acción alimenta slots (calendar create/reschedule), verificado con action catalog 46/46. ✓
- **entityScope+temporalScope componen**: sí para cliente+citas/tareas; ver H2/H5 para el resto.
- **lastResults no es fuente de verdad**: solo aparece en `keep_prior_on_error` tras fallo de reconsulta y
  con prefacio explícito. `confirm_prior` ya NO responde de caché (P71). ✓ con matiz (H6).
- **La respuesta se genera tras consultar**: todos los readers consultan en el turno. ✓
- **Fallos no cambian entidad/módulo**: fail() conserva entidad; anti-contradicción explícita. ✓

## 3. Hallazgos

### H1 (P1) — Elisión puede resolver a la entidad ACTIVA aunque el mensaje nombre OTRA
`handleContextualFollowup`/scope: «¿qué operaciones tiene María?» con Roberto activo → el gate de elisión
(«tiene» sin «tengo/tienes») ancla al cliente ACTIVO y responde con las operaciones de Roberto (etiquetadas,
no silente, pero objetivo mal resuelto). **Causa**: la elisión no comprueba si el mensaje trae un candidato
explícito distinto. **Corrección (F3.1)**: detectar span de nombre propio; si existe, resolver contra
candidatos reales del workspace (1→scoped, N→aclarar, 0→«no encuentro», nunca la activa por accidente).

### H2 (P1) — Entidad explícita nueva + periodo NO compone → resultado global
«¿qué citas tiene María la semana que viene?» sin María en estado → agenda GLOBAL del periodo. Viola el
gate «una referencia de entidad no puede devolver resultados globales». **Corrección (F3.1)**: mismo resolver
de candidatos en el camino temporal.

### H3 (P2) — Partículas de asentimiento pueden tratarse como valor de slot
Con pendingIntent abierto, «sí, confirma» puede capturarse como needle de entidad (termina en desambiguación
o «no encuentro», sin mutación errónea, pero es ruido). **Corrección (F3.4)**: clase general de partículas
discursivas (asentimiento/negación/cortesía) excluida de needles y de slot-filler.

### H4 (P2) — Split-brain parcial con n8n
El contrato (`n8n-assistant-client.ts`) envía `activeEntity`+`recentMessages`+turn policy, pero NO el
ConversationState reducido (temporalScope/pendingIntent/lastDataQuery), y solo recibe `activeEntityUpdate`.
Impacto real BAJO: local-first intercepta las continuaciones (referencias/temporal/pending) antes de n8n, y
n8n YA recibe la entidad activa. Pero un turno complejo que caiga a n8n con periodo activo pierde ese
contexto. **Corrección (F3.5)**: ampliar el body con `conversationState` reducido y validado (ids/labels/
periodo, sin datos de negocio) — backward-compatible; consumo en el prompt del workflow con el protocolo
backup→GET→diff→patch→verify→drift.

### H5 (P2) — Composición temporal limitada a calendar/tasks
Operaciones (expected_close_date) y trámites (due_date) tienen fechas reales y no componen periodo.
**Corrección (F3.2)**: metadata temporal por capability (campo fecha, si admite continuidad) y filtro de
rango en el reader — derivado de metadata, no de frases.

### H6 (P3) — `context-policy.ts` con comentario legacy y conteo de origen frontend
El comentario dice «confirmamos SIN re-consultar», pero P71 reinterpreta `confirm_prior` como reconsulta en
el call-site (comportamiento correcto; comentario desactualizado). `keep_prior_on_error` usa el CONTEO de
`lastResults` (enviado por el navegador) en su texto — siempre tras fallo fresco y con prefacio honesto;
no es autorización ni sustituye datos. Aceptado y documentado; actualizar comentario.

### H7 (P3) — Relación cliente→trámites sin reader scoped
«¿y sus trámites?» → ficha del cliente (degradación visible y segura, no global), porque no existe
`readClientCases`. Aceptable; documentado como límite del modelo de readers.

### H8 (P2) — Residuos QA de automation rules por proceso matado
`p70-automation-catalog-e2e.mts` limpia en `finally` con marca temporal `testStartIso`; un proceso MATADO
(timeout kill) no ejecuta `finally` → residuos (2 `data_quality_watch` del 07-15, deshabilitadas) →
bm-0304 en 99.89%. **Corrección (F3.6)**: sweep de residuos al INICIO del E2E (reglas deshabilitadas de los
tipos bajo test, con sus runs), assert permanente de no-duplicados, y re-benchmark a 100%.

### H9 (P3) — Gate de mutation citado como 7/7
El gate oficial P70 es 7 mutaciones en código + 2 dedicadas («quitar verify» por inyección+build;
«GRANT» por revoke/regrant dentro de grants-check 12/12). El checkpoint It3 citó solo el 7/7 del harness.
**Corrección**: ejecutar/citar las 9 explícitamente en la matriz final.

## 4. Duplicaciones / incoherencias / riesgos estructurales
- No hay handlers duplicados nuevos: la composición reutiliza los scoped readers existentes.
- `conversation-scope.ts` (planner fino) está infra-conectado: `resolveQueryScope` se usa para diagnóstico y
  suites; `local-answers` materializa la composición directamente. Aceptable como capa de decisión
  documentada; unificar en una fase futura si crece (riesgo de doble fuente de interpretación si divergen).
- Crecimiento del estado acotado (MAX_ENTITIES/MAX_REFERENTS/25 refs), TTL 24 h, pending 6 min. ✓
- Sin `any` nuevos ni casts inseguros en módulos P71; `as never` puntual en scripts de test.

## 5. Decisiones recomendadas (ejecutadas en esta auditoría)
1. F3.1 resolver de entidad explícita por candidatos (H1+H2) — bloqueante.
2. F3.4 clase de partículas discursivas (H3).
3. F3.2 metadata temporal multimódulo (H5).
4. F3.5 contrato n8n ampliado (H4) — code-side ya; workflow con protocolo controlado.
5. F3.6 sweep de residuos + regresión permanente + benchmark 100% (H8).
6. Citar mutation 9/9 correctamente (H9). Comentario H6 actualizado.
