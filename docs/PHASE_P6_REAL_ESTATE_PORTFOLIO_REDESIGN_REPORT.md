# FASE P6 — Cartera inmobiliaria como centro del CRM

> **Fecha:** 2026-06-23 · HEAD previo `8e52407`. `/opportunities` (UI) + `vertical-queries`
> (tipo) + Sidebar (label). **Sin** migraciones, sin Storage, sin fake upload. Requiere redeploy.

## 1. Diagnóstico
El módulo abría como "Operaciones" (concepto abstracto). Una inmobiliaria trabaja con
**inmuebles**: registrar la propiedad, su precio/estado, propietario, interesados, operación y
documentación. "Operaciones" como pantalla principal confundía.

## 2-3. Decisión de producto + naming
**Inmueble** (tabla `properties`) = activo gestionado · **Operación** = negocio comercial ·
**Trámite** (`service_cases`) = gestión/documentación · **Documento/Foto** = archivo real (futuro).
- **Sidebar: "Cartera"** (icono inmueble). **Página: "Cartera inmobiliaria".** Ruta `/opportunities`
  intacta (sin romper enlaces).
- Tabs: **Inmuebles** (por defecto) · Operaciones · Trámites.

## 4. Inmuebles (vista principal — cards premium)
Grid de **cards** (`sm:2 / xl:3`): placeholder visual elegante (sin fotos aún) con badge de
**operación** (Venta/Alquiler/…) y **estado** (Publicado/Reservado/Captación…); título, **referencia**
+ tipo, **habitaciones · baños · m²**, **precio** (con `/mes` en alquiler), **ubicación + propietario/
cliente**, y "N operaciones vinculadas" cuando existe enlace. Estado editable inline + Editar.
Datos reales (columnas `properties`; beds/baths/m² desde columna o, en demo, metadata).

## 5. KPIs de cartera (en la vista Inmuebles)
**Inmuebles en cartera · En comercialización · Reservados · Valor de cartera** (suma de precios
listados, *no* facturación; excluye vendidos/archivados). El resto de vistas mantienen los KPIs
comerciales (Operaciones abiertas / Valor potencial / Trámites / Inmuebles).

## 6. Operaciones (secundaria)
Sin cambios de fondo (P5/P5.1): por etapa, con cliente, valor, probabilidad, cierre, "Cierre
pronto". **Añadido**: muestra el **inmueble vinculado** cuando hay `metadata.property_id`
(honesto: si no hay enlace, "Sin cliente ni inmueble vinculado"). CTA principal pasó a **"Nuevo
inmueble"**; "Nueva operación"/"Nuevo trámite" secundarios; Refrescar icono.

## 7. Trámites (secundaria)
"Trámites" (no "Expediente"/`service_case`). Muestra **cliente + operación vinculada** +
tipo/prioridad/vencimiento. Empty state claro.

## 8. Fotos
**No implementadas** (0 buckets de Storage, sin columna de imagen). Card con **placeholder**
elegante (icono, sin imagen rota, sin botón de subida falso). Roadmap:
`docs/REAL_ESTATE_MEDIA_AND_DOCUMENTS_ROADMAP.md` (D2).

## 9. Documentos/PDFs
**No implementados** (sin tabla ni bucket). Roadmap unificado por entidad (D1/D2/D3). Sin fake
upload.

## 10. Qué se implementó de verdad
Cartera de inmuebles con cards premium y KPIs reales; enlaces inmueble↔operación (cuando existen)
y operación↔trámite; reordenación + naming; empty states inmobiliarios. Todo con datos/relaciones
existentes, sin N+1 (1 lectura agregada de clientes).

## 11. Roadmap
Fotos/documentos (D-files), y enlace estructurado `opportunities.property_id` (hoy solo metadata).

## 12. Validaciones
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅.

## Veredicto
**P6 PARCIAL SEGURO — CARTERA INMOBILIARIA.** El módulo deja de ser "Operaciones" abstracto: abre
en **Inmuebles** (cards premium + KPIs de cartera), con Operaciones y Trámites alrededor, naming
coherente y fotos/documentos honestamente en roadmap. Requiere redeploy.
