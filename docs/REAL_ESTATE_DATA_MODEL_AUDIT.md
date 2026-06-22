# Auditoría del modelo de datos inmobiliario (P6/P6.1)

> Fecha: 2026-06-23. Verificado por schema (Supabase) + código. Proyecto `ylhdbawrllqygfvllhdo`.

## Tablas relevantes (con `workspace_id`, RLS al fondo)
`clients`, `properties`, `opportunities`, `service_cases`, `tasks`, `calendar_events`,
`activities`, `assistant_threads/messages/agent_memory`. **No** existen tablas de archivos.

## Respuestas a la auditoría
1. **Campos de `properties`**: `id, workspace_id, client_id, title, reference, property_type,
   operation_type, status, city, area, address, price, currency, bedrooms, bathrooms, area_m2,
   owner_name, owner_phone, notes, created_by, metadata (jsonb), created_at, updated_at,
   deleted_at`. → Rico: suficiente para cards inmobiliarias (tipo, operación, estado, precio,
   habitaciones, baños, m², referencia, propietario).
2. **owner/client en `properties`**: SÍ — `client_id` (uuid, → clients) y `owner_name`/`owner_phone`.
3. **Imágenes/fotos en `properties`**: **NO**. No hay columna de imagen ni tabla de medios.
4. **`opportunities.property_id`**: **NO como columna**. Solo (a veces) `metadata.property_id`.
   En el workspace de ejemplo, las operaciones **no** tienen ese enlace poblado.
5. **`opportunities` cliente + inmueble**: cliente SÍ (`client_id`); inmueble solo vía
   `metadata.property_id` (no estructurado, no FK). → Enlace inmueble↔operación = **roadmap**.
6. **`service_cases` como trámites**: SÍ. Campos: `client_id, opportunity_id, case_type, status,
   priority, due_date, title, notes…`. Enlaza a cliente y a operación (`opportunity_id`).
7. **Tabla de documentos**: **NO existe**.
8. **Bucket de Storage**: **NO existe** (0 buckets).
9. **Relaciones existentes**: clients→(properties.client_id, opportunities.client_id,
   service_cases.client_id, tasks, calendar_events, activities); service_cases→opportunities
   (`opportunity_id`). **Falta**: properties↔opportunities estructurado; cualquier
   archivo/documento/foto.
10. **Qué se puede hacer real ahora (sin migración)**: cartera de inmuebles con cards premium
    (todos los campos arriba), KPIs de cartera, operaciones/trámites con cliente y enlaces ya
    existentes (service_cases→opportunity). Nº operaciones por inmueble **solo** cuando exista
    `metadata.property_id` (honesto: 0 si no hay enlace).
11. **Requiere migración futura**: (a) sistema de archivos/medios (fotos + documentos) con
    Storage + tabla + RLS + signed URLs; (b) enlace estructurado `opportunities.property_id`
    (columna + FK) para vincular operación↔inmueble de forma fiable.

## Estado del workspace de ejemplo (Inmobiliaria Costa Azul · `d0000000-…-000000000001`)
9 clientes · 7 inmuebles · 8 operaciones · 5 trámites. **0 emails reales** (todos `@example.com`/
`.example`). Sin PII real (saneado en P4.6.2). Producto real **vacío**: 1 workspace total, 0
clientes/inmuebles fuera del ejemplo.
