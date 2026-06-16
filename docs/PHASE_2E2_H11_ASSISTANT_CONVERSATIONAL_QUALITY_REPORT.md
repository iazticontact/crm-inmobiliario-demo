# Phase 2E-2 H11 — Assistant conversational quality + full client profiles

> **Fecha:** 2026-06-16 · **Base:** `8e73af2` · Mejora de comportamiento del agente
> (prompt) + ocultar "Lead Score" en UI. Sin features grandes, sin n8n, sin tocar
> el cerebro/arquitectura, sin schema. El cerebro sigue en el CRM.

## 1. Problemas detectados en la conversación real
- Casual: tras "muy bien y tú?" repetía "estoy operativo" y reconducía en cada frase (robótico).
- "¿Puedes mirar fichas?": respondía "no tengo acceso directo…" (pobre; sí puede).
- "Coge un cliente al azar": primero decía "no he encontrado…" y luego lo elegía (incoherente).
- Ficha de cliente: muy pobre (Tipo, Estado, **Lead Score**, Cita) en vez de una ficha completa.
- Mostraba **"Lead Score"** como dato protagonista (poco profesional).

## 2. Cambios de personalidad (system prompt, `nowlabs-main-agent.ts`)
- **Charla casual:** responde humano y natural 1-2 turnos, sin repetir "estoy
  operativo" ni reconducir en cada frase; si preguntan cómo está, contesta con
  naturalidad; tras un par de turnos reconduce suave. Off-topic real (recetas…)
  sigue acotado a 1 frase + redirección.

## 3. Cambios de tool usage
- **"Puedes mirar fichas" → SÍ**, explica capacidades; nunca "no tengo acceso directo".
  Si falta nombre, ofrece "dime el nombre o tomo uno de ejemplo".
- **Cliente de ejemplo / "test" / "al azar":** ELIGE un cliente REAL (list_clients,
  uno activo/reciente), lo anuncia como ejemplo real; NUNCA "no he encontrado…"
  si lo acaba de elegir.

## 4. Ficha completa de cliente
- Para "dame sus datos / ficha completa / qué sabes de X": **combina**
  `get_client_context` + `list_opportunities` + `list_service_cases` y presenta por
  secciones: Identificación (nombre, empresa/perfil, estado, email, teléfono,
  NIF/CIF, dirección) · Interés comercial (tipo, presupuesto, zona, notas) ·
  Operaciones · Expedientes · Tareas · Próximas citas · Actividad reciente ·
  **Datos por completar**.
- Dato ausente → **"No registrado" / "Sin completar"** (no un escueto "no tengo").
- (Se reutilizan tools existentes; no se modificó `getClient360` ni el schema.)

## 5. Lead Score / score
- **Prompt:** "NUNCA muestres puntuación/Lead Score/score numérico; es interno; si
  acaso, 'prioridad comercial' cualitativa".
- **UI:** ocultos los chips visibles de score en el listado de clientes
  (`clients/page.tsx`) y en la cabecera de la ficha (`clients/[id]/page.tsx`),
  gateados tras `NEXT_PUBLIC_NOWLABS_INTERNAL` (siguen para operador interno). El
  campo `leadScore` se mantiene internamente (types/estado/queries); **no se tocó
  schema** ni se borraron columnas.

## 6. UI microcopy
- Score oculto al cliente (arriba). El resto de microcopy técnico (Backend agent,
  OpenAI/tools server-side) vive en el panel de diagnóstico interno
  (`NOWLABS_INTERNAL`), no en la vista de cliente; sin cambios adicionales en H11.

## 7. Evals añadidos
`ASSISTANT_CRM_INTELLIGENCE_EVALS.md` §9 — 12 casos H11 (charla natural H1-H4,
cliente de ejemplo H5, ficha completa H6/H8, NIF "No registrado" H7, datos
faltantes H9, próxima acción H10, sin score H11, cierre amable H12).

## 8. Qué NO se tocó
Cerebro (flujo v2/confirm), executor de escritura, n8n, WhatsApp/Inbox, Storage,
Google, facturación, schema/migraciones, `.env.local`, service_role frontend, demo.
No se modificaron tools (solo el prompt) salvo el ocultado de score en UI.

## 9. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).

## 10. Smoke (Oier) — repetir la conversación real
"Hola buenas" → "Muy bien y tú?" → "Pero te he preguntado qué tal estás" → "Pues
no sé jejeje a ver dime" → "¿Podrías mirar fichas de clientes?" → "Coge un cliente
al azar y mírame sus datos enteros" → "Sí, dame sus datos" → "¿No hay más datos?
El NIF?" → "Vale perfecto gracias y un saludo".
Esperado: tono natural (no robot), usa tools, elige cliente real, ficha completa
por secciones, NIF = "No registrado", **sin Lead Score**, cierre amable.

## 11. Próximo paso
Smoke conversacional por Oier; si el agente aún muestra score (porque alguna tool
lo incluye en su texto), reportarlo y se filtra en la tool concreta. Ampliar
`get_client_context` para incluir operaciones/expedientes nativamente sería una
mejora futura (hoy se combinan vía tools).
