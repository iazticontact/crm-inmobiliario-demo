# FASE P17 — Location Intelligence real + Configuración Pro final sin "workspace" visible

> **Fecha:** 2026-06-26 · Dos frentes: **(A)** la ubicación pasa de catálogo manual a un **autocompletado
> real tipo logística** vía backend con proveedor externo opcional (Google/Mapbox/Geoapify) y fallback a
> empresa + catálogo local; conceptos separados (Localidad/municipio vs Zona/barrio). **(B)** Configuración
> se rediseña como cuenta/empresa profesional: fuera la palabra "workspace", fuera los chips
> multivertical, Perfil con **nombre editable real**, Empresa editable (nombre/descripción/teléfono/web/
> email). Cero humo: avatar/logo se deja como pendiente honesto (sin upload falso).

## 1. Diagnóstico

- **Ubicación:** `LocationAutocomplete` + `location-catalog.ts` (catálogo manual) + valores de workspace
  síncronos (P16). Campos reales `properties.city`, `area`, `address`; **no** existen `province`,
  `postal_code`, `lat`, `lng`, `place_id` (añadirlos = migración → se difiere). El catálogo manual no
  escala ni distingue municipio vs barrio.
- **Settings:** aún se veía "Tipo de workspace" + chips (Inmobiliaria/Extranjería/Servicios/Mixto/
  General) y la palabra "workspace". `profiles` permite **UPDATE de `full_name`** desde la sesión bajo
  RLS (sin service_role); `avatar_url` necesitaría grant/migración. Storage (`entity-files`) ya opera
  para fotos de inmueble.

## 2. Ubicación — problema actual

Catálogo hecho a mano, incompleto y arbitrario; "Ciudad" como concepto único mezcla municipios y
pueblos. Se quería experiencia tipo ecommerce/logística.

## 3. Solución — Location Intelligence

Ruta backend **`/api/locations/suggest`** (autenticada, RLS) que combina, por capas y rankeadas:
1. **valores reales de la empresa** (`properties.city`/`area`), 2. **proveedor externo** (si hay key,
la clave vive SOLO en servidor), 3. **catálogo local** (fallback). Debounce + caché + rate limit +
cancelación de peticiones obsoletas en el cliente. Si el proveedor falla o no está configurado, degrada
en silencio a empresa + local: **nunca rompe**.

## 4. Provider externo: implementado/preparado

Abstracción `src/lib/locations/providers.server.ts` (solo servidor) con adaptadores reales para
**`google`** (Places Autocomplete), **`geoapify`** y **`mapbox`**, más **`local`** (por defecto).
Se activa por env (`LOCATION_PROVIDER` + su clave). **Sin clave → `local`** (empresa + catálogo).
Estado: **arquitectura completa y operativa**; con una API key se obtiene la experiencia "real"
inmediatamente. Hoy, sin key, funciona con empresa + catálogo local. Envs documentadas en `.env.example`
(nunca `NEXT_PUBLIC_`).

## 5. Cambios en campos de ubicación

- UI: **"Ciudad" → "Localidad / municipio"**; "Zona / barrio" se mantiene.
- BD: se sigue usando `city` (localidad/municipio) y `area` (zona/barrio) — **sin migración, sin romper
  datos**. `province`/`lat`/`lng`/`place_id` quedan como mejora futura (el proveedor ya devuelve
  provincia como pista visible, pero no se persiste todavía).

## 6. Cambios en formularios de inmueble

`NewPropertyDrawer` y `EditPropertyDrawer`: ambos campos usan el `LocationAutocomplete` 2.0 (async).
Localidad (`type="locality"`) → al elegir, foco a Zona. Zona (`type="area"` + `locality`) sugiere
barrios de esa localidad (empresa + provider + catálogo). Valor personalizado permitido; normalización
al guardar; sin símbolos sueltos. Se eliminó la maquinaria síncrona de P16 (`workspace-locations.ts`,
`location-provider.ts`) — ahora todo pasa por la ruta.

## 7. Seguridad / coste del provider

Clave **solo server-side** (nunca `NEXT_PUBLIC_`); rate limit por usuario (`/api/locations/suggest`);
debounce 250 ms; mín. 2 chars para llamar al proveedor (empresa/local responden antes); caché 60 s en
servidor + caché por consulta en cliente; sin `service_role` en frontend; RLS para los valores de la
empresa; no se guardan datos crudos del proveedor.

## 8. Configuración — problema actual

Se veía "workspace" y chips multivertical; faltaba edición real de perfil/empresa; demasiado
administrativa.

## 9. Qué se eliminó

- La palabra **"workspace"** de la UI visible (→ "cuenta"/"empresa"/"equipo").
- Los **chips** Inmobiliaria/Extranjería/Servicios/Mixto/General → "Actividad principal: Inmobiliaria"
  (fija, informativa; el valor interno sigue siendo `real_estate`).
- El badge "Solo lectura" grande del Perfil (ahora el Perfil es editable en el nombre).
- Componente muerto `VerticalPreferenceCard` (chips + "workspace").

## 10. Nueva estructura de Configuración

Una columna limpia: **Perfil** · **Empresa** · **Equipo** (+ secciones internas solo para operador,
gateadas). Sin Notificaciones, sin roadmap, sin chips, sin "workspace". Badge de cabecera "Cuenta
activa" (antes "Workspace activo").

## 11. Perfil / avatar

`ProfileCard`: avatar de **iniciales**, **nombre visible editable** (persistido en `profiles.full_name`
vía cliente de navegador bajo RLS, sin service_role), email/rol/idioma/estado informativos.
**Avatar/logo con subida de imagen: NO se implementa** (requeriría `profiles.avatar_url` con grant/
migración + bucket/RLS + cableado del topbar para hacerse de forma segura) → pendiente honesto (sin
upload falso). Storage ya opera para fotos de inmueble, así que es viable en P18.

## 12. Empresa / datos

`WorkspaceProfileCard` (sección "Empresa"): nombre comercial (`business_name`), descripción, teléfono,
web y email de contacto (en `metadata`, **sin migración**), actividad fija Inmobiliaria. Validación
(nombre obligatorio, descripción ≤ 220, web/email con formato), un único Guardar con feedback. Persiste
bajo RLS, sin service_role.

## 13. Equipo / invitar miembro

Se mantiene (real). Título "Equipo", subtítulo "Invita a tu equipo para trabajar sobre los mismos
clientes, inmuebles, operaciones y tareas.", botón **"Invitar miembro"**, modal con explicación
(miembros internos, no clientes). Sin "workspace" visible.

## 14. Cambios de lenguaje visible

"workspace" → cuenta/empresa/equipo · "Tipo de workspace"/chips → "Actividad principal: Inmobiliaria" ·
"Workspace activo" → "Cuenta activa" · "Invitar usuario" → "Invitar miembro" · "Ciudad" → "Localidad /
municipio".

## 15. Asistente / capabilities / n8n

- **Capabilities** (`product-capabilities.ts`): `settings.profile` (nombre editable), `settings.company`
  (editable; reemplaza a `settings.workspace`), `settings.team`, `settings.assistant`.
- **Fallback local** (`nowlabs-main-agent.ts`): habla de "cuenta/empresa", nunca "workspace"; Perfil
  (nombre editable), Empresa (editable: nombre/descripción/teléfono/web/email), Equipo; no inventa foto/
  logo/permisos.
- **n8n vivo:** microparche `n8n/patches/P17-configuracion-empresa-sin-workspace.txt` (3 sustituciones
  exactas sobre el bloque P16). Aplicado con autorización (ver Deploy).

## 16. Backend / persistencia / migraciones

**Sin migraciones nuevas.** Empresa → `workspace_settings` (business_name + metadata). Nombre de perfil
→ `profiles.full_name` (UPDATE permitido por RLS a cada usuario sobre su fila). Ubicación → `city`/`area`
existentes. No `service_role` en frontend.

## 17. Tests

- `location-catalog.evals.ts`: alias (bil/bilbo/barna/donosti/san sebastian/vitoria), mezcla
  empresa>catálogo, zona por localidad, custom — siguen verdes (la ruta usa el catálogo como fallback).
- `product-capabilities.evals.ts`: estados P17 (profile/company editables), resumen sin "workspace" ni
  "Próximamente" ni términos prohibidos.
- `assistant-coherence.evals.ts`: Empresa editable, sin "workspace".
- Scans: clave de proveedor nunca `NEXT_PUBLIC_`; `providers.server` solo en servidor.

## 18. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ (ruta
`/api/locations/suggest` construida). Sin "workspace"/"Próximamente"/"Notificaciones"/chips visibles, sin
upload falso, sin keys expuestas, sin service_role en frontend.

## 19. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/app/api/locations/suggest/route.ts` | **NUEVO** backend de autocompletado (empresa+provider+local) |
| `src/lib/locations/providers.server.ts` | **NUEVO** adaptadores google/geoapify/mapbox/local (server-only) |
| `src/components/LocationAutocomplete.tsx` | 2.0 async (debounce, cancelación, caché, loading, fallback) |
| `src/components/VerticalForms.tsx` / `VerticalEditForms.tsx` | "Localidad/municipio", async, simplificados |
| `src/components/ProfileCard.tsx` | **NUEVO** Perfil con nombre editable real (full_name) |
| `src/components/WorkspaceProfileCard.tsx` | "Empresa": nombre/descr./tel./web/email, sin chips, actividad fija |
| `src/components/TeamUsersCard.tsx` | "Invitar miembro", "cuenta" en vez de "workspace" |
| `src/app/(saas)/settings/page.tsx` | Perfil+Empresa+Equipo; "Cuenta activa"; sin "workspace" visible |
| `src/lib/product-capabilities.ts`, `src/lib/agents/nowlabs-main-agent.ts` | capabilities + fallback P17 |
| `.env.example` | envs del proveedor de ubicación |
| `n8n/patches/P17-configuracion-empresa-sin-workspace.txt` | **NUEVO** microparche prompt vivo |
| `src/lib/locations/workspace-locations.ts`, `location-provider.ts`, `components/VerticalPreferenceCard.tsx` | **ELIMINADOS** (muertos tras el refactor) |

## 20–21. Commit / Push

Commit `feat(location+settings): autocompletado real + Configuración empresa sin workspace (P17)` →
`origin/main`.

## 22. Deploy

- **Frontend:** redeploy. La experiencia "real" de ubicación se activa configurando `LOCATION_PROVIDER`
  + su API key en el servidor (sin key → empresa + catálogo local).
- **n8n:** aplicado el microparche P17 al systemMessage vivo, con autorización (`=` y `{{ }}` intactos).

## 23. Checklist staging

- [ ] Crear inmueble → "Localidad / municipio": escribir "bil"/"getxo"/"madrid" → sugerencias; con
      provider configurado, resultados reales y amplios.
- [ ] Localidades ya usadas por la empresa salen con "Usado en tu empresa".
- [ ] Zona depende de la localidad; valor personalizado permitido.
- [ ] Configuración: NO aparece "workspace" ni chips; badge "Cuenta activa".
- [ ] Perfil: editar nombre visible → Guardar → persiste (recargar).
- [ ] Empresa: editar nombre/descripción/teléfono/web/email → Guardar → persiste; web/email validan.
- [ ] Equipo: "Invitar miembro" con explicación; invitación real si hay service-role.
- [ ] Asistente: "¿puedo cambiar la descripción de mi empresa?" → sí (Empresa); nunca dice "workspace".

## 24. Pendientes honestos

- **Avatar de perfil / logo de empresa con subida de imagen**: pendiente P18 (necesita
  `profiles.avatar_url` con grant/migración o `metadata` + bucket privado con signed URL en el topbar,
  para hacerse seguro). Hoy iniciales, sin upload falso.
- **Campos de ubicación** province/postal/lat/lng/place_id: migración futura para filtros/mapa.
- **Filtro de cartera por localidad/zona**: futuro (reutilizando la misma ruta).
- **Provider externo**: arquitectura lista; falta solo la API key del cliente para la experiencia top.

## 25. Veredicto

**P17 COMPLETADO — LOCATION INTELLIGENCE REAL Y CONFIGURACIÓN FINAL PRO SIN WORKSPACE VISIBLE.** La
ubicación es un autocompletado de verdad (backend seguro, proveedor externo opcional, empresa + fallback
local, debounce/caché/cancelación) con conceptos separados (localidad vs zona). Configuración parece
producto SaaS: Perfil con nombre editable real, Empresa editable (nombre/descripción/teléfono/web/email),
Equipo; sin "workspace", sin chips, sin roadmap, sin humo. Avatar/logo queda como pendiente honesto.
`tsc`/`lint`/`build` en verde.
