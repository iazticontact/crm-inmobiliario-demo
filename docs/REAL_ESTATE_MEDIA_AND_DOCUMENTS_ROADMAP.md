# Roadmap — Medios y documentos inmobiliarios (D-files)

> Estado: **NO implementado** (no hay Storage ni tablas de archivos). Documentado para fase
> dedicada. **No se finge**: la UI muestra placeholder elegante de foto y bloques honestos, sin
> botones de subida que no funcionen.

## Por qué es central
Una inmobiliaria necesita **fotos de inmuebles** y **documentos** (DNI/NIE/CIF, contrato de arras,
nota simple, encargo de venta, reserva, tasación, certificado energético, justificantes). Hoy no
hay infraestructura; cerrar el producto inmobiliario exige esta fase.

## Diseño recomendado: sistema unificado de archivos por entidad
Una sola tabla + un bucket privado sirven para cliente, inmueble, operación y trámite.

### Tabla `files` (o `documents`)
```
id            uuid pk
workspace_id  uuid  not null            -- RLS scope
entity_type   text  check in (client | property | opportunity | service_case)
entity_id     uuid  not null
file_name     text
file_path     text  not null            -- ruta en el bucket
mime_type     text
size          bigint
category      text  check in (dni | contrato | nota_simple | foto | reserva | justificante | otro)
is_primary    boolean default false     -- foto principal del inmueble
created_by     uuid
created_at    timestamptz default now()
deleted_at    timestamptz
```

### Storage
- Bucket **privado** `workspace-files` (o `property-media` + `documents` separados).
- Path: `workspace_id/entity_type/entity_id/<uuid>-<filename>`.
- **Signed URLs** para subir y descargar (expiración corta). **Nunca** `service_role` en frontend.
- RLS: `workspace_id` = workspace del usuario (`current_workspace_ids()` / `is_workspace_admin`).

### UI
- **Inmueble**: galería de fotos (principal + miniaturas) + documentos del inmueble.
- **Cliente** (D1): documentos del cliente (ya hay placeholder honesto en la ficha).
- **Operación/Trámite** (D3): adjuntos vinculados.
- Subir / listar / fijar principal / eliminar (con confirmación). Integrar el borrado en
  `delete_client_cascade` y en el borrado de inmueble.

## Fases sugeridas
- **D1** — Documentos de cliente (ya hay roadmap en `CLIENT_DOCUMENTS_ROADMAP.md`).
- **D2** — Fotos + documentos de **inmueble** (prioridad inmobiliaria: galería + portada).
- **D3** — Adjuntos de operación/trámite.
- Recomendado: implementar **el sistema unificado** (`files`) de una vez y exponerlo por entidad.

## Reglas (cuando se implemente)
Real, no falso: tabla + bucket + RLS + signed URLs + workspace-scoped + delete seguro. Sin
`service_role` en cliente. Sin PII pública. Validar tipos/límite de tamaño.
