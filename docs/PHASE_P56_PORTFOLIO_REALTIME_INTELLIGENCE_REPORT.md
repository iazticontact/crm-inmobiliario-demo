# P56 — CARTERA / INMUEBLES REAL-TIME INTELLIGENCE V2

**Estado:** ✅ CODE COMPLETE / ⛔ UI QA PENDING (tarjeta de 20 prompts lista)
**Fecha:** 2026-07

## 1-3. Baseline + auditoría
`main` limpio, HEAD `91cb54a` (P55). Auditoría completa en `P56_PORTFOLIO_DATA_MODEL_AUDIT.md`:
- **La publicación EXISTE vía `status`**: `listed` = «Publicado» en la UI (también `prospecting`=«En
  preparación», `under_contract`=«Reservado», `sold/rented/archived`=cerrados). NO hay campo aparte ni
  portales — no se promete.
- Vendido/alquilado/reservado dependen de `status`. `updated_at` cambia al editar; el endpoint es
  `force-dynamic` (lecturas siempre vivas).

## 4-6. Causa raíz y fixes
**Causa raíz** del fallo de referencia: «¿tengo algún inmueble publicado?» no se mapeaba a
`status='listed'` → caía en la búsqueda por SIMILITUD → «No hay inmuebles que cumplan todos los criterios.
Lo más cercano…» (sin criterio, con alternativas sin sentido). Y «no entiendo» podía heredar un módulo
equivocado (alias más largo de TODO el hilo).

**Fixes (generales, sin hardcodear la conversación):**
1. **`src/lib/portfolio-domain.ts`** (nuevo, PURO): `normalizePropertyState` (estado crudo → semántica +
   etiqueta en español, nunca raw), `parseStatusIntent` (publicados/sin publicar/vendidos/alquilados/
   reservados/disponibles/cerrados/recientes/todos), `matchesStatusIntent` (vendido ∉ disponibles/
   publicados; reservado no libre; histórico = cerrados), `isBinaryStateQuestion` (prohíbe «lo más
   cercano»), `STATUS_INTENT_LABEL` (criterio siempre explicado).
2. **`local-answers.handleProperties`**: si hay intención de estado → lectura viva por `crmReadQuery`
   filtrada por la semántica, respuesta con **criterio explícito** («criterio: estado = Publicado»),
   etiqueta de estado por inmueble, **sin** parciales/«lo más cercano»; vacío honesto con el criterio +
   alternativa. La búsqueda por características (Malasaña, m²/habs/baños, precio) sigue igual.
3. **Lectura fresca (`decideTurn` P56)**: «mira otra vez / revisa / acabo de editar / cambios recientes» →
   `data_read` en vivo (antes la pragmática lo tragaba como confirmación del resultado en caché).
4. **Contexto**: el módulo del hilo sale del **último** mensaje que nombra uno (no del alias más largo de
   toda la conversación) → «no entiendo» tras Cartera se queda en Cartera, no salta a Operaciones.
5. **Catálogo**: Cartera ahora lista los estados reales y aclara que «Publicado» es el estado en cartera
   activa (sin portales externos).

## 7-9. «No entiendo» / correcciones / recientes
- «no entiendo esa respuesta» (priorModule portfolio) → user_confused, módulo portfolio, sin lectura ✔ eval.
- «no te he pedido que busques…» → corrección/meta, sin lectura, sin repetir ✔ eval.
- «recientes» → orden por `updated_at desc` ✔.

## 10-12. n8n / strict / UI
n8n **sin tocar** (sus tools llaman al endpoint, que usa los readers corregidos). Strict re-verificado EN
VIVO: **7/7 OK**. UI de crear/editar ya persiste estado/precio/m²/habs/baños (P47) y `updated_at` cambia →
la lectura fresca ve los cambios.

## 13-15. Evals / runner / scans
Nueva **`portfolio-domain.evals.ts`** (normalización, intención, vendido∉disponible, binario sin cercanos,
fresh-read, no-entiendo mantiene Cartera, sin raw status). **30 suites TODO VERDE** · QA runner **TODO
PASS** · tsc/lint/build/gate ✅ · `documents`=0 · `invoices` agents=0 · sin secretos · 0 migraciones.

## 16-19. Archivos / qué NO / riesgos / validación
**Nuevos:** `portfolio-domain.ts`, su eval, auditoría, QA card, este informe. **Modificados:**
`assistant-turn.ts` (fresh-read), `local-answers.ts` (status-handler + priorModule último mensaje),
`crm-module-catalog.ts` (Cartera fiel). **No se tocó:** n8n, strict, Facturación, real-estate-search
(features intactas), arquitectura. **Riesgo:** heurística de intención de estado; lo no cubierto cae a la
búsqueda normal o a aclaración (nunca inventa publicación). **Validar:** `P56_PORTFOLIO_REALTIME_QA_CARD.md`
(20 prompts; críticos #4, #7, #15, #16, #17).

---

**P56 CODE COMPLETE — PUBLICACIÓN REAL VÍA STATUS (listed=Publicado), ESTADOS HONESTOS (vendido≠disponible),
CRITERIO SIEMPRE EXPLICADO, SIN «LO MÁS CERCANO» EN PREGUNTAS DE ESTADO, LECTURA FRESCA FORZADA Y CONTEXTO
QUE NO SALTA DE MÓDULO. 30 SUITES VERDES + STRICT 7/7 EN VIVO. / UI QA PENDING (tarjeta lista).**
