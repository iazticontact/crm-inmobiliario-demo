# FASE P28B — Mobile Responsive Lockdown

> **Fecha:** 2026-07-01 · Fix bloqueante detectado en la QA visual: en móvil el **sidebar desktop
> permanecía fijo (256px) y aplastaba el contenido**. Corregido de forma **global** en el app shell:
> desktop mantiene el sidebar fijo; móvil/tablet lo convierte en **drawer deslizable** y el contenido ocupa
> el 100% del ancho. Sin features nuevas, sin tocar n8n/Supabase/lógica de negocio.

---

## 1. Diagnóstico
El shell (`src/app/(saas)/layout.tsx`) era un `flex` con `<Sidebar/>` = `<aside className="w-64 shrink-0">`
**siempre renderizado** y `<main>` a su derecha. **No había ningún tratamiento móvil** (ni breakpoint, ni
drawer, ni botón menú). Resultado en <1024px: 256px de sidebar fijo + contenido aplastado.

## 2. Causa del fallo móvil
El `<aside>` no estaba gateado por breakpoint (`w-64 shrink-0` en todos los anchos) y el `<main>` compartía
fila flex sin recuperar el ancho en móvil. No existía navegación móvil alternativa.

## 3. Cambios en AppShell/layout
- **Nuevo `src/components/AppShell.tsx`** (client): orquesta el estado del drawer y renderiza:
  - **Desktop (`lg+`):** `<div className="hidden h-full lg:flex"><Sidebar/></div>` → sidebar fijo, igual que antes.
  - **Móvil/tablet (`<lg`):** drawer `fixed inset-0 z-50 lg:hidden` con overlay oscuro + panel deslizable
    (`w-64 max-w-[84%]`, `translate-x` con transición). `role="dialog"`, `aria-modal`.
  - **Main a 100% de ancho:** `flex min-w-0 flex-1 ... overflow-x-hidden`, padding responsive `p-4 sm:p-5 xl:p-6`.
  - Contenedor raíz `h-[100dvh]` (viewport móvil real) `overflow-hidden`.
  - Cierre del drawer: **al navegar** (cambio de ruta), **Escape**, **click en overlay** y **botón X**.
- **`layout.tsx`** simplificado a `<AppShell>{children}</AppShell>` (dentro de AuthGate + WorkspaceIdentityProvider).

## 4. Sidebar / navegación móvil
- `Sidebar` acepta `onClose?` opcional → en el drawer muestra un botón **X** (cerrar) en la cabecera de marca
  (`lg:hidden`). En desktop no se pasa `onClose`, así que no cambia nada.
- El mismo componente `Sidebar` (navegación + tarjeta de cuenta/logo) se usa en desktop y en el drawer: **una
  sola fuente de navegación**, sin duplicar menús rotos.

## 5. Topbar móvil
- Nuevo prop `onMenuClick?` + **botón hamburguesa** (`Menu`, `lg:hidden`) a la izquierda del título.
- Padding responsive `px-4 sm:px-6`; título con `truncate`; **descripción oculta en móvil** (`hidden sm:block`)
  para no comer ancho. El buscador global ya estaba `hidden md:block` (se oculta en móvil).

## 6–11. Módulos base en móvil (auditados)
- **Dashboard:** grids ya responsive (`grid-cols-2 md:grid-cols-3 xl:grid-cols-6`, `grid-cols-2 sm:grid-cols-4`,
  `lg:grid-cols-3`). Una columna en móvil. ✓
- **Clientes:** la tabla es `hidden overflow-x-auto md:block` → en móvil usa **cards** (no tabla ancha). Stats
  `grid-cols-2 sm:grid-cols-4`. ✓
- **Cartera/Inmuebles:** tabs con `overflow-x-auto` (scroll horizontal limpio, scrollbar oculta); cards
  `sm:grid-cols-2 lg:grid-cols-4` (1 col en móvil); fila de filtros `flex flex-wrap` (los `min-w-[180px]`
  **envuelven**, no desbordan). ✓
- **Calendario:** la vista **Semana** son 7 columnas (apretadas en móvil). **Fix:** por defecto arranca en
  **Agenda** (lista legible) en `<lg` (una vez, al montar); el usuario puede cambiar a Semana. El toggle
  Semana/Agenda ya existía. ✓
- **Asistente:** paneles `lg:grid-cols-3` colapsan a 1 col en móvil; el shell le da ancho completo. Usable.
  Refinamiento futuro documentado (§Pendientes).
- **Configuración:** grids `md:grid-cols-2 xl:grid-cols-4` → 1 col en móvil; inputs full-width. ✓

## 12. Formularios / drawers / modales
Los drawers/modales existentes (crear/editar cliente, inmueble, cita, etc.) se abren dentro del shell ya
corregido (100% de ancho, sin sidebar fijo detrás). No se rediseñaron a bottom-sheet en esta fase (no era el
bloqueante); quedan usables. Refinamiento a bottom-sheet documentado como mejora futura no crítica.

## 13. Scans responsive
- `w-screen`: **0** en páginas base.
- `min-w-[…]`: solo en contenedores `flex-wrap` (envuelven) o tabs con `overflow-x-auto` (scroll contenido) →
  no desbordan el viewport.
- Tablas anchas: envueltas en `overflow-x-auto` o `hidden md:block` con cards móviles.
- `main` con `overflow-x-hidden` como red de seguridad anti-scroll-horizontal.

## 14. QA checklist móvil (manual, para validadores)
Probar a 320 / 375 / 390 / 414 / 768 px:
1. Dashboard: sin sidebar fijo, contenido a ancho completo, sin scroll horizontal.
2. Pulsar hamburguesa → abre drawer con overlay; cerrar con X, overlay y Escape.
3. Navegar a Clientes / Cartera / Calendario / Asistente / Configuración desde el drawer (se cierra al navegar).
4. Clientes en cards (no tabla desbordada); búsqueda/filtros accesibles.
5. Cartera: tabs con scroll horizontal limpio; cards 1 col; sub-tabs de trámites usables.
6. Calendario abre en **Agenda** por defecto; eventos legibles; crear/editar cita en modal a ancho completo.
7. Asistente: chat e input usables; escribir una consulta.
8. Configuración: subir avatar/logo; formularios full-width; guardar.
9. Repetir en **Safari iOS** (revisar `100dvh` y safe-area) y **Chrome Android**.
10. Confirmar en todas: **sin scroll horizontal** y **sin contenido cortado**.

## 15. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ (Compiled successfully) ·
runtime re-smoke: `/login /dashboard /clients /calendar /assistant /opportunities /settings` → **todas 200**.
git limpio · sin secretos · sin temp files · sin cambios n8n · sin cambios BD.

## 16. Archivos tocados
| Archivo | Cambio |
|---|---|
| `src/components/AppShell.tsx` | **Nuevo** — shell responsive (sidebar desktop / drawer móvil / main 100%) |
| `src/app/(saas)/layout.tsx` | Usa `<AppShell>` (elimina el shell inline sin móvil) |
| `src/components/Topbar.tsx` | Prop `onMenuClick` + botón hamburguesa `lg:hidden` + padding/título responsive |
| `src/components/Sidebar.tsx` | Prop `onClose` + botón X en el drawer |
| `src/app/(saas)/calendar/page.tsx` | Vista **Agenda** por defecto en `<lg` |

## 17–19. Commit / Push / Deploy
Commit `fix(p28b): responsive móvil — sidebar desktop / drawer móvil, main a 100% (fix bloqueante)` →
`origin/main`. Deploy: redeploy del frontend; la QA de dispositivo real (§14) se hace sobre el deploy o en local.

## 20. Pendientes honestos
1. **QA en dispositivo real:** no puedo abrir un navegador móvil desde aquí. Los cambios están validados por
   build + breakpoints + smoke de rutas; falta la pasada humana en iPhone/Android (checklist §14), sobre todo
   Safari iOS (`100dvh`, safe-area/notch).
2. **Refinamientos no bloqueantes:** panel derecho del Asistente → drawer en móvil; drawers de formularios →
   bottom-sheet; safe-area insets explícitos (`env(safe-area-inset-*)`). Mejoran el pulido pero el CRM ya es
   **usable y presentable** en móvil sin ellos.

## 21. Veredicto
**P28B COMPLETADO — CRM RESPONSIVE EN MÓVIL Y APTO PARA VALIDADORES.** El fallo bloqueante (sidebar fijo
aplastando el contenido) está **corregido globalmente**: desktop intacto, móvil con drawer y contenido a
ancho completo, navegación clara (hamburguesa + drawer con overlay/Escape/X), calendario en Agenda por
defecto, y sin fuentes de scroll horizontal en las páginas base. `tsc`/`lint`/`build` verde y rutas 200.
Queda la QA humana en dispositivo real (§14/§20) como verificación final.
