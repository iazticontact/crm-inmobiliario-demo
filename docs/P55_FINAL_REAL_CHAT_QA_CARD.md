# P55 — Tarjeta FINAL de QA del chat (5-10 min)

> Staging → Asistente IA. Escribe cada prompt EN ORDEN. Marca PASS/FAIL. Si falla: pega el prompt exacto +
> la respuesta completa (captura).

| # | Prompt | Esperado | PASS/FAIL |
|---|---|---|---|
| 1 | `soy nuevo, ¿por dónde empiezo?` | Tour por bloques, sin listados | |
| 2 | `qué puede hacer este asistente` | Capacidades, sin listados | |
| 3 | `explícame el CRM` | Visión general del CRM | |
| 4 | `¿qué muestra el dashboard?` | Explica el módulo (bullets), NO lista | |
| 5 | `no entiendo` | Simplifica el Dashboard (mismo tema) | |
| 6 | `ahora cartera` | Explica Cartera (cambio de tema limpio) | |
| 7 | `qué son los trámites` | Explica Trámites | |
| 8 | `qué hace facturación` | Explica + facturas van en su módulo | |
| 9 | `muéstrame los clientes` | **Lista real** de clientes | |
| 10 | `¿y cuántos hay en total?` | Total desde el resultado/consulta | |
| 11 | `¿qué pisos hay en cartera?` | **Lista real** (precio/zona/m²/hab) | |
| 12 | `¿y el de Malasaña?` | Filtra el conjunto anterior | |
| 13 | `lista mis tareas pendientes` | **Datos reales** (o «no hay tareas») | |
| 14 | `¿qué trámites hay abiertos?` | **Datos reales** | |
| 15 | `¿qué citas tengo próximas?` | **Datos reales** | |
| 16 | `no listes datos` | Reconoce la instrucción, no lista | |
| 17 | `te has liado` | Reconoce, pregunta qué necesitas | |
| 18 | `¿por qué me has dicho eso?` | Explica su interpretación, sin listar | |
| 19 | `¿cuánto he facturado?` | Redirige al módulo Facturación | |
| 20 | `gracias` | Cierre natural y breve | |

**Aprobado:** 1-8 y 16-20 sin listados de datos; 9-15 con datos reales. Cero UUIDs/SQL/errores técnicos.
