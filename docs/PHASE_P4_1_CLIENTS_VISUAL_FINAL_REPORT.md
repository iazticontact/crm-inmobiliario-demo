# FASE P4.1 — Clientes Premium definitivo (listado + ficha 360)

> **Fecha:** 2026-06-22 · HEAD previo `9f11772`. Solo `/clients` y `/clients/[id]` + docs.
> **Sin** migraciones, sin tocar otros módulos, sin documentos reales (D1). Requiere redeploy.

## 1. Diagnóstico de P4
P4 dejó Clientes funcional pero conservador: la lista seguía pareciendo tabla administrativa,
en **móvil** era una tabla con **scroll horizontal** tipo Excel, las acciones de fila eran
**iconos sueltos** (mail/tel/editar/borrar) y la ficha tenía un resumen ejecutivo de 4 ítems.

## 2. Listado — qué se mejoró
- **Móvil = tarjetas por cliente** (nuevo): la tabla se oculta en `<md` y se muestra una lista
  de cards (avatar, nombre, subtítulo, estado, contacto mailto/tel, **"Ver ficha"** + editar/
  borrar). **Se acabó el scroll horizontal**. La tabla premium se mantiene en desktop (`md+`).
- **Acciones de fila reordenadas** (no más iconos sueltos): "Ver ficha" pasa a botón
  **dominante oscuro** (gray-900) + un **grupo compacto** Editar/Eliminar en un control con
  borde. Se **quitaron los iconos mail/tel redundantes** de la columna Acciones (el email y el
  teléfono ya son clicables en la columna Contacto).
- Mantenido de P4: fila de **stats** (Total/Activos/En seguimiento/Nuevos este mes), buscador
  (nombre/email/teléfono/empresa/DNI), filtros de estado, "—" en lugar de "Sin completar".

## 3. Mobile
Listado móvil = cards (sin overflow horizontal). Ficha móvil: header apila (flex-wrap), tabs
scrollables, Resumen a 1 columna. Sin overflow de página a 390px.

## 4. Ficha 360 — qué se mejoró
- **Resumen ejecutivo ampliado a 6 ítems** (grid 3 col): Perfil · Interés · Operación activa ·
  Próxima cita · **Tarea pendiente** · **Expediente abierto** — todo de datos ya cargados
  (`sortedTasks`, `cases`, `opportunities`, `events`, `meta`), sin queries nuevas, sin inventar.
- Mantenido de P4: botón **Copiloto** en el header, card **"Documentos y recursos"** (empty
  state premium, sin upload), header con mailto/tel/copy/editar, secciones con "No consta"
  elegante.

## 5. Email / Teléfono
Email = `mailto:` puro (lista + ficha + cards), sin plantilla/body. Teléfono = `tel:` + copiar
al portapapeles (ficha). Si no hay email/teléfono, no se muestra icono inútil.

## 6. Delete seguro
**P3.9A intacto**: `DeleteClientDialog` (preview + doble confirmación + cascade RPC) desde la
papelera del listado (desktop y cards móvil). Nunca delete directo. La ficha no borra el
cliente.

## 7. Documentos — por qué siguen en D1
Sin tabla `public.documents` ni buckets (auditado en P4): no se implementa upload real a
medias. La ficha muestra un bloque "Documentos y recursos" con empty state premium; la pestaña
operativa sigue oculta al cliente. Roadmap en `docs/CLIENT_DOCUMENTS_ROADMAP.md` (sin RAG/PDF
IA).

## 8. Data / performance
**Cero queries nuevas**. El listado sigue cargando solo `clients`; las cards y el resumen
ejecutivo reutilizan datos ya cargados. No se añadió señal por-fila (operación/cita/tarea) en
el listado para no meter joins/N+1 — queda como mejora futura justificada.

## 9. Responsive
Desktop: tabla premium. Tablet/móvil: cards. Ficha: 2 col desktop → 1 col móvil.

## 10. QA
tsc/lint/build verdes. Revisado: listado desktop (tabla) y móvil (cards), stats, búsqueda,
filtros, Ver ficha, mailto/tel, editar, delete dialog (P3.9A), resumen ejecutivo de 6 ítems
con datos del ejemplo. Sin UUID/lead_score visibles (lead_score gated a operador). Visual
humano pendiente en staging.

## 11. Validaciones
`tsc --noEmit` ✅ · `lint --max-warnings=0` ✅ · `build` ✅.

## 12. Archivos tocados
- `src/app/(saas)/clients/page.tsx` (tabla `md:block` + cards móvil + acciones reordenadas).
- `src/app/(saas)/clients/[id]/page.tsx` (resumen ejecutivo a 6 ítems).
- Docs: este report.

## 13-15. Commit / push / redeploy
Ver hash `polish(clients): mobile cards + cleaner row actions + richer 360 summary (P4.1)`.
Push a `origin/main`. **Requiere redeploy** (cambió `src/`).

## 16. Screenshots a revisar
1. **`/clients` desktop** ("Inmobiliaria Costa Azul", 9 clientes): tabla, "Ver ficha" oscuro
   dominante, grupo editar/eliminar, stats.
2. **`/clients` móvil 390**: cards por cliente, sin scroll horizontal.
3. **Ficha** (Familia Soler / Lucía / Javier): resumen ejecutivo de 6 ítems, Copiloto,
   Documentos y recursos.
4. **Workspace real vacío**: empty state premium.

## 17. Pendientes honestos
- **D1 — Documentos** (tabla + bucket + RLS + signed URLs + upload).
- Señal por-fila en el listado (operación/cita/tarea) — requiere agregados; mejora futura.
- Copiloto con **activeEntity** del cliente (deep-link con contexto).
- Kebab dropdown real (hoy grupo compacto; un dropdown clipa dentro del `overflow-x-auto`).

## Veredicto
**P4.1 PARCIAL SEGURO — CLIENTES PREMIUM (listado moderno + ficha 360), documentos en D1.**
El listado deja de parecer Excel: tabla premium en desktop, **cards en móvil**, acciones
ordenadas con "Ver ficha" dominante; la ficha gana un resumen ejecutivo de 6 ítems. Datos 100%
reales, cero queries nuevas, delete seguro intacto. tsc/lint/build verdes. **Requiere
redeploy.**
