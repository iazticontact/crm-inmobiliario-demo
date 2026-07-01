-- =====================================================================
-- P29 — clients.country + clients.preferred_language (additivo)
-- =====================================================================
-- Aplicada el 2026-07-01 al proyecto ylhdbawrllqygfvllhdo vía MCP apply_migration
-- (migración: p29_clients_country_language).
--
-- NOTA: hoy el formulario de cliente guarda país/idioma en `metadata`
-- (nationality / preferred_language), patrón de perfil extendido; el Asistente
-- ya los lee porque crm_read_query devuelve `metadata` (includeMeta:true). Estas
-- columnas dedicadas quedan ADDITIVAS para uso futuro (migrar de metadata a
-- columna cuando se decida). Nullable → permiten "No consta". RLS de clients
-- ya cubre estas columnas.
alter table public.clients add column if not exists country text;
alter table public.clients add column if not exists preferred_language text;

comment on column public.clients.country is 'País del cliente (nombre canónico es-ES, p. ej. España). P29.';
comment on column public.clients.preferred_language is 'Idioma preferido (nombre canónico es-ES, p. ej. Español). P29.';
