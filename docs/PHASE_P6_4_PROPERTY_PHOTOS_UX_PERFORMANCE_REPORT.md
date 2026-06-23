# FASE P6.4 — Fotos de inmueble premium: instantáneas, portada inmediata, sin recargar

> **Fecha:** 2026-06-23 · HEAD previo `2d6c5f3`. Solo frontend/UX (sin migración: Storage/RLS
> intactos de P6.3). Requiere redeploy.

## 1-2. Diagnóstico: por qué tardaba y por qué hacía falta F5
- **Subida secuencial**: `handlePick` subía las fotos **una a una** (`await` en serie) y solo al
  terminar TODO el lote hacía un `reload()` completo. Sensación de lentitud + la miniatura no
  aparecía hasta el final.
- **Card no se actualizaba sin F5 (causa raíz del "recargar")**: la portada de la card vive en el
  estado `coverUrls` de `/opportunities`, que se cargaba **una vez** en `loadData`. El
  `PropertyPhotosManager` (dentro del drawer) **no notificaba al padre** → la card solo cambiaba
  al recargar la página (que re-ejecuta `loadData`).

## 3. Refresco sin recargar (callback de portada)
`PropertyPhotosManager` recibe ahora **`onCoverChange(propertyId, coverUrl | null)`** y lo llama
tras cargar / subir / cambiar portada / borrar. El padre `/opportunities` actualiza `coverUrls`
localmente con un handler **memoizado** (`useCallback`, estable para no recrear el efecto del
manager). Resultado: **la card de la cartera se actualiza al instante**, sin F5:
- subir la 1ª foto → portada aparece en la card.
- cambiar portada → la card cambia al momento.
- borrar la portada → se promociona la siguiente (o se vuelve a placeholder), reflejado al instante.
Persistencia tras refresh garantizada (los datos están en `entity_files` + Storage; el cover se
recalcula igual al recargar).

## 4. Portada
- 1ª foto subida (cuando no había ninguna) → **portada automática**.
- Subir varias sin portada previa → la **primera seleccionada** queda de portada (determinista,
  aunque la subida sea concurrente: solo a esa se le pasa `isCover`).
- Portada existente **no se machaca** salvo que el usuario pulse **"Usar como portada"**.
- Badge **"Portada"** visible. Borrar la portada **auto-promociona** la primera restante.

## 5. Rendimiento
- **Subida concurrente limitada** (pool de 3) en vez de secuencial → lotes mucho más rápidos.
- **Previsualización instantánea**: al elegir fotos se muestran ya las miniaturas locales
  (`URL.createObjectURL`) con spinner, mientras suben (sensación inmediata). Se revocan al acabar.
- **Progreso**: el botón muestra **"Subiendo 2/5…"**.
- **Sin bloqueo global tosco**: cada acción (portada/borrar) tiene su propio `busyId`.
- Signed URLs se piden en lote (`createSignedUrls`) tras la carga (1 llamada), no por foto.
- **Compresión automática NO incluida** (evita dependencia pesada): se recomienda < 10 MB y se
  documenta como mejora futura. El cuello restante es el tamaño real de la imagen/red.

## 6-7. UX y card
Manager: zona de subida con formatos + máximo visibles, estado "Subiendo…", grid de miniaturas,
badge Portada, "Usar como portada", borrar, errores por-foto (uno que falle no bloquea el resto),
empty state elegante ("La primera será la portada"). Card: portada con `object-cover` y ratio
estable; placeholder elegante si no hay foto; nunca imagen rota; los PDF (categoría `document`) no
entran en la galería de fotos (solo `category='image'`).

## 8. Seguridad (sin cambios, confirmada)
Bucket privado + signed URLs + RLS workspace-scoped (tabla + `storage.objects`), path
`workspace_id/property/<id>/...`, **sin service_role en frontend**, rollback si falla metadata.
Subir/listar/borrar/portada siguen restringidos al workspace del usuario (políticas P7 + GRANT
P6.3). **No se relajó ninguna política.** Sin migración en P6.4.

## 9-10. Documentos / copy
Documentos: **no** se añadió UI (queda P7.1; la infra lo soporta con `category='document'`). Copy
del módulo ya coherente: topbar **"Cartera" / "Inmuebles, operaciones y trámites"** (P6.3), CTAs
contextuales por pestaña, sin "Pipeline comercial".

## 11. Limitaciones honestas
- Signed URLs caducan (1 h): si dejas la página abierta >1 h, la portada podría requerir recarga
  para regenerar la URL (los datos no se pierden). Aceptable para el MVP.
- Sin compresión automática (imágenes grandes suben más lento). Futuro.
- Sin reordenar fotos por arrastre todavía (futuro).

## 12. Validaciones
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Sin secretos/PII; sin "Pipeline comercial".

## 13. Archivos
`src/components/PropertyPhotosManager.tsx` (reescrito: concurrencia + previews + progreso +
cover callback), `src/components/VerticalEditForms.tsx` (thread `onCoverChange`),
`src/app/(saas)/opportunities/page.tsx` (handler memoizado + prop), este report.

## 14-16. Commit / push / redeploy
Ver hash en el commit. Push a `origin/main`. **Requiere redeploy** del front (sin migración).

## 17. Checklist QA humano (post-deploy)
1. Cartera → Inmuebles → Editar "Piso 3 dorm. - Calle Mayor 14".
2. Subir **JPG** → miniatura aparece **sin recargar** + "Foto subida".
3. Si era la 1ª foto → queda **Portada**.
4. Cerrar drawer → **portada en la card sin recargar**.
5. Subir **PNG/WebP** (varias) → "Subiendo 2/3…", miniaturas instantáneas.
6. Marcar otra como **portada** → card cambia al instante.
7. **Borrar** una foto → desaparece; si era portada, se promociona otra.
8. **Refrescar** → persistencia correcta.
9. (Negativo) Subir >10 MB o no-imagen → toast claro (tamaño/formato).

## Veredicto
**P6.4 COMPLETADO — FOTOS PREMIUM SIN RECARGA.** Subida concurrente con previsualización
instantánea y progreso, portada inmediata propagada a la card sin F5, errores útiles por foto,
seguridad intacta (RLS/Storage/sin service_role). Compresión y reordenar quedan como mejoras
futuras documentadas. Requiere redeploy.
