# FASE P19 — Cartera Pro usable + Asistente IA 360 en tiempo real

> **Fecha:** 2026-06-30 · Dos frentes: **(A)** Cartera/Inmuebles pasa a ser una pantalla de trabajo real
> (buscador + filtros por estado/operación/tipo/localidad + orden, contador y empty states); **(B)**
> Asistente 360 en tiempo real: la lectura del CRM es siempre fresca (route `force-dynamic`), el parser
> de fechas se extiende a `crm_read_query` (cualquier entidad con fecha) y el prompt refuerza
> cartera/relaciones/datos vivos. n8n: microparche de `crm_read_query` (autorizado).

## 1. Diagnóstico global

Cartera (`/opportunities` → Inmuebles) sólo tenía el toggle activos/histórico/todos: **sin buscador ni
filtros ni orden**. El asistente lee vía `/api/agent/tool` (15 tools n8n → handlers en
`agent-tool-readers.ts`); la P18 dejó pendiente el rango de fecha en `crm_read_query`.

## 2–3. Diagnóstico y problemas de Cartera

- No se podía filtrar por localidad/zona/estado/operación/tipo ni ordenar por precio/localidad.
- La card ya era rica (portada, specs, precio, ubicación, propietario, operaciones vinculadas, acciones)
  → el gap real era **encontrar/filtrar**, no el contenido de la card.

## 4. Mejoras de Cartera implementadas

Barra de **búsqueda + filtros + orden** dentro de la sección Inmuebles, client-side sobre los inmuebles
ya cargados (RLS, sin N+1):
- **Buscador** por título, localidad, zona, tipo, operación, estado, propietario/contacto, teléfono y
  notas (tolerante a acentos/mayúsculas, multi-término).
- **Filtros** por Estado, Operación, Tipo y Localidad (opciones derivadas de lo que existe en la
  cartera, con etiquetas humanas; la localidad solo aparece si hay más de una).
- **Orden**: más recientes (por defecto), precio ↓, precio ↑, localidad.
- **Contador** "X de Y" cuando hay filtros; **"Limpiar filtros"**; **empty state** específico de "ningún
  inmueble coincide".
- Lógica extraída a `src/lib/portfolio-filter.ts` (pura, testeable).

## 5. Filtros/búsqueda/ordenación

Implementados (ver §4). Se usan los **valores reales** de la cartera para las opciones (lo más útil
para filtrar lo que tienes). No se usa la palabra "Ciudad" (es "Localidad"); no hay "workspace" visible.
Filtros afectan listado, contador y empty state. (URL query params: no incluido → mejora futura.)

## 6. Detalle de inmueble

La ficha (`/opportunities/properties/[id]`) ya muestra ubicación (localidad/zona, P17), precio,
propietario, estado y vínculos. No se rediseña; el prompt del asistente refuerza dar detalle completo y
"No consta" si falta.

## 7. Acciones crear/editar/eliminar

Sin cambios estructurales: crear/editar/eliminar ya persisten y actualizan el estado local (optimista).
**Tiempo real → asistente:** la lectura del asistente es fresca (§15), así que un inmueble recién creado
aparece en la siguiente consulta.

## 8. Responsive / empty / error states

La barra de filtros es `flex-wrap` (compacta en móvil); skeleton de carga existente; empty states para
sin inmuebles, cartera cerrada y "sin resultados por filtro".

## 9–11. Asistente 360 — diagnóstico, tools, desalineaciones

Auditadas las 15 tools (nombre/schema/jsCode/handler/filtros/orden/campos). Hallazgo principal:
`crm_read_query` **no reenviaba el rango de fecha** (el backend sí lo soporta). El resto (clientes,
inmuebles, operaciones, trámites, tareas, comisiones, documentos, calendario tras P18) alineado, RLS por
cuenta, read-only.

## 12. Cambios backend/tools

- `crmReadQuery`: acepta `range` (palabra clave, Europe/Madrid vía `madridDateRange`) además de
  `dateRange.{from,to}` → date-bounded queries en cualquier entidad con fecha.
- (P18 ya enriqueció el detalle de calendario y `madridDateRange`.)

## 13. Cambios n8n

Microparche **`P19-crm-read-query-date-range.txt`** (nodo `crm_read_query`: inputSchema +range/from/to,
jsCode reenvía range y dateRange). Aplicado por REST con autorización; `=`/`{{ }}`/credenciales/
conexiones/memory/webhook/otros nodos intactos; active=true, 24 nodos.

## 14. Cambios prompt/fallback

`nowlabs-main-agent.ts` (fallback local): se amplía el bloque de fiabilidad con **CARTERA** (filtrar por
localidad/municipio y zona/barrio sin confundir barrio con localidad; detallar precio/estado/tipo/
operación/ubicación/propietario/teléfono/notas) y **RELACIONES** (resolver la referencia y consultar los
datos vinculados; si una relación trae solo un id, decir que el vínculo existe sin mostrar el id, en vez
de inventar). Generalizado, sin ejemplos.

## 15. Tiempo real / cache invalidation

`/api/agent/tool` marcado **`export const dynamic = 'force-dynamic'`**: la lectura del asistente nunca se
cachea (fuente de verdad = Supabase, bajo RLS). El historial enviado al agente ya está truncado (P13) y
no es fuente de verdad. La UI ya actualiza su estado tras crear/editar/eliminar. Resultado: tras una
mutación en la UI, la siguiente consulta del asistente ve los datos.

## 16–17. Detalle por entidad / relaciones

Las cols por entidad de `crm_read_query` y los handlers dedicados devuelven los campos relevantes
(calendario enriquecido en P18; clientes/operaciones/trámites/tareas con notas/estado/fechas). El prompt
exige "No consta" si falta y no inventar relaciones. (Joins de nombre para vínculos por id: mejora
futura documentada.)

## 18. Guardrails de acciones / cero humo

Sin cambios respecto a P12.7/P18: el Agent V2 es read-only; no afirma ejecución sin write tool real;
acciones no conectadas se dejan preparadas para la UI.

## 19. Evals

- `src/lib/__evals__/portfolio-filter.evals.ts` (**NUEVO**, `runPortfolioFilterEvals()`): 14 casos de
  filtro (localidad/estado/operación/tipo/búsqueda por texto/teléfono/propietario/combinación) + orden
  por precio. **Verificado 14/14** con script desechable.
- `assistant-coherence.evals.ts` +4 fixtures P19: inmuebles por localidad (Bilbao), por zona (Deusto,
  no confundir con localidad), detalle completo, inmueble recién creado (tiempo real).

## 20. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅. Scans: sin
service_role frontend · sin "workspace"/"lead"/"pipeline"/"oportunidad"/"expediente"/"completed"/
"Copiloto" visibles en Cartera · sin UUID/JSON técnicos en la card · sin acciones fake · sin keys
expuestas.

## 21. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/app/(saas)/opportunities/page.tsx` | Cartera: buscador + filtros + orden + contador + empty; derivaciones memoizadas |
| `src/lib/portfolio-filter.ts` | **NUEVO** filtro/orden de cartera (puro, testeable) |
| `src/lib/agent-tool-readers.ts` | `crm_read_query` acepta `range` keyword (date-bounded en cualquier entidad) |
| `src/app/api/agent/tool/route.ts` | `dynamic = 'force-dynamic'` (lectura siempre fresca) |
| `src/lib/agents/nowlabs-main-agent.ts` | microparche CARTERA + RELACIONES (fallback local) |
| `src/lib/__evals__/portfolio-filter.evals.ts` | **NUEVO** evals de filtro |
| `src/lib/agents/__evals__/assistant-coherence.evals.ts` | +4 fixtures de cartera/tiempo real |
| `n8n/patches/P19-crm-read-query-date-range.txt` | **NUEVO** microparche tool |

## 22–23. Commit / Push

Commit `feat(portfolio+assistant): Cartera Pro con filtros + lectura 360 en tiempo real (P19)` →
`origin/main`.

## 24. Deploy

- **Frontend/backend:** redeploy (filtros de Cartera + lectura fresca + `range` en crm_read_query).
- **n8n:** aplicado el microparche de `crm_read_query` (range/from/to).

## 25. Checklist staging

- [ ] Cartera: buscar por contacto/teléfono; filtrar por localidad/zona/estado/operación/tipo; ordenar
      por precio; "Limpiar filtros"; contador "X de Y"; empty "sin resultados".
- [ ] Crear inmueble → aparece sin recargar; editar → se refleja; eliminar con confirmación.
- [ ] Móvil: barra de filtros usable, sin desbordes.
- [ ] Asistente: "inmuebles en Bilbao" (localidad) vs "en Deusto" (zona) — no confunde.
- [ ] Asistente: detalle de inmueble con propietario/teléfono/notas; "No consta" si falta.
- [ ] Asistente: inmueble/cita recién creados → aparecen en la siguiente consulta (tiempo real).
- [ ] Asistente: "tareas que vencen esta semana" → usa rango de fecha.

## 26. Pendientes honestos

- **detailLevel/expand** en `crm_read_query` (resumen/detalle/full + joins de nombre por relación):
  mejora futura; hoy se devuelven cols por entidad + ids (sin UUID visible al usuario).
- **URL query params** en los filtros de Cartera (deep-link/refresh): mejora futura.
- **Avatar/logo** (P17) sigue pendiente.

## 27. Veredicto

**P19 COMPLETADO — CARTERA PRO USABLE Y ASISTENTE IA 360 EN TIEMPO REAL SOBRE TODO EL CRM.** Cartera se
busca/filtra/ordena en segundos con datos reales; el asistente lee el CRM siempre fresco (sin caché),
con rango de fecha en cualquier entidad y reglas reforzadas de detalle/relaciones/cero humo.
`tsc`/`lint`/`build` en verde; filtro de cartera verificado 14/14.
