# FASE P1 — CRM básico como producto final (auditoría + pulido)

> **Fecha:** 2026-06-21 · HEAD previo `db1ace0`. Toca runtime CRM (`src/`, mínimo) →
> **requiere redeploy del CRM**. Sin tocar `.env`/`.mcp.json`/secretos/Supabase/RLS/
> workflows/Auth. Sin features nuevas.

---

## 1. Objetivo
Dejar el CRM básico listo para enseñar a un cliente sin pedir perdón por UI, textos o
módulos dormidos. Primero pack básico perfecto; los extras (facturas, scraper, WhatsApp,
web) van como módulos premium posteriores.

## 2. Estado inicial (auditoría)
**Hallazgo central: el producto ya está fuertemente productizado.** No había restos
legacy de marca en UI (BRAND centralizado, sin "NowLabs/CostaDelSol/Real Homes"), y los
módulos dormidos ya se ocultan por **feature flags**:
- `src/lib/feature-flags.ts`: `nowlabsInternal` y `demoData` **default OFF**; el resto
  default ON. Un clon de cliente sin `NEXT_PUBLIC_NOWLABS_INTERNAL=true` NO ve módulos
  operativos.
- `Sidebar.tsx`: nav del cliente = Dashboard, Clientes, Operaciones, Calendario, Asistente
  IA, Configuración. WhatsApp/Inbox, Automatizaciones y Facturación marcados `internal`
  (ocultos salvo flag interno).
- **lead_score / "Score"** en listado y ficha de cliente: ya gateado por
  `NEXT_PUBLIC_NOWLABS_INTERNAL === 'true'` → invisible al cliente.
- **Dashboard**: KPIs de "Cobros pendientes" y "WhatsApp" ya gateados por NOWLABS_INTERNAL.
- **Settings**: superficie técnica (editor n8n, flows, env checklist) gateada por
  `SHOW_INTERNAL_TECH` (NOWLABS_INTERNAL).
- **Asistente**: quick-actions ya limpias y read-only (Cómo va todo, Qué tengo pendiente,
  Operaciones abiertas, Buscar cliente, Resumen cliente, Citas de la semana, Buscar
  propiedad, Expedientes abiertos, Plan del día). Copiloto = n8n Agent V2 (N4.x).

Clasificación: **(1) visible al cliente** = pack básico (ver roadmap); **(2) interno/oculto**
= billing/inbox/automations + tiles técnicos (gateados); **(3) dormido útil futuro** =
módulos premium; **(4) legacy a quitar** = prácticamente nada en UI; **(5) riesgo de tocar**
= layouts grandes (assistant 4039 líneas) → no se rediseñan a ciegas.

## 3. Qué se limpió
Fugas de copy: el subtítulo y el empty-state del Dashboard mencionaban "cobros" (módulo
oculto para el cliente). Corregido:
- "Resumen del día: clientes, citas, expedientes ~~y cobros~~ del workspace."
- "...a medida que añadas clientes, citas ~~o cobros~~ o expedientes, irá apareciendo aquí."

## 4. Qué queda oculto (premium, ya gateado)
Facturación, WhatsApp/Inbox, Automatizaciones, tiles técnicos de Settings, chips de score,
KPIs de cobros/WhatsApp — todos detrás de `nowlabsInternal` (OFF por defecto). No requieren
cambios de código para un clon de cliente: basta el env.

## 5. Pack básico (resumen)
Dashboard · Clientes (+ficha 360) · Operaciones (pipeline) · Expedientes · Tareas ·
Calendario interno · Documentos (metadata) · Asistente IA read-only · Demo offline ·
Configuración básica. Detalle en `docs/PRODUCT_MODULE_ROADMAP.md`.

## 6. Cambios UI/UX por página
- **Dashboard:** copy de cobros eliminado del texto del cliente (KPIs de cobros/WhatsApp ya
  estaban gateados). Resto ya correcto (MetricTiles, snapshot operativo, próximas citas,
  clientes recientes, actividad, empty states elegantes).
- **Clientes / ficha / Operaciones / Calendario / Asistente / Settings:** auditados, sin
  restos legacy ni cadenas técnicas visibles al cliente; sin cambios necesarios.
- **Naming** ya comercial: Operaciones (opportunities), Expedientes (service_cases),
  Asistente IA / Copiloto. "lead score" nunca visible al cliente.

## 7. Configuración / demo / datos
- Settings ya separa cliente vs operador (`SHOW_INTERNAL_TECH`). No se tocó (evitar
  regresión); recomendación opcional futura: recortar los tiles "Próxima fase" para una
  vista 100% cliente.
- **No** se tocaron seed ni datos reales (regla: no destruir datos sin confirmación). El
  dataset demo/seed es inmobiliario coherente. Nota: si en algún momento se publica un seed,
  redactar/ficticiar DNI/email/teléfono de prueba (ver §Seguridad).

## 8. Seguridad
Sin secretos/PII en el diff. No se tocó `.env.local`/`.mcp.json`/RLS/Auth/Supabase. El
DNI/email/teléfono reales del workspace de pruebas viven en datos, no en el repo.

## 9. QA
- **Automática:** `tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅ (sin regresión de tipos/
  build). Sweep de cadenas dev/legacy en páginas de cliente: limpio.
- **Manual (pendiente en staging, requiere navegador):** login, dashboard, clientes,
  búsqueda, ficha, operaciones, tareas, calendario, asistente, configuración, logout, F5,
  móvil; demo mode; y los prompts del asistente ("Qué tal estás?", "Hazme un tour", "Dame
  datos sobre Oier", "Dame su DNI", "Para mañana a las 11 tengo libre?", "Hay facturas
  vencidas?", "Puedo crear cliente?", "Dame el UUID", "Hasta luego"→"Hola?"). El asistente
  ya está certificado por la suite de evals (171 casos, N4.x).

## 10. Riesgos
- No se hizo rediseño visual profundo (no verificable sin navegador) → bajo riesgo, pero el
  pulido fino de layout/responsive se valida mejor en staging con ojo humano.
- Para un demo de cliente hay que **fijar el env** (`NEXT_PUBLIC_NOWLABS_INTERNAL=false`,
  `NEXT_PUBLIC_ENABLE_DEMO_DATA` según caso); si se queda en `true`, el cliente vería los
  módulos internos.

## 11. Redeploy
**Sí** (cambió `src/dashboard`). Aprovechar para incluir el runtime pendiente de N4/N4.1.

## 12. Próximos pasos
1. Redeploy del CRM con `NEXT_PUBLIC_NOWLABS_INTERNAL=false` para el clon de cliente.
2. QA visual manual en staging (checklist §9) + móvil.
3. (Opcional) recortar tiles "Próxima fase" de Settings para vista pura de cliente.
4. Empezar módulos premium por packs (facturas, scraper, WhatsApp, web) — ver roadmap.

## Veredicto
**P1 PARCIAL SEGURO — BASIC CRM PRODUCT (núcleo listo, falta QA visual humano).** El pack
básico ya está productizado y limpio: branding centralizado, módulos premium ocultos por
flags, sin legacy en UI de cliente, naming comercial, asistente read-only certificado.
Se cerraron las fugas de copy ("cobros") del dashboard y se documentó el alcance (roadmap +
este informe). tsc/lint/build verdes. **Requiere redeploy** y una pasada de **QA visual en
staging** (no automatizable aquí) para declararlo COMPLETADO.
