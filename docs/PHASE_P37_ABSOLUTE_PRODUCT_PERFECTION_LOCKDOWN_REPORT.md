# FASE P37 — Absolute Product Perfection Lockdown (auditoría + bug hunt + cierre de calidad)

> **Fecha:** 2026-07-02 · Auditoría transversal **basada en evidencia** (escaneos reales del código + BD),
> no una pasada superficial. Se corrigió el **bug real más importante** (referencias legacy a la tabla
> inexistente `documents`), se verificó seguridad/RLS/aislamiento y se validó todo. **Sin n8n, sin secrets,
> sin service_role en frontend, sin cambios destructivos.** Honestidad: esto **reduce** fallos detectables;
> no garantiza «cero bugs».

---

## 33. Diagnóstico general
El producto viene de varias fases de lockdown (P26–P36F) y está, en general, **limpio y consistente**: RLS
activa en todas las tablas críticas, sin marca legacy visible al usuario, sin `service_role` en frontend, sin
`@ts-ignore`. El **hallazgo real** de esta fase: **referencias legacy a una tabla `documents` que NO existe**
(solo existe `entity_files`), que dejaban rotos varios lectores de documentos.

## 34. Mapa auditado (evidencia)
- **Tabla `documents`:** confirmado por `information_schema` que **no existe**; solo `entity_files`.
- **`from('documents')`** encontrado en 6 sitios (agent-tool-readers, assistant-tools, supabase-queries×2,
  API routes×2). Clasificados por reachability (ver §35–36).
- **Marca legacy** (`NowLabs`/`Copiloto`): solo en **comentarios/identificadores internos** (`nowlabsInternal`,
  `nowlabs_agent`, `nowlabs_admin`, nombres de función) y strings de detección de datos antiguos — **nada
  visible al cliente** (`brand.ts` lo garantiza).
- **`service_role`:** solo en **rutas de servidor** (`src/app/api/**`) y `supabase-admin.ts` (server-only), o
  en comentarios «NUNCA service_role». **Cero** en componentes de navegador.
- **`console.log`:** 12, todas en **rutas de API/servidor** (agent/tool, assistant/v2, webhooks…) — logging
  de servidor aceptable.
- **`@ts-ignore`:** **ninguno** (los 12 «TODO/expect-error» son `@ts-expect-error` o comentarios).
- **RLS:** `entity_files`(4), `clients`(5), `properties`(5), `opportunities`(5), `service_cases`(5),
  `tasks`(4), `calendar_events`(4), `activities`(3), `invoices`(4), `invoice_items`(2),
  `workspace_settings`(4) — **todas con RLS activada** y políticas.

## 35. Bugs críticos encontrados (y corregidos)
1. **`get_client_360` del Asistente leía `documents` (tabla fantasma).** El bloque de documentos del cliente
   siempre devolvía vacío (query erroraba en silencio). → **Corregido** a `entity_files`
   (`entity_type='client'`, `category='document'`), con las columnas reales (`file_name/mime_type/size_bytes`).
2. **`assistant-tools.ts` (agente OpenAI) `getDocuments` leía `documents`.** Siempre respondía «No hay
   documentos». → **Corregido** a `entity_files` + `metadata.kind`.
3. **Pestaña «Documentos» de la ficha de cliente rota.** Subía/listaba/borraba contra API routes que
   consultan `documents` (fantasma) → la pestaña no funcionaba. → **Reescrita** para usar
   **`EntityDocumentsManager`** (el mismo gestor real —`entity_files`, Storage privado, signed URLs, RLS—
   que ya usan inmuebles y trámites). Como ahora **sí funciona**, se **desoculta** la pestaña (antes gateada
   por `NOWLABS_INTERNAL`). Conversaciones/Facturación por-cliente siguen gateadas.

## 36. Bugs menores / deuda detectada (no bloqueante)
- **Código muerto legacy** que aún consulta `documents` pero **ya no es alcanzable**: API routes
  `clients/[id]/documents/*` (la ficha ya no las llama) y `listDocuments`/`createDocumentRecord` en
  `supabase-queries.ts` (sin llamadas). No producen error en runtime (nadie las invoca). **Recomendado
  eliminarlas** en un follow-up de limpieza (no se tocan ahora para no ampliar superficie sin validar).
- **Copy técnico** en un diagnóstico de Google Calendar (`settings`) menciona `service_role` al usuario
  interno — aceptable (ruta de diagnóstico interna), anotado como mejora futura.

## 37. Cambios implementados
- `agent-tool-readers.ts`: `get_client_360` documentos → `entity_files`.
- `assistant-tools.ts`: `getDocuments` → `entity_files` (+ `kind`).
- `clients/[id]/page.tsx`: pestaña Documentos → `EntityDocumentsManager`; eliminado el código muerto
  (estado/handlers/modal/tipo/formatBytes/imports) y **desocultada** la pestaña (ya funcional).

## 38. UI/UX/copy
Escaneo de copy: **sin marca legacy visible**, sin `workspace`/UUID/`storage_path` expuestos al cliente en
las zonas revisadas. La pestaña de documentos del cliente pasa a una UX real y consistente con inmuebles/
trámites (subir, listar por tipo, descargar por signed URL, borrar con confirmación).

## 39. Mobile
`EntityDocumentsManager` ya es responsive (mismo componente usado en inmuebles/trámites, inputs 16px). No se
detectaron regresiones en las zonas tocadas. **Honesto:** no se hizo una revisión pixel-a-pixel de cada ruta
a todos los anchos (no es verificable solo desde código); las fases P28/P28C ya endurecieron el móvil.

## 40. Asistente IA
- **Documentos:** ahora `get_client_360` y el tool de documentos leen `entity_files` (solo **metadata**,
  nunca contenido; sin OCR/embeddings) — frontera intacta.
- **Facturación:** **aislamiento P35 intacto** — `get_invoices_summary` sigue `not_available`, **0** queries
  a `invoices` en `agent-tool-readers`, sin `prepare_invoice`/`preparedAction`.
- **n8n:** intacto (no se tocó).

## 41. Facturación
Sin cambios en esta fase (cerrada en P33–P36F). Evals de facturación (calc/parser/PDF/summary) **re-ejecutados
→ PASS**. Aislamiento verificado.

## 42. Documentos / entity_files
Los tres lectores/gestores **live** ahora usan `entity_files` con `entity_type` correcto
(`client`/`property`/`service_case`/`invoice`). Bucket `entity-files` privado con **RLS (4 políticas)**;
descargas por **signed URL**. Frontera IA: solo metadata.

## 43. RLS / Supabase / Storage
Verificado (BD real): **RLS activada en las 11 tablas críticas** con políticas. Storage: `entity-files`
privado (signed URLs), logos/avatares públicos por diseño. Sin `service_role` en frontend. Sin acceso
cross-workspace (políticas `current_workspace_ids()`).

## 44. Seguridad / scans
- `service_role` en frontend: **0**. · `@ts-ignore`: **0**. · Secrets/`sk_live`: **0** en las zonas tocadas.
- `console.log` cliente: mínimo y no sensible; los relevantes son server-side.
- Sin URLs `localhost`/dominios hardcodeados en las rutas revisadas.

## 45. Tests / evals
- **Invoicing evals** (calc, parser, PDF, summary) → **PASS**.
- **tsc** (proyecto completo) → **OK**. **lint** `--max-warnings=0` → **OK**.
- **RLS BD** (query a `pg_policies`/`pg_class`) → RLS activa en tablas críticas.

## 46. Validaciones
`npx tsc --noEmit` **OK** · `npm run lint -- --max-warnings=0` **OK** · `npm run build` **OK** ·
`node --check scripts/check-agent-deploy.mjs` **OK** · evals **PASS** · escaneo de secretos **sin hallazgos**
· `git status` limpio tras commit.

## 47. Archivos tocados
`src/lib/agent-tool-readers.ts`, `src/lib/assistant-tools.ts`, `src/app/(saas)/clients/[id]/page.tsx`,
`docs/PHASE_P37_ABSOLUTE_PRODUCT_PERFECTION_LOCKDOWN_REPORT.md`.

## 48. Migraciones
**Ninguna.** Fix de código sobre tablas existentes (`entity_files`). Sin cambios de esquema ni de políticas.

## 49. Qué NO se hizo
- **No** se eliminaron las API routes/funciones muertas de `documents` (dead code inalcanzable; limpieza
  recomendada en follow-up para no ampliar superficie sin validar).
- **No** revisión pixel-a-pixel de mobile en todos los anchos (no verificable solo desde código).
- **No** se tocó n8n, Asistente-facturas, emails, OCR, embeddings, import/export, pasarelas, Verifactu.
- **No** reescrituras grandes ni módulos nuevos.

## 50. Commit / 51. Push
Ver `chore(p37)` en `main` (push a `origin/main`). Detalle tras publicar.

## 52. Pendientes honestos
- **Limpieza dead-code:** borrar `clients/[id]/documents` API routes + `listDocuments`/`createDocumentRecord`
  + tipos asociados (`WorkspaceDocument`/`DocumentPayload`) — inalcanzables tras P37.
- **QA mobile manual** a 320–430px de cada ruta (recomendado con dispositivo real).
- **Documentos avanzados** (versionado, tipos avanzados, vista previa inline) — fase futura si se prioriza.

## 53. Veredicto
**P37 COMPLETADO — ABSOLUTE PRODUCT PERFECTION LOCKDOWN: PRODUCTO AUDITADO CON EVIDENCIA, BUG REAL DE
DOCUMENTOS (TABLA FANTASMA `documents`) CORREGIDO EN LOS 3 PUNTOS ALCANZABLES Y PESTAÑA DE DOCUMENTOS DEL
CLIENTE FUNCIONAL SOBRE `entity_files`, RLS/AISLAMIENTO/SEGURIDAD VERIFICADOS Y TODO VALIDADO. ASISTENTE
AISLADO DE FACTURAS, N8N INTACTO. BASE LISTA PARA LA SIGUIENTE FASE.**
