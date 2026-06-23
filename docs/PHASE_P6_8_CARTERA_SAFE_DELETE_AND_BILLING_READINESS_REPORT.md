# FASE P6.8 — Cierre de Cartera: borrado seguro + preparación para facturación futura

> **Fecha:** 2026-06-23 · HEAD previo `ad622b3`. UI + helpers de borrado. **Sin migración**
> (las policies DELETE y las FKs ya existían y son correctas). Requiere redeploy.

## 1-2. Diagnóstico (auditoría BD, verificada)
- **Policies DELETE ya existen**: `opportunities_delete` y `service_cases_delete`, ambas
  `is_workspace_admin(workspace_id)` → admins/owners pueden borrar (RLS). **No service_role.**
- **FKs ON DELETE SET NULL**: `calendar_events/tasks/service_cases.opportunity_id` →
  `opportunities`; `calendar_events/tasks.case_id` → `service_cases`. Borrar **no destruye** citas/
  tareas/trámites ni bloquea; solo **desvincula** (pone la FK a NULL).
- **`entity_files` es polimórfica** (entity_type/entity_id, sin FK) → borrar un trámite **no**
  borra sus documentos automáticamente; hay que limpiarlos en la app para no dejar huérfanos.
- **Copy**: sin "lead"/"pipeline"/"expediente"/"service_case" visibles (solo internos: nombres de
  función, comentarios, `entity_type='service_case'`).

## 3. Opciones revisadas — etapas
Se **mantienen las 9** (Nueva · Contactado · **Cualificado** · Visita · Oferta · Negociación ·
Reserva · Cerrada · Perdida). **Decisión sobre "Cualificado": se mantiene** — es un paso de
cualificación estándar (separa "contactado" de "listo para visita"), aporta a una inmobiliaria
comercial y **un dato real del ejemplo lo usa**; quitarlo exigiría re-mapear datos por una ganancia
marginal. No se reduce por reducir.

## 4. Estados / edición rápida
Sin cambios respecto a P6.7: trámite con 5 estados primarios + fallback al valor actual si fuese
antiguo (`serviceCaseStatusLabel`); operación con labels P6.6. Sin "lead"/legacy raros.

## 5. Política de borrado de OPERACIÓN
- Icono **papelera** discreto en la fila de la operación (junto a editar).
- **Si tiene trámites vinculados → BLOQUEO** (toast claro): *"No puedes eliminar esta operación.
  Tiene N trámites vinculados. Elimina o reasigna los trámites primero."* (la FK es SET NULL, así
  que borrar los desvincularía en silencio — preferimos bloquear y avisar).
- **Si no tiene trámites → ConfirmDialog** destructivo: *"¿Eliminar «título»? El cliente y el
  inmueble vinculados no se eliminan."* → `deleteOpportunity` (RLS admin). **No** toca cliente ni
  inmueble; citas/tareas quedan (desvinculadas por la FK). Actividades = log histórico, se conservan.

## 6-7. Política de borrado de TRÁMITE (+ documentos)
- Icono **papelera** discreto en la card del trámite.
- **ConfirmDialog** que avisa de los documentos: *"¿Eliminar «título»? Se eliminarán también sus N
  documentos. Esta acción no se puede deshacer."*
- Al confirmar: **`deleteEntityFilesFor`** borra primero **cada documento** (objeto de Storage +
  fila `entity_files`, best-effort), luego **`deleteServiceCase`** borra el trámite. **Sin
  huérfanos** (verificado con datos desechables: trámite=0, docs=0, huérfanos=0). Si fallara borrar
  un objeto de Storage, su metadata se limpia igual (no queda fila huérfana; a lo sumo un objeto sin
  metadata, invisible y protegido por RLS — documentado, no rompe UI). No toca operación/cliente/
  inmueble ni otros trámites.

## 8. Preparación futura para FACTURACIÓN (documentado, NO implementado)
**No se construye facturación.** Semántica preservada para no cerrar la puerta:
- **Campos que alimentarán facturación**: `opportunities.value` (valor potencial),
  `opportunities.stage='won'` (operación **Cerrada**), `opportunities.expected_close_date`,
  `opportunities.client_id`, `opportunities.property_id`, `properties.price`.
- **Lo que NO es facturación** (y la UI nunca lo llama así): "valor potencial", "valor de cartera"
  (suma de precios listados), "precio del inmueble" → son **indicadores comerciales**, no ingresos,
  beneficio, comisión ni impuesto.
- **Módulo económico futuro (separado)**: tablas `invoices`, `invoice_items`, `expenses`, `taxes`,
  `commission_model`, `payment_status`, `fiscal_data`. Una operación **Cerrada** podrá **disparar**
  una factura/comisión, pero el cálculo económico vivirá aparte de Cartera.
- **Regla**: Cartera expone "valor potencial" y "operación cerrada"; **no** mezcla valor de inmueble
  con ingreso de agencia. Sin UI/tablas de facturación ahora.

## 9. Copy
Sin cambios necesarios (P6.6/P6.7 ya limpiaron "lead"/"pipeline"/"expediente"). Verificado por grep:
ningún término técnico visible.

## 10. Seguridad / RLS
DELETE protegido por RLS (`is_workspace_admin`); Storage por RLS workspace-scoped (P6.3/P6.4);
**sin service_role en frontend**; no cross-workspace; signed URLs efímeras. Si el usuario no es
admin, el borrado falla con mensaje claro ("Comprueba permisos de administrador").

## 11. Qué NO se tocó
n8n, Asistente, Dashboard, Clientes, Calendario, auth, fotos de inmueble, facturación (no existe),
datos reales fuera del ejemplo. Sin migración. Test de borrado con datos **desechables** (creados y
eliminados en la misma operación); 0 datos del ejemplo afectados.

## 12. Validaciones
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Sin secretos/PII; sin lead/pipeline/expediente
visibles.

## 13. Archivos
`src/lib/vertical-queries.ts` (`deleteOpportunity`/`deleteServiceCase`), `src/lib/entity-files.ts`
(`deleteEntityFilesFor`), `src/app/(saas)/opportunities/page.tsx` (papeleras + ConfirmDialogs +
handlers), este report.

## 14. Migraciones/RPC
**Ninguna.** Las policies DELETE y las FKs (SET NULL) ya estaban; el borrado de documentos se hace
desde el cliente (helper) porque Storage no se puede borrar desde SQL.

## 18. Qué probar
- **Operación sin trámites**: papelera → confirmar → desaparece; inmueble/cliente intactos; KPIs se
  actualizan.
- **Operación con trámites**: papelera → toast de bloqueo (no borra).
- **Trámite con documentos**: subir PDF → papelera → confirmar (avisa "N documentos") → desaparece;
  el documento ya no existe; operación/cliente/inmueble intactos; otros trámites intactos.
- Refrescar → persistencia. Fotos de inmueble siguen funcionando.

## Veredicto
**P6.8 COMPLETADO — CARTERA SEGURA Y LISTA PARA FUTURA FACTURACIÓN.** Borrado seguro de operación
(bloqueo si hay trámites) y de trámite (con limpieza real de documentos, sin huérfanos —
verificado), todo protegido por RLS y sin service_role; etapas revisadas (se mantiene "Cualificado"
con criterio); y semántica de "valor potencial / operación cerrada" preparada para un módulo
económico futuro **sin** construir facturación. Sin migración. Requiere redeploy.
