# FASE P6.11 / P8 PREP — Cierre comercial + módulo de comisiones (base)

> **Fecha:** 2026-06-23 · HEAD previo `e4f21e0`. UI + helpers + **migración ligera**
> (commission_status/paid_amount/paid_at). Requiere redeploy.

## 1. Diagnóstico
Cartera estaba muy cerrada (P6.10) pero faltaban: el badge **"Cierre pronto"** (confuso), el flujo
**al cerrar/vender** (¿se borra el inmueble?), y el inicio del **control de comisiones/cobros**.

## 2. "Cierre pronto" → "Cierre previsto" / "Cierre vencido"
Helper `closeState(fecha)`: **`Cierre vencido`** (fecha pasada, rojo) · **`Cierre previsto`** (≤30
días, ámbar) · nada si no hay fecha. Solo se muestra en operaciones **no terminales** (no en
Cerradas/Perdidas). Adiós a "Cierre pronto".

## 3. Etapas finales
Sin cambios respecto a P6.10: formularios y **edición rápida** ofrecen **7 etapas** (Nueva ·
Contactado · Visita · Oferta · Reserva · Cerrada · Perdida); Cualificado/Negociación ocultas pero
visibles en el tablero si hay datos, y la edición rápida incluye la etapa actual si es legacy.

## 4-5. Al cerrar/vender una operación (histórico, NO borrar)
**Principio**: cerrar **no borra nada**. Al cambiar una operación a **Cerrada** desde el tablero,
**si tiene inmueble vinculado** → **ConfirmDialog guiado**: *"La operación quedará cerrada y el
inmueble «X» se marcará como vendido/alquilado. No se elimina nada: queda en el histórico (comisión,
documentos y trámites se conservan)."*
- Al confirmar: operación → `won`; **inmueble → `sold`** (venta/compra/captación/inversión/
  valoración) o **`rented`** (alquiler), según `metadata.operation_kind`. **Sin borrar** inmueble/
  cliente/trámites/documentos.
- Si la operación **no** tiene inmueble → solo se cierra (sin tocar inmuebles).
- (El cierre rápido vive en el tablero; cerrar desde el drawer de edición solo cambia la etapa.)

## 5b. Inmuebles vendidos = histórico
Los inmuebles **vendidos/archivados no se borran**. En la vista Inmuebles se **ocultan por defecto**
y hay un toggle **"Ver vendidos (N)" / "Ocultar vendidos"**. Estados: Captación · Publicado/
Disponible · Reservado · Bajo contrato · **Vendido** · **Alquilado** · Archivado.

## 6-7. Módulo "Comisiones" (control interno, NO facturación)
Nueva **pestaña "Comisiones"** dentro de Cartera (Inmuebles · Operaciones · Trámites · **Comisiones**):
- **KPIs**: **Comisión estimada** (orientativa) · **Comisión pendiente** (por cobrar) · **Comisión
  cobrada** (registrada, no fiscal) · nº operaciones con comisión.
- **Lista**: operación · cliente · inmueble · % pactado · **comisión estimada** · badge
  **Pendiente/Cobrada** · acción **"Cobrada"** / **"Pendiente"**.
- **Persistencia** (migración ligera en `opportunities`): `commission_status` (pendiente|cobrada),
  `commission_paid_amount` (importe real), `commission_paid_at` (fecha). "Marcar cobrada" registra
  importe (= estimada) + fecha; "Pendiente" lo revierte. Vía `updateOpportunity` (RLS).
- **Cálculo**: comisión estimada = base × rate/100, base = precio del inmueble vinculado o, si no
  hay, valor potencial. Ej.: 285.000 € × 3% = **8.550 €**.

## 7b/8. Qué NO es facturación (copy obligatorio)
- **Comisión estimada** = orientativa (lo dice en cada sitio: "no es factura/facturación").
- **Comisión cobrada** = ingreso registrado **manualmente** (detalle: "registrada · no fiscal").
- **NO** se crea: factura legal, PDF fiscal, impuestos, gastos, beneficio, contabilidad. La pestaña
  dice **"Control interno de comisiones"**, nunca "Facturación legal".
- **Futuro módulo económico** (documentado, no construido): facturas, cobros, gastos, impuestos,
  beneficio, método/estado de pago. Una operación Cerrada con comisión cobrada podrá alimentarlo.

## 9. UI / copy
Sin "probabilidad"/"lead"/"pipeline"/"expediente" visibles. Card de operación: valor potencial +
**comisión estimada** + estado + cierre (previsto/vencido). Operación cerrada → badge de etapa
"Cerrada" + chip de comisión.

## 10-11. Seguridad / compatibilidad
Migración **aditiva, nullable**, RLS de `opportunities` ya la cubre, **sin service_role frontend**,
sin tocar datos existentes. `probability` se conserva (legacy). Claves de etapa intactas. Borrado
seguro (P6.8/P6.9) intacto.

## 12. Validaciones
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Sin "Cierre pronto"/"Probabilidad"/secretos.

## 13-14. Archivos / Migración
`src/lib/vertical-queries.ts` (commission_status/paid en tipo/update), `src/app/(saas)/opportunities/page.tsx`
(badge cierre, flujo cerrar, módulo Comisiones, toggle vendidos), migración
`20260623_p611_opportunities_commission_status.sql` (aplicada), este report.

## Qué probar
- **Cierre**: cambiar una operación con inmueble a **Cerrada** → modal guiado → confirmar →
  operación cerrada + inmueble Vendido/Alquilado; **nada se borra**; el inmueble pasa a "vendidos"
  (toggle "Ver vendidos").
- **Comisiones**: pestaña Comisiones → KPIs (estimada/pendiente/cobrada) + lista; **"Cobrada"** →
  badge verde y suma en "cobrada"; **"Pendiente"** revierte. 285.000 € × 3% = 8.550 €.
- Badge **"Cierre previsto"/"Cierre vencido"** según fecha; nada en cerradas.
- Borrado (P6.8/P6.9) sigue funcionando.

## Veredicto
**P6.11 COMPLETADO — CIERRE COMERCIAL Y COMISIONES BASE.** Cerrar una operación marca el inmueble
(vendido/alquilado) **sin borrar nada** (histórico íntegro); badge de cierre claro
(previsto/vencido); y arranca el **módulo Comisiones** (control interno, KPIs, marcar cobrada) con
migración ligera — **sin** facturación fiscal, semántica preparada para el módulo económico futuro.
Requiere redeploy.
