# FASE P3.1 — Factory Onboarding real + Demo Data segura + pulido premium

> **Fecha:** 2026-06-21 · HEAD previo `f559439`. Toca runtime (`src/`) → **requiere
> redeploy**. Cambio de datos: 1 migración **idempotente, no destructiva, solo demo
> workspace** (PII). Sin tocar `.env`/`.mcp.json`/secretos/n8n/RLS/Auth peligroso/datos
> reales sin confirmación. Sin extras premium (facturación/scraper/WhatsApp/landing/RAG/
> Google OAuth real).

---

## 1. Diagnóstico inicial
P3 dejó: factory auditado (sin auto-provisioning), demo PII pendiente, Settings con
"No se pudieron cargar los usuarios", dashboard/operaciones planos, Google CTA ya oculto.
Faltaba para producto vendible: (1) alta de workspace vacío sin SQL manual, (2) demo sin
PII real, (3) Settings sin estados feos, (4/5) dashboard/operaciones más premium.

## 2. Factory onboarding elegido → **Opción A (self-onboarding UI)**
Login es **solo invitación/admin** (no hay signup público). Un usuario autenticado sin
workspace solo aparece cuando un operador crea/invita su `auth.user`. Antes `AuthGate` lo
**expulsaba** (`signOut` → `/login?error=no_profile`); ahora lo lleva a **`/onboarding`**.
- **`POST /api/onboarding/workspace`** (server, `runtime=nodejs`): verifica la sesión
  (cookie-bound), y **solo entonces** crea con service_role workspace **vacío** +
  profile `client_admin` + member `owner`. **Idempotente** (si ya tiene workspace, lo
  devuelve; nunca crea dos). `workspace_id` viene del row creado, nunca del body. Rollback
  del workspace si falla el profile. Schema verificado en BD (NOT NULL/defaults/CHECK de
  roles) para que el insert no falle en runtime.
- **`/onboarding`** (page, fuera de `(saas)` → no pasa por `AuthGate`): comprueba sesión
  (sin sesión → `/login`; con workspace → `/dashboard`), formulario "Crea tu espacio de
  trabajo" → crea y entra. Estilo consistente con login.
- **`AuthGate`**: rama sin-workspace ahora redirige a `/onboarding` (mantiene la sesión).
  Cero regresión para el usuario actual (que **sí** tiene workspace).

## 3. ¿Cliente nuevo puede crearse vacío por UI?
**Sí**, por self-onboarding (§2), sin SQL. Requiere `SUPABASE_SERVICE_ROLE_KEY` en el
servidor; si falta, el endpoint da 503 y queda el alta admin por SQL como fallback
(`docs/FACTORY_STATE_AND_DEMO_DATA_POLICY.md` §3.b).

## 4. Usuario sin workspace
Ya **no se le cierra la sesión**: va a `/onboarding` a crear su espacio vacío (sin demo,
sin Oier/Familia Soler/"Demo Inmobiliaria"). El workspace nace con 0
clientes/operaciones/tareas/citas → empty states de fábrica.

## 5. Demo data: **saneada** (ejecutada)
Auditoría: de 8 clientes demo, **solo 1** tenía PII real (el contacto de prueba del propio
owner). Migración `20260621_p31_sanitize_demo_workspace_pii.sql` (aplicada vía MCP,
**idempotente, no destructiva, solo `d0000000…`**):
- cliente → "Javier Ortega Ruiz", `javier.ortega@example.com`, `+34 600 109 209`,
  dirección "Calle Mayor 12, 3B", DNI demo `00000000T`.
- `activities` (2), `calendar_events` (1), `assistant_agent_memory` (1) → nombre ficticio.
- **Verificado: 0 tokens de PII real** (nombre, DNI, email, teléfono y dirección reales)
  en el workspace demo. El SQL lee el nombre antiguo dinámicamente, sin hard-codear PII.
- No se tocó `auth.users`, ni otros workspaces, ni se borró nada. El *owner/profile* sigue
  siendo el real (es la identidad del que enseña el CRM, no un contacto).

## 6. Settings
- **TeamUsersCard**: la alerta amarilla técnica ("No se pudieron cargar los usuarios") ya
  **no se muestra al cliente**; un fallo de carga cae con elegancia a un **empty state**
  premium ("Aún no hay otros usuarios en este workspace · Invita a tu equipo…"). El detalle
  del error solo lo ve el build de operador (`NOWLABS_INTERNAL=true`) para diagnosticar.
- (P3) "Plataforma IA / IA gestionada por el equipo técnico" → "Copiloto IA incluido"
  ya estaba hecho.

## 7. Dashboard
- **Empty state convertido en onboarding guiado** (solo cuando el workspace está vacío,
  `isEmpty && !loadError` → cero impacto en demo/activo): card "Tu CRM está listo" con 4
  pasos clicables — 1) Añade tu primer cliente, 2) Crea una operación, 3) Planifica una
  cita, 4) Pregunta al copiloto (este último gated por `featureFlags.assistant`).
- Header (saludo + badge demo/activo), KPIs reales y cobros/WhatsApp ya gated por
  `NOWLABS_INTERNAL` venían bien de antes. Actividad ya filtra borrados (P3).

## 8. Operaciones
**Sin cambios** en P3.1. Rediseño visual de una página grande sin poder ver el render es
riesgo neto negativo. Plan documentado (segmentar Operaciones/Expedientes/Propiedades,
ocultar Plantillas si premium, cards con jerarquía título/tipo/cliente/vencimiento/
prioridad/estado, selects→badges+editar, empty states). **Pendiente: requiere screenshots
para iterar dirigido sin romper mutaciones.**

## 9. Calendario
- (P3) CTA "Conecta tu Google Calendar" ya oculto en pack básico.
- (P3.1) **Ocultados también los indicadores de estado de Google** para el cliente
  (`showGoogleStatus = NOWLABS_INTERNAL==='true'`): el chip de la barra ("Google no
  conectado") y la leyenda/badge inferior ("Sin Google Calendar", dot "Google"). El cliente
  solo ve "Sin conexión" si hay un fallo real de carga. El operador interno ve todo.

## 10. QA demo (workspace `d0000000…`)
Entrar con demo → datos ficticios coherentes, **sin PII real**, dashboard con actividad
positiva, copiloto operativo. (Verificación de datos en BD ✅; render visual pendiente de
screenshot tras redeploy.)

## 11. QA workspace vacío
Sin un `auth.user` sin workspace no se puede E2E aquí (no hay browser ni usuario de prueba).
**Verificado por construcción**: schema de inserts validado en BD, tsc/lint/build verdes,
rutas `/onboarding` y `/api/onboarding/workspace` presentes en el build. **E2E pendiente
del usuario**: crear un `auth.user` nuevo (sin profile) → login → debe ver "Crea tu espacio
de trabajo" → CRM vacío con onboarding del dashboard. Ver §17.

## 12. Validaciones
`tsc --noEmit` ✅ · `lint --max-warnings=0` ✅ · `build` ✅ (rutas nuevas en el manifest).
SQL: 1 migración revisada, idempotente, solo demo workspace, verificada antes/después
(0 PII), rollback documentado.

## 13. Archivos tocados
- NUEVO `src/app/api/onboarding/workspace/route.ts` (provisioning seguro).
- NUEVO `src/app/onboarding/page.tsx` (UI alta de espacio vacío).
- `src/components/AuthGate.tsx` (sin-workspace → `/onboarding`, sin signOut).
- `src/components/TeamUsersCard.tsx` (error → empty state; alerta solo operador).
- `src/app/(saas)/dashboard/page.tsx` (empty state → onboarding 4 pasos).
- `src/app/(saas)/calendar/page.tsx` (ocultar estado Google al cliente).
- NUEVO `supabase/migrations/20260621_p31_sanitize_demo_workspace_pii.sql`.
- Docs: este report + `FACTORY_STATE_AND_DEMO_DATA_POLICY.md` + `QA_CHECKLIST.md`.

## 14-15. Commit / push
Ver hash del commit `feat(factory): self-onboarding + sanitize demo PII + UI polish (P3.1)`.
Push a `origin/main`.

## 16. Redeploy
**Sí** (cambió `src/`). Desplegar con `NEXT_PUBLIC_NOWLABS_INTERNAL=false` (vista cliente) y
**`SUPABASE_SERVICE_ROLE_KEY` presente en el servidor** (necesario para el self-onboarding;
sin ella el alta cae al fallback admin).

## 17. Qué probar en staging (tras redeploy)
1. **Demo** (`d0000000…`): clientes ficticios, **sin Oier/DNI real**; el cliente que era
   Oier ahora es "Javier Ortega Ruiz".
2. **Onboarding**: crear un `auth.user` nuevo en Supabase (sin profile) → iniciar sesión →
   debe aparecer **`/onboarding`** ("Crea tu espacio de trabajo") → tras crear, **dashboard
   vacío** con la card "Tu CRM está listo" (4 pasos), Clientes/Operaciones/Calendario
   vacíos, Settings limpio.
3. **Settings**: si el equipo no carga, **empty state elegante** (sin alerta amarilla).
4. **Calendario** (cliente): sin "Google no conectado" ni "Sin Google Calendar".

## 18. Pendientes honestos
- **Operaciones** premium → requiere screenshots para iterar sin romper.
- **E2E del onboarding** (crear usuario nuevo) → lo prueba el usuario (no testeable aquí).
- **Coherencia "Próximos eventos"** del calendario (decía "sin citas" habiendo eventos en
  la semana) → no reproducible sin datos/render; revisar con caso concreto.
- Self-onboarding está **siempre activo** si hay service_role; si algún deployment quiere
  alta solo-admin, habría que gatearlo con un flag (no incluido).
- Posible signup público a nivel de Supabase Auth: la app no expone signup, pero conviene
  confirmar que `Enable signups` está como se desea en el proyecto.

## 19. Veredicto
**P3.1 COMPLETADO — FACTORY ONBOARDING + DEMO SAFE + PREMIUM UI POLISH (con E2E de
onboarding pendiente de prueba del usuario).** Un cliente nuevo ya **no ve la demo**: crea
su propio espacio vacío y guiado desde la UI (sin SQL). La demo comercial quedó **sin PII
real** (verificado, 0 tokens). Settings/Dashboard/Calendario más premium y sin estados
feos. Operaciones queda para iteración con screenshots. tsc/lint/build verdes; el único
cambio de datos fue una migración idempotente y no destructiva sobre el workspace demo.
**Requiere redeploy con `SUPABASE_SERVICE_ROLE_KEY`.**
