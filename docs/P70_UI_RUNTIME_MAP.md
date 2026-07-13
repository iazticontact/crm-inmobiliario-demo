# P70 — UI Runtime Map (Wave A)

## Flujo real
- **Route**: `POST /api/assistant/v2` → responde JSON `{ ok, answer, mode, toolCalls, referencedList,
  dataPreview, preparedAction, ui }`. El campo **`ui`** (P70) es el bloque ESTRUCTURADO del contrato
  compartido, validado en runtime (`validateAssistantUi`); si es inválido → `null` y la UI usa `answer`.
- **Motor**: `tryLocalAnswer` devuelve `LocalAnswer` extendido con `ui?: AssistantUiPayload`.
  Emisores actuales: `handleChatAction` → `action_preview` (prepare) y `action_result` (confirm verificado),
  con `actionId`, campos actual→propuesto, expiración y `allowedUiActions` (confirm/cancel/modify).
- **Contrato**: `src/lib/assistant/ui-contract.ts` — ÚNICA definición para route y frontend
  (kinds, estados, acciones UI, validador). Prohibido duplicar enums o parsear texto para tarjetas.
- **Frontend**: `src/app/(saas)/assistant/page.tsx` renderiza hoy solo `answer` (texto). **Pendiente**:
  leer `ui` de la respuesta y renderizar `AssistantActionCard` (+ automation/finding cards), con botones
  que envíen `actionId` a la route (nunca reconstruir la acción del texto).

## Cambios mínimos pendientes (frontend)
1. Tipar la respuesta del fetch con `AssistantUiPayload`.
2. `AssistantActionCard` (estados prepared/completed/…; botones Confirmar/Cancelar/Modificar → nueva
   operación en la route que reciba `{uiAction, actionId}` y reuse `handleChatAction`-equivalente server-side).
3. Persistir `ui` junto al mensaje en `assistant_messages` para recuperación tras refresh.
4. Cards de automatización y findings (mismo patrón; emisores backend pendientes de poblar `ui`).
