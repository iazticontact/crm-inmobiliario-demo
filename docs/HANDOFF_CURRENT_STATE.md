# Handoff — Estado actual del proyecto

> Documento de continuidad. Si se abre una conversación nueva o cambia de persona/IA, **empezar por aquí**.
> Última actualización: 2026-06-13 (Fase 1L).

---

## Estado del repositorio

- **Repo (único válido):** `git@github.com:iazticontact/crm-inmobiliario-demo.git`
- **Branch:** `main`
- **HEAD:** `ca04af9` (antes del commit de docs de Fase 1L; ver `git log` para el último)
- **Tag de venta congelado:** `demo-v1` → commit `ca04af9fe0e71551b00de3eb6baac2285e97a72a`
- **Working tree:** limpio (trabajo siempre commiteado y pusheado)
- **Repo viejo `nowlabsai`:** ABANDONADO. No tocar nunca.

**Stack:** Next.js 16.2.4 (React 19, Tailwind 4), Supabase (`@supabase/ssr`), sonner, recharts, framer-motion, lucide-react. Build: `npm run build`. Lint: `npm run lint`. Typecheck: `npx tsc --noEmit`.

> ⚠️ `AGENTS.md` advierte: «This is NOT the Next.js you know» — hay breaking changes respecto a versiones conocidas. Antes de escribir código Next, leer la guía en `node_modules/next/dist/docs/`.

---

## Qué es esto

**CRM Inmobiliario Demo:** una demo genérica y reutilizable de CRM para inmobiliarias, sin branding de cliente, pensada para **enseñar y empezar a vender**. No es una maqueta desechable: es la **base comercial** de futuros CRMs inmobiliarios a medida.

---

## La demo offline (lo que se vende hoy)

- **Activación:** botón **«Ver demo inmobiliaria»** en `/login` → setea `localStorage['nowcrm-demo-mode']='true'` (constante `DEMO_MODE_KEY` en `src/lib/current-user.ts`).
- **100% offline:** `AuthGate` y `current-user` comprueban ese flag **antes** que Supabase → funciona sin backend, sin internet fiable, sin secrets.
- **Datos:** mock coherente en `src/lib/mock-data.ts` + `src/lib/demo/demo-real-estate.ts`. Fechas **relativas a hoy** (helper `src/lib/demo/demo-dates.ts`) → la demo nunca «envejece».
- **Pantallas que funcionan offline:** login, dashboard, clientes, ficha 360, oportunidades/pipeline, propiedades, expedientes, calendario (crear/editar/borrar visita), asistente IA (respuestas de muestra), settings, logout.
- **Comportamiento esperado:** los cambios en demo son **efímeros** (se pierden al refrescar). Las acciones de escritura muestran un toast amable «Modo demo (solo lectura)» o aplican un cambio optimista en pantalla — **nunca** un error técnico.
- **Billing / Automations:** ocultos tras el flag interno `nowlabsInternal` (default `false`). Correcto: no se enseñan al cliente.

---

## Fases completadas (1A–1L)

| Fase | Qué se hizo | Commit/Tag |
|---|---|---|
| 1A | Branding neutro (sin NowLabs/CostaDelSol/Andrei) | — |
| 1B | Naming del asistente | — |
| 1C | Dependencias | — |
| 1D | Documentación | — |
| 1F | Auditoría de demo | — |
| 1G | Modo demo offline | `55dd0b3` |
| 1H | QA + polish read-only/optimista | `5a8f5a5` |
| 1I | Pulido final: guards demo en drawers crear/editar, fechas mock relativas, badges «Modo demo» | `c411d28` |
| 1J | QA visual + microfixes: footer PDF a `BRAND.appName`, guards demo en ficha cliente (notas/documentos) | `ca04af9` |
| 1K | Congelación de versión: tag anotado `demo-v1` creado y pusheado | tag `demo-v1` → `ca04af9` |
| 1L | Paquete comercial + planificación Fase 2 (solo docs) | este commit |

---

## Qué se PUEDE vender hoy

- La demo offline funcionando, como prueba de que el producto **existe y funciona**.
- Un proyecto de CRM inmobiliario **a medida**, conectado a los datos y cuentas del cliente (ese es el siguiente paso real).
- Guion comercial listo: ver [DEMO_V1_SALES_GUIDE.md](DEMO_V1_SALES_GUIDE.md) (guiones de 5 y 12 min, frases, respuestas a objeciones).

## Qué NO prometer todavía

- ❌ WhatsApp real (hasta integrar Meta).
- ❌ IA real completa (hasta conectar OpenAI + tools reales).
- ❌ Persistencia en la demo (los cambios son efímeros, a propósito).
- ❌ Que ya esté conectado al Supabase nuevo (Fase 2 no iniciada).
- ❌ Que esté en producción.
- ❌ Fechas de entrega cerradas sin dimensionar el proyecto.

(Detalle y forma de decirlo: sección «Qué NO prometer» de [DEMO_V1_SALES_GUIDE.md](DEMO_V1_SALES_GUIDE.md).)

---

## Reglas de seguridad (NO TOCAR)

- Repo viejo `nowlabsai`.
- `.env.local`, `.env.local.backup_antiguo`, `.mcp.json`, `memory/`.
- Secrets, `service_role`, RLS/auth profunda.
- Supabase real, n8n real, Google real, Meta/WhatsApp real, OpenAI real.
- `docs/supabase/*`, `docs/n8n/workflows/*` (referencia histórica; no modificar).
- Contratos internos protegidos: `NOWCRM_*`, `NOWLABS_*`, `x-nowcrm-*`, `runNowLabsAgent`, `nowlabs_admin` (conservar nombres; solo cambian valores).
- No instalar paquetes, no deploy real, no force push, no cambiar arquitectura runtime sin plan.

---

## Documentos clave de esta entrega (Fase 1L)

- [DEMO_V1_SALES_GUIDE.md](DEMO_V1_SALES_GUIDE.md) — guion comercial, frases, objeciones.
- [DEMO_V1_SCREENSHOTS.md](DEMO_V1_SCREENSHOTS.md) — qué capturas sacar y cómo.
- [DEMO_V1_DEPLOY_GUIDE.md](DEMO_V1_DEPLOY_GUIDE.md) — deploy temporal en Vercel (sin ejecutar).
- [PHASE_2_SUPABASE_BLUEPRINT.md](PHASE_2_SUPABASE_BLUEPRINT.md) — blueprint del backend real.
- Este handoff.

---

## Siguiente paso

1. **Oier prueba** la demo visualmente (checklist de [DEMO_V1_SALES_GUIDE.md](DEMO_V1_SALES_GUIDE.md) / Fase 1J).
2. **Saca screenshots** comerciales ([DEMO_V1_SCREENSHOTS.md](DEMO_V1_SCREENSHOTS.md)).
3. **Decide deploy** temporal en Vercel cuando quiera ([DEMO_V1_DEPLOY_GUIDE.md](DEMO_V1_DEPLOY_GUIDE.md), recomendado Opción B desde el tag).
4. **Empieza a vender** con la demo + el guion.
5. **Cuando haya luz verde de negocio → Fase 2** (Supabase nuevo), arrancando por auditoría y diseño (no ejecutar SQL de entrada).

---

## Prompt recomendado para el próximo chat

> Para retomar sin perder contexto. Si el objetivo es **seguir vendiendo / preparar material**, usa este. Si el objetivo es **empezar Fase 2**, usa el «Prompt de arranque para Fase 2» de [PHASE_2_SUPABASE_BLUEPRINT.md](PHASE_2_SUPABASE_BLUEPRINT.md).

```
Retomamos CRM Inmobiliario Demo.

Estado: branch main, tag demo-v1 (commit ca04af9), demo offline vendible.
Fase 2 (Supabase real) NO iniciada.

Lee primero docs/HANDOFF_CURRENT_STATE.md para recuperar contexto completo.

Respeta las reglas NO TOCAR (Supabase/secrets/.env/contratos internos
protegidos, repo viejo, no deploy, no force push).

Hoy quiero: [DESCRIBE AQUÍ: p.ej. "ajustar el guion comercial",
"preparar el deploy en Vercel", "revisar una pantalla concreta de la demo"].

No empieces Fase 2 ni conectes Supabase salvo que te lo pida explícitamente.
```
