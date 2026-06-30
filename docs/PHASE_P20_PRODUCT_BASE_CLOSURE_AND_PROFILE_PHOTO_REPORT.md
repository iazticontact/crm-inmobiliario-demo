# FASE P20 — Cierre del producto base: foto de perfil real + hardening global

> **Fecha:** 2026-06-30 · Cierre profesional de la base del producto. Pieza estrella: **foto de perfil
> real** (subida desde galería/archivo, persistida, visible en el avatar arriba a la derecha y en
> Perfil), implementada con Supabase Storage seguro **sin upload falso, sin service_role, sin migración
> de `profiles`**. Además: limpieza de vocabulario visible, avatar global, capabilities/prompt
> actualizados y validaciones. El pendiente honesto de P19 (detail/expand 360) se documenta como P21.

## 1. Diagnóstico global

`profiles` no tenía `avatar_url`; el único bucket era `entity-files` (privado, RLS por workspace); el
Topbar mostraba iniciales (`currentUser.initials`); `buildCurrentUser` ya leía `user_metadata`. Conclusión
clave: la foto puede vivir en **auth `user_metadata`** (auto-editable vía `auth.updateUser`, sin
service_role ni migración de `profiles`), y solo hace falta un **bucket de Storage**.

## 2. Foto de perfil — diagnóstico

Necesario: bucket seguro + componente de subida + persistencia + avatar global + fallback iniciales,
todo real (el usuario explícitamente NO quiere humo).

## 3. Storage / RLS / migraciones

Migración mínima aplicada (vía Supabase MCP; registrada en `docs/supabase/p20_profile_avatars_bucket.sql`):
- **Bucket público `profile-avatars`** (avatar = baja sensibilidad; patrón estándar) con
  `file_size_limit = 2 MB` y `allowed_mime_types = jpeg/png/webp` a nivel de Storage.
- **RLS** en `storage.objects`: lectura pública; INSERT/UPDATE/DELETE solo en la carpeta propia
  (`(storage.foldername(name))[1] = auth.uid()`). Cada usuario gestiona **solo su** avatar.
- **Sin migración de `profiles`**, sin grants nuevos, sin service_role.

## 4. Foto de perfil — implementación

- `src/lib/profile-avatar.ts`: `validateAvatarFile` (tipo + 2 MB, pura/testeable), `uploadAvatar`
  (sube a `{uid}/{timestamp}.{ext}`, URL pública → `auth.updateUser({ data: { avatar_url, avatar_path }})`,
  borra la anterior best-effort) y `removeAvatar` (limpia metadata + borra el archivo).
- `src/components/AvatarUploader.tsx`: preview inmediata, botón Subir/Cambiar foto, Eliminar si hay foto,
  estado subiendo, errores humanos, `accept="image/png,image/jpeg,image/webp"`, input oculto accesible,
  forma circular con `object-cover` (sin recorte obligatorio), fallback a iniciales.

## 5. Topbar / avatar global

- `current-user.ts`: `CurrentUser.avatarUrl` (de `user_metadata.avatar_url`) + re-resolución en
  `USER_UPDATED` (tras `auth.updateUser`) para que el avatar se actualice **sin recargar**.
- `WorkspaceIdentityProvider`: mismo `USER_UPDATED` → el Topbar refleja el cambio en vivo.
- `Topbar`: muestra `<img>` con `object-cover` si hay `avatarUrl`, con **fallback a iniciales** si no hay
  o si la imagen falla (`onError`).
- No se mezcla avatar personal con logo de empresa (logo de empresa = pendiente, no se finge).

## 6. Configuración premium

`ProfileCard` integra el `AvatarUploader` arriba (foto + nombre editable). Configuración ya era SaaS
(P14/P16/P17): Perfil · Empresa · Equipo, sin "workspace", sin "Próximamente", sin chips, sin
notificaciones falsas. No se añade "Preferencias" porque no hay preferencias reales (cero humo).

## 7. Auditoría UI global / vocabulario

Escaneo de términos prohibidos visibles y correcciones:
- `clients/[id]` badge **"Lead" → "En seguimiento"** (alineado con el listado).
- `assistant` descripción de Inbox "clientes/leads" → "clientes y contactos".
- `automations` nodo "Nuevo lead" → "Nuevo cliente".
- `Topbar` "nuevos leads" → "nuevos clientes"; "Centro de notificaciones próximamente" → copy honesto
  sin "Próximamente".
- Resto de coincidencias son **identificadores internos** (clave de tab `pipeline` que se muestra como
  "Operaciones"; `status: 'lead'` como valor de BD; "Copiloto" solo en comentarios) o secciones
  **gateadas** por `NEXT_PUBLIC_NOWLABS_INTERNAL` (Lead Score) → no visibles en producción.

## 8. Auditoría de formularios

Sin cambios estructurales: los formularios (cliente/inmueble/tarea/cita/operación/trámite/empresa/
invitar) ya validan, persisten y actualizan estado local (P15–P19). El perfil añade la subida de foto
con validación y feedback.

## 9. Assistant hardening / capabilities

- `product-capabilities.ts` (`settings.profile`): ahora **canDo** incluye "Subir, cambiar o eliminar la
  foto de perfil"; retirado el "no hay foto (todavía)".
- Fallback local: Perfil "se puede subir/cambiar la foto"; se quita "foto de perfil" de la lista de
  cosas que NO debe inventar (ya existe; el logo de empresa sí sigue como inexistente).

## 10. Detail/expand 360 (pendiente de P19)

Auditado: implementarlo bien (detailLevel summary|detail|full + expand con joins de nombre por relación
+ límites de payload) requiere cambios en backend (joins/enriquecimiento) **y** en el schema/jsCode de
`crm_read_query` en n8n vivo. Para no arriesgar el cierre de base ni meter medio feature, **se difiere a
P21** con alcance claro. Hoy: cols por entidad + ids (sin UUID visible); el prompt ya pide resolver
vínculos y no inventar.

## 11. Tiempo real UI → Asistente

Intacto de P19: `/api/agent/tool` es `force-dynamic` (lectura siempre fresca). El cambio de nombre/foto
de perfil se refleja en la UI vía `USER_UPDATED` sin recargar.

## 12. Seguridad

RLS de Storage por carpeta `auth.uid()` (cada usuario solo su avatar); bucket con límite 2 MB + MIME;
**sin service_role en frontend**; **sin keys** (el avatar no usa env/secretos); validación MIME/tamaño
en cliente y en Storage; path con `{uid}/{timestamp}` (sin path traversal); `auth.updateUser` solo afecta
al propio usuario. Crisis/cost guard intactos.

## 13. Performance

Avatar: imagen ≤ 2 MB, `object-cover`, `onError` a iniciales; `URL.createObjectURL` revocado tras subir.
Derivaciones de cartera memoizadas (P19). Sin cargas nuevas innecesarias.

## 14. Accesibilidad

`AvatarUploader`: input file oculto con `accept`, botones con texto/`aria-label`, foto con `alt`.
Topbar avatar con `alt`. Resto de patrones accesibles previos intactos.

## 15. Mobile

`accept="image/*"` abre galería/cámara según el sistema; `AvatarUploader` es `flex` compacto;
ProfileCard reflowa (avatar arriba, nombre debajo); sin desbordes.

## 16. Tests/evals

- `src/lib/__evals__/profile-avatar.evals.ts` (**NUEVO**, `runAvatarEvals()`): acepta jpg/png/webp ≤ 2 MB,
  rechaza pdf/gif/vacío y > 2 MB, extensión por MIME. **Verificado 8/8** con script desechable.
- `assistant-coherence.evals.ts`: caso de Perfil actualizado (la foto SÍ se puede subir; permisos
  avanzados no).

## 17. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅.

## 18. Scans

service_role en frontend: 0 (solo comentarios) · keys/secretos en avatar: 0 · "Lead"/"Próximamente"
visibles corregidos · "workspace" visible: 0 (solo identificadores/código) · upload falso: 0 · sin temp
files.

## 19. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/lib/profile-avatar.ts` | **NUEVO** validación + subida/borrado de avatar (Storage + user_metadata) |
| `src/components/AvatarUploader.tsx` | **NUEVO** componente de foto de perfil |
| `src/components/ProfileCard.tsx` | integra el uploader (foto + nombre) |
| `src/components/Topbar.tsx` | avatar con fallback a iniciales; copy sin "leads"/"próximamente" |
| `src/lib/current-user.ts` | `avatarUrl` + re-resolución en USER_UPDATED |
| `src/components/WorkspaceIdentityProvider.tsx` | re-resolución en USER_UPDATED |
| `src/lib/product-capabilities.ts`, `src/lib/agents/nowlabs-main-agent.ts` | Perfil con foto real |
| `src/app/(saas)/clients/[id]/page.tsx`, `assistant/page.tsx`, `automations/page.tsx` | vocabulario visible |
| `src/lib/__evals__/profile-avatar.evals.ts` | **NUEVO** evals de avatar |
| `docs/supabase/p20_profile_avatars_bucket.sql` | registro de la migración aplicada |

## 20. Migraciones aplicadas

`p20_profile_avatars_bucket` (bucket público `profile-avatars` + límites + 4 políticas RLS). Aplicada en
producción vía Supabase MCP; registrada en `docs/supabase/`. **No** se tocó `profiles`.

## 21. Cambios n8n

**Ninguno.** La foto de perfil es 100% Supabase Storage + frontend; no requiere el agente ni n8n.

## 22–23. Commit / Push

Commit `feat(profile): foto de perfil real + hardening de cierre de base (P20)` → `origin/main`.

## 24. Deploy

Solo **redeploy del frontend**. La migración de Storage ya está aplicada en producción.

## 25. Checklist staging

- [ ] Perfil → Subir foto JPG / PNG / WebP → preview → se guarda → recargar → persiste.
- [ ] Intentar PDF → rechazado con mensaje humano; imagen > 2 MB → rechazada.
- [ ] La foto aparece arriba a la derecha (Topbar) sin recargar; al fallar la imagen, vuelve a iniciales.
- [ ] Cambiar foto (sustituye); Eliminar foto → vuelve a iniciales.
- [ ] Móvil: el botón abre galería/cámara; layout cómodo.
- [ ] Asistente: "¿puedo poner mi foto de perfil?" → sí (Perfil); no inventa logo/permisos.
- [ ] Configuración sin "workspace"/"Próximamente"/chips; cliente con badge "En seguimiento" (no "Lead").

## 26. Pendientes honestos

- **Logo de empresa**: no implementado (avatar personal ≠ logo; el logo requeriría su propio bucket/UX)
  → P21.
- **detail/expand 360** del asistente: diferido a P21 (alcance documentado).
- **Centro de notificaciones**: sigue siendo superficie vacía honesta (sin avisos reales todavía).

## 27. Veredicto

**P20 COMPLETADO — PRODUCTO BASE CERRADO PROFESIONALMENTE, PERFIL CON FOTO REAL Y CRM LISTO PARA
EXTRAS.** La foto de perfil es real (Storage seguro, RLS por usuario, sin service_role, sin upload
falso), persiste y se ve en el avatar global con fallback a iniciales; el vocabulario visible queda
limpio; capabilities/prompt reflejan la nueva realidad. `tsc`/`lint`/`build` en verde; validación de
avatar verificada 8/8. Base lista para empezar extras.
