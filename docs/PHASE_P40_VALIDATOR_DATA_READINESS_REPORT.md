# FASE P40 — Validator Data Readiness (datos de prueba, recorrido demo, QA y fix UX numérica)

> **Fecha:** 2026-07-03 · Preparar el CRM para **enseñarlo/probarlo** con datos coherentes y un recorrido
> impecable. Se auditaron los datos reales del workspace de demo (suficientes → **sin seed**), se **corrigió
> un dato embarazoso** de la empresa, se crearon los **guiones de validación** (demo + validador + móvil) y
> se resolvió el **bug de UX de los inputs numéricos** de Facturación (addendum). **Sin n8n, sin
> Asistente-facturas, sin migraciones de esquema, sin cambios destructivos.**

---

## 1. Baseline
`main`, árbol **limpio**, último commit **P39 `d41e30e`**.

## 2. Datos auditados (workspace de demo)
Recuento real (BD): **clientes 9 · inmuebles 8 · operaciones 8 · trámites 5 · tareas 11 · citas 12 ·
documentos (entity_files) 3 · facturas 3 · configuración 1**. Facturas con estados variados
(emitida / cancelada / borrador). Inmuebles de tipos distintos (piso, ático, chalet, adosado, local). Nombres
de cliente **realistas** (Familia Soler, Lucía Herrera, Inversiones Atlántico SL…).

## 3. Datos suficientes → sin seed (pero con una corrección)
Todos los mínimos de validación están **cubiertos o superados** → **no se creó seed** (evita ensuciar la BD).
**Corrección de calidad (BD, no destructiva):** la configuración de empresa tenía datos embarazosos que
aparecen en el **PDF de factura** (bloque emisor):
- `contact_email`: `hola@pene.es` → **`hola@inmobiliariacostaazul.es`**.
- `fiscal_address`: `Prueba` → **`Gran Vía 12, 3º izq.`**.
- Inconsistencia `postal_code=32001` (Ourense) / `province=Vizcaya` con `city=Bilbao` → **`48001` / `Bizkaia`**.
- Se completaron `phone` y `website` con valores profesionales.
Es una **actualización de metadata** del workspace demo (additiva, reversible), no un cambio de esquema.

## 4. Recorrido demo
Nuevo **`docs/CRM_VALIDATOR_DEMO_SCRIPT.md`** — guion comercial de **15–20 min** (Dashboard → Clientes →
Documentos → Cartera → búsqueda por presupuesto → Asistente → Calendario → Facturación crear/emitir/PDF →
Papelera → Configuración), con «qué mostrar / qué se ve / qué decir» por paso y una lista de «qué NO debería
pasar».

## 5. Checklist de validador
Ya existía **`docs/VALIDATOR_QA_CHECKLIST.md`** (P39), con cómo reportar fallos (captura, dispositivo, texto
exacto, resultado esperado vs visto). Se mantiene como guía de reporte.

## 6. Checklist mobile
Nuevo **`docs/MOBILE_QA_CHECKLIST.md`** — pack de QA móvil (iPhone 390 / Android 360): reglas generales
(16px, sin scroll horizontal, drawer), y por pantalla (login, dashboard, clientes/documentos, cartera,
calendario, asistente, **facturación** incl. inputs numéricos y descarga de PDF, configuración).

## 7. Fix UX inputs numéricos de Facturación (ADDENDUM)
- **Causa:** los inputs estaban controlados con un **número**; al borrar el `0`, el `onChange` reconvertía a
  `0` de inmediato → no se podía vaciar ni escribir con libertad (solo con las flechas).
- **Solución (reutilizable):** nuevo componente **`DecimalInput`** (`type="text"` + `inputMode="decimal"`)
  con **estado local de texto** durante la edición: permite vacío temporal y coma/punto decimal; los cálculos
  reciben `0` cuando está vacío (sin NaN); al **perder el foco** normaliza a número (vacío → `0`/`min`) y
  aplica límites. Lógica pura en `src/lib/invoicing/decimal.ts` (`parseDecimal`/`isEditingDecimal`/
  `clampNumber`/`formatDecimal`).
- **Campos corregidos:** **Cantidad, Precio, Dto. % (0–100), IVA %, IRPF %** del editor de factura. El
  **tipo de cambio** ya permitía vaciarse (mapea vacío → `null`) y mantiene su guardrail (`>0` para emitir),
  así que no requería cambio.
- **IVA por defecto:** las líneas nuevas siguen naciendo con **21%** (no cambia); pero ahora el usuario
  **puede borrarlo y escribir 0** u otro valor. Presets (datalist 21/10/4/0 · IRPF 0/7/15/19) intactos.
- **Cálculos/preview/PDF:** estables con campos vacíos (se tratan como 0); **eval anti-NaN** en el PDF pasa.
- **Móvil:** teclado decimal, 16px (sin auto-zoom), edición con libertad.

## 8. Bugs encontrados / corregidos
1. **Dato embarazoso** en la empresa demo (email/dirección) → corregido en BD (§3).
2. **UX inputs numéricos** de Facturación (no se podía borrar el 0) → corregido con `DecimalInput` (§7).

## 9. No regresiones
Evals: **calc, parse, pdf, summary, decimal, pdf-nan → PASS**. Asistente aislado de facturas (0
`from('invoices')`, `get_invoices_summary=not_available`). Documentos sobre `entity_files` (0
`from('documents')`). **n8n intacto.**

## 10. Scans
`from('documents')` **0** · `from('invoices')` Asistente **0** · `service_role` frontend **0** · `@ts-ignore`
**0** · marca legacy visible **0**. (Verificado en P37–P39; sin regresión.)

## 11. Validaciones
`npx tsc --noEmit` **OK** · `npm run lint -- --max-warnings=0` **OK** · `npm run build` **OK** ·
`node --check scripts/check-agent-deploy.mjs` **OK** · evals **PASS** (incl. `decimal` y anti-NaN) ·
`git status` limpio tras commit.

## 12. Archivos tocados
- **Nuevos:** `src/lib/invoicing/decimal.ts`, `src/components/invoicing/DecimalInput.tsx`,
  `src/lib/invoicing/__evals__/decimal.evals.ts`, `docs/CRM_VALIDATOR_DEMO_SCRIPT.md`,
  `docs/MOBILE_QA_CHECKLIST.md`, `docs/PHASE_P40_VALIDATOR_DATA_READINESS_REPORT.md`.
- **Modificado:** `src/components/invoicing/InvoiceEditor.tsx` (5 inputs numéricos → `DecimalInput`).

## 13. Migraciones
**Ninguna de esquema.** Solo una **corrección de datos** (metadata de `workspace_settings` del workspace
demo), additiva y reversible.

## 14. Qué NO se hizo
No seed automático (datos ya suficientes); no se tocó Facturación salvo el fix de inputs; no se tocó
Asistente-facturas, n8n, emails, OCR, import/export ni RLS.

## 15. Commit / 16. Push
Ver `fix(p40)` en `main` (push a `origin/main`).

## 17. Pendientes honestos
- **QA manual con dispositivo real** siguiendo `MOBILE_QA_CHECKLIST.md` y `CRM_VALIDATOR_DEMO_SCRIPT.md`.
- Revisar emails/datos de **clientes** demo por si alguno tuviera valores de prueba poco profesionales
  (se revisaron los nombres —correctos—; los emails no se auditaron uno a uno).
- Documentos avanzados y persistir informes del Asistente en `entity_files` — mejoras futuras, no bugs.

## 18. Veredicto
**P40 COMPLETADO — VALIDATOR DATA READINESS: CRM LISTO PARA ENSEÑARSE Y PROBARSE CON GUION DEMO (15–20 MIN),
CHECKLISTS DE VALIDADOR Y MÓVIL, DATOS DE EMPRESA CORREGIDOS (SIN DATOS EMBARAZOSOS) Y EL BUG DE UX DE LOS
INPUTS NUMÉRICOS DE FACTURACIÓN RESUELTO (SE PUEDE BORRAR EL 0 Y ESCRIBIR CON LIBERTAD). SIN REGRESIONES,
N8N INTACTO.**
