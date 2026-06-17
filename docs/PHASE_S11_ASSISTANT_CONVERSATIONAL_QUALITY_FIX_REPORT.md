# FASE S11 (conv) — Calidad conversacional del asistente

> **Fecha:** 2026-06-17 · **Base:** `51ea88a` → este commit ·
> **Alcance:** corregir el COMPORTAMIENTO conversacional del agente (sobre-ayuda,
> capability spam, no escuchar, contradecir al usuario, prometer facturación).
> Es polish de prompt/personalidad — NO se tocaron tools, executor/confirm,
> schema, RLS ni `service_role`.

---

## 1. Conversación real fallida
Usuario: "Necesito el DNI de Oier" → ✅ "El DNI de Oier… es …".
Usuario: "Perfecto, gracias, dame un segundo que estoy haciendo una factura" →
❌ "Claro, tómate tu tiempo. Cuando estés listo puedo ayudarte a preparar la
factura o 😊" (frase rota, emoji, se adelanta, promete factura).
Usuario: "¿Ayudarme en qué sentido?" → ❌ lista genérica de capacidades.
Usuario: "¿Qué tiene que ver… con revisar oportunidades?" → ❌ insiste, no escucha.
Usuario: "Funcionas mal" → ❌ "Sí, estoy funcionando correctamente…" (contradice).

## 2. Causa exacta (qué regla lo provocaba)
En el system prompt (`nowlabs-main-agent.ts`):
- L828: "si puedes dar contexto útil o **proponer una acción**, hazlo en la
  primera frase" → empujaba a ofrecer ayuda no pedida.
- L836: "Tras un par de turnos, **reconduce suave**: '¿Miramos algún cliente…'"
  + ejemplo con 😊 → reconducción/over-help y emoji por defecto.
- L830: permiso explícito de emojis.
- **No existía** ninguna regla para: respetar una pausa/agradecimiento, NO listar
  capacidades sin pedirlo, reconocer una crítica, ni prohibir prometer factura.
  Ante el vacío, el modelo improvisó "estoy funcionando correctamente".

## 3. Cambios de prompt / personalidad
Nuevo bloque **JUICIO CONVERSACIONAL (MÁXIMA PRIORIDAD)**: el agente clasifica el
turno y responde SOLO a su intención real:
- Dato exacto → tool + solo el dato.
- **Pausa/agradecimiento/espera** ("gracias, dame un segundo", "vale", "espera")
  → "Perfecto, te espero." y NADA más (sin acciones, sin capacidades, sin
  módulos, sin emoji).
- Aclaración sobre lo que dijo → explica solo el contexto; reconoce si se adelantó.
- **Crítica** ("funcionas mal", "¿quién ha dicho eso?") → DA LA RAZÓN y corrige;
  PROHIBIDO "estoy funcionando correctamente" / defenderse.
- Acción → preparar + confirmar.
- Consulta amplia → tools + completo.
- Módulo no activo (factura) → honesto + ofrecer datos fiscales/contacto.
REGLAS DURAS: no sobre-ayudar; no listar capacidades salvo que lo pregunten;
nunca "preparar/emitir/crear/generar la factura"; emojis casi nunca; no cambiar
de tema; no insistir; no defenderse; no cerrar con frases rotas.
Además se suavizaron L828 (no proponer acciones no pedidas), L830 (emojis casi
nunca), L836 (no reconducir tras "gracias/un segundo") y la respuesta canónica de
"¿funcionas?" (sin emoji; con puntero a la regla de crítica).

## 4. Facturación — honestidad
No hay módulo de facturación activo (capability registry S10 = future). Regla
explícita: el asistente NUNCA dice que puede preparar/emitir/crear/generar una
factura; ofrece los datos fiscales/contacto del cliente (DNI/NIF, dirección,
email, teléfono) para que el usuario la prepare. (Ej.: CQ-07.)

## 5. Response quality guard
Se optó por **prompt hardening** (corrige la causa raíz) en lugar de un
postprocess que reescriba la salida del modelo: un guard por regex
("funcionando correctamente", capability spam, emoji) es frágil y podría mangañar
respuestas buenas o datos exactos (prohibido por el brief). Documentado como
descartado a propósito; la verificación se hace con el corpus de evals.

## 6. Evals añadidos
- `docs/evals/assistant-crm-evals.json`: categoría `conversation_quality`
  (CQ-01..CQ-10) con `expected_intent`, `expected_behavior` y `forbidden_behavior`.
- `docs/ASSISTANT_CRM_INTELLIGENCE_EVALS.md`: sección S11 (conv) con la tabla del
  bug real. JSON validado (56 casos en total).

## 7. Qué NO se tocó
Tools CRM (get_client_field_exact, get_client_context, get_latest_client,
list_*), active client, compactToolData, capability registry, assistant cache
(S6), executor/confirm, RLS, `service_role`, rendimiento S2–S7, modal de borrado
(S11 UI). Solo texto del system prompt.

## 8. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅
(`✓ Compiled successfully`, 46 rutas). JSON de evals válido.

## 9. Smoke staging (pendiente, Oier — tras redeploy)
Reproducir la conversación: "gracias, dame un segundo" → "Perfecto, te espero.";
"¿ayudarme en qué sentido?" → contextual; "funcionas mal" → reconoce y corrige;
"hazme la factura" → honesto + ofrece datos. Sin emoji por defecto, sin capability
spam, sin "funcionando correctamente".

## Veredicto
**S11 (conv) PARCIAL SEGURO — asistente más natural, escucha y se corrige.**
Causa raíz (prompt empujaba a sobre-ayudar/reconducir y no tenía regla de
crítica) corregida con el bloque JUICIO CONVERSACIONAL + ajustes de tono +
honestidad de facturación + evals. Falta el smoke en navegador (Oier) tras deploy.
