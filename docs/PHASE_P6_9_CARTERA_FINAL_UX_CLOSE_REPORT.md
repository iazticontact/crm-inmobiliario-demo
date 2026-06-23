# FASE P6.9 — Cierre final UX de Cartera: menos etapas + borrado guiado

> **Fecha:** 2026-06-23 · HEAD previo `02e5326`. UI + helper de etapas. **Sin migración** (claves
> de etapa intactas; datos antiguos compatibles). Requiere redeploy.

## 1-2. Diagnóstico
Cartera era funcional y segura (P6.8) pero faltaba pulido UX: **9 etapas** en los formularios
(demasiadas para una inmobiliaria pequeña) y, al intentar borrar una operación con trámites, un
**toast rojo de error** (correcto pero no premium).

## 3. Etapas: formulario vs tablero (sin perder datos)
Nuevo helper `formStagesForVertical(vertical, currentStage?)`:
- **Formularios (crear / editar / edición rápida)** ofrecen ahora **8 etapas**: Nueva · Contactado ·
  Visita · Oferta · **Negociación** · Reserva · Cerrada · Perdida.
- **"Cualificado" se OCULTA** de los formularios (`HIDDEN_FORM_STAGE_IDS = {'qualified'}`) — es un
  micro-paso de CRM que una inmobiliaria pequeña no separa.
- **El tablero sigue mostrando "Cualificado"** si hay operaciones en esa etapa (renderiza desde el
  pipeline completo). Y si una operación **ya está** en una etapa oculta/antigua, su select **incluye
  esa etapa actual** (no se queda en blanco ni se pierde).

## 4. ¿Cualificado / Negociación?
- **Cualificado: oculto** en formularios, **visible en tablero** si hay datos (compatibilidad). El
  ejemplo tiene 1 operación en "Cualificado" → se sigue viendo y editando.
- **Negociación: se mantiene** (decisión justificada): es un estado comercial real y distinto
  (Oferta → Negociación → Reserva → Cerrada); quitarlo rompería el flujo de cierre. El ejemplo
  tiene 3 operaciones en "Negociación".

## 5. Borrado de OPERACIÓN con trámites — UX guiada (no toast)
- **Sin trámites** → ConfirmDialog: "¿Eliminar «título»? El cliente y el inmueble vinculados no se
  eliminan." → borra.
- **Con trámites** → **modal guiado** (ya no toast rojo): título *"Esta operación tiene trámites
  vinculados"*, texto *"Para no perder documentación ni dejar gestiones sueltas, elimina o reasigna
  sus N trámites antes de borrar «título». Vinculados: A, B, C (+N más)."*, botones **"Ver trámites"**
  + "Cancelar". **No se borra.**
- **"Ver trámites"** → cambia a la pestaña **Trámites**, **resalta** (banner + anillo indigo) los
  trámites vinculados a esa operación, y muestra un toast informativo. "Ver todos" quita el resaltado.

## 6. Borrado de TRÁMITE — premium
Sin cambios de lógica (P6.8, ya correcta): ConfirmDialog que **avisa de los N documentos** → borra
documentos (Storage + metadata) y luego el trámite. No toca operación/cliente/inmueble.

## 7. Copy / ruido
- Descripción del tablero: "Negocio abierto por etapa…" → **"Operaciones activas agrupadas por etapa
  comercial."**
- Descripción de "Cualificado" acortada (solo se ve en tablero si hay datos).
- Grupos de etapa vacíos no se renderizan (ya). "Cierre pronto" sigue condicional.
- Sin "lead"/"pipeline"/"expediente"/"service_case" visibles (verificado por grep; solo internos).

## 7b. Facturación
Sin cambios: ver `docs/PHASE_P6_8_CARTERA_SAFE_DELETE_AND_BILLING_READINESS_REPORT.md`. "valor
potencial" ≠ facturación; el módulo económico (invoices/expenses/taxes/commission) será aparte.

## 8. Compatibilidad
**Sin migración.** Solo se filtran etapas en los selects de formulario; las claves internas
(`new`/`qualified`/`negotiation`/`won`…) no cambian. Operaciones existentes en cualquier etapa
(incl. Cualificado) siguen visibles y editables.

## 10. Validaciones
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Sin secretos/PII.

## 11. Archivos
`src/lib/demo/vertical-templates.ts` (`formStagesForVertical` + HIDDEN set + desc), `src/components/VerticalForms.tsx`
y `src/components/VerticalEditForms.tsx` (usan formStages), `src/app/(saas)/opportunities/page.tsx`
(modal guiado + resaltado + edición rápida con formStages + copy), este report.

## 15. Qué probar
- **Crear operación**: el select de etapa muestra **8** (sin "Cualificado").
- **Operación en Cualificado** (ejemplo): se ve en el tablero; su edición rápida muestra "Cualificado"
  seleccionado (no en blanco).
- **Borrar operación sin trámites** → confirm → borra (cliente/inmueble intactos; KPIs OK).
- **Borrar operación con trámites** → **modal guiado** (no toast rojo) → "Ver trámites" lleva a
  Trámites y **resalta** los vinculados; la operación **no** se borra.
- **Borrar trámite con documento** → confirm avisa "N documentos" → desaparece; refrescar no lo
  devuelve; operación/cliente/inmueble intactos.

## Veredicto
**P6.9 COMPLETADO — CARTERA UX FINAL CERRADA.** Menos etapas en formularios (8, sin "Cualificado")
sin perder datos antiguos; borrado de operación con trámites **guiado** (modal + "Ver trámites" +
resaltado) en vez de error seco; borrado de trámite premium; copy limpio. Sin migración, sin tocar
facturación. Requiere redeploy.
