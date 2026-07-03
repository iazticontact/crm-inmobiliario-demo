# P45 — COMMISSIONS ↔ INVOICING UX INTEGRITY

**Estado:** COMPLETADO
**Fecha:** 2026-07
**Alcance:** integridad UX/producto de la relación Comisiones ↔ Facturación. Sin rediseños, sin n8n, sin Asistente-write, sin migraciones.

Principio rector: **Comisiones y Facturación conectadas, pero no mezcladas.**
- Comisiones = control **interno** de honorarios por operación.
- Facturación = **documentos oficiales** (base, IVA, PDF, cobro).

---

## 1. Baseline
- Rama `main`, árbol limpio (solo `PHASE_P28C…md` preexistente sin trackear).
- Último commit antes de empezar: `95b07db` (P44). Sin cambios parciales.

## 2. Diagnóstico del flicker
`/facturacion?fromOpportunity=…` montaba la página y **renderizaba el listado/dashboard normal** mientras resolvía el prellenado asíncrono (`loadOpportunityInvoicePrefill` + `loadInvoice`, ~1 s). El editor solo se abría **después** (`setEditorOpen(true)`), por lo que durante ese segundo se veía Facturación por debajo. Causa: no existía un estado de «preparación» que suprimiera el listado; el editor es un overlay que llega tarde.

## 3. Solución flujo sin parpadeo (Opción A — estado «prefill loading»)
En [facturacion/page.tsx](../src/app/(saas)/facturacion/page.tsx):
- Nuevos estados `prefillPending` y `prefillError`. Al detectar `fromOpportunity`, la página entra en modo preparación (**no** se renderiza el listado): `if (prefillPending || prefillError) return <pantalla limpia />`.
- Pantalla de carga centrada: **«Preparando factura de honorarios…»** · «Usaremos la comisión de la operación, no el precio del inmueble.» · «Calculando honorarios e IVA…».
- Al resolver: se abre el editor directamente (`prefillPending=false` + `editorOpen=true` en el mismo tick → sin parpadeo).
- Si falla: pantalla de **error humano** + botón que respeta `returnTo` («Volver a Comisiones» / «Volver al cliente») o «Ir a Facturación».
- Sin borrador fantasma (el prellenado sigue siendo temporal, P42). Entrada normal a `/facturacion` intacta. Demo: no entra en modo prefill (muestra aviso de ejemplo).
- Banner contextual dentro del editor: **«Factura de honorarios de una operación inmobiliaria.»** + «El IVA se calcula sobre los honorarios, no sobre el precio del inmueble.» (prop `banner` opcional en `InvoiceEditor`).

## 4. Gating del extra Facturación PRO
- Nuevo flag `invoicing` en [feature-flags.ts](../src/lib/feature-flags.ts) (env `NEXT_PUBLIC_ENABLE_INVOICING`, **default ON / opt-out**, coherente con el sistema existente). Reutiliza la capa de flags; **no** se inventa un sistema de entitlements.
- [Sidebar.tsx](../src/components/Sidebar.tsx): la entrada extra `/facturacion` pasa a `flag: 'invoicing'` → un clon sin el módulo lo oculta con `NEXT_PUBLIC_ENABLE_INVOICING=false`.
- En Comisiones y ficha de cliente, cuando haría falta emitir factura y el flag está **off**: CTA no primario → chip **«Requiere Facturación PRO»** (sin navegación), ayuda: «Para emitir facturas necesitas el módulo Facturación.» No lleva a rutas rotas ni abre editor.

## 5. Matriz de estados Comisiones ↔ Facturación
Centralizada en helper **puro** [commission-cta.ts](../src/lib/invoicing/commission-cta.ts) (`resolveCommissionState`), reutilizado por Comisiones y ficha de cliente:

| Caso | Chip | Acción |
|---|---|---|
| 1 · Cerrada, pendiente, sin factura | Pendiente | **Facturar honorarios** (+ «Aún no hay factura vinculada.») |
| 2 · Cobrada internamente, sin factura | Cobrada · sin factura | **Crear factura del cobro** (+ «El cobro está registrado, pero todavía no hay factura oficial vinculada.») |
| 3 · Borrador vinculado | Borrador de factura | **Abrir borrador** |
| 4 · Emitida / enviada | Facturado · pendiente de cobro | **Abrir factura** |
| 5 · Pagada | **Cobrado con factura** | **Abrir factura** (oculta el cobro interno: `collectedByInvoice`) |
| 6 · Cancelada / anulada | Factura cancelada | **Abrir factura** (+ aviso «crea una nueva si procede») |
| 7 · Operación abierta | Potencial | — (sin CTA de factura) |

Reglas garantizadas: si hay factura vinculada **nunca** aparece «Facturar honorarios» (se abre la existente, anti-duplicados); el estado **oficial** de la factura manda sobre el cobro interno.

## 6. Cambio tras «Registrar cobro»
- «Registrar cobro» es **control interno**: fija `commission_status='cobrada'`, `commission_paid_at`, `commission_paid_amount` y `metadata.commission_note`. No toca facturas.
- Tras cobrar sin factura, el estado pasa a **«Cobrada · sin factura»** y la acción cambia de «Facturar honorarios» a **«Crear factura del cobro»** (con ayuda). Ya no aparece el CTA genérico anterior.
- Si hay factura **pagada** vinculada, prioriza el estado de Facturación → **«Cobrado con factura»** y se ocultan los botones de cobro interno (sin mutar la comisión).

## 7. Diferencia Comisiones vs Facturación en UI
- Comisiones (descripción): «Control interno de honorarios por operación. Las facturas, IVA, PDF y vencimientos se gestionan en Facturación.» + nota: «Una comisión puede estar cobrada internamente y aun así no tener factura vinculada…».
- Facturación (subtítulo): «Documentos oficiales por tus honorarios: base, IVA/IRPF, PDF con tu logo… El seguimiento interno de comisiones se hace en Cartera → Comisiones.»

## 8. Cliente detail
[clients/[id]/page.tsx](../src/app/(saas)/clients/[id]/page.tsx): la fila económica por operación usa la **misma** matriz (`resolveCommissionState`) + gating; el CTA conserva `returnTo=/clients/<id>` y, con la corrección del flicker, abre limpio. Sin CTA incoherente.

## 9. Facturación — no regression
Módulo intacto salvo: pantalla de preparación (nuevo estado), banner contextual y subtítulo. `returnTo` (P44) sin regresión: los únicos `router.push` navegan a `returnTo` validado por `safeReturnTo`. No `router.back()`.

## 10. Tests / Evals
Runner temporal (`npx tsx`, luego borrado) sobre **15 suites puras — TODO VERDE ✅**. Nueva suite **commission-cta** (17 asserts) cubre los 7 casos + gating (con/sin extra, no bloquea abrir existente) + sin-cliente + «link manda sobre cobro interno» + `collectedByInvoice`. Reutiliza safe-return, economic-cycle, honorarios, billing-state, invoicing, summary, parse, pdf, decimal, real-estate-search, portfolio-filter, assistant (capabilities/reliability/guard).

## 11. Validaciones
| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ 0 warnings |
| `npm run build` | ✅ (49 páginas) |
| `node --check scripts/check-agent-deploy.mjs` | ✅ |
| Evals (15 suites) | ✅ TODO VERDE |

### Escaneos de seguridad
| Escaneo | Resultado |
|---|---|
| `from('documents')` en `src` | 0 |
| `from('invoices')` en `src/lib/agents` | 0 |
| `router.back()` / `location.href/assign/replace` en Facturación | 0 |
| `router.push` en Facturación | solo a `returnTo` validado (sin open redirect) |
| service_role real en frontend | 0 |

## 12. Archivos tocados
**Nuevos:** `src/lib/invoicing/commission-cta.ts`, `src/lib/invoicing/__evals__/commission-cta.evals.ts`, este informe.
**Modificados:** `feature-flags.ts`, `components/Sidebar.tsx`, `components/invoicing/InvoiceEditor.tsx`, `app/(saas)/facturacion/page.tsx`, `app/(saas)/opportunities/page.tsx`, `app/(saas)/clients/[id]/page.tsx`.

## 13. Migraciones
Ninguna. (0 cambios de esquema.)

## 14. Qué NO se hizo (respetado)
No n8n · no Asistente leyendo/creando facturas · no service_role frontend · no secretos · no OCR/emails/import-export/pasarelas/Verifactu/TicketBAI · no migraciones destructivas · no rediseño de Comisiones/Facturación · no duplicar facturas.

## 15. Pendientes honestos
- El gating se resuelve por **feature flag de build** (env), no por entitlement por-workspace en BD. Es la fuente fiable disponible hoy y suficiente para clones; si en el futuro se contrata por workspace, `resolveCommissionState` ya recibe `invoicingEnabled` como parámetro y solo habría que alimentarlo desde otra fuente.
- Móvil verificado por estructura (fila en columna, chips no cortados, sin overflow horizontal); no se hizo QA en dispositivo físico.
- La pantalla de preparación puede mostrar un frame de skeleton del listado antes de activarse (efecto de montaje); nunca el listado poblado. Aceptable y muy por debajo del segundo anterior.

---

**P45 COMPLETADO — COMMISSIONS ↔ INVOICING UX INTEGRITY: SIN PARPADEO AL FACTURAR HONORARIOS, CTA RESPETA FACTURACIÓN PRO, ESTADOS CLAROS TRAS COBRO Y DIFERENCIA COMISIONES/FACTURACIÓN ULTRA SIMPLE.**
