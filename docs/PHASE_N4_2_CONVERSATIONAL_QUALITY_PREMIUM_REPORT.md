# FASE N4.2 — Calidad conversacional premium del Agent V2

> **Fecha:** 2026-06-21 · Workflow n8n `6mps8YoWu3syldUc` (ACTIVO, `gpt-4.1-mini`@0.2).
> **Solo n8n** (prompt + Build Response) → NO toca runtime CRM, NO requiere redeploy.
> Sin tocar `.env`/`.mcp.json`/secretos/modelo/temperature/workflows antiguos/memoria/
> tools/seguridad.

---

## 1. Diagnóstico de calidad actual
El agente funcionaba (datos, memoria, tools) pero sonaba a **chatbot genérico**. Ejemplo:
"¿Qué tal estás?" → "Estoy listo para ayudarte con cualquier consulta sobre el CRM
inmobiliario. ¿Qué información necesitas?". El prompt era **rico en REGLAS pero sin guía
POSITIVA de voz**: muchas prohibiciones, ningún modelo de cómo debía SONAR. Por eso el
modelo caía en el estilo por defecto de ChatGPT.

## 2. Qué fallaba exactamente
- Sin persona ni tono definidos → respuestas planas/robóticas.
- Cierres de relleno ("Estoy listo para ayudarte", "¿En qué puedo ayudarte hoy?").
- Small talk frío; agradecimientos secos; fichas en párrafo largo en vez de bullets.
- Las reglas existentes eran "no hagas X", faltaba "suena así".

## 3. Cambios en el prompt (quirúrgico, no infinito)
Solo n8n, prompt 5603 → **7895 chars** (persona + 8 ejemplos de estilo; se recortaron las
prohibiciones de tono ahora cubiertas por la persona):
- **Intro reescrita** → persona fuerte: "Eres el copiloto interno de un CRM inmobiliario:
  el apoyo operativo del equipo… hablas como un compañero competente, no como un bot."
- **Bloque PERSONALIDAD Y ESTILO** (gobierna todas las respuestas): español natural,
  cercano sin pasarse, small talk humano ("Bien, aquí estoy", "Me alegro"), **prohíbe**
  cierres de relleno y capability spam, casual→casual, agradecimiento→cálido breve,
  crítica→da la razón y corrige, sin emojis, sin fingir emociones/IA.
- **GUÍA DE ESTILO** (8 ejemplos de TONO, no plantillas; "interpreta por intención"):
  casual, agradecimiento fuerte, crítica, confusión, saludo, despedida/pausa, capacidades,
  y formato de ficha.
- **Ficha premium**: encabezado + "Datos principales" en bullets + actividad/citas aparte
  + "No consta" para lo que falte; nunca mencionar módulos inexistentes (facturas/WhatsApp)
  con datos.
- **Intactos**: PRIORIDAD MENSAJE vs MEMORIA (N4.1.1), No consta/no inventar, no UUID/
  lead_score, identidad/pronombres (activeEntity/previous/recent), recuperación ante fallo
  de tool, ruteo de tools, READ-ONLY, honestidad PDF/facturación, seguridad.

## 4. Build Response (defensa en profundidad)
El agente, ante "dame el UUID/ID interno de X", **filtraba el UUID** pese a la regla del
prompt (gpt-4.1-mini obedece la petición directa). Fix robusto: **Build Response elimina
cualquier UUID del `reply`** (texto al usuario), reemplazándolo por
"(identificador interno, no se muestra)". El id sigue viajando **internamente** vía
`activeEntityUpdate` (derivado de datos de tools) → memoria intacta, usuario sin UUID.
Build Response sigue devolviendo `reply` limpio + `activeEntityUpdate` interno; no cambia
tono ni pierde memoria.

## 5. ¿n8n? ¿CRM runtime? ¿redeploy?
- **n8n:** sí (prompt + Build Response). Workflow activo, read-back OK, backup sincronizado.
- **CRM runtime:** **no**. → **No requiere redeploy.**

## 6-8. Evals (en vivo, comportamiento GENERAL)
Nueva categoría **`conversation_quality_premium` (20 casos)** + robóticos en
`global_forbidden` ("estoy listo para ayudarte", "en que puedo ayudarte hoy") + runner
**acento-insensible** (los patrones ASCII casan con tildes).

| Categoría | Resultado |
|---|---|
| conversation_quality_premium | **20/20** |
| reopen (reapertura/pausa/saludo) | 12/12 |
| memory_chain (persist/recall "su"/"el anterior") | 7/7 |
| active_capture (activeEntityUpdate) | 4/4 |
| no_score | 2/2 |
| **no_uuids** (tras fix Build Response) | **2/2** |
| client_by_name (datos + tools) | 8/8 |
| pdf_unavailable / invoice_unavailable | 3/3 · 3/3 |
| pause (pausa REAL sigue breve) | 3/3 |

Suite total **148 casos**. 0 frases robóticas, 0 "te espero" ante saludo/agradecimiento,
0 JSON/UUID/lead_score visible, 0 invención de módulos, memoria y tools intactas.

## 9. Resultados clave (PII redactada)
- **"Qué tal estás?"** → "Bien, aquí estoy. ¿Quieres que miremos algún cliente, operación
  o tarea?" (natural, no robótico).
- **"Joder tío mil gracias eres la hostia"** → "Me alegro. Para eso está el copiloto:
  datos claros sin que pierdas tiempo navegando." (cálido, premium).
- **"Dame datos sobre Oier"** → ficha estructurada: "Encontré a Oier Duñabeitia Berezo.
  Datos principales: · Empresa … · Email \<email\> · Teléfono \<tel\> · DNI/NIF \<DNI\> ·
  Nacionalidad … · Dirección … Actividad y citas: · …" (bullets, no párrafo).
- **"Aparte de esto hay más detalle o qué?"** → amplía con lo que consta (actividad/citas),
  dice lo que no consta, sin inventar facturas/WhatsApp.

## 10. Seguridad
Sin secretos/PII en el diff (DNI/email/tel redactados en este report). `lead_score` (strip
server N4) y `UUID` (strip Build Response N4.2) nunca llegan al usuario. UUIDs internos
siguen disponibles server-to-server para memoria. Sin tocar `.env`/`.mcp.json`.

## 11. Validaciones
Solo n8n/docs/evals → workflow read-back (activo, gpt-4.1-mini@0.2, PERSONALIDAD/GUIA,
Build Response UUID strip, activeEntityUpdate + todas las reglas intactas, sin mojibake),
backup sincronizado, evals en vivo. **No tsc/lint/build** (no se tocó `src/`).

## 12. Archivos tocados
- `n8n/workflows/crm-agent-v2-readonly.json` (backup: prompt premium + Build Response strip)
- `docs/evals/agent-v2-crm-evals.json` (+conversation_quality_premium, +global robóticos)
- `docs/evals/run-agent-evals.mjs` (matching acento-insensible)
- docs (este report + spec + arquitectura)

## Veredicto
**N4.2 COMPLETADO — PREMIUM CONVERSATIONAL QUALITY.** Persona general sólida y natural
(copiloto interno, no bot de soporte) vía bloque PERSONALIDAD + guía de estilo, gobernando
TODAS las respuestas por intención (no parches literales). Casual/agradecimiento/crítica/
saludo/datos suenan premium; memoria, tools, seguridad y guardrails intactos (UUID ahora
blindado en Build Response). Certificado con 148 evals (conversation_quality_premium 20/20
+ regresión completa). `gpt-4.1-mini`@0.2, solo n8n, **sin redeploy del CRM**.
