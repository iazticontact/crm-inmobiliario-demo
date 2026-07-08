# P56 — QA de Cartera en el chat (staging, en orden)

| # | Prompt | Esperado | ¿Lee? |
|---|---|---|---|
| 1 | `soy nuevo y quiero entender cartera` | Explica Cartera (estados reales) | ❌ |
| 2 | `¿qué muestra el apartado Cartera?` | Explica (menciona estados: Publicado, Reservado…) | ❌ |
| 3 | `¿cómo funciona Cartera?` | Explica | ❌ |
| 4 | `¿tengo algún inmueble publicado?` | Lista con **criterio: estado = Publicado**. SIN «lo más cercano» | ✅ |
| 5 | `¿cuáles no están publicados?` | Activos «En preparación» o «no veo inmuebles con ese criterio» | ✅ |
| 6 | `muéstrame los inmuebles disponibles` | Disponibles (sin vendidos/alquilados) | ✅ |
| 7 | `muéstrame los vendidos` | Solo vendidos, etiquetados «Vendido» | ✅ |
| 8 | `¿hay reservados?` | Solo reservados | ✅ |
| 9 | `muéstrame los inmuebles en venta` | Venta | ✅ |
| 10 | `¿y en alquiler?` | Alquiler | ✅ |
| 11 | `muéstrame los de Malasaña` | Av. San Pedro 66 | ✅ |
| 12 | `pisos de 3 habitaciones, 2 baños y más de 80 m²` | Filtra bien | ✅ |
| 13 | `¿cuáles son los más baratos?` | Ordena/filtra por precio | ✅ |
| 14 | `¿qué inmuebles se han actualizado recientemente?` | Recientes (updated_at) | ✅ |
| 15 | `acabo de editar un inmueble, mira otra vez` | **Relee en vivo** (no caché) | ✅ |
| 16 | `no entiendo esa respuesta` | Explica lo anterior, **se queda en Cartera** | ❌ |
| 17 | `no te he pedido que busques, te pregunté si están publicados` | Repara, no repite la lista mala | ❌ |
| 18 | `¿por qué dices eso?` | Explica su criterio | ❌ |
| 19 | `ahora explícame Clientes` | Cambia limpio a Clientes | ❌ |
| 20 | `gracias` | Cierre natural | ❌ |

**Prohibido:** «lo más cercano» en 4-8 · status crudos (`listed`, `sold`) · saltar a Operaciones en 16-18 ·
«no hay inmuebles que cumplan todos los criterios» sin decir el criterio. Si falla: pega prompt + respuesta.
