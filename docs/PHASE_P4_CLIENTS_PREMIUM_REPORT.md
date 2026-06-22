# FASE P4 — Clientes Premium + Ficha 360

> **Fecha:** 2026-06-22 · HEAD previo `3e9d27b`. Solo `/clients` y `/clients/[id]` + 2 docs.
> **Sin** tocar Dashboard/Operaciones/Calendar/Settings/Asistente/onboarding/RLS/n8n. Sin
> migraciones. Requiere redeploy.

## 1. Objetivo
Dejar el módulo Clientes a nivel SaaS premium: listado claro y escaneable, ficha 360 útil de
un vistazo, acciones simples (email mailto, teléfono), delete seguro integrado, empty states.

## 2. Diagnóstico inicial (auditado)
- **`/clients`**: ya sólido — buscador (nombre/email/teléfono/empresa/DNI), filtros de estado,
  tabla con avatar/contacto/área/estado/alta, **mailto + tel + Ver ficha + editar + borrar**,
  `DeleteClientDialog` (P3.9A) ya integrado, empty states. Faltaba: **resumen de stats arriba**
  y quitar "Sin completar" feo.
- **`/clients/[id]`**: ficha rica (1.6k líneas) — header con mailto/tel/copy/editar, tabs
  (Resumen/Documentos/Expedientes/Visitas/Tareas; documentos/conversaciones/facturas
  **gateados a operador**), Resumen con Datos/Contacto/Interés/Notas + operativo + actividad.
  Faltaba: **resumen ejecutivo** de un vistazo y botón **copiloto**.
- **Documentos**: `public.documents` **no existe**, **0 buckets** → feature no provisionada
  (el route fallaría). La pestaña ya está **oculta al cliente**. → se difiere (D1).
- Lo que **NO tocar**: delete seguro, RLS, asistente, dashboard, etc.

## 3. Cambios en el listado
- **Fila de stats** premium (solo con datos): Total clientes · Activos · En seguimiento ·
  Nuevos este mes (de `counts`, sin queries nuevas).
- "Sin completar" en Área/servicio → **"—"** discreto (no llenar de gris).
- Mantenido: buscador, filtros, mailto/tel, "Ver ficha" dominante, `DeleteClientDialog`,
  empty states.

## 4. Cambios en la ficha 360
- **Resumen ejecutivo** nuevo (arriba del Resumen): Perfil · Interés · Próxima cita ·
  Operación activa — "entender al cliente en 5 segundos" (de datos ya cargados).
- **Botón "Copiloto"** en el header (gated `featureFlags.assistant`) → abre `/assistant`.
- **"Documentos y recursos"**: card con empty state premium ("Aquí aparecerán los documentos
  del cliente"), sin fetch/upload (infra diferida, ver D1).
- "Resumen operativo": el pill "Documentos" (siempre 0 en cliente, no se carga) → **"Operaciones"**.

## 5. Email (mailto)
Listado y ficha: `mailto:${email}` (sin plantilla, sin body, sin asunto). Si no hay email →
no se muestra el botón / "Sin email". Sin Gmail API, sin sistema interno.

## 6. Teléfono
Número visible; `tel:${phone}`; en la ficha además **copiar al portapapeles** con toast (ya
existía `copyToClipboard`). Sin centralita ni llamadas desde el CRM.

## 7. Documentos / PDFs — decisión
**Diferido a fase D1** (`docs/CLIENT_DOCUMENTS_ROADMAP.md`): no hay tabla `documents` ni
bucket → no se implementa a medias. Bloque premium con empty state en la ficha; la pestaña
operativa sigue oculta al cliente. **Sin** RAG/IA de PDFs (premium futuro).

## 8. Delete seguro
Intacto (P3.9A): `DeleteClientDialog` (preview + doble confirmación + cascade RPC) en el
listado; tras borrar refresca la lista. La ficha no borra el cliente (su ConfirmDialog es solo
para documentos). No hay papelera de delete directo.

## 9. Empty states
- Listado vacío (workspace real nuevo): "Todavía no hay clientes" + "Crear primer cliente".
- Filtros sin resultados: "Limpiar filtros".
- Ficha: secciones con empty states elegantes ("No consta", "Sin operaciones abiertas", etc.).

## 10. Responsive
Listado: tabla con `overflow-x-auto` (scroll horizontal en móvil, sin overflow de página);
stats 2 col móvil → 4 desktop. Ficha: header apila, acciones con flex-wrap, tabs scrollables,
Resumen 1 col móvil → 2 col desktop. (Pendiente: cards responsivas en lugar de scroll
horizontal en la tabla — mejora futura.)

## 11. QA
tsc/lint/build verdes. Revisado: listado carga, stats, búsqueda, filtros, mailto/tel, ver
ficha, delete dialog (P3.9A ya verificado), resumen ejecutivo con datos del ejemplo
(Familia Soler/Lucía/Javier), copiloto abre /assistant. Visual humano pendiente en staging.

## 12. Validaciones
`tsc --noEmit` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. (Fix lint `react-hooks/purity`:
`Date.now()` en useMemo → `new Date().getTime()`.)

## 13. Pendientes honestos
- **D1 — Documentos de cliente** (tabla + bucket + RLS + signed URLs + upload UI). Ver roadmap.
- Tabla de clientes → **cards responsivas** en móvil (hoy scroll horizontal).
- Copiloto con **activeEntity** del cliente (deep-link con contexto) — hoy abre /assistant sin
  preseleccionar; el asistente ya soporta memoria de cliente, falta el deep-link.
- Rediseño visual fino de la ficha (no era necesario: ya está bien estructurada).

## 14. Archivos tocados
- `src/app/(saas)/clients/page.tsx` (stats row, "—", counts).
- `src/app/(saas)/clients/[id]/page.tsx` (resumen ejecutivo, copiloto, documentos card,
  derived nextEvent/activeOpp, imports).
- NUEVO `docs/CLIENT_DOCUMENTS_ROADMAP.md` + este report.

## 15-16. Commit / push / redeploy
Ver hash `polish(clients): premium list stats + 360 executive summary + copilot (P4)`. Push a
`origin/main`. **Requiere redeploy** (cambió `src/`).

## 17. Qué probar en staging
- **Ejemplo** ("Inmobiliaria Costa Azul"): listado con stats (9 clientes), buscar/filtrar,
  Ver ficha de Familia Soler/Lucía/Javier → resumen ejecutivo con datos, operaciones/tareas/
  citas/expedientes, mailto/tel, Copiloto. Móvil 390 sin overflow de página.
- **Workspace real vacío**: listado "Todavía no hay clientes" + CTA; sin stats vacías.

## Veredicto
**P4 PARCIAL SEGURO — CLIENTES PREMIUM (listado + ficha 360) con documentos diferidos.** El
listado gana una banda de stats y limpieza; la ficha gana un resumen ejecutivo y el copiloto,
manteniendo su estructura rica y el delete seguro de P3.9A. Los documentos quedan como **D1**
(infra inexistente; no se implementa a medias). tsc/lint/build verdes. **Requiere redeploy.**
