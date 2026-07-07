# P54 — Tarjeta de QA final del Asistente (copiar/pegar en el chat de staging)

> 20 pruebas cortas, en orden. Si una falla: captura de pantalla + el mensaje exacto + qué respondió.
> Staging: `https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host` → Asistente IA.

| # | Escribe | Esperado |
|---|---|---|
| 1 | `soy nuevo, ¿por dónde empiezo?` | Tour por bloques + 1 pregunta. Sin listados. |
| 2 | `¿qué puedes hacer?` | Capacidades. Sin listados. |
| 3 | `¿qué muestra el dashboard?` | Explica el módulo (bullets) + ofrece datos. NO lista. |
| 4 | `¿para qué sirve la cartera?` | Explica Cartera. NO lista pisos. |
| 5 | `explícame el apartado de clientes` | Explica Clientes. NO lista clientes. |
| 6 | `¿qué es el apartado de trámites?` | Explica Trámites. |
| 7 | `¿cómo funciona la facturación?` | Explica + aclara que las facturas van en su módulo. |
| 8 | `¿qué resume esta pantalla?` | Explica o pregunta qué pantalla. |
| 9 | `no entiendo` | Simplifica el MISMO tema anterior. Sin datos. |
| 10 | `no me refiero a eso` | Reconoce y pregunta qué necesitas. No repite. |
| 11 | `¿por qué me has dicho eso?` | Explica su interpretación. Sin listados. |
| 12 | `muéstrame los clientes` | **Lista real** de clientes. |
| 13 | `¿qué pisos hay en cartera?` | **Lista real** con precio/zona/m²/hab. |
| 14 | `lista mis tareas pendientes` | **Datos reales** (o «no hay tareas»). |
| 15 | `¿qué trámites hay abiertos?` | **Datos reales**. |
| 16 | `¿y el de Malasaña?` (tras 13) | Filtra el conjunto anterior. |
| 17 | `¿qué muestra el dashboard?` (tras 13) | Explica Dashboard. NO vuelve a listar pisos. |
| 18 | `¿cuánto he facturado?` | Redirige al módulo Facturación. |
| 19 | `mmm` | Pide aclaración con opciones. |
| 20 | `¡Hola!` / `gracias` | Natural y breve. |

**Aprobado:** 1-11 y 17-20 sin listados de datos; 12-16 con datos reales. Cero UUIDs/SQL/errores técnicos.
**Nota:** cada turno deja traza `[assistant.turn] {turnType, module, shouldReadData…}` en logs del servidor.
