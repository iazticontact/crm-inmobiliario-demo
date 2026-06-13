# Fase 2C — Plan de Storage (Supabase Storage)

> Diseño de buckets, paths, acceso y policies para archivos del CRM (documentos, fotos de propiedad, PDFs de factura, audios futuros).
> **No ejecutable.** Anclado en [PHASE_2_CODE_SUPABASE_AUDIT.md](PHASE_2_CODE_SUPABASE_AUDIT.md) y [PHASE_2_SCHEMA_DESIGN.md](PHASE_2_SCHEMA_DESIGN.md).

---

## Principios de Storage

- **Todo objeto cuelga de `workspace_id`** como **primer segmento del path**. Es la base del aislamiento: las policies comprueban que el primer segmento esté en `current_workspace_ids()`.
- **Buckets privados por defecto.** Nada público salvo assets de branding explícitamente públicos.
- **Acceso vía signed URLs** de vida corta (60–600 s), generadas server-side o por el cliente autenticado con permiso.
- **Toda fila de Storage tiene su registro en `documents`** (o `property_media`) — la BD es el índice; Storage es el almacén. Nunca un objeto huérfano (rollback si falla el insert, como ya hace el código).
- **Subidas validadas:** allowlist de MIME + extensión, límite de tamaño (hoy 50 MB en documentos), nombre saneado (sin `..`, sin `//`, sin path traversal).
- **service_role solo backend** para borrados atómicos (Storage + fila) y operaciones privilegiadas.

> ⚠️ **Compatibilidad con el código actual:** el código ya usa los nombres de bucket `client-files`, `facturas-pdf` e `informes-pdf` (constantes/strings en `src/`). Para **no tocar runtime**, el Supabase nuevo debe crear esos buckets con **esos nombres exactos**. Los nombres «bonitos» (`documents`, `invoice-pdfs`) se documentan abajo como alias conceptual, pero **el bucket real conserva el nombre que el código espera**. Cualquier renombrado sería un cambio de código aparte y planificado.

---

## Buckets

### 1. `client-files` (documentos de cliente) · **día 1** · privado
- **Uso:** documentos subidos en la ficha de cliente (PDF, imágenes, Word, Excel, txt, csv).
- **Path:** `{workspace_id}/clients/{client_id}/{timestamp}-{nombre_saneado}`
  - Ejemplo real (del código): `a1b2.../clients/7c8d.../1718123456789-nota-simple.pdf`
- **Acceso:** privado. Lectura vía signed URL (10 min). Subida desde **backend** (ruta `api/clients/[id]/documents`, valida sesión + workspace + MIME + tamaño).
- **Tabla espejo:** `documents` (`type='client_file'`, `storage_bucket='client-files'`, `storage_path`).
- **Policies:**
  - `SELECT`/`INSERT`: usuario cuyo workspace = primer segmento del path.
  - `DELETE`: backend con service_role (borrado atómico Storage + fila `documents`).
- **Límites:** 50 MB; MIME allowlist (pdf, png, jpg/jpeg, webp, doc, docx, xls, xlsx, txt, csv).

### 2. `property-media` (fotos/planos de propiedad) · **día 1 para producto real** · privado (o público controlado)
- **Uso:** imágenes y planos de inmuebles. Tabla espejo `property_media`.
- **Path:** `{workspace_id}/properties/{property_id}/{timestamp}-{nombre_saneado}`
  - Ejemplo: `a1b2.../properties/9f.../1718123456789-salon-01.jpg`
- **Acceso:** privado por defecto (signed URL). Si se publican fichas/escaparate web, valorar un derivado público con `is_cover` — **decisión por workspace**, no por defecto.
- **Subida:** desde backend o cliente autenticado con guard de tamaño/MIME (imágenes).
- **Policies:** `SELECT`/`INSERT`/`DELETE` por workspace (primer segmento del path).
- **Límites:** ~10–20 MB por imagen; MIME imagen (png/jpg/webp) + pdf (planos).

### 3. `facturas-pdf` (PDFs de factura) · **día 1** · privado
- **Uso:** PDF generado de cada factura. Ya referenciado por el código (`storageBucket: 'facturas-pdf'`, path `{workspace_id}/invoices/{filename}`).
- **Path:** `{workspace_id}/invoices/{invoice_id}/{numero}-{timestamp}.pdf`
- **Acceso:** privado. Descarga vía signed URL (10 min). Generación y guardado desde **backend** (`api/reports/invoice`), con service_role si hace falta para escribir.
- **Tabla espejo:** `documents` (`type='invoice_pdf'`) + `invoices.pdf_document_id`.
- **Policies:** `SELECT` por workspace; `INSERT`/`DELETE` backend.

### 4. `informes-pdf` (informes/propuestas) · día 1 (si reports en alcance) · privado
- **Uso:** PDFs de informe de cliente / propuestas (`api/reports/client`, assistant). Ya referenciado (`storageBucket: 'informes-pdf'`).
- **Path:** `{workspace_id}/reports/{client_id}/{timestamp}.pdf`
- **Tabla espejo:** `documents` (`type='proposal_pdf'` o `workspace_asset`).
- **Policies:** como `facturas-pdf`.

### 5. `audio-notes` (notas/dictados de voz) · **futura (facturación por voz)** · privado
- **Uso:** audios que el comercial dicta (p. ej. para crear factura por voz, ver 2D). Transcripción posterior con OpenAI.
- **Path:** `{workspace_id}/audio/{user_id}/{timestamp}-{uuid}.m4a` (o webm/ogg según grabación).
- **Acceso:** privado. Subida desde cliente autenticado; procesamiento (transcripción) desde backend.
- **Tabla espejo:** `documents` (`type='workspace_asset'` o tabla `voice_notes` futura) — vincula audio → `prepared_action` generada.
- **Policies:** `SELECT`/`INSERT` por workspace; borrado backend.
- **Nota:** retención/borrado del audio tras procesar (privacidad). Definir política de retención.

### 6. `branding` (logos/avatars) · día 1 (ligero) · público controlado
- **Uso:** logo del workspace y avatares de usuario (para PDFs y UI).
- **Path:** `{workspace_id}/branding/logo.png`, `{workspace_id}/avatars/{user_id}.png`
- **Acceso:** puede ser **público** (logo en PDFs/escaparate) o privado con signed URL. Decidir por caso; los logos suelen ser públicos.
- **Tabla espejo:** `billing_settings.logo_path`, `profiles.avatar_url`, `workspaces.branding`.
- **Policies:** `INSERT`/`DELETE` por workspace (admin); `SELECT` público si el logo debe verse en PDFs/web.

---

## Flujos concretos

### Subir un documento de cliente
1. Frontend hace `POST /api/clients/{id}/documents` con el archivo (multipart).
2. Backend (server client) valida sesión → deriva `workspace_id` de `profiles`.
3. Valida MIME+extensión (allowlist) y tamaño (≤50 MB); sanea el nombre.
4. Sube a `client-files` en `{workspace_id}/clients/{client_id}/{ts}-{safeName}` (`upsert:false`).
5. Inserta fila en `documents`. **Si el insert falla → borra el objeto** (no dejar huérfanos).
6. Devuelve la fila. (En **demo** este flujo no se ejecuta: guard `DEMO_MODE_KEY` → toast amable.)

### Subir imágenes de propiedad
- Igual patrón, bucket `property-media`, path `{workspace_id}/properties/{property_id}/...`, fila en `property_media` con `position`/`is_cover`. Generar miniaturas es opcional (futuro).

### Guardar PDF de factura
1. Backend genera el PDF (`generateInvoicePdfBytes`) con footer `BRAND.appName`/branding del workspace.
2. Sube a `facturas-pdf` en `{workspace_id}/invoices/{invoice_id}/...pdf`.
3. Inserta fila en `documents` (`type='invoice_pdf'`) y enlaza `invoices.pdf_document_id`.
4. Descarga vía signed URL (10 min).

### Guardar audio de nota/factura (futuro)
1. Frontend graba audio → sube a `audio-notes` (`{workspace_id}/audio/{user_id}/...`).
2. Backend transcribe (OpenAI) → IA extrae datos → crea `prepared_action` (`create_invoice`).
3. Usuario confirma → backend crea `invoice` + `invoice_items` + PDF.
4. Política de retención del audio (borrar tras X días o tras confirmar).

---

## Cómo se evita exponer archivos entre workspaces

- **Path con `workspace_id` delante** + **policy que exige** que ese segmento esté en `current_workspace_ids()`. Un usuario del workspace A no puede leer `B/clients/...`.
- **Buckets privados** + **signed URLs cortas**: las URLs caducan; no hay enlaces permanentes adivinables.
- **Borrado atómico** (Storage + fila) con service_role en backend: nunca queda un objeto accesible sin su control en BD.
- **Validación de subida** server-side: el `workspace_id` del path lo pone el backend desde la sesión, **nunca** el cliente.
- **Smoke test obligatorio (2E-4):** usuario del workspace A intenta leer/borrar un objeto del workspace B → debe fallar.

---

## Riesgos de Storage

- ⚠️ **Nombres de bucket**: deben coincidir con los del código (`client-files`, `facturas-pdf`, `informes-pdf`) o habría que tocar runtime. Crear con esos nombres en el Supabase nuevo.
- ⚠️ **Objetos huérfanos**: si se sube a Storage pero falla el insert en BD. Mitigación: rollback (ya implementado en documentos); replicar en property-media/facturas.
- ⚠️ **Fugas entre workspaces**: una policy floja = acceso cruzado. Mitigación: path con `workspace_id` + policies + smoke test de aislamiento.
- ⚠️ **Costes/tamaño**: imágenes de propiedad pueden pesar. Mitigación: límites de tamaño, futura compresión/thumbnails.
- ⚠️ **Privacidad de audios**: datos personales en voz. Mitigación: bucket privado, retención corta, borrado tras procesar.
- ⚠️ **Logos públicos**: si `branding` es público, no subir nada sensible ahí (solo logo/avatar).
