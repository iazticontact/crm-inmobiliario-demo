# FASE P15 — Ubicaciones inmobiliarias con autocompletado profesional y datos normalizados

> **Fecha:** 2026-06-26 · Los campos **Ciudad** y **Zona / barrio** del formulario de inmueble eran
> inputs libres → permitían "Bilbaoooo", duplicados y barrios sin normalizar, ensuciando filtros,
> búsquedas, dashboard e informes. Ahora son **autocompletado** con catálogo local (sin APIs externas),
> zonas dependientes de la ciudad y **normalización** al guardar. Sin tocar n8n, prompt del agente,
> credenciales, RLS/Auth/Storage ni lógica de negocio.

---

## 1. Diagnóstico (en código)

- **Crear inmueble:** `NewPropertyDrawer` (`src/components/VerticalForms.tsx`) — entrada compartida desde
  `/opportunities` (Cartera) y desde la ficha de cliente (360). Campos `city` y `area` como `<Input>` libre.
- **Editar inmueble:** `EditPropertyDrawer` (`src/components/VerticalEditForms.tsx`) — mismos campos libres.
- **Campos reales (tabla `properties`):** `city: string | null`, `area: string | null` (zona/barrio).
  Existe también `address` (texto libre) que no se edita desde el formulario; se respeta tal cual.
- **Cartera (`/opportunities`, vista Inmuebles):** muestra `[p.city, p.area]` como ubicación. **No hay
  filtro por ciudad/zona** (solo activos/histórico/todos) → se documenta como mejora futura.
- **Ficha de inmueble (`/opportunities/properties/[id]`):** solo muestra ubicación, no la edita inline.
- **Combobox existente:** `EntitySelect` (selección por id, no free-text) → no reutilizable aquí; se crea
  un componente nuevo de free-text con sugerencias.
- **Seeds:** valores limpios (Valencia/Paterna/Torrent + barrios reales). **No se migra nada.**

## 2. Problema detectado por el validador

Ciudad y zona como texto libre permiten datos inconsistentes (errores ortográficos, duplicados, barrios
no normalizados), lo que degrada filtros, agrupación por zona, dashboard y la sensación de producto real.

## 3. Solución implementada

Autocompletado tipo web real, **rápido de introducir y difícil de ensuciar**: el usuario escribe,
aparecen sugerencias (prefijo primero), elige ciudad y luego el barrio se sugiere según esa ciudad; si la
zona no está en catálogo puede usarla como **personalizada** (sin bloquear). Al confirmar/guardar, el
valor se **normaliza** (capitalización limpia, sin espacios dobles, acentos y nombres oficiales
preservados). Sin APIs externas ni coste.

## 4. Catálogo local

`src/lib/locations/location-catalog.ts` — estructura mantenible y ampliable: `name`, `province`,
`region`, `country` (España por defecto), `aliases`, `areas`. Ciudades MVP: **Bilbao, Donostia / San
Sebastián, Vitoria-Gasteiz, Madrid, Barcelona, Valencia, Málaga, Marbella, Sevilla, Zaragoza, Santander,
Pamplona, Logroño**. Bilbao incluye los barrios pedidos (Abando, Indautxu, Ensanche, Casco Viejo,
Deusto, Santutxu, Begoña, San Ignazio, Uribarri, Rekalde, Basurto, Zorrotza, Miribilla) y el resto de
ciudades una selección razonable. Alias para que la búsqueda encuentre variantes ("San Sebastián" →
Donostia). Helpers: `searchCities`, `searchAreas`, `findCity`, `isKnownArea` (ranking exacto > prefijo >
contiene, sin acentos/mayúsculas). **No** usa Google Places/Mapbox (queda como futuro).

## 5. Componentes creados

- **`src/components/LocationAutocomplete.tsx`** — combobox free-text reutilizable, sin dependencias:
  sugerencias (máx. 8), navegación con **↑/↓**, **Enter** selecciona, **Escape** cierra, **click fuera**
  cierra, resaltado de coincidencia, **valor personalizado** ("Usar 'X'…"), `aria-*` (role combobox/
  listbox/option), `maxLength` 80, normaliza al confirmar/blur y `onCommit` para pasar el foco. Estilo
  coherente con el CRM (icono `MapPin`, mismo input shell), responsive.
- **`src/lib/locations/normalize-location.ts`** — `normalizeLocationText`, `normalizeLocationForSave`
  (vacío si solo símbolos), `foldAccents`, `hasLetters`, `sameLocation`.

## 6. Formulario de inmueble

En **crear** y **editar**:
- **Ciudad:** `LocationAutocomplete` con sugerencias del catálogo (muestra provincia: "Bilbao · Bizkaia").
  Al elegir una ciudad conocida, el foco pasa a Zona/barrio.
- **Zona / barrio:** `LocationAutocomplete` dependiente de la ciudad (Bilbao → Deusto, Abando, Indautxu…).
  Si no hay ciudad, ayuda discreta: "Escribe primero la ciudad para ver barrios sugeridos." Si la zona no
  pertenece a la ciudad, aviso discreto: "'X' no figura en {ciudad}; se guardará como zona personalizada"
  (**no se borra ni se bloquea**).
- Título / tipo / operación / estado / precio / propietario: **sin tocar**.

## 7. Normalización

" bilbao " → "Bilbao" · "BILBAO" → "Bilbao" · "deusto" → "Deusto" · "  plaza   españa " → "Plaza España"
· "vitoria-gasteiz" → "Vitoria-Gasteiz" · "donostia / san sebastián" → "Donostia / San Sebastián".
Conectores en minúscula salvo primera palabra ("El Grao"), acentos preservados, solo símbolos → no se
guarda.

## 8. Datos existentes

No se rompe nada: los valores guardados se siguen mostrando; si no están en catálogo se admiten como
personalizados. **No hay migración masiva**; un inmueble solo se normaliza cuando el usuario guarda su
edición. Seeds intactos (valores ya limpios).

## 9. Filtros / cartera

La vista de Cartera **no** tenía filtro por ciudad/zona; **no se añade** uno nuevo en esta fase (scope).
Cuando se añada, debe reutilizar el catálogo + los valores reales en BD. Documentado como pendiente.

## 10. Responsive / accesibilidad

Input con icono, dropdown limpio (máx-h con scroll propio), sin cajas gigantes. `role=combobox/listbox/
option`, `aria-expanded`, `aria-autocomplete`, `aria-selected`, navegación por teclado completa, focus
visible (ring), estados con texto (ayuda/aviso), no solo color. Cómodo en móvil (selección por
`onMouseDown`, sin perder foco antes de tiempo).

## 11. Tests

`src/lib/locations/__evals__/location-catalog.evals.ts` (con `runLocationEvals()`): normaliza
"bilbao"→"Bilbao", sugiere Bilbao al escribir "bil", Donostia por alias "san sebastián", Deusto cuando
ciudad=Bilbao y zona="de", zona personalizada permitida, ciudad desconocida → sin barrios (no rompe),
`isKnownArea`, `foldAccents`, `hasLetters`, `normalizeLocationForSave`. **Verificado** con un script
desechable que reproduce el algoritmo: **20/20 PASS**.

## 12. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅. Sin imports muertos,
sin datos técnicos visibles, sin duplicación (un único catálogo + un único componente reutilizado en
crear y editar).

## 13. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/lib/locations/location-catalog.ts` | **NUEVO** catálogo + búsqueda (ciudades/zonas) |
| `src/lib/locations/normalize-location.ts` | **NUEVO** normalización de ubicación |
| `src/components/LocationAutocomplete.tsx` | **NUEVO** combobox free-text reutilizable |
| `src/components/VerticalForms.tsx` | crear inmueble: Ciudad/Zona con autocompletado + normalización |
| `src/components/VerticalEditForms.tsx` | editar inmueble: Ciudad/Zona con autocompletado + normalización |
| `src/lib/locations/__evals__/location-catalog.evals.ts` | **NUEVO** evals |

## 14–15. Commit / Push

Commit `feat(properties): autocompletado de ciudad/zona + normalización de ubicaciones (P15)` →
`origin/main`.

## 16. Deploy necesario

Solo **redeploy del frontend**. Sin migraciones, sin cambios en n8n, RLS, Auth ni Storage.

## 17. Checklist staging

- [ ] Crear inmueble: escribir "bil" → aparece "Bilbao · Bizkaia"; elegir → foco salta a Zona.
- [ ] Zona: con Bilbao, escribir "de" → aparece "Deusto"; elegir.
- [ ] Escribir una zona inexistente → "Usar 'X' como valor personalizado" + aviso discreto; guarda igual.
- [ ] " bilbao " / "BILBAO" → se guarda "Bilbao".
- [ ] Editar un inmueble con ciudad fuera de catálogo (p. ej. Paterna) → se muestra y se conserva.
- [ ] Cambiar ciudad con zona ya escrita → la zona NO se borra; avisa si no pertenece.
- [ ] Teclado (↑/↓/Enter/Escape) y móvil cómodos; sin errores de consola.

## 18. Pendientes honestos

- **Filtro de cartera por ciudad/zona:** mejora futura (reutilizando catálogo + valores reales).
- **Catálogo:** MVP; ampliar municipios/barrios según uso real.
- **Futuro:** nomenclátor nacional completo, API externa opcional (Google Places/Mapbox), códigos
  postales, coordenadas/mapa, autocompletado de dirección, geocoding, deduplicación avanzada.

## 19. Veredicto

**P15 COMPLETADO — UBICACIONES INMOBILIARIAS CON AUTOCOMPLETADO PROFESIONAL Y DATOS NORMALIZADOS.**
Escribes "Bilbao" y aparecen opciones con provincia; eliges ciudad y el barrio se sugiere en orden;
puedes usar valores personalizados sin bloquearte; y todo se guarda limpio y consistente. Sin APIs
caras, sin romper datos existentes, sin tocar n8n/credenciales/RLS. `tsc`/`lint`/`build` en verde.
