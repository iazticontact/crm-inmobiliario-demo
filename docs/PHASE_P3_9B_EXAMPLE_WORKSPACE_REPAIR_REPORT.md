# FASE P3.9B — Reparar huérfanos + restaurar el entorno de ejemplo comercial

> **Fecha:** 2026-06-22 · HEAD previo `5832f53`. Esto **no es "hacer una demo"**: es reparar
> el **entorno de ejemplo/showcase** (workspace `d0000000…`) y garantizar que el **producto
> real arranca vacío y limpio**. Solo el workspace de ejemplo + 3 ficheros de copy. Sin
> tocar `auth.users`/otros workspaces/profiles/members. Sin PII real.

---

## Aclaración de producto (importante)
El CRM es un **producto comercial real**. El workspace `d0000000…` es el **entorno de
ejemplo opcional** (para enseñar en reuniones), ahora llamado **"Inmobiliaria Costa Azul"**
(no "Demo Inmobiliaria"). Un **cliente real** se da de alta y entra a un CRM **vacío**, sin
heredar nada del ejemplo.

## 1. Estado antes
Ejemplo: 6 clientes, 7 operaciones (1 huérfana), 5 expedientes, 10 tareas, 10 eventos, 21
actividades, 1 memoria **colgada** (apuntaba a un cliente borrado). 3 clientes borrados en
pruebas (Lucía Herrera, Familia Soler, Javier Ortega Ruiz) → operaciones/tareas/citas/
expediente quedaron con `client_id NULL` (FK SET NULL).

## 2. Huérfanos detectados
- 1 operación: "Venta piso Calle Mayor 14" (de Familia Soler).
- 2 tareas con `client_name` (Lucía, Familia Soler), 3 eventos (Lucía, Familia Soler, Javier),
  1 expediente (venta Calle Mayor).
- 1 `assistant_agent_memory` colgada (entity_id = Javier inexistente).
- (Items intencionadamente sin cliente —reunión interna, tarea de publicación, visita
  genérica— se dejan como están.)

## 3. Qué se limpió / reparó
- **Workspace de ejemplo renombrado** → "Inmobiliaria Costa Azul" (slug
  `inmobiliaria-costa-azul`).
- **3 clientes restaurados** con sus **UUIDs originales** (reconecta la memoria del asistente
  automáticamente), datos ficticios coherentes (email `example.com`, tel. `+34 600…`, DNI
  demo `00000000T`, área/tipo/idioma → menos "Sin completar").
- **Huérfanos reconectados** por su texto a los clientes restaurados (operación, 2 tareas, 3
  eventos, 1 expediente).
- **Eliminadas** las 3 actividades "Cliente eliminado: …" (ya no son ciertas).

## 4. Clientes demo restaurados/creados
- **Familia Soler** (vendedores, `active`) — operación de venta Calle Mayor 14 + tarea +
  evento + expediente + actividad.
- **Lucía Herrera** (compradora obra nueva, `active`) — **operación nueva** "Compra piso
  Calle Mayor 14" (lado comprador) + tarea + evento + actividad.
- **Javier Ortega Ruiz** (inversor, `active`, DNI demo) — **tarea nueva** de propuesta de
  inversión + evento + memoria del asistente reconectada + actividad.

## 5. Operaciones/tareas/citas/expedientes
+1 operación (Lucía) y +1 tarea (Javier) nuevas; resto reconectadas. Actividad reciente
positiva añadida ("Nuevo cliente creado", "Expediente abierto", "Operación actualizada",
"Visita programada"). Sin textos técnicos ("Stage negotiation" ya saneado en P3.8).

## 6. Counts antes → después
| | clientes | operaciones | expedientes | tareas | eventos | actividades |
|---|---|---|---|---|---|---|
| antes | 6 | 7 (1 huérfana) | 5 | 10 | 10 | 21 |
| **después** | **9** | **8** | **5** | **11** | **10** | **23** |

## 7-10. Confirmaciones (verificadas por SQL)
- **Solo workspace de ejemplo** (`d0000000…`): `clients_outside_example = 0`. ✅
- **Sin PII real**: 0 tokens (DNI/teléfono/email reales). ✅
- **Sin textos vulgares/inapropiados/técnicos**: 0. ✅
- **0 huérfanos relevantes** (operaciones/tareas/eventos con cliente que debían reconectarse)
  y **0 memoria colgada**. ✅

## Producto real arranca vacío (confirmado)
- `total_workspaces = 1` (solo el ejemplo); `auth_user_triggers = 0` (no hay
  auto-provisioning); `clients_outside_example = 0`.
- Un usuario nuevo sin workspace → `AuthGate` → **/onboarding** → `POST
  /api/onboarding/workspace` crea un workspace **vacío** (0 clientes/operaciones/tareas/
  citas/actividad), **sin seed** (P3.1). No hereda nada del ejemplo.
- Empty states + onboarding premium del dashboard/clientes (P3.1/P3.2). Asistente activo en
  workspace vacío.

## Branding / "demo" en la UI
- `BRAND.appName = 'CRM Inmobiliario'` (sin "Demo", P3.7).
- `BRAND.workspaceName` → **"Tu inmobiliaria"** (fallback neutro de workspace real, nunca
  "Demo Inmobiliaria"). Nuevo `BRAND.exampleWorkspaceName = 'Inmobiliaria Costa Azul'`.
- `current-user.ts`: el usuario del entorno de ejemplo usa `exampleWorkspaceName` (nombre de
  agencia realista) y `trialLabel = 'Entorno de ejemplo'`.
- Dashboard badge en ejemplo: **"Entorno de ejemplo"** (discreto); en workspace real: "Cuenta
  activa". Los avisos "Modo demo (solo lectura)" **solo** aparecen en el entorno de ejemplo
  (gated por `isDemo`), **nunca** en un workspace real.

## 11. Migración / script
`20260622_p39b_repair_and_reseed_example_workspace.sql` (aplicada por MCP, idempotente,
ejemplo-only). **Rollback:** no destructivo; reaplicable. (No revierte el rename del
workspace ni borra clientes; es restaurador.)

## 12. Validaciones
SQL: counts antes/después + 0 huérfanos + 0 PII + 0 vulgar verificados por consulta.
Código (`brand.ts`, `current-user.ts`, `dashboard`): `tsc` ✅ · `lint` ✅ · `build` ✅.

## 13-15. Commit / push / redeploy
Ver hash `chore(example): repair orphans + reseed showcase workspace + de-demo UI (P3.9B)`.
Push a `origin/main`. **Requiere redeploy** (cambió `src/`: brand/current-user/dashboard). El
repair de datos ya está en BD.

## 16. Qué probar en staging
- **Entorno de ejemplo** ("Ver demo" / login del workspace `d0000000`): 9 clientes, pipeline
  con 8 operaciones, agenda, actividad profesional, ficha 360 de Familia Soler/Lucía/Javier
  rica; nombre "Inmobiliaria Costa Azul"; badge "Entorno de ejemplo".
- **Workspace real nuevo** (crear `auth.user` sin profile → onboarding): CRM **vacío**,
  empty states premium, asistente activo, sin "Demo", sin datos heredados.

## Veredicto
**P3.9B COMPLETADO — ENTORNO DE EJEMPLO COMERCIAL REPARADO + PRODUCTO REAL ARRANCA VACÍO.**
Huérfanos antiguos reparados (0 relevantes), 3 clientes restaurados con relaciones coherentes,
dataset rico (9/8/5/11/10/23), memoria del asistente reconectada, **solo workspace de
ejemplo**, **sin PII real ni textos feos**. El producto real arranca limpio y el ejemplo se
llama como una agencia real, no "Demo". **Requiere redeploy.**
