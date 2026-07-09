# P58 — QA de ventas/vendidos en el chat (cuenta demo Oier, en orden)

Ground truth demo: **6 inmuebles vendidos**, 1 alquilado · **7 operaciones ganadas**.

| # | Prompt | Esperado |
|---|---|---|
| 1 | `¿cuántos he vendido?` | Las DOS cifras: Cartera 6 vendidos (+1 alquilado) · Operaciones 7 ganadas |
| 2 | `¿he vendido algo?` | Sí, resumen de ambas fuentes (no «no consta nada») |
| 3 | `¿tengo algún inmueble vendido?` | Solo Cartera: 6 con estado Vendido |
| 4 | `¿cuántas operaciones he cerrado?` | Solo Operaciones: 7 ganadas |
| 5 | `¿cuántas ventas tengo?` | Ambas cifras |
| 6 | `¿qué pisos he vendido?` | Lista de inmuebles vendidos (etiquetados «Vendido») |
| 7 | `¿qué operaciones están cerradas?` | 7 ganadas |
| 8 | `en cartera o en operaciones no he vendido nada?` | Corrige: sí hay; da ambas cifras |
| 9 | `muéstrame los vendidos` | Lista inmuebles vendidos + menciona operaciones ganadas |
| 10 | `¿qué diferencia hay entre inmueble vendido y operación cerrada?` | Explica la diferencia (no lista) |
| 11 | (tras #4) `no te he preguntado por operaciones, te he preguntado por cartera` | Cambia a Cartera: 6 vendidos |
| 12 | (tras #3) `no te he preguntado por cartera, te he preguntado por operaciones` | Cambia a Operaciones: 7 ganadas |
| 13 | `acabo de cambiar el estado, mira otra vez` | Relee en vivo |
| 14 | `muéstrame los alquilados` | 1 alquilado |
| 15 | `muéstrame los disponibles` | Disponibles (no vendidos) |

**Prohibido:** «no consta ninguna operación vendida» con 7 ganadas · «fallo temporal» si una fuente
responde · fundir 6 y 7 en una sola cifra sin explicar · status crudos (`sold`, `won`).
**Recordatorio:** usar la MISMA cuenta en chat y en la UI (ver P56B); el workspace de gabriel tiene 0 vendidos.
