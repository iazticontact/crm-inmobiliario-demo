# P60 — QA final del Asistente en el chat (cuenta demo Oier, en orden)

Leyenda: **read** = ¿debe leer datos? · Prohibido = respuesta que sería fallo.

## A. Onboarding / product tour
| # | Prompt | Esperado | read |
|---|---|---|---|
| 1 | `soy nuevo usuario` | Bienvenida breve, sin datos | ❌ |
| 2 | `hazme un resumen de todo el CRM para entenderlo empezando desde el Dashboard` | **Tour de módulos** empezando por Dashboard, sin datos | ❌ |
| 3 | `¿cómo? te he pedido resumen` | Aclara conceptual vs datos (no lista) | ❌ |
| 4 | `no leas datos, explícame el producto` | Explica producto | ❌ |
| 5 | `no sé cómo va esto` | Onboarding | ❌ |

## B. Resumen conceptual vs datos
| 6 | `hazme un resumen` | Pregunta: ¿entender el CRM o tus datos? | ❌ |
| 7 | `resumen del día con mis datos` | Datos del día | ✅ |
| 8 | `ahora sí, muéstrame mis tareas` | Lista tareas | ✅ |

## C-D. Dashboard / Cartera / Ventas
| 9 | `¿qué muestra el dashboard?` | Explica | ❌ |
| 10 | `¿tengo algún inmueble publicado?` | Publicados, criterio explícito | ✅ |
| 11 | `¿cuántos he vendido?` | Cartera 6 + Operaciones 7 | ✅ |
| 12 | `en cartera o en operaciones` | Ambas cifras | ✅ |
| 13 | `no te he preguntado por operaciones, te he preguntado por cartera` | Solo Cartera (6) | ✅ |
| 14 | `muéstrame los vendidos` | Inmuebles vendidos + menciona ops | ✅ |
| 15 | `acabo de editar, mira otra vez` | Relee en vivo | ✅ |

## E-H. Clientes / tareas / correcciones / facturación
| 16 | `muéstrame los clientes` | Lista | ✅ |
| 17 | `qué tareas tengo` | Pendientes | ✅ |
| 18 | `no listes datos` | Repara, no lista | ❌ |
| 19 | `¿qué facturas tengo?` | Redirige a Facturación | ❌ |
| 20 | `explícame Facturación` | Explica (no lee invoices) | ❌ |

**Prohibido global:** onboarding/resumen conceptual que liste tareas/operaciones · «no consta ninguna
operación vendida» con 7 ganadas · «fallo temporal» si una fuente responde · status crudos (`sold`,`won`,
`listed`) · UUID/SQL · leer facturas desde el Asistente. Usar la MISMA cuenta en chat y UI (P56B).
