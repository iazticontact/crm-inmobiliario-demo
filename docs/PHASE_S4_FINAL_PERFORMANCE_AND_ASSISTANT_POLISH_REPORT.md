# FASE S4 — Final performance, assistant fluency & staging polish

> **Fecha:** 2026-06-16 · **Base:** `4dc1594` (S3) → este commit ·
> **Alcance:** último repaso de fluidez/rendimiento. Filosofía aplicada: **"no
> tocar por tocar — cada cambio con razón".** Tras S2 (skeletons) y S3 (dedup de
> identidad), la auditoría confirma que el grueso del CRM **ya está bien
> optimizado**; S4 aplica **un** arreglo de fluidez real (asistente) y documenta
> el resto como ya-correcto, sin churn.

---

## 1. Estado inicial
- S2: `PageSkeleton` + `loading.tsx` por ruta.
- S3: `WorkspaceIdentityProvider` + resolutor de identidad cacheado client-only
  (dedup por `user.id`, invalidación por auth, bypass server-side).
- Navegación ya notablemente mejor.

## 2. Qué seguía lento / mejorable (hallazgos)
1. **Asistente:** `loadConversations()` ponía `setAssistantReady(false)` en **toda**
   llamada, y el guard de render cambia la página entera por un loader a pantalla
   completa. Esto se disparaba también **al crear/resolver** una conversación →
   *flash* de toda la zona del asistente para una acción que solo debía refrescar
   la lista de hilos. **(Único hallazgo con impacto real de fluidez.)**
2. Resto de páginas core: sin hallazgos accionables (ver §3).

## 3. Auditoría final de waterfalls y renders (FASE B)
| Área | Estado | Acción |
|---|---|---|
| `WorkspaceIdentityProvider` | `value` memoizado (`useMemo[state]`); Sidebar/Topbar consumen 1 contexto compartido (S3) | OK, sin cambios |
| `Sidebar` / nav | `navItems`/`visibleNavItems` son **const de módulo** (no se recrean por render); todos los links son `<Link>` de Next (prefetch por defecto); active state inmediato vía `usePathname` | OK, sin cambios |
| `window.location` | Solo en login/auth/reset (lectura de params de URL) y en 2 redirects **externos** de OAuth Google. **Cero** uso para navegación interna | OK |
| `AuthGate` | Gate de seguridad, no bloqueante (`allowed` no se resetea entre navegaciones); 1 lookup `profiles` indexado | Intacto (seguridad) |
| Dashboard | 1 `getWorkspaceContext` (cacheado S3) + `Promise.all` de 9 queries; listas limitadas (`upcoming`/`hotLeads` slice 5) | OK (S2), sin cambios |
| Clientes (lista) | `getClients` usa columnas explícitas (no `select('*')`) | OK |
| Calendario | Agrupación por día **ya memoizada**: `eventsByDate`, `eventsByDateLaidOut`, `visibleEvents`, `upcomingEvents`, `agendaEvents` (todos `useMemo`) | OK, sin cambios |
| Operaciones | `opportunitiesByStage`, `visibleOpportunities/Cases/Properties` **ya `useMemo`**; única suma inline es O(n) sobre ~8 filas (trivial) | OK, sin cambios |
| Asistente — mensajes | Solo del hilo activo (`listThreadMessages(selected.id)`); preserva mensajes optimistas (no pisa con carga vacía) | OK |
| Asistente — envío | **No** dispara reload completo de hilos al enviar; append optimista (`void appendThreadMessage`) | OK (ya cumplía FASE F#7) |
| Asistente — borrado | Ya optimista en estado local (filtra lista + borra mensajes/refs) **sin** reload completo; pesimista a propósito (acción destructiva con `confirm()`) | OK, sin cambios |

> Conclusión honesta: la mayoría de items de FASE B/E **ya estaban resueltos**
> por S2, S3 y el cuidado previo (H8–H14). Forzar cambios habría sido churn.

## 4. Cambios de performance / fluidez aplicados
**Asistente — refresh silencioso** ([assistant/page.tsx](../src/app/(saas)/assistant/page.tsx)):
- `loadConversations(options?: { silent?: boolean })`. En modo `silent` **no**
  baja `assistantReady`/`loadingConversations`, así que la página no se sustituye
  por el loader a pantalla completa.
- Las llamadas tras **crear** y **resolver** conversación pasan a
  `loadConversations({ silent: true })` → la lista de hilos se actualiza **en
  sitio**, sin *flash* de toda la zona del asistente.
- La carga **inicial** (mount) sigue usando el loader completo (correcto).
- Sin tocar OpenAI, tools, executor/confirm, prompts ni n8n.

## 5. S3.1 — invalidación de cache desde Configuración (FASE C)
**Resultado: N/A — documentado, NO se toca.** Configuración persiste
`workspace_settings` (vertical, `business_name`, idioma, zona horaria, `ai_tone`,
auto-reply) vía `upsertWorkspaceSettings`. **No** edita `profiles.full_name` ni
`workspaces.name`, que son los campos que Sidebar/Topbar muestran. Como esos
campos **no tienen ruta de edición** en la app, el TTL de 120s **nunca** produce
un display obsoleto por una acción del usuario → no hay trade-off que cerrar. Si
en el futuro se añade edición de nombre de perfil/workspace, ahí sí habría que
llamar `clearWorkspaceIdentityCache()` + `useWorkspaceIdentity().refresh()` tras
guardar (gancho ya disponible).

## 6. Cambios de navegación (FASE D)
Ninguno necesario: `<Link>` + prefetch por defecto, `navItems` const de módulo,
active state inmediato, layout (Sidebar/Topbar) estable entre rutas (no remonta),
sin `window.location` para navegación interna. Documentado como ya-premium.

## 7. Cambios del asistente (FASE F)
Solo el refresh silencioso (§4). El resto de items ya se cumplían: mensajes solo
del hilo activo, optimista al enviar, sin reload completo al enviar, borrado
optimista local. Microcopy/personalidad **no** se reabre (riesgo; ya pulida en
H14). Confirm actions intactas.

## 8. Query audit (FASE G)
- Identidad: cacheada (S3) → sin round-trips repetidos por navegación.
- Page queries filtran por `workspaceId` (RLS) con columnas explícitas.
- Sin queries globales sin `workspace_id`; sin joins pesados nuevos.
- **Índices**: ya excelentes (auditados en S2); **sin migración** en S4.

## 9. UX / loading polish (FASE H)
Skeletons S2 consistentes; el único *flash* real (zona del asistente en
create/resolve) queda eliminado. Header/sidebar estables. Sin rediseño.

## 10. Seguridad multi-tenant
Sin cambios en el modelo de S3: cache client-only keyed por `user.id`,
invalidación por auth, bypass server-side, RLS intacta, sin `service_role` en
frontend, demo mode preservado. El cambio del asistente es puramente de UI
(banderas de loading); no toca datos, RLS ni el executor.

## 11. Qué NO se tocó
`.env.local`/secrets · EasyPanel envs · schema/migraciones · RLS · `service_role`
frontend · n8n · WhatsApp/Meta · Google OAuth · Storage/RAG/PDFs · facturación ·
`/api/assistant/confirm` y executor · prompts/tools del asistente · deps · `git
reset`. Calendar/Operaciones/Dashboard **no** se tocaron (ya memoizados).

## 12. Validaciones
- `tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅
  (`✓ Compiled successfully`, 46 rutas).

## 13. Smoke local (estático/build)
Build verde con el cambio del asistente. Flujo esperado tras deploy: crear
consulta / resolver → la lista de hilos se refresca sin *flash* de pantalla;
enviar mensaje → optimista; reabrir/eliminar hilo → sin reload completo.

## 14. Smoke staging (pendiente, Oier)
Navegación dashboard↔clientes↔ficha↔operaciones↔calendario↔asistente fluida;
asistente: crear/enviar/reabrir/eliminar sin *flash*; sin errores consola; sin
fuga de workspace; demo intacta.

## 15. Recomendación final
**El CRM está, en código, listo para sentirse 10/10 en staging**: S2+S3+S4 cubren
skeletons, dedup de identidad y el último *flash* del asistente; el resto ya
estaba bien optimizado. Falta únicamente **confirmarlo en navegador** (Oier) tras
redeploy. Mejora futura opcional (no necesaria): unificar AuthGate con el
resolutor cacheado.

**Veredicto: S4 PARCIAL SEGURO** — un arreglo de fluidez real (asistente) +
auditoría que confirma que el resto ya está optimizado; validaciones verdes;
smoke en navegador pendiente para declarar "10/10".
