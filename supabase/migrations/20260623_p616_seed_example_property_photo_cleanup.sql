-- P6.16 — Limpieza del entorno de EJEMPLO: una captura de pantalla quedó subida como foto de
-- inmueble y confunde al enseñar la cartera. Se elimina su fila de metadatos en entity_files para
-- que la card del inmueble vuelva al placeholder elegante. Acotado al workspace de ejemplo,
-- idempotente, sin tocar datos reales de clientes ni otros inmuebles/documentos.
--
-- Nota: el objeto binario en Storage NO se borra por SQL (Storage protege el borrado directo; hay
-- que usar la Storage API). Al quitar la fila de entity_files, la app deja de listar/firmar ese
-- objeto: queda huérfano e inaccesible en el bucket privado. Aceptable para el entorno de ejemplo.

delete from public.entity_files
where workspace_id = 'd0000000-0000-4000-8000-000000000001'
  and entity_type = 'property'
  and category = 'image'
  and file_name ilike 'captura%';
