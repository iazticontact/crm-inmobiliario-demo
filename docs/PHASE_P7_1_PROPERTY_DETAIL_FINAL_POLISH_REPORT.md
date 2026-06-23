# FASE P6.17 / P7.1 — Inmuebles y ficha de inmueble: premium final

> **Fecha:** 2026-06-23 · UX/copy de la pestaña Inmuebles + **rediseño compacto premium de la ficha
> de inmueble**. Solo UI (helpers/labels), **sin migración**, sin tocar Storage/RLS. Requiere
> redeploy.

## 1. Diagnóstico (staging)
- Estados aún técnicos ("Captación"); dudas activo vs histórico (¿archivado va a histórico?).
- "Ver ficha" pequeño y poco protagonista; "Editar" competía con él.
- En la ficha, sin foto, el hero/placeholder ocupaba **media pantalla**.
- La ficha funcionaba pero no parecía una **ficha inmobiliaria 360 premium**; faltaba feedback
  visual de estado y gestionar fotos/documentos desde la propia ficha.

## 2. Estados de inmueble (decisión de producto)
- **Captación → "En preparación"** (label visible; clave interna `prospecting` intacta). Tono
  indigo suave.
- Etiquetas finales: **En preparación · Publicado · Reservado · Vendido · Alquilado · Archivado**.
- **Activos** = En preparación + Publicado + Reservado. **Histórico** = Vendido + Alquilado +
  Archivado (archivado **sí** va a histórico).
- Drawers alineados: **edición** ofrece los 6 estados (con Vendido/Alquilado separados, fin del
  "Vendida / alquilada" combinado); **alta** ("Estado inicial") ofrece solo activos (En preparación
  / Publicado / Reservado) — un inmueble nuevo entra en cartera activa.

## 3. Activos / Histórico / Todos (más claro)
- Segmented control **Activos · Histórico (N) · Todos** (default Activos; solo si hay histórico).
- **Subcopy dinámico** de la sección: Activos → "Cartera activa: inmuebles disponibles o en
  gestión." · Histórico → "Histórico: vendidos, alquilados o archivados." · Todos → "Cartera activa
  e histórico." (en "Todos", secciones separadas "Cartera activa · N" / "Histórico · N").

## 4. Cards — "Ver ficha" protagonista
- **Botón "Ver ficha" sólido (indigo)** en el pie + toda la card clicable hacia la ficha (hover).
- **"Editar"** pasa a **icono secundario** (lápiz) → ya no compite con "Ver ficha".
- Pie: `[estado select (flex)] · [Ver ficha (primario)] · [editar (icono)]`.

## 5. Cards — feedback visual de estado / histórico
- Badges por estado: En preparación (indigo) · Publicado (verde) · Reservado (ámbar) · Vendido/
  Alquilado (azul) · Archivado (gris).
- **Cards de histórico**: fondo apagado (`bg-gray-50/50`), sin elevación en hover, **sello
  "Histórico"** sobre la foto y portada levemente atenuada → no parecen activas, pero siguen
  elegantes. Activas: blancas con sombra y *lift* en hover.

## 6. Ordenación (sin cambios de criterio, ya correcto)
Activos: Reservado → Publicado → En preparación. Histórico: Vendido → Alquilado → Archivado.
Desempate por `updated_at` desc. Al cambiar estado, la card se reubica en su grupo (estado local,
sin F5).

## 7. Ficha de inmueble — rediseño compacto premium
- **Cabecera de 2 columnas** (foto acotada `aspect-[4/3]`, máx. 300–360px + datos): **se acabó el
  hero gigante vacío**. Sin fotos → placeholder **compacto** con CTA "Subir fotos" (no media
  pantalla).
- Columna de datos: badges (operación · estado · "Histórico" si aplica), **título**, ref/tipo/specs,
  ubicación, **precio grande** (€ o €/mes) y **acciones**: **Editar · Subir fotos · Añadir
  documento** (las dos últimas hacen *scroll* a sus secciones, sin botones muertos).
- Secciones: **Datos del inmueble** · **Operaciones vinculadas** (estado comercial) · **Trámites
  vinculados** (estado) · **Fotos del inmueble** · **Documentos del inmueble**.
- Empty states compactos y útiles ("Sin operaciones vinculadas todavía", etc.).

## 8. Fotos (gestión desde la ficha)
- **`PropertyPhotosManager` montado en la ficha** (sección "Fotos del inmueble"): subir múltiple con
  previsualización, **fijar portada**, borrar — todo real (Storage + signed URLs + RLS, sin
  service_role). `onCoverChange` **actualiza la portada de la cabecera en vivo** (sin F5). No se
  duplicó lógica (mismo componente que el drawer). Portada/galería/cartera siguen sincronizadas.

## 9. Documentos del inmueble
- Sección "Documentos del inmueble" con **`EntityDocumentsManager`** (`entity_type='property'`,
  `category='document'`): subir nota simple/planos/certificado/escrituras, abrir/descargar, borrar.
  No se llama "trámite". signed URLs / RLS / sin service_role. Documentos de trámites **no tocados**.

## 10. Qué pasa al vender / alquilar / archivar
Desde la card (o el drawer), pasar a Vendido/Alquilado/Archivado **pide confirmación**: «saldrá de la
cartera activa y quedará en el histórico. No se elimina nada: se conservan fotos, documentos,
operaciones y trámites.» El inmueble pasa al grupo Histórico (estado local, sin F5).

## 11. Qué NO se tocó
n8n · Asistente IA · Auth/onboarding · Clientes · Calendario · Dashboard · Storage **policies** · RLS
· `.env.local`/secretos · **service_role (sin uso en frontend)** · facturación/impuestos/gastos ·
lógica de comisiones. **Sin migración** (el entorno de ejemplo ya no tenía fotos raras tras P6.16).

## 12. Rendimiento
- Cartera: sin coste extra (covers/doc-counts/clientes agregados, `Promise.all`, sin N+1, signed
  URLs perezosas, estado local en acciones). Ordenación O(n·log n) sobre arrays pequeños.
- Ficha: carga **solo al entrar** (`Promise.all`: propiedad + operaciones + trámites + clientes). La
  galería ya **no se descarga dos veces**: la portada de la cabecera la provee
  `PropertyPhotosManager` vía `onCoverChange` (una sola carga de imágenes en la ficha). Documentos
  solo se listan en su sección.

## 13. Datos de ejemplo
- Verificado: **0 fotos de inmueble** en el workspace de ejemplo (la captura de pantalla se retiró en
  P6.16). No queda ninguna foto rara; las cards muestran el placeholder elegante. **Sin nuevos
  cambios de datos** este ciclo.

## 14. Validaciones
- `npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅
  (`✓ Compiled successfully`; ruta `/opportunities/properties/[id]` compilada).
- Scans: sin probabilidad/pipeline/lead/expediente visibles; sin "Vendida / alquilada" combinado;
  "Captación" solo como **tipo de operación** (correcto), no como estado; service_role solo en
  comentario; **sin botón muerto** (ruta de ficha real); sin UUID visible; sin imagen rota.

## 15. Checklist QA (staging)
**Inmuebles**
- [ ] Activos muestra solo activos; Histórico solo vendidos/alquilados/archivados; Todos separa
      "Cartera activa" / "Histórico".
- [ ] Control Activos/Histórico/Todos visible; subcopy de sección coherente.
- [ ] Cards ordenadas; histórico apagado con sello "Histórico".
- [ ] Card clicable abre ficha; **"Ver ficha"** botón sólido visible; **Editar** (icono) funciona.
- [ ] Cambiar a vendido/alquilado/archivado **pide confirmación** y pasa a histórico; no borra nada.

**Ficha**
- [ ] **Sin hero gigante vacío** si no hay fotos (placeholder compacto + "Subir fotos").
- [ ] Con fotos: cabecera con portada acotada; galería premium en "Fotos del inmueble".
- [ ] Subir/portada/borrar fotos funciona; la portada de la cabecera y la card de cartera se
      actualizan sin F5.
- [ ] Documentos del inmueble: subir/abrir/borrar funciona.
- [ ] Operaciones y trámites vinculados se ven con su estado.
- [ ] Editar funciona; F5 en la ficha no rompe; "Volver a Cartera" funciona; responsive correcto.

## Veredicto
**P7.1 COMPLETADO — FICHA DE INMUEBLE PREMIUM FINAL.** Inmuebles queda claro y premium: estados
legibles ("En preparación"), activo/histórico inequívoco (sello + estilo + secciones), **"Ver ficha"
protagonista** con edición secundaria, y una **ficha 360 compacta** (sin hero vacío gigante) que
gestiona **fotos y documentos reales desde la propia ficha** (Storage/RLS/signed URLs, sin
service_role). `tsc`/`lint`/`build` en verde; sin migración; rendimiento intacto. Requiere redeploy.
