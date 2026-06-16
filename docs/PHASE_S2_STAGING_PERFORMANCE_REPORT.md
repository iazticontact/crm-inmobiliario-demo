# FASE S2 — Staging performance & UX fluidity pass

> **Fecha:** 2026-06-16 · **Base:** `c768427` → este commit ·
> **Alcance:** rendimiento percibido y fluidez de navegación, **sin romper
> arquitectura, RLS ni Data Reality Policy.** Medir/auditar primero, optimizar
> solo lo seguro. No se tocó `.env.local`, ni schema/migraciones (salvo que un
> índice lo justificara — no hizo falta), ni `service_role` en frontend.

---

## 0. Resumen ejecutivo
- **Causa real de la lentitud percibida (auditada en código):** cada navegación
  reejecuta una **cadena secuencial de round-trips de identidad**
  (`auth.getUser()` → `profiles` → `workspaces`) en **tres** sitios a la vez
  (AuthGate, `useCurrentUser` vía Sidebar/Topbar, y la propia página vía
  `getWorkspaceContext`). En un VPS con latencia a Supabase, eso son varios
  saltos en serie **antes** de que arranque el batch de datos de la página.
- **No es problema de índices ni de queries en paralelo:** la BD está bien
  indexada y el Dashboard ya paraleliza sus 9 queries con `Promise.all`.
- **Lo que faltaba para fluidez percibida:** no había **`loading.tsx`** en
  ninguna ruta → hueco en blanco al navegar a una ruta aún "fría".
- **Aplicado en este pase (cero riesgo):** skeletons premium de ruta
  (`loading.tsx`) en Dashboard, Clientes, Ficha, Operaciones, Calendario,
  Asistente y Configuración → feedback **instantáneo** al navegar.
- **Documentado, NO aplicado (requiere cuidado):** deduplicación cacheada del
  contexto de identidad/workspace (la mayor ganancia real) — diseño seguro en §5.

**Veredicto: S2 PARCIAL SEGURO.** Mejora de fluidez percibida entregada y
verificada (tsc/lint/build verdes); la optimización de fondo (dedup de
identidad) queda diseñada para un pase dedicado por su sensibilidad multi-tenant.

---

## 1. FASE A — Prechecks
- `git status` limpio en `main` (`c768427`), `.env.local`/`.mcp.json` no trackeados.
- `tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).

## 2. FASE B/C — Auditoría estática de rendimiento
Método: lectura de patrones de fetch (no instrumentación en navegador; staging no
medible desde aquí). Hallazgos por archivo:

| Área | Hallazgo | Severidad | Acción |
|---|---|---|---|
| `getWorkspaceContext` (`supabase-queries.ts:560`) | 3 round-trips **secuenciales** (user→profile→workspace) por carga de página | **Alta** (latencia) | Documentado §5 (cache segura). No tocado este pase. |
| `AuthGate` (`components/AuthGate.tsx`) | `checkAccess` (getSession + query `profiles`) **se re-dispara en cada cambio de `pathname`**. No bloquea UI (`allowed` no se resetea), pero lanza una query de red por navegación | Media | Documentado §5. No tocado (componente de seguridad). |
| `useCurrentUser` (`current-user.ts:164`) | Resuelve contexto vía `getResolvedWorkspaceContext` (getUser + profile + workspace) en **cada** página (Sidebar/Topbar montan en el layout) → duplica el trabajo de identidad de la página | Media-Alta | Documentado §5 (mismo cache). |
| `dashboard/page.tsx:210` | **Ya** usa `Promise.all` de 9 queries tras 1 query de contexto | OK | Sin cambios. |
| Rutas `(saas)` | **Sin `loading.tsx`** → hueco en blanco al navegar a ruta fría | Media (percibida) | **Resuelto** (FASE F). |
| `getCurrentWorkspace` (`:549`) | `select('*')` en `workspaces` (1 fila) | Baja | Aceptable; trim documentado §5. |
| Páginas `(saas)` | Todas `'use client'` con fetch en `useEffect` (CSR) | Por diseño | El skeleton de ruta + el skeleton interno cubren la espera. |

## 3. FASE K — Auditoría de índices Supabase (solo lectura)
`pg_indexes` sobre las tablas del CRM. **Cobertura excelente, no se requiere
migración:**
- `clients`: `(workspace_id)`, `(workspace_id, updated_at DESC) WHERE deleted_at IS NULL`, `(workspace_id, status)`, `(assigned_to)`.
- `opportunities`: `(workspace_id)`, `(workspace_id, stage)`, `(workspace_id, assigned_to)`, `(workspace_id, updated_at DESC)…`, `(client_id)`, `(property_id)`.
- `service_cases`: `(workspace_id)`, `(workspace_id, status)`, `(workspace_id, updated_at DESC)…`, `(client_id)`, `(opportunity_id)`.
- `tasks`: `(workspace_id, due_date)`, `(workspace_id, status)`, `(client_id)`, `(assigned_to)`.
- `calendar_events`: `(workspace_id, start_at)`, `(client_id)`, único `(workspace_id, google_event_id)`.
- `activities`: `(workspace_id, created_at DESC)`, `(client_id, created_at DESC)`.
- `assistant_threads`: `(workspace_id, last_message_at DESC)`; `assistant_messages`: `(thread_id, created_at)`.
- `profiles`/`workspace_members`: por `workspace_id`, `user_id`, `lower(email)`.

**Conclusión:** los filtros típicos (`workspace_id` + estado/fecha) están
cubiertos. **No se propone ninguna migración de índices.**

## 4. FASE F — Estados de carga premium (APLICADO)
Nuevo `src/components/PageSkeleton.tsx` (presentacional, sin datos ni hooks) con
variantes `dashboard | list | detail | board | calendar | chat`, y `loading.tsx`
por ruta:

- `(saas)/dashboard/loading.tsx` → `dashboard` (tiles + listas)
- `(saas)/clients/loading.tsx` → `list`
- `(saas)/clients/[id]/loading.tsx` → `detail`
- `(saas)/opportunities/loading.tsx` → `board`
- `(saas)/calendar/loading.tsx` → `calendar`
- `(saas)/assistant/loading.tsx` → `chat`
- `(saas)/settings/loading.tsx` → `list`

**Efecto:** Next.js muestra el skeleton de ruta **al instante** (fallback de
Suspense) mientras el chunk de la página evalúa y monta; el handoff al skeleton
interno de cada página es visualmente continuo (sin parpadeo brusco). **Cero
coste de query, cero riesgo** (no tocan datos, RLS ni lógica). Combinado con el
prefetch por defecto de `<Link>` en el Sidebar, la navegación se siente inmediata.

## 5. Optimización de fondo recomendada (DISEÑO, no aplicada)
> **✅ IMPLEMENTADA EN S3 (2026-06-16):** ver
> [PHASE_S3_IDENTITY_CONTEXT_DEDUP_REPORT.md](PHASE_S3_IDENTITY_CONTEXT_DEDUP_REPORT.md)
> — cache de identidad cacheado por `user.id` con dedup de promise en vuelo,
> invalidación por `onAuthStateChange` + limpieza en consumidores y logout,
> bypass server-side, y `WorkspaceIdentityProvider` consumido por Sidebar/Topbar.

> La mayor ganancia real de latencia es **dejar de re-resolver la identidad en
> cada navegación.** No se aplica en este pase por ser **sensible multi-tenant**
> (la regla S2 prohíbe explícitamente cualquier cache que pueda mostrar datos de
> otro workspace). Diseño seguro propuesto para un pase dedicado:

1. **Cache en memoria del contexto resuelto** (`{ user, profile, workspace }`),
   **clave = `user.id`**, TTL corto (p. ej. 30–60 s) o sin TTL pero invalidado
   por eventos de auth.
2. **Invalidación obligatoria** vía `supabase.auth.onAuthStateChange`: limpiar el
   cache en `SIGNED_OUT`, `SIGNED_IN`, `USER_UPDATED`, `TOKEN_REFRESHED` con
   cambio de usuario. Nunca servir cache si `user.id` no coincide.
3. **Una sola fuente:** que `AuthGate`, `useCurrentUser` y `getWorkspaceContext`
   consuman el mismo resolver cacheado → de ~3× round-trips de identidad por
   navegación a ~1 (o 0 si está caliente).
4. **AuthGate:** mantener la verificación de sesión, pero evitar la query a
   `profiles` en **cada** `pathname` una vez `allowed` (revalidar por tiempo o
   por evento de auth, no por cada navegación). Sin desactivar RLS ni ocultar
   errores reales (se conserva la rama `access_check` de H6D).
5. **Trim de selects** (`getCurrentWorkspace` `select('*')` → columnas usadas) —
   ganancia menor, hacer junto al punto 1.

**Riesgo si se hace mal:** servir el workspace de un usuario a otro tras un
re-login rápido. Por eso se entrega como diseño y no como cambio apresurado.

## 6. FASE M — Workflow de auto-deploy (EasyPanel)
- **Los cambios de código requieren redeploy en EasyPanel.** El servidor sirve el
  build de un commit; editar local no afecta a staging hasta:
  `commit → push a `main` → EasyPanel **Deploy**` (o auto-deploy on push si está
  activado; ver runbook §4.2/§4.11).
- **`NEXT_PUBLIC_*` se inlinean en BUILD** → si cambias una env pública hay que
  **rebuild**, no basta reiniciar (runbook §2).
- Estos `loading.tsx` son cambios de código → entran en staging en el próximo
  redeploy. No requieren cambios de env ni de DB.

## 7. FASE N — Validaciones
- `tsc --noEmit` ✅
- `eslint --max-warnings=0` ✅
- `next build` ✅ (46 rutas; los `loading.tsx` son fallbacks de segmento, no
  añaden rutas).

## 8. FASE O — Smoke de staging (pendiente, Oier)
Tras redeploy, verificar **fluidez percibida**:
1. Login → Dashboard aparece con **skeleton instantáneo** y luego datos (sin
   blanco).
2. Dashboard → Clientes → Operaciones → Calendario → Asistente: cada salto
   muestra su skeleton al instante; el contenido entra sin parpadeo brusco.
3. Asistente: lista de hilos + chat con skeleton tipo `chat` antes de cargar.
4. Datos correctos del workspace real (sin fugas; sin demo en modo real).

## 9. Qué NO se tocó (límites S2 respetados)
`.env.local`/secrets · schema/migraciones (no hizo falta índice) · Auth users ·
n8n/WhatsApp/Meta/Google/Storage/Facturación · `/api/assistant/confirm` ·
`service_role` en frontend · políticas RLS · dependencias · `git reset`. Sin
caching que pueda mostrar otro workspace (por eso §5 queda documentado, no
aplicado). Data Reality Policy intacta.

## 10. Veredicto
**S2 PARCIAL SEGURO.** Entregado: skeletons de ruta premium (fluidez percibida
inmediata) + auditoría de rendimiento + confirmación de índices (sin migración) +
diseño seguro de la optimización de fondo (dedup de identidad). Validaciones
verdes. Próximo pase opcional: implementar §5 con la invalidación por evento de
auth (mayor ganancia de latencia real), con su propio smoke de aislamiento
multi-tenant.
