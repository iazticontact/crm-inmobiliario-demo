# Phase 2E-2 — Full Smoke Test & Pre-Hostinger QA Report

> **Fecha:** 2026-06-15 · **HEAD probado:** `430c47e` (main, sincronizado con
> origin/main) · **Tag de referencia:** `demo-v1`
> **Modo:** QA senior + auditoría runtime + seguridad. **No se desplegó nada.**
> **No se implementaron features nuevas.** **No se tocó `.env.local`.**

---

## SESIÓN 2 — Smoke navegador con OpenAI live (2026-06-15, HEAD `07b7b8a`)

> Actualización tras resolver el bloqueante de Sesión 1 y aplicar el polish de
> navegación (H1/H2).

**Cambios desde Sesión 1:**
- `OPENAI_API_KEY` **real** y `AGENT_TOOL_SECRET` **fuerte** ya en `.env.local`
  (verificado sin imprimir valores: present=true, placeholder=false) → **el
  asistente IA ya NO está bloqueado**.
- Navegación cliente simplificada (commit `07b7b8a`): WhatsApp oculto del nav
  cliente; labels `Operaciones`/`Calendario`.

**Prechecks automáticos (verde):**
- Git: HEAD `07b7b8a`, `main` sincronizado, árbol limpio.
- Env: ref `ylhdbawrllqygfvllhdo` OK, legacy ausente, `.env.local` no trackeado,
  OpenAI + agent secret presentes (no placeholder).
- `tsc --noEmit` ✅ · `lint --max-warnings=0` ✅ · `build` ✅ (46 rutas).
- **Dev server confirmado arriba:** `http://localhost:3000` responde **HTTP 200**
  en `/login` (sin error-overlay de Next). *(Un `next dev` ya corría — PID 5356 —
  no se tocó; un segundo intento se descartó solo, comportamiento esperado.)*

**Baseline Supabase (pre-smoke, para verificar persistencia tras mutaciones):**
`opportunities=7 · service_cases=5 · tasks=10 · calendar_events=8 · activities=14`.
Tras FASE D/F (crear operación/expediente/tarea/evento) estos counts **deben
subir** y `activities` crecer con cada acción.

**Estado de las fases de navegador (las ejecuta Oier):**
| Fase | Estado |
|---|---|
| C — Smoke modo real (nav/ficha/listados) | ⏳ pendiente ejecución navegador |
| D — Mutaciones core en ficha | ⏳ pendiente ejecución navegador |
| E — Asistente READ | ⏳ pendiente (ya posible, OpenAI live) |
| F — Asistente ACCIONES (cancelar/confirmar) | ⏳ pendiente (ya posible) |
| G — Negative tests | ⏳ pendiente |
| H — Demo mode | ⏳ pendiente |

**Veredicto Sesión 2:** **SMOKE EN CURSO — prechecks + arranque OK; pendiente de
la ejecución de navegador por Oier** (checklist abajo §6–§17). Sin bloqueantes
técnicos conocidos; el asistente ya es probable end-to-end con la clave real.

---

## SESIÓN 10 — H8: persistencia real del copiloto + personalidad + UX (2026-06-16)

Tablas dedicadas **`assistant_threads`/`assistant_messages`** (migración
`20260616_2e2_assistant_threads.sql`, **aplicada**) con RLS por workspace + GRANT
a authenticated; lib `assistant-threads.ts` (client RLS); el copiloto ahora
**crea/lista/reabre hilos y persiste mensajes reales** (sobreviven al refresh),
SIN tocar conversations/messages de Inbox ni el cerebro (v2/confirm). Personalidad
del agente (`nowlabs-main-agent.ts`) y fallback (`ai.ts`) más **majo/cercano** con
emoji ligero. UX: empty state + placeholder más premium. Validaciones verdes (46
rutas). Detalle:
[PHASE_2E2_H8_ASSISTANT_PERSISTENCE_PERSONALITY_REPORT.md](PHASE_2E2_H8_ASSISTANT_PERSISTENCE_PERSONALITY_REPORT.md).

**Veredicto Sesión 10:** asistente con persistencia real + personalidad; pendiente
smoke navegador (consulta → refresh persiste → acción confirmada).

---

## SESIÓN 9 — H7: asistente desacoplado de public.conversations (2026-06-15, HEAD `2fb9625`+)

**BUG asistente RESUELTO.** En `/assistant`, "Nueva consulta"/enviar mensaje
fallaba con **PGRST205 (public.conversations no existe)** porque la página
persistía conversación+mensajes en tablas diferidas (Inbox/WhatsApp). **Fix
(solo `assistant/page.tsx`, flag `ASSISTANT_CONVERSATION_PERSISTENCE=false`):** el
copiloto corre como **sesión LOCAL en memoria** (reusa la maquinaria offline);
gateados `ensureRealConversation`/`createDemoConversation`/`appendAssistantMessage`/
`sendMessage` para no insertar en conversations/messages. El cerebro
(`/api/assistant/v2` + `/api/assistant/confirm`) y la **persistencia de acciones
confirmadas** (operaciones/tareas + activity vía RLS) **intactos**. Sin tocar n8n/
Inbox/WhatsApp/schema. Modo Inbox ya oculto al cliente (H4). Validaciones verdes
(46 rutas). Detalle:
[PHASE_2E2_H7_ASSISTANT_CONVERSATION_RUNTIME_FIX_REPORT.md](PHASE_2E2_H7_ASSISTANT_CONVERSATION_RUNTIME_FIX_REPORT.md).

**Veredicto Sesión 9:** asistente desbloqueado para smoke. Falta verificación en
navegador (Oier): consulta + acción confirmada.

---

## SESIÓN 8 — H6D: identidad + AuthGate hardening (2026-06-15, HEAD `128a74b`+)

**Identidad:** el nombre mostrado ("Oier Dunabeitia") sale de
`public.profiles.full_name`, valor que escribió Claude en H6 derivándolo del email
(`odunabeitia14`). Auth no tiene nombre (`raw_user_meta_data={email_verified}`);
**no hay hardcode en frontend** (0 coincidencias). Fuente canónica = profiles.full_name
→ email → "Usuario". Se mantiene (regla: si está en profiles, dejarlo; editable).
**AuthGate hardening:** antes trataba cualquier `profileError` como "sin workspace"
(enmascaró el 42501 de H6B y cerraba sesión). Ahora distingue: error de
permiso/conexión → `?error=access_check` (sin signOut, log dev-only) vs sin
profile/workspace real → `?error=no_profile` (+signOut). Login añade toast
access_check. Validaciones verdes. Detalle:
[PHASE_2E2_H6D_IDENTITY_AND_AUTHGATE_AUDIT_REPORT.md](PHASE_2E2_H6D_IDENTITY_AND_AUTHGATE_AUDIT_REPORT.md).

**Veredicto Sesión 8:** identidad explicada y AuthGate endurecido. Smoke navegador
sigue pendiente (counts = baseline).

---

## SESIÓN 7 — H6: vínculo workspace + login premium (2026-06-15, HEAD `4e84a43`+)

**BLOQUEANTE DE LOGIN RESUELTO.** Diagnóstico (Supabase MCP, read-only): único
usuario Auth = `odunabeitia14@gmail.com` (confirmado, Auth OK) pero **sin profile
ni workspace_member** (`profiles`/`workspace_members` estaban vacías; el seed se
borró por FK ON DELETE CASCADE al eliminarse un usuario Auth previo). **Fix
(idempotente, server-side):** creado profile (`client_admin`, workspace=Demo) +
workspace_member (`owner`) para ese usuario en **Demo Inmobiliaria**. Verificado.
**Login UI** rediseñado (portada premium honesta, sin WhatsApp/facturación/
documentación; microcopy sin-workspace claro; demo copy). Sin tocar
schema/migraciones/contraseñas/.env. Validaciones verdes (46 rutas). Detalle:
[PHASE_2E2_H6_LOGIN_WORKSPACE_AND_LOGIN_POLISH_REPORT.md](PHASE_2E2_H6_LOGIN_WORKSPACE_AND_LOGIN_POLISH_REPORT.md).

**Veredicto Sesión 7:** login real **desbloqueado** (usuario vinculado). Oier:
reiniciar dev + hard refresh + login con `odunabeitia14@gmail.com` (pass ≥8) →
**smoke navegador real**. Counts CRM aún = baseline (smoke sin ejecutar).

---

## SESIÓN 6 — H5: settings final cleanup (2026-06-15, HEAD `dd31b48`+)

**H5 COMPLETADO** (solo `settings/page.tsx`, gateado por `NOWLABS_INTERNAL`, sin
backend): ocultada al cliente la **tarjeta WhatsApp** completa y los toggles de
notificación dormidos **Facturas vencidas** y **Conversaciones urgentes**;
quedan **Nuevos leads** y **Resumen diario IA** con copy suavizado. Settings
cliente ya no muestra Google OAuth / Inbox Agent / WhatsApp / facturación.
Validaciones verdes (46 rutas). Detalle:
[PHASE_2E2_H5_SETTINGS_FINAL_CLEANUP_REPORT.md](PHASE_2E2_H5_SETTINGS_FINAL_CLEANUP_REPORT.md).

**Veredicto Sesión 6:** UI cliente honesta y completa. **No quedan polish
pendientes.** Único siguiente paso: **smoke navegador real** (Oier: reiniciar dev
+ hard refresh + password ≥8 + probar). Counts aún = baseline (smoke sin ejecutar).

---

## SESIÓN 5 — H4: coherencia UI profunda (2026-06-15, HEAD `2ac7446`+)

Limpieza profunda (gateada por `NOWLABS_INTERNAL`, sin tocar backend/schema):
- **Settings:** ocultadas al cliente las tarjetas dormidas "Mi Google Calendar"
  (+ "Autorizar con Google"), calendario de equipo Google e "Inbox Agent /
  Respuesta automática". WhatsApp ya estaba suavizada.
- **Asistente:** modo Inbox/Conversaciones oculto al cliente (default ya era
  Copiloto), badge "WhatsApp siguiente fase" oculto, descripción sin "/inbox".
- **Calendar:** sin cambios (su render no muestra estado Google; el "Comprobando
  Google" era de Settings).
- Dashboard/ficha/operaciones ya coherentes desde H3.
Validaciones verdes (46 rutas). Detalle:
[PHASE_2E2_H4_DEEP_UI_COHERENCE_REPORT.md](PHASE_2E2_H4_DEEP_UI_COHERENCE_REPORT.md).

**Veredicto Sesión 5:** UI coherente y honesta para cliente; smoke navegador
**sigue pendiente de ejecución** (Oier: reiniciar dev + password ≥8 + probar).

---

## SESIÓN 4 — H3: login triage + limpieza UI dormante (2026-06-15, HEAD `bd1f5a4`+)

**Login "Invalid API key" RESUELTO en diagnóstico:** las claves de `.env.local`
son **válidas** (PUBLISHABLE y ANON → HTTP 200 contra Supabase; publishable
coincide con dashboard). Causa real = **dev server rancio** (arrancado antes de
corregir la key; `NEXT_PUBLIC_*` se inlinean al arrancar). **Fix operativo (Oier):
reiniciar `next dev` + hard refresh.** Código: mapeo de error de login mejorado
(nunca muestra "Invalid API key" crudo). Password: se mantiene mínimo 8; Oier
resetea el usuario de prueba a ≥8 en Supabase Auth.

**Limpieza UI dormante (gateada por `NOWLABS_INTERNAL`, reversible, sin borrar
código):** ocultos tiles dashboard (Cobros/WhatsApp), tabs ficha (Documentos/
Conversaciones/Facturación), chips asistente (factura/cobros→operaciones/
expedientes); título `Gestión`→`Operaciones`. **Diferido a H4:** settings deep,
calendar Google status, modo Inbox del asistente. Validaciones verdes. Detalle:
[PHASE_2E2_H3_AUTH_AND_DORMANT_UI_CLEANUP_REPORT.md](PHASE_2E2_H3_AUTH_AND_DORMANT_UI_CLEANUP_REPORT.md).

**Veredicto Sesión 4:** smoke navegador **sigue pendiente de ejecución** (counts
aún = baseline); ahora **desbloqueado** (login arreglable con reinicio + password
≥8). Tras reiniciar dev y resetear password, Oier puede correr el smoke completo.

---

## SESIÓN 3 — Re-validación + persistencia + plan staging (2026-06-15, HEAD `2ccfa76`)

**Prechecks automáticos (verde):** git `2ccfa76` limpio/sincronizado · env OK
(OpenAI real + agent secret, no placeholder, no legacy, no trackeado) ·
`tsc` ✅ · `lint` ✅ · `build` ✅ (46 rutas) · dev server `:3000` responde HTTP 200.

**Certificación de persistencia (FASE H) — read-only:**
counts actuales = `opportunities 7 · service_cases 5 · tasks 10 ·
calendar_events 8 · activities 14 · clients 8` → **IDÉNTICOS al baseline**.
➡️ **Conclusión objetiva: la smoke de mutaciones (FASE D) y las acciones-confirmar
del asistente (FASE E) AÚN NO se han ejecutado en navegador** (si se hubieran
hecho, estos counts y `activities` habrían subido). No hay leakage; un único
workspace.

**Plan de staging:** creado [EASYPANEL_STAGING_DEPLOYMENT_PLAN.md](EASYPANEL_STAGING_DEPLOYMENT_PLAN.md)
(VPS Hostinger + EasyPanel, n8n separado/dormido, env names sin valores, pasos,
smoke post-deploy, rollback, seguridad).

**Estado de las fases de navegador:** C/D/E/F/G **pendientes de ejecución por
Oier** (la app está lista y arriba; nada técnico lo bloquea).

**Veredicto Sesión 3:** **SMOKE TÉCNICO OK — pendiente la ejecución de navegador
por Oier.** No se puede certificar "SMOKE OK — LISTO PARA STAGING" sobre
resultados de navegador que todavía no existen; **no se inventan**. El plan de
staging queda listo para usarse en cuanto el smoke de navegador pase.

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
