# HOTFIX N4.1.1 — "Perfecto, te espero" ante saludo: prioridad mensaje vs memoria

> **Fecha:** 2026-06-21 · Workflow n8n `6mps8YoWu3syldUc` (ACTIVO, `gpt-4.1-mini`@0.2).
> **Solo n8n (prompt)** → NO toca runtime CRM, NO requiere redeploy. Sin tocar
> `.env`/`.mcp.json`/secretos/workflows antiguos/modelo/arquitectura.

---

## 1. Causa exacta
Diagnóstico sobre la ejecución real `#1448`:
- `Normalize input.message = "Hola?"`, `activeEntity = {}`, **`recentMessages = 0` (vacío)**,
  `Build Response.reply = "Perfecto, te espero."`.
- Conexiones correctas: `Webhook In → Check secret → Normalize input → CRM Agent →
  Build Response → Respond to Webhook`. **No** hay `CRM Agent → Respond` directo. La
  respuesta sale de Build Response (que pasa el `output` del agente). El texto absurdo lo
  generó el **LLM**, no Build Response.

**Causa = contaminación de Window Memory + regla de pausa demasiado ansiosa.** Como
`recentMessages` iba vacío (y además el workflow **no lo consume**: Normalize no lo inyecta),
la contaminación venía de la **Window Memory de n8n** (sessionKey `workspaceId:userId:threadId`):
el hilo traía un cierre/pausa previo ("dame un segundo" → "Perfecto, te espero"), y el
modelo, con la regla `JUICIO CONVERSACIONAL` que mapeaba pausa→"Perfecto, te espero",
**clasificó el nuevo saludo como continuación de la pausa anterior**. En hilos FRESCOS
"Hola" ya respondía bien (evals N4.1) → confirma que era prioridad memoria, no el saludo.

## 2. Qué era (y qué NO)
- **Sí:** Window Memory + prompt (mala priorización mensaje-actual vs historial).
- **No:** no era env del CRM, no era `recentMessages` (vacío y además ignorado por el
  workflow), no era conexión directa CRM Agent→Respond (no existe), no era Build Response.

## 3. Fix aplicado (general, no un parche para "Hola?")
Se **reemplazó** el bloque `JUICIO CONVERSACIONAL` por un bloque de **PRIORIDAD MENSAJE vs
MEMORIA** basado en principios (no en frases hardcodeadas, no if/else):
- El **mensaje ACTUAL manda**; memoria e historial solo apoyan, no secuestran.
- Usar memoria (activa/previa/reciente, Window Memory) **solo ante referencia contextual
  real** del mensaje actual ("su", "este", "el anterior", "eso", "lo de antes", "vuelve"…).
  Sin referencia clara, no arrastrar tema ni cierre anterior.
- **Saludo/reapertura** (por INTENCIÓN, no por texto) = inicio fresco; nunca continuar una
  pausa/despedida previa.
- "Te espero"/despedidas/cierres **solo si el mensaje actual lo pide**.
- Consulta nueva → tools; crítica → dar la razón; pausa/gracias reales → breve; capacidades
  solo si las piden.
- "Interpreta SIEMPRE por intención, no por frases exactas; los ejemplos son guía."

Prompt: 4938 → **5603 chars** (ajuste quirúrgico, principios; no infinito, no listas
masivas). Modelo/temperatura/tools/Build Response/activeEntityUpdate intactos.

`recentMessages`: **no se tocó** — el workflow no lo usa, no contamina (la memoria real
viene de Window Memory + activeEntity). Documentado por si se reduce en el CRM más adelante.

## 4. Evals (en vivo) — comportamiento GENERAL, no solo "Hola?"
Nueva categoría **`reopen`** (12 casos, multi-turno en el MISMO hilo, que reproduce la
contaminación) + saludos forbidden "te espero":
- "Hasta luego" → "Hola?" → reapertura fresca (no "te espero"). ✅
- "Perfecto, gracias" → "Dame datos sobre Oier" → usa tools, da Oier. ✅
- "Dame un segundo" → "Buenas, seguimos" → fresco. ✅
- "Hasta luego" → "Tengo una duda, dame el resumen del pipeline" → pipeline. ✅
- Variantes por intención: "Ey", "Ya estoy", "A ver, una cosa", "Volvemos" → frescas. ✅

Regresión sin pérdidas:
| Categoría | Resultado |
|---|---|
| reopen | **12/12** |
| greeting (con forbidden "te espero") | 5/5 |
| pause (pausa REAL sigue breve) | 3/3 |
| farewell | 3/3 |
| criticism | 3/3 |
| active_capture (emisión AEU) | 4/4 |
| memory_chain (persist/recall "su"/"el anterior") | 7/7 |
| client_by_name (datos + tools) | 8/8 |

Suite total **128 casos**. 0 "Perfecto, te espero" ante saludo, 0 pérdida de memoria de
entidades, 0 JSON visible, 0 V1, sin PII/secrets en logs.

## 5. Resultados clave
- **"Hola?"** (tras pausa/despedida) → saludo fresco y útil, **no** "te espero".
- **"Dame datos sobre Oier"** → ficha real (search_clients → get_client_360).
- **"Dame su DNI"** → usa el cliente activo (memoria intacta).
- **"Vuelve al anterior"** → usa el previo (memoria intacta).

## 6. Qué se tocó
- **n8n:** prompt (bloque PRIORIDAD). Workflow **activo**, read-back OK, backup
  `n8n/workflows/crm-agent-v2-readonly.json` sincronizado.
- **CRM runtime:** **nada** → **no requiere redeploy**.
- Evals ampliados (`reopen` + forbidden), report añadido.

## Veredicto
**HOTFIX N4.1.1 COMPLETADO — GREETING/MEMORY CONTAMINATION FIXED.** Causa: Window Memory
contaminaba el saludo + regla de pausa ansiosa. Fix general y principista (el mensaje
actual manda; memoria solo ante referencia contextual real; reapertura = inicio fresco),
no un parche literal. Certificado con la categoría `reopen` (12/12) y sin regresión
(memoria, pausas reales, datos). Solo n8n, sin redeploy del CRM.
