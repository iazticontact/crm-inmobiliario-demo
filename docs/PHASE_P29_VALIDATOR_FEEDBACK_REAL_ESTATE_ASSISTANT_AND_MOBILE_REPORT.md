# FASE P29 — Validadores: Asistente inmobiliario semántico, cliente país/idioma, inmueble m²/hab/baños, mobile

> **Fecha:** 2026-07-01 · Feedback de validadores reales. Sin extras (nada de facturación/documentos/
> notificaciones). Se generaliza por **taxonomía + helpers + filtros flexibles + ranking + evals**, sin
> hardcodear casos concretos. El fix principal del Asistente es de **backend** (motor de búsqueda), por lo
> que generaliza aunque el LLM sea literal.

---

## 1. Diagnóstico inicial
- **properties** ya tenía `area_m2`, `bedrooms`, `bathrooms`, `owner_name/phone`, `reference`, `notes` — pero
  el **formulario de alta no los pedía** y el **Asistente no los leía**.
- **clients** guarda país/idioma en `metadata` (nationality / preferred_language); el Asistente ya los recibe
  (`crm_read_query` incluye `metadata`). Faltaba UX de autocomplete.
- **`searchProperties`** era **literal**: filtro exacto por `status`, `ilike` solo en title/city/area/address,
  **sin** sinónimos, notas, operación, precio, habitaciones, disponibilidad ni parciales.
- **Detección de acción** (`ai.ts`) marcaba **factura** ante presupuesto/€/importe/pago (falsos positivos en
  inmobiliaria).

## 2. Causa del fallo del Asistente
Búsqueda **literal + filtros rígidos**: (a) exigía `status` exacto y coincidencia textual estrecha → falsos
negativos; (b) no exponía m²/hab/baños/notas; (c) no distinguía tipo/operación/estado por sinónimos ni
disponibilidad comercial; (d) no devolvía parciales, así que decía "no hay" con candidatos relevantes
presentes. Verificado y corregido con pruebas E2E contra datos reales (§15).

## 3. Mobile final
La regla global de P28C (`input/select/textarea` ≥16px en móvil + viewport `viewport-fit=cover`) **cubre
automáticamente** los campos nuevos (autocompletes país/idioma, inputs m²/hab/baños) → sin auto-zoom iOS. El
autocomplete usa `input` estándar (hereda 16px). No hizo falta tocar viewport ni añadir hacks.

## 4. Cliente — País e Idioma (autocomplete profesional)
- **Componente reutilizable** `AutocompleteSelect.tsx` (accesible: combobox/listbox, ↑/↓/Enter/Escape, click
  fuera, limpiar) + **datasets** `geo-language-data.ts` (LANGUAGES, COUNTRIES; búsqueda tolerante a acentos,
  por prefijo→contiene, con alias).
- **Idioma preferente** → autocomplete `LANGUAGES` (Español, Inglés, Francés, Alemán, Euskera, Catalán,
  Gallego, Árabe, Chino, Rumano…). **País** → autocomplete `COUNTRIES`. Persisten por el patrón existente
  (`metadata.preferred_language` / `metadata.nationality`), que el **Asistente ya lee**.
- Columnas dedicadas `clients.country`/`preferred_language` añadidas (additivo, `docs/supabase/
  p29_clients_country_language.sql`) para uso futuro.

## 5. Autocomplete idioma
Se comporta como el selector de localidad: escribes una letra y aparecen opciones (nombre o alias),
priorizando las que empiezan por lo escrito. Permite "No consta" (vacío). Móvil sin auto-zoom.

## 6. Inmueble — m²/habitaciones/baños
- Columnas ya existían. **Añadidos inputs** en el alta (`NewPropertyDrawer`): Superficie (m²), Habitaciones,
  Baños (validados: número ≥0, vacío permitido) + wiring en `createProperty` (area_m2/bedrooms/bathrooms).
- **Card y ficha** ya los mostraban (`propNum`).
- **Asistente**: `crm_read_query` (properties) y `search_properties` ahora devuelven `area_m2/bedrooms/
  bathrooms/owner_name/owner_phone/reference/notes`.

## 7. Cambios de UI
Formulario de cliente (país/idioma autocomplete), formulario de inmueble (m²/hab/baños), sin romper desktop;
móvil cómodo (16px). Card/ficha de inmueble ya cubrían m²/hab/baños.

## 8. Taxonomía inmobiliaria (`real-estate-search.ts`, pura)
Diccionarios de **tipo** (piso/apartamento→piso; casa/chalet/adosado/villa→familia casa; local/oficina/
garaje/terreno/nave…), **operación** (comprar/invertir→venta; alquilar/renta→alquiler), y clasificación de
**estado**. "vivienda/inmueble/propiedad" = genérico (no filtra por tipo).

## 9. Disponibilidad
`isPropertyClosed` (sold/rented/archived), `isPropertyCommerciallyActive` (todo lo demás con estado),
`availabilityAllows(status, mode)` con modos `available` (por defecto, excluye cerrados) / `all` / `closed`.
No depende de un único estado rígido.

## 10. Ranking / búsqueda inteligente
`scoreProperty` puntúa disponibilidad + tipo + operación + ubicación (incl. notas, tolerante a acentos) +
presupuesto (con margen 10%) + habitaciones/baños + notas. `rankProperties` separa **exactos** de
**parciales** (y cuenta excluidos). Sin criterios ("viviendas disponibles") → todo lo activo es exacto (no
falsos negativos). `searchProperties` devuelve `exactMatches`, `partialMatches`, `appliedFilters`,
`availabilityMode`, `warnings`, e `items` con `matchLevel` + `reasons`.

## 11. Notas y precio
El motor consulta **notas** (ubicación/condiciones) y `search_properties` las devuelve (clamp 400). El
microparche del prompt indica explicar **precio listado vs. notas** si difieren ("según las notas…"), sin
sobreinterpretar.

## 12. Detección de acción "factura"
`ai.ts`: `invoiceWords` reducido a facturación **explícita** (`factura/facturar/facturación/nota de
honorarios`). Presupuesto, €/euros, importe, pago, **comisión** y precio ya **no** disparan factura. Los
cobros los cubre la intención `collection`. Verificado en evals.

## 13. Backend / tools
`searchProperties` reescrito sobre el motor: acepta `query/searchText, type, operation, locality/area/city,
minPrice, maxPrice, bedrooms, bathrooms, availabilityMode, includePartialMatches`; trae 120 candidatos por
workspace (sin filtro rígido de status en BD para no crear falsos negativos) y rankea en memoria. Payload
acotado (exactos ≤12, parciales ≤8). `crm_read_query` expone los campos nuevos de inmueble.

## 14. Prompt / capabilities
Microparche **generalizado** (sin ejemplos concretos) en el **fallback local** (`nowlabs-main-agent.ts`):
búsqueda inmobiliaria no literal (sinónimos, activos, parciales antes de "no hay", notas, precio listado vs
notas, m²/hab/baños), país/idioma del cliente, y "factura solo si es facturación explícita". **El prompt VIVO
de n8n NO se ha tocado** (ver §20 — preparado, pendiente de autorización).

## 15. Evals / tests + verificación E2E
- **`src/lib/__evals__/real-estate-search.evals.ts`** (ejecutable, fixtures sintéticas): taxonomía, operación,
  disponibilidad, presupuesto (hasta/entre/mil/mensual), habitaciones, ranking exacto/parcial, cerrados
  excluidos, match por notas, y **factura no se dispara** por precio/comisión/presupuesto (sí por factura
  explícita).
- **E2E contra datos reales** (backend local + Supabase real, `search_properties`):
  - "qué viviendas tengo disponibles" → **exactos** (solo activos; cerrados excluidos).
  - "busco un piso en venta hasta 300.000€" → **exacto** (piso listado 245.000€, m²76, 2 hab).
  - "alguna casa o chalet" → **exacto** (chalet listado).
  - "busco para invertir hasta 500 mil" → **exactos** (operación=venta inferida).
  - Iterando, se **detectaron y corrigieron** fugas de tokens de ubicación (filler/presupuesto/atributos/
    intención se tomaban como localidad y degradaban todo a parcial = el falso negativo del validador).

## 16. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ · pruebas E2E ✅ · git limpio ·
sin secretos · sin temp files.

## 17. Scans
Sin `service_role` frontend · sin secretos · sin IDs a usuario (los reasons/appliedFilters no exponen ids) ·
sin tablas inexistentes (search usa `properties` real) · inputs nuevos heredan 16px móvil · sin ejemplos
hardcodeados en el motor (diccionarios/heurística).

## 18. Archivos tocados
| Archivo | Cambio |
|---|---|
| `src/lib/real-estate-search.ts` | **Nuevo** — motor puro (taxonomía/disponibilidad/presupuesto/ranking) |
| `src/lib/agent-tool-readers.ts` | `searchProperties` semántico + expone m²/hab/baños/owner/notes (search + crm_read_query) |
| `src/lib/geo-language-data.ts` | **Nuevo** — datasets país/idioma + filtro |
| `src/components/AutocompleteSelect.tsx` | **Nuevo** — autocomplete accesible reutilizable |
| `src/app/(saas)/clients/page.tsx` | País/Idioma como autocomplete |
| `src/components/VerticalForms.tsx` | Alta de inmueble: inputs m²/habitaciones/baños |
| `src/lib/vertical-queries.ts` | `createProperty` acepta area_m2/bedrooms/bathrooms |
| `src/lib/ai.ts` | Fix falso positivo de intención "factura" |
| `src/lib/agents/nowlabs-main-agent.ts` | Microparche generalizado (fallback local) |
| `src/lib/__evals__/real-estate-search.evals.ts` | **Nuevo** — evals ejecutables |
| `docs/supabase/p29_clients_country_language.sql` | Registro de migración additiva |

## 19. Migraciones
`p29_clients_country_language` (additiva, no destructiva): `clients.country` + `clients.preferred_language`.

## 20. Cambios n8n
**Ninguno aplicado.** El fix del Asistente es de backend (el motor devuelve exactos/parciales/warnings, así
que el LLM ya recibe mejor información). Se **recomienda** replicar el microparche de §14 en el `systemMessage`
del nodo "CRM Agent" del workflow vivo para reforzar (usar exactMatches/partialMatches, no decir "no hay" con
parciales). Es un cambio en n8n vivo → **requiere tu autorización** (protocolo: diff mínimo solo al
systemMessage, no tocar credentials/connections/memory/webhook, verificar activo + 24 nodos + expresiones
tras el PUT). Ver §25.

## 21–22. Commit / Push
Commit `feat(p29): asistente inmobiliario semántico + país/idioma + m²/hab/baños + fix factura (validadores)`
→ `origin/main`.

## 23. Deploy necesario
Redeploy del frontend/backend para servir el motor y los campos nuevos. La migración ya está aplicada en
Supabase (no requiere acción de deploy).

## 24. Pendientes honestos
1. **n8n live prompt:** microparche preparado (§14/§20), **no aplicado** — requiere tu autorización.
2. **Ficha de cliente:** el Asistente ya lee país/idioma (metadata); mostrarlos también en la ficha visual del
   cliente detalle es una mejora menor pendiente (no bloqueante).
3. **QA humano móvil** en dispositivo real (heredado de P28B/C) para los formularios nuevos.
4. **Columnas dedicadas country/preferred_language:** additivas; migrar el guardado de metadata→columna queda
   como limpieza futura si se prefiere columnas explícitas.

## 25. Veredicto
**P29 COMPLETADO — ASISTENTE INMOBILIARIO SEMÁNTICO, MOBILE ESTABLE Y DATOS CLIENTE/INMUEBLE PROFESIONALES.**
La búsqueda de inmuebles ya no es literal: interpreta intención (sinónimos de tipo/operación), respeta
disponibilidad comercial, entiende presupuesto/habitaciones/ubicación (incl. notas) y devuelve **exactos +
parciales con motivos**, evitando los falsos negativos que reportaron los validadores (verificado E2E). País e
idioma son autocompletes profesionales; el inmueble tiene m²/habitaciones/baños de punta a punta; y
precio/comisión ya no se confunden con factura. Único pendiente que requiere tu OK: replicar el microparche en
el prompt vivo de n8n.
