# P58 — Auditoría: fuentes de verdad de «ventas/vendidos» (Cartera vs Operaciones)

Verificado contra la BD real (2026-07-09), workspace demo `d0000000…`.

## A. Cartera (`properties.status`)
| status | label | n (demo) |
|---|---|---|
| `sold` | Vendido | **6** |
| `rented` | Alquilado | **1** |
| `listed` | Publicado | 1 |

## B. Operaciones (`opportunities.stage`)
No hay `outcome`/`won`/`closed_at`: el resultado vive en **`stage`**. Valores en demo: `won` (**7**), `lost` (1).
- `stage = won` = **operación ganada = cerrada con éxito**. (`lost` = perdida; el resto = abiertas.)
- Columnas: `stage, value, commission_*, property_id, client_id, expected_close_date, updated_at`. **No** hay
  `operation_type` en la operación; el tipo venta/alquiler vive en el inmueble vinculado.

## C. Relación Cartera ↔ Operaciones (reconciliación real)
| op.stage | prop.status | prop.operation_type | n |
|---|---|---|---|
| won | sold | venta | **6** |
| won | (sin inmueble) | — | **1** |
| lost | sold | alquiler | 1 |

## D. Matriz de «vendido» (demo)
- Inmuebles vendidos (Cartera): **6**.
- Inmuebles alquilados (Cartera): **1**.
- Operaciones ganadas (Operaciones): **7** (6 de venta con inmueble `sold` + **1 sin inmueble**).
- **Discrepancia legítima**: 7 ganadas vs 6 inmuebles vendidos → 1 operación ganada no tiene inmueble de
  cartera asociado. Por eso el Asistente da **las dos cifras** y no las funde.

## Conclusiones (vinculantes para el código)
1. `ventas ≠ operaciones` y `vendidos ≠ properties`: son **dos fuentes** que se consultan y reconcilian.
2. «Vendido» en Cartera = `status='sold'`; en Operaciones = `stage='won'`.
3. El transcript («no consta ninguna operación vendida») era **falso**: había 7 ganadas. Causa: la frase
   sin vocab de módulo no llegaba a ningún reader local → n8n alucinaba. Corregido con `sales-domain.ts`.
