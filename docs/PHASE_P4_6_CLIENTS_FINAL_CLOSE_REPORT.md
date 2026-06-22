# FASE P4.6 — Clientes cierre final (email mailto global + polish ficha/tabs)

> **Fecha:** 2026-06-22 · HEAD previo `f2499b9`. Solo `/clients/[id]` + docs. **Sin** migraciones,
> sin documentos reales (D1), sin tocar otros módulos. Delete seguro P3.9A intacto. Requiere redeploy.

## 1. Diagnóstico (tras screenshots)
- **Bug real**: en la ficha, el email de la sección **Contacto** se renderizaba como **texto
  plano** (`DetailItem`), no como enlace → click no hacía nada. (El header y el listado ya eran
  `mailto:`.)
- **"Demo" visible**: en "Visitas y citas" salía un badge **"Demo"** (tipo de evento `demo`
  mapeado literalmente) → impropio de un producto comercial.
- **Tabs Visitas/Tareas**: filas planas con `divide-y` y empty states de una línea → mucho
  **espacio muerto**, sensación de panel a medias.
- **Lenguaje "Expediente"**: aún quedaba en botones/toasts/placeholders del bloque de trámites
  (P4.5 renombró el título pero no el interior).

## 2. Email / mailto — auditoría completa
Regla aplicada: **todo email visible es clicable con `mailto:` puro** (sin subject/body/plantilla/
Gmail API). Si no hay email → no se pinta enlace (`—` discreto).
- **Listado desktop** (`clients/page.tsx:581`) y **cards móvil** (`:689`): ya eran `mailto:` ✅
  (sin cambios).
- **Header de ficha** (`:961`) y **botón Email** (`:993`): ya eran `mailto:` ✅ (sin cambios).
- **Sección Contacto** (`DetailItem` Email): **ARREGLADO** → ahora `<a href="mailto:…">` con
  icono de sobre, hover indigo + subrayado, `title`/`aria-label`. `DetailItem` recibe un prop
  opcional `href` (genérico, sin romper los demás campos).

## 3. Resumen — polish
- **Contacto**: email clicable (arriba); teléfono sigue visible/copiable (header); campos vacíos
  siguen discretos ("—", sin caja, P4.4). Sin acciones redundantes.
- **Documentos y recursos** (bloque público del Resumen): se mantiene compacto y honesto, sin
  botón de subir (el tab Documentos con upload real está **gated a NOWLABS_INTERNAL**, no lo ve
  el cliente). Copy honesto intacto.
- **Datos / Interés / Actividad**: sin cambios (ya cerrados en P4.4/P4.5).

## 4. Operaciones — revisión
Estructura y cards comerciales ya correctas (P4.4/P4.5): Operaciones del cliente → **Trámites y
documentación** → Propiedades. No se rehace por ego. **Limpieza de lenguaje** (ver §7).

## 5. Visitas y citas — rediseño
- Filas planas → **cards compactas** (`rounded-xl border bg-white p-3 shadow-sm`), coherentes con
  las cards de Operaciones: título + (fecha/hora · ubicación · tipo) + badge de tipo + Editar.
- **Empty state** compacto con icono: **"Sin citas programadas"** + "Aquí aparecerán visitas,
  llamadas o reuniones vinculadas a este cliente." (no media pantalla vacía).
- **"Demo" eliminado**: tipo de evento `demo` → etiqueta **"Evento"** (mapa + selects de
  crear/editar; se mantiene el valor `demo` en BD → sin migración, sin romper el check).

## 6. Tareas — rediseño
- Filas → **cards compactas** con prioridad, vencimiento (Vencida/Vence pronto/Vence), responsable
  y estado; botones **Editar / Completar** intactos (lógica de toggle sin tocar).
- **Vencida** → borde sutil `border-red-200` (profesional, no alarmista).
- **Empty state** compacto con icono: **"Sin tareas pendientes"** + "Aquí aparecerán
  seguimientos, llamadas y acciones comerciales del cliente."

## 7. Copy / sin "Demo" / sin técnico
- **"Expediente" → "Trámite"** en todo lo visible: botón "Nuevo trámite", "Crear trámite",
  empty "Sin trámites abiertos", toasts ("Trámite creado/actualizado", "No se pudo crear/
  actualizar el trámite", "Falta el título del trámite", "Crear trámites estará disponible…").
- **Placeholders real-estate**: "Ej. Expediente NIE" → **"Ej. Contrato de arras"**;
  "NIE, residencia…" → **"Contrato, tasación, financiación…"**.
- Descripción del tab Documentos (interno): "…expedientes…" → "…documentación…".
- "Demo" fuera de Visitas (§5). Sin `service_case`/`lead_score`/UUID/"Sin completar" visibles.
  (Los toasts "Modo demo (solo lectura)" solo aparecen en modo offline de ejemplo; no en el
  producto real conectado.)

## 8. Qué NO se tocó
Dashboard, n8n, asistente backend, RLS, auth, onboarding, operations page global, calendario
global, settings, Storage/documentos reales (D1), facturación, WhatsApp, scraper, `.env.local`,
`.mcp.json`, secretos. Delete seguro P3.9A, mailto/tel/copy existentes, listado desktop, cards
móvil, ficha 360, producto real vacío, entorno de ejemplo. Lógica de completar tarea / editar
evento-trámite: intacta.

## 9. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅.
Grep visible: sin "Demo"/"Expediente"/"Sin completar". Scan de secretos/PII: limpio.

## 10. Archivos tocados
- `src/app/(saas)/clients/[id]/page.tsx` (DetailItem `href`; Contacto email mailto; `demo`→
  "Evento"; cards+empty de Visitas y Tareas; "Expediente"→"Trámite"; placeholders).
- Docs: este report.

## 11-12. Commit / push
`polish(clients): clickable email everywhere + Visitas/Tareas cards + trámite language (P4.6)`.
Push a `origin/main`.

## 13. Redeploy
**Requiere redeploy** (solo UI; sin migración).

## 14. Qué probar en staging (ejemplo "Inmobiliaria Costa Azul")
- **Roberto Díaz**: Resumen → Contacto, **click en el email abre el correo** con el destinatario
  (sin asunto/cuerpo); Operaciones (cards); **Visitas y citas** (cards, sin badge "Demo", ahora
  "Evento"/"Reunión"); **Tareas** (cards, vencidas con borde sutil).
- **Lucía Herrera / Familia Soler / Javier Ortega**: email clicable; empties compactos.
- **Cliente sin citas/tareas**: empty states compactos con subcopy (no media pantalla).
- **Listado desktop + cards móvil**: emails siguen abriendo el correo.

## 15. Veredicto
**P4.6 PARCIAL SEGURO — CLIENTES (email clicable global + Visitas/Tareas premium + lenguaje
trámite).** Se cerró el bug del email no clicable (Contacto), se eliminó el badge "Demo" de
Visitas, se convirtieron Visitas y Tareas en cards compactas con empty states claros, y se
sustituyó "Expediente" por "Trámite" en toda la UI visible. tsc/lint/build verdes. **Requiere
redeploy** + ojo humano sobre staging (este deploy arrastra P4.4+P4.5+P4.6) para firmar
"CLIENTES FINAL PREMIUM" al 100%.
