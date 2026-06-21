# FASE P3 — Factory State real + pulido premium dirigido por feedback de screenshots

> **Fecha:** 2026-06-21 · HEAD previo `5d09762`. Toca runtime CRM (`src/`) → **requiere
> redeploy**. Sin tocar `.env`/`.mcp.json`/secretos/RLS/Auth/migraciones destructivas/
> workflows/datos reales. Sin features nuevas.

---

## 1. Diagnóstico de screenshots (feedback del usuario)
- **Dashboard:** "Actividad reciente" mostraba "Cliente eliminado: lara" → feo para
  cliente/demo. Mucho espacio, KPIs básicos, falta distinguir demo vs cliente vacío.
- **Operaciones:** funcional pero administrativo; tabs/Plantillas; filas con selects.
- **Calendario:** lo mejor visualmente, pero banner "Conecta tu Google Calendar" /
  "Google no conectado" confunde si Google no está en el pack básico.
- **Settings:** lo más problemático — "IA gestionada por el equipo técnico",
  "Automatizaciones Configurable", "No se pudieron cargar los usuarios", texto técnico.
- **Factory state:** staging tiene datos demo; el cliente nuevo no debe heredarlos.

## 2. Estado factory actual (AUDITADO en BD)
`auth.users=1, workspaces=1, workspace_members=1, profiles=1`. **Sin triggers en
`auth.users`, sin funciones de provisioning.** ⇒ **No hay auto-provisioning**: un signup no
recibe workspace → `AuthGate` → `/login?error=no_profile`. **El cliente nuevo NO hereda
datos demo** (no se le asigna ningún workspace). El único workspace (`d0000000…`) es la
DEMO con seed.

## 3. Riesgo de datos demo en clientes reales
**Nulo con el flujo actual** (no hay provisioning automático que meta al usuario en la demo).
El trabajo real es un **procedimiento de alta limpio** + separación demo/cliente, no un bug.
Documentado en `docs/FACTORY_STATE_AND_DEMO_DATA_POLICY.md`.

## 4. Factory state — qué se entregó
- **Doc `FACTORY_STATE_AND_DEMO_DATA_POLICY.md`:** demo vs cliente; **SQL admin** para alta
  de workspace **vacío** (workspace + profile + member, SIN seed); **reset seguro**
  workspace-scoped (nunca global, nunca `auth.users`); política de PII en demo; checklist.
- No se creó provisioning automático (sería grande y arriesgado); se documenta el
  procedimiento admin seguro y reproducible.

## 5. Dashboard
- **Filtra el ruido de borrados** del feed ("Cliente eliminado: …") → la home ya no muestra
  actividad negativa. (Cambio de lógica, verificable; el log completo sigue en el detalle.)
- Empty-state ya existente; el rediseño de hero/onboarding premium queda para pasada visual.

## 6. Operaciones
Sin cambios en P3 (rediseño visual requiere screenshots/QA humano para no romper a ciegas un
layout grande). Plan documentado (segmentar Operaciones/Expedientes/Propiedades, ocultar
Plantillas si premium, cards más limpias) — pendiente con feedback visual.

## 7. Calendario
- **Oculto el CTA "Conecta tu Google Calendar"** en el pack básico (`showGoogleConnectCta`
  ahora requiere `NOWLABS_INTERNAL=true`). El cliente usa el calendario interno sin ver un
  módulo premium que no tiene. (El operador interno sigue viéndolo.)

## 8. Settings
- **Reescrita la card client-visible "Plataforma IA / IA gestionada por el equipo técnico"**
  → **"Copiloto IA · Copiloto IA incluido"**: "El asistente está configurado y listo para
  ayudarte con clientes, operaciones, tareas y calendario. No necesitas configurar nada."
  Quitado el tile "Automatizaciones Configurable" (dormido/premium); 2 tiles limpios
  (Asistente IA Activo / Soporte y actualizaciones Incluidos), sin `font-mono` técnico.
- Pendiente: "No se pudieron cargar los usuarios" (TeamUsersCard) → estado elegante u
  ocultar para pack básico (requiere revisar por qué falla la carga del equipo en staging).

## 9. Datos demo
No se tocaron datos (regla: no destruir sin confirmación). El dashboard ya no muestra
borrados. Sustitución de PII real (DNI/email de Oier) por ficticios para demo pública:
**propuesto** en la doc, pendiente de confirmación (script workspace-scoped).

## 10. Pendiente
- Rediseño visual fino (dashboard hero/onboarding, operaciones, ficha) → requiere
  screenshots concretos para iterar sin romper a ciegas.
- "No se pudieron cargar los usuarios" en Settings (TeamUsersCard).
- Sustitución de PII real en el workspace demo (con confirmación).
- Si staging está con `NOWLABS_INTERNAL=true`, el cliente ve módulos internos: confirmar
  `=false` para la vista de cliente.

## 11. Scripts / provisioning
SQL documentado (no aplicado): alta de workspace vacío + reset workspace-scoped, en
`docs/FACTORY_STATE_AND_DEMO_DATA_POLICY.md`. No se ejecutó ningún cambio de datos.

## 12. Validaciones
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. No se ejecutaron migraciones (solo
auditoría SQL de solo-lectura + queries de esquema).

## 13. Archivos tocados
- `src/app/(saas)/dashboard/page.tsx` (filtro de actividad)
- `src/app/(saas)/settings/page.tsx` (card Copiloto IA)
- `src/app/(saas)/calendar/page.tsx` (gate Google CTA)
- NUEVO `docs/FACTORY_STATE_AND_DEMO_DATA_POLICY.md` + este report

## 14-15. Commit / push
Ver hash en el commit `polish(product): P3 factory-state docs + UI cleanups`. Push a origin/main.

## 16. Redeploy
**Sí** (cambió `src/`). Desplegar con `NEXT_PUBLIC_NOWLABS_INTERNAL=false` para la vista de
cliente.

## 17. Qué probar en staging (tras redeploy, NOWLABS_INTERNAL=false)
- Dashboard: la actividad ya NO muestra "Cliente eliminado: …".
- Settings: card "Copiloto IA incluido" (sin "IA gestionada por el equipo técnico" ni
  "Automatizaciones Configurable").
- Calendario: ya NO aparece "Conecta tu Google Calendar".
- Alta de cliente nuevo (SQL de la doc) → CRM vacío con empty states.

## Veredicto
**P3 PARCIAL SEGURO — FACTORY STATE RESUELTO + UI CLEANUPS SEGUROS.** El factory state (la
preocupación #1) queda **respondido y documentado**: no hay auto-provisioning, el cliente
nuevo no hereda demo, y hay procedimiento admin seguro para alta vacía + reset
workspace-scoped. Arreglados los eyesores client-visible más claros (actividad "Cliente
eliminado", copy técnico de IA en Settings, banner Google en Calendario). tsc/lint/build
verdes. **El rediseño visual fino (dashboard/operaciones)** sigue necesitando iteración con
screenshots concretos para no tocar a ciegas; con ellos lo cierro dirigido. **Requiere
redeploy.**
