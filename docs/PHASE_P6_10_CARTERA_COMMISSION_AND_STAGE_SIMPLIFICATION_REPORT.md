# FASE P6.10 — Comisión estimada (en vez de Probabilidad) + etapas finales

> **Fecha:** 2026-06-23 · HEAD previo `87a4a5a`. UI + helpers + **migración ligera** (columna
> `commission_rate` nullable) + seed de showcase. Requiere redeploy.

## 1-3. Diagnóstico: el problema con "Probabilidad (%)"
"Probabilidad (%)" es lenguaje de CRM genérico: una inmobiliaria no piensa en "% de probabilidad"
sino en **comisión**. Aparecía en el formulario (crear/editar) y como **chip** en la card de
operación ("40% / 70%"). **Decisión:** **quitar `probability` de toda la UI** y sustituirlo por
**Comisión pactada (%)** + **Comisión estimada (€)** calculada. La columna `probability` **se
conserva en BD** (no se borra; legacy/interno) — no es protagonista.

## 4. Migración o metadata
**Migración ligera (Opción B)**: `ALTER TABLE opportunities ADD COLUMN commission_rate numeric`
(nullable, aditivo, RLS ya lo cubre). El **importe** de comisión **NO se persiste** (se calcula en
frontend). Más estructurado para el futuro módulo económico sin riesgo.

## 5-6. Comisión pactada / estimada (cómo se calcula)
- **Comisión pactada (%)** = `opportunities.commission_rate` (opcional, sin default — no se inventa).
- **Comisión estimada (€)** = `base × rate / 100`, con **base** =
  1) **precio del inmueble vinculado** (si la operación tiene `property_id`), o
  2) **valor potencial** de la operación, o
  3) si no hay ninguno → **no se calcula** ("—").
- Helper `estimateCommission(base, rate)` reutilizable.
- **Formulario** (crear/editar): bloque económico = Valor potencial · **Comisión pactada (%)** ·
  Cierre estimado + tarjeta **"Comisión estimada"** readonly (se recalcula en vivo). Texto:
  *"Estimación orientativa; no es una factura."*
- **Card de operación**: el chip de probabilidad → **"Com. {importe}"** (verde) cuando hay comisión;
  si no, no se muestra.
- **Verificado**: "Venta piso Calle Mayor 14" (285.000 € × 3%) → **8.550 €** (coincide con el ejemplo).

## 7. KPIs de Cartera (tab Operaciones)
Ahora: **Operaciones abiertas · Valor potencial · Comisión estimada · Trámites abiertos.** La
"Comisión estimada" suma `base × rate/100` de las operaciones abiertas. Detalle: *"Orientativa · no
es facturación"*. (La pestaña Inmuebles mantiene sus 4 KPIs de cartera.)

## 8. Etapas finales (formularios)
`HIDDEN_FORM_STAGE_IDS = {qualified, negotiation}` → los formularios ofrecen **7 etapas**:
**Nueva · Contactado · Visita · Oferta · Reserva · Cerrada · Perdida.** Justificación de ocultar
"Negociación": para una inmobiliaria pequeña, **Oferta** y **Reserva** suelen bastar (la
negociación ocurre dentro de "Oferta"). **Compatibilidad**: el **tablero** sigue mostrando
"Cualificado"/"Negociación" si hay operaciones ahí, y la edición rápida de una operación en esas
etapas **incluye su etapa actual** (no se queda en blanco). El ejemplo (1 en Cualificado, 3 en
Negociación) se sigue viendo y editando. **Sin migrar datos.**

## 9. Copy
Sin "Probabilidad" visible (verificado por grep). Sin "lead"/"pipeline"/"expediente". "Comisión
estimada" siempre con disclaimer "no es factura".

## 10. Facturación futura (solo documentado)
La **comisión estimada NO es factura ni ingreso confirmado**. Cuando una operación esté **Cerrada**,
el futuro módulo económico (separado) podrá generar factura, cobro, gastos, impuestos y beneficio.
Ahora **no** se crea invoice/gastos/impuestos. Ver
`docs/PHASE_P6_8_CARTERA_SAFE_DELETE_AND_BILLING_READINESS_REPORT.md`.

## Compatibilidad / Qué NO se tocó
`probability` se conserva (legacy). Claves de etapa intactas. No se tocó n8n/Asistente/Dashboard/
Clientes/Calendario/facturación. Borrado seguro (P6.8/P6.9) intacto. Seed de comisión = solo
workspace de ejemplo (3%, ficticio, idempotente).

## Validaciones
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Sin "Probabilidad" visible; sin secretos/PII.

## Migraciones
- `20260623_p610_opportunities_commission_rate.sql` (columna; aplicada).
- `20260623_p610_seed_example_commission_rate.sql` (showcase 3%; aplicada).

## Archivos
`src/lib/demo/vertical-templates.ts` (oculta negotiation), `src/lib/vertical-queries.ts`
(commission_rate en tipo/create/update), `src/components/VerticalForms.tsx` (comisión + helpers
`estimateCommission`/`formatEuro`), `src/components/VerticalEditForms.tsx` (comisión + inmueble
vinculado), `src/app/(saas)/opportunities/page.tsx` (card + KPI), 2 migraciones, este report.

## Qué probar
- **Crear operación con inmueble** (precio 285.000) + comisión 3% → "Comisión estimada" muestra
  **8.550 €**; card muestra "Com. 8.550 €". Etapas: **7** (sin Negociación/Cualificado).
- **Sin inmueble**: valor potencial manual + comisión % → calcula sobre el valor.
- **Sin comisión**: "—"; card sin chip de comisión.
- **Operación en Negociación/Cualificado** (ejemplo): sigue visible en el tablero y editable.
- Borrado (P6.8/P6.9) sigue funcionando.

## Veredicto
**P6.10 COMPLETADO — COMISIÓN ESTIMADA Y ETAPAS SIMPLES.** "Probabilidad" fuera de la UI (legacy en
BD); **Comisión pactada/estimada** real y orientativa (no facturación) en formularios, cards y KPI;
**7 etapas** en formularios con datos antiguos compatibles. Migración ligera segura. Requiere redeploy.
