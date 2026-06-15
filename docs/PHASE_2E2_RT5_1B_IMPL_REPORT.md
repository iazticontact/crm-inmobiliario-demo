# Fase 2E-2 RT5.1b-IMPL — Cableado conversacional del asistente (informe)

**Fecha:** 2026-06-15 · **Base:** `32dccec` · **Política:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)
Sigue a [PHASE_2E2_RT5_1B_ASSISTANT_END_TO_END_REPORT.md](PHASE_2E2_RT5_1B_ASSISTANT_END_TO_END_REPORT.md)

## 1. Objetivo
Que el chat **prepare y confirme** acciones CRM reales end-to-end, sin tocar el
agente OpenAI (2018 l) ni convertir nada en if/else gigante.

## 2. Acciones conversacionales implementadas (end-to-end)
- **`create_operation`** ("crea/abre/registra una operación para X", "operación de
  venta/alquiler/compra", "por 300000", "probabilidad 40%").
- **`create_service_case`** ("abre/crea un expediente/caso para X", "expediente de
  documentación", "expediente urgente").

Flujo completo: usuario → `/api/assistant/v2` (auth+RLS) → agente OpenAI (sin
acción) → **fallback determinista** detecta y prepara `PreparedActionDraft` →
v2 devuelve `preparedAction` → page lo mapea a la unión `PreparedAction` →
**confirm-card** ("Crear operación"/"Crear expediente" con cliente y campos) →
Confirmar → `/api/assistant/confirm` (executor RT5.1, auth+RLS) escribe + activity
→ mensaje de éxito. Cancelar no escribe.

## 3. Acciones diferidas (RT5.1b-2)
- `move_operation_stage`, `update_task`, `update_service_case`,
  `update_calendar_event`: requieren **resolver el ID real** de la entidad, que
  vive en el agente OpenAI (tools de lectura). El **executor ya las soporta**
  (RT5.1); falta emitir el `preparedAction` (añadir tools al agente o resolución
  por nombre). Diferido por riesgo en el agente de 2018 l (FASE P: no forzar).

## 4. Resolución de cliente / ambigüedad
El fallback extrae `clientName` (texto, conservador: solo nombres con mayúscula,
nunca inventa). La **resolución canónica** ocurre en `/api/assistant/confirm`
(`resolveActionClient`): por nombre → 1 match = canónico; 0 = `client_not_found`;
≥2 = `ambiguous_client` con `candidates`. La UI ya muestra candidatos y pide
elegir (flujo existente reutilizado). Si falta cliente → la card pide el cliente
(`missingFields: ['cliente']`) y el guard de confirmación lo bloquea.

## 5. Confirm-card UI
Nuevas cards "Crear operación" / "Crear expediente": título de acción, **cliente**,
entidad (título), campos (valor/probabilidad para operación; prioridad para
expediente), botones **Confirmar/Cancelar**. Sin UUIDs, sin JSON bruto. No tienen
botón "Editar" (se confirman/cancelan; el cliente se ajusta reformulando).

## 6. Executor compatibility
Sin reescribir el executor: el page construye `confirmPayload` con
`type/clientName/title/stage/value/probability` (operación) y
`type/clientName/title/caseType/status/priority` (expediente), que el executor
RT5.1 ya valida. No rompe booking/task/invoice/report (ramas intactas).

## 7. Demo mode
Nuevo guard al inicio de `confirmPreparedAction`: si **no** es modo real →
"Modo demo: acción no guardada", descarta la card y **no escribe** en Supabase.
Aplica también a las acciones antiguas (mejora consistente).

## 8. Guardrails anti-invención
- El fallback nunca inventa cliente (extracción conservadora) ni id; si falta
  cliente, lo pide.
- La resolución real es server-side (RLS); ambigüedad → candidatos reales.
- Sin fechas/valores inventados (value/probability solo si aparecen).
- Sin mocks en real; sin escritura sin confirmación.

## 9. Seguridad
Sin `service_role` en frontend (el confirm usa sesión cookie-bound + RLS; el
agente "sin service_role"). Sin tocar env/Storage/n8n/schema/migraciones.

## 10. Validaciones
| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ |
| `npm run build` | ✅ (46 rutas) |

## 11. Smoke test (pendiente Oier — `npm run dev -- --webpack`)
Real (copilot, login owner):
1. "crea una operación de venta para [cliente real]" → card "Crear operación".
2. Cancelar → no escribe.
3. Repetir → Confirmar → operación creada + actividad + mensaje.
4. "abre un expediente para [cliente real]" → Confirmar → expediente creado.
5. Cliente inexistente → "No encuentro ese cliente" / pide cliente.
6. Cliente ambiguo → candidatos.
7. Sin UUIDs, sin datos inventados, sin errores RLS.
Demo: preparar acción → Confirmar → "Modo demo: acción no guardada" (no escribe).

## 12. Archivos tocados
- `src/lib/agents/nowlabs-main-agent.ts` — `PreparedActionDraft` (+2 tipos/campos).
- `src/lib/agents/deterministic-fallback.ts` — detección create_operation/create_service_case.
- `src/app/(saas)/assistant/page.tsx` — unión `PreparedAction`, mapeo v2, demo guard,
  `confirmPreparedAction` (payload+finalización), confirm-cards.

## 13. Riesgos / siguiente fase
- **RT5.1b-2:** move/update conversacional (executor listo; falta emitir desde el
  agente). 
- Smoke navegador pendiente.
- Siguiente: RT5.1b-2 o 2E-3 (Storage).
