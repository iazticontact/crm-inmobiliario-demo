# P60 — Mapa runtime real del Asistente

## Flujo por turno (lo que realmente ocurre)
```
UI chat (app/(saas)/assistant) ─POST /api/assistant/v2─► route
  payload: { message, threadId, lastResults, lastReferencedClient* }  (mismo endpoint para chat y quick actions)
    │
    ├─ resolveAssistantProvider (default n8n; legacy solo si ALLOW_LEGACY_ASSISTANT)
    │
    └─ tryLocalAnswer(supabase RLS, workspace de sesión, message, {recentContext, lastResults})
         1. decideTurn(message, {priorEntity, priorModule, hasLastResult})  ← CONTRATO ÚNICO
              orden: META > guía de producto (P53) > RESUMEN/LEARNING (P60) > lectura fresca (P56)
                     > pragmática (P49) > datos > ambiguo
         2. Gate VENTAS transversal (P58): turnos data/ambiguo + parseSalesIntent → handleSales (Cartera+Ops)
         3. switch(turnType): social/help/capability/how/onboarding/module_explanation/navigation/
              confused/hypothetical/meta/correction/complaint/disagreement  → SIN leer
            ambiguous(p60:ambiguous-summary) → aclara conceptual vs datos ; ambiguous → n8n
            data_read/data_followup → enrutado por entidad (clients/properties/operations/…)
         → si handled:true  ⇒ n8n NI SE LLAMA (local determinista, con traza [assistant.turn])
    │
    └─ si tryLocalAnswer NO maneja ⇒ n8n (bajo contrato: firma turnPolicyToken + allowedTools; endpoint
         /api/agent/tool con strict AGENT_TOOLS_REQUIRE_POLICY=true rechaza sin token / fuera de dominio /
         facturas). n8n NO puede leer sin token válido ni tocar facturas.
```

## Respuestas a la auditoría
- **¿Quién decide el turno?** `decideTurn` (contrato único). No hay routers paralelos.
- **¿Quién lee datos?** Solo el enrutado por entidad / `handleSales` / `handleProperties`, y solo si el
  contrato lo permite (`shouldReadData`). Learning/onboarding/resumen conceptual → NO leen.
- **¿Cuándo n8n?** Solo si local NO maneja (lecturas complejas/escrituras/ambiguo genérico). Nunca en
  onboarding, guía, resumen conceptual, ventas, correcciones ni Facturación.
- **¿n8n puede alucinar por encima del router?** No para las clases cubiertas: local responde
  `handled:true` y n8n no se invoca. Antes de P58/P60, «vendido»/«resumen» caían a n8n (causa de la
  alucinación). Ahora se resuelven local.
- **¿Datos vivos?** `crmReadQuery`/readers con RLS del **workspace de sesión** (no hardcode); endpoint
  `force-dynamic`; `lastResults` solo para follow-up claro; señales «mira otra vez/acabo de editar» fuerzan
  lectura fresca.
- **¿Errores?** Códigos humanos; **fallback parcial** en ventas (si una fuente responde, no «fallo total»).
- **Traza:** `[assistant.turn] {turnType, domain, module, action, shouldReadData, shouldCallN8n, reason}`.

## Quick actions
Chat y quick actions comparten `/api/assistant/v2`. El texto libre NO se enruta por keyword de quick
action: `decideTurn` decide el acto. «resumen» ya no dispara «resumen del día» automáticamente (P60:
conceptual vs operativo vs ambiguo).
