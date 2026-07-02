# FASE P43 — Total CRM Validator Program (validación apartado por apartado)

> **Fecha:** 2026-07-03 · Revisión del CRM **apartado por apartado** como validador (no como generador de
> features). Se auditó cada módulo, se corrigieron **bugs reales pequeños** y se **cerró el ciclo económico**
> (honorarios → factura → cobro) de forma visual. **Sin n8n, sin Asistente-facturas, sin migraciones, sin
> rediseños.** Honestidad: muchos apartados ya venían validados de P37–P42; aquí se confirma y se cierra lo
> que faltaba.

## 1. Baseline
`main`, árbol **limpio**, último commit **P42 `b613ec9`**.

## 2. Plan por apartados
A ciclo económico · B dashboard · C clientes · D cartera · E operaciones/comisiones · F facturación ·
G documentos · H calendario/tareas/trámites · I Asistente · J configuración · K mobile · L seguridad/scans ·
M datos demo · N documentación.

## 3. Apartado A — Ciclo económico (IMPLEMENTADO)
Se cierra el ciclo **sin mutar la operación** (evita sincronización frágil): el estado se **deriva** de la
factura vinculada con una función pura `billingStateFromInvoice`:
- sin factura → **«Pendiente de facturar»** (+ CTA «Facturar honorarios», P42).
- borrador → **«Borrador de factura»**.
- emitida/enviada/vencida → **«Facturado · pendiente de cobro»**.
- pagada → **«Cobrado»**.
- cancelada/anulada → **«Factura cancelada»**.
En **Operaciones → Comisiones**: el chip de cada operación muestra ese estado con color; y se añade un
**resumen del ciclo** («N pendientes de facturar · N facturadas sin cobrar · N cobradas»). Decisión
documentada: **no** se auto-actualiza `opportunities.paid_amount` al pagar la factura (se muestra el estado
calculado desde la factura, más robusto). Evals nuevos lo cubren (emitida=facturado, pagada=cobrado,
cancelada≠cobrada, sin factura=pendiente).

## 4. Apartado B — Dashboard principal
Auditado: KPIs de comisión ya diferencian **Cobrada / Pendiente de cobro / Potencial abierto (orientativo)**
y no confunden precio del inmueble con honorarios (P41). **Sin cambios** (correcto).

## 5. Apartado C — Clientes
Auditado listado/ficha/documentos. La pestaña **Documentos** usa `EntityDocumentsManager` (`entity_files`,
P37). Datos demo profesionales (§15). **Sin bugs nuevos.** El botón «Facturar honorarios» desde la ficha de
cliente queda como **mejora futura** (hoy vive en Operaciones/Comisiones, su sitio natural; evita duplicados).

## 6. Apartado D — Cartera / Inmuebles
Auditado: estados (disponible/reservado/vendido/alquilado), tipos, precios (formato es-ES), documentos
(`EntityDocumentsManager`), búsqueda del Asistente (sin false negatives conocidos; eval de rango de precio
corregido en P39). **Sin bugs nuevos.**

## 7. Apartado E — Operaciones / Comisiones
`computeHonorarios` (compartido, P42) calcula la base = **comisión** (percent/one_month/fixed), nunca el
precio del inmueble. CTA de facturar + chip de estado del ciclo (A) + anti-duplicados (P42). **Copy corregido:**
el pie decía «se gestionarán en el módulo económico» (futuro) → «se gestionan en el módulo Facturación».

## 8. Apartado F — Facturación PRO
No reabierta. Evals **calc/parser/pdf/summary/decimal/honorarios → PASS**; inputs numéricos (DecimalInput,
P40) sin NaN; papelera/purga, divisas, checklist pre-emisión intactos. **Sin bugs nuevos.**

## 9. Apartado G — Documentos / entity_files
**0** `from('documents')` (P37/P38). Cliente/inmueble/trámite/factura sobre `entity_files` con signed URLs y
RLS; Asistente solo metadata. **Sin bugs nuevos.**

## 10. Apartado H — Calendario / Tareas / Trámites
Auditado (fechas es-ES, estados, relaciones). Sin regresiones detectadas desde código. Verificación fina de
UX queda para QA manual (checklist).

## 11. Apartado I — Asistente IA
`get_invoices_summary = not_available`; **0** `from('invoices')`; «facturado» remite a Facturación,
«comisionado/honorarios» → operaciones (P41, con evals). **Bug menor corregido:** un `console.log` de
depuración del Asistente estaba **sin gatear** (volcaba metadatos de respuesta a la consola del navegador) →
ahora solo en `NODE_ENV==='development'`. Evals de Asistente (capabilities/reliability/guard) → PASS.

## 12. Apartado J — Configuración / Empresa
Datos de empresa demo **profesionales** (corregidos en P40: email, dirección, CP/provincia coherentes con
Bilbao, teléfono, web). El PDF muestra el emisor correcto. **Sin datos embarazosos.**

## 13. Apartado K — Mobile
Escaneo de código: **0** `h-screen`/`w-screen` crudos (solo `clamp()/calc(100vh…)` acotados); inputs a 16px;
pestañas con `overflow-x-auto`; editor de factura con toggle Editar/Vista previa. Checklist en
`MOBILE_QA_CHECKLIST.md` para validación con dispositivo real (no verificable solo desde código).

## 14. Apartado L — Seguridad / RLS / scans
`from('documents')`=**0** · `from('invoices')` Asistente=**0** · `service_role` en componentes=**0** (solo
comentarios) · `NowLabs/Copiloto` en texto visible=**0** · `h-screen/w-screen` crudos=**0** ·
`@ts-ignore`=**0** (4 `eslint-disable-next-line no-explicit-any` puntuales, aceptables) ·
`console.log` cliente sin gatear=**0** (corregido) · RLS activa en las 11 tablas críticas (verificado P37).

## 15. Apartado M — Datos demo
Clientes demo **profesionales** (nombres reales, emails `@example.com`, teléfonos coherentes). Empresa
corregida en P40. **No** se creó seed (datos suficientes). **Sin hallazgos nuevos.**

## 16. Apartado N — Documentación
Nuevo informe P43. `CRM_VALIDATOR_DEMO_SCRIPT.md` ya incluye el paso operación→factura (P42);
`MOBILE_QA_CHECKLIST.md` y `VALIDATOR_QA_CHECKLIST.md` vigentes.

## 17. Bugs encontrados
1. Comisiones: pie con copy en **futuro** («se gestionarán…») pese a que Facturación está viva.
2. Asistente: `console.log` de depuración **sin gatear** en cliente (ruido en consola).
3. Ciclo económico: faltaba mostrar el **estado derivado** (pendiente/facturado/cobrado) por operación.

## 18. Bugs corregidos
1. Copy del pie de Comisiones → «se gestionan en el módulo Facturación».
2. `console.log` del Asistente gateado a `development`.
3. Estado del ciclo por operación (chip) + resumen («N pendientes de facturar · N facturadas · N cobradas»),
   con función pura `billingStateFromInvoice`.

## 19. Tests / evals
**11/11 suites PASS**: invoicing (calc, parse, pdf, summary, decimal, honorarios, **billing-state** nuevo),
real-estate-search, assistant (capabilities, reliability, guard).

## 20. Validaciones
`npx tsc --noEmit` **OK** · `npm run lint -- --max-warnings=0` **OK** · `npm run build` **OK** ·
`node --check scripts/check-agent-deploy.mjs` **OK** · evals **PASS** · scans **limpios** · `git status`
limpio tras commit.

## 21. Archivos tocados
- **Nuevos:** `src/lib/invoicing/billing-state.ts`, `src/lib/invoicing/__evals__/billing-state.evals.ts`, este informe.
- **Modificados:** `src/app/(saas)/opportunities/page.tsx` (chip de estado del ciclo + resumen + copy),
  `src/app/(saas)/assistant/page.tsx` (gate del console.log).

## 22. Migraciones
**Ninguna.**

## 23. Qué NO se hizo
- **No** auto-sincronización comisión↔factura (estado calculado, no mutado) — decisión documentada.
- **No** botón facturar desde ficha de cliente (mejora futura, evita duplicados).
- **No** KPI «Pendiente de facturar» en el dashboard principal (se muestra en Comisiones; evita rediseño).
- **No** se tocó n8n, Asistente-facturas, emails, OCR, import/export ni RLS.
- QA mobile con dispositivo físico y validación funcional profunda de Calendario/Trámites → checklist manual.

## 24. Commit / 25. Push
Ver `fix(p43)` en `main` (push a `origin/main`).

## 26. Pendientes honestos
- QA manual con dispositivo real (checklists listos).
- KPI «Pendiente de facturar» en el dashboard principal + facturar desde ficha de cliente.
- Reflejar automáticamente la comisión como cobrada al pagar la factura vinculada (hoy son controles
  separados; el estado se muestra derivado de la factura).

## 27. Veredicto
**P43 COMPLETADO — TOTAL CRM VALIDATOR PROGRAM: CRM VALIDADO APARTADO POR APARTADO COMO PRODUCTO INMOBILIARIO
REAL, CON CICLO HONORARIOS→FACTURACIÓN→COBRO CLARO (PENDIENTE DE FACTURAR / FACTURADO / COBRADO DERIVADO DE LA
FACTURA VINCULADA), BUGS MENORES CORREGIDOS, SCANS LIMPIOS Y BASE LISTA PARA VALIDACIÓN COMERCIAL. ASISTENTE
AISLADO, N8N INTACTO, SIN MIGRACIONES.**
