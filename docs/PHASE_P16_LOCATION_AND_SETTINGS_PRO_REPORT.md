# FASE P16 — Ubicación inmobiliaria avanzada + Configuración profesional sin roadmap visible

> **Fecha:** 2026-06-26 · Dos frentes: **(A)** la ubicación del inmueble pasa a experiencia tipo web
> profesional (catálogo ampliado + valores reales del workspace + ranking en capas + UI premium, sin
> APIs caras); **(B)** Configuración se rediseña como pantalla de producto real: fuera "Próximamente",
> fuera Notificaciones, fuera roadmap. Si no funciona hoy, no aparece. Sin tocar credenciales ni RLS;
> el prompt vivo de n8n se actualiza con microparche autorizado.

---

## 1. Diagnóstico

- **Ubicación (P15):** `LocationAutocomplete` + `location-catalog.ts` (13 ciudades), usado en
  `NewPropertyDrawer` y `EditPropertyDrawer` sobre los campos reales `city`/`area`. El dropdown se
  posicionaba bien en el drawer; faltaba amplitud (pocas ciudades), valores del propio negocio y
  ranking más fino. La cartera muestra `[city, area]` pero **no** filtra por ellos.
- **Configuración (P14):** mezclaba estado real con roadmap — bloque grande de Asistente IA + columna
  de **Notificaciones** "Próximamente" (sin backend) + badges "Próximamente". `workspace_settings` ya
  tenía `business_name`, `metadata` (jsonb), `vertical` y `default_language` → permite persistir
  nombre/descripción/tipo **sin migración**.

## 2. Ubicación — problema actual

Catálogo corto; no sugería valores que la inmobiliaria ya usa (p. ej. "Paterna", "La Cañada"); ranking
básico; sin etiquetas de origen.

## 3. Ubicación — solución avanzada (capas)

Sistema en capas, sin APIs externas por defecto:
1. **Catálogo local ampliado** (33 ciudades + provincias + alias + barrios).
2. **Valores reales del workspace** (`properties.city`/`area`), normalizados y deduplicados, cargados
   una vez al abrir el drawer y cacheados en sesión (RLS, **sin service_role**; fallback al catálogo).
3. **Proveedor externo opcional** (interfaz preparada, **apagado** por defecto, sin claves).

## 4. Catálogo ampliado

`location-catalog.ts`: Bilbao y alrededores (Barakaldo, Getxo, Leioa, Portugalete, Santurtzi, Basauri),
Donostia, Vitoria-Gasteiz, Pamplona, Logroño, Santander, Zaragoza, Madrid, Barcelona, Valencia, Málaga,
Marbella, Estepona, Benahavís, Sevilla, Granada, Córdoba, Alicante, Murcia, A Coruña, Vigo, Oviedo,
Gijón, Valladolid, Salamanca, Burgos, Palma, Girona, Tarragona. Barrios ampliados para Bilbao,
Barcelona, Madrid y Marbella/Málaga. **Alias**: Bilbao↔Bilbo, Barcelona↔Barna, Donostia↔San Sebastián/
Donosti, Vitoria-Gasteiz↔Vitoria, Pamplona↔Iruña, A Coruña↔La Coruña, etc.

## 5. Valores del workspace como sugerencias

`workspace-locations.ts` → `getWorkspaceLocations(workspaceId)`: lee `city`/`area` del workspace bajo
RLS, normaliza, deduplica, agrupa zonas por ciudad, cachea en sesión y degrada al catálogo si falla.
Las sugerencias del workspace se marcan con una etiqueta discreta **"En este workspace"**.

## 6. Provider externo opcional

`location-provider.ts`: interfaz `LocationProvider` + `getExternalLocationProvider()` que hoy devuelve
**null**. Documentadas envs futuras (`NEXT_PUBLIC_LOCATION_PROVIDER` = google|mapbox|geoapify|nominatim;
clave SOLO server-side). No se activa nada por defecto, no rompe si no hay proveedor.

## 7. Ranking de sugerencias

`suggestCities`/`suggestAreas` mezclan workspace + catálogo y ordenan: exacto workspace > exacto
catálogo > prefijo workspace > prefijo catálogo > contiene workspace > contiene catálogo (alias dentro
del catálogo). Sin acentos/mayúsculas, dedup por valor (gana el del workspace), máx. 8 + footer
"Sigue escribiendo para afinar" cuando hay más. Zona/barrio mezcla barrios del catálogo de la ciudad
con zonas reales del workspace; si la ciudad no está en catálogo pero hay zonas usadas, se sugieren.

## 8. Cambios en formularios de inmueble

`NewPropertyDrawer` y `EditPropertyDrawer`: cargan los valores del workspace al abrir; Ciudad y
Zona/barrio usan `suggestCities`/`suggestAreas`; etiqueta de origen ("En este workspace" / "Personalizado"),
provincia a la derecha, resaltado de coincidencia, spinner de carga, footer de afinado. Al cambiar la
ciudad la zona **no** se borra; aviso discreto si no encaja. Normalización al guardar (sin símbolos
sueltos). El dropdown usa `z-40` y sombra suave para no solaparse dentro del drawer.

## 8-bis. UI del autocompletado

Dropdown premium (borde redondeado, sombra), ciudad izquierda / provincia derecha, etiqueta discreta de
workspace, "Personalizado" en ámbar, icono `MapPin`, loading solo al cargar workspace, accesible
(combobox/listbox/option, teclado completo), responsive y usable en móvil.

## 9. Configuración — problema actual

Mostraba roadmap: Notificaciones "Próximamente" (sin backend = humo), tarjeta enorme de Asistente IA que
repetía la navegación, badges "Próximamente". Mezclaba estado interno/futuro con lo real.

## 10. Qué se quitó

- **Notificaciones** (toda la sección): no hay backend real → fuera por completo (no "Próximamente").
- **Tarjeta grande de Asistente IA** → fila compacta (Estado: Activo + botón Abrir).
- **"Próximamente"** de la superficie de cliente.
- La **columna lateral** vacía: el layout pasa a una sola columna en producción (la `aside` solo existe
  en build de operador interno).
- Definiciones muertas (`notifDefaults`, `visibleWorkspaceItems`) y la card `VerticalPreferenceCard`
  suelta (su función vive ahora en Workspace/Empresa).

## 11. Nueva estructura de Configuración

Una sola columna de tarjetas reales: **Perfil** (solo lectura) · **Workspace / Empresa** (editable) ·
**Equipo** (invitar real) · **Asistente IA** (fila compacta). Responde sin preguntar: qué eres, qué
puedes editar, quién tiene acceso y dónde está el asistente.

## 11-bis. Perfil / Workspace

- **Perfil** (solo lectura, sin upload falso): avatar de iniciales, nombre, email, rol, idioma y estado
  de la cuenta.
- **Workspace / Empresa** (`WorkspaceProfileCard`, **persistencia real** en `workspace_settings`):
  Nombre comercial (`business_name`), Descripción (`metadata.description`, máx. 200 + contador) y Tipo
  de workspace (Inmobiliaria primero/recomendado). Un único **Guardar** con feedback (Guardado/Error).

## 12. Equipo / Invitar usuario

Se mantiene **activo** (es real: `inviteUserByEmail` + profile + RLS + roles + idempotencia). Añadida la
explicación de producto en el modal: *"Invita a miembros de tu equipo (comerciales, administradores,
gestores) para que accedan a este workspace y trabajen sobre los mismos clientes, inmuebles, operaciones
y tareas. No es para clientes finales."*

## 13. Asistente IA en Configuración

Reducido a una **fila compacta** (Estado: Activo + botón "Abrir"). El asistente ya está en el menú
lateral; no se repite marketing interno.

## 14. Notificaciones

**Fuera por completo** de la UI. Cuando haya notificaciones reales (cron + email + tabla) se hará una
fase específica.

## 15. Backend / persistencia

`workspace_settings` (ya existente) guarda nombre (`business_name`), descripción (`metadata.description`)
y tipo (`vertical`) bajo RLS con el cliente de navegador — **sin migración** y **sin service_role en
frontend**. Validación: nombre ≤ 80, descripción ≤ 200, tipo restringido. Avatar/logo: **no** se
implementa (requeriría Storage + RLS bien hechos) → se mantienen iniciales, documentado como futuro
(cero humo, sin upload falso).

## 16. Cambios en Asistente IA (conocimiento)

- **Capabilities** (`product-capabilities.ts`): `settings.profile` (readonly), `settings.workspace`
  (configurable), `settings.team` (active), `settings.assistant` (active). **Eliminada**
  `settings.notifications`.
- **Fallback local** (`nowlabs-main-agent.ts`): bloque de Configuración reescrito (Perfil/Workspace/
  Equipo/Asistente; sin "Próximamente"; si preguntan por notificaciones, dice que no hay sección
  activa).
- **n8n vivo:** microparche preparado en `n8n/patches/P16-configuracion-sin-roadmap.txt` (reemplaza el
  bloque P14). Aplicado con autorización (ver Deploy).

## 17. Tests

- `location-catalog.evals.ts` +P16: alias (barna/bilbo/donosti/san sebastian/vitoria/iruña/la coruña),
  ciudades nuevas, mezcla workspace>catálogo (Paterna primero), zona del workspace (La Cañada),
  Deusto del catálogo. **Verificado 16/16** con script desechable.
- `product-capabilities.evals.ts`: estados nuevos, `settings.notifications` ya no existe, workspace
  editable, resumen sin "Próximamente" ni términos prohibidos/inventados.
- `assistant-coherence.evals.ts`: Configuración (workspace editable, sin notificaciones, sin permisos/
  avatar inventados).

## 18. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅. Scans: sin
"Próximamente"/"Notificaciones"/"lead" visibles · sin toggles ni upload falsos · sin service_role en
frontend · sin UUID/JSON visibles.

## 19. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/lib/locations/location-catalog.ts` | catálogo ampliado (33 ciudades, alias, barrios) + `suggestCities`/`suggestAreas` (mezcla workspace+catálogo) |
| `src/lib/locations/workspace-locations.ts` | **NUEVO** sugerencias desde datos reales del workspace (RLS, caché) |
| `src/lib/locations/location-provider.ts` | **NUEVO** interfaz de proveedor externo opcional (apagado) |
| `src/components/LocationAutocomplete.tsx` | etiquetas de origen, loading, footer de afinado, UI premium |
| `src/components/VerticalForms.tsx` / `VerticalEditForms.tsx` | drawers: carga workspace + sugerencias en capas |
| `src/components/WorkspaceProfileCard.tsx` | **NUEVO** Workspace/Empresa editable (nombre+descripción+tipo) |
| `src/components/TeamUsersCard.tsx` | explicación de "Invitar usuario" en el modal |
| `src/app/(saas)/settings/page.tsx` | rediseño: Perfil + Workspace + Equipo + Asistente compacto; fuera Notificaciones/roadmap; 1 columna en producción |
| `src/lib/product-capabilities.ts` | capabilities P16 (sin notifications) |
| `src/lib/agents/nowlabs-main-agent.ts` | bloque de Configuración reescrito (fallback local) |
| `n8n/patches/P16-configuracion-sin-roadmap.txt` | **NUEVO** microparche para el prompt vivo |
| `src/lib/locations/__evals__/...`, `src/lib/agents/__evals__/...` | evals actualizados |

## 20–21. Commit / Push

Commit `feat(location+settings): ubicación pro en capas + Configuración sin roadmap (P16)` →
`origin/main`.

## 22. Deploy

- **Frontend:** redeploy.
- **n8n (producción):** aplicado el microparche `P16-configuracion-sin-roadmap.txt` (reemplaza el bloque
  P14) al systemMessage vivo, con autorización del usuario, conservando `=` y `{{ }}`.

## 23. Checklist staging

- [ ] Crear inmueble: "bil"→Bilbao·Bizkaia; "barna"→Barcelona; "donosti"→Donostia.
- [ ] Si el workspace ya usa "Paterna"/"La Cañada", aparecen con etiqueta "En este workspace".
- [ ] Zona de Bilbao: "de"→Deusto; zona inexistente → "Personalizado" + aviso, guarda igual.
- [ ] Configuración: NO hay Notificaciones ni "Próximamente"; Perfil (solo lectura), Workspace editable.
- [ ] Workspace/Empresa: editar nombre + descripción + tipo → Guardar → recargar → persiste.
- [ ] Equipo: modal de invitar con la explicación; invitación real si hay service-role.
- [ ] Asistente: "¿me llegan notificaciones?" → no hay sección activa; "¿puedo cambiar la descripción
      de mi inmobiliaria?" → sí, en Workspace/Empresa.

## 24. Pendientes honestos

- **Avatar/logo con Storage**: no implementado (requiere bucket + RLS + validación) → futuro, sin humo.
- **Filtro de cartera por ciudad/zona**: no entra en P16 → P17 (reutilizando el mismo autocomplete).
- **Proveedor externo de ubicaciones**: interfaz lista, integración real (Places/Mapbox/geocoding/mapa)
  como fase futura.
- **Notificaciones reales**: fase específica (cron + email + tabla de preferencias).

## 25. Veredicto

**P16 COMPLETADO — UBICACIÓN PRO Y CONFIGURACIÓN DE PRODUCTO REAL, SIN ROADMAP VISIBLE.** La ubicación
se comporta como una web moderna (catálogo amplio + valores del propio negocio + ranking en capas, sin
APIs caras) y Configuración muestra solo lo real y editable (Perfil, Workspace/Empresa con persistencia
real, Equipo), sin "Próximamente" ni Notificaciones de humo. `tsc`/`lint`/`build` en verde.
