# P46 — COMISIONES ULTRA SIMPLE + GUIDED FEEDBACK UX

**Estado:** COMPLETADO
**Fecha:** 2026-07
**Alcance:** simplificar la pantalla de Comisiones (flujo visual por estados, filtros, KPIs claros, acciones no ambiguas) y añadir guía contextual (ADDENDUM Guided Feedback UX). Sin rediseño del CRM, sin n8n, sin Asistente-write, sin migraciones.

Objetivo: que el usuario **no tenga que pensar**. En 5 segundos debe saber qué está pasando, qué falta y cuál es el siguiente paso.

---

## 1. Baseline
`main`, árbol limpio, HEAD previo `8e0e6ac` (P45). Sin cambios parciales.

## 2. Diagnóstico UX
- **«Marcar pendiente»** visible en filas facturadas → confuso (¿por qué puedo revertir algo ya facturado?).
- Lista **plana**: pendientes, facturadas y cobradas mezcladas sin prioridad; al emitir una factura la operación seguía pareciendo pendiente.
- KPIs ambiguos: «Comisión prevista» en cerradas, «Pendiente de cobro» cuando en realidad faltaba **factura**, «Cobrada» sin distinguir con/sin factura.
- Acciones técnicas en vez de «el siguiente paso lógico».

## 3. Nuevo modelo visual (buckets + prioridad)
Helper **puro** [commission-cta.ts](../src/lib/invoicing/commission-cta.ts) clasifica cada operación en un **bucket** y la pantalla agrupa por bucket en orden de prioridad:
`Pendiente de facturar` → `Cobradas sin factura` → `Borradores` → `Facturadas · pendiente de cobro` → `Facturas canceladas` → `Cobradas` → `Potenciales`.
Cada grupo tiene cabecera + recuento; solo se muestran los grupos con filas.

## 4. Filtros / vistas
Pestañas dentro de Comisiones: **Por hacer · Facturadas · Cobradas · Potenciales · Todas** (con recuento).
- **Por hacer** = lo que necesita acción: pendiente de facturar + cobrada sin factura + borrador + facturada pendiente de cobro (+ cancelada).
- **Facturadas** = borradores + emitidas pendientes de cobro. **Cobradas** = facturas pagadas. **Potenciales** = abiertas. **Todas** = todo.
- Reemplaza el antiguo toggle «Incluir abiertas» (las abiertas viven ahora en «Potenciales»/«Todas»).

## 5. KPIs / resumen
Cabecera de 4 KPIs, derivados en vivo (se actualizan solos al crear/emitir/pagar/cobrar/cancelar):
1. **Pendiente de facturar** — «Honorarios cerrados sin factura».
2. **Facturado pendiente de cobro** — «Facturas emitidas no pagadas».
3. **Cobrado** — «Facturas pagadas o cobros registrados».
4. **Potencial abierto** — «Honorarios estimados no cerrados».
Sin doble conteo: un **cobro interno sin factura** cuenta en «Cobrado» (dinero recibido) pero NO en «Pendiente de facturar»; sigue apareciendo en «Por hacer» para regularizar. El precio del inmueble nunca suma.

## 6. Matriz final de acciones (una acción principal por fila)
| Estado (bucket) | Chip | Acción principal | Menú «Más» |
|---|---|---|---|
| Pendiente de facturar | Pendiente de facturar | **Crear factura** | Registrar cobro interno |
| Cobrada sin factura | Cobrada sin factura | **Crear factura del cobro** | Deshacer cobro interno |
| Borrador | Borrador de factura | **Abrir borrador** | — |
| Facturada · pdte. cobro | Facturado · pendiente de cobro | **Abrir factura** | — |
| Cobrada (con factura) | **Cerrado · cobrado** | **Ver factura** | — |
| Factura cancelada | Factura cancelada | **Abrir factura** | — |
| Potencial | Potencial | — (Ver operación al pulsar la fila) | — |

Con factura vinculada **nunca** reaparece «Crear factura» (anti-duplicados). El estado oficial de la factura manda sobre el cobro interno.

## 7. «Marcar pendiente» → «Deshacer cobro interno»
Ya no es botón visible. Se mueve al menú **«Más» (⋯)** solo para «Cobrada sin factura», con confirmación breve: *«Esto solo cambia el control interno de comisiones. No modifica facturas emitidas.»* No aparece cuando hay factura pagada.

## 8. «Registrar cobro» → «Registrar cobro interno»
Texto y modal aclarados: *«No genera factura: para el documento oficial, créala en Facturación.»* Tras registrarlo → estado «Cobrada sin factura» + acción «Crear factura del cobro». Toast: *«Cobro interno registrado. Falta crear la factura oficial…»*.

## 9. Flujo tras emitir factura
Emitir desde una comisión saca la operación de «Pendiente de facturar» y la lleva a **«Facturadas»** (acción «Abrir factura»). Marcarla cobrada → **«Cobradas»** con chip verde **«Cerrado · cobrado»**. Verificado por los KPIs (derivados) y las evals de deltas.

## 10. Cliente detail
La ficha de cliente usa la **misma** matriz (`resolveCommissionState`) + descripciones + gating + `returnTo=/clients/<id>`; muestra chip «Cerrado · cobrado» en pagadas; sin «Marcar pendiente»; sin parpadeo (P45).

## 11. Facturación — no regression
Sin cambios de módulo. Se añadió **guía de siguiente paso** (no toca la lógica): banner en el editor «Pendiente de cobro / Cobrada» y botón **«Marcar cobrada»** para facturas emitidas. `returnTo` y anti-parpadeo intactos.

---

## Guided Feedback UX (ADDENDUM)
El CRM responde a *¿qué pasa? · ¿qué falta? · ¿siguiente paso?*:
- **Explicación por estado** (visible bajo cada fila), p. ej. *«La factura está emitida. Falta registrar el cobro en Facturación.»* — mapa `COMMISSION_BUCKET_DESCRIPTION`.
- **Progreso del ciclo**: «Paso 1/2/3 de 3» por operación — mapa `COMMISSION_BUCKET_STEP`.
- **Panel «Qué falta por hacer»** arriba de la lista, con recuentos humanos o «Todo al día».
- **Estado final «Cerrado»**: chip verde + «Factura pagada. No queda ninguna acción pendiente.» solo cuando la factura está pagada (`isEconomicallyClosed`).
- **Toasts humanos**: emitir → «…Ahora queda pendiente de cobro»; marcar cobrada → «…operación cerrada económicamente»; cobro interno → «…Falta crear la factura oficial»; deshacer → «…No modifica facturas emitidas».
- **Empty states guiados** por filtro (`COMMISSION_EMPTY_COPY`).
- **Errores humanos** al crear factura (sin cliente / sin honorarios / operación no encontrada / ya existe factura) vía la pantalla de preparación de Facturación (P45).
- **Guía «¿Cómo funciona?»** (modal de 4 pasos + nota «El IVA se aplica sobre honorarios, no sobre el precio del inmueble»).

## 12. Tests / Evals
Runner temporal (`npx tsx`, luego borrado) sobre **15 suites puras — TODO VERDE ✅**. `commission-cta` ampliada: matriz completa + buckets + filtros (pertenencia) + resumen (deltas al emitir/pagar, no-doble-conteo, precio del inmueble fuera) + descripciones + pasos + «cerrado económicamente solo si pagada» + «ninguna acción principal es de deshacer».

## 13. Validaciones
| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ 0 warnings |
| `npm run build` | ✅ (49 páginas) |
| `node --check scripts/check-agent-deploy.mjs` | ✅ |
| Evals (15 suites) | ✅ TODO VERDE |
| scans: `documents`=0 · `invoices` Asistente=0 · `router.back`=0 · service_role frontend=0 | ✅ |

## 14. Archivos tocados
**Modificados:** `src/lib/invoicing/commission-cta.ts` (+ evals), `src/app/(saas)/opportunities/page.tsx`, `src/app/(saas)/facturacion/page.tsx`, `src/components/invoicing/InvoiceEditor.tsx`, `src/app/(saas)/clients/[id]/page.tsx`, `docs/VALIDATOR_QA_CHECKLIST.md`. **Nuevo:** este informe. **Migraciones:** 0.

## 15. Qué NO se hizo (respetado)
No n8n · no Asistente leyendo/creando facturas · no service_role frontend · no secretos · no OCR/emails/import-export/pasarelas/Verifactu/TicketBAI · no migraciones · no rediseño del CRM · no nuevo sistema contable · no auto-sync frágil · no duplicar Facturación · el precio del inmueble nunca es ingreso.

## 16. Pendientes honestos
- Móvil verificado por estructura (filtros scrollables, filas como cards, acción principal + «Más», sin overflow); sin QA en dispositivo físico.
- El menú «Más» es un dropdown propio ligero (cierre por backdrop); no se introdujo librería de menús.
- El gating de Facturación PRO sigue por feature flag de build (P45), no por entitlement por-workspace.

---

**P46 COMPLETADO — COMISIONES ULTRA SIMPLE: POR HACER / FACTURADAS / COBRADAS / POTENCIALES, ACCIONES CLARAS, DASHBOARD ACTUALIZADO Y CERO CONFUSIÓN ENTRE COBRO INTERNO Y FACTURA OFICIAL — con Guided Feedback UX (estado, qué falta y siguiente paso en cada fila).**
