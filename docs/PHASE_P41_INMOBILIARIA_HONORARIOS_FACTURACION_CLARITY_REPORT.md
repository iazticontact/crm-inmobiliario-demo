# FASE P41 — Claridad inmobiliaria: honorarios/comisiones vs facturación, IVA y cobros

> **Fecha:** 2026-07-03 · Objetivo: que una inmobiliaria entienda de forma **ultra simple** la diferencia
> entre **honorarios/comisión de operaciones** y **facturación oficial**, y que el **IVA se aplica sobre los
> honorarios, no sobre el precio del inmueble**. Fase de **claridad (copy/UX) + evals**, no de features
> grandes. **Sin n8n, sin Asistente-facturas, sin migraciones, sin cambios destructivos.**

---

## 1. Diagnóstico
- **Esquema (auditado):** `opportunities` ya tiene `value`, `commission_rate`, `commission_paid_amount/at/
  status` y `stage`; `invoices` ya tiene `opportunity_id`/`property_id`. Modelo suficiente; **no hacen falta
  migraciones**.
- **Dashboard principal (operaciones):** ya distingue bien **Comisión cobrada**, **Pendiente de cobro** y
  **Potencial abierto** (etiquetado como *orientativo/potencial*, no como «ganado»). No inducía a pensar que
  la inmobiliaria cobra el precio total de la vivienda. Copy correcto → **no se tocó**.
- **Gaps reales de claridad:** (a) faltaba el mensaje **IVA-sobre-honorarios-no-precio** en Facturación;
  (b) el Asistente remitía la creación de facturas a Facturación pero sin dejar claro que **sí** puede con
  honorarios/comisiones; (c) el resumen financiero no explicitaba que el IVA es sobre la base.

## 2. Modelo conceptual aplicado (copy/UX/docs)
- **Precio del inmueble ≠ honorarios de la inmobiliaria.** La factura es por los honorarios/comisión.
- **Honorarios + IVA = total de la factura.** (Ej.: vivienda 250.000 € · honorarios 3% = 7.500 € · IVA 21% =
  1.575 € · **factura = 9.075 €**.)
- **Operación cerrada ≠ factura emitida.** **Factura emitida ≠ factura cobrada.**
- **Operaciones** = origen comercial de los honorarios (control interno). **Facturación** = documentos
  oficiales, IVA y cobros. No se duplican.

## 3–4. Operaciones / honorarios
Sin cambios de datos ni de estados (el dashboard ya diferencia estimado/potencial · cerrado · cobrado). Se
mantiene el mapeo existente: operación abierta → **potencial**; cerrada con comisión → **pendiente de
cobro**; comisión marcada cobrada → **cobrada**. Documentado, sin tocar datos.

## 5. Relación operación → factura
`invoices.opportunity_id` **ya existe** y `InvoiceFormData` admite `opportunityId`/`propertyId`. **No se
implementó** el botón «Crear factura de honorarios» con prellenado cross-route en esta fase (sería una
feature: pasar contexto de la operación a `/facturacion`). Queda **documentado como siguiente paso** con la
especificación de prellenado (cliente · inmueble · operación · concepto «Honorarios de intermediación
inmobiliaria» · base = comisión · IVA 21% · total = base + IVA · EUR · serie A). No se crea migración.

## 6–7. Aviso IVA / honorarios (implementado)
En el **editor de factura** (sección Conceptos) se añade un aviso claro y breve:
> «Factura por tus **honorarios/comisión**, no por el precio del inmueble. El **IVA se calcula sobre los
> honorarios**. Ej.: vivienda 250.000 € · honorarios 7.500 € → factura **7.500 € + IVA**.»

Además, el campo de concepto sugiere (datalist) conceptos inmobiliarios: **«Honorarios de intermediación
inmobiliaria»**, «Comisión por venta/alquiler de inmueble», «Gestión y tramitación», «Asesoramiento
inmobiliario».

## 8. Pagador de honorarios
**No implementado** en esta fase (evita ampliar el modelo/UX sin necesidad). Documentado como mejora futura
opcional (campo operativo vendedor/comprador/arrendador/arrendatario + aviso en alquiler de vivienda habitual).

## 9. Dashboard de operaciones
Sin cambios: ya usa lenguaje claro (Comisión cobrada · Pendiente de cobro · Potencial abierto *orientativo*)
y ya indica que «las facturas, gastos e impuestos se gestionan en el módulo económico».

## 10. Dashboard de Facturación
Microcopy afinado: «Importes orientativos en EUR basados en tus facturas. **El IVA se calcula sobre la base
de cada factura (tus honorarios), no sobre el precio del inmueble.** Revísalos con tu asesor fiscal…».

## 11. Asistente (verificado + copy)
Comportamiento **ya correcto** (probado con `detectAssistantIntent`):
- «¿cuánto he **facturado**?» → intención de factura → **remite al módulo Facturación** (el Asistente no lee
  facturas).
- «¿cuánto he **comisionado**?» / «¿qué **honorarios** tengo pendientes?» → intención **general** → lo
  responde el lector de operaciones (comisiones), **no** facturas.
Se **mejora el copy** de la redirección: «Las facturas, cobros e IVA se gestionan en el módulo Facturación…;
en cambio, **sí** puedo ayudarte con los honorarios/comisiones de tus operaciones (cerrados, pendientes de
cobro y potencial)». **No** se reactivan facturas en el Asistente; **0** `from('invoices')`.

## 12. Copy corregido
- Editor de factura: aviso IVA-sobre-honorarios + placeholder «Honorarios de intermediación inmobiliaria».
- Dashboard de Facturación: IVA sobre la base (honorarios), no sobre el precio.
- Asistente: redirección clara honorarios vs facturación.

## 13. Tests / evals (añadidos)
- **`invoicing.calc`**: caso honorarios — 3% de 250.000 = 7.500; IVA 21% = 1.575; **total 9.075**; y assert de
  que el IVA **no** se calcula sobre el precio del inmueble.
- **`real-estate-search`**: «facturado» → intención invoice (remite); «comisionado»/«honorarios» → **no**
  invoice.
- Suites completas re-ejecutadas → **PASS** (calc, parse, pdf, summary, decimal, real-estate-search,
  capabilities).

## 14. Validaciones
`npx tsc --noEmit` **OK** · `npm run lint -- --max-warnings=0` **OK** · `npm run build` **OK** ·
`node --check scripts/check-agent-deploy.mjs` **OK** · evals **PASS** · scans: `from('documents')`=0,
`from('invoices')` en Asistente=0, `not_available` presente, service_role frontend=0 (solo comentarios) ·
`git status` limpio tras commit.

## 15. Archivos tocados
- `src/components/invoicing/InvoiceEditor.tsx` (aviso IVA/honorarios + datalist de conceptos).
- `src/components/invoicing/InvoiceDashboard.tsx` (microcopy IVA sobre base).
- `src/app/(saas)/assistant/page.tsx` (copy de redirección honorarios vs facturación).
- `src/lib/invoicing/__evals__/invoicing.evals.ts`, `src/lib/__evals__/real-estate-search.evals.ts` (evals).
- **Nuevo:** este informe.

## 16. Migraciones
**Ninguna.** El modelo (comisión en operaciones + `opportunity_id` en facturas) ya existía.

## 17. Qué NO se hizo
- **No** el flujo completo «Crear factura de honorarios» desde la operación (prellenado cross-route) — feature
  documentada como siguiente paso.
- **No** campo «Pagador de honorarios» (documentado como opcional futuro).
- **No** se tocó n8n, Asistente-facturas (sigue aislado), emails, OCR, import/export, RLS ni el dashboard de
  operaciones (ya era claro).

## 18. Commit / 19. Push
Ver `fix(p41)` en `main` (push a `origin/main`).

## 20. Pendientes honestos
- **Factura de honorarios desde la operación** (botón + prellenado) — el mayor valor pendiente; requiere pasar
  contexto a `/facturacion` (query param o store) sin romper el flujo actual.
- **Pagador de honorarios** + aviso en alquiler de vivienda habitual.
- Vincular visualmente en la operación cerrada si ya tiene factura asociada («Factura emitida» + estado).

## 21. Veredicto
**P41 COMPLETADO — CLARIDAD INMOBILIARIA TOTAL: HONORARIOS/COMISIONES (OPERACIONES) Y FACTURACIÓN (FACTURAS,
IVA, COBROS) DIFERENCIADOS DE FORMA ULTRA SIMPLE; AVISO CLARO DE QUE EL IVA SE APLICA SOBRE LOS HONORARIOS, NO
SOBRE EL PRECIO DEL INMUEBLE; ASISTENTE REMITE «FACTURADO» A FACTURACIÓN Y RESPONDE «COMISIONADO» CON
OPERACIONES. SIN REGRESIONES, N8N INTACTO.**
