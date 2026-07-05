# P51 — Resultados de QA adversarial en UI/staging

## Estado: ⛔ BLOCKED — falta acceso interactivo a la UI/staging

**Por qué:** esta sesión es no-interactiva. Puedo comprobar disponibilidad por red (`curl`), pero **no**
puedo iniciar sesión en la UI del Asistente ni escribir mensajes en el chat para observar las trazas
`[assistant.turn]` en vivo. Por tanto, la QA adversarial manual en UI **no se ha ejecutado** en esta
iteración. No lo marco como hecho.

**Sí verificado (no-interactivo):**
- Staging responde: `curl -I …/login → HTTP 200` (2026-07). App arriba.
- Lógica de decisión/permS: **24 suites de evals TODO VERDE** (incluye el contrato de token y el blindaje
  legacy). Esto cubre la clase de fallo a nivel de lógica, pero **no** sustituye a la prueba en UI.

---

## Checklist EJECUTABLE para el validador (copiar/pegar en el chat del Asistente)

Para cada fila: escribe el mensaje, observa la respuesta y (si tienes acceso a logs) confirma la traza
`[assistant.turn] { turnType, shouldReadData, shouldCallN8n }`.

| # | Escribe esto | Esperado | ¿Lee datos? |
|---|---|---|---|
| 1 | `hola` | Saludo + oferta de ayuda | ❌ |
| 2 | `¿qué puedes hacer?` | Explica capacidades | ❌ |
| 3 | `¿cómo funciona la cartera?` | Explica el módulo | ❌ |
| 4 | `si creo un cliente nuevo, ¿podrás verlo?` | Responde condicional | ❌ |
| 5 | `muéstrame los clientes` | Lista clientes reales | ✅ |
| 6 | `¿y el de Malasaña?` (tras pedir pisos) | Filtra por Malasaña | ✅ (contexto) |
| 7 | `no me refiero a los clientes` | Repara, pide aclaración | ❌ |
| 8 | `esto está mal, no me ayudas` | Se disculpa, pregunta | ❌ |
| 9 | `¿por qué me listas los clientes?` | Explica su interpretación | ❌ |
| 10 | `¿puedes leer los trámites nuevos?` | Explica capacidad | ❌ |
| 11 | (cambio de tema) `¿cómo funciona esto?` | Explica, no arrastra | ❌ |
| 12 | `mmm` | Pide aclaración | ❌ |
| 13 | `¿cuánto he facturado?` | Redirige a Facturación | ❌ |
| 14 | `muéstrame las próximas citas` | Lista citas reales | ✅ |
| 15 | `¿qué inmuebles hay con 3 habs y +80 m²?` | Filtra por características | ✅ |

**Criterio de aprobado:** filas 1-4, 7-13 **no** deben devolver listados de datos; filas 5-6, 14-15 sí.
Ninguna respuesta debe mostrar UUIDs, SQL ni errores técnicos crudos.

## Checklist de enforcement de tools (requiere logs de servidor)
1. En turnos no-datos, en los logs **no** debe aparecer ninguna llamada a `/api/agent/tool` (source local).
2. Tras editar el workflow de n8n (ver `AGENT_N8N_CONTRACT.md`) y poner `AGENT_TOOLS_REQUIRE_POLICY=true`:
   - una tool sin `x-nowcrm-turn-policy` ⇒ `403 turn_policy_required`;
   - `get_invoices_summary` ⇒ `403 tool_forbidden_for_assistant`;
   - un turno no-datos ⇒ `403 tool_not_allowed_for_turn`.
3. Confirmar que dejan de aparecer `WARN unscoped_tool_call` en `[agent/tool]`.

> Rellenar esta tabla con transcript + traza cuando se ejecute en staging real.
