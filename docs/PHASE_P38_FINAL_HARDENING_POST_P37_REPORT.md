# FASE P38 — Final Hardening post-P37 (limpieza dead-code, documentos entity_files, QA mobile, polish)

> **Fecha:** 2026-07-02 · Pasada final **quirúrgica** (no features): se eliminó el **dead-code legacy** que
> aún apuntaba a la tabla inexistente `documents`, se corrigió un **bug real** en la generación de PDF del
> Asistente, se verificó la consistencia de documentos sobre `entity_files`, se hizo **QA mobile desde
> código** + checklist manual, y se revalidó todo. **Sin n8n, sin tocar Facturación (salvo evals), sin
> Asistente-facturas, sin migraciones, sin cambios destructivos.**

---

## 25. Baseline inicial
`git branch` = **main**, árbol **limpio**, último commit **P37 `2e2a5a5`**. Sin cambios parciales.

## 26. Dead-code `documents` encontrado
Tras P37 quedaban referencias a la tabla fantasma `documents`:
- `src/lib/supabase-queries.ts`: `listDocuments`, `createDocumentRecord`, `toDocumentRow`,
  `mapSupabaseDocument`, `normalizeDocumentType` (todas con `from('documents')`).
- API routes `src/app/api/clients/[id]/documents/route.ts` y `.../[docId]/route.ts` (INSERT/SELECT/DELETE
  sobre `documents`).
- **Bug real (alcanzable):** `saveGeneratedDocument` (usado por el Asistente para guardar el PDF de informe/
  factura generado) subía el PDF a Storage **correctamente** y después hacía `createDocumentRecord` →
  `INSERT` en `documents` → **excepción**. El llamante la capturaba y mostraba «El PDF se generó, pero no se
  pudo guardar en Storage. Revisa RLS del bucket…» **aunque la subida había funcionado** (falso error +
  volcado del contenido en el chat).

## 27. Dead-code eliminado / corregido
- **`saveGeneratedDocument` → upload-only:** ahora solo sube el PDF a su bucket y devuelve la ubicación (con
  `doc.id = null` por compatibilidad de firma; **no** se cambió el Asistente). El informe se guarda de verdad
  y deja de mostrar el falso error. Bug corregido sin tocar la lógica de facturas del Asistente.
- **Eliminadas** (código muerto sin callers): `listDocuments`, `createDocumentRecord`, `toDocumentRow`,
  `mapSupabaseDocument`, `normalizeDocumentType`.
- **Eliminadas** las 2 API routes `clients/[id]/documents/*` (inalcanzables: la ficha de cliente ya usa
  `EntityDocumentsManager`). Confirmado que **ningún** `fetch` las llamaba.
- Se conservan los helpers de Storage que **sí** se usan (`uploadDocumentToStorage`, `getSignedDocumentUrl`)
  y los tipos `WorkspaceDocument`/`DocumentPayload` (referenciados por las firmas de Storage).
- **Resultado:** **CERO** `from('documents')` en `src/` (verificado por escaneo).

## 28. Consistencia entity_files
Los tres gestores/lectores **live** usan `entity_files` con `entity_type` correcto:
- **Cliente** → `EntityDocumentsManager entityType="client"` (P37).
- **Inmueble** → `EntityDocumentsManager entityType="property"`.
- **Trámite (service_case)** → `EntityDocumentsManager entityType="service_case"`.
- **Factura PDF** → `entity_files entityType="invoice"` (emisión P34+).
- **Asistente (metadata)** → `get_documents_metadata` y `get_client_360` leen `entity_files` (solo metadata;
  sin contenido/OCR; sin `storage_path`/IDs técnicos visibles; error ≠ vacío). Mismo componente = mismo copy,
  iconos, categorías, estados, empty state y descarga por signed URL en todas las entidades.

## 29. Mobile QA desde código
Escaneo de patrones de riesgo en los componentes tocados/críticos: **sin** `w-screen`, `h-screen`, `100vh`
ni `min-w-[…]` problemáticos en `components/invoicing/*` ni en `EntityDocumentsManager`. Inputs a **16px** en
móvil (`text-base sm:text-sm`) en editor de factura, generador y búsquedas → sin auto-zoom iOS. Editor de
factura en móvil = toggle **Editar / Vista previa** (no dos paneles a la vez). Pestañas de estado con
`overflow-x-auto`. Modales de borrado/eliminación centrados y usables.

## 30. Checklist mobile manual (para validar con dispositivo real)
> Ejecutar en **iPhone Safari (390px)** y **Android Chrome (360px)**. Marcar cada punto.
- [ ] **Login / reset:** formulario sin zoom, botón visible, sin scroll horizontal.
- [ ] **Dashboard:** KPIs en grid, sin corte; drawer del menú se abre/cierra y no bloquea el scroll.
- [ ] **Clientes / ficha:** pestañas scrollables; pestaña **Documentos** sube/lista/descarga/borra; sin UUID
      ni `storage_path` visibles.
- [ ] **Cartera / inmueble:** cards (no tabla) en móvil; fotos y documentos usables.
- [ ] **Calendario:** agenda/próximas citas legibles; crear/editar cita sin que el teclado tape el CTA.
- [ ] **Asistente:** input 16px; respuestas sin IDs; generar informe PDF → enlace abre el PDF.
- [ ] **Facturación:** crear por texto/voz; selector de divisa; serie; **checklist pre-emisión**; emitir →
      **descargar PDF**; papelera → restaurar / eliminar definitivamente (modal ELIMINAR).
- [ ] **Facturación resumen:** KPIs y gráficos sin overflow; periodo cambia.
- [ ] **General:** ningún scroll horizontal accidental; drawers y modales a pantalla usable.

## 31. Facturación — no regression
No se tocó el módulo. **Evals** (`calc`, `parser`, `pdf`, `summary`) → **PASS**. Series/divisas/FX guardrail/
autofill/checklist/papelera/purga/resumen intactos (P36F). PDF smoke incluido en `invoice-pdf.evals` → OK.

## 32. Asistente — no regression
`get_invoices_summary` sigue `not_available`; **0** `from('invoices')` en `agent-tool-readers`; sin
`preparedAction` de factura producido; documentos por `entity_files` (metadata). **n8n intacto.** El cambio en
`saveGeneratedDocument` no toca la lógica de facturas del Asistente (helper de Storage compartido).

## 33. Seguridad / scans
- `from('documents')`: **0**. · `service_role`/`SUPABASE_SERVICE_ROLE` en **frontend**: **0** (solo server
  API + `supabase-admin.ts` server-only). · `@ts-ignore`: **0**. · secrets/`sk_live`: **0**.
- `console.log`: server-side (rutas API), no sensible. · Sin `localhost`/dominios hardcodeados en las rutas
  revisadas. · Sin marca legacy (`NowLabs`/`Copiloto`) **visible** al usuario (solo identificadores internos).

## 34. RLS / Storage
Sin cambios. Verificado en P37 (BD real): **RLS activa** en las 11 tablas críticas con políticas;
`entity-files` privado (signed URLs); logos/avatares públicos por diseño. Sin acceso cross-workspace.

## 35. UX / copy polish
La generación de informe del Asistente deja de mostrar el **falso error de Storage**. Copy de documentos del
cliente unificado con inmuebles/trámites (mismo `EntityDocumentsManager`). No se hicieron rediseños.

## 36. Tests / evals
Invoicing evals **PASS**; `tsc` **OK**; `lint --max-warnings=0` **OK**; `deploy-gate` **OK**.

## 37. Validaciones
`npx tsc --noEmit` **OK** · `npm run lint -- --max-warnings=0` **OK** · `npm run build` **OK** (tras limpiar
`.next` para regenerar el árbol de rutas sin las rutas borradas) · `node --check scripts/check-agent-deploy.mjs`
**OK** · evals **PASS** · escaneo de secretos **sin hallazgos** · `git status` limpio tras commit.

## 38. Archivos tocados
- **Modificado:** `src/lib/supabase-queries.ts` (dead-code fuera; `saveGeneratedDocument` upload-only).
- **Eliminados:** `src/app/api/clients/[id]/documents/route.ts`, `src/app/api/clients/[id]/documents/[docId]/route.ts`.
- **Nuevos:** este informe (+ nota en roadmap).

## 39. Migraciones
**Ninguna.** Solo limpieza de código sobre tablas existentes. Sin cambios de esquema ni de políticas.

## 40. Qué NO se hizo
- No se tocó **Facturación** (solo evals), ni la **lógica de facturas del Asistente**, ni **n8n**.
- No se añadió persistencia de los PDFs de informe/factura del Asistente en `entity_files` (hoy viven solo en
  su bucket de Storage con signed URL; suficiente para el enlace). Migrarlos a `entity_files` sería una mejora
  futura, no un bug.
- No OCR/emails/import-export/pasarelas/Verifactu; no reescrituras grandes.

## 41. Commit / 42. Push
Ver `chore(p38)` en `main` (push a `origin/main`). Detalle tras publicar.

## 43. Pendientes honestos
- **QA mobile manual** con dispositivo real siguiendo el checklist de §30 (no verificable solo desde código).
- **Persistir informes/facturas del Asistente en `entity_files`** (mejora, no bug).
- **Documentos avanzados** (versionado, previsualización inline, tipos avanzados) — fase futura si se prioriza.

## 44. Veredicto
**P38 COMPLETADO — FINAL HARDENING POST-P37: DEAD-CODE `documents` ELIMINADO (CERO `from('documents')`), BUG
REAL DE GENERACIÓN DE PDF DEL ASISTENTE CORREGIDO, DOCUMENTOS 100% SOBRE `entity_files`, QA MOBILE PREPARADA
(CHECKLIST INCLUIDO), SCANS LIMPIOS Y TODO VALIDADO. FACTURACIÓN Y ASISTENTE SIN REGRESIONES, N8N INTACTO.**
