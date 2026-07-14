# P70 — UI Runtime Map (Wave A COMPLETA)

## Flujo real
- **Route**: `POST /api/assistant/v2` → responde JSON `{ ok, answer, mode, toolCalls, referencedList,
  dataPreview, preparedAction, ui }`. El campo **`ui`** es el bloque ESTRUCTURADO del contrato
  compartido, validado en runtime (`validateAssistantUi`); si es inválido → `null` y la UI usa `answer`.
  La route acepta además **peticiones de botón** `{ uiAction: 'confirm'|'cancel', actionId, threadId }`
  → `executeUiAction` server-side (fila real por RLS, token re-firmado, plano P65). Un `[ui:*]`
  sintético NUNCA sigue hacia n8n: si la acción no se resuelve, respuesta segura y fin.
- **Motor**: `tryLocalAnswer` devuelve `LocalAnswer` con `ui?: AssistantUiPayload`. Emisores:
  `handleChatAction` (`action_preview`/`action_result`), `executeUiAction` (`action_result`/
  `action_status` con safeErrorCode), automatizaciones P69 (`automation_preview` opt-in /
  `automation_result` / `automation_status`; neutralización con `[AUTO:cancelled]`/`[AUTO:done]` vía
  `lastLiveAutoPreview`) y findings (`finding` con criterio separado del resumen).
- **Contrato**: `src/lib/assistant/ui-contract.ts` — ÚNICA definición para route y frontend
  (kinds, estados, acciones UI, validador). Prohibido duplicar enums o parsear texto para tarjetas.
- **Frontend** (`src/app/(saas)/assistant/page.tsx`): componentes puros `AssistantActionCard`,
  `AssistantAutomationCard`, `AssistantFindingsCard` bajo `AssistantUiCards`, renderizados desde
  `msg.metadata.ui` validado. Botones de acción → `sendUiAction` (solo `{uiAction, actionId}`);
  botones de automatización → quick-reply del flujo P69; Modificar → composer (flujo modify P66).
  El texto visible se sanea (`displayAssistantText`): sin `[AUTO:…]` ni `**`.
- **Persistencia**: `ui` en `assistant_messages.metadata.ui` (insert browser RLS); recuperación tras
  refresh vía `listThreadMessages`. Mensajes antiguos o `ui` inválido → solo texto (fallback garantizado).
- **Multitab**: BroadcastChannel `nowcrm-assistant-threads` con `{threadId}`; la pestaña receptora relee
  el hilo de BD con su sesión. `resolvedActionIds` oculta botones de previews ya resueltos; el doble
  confirm es idempotente (probado en `scripts/p70-ui-contract-e2e.mts`, 15/15).
- **Centro de findings**: `/assistant/findings` (client page, RLS select directo) — dashboard de conteos,
  filtros estado/severidad, criterio en claro. Linkado desde la card de findings del chat.
