# FASE P2 — Perfección visual del CRM básico (auditoría + pulido seguro)

> **Fecha:** 2026-06-21 · HEAD previo `a152c82`. Toca runtime CRM (`src/`, mínimo) →
> **requiere redeploy**. Sin tocar `.env`/`.mcp.json`/secretos/Supabase/RLS/Auth/workflows.
> Sin features nuevas. Sin rediseño a ciegas de páginas grandes.

---

## 1. Objetivo
Dejar el CRM básico "parece producto" (premium, limpio, responsive), vendible como pack
básico, sin módulos premium expuestos.

## 2. Precondición de deploy
- `origin/main` incluye `a152c82` (P1) ✅ y todo el runtime de N4/N4.1 (`66581d0`+).
- **Staging debe redeployarse** a `a152c82`+ para incluir P1, N4/N4.1 runtime y este P2.
- Para vista de cliente: `NEXT_PUBLIC_NOWLABS_INTERNAL=false`.

## 3. Auditoría (estática — sin navegador)
**No hay navegador/Playwright en el entorno** (no instalado; demo necesita sesión). Per la
Opción B del brief, hice **auditoría estática profunda** y solo cambios verificables por
código; el pulido visual fino se delega a QA humano en staging (checklist provisto).

**Hallazgo central: el producto YA estaba fuertemente productizado y pulido** (fases RT/S +
Vertical Pack + Clone-readiness + P1). Evidencia en código:
- `BRAND` centralizado y limpio (sin NowLabs/CostaDelSol/Real Homes en UI de cliente).
- **Feature flags** (`feature-flags.ts`) ocultan todo lo dormido: `nowlabsInternal`/
  `demoData` default OFF.
- **Dashboard** ya responsive (`grid-cols-2 xl:grid-cols-4`, `sm:grid-cols-3`), con empty
  states, cards con gradiente/hover, datos reales; KPIs de Cobros/WhatsApp gateados.
- **Sidebar** limpio; WhatsApp/Automatizaciones/Facturación marcados `internal`.
- **lead_score / "Score"** gateado por NOWLABS_INTERNAL en listado y ficha.
- **Settings** separa cliente vs operador (`SHOW_INTERNAL_TECH`); tiles técnicos ocultos.
- **Asistente** quick-actions ya read-only/limpias; cerebro N4.x (171 evals).
- Sweep de términos legacy/dev (NowLabs/CostaDelSol/Backend agent/V1/V2/coming soon/…) en
  páginas de cliente: **limpio** (los hits de n8n/OpenAI viven en páginas internas gateadas).

## 4. Cambios aplicados (seguros, verificables)
- **Dashboard:** añadido CTA **"Copiloto"** en la cabecera (botón → `/assistant`, gateado por
  `featureFlags.assistant`, `flex-wrap` para no romper en móvil) — el único requisito de
  dashboard que faltaba (CTA al asistente).
- (P1 ya había quitado las menciones de "cobros" del copy del dashboard.)
- No se reescribieron páginas grandes (clientes/ficha 1500+ líneas, asistente 4039) a ciegas:
  riesgo de regresión visual no verificable.

## 5. Componentes
No se crearon componentes nuevos (ya existen `SectionCard`, `Button`, `Badge`, `MetricTile`,
`EmptyState`/`PageSkeleton`, etc.). Evitado refactor peligroso por reducir duplicación.

## 6-11. Páginas (estado)
- **Dashboard:** premium, responsive, CTA Copiloto añadido. ✅
- **Clientes/ficha 360:** ficha 360 completa (datos/contacto/operaciones/expedientes/tareas/
  citas/actividad/documentos), score/UUID/facturación gateados. Sin cambios (ya correcto).
- **Operaciones (pipeline):** etapas/cliente/propiedad/importe, naming comercial. Sin cambios.
- **Expedientes/Tareas/Calendario:** naming comercial, empty states, sin OAuth visible al
  cliente. Sin cambios.
- **Asistente/Settings/Login/Demo:** quick-actions limpias; settings gateado; login con BRAND
  limpio; demo offline funcional. Sin cambios necesarios.

## 12. Responsive
Auditado por clases Tailwind: dashboard usa breakpoints (`grid-cols-2 xl:grid-cols-4`,
`sm:grid-cols-3`, header `flex-wrap`). La confirmación pixel a pixel en 390/768/1440 se hace
con el checklist (sección "P2 — Pack básico cliente" de `docs/QA_CHECKLIST.md`).

## 13. Factory state
Clon de cliente = solo env (sin código): `NEXT_PUBLIC_NOWLABS_INTERNAL=false`,
`NEXT_PUBLIC_ENABLE_DEMO_DATA` según caso, `NEXT_PUBLIC_ENABLE_*` para apagar módulos. Branding
en `src/lib/brand.ts`. Detalle en `docs/PRODUCT_MODULE_ROADMAP.md`. La QA de clon ya existe en
`docs/QA_CHECKLIST.md` (sección "Clone readiness QA").

## 14. Premium roadmap
`docs/PRODUCT_MODULE_ROADMAP.md` separa pack básico vs premium (facturas, scraper, WhatsApp,
web, RAG, Google Calendar real, escritura del agente, etc.). No implementado en P2.

## 15-16. QA / validaciones
- `tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅ (sin regresión).
- Sweep de cadenas legacy/dev en páginas de cliente: limpio.
- **QA visual/funcional manual:** pendiente en staging (checklist P2 + secciones existentes).

## 17. Riesgos
- El pulido visual fino (espaciado, alineaciones, móvil real) no se puede certificar sin
  navegador → requiere ojo humano en staging. El checklist guía esa pasada.
- Si staging queda con `NOWLABS_INTERNAL=true`, el cliente vería módulos internos.

## 18. Pendientes (para cerrar P2 como COMPLETADO)
1. Redeploy de staging a `a152c82`+ con `NEXT_PUBLIC_NOWLABS_INTERNAL=false`.
2. Pasada de **QA visual humana** con el checklist P2 (390/768/1440).
3. Enviar screenshots de cualquier pantalla que no convenza → corrección dirigida (puedo
   rediseñar una página concreta con feedback visual, sin tocar a ciegas).

## 19. Redeploy
**Sí** (cambió `src/dashboard`). Incluir también el runtime pendiente de P1/N4/N4.1.

## Veredicto
**P2 PARCIAL SEGURO — BASIC CRM VISUAL PRODUCT (núcleo ya productizado, falta QA visual
humana).** Auditoría confirma que el pack básico ya es un SaaS limpio y moderno (branding
centralizado, premium oculto por flags, naming comercial, dashboard responsive con empty
states, asistente read-only certificado). Añadido el CTA "Copiloto" en el dashboard;
entregado checklist visual P2 + factory config + roadmap. tsc/lint/build verdes. **Requiere
redeploy + una pasada de QA visual en staging** (no automatizable aquí) para declararlo
COMPLETADO; con screenshots concretos hago el pulido fino dirigido.
