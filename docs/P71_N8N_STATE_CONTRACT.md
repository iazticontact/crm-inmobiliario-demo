# P71 — Contrato de estado compartido con n8n

> Cierra el split-brain: local-first y n8n consumen la MISMA memoria estructurada del hilo.
> Fecha: 2026-07-17 · Workflow: `[CRM Inmobiliario] Agent V2 — Read Only` (id `6mps8YoWu3syldUc`)

## Qué envía el backend (route → webhook)
Campo nuevo `conversationState` en el body (además de `activeEntity`/`recentMessages`/`turn`/
`turnPolicyToken`, que se mantienen): proyección REDUCIDA y validada del `ConversationState` v2
(`reduceStateForN8n` en `src/lib/agents/conversation-state.ts`):

```json
{
  "activeModule": "clients" | null,
  "activeCapability": "..." | null,
  "activeEntities": [{ "type": "client", "id": "uuid", "label": "..." }],
  "temporal": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "interpretation": "esta semana" } | null,
  "pendingIntent": { "capability": "portfolio.update_price", "missingSlots": ["value"] } | null,
  "lastQuery": { "module": "calendar", "entityType": "calendar_event" } | null
}
```
Nunca contiene: datos de negocio, valores propuestos, secretos, respuestas previas ni el workspace como
autoridad (el workspace válido sigue siendo el del `Normalize input`).

## Qué hace n8n con él (bloque de prompt `[P71 ADAPTIVE CONVERSATIONAL INTELLIGENCE]`)
Reglas GENERALES (sin ejemplos de incidente):
1. Contexto de continuidad: pronombres/elipsis → `activeEntities`; continuación temporal → hereda
   `temporal`; complemento de `pendingIntent` → pedir SOLO los `missingSlots`.
2. **Jamás** responder datos desde el estado/memoria: todo dato actual sale de una tool (releer siempre).
3. Los ids de `activeEntities` se usan como parámetros de tools sin inventarlos; workspace del Normalize.
4. `pendingIntent` nunca se ejecuta desde n8n; las acciones siguen el flujo bifásico existente (preview).
5. Sin `conversationState` → comportamiento previo (compatibilidad total con P70).
6. Se conservan intactas todas las reglas P51/P70 (turn policy, Facturación prohibida, cero UUIDs, aclarar
   ante ambigüedad).

## Qué devuelve n8n
Sin cambios de shape: `activeEntityUpdate` {type,id,label} con la entidad REALMENTE resuelta en el turno;
la route lo fusiona en el ConversationState compartido (como ya hacía). `usedTools`/`limitations` igual.

## Procedimiento aplicado (auditable)
GET → backup completo fuera del repo (`%TEMP%/CRM_AGENT_V2_BACKUP_BEFORE_P71_*.json`) → dry-run con diff →
PUT 200 → reread (41 nodos, active=true, markers P70+P71 presentes) → `n8n-p70-verify` **17/17** →
`n8n-p70-e2e` **11/11** → `n8n-p70-chaos` **9/9** → drift re-registrado.

## Hash registrado
- Anterior (P70): `5091deae9de58a5f`
- Vigente (P71): `952900d3c8f3e6c0` (`docs/P70_N8N_WORKFLOW_HASH.txt`)
- Nodos: 41 (sin cambios) · Tools: sin cambios · Prompt: 33.391 → 35.119 chars (bloque P71 append-only)

## Rollback
Restaurar el backup JSON con PUT (o borrar el bloque `[P71 …]` del systemMessage) y re-registrar
`5091deae9de58a5f`. El campo `conversationState` del body es ignorado por el prompt P70 (inocuo).
