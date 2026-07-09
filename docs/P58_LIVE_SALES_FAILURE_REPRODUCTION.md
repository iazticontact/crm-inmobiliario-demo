# P58 — Reproducción del fallo de «vendidos» (contra la lógica real)

`decideTurn` + `classifyIntent` para las frases del transcript (ANTES del fix):

| Frase | turn | entity | dónde caía |
|---|---|---|---|
| Como que no, a ver cuántos he vendido? | data_read | **unknown** | línea 341 → **n8n** (alucina) |
| ¿Cuántos he vendido? | data_read | **unknown** | → n8n |
| ¿He vendido algo? | **ambiguous** | unknown | línea 333 → n8n |
| ¿Cuántas ventas tengo? | data_read | **unknown** | → n8n |
| muéstrame los vendidos | data_read | **unknown** | → n8n (¡ni P56 lo cogía!) |
| ¿Qué pisos he vendido? | ambiguous | properties | → n8n |
| En cartera o en operaciones no he vendido nada? | ambiguous | properties | → n8n → «fallo temporal» |
| No te he preguntado por operaciones, te he preguntado por cartera | ambiguous | operations | → n8n |

## Causa raíz
`parseStatusIntent` (P56) solo corría **dentro de `handleProperties`**, que solo se alcanza si
`classifyIntent` devuelve `properties` (requiere vocab: piso/inmueble/cartera). «Vendido/ventas/he vendido»
**sin** vocab → `entity=unknown` o `turn=ambiguous` → `handled:false` → n8n, que inventaba «no consta
ninguna operación vendida» y, al combinar cartera+operaciones, devolvía un **fallo temporal total**.

## Después del fix (P58)
`sales-domain.parseSalesIntent` se evalúa en el gate de `tryLocalAnswer` para turnos
`data_read/data_followup/ambiguous`, ANTES del enrutado por entidad → las 14 frases se **capturan
localmente** (eval `sales-domain` A), leen Cartera+Operaciones según alcance y responden con datos vivos.
