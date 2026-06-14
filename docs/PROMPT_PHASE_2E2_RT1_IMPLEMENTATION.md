# Prompt listo — FASE 2E-2 RT1 (implementación runtime: Clients + Properties + Operaciones)

> Copia el bloque de abajo en una sesión nueva de Claude Code (Opus 4.8) cuando quieras EJECUTAR RT1.
> Antes de empezar, ten a mano (en Proton Pass, NO los pegues en el chat salvo que el agente los pida para `.env.local` y aun así nunca en docs/git): URL y publishable/anon key del proyecto `ylhdbawrllqygfvllhdo`, y el login del owner demo.

---

```
FASE 2E-2 RT1 — Integración runtime read-only: Clients + Properties + Operaciones

Modelo: Opus 4.8 Ultra Code
Effort: máximo / ultrathink
Modo: implementación runtime mínima y segura, preservando demo offline

CONTEXTO:
- Repo: git@github.com:iazticontact/crm-inmobiliario-demo.git, branch main.
- Supabase nuevo: crm-inmobiliario-demo, ref ylhdbawrllqygfvllhdo (org Demos Inmobiliarias Workspace).
- 2E-2 YA aplicado: 7 tablas CRM con RLS + seed (8 clients / 7 properties / 7 opportunities /
  5 service_cases / 10 tasks / 8 calendar_events / 14 activities) en el workspace demo
  d0000000-0000-4000-8000-000000000001. Owner demo vinculado (profile client_admin + member owner).
- La capa de datos ya consulta Supabase: src/lib/supabase-queries.ts y src/lib/vertical-queries.ts.
- Naming: tabla `opportunities` (técnico); UI debe mostrar "Operaciones" / "Pipeline comercial".
- Lee primero: docs/PHASE_2E2_RT0_RUNTIME_AUDIT.md y
  docs/PHASE_2E2_RT1_CLIENTS_PROPERTIES_OPERATIONS_PLAN.md.

OBJETIVO:
Conectar clientes, inmuebles y operaciones a Supabase real en READ-ONLY, con login real del owner,
sin romper la demo offline ni demo-v1.

RESTRICCIONES (PROHIBIDO):
- NO pegues secretos/keys en el chat ni en docs ni en git. El service_role nunca en el cliente
  ni en NEXT_PUBLIC_*.
- NO toques .env.local.backup_antiguo, .mcp.json, src/lib/agents/* (runNowLabsAgent/NOWCRM_*),
  n8n, Storage, Auth users, proyectos legacy.
- NO inicies billing/inbox/documents (son fases posteriores).
- NO rompas el cortocircuito demo (localStorage 'nowcrm-demo-mode' / useCurrentUser().isDemo) que va
  ANTES de cualquier query.
- NO apliques migraciones nuevas salvo que se justifique; esta fase es runtime.

PASOS:
1. .env.local (manual, lo edita el humano o lo guías): NEXT_PUBLIC_SUPABASE_URL=
   https://ylhdbawrllqygfvllhdo.supabase.co y la publishable/anon key del proyecto nuevo.
   Confirmar que YA NO apunta al legacy ktsgfukjgldeylfzrayr. No escribir la key en ningún archivo versionado.
2. Verificar (solo lectura) que el schema/seed están: clients=8, properties=7, opportunities=7.
3. Revisar y, si hace falta, ajustar (mínimo) las ramas "real" detrás del guard isDemo en:
   - src/app/(saas)/clients/page.tsx
   - src/app/(saas)/opportunities/page.tsx  (mostrar "Operaciones"/"Pipeline comercial")
   - src/app/(saas)/dashboard/page.tsx
   Reutilizar getClients / listProperties / listOpportunities / getWorkspaceFullOverview /
   getResolvedWorkspaceContext. No reescribir la capa de datos.
4. Mapping DB→UI: lead_score→leadScore; stage→etiqueta (REAL_ESTATE_PIPELINE); avatar/lastInteraction
   derivados; precios EUR. Etiqueta de módulo "Operaciones".
5. Preservar demo offline (mock-data.ts / demo/demo-real-estate.ts) en cada página.

PRUEBAS MANUALES:
- Login real owner → dashboard KPIs reales, clientes=8, inmuebles=7, operaciones=7.
- Demo offline (nowcrm-demo-mode=true) intacta vs demo-v1.
- RLS: no se ven datos de otro workspace.

VALIDACIONES (si tocaste src/*):
- npm run lint -- --max-warnings=0
- npx tsc --noEmit
- npm run build

ENTREGA:
- Resumen de cambios por archivo, confirmación de no tocar env/secrets/runtime prohibido,
  resultados de pruebas y validaciones, git status, y veredicto
  FASE 2E-2 RT1 COMPLETADA o BLOQUEADO con motivo.
- Commit/push SOLO si lint+tsc+build pasan y no hay secretos/.env/.mcp.json/runtime sospechoso.
  Mensaje sugerido: feat(crm): wire clients, properties and operaciones to Supabase (read-only).

RECUERDA: pensar despacio, reutilizar lo existente, no romper la demo, no exponer secretos.
```

---

## Notas para Oier (antes de lanzar el prompt)
- El cambio de `.env.local` es **manual** y contiene la **publishable/anon key** (pública, va al cliente) — NO el `service_role`. Guarda todo en Proton Pass.
- El proyecto legacy `ktsgfukjgldeylfzrayr` no se debe reutilizar; solo se sustituye la referencia en `.env.local`.
- Si algo falla con el login/workspace, revisar el bootstrap del owner en [PHASE_2E1_DEMO_USER_BOOTSTRAP.md](PHASE_2E1_DEMO_USER_BOOTSTRAP.md).
