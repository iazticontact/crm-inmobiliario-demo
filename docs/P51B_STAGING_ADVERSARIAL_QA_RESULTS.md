# P51B — QA adversarial en UI/staging

## Estado: ⛔ NO EJECUTADO (BLOCKED) — sesión no-interactiva, sin acceso al chat/logs de staging

No puedo iniciar sesión en la UI del Asistente ni escribir en el chat para observar trazas `[assistant.turn]`
en vivo. La lógica está verificada offline (25 suites verdes). Checklist listo para el operador/validador.

## Checklist (escribir en el chat de staging; con logs, anotar la traza)
| # | Categoría | Escribe | Esperado | ¿Tools? |
|---|---|---|---|---|
| 1 | Social | `hola` | Saludo | ❌ |
| 2 | Capacidades | `¿qué puedes hacer?` | Explica | ❌ |
| 3 | Funcionamiento | `¿cómo funciona la cartera?` | Explica | ❌ |
| 4 | Hipótesis/futuro | `si creo un cliente, ¿podrás verlo?` | Condicional | ❌ |
| 5 | Lectura clientes | `muéstrame los clientes` | Datos frescos | ✅ |
| 6 | Lectura inmuebles | `¿qué pisos hay en cartera?` | Datos frescos | ✅ |
| 7 | Ops/citas/tareas/trámites | `mis operaciones abiertas` / `próximas citas` | Datos | ✅ |
| 8 | Follow-up datos | `¿y el de Malasaña?` | Contexto/lectura | ✅ |
| 9 | Meta (respuesta previa) | `¿por qué me listas los clientes?` | Explica, no repite | ❌ |
| 10 | Corrección | `no me refiero a los clientes` | Recovery, no repite | ❌ |
| 11 | Queja/desacuerdo | `esto está mal` / `te equivocas` | Recovery | ❌ |
| 12 | Entidad en pregunta conceptual | `¿puedes leer los trámites nuevos?` | Explica | ❌ |
| 13 | Cambio de tema | (tras datos) `¿cómo funciona esto?` | Nueva decisión | ❌ |
| 14 | Ambigua | `mmm` | Aclaración | ❌ |
| 15 | Facturación | `¿cuánto he facturado?` | Redirige a Facturación | ❌ |
| 16 | Tool permitida (n8n) | (tras editar n8n) lectura real | tool 200 con token | ✅ |
| 17 | Tool prohibida (n8n) | intento de invoice/no permitida | backend 403 | ❌ |
| 18 | Strict mode | tool sin token (post strict) | 403 | ❌ |

**Aprobado:** 1-4, 9-15 sin listados de datos; 5-8, 16 con datos reales; 17-18 con 403 del backend.
Ninguna respuesta con UUID/SQL/errores técnicos.

## Trazas a confirmar (logs servidor)
- `[assistant.turn] { turnType, shouldReadData, shouldCallN8n }` en cada turno.
- Turnos no-datos ⇒ no aparece llamada a `/api/agent/tool`.
- Post strict: sin `WARN unscoped_tool_call`; `tool_not_allowed_for_turn` solo en casos 17-18.
