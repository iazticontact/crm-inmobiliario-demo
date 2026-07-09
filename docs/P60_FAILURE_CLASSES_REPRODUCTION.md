# P60 — Reproducción de clases de fallo (no frases)

Contra el contrato real (`decideTurn`) + gate de ventas, ANTES del fix:

| Clase | Ejemplo | Antes | Después |
|---|---|---|---|
| Resumen conceptual leído como datos | «Hazme un resumen de todo el CRM para entenderlo empezando desde el Dashboard» | **data_read** | onboarding/tour, **no lee** |
| Resumen «para entender» | «resumen para entender el CRM» | data_read | onboarding, no lee |
| Resumen ambiguo | «hazme un resumen» | data_read | **aclara** (conceptual vs datos), no lee |
| Learning no reconocido | «no sé cómo va esto», «me han dado la cuenta para probar», «estamos valorando comprar» | ambiguous→n8n | onboarding, no lee |
| Resumen operativo | «resumen del día con mis datos», «qué tengo pendiente hoy» | data_read (ok) | data_read (se mantiene) |
| Ventas transversal | «cuántos he vendido» | (P58) local ambas fuentes | se mantiene |
| Seguimiento de alcance | «en cartera o en operaciones» (tras ventas) | n8n | **sales, ambas** (fix P60) |
| Corrección | «no te he pedido eso», «te has liado» | meta/correction, no lee | se mantiene |

## Causa raíz global
Keywords débiles («resumen», «dashboard», «vendido», «tareas») podían **secuestrar la intención**: si no
había una capa que separase *entender* de *consultar*, el mensaje caía en data_read o en n8n (que
alucinaba). P60 añade la capa `summary-intent` + `learning context` con prioridad correcta
(META > guía > resumen/learning > datos), de modo que **el acto comunicativo manda sobre la keyword**.

## Harness
`scripts/assistant-conversation-harness.mts` ejecuta 5 conversaciones multi-turn (onboarding, conceptual
vs datos, cartera, ventas transversal, correcciones) contra el mismo contrato de la route + gate de ventas.
Resultado: **TODO PASS**.
