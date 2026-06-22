# D1 — Documentos de cliente (fase futura)

> Decisión de P4: el MVP de documentos **NO se implementa todavía** porque la
> infraestructura **no existe**. Se deja un bloque premium con empty state y aquí queda el
> diseño para activarlo de forma segura.

## Estado actual (auditado 2026-06-22)
- `public.documents` **NO existe**.
- **0 buckets** de Storage (no hay `client-files`).
- `src/app/api/clients/[id]/documents/route.ts` ya está escrito (asume tabla `documents` +
  bucket `client-files` + signed URLs) pero **fallaría** sin la infra → la pestaña
  "Documentos" de la ficha está **gateada a operador** (`NOWLABS_INTERNAL`), así que el
  cliente **no** ve una feature rota.
- En el Resumen de la ficha hay una card "Documentos y recursos" con **empty state** premium
  (sin fetch, sin upload) — preparada para cuando la infra esté lista.

## Qué falta para el MVP (D1)
1. **Migración**: tabla `public.documents`
   `(id, workspace_id, client_id, title, type, category, storage_bucket, storage_path,
   mime_type, size, created_by, metadata, created_at)`, FK a clients `ON DELETE CASCADE`
   (o limpiar en `delete_client_cascade`), índices por `(workspace_id, client_id)`.
2. **RLS** workspace-scoped (select/insert/delete por `is_workspace_admin`/miembro), igual que
   el resto de tablas.
3. **Bucket privado** `client-files` (no público) + políticas de Storage workspace-scoped.
4. **Signed URLs** para abrir/descargar (no URLs públicas).
5. **Helpers de subida** (validación MIME/extensión + tamaño máx; ya esbozados en el route
   existente: PDF/PNG/JPG/WEBP/DOC/XLS/TXT/CSV, 50 MB).
6. **UI**: activar la pestaña/bloque "Documentos" para el cliente: subir, listar, categoría
   (Identificación / Contrato / Nota simple / Encargo / Reserva / Justificante / Otro),
   abrir/descargar, eliminar con confirmación.
7. **Integrar en el delete seguro (P3.9A)**: borrar metadata + objetos de Storage del cliente
   al eliminarlo (hoy `delete_client_cascade` no toca documentos porque la tabla no existe).

## Fuera de alcance (más adelante, premium)
- Lectura IA / RAG de PDFs (extracción, resumen) — **no** en D1. La subida documental es
  básica; la lectura IA es un módulo premium posterior.

## Seguridad (obligatoria al implementar)
- Storage **privado**, signed URLs, **workspace-scoped**, RLS, **sin** `service_role` en
  frontend, sin bucket público.
