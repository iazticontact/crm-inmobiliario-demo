// Cálculo de honorarios/comisión de la inmobiliaria (P42) — PURO, sin I/O. Es la base de la FACTURA de
// honorarios: NUNCA se factura el precio del inmueble, sino la comisión. Replica exactamente el modelo de
// la pantalla de Operaciones (metadata.commission_model): 'percent' (por defecto), 'one_month' (1
// mensualidad de alquiler) y 'fixed' (importe fijo en metadata.commission_fixed).
//
// Modelo:
//   · percent (venta): base = precio del inmueble (o value) × commission_rate %.
//   · percent (alquiler): base = renta ANUAL (opp.value) × commission_rate %.
//   · one_month (alquiler): 1 mensualidad (precio del inmueble = renta mensual).
//   · fixed: metadata.commission_fixed.

export type HonorariosInput = {
  value: number | null           // opportunities.value (venta: valor; alquiler: renta anual)
  commissionRate: number | null  // opportunities.commission_rate (%)
  propertyPrice: number | null   // precio del inmueble (venta) o renta mensual (alquiler)
  isRental: boolean
  metadata?: Record<string, unknown> | null
}

export function computeHonorarios(o: HonorariosInput): number | null {
  const meta = o.metadata ?? {}
  const model = typeof meta.commission_model === 'string' ? meta.commission_model : 'percent'
  const monthly = o.isRental ? o.propertyPrice : null
  if (model === 'fixed') {
    const f = Number(meta.commission_fixed)
    return Number.isFinite(f) && f > 0 ? Math.round(f) : null
  }
  if (model === 'one_month') {
    return monthly ? Math.round(monthly) : null
  }
  // percent (por defecto)
  const base = o.isRental ? o.value : (o.propertyPrice ?? o.value)
  return base && o.commissionRate ? Math.round((base * o.commissionRate) / 100) : null
}
