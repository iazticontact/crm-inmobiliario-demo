# FASE S7 — Kill remaining global loaders + route/tab-focus final audit

> **Fecha:** 2026-06-17 · **Base:** `6f873c4` (S6) → este commit ·
> **Alcance:** auditoría total de loaders "Cargando…" y de los eventos de
> foco/auth; eliminar los loaders visibles restantes en navegación. Sin tocar
> agente/tools/v2/confirm/executor, n8n, schema, RLS ni `service_role`.

---

## 0. ⚠️ HALLAZGO CRÍTICO PRIMERO: estado de deploy
HEAD local/remoto = `6f873c4` (S6). **S4, S5 y S6 están PUSHEADOS pero el deploy a
EasyPanel es manual.** La auditoría de código (abajo) demuestra que, con S6,
**volver de pestaña ya NO re-resuelve identidad ni muestra loader**. Por tanto, si
Oier todavía ve lag al volver de pestaña, la causa más probable es que **staging
sigue en un build anterior a S6**. **Acción nº1: redeploy de `6f873c4`+ (este
commit) en EasyPanel** y re-test. Si tras desplegar persiste, hay que volver a
mirar — pero el código ya está correcto.

## 1. Problema observado (usuario)
- Al volver de otra pestaña, lag/carga.
- Al cambiar de apartado, a veces "Cargando…".
- Asistente no del todo instantáneo.

## 2. FASE B — Inventario de TODOS los loaders "Cargando…"
| Archivo | Texto | Cuándo aparece | ¿Focus/tab? | Decisión |
|---|---|---|---|---|
| `AuthGate` | "Verificando acceso..." | primer mount / F5 (layout persiste en navegación) | **No** | mantener (carga inicial real) |
| `dashboard` tiles | "Cargando…" (placeholder en tarjetas) | entrada a dashboard, dentro del shell | No | aceptable (shell visible); texto menor |
| `clients` lista | "Cargando clientes…" (en `<tbody>`) | entrada a clientes | No | **→ skeleton rows** |
| `clients/[id]` | "Cargando ficha del cliente…" (**full-page**) | abrir ficha | No | **→ `PageSkeleton variant=detail`** |
| `opportunities` ×3 | "Cargando…" (en SectionCard) | entrada a operaciones | No | **→ skeleton** |
| `calendar` | "Cargando rango/eventos" | entrada / cambio de semana | **No al focus** (ver §4) | mantener (cambio de rango real) |
| `settings` | "Cargando..." (placeholders) | entrada a settings | No | aceptable (shell visible) |
| `assistant` | "Preparando el Asistente IA" | **solo primer mount** (latch S5) | No (S6) | mantener |
| `assistant` | "Cargando mensajes..." | hilo sin cache (S6) | No | mantener |
| login/reset | "Verificando/Preparando" | flujo de login | No | mantener |
| Team*/Templates/Vertical cards | "Cargando…" | paneles internos de settings | No | mantener (locales) |

**Conclusión:** ningún loader se dispara por **tab focus** tras S6. Los de
navegación son **de área de contenido** (el shell/layout permanece). El único
**full-page** en navegación normal era `clients/[id]`.

## 3. FASE C — route-level loading.tsx (S2)
Correctos (skeletons por ruta). Con prefetch, en navegación normal a veces ni se
ven (el chunk ya está) y se ve directamente el loader interno de la página → por
eso convertimos los internos a skeleton para que sean consistentes.

## 4. FASE D/E — AuthGate / layout / focus / auth (auditoría)
- **WorkspaceIdentityProvider** y **useCurrentUser** (S6): en `onAuthStateChange`
  solo re-resuelven en `SIGNED_OUT` o cambio real de `user.id`. `TOKEN_REFRESHED`
  / `SIGNED_IN` / `INITIAL_SESSION` del mismo usuario = **no-op** → volver de
  pestaña no mete la app en loading. ✅
- **AuthGate**: no se suscribe a auth; su efecto depende de `[pathname]`, así que
  **no reacciona al focus** (no cambia el pathname). El layout `(saas)` persiste
  en navegación → "Verificando acceso..." solo en primer mount/F5. Se deja intacto
  (gate de seguridad). *Nota:* re-chequea perfil en cada navegación (no
  bloqueante); unificarlo con el provider es una mejora futura opcional, no se
  toca por sensibilidad de seguridad.
- **calendar** tiene 2 listeners de `visibilitychange`/`focus`: uno solo recalcula
  `todayStr` (fecha de hoy), otro re-lee el **estado de Google** (chip). **Ninguno
  re-carga eventos ni muestra "Cargando eventos"** → no producen lag de foco. Se
  dejan (son correctos y baratos).
- Sin `router.refresh()` global por foco; sin `location.reload`.

## 5. FASE F — Asistente (estado tras S6)
Revisado: shell premium en primer mount (latch), SWR de threads/messages, no
loader en focus/token refresh, revalidate silencioso que no vacía lo visible. **No
se requieren más cambios** en el asistente en S7.

## 6. Cambios aplicados (navegación premium)
- `clients/[id]/page.tsx`: el loader full-page "Cargando ficha…" → **`PageSkeleton
  variant="detail"`** (coincide con su `loading.tsx`; abrir una ficha ya no
  muestra "Cargando…").
- `clients/page.tsx`: loader del `<tbody>` → **filas skeleton** (pulse). Import de
  `Loader2` retirado (quedaba sin uso).
- `opportunities/page.tsx`: los 3 "Cargando…" (pipeline/expedientes/propiedades) →
  **skeletons** (pulse). Import de `Loader2` retirado.

Todo presentacional: sin datos, sin lógica de negocio, sin RLS.

## 7. FASE G — Cache de páginas
**No** se añaden caches nuevas (preferencia del prompt: solo con hallazgo claro).
El layout persiste y la identidad ya está cacheada (S3); los listados cargan con
una query indexada y ahora muestran skeleton en lugar de "Cargando…". Suficiente.

## 8. FASE H — Navegación
`<Link>` con prefetch por defecto, `navItems` const de módulo, layout/Sidebar/
Topbar estables (no remontan), sin `window.location` interno. Sin cambios extra.

## 9. FASE I — Cleanup
Imports `Loader2` muertos retirados en `clients`/`opportunities` (consecuencia de
los skeletons). `eslint --max-warnings=0` garantiza cero imports muertos. Nada de
legacy protegido tocado.

## 10. Qué NO se tocó
Agente/tools/v2/confirm/executor · prompts · n8n · WhatsApp/Meta · Google ·
Storage/PDF · facturación · schema/migraciones · RLS · deps · `git reset` ·
AuthGate (seguridad) · calendar focus listeners (correctos) · S2–S6 intactos.

## 11. Seguridad multi-tenant
Sin cambios de modelo: identidad cacheada por `user.id` (S3), cache assistant por
`userId::workspaceId(::threadId)` (S6), invalidación por auth, bypass server-side,
RLS intacta, sin `service_role` en frontend, demo preservada. Los cambios S7 son
puramente visuales.

## 12. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅
(`✓ Compiled successfully`, 46 rutas).

## 13. Smoke local (estático/build)
Build verde. Lógica revisada para FASE J: navegar a Clientes/Ficha/Operaciones
muestra **skeleton** (no "Cargando…"); tab focus (post-S6) no dispara loaders;
assistant intacto.

## 14. Smoke staging (pendiente, Oier — tras redeploy)
A) Tab focus: Dashboard → cambiar pestaña 30s → volver → sin loader global.
B) Asistente: entrar/enviar → cambiar pestaña 30-60s → volver → sin "Preparando".
C) Navegación: Dashboard→Clientes→Ficha→Operaciones→Calendario→Asistente →
   skeletons, sin "Cargando…" full-page, sin pantallas blancas.
D) Auth: logout/login (otro user) sin datos previos; demo; F5 limpio.

## 15. Riesgos pendientes
- **Deploy:** el beneficio S4–S7 no se ve hasta redeploy en EasyPanel.
- AuthGate re-chequea perfil por navegación (no bloqueante; mejora futura).
- Mensajes del asistente sin paginación (futuro).

## 16. Próximo paso
**Redeploy `6f873c4`+este commit en EasyPanel** y ejecutar el smoke §14. Si el lag
de foco persiste **tras** desplegar, reabrir investigación con DevTools (Network/
Performance) al volver de pestaña.

## Veredicto
**S7 PARCIAL SEGURO — loaders de navegación convertidos a skeleton; auditoría
confirma que el lag de foco ya está resuelto en código (S6).** La pieza que falta
para "fluidez final" percibida es **desplegar** los commits S4–S7 en staging. Sin
eso, Oier sigue viendo el build viejo.
