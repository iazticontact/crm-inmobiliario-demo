# FASE P6.15 — Cartera: claridad de KPIs, alquileres preparados, documentos visibles

> **Fecha:** 2026-06-23 · Microfase de claridad final. UI/copy + helpers de comisión + **migración
> ligera SOLO de datos de ejemplo** (idempotente). Sin facturación real. Requiere redeploy.

## 1. Diagnóstico (staging)
- **A.** KPIs de Inmuebles: "Inmuebles en cartera: 7 / Activos gestionados" cuando el usuario ve 4
  (los vendidos/alquilados están ocultos). El "7" confundía.
- **B/E.** Alquileres: una operación de alquiler calculaba **comisión = 3% × renta mensual** (1.200 €
  → **36 €**, absurdo). Faltaba dejar el alquiler bien preparado.
- **C.** Operación de ejemplo "Cartera de inversión Atlántico": abstracta, no enseña bien.
- **D.** Documentos de trámite: accesibles desde la fila (P6.14) pero como texto pequeño poco
  evidente.
- **Rendimiento:** verificar que no hay N+1 ni recargas innecesarias.

## 2. Inmuebles — KPIs claros (antes / después)
| # | Antes | Después |
|---|---|---|
| 1 | "Inmuebles en cartera · **7** · Activos gestionados" | **"Inmuebles activos" · {activos}** · "Disponibles o en gestión" (+ tooltip "Total gestionado: 7 = activos + histórico" cuando hay histórico) |
| 2 | "En comercialización · Publicados / disponibles" | **"En comercialización" · "Publicados"** |
| 3 | "Reservados · Reserva / bajo contrato" | **"Histórico" · {vendidos+alquilados} · "Vendidos / alquilados"** |
| 4 | "Valor de cartera · Suma de precios listados" | **"Valor de cartera activa" · "Precio listado activo"** |

**Decisión valor de cartera:** suma **solo de inmuebles activos** (excluye histórico vendido/
alquilado/archivado). Antes incluía por error los `rented`; ahora se excluyen. El usuario entiende
que ve N activos porque **activos (N) + histórico (M) = total gestionado** (visible en dos KPIs + el
tooltip). No es facturación ni ingresos.

## 3. Inmuebles histórico — copy
- Toggle **"Ver vendidos y alquilados (N)" / "Ocultar cerrados"** se mantiene (estados concretos;
  más claro que un genérico "histórico"). El KPI "Histórico · Vendidos / alquilados" ya da el marco.
- **No se borra nada**: vendido/alquilado sale de la cartera activa y conserva fotos, operaciones,
  trámites, documentos y comisiones.

## 4. Alquileres — preparados sin facturación real
**Decisión:** se prepara la estructura de comisión de alquiler **sin construir** facturación/
mensualidades. `commissionOf` ahora entiende `metadata.commission_model`:
- **`percent`** (por defecto): venta → base = precio del inmueble; **alquiler → base = renta ANUAL
  (valor potencial)**, no la mensualidad → adiós al "3% de 1 mes". Ej.: alquiler 14.400 €/año ×
  3% = 432 € (sensato) en vez de 36 €.
- **`one_month`**: comisión = **1 mensualidad** (modelo más habitual en alquiler). Ej.: 1.200 €.
- **`fixed`**: importe fijo en `metadata.commission_fixed`.
- En la lista de Comisiones, el criterio se muestra como **"3%" / "1 mensualidad" / "importe fijo"**
  (`commissionBasisLabel`), no siempre "%".
- El **inmueble** de alquiler ya muestra el precio como **"X €/mes"** (tarjeta). En el tablero, las
  operaciones de alquiler abiertas llevan una etiqueta discreta **"Alquiler"** (las ganadas ya
  muestran "Alquilada").
- **No se construye** facturación recurrente, recibos, impuestos, gastos ni beneficio. Copy/estructura
  quedan listos para el **módulo económico futuro** (mensualidades y cobros recurrentes).
- **No hay UI nueva** para elegir el modelo (se evita ampliar superficie/riesgo); por defecto
  `percent`. El modelo `one_month`/`fixed` se alimenta vía datos/seed o el futuro módulo económico —
  documentado, sin fingir.

## 5. Operación de ejemplo confusa
- **"Cartera de inversión Atlántico" → "Compra edificio para inversión — Ensanche"** (caso
  inmobiliario claro; sigue siendo `inversion`, valor 900.000 €). Datos ficticios; sin tocar
  relaciones reales.
- Además, para enseñar el estado **Reserva** (antes vacío), "Compra obra nueva Promoción Marina" pasa
  a **Reserva**. El showcase del tablero ahora cubre **En gestión · Reserva · Vendida/Alquilada**.

## 6. Trámites — documentos más visibles
- La fila muestra ahora un **pill claramente clicable**:
  - con documentos → **"Ver documentos (N)"** (pill indigo relleno),
  - sin documentos → **"Añadir documento"** (pill discreto con borde punteado, hover indigo).
- Al pulsar abre el **gestor directo** (`EntityDocumentsManager`): subir PDF/imagen, abrir/descargar
  (signed URL), borrar, estado "Subiendo…". **Contador de la fila se actualiza sin F5**
  (`onCountChange`). Sigue funcionando desde editar. Storage/RLS intactos, **sin service_role**.

## 7. Comisiones — sin tocar de más
- Sigue: KPIs (Comisión prevista/Pendiente/Cobrada/**Operaciones cerradas · Con comisión pactada**),
  toggle "Incluir abiertas", nota única, botones Registrar cobro / Marcar pendiente.
- **No** hay comisión como KPI en Operaciones. Los alquileres ya **no** comunican comisiones absurdas.

## 8. Rendimiento (auditoría — sin regresiones)
- `loadData` carga las 4 listas con **`Promise.all`** (sin waterfall).
- Nombres de cliente: **una** lectura agregada (`getClients`), no N+1.
- Portadas: **`coverUrlsForProperties` en batch**, asíncrono (no bloquea render).
- Contador de documentos por trámite: **una** lectura agregada (`documentCountsForEntities`), no por
  fila.
- **Signed URLs de documentos: solo se generan al abrir el gestor** (no en el listado).
- Acciones pequeñas (cambiar estado, marcar/registrar comisión, cerrar) **actualizan estado local**;
  solo recargan en error. Mapas `propertiesById`/`opportunitiesById`/`opsCountByProperty` memoizados.
- **No** se añadieron queries, subscriptions ni websockets. Rendimiento intacto.

## 9. Qué NO se tocó
n8n · Asistente IA · Auth/onboarding · Clientes · Calendario · Dashboard · Storage **policies** · RLS
· `.env.local`/secretos · **service_role (sin uso en frontend)** · facturación/impuestos/gastos/
beneficio reales. Migración **solo de datos del workspace de ejemplo** (idempotente, sin PII, sin
esquema). Borrado seguro intacto.

## 10. Validaciones
- `npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅
  (`✓ Compiled successfully`).
- Audit: sin "Activos gestionados", sin "Suma de precios listados", sin KPI "Comisión estimada", sin
  probabilidad/pipeline/lead/expediente visibles, sin service_role/secretos.
- Datos de ejemplo (MCP): buckets **En gestión 4 · Reserva 1 · Vendida/Alquilada 3**; alquiler con
  `commission_model=one_month` (1.200 €); op de inversión renombrada.

## 11. Checklist QA (staging)
**Inmuebles**
- [ ] KPIs: "Inmuebles activos" (= visibles), "En comercialización", "Histórico" (vendidos/
      alquilados), "Valor de cartera activa" (no suma histórico). Tooltip "Total gestionado".
- [ ] Vendido/alquilado no aparece en activos; "Ver vendidos y alquilados (N)" lo muestra; no se
      borra.

**Operaciones**
- [ ] Venta y alquiler se entienden; alquiler lleva etiqueta "Alquiler" (o "Alquilada" si cerrada).
- [ ] Inmueble de alquiler con precio "X €/mes".
- [ ] "Cartera de inversión Atlántico" → "Compra edificio para inversión — Ensanche".
- [ ] Estado **Reserva** visible en el tablero. No hay comisión como KPI.

**Trámites**
- [ ] Pill "Ver documentos (N)" / "Añadir documento" claramente clicable → abre gestor directo.
- [ ] Subir PDF, abrir/descargar, borrar; contador actualiza sin F5; editar sigue funcionando;
      borrar trámite con documentos sigue avisando y borra documentos.

**Comisiones**
- [ ] "Operaciones cerradas / Con comisión pactada" claro; Registrar cobro y Marcar pendiente
      persisten; alquiler muestra "1 mensualidad · 1.200 €" (no "3% · 36 €").

**Rendimiento**
- [ ] Abrir Cartera y cambiar de pestaña va rápido; abrir gestor de documentos va rápido; sin F5.

## Veredicto
**P6.15 COMPLETADO — CARTERA CLARITY FINAL.** KPIs de Inmuebles claros (activos vs histórico vs valor
de cartera activa), **alquileres preparados** (modelo de comisión percent/one_month/fixed, base anual
en %, "€/mes" y etiqueta "Alquiler", sin facturación real), **operación de ejemplo clara** + estado
Reserva en el showcase, y **documentos de trámite muy accesibles** (pill clicable + gestor directo,
contador en vivo). Rendimiento intacto (sin N+1, signed URLs perezosas). `tsc`/`lint`/`build` en
verde; migración solo de datos de ejemplo (idempotente). Requiere redeploy.
