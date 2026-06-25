# FASE P12.2 — Asistente IA ultraeficiente, con personalidad, foco CRM y control de tokens

> **Fecha:** 2026-06-25 · Ajuste de **comportamiento** del Asistente IA (no de UI): personalidad
> humana y breve, foco CRM, reconducción graduada de off-topic y control de coste/tokens. El cambio
> central es el **system prompt del Agent V2 en n8n** (era la causa real de las respuestas robóticas).
> Sin tocar tools/enums/RLS/Auth/Storage/Google Calendar/secretos.

---

## 1. Diagnóstico (arquitectura del cerebro)

El runtime de producción es **n8n** (`runN8nAssistant`). El adapter del repo envía solo
`{ message, workspaceId, userId, threadId, activeEntity, recentMessages }` al webhook — **no manda
system prompt**. Por tanto **el prompt que gobierna el comportamiento vive DENTRO del workflow de n8n**,
no en el repo. El repo `SYSTEM_PROMPT_BASE` (`nowlabs-main-agent.ts`) solo alimenta la ruta **OpenAI**
(fallback). El workflow está versionado en `n8n/workflows/crm-agent-v2-readonly.json`.

## 2. Problema de comportamiento detectado

El `systemMessage` del Agent V2 (workflow JSON, en `nodes` **y** `activeVersion.nodes`) contenía
**exactamente** lo que el usuario reportaba:
- Se autodenominaba **"copiloto"**; usaba **"expedientes"**, **"pipeline"**, **"probabilidad"**.
- Ejemplos robóticos literales: *"Hola? → Hola. Dime que quieres mirar del CRM"* y *"Que tal estas? →
  Bien, aqui estoy. ¿Miramos algun cliente, operacion o tarea?"*.
- Sin política graduada de off-topic ni límites de brevedad → respondía como ChatGPT generalista y
  gastaba tokens.

## 3. Política de personalidad

Tono profesional, cercano, español de España, breve, cero robótico. Emojis **ocasionales** (máx. 1 en
casual, **nunca** en datos serios: comisiones/vencimientos/fichas). Saludos como persona:
- "Hola buenas" → "¡Buenas! 👋 ¿Qué tal?"
- "Ya estoy de vuelta" → "Perfecto, bienvenido de vuelta. ¿Seguimos con el CRM?"
- "Qué tal todo?" → "Todo en orden por aquí. ¿Quieres que revise algo del CRM?"
- "Mil gracias" → "De nada 🙂" (corto, sin ofrecer nada).

## 4. Política off-topic (graduada)

- **1ª salida de tema:** 1-2 líneas amables + reconducción suave (ej. libro → "Buen libro… cuando
  quieras, revisamos CRM").
- **2ª salida:** muy breve + reconduce.
- **3ª salida:** límite amable: *"Te entiendo, pero soy el Asistente IA del CRM y estoy pensado para
  ayudarte con clientes, inmuebles, operaciones, citas, trámites y comisiones. Si quieres seguimos por
  ahí."* — **sin** rankings largos ni consejos extensos.
- **Insultos/abuso:** no escalar; "Te leo; cuando quieras revisamos el CRM."

## 5. Política de ahorro de tokens

- Respuestas normales **1-4 líneas**; resumen del día **máx. 5-7 bullets**; listados **máx. 5 + "y N
  más"**.
- **Saludos y charla casual → NO llamar tools.** Conocimiento general fuera del CRM → responder breve
  sin tools. No repetir explicaciones largas si solo saludan.
- No cerrar siempre con la misma coletilla ("¿quieres mirar algo del CRM?"); variar.

## 6. Cambios en el prompt del agente (lo importante)

- **Reescrito el `systemMessage` del Agent V2** en `n8n/workflows/crm-agent-v2-readonly.json` (las **dos**
  copias: `nodes` y `activeVersion.nodes`) con: identidad "Asistente IA" (no copiloto), vocabulario
  final (operación/trámite/comisión; **prohíbe** pipeline/lead/expediente/probabilidad/oportunidad/
  score/ganada), personalidad + brevedad + off-topic graduado + reglas de coste, y ejemplos de tono
  corregidos. **Preservados**: el prefijo `=` (expresión n8n), las expresiones
  `{{ $('Normalize input').item.json.workspaceId/activeEntity }}`, **todos los nombres de tools**
  (`search_clients`, `get_client_360`, `pipeline_summary`, `crm_read_query`…), inputSchema y el modelo
  read-only.
- **Descripciones de tools** (metadata que lee el LLM): limpiado vocabulario antiguo en el **texto**
  (Expedientes→Trámites, "(pipeline)"→"", quitada "probabilidad") sin tocar nombres ni schemas ni el
  enum `entity` (clients/opportunities/service_cases… = tablas internas).
- **Fuente legible versionada:** `n8n/workflows/crm-agent-v2-system-prompt.txt` (el prompt completo en
  texto plano, fácil de revisar/editar/repegar en n8n).
- **Repo (ruta OpenAI):** `SYSTEM_PROMPT_BASE` (`nowlabs-main-agent.ts`) ampliado con el bloque
  **POLÍTICA OFF-TOPIC GRADUADA + BREVEDAD Y COSTE** para que el fallback se comporte igual.

> ⚠️ **Para que el cambio surta efecto en producción hay que REIMPORTAR el workflow en n8n** (o pegar el
> contenido de `crm-agent-v2-system-prompt.txt` en el campo *System Message* del nodo AI Agent
> "ai-agent"). El JSON del repo es la **fuente de verdad**; la instancia n8n viva no cambia sola.
> No se tocaron tools, credenciales ni el resto de nodos.

## 7. Cambios en fallback/local

`SYSTEM_PROMPT_BASE` (OpenAI) ya tenía JUICIO CONVERSACIONAL/ALCANCE; se le añadió la escalada
off-topic 1ª/2ª/3ª y los topes de brevedad/emoji + "operación cerrada = vendida/alquilada, nunca
ganada". El fallback determinista (`deterministic-db-actions`) ya quedó alineado en P12.1.

## 8. Tool calls evitadas

El prompt instruye explícitamente: **saludos y charla casual → sin tools**; conocimiento general →
sin tools; CRM → tools; "resumen del día" → tools necesarias. Reduce round-trips (coste) en los turnos
conversacionales, que son frecuentes.

## 9. Vocabulario final

clientes · inmuebles · cartera activa · vendidos/alquilados · operaciones (Nueva/En gestión/Reserva/
Vendida-Alquilada/Perdida) · trámites · citas · tareas · comisiones (prevista/pendiente/cobrada) ·
vencimientos. **Prohibido** (en salida): copiloto, pipeline, lead, expediente, probabilidad, stage,
won/lost/ganada, listed, score, completed (tareas → done).

## 10. Evals y resultados

`assistant-coherence.evals.ts` ampliado a **18 casos** (P10 + P12.1 + P12.2 comportamiento): saludo,
cortesía, vuelta, off-topic 1ª/3ª, repetición de cierre, + los de coherencia CRM. **No hay runner**
(ejecutar el LLM real es costoso); es la fuente de verdad para QA manual en staging. Las respuestas
robóticas concretas ("Dime qué quieres mirar del CRM") están en `mustNotMention`.

## 11. Qué NO se tocó

n8n: **nodos, tools, credenciales, conexiones y triggers** (solo el `systemMessage` y el texto de las
descripciones de tools). `/api/agent/tool` contract · enums de tools · RLS · Auth · Storage · Google
Calendar · secretos/env · service_role · migraciones · UI del Asistente (salvo 1 línea de microcopy).

## 12. Rendimiento

Cambio de prompt → **menos tokens** por turno (brevedad + sin tools en charla). 0 N+1, 0 dependencias,
0 queries nuevas. El repo solo cambia strings de prompt.

## 13. Seguridad

RLS · workspace-scoped · sin service_role frontend · sin UUID/lead score visibles (el prompt lo
refuerza: "nunca muestres IDs ni score") · acciones de escritura siguen exigiendo confirmación.

## 14. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅. Workflow JSON
**válido** tras la inyección (parse OK; diff quirúrgico de 11 líneas). **Scans:** en el workflow,
copiloto **0**, robotic greeting **0**; "expediente/probabilidad" restantes = solo dentro de la
**lista de términos prohibidos** del propio prompt (legítimo). Resto del repo: Copiloto/expediente/
pipeline/won/lost visibles **0**, service_role **0**, UUID **0**, botón muerto **0**.

## 15. Archivos

| Archivo | Cambio |
|---|---|
| `n8n/workflows/crm-agent-v2-readonly.json` | **systemMessage** del Agent V2 reescrito (×2: nodes + activeVersion) + descripciones de tools limpiadas |
| `n8n/workflows/crm-agent-v2-system-prompt.txt` | **nuevo** — prompt completo en texto (fuente legible) |
| `src/lib/agents/nowlabs-main-agent.ts` | bloque off-topic graduado + brevedad/coste (ruta OpenAI) |
| `src/lib/agents/__evals__/assistant-coherence.evals.ts` | +6 casos de comportamiento (P12.2) |
| `src/app/(saas)/assistant/page.tsx` | 1 línea de microcopy ("Especializado en tu CRM…") |

## 16–18. Commit / Push / Redeploy

Commit `polish(assistant): personalidad, foco CRM y control de tokens en el prompt del Agent V2
(P12.2)` → `origin/main`. **Redeploy del front** (microcopy + prompt OpenAI) **y REIMPORTAR el workflow
en n8n** para que el agente de producción use el nuevo prompt.

## 19. Checklist de staging

- [ ] (Tras reimportar n8n) "Hola buenas" → "¡Buenas! 👋 ¿Qué tal?" (no "Dime qué quieres mirar del CRM").
- [ ] "Qué tal todo?" → cortesía breve, sin tools.
- [ ] "Ya estoy de vuelta" → "Bienvenido de vuelta…", sin parrafada.
- [ ] "Estoy leyendo Padre rico padre pobre" → 1 línea + reconduce.
- [ ] Insistir off-topic 3 veces → límite amable, sin ranking largo.
- [ ] "Resumen del día" → ≤ 7 bullets con citas/vencimientos/operaciones.
- [ ] "Qué inmuebles activos tengo?" / "Qué comisiones pendientes?" / "Algún trámite abierto?" →
      datos reales, vocabulario final (trámite, no expediente).
- [ ] "Completa la tarea X" → confirmación → done.
- [ ] El asistente NO cierra siempre con la misma coletilla.

## 20. Pendientes honestos

- **Reimportar el workflow en n8n** es manual (o vía n8n MCP con OAuth del usuario): el JSON del repo
  es la fuente; no modifica la instancia viva por sí solo. Documentado arriba.
- **offTopicCount** no se persiste en tabla: la escalada 1ª/2ª/3ª la infiere el LLM por el historial
  (Window Memory de n8n), tal como pide el prompt. Suficiente sin nueva tabla.
- El **fallback local** (offline) conserva el flujo genérico de cita/factura; en producción responde
  n8n (ya alineado). Reescribirlo entero a inmobiliario sería micro-fase aparte.
- Modo **Inbox** (interno) mantiene su "Lead Score" gateado, fuera del Asistente IA de producción.

## Veredicto

**P12.2 COMPLETADO — ASISTENTE IA CON PERSONALIDAD, FOCO CRM Y COSTE CONTROLADO.** Se localizó la causa
real (el `systemMessage` del Agent V2 en n8n, que se llamaba "copiloto" y respondía "Dime qué quieres
mirar del CRM") y se reescribió por completo: personalidad humana y breve, reconducción graduada de
off-topic, topes de tokens, sin tools en charla casual y vocabulario inmobiliario final — preservando
nombres de tools, expresiones n8n y el modelo read-only. La ruta OpenAI y los evals quedan alineados.
`tsc`/`lint`/`build` en verde y workflow JSON válido. **Requiere redeploy del front + reimportar el
workflow en n8n.**
