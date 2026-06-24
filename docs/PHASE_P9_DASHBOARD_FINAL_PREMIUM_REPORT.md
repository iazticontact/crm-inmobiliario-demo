# FASE P9 — Dashboard final premium conectado a todo el CRM

> **Fecha:** 2026-06-24 · Centro de mando real: KPIs operativos, cartera, comisiones y vencimientos
> derivados de los datos ya cargados (sin re-fetch). **Sin migración.** Requiere redeploy.

## 1. Diagnóstico
El Dashboard ya cargaba datos reales con `Promise.all` (clients, invoices, events, conversations,
activities, opportunities, cases, properties, tasks) — **arquitectura sólida, sin N+1**. Pero:
- KPIs genéricos (Clientes, Operaciones, **Tareas pendientes**, **Próximas citas**) — no reflejaban
  Cartera ni Comisiones.
- Faltaban bloques de **Cartera** (inmuebles por estado), **Comisiones** y **Vencimientos críticos**.
- "Prioridades" mostraba conteos que ahora son KPIs (redundante).
- Las cifras de los datos cargados se **descartaban** tras calcular `stats` (no reutilizadas).

## 2. Qué estaba flojo
Sin visión de cartera/comisiones/vencimientos en la home; KPIs poco inmobiliarios; bloque
"Prioridades" redundante. El resto (hero, embudo, semana operativa, "Hoy", actividad, onboarding) ya
era premium y se conserva.

## 3. Snapshot consolidado
Nuevo **`src/lib/dashboard-snapshot.ts`** → `buildDashboardSnapshot(input)` **puro** (sin fetch),
que deriva todo reutilizando los helpers ya existentes (`commStateOf`, `isClosedPropertyStatus`,
`isRentalProperty`; comisión = espejo de `commissionOf` de Cartera):
- **cartera**: activos, histórico, publicados, reservados, en preparación, valor de cartera activa.
- **opsByState**: operaciones por estado comercial (Nueva/En gestión/Reserva/Vendida·Alquilada/Perdida).
- **commissions**: prevista · pendiente · cobrada · nº cerradas con comisión (control interno).
- **deadlines**: trámites + tareas abiertos con vencimiento ≤14 días o vencidos, con enlace a inmueble
  o cliente.
- **todayEvents**: citas de hoy (no canceladas).

La página mantiene su carga (`Promise.all`, demo/real, errores, refresco) y guarda los **datos crudos
en un solo estado `raw`**; el snapshot se computa con **`useMemo`** (sin queries nuevas, sin N+1).

## 4. KPIs finales (6)
**Clientes activos · Inmuebles activos · Operaciones abiertas · Citas de hoy · Trámites urgentes ·
Comisiones pendientes.** Sin "pipeline/lead/probabilidad/expediente". Sin facturación/ingresos
inventados (la única cifra € de comisiones se etiqueta como control interno).

## 5. Bloques del Dashboard
- **A. Hero** "Hoy en tu inmobiliaria" (saludo + fecha + CTAs: Actualizar · Copiloto · Calendario ·
  Nuevo cliente). *(Existente, se conserva.)*
- **B. KPIs** (6, arriba).
- **C. Resumen comercial** (embudo por estado) · **Semana operativa** (citas+tareas, próximos 7 días).
  *(Existentes.)*
- **D. Cartera inmobiliaria** *(NUEVO)*: barras por estado (Publicado/Reservado/En preparación) +
  "{N} activos · {M} en histórico" + valor de cartera activa. Link a Inmuebles.
- **E. Comisiones** *(NUEVO)*: Prevista / Pendiente / Cobrada + "{N} operaciones cerradas con
  comisión" + nota del módulo económico. Link a Comisiones.
- **F. Hoy** (próxima cita · tarea urgente · operación a revisar). *(Existente.)*
- **G. Vencimientos críticos** *(NUEVO, sustituye "Prioridades")*: trámites/tareas por vencer o
  vencidos (máx. 5 + "y N más"), con enlace a inmueble/cliente; badge "{N} vencidos".
- **H. Actividad reciente** *(Existente.)*
- **Workspace vacío**: onboarding premium (1. cliente · 2. operación · 3. cita · 4. copiloto).

## 6. Gráficos
Ligeros, sin dependencias: **embudo** de operaciones (existente), **barras de cartera por estado**
(nuevas, divs+Tailwind), **rail de 7 días** (existente). Todos con empty state elegante si no hay
datos.

## 7. Workspace vacío
`isEmpty` (sin clientes/operaciones/inmuebles/citas) → tarjeta de onboarding con CTAs; **sin** KPIs
de ceros sin contexto, sin gráficos vacíos feos, sin demo data.

## 8. Ejemplo / showcase (verificado MCP)
Coherente con Cartera/Calendario: **3 inmuebles activos · 4 histórico** (2 publicados), **5
operaciones abiertas · 3 cerradas con comisión** (1 cobrada), **2 citas hoy**, **2 trámites por
vencer**. Sin seed nuevo (los datos de P6–P8 ya están vivos).

## 9. Rendimiento
**0 queries nuevas**: el snapshot deriva de los datos ya cargados (`Promise.all` existente). Mapas por
id + cálculos en `useMemo`. Sin signed URLs, sin Storage, sin imágenes, sin dependencias pesadas.
Refresco manual silencioso (existente) intacto.

## 10. Seguridad
RLS · workspace-scoped (helpers existentes) · **sin service_role en frontend** · **sin UUID visible**
(todo se muestra con nombres) · sin PII en docs · sin tocar otros workspaces.

## 11. Qué NO se tocó
n8n · Asistente/Agent V2 · Google Calendar · Auth · Storage/RLS · secretos · facturación real ·
Cartera/Inmuebles/Clientes/Calendario (solo se **importan** helpers/lecturas existentes). Lógica de
comisiones de Cartera intacta (el snapshot reimplementa la fórmula en local, documentado, para no
tocar el módulo cerrado).

## 12. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅. Scans: Demo=0 ·
pipeline/expediente/probabilidad=0 visible · "lead" solo interno (estado de cliente, no copy) ·
service_role=0 · UUID visible=0 · **mock en modo real=0** (los `demo*` solo dentro del branch demo) ·
botón muerto=0.

## 13. Checklist de staging
- [ ] **Workspace ejemplo:** 6 KPIs con cifras coherentes con Cartera/Calendario; Cartera (3 activos /
      4 histórico, 2 publicados); Comisiones (prevista/pendiente/cobrada, 3 cerradas); Vencimientos (2
      trámites + tareas) con enlaces; Citas de hoy (2).
- [ ] Links KPIs/bloques → Clientes / Cartera / Calendario funcionan.
- [ ] Vencimientos: "vencido" en rojo, "vence hoy/mañana/en N días"; "y N más" si >5.
- [ ] **Workspace vacío real:** onboarding premium, sin ceros sin contexto, sin gráficos vacíos.
- [ ] **Móvil 390:** KPIs 2 columnas, bandas apiladas, sin scroll horizontal, gráficos compactos.
- [ ] Carga rápida; "Actualizar" refresca sin parpadeo; sin datos inventados.

## 14. Pendientes honestos
- El embudo "Resumen comercial" solo muestra estados **abiertos** (Nueva/En gestión/Reserva); las
  cerradas viven en el bloque Comisiones — coherente, no es un fallo.
- `opsByState` se calcula en el snapshot y hoy alimenta indirectamente (KPIs/embudo); si se quiere un
  mini-gráfico dedicado de operaciones por estado (incluyendo cerradas/perdidas), es una mejora
  futura de bajo riesgo.

## Veredicto
**P9 COMPLETADO — DASHBOARD FINAL PREMIUM.** El Dashboard resume **Clientes + Cartera + Calendario +
Trámites + Comisiones** en un centro de mando real: 6 KPIs operativos, bloques de Cartera, Comisiones
y Vencimientos críticos conectados con enlaces a las fichas, sobre un snapshot derivado **sin queries
nuevas ni N+1**. Workspace vacío premium, showcase coherente, sin humo financiero. Sin tocar
Google/n8n/Asistente/RLS ni módulos cerrados. `tsc`/`lint`/`build` en verde. Requiere redeploy.
