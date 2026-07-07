# P53 — QA en UI/staging (guía de producto + datos)

## Estado: ⛔ QA interactiva de chat NO ejecutada (sesión no-interactiva) — checklist listo

Lo verificable sin chat SÍ está hecho: strict 7/7 contra staging real, 27 suites de evals verdes (incluida
la clase «explicación no lee»), build/lint OK. Falta escribir en el chat real.

## Checklist (20 categorías — copiar/pegar en el chat de staging)
| # | Categoría | Escribe | Esperado | ¿Lee datos? |
|---|---|---|---|---|
| 1 | Usuario nuevo | `soy nuevo, ¿por dónde empiezo?` | Tour por bloques + 1 pregunta | ❌ |
| 2 | Capacidades | `¿qué puedes hacer?` | Explica capacidades | ❌ |
| 3 | Dashboard | `¿qué muestra el dashboard?` | Explica el módulo (catálogo) | ❌ |
| 4 | Cartera | `¿para qué sirve la cartera?` | Explica el módulo | ❌ |
| 5 | Clientes | `explícame el apartado de clientes` | Explica el módulo | ❌ |
| 6 | Trámites | `¿qué es el apartado de trámites?` | Explica el módulo | ❌ |
| 7 | Facturación | `¿cómo funciona la facturación?` | Explica + aclara que no lee facturas | ❌ |
| 8 | Pantalla | `¿qué resume esta pantalla?` | Explica (o pide qué pantalla) | ❌ |
| 9 | No entiendo | `no entiendo` (tras 3-8) | Simplifica el mismo tema, 1 pregunta | ❌ |
| 10 | Corrección/queja | `no me refiero a eso` / `esto está mal` | Recovery, no repite | ❌ |
| 11 | Respuesta anterior | `¿por qué me has dicho eso?` | assistant_meta, explica | ❌ |
| 12 | Lectura clientes | `muéstrame los clientes` | Lista real | ✅ |
| 13 | Lectura inmuebles | `¿qué pisos hay en cartera?` | Lista real | ✅ |
| 14 | Lectura tareas | `lista mis tareas pendientes` | Lista real (fix P51C vivo) | ✅ |
| 15 | Lectura trámites | `¿qué trámites hay abiertos?` | Lista real | ✅ |
| 16 | Follow-up datos | `¿y el de Malasaña?` (tras 13) | Filtra el conjunto | ✅ |
| 17 | Cambio de módulo | tras 13: `¿qué muestra el dashboard?` | Explica dashboard, NO lista pisos | ❌ |
| 18 | Facturación datos | `¿cuánto he facturado?` | Redirige al módulo | ❌ |
| 19 | Ambigüedad | `mmm` | Pide aclaración | ❌ |
| 20 | Social | `hola` / `gracias` | Natural, breve | ❌ |

**Aprobado:** 1-11, 17-20 sin listados; 12-16 con datos reales. Nada de UUID/SQL/errores técnicos.
**Traza:** cada turno emite `[assistant.turn] {turnType, module, shouldReadData…}` en logs del servidor.

> Rellenar con transcript + pass/fail al ejecutarla. Hasta entonces, P53 = CODE COMPLETE / UI QA BLOCKED.
