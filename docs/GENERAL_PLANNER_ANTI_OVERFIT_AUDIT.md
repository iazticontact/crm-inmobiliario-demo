# General Planner — Auditoría anti-hardcode / anti-overfit (FASE 5)

> Diff auditado: `ad3c06e..HEAD` (rama `general-semantic-planner`), 2026-07-20.
> Búsqueda: comparaciones de texto de mensaje, `includes()/startsWith()` sobre mensajes humanos, regex
> semánticas, nombres demo, frases de incidentes, mapas de respuestas enlatadas, sinónimos crecientes.

## Resultado: 0 hallazgos de overfit directo en el código NUEVO de la rama

### Clasificación de todo lo encontrado

| Hallazgo | Fichero | Clase | Justificación |
|---|---|---|---|
| `.includes()` sobre ALLOWLISTS (capabilities, módulos, campos, operaciones) | planner/* (executor, ontology, query-layer, contract) | GENERAL MECHANISM | Operan sobre registros/ids, jamás sobre el mensaje humano |
| `INJECTION_RE`, regex UUID | plan-contract, crm-query-layer | SAFE (defensivo) | Bloquean valores hostiles; seguridad, no semántica |
| Regex deíctica (pronombres es-ES) + `PRONOUN_RE` | capability-executor:66, entity-resolver | GENERAL MECHANISM | CLASE GRAMATICAL CERRADA (deixis del español), aplicada al `entityRef` que emite el MODELO, no al mensaje crudo. No es una lista de sinónimos creciente: los pronombres del español no crecen con incidentes |
| Fuzzy containment de labels | entity-resolver:72 | GENERAL MECHANISM | Matching de candidatos VIVOS autorizados, con umbral; no frases |
| `/aggregate/.test(e.capability)` | consistency-checker:26 | SAFE STRUCTURED | Sobre id de capability, no lenguaje |
| Regex de proyección de campos (`_id$`, `workspace`, `metadata`) | response-synthesizer:45 | SAFE (privacidad) | Filtra columnas internas de la evidencia |
| Nombres demo (San Pedro 66, David Iglesias, Roberto Díaz…) | `assistant-action-intent.ts`, `local-answers.ts`, `scripts/p6x-p70*`, `__evals__/*`, `demo/*` | LEGACY (P71, preexistente en main) + TEST FIXTURE | Nada de esto es código nuevo de la rama; es el árbol P71 vigente (rollback) y sus tests. Los scripts `planner-*.mts` descubren nombres DINÁMICAMENTE de QA |
| Árbol regex P71 completo (`tryLocalAnswer`, `parseActionIntent`) | agentes legacy | LEGACY / FRAGILE SEMANTIC HEURISTIC (conocida) | Es exactamente la arquitectura que el planner sustituye. NO se borra: es el sistema vigente bajo OFF y el rollback. Bajo ON solo es alcanzable por fail-soft (ver PROTOCOL_FAST_PATHS) |

### Invariantes que protegen contra overfit futuro

1. Los tests del planner son de PROPIEDAD (speech-act estable, capability compatible, cardinalidad),
   con fraseos generados y datos QA dinámicos — no transcripciones de incidentes.
2. El prompt del planner enuncia PRINCIPIOS (acto vs objetivo, selección, foco) sin frases disparadoras.
3. Los fixes de esta sesión son de mecanismo (proyección sin ids, replan acotado, ids canónicos), no de
   frase: ninguno menciona texto de usuario.
4. El P2 abierto (relation+aggregate de entidad nombrada → clients.search) se deja SIN parchear a
   propósito: es clase LIMITACIÓN DE MODELO y su palanca es el benchmark de modelos (FASE 45-48).
