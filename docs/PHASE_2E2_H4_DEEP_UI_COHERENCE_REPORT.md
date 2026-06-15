# Phase 2E-2 H4 — Deep UI coherence + assistant product honesty

> **Fecha:** 2026-06-15 · **Base:** `2ac7446` · Solo UI/producto (gating por
> `NEXT_PUBLIC_NOWLABS_INTERNAL`). **No se tocó backend, schema, RLS, rutas, ni
> `.env.local`.** Continúa [PHASE_2E2_H3_AUTH_AND_DORMANT_UI_CLEANUP_REPORT.md](PHASE_2E2_H3_AUTH_AND_DORMANT_UI_CLEANUP_REPORT.md).

## 1. Objetivo
Dejar la UI coherente y honesta antes del smoke real: que el cliente no vea
módulos dormidos (WhatsApp/Inbox, Google OAuth, facturación) como si funcionaran.

## 2. Por qué H4
H3 limpió dashboard/ficha/operaciones/asistente-chips, pero dejó diferido el
**deep cleanup** de Settings, Calendar y el modo Inbox del asistente por ser
ficheros grandes y arriesgados. H4 los aborda con **cambios mínimos y seguros**
(ocultar tras `SHOW_INTERNAL_TECH`/flag, sin reestructurar layout ni borrar código).

## 3. Qué estaba visible indebidamente (cliente, `NOWLABS_INTERNAL=false`)
- **Settings:** "Mi Google Calendar" + botón "Autorizar con Google" (OAuth no
  configurado → fallaría), calendario de equipo (Google), "Inbox Agent /
  Respuesta automática" (sin canal real).
- **Asistente:** selector de modo **Conversaciones (Inbox)**, badge "WhatsApp
  siguiente fase", descripción que decía "los mensajes reales viven en /inbox".

## 4. Settings cleanup (FASE C)
[settings/page.tsx](../src/app/(saas)/settings/page.tsx): se envuelven en
`{SHOW_INTERNAL_TECH && (…) }` (solo operador interno) tres tarjetas dormidas
contiguas, **sin borrar código ni rutas**:
- **"Mi Google Calendar"** (OAuth) + **"Autorizar con Google"**.
- **`TeamCalendarStatusCard`** (estado Google de equipo).
- **"Atención automática" / "Inbox Agent" / "Respuesta automática"**.
La tarjeta **WhatsApp** ya estaba *suavizada* para cliente ("Conexión de WhatsApp
gestionada por el equipo técnico") — se deja así (honesta, sin botón que falle).
**Pendiente menor (documentado):** ocultar también la tarjeta WhatsApp por
completo y filtrar los toggles de notificación dormidos ("Facturas vencidas",
"Conversaciones urgentes"); el resto de Settings (cuenta, workspace, vertical,
plataforma IA gestionada) ya es honesto y se mantiene.

## 5. Calendar cleanup (FASE D)
**Sin cambios necesarios.** Auditado: el render del calendario (líneas 600+) **no
tiene referencias a Google** ni banner "Comprobando Google…". El "Comprobando
Google…" de las capturas era la tarjeta de **Settings** (ya ocultada en §4). El
calendario interno (eventos `calendar_events` + RLS) funciona y es el core.

## 6. Assistant cleanup (FASE E)
[assistant/page.tsx](../src/app/(saas)/assistant/page.tsx), cambios de UI (no se
tocó `/api/assistant/v2`, `/api/assistant/confirm`, prepared actions ni demo guard):
- **Selector de modo:** el modo **Inbox/Conversaciones** se oculta para cliente
  (`assistantModes.filter(... || m.id === 'copilot')`). El default ya era
  `copilot`; el cliente solo ve el **Copiloto del CRM**.
- **Badge "WhatsApp siguiente fase":** oculto salvo operador interno.
- **Descripción del header:** de "…facturas… los mensajes reales viven en /inbox"
  → "Copiloto interno del CRM: consulta clientes, operaciones, expedientes,
  tareas y calendario, y prepara acciones con confirmación."
- (H3) chips/ejemplos de facturación/cobros ya sustituidos por operaciones/
  expedientes.
- **Pendiente menor (documentado):** quedan textos internos del modo Inbox en
  funciones auxiliares (`internalAssistantIntro`, `buildLocalOperationalResponse`)
  que solo se ejecutan en modo inbox — inalcanzable para el cliente al ocultar el
  modo, así que no afecta a la vista cliente.

## 7. Dashboard / Client detail / Operaciones (FASE F/G/H)
Verificados (ya hechos en H3, sin nuevos cambios):
- **Dashboard:** sin tiles Cobros/WhatsApp para cliente (gateados).
- **Ficha cliente:** sin tabs Documentos/Conversaciones/Facturación (gateadas).
- **Operaciones:** título "Operaciones" + subtítulo "Pipeline comercial,
  expedientes y propiedades del workspace.".

## 8. Login (FASE I) — nota operativa (sin tocar `.env.local`)
1. Parar el `next dev` actual. 2. `npm run dev`. 3. Hard refresh (Ctrl+Shift+R).
4. Resetear el usuario de prueba en Supabase Auth a contraseña **≥8**. 5. Usar el
email real de Auth. El "Invalid API key" era un **dev server rancio** (claves de
`.env.local` válidas, verificadas); ya mapeado a mensaje claro en código.

## 9. Demo vs real (FASE J) — verificado
Demo solo por botón (`DEMO_MODE_KEY`); login real lo borra; logout limpia; modo
real sin mocks; el asistente muestra badge "Workspace real" / "Modo demo".

## 10. Qué NO se tocó (FASE K)
Supabase helpers, RLS, `/api/assistant/v2`, `/api/assistant/confirm`,
`/api/n8n/trigger`, `assistant-n8n-hook`, Auth server, Storage, schema/migraciones.
Solo UI (assistant + settings en H4; login/dashboard/ficha/operaciones en H3).

## 11. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).

## 12. Riesgos
- Quedan dormidos menores en Settings (tarjeta WhatsApp suavizada, toggles de
  notificación de facturas/urgentes) — honestos o de bajo impacto; opcional H5.
- El login depende de que Oier **reinicie el dev** y use password ≥8.

## 13. Siguiente paso
Reiniciar dev + password ≥8 → **smoke navegador real** (login → ficha/mutaciones
→ asistente copiloto READ/ACTIONS → demo) → certificar persistencia (counts) →
staging EasyPanel.
