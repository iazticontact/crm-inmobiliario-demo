# Phase 2E-2 — Full Smoke Test & Pre-Hostinger QA Report

> **Fecha:** 2026-06-15 · **HEAD probado:** `430c47e` (main, sincronizado con
> origin/main) · **Tag de referencia:** `demo-v1`
> **Modo:** QA senior + auditoría runtime + seguridad. **No se desplegó nada.**
> **No se implementaron features nuevas.** **No se tocó `.env.local`.**

---

## 0. Resumen ejecutivo / Veredicto

**VEREDICTO: SMOKE AUTOMÁTICO OK — CRM CORE LISTO PARA SMOKE DE NAVEGADOR /
STAGING; ASISTENTE IA BLOQUEADO HASTA AÑADIR UNA `OPENAI_API_KEY` REAL.**

- Toda la mitad **automatizable** del smoke está **verde**: build/lint/types,
  datos reales en Supabase, RLS, aislamiento por workspace, seguridad de
  secretos/legacy/service_role.
- La mitad **de navegador** (login real, ficha, mutaciones, asistente, demo)
  **requiere a Oier** y está **pendiente de ejecución** (checklist en §6–§13).
- **Único bloqueante real detectado:** `OPENAI_API_KEY` en `.env.local` es un
  **placeholder** (`PEGA_AQUI...`), no una clave real. El asistente IA intentará
  llamar a OpenAI y recibirá `401` → **el smoke del asistente (read + acciones)
  no se puede completar hasta poner una clave real.** El resto del CRM (core)
  **no depende de OpenAI** y puede probarse ya.

---

## 1. Entorno

- **Proyecto:** CRM Inmobiliario Demo
- **Repo:** `git@github.com:iazticontact/crm-inmobiliario-demo.git`
- **Rama:** `main` · **HEAD:** `430c47e feat(assistant): wire confirmed CRM update actions`
- **Stack:** Next.js 16.2.4 (Turbopack) + TypeScript + Tailwind + Supabase (RLS) +
  agente OpenAI + demo offline.
- **Supabase:** `crm-inmobiliario-demo` · ref `ylhdbawrllqygfvllhdo` ·
  `https://ylhdbawrllqygfvllhdo.supabase.co`
- **OS:** Windows 11 + OneDrive (rendimiento dev no representativo de prod Linux).

---

## 2. Estado Git inicial

```
## main...origin/main         (working tree limpio, sin cambios locales)
430c47e feat(assistant): wire confirmed CRM update actions   <- HEAD esperado ✓
8cdcebd feat(assistant): wire confirmed CRM actions end to end
32dccec docs(assistant): AI agent architecture, RT5.1b design and pre-Hostinger readiness
c93e32a feat(assistant): execute confirmed CRM actions (executor)
45c6957 feat(assistant): connect CRM read tools
Tags: demo-v1
Remote: origin = iazticontact/crm-inmobiliario-demo (correcto, no legacy)
```

Resultado: **OK** — rama correcta, HEAD esperado, árbol limpio, remoto correcto.

---

## 3. Env check seguro (sin imprimir valores)

`.env.local` **existe**, **gitignored**, **no trackeado**. Ref correcto presente,
ref legacy ausente.

| Variable | Estado | Nota |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SET | apunta a `ylhdbawrllqygfvllhdo` ✓ |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | SET | ✓ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | SET | ✓ |
| `SUPABASE_SERVICE_ROLE_KEY` | SET | solo server ✓ |
| `OPENAI_API_KEY` | **PLACEHOLDER** | ⚠️ `PEGA_AQUI...`, len=30, no `sk-` → **bloquea asistente** |
| `OPENAI_ASSISTANT_MODEL` | SET | ✓ |
| `OPENAI_AGENT_ENABLED` | SET (`true`) | ✓ |
| `AGENT_TOOL_SECRET` | **PLACEHOLDER** | ⚠️ `PEGA_AQUI...`, len=33 → reforzar antes de staging |
| `NEXT_PUBLIC_APP_URL` | SET | ✓ |
| `NEXT_PUBLIC_FORCE_OFFLINE_DEV` | SET (`false`) | ✓ no fuerza offline |
| `NEXT_PUBLIC_ENABLE_DEMO_DATA` | SET (`false`) | ✓ (demo por botón, no por fallback) |
| `NEXT_PUBLIC_SHOW_DEBUG_PANEL` | SET (`false`) | ✓ |
| `NODE_ENV` | SET (`development`) | ✓ (dev local) |
| `GOOGLE_CLIENT_ID/SECRET` | EMPTY | integración futura — OK vacío |
| `N8N_BASE_URL`, `N8N_WEBHOOK_SECRET`, `NOWCRM_WEBHOOK_SECRET` | EMPTY/PLACEHOLDER | integración futura — OK |

Resultado: **OK CON 1 BLOQUEANTE** — falta `OPENAI_API_KEY` real (Oier debe
ponerla; no se toca `.env.local` desde aquí) y conviene un `AGENT_TOOL_SECRET`
fuerte para staging.

---

## 4. Supabase read-only check (ref `ylhdbawrllqygfvllhdo`)

### Counts
| Tabla | Filas | Esperado | OK |
|---|---|---|---|
| clients | 8 | 8 | ✓ |
| properties | 7 | 7 | ✓ |
| opportunities (Operaciones) | 7 | ≥7 | ✓ |
| service_cases (Expedientes) | 5 | ≥5 | ✓ |
| tasks | 10 | ≥10 | ✓ |
| calendar_events | 8 | ≥8 | ✓ |
| activities | 14 | ≥14 | ✓ |
| profiles | 1 | ≥1 | ✓ |
| workspace_members | 1 | ≥1 | ✓ |
| workspaces | 1 | 1 | ✓ |

> Los counts coinciden **exactamente** con el seed → todavía **no hay datos
> creados desde navegador** (consistente con "smoke navegador pendiente").

### RLS y aislamiento
- **RLS ON en las 10 tablas**, todas con políticas (2–5 cada una). ✓
- **1 solo `workspace_id` distinto** en clients/properties/opportunities/
  service_cases/tasks/calendar_events/activities → **sin fuga entre workspaces**. ✓
- Único miembro: `role=owner`, `has_user=true`, `profile_linked=true`,
  workspace **"Demo Inmobiliaria"**. ✓

### Advisors de seguridad
- **0 ERROR**, **4 WARN** (aceptados):
  - 3× `SECURITY DEFINER` callable por `authenticated`
    (`current_workspace_ids`, `current_workspace_role`, `is_workspace_admin`) →
    son las funciones helper de RLS, uso intencionado.
  - 1× leaked-password-protection desactivado (ajuste de Auth, opcional;
    recomendable activarlo antes de producción cliente final).

Resultado: **OK**.

---

## 5. Validaciones automáticas

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npm run lint -- --max-warnings=0` | ✅ exit 0 |
| `npm run build` | ✅ exit 0 — compila en ~9.4s, TS ~12.2s, **46 rutas** generadas |

Resultado: **OK (verde total)**.

---

## 6. Smoke real básico — **PENDIENTE (Oier, navegador)**

> Requiere sesión real owner. Checklist a marcar:

1. [ ] Login real owner. 2. [ ] Dashboard carga (datos reales). 3. [ ] No
aparece modo demo. 4. [ ] No hay mocks. 5. [ ] Clientes carga. 6. [ ] Clientes
muestra datos reales. 7. [ ] "Ver ficha" funciona. 8. [ ] Ficha carga.
9. [ ] Contacto básico visible. 10. [ ] Operaciones vinculadas. 11. [ ]
Expedientes vinculados. 12. [ ] Tareas vinculadas. 13. [ ] Eventos/visitas.
14. [ ] Actividad. 15. [ ] Sin UUIDs visibles. 16. [ ] Sin errores en consola.
17. [ ] Logout funciona.

*Soporte de código verificado:* gate demo-primero + RLS client-side + empty
states (Data Reality Policy §2–§7). Pendiente confirmación visual.

---

## 7. Smoke mutaciones core en ficha — **PENDIENTE (Oier, navegador)**

- **Tareas:** [ ] crear · [ ] aparece · [ ] editar prioridad · [ ] editar fecha ·
  [ ] editar responsable (selector real, sin UUID) · [ ] completar · [ ] reabrir ·
  [ ] activity creada.
- **Operaciones:** [ ] crear · [ ] aparece · [ ] editar · [ ] mover etapa ·
  [ ] activity.
- **Expedientes:** [ ] crear · [ ] aparece · [ ] editar estado/prioridad ·
  [ ] activity.
- **Eventos:** [ ] crear · [ ] aparece · [ ] editar/reprogramar · [ ] activity.
- Comprobar: sin errores RLS · sin fallback a mocks · sin UUIDs · toasts ·
  estado local actualizado · **persiste al recargar**.

*Soporte de código:* RT4/RT4.2/RT4.3 (escrituras client-side con RLS, sin
service_role, selector responsable real, demo guard). Pendiente confirmación.

---

## 8. Smoke asistente IA READ — **BLOQUEADO (falta `OPENAI_API_KEY` real)**

Preguntas a probar (`/assistant`): resumen del CRM · operaciones abiertas ·
tareas pendientes · expedientes abiertos · eventos próximos · actividad reciente ·
cliente a seguir. **No ejecutable** hasta poner clave real: con el placeholder,
`/api/assistant/v2` considera OpenAI "configurado" (clave no vacía) e intentará
la llamada → **401 de OpenAI**.

---

## 9. Smoke asistente IA ACTIONS (cancelar) — **BLOQUEADO** (mismo motivo)

create_operation / create_service_case / move_operation_stage / update_task /
update_service_case por chat → card → **Cancelar** → no escribe. *Soporte:*
RT5.1 executor + RT5.1b/RT5.1b-2 (preparar→confirmar, RLS, demo no persiste).

---

## 10. Smoke asistente IA ACTIONS (confirmar) — **BLOQUEADO** (mismo motivo)

Las 5 acciones con **Confirmar** (debe escribir + activity + persistir).
`update_calendar_event` por chat sigue **diferido** (RT5.1b-3) → no probar.

---

## 11. Negative tests — **BLOQUEADO** (dependen del asistente)

Cliente inexistente / ambiguo / entidad inexistente / acción no soportada
("borra este cliente") / fecha ambigua. Esperado: no inventa, pide aclarar, no
escribe. *Soporte:* guardrail anti-invención (Data Reality Policy §8).

---

## 12. Smoke demo mode — **PENDIENTE (Oier, navegador)**

Logout → "Ver demo inmobiliaria" → dashboard/clientes/ficha demo → intentar
crear tarea/operación/expediente/evento y una acción del asistente. Esperado:
**no escribe en Supabase**, toast "Modo demo (solo lectura)", sin mezclar datos
reales, demo navegable. *Soporte:* Data Reality Policy §3.4, §4.

---

## 13. Performance / UX — **PENDIENTE (observación durante smoke)**

Referencia: dev en Windows/OneDrive puede ir lento (no representa prod Linux).
Build de producción rápido (~9.4s compile). Clasificar lentitudes como
"aceptable dev / lento no bloqueante / bloqueo / bug" durante la prueba.

---

## 14. Bugs encontrados

| ID | Sev | Ruta/área | Descripción | Estado |
|---|---|---|---|---|
| ENV-1 | **blocker (asistente)** | `.env.local` | `OPENAI_API_KEY` es placeholder `PEGA_AQUI`, no clave real → asistente IA inoperable (401 OpenAI). | **Abierto** — Oier debe poner clave real (no se toca env desde QA). |
| ENV-2 | medium (staging) | `.env.local` | `AGENT_TOOL_SECRET` es placeholder; gatea `/api/agent/tool`. Funciona si consistente, pero débil para staging. | **Abierto** — reforzar antes de staging. |
| SEC-1 | low | `auth` | Leaked-password-protection desactivado en Supabase Auth. | **Abierto** — activar antes de prod cliente final. |

No se detectaron bugs de código en build/lint/types ni en el esquema/RLS.

---

## 15. Bugs corregidos

Ninguno. No se requirió bugfix de código (todas las validaciones automáticas
verdes). Los hallazgos abiertos son de configuración de entorno (no de código).

---

## 16. Bugs pendientes

- **ENV-1 (blocker asistente):** poner `OPENAI_API_KEY` real en `.env.local` y
  reiniciar dev. Sin esto, §8–§11 no se pueden completar.
- **ENV-2 (medium):** generar `AGENT_TOOL_SECRET` fuerte para staging.
- **SEC-1 (low):** activar leaked-password-protection en Supabase Auth.
- **Smoke de navegador (§6, §7, §12):** ejecución manual pendiente de Oier.

---

## 17. Security pre-Hostinger

- **service_role solo server:** uso real confinado a route handlers / libs server
  (`supabase-admin.ts` documentado server-only y fail-safe a `null`;
  `/api/agent/tool`, `/api/team/*`, `/api/clients/[id]/documents/*`, webhooks).
  En `settings/page.tsx` y `supabase-queries.ts` solo aparece como **texto de
  ayuda / comentario**, no como uso client-side. ✓
- **Sin secretos hardcoded:** sin coincidencias `sk-…`, `sb_secret_`, JWT
  `eyJ…` en el código fuente. ✓
- **Sin legacy en código/env:** `ktsgfukjgldeylfzrayr` y `CostaDelSol` aparecen
  **solo en docs históricos** (y una referencia en comentario a un `.sql` de
  esquema histórico); ausentes de `.env.local` y de la lógica. ✓
- **Ficheros sensibles:** `.env.local`, `.env.local.backup_antiguo`, `.mcp.json`
  → existen, **gitignored**, **no trackeados**. ✓
- **Gates del agente:** READ tools por `AGENT_TOOL_SECRET`; CONFIRM exige sesión
  real + RLS. ✓ (ver ENV-2 sobre la fortaleza del secreto).

Resultado: **OK** (con ENV-2/SEC-1 como mejoras recomendadas antes de staging/prod).

---

## 18. Docs creados/actualizados

- **Creado:** `docs/PHASE_2E2_FULL_SMOKE_TEST_REPORT.md` (este documento).
- Pendiente de actualizar tras smoke de navegador: `PRE_HOSTINGER_PRODUCTION_READINESS.md`,
  `PHASE_2E2_NEXT_PHASES_ROADMAP.md`.

---

## 19. Próximo paso exacto para Oier

1. **Editar `.env.local`** (manualmente):
   - `OPENAI_API_KEY=<clave real sk-...>` (obligatorio para el asistente).
   - `AGENT_TOOL_SECRET=<secreto fuerte aleatorio>` (recomendado para staging).
2. **Arrancar:** `npm run dev -- --webpack` (o pedir a Claude que lo arranque).
3. **Ejecutar smoke de navegador** §6, §7, §12 (core + demo) — ya posibles ahora.
4. **Tras poner la clave OpenAI:** ejecutar §8–§11 (asistente read + acciones +
   negative tests).
5. **Reportar resultados** → se actualiza este informe y los readiness docs, y se
   decide veredicto final de staging.

---

## 20. Veredicto por bloque

| Bloque | Estado |
|---|---|
| Git / repo | ✅ OK |
| Env (secretos/refs) | ⚠️ OK salvo `OPENAI_API_KEY` placeholder (blocker asistente) |
| Supabase (datos/RLS/aislamiento/advisors) | ✅ OK |
| tsc / lint / build | ✅ OK |
| Seguridad (service_role/secrets/legacy/gitignore) | ✅ OK (mejoras ENV-2/SEC-1) |
| Smoke navegador core (real) | ⏳ PENDIENTE (Oier) |
| Smoke mutaciones core | ⏳ PENDIENTE (Oier) |
| Smoke asistente IA | ⛔ BLOQUEADO (falta clave OpenAI real) |
| Smoke demo mode | ⏳ PENDIENTE (Oier) |

**Conclusión:** el CRM **core** está técnicamente **listo para smoke de navegador
y staging**; el **asistente IA** queda **bloqueado** hasta una `OPENAI_API_KEY`
real. No hay bloqueos de código.
