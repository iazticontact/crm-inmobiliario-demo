# FASE P32 — Product Completion Master Plan (arquitectura de extras antes de dominio)

> **Fecha:** 2026-07-02 · Mapa maestro para completar el producto **antes** de dominio final, añadiendo
> extras de forma controlada **sin romper la base cerrada** (P30/P31). **P32 NO implementa extras**: es
> diseño, dependencias, riesgos y orden. Se implementarán uno a uno, en fases con prompt propio.

---

## 1. Estado actual confirmado (base cerrada)
- **Rama:** `main` @ `57556e6` — limpio, `tsc`/`lint`/`build` verde. Base cerrada tras P27–P31.
- **Stack:** Next.js App Router + TS + Tailwind + Supabase (RLS) + n8n **Agent V2 read-only**.
- **Tablas reales (15):** `workspaces`, `workspace_members`, `workspace_settings`, `profiles`, `clients`,
  `properties`, `opportunities` (con `commission_*`), `service_cases`, `tasks`, `calendar_events`,
  `activities`, `entity_files`, `assistant_threads/messages/agent_memory`.
- **Buckets Storage:** `entity-files` (**privado**, 10 MB), `company-logos` (público, 2 MB),
  `profile-avatars` (público, 2 MB).
- **RLS (verificada):** 12 tablas base con RLS; helpers `current_workspace_ids()`,
  `current_workspace_role(workspace_id)`, `is_workspace_admin(workspace_id)`.
- **Roles (ya existen):** `workspace_members.role` (owner/admin/comercial/staff; hoy solo `owner` en datos);
  la RLS de `clients` ya distingue roles. **La infraestructura de roles YA está** — el extra es UI + afinado.
- **Escritura:** el frontend inserta bajo **RLS** (cliente de navegador autenticado: `createClient`,
  `createProperty`, etc.). El **Agent V2 es READ-ONLY**; las escrituras van por `preparedAction` +
  **confirmación** del operador. No hay write-tools en `/api/agent/tool`.
- **Contrato de tools:** `TOOL_CONTRACT_VERSION = 2026-07-01.p24`; `/api/agent/diag`; gate
  `scripts/check-agent-deploy.mjs`.
- **`entity_files.entity_type` CHECK:** `property | client | opportunity | service_case` → **habrá que
  ampliarlo** (a `invoice`) antes de guardar PDFs de factura.
- **Referencia externa analizada:** `auto-factor` (Lovable, TanStack/Vite) — **apto parcialmente**:
  reutilizable `calc.ts`/`pdf.ts`/`parsePrompt.ts`/`types.ts`/patrón repository/migración plantilla; NO el
  shell (TanStack/Nitro/localStorage/RLS por user_id). Ver el análisis en el chat de P29.

### Clasificación base vs extra
- **Base (cerrada, no tocar salvo bug):** Login/Auth, Dashboard, Clientes, Cartera/Inmuebles, Operaciones,
  Trámites, Tareas, Calendario, Comisiones, Asistente IA (lectura), Configuración, Perfil/avatar,
  Empresa/logo, Equipo básico, Sidebar/Topbar, Location Intelligence, RLS/multitenancy, gate.
- **Extra (a construir):** Facturación, Documentos avanzados, Notificaciones, Import/Export, Roles avanzados,
  Plantillas, y la **evolución del Asistente** para leer/preparar acciones sobre esos extras.

## 2. Mapa de extras (resumen)
| # | Extra | Núcleo | Depende de |
|---|---|---|---|
| 1 | **Facturación** | invoices + invoice_items + numeración atómica + PDF + Storage | clients, opportunities, entity_files (ampliar check) |
| 2 | **Documentos avanzados** | subida real por entidad + signed URLs + categorías | entity-files (existe), entity_type (+invoice) |
| 3 | **Notificaciones/recordatorios** | in-app (derivadas primero), leído/no leído | tasks/events/service_cases (+invoices) |
| 4 | **Import/Export CSV** | export (sin tablas) + import validado por lotes | clients/properties (RLS) |
| 5 | **Roles/permisos avanzados** | UI de roles + afinado de policies por módulo | workspace_members.role (existe) |
| 6 | **Plantillas comerciales** | workspace_templates (email/mensaje/documento) | (tabla nueva; menor prioridad) |
| 7 | **Asistente con extras** | leer facturas/docs/notifs + preparar con confirmación | todo lo anterior |

## 3. Orden de implementación recomendado (una fase = un extra)
> Regla: **BD/RLS primero → UI → Asistente → tests/E2E → docs → commit/informe.**

- **P33 — Facturación (modelo):** migración additiva `invoices` + `invoice_items` + emisor + RLS + **RPC
  atómica** de numeración. Sin UI. Cierre: gate de RLS (workspace A no ve facturas de B) + numeración
  concurrente.
- **P34 — Facturación (UI + PDF + Storage):** formulario emisor/cliente/líneas/impuestos, preview en vivo,
  PDF (jspdf, port de `auto-factor/pdf.ts`), guardar PDF en `entity-files` (ampliar `entity_type` a
  `invoice`), estados (borrador/enviada/pagada/vencida/cancelada), actividad. Mobile 16px.
- **P35 — Facturación (Asistente + QA):** `crm_read_query` entidad `invoices` (lectura) + `search`/resumen;
  `prepare_invoice` como `preparedAction` con **confirmación** (no escribe sin confirmar); evals + E2E.
- **P36 — Documentos avanzados:** des-gatear la pestaña Documentos del cliente/inmueble/operación/trámite,
  subida real a `entity-files`, **signed URLs** (bucket privado), categorías, eliminar con confirmación,
  actividad. `get_documents_metadata` ya lee `entity_files`.
- **P37 — Notificaciones/recordatorios:** primero **in-app derivadas** (tareas/citas/trámites/facturas
  vencidas) sin tabla; luego tabla `notifications` con leído/no leído + preferencias. Email **después**.
- **P38 — Import/Export CSV:** export cliente-side (clientes/inmuebles/operaciones/facturas); import con
  validación + **preview** + inserción por lotes bajo RLS + errores por fila + actividad.
- **P39 — Roles/permisos avanzados:** UI de gestión de roles (owner/admin/comercial/staff) + afinado de
  policies por módulo (quién factura/borra/invita/ve configuración) usando `current_workspace_role`.
- **P40 — Plantillas comerciales (si encaja):** `workspace_templates` (email/mensaje/documento) con
  variables; el Asistente prepara texto, no envía sin confirmación.
- **P41 — QA producto completo:** barrido tipo P27/P30 sobre todos los extras + mobile + seguridad + evals.
- **P42 — Release Candidate + dominio:** ejecutar el pack de P31 (envs, gate, smoke), cambio de dominio.

Cada fase incluirá: **objetivo · alcance · archivos probables · tablas/migraciones · riesgos · tests ·
validación · criterio de cierre.**

## 4. Riesgos principales (con mitigación / test / rollback)
| Riesgo | Mitigación | Test | Rollback |
|---|---|---|---|
| Romper RLS / fuga cross-workspace | RLS-first; `workspace_id in (select current_workspace_ids())` en cada tabla | probe: cuenta A no ve datos de B | migración additiva → revert código |
| **Facturas duplicadas / numeración** | `unique(workspace_id, series, number)` + **RPC atómica** `reserve_next_invoice_number` | test de concurrencia | additivo; no borra datos |
| `service_role` en frontend | prohibido; escrituras bajo RLS con cliente autenticado | scan en cada commit | n/a |
| Romper Asistente | leer-only por defecto; escrituras solo con `preparedAction`+confirmación | evals + E2E por entidad | revert de la tool |
| Tocar n8n sin querer | no se toca; el backend hace el trabajo | verificación read-only del workflow | restaurar env n8n |
| PDFs pesados | jspdf cliente + límites de líneas/imagen | tamaño del PDF | n/a |
| Permisos de Storage | bucket `entity-files` privado + signed URLs con caducidad | intento de acceso sin firma | políticas de bucket |
| Migración destructiva | solo **additiva** (`add column/table if not exists`) | list_migrations | additivo = no requiere revert BD |
| Mobile roto en formularios nuevos | inputs ≥16px (P28C) + shell drawer | QA 375px | CSS |
| `entity_type` CHECK bloquea PDF factura | ampliar el CHECK a `invoice` **antes** de insertar | insert de prueba | additivo |

## 5. Estrategia — Facturación (grounded en `auto-factor` + esquema real)
- **Tablas (additivas):**
  - `invoices(id, workspace_id, client_id, opportunity_id?, property_id?, series, number, status
    ['draft','sent','paid','overdue','cancelled'], currency, issue_date, due_date, payment_method,
    payment_reference, subtotal, tax_amount, irpf_amount, total, issuer_snapshot jsonb, client_snapshot
    jsonb, notes, created_by, created_at, updated_at, unique(workspace_id, series, number))`.
  - `invoice_items(id, invoice_id, workspace_id, position, description, quantity, unit_price, tax_rate,
    irpf_rate, created_at, updated_at)`.
  - **Emisor:** reutilizar `workspace_settings.metadata` (ya existe) o `invoice_issuer_settings(workspace_id)`.
  - **Cliente fiscal:** reutilizar `clients` (NIF/dirección en columna o metadata) — **no** duplicar clientes.
  - **Snapshots jsonb** de emisor/cliente al emitir (una factura pasada no cambia si luego editas emisor).
- **RLS:** lectura/escritura de miembros por `current_workspace_ids()`; borrado `is_workspace_admin`; "quién
  puede facturar" por `current_workspace_role in (owner/admin/comercial)`.
- **Numeración:** RPC `reserve_next_invoice_number(workspace_id, series)` con `update … returning`
  (atómica; evita duplicados en concurrencia).
- **Cálculo:** base imponible + **IVA por línea** + **IRPF** (retención autónomos; `auto-factor` NO lo tenía →
  añadir) + total. Formato es-ES. **Sin** Verifactu/TicketBAI/firma (legal/futuro; documentar límite).
- **PDF:** portar `auto-factor/pdf.ts` (jspdf + autotable; ya es puro y profesional) adaptado a los tipos del
  CRM; logo desde `company-logos`. Guardar el PDF en `entity-files` (`entity_type='invoice'`) + registrar en
  `activities` (creada/pagada/descargada).
- **Vínculos:** factura ↔ operación (`opportunity_id`) ↔ inmueble ↔ comisión (ya en `opportunities`).
- **Asistente:** lectura vía `crm_read_query` (entidad `invoices`, con relaciones por nombre) + `prepare_invoice`
  (usa `parsePrompt` como pre-parser) devolviendo `preparedAction` con **confirmación**; nunca emite sin confirmar.
- **Reutilizar de `auto-factor`:** `calc.ts`, `pdf.ts`, `parsePrompt.ts`, `types.ts`, la migración como
  plantilla (renombrar `user_id`→`workspace_id`). **No** reutilizar shell/rutas/localStorage.

## 6. Estrategia — Documentos avanzados
- Reutilizar `entity-files` (privado) + `get_documents_metadata` (ya lee `entity_files`). **Ampliar** el CHECK
  `entity_type` a `invoice`. Subida real por entidad (cliente/inmueble/operación/trámite/factura),
  **signed URLs** con caducidad (no URLs públicas), categorías/metadata, eliminar con confirmación, actividad.
  Des-gatear las pestañas Documentos (hoy internas). **Sin OCR** (fase futura).

## 7. Estrategia — Notificaciones/recordatorios
- **Fase 1 (in-app derivadas):** calcular al vuelo desde `tasks`/`calendar_events`/`service_cases`
  (vencimientos, citas próximas, trámites críticos) — **sin tabla**, sin spam. Badge en Topbar.
- **Fase 2:** tabla `notifications(workspace_id, user_id?, type, entity_type, entity_id, title, body,
  read_at, created_at)` + leído/no leído + preferencias. Email **solo si se decide** (n8n/Resend), después.
- Asistente: resume "qué vence / qué es crítico" con tools; no inventa.

## 8. Estrategia — Import/Export CSV
- **Export:** cliente-side desde las queries existentes (clientes/inmuebles/operaciones/facturas) → CSV. Sin
  tablas nuevas. Respetar RLS (solo el workspace activo).
- **Import:** subir CSV → **validación por fila** → **preview** (qué se creará/actualizará) → inserción por
  **lotes** bajo RLS → errores por fila → actividad. Sin `service_role`. Rollback: import como borrador o
  transacción por lote.

## 9. Estrategia — Roles/permisos avanzados
- La infra **existe** (`workspace_members.role` + `current_workspace_role` + `is_workspace_admin`; RLS de
  clients ya role-aware). El extra:
  - **UI de equipo:** ver/cambiar rol (owner/admin/comercial/staff), invitar (ya existe endpoint), revocar.
  - **Afinado de policies por módulo:** quién puede **facturar** (owner/admin/comercial), **borrar**
    (admin+), **invitar** (admin+), **ver configuración** (admin+). Additivo sobre las policies actuales.
  - **Asistente** respeta permisos (es read-only; para acciones preparadas, la ejecución la hace el usuario
    bajo su RLS/rol).
- **No romper** el modelo actual (owner por defecto; todo lo demás additivo).

## 10. Estrategia — Asistente IA con extras
- **Lectura (read-only, patrón actual):** añadir entidades a `crm_read_query` (`invoices`) y readers de
  documentos/notificaciones; relaciones por **nombre**, nunca ids; error≠vacío; "No consta" en faltantes.
- **Acciones (preparadas + confirmación):** `prepare_invoice`, `create_draft`, `prepare_message` (plantillas),
  `remind` (vencimientos) → todas devuelven `preparedAction`; la escritura la confirma el operador (o una
  ruta de escritura autenticada bajo RLS/rol). **Nunca** ejecuta acciones sensibles sin confirmación.
- **Reglas invariables:** usar tools (no memoria) · no inventar · no IDs · error≠vacío · respetar permisos ·
  registrar actividad · precio/comisión ≠ factura (P29) · búsqueda inmobiliaria no literal (P29/P30).

## 11. Reglas de implementación (obligatorias por fase)
1. **Migraciones additivas** (`add column/table if not exists`), nunca destructivas.
2. **RLS primero**, UI después, Asistente después.
3. **Tests/evals** + **E2E** contra Supabase real por fase.
4. **Mobile** (≥16px, sin overflow) en cada formulario nuevo.
5. **Docs** + informe por fase; **un commit por fase**.
6. **No n8n** salvo autorización expresa (diff quirúrgico, verificar activo/24 nodos/expresiones después).
7. **No secrets**, **no `service_role` en frontend**, **no temp files**.
8. **Un extra por fase** (no mezclar facturación/documentos/notificaciones).
9. **Gate + smoke** (P31) antes de dar por buena cualquier integración con deploy.

## 12. Checklist de avance del producto
- [x] **Base cerrada** (P27–P31): UI/mobile/Asistente/datos/RLS/release pack.
- [ ] **P33–P35 Facturación** (modelo → UI/PDF → Asistente/QA).
- [ ] **P36 Documentos avanzados.**
- [ ] **P37 Notificaciones/recordatorios.**
- [ ] **P38 Import/Export CSV.**
- [ ] **P39 Roles/permisos avanzados.**
- [ ] **P40 Plantillas comerciales (si encaja).**
- [ ] **P41 QA producto completo.**
- [ ] **P42 Release Candidate + dominio** (pack P31).

## 13. Validaciones (P32)
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ ·
`node --check scripts/check-agent-deploy.mjs` ✅ · git limpio · **sin cambios funcionales** (solo este doc).

## 14. Archivos tocados
| Archivo | Cambio |
|---|---|
| `docs/PHASE_P32_PRODUCT_COMPLETION_MASTER_PLAN.md` | **Nuevo** — este plan maestro |

## 15. Veredicto
**P32 COMPLETADO — MAPA MAESTRO DE PRODUCTO COMPLETO ANTES DE DOMINIO.** Estado base confirmado (main
limpio, RLS/roles/Storage/agent read-only auditados), extras mapeados con dependencias y riesgos, orden de
fases P33–P42 (BD/RLS→UI→Asistente→tests→docs, un extra por fase), y estrategias concretas ancladas en el
esquema real y en el análisis de `auto-factor`. **No se implementó ningún extra.** Siguiente paso sugerido:
**P33 — Facturación (modelo + RLS + numeración atómica)** con prompt propio y cerrado.
