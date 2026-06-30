// Config del sondeo de /api/agent/diag (P25). Se extrae aquí para que un eval pueda
// VERIFICAR que cada entidad sondeada apunta a una tabla REAL (evita el fallo "probar una
// tabla inexistente" → conteo 0 silencioso, que enmascara un mismatch de entorno).
//
// `key`     etiqueta funcional (la que se compara con la UI).
// `table`   tabla real en Supabase (debe existir; ver assistant-diag.evals.ts).
// `nameCol` columna legible para la muestra (sin UUIDs, sin datos sensibles largos).
// `dateCol` columna de fecha para "última actualización".

export type ProbeEntity = { key: string; table: string; nameCol: string; dateCol: string }

export const PROBE_ENTITIES: ProbeEntity[] = [
  { key: 'clients', table: 'clients', nameCol: 'name', dateCol: 'updated_at' },
  { key: 'events', table: 'calendar_events', nameCol: 'title', dateCol: 'updated_at' },
  { key: 'properties', table: 'properties', nameCol: 'title', dateCol: 'updated_at' },
  { key: 'opportunities', table: 'opportunities', nameCol: 'title', dateCol: 'updated_at' },
  { key: 'service_cases', table: 'service_cases', nameCol: 'title', dateCol: 'updated_at' },
  { key: 'tasks', table: 'tasks', nameCol: 'title', dateCol: 'updated_at' },
  // "documentos" = metadata de archivos en `entity_files` (no existe tabla `documents` en esta BD).
  { key: 'documents', table: 'entity_files', nameCol: 'file_name', dateCol: 'created_at' },
  { key: 'activities', table: 'activities', nameCol: 'title', dateCol: 'created_at' },
]
