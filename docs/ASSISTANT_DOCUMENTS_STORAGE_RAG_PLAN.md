# Assistant — Documents / Storage / RAG (honest audit + plan)

> **Fecha:** 2026-06-17 (S9). Estado REAL de documentos en el CRM y qué puede /
> no puede hacer el asistente con ellos. Regla de oro: **el asistente no finge
> leer PDFs ni inventa contenido.**

## Estado real (auditado)
- **Existe módulo de documentos por cliente.** Ruta UI: pestaña "Documentos" en la
  ficha (`/clients/[id]`). API: `src/app/api/clients/[id]/documents/route.ts` y
  `.../documents/[docId]/route.ts`. Storage: bucket Supabase **`client-files`**.
- Guarda: nombre, tamaño, MIME, path; subida/descarga vía signed URL; metadata
  por documento. Tipos permitidos incl. txt/csv/pdf, etc.
- **NO hay extracción de texto, NO hay chunks, NO hay embeddings, NO hay RAG.**

**Clasificación: (B) Existe metadata + storage, pero NO contenido indexado.**

## Qué puede leer el asistente hoy
- Todos los campos de negocio del cliente, incluidos los **personalizados**
  (DNI/NIF en `metadata.document_id`, dirección, zona, etc.) — vía
  `get_client_field_exact` / `get_client_context` (S9).
- Operaciones, expedientes, tareas, citas, actividad, propiedades.

## Qué NO puede leer todavía
- **El contenido de los archivos** (PDFs, etc.). No hay extracción ni índice.
- Por tanto, ante "léeme el PDF / qué pone en el contrato": respuesta honesta:
  > "Ahora mismo no puedo leer el contenido de los archivos adjuntos; el CRM
  > guarda los documentos pero todavía no indexa su texto."
- Facturación real (módulo dormido) → "fase futura".

## Roadmap (cuando se quiera activar lectura de documentos)
1. ✅ **Tool metadata-only `list_client_documents`** — IMPLEMENTADA EN S9.1. Lista
   título/tipo/fecha de los archivos del cliente (tabla `documents`, columnas
   `title,type,mime_type,size,created_at`), workspace+client scoped, SIN contenido.
   El asistente dice explícitamente que no lee el interior de los archivos.
2. **Extracción de texto** server-side (pdf-parse / textract) → tabla
   `document_chunks` (doc_id, content, page).
3. **Embeddings + pgvector** → búsqueda semántica (`crm_search` sobre documentos).
4. **Tool `search_document_content`** con RLS por workspace/cliente.
5. Citar fuente (documento + página) y nunca inventar.

> Hasta que exista (2)–(4), el asistente **no** debe afirmar que lee documentos.
> El system prompt ya marca "documentos/Storage" como fase futura en NO PROMETAS.
