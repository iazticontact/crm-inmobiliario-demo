# FASE S3 — Identity/workspace context dedup + real navigation latency fix

> **Fecha:** 2026-06-16 · **Base:** `abe229b` → este commit ·
> **Alcance:** eliminar la re-resolución repetida de identidad/workspace en cada
> navegación, de forma **segura para multi-tenant**. No se tocó `.env.local`,
> secrets, schema, RLS, migraciones, n8n, Google, WhatsApp, Storage, facturación,
> el executor del asistente, ni `service_role` en frontend.

---

## 1. Problema real (confirmado en código)
Antes de S3, **cada navegación re-resolvía la identidad** con la cadena
secuencial `auth.getUser()` → `profiles` → `workspaces`, de forma **independiente
y duplicada** en tres frentes que montan en cada página:

| Frente | Qué hacía por navegación |
|---|---|
| `AuthGate` | `getSession()` (local) + 1 query `profiles` (re-disparada en cada `pathname`). |
| `useCurrentUser` (Sidebar) | `auth.getUser()` **+** `getResolvedWorkspaceContext()` (que internamente hace `auth.getUser()` otra vez + `resolveCurrentProfile` [otro `getUser` + 1-2 `profiles`] + 1 `workspaces`). |
| `useCurrentUser` (Topbar) | **lo mismo otra vez** (segunda instancia del hook). |
| `getWorkspaceContext()` (cada page) | `getCurrentUser()` + `getCurrentProfile()` (`getUser` + `profiles`) + `getCurrentWorkspace()` (`workspaces`). |

Resultado: ~3 cadenas independientes y secuenciales de identidad por navegación
(además del AuthGate), **antes** de que la página empezara siquiera sus queries
de negocio. En un VPS con latencia a Supabase, eso es el “se siente lento”.

> Nota: los **índices** de Supabase ya eran correctos (S2) y el Dashboard ya
> paraleliza sus queries de negocio (S2). El cuello real era la identidad.

## 2. Diseño aplicado (seguro multi-tenant)
**a) Resolutor de identidad cacheado (cliente)** en
[src/lib/supabase-queries.ts](../src/lib/supabase-queries.ts):
- `getResolvedWorkspaceContext()` y `getWorkspaceContext()` ahora delegan en un
  resolutor único memoizado **una vez por sesión de navegador**.
- **Dedup de concurrencia:** las llamadas simultáneas (Sidebar + Topbar + page en
  el mismo tick) comparten **una sola promise en vuelo** (`identityPending`) → 1
  resolución, no 3.
- **Cache en memoria** keyed por `user.id`, sólo se guarda si hay usuario real.
- **TTL corto (120 s)** que acota la *frescura del display* (nombre de workspace,
  rol). La **corrección multi-tenant NO depende del TTL** (ver invalidación).
- **Bypass server-side** (`typeof window === 'undefined'`) → en servidor siempre
  resuelve fresco; **nunca** existe un cache de proceso compartido entre usuarios.

**b) Provider de identidad** en
[src/components/WorkspaceIdentityProvider.tsx](../src/components/WorkspaceIdentityProvider.tsx):
- `WorkspaceIdentityProvider` montado **una vez** en el layout autenticado
  ([src/app/(saas)/layout.tsx](../src/app/(saas)/layout.tsx), dentro de `AuthGate`).
- `useWorkspaceIdentity()` expone `{ currentUser, user, profile, workspace,
  workspaceId, role, isDemo, isAuthenticated, isLoading, error, refresh() }`.
- **Sidebar** y **Topbar** ahora consumen `useWorkspaceIdentity()` → **0 queries
  propias** (antes cada uno disparaba su cadena completa).

**c) Una sola lógica de mapeo**: se extrajo `buildCurrentUser()` + `loadIdentity()`
+ `getFallbackCurrentUser()` en
[src/lib/current-user.ts](../src/lib/current-user.ts). `useCurrentUser` y el
provider comparten **exactamente** el mismo mapeo y el mismo resolutor cacheado
(antes `useCurrentUser` hacía `getUser` dos veces por ejecución).

## 3. Seguridad multi-tenant (cómo se evita mezclar workspaces)
Capas de defensa (independientes):
1. **Cache keyed por `user.id`**, sólo poblado con usuario real.
2. **Invalidación por evento de auth** (`onAuthStateChange` en el resolutor):
   `SIGNED_OUT` → limpia; cualquier evento cuyo `session.user.id` ≠ el cacheado →
   limpia. Nunca se sirve identidad de un usuario distinto al de la sesión viva.
3. **Los consumidores limpian el cache ANTES de re-resolver** en cualquier evento
   de auth (provider y `useCurrentUser`), de modo que el orden de registro de
   listeners es irrelevante (no hay ventana de fuga por orden de callbacks).
4. **Logout** (`Sidebar.handleLogout`) llama `clearWorkspaceIdentityCache()`
   explícitamente, además del `SIGNED_OUT`.
5. **Login fuera de `(saas)`**: el provider se **desmonta** al ir a `/login` y se
   **remonta** (resolución fresca) al entrar; no hay estado que sobreviva.
6. **TTL 120 s** acota cualquier desfase de *display*; **F5** resuelve desde cero.
7. **Bypass en servidor** → imposible cache de proceso compartido entre usuarios.
- **No** se usa `localStorage`/`sessionStorage` para la identidad (sólo memoria).
- **No** se guardan secrets ni `service_role`. **No** se desactiva RLS. Las
  queries de negocio siguen filtrando por `workspace_id` con RLS.

## 4. Demo mode
`loadIdentity()` respeta el orden: `OFFLINE_FORCE_DEV` → demo (`DEMO_MODE_KEY`) →
sesión real. En demo **no** se llama al resolutor real ni se puebla el cache de
identidad (devuelve `demoUser`). Al confirmar usuario real se elimina
`DEMO_MODE_KEY`. Salir de la app / logout limpia estado. La demo offline sigue
funcionando sin backend.

## 5. Páginas (FASE E) — sin reescritura masiva
Las páginas (`dashboard/clients/[id]/opportunities/calendar/assistant/settings`)
**siguen llamando `getWorkspaceContext()`**, que ahora es **O(1) desde cache** (o
comparte la promise en vuelo si la resolución está en curso). Se eligió esto
sobre reescribir el control-flow de cada page (la regla S3 pide “evitar cambios
masivos si no hace falta”): mismo resultado de latencia, superficie de riesgo
mínima. Las queries de negocio de cada página no cambian.

## 6. AuthGate — intencionadamente intacto
`AuthGate` es el gate de seguridad (H6D: distingue `access_check` vs `no_profile`,
no cierra sesión por errores temporales). Su chequeo **no bloquea** el render
(`allowed` no se resetea entre navegaciones) y es **1 lookup `profiles`
indexado**. Se deja **sin tocar** para no arriesgar el gate; su coste por
navegación es no-bloqueante y mínimo. (Unificarlo con el resolutor es una mejora
futura opcional, no necesaria para la latencia percibida.)

## 7. Métrica antes/después (estática)
| Momento | Antes S3 | Después S3 |
|---|---|---|
| Carga fría de sesión | 3 cadenas independientes (Sidebar, Topbar, page), cada una `getUser→profiles→workspaces`, secuenciales | **1** resolución compartida (promise en vuelo deduplicada) |
| Navegación posterior (≤120 s) | re-resuelve identidad en cada frente | **0** round-trips de identidad (cache en memoria) |
| `getUser` por `useCurrentUser` | 2 por ejecución (uno directo + uno dentro del resolver) | 0 directos extra (deriva el user del contexto resuelto) |
| AuthGate | 1 `profiles` por navegación (no bloqueante) | igual (intacto, por seguridad) |

Llamadas eliminadas en la práctica: las cadenas de identidad de **Sidebar,
Topbar y páginas** dejan de pegar a la red en cada navegación; se resuelve una
vez por sesión y se comparte. Sin logs ruidosos en producción.

## 8. Qué NO se tocó
`.env.local`/secrets · schema/migraciones · RLS policies · `service_role`
frontend · n8n · WhatsApp/Meta · Google OAuth · Storage/RAG · facturación ·
`/api/assistant/confirm` y executor · prompt/tools del asistente · deps de npm ·
`git reset`. Skeletons/`loading.tsx` de S2 se mantienen.

## 9. Validaciones
- `tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅
  (`✓ Compiled successfully`, 46 rutas).

## 10. Smoke local (estático/build)
- Build verde con el provider montado en el layout y Sidebar/Topbar consumiéndolo.
- Sin ciclos de import (provider → current-user → supabase-queries; supabase-queries
  no importa de vuelta).
- Pendiente smoke en **navegador** (Oier) — ver FASE H.

## 11. Smoke staging / multi-tenant (FASE H — pendiente navegador)
1. **Usuario normal:** login → dashboard → clients → assistant → navegación
   notablemente más rápida (sin re-cargar identidad) → logout → login de nuevo →
   contexto correcto.
2. **Invalidación:** logout → confirmar que no queda workspace en memoria (la
   nav siguiente re-resuelve) → entrar de nuevo → sin datos del anterior.
3. **Cambio de display:** si se renombra el workspace en Configuración, el nombre
   en Sidebar/Topbar se refresca tras ≤120 s o F5 (o `refresh()`); documentado.
4. **Demo:** “Ver demo” no contamina el contexto real; salir limpia estado.
5. **Refresh (F5):** recalcula identidad sin error falso.

## 12. Riesgos pendientes / notas
- Desfase de *display* de perfil/workspace acotado a 120 s (TTL) o hasta F5;
  aceptable (perfil/workspace casi no cambian en sesión). Si molesta, llamar
  `clearWorkspaceIdentityCache()` tras guardar en Configuración (mejora menor).
  > **Cerrado en S4 (2026-06-16):** Configuración persiste `workspace_settings`,
  > **no** `profiles.full_name` ni `workspaces.name` (los campos que muestran
  > Sidebar/Topbar), por lo que no existe edición de usuario que produzca display
  > obsoleto → **N/A**. Ver
  > [PHASE_S4_FINAL_PERFORMANCE_AND_ASSISTANT_POLISH_REPORT.md](PHASE_S4_FINAL_PERFORMANCE_AND_ASSISTANT_POLISH_REPORT.md) §5.
- AuthGate mantiene 1 lookup por navegación (no bloqueante) — unificación futura
  opcional.

## 13. Próximo paso
Deploy en EasyPanel (redeploy/push) + smoke navegador (FASE H). Opcional futuro:
unificar AuthGate con el resolutor y refrescar el cache tras edición de perfil.

## 14. Veredicto
**S3 PARCIAL SEGURO — LATENCIA DE IDENTIDAD ELIMINADA EN NAVEGACIÓN.** La
identidad se resuelve una vez por sesión y se comparte (provider + cache con
dedup e invalidación por auth), con defensa multi-tenant en capas. Validaciones
verdes. Falta únicamente el smoke en navegador contra staging (Oier).
