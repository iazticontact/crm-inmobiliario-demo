# FASE P6.12 — Cartera: 5 estados comerciales + Comisiones pulidas

> **Fecha:** 2026-06-23 · Última gran pasada de simplificación de **Operaciones + Comisiones**.
> UI + helpers + 1 migración **de datos de ejemplo** (no de esquema). Requiere redeploy.

## 1. Objetivo
Reducir ruido y ambigüedad en Cartera: pocos estados, claros y coherentes con una inmobiliaria
real. Prioridad declarada: **ante la duda, claridad > más opciones**.

## 2. Estados comerciales (5 visibles) — el cambio central
Las operaciones visibles se reducen a **5 estados**: **Nueva · En gestión · Reserva · Vendida /
Alquilada · Perdida**. Patrón **estado visible vs. etapa interna**:
- Helpers en `src/lib/demo/vertical-templates.ts`: `CommState`, `COMM_STATE_ORDER`,
  `COMM_STATE_OPTIONS`, `COMM_STATE_TONE`, `commStateOf(stage)`, `stageForCommState(state)`,
  `wonLabel(kind)`.
- `commStateOf` **colapsa las etapas internas antiguas** (`contacted/qualified/visit_scheduled/
  offer/negotiation`) en **«En gestión»**; `new→Nueva`, `reserved→Reserva`,
  `won/closed/resolved→Vendida/Alquilada`, `lost→Perdida`. **No se migran datos**: las claves
  internas se conservan y se resuelven al vuelo.
- Aplicado en **los 4 sitios** pedidos: **creación** (`VerticalForms`), **edición**
  (`VerticalEditForms`), **cambio rápido en el listado** y **agrupación del tablero**
  (`opportunitiesByCommState`). El selector rápido compara por *bucket*: reseleccionar el mismo
  estado sobre una etapa legacy **no reescribe** la etapa.

## 3. "Cerrada" desaparece como etiqueta → Vendida / Alquilada
- Internamente sigue siendo `won`. La **opción del selector** es genérica **«Vendida / Alquilada»**,
  pero la **tarjeta** muestra el texto correcto vía `wonLabel(metadata.operation_kind)`:
  `alquiler → Alquilada`, resto → **Vendida**.
- En ningún sitio visible aparece ya "Cerrada"/"Etapa". El error de cambio de estado dice
  "No se pudo cambiar el estado".

## 4. Fuera los badges de cierre
Eliminados de la interfaz principal de Operaciones los badges **«Cierre previsto / vencido /
pronto»** y la función `closeState`. `expected_close_date` **se conserva como dato** (editable en el
drawer), pero **deja de ser protagonista visual** (tampoco aparece en la línea de meta de la tarjeta).

## 5. Comisiones pulidas
- **KPIs**: **Comisión prevista** (orientativa · no es factura) · **Pendiente de cobro** ·
  **Cobrada** (registrada, no fiscal) · **Cerradas con comisión** (nº de vendidas/alquiladas).
- **Vista por defecto = cerradas**: solo las operaciones **Vendida/Alquilada** con comisión. Toggle
  discreto **«Ver también abiertas (N)» / «Ver solo cerradas»** para anticipar las que siguen en
  gestión (marcadas con un chip «En gestión»).
- **Lista**: operación · cliente · inmueble · **tipo de operación** (Venta/Alquiler/Inversión…) ·
  **% pactado** · **comisión prevista €** · estado **Pendiente/Cobrada** · acción.
- **Registrar cobro** (modal): marca **cobrada** + **fecha** + **importe cobrado real (opcional)** +
  **nota (opcional, en `metadata.commission_note`)**. «Pendiente» revierte (borra importe y fecha).
  Si el importe real difiere de la prevista, la fila muestra el real y, debajo, «prevista X».
- Copy de límites (discreto, no repetitivo): "orientativa", "control interno", "no genera factura,
  impuestos ni contabilidad".

## 6. Inmuebles cerrados = histórico, ocultos por defecto
- Cerrar una operación a **Vendida/Alquilada** con inmueble vinculado → **modal guiado**, marca el
  inmueble **`sold`** (venta/compra/captación/inversión/valoración) o **`rented`** (alquiler).
  **No borra nada** (fotos/trámites/documentos/cliente intactos).
- En **Inmuebles**, los **vendidos, alquilados y archivados** se **ocultan por defecto**; toggle
  **«Ver vendidos y alquilados (N)» / «Ocultar cerrados»**. (Antes solo se ocultaban `sold/archived`;
  ahora también `rented`.)

## 7. Módulo económico futuro (documentado, NO construido)
Preparado para un módulo económico posterior **sin** construirlo y **sin humo**:
- Una operación **Vendida/Alquilada** con **comisión cobrada** (importe real + fecha + nota) es el
  punto de entrada natural a: **facturación**, **cobros/pagos**, **gastos**, **impuestos (IVA/IRPF)**,
  **beneficio**, método y estado de pago.
- Reglas mantenidas para no contaminar ese futuro: **la comisión prevista NO es facturación**; **el
  precio del inmueble (operación) ≠ ingreso de la agencia (comisión)**; el importe cobrado es **dato
  interno**, no documento fiscal. Nada en la UI llama "factura"/"contabilidad" a la comisión.
- Persistencia ya lista (de fases previas, aditiva): `commission_rate`, `commission_status`,
  `commission_paid_amount`, `commission_paid_at`, y ahora `metadata.commission_note`.

## 8. Qué NO toqué
n8n / Asistente (Agent V2) · Auth/onboarding · `.env.local`/secretos · **sin service_role en
frontend** · datos reales fuera del workspace de ejemplo · módulos ajenos (Clientes, Calendario,
Dashboard, Inbox, Settings). **RLS y workspace scoping intactos**; Storage y borrado seguro
(P6.8/P6.9) sin cambios.

## 9. Archivos
- `src/lib/demo/vertical-templates.ts` — helpers de estado comercial (ya presentes; sin cambios
  nuevos en esta pasada salvo su uso).
- `src/components/VerticalForms.tsx` · `src/components/VerticalEditForms.tsx` — selector **Estado**
  (5 opciones) en alta y edición.
- `src/app/(saas)/opportunities/page.tsx` — tablero agrupado por estado, sin badges de cierre,
  Comisiones (KPIs + toggle cerradas/abiertas + columnas + modal Registrar cobro), Inmuebles ocultan
  `rented`, copy.
- `src/lib/vertical-queries.ts` — `updateOpportunity` acepta `metadata` (para `commission_note`).
- `supabase/migrations/20260623_p612_seed_example_operation_kind.sql` — **datos de ejemplo**.

## 10. Migración (solo datos de ejemplo, aditiva y reversible)
`20260623_p612_seed_example_operation_kind.sql` (aplicada), acotada a
`workspace = d0000000-…-0001`:
1. Rellena `metadata.operation_kind` (venta/alquiler) desde el inmueble vinculado; `inversion` para
   la operación sin inmueble.
2. Marca **`sold`** el inmueble de una operación ya **ganada** que seguía `listed` (incoherencia que
   el nuevo modelo dejaba a la vista). **Sin tocar esquema ni datos reales.**

## 11. Validaciones
- `npx tsc --noEmit` ✅
- `npm run lint -- --max-warnings=0` ✅
- `npm run build` ✅
- Sin "Cerrada"/"Cierre previsto/vencido"/"Probabilidad" visibles; sin service_role/secretos.
- Datos de ejemplo verificados (MCP): buckets → **En gestión 5 · Vendida/Alquilada 3**; 3 won con
  inmueble `sold`; 3 inmuebles cerrados ocultos por defecto, 4 activos.

## 12. QA checklist
- [ ] **Alta de operación**: selector **Estado** con 5 opciones (Nueva/En gestión/Reserva/Vendida ·
      Alquilada/Perdida).
- [ ] **Edición**: el estado se muestra colapsado; una operación legacy (`offer`/`negotiation`) cae
      en «En gestión» sin perder datos.
- [ ] **Tablero**: dos grupos visibles (En gestión, Vendida / Alquilada); cada won muestra **Vendida**;
      sin badges de cierre.
- [ ] **Cambio rápido**: pasar una operación con inmueble a **Vendida/Alquilada** → modal guiado →
      inmueble marcado vendido/alquilado, **nada borrado**, pasa a histórico.
- [ ] **Inmuebles**: vendidos/alquilados ocultos; «Ver vendidos y alquilados (3)» los muestra.
- [ ] **Comisiones**: por defecto solo cerradas (3); «Ver también abiertas (5)» añade las de gestión;
      columnas con tipo de operación y % ; **Registrar cobro** (importe real + nota) → Cobrada y suma
      en KPI «Cobrada»; «Pendiente» revierte. 285.000 € × 3% = 8.550 €.
- [ ] **Borrado seguro** (P6.8/P6.9) sigue funcionando.

## Veredicto
**P6.12 COMPLETADO — CARTERA SIMPLIFICADA Y COHERENTE.** Operaciones en **5 estados** claros
(creación/edición/listado/tablero), **«Vendida/Alquilada»** en vez de «Cerrada», **sin badges de
cierre**, **Comisiones** enfocadas en cerradas con cobro registrable (importe real + nota) y copy que
deja claro que es **control interno, no facturación**, e **inmuebles cerrados como histórico oculto**.
`tsc`/`lint`/`build` en verde; sin tocar n8n/Asistente/secretos/módulos ajenos; RLS y borrado seguro
intactos. Migración únicamente de **datos de ejemplo** (aditiva). Requiere redeploy.
