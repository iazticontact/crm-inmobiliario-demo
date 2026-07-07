# P53 — Mapa completo del circuito del Asistente (con respuestas)

> Complementa `ASSISTANT_ARCHITECTURE.md` respondiendo las preguntas de auditoría.

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide el tipo de turno? | `decideTurn` (`assistant-turn.ts`) — decisión ÚNICA por turno, prioridad meta > guía de producto > pragmática > datos. |
| ¿Quién decide leer datos? | Solo `decideTurn` (`shouldReadData`). Ningún reader se ejecuta antes de la decisión. |
| ¿Quién decide llamar a n8n? | `local-answers.tryLocalAnswer`: si maneja el turno, n8n NI SE LLAMA. Solo lo no cubierto (lecturas complejas/escrituras/ambiguo) va a n8n con token firmado. |
| ¿Quién bloquea tools? | Doble capa: (1) `allowedToolsForTurn` en la app; (2) `/api/agent/tool` verifica el Turn Policy Token — strict ACTIVO en staging (verificado 7/7). |
| ¿Quién genera respuesta? | Turnos de guía → `crm-module-catalog` (catálogo, sin inventar). Meta/recovery → generadores de `assistant-turn`. Datos → formateadores de `local-answers` (sin UUID/SQL). n8n → su agente, bajo contrato. |
| ¿Quién mantiene contexto? | Frontend reenvía `lastResults`; `context-policy` decide (confirmar/conservar/aclarar); `priorModule` del hilo alimenta la guía («no entiendo»). |
| ¿Dónde puede fallar? | Lecturas complejas dependen de n8n (si cae → error honesto). Ambiguo va al cerebro general. |
| ¿Dónde puede haber bypass? | Legacy V1: bloqueado por `ALLOW_LEGACY_ASSISTANT` (default off). Tool endpoint: strict activo → sin token = 403. n8n: no puede leer sin token válido. `from('invoices')` en agents = 0. |
| ¿Dónde puede arrastrarse mal el contexto? | Mitigado: módulo del mensaje GANA al del hilo; «no entiendo» hereda módulo (no entidad de datos); corrección entra en recovery (no repite). Evals `assistant-decision-router` D lo protegen. |

## Frontend
- Chat + quick actions → misma ruta `/api/assistant/v2`. Payload: message, threadId, lastResults,
  lastReferencedClient*. Sin rutas antiguas activas.

## n8n (verificado en vivo P51C)
- Workflow `[CRM Inmobiliario] Agent V2 — Read Only` (24 nodos, active): `Webhook In` (gateado por
  `N8N_ASSISTANT_V2_SECRET`) → `Check secret` → `Normalize input` (expone `turnPolicyToken`) → `CRM Agent`
  (contrato P51 en system prompt) → 15 `toolCode` con header `x-nowcrm-turn-policy` → `/api/agent/tool`.

## Tool endpoint
- Strict ACTIVO (`AGENT_TOOLS_REQUIRE_POLICY=true`): sin token 403 `turn_policy_required`; inválido/expirado
  403 `invalid_turn_policy`; dominio no permitido 403 `tool_not_allowed_for_turn`; facturación 403
  `tool_forbidden_for_assistant` (siempre). Con token válido + permitida → 200 datos frescos
  (`force-dynamic`, sin caché).
