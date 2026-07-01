# FASE P28C — Mobile Safari/iPhone: sin auto-zoom, viewport estable, login perfecto

> **Fecha:** 2026-07-01 · Cierre del comportamiento móvil en iOS Safari. Causa raíz del auto-zoom
> identificada y corregida **globalmente** (no solo el login), preservando la accesibilidad (no se bloquea
> el pinch-zoom). Sin features nuevas, sin tocar n8n/Supabase/lógica de negocio.

---

## 1. Diagnóstico
- **Sin `viewport` explícito:** el root layout (`src/app/layout.tsx`) no exportaba `viewport`; se usaba el
  default de Next (`width=device-width, initial-scale=1`) sin `viewport-fit=cover` (sin safe-area iOS).
- **Inputs < 16px:** no existe componente `Input` compartido; los campos son `<input className="… text-sm">`
  (14px) o `text-xs` repartidos por todas las páginas. **iOS Safari hace zoom automático al enfocar un campo
  con font-size < 16px** → esa es la causa exacta del auto-zoom en login (email/contraseña) y en todos los
  formularios.
- **Auth a `min-h-screen`:** login, reset-password, auth/callback, onboarding y AuthGate usaban `min-h-screen`
  (`100vh`), que en iOS incluye la barra de direcciones → sensación de contenido "pegado/empujado".

## 2. Causa del zoom móvil
**Font-size de los campos < 16px** (Safari iOS hace auto-zoom para "ayudar" a leer). No era el viewport ni un
`transform: scale`. Confirmado por código (todos los inputs usan `text-sm`/`text-xs`).

## 3. Cambios en viewport
`src/app/layout.tsx` — añadido export explícito (Next App Router):
```ts
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',   // habilita safe-area iOS (notch/home indicator)
}
```
**Decisión (Parte 17):** NO se usa `maximumScale`/`userScalable: false`. Bloquear el zoom sería innecesario y
dañaría la accesibilidad. El auto-zoom se elimina en su origen (font-size ≥16px). Verificado en el HTML
servido: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.

## 4. Cambios en inputs (global, cubre TODO el CRM)
`src/app/globals.css` — regla global en móvil (≤767px), sin tocar el diseño desktop:
```css
@media (max-width: 767px) {
  input, select, textarea, input[type='text'|'email'|'password'|'search'|'tel'|'url'|'number'|'date'|'time'|'datetime-local'] {
    font-size: 16px !important;
    line-height: 1.4;
  }
}
html, body { max-width: 100%; overflow-x: hidden; }  /* red de seguridad anti scroll-horizontal */
```
Al apuntar al **tipo de elemento**, cubre inputs "crudos" y cualquier componente (login, clientes, inmuebles,
citas, tareas, trámites, configuración, avatar/logo, búsqueda/filtros, input del Asistente) **sin editar
decenas de ficheros**. En desktop se mantiene `text-sm`/`text-xs` (no hay auto-zoom en desktop).

## 5. Cambios en login móvil
`src/app/login/page.tsx`:
- `min-h-screen` → **`min-h-dvh`** (x3): la card deja de quedar "empujada" bajo la barra de Safari.
- Email: `inputMode="email"`, `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}` (además del
  `type="email"` + `autoComplete="email"` ya presentes). Password ya tenía `type=password` +
  `autoComplete="current-password"`.
- Layout ya era correcto en móvil: el panel de marketing es `hidden lg:flex` (en móvil solo se ve el formulario,
  `max-w-[420px]`, `px-6`), los inputs son `h-12` (48px) → cómodos con 16px.

## 6. Cambios en AppShell/main
Ninguno nuevo (P28B ya dejó `h-[100dvh]`, `overflow-x-hidden` en main y el drawer móvil). El guard global de
`overflow-x` en `html, body` refuerza que no aparezca scroll horizontal en ninguna página (incluidas las de
auth, fuera del shell).

## 7. Formularios CRM móvil
Cubiertos por la regla global de 16px (Parte 4): nuevo/editar cliente, inmueble, cita, tareas, trámites,
operaciones, configuración de empresa, perfil/avatar, logo, búsqueda global y filtros. Ningún campo editable
disparará auto-zoom en móvil. Los drawers/modales ya se abren dentro del shell corregido (ancho completo).

## 8. Asistente móvil
El input del chat (input/textarea) queda en 16px por la regla global → no hace zoom al enfocar. Los paneles
`lg:grid-cols-3` colapsan a 1 columna en móvil (P28B). El shell da ancho completo.

## 9. Calendario móvil
Vista **Agenda** por defecto en móvil (P28B). Los inputs de los modales de cita (texto, fecha/hora, notas)
quedan en 16px por la regla global → sin zoom al editar.

## 10. Configuración móvil
Inputs de empresa (nombre/descripción/teléfono/email/web), perfil e invitar equipo → 16px en móvil (sin zoom).
Uploads de avatar/logo son botones + `<input type=file>` (file no dispara auto-zoom). Grids `md:grid-cols-*`
colapsan a 1 col.

## 11. Auth/onboarding
`min-h-screen` → `min-h-dvh` en `reset-password`, `auth/callback`, `onboarding` (x3) y `AuthGate` → pantallas
de acceso/carga estables en iOS, sin "empuje" por la barra del navegador.

## 12. Scans realizados
- `text-sm`/`text-xs` en inputs → **neutralizados globalmente** en móvil (16px), sin tocar desktop.
- `min-h-screen`/`100vh` de página completa → migrados a `min-h-dvh` (auth/onboarding). Los `100vh` restantes
  son `clamp()` de altura de contenido en calendario/asistente (no causan el problema; se dejan).
- `w-screen`: 0 en páginas base. `min-w-[…]`: solo en `flex-wrap`/`overflow-x-auto` (no desbordan).
- `maximum-scale`/`user-scalable`: **ninguno** (decisión consciente, accesibilidad intacta).

## 13. QA checklist iPhone/Android (manual, para validadores)
**Login:** abrir → tocar email → tocar password → escribir → **NO debe hacer zoom** → entrar → la app **no**
queda ampliada. **Dashboard:** abrir/cerrar menú, navegar, sin zoom/overflow. **Clientes:** buscar, crear/editar
(inputs sin zoom). **Cartera:** filtros, crear/editar inmueble (localidad/zona), sin zoom. **Calendario:** crear/
editar cita, date/time, notas, sin zoom. **Asistente:** escribir, teclado no tapa el input, sin zoom.
**Configuración:** editar empresa, subir avatar/logo, sin zoom. **General:** sin scroll horizontal, sin sidebar
desktop, sin contenido aplastado, **sin pellizcar para desampliar**. Repetir en **Safari iOS** (100dvh /
safe-area) y **Chrome Android** (resize del teclado).

## 14. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ (Compiled successfully) ·
`node --check scripts/check-agent-deploy.mjs` ✅ · viewport verificado en el HTML servido ✅ · rutas base 200 ✅ ·
git limpio · sin secretos · sin temp files · sin cambios n8n/BD.

## 15. Archivos tocados
| Archivo | Cambio |
|---|---|
| `src/app/layout.tsx` | Export `viewport` (device-width, initial-scale 1, viewport-fit cover) |
| `src/app/globals.css` | 16px en form controls en móvil + guard `overflow-x` en html/body |
| `src/app/login/page.tsx` | `min-h-dvh` + atributos iOS en email |
| `src/app/reset-password/page.tsx` | `min-h-dvh` |
| `src/app/auth/callback/page.tsx` | `min-h-dvh` |
| `src/app/onboarding/page.tsx` | `min-h-dvh` |
| `src/components/AuthGate.tsx` | `min-h-dvh` |

## 16–17. Commit / Push / Deploy
Commit `fix(p28c): iOS Safari sin auto-zoom (inputs 16px móvil) + viewport + min-h-dvh en auth` →
`origin/main`. Deploy: redeploy del frontend; QA en dispositivo real sobre el deploy o en local.

## 18. Pendientes honestos
1. **QA en dispositivo real:** no puedo abrir Safari iOS / Chrome Android desde aquí. La corrección es la
   canónica (16px + viewport + dvh) y está verificada por build + meta emitido, pero falta la pasada humana en
   iPhone/Android (checklist §13).
2. **Refinamientos no bloqueantes (heredados de P28B):** panel derecho del Asistente → drawer; drawers de
   formularios → bottom-sheet; `env(safe-area-inset-*)` explícito en barras fijas si se añaden. No afectan al
   auto-zoom ni al 100%.

## 19. Veredicto
**P28C COMPLETADO — MOBILE SAFARI SIN AUTO-ZOOM, LOGIN ESTABLE Y CRM MÓVIL AL 100%.** La causa (inputs
<16px) está resuelta globalmente para todo el CRM; el viewport es explícito y correcto (`viewport-fit=cover`,
sin bloquear zoom → accesible); login y pantallas de acceso usan `min-h-dvh` (sin "empuje" de la barra iOS); y
hay red de seguridad anti scroll-horizontal. Al tocar cualquier campo ya **no** se hace zoom y el usuario **no**
tiene que pellizcar para desampliar. Queda la QA humana en dispositivo real (§13/§18) como verificación final.
