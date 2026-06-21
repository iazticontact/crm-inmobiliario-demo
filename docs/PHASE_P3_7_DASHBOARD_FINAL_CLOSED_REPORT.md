# FASE P3.7 — Dashboard final: claridad comercial, interacción, freshness, no-demo

> **Fecha:** 2026-06-21 · HEAD previo `c090b2e`. Toca el dashboard + `src/lib/brand.ts`
> (nombre de producto). **Sin** queries nuevas, **sin** dependencias nuevas, **sin** tocar
> otras páginas/datos/RLS. Requiere redeploy.

---

## 1. Diagnóstico final
El dashboard ya gustaba, pero: (a) "oportunidades" no se entendía y el valor podía leerse como
facturación; (b) el bloque comercial no era interactivo ni "clicable"; (c) la app se llamaba
"CRM Inmobiliario **Demo**" (sonaba a maqueta); (d) dudas sobre si los datos se refrescan.

## 2. Naming "oportunidades/operaciones"
El sidebar etiqueta `/opportunities` como **"Operaciones"** → por coherencia, el dashboard pasa
TODO a **"Operaciones"**: KPI "Operaciones abiertas", bloque "Resumen comercial" (header +
filas "Operaciones abiertas"), prioridad, Hoy "Operación a revisar", onboarding, empty states.
Microcopy del bloque: **"Operaciones comerciales en seguimiento · valor potencial"**.

## 3. Resumen comercial (cambios)
- Header: **total de operaciones abiertas** + **valor potencial en cartera**.
- Caption fija que mata la confusión: **"Valor potencial estimado si se cierran · no es
  facturación."**
- Barras proporcionales al **valor** (cuando hay), con **count siempre visible** + € por etapa.
- El importe **nunca** se llama facturación/ingresos/cobros/beneficio (regla cumplida en KPI,
  bloque y caption: solo "valor potencial / en cartera").

## 4. Interacción hover/click
- **Cada fila de etapa es clicable → `/opportunities`** (sin filtro de etapa inventado: la
  página no soporta `?stage=`, así que enlazamos limpio).
- **Hover**: la fila se resalta (`hover:bg-gray-50`) + **tooltip** con el microdetalle:
  *etapa · nº operaciones · valor potencial · % de la cartera*.

## 5. Semana operativa (cambios)
Ya mejorada en P3.6 y reforzada: tiles **clicables → `/calendar`**, hover con elevación,
**acento superior** en días con actividad, **resalta hoy y el siguiente día con actividad**,
citas (azul) / tareas (ámbar) separadas, y **footer con totales reales de la semana**
("X citas · Y tareas").

## 6. Branding / demo
- **`BRAND.appName`: "CRM Inmobiliario Demo" → "CRM Inmobiliario"** (sidebar/login/topbar dejan
  de decir "Demo").
- **`BRAND.appDescription`** ("Prototipo funcional…") → "CRM para inmobiliarias: clientes,
  operaciones, agenda y copiloto IA".
- Badge del dashboard: en demo "Cuenta de ejemplo" (discreto, correcto); en real "Cuenta
  activa". `BRAND.workspaceName` ("Demo Inmobiliaria") se deja: es el **fallback del workspace
  demo**, no el nombre del producto, y en cliente real se muestra el nombre real de su workspace.

## 7. Freshness / "tiempo real" (auditoría + implementación)
**Auditoría:** el dashboard es client component y **hace las queries en `useEffect`**, que se
re-ejecuta en **cada montaje/navegación** → al volver tras crear/editar/borrar en otra página,
el dashboard remonta y **carga datos frescos**; F5 también. No hay cache cliente del dashboard.
NO se hace refetch al foco de ventana **a propósito** (eso causó el lag combatido en S6/S7).
**Implementado (seguro y pequeño):** botón discreto **"Actualizar"** en el hero que dispara un
**refresco SILENCIOSO** (`reloadKey` → re-ejecuta el efecto sin volver a mostrar el esqueleto;
spinner en el icono; conserva los datos visibles hasta llegar los nuevos). **Honesto:** no hay
websockets/live updates; "fresh on load/navigation + refresco manual" — el live total por
Supabase Realtime queda como mejora futura.

## 8. Datos de cada bloque (sin inventar)
- **KPIs / Resumen comercial (operaciones por etapa + valor potencial)** ← `pipeline` y
  `stats.pipelineValue` (operaciones abiertas reales del `Promise.all`).
- **Semana operativa** ← `weekActivity` (events + tasks ya cargados).
- **Hoy / Prioridades / Actividad** ← mismos `stats`/listas. **Cero queries nuevas.**

## 9. Qué NO se tocó
Clientes, Operaciones, Calendario, Asistente, Settings, onboarding, RLS, migraciones, n8n,
módulos premium. Empty/onboarding intacto. `BRAND.workspaceName` sin cambiar.

## 10. Validaciones
`tsc --noEmit` ✅ · `lint --max-warnings=0` ✅ · `build` ✅.

## 11. Archivos tocados
- `src/app/(saas)/dashboard/page.tsx` (naming, funnel interactivo, freshness, copy).
- `src/lib/brand.ts` (appName/appDescription sin "Demo"/"Prototipo").

## 12-13. Commit / push
Ver hash `polish(dashboard): operaciones naming + interactive funnel + freshness + brand`.
Push a `origin/main`.

## 14. Redeploy
**Sí** (cambió `src/`). El cambio de `BRAND.appName` se ve en sidebar/login/topbar tras deploy.

## 15. Screenshots a revisar
1. **Demo desktop 1440** — sin scroll; "Resumen comercial" con header + caption "no es
   facturación" + filas por etapa; sidebar sin "Demo".
2. **Hover en una etapa** — resalte + tooltip (nº, valor, % cartera); clic → Operaciones.
3. **Semana** — hoy y próximo día resaltados; clic → Calendario.
4. **Botón "Actualizar"** — icono gira, datos se refrescan sin parpadeo de esqueleto.
5. **Móvil 390** — sin overflow. **Workspace vacío** — onboarding.

## 16. Veredicto
**P3.7 COMPLETADO — DASHBOARD FINAL CLOSED.** Naming coherente con el sidebar ("Operaciones"),
bloque comercial claro e interactivo (hover+tooltip+clic, "valor potencial, no facturación"),
semana operativa interactiva, marca sin "Demo", y freshness honesto (fresco en cada
navegación + botón "Actualizar" silencioso; sin refetch al foco). Datos 100% reales, sin
deps/queries nuevas. tsc/lint/build verdes. **Requiere redeploy.** Listo para pasar a Clientes.
