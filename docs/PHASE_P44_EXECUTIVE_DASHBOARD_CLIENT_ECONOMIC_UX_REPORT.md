# P44 — EXECUTIVE DASHBOARD & CLIENT DETAIL ECONOMIC UX

**Estado:** COMPLETADO
**Fecha:** 2026-07
**Alcance:** UX de visibilidad económica ejecutiva (Dashboard + ficha de cliente) **sin** nuevas features grandes, **sin** n8n, **sin** Asistente-write, **sin** migraciones destructivas, **sin** redseños de dashboard.

---

## 1. Objetivo

Que al abrir el **Dashboard** o la **ficha de un cliente**, una inmobiliaria entienda de un vistazo:

- Qué dinero está **pendiente de facturar** (honorarios/comisión de operaciones cerradas todavía sin factura).
- Qué está **facturado y pendiente de cobro**.
- Qué está **cobrado**.
- **Dónde** crear la factura (CTA directo desde la operación cerrada).

**Principio no negociable respetado:** el estado económico es **DERIVADO** de la operación + la factura vinculada. No se sincronizan campos duplicados ni se hace auto-sync frágil. **El precio del inmueble nunca se trata como ingreso de la inmobiliaria** — la base siempre son los honorarios/comisión.

---

## 2. Qué se ha entregado

### 2.1 KPI «Pendiente de facturar» en el Dashboard
- Nueva tarjeta ejecutiva (tono ámbar) como primer KPI del bloque económico.
- Muestra la suma de **honorarios de operaciones cerradas (`stage = 'won'`) que todavía NO tienen factura emitida**.
- Explícitamente **no incluye** el precio del inmueble (hint en la propia tarjeta).
- Se calcula en el mismo ciclo de carga del dashboard (sin doble fetch): se cargan los enlaces factura↔oportunidad, se computan los honorarios por operación y se agregan con `computeEconomicCycle`.
- La rejilla pasa a `sm:grid-cols-3 lg:grid-cols-5` para acomodar la nueva tarjeta sin romper el layout.
- En **modo demo** el KPI muestra `—` (no hay workspace real que consultar); comportamiento intencionado.

### 2.2 CTA «Facturar honorarios» desde la ficha del cliente
- En cada tarjeta de operación de la ficha del cliente:
  - Si la operación está **cerrada (won)** y **no tiene factura** → botón **«Facturar honorarios»** que abre el editor de factura pre-rellenado con los honorarios (flujo P42 `?fromOpportunity=`).
  - Si ya tiene factura → **chip de estado** (Pendiente de facturar / Borrador / Facturado · pendiente de cobro / Cobrado / Cancelada), derivado del estado real de la factura vinculada.
  - Si la operación está **abierta** → «Potencial · operación abierta» (no es ingreso todavía).
- La etiqueta del valor se aclaró a **«Valor operación»** para no confundirlo con ingreso de la inmobiliaria.

### 2.3 Estado económico por operación (derivado)
- `billingStateFromInvoice(status)` + `BILLING_STATE_LABEL` (P43) como única fuente de verdad del estado mostrado.
- Sin escritura de `commission_paid_amount` ni sincronizaciones: el chip refleja SIEMPRE el estado de la factura enlazada en el momento de la carga.

---

## 3. ADDENDUM P44 — Fix navegación contextual desde «Facturar honorarios»

### 3.1 Problema
Al crear una factura desde **Comisiones** o desde la **ficha de cliente** vía «Facturar honorarios», el botón «Volver» del editor devolvía/dejaba al usuario en el módulo **Facturación** (origen incorrecto).

### 3.2 Solución (anti open-redirect, sin `router.back()`)
- Nuevo helper **PURO** `src/lib/safe-return.ts`:
  - `safeReturnTo(raw)` — valida un `returnTo`: solo **rutas internas relativas**. Rechaza (`→ null`, fallback a `/facturacion`):
    - URLs externas (`https://malicioso.com`, `http://…`).
    - Protocol-relative (`//malicioso.com`) y el truco `/\` (se normaliza a `//`).
    - Esquemas (`javascript:`, o esquema tras la barra `/js:`), caracteres de control, cadenas vacías/nulas o absurdamente largas (>512), y rutas sin `/` inicial.
    - `decodeURIComponent` protegido con try/catch (percent-encoding inválido → `null`, sin excepción).
  - `returnToLabel(path)` — texto del botón según origen: `/opportunities*` → **«Volver a Comisiones»**, `/clients/*` → **«Volver al cliente»**, `/facturacion*` → **«Volver a Facturación»**, sin `returnTo` → **«Cerrar»**, otra ruta interna → **«Volver»**.
- **Origen → returnTo generado en el CTA:**
  - Comisiones (`opportunities`): `?fromOpportunity=<id>&returnTo=%2Fopportunities%3Ftab%3Dcommissions`.
  - Ficha de cliente: `?fromOpportunity=<id>&returnTo=%2Fclients%2F<id>`.
- **Preservación del contexto** en `facturacion/page.tsx`:
  - El `returnTo` se captura en el efecto de prefill **antes** de limpiar la URL (`history.replaceState`) y se guarda en estado interno (`useState`), envuelto en `queueMicrotask` para cumplir `react-hooks/set-state-in-effect`.
  - `closeEditor()` y `afterEditorSuccess()` navegan a `returnTo` (con `router.push`) si existe; si no, cierran el editor / recargan la lista (comportamiento previo).
  - Se conserva a través de: prefill → limpieza de URL → guardar borrador → emitir → cancelar/cerrar.
  - Las aperturas normales (`openCreate`, `handleGenerate`, apertura desde el listado `openInvoiceById`) hacen `setReturnTo(null)` → sin origen externo → botón «Cerrar».
- **Landing en Comisiones:** como el subtab de `opportunities` no estaba en la URL, se añadió una lectura única de `?tab=` que selecciona el subtab válido (incl. `commissions`).
- El editor (`InvoiceEditor`) acepta una prop opcional **`closeLabel`** (default `'Cerrar'`) usada en el botón de cabecera (X, con `title`/`aria-label`) y en el botón inferior.

### 3.3 Garantías de seguridad
- **No** se usa `router.back()` como solución principal.
- **Ningún** `router.push` / `location.href` / `location.assign` con valor externo sin sanear: los únicos `router.push` del módulo van a `returnTo` ya validado por `safeReturnTo`.
- No hay open redirect: entradas externas/protocol-relative/esquema → `null` → fallback `/facturacion`.

---

## 4. Ficheros

### Nuevos (lógica pura + evals)
- `src/lib/invoicing/economic-cycle.ts` — `computeEconomicCycle(rows)` agrega honorarios por estado de facturación; solo operaciones **cerradas sin factura** cuentan como pendiente; borrador/cancelada no suman al headline.
- `src/lib/safe-return.ts` — `safeReturnTo` + `returnToLabel` (anti open-redirect).
- `src/lib/invoicing/__evals__/economic-cycle.evals.ts` — `runEconomicCycleEvals()`.
- `src/lib/__evals__/safe-return.evals.ts` — `runSafeReturnEvals()`.

### Modificados (UI)
- `src/app/(saas)/dashboard/page.tsx` — KPI «Pendiente de facturar» + cómputo del ciclo en la carga real.
- `src/app/(saas)/clients/[id]/page.tsx` — estado económico por operación + CTA «Facturar honorarios» con `returnTo`.
- `src/app/(saas)/opportunities/page.tsx` — CTA de Comisiones con `returnTo` + lectura de `?tab=`.
- `src/app/(saas)/facturacion/page.tsx` — wiring de `returnTo` (captura, navegación, reset) + `closeLabel`.
- `src/components/invoicing/InvoiceEditor.tsx` — prop opcional `closeLabel`.

---

## 5. Tests / Evals

Runner temporal (`npx tsx`, luego borrado) sobre **14 suites puras — TODO VERDE ✅**:

`safe-return`, `economic-cycle`, `honorarios`, `billing-state`, `invoicing`, `invoice-summary`, `invoice-parse`, `invoice-pdf`, `decimal`, `real-estate-search`, `portfolio-filter`, `assistant capabilities`, `assistant reliability`, `assistant guard`.

Cobertura destacada:
- **economic-cycle:** pendiente = 7.500 (solo cerradas sin factura); operación **abierta NO cuenta**; facturado = 4.200 (issued + sent); cobrado = 2.000; borrador/cancelada no suman; sin honorarios → 0.
- **safe-return:** rutas internas aceptadas (incl. codificadas); `https://malicioso.com`, `http://…`, `//malicioso.com`, `/\…`, `javascript:`, control chars, vacío/null/undefined y >512 → `null` (fallback); percent-encoding inválido no lanza; `returnToLabel` mapea Comisiones/cliente/Facturación/Cerrar/Volver.

---

## 6. Validaciones

| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ sin errores |
| `npm run lint -- --max-warnings=0` | ✅ 0 warnings |
| `npm run build` | ✅ compila (49 páginas) |
| `node --check scripts/check-agent-deploy.mjs` | ✅ sintaxis OK |
| Evals (14 suites) | ✅ TODO VERDE |

### Escaneos de seguridad / alcance
| Escaneo | Resultado |
|---|---|
| `from('documents')` en `src` | 0 |
| `from('invoices')` en `src/lib/agents` (Asistente) | 0 |
| `service_role` real en frontend (`src/app`) | 0 (solo cadenas de diagnóstico/comentarios) |
| `router.back()` en Facturación | 0 |
| `location.href/assign/replace` sin sanear en Facturación | 0 |
| `router.push` en Facturación | solo a `returnTo` validado por `safeReturnTo` |
| Cambios en n8n / migraciones / API routes | 0 |

---

## 7. Fuera de alcance (respetado)
No n8n · no Asistente leyendo/creando facturas · no `service_role` en frontend · no secretos · no OCR/emails/import-export/pasarelas/Verifactu/TicketBAI · no migraciones destructivas (0 migraciones) · no auto-sync frágil · no rediseño de dashboard · no duplicar facturas · el precio del inmueble nunca es base de factura.

---

**P44 COMPLETADO — EXECUTIVE DASHBOARD & CLIENT DETAIL ECONOMIC UX: PENDIENTE DE FACTURAR VISIBLE, FACTURAR HONORARIOS DESDE CLIENTE Y CICLO ECONÓMICO MÁS CLARO SIN SINCRONIZACIONES FRÁGILES + Fix navegación contextual desde Facturar honorarios.**
