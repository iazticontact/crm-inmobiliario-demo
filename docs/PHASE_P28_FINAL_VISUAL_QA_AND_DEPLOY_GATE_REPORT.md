# FASE P28 — QA visual/manual final + Deploy Gate

> **Fecha:** 2026-07-01 · Última pasada de release candidate sobre la base antes de extras. QA estática
> profunda + smoke de runtime real (servidor local contra Supabase real). **No se implementaron features.**
> Durante la QA se detectó un fallo móvil bloqueante → resuelto en **P28B** (ver
> `PHASE_P28B_MOBILE_RESPONSIVE_LOCKDOWN_REPORT.md`).

---

## 1. Qué se revisó
Dashboard, Clientes, Cartera/Inmuebles (Operaciones/Trámites/Comisiones), Calendario, Configuración,
Sidebar/Topbar, Asistente IA, seguridad/scans y el gate de despliegue. Método: lectura de componentes
(estados vacío/carga/error, copy, breakpoints) + **smoke de runtime** (build + `next start` contra la
Supabase real, curl a cada ruta base, y llamadas reales a las tools del Asistente).

## 2. Bugs visuales encontrados
- **BLOQUEANTE (móvil):** el sidebar desktop permanecía fijo en móvil y aplastaba el contenido. → **P28B**.
- Términos prohibidos visibles: ninguno nuevo (los de P27 ya corregidos; re-escaneo limpio).

## 3. Bugs funcionales encontrados
- Ninguno nuevo. El bug base del Asistente (tabla `documents` inexistente) ya se corrigió en P27.

## 4. Bugs corregidos
- Móvil (sidebar → drawer, main 100%, calendario Agenda por defecto) en **P28B**.

## 5. Runtime smoke (servidor local + Supabase real)
- **Rutas base → HTTP 200** (sin 500): `/login /dashboard /clients /calendar /assistant /opportunities /settings`
  y `/api/agent/diag`.
- **Asistente lee datos vivos por entidad** (`/api/agent/tool`, workspace con datos):
  `crm_read_query` clients/properties/opportunities/service_cases/tasks/calendar_events → **200** con datos;
  `get_calendar_summary(week)` → 200; `get_documents_metadata` → 200 (RUTINA.pdf real, metadata);
  `get_crm_overview` → 200.

## 6. Resultado mobile
Ver **P28B**: corregido globalmente (drawer móvil, contenido a ancho completo, navegación con hamburguesa,
sin scroll horizontal en páginas base). Pendiente QA humana en dispositivo real.

## 7. Resultado Asistente
Verificado en vivo (§5) + reglas de fases previas (error≠vacío, cuenta vacía, sin IDs, "No consta",
crisis/cost guard, expand caps, documentos = solo metadata). Sin regresiones.

## 8. Resultado seguridad/scans
- Escaneo de términos prohibidos **visibles** en páginas base: **limpio** (los 6 restos están en superficies
  internas gateadas por `NEXT_PUBLIC_NOWLABS_INTERNAL`: billing, WorkspaceTemplatesPanel, pestaña documentos).
- Sin secretos en repo/diff · sin `service_role` en frontend · panel debug del Asistente gateado a
  `dev`+flag (no expone UUIDs en prod) · `/api/agent/diag` protegido por secreto para conteos · n8n intacto.

## 9. Deploy gate preparado
Cuando exista dominio, ejecutar (este entorno es local, sin dominio real todavía):

```bash
node scripts/check-agent-deploy.mjs https://<DOMINIO_CRM> --workspace d0000000-0000-4000-8000-000000000001
```

Debe comprobar y cuadrar:
- `supabaseRef` == `ylhdbawrllqygfvllhdo` (misma Supabase que la UI).
- `toolVersion` == `2026-07-01.p24`.
- `commit` == último de `main` (exponer `SOURCE_COMMIT`/`NEXT_PUBLIC_COMMIT_SHA` en EasyPanel).
- **conteos reales** del workspace con datos (clients 9, events 12, properties 8, opportunities 8,
  service_cases 5, tasks 11) — coincidiendo con la UI.
- `config`: `agentToolSecret/serviceRole/n8nWebhook/**n8nSecret**` todos `true` (en prod `n8nSecret` debe ser
  true; en local es false por no tener el secreto del webhook v2).
- frontend y backend en el **mismo** commit/entorno.

Si algún conteo da 0 o `supabaseRef` difiere → mismatch de entorno (`CRM_BASE_URL`/envs/redeploy), no lógica.

## 10. Decisión final

### ✅ BASE VISUALMENTE APROBADA PARA EXTRAS
El fallo bloqueante (móvil) está resuelto (P28B); las rutas base renderizan (200); el Asistente lee datos
vivos por entidad; el copy base está limpio de términos prohibidos; seguridad y scans OK; validaciones
verdes. **Aprobada para empezar extras**, con dos verificaciones humanas/entorno residuales **no
bloqueantes**: (a) **QA en dispositivo real** (iPhone/Android, checklist de P28B §14), y (b) ejecutar el
**deploy gate** (§9) en el primer despliegue. Si la QA de dispositivo revelara un bug bloqueante, se abriría
un cierre puntual; a nivel de código/datos/seguridad/Asistente/responsive, la base está lista.

## Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ ·
`node --check scripts/check-agent-deploy.mjs` ✅ · git limpio · sin secretos · sin temp files · sin cambios n8n.
