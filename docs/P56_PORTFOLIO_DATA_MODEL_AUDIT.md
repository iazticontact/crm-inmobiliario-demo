# P56 — Auditoría REAL del modelo de Cartera

## Columnas reales de `properties` (verificado en código/BD, P47+P56)
`id, workspace_id, title, reference, property_type, operation_type, status, city, area, address, price,
currency, area_m2, bedrooms, bathrooms, owner_name, owner_phone, client_id, notes, metadata, created_at,
updated_at, deleted_at`. **NO existe** columna `published/is_published/publication_status/portal_status`
ni nada en metadata para portales.

## Estados reales (`status`) y su significado en la UI
| status (crudo) | Etiqueta UI | Semántica |
|---|---|---|
| `prospecting` | **En preparación** | Activo, SIN publicar |
| `listed` | **Publicado** | Publicado en cartera activa (disponible) |
| `available` | Disponible | Publicado/disponible (legado) |
| `under_contract` / `reserved` | **Reservado** | No libre, no cerrado |
| `sold` | Vendido | Cerrado (histórico) |
| `rented` | Alquilado | Cerrado (histórico) |
| `archived` | Archivado | Cerrado (histórico) |

Fuente: `PROPERTY_STATUS_OPTIONS` en `VerticalForms.tsx` (alta: En preparación/Publicado/Reservado) y
`VerticalEditForms.tsx` (edición, incluye vendido/alquilado/archivado). Valores vistos en BD demo:
`listed, rented, sold, prospecting`.

## Conclusiones vinculantes
1. **La publicación EXISTE** y es el propio `status` (`listed` = «Publicado»). No hay campo aparte ni
   conexión con portales externos → el Asistente puede responder «publicados» usando `status`, y NO debe
   prometer portales.
2. Vendido/alquilado/reservado dependen de `status` (no de operaciones asociadas).
3. «Cartera activa» = no cerrados (`sold/rented/archived` fuera), coherente con `isClosedPropertyStatus`.
4. La UI y el Asistente leen las mismas columnas (readers `searchProperties`/`crmReadQuery` incluyen
   `status, price, city, area, area_m2, bedrooms, bathrooms, updated_at`-ordenable). `updated_at` se
   actualiza en `updateProperty` → la lectura viva ve los cambios (endpoint `force-dynamic`, sin caché).
5. **Causa raíz del fallo de referencia**: «¿tengo algún inmueble publicado?» no se mapeaba a
   `status='listed'`; caía en la búsqueda por similitud → «No hay inmuebles que cumplan todos los
   criterios. Lo más cercano…». Corregido en P56 (`portfolio-domain.ts` + handler de estado).
