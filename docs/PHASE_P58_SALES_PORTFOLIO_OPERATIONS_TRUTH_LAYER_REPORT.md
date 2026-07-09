# P58 — SALES / PORTFOLIO / OPERATIONS REAL-TIME TRUTH LAYER

**Estado:** ✅ CODE COMPLETE / ⛔ UI QA PENDING (tarjeta de 15 prompts lista)
**Fecha:** 2026-07-09

## 1-2. Baseline + reproducción
`main` limpio, HEAD `e07b531` (P56B). Reproducción en `P58_LIVE_SALES_FAILURE_REPRODUCTION.md`: 14 frases de
ventas caían a n8n (`entity=unknown`/`turn=ambiguous`) → alucinación «no consta ninguna operación vendida»
y «fallo temporal» al combinar cartera+operaciones.

## 3. Auditoría de fuentes de verdad (`P58_SALES_SOURCE_OF_TRUTH_AUDIT.md`)
- Cartera: `properties.status` → **6 sold**, 1 rented, 1 listed (demo).
- Operaciones: `opportunities.stage` → **7 won**, 1 lost. No hay `outcome`/`operation_type` en la operación.
- Reconciliación: 6 won↔sold/venta coherentes + **1 won sin inmueble** → discrepancia legítima (7 vs 6).
- `ventas ≠ operaciones`, `vendidos ≠ properties`: dos fuentes, se consultan ambas y se reconcilian.

## 4. Causa raíz
`parseStatusIntent` (P56) solo corría dentro de `handleProperties`, alcanzable solo con vocab de módulo.
«Vendido/ventas/he vendido» sin vocab → `unknown`/`ambiguous` → n8n. **No era Cartera: era una clase
transversal** sin capa propia.

## 5. Solución de dominio (no parche de frase)
- **`src/lib/sales-domain.ts`** (nuevo, PURO): `parseSalesIntent` decide **scope**
  (`portfolio_only` / `operations_only` / `both`), **metric**, **operationType**, y flags
  (`asksCount/List/YesNo/Explanation`, `forceLiveRead`, `explicitCurrentMessageWins`). Solo dispara con
  formas de RESULTADO (`vendido/vendí/ventas/alquilado/operación ganada|cerrada`), nunca proceso
  (`vender/vendo`). Corrección de alcance («te he preguntado por cartera») solo con contexto de ventas
  previo, con negación que no cruza la coma. `SALES_DIFFERENCE_EXPLANATION` (inmueble vendido vs op. cerrada).
- **`handleSales`** (`local-answers.ts`): lee Cartera (`status=sold/rented`) y Operaciones (`stage=won`)
  según scope, **en vivo** (`crmReadQuery`, RLS, nunca `lastResults`), y responde con **las dos cifras** y
  criterio honesto. **Fallback PARCIAL**: si una fuente falla y otra responde, da la parcial (nunca el
  «fallo temporal total»). Todo 0 → «de momento no consta nada vendido…», nunca alucina.
- **Gate** en `tryLocalAnswer`: se evalúa ANTES del enrutado por entidad para turnos
  `data_read/data_followup/ambiguous` (nunca meta/guía/social/corrección; nunca Facturación).

## 6-8. Cartera / búsqueda / respuestas
Catálogo y `real-estate-search` intactos (Malasaña, m²/habs/baños, precio siguen por eval). «Vendido» ya no
secuestra búsquedas por características. Estados con etiqueta ES (nunca `sold`/`won` crudos).

## 9-12. Contexto / n8n / strict / scans
- Contexto: corrección de alcance re-consulta la fuente correcta sin arrastre.
- n8n **sin tocar** (sus tools llaman al endpoint, que lee lo corregido). Strict re-verificado EN VIVO
  **7/7**. Reader `properties` con `soft:true` (P56B) → reconciliación UI=Asistente.
- Scans: `documents`=0 · `invoices` agents=0 · sin secretos · **0 migraciones**.

## 13. Evals
Nueva **`sales-domain.evals.ts`** (14 frases capturadas localmente, scope/metric/opType, actos,
correcciones con/ sin contexto, sin falsos positivos, fresh-read). **31 suites TODO VERDE** · tsc/lint/
build/gate ✅.

## 14-16. Archivos / migraciones / qué NO
**Nuevos:** `sales-domain.ts`, su eval, 3 docs + QA card. **Modificado:** `local-answers.ts`
(gate + `handleSales`). **0 migraciones.** No se tocó n8n, strict, Facturación, arquitectura,
`real-estate-search`, `portfolio-domain`.

## 17-19. Riesgos / validación
Riesgo: heurística de ventas; lo no cubierto cae a búsqueda/entidad normal (nunca inventa). Ejecutar
`P58_SALES_QA_CARD.md` con la **cuenta demo** (críticos #1, #2, #8, #11/#12, #13). Recordatorio P56B:
misma cuenta en chat y UI.

---

**P58 CODE COMPLETE — «VENDIDO/VENTAS» COMO DOMINIO TRANSVERSAL: CARTERA (status=sold) + OPERACIONES
(stage=won) LEÍDAS EN VIVO, DOS CIFRAS RECONCILIADAS, FALLBACK PARCIAL (NUNCA «FALLO TEMPORAL» SI UNA
FUENTE RESPONDE), SCOPE/CORRECCIÓN HONESTOS Y CERO ALUCINACIÓN. 31 SUITES VERDES + STRICT 7/7 EN VIVO. /
UI QA PENDING (tarjeta de 15 prompts).**
