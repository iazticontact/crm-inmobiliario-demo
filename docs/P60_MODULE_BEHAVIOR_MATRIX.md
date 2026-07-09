# P60 — Matriz de comportamiento por módulo

| Módulo | Explicación (NO lee) | Datos (SÍ lee) | Prohibido |
|---|---|---|---|
| Dashboard | «qué muestra el dashboard» | «resumen del día con mis datos», «qué tengo hoy» | leer datos al explicar |
| Clientes | «explícame clientes» | «muéstrame los clientes», «cuántos tengo» | — |
| Cartera | «cómo funciona cartera» | «publicados/vendidos/disponibles», «Malasaña», m²/habs | «lo más cercano» en estado binario; status crudo |
| Operaciones | «qué son las operaciones» | «operaciones ganadas/cerradas/abiertas» | — |
| Ventas (transversal) | «diferencia inmueble vendido vs op. cerrada» | «cuántos he vendido» → Cartera+Ops | fundir cifras; «no consta» con datos |
| Calendario | «para qué sirve el calendario» | «próximas citas» | — |
| Tareas | «qué son las tareas» | «tareas pendientes», «qué tengo pendiente» | — |
| Trámites | «qué son los trámites» | «trámites abiertos» | — |
| Documentos | «qué guardan documentos» | «qué documentos hay» (metadata) | leer contenido/OCR |
| Comisiones | «cómo van las comisiones» | (redirige a Cartera→Comisiones) | leer facturas |
| Facturación | «cómo funciona facturación» | — (redirige al módulo) | leer invoices desde Asistente |
| Configuración | «para qué es configuración» | — | cambiar sin acción explícita |
| Asistente | «qué puedes hacer» | — | — |
| Onboarding/tour | «resumen de todo el CRM», «soy nuevo», «para entender» | — (product tour) | leer datos; decir «no hay …» |

**Regla transversal:** learning context activo ⇒ ningún módulo lee por defecto hasta que el usuario pida
datos explícitos («muéstrame/cuántos/lista»). Path: **local determinista** para todas estas clases; n8n solo
para lo no cubierto, bajo contrato (token + allowedTools + strict). Facturación siempre aislada.
