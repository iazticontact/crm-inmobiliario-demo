# Data Reality Policy — datos reales vs datos demo

> **Fecha:** 2026-06-14 · **Fase:** 2E-2 DATA-POLICY
> **Regla de producto innegociable:** cuando un usuario real inicia sesión, el
> CRM se comporta como un CRM inmobiliario real. **Cero datos inventados.**

Este documento es la fuente de verdad sobre cuándo la app puede mostrar datos
ficticios y cuándo está terminantemente prohibido. Aplica a todos los módulos
actuales y futuros (RT2, RT3, Storage, Billing, Inbox, Asistente IA).

---

## 1. Principio general

Un usuario real **solo** ve datos reales de **su** workspace en Supabase:

- Solo datos reales de Supabase.
- Solo datos del workspace del usuario (aislados por RLS).
- Cero mocks, cero datos inventados, cero "ejemplos".
- Cero fallback demo silencioso.
- Cero hardcoding de clientes / inmuebles / operaciones / facturas / tareas.
- Si no hay datos → **estado vacío profesional**, nunca relleno ficticio.

Los datos ficticios existen **solo** para vender/desarrollar la demo, y solo se
sirven cuando el usuario entra **explícitamente** en modo demo.

---

## 2. Modo real vs modo demo

La decisión vive en [src/lib/current-user.ts](../src/lib/current-user.ts),
[src/lib/feature-flags.ts](../src/lib/feature-flags.ts) y
[src/components/AuthGate.tsx](../src/components/AuthGate.tsx).

### Tres estados posibles

| Estado | Condición | Datos que se muestran |
|--------|-----------|------------------------|
| **Demo** | `localStorage['nowcrm-demo-mode'] === 'true'` (botón "Ver demo inmobiliaria") | Mocks (`mock-data.ts`, `demo/demo-real-estate.ts`) |
| **Real** | Sesión Supabase válida **y** demo mode NO activo | Supabase, workspace del usuario, vía RLS |
| **Sin sesión** | Ni sesión ni demo mode | Login. Nunca datos ficticios |

Notas clave:

- `DEMO_MODE_KEY = 'nowcrm-demo-mode'`. El cortocircuito demo va **antes** de
  cualquier query a Supabase, en cada página.
- `NEXT_PUBLIC_ENABLE_DEMO_DATA` (flag `featureFlags.demoData`, **default OFF**):
  controla si un clon de cliente puede caer a `demoUser` cuando no hay sesión y
  si se muestra el botón demo en `/login`. En despliegues de cliente real está
  **OFF** → sin sesión = `null` y AuthGate redirige a login.
- `NEXT_PUBLIC_FORCE_OFFLINE_DEV`: escotilla **solo dev**, hard-gated a
  `NODE_ENV !== 'production'`. Nunca concede sesión sintética en producción.
- El acceso a datos reales es **client-side** con la clave anon/publishable y
  RLS. **Nunca** `service_role` en el navegador (ver §10).

---

## 3. Reglas para desarrolladores

1. **El gate demo va primero.** Toda carga de datos comprueba
   `localStorage.getItem(DEMO_MODE_KEY) === 'true'` antes de tocar Supabase.
   Patrón canónico (ver [dashboard](../src/app/(saas)/dashboard/page.tsx),
   [clients](../src/app/(saas)/clients/page.tsx)):

   ```ts
   if (typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true') {
     setData(demoData)        // mocks SOLO aquí
     setWorkspaceId(null)
     return
   }
   // ... a partir de aquí, solo Supabase real
   ```

2. **No importes `mock-data.ts` ni `demo/*` fuera de una rama demo.** Si un
   archivo los importa, el único uso permitido es dentro del `if (isDemoMode)`.

3. **Prohibido el fallback a mock en modo real.** Nunca
   `catch { return mockData }`, `data.length || mockData`, `data ?? demoData`.

4. **Escrituras bloqueadas en demo.** En demo, crear/editar/borrar muestra un
   toast "Modo demo (solo lectura)" y retorna sin tocar Supabase.

5. **`featureFlags` solo oculta navegación.** No es seguridad. La seguridad real
   es RLS + `pending_config` server-side. No uses flags para inyectar datos.

---

## 4. Qué está permitido en modo demo

- Servir `mock-data.ts` y `demo/demo-real-estate.ts` (nombres, emails
  `@example.com`, teléfonos: **todos inventados**).
- Banners / badges "Modo demo" para que quede claro que no son datos reales.
- Cambios optimistas en pantalla que no se persisten ("cambio aplicado, no se
  guarda").
- Mostrar el botón "Ver demo inmobiliaria" en `/login` (si `demoData` ON).

El modo demo y su botón **no se deben romper**: son la herramienta comercial.

---

## 5. Qué está prohibido en modo real

- Mostrar cualquier registro de `mock-data.ts` / `demo/*`.
- Caer a datos demo si Supabase falla o devuelve vacío.
- Hardcodear clientes/inmuebles/operaciones/facturas/tareas en JSX.
- Mostrar nombres de ejemplo como si fueran datos (los `placeholder=` de inputs
  usan textos neutros: "Nombre y apellidos", "Nombre del cliente").
- Que el asistente IA afirme que existen datos que no están en Supabase (§8).

---

## 6. Manejo de errores de Supabase

- **Por consulta:** `.catch(() => [])` → lista vacía, **nunca** mock. Ejemplo en
  [dashboard](../src/app/(saas)/dashboard/page.tsx) (`getInvoices(...).catch(() => [])`).
- **Error global de carga:** `setData([])` + estado de error controlado. En
  modo real, el mensaje al usuario debe ser honesto (p. ej. "No se pudieron
  cargar conversaciones"), **sin** sugerir que se entró en modo demo.
- Nunca silenciar un error real disfrazándolo de "modo demo".

---

## 7. Manejo de listas vacías (empty states)

Si una consulta real devuelve `[]`, mostrar un estado vacío profesional, nunca
datos de ejemplo. Patrones ya presentes:

- Clientes / Inmuebles / Operaciones / Inbox → componente `EmptyState`.
- Ficha de cliente → "Sin expedientes abiertos", "Sin propiedades vinculadas",
  "Sin operaciones activas", "Sin citas programadas para este cliente".

Copys de referencia: "Aún no hay clientes", "Añade tu primer inmueble",
"Todavía no hay operaciones activas", "No hay actividad registrada".

---

## 8. Reglas para el Asistente IA

Implementadas en [src/lib/ai.ts](../src/lib/ai.ts) (`buildOperationalPrompt`) y
respetadas por el flujo n8n y el responder heurístico (`generateMockAIResponse`).

- **Nunca inventar** clientes, inmuebles, operaciones, facturas ni tareas como
  si existieran salvo que consten en Supabase o en el contexto aportado.
- Si no hay datos reales del workspace, responder de forma explícita:
  **"No encuentro datos reales en este workspace."** y ofrecer crearlos.
- Puede **sugerir** crear datos; no puede **fingir** que existen.
- Ejemplos concretos solo si el usuario los pide explícitamente o en modo demo.
- No inventar importes/precios: pedir tipo de negocio, usuarios y módulos.
- No confirmar acciones críticas como creadas sin confirmación en el CRM.
- Los conteos del asistente (`get_workspace_summary`) salen de Supabase real;
  solo se piden cuando hay `workspaceId` real y no es demo.

---

## 9. Reglas para futuras fases

- **RT2 (ficha profunda + tasks + activities):** tasks/activities reales por
  workspace; vacío → empty state. Ver
  [PHASE_2E2_RT2_TASKS_ACTIVITIES_PLAN.md](PHASE_2E2_RT2_TASKS_ACTIVITIES_PLAN.md).
- **RT3 (calendar):** eventos reales; sin eventos → "Sin citas programadas".
- **Storage (documentos):** en demo, subir documentos está deshabilitado y la
  lista es `[]`; en real, archivos del workspace vía API + RLS.
- **Billing:** facturas reales del workspace; demo usa `invoices` mock. Nunca
  mezclar. PDFs reales se generan desde datos reales.
- **Inbox / WhatsApp:** conversaciones reales del workspace; sin sesión real no
  se muestran conversaciones demo (toast "Assistant sin sesión real").

Regla transversal: **cada módulo nuevo repite el patrón gate-demo-primero +
empty-state + sin fallback a mock en real.**

---

## 10. Checklist antes de entregar a un cliente

- [ ] `NEXT_PUBLIC_ENABLE_DEMO_DATA=false` en el despliegue del cliente.
- [ ] `NEXT_PUBLIC_FORCE_OFFLINE_DEV` ausente o `false`.
- [ ] `.env.local` apunta al proyecto Supabase correcto del cliente.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` solo server-side (route handlers); jamás en
      componentes `'use client'` (ver [supabase-admin.ts](../src/lib/supabase-admin.ts)).
- [ ] Login real → dashboard/clientes/inmuebles/operaciones muestran datos del
      workspace, no demo.
- [ ] Workspace vacío → empty states, sin nombres/registros de ejemplo.
- [ ] Asistente IA: ante workspace sin datos, dice "No encuentro datos reales en
      este workspace" y no inventa.
- [ ] Botón "Ver demo inmobiliaria" oculto (o claramente etiquetado) según el
      caso comercial.
- [ ] `npx tsc --noEmit`, `npm run lint -- --max-warnings=0`, `npm run build`
      en verde.
