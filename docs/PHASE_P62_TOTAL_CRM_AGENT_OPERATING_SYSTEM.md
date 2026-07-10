# P62 — TOTAL CRM AGENT OPERATING SYSTEM

**Estado:** ✅ CODE COMPLETE / ⛔ UI E2E BLOCKED — TEST_SESSION_MISSING
**Fecha:** 2026-07-10

> Alcance honesto: el spec permite juicio técnico («no crear arquitectura sin integrar»). Se atacaron las
> clases del incidente con fixes integrados en el contrato existente y se demostraron contra el motor real.
> Lo NO construido se declara abajo (§Qué no se hizo) — sin fingir completitud.

## 0. N8N Preflight (obligatorio) — ✅ OK
API accesible (HTTP 200, solo dominio seguro), workflow activo **[CRM Inmobiliario] Agent V2 — Read Only**
id `6mps8YoWu3syldUc`, 24 nodos, **15/15 toolCode con `x-nowcrm-turn-policy`**, Normalize expone token,
contrato en el agente. **Backup** guardado en temp del SO (fuera de git). Capacidad PUT demostrada en P51C.

## 1-2. Baseline + incidente
`main` limpio, HEAD `9d4eb5d` (P61). Incidente analizado por clase en `P62_REAL_INCIDENT_ANALYSIS.md`:
oferta→aceptación inexistente, «sí» re-explicaba, global atrapado en módulo previo, «mirar» no leía,
saludo bilingüe no reconocido, y (descubierto por el test) el prefijo «asistente:» del hilo contaminaba la
resolución de módulo.

## 3-7. Fixes (integrados, no paralelos)
1. **Motor de ofertas** (`local-answers`): `detectOfferRequest` → oferta local concreta;
   `detectAcceptance` (breve, excluye «sí explícame»/corrección) + `resolveOfferedModules` (la oferta se
   deriva del ÚLTIMO mensaje del asistente con marcador; cabecera de módulo manda en exclusiva) +
   `executeOfferedModule` (lecturas vivas por módulo). Varias opciones sin resolver → UNA aclaración.
2. **Alcance global** (`decideTurn` 1a-P62): «todo el CRM / en general / explícame todo» → tour global,
   ANTES de heredar módulo del contexto.
3. **«mirar» = lectura** (pragmática) + gate de agenda acepta verbos de lectura → «en el calendario me
   puedes mirar?» responde answer-first con datos vivos.
4. **Saludo bilingüe** («hello/hi») + prefijo de hablante limpiado en resolvedores de contexto.

## 8-10. n8n / capacidades / acciones
n8n NO modificado: todas las clases del incidente se resuelven **localmente antes** de n8n (por diseño del
contrato local-first); n8n sigue para lo no cubierto, bajo token+allowedTools+strict (**7/7 en vivo**).
Registro formal de capabilities/actions y subworkflows: **NO construidos** en esta fase (ver §Qué no se hizo).

## 11-14. Validación
- **`scripts/p62-real-incident-check.mts`**: transcript completo contra el motor real → **7/7 PASS**.
- No-regresión: p61-incident **PASS** · conversation-harness **PASS** · QA runner **PASS**.
- Nueva eval `assistant-offer-engine` → **34 suites TODO VERDE**.
- tsc/lint/build/deploy-gate ✅ · strict **7/7 en vivo** ✅ · scans (invoices agents=0, `.env.local` no
  trackeado, sin secretos) ✅ · **0 migraciones**.

## Archivos
**Modificados:** `assistant-turn.ts` (alcance global), `assistant-pragmatics.ts` (mirar/hello),
`local-answers.ts` (motor de ofertas + gates + prefijo hablante). **Nuevos:** eval offer-engine,
p62-real-incident-check, 2 docs.

## Qué NO se hizo (declarado, no fingido)
- Registries formales (capability/action), planner tipado, subworkflows n8n, acciones de escritura
  confirmadas, Playwright E2E, trace-id end-to-end: **no construidos**. Las clases de fallo reales se
  cierran sin ellos; construirlos sin integración habría violado la regla «no arquitectura sin integrar».
- **UI E2E: BLOCKED — TEST_SESSION_MISSING** (sin credenciales de sesión; no se inventa PASS).

## Riesgos restantes
- La resolución de ofertas depende de marcadores estables en los textos generados (si se reescriben los
  generadores, actualizar `OFFER_MARKER`). Protegido por eval.
- Escrituras (crear/editar desde el chat) siguen fuera de alcance (prepared actions futuras).

## Validación manual (5 min, cuenta demo)
1. «que hacemos ofreceme algo» → 3 opciones. 2. «venga va muestramela» → resumen de cartera (o aclaración
concreta). 3. «en el calendario me puedes mirar?» → «Citas próximas: sí/no…». 4. tras una explicación con
oferta, «sí» → datos (no re-explica). 5. «explícame todo el crm resumido» → tour global.

---

**P62 CODE COMPLETE — OFERTA→ACEPTACIÓN RESUELTA («sí/venga/muéstramela» ejecuta lo ofrecido o aclara UNA
vez), ALCANCE GLOBAL > MÓDULO PREVIO, «MIRAR» LEE, CONTEXTO SIN CONTAMINAR, TODO DEMOSTRADO CONTRA EL MOTOR
REAL (incidente 7/7) CON 34 SUITES + STRICT 7/7 EN VIVO Y N8N PREFLIGHT OK. / UI E2E BLOCKED:
TEST_SESSION_MISSING.**
