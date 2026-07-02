# FASE P42 — Factura de honorarios desde operación (prellenado operación → facturación)

> **Fecha:** 2026-07-03 · Conecta **Operaciones** y **Facturación** de forma profesional: desde una operación
> con comisión se crea una **factura de honorarios prellenada** (base = comisión, **no** el precio del
> inmueble), con revisión manual, vínculo `opportunity_id` y **sin duplicados**. **Sin n8n, sin
> Asistente-facturas, sin migraciones, sin cambios destructivos.**

---

## 1. Diagnóstico
El esquema ya tenía todo: `opportunities` con `value`, `commission_rate`, `title`, `stage`, `metadata` y
`property_id`/`client_id`; `invoices` con `opportunity_id`. La pantalla de Operaciones ya calculaba la
comisión (`commissionOf`, 3 modelos: `percent`/`one_month`/`fixed`). **No hacía falta migración.** Faltaba el
puente operación → factura.

## 2. Dónde se añadió el CTA
En **Operaciones → subpestaña Comisiones**, en cada operación con comisión y cliente:
- Si **no** hay factura vinculada activa → botón **«Facturar honorarios»** → `/facturacion?fromOpportunity=<id>`.
- Si **ya** hay factura vinculada → chip **«FAC-… · Estado»** (enlace a Facturación) — **no** ofrece crear otra.
Verificado con datos demo: 5 operaciones «won» con comisión y **0 facturas** vinculadas (p. ej. *Chalet Los
Robles* 560.000 € · 3% → honorarios 16.800 €).

## 3. Cálculo de honorarios
Extraído a una función **pura y compartida** `computeHonorarios` (`src/lib/invoicing/honorarios.ts`), que
`commissionOf` de Operaciones ahora **delega** (una sola fuente, sin divergencia):
- **percent** (venta): `base = precio del inmueble (o value) × commission_rate %`.
- **percent** (alquiler): `base = renta ANUAL (value) × %`.
- **one_month** (alquiler): 1 mensualidad (precio del inmueble = renta mensual).
- **fixed**: `metadata.commission_fixed`.
**La base es SIEMPRE la comisión, nunca el precio del inmueble.** Eval que lo bloquea:
`venta 3% de 250.000 = 7.500` y `!== 250.000`; y `7.500 + IVA 21% = 9.075`.

## 4. Prellenado de factura
`loadOpportunityInvoicePrefill(workspaceId, oppId)` (invoice-repo, bajo RLS) devuelve un **borrador editable**
(no crea nada) con: `client_id`, `property_id`, **`opportunity_id`**, línea única *«Honorarios de
intermediación inmobiliaria · <inmueble>»*, `quantity=1`, `unit_price = honorarios`, **IVA 21%**, IRPF 0,
descuento 0, **EUR**, serie **A**, y nota «IVA calculado sobre los honorarios de la inmobiliaria, no sobre el
precio del inmueble». Abre el **editor** en Facturación (modo creación); **no emite** (pasa por el checklist
pre-emisión existente). El `customer_snapshot` se resuelve en `saveDraft` por `client_id`.

## 5. Navegación (decisión)
**Opción A (prefill temporal por URL)**, no crear borrador hasta que el usuario guarde → **no ensucia** la BD
ni genera borradores fantasma. La página de Facturación lee `?fromOpportunity` una sola vez (guard con `ref`),
limpia el parámetro de la URL (`replaceState`) y abre el editor. Errores humanos si falta cliente/comisión.

## 6. Relación operación ↔ factura
En Comisiones, junto a cada operación: **«Facturar honorarios»** (si no hay factura) o **estado de la
factura** (número + estado, enlace a Facturación). Sin UUIDs ni datos técnicos.

## 7. Aviso IVA/honorarios (editor)
Banner discreto cuando la factura procede de una operación (`opportunityId`): «Factura generada desde una
operación inmobiliaria. La base son tus honorarios/comisión (no el precio del inmueble)». Además del aviso de
IVA-sobre-honorarios ya añadido en P41.

## 8. Prevención de duplicados
Antes de prellenar, `loadOpportunityInvoicePrefill` comprueba si ya existe factura **activa** (no papelera/no
purgada) con ese `opportunity_id`. Si existe → devuelve `{ existing }` y la página **abre esa factura** con un
aviso («esta operación ya tiene una factura vinculada»), en lugar de crear un duplicado. (Las canceladas
siguen visibles como vinculadas; una purgada/eliminada no bloquea una nueva.)

## 9. Dashboard de operaciones
Sin rediseño. La subpestaña Comisiones ahora muestra, por operación, el **puente a facturación** (facturar o
estado de factura), reforzando el ciclo honorarios → factura → cobro sin duplicar el dashboard de Facturación.

## 10. Facturación (no regression)
Las facturas creadas desde operación cuentan igual (llevan `opportunity_id`, que no afecta al resumen). IVA
sigue sobre la base de honorarios. Evals de facturación → **PASS**.

## 11. Asistente / n8n
Intactos. **0** `from('invoices')` en el Asistente; `get_invoices_summary = not_available`; sin
`preparedAction` de factura. Si preguntan por la factura de una operación, se remite a Facturación (P41).
**n8n intacto.**

## 12. Tests / evals
- **`honorarios.evals`** (nuevo): venta 3% de 250.000 = 7.500 (no 250.000); venta sin precio usa value;
  alquiler % sobre renta anual; one_month = 1 mensualidad; fixed; sin comisión → null; factura 7.500 + IVA =
  9.075.
- **8/8 suites** re-ejecutadas → **PASS** (invoicing×4, decimal, honorarios, real-estate-search, capabilities).

## 13. Validaciones
`npx tsc --noEmit` **OK** · `npm run lint -- --max-warnings=0` **OK** · `npm run build` **OK** ·
`node --check scripts/check-agent-deploy.mjs` **OK** · evals **PASS** · scans: `from('documents')`=0,
`from('invoices')` en Asistente=0, `not_available` presente · `git status` limpio tras commit.

## 14. Archivos tocados
- **Nuevos:** `src/lib/invoicing/honorarios.ts`, `src/lib/invoicing/__evals__/honorarios.evals.ts`, este informe.
- **Modificados:** `src/lib/invoicing/invoice-repo.ts` (`computeHonorarios`, `loadInvoiceLinksForOpportunities`,
  `loadOpportunityInvoicePrefill`), `src/app/(saas)/facturacion/page.tsx` (lectura de `?fromOpportunity`,
  `mapInvoiceToForm`, `openInvoiceById`), `src/app/(saas)/opportunities/page.tsx` (CTA + estado de factura +
  `commissionOf` delega), `src/components/invoicing/InvoiceEditor.tsx` (banner de origen),
  `docs/CRM_VALIDATOR_DEMO_SCRIPT.md` (paso 7b).

## 15. Migraciones
**Ninguna.** `invoices.opportunity_id` y las columnas de comisión ya existían.

## 16. Qué NO se hizo
- No se creó un botón de facturar en la ficha de **cliente** (queda en Operaciones/Comisiones, su sitio
  natural); ampliable.
- No se añadió KPI «Pendiente de facturar» en el dashboard principal (evita rediseño; el ciclo se ve en
  Comisiones). Documentado como mejora futura.
- No se tocó n8n, Asistente-facturas, emails, OCR, import/export ni RLS.

## 17. Commit / 18. Push
Ver `feat(p42)` en `main` (push a `origin/main`).

## 18. Pendientes honestos
- **KPI «Pendiente de facturar»** en el dashboard principal (operaciones cerradas con honorarios y sin
  factura activa).
- Botón de facturar honorarios también desde la **ficha de cliente**.
- Marcar la comisión como cobrada automáticamente al pagar la factura vinculada (hoy son controles separados).

## 19. Veredicto
**P42 COMPLETADO — FACTURA DE HONORARIOS DESDE OPERACIÓN: OPERACIONES Y FACTURACIÓN CONECTADAS DE FORMA
PROFESIONAL (PRELLENADO CON BASE = COMISIÓN, NUNCA EL PRECIO DEL INMUEBLE), CON VÍNCULO `opportunity_id`,
ESTADO DE FACTURA EN COMISIONES Y SIN DUPLICADOS. ASISTENTE AISLADO, N8N INTACTO, SIN MIGRACIONES.**
