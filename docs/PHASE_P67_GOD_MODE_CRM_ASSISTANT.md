# P67 — GOD MODE: ACCIONES AMPLIADAS + INTELIGENCIA PROACTIVA + N8N 20 TOOLS

**Estado:** ✅ verticales core operativos / límites declarados
**Fecha:** 2026-07-13

> Alcance honesto del "god mode": con el presupuesto disponible se entregan los verticales de mayor valor
> REALES y verificados; lo demás se declara sin simular.

## Preflights — ✅
Repo limpio (HEAD P66 `57f62cc`) · n8n P66 intacto (verificación idempotente) · staging p66 → **p67**.

## 1. Acciones ampliadas (mismo plano P65, cero duplicación)
- **Registro** + `clients.update_email`, `tasks.update_due_date`, `portfolio.update_status` — todas con
  confirmación obligatoria, idempotencia, optimistic lock y read-after-write.
- **Matriz de transiciones** de Cartera (`PORTFOLIO_TRANSITIONS`): `sold→listed` y similares se **rechazan
  en prepare** (`ACTION_TRANSITION_INVALID`) explicando las transiciones válidas; se valida contra el
  estado ACTUAL leído de la BD.
- Validaciones semánticas (email, fecha ISO) y **parser natural**: «cambia el email de David a x@y.com»,
  «cambia la fecha de la tarea X a mañana», «marca San Pedro 66 como reservado/vendido». Las lecturas de
  estado («muéstrame los vendidos») NO son acciones (eval anti-falso-positivo).

## 2. Inteligencia proactiva (findings)
- Migración aditiva **`assistant_findings`** (RLS; **dedupe por fingerprint único** por workspace).
- **`findings-engine.ts`**: reglas objetivas, cada finding lleva su **criterio explícito** — vendido sin
  operación ganada · ganada sin inmueble cerrado · publicado sin precio · operación sin cliente · tareas
  vencidas (verdad temporal P64). **Nunca modifica datos.**
- **`/api/agent/automation`**: `run_data_quality` (detecta + persiste con dedupe) · `list_findings` ·
  `resolve_finding`. Server-to-server, mismo modelo de auth.
- **Chat**: «¿qué requiere atención? / incidencias / auditoría de calidad» → auditoría VIVA + findings
  abiertos con severidad.

## 3. n8n (PUT 200, verificado en fresco)
Tool **`crm_findings_check`** conectada al agente → **20 tools totales** (15 lectura + 4 acción + findings)
+ bloque **[P67 PROACTIVE INTELLIGENCE]** (findings con criterio, transiciones explicadas, corregir =
acción con confirmación). Backup previo en temp.

## Validación
Eval `assistant-p67` (transiciones, registro, parsers) → **39 suites TODO VERDE** · incidentes P61/P62/P63
**PASS** · **P66 chat-action E2E 11/11 PASS** (regresión) · tsc/lint/build ✅ · **strict 7/7 en vivo** ✅ ·
marcador `2026-07-13.p67` · `scripts/p67-e2e.mjs` contra staging (findings + dedupe + transiciones + email
inválido) — resultado en el runbook del operador.

## Límites declarados (sin simular)
UI visual de tarjetas con botones · scheduler de automatizaciones (rules/runs/next_run_at) · Playwright
(TEST_SESSION_MISSING) · resto de acciones del catálogo (mismo patrón, pendientes de registro).

## Operador (2 min, tras deploy)
1. Chat: «¿qué requiere atención?» → incidencias reales con criterio.
2. Chat: «marca San Pedro 66 como reservado» → preview con transición válida; «cancela».
3. `node scripts/p67-e2e.mjs` → findings/dedupe/transiciones contra staging.

---
**P67 — 0 fallos conocidos dentro de la matriz validada (39 suites + 3 incidentes + P66 11/11 + strict 7/7
+ n8n 20 tools verificadas). Verticales entregados: acciones con transiciones de negocio y sistema de
findings proactivo E2E. Límites declarados arriba.**
