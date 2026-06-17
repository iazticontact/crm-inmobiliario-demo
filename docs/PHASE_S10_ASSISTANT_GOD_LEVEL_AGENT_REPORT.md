# FASE S10 — Assistant agente premium: planner, capability registry, eval harness

> **Fecha:** 2026-06-17 · **Base:** `2b4c59a` (S9.1) → este commit ·
> **Alcance:** subir la CALIDAD del agente (planificación, conciencia de
> capacidades, formato por intención, personalidad) y blindarlo con un harness de
> evals. Sin tocar executor/confirm, n8n, schema, RLS ni `service_role` frontend.

---

## 1. Objetivo
No "más tools", sino un asistente que se comporte como un empleado IA excelente:
entiende intención, planifica qué consultar, usa la tool correcta, mantiene
contexto, responde natural y honesto, y no se rompe (evals).

## 2. Estado inicial (tras S8/S9/S9.1)
Cobertura CRM amplia (clientes+metadata/DNI, operaciones/expedientes/tareas/
calendario/actividad/propiedades, documentos metadata), `result.data` al modelo,
cliente activo, prompt anti-"no tengo acceso". Faltaba: una capa explícita de
planificación/capacidades y una red de regresión.

## 3. Arquitectura del agente (cómo es de verdad)
OpenAI Responses API con **bucle de tools** (`runNowLabsAgent`, MAX_ROUNDS=4),
~32 tools, `preRoute` determinista para lecturas inequívocas, `compactToolData`
(la data estructurada llega al modelo), `buildFormatPrompt` (formateo del atajo),
contexto de conversación (cliente activo, últimos resultados) inyectado por
`buildSystemPrompt`. **El planner es el propio LLM** — no un router if/else.

## 4. Planner (realizado a nivel de prompt, no como bot)
Nuevo bloque "CÓMO PLANIFICAS" inyectado en el system prompt: el agente decide en
silencio intención (dato real / campo exacto / ficha / acción / ayuda producto /
documento / módulo no soportado), entidad, si hay entidad activa, qué tool y si
requiere confirmación. **No** se añadió un clasificador en código (sería el
if/else prohibido); el `preRoute` existente cubre los atajos deterministas seguros.

## 5. Capability registry (nuevo — única fuente de verdad)
`src/lib/agents/assistant-capabilities.ts`: `ASSISTANT_CAPABILITIES` (active /
partial / future) + `buildCapabilityBlock()`, inyectado en el system prompt.
- **Active:** clientes (incl. DNI/metadata), operaciones, expedientes, tareas,
  calendario, actividad, propiedades, acciones con confirmación.
- **Partial:** documentos (listado/metadata, sin contenido).
- **Future:** contenido PDF/RAG, facturación real, WhatsApp/Inbox, Google sync.
Beneficio: el asistente sabe exactamente qué ofrecer y qué declarar como futuro,
sin sonar inútil y sin prometer lo que no existe. Single source of truth → no drift.

## 6. Active entity memory
Cliente activo robusto (S9): la página captura `referencedClientId` al resolver un
cliente único y lo reenvía; el agente lo inyecta y el planner lo usa para "su/este/
él". **Pendiente (roadmap, NO implementado para no tocar página+v2+agente):**
`activeOpportunity/activeServiceCase/activeTask/activeEvent/activeProperty` para
pronombres sobre entidades no-cliente ("esta operación"). Hoy "mueve esta
operación" se resuelve por nombre vía `deterministic-db-actions`.

## 7. Response quality engine (formato por intención)
Bloque "FORMATO POR INTENCIÓN" en el prompt: campo exacto → 1 frase; ficha →
secciones (Identificación·Contacto·Comercial·Operaciones·Expedientes·Tareas·
Calendario·Actividad·Documentos); resumen ejecutivo → 1-3 frases con criterio;
ambigüedad → candidatos reales; limitación → honesta+útil; acción → confirmación.
Varía aperturas/cierres; nunca UUID/score.

## 8. Personalidad empleado IA
Reforzada en S9.1 + S10: empleado con criterio comercial, varía respuestas, avisa
de riesgos reales (tarea vencida, dato fiscal ausente para facturar) SOLO si el
dato falta de verdad; nunca "estoy operativo"/"no tengo acceso"/"como asistente
IA"; score solo interno.

## 9. Tool suite audit final
Cobertura verificada contra el cuestionario de dominios (clientes/operaciones/
expedientes/tareas/calendario/actividad/propiedades/documentos). **Cubierto** por
las tools existentes + las aggregate (`get_client_context`, list_*). 
- **Añadidas (S8–S9.1, contexto):** compactToolData, get_client_context (360),
  get_client_field_exact, get_latest_client, list_client_documents.
- **S10:** capability registry (no es tool, es conocimiento del agente).
- **NO añadidas y por qué:** get_opportunity_detail / list_stale_opportunities /
  list_clients_missing_contact / match_properties_to_client, etc. — no aportan
  cobertura nueva (las list_* ya devuelven filas completas y get_client_context
  agrega por cliente). Se documentan como roadmap; añadir 30 tools duplicadas
  degradaría la elección del modelo (regla del usuario).

## 10. Documentos / RAG
Sin cambios de infra: bucket `client-files` + tabla `documents` (metadata), sin
extracción/RAG. `list_client_documents` lista metadata; el contenido es fase
futura. Plan en `ASSISTANT_DOCUMENTS_STORAGE_RAG_PLAN.md`.

## 11. Eval harness / regresión
Nuevo `docs/evals/assistant-crm-evals.json`: corpus estructurado (id, category,
user_prompt, expected_intent, expected_tools, expected_behavior, forbidden,
requires_active_entity) con `global_forbidden` (no inventar, no UUID/score, no
"no tengo acceso", no fingir PDF, no escribir sin confirmar) y scoring. Cubre el
bug real, campos/metadata, pronombres, ambigüedad, todas las entidades,
documentos (metadata y contenido), módulos futuros, personalidad y acciones.
Complementa los ~110 casos markdown (`ASSISTANT_CRM_INTELLIGENCE_EVALS.md`) →
corpus combinado > 150. Sin dependencias nuevas; ejecutable manualmente en navegador.

## 12. Trace / debug
Ya existe traza segura sin PII: `/api/assistant/v2` logea `InvokeLog`
(workspaceResolved, toolCalls, source, durationMs, errorCode) — sin cuerpo de
mensaje ni secretos; el agente devuelve `toolCalls`/`debugSource`; el panel
debug del asistente (gated `NEXT_PUBLIC_SHOW_DEBUG_PANEL`, off en prod) muestra
diagnósticos. No se añadió logging nuevo para no arriesgar PII en producción.

## 13. Seguridad / privacidad
RLS + `workspace_id` en cada query; metadata solo de la entidad resuelta; sin
query global; data capada (compactToolData); sin `service_role` frontend; UUID/
workspace_id/score nunca al usuario; active entity por hilo/usuario; **sin PII
real en docs/evals** (placeholders). El capability block no expone nada sensible.

## 14. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅
(`✓ Compiled successfully`, 46 rutas).

## 15. Tests
Tools deterministas + capability block estáticos (build verde). Smoke del agente
OpenAI = navegador (Oier), con el corpus de evals.

## 16. Qué NO se tocó
Executor/confirm · acciones confirmadas · n8n · WhatsApp/Meta · Google · Storage
(solo metadata) · facturación · schema/migraciones · RLS · deps · `git reset` ·
performance S2–S7.

## 17. Próximos pasos
- Active entity para operación/expediente/tarea (página+v2+agente) — diseño listo.
- Tools de detalle por entidad solo si una pregunta real lo necesita.
- RAG de documentos (plan documentado).
- Ejecutar el corpus de evals en staging y registrar PASA/FALLA.

## Veredicto
**S10 PARCIAL SEGURO — agente más inteligente, honesto y blindado.** Planner
(prompt) + capability registry (código, única fuente de verdad) + formato por
intención + personalidad + harness de evals. Sin tocar lógica de escritura ni
romper rendimiento. Falta el smoke navegador (Oier) para firmar "god-level".
