# FASE P3.4 — Dashboard Cockpit sin scroll + gráficos útiles + limpieza demo crítica

> **Fecha:** 2026-06-21 · HEAD previo `a275011`. Toca SOLO el dashboard + 2 helpers
> (text-safety, charts retirados) + 1 migración demo acotada. **Sin** queries nuevas, **sin**
> dependencias nuevas, **sin** tocar otras páginas/RLS/n8n/asistente. Requiere redeploy.

---

## 1. Diagnóstico de screenshots
- El dashboard requería **scroll**; los gráficos ocupaban una fila enorme y aportaban poco.
- El "Pipeline por columnas" y el "Próximos 7 días" se veían vacíos/decorativos.
- Las listas "Próximas citas", "Clientes recientes" y "Actividad reciente" empujaban scroll.
- **GRAVE:** una actividad/evento de demo contenía **texto vulgar/inapropiado** + un cliente
  de prueba sin sentido comercial, tecleado durante pruebas.

## 2. Qué se cambió para eliminar scroll
- **Cockpit de una pantalla**: hero compacto + KPI strip + **un grid principal de 3 columnas**
  (Hoy · Estado comercial · Prioridades) + **una banda inferior compacta** (Semana operativa ·
  Actividad). Se **eliminaron** las listas largas "Próximas citas" y "Clientes recientes".
- Densidad: `space-y-5→4`, hero `p-5/6 → px-4 py-3.5` (fecha inline en el subtítulo), KPIs
  `gap-4→3` y `p-5→p-4` (número `text-2xl`, icono 36px), Hoy/Prioridades/Actividad compactas.
- Actividad reciente: **máx 3** (antes 5), líneas truncadas a 1.

## 3. Qué gráficos se sustituyeron
- Se **retiró `MiniColumns`** (columnas verticales de P3.3) → eliminado el archivo.
- **Gráfico 1 — Pipeline** → `PipelineFunnel`: filas compactas por etapa con barra
  proporcional + **recuento + valor compacto (€150k)**; footer con total ops y € pipeline.
- **Gráfico 2 — Semana** → `WeekRail`: **7 tiles tipo mini-calendario** (Hoy, Lun…) con día y
  recuento de citas (azul) y tareas (ámbar) por dots. No usa barras altas → no queda vacío/feo
  cuando hay poco.

## 4. Nuevo diseño de pipeline
`PipelineFunnel` (componente local): por cada etapa (Nuevo→Negociación) una fila con
`etiqueta · barra proporcional · count · €valor compacto`. En 5s se ve dónde están las
operaciones y cuánto valor hay. Empty state si no hay operaciones abiertas.

## 5. Nuevo diseño semana/agenda
`WeekRail`: grid de 7 tiles compactos; hoy resaltado; días sin nada atenuados con un punto.
Empty state "Semana despejada" si no hay nada en 7 días. Leyenda discreta Citas/Tareas.

## 6. Qué listas se compactaron / quitaron
- **Quitadas**: "Próximas citas" (cubierta por Hoy + Semana operativa + KPI) y "Clientes
  recientes" (a un clic en Clientes). Se eliminó el estado `hotLeads` asociado.
- **Compactada**: "Actividad reciente" a máx 3, truncada, en la banda inferior.

## 7. Limpieza demo crítica
Auditadas activities/calendar_events/tasks/opportunities/service_cases/clients del workspace
demo. **2 registros** con texto inaceptable (un evento + su actividad). Saneados a copy
comercial ("Visita a vivienda" / "Visita comercial programada" / "Nueva cita programada"),
y el cliente de prueba → null. **Verificado tras aplicar: 0 tokens inapropiados en el workspace.**

## 8. Migración SQL
`20260621_p34_sanitize_demo_inappropriate_text.sql` — DEMO workspace ONLY, **targeted por
id** (sin reproducir el texto vulgar en el repo), **UPDATE** (no delete), **idempotente**.
Aplicada vía MCP y guardada en el repo. No toca auth.users ni otros workspaces.

## 9. Filtros defensivos añadidos
`src/lib/text-safety.ts` → `containsBlockedText()` (regex de profanidad acotada, con límite de
palabra). Aplicado en el dashboard (demo + real) a: feed de actividad y eventos próximos. Si
un texto contiene contenido bloqueado, **no se pinta** (red de seguridad además del saneado).

## 10. Workspace vacío
Intacto: hero + KPIs a 0 + **onboarding 4 pasos**, sin charts ni cards vacías. La banda de
cockpit y la inferior solo se renderizan con datos (`stats && !isEmpty`).

## 11. Demo
Cockpit completo con datos ficticios y **sin texto vulgar**: pipeline funnel con valores,
week rail con citas/tareas, Hoy con próxima cita/tarea/operación, prioridades, actividad ≤3.

## 12. Responsive
- Desktop ≥1280: cockpit en una pantalla (3 col + banda inferior), scroll mínimo o nulo.
- Tablet/`lg`: grid intermedio (2 col arriba, banda inferior 2 col).
- Móvil 390: apila; KPIs 2 col; WeekRail 7 tiles caben (sin overflow); funnel filas legibles.

## 13. Validaciones
`tsc --noEmit` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Migración verificada antes/después.

## 14. Archivos tocados
- `src/app/(saas)/dashboard/page.tsx` (cockpit + funnel/rail locales + filtros).
- NUEVO `src/lib/text-safety.ts`.
- ELIMINADO `src/components/charts/MiniColumns.tsx`.
- NUEVO `supabase/migrations/20260621_p34_sanitize_demo_inappropriate_text.sql`.

## 15-16. Commit / push
Ver hash del commit `polish(dashboard): cockpit no-scroll + funnel/week rail + demo cleanup`.
Push a `origin/main`.

## 17. Redeploy
**Sí** (cambió `src/`). La limpieza demo ya está aplicada en BD (no requiere deploy).

## 18. Screenshots a revisar
1. **Demo desktop ≥1440** — ¿cabe sin scroll? cockpit 3 col + banda inferior.
2. **Demo desktop 1280** — sin scroll o mínimo.
3. **Demo móvil 390** — apila, WeekRail sin overflow, funnel legible.
4. **Workspace vacío** — onboarding, sin charts.
5. **Actividad reciente** — sin ningún texto raro/vulgar.

## 19. Veredicto
**P3.4 COMPLETADO — DASHBOARD COCKPIT NO-SCROLL + CLEAN DEMO DATA.** Dashboard convertido en
cockpit compacto de una pantalla (3-col + banda inferior), pipeline funnel + week rail útiles
y compactos, listas largas retiradas/compactadas, demo **saneada** (0 texto inapropiado) +
filtro defensivo permanente. Datos 100% reales, sin deps/queries nuevas, solo dashboard.
tsc/lint/build verdes. **Requiere redeploy** (la limpieza demo ya está en BD).
