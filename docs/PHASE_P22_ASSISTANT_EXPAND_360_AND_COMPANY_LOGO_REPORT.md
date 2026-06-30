# FASE P22 — Assistant Detail/Expand 360 + Logo de empresa real + Branding

> **Fecha:** 2026-07-01 · Cierre de los dos pendientes serios de la base: **(A)** el Asistente lee el CRM
> **conectado** con `detailLevel` (summary/detail/full) y `expand` (relaciones acotadas, con nombres
> legibles y sin UUIDs); **(B)** **logo de empresa real** (Supabase Storage seguro, distinto de la foto
> personal), visible en Empresa y en la tarjeta de cuenta del sidebar. Sin upload falso, sin
> service_role, sin tocar credenciales/connections/memory/webhook de n8n.

## 1. Diagnóstico global

Tras P21: `crm_read_query` resolvía nombres de FKs (client_name/property_title/operation_title) pero no
expandía relaciones hijas; el avatar personal existía pero faltaba el logo de empresa; Empresa no cerraba
el branding.

## 2. Diagnóstico Assistant 360

`/api/agent/tool` (force-dynamic, fresco) → handlers en `agent-tool-readers.ts`. `crm_read_query` ya
tenía entity/searchText/clientRef/filters/orderBy/orderDirection/limit/offset/range/from/to + nombres de
relaciones (P21). Hueco: sin `detailLevel`/`expand` para traer contexto conectado.

## 3. detailLevel

`detailLevel: summary | detail | full` (default `summary`). summary/detail = filas + nombres de
relaciones (P21). **full** = aplica el set de expand por defecto de la entidad. Se devuelve `detailLevel`
en la respuesta para trazabilidad.

## 4. expand

`expand: string[]` con **allowlist estricta**: `operation, property, client, service_case, tasks, events,
documents, activity`. Resuelve relaciones hijas por FK, con nombres legibles, sin ids ni campos técnicos.
Claves arbitrarias se descartan.

## 5. Entidades soportadas

Expansión por entidad principal:
- **clients** → operaciones, inmuebles, citas, tareas, trámites, documentos, actividad (por `client_id`).
- **properties** → operaciones, citas, tareas, trámites (por `property_id`).
- **opportunities** → citas, tareas, trámites (por `opportunity_id`).
- **service_cases** → tareas, citas (por `case_id`).
(FKs verificados contra el schema real vía Supabase MCP.)

## 6. Límites / payload

Protección dura: solo se expanden las **primeras 5** filas principales (`EXPAND_PRIMARY_CAP`), cada
relación trae como mucho **5** elementos (`REL_CAP`, orden por fecha desc), notas truncadas a 300 chars,
campos técnicos (workspace_id/deleted_at/metadata) eliminados, sin UUIDs visibles. Si hay más filas que
las expandibles, se marca `related_truncated: true` → el agente resume y ofrece profundizar.

## 7. Cambios backend

`crmReadQuery` (`agent-tool-readers.ts`): parse de `detailLevel`/`expand`, `applyExpand` (consultas por
FK acotadas, RLS por workspace, batch + `enrichRelationNames` para nombres), `sanitizeRelatedRow`. No N+1
descontrolado (acotado por caps). Compatibilidad total con inputs antiguos (sin detailLevel/expand = como
antes).

## 8. Cambios n8n

Microparche `n8n/patches/P22-crm-read-query-detaillevel-expand.txt` (nodo `crm_read_query`: inputSchema
+detailLevel/expand, jsCode reenvía). Aplicado por REST con autorización; `=`/`{{ }}`/credenciales/
conexiones/memory/webhook/otros nodos intactos; active=true, 24 nodos.

## 9. Cambios prompt / capabilities

Fallback local: bloque "FICHA COMPLETA / CONTEXTO CONECTADO" (usar detailLevel=detail/full + expand para
vínculos; mostrar nombres, nunca ids; si related_truncated, resumir). Capabilities/prompt de Empresa:
incluye el logo y aclara que es DISTINTO de la foto personal.

## 10. Evals Assistant

`assistant-expand.evals.ts` (**NUEVO**, `runExpandEvals()`): allowlist (acepta válidas, descarta
arbitrarias), caps (REL_CAP/EXPAND_PRIMARY_CAP ≤ 10), mapa de relaciones por entidad, y resolución
(full→set por defecto, expand explícito, descarte de "hack"). +3 fixtures de coherencia (cliente full,
inmueble full, logo vs foto).

## 11. Diagnóstico logo empresa

`profiles` sin campo de logo; bucket `entity-files` (privado) + `profile-avatars` (público, P20).
`workspace_settings.metadata` (jsonb, auto-editable por miembros) sirve para la URL sin migración de
tabla. Sidebar tiene tarjeta de cuenta con iniciales de empresa.

## 12. Storage / RLS logo

Bucket público **`company-logos`** (migración `p22_company_logos_bucket`, registrada en
`docs/supabase/`): límite 2 MB, MIME jpeg/png/webp (**no SVG**, por seguridad). RLS: lectura pública;
escritura solo para **miembros del workspace** (`(storage.foldername(name))[1] in current_workspace_ids()`).
Sin service_role.

## 13. Implementación logo

- `src/lib/company-logo.ts`: `uploadCompanyLogo` (valida, sube a `{workspaceId}/{ts}.{ext}`, URL pública
  → `workspace_settings.metadata.company_logo_url/_path/_updated_at`, borra el anterior) y
  `removeCompanyLogo`. Reutiliza la validación de imagen del avatar.
- `src/components/CompanyLogoUploader.tsx`: preview, cambiar/eliminar, loading, errores humanos, forma
  **cuadrada redondeada** con `object-contain` (no deforma), fondo neutro, fallback a iniciales de empresa.
- El "Guardar" de Empresa relee la metadata más reciente para **no pisar el logo**.

## 14. Configuración / branding

Empresa: logo arriba + nombre comercial, descripción, teléfono, email, web, actividad fija Inmobiliaria.
Subtítulo humano ("Estos datos ayudan a identificar tu cuenta…"). Sin "workspace", sin roadmap, sin chips.

## 15. Avatar personal vs logo empresa

- **Foto de perfil** (Perfil): personal, redonda, en el Topbar arriba a la derecha.
- **Logo de empresa** (Empresa): identifica la cuenta, cuadrado `object-contain`, en la **tarjeta de
  cuenta del sidebar** (no sustituye el avatar personal del topbar, no es el icono del producto).
- El asistente sabe distinguirlos (capabilities + prompt).

## 16. Seguridad

Sin secrets/keys; sin service_role en frontend; RLS de Storage por workspace (logo) y por usuario
(avatar); MIME/tamaño en cliente y bucket; **no SVG**; path `{id}/{ts}` (sin traversal); APIs
autenticadas; expand filtra por `workspace_id`; sin UUIDs visibles; n8n credenciales intactas.

## 17. Performance

Expand acotado (≤5×5) — no payload gigante; full no se usa por defecto en listados; logo/avatar ≤ 2 MB
`object-contain`/`object-cover`; el sidebar carga el logo con 1 query best-effort; batch joins para
nombres.

## 18. Mobile / accesibilidad

Uploaders con input file accesible (`accept`, `aria-label`), botones como `button` con `focus-visible`;
Configuración responsive; logo cuadrado no se deforma.

## 19. Revisión global

Pulido quirúrgico; sin términos prohibidos visibles nuevos; avatar/logo con fallback (no imagen rota).

## 20. Tests / evals

`assistant-expand.evals.ts` (nuevo) + 3 fixtures de coherencia. Validación de logo = misma que avatar
(cubierta por `profile-avatar.evals.ts`). Suites previas intactas.

## 21. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅.

## 22. Scans

Sin "workspace"/"Próximamente"/"completed"/"Copiloto"/"expediente" visibles · sin UUID visible (expand
sin ids) · sin service_role frontend · sin keys · **SVG rechazado** · sin upload falso · sin temp files
en el repo.

## 23. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/lib/agent-tool-readers.ts` | `detailLevel` + `expand` (allowlist, caps, applyExpand, sanitize) |
| `src/lib/company-logo.ts` | **NUEVO** subida/borrado de logo (Storage + workspace_settings) |
| `src/components/CompanyLogoUploader.tsx` | **NUEVO** componente de logo |
| `src/components/WorkspaceProfileCard.tsx` | logo en Empresa + save que preserva el logo |
| `src/components/Sidebar.tsx` | logo en la tarjeta de cuenta (fallback iniciales) |
| `src/lib/agents/nowlabs-main-agent.ts`, `src/lib/product-capabilities.ts` | detailLevel/expand + logo vs foto |
| `src/lib/agents/__evals__/assistant-expand.evals.ts` | **NUEVO** evals |
| `src/lib/agents/__evals__/assistant-coherence.evals.ts` | +3 fixtures |
| `n8n/patches/P22-...txt`, `docs/supabase/p22_company_logos_bucket.sql` | microparche n8n + registro migración |

## 24. Migraciones

`p22_company_logos_bucket` (bucket público + límites + 4 políticas RLS). Aplicada vía Supabase MCP;
registrada en `docs/supabase/`. **No** se tocó `profiles` ni `workspace_settings` (solo metadata jsonb).

## 25–26. Commit / Push

Commit `feat(assistant+branding): detailLevel/expand 360 + logo de empresa real (P22)` → `origin/main`.

## 27. Deploy

- **Frontend/backend:** redeploy (expand 360 + logo).
- **n8n:** aplicado el microparche de `crm_read_query` (detailLevel/expand).

## 28. Checklist staging

- [ ] Asistente: "ficha completa de [cliente] con operaciones/citas/tareas/trámites" → trae relaciones
      con NOMBRES, sin ids; si hay muchas, resume (related_truncated).
- [ ] Asistente: contexto de un inmueble (operaciones/visitas/tareas). Campos ausentes → "No consta".
- [ ] Empresa: subir logo jpg/png/webp → preview → guarda → recargar persiste; intentar PDF/SVG/>2MB →
      rechazado; cambiar/eliminar logo.
- [ ] El logo aparece en la tarjeta de cuenta del sidebar; el Topbar sigue mostrando la **foto personal**.
- [ ] Editar datos de Empresa y Guardar NO borra el logo.
- [ ] Móvil: subida de logo abre galería/cámara; layout correcto.

## 29. Pendientes honestos

- **Expand bidireccional total** (p. ej. trámite→documentos por entity_files, actividad por
  entity_type/entity_id en inmuebles): cubierto lo de FK directa; los vínculos por tabla puente quedan
  como mejora futura.
- **Color de marca / branding avanzado**: no implementado (no inventar personalización inexistente).
- **Centro de notificaciones**: superficie vacía honesta.

## 30. Veredicto

**P22 COMPLETADO — ASISTENTE IA 360 CON RELACIONES COMPLETAS Y LOGO DE EMPRESA REAL.** El Asistente lee
el CRM conectado con `detailLevel`/`expand`, relaciones acotadas y con nombres legibles, sin ids ni humo;
y la empresa tiene **logo real** (Storage seguro, RLS por workspace), separado de la foto personal y
visible donde aporta. `tsc`/`lint`/`build` en verde. Base lista para empezar extras.
