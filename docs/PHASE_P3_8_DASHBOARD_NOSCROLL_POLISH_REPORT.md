# FASE P3.8 — Dashboard no-scroll micro-polish + cierre

> **Fecha:** 2026-06-21 · HEAD previo `bb6ad3a`. Toca el dashboard + 1 línea del sidebar
> (copy) + 1 migración demo acotada (feed). **Sin** queries/deps nuevas, **sin** tocar otras
> páginas/RLS. Requiere redeploy.

---

## 1. Diagnóstico visual final
El dashboard ya gustaba pero dejaba un **mini scroll a 1440/100%**, la **fecha** salía con
mayúsculas raras ("Domingo, 21 De Junio") y el **feed de actividad** mostraba una entrada
basura de prueba ("Nuevo cliente creado: <test>") y una línea técnica ("Stage negotiation…").

## 2. Qué se compactó para reducir scroll (altura vertical)
- `space-y` entre bloques **4 → 3**.
- **Hero**: `py-3.5/sm:py-4` → `py-3/sm:py-3.5`.
- **KPI cards**: `p-4` → `px-4 py-3.5`, número `1.8rem`→`1.7rem`, spacings `mt` reducidos
  (mantienen impacto).
- **Cuerpo de las 5 cards**: `p-5` → **`p-4`** vía `bodyClassName` (sin tocar el componente
  compartido `SectionCard`).
- **Hoy**: items `p-3`→`p-2.5`, `space-y-2.5`→`space-y-2`.
- **Prioridades**: filas `py-2.5`→`py-2`, lista `space-y-1.5`→`space-y-1`.
- **Actividad reciente**: items `py-2`→`py-1.5` (máx 4, ya compacto).
- **Semana operativa (WeekRail)**: tiles `py-2`→`py-1.5`, `gap-1`→`gap-0.5`,
  `min-h-[26px]`→`min-h-[22px]` (mantiene interacción y totales).
- Sin `overflow-hidden` global; sin cortar contenido; móvil intacto.

## 3. Microcopy corregido
- **Fecha**: quitado `capitalize` (capitalizaba cada palabra) → ahora **"domingo, 21 de
  junio"** (es-ES natural).
- **Sidebar**: "Workspace activo" → **"Cuenta activa"** (coherente con el badge del
  dashboard; cambio de 1 string, seguro).
- (P3.7 ya dejó appName sin "Demo"; "Demo Inmobiliaria" del sidebar es el **nombre de la
  cuenta de ejemplo**, no del producto → se mantiene.)

## 4. Demo data — saneada (no solo filtrado)
Migración `20260621_p38_sanitize_demo_activity_feed.sql` (DEMO workspace only, **por id**,
idempotente, UPDATE/DELETE, sin auth.users ni otros workspaces; aplicada vía MCP):
- **Eliminadas** las 2 actividades de un cliente de prueba desechable (create + delete) que
  ensuciaban el feed.
- **Reescrita** una actividad técnica → "Operación en negociación · 390.000 €".
- Resultado: el feed reciente queda profesional en español. (Los "Cliente eliminado: …" ya se
  filtran en el dashboard.)

## 5. Qué NO se tocó
Clientes, Operaciones, Calendario, Asistente, Settings, onboarding, Auth, RLS, n8n, premium.
Solo `dashboard/page.tsx`, 1 línea de `Sidebar.tsx` (copy) y la migración del feed demo.

## 6. Freshness
Sin cambios de arquitectura: fetch en mount/navegación + **botón "Actualizar" silencioso**
(verificado, sigue funcionando) + sin refetch al foco + sin websockets. Honesto.

## 7. Validaciones
`tsc --noEmit` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Migración verificada.

## 8. Archivos tocados
- `src/app/(saas)/dashboard/page.tsx` (compactación + fecha).
- `src/components/Sidebar.tsx` (1 string: "Cuenta activa").
- NUEVO `supabase/migrations/20260621_p38_sanitize_demo_activity_feed.sql`.

## 9-10. Commit / push / redeploy
Ver hash `polish(dashboard): no-scroll compaction + date + demo feed cleanup`. Push a
`origin/main`. **Requiere redeploy** (la limpieza demo ya está en BD).

## 11. Screenshots a revisar
1. **Demo desktop 1440 / 100%** — ¿ya sin scroll (o mínimo)? cockpit completo.
2. **Hero** — fecha "domingo, 21 de junio" en minúsculas.
3. **Actividad reciente** — sin entradas basura ni texto técnico.
4. **Sidebar** — "Cuenta activa" (no "Workspace activo"); marca "CRM Inmobiliario".
5. **Móvil 390** — sin overflow horizontal.

## 12. Pendiente importante (requiere tu confirmación, NO tocado)
**Durante pruebas se borraron clientes del demo** (Familia Soler, Lucía Herrera, Javier
Ortega Ruiz — borrado *hard*, 0 soft-deleted). El demo quedó en **6 clientes / 7 operaciones
abiertas / 10 eventos / 9 tareas** (sigue siendo un demo válido, pero más pobre). **No los he
restaurado** (es dato y la regla es no tocar sin confirmación). Si quieres, en una micro-fase
aparte re-siembro esos clientes demo (con sus operaciones) para dejar el demo comercial
completo otra vez.

## Veredicto
**P3.8 COMPLETADO — DASHBOARD FINAL NO-SCROLL POLISH.** Altura reducida (space-y, hero, KPIs,
cuerpos de card y contenidos internos) para minimizar el mini-scroll a 1440 sin romper
estética ni móvil; fecha en español natural; sidebar "Cuenta activa"; feed demo saneado. Sin
deps/queries nuevas, solo dashboard + 1 copy de sidebar + migración demo. tsc/lint/build
verdes. **Requiere redeploy.** Dashboard **cerrado**; siguiente = Clientes. (Pendiente
opcional con confirmación: re-sembrar los clientes demo borrados en pruebas.)
