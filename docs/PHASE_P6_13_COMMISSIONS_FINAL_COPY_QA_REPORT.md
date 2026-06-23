# FASE P6.13 — Comisiones: pulido final de copy (menos disclaimers)

> **Fecha:** 2026-06-23 · Microfase de **copy/UX** sobre la pestaña Comisiones de Cartera.
> **No** crea facturación real, **no** rediseña Cartera, **no** cambia lógica de cálculo.
> Requiere redeploy.

## 1. Diagnóstico
Comisiones funcionaba bien, pero el copy de límites ("Orientativa · no es factura / no es
facturación / no fiscal / no es contabilidad") aparecía **repetido en casi cada elemento** (3 KPIs +
header + nota de sección + nota de modal). Resultado: sensación de advertencia pesada / "humo", poco
profesional. El objetivo era **concentrar** ese mensaje en **una** nota elegante y dejar el resto del
módulo limpio y serio.

## 2. Qué estaba bien (se conserva)
- Estructura funcional: KPIs + lista + toggle cerradas/abiertas + modal Registrar cobro.
- Lógica de cálculo (prevista / pendiente / cobrada / nº cerradas) — **sin cambios**.
- Persistencia (`commission_status`, `commission_paid_amount`, `commission_paid_at`,
  `metadata.commission_note`) — **sin cambios**.
- Modelo de 5 estados y separación "comisión ≠ facturación" — intactos.

## 3. Qué se pulió (solo copy/UX)
- **KPIs**: subcopys neutros, sin disclaimers repetidos.
- **Header de sección**: una sola frase clara.
- **Nota de límites**: **una** nota inferior elegante (antes había disclaimer en KPIs + header +
  nota + modal).
- **Lista**: etiquetas "Comisión prevista / Comisión cobrada"; botones de acción **sin iconos**
  (menos ruido) y con texto claro ("Registrar cobro" / "Marcar pendiente").
- **Toggle**: "Ver también abiertas (N)" → **"Incluir abiertas (N)"** (más preciso: el modo añade
  las abiertas a las cerradas; no las sustituye). Por defecto, foco en **cerradas**.
- **Modal**: subtexto único + contexto de la operación en un chip; placeholder de nota sin referencia
  fiscal (se quitó "regularizar IVA con gestoría"); se eliminó la nota inferior redundante.
- **KPI del tab Operaciones** ("Comisión estimada"): subcopy "Orientativa · no es facturación" →
  **"Operaciones abiertas"** (quita otra repetición del disclaimer fuera de la pestaña).

## 4. Copy antes / después
**KPIs (subcopy):**
| KPI | Antes | Después |
|---|---|---|
| Comisión prevista | "Orientativa · no es factura" | **"Estimación comercial"** |
| Pendiente de cobro | "Aún no registrada" | **"Por registrar"** |
| Cobrada | "Registrada (no fiscal)" | **"Registrada"** |
| Cerradas con comisión | "Vendidas / alquiladas" | "Vendidas / alquiladas" (igual) |

**Header de sección:**
- Antes: "Comisión prevista y cobro de tus operaciones cerradas. Orientativa, para control interno:
  no es factura ni contabilidad."
- Después: **"Control interno de comisiones comerciales."**

**Nota inferior (única):**
- Antes: "La comisión prevista (precio o valor × % pactado) es orientativa. Registrar el cobro guarda
  el importe y la fecha como control interno; no genera factura, impuestos ni contabilidad."
- Después: **"Las comisiones son un control interno. La facturación fiscal, gastos e impuestos se
  gestionarán en el módulo económico."**

**Lista (fila):**
- Sub-etiqueta importe: "comisión prevista/cobrada" (minúsculas) → **"Comisión prevista" /
  "Comisión cobrada" / "Prevista {€}"** (si el real difiere).
- Botón pendiente→: "↺ Pendiente" → **"Marcar pendiente"** (sin icono).
- Botón cobrar→: "✓ Registrar cobro" → **"Registrar cobro"** (sin icono).

**Toggle:** "Ver también abiertas (N)" → **"Incluir abiertas (N)"** · vuelta: "Ver solo cerradas".

**Modal Registrar cobro:**
- Subtexto: "«{op}» · comisión prevista {€}." → **"Guarda el cobro interno de esta comisión. No
  genera factura."** (+ chip de contexto con la operación y su prevista).
- Placeholder nota: "…regularizar IVA con gestoría…" → **"Ej.: cobrado por transferencia."**
- Se elimina la nota inferior "Control interno. No genera factura, impuestos ni contabilidad."

## 5. Cómo queda Comisiones
- **Header**: "Comisiones" · "Control interno de comisiones comerciales." · acción: *Incluir abiertas
  (N)* + contador.
- **KPIs**: Comisión prevista (Estimación comercial) · Pendiente de cobro (Por registrar) · Cobrada
  (Registrada) · Cerradas con comisión (Vendidas / alquiladas).
- **Lista**: operación · cliente · inmueble · tipo · % · importe · estado (Pendiente/Cobrada) ·
  acción (Registrar cobro / Marcar pendiente). Limpia, sin iconos de ruido.
- **Nota única** al pie (la del módulo económico).
- **Modal**: fecha de cobro (hoy por defecto, permite backdating) · importe real opcional · nota
  opcional · una sola frase de límite ("No genera factura").
- **Disclaimers visibles totales en la pestaña: 2** (nota de pie + frase del modal) frente a ~6 antes.

## 6. Marcar pendiente — comportamiento (documentado)
"Marcar pendiente" es acción directa segura: pone `commission_status='pendiente'` y **limpia**
`commission_paid_at`/`commission_paid_amount` (coherente: dejan de existir un cobro y su fecha). **No**
toca `commission_rate` ni ningún dato de la operación (título, valor, inmueble, cliente, trámites,
documentos). La comisión prevista se recalcula sola desde `commission_rate` × base.

## 7. Qué NO es facturación / qué queda para el módulo económico
- Comisión **prevista** = estimación comercial (precio o valor × % pactado). Comisión **cobrada** =
  registro interno (importe + fecha + nota). **Ninguna** genera factura, impuestos, gastos ni
  beneficio neto.
- **Futuro módulo económico** (documentado, NO construido): facturación fiscal, cobros/pagos, gastos,
  impuestos (IVA/IRPF), beneficio, método/estado de pago. Una operación cerrada con comisión cobrada
  es su punto de entrada natural.

## 8. Qué NO se tocó
n8n · Asistente IA · Auth/onboarding · Storage policies · RLS · Clientes · Calendario · Dashboard
(salvo P6.12-QA; aquí **sin** cambios) · `.env.local`/secretos · **sin service_role en frontend** ·
**sin facturación/impuestos/gastos/beneficio reales** · sin migraciones · sin cambios de lógica.

## 9. Validaciones
- `npx tsc --noEmit` ✅
- `npm run lint -- --max-warnings=0` ✅
- `npm run build` ✅ (`✓ Compiled successfully`)
- Scans: **probabilidad** (0 visible en Cartera) · **pipeline/expediente/lead** (solo claves
  internas/comentarios) · **service_role / secretos** (0 en frontend) · **UUID visible** (0) ·
  **lead_score** (0) · **facturación**: reducida a **2 menciones controladas** en la pestaña.

## 10. Checklist QA (staging)
- [ ] Pestaña Comisiones: header "Control interno de comisiones comerciales."; KPIs con subcopys
      nuevos; **una** nota al pie; sin "no es factura" repetido en cada card.
- [ ] Toggle **"Incluir abiertas (N)"** alterna con "Ver solo cerradas"; por defecto solo cerradas.
- [ ] Fila: estado Pendiente → botón **"Registrar cobro"**; estado Cobrada → **"Marcar pendiente"**;
      sin iconos de ruido.
- [ ] Modal: subtexto "Guarda el cobro interno de esta comisión. No genera factura."; fecha (hoy) +
      importe opcional + nota opcional; placeholder sin referencia fiscal.
- [ ] Registrar cobro → badge **Cobrada** + suma en KPI Cobrada; **Marcar pendiente** revierte sin
      perder `commission_rate` ni datos de la operación.
- [ ] Operaciones (tab): KPI "Comisión estimada" con subcopy "Operaciones abiertas" (sin disclaimer).
- [ ] Sin "Probabilidad/pipeline/expediente/lead/Cerrada" visibles indebidos en Cartera.

## Veredicto
**P6.13 COMPLETADO — COMISIONES FINAL COPY POLISH.** La pestaña Comisiones queda profesional, simple
y clara: KPIs con subcopys útiles, botones limpios sin iconos de ruido, toggle preciso ("Incluir
abiertas"), modal sobrio y **un único** mensaje de límite ("control interno · módulo económico
futuro") en vez de disclaimers por todos lados. Sin facturación real, sin tocar lógica, RLS/Storage/
secretos intactos. `tsc`/`lint`/`build` en verde. Requiere redeploy.
