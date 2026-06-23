# FASE P7.2 — Inmuebles/Ficha: acciones directas, estados vivos, tipo "Otro" y cierre premium

> **Fecha:** 2026-06-24 · Pulido UX final de Inmuebles + ficha. Solo UI/helpers/labels + 1 mejora de
> robustez (claves de tipo/operación). **Sin migración de esquema.** Requiere redeploy.

## 1. Diagnóstico (staging)
- En la ficha, "Subir fotos" y "Añadir documento" hacían **scroll** hacia abajo (lento/incómodo).
- El contador del segmented control "Histórico (4)" se sentía raro.
- Los inmuebles publicados no se diferenciaban lo suficiente (faltaba sensación "activo/online").
- El **tipo de inmueble** era cerrado: faltaba **"Otro" + campo libre**.
- (Bug encontrado de paso) el alta/edición guardaba el **tipo y la operación en claves inglesas**
  (`apartment`/`sale`…) que se mostraban mal ("Apartment", "Sale") y rompían el `€/mes` de alquiler.

## 2. "Subir fotos" → acción directa (modal)
- El botón abre un **modal ligero "Fotos del inmueble"** con **`PropertyPhotosManager`** (mismo
  componente, sin duplicar lógica): subir múltiple con previsualización, **fijar portada**, borrar.
- `onCoverChange` **actualiza la portada de la cabecera en vivo** (sin F5). El modal se monta
  **lazy** (solo al abrir). **Ya no hace scroll.**

## 3. "Añadir documento" → acción directa (modal)
- El botón abre un **modal "Documentos del inmueble"** con **`EntityDocumentsManager`**
  (`entity_type='property'`, `category='document'`): subir, abrir/descargar, borrar. Lazy.
- Copy: "Documentos del inmueble · Nota simple, planos, certificado energético, escrituras o
  contratos." No se llama "trámite"; no se mezcla con documentos de trámites.

## 4. Activos / Histórico / Todos (copy)
- Segmented control → **Activos · Histórico · N · Todos** ("Histórico · 4" en vez de "(4)").
- Subcopy de sección dinámico (ya existente): Activos "Cartera activa: inmuebles disponibles o en
  gestión." · Histórico "vendidos, alquilados o archivados." · Todos separa "Cartera activa" /
  "Histórico".

## 5. Feedback visual de inmuebles activos
- **Publicado**: badge verde con **punto verde pulsante** (sensación "activo/online", discreto y
  premium) en cards y en la cabecera de la ficha.
- Diferenciación por estado: En preparación (indigo) · Publicado (verde + dot) · Reservado (ámbar) ·
  Vendido/Alquilado (azul) · Archivado (gris) · histórico = card apagada con sello "Histórico".

## 6. Tipo de inmueble — "Otro" + campo libre (+ fix de claves)
- **Catálogo unificado** en `property-display.ts` (`PROPERTY_TYPE_OPTIONS`,
  `PROPERTY_OPERATION_OPTIONS`) con **claves es-ES** coherentes con las etiquetas: Piso · Ático ·
  Chalet · Casa · Local · Oficina · Garaje · Terreno · **Otro**. Operación: Venta · Alquiler.
- **"Otro"** muestra un input **"Especifica el tipo"** (placeholder "Ej.: trastero, garaje, nave,
  terreno…") en **alta y edición**. Se guarda en **`metadata.custom_property_type`** (sin migración;
  `updateProperty` ahora acepta `metadata`). Se muestra en cards y ficha vía **`propertyTypeText()`**.
- **Fix de robustez**: el alta/edición guardaba claves inglesas (`apartment`/`house`/`villa`/
  `commercial`/`office`/`land`, `sale`/`rent`) que no casaban con el catálogo es-ES → labels en
  inglés y `€/mes` roto en alquileres nuevos. Ahora guarda claves es-ES (`piso`/`venta`…). Datos
  existentes intactos: la edición **conserva** un tipo antiguo no catalogado (se añade como opción).

## 7. Ficha — micro-polish
- Cabecera compacta de 2 columnas (portada acotada `aspect-[4/3]`, sin hero gigante; placeholder
  compacto que abre el modal de fotos).
- Jerarquía de acciones: **Editar** (primario) · **Subir fotos** · **Añadir documento** (secundarios,
  abren modal — feedback inmediato).
- Secciones: Datos · Operaciones vinculadas · Trámites vinculados. Fotos/Documentos viven en sus
  modales (más ligero; **se cargan solo al abrir**).

## 8. Cards — micro-polish
- "Ver ficha" sigue protagonista (botón sólido) + card clicable; "Editar" icono secundario.
- Tipo mostrado con `propertyTypeText` (respeta "Otro"). Publicado con dot verde. Histórico apagado.
- Precio alquiler `€/mes`, venta `€`. Operaciones vinculadas visibles, no ruidosas.

## 9. Rendimiento
- **Ficha más ligera que P7.1**: la cabecera carga **solo la portada** (1 signed URL vía
  `coverUrlsForProperties`); la galería completa y los documentos se cargan **lazy** al abrir cada
  modal (antes se montaban siempre). `Promise.all` para las listas; sin N+1; estado local para la
  portada (sin recargar al subir/borrar). Sin dependencias nuevas.
- Cartera: sin cambios de coste (covers/doc-counts/clientes agregados, sin N+1).

## 10. Qué NO se tocó
n8n · Asistente IA · Auth/onboarding · Clientes · Calendario · Dashboard · Storage **policies** · RLS
· `.env.local`/secretos · **service_role (sin uso en frontend)** · facturación/impuestos/gastos ·
lógica de comisiones · datos reales fuera del ejemplo. **Sin migración de esquema** (custom type =
metadata aditivo en escritura). Fotos y documentos (managers) no se modificaron.

## 11. Validaciones
- `npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅
  (`✓ Compiled successfully`; ruta `/opportunities/properties/[id]` compilada).
- Scans: sin probabilidad/pipeline/lead/expediente visibles; **sin acción scroll-only** en los
  botones de la ficha (abren modal); sin claves inglesas en los drawers; service_role solo en
  comentario; sin botón muerto; sin imagen rota (ejemplo con 0 fotos → placeholder).

## 12. Checklist QA (staging)
**Inmuebles**
- [ ] Segmented control "Activos · Histórico · N · Todos" claro y visible.
- [ ] **Publicado** se diferencia (dot verde pulsante); Reservado ámbar; histórico apagado.
- [ ] Card clicable abre ficha; "Ver ficha" visible; Editar funciona; cambiar estado mantiene grupos.

**Ficha**
- [ ] **"Subir fotos" abre modal** (no scroll); subir/portada/borrar; la portada de la cabecera se
      actualiza sin F5.
- [ ] **"Añadir documento" abre modal** (no scroll); subir/abrir/borrar; persiste.
- [ ] Sin foto no ocupa media pantalla; F5 directo funciona; "Volver a Cartera" funciona.

**Tipo de inmueble**
- [ ] Crear inmueble con **tipo "Otro" + "Trastero"** → card y ficha muestran **"Trastero"**.
- [ ] Editar conserva y permite cambiar el tipo (incl. tipos antiguos no catalogados).
- [ ] Un inmueble estándar (Piso/Local…) sigue mostrándose bien; alquiler muestra €/mes.

## Veredicto
**P7.2 COMPLETADO — INMUEBLES UX FINAL POLISH.** Acciones **directas** (fotos y documentos en modal,
sin scroll), **estados vivos** (dot verde "activo" en Publicado), **tipo flexible** ("Otro" + campo
libre, guardado en metadata) y de paso **corregidas las claves inglesas** de tipo/operación del alta/
edición. Cards y ficha más cómodas y premium; ficha **más ligera** (galería/documentos lazy). Sin
migración, sin tocar Storage/RLS/módulos externos, rendimiento intacto. `tsc`/`lint`/`build` en verde.
Requiere redeploy.
