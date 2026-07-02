# FASE P39 — Product Acceptance Gate (QA final, smoke tests, checklists, scans y cierre pre-siguiente fase)

> **Fecha:** 2026-07-02 · Fase de **aceptación**: simular uso real, preparar checklists de validación, correr
> todas las suites de evals y **corregir solo bugs reales**. No se añadieron features. **Sin n8n, sin
> Asistente-facturas, sin migraciones, sin cambios destructivos.** El gate caló **2 bugs reales** (los dos
> corregidos) que estaban ocultos hasta ejecutar las evals completas.

---

## 1. Baseline
`main`, árbol **limpio**, último commit **P38 `f86cd10`**. Sin cambios parciales.

## 2. Rutas auditadas
**Core:** `/login`, `/dashboard`, `/clients`, `/clients/[id]`, `/opportunities` (cartera),
`/opportunities/properties/[id]`, `/calendar`, `/assistant`, `/settings`, `/facturacion`.
**Sistema:** `/reset-password`, `/auth/callback`, `/onboarding`.
**Gated (internal `NOWLABS_INTERNAL`):** `/automations`, `/billing`, `/inbox`.
Confirmado: la ruta legacy `/api/clients/[id]/documents` **ya no existe** (eliminada en P38). El árbol de
rutas compila y renderiza (build OK).

## 3. Smoke tests (checklist)
Se elaboró el guion de validación funcional por módulo — ver **`docs/VALIDATOR_QA_CHECKLIST.md`**
(Dashboard, Clientes, Cartera, Calendario, Asistente, Configuración, Facturación, Documentos), en español y
apto para un validador no técnico.

## 4. Bugs encontrados (por el gate de evals)
1. **`real-estate-search`**: `parseBudget('entre 200 y 250 mil')` devolvía `minPrice=200` en vez de
   `200000`. El sufijo compartido «mil» se aplicaba al límite superior pero **no** al inferior. → **bug real**
   del buscador de inmuebles del Asistente (un validador que pida «entre 200 y 250 mil» obtendría un rango
   incorrecto).
2. **`assistant.capabilities`**: el resumen de capacidades que ve/razona el Asistente contenía la palabra
   **«workspace»** (en la explicación de *Equipo*), prohibida en copy visible (regla P17).

## 5. Bugs corregidos
1. `real-estate-search.ts`: `minPrice = scale(between[1], between[2] ?? between[4])` (el sufijo aplica a ambos
   extremos, simétrico con `maxPrice`). Verificado por eval.
2. `product-capabilities.ts`: «…accedan al **workspace**…» → «…accedan a **la cuenta**…». Verificado por eval.

## 6. Checklist validador
`docs/VALIDATOR_QA_CHECKLIST.md` — guía simple: configurar empresa, clientes + documentos, cartera,
calendario, Asistente (incluye el caso «entre 200 y 250 mil»), Facturación completa (texto→emisión→PDF→
papelera→resumen) y móvil, con instrucciones de **cómo reportar fallos**.

## 7. Checklist mobile
Incluido en la guía del validador (sección 7) y en el informe de P38 (§30). Riesgos de código revisados: los
usos de `100vh` son `clamp()`/`calc()` controlados (paneles/modales), **no** `h-screen` que rompa móvil;
inputs a 16px (sin auto-zoom iOS); pestañas con `overflow-x-auto`; editor de factura con toggle Editar/Vista
previa en móvil.

## 8. Datos necesarios para validar
Para una validación completa conviene tener (si no existen, crearlos siguiendo la guía):
- 1+ **empresa** con datos fiscales + logo (Configuración).
- 2–3 **clientes** con datos completos (país/idioma/NIF).
- 3–5 **inmuebles** de tipos distintos (piso/casa/local) y operaciones (venta/alquiler).
- 1–2 **operaciones**, alguna **tarea** y **cita**, y 1 **trámite**.
- 1 **documento** por entidad (cliente/inmueble/trámite).
- 1 **factura** creada (texto→emisión→PDF).
No se añadió seed automático (fuera de alcance); la guía indica cómo generarlos manualmente.

## 9. Facturación — no regression
Evals `calc/parse/pdf/summary` → **PASS**. Módulo intacto (P36F). PDF smoke (incl. divisa USD con nota de
cambio) OK.

## 10. Asistente — no regression
`get_invoices_summary` = `not_available`; **0** `from('invoices')` en `agent-tool-readers`; documentos por
`entity_files` (metadata); evals `capabilities/reliability/expand/guard` → **PASS** (tras el fix de copy).
**n8n intacto.**

## 11. Documentos — no regression
Cliente/inmueble/trámite usan `EntityDocumentsManager` (`entity_files`, signed URLs, RLS). **0**
`from('documents')`. Asistente lee solo metadata.

## 12. Scans
- `from('documents')`: **0**. · `from('invoices')` en Asistente: **0**. · `service_role` en frontend: **0**
  (los mensajes técnicos de Google Calendar en `settings` están **gateados** a `NOWLABS_INTERNAL`; el cliente
  ve copy genérico). · `@ts-ignore`: **0**. · secrets/`sk_live`: **0**. · `w-screen`/`h-screen` peligrosos:
  **0** (solo `clamp/calc(100vh…)` controlados). · marca legacy visible: **0**.

## 13. Validaciones
`npx tsc --noEmit` **OK** · `npm run lint -- --max-warnings=0` **OK** · `npm run build` **OK** ·
`node --check scripts/check-agent-deploy.mjs` **OK** · **12/12 suites de evals PASS** (invoicing×4,
real-estate-search, portfolio-filter, profile-avatar, locations, assistant×4) · escaneo de secretos **sin
hallazgos** · `git status` limpio tras commit.

## 14. Archivos tocados
- `src/lib/real-estate-search.ts` (fix rango «entre X y Y mil»).
- `src/lib/product-capabilities.ts` (copy «workspace» → «la cuenta»).
- **Nuevos:** `docs/VALIDATOR_QA_CHECKLIST.md`, `docs/PHASE_P39_PRODUCT_ACCEPTANCE_GATE_REPORT.md`.

## 15. Migraciones
**Ninguna.**

## 16. Qué NO se hizo
No seed automático de datos; no QA con dispositivo físico (checklist preparado); no se tocó Facturación
(solo evals), Asistente-facturas, n8n, emails, OCR, import/export, pasarelas ni dominio.

## 17. Commit / 18. Push
Ver `fix(p39)` en `main` (push a `origin/main`).

## 19. Pendientes honestos
- **QA manual con dispositivo real** siguiendo `VALIDATOR_QA_CHECKLIST.md`.
- **Seed de datos de validación** (opcional) para acelerar pruebas de terceros.
- **Documentos avanzados** (versionado/preview) y **persistir informes del Asistente en `entity_files`** —
  mejoras futuras, no bugs.
- Evals con I/O (RLS/E2E) no incluidas en el gate puro; se validan por MCP en fases con cambios de BD.

## 20. Veredicto
**P39 COMPLETADO — PRODUCT ACCEPTANCE GATE: CRM PREPARADO PARA VALIDACIÓN REAL CON CHECKLISTS (VALIDADOR +
MÓVIL), 12/12 SUITES DE EVALS EN VERDE, SCANS LIMPIOS Y 2 BUGS REALES CORREGIDOS (RANGO DE PRECIO «ENTRE X Y
Y MIL» Y COPY «WORKSPACE»). FACTURACIÓN/ASISTENTE/DOCUMENTOS SIN REGRESIONES, N8N INTACTO.**
