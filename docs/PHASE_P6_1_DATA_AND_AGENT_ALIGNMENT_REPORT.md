# FASE P6.1 — Alineación integral con el modelo Cartera/Inmuebles

> **Fecha:** 2026-06-23 · Integrada con P6 (mismo commit). Toca `/opportunities`, Sidebar,
> Dashboard (microcopy), Asistente (UI), `vertical-queries` (tipo) + docs. **Sin** migraciones
> (datos ya limpios). Requiere redeploy.

## 1. Auditoría de BD
Ver `docs/REAL_ESTATE_DATA_MODEL_AUDIT.md`. Resumen: `properties` es rico (tipo, operación,
estado, precio, hab/baños/m², referencia, owner, client_id); **no hay** imágenes, **ni** tabla de
documentos, **ni** buckets de Storage; operación↔inmueble solo vía `metadata.property_id`;
trámite↔operación vía `service_cases.opportunity_id` (real). Producto real **vacío** (1 workspace,
0 datos fuera del ejemplo).

## 2. Naming final
**Sidebar: "Cartera"** · Página: **"Cartera inmobiliaria"** · tab por defecto **Inmuebles**. Fuera
"Operaciones" como módulo dominante, fuera "Pipeline" y "Expediente" en la UI visible.

## 3. Módulo cartera/inmuebles
Ver `docs/PHASE_P6_REAL_ESTATE_PORTFOLIO_REDESIGN_REPORT.md`.

## 4. Dashboard (microcopy mínimo)
El Dashboard ya es coherente (KPIs/funnel de **operaciones** siguen siendo válidos). Único cambio:
"Expedientes esperando docs" → **"Trámites esperando documentación"**. **No** se tocó la estructura
ni el no-scroll (P6.1 pide tocar mínimo si ya está bien). Un KPI "Inmuebles en cartera" en el
Dashboard queda como mejora futura (evitar romper el cockpit no-scroll).

## 5. Sidebar / copy
Sidebar "Operaciones" → **"Cartera"** (icono inmueble). Ruta intacta.

## 6. Asistente (UI, copia segura)
**No se tocó el prompt del agente** (28 tools tuned, sin infra de evals aquí → riesgo). Sí se
alineó la **copia visible** de la UI del asistente (sin afectar lógica; el agente ya reconoce
"trámite", ver mapeo `/expediente|trámite/`):
- Chips: "Expedientes abiertos" → **"Trámites abiertos"**; "Buscar propiedad" → **"Buscar inmueble"**.
- Capacidades: añadido **"Inmuebles"**; "Expedientes" → **"Trámites"**.
- Ejemplos/descripciones/empty: "expediente" → "trámite"; añadido "inmuebles".
- Tarjetas de confirmación y toasts de acción: "Expediente" → **"Trámite"**.
**Pendiente (P6.2, con evals)**: alinear el **prompt** del agente (`nowlabs-main-agent.ts`:
descripciones de tools y guías) de "expediente/pipeline" → "trámite/cartera-inmuebles". No se hizo
ahora para no degradar un asistente tuneado sin red de evals.

## 7. Datos de ejemplo
**Ya limpios** (saneados en P4.6.2): 0 emails reales, 0 PII, 0 textos vulgares. Verificado:
9 clientes · 7 inmuebles · 8 operaciones · 5 trámites; 0 emails no ficticios. **No** se aplicó
migración (no hacía falta). Huérfanos: 0 detectados en esta auditoría.

## 8. Fotos / documentos
**No implementados** (sin Storage). Placeholder honesto + roadmap unificado
(`REAL_ESTATE_MEDIA_AND_DOCUMENTS_ROADMAP.md`). Sin fake upload.

## 9. Qué NO se implementó (por honestidad)
Fotos de inmueble, documentos/PDFs, enlace estructurado operación↔inmueble, KPI de cartera en
Dashboard, reescritura del prompt del agente. Todo documentado como roadmap.

## 10. Producto real vacío — confirmado
1 workspace total (el ejemplo); 0 clientes/inmuebles fuera del ejemplo. Usuario nuevo arranca
vacío con onboarding (sin heredar Costa Azul, sin "demo").

## 11. Validaciones
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Sin secretos/PII en el diff.

## Veredicto
**P6.1 PARCIAL SEGURO — CARTERA ALINEADA + DATOS LIMPIOS + AGENTE (UI) COHERENTE.** Módulo,
sidebar, dashboard (copy) y UI del asistente alineados al modelo inmobiliario; datos de ejemplo
limpios y producto real vacío verificados; fotos/documentos y prompt del agente quedan como
roadmap honesto (sin humo). Requiere redeploy.
