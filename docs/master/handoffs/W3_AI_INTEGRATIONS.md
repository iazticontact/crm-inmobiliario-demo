# Handoff W3 — AI, Agents & Integrations

Fecha: 2026-09-25

Rama: `w3/assistant-runtime-foundation`

Documento de arquitectura: `docs/master/04_AI_ARCHITECTURE.md`

## Publicado por W3

- Capability contracts: `src/lib/agents/planner/capability-contracts.ts`.
- Puente de memoria único: `src/lib/agents/planner/conversation-state-bridge.ts`.
- UI contract ampliado: `src/lib/assistant/ui-contract.ts`.
- Evals puras para contracts, memoria y UI en `src/lib/agents/__evals__`.

## W1 — contrato requerido

W3 no añadirá tablas telecom por inferencia. Para implementar permanencias, renovaciones, líneas y ownership comercial necesita un handoff versionado con:

- tablas/vistas canónicas y relaciones;
- claves, tipos y nulabilidad;
- campos temporales y timezone;
- vocabularios/estados permitidos;
- política RLS y resolución de workspace/membership;
- queries/readers publicados o RPCs permitidas;
- semántica de “permanencia”, “renovación”, “línea” y “comercial”.

Tras recibirlo, W3 añadirá capabilities y readers tipados sin SQL generado por LLM.

## W2 — contrato publicado

Consumir `AssistantUiPayload`; no derivar cards, botones o navegación desde texto. Campos nuevos opcionales:

- `entities` para enlaces a registros;
- `table` para listas y comparativas;
- `followUps` para sugerencias/refinamiento/acción;
- `navigationTarget` para destino de módulo/entidad.

Los botones de writes deben transportar únicamente IDs seguros de acción. No conservar ni reenviar tokens, workspace IDs, proposed changes autoritativos o payloads de ejecución. Mantener texto como fallback accesible.

W2 debe preparar la retirada del POST legacy a `/api/assistant/confirm` a favor del flujo `assistant_actions`/UI actions.

## W4 — revisión solicitada

Revisar antes de habilitar planner ON o writes nuevos:

1. Auth cookie-bound de `/api/assistant/v2` y binding `profiles.workspace_id`.
2. Aislamiento del action control plane con service role + `x-nowcrm-secret` + workspace explícito.
3. Que ningún input del modelo pueda elegir workspace, SQL, URL, tabla, permiso o ID interno.
4. Firma/expiración de action tokens, idempotencia, optimistic lock y read-after-write.
5. Eliminación/migración de `/api/assistant/confirm` y su catálogo alternativo.
6. Secret rotation P0 y configuración CI para typecheck, lint y evals puras.
7. Entorno de staging aislado para evals live, prompt injection y cross-workspace attacks.

## Decisiones que no deben bloquearse entre equipos

- W3 puede avanzar en planner, runtime, schemas, eval framework, memory y UI contracts sin modelo telecom.
- n8n no será la fuente única de semántica; se conserva para integraciones, webhooks, cron y workflows externos.
- No se activa Google Calendar realtime: el webhook actual está marcado como skeleton.
- No se retira código legacy sin métricas, consumidores migrados y rollback.
