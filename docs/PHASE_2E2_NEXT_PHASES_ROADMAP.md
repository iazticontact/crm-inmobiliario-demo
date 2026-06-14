# CRM Inmobiliario — Roadmap de próximas fases

**Fecha:** 2026-06-15 · **Base:** RT3 verificado (`be73f56`+)
**Política transversal:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md) aplica a todas.

Estado actual: lectura real conectada (dashboard, clientes, ficha profunda,
operaciones, calendario), demo offline intacta, datos reales verificados
(8/7/7/5/10/8/14). Lo que sigue, en orden de valor/riesgo:

## RT4 — Mutaciones controladas (siguiente)
Escrituras reales seguras desde la UI sobre lo ya leído:
- Crear/editar tareas, operaciones, expedientes y eventos (helpers de escritura
  ya existen en `vertical-queries.ts`/`supabase-queries.ts`).
- **Responsables (RT2.5 efectivo):** al crear/editar, selector de responsable
  desde `profiles`/`workspace_members`; mostrar nombre, nunca UUID; "Sin asignar".
- Confirmaciones, optimistic UI, toasts; bloqueo en modo demo (solo lectura).
- Registrar `activities` (`source: 'ui_manual'`) por cada mutación.

## RT5 — Assistant tools reales
- Conectar las tools del asistente a lecturas/escrituras reales con confirmación.
- Mantener guardrail anti-invención (no afirmar datos inexistentes).
- Sin promesas de WhatsApp/Meta hasta su fase.

## 2E-3 — Storage / documents
- Subida/listado/descarga real de documentos del cliente (bucket privado + RLS).
- La ficha ya tiene la pestaña Documentos preparada (demo bloquea subida).

## 2E-4 — Billing / invoices
- Facturas reales del workspace; PDF desde datos reales; estados es-ES.
- No mezclar con demo; empty states.

## 2E-5 — Inbox / conversations / messages
- Bandeja real (la pestaña "Conversaciones" de la ficha es hoy solo lectura).
- WhatsApp Business (Meta Cloud API) como sub-fase posterior, no antes.

## Transversal / deuda técnica
- RT2.5: nombres de responsable (necesita asignaciones reales).
- Limpieza opcional de `title` de actividades verticales ("Oportunidad" en
  data-layer, no visible en UI).
- Rendimiento dev en Windows/OneDrive: considerar mover el repo fuera de OneDrive
  (ver [PHASE_2E2_RT1_5_UX_PERFORMANCE_REPORT.md](PHASE_2E2_RT1_5_UX_PERFORMANCE_REPORT.md)).
