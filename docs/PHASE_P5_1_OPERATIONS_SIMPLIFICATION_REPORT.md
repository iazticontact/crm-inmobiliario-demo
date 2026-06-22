# FASE P5.1 — Operaciones simple, rentable y multi-vertical (sin ruido)

> **Fecha:** 2026-06-23 · HEAD previo `a0a3d5d`. Solo `/opportunities` + docs. **Sin** migraciones,
> sin tocar otros módulos. Requiere redeploy.

## 1. Diagnóstico (tras screenshots)
El módulo seguía mostrando el **selector de verticales** (Todos / Inmobiliaria / Extranjería /
Servicios) a una inmobiliaria que **solo usa inmobiliaria** → "Extranjería"/"Servicios"
confundían y, al pulsarlos, aparecían **Propiedades vacías** y KPIs en 0 sin contexto. Además se
detectó un **bug de fondo**: con el filtro "Todos" el pipeline usaba etapas *genéricas*, así que
las operaciones en etapas inmobiliarias (visita, oferta, negociación) **no se mostraban** (5 de 8
en el entorno de ejemplo quedaban ocultas).

## 2. Decisión sobre verticales (data-driven, sin config nueva)
El selector de verticales **solo aparece si el workspace tiene datos en más de una vertical**
(workspace mixto). Se deriva de los propios datos (`opportunities`/`service_cases`/`properties`):
- Inmobiliaria normal / entorno de ejemplo Costa Azul / workspace vacío → **una sola vertical
  (real_estate)** → **no se muestra la barra de verticales**. UI mínima y clara.
- Workspace mixto → barra visible con **solo las verticales presentes** (sin "Extranjería"/
  "Servicios" si no hay datos de ellas), con etiqueta "Área de negocio:".

## 3. Extranjería
**Oculta** en el pack básico (no hay datos de extranjería → no aparece). Si un workspace tuviera
trámites de extranjería, el filtro aparecería con tooltip "Trámites y gestiones de extranjería" y,
al seleccionarlo, **se oculta Propiedades** (no aplica) y el 4º KPI pasa a **"Vencen pronto"**.

## 4. Servicios
Igual que Extranjería: **oculto** salvo que existan datos de esa vertical.

## 5. Plantillas
Sigue **oculta al cliente** (solo `NEXT_PUBLIC_NOWLABS_INTERNAL`), junto a Automatizaciones. Sin
cambios respecto a P5 (no se reintroduce).

## 6. Operaciones (vista)
- **Bug corregido**: el pipeline ya no usa etapas genéricas en "Todos". Se elige la vertical
  dominante (inmobiliaria por defecto) y, además, se **añaden las etapas presentes en los datos**
  que no estén en el pipeline canónico → **ninguna operación queda oculta**.
- Se mantiene lo de P5 (agrupación por etapa, cliente por fila, valor por etapa, "Cierre pronto").

## 7. Trámites (vista)
Sin cambios de fondo (P5): "Trámites", cliente + tipo + prioridad + vencimiento, empty state
claro. Añadido botón **"Ver todos"** en el empty state cuando hay un filtro de vertical activo.

## 8. Propiedades / Inmuebles
Se mantiene **"Propiedades"** (coherencia con la ficha de cliente, que dice "Propiedades
vinculadas"). Renombrar a "Inmuebles" se deja como **cambio global futuro** (ficha + operaciones a
la vez) para no crear inconsistencia entre módulos. La pestaña/KPI de Propiedades **se oculta** en
verticales sin inmuebles. Empty state claro.

## 9. KPIs (adaptativos)
- Inmobiliaria/Todos: **Operaciones abiertas · Valor potencial · Trámites abiertos · Propiedades
  en cartera**.
- Vertical sin inmuebles (p. ej. Extranjería): el 4º KPI pasa a **"Vencen pronto"** (trámites que
  vencen en 7 días) en vez de "0 propiedades". Sin KPIs irrelevantes en 0.

## 10. Empty states
- Filtro sin datos → "No hay operaciones/trámites en este filtro. Vuelve a «Todos» o crea…" +
  botón **"Ver todos/as"** (resetea a Todos).
- Workspace vacío → "Todavía no hay operaciones" + "Nueva operación" + "Crear cliente".

## 11. Header / acciones
- Subtítulo más simple: **"Gestiona los negocios abiertos, sus trámites y los inmuebles
  asociados."** (sin "Pipeline").
- Jerarquía de botones: **"Nueva operación"** (primario) · "Nuevo trámite" · "Nueva propiedad"
  (solo si aplica la vertical) · **"Refrescar" = icono discreto** (ghost, sin texto).

## 12. Responsive
Barra de verticales y subtabs con `flex-wrap`. KPIs `sm:grid-cols-2 lg:grid-cols-4`. Botones del
header envuelven en móvil. Badge "Cierre pronto" oculto en móvil.

## 13. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅.
Sin "Pipeline comercial"/"Expediente"/service_case/UUID/lead_score/PII visibles.

## 14. Archivos
- `src/app/(saas)/opportunities/page.tsx` (verticales data-driven; pipeline dominante + etapas
  presentes; KPI adaptativo; header; empty states; subtabs contextuales).
- Docs: este report.

## 15. Pendiente (futuro)
- Config explícita de verticales por workspace (`workspace_settings.vertical = mixed`) si se quiere
  forzar la barra sin datos.
- Rename global "Propiedades" → "Inmuebles" (ficha de cliente + operaciones juntas).
- KPIs 100% bespoke por vertical (Clientes vinculados, Gestiones en revisión…) si crece el uso
  multi-vertical.
- Kanban arrastrable.

## 16. Redeploy
**Requiere redeploy** (solo UI; sin migración).

## Veredicto
**P5.1 COMPLETADO — OPERACIONES SIMPLE Y MULTI-VERTICAL.** Una inmobiliaria normal ve una UI
mínima (sin verticales, sin Extranjería/Servicios, sin Propiedades vacías), y el módulo sigue
preparado para workspaces mixtos sin ensuciar la experiencia básica. Además se corrigió el bug
que ocultaba operaciones en etapas inmobiliarias con el filtro "Todos". tsc/lint/build verdes.
**Requiere redeploy** + ojo humano sobre staging.
