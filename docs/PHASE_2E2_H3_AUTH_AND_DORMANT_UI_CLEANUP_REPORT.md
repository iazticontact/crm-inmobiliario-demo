# Phase 2E-2 H3 — Login/Auth triage + dormant-UI cleanup

> **Fecha:** 2026-06-15 · **Base:** `bd1f5a4` · Cambios de UI/producto + mapeo de
> error de login. **No se tocó `.env.local`, ni schema, ni backend, ni rutas.**

## 1. Problema detectado
- **Login real bloqueado:** toast "Acceso no completado · Invalid API key".
- **Contraseña:** el formulario exige ≥8 caracteres; el usuario de prueba en
  Supabase tenía 7.
- **Confusión real/demo:** Oier navegaba en modo demo (`demo@crm-demo.local`).
- **Módulos dormidos visibles** como si funcionaran (WhatsApp, cobros/facturas,
  documentos, conversaciones).

## 2. Login/Auth triage — diagnóstico (con evidencia)
Verificado **sin imprimir valores**:
- `.env.local`: `NEXT_PUBLIC_SUPABASE_URL` → proyecto correcto `ylhdba…`;
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`, len 46) y
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (JWT, len 208) **ambos presentes**.
- **Test en vivo contra Supabase** (`/auth/v1/settings` con cada `apikey`):
  **PUBLISHABLE → HTTP 200 VALID** y **ANON → HTTP 200 VALID**.
- La publishable key del `.env.local` **coincide** con la del dashboard (MCP
  `get_publishable_keys`).
- `src/lib/supabase.ts` usa `publishableKey || anonKey` (prefiere publishable).

➡️ **Conclusión:** las claves del `.env.local` son **correctas y válidas**. El
"Invalid API key" del navegador proviene de un **servidor de desarrollo
"rancio"**: el `next dev` (PID 5356) se arrancó **antes** de que la publishable
key estuviera bien, y las `NEXT_PUBLIC_*` se **inlinean al arrancar/buildear** →
el bundle servido al navegador llevaba una clave antigua.

**Fix (operativo, lo hace Oier — no es bug de código ni de `.env.local`):**
1. Parar el `next dev` actual (Ctrl+C en esa terminal; o `taskkill /PID 5356 /F`).
2. `npm run dev` de nuevo (re-lee `.env.local`).
3. **Hard refresh** del navegador (Ctrl+Shift+R) para descartar bundle cacheado.

**Fix de código aplicado (seguro):** `getAuthErrorMessage` en
[src/app/login/page.tsx](../src/app/login/page.tsx) ahora **mapea** los errores y
**nunca** muestra el texto crudo:
- "invalid login credentials" → "Email o contraseña incorrectos."
- contiene "api key" → "Configuración de acceso incompleta. Avisa al equipo
  técnico (revisar variables de entorno y reiniciar el servidor)."
- "failed to fetch"/"network" → mensaje de conexión.
- fallback genérico (sin exponer texto interno de Supabase).

## 3. Decisión sobre contraseña
- **Se mantiene el mínimo de 8 caracteres** (no se baja la seguridad del
  producto). El código (`validateAuthFields`) ya exige ≥8 y está bien.
- **Acción para Oier:** resetear el usuario de prueba en Supabase Auth con una
  contraseña **≥8** (Dashboard → Authentication → Users → reset password). No se
  toca Auth desde aquí.

## 4. Qué se ocultó (gateado por `NEXT_PUBLIC_NOWLABS_INTERNAL`, reversible, sin borrar código)
- **Dashboard** ([dashboard/page.tsx](../src/app/(saas)/dashboard/page.tsx)):
  tiles **"Cobros pendientes"** y **"WhatsApp"** (no hay invoices/conversations).
- **Ficha cliente** ([clients/[id]/page.tsx](../src/app/(saas)/clients/[id]/page.tsx)):
  pestañas **Documentos**, **Conversaciones**, **Facturación** (sin backend real).
  Las secciones/código de esas tabs se mantienen intactas.
- **Asistente** ([assistant/page.tsx](../src/app/(saas)/assistant/page.tsx)):
  quick chips **"Crear factura"/"Revisar cobros"** y ejemplos de capacidad de
  facturación/cobros sustituidos por reales (operaciones/expedientes).

## 5. Qué se renombró
- **Operaciones** ([opportunities/page.tsx](../src/app/(saas)/opportunities/page.tsx)):
  título `Gestión` → **`Operaciones`**; subtítulo → "Pipeline comercial,
  expedientes y propiedades del workspace." (El topbar ya decía Operaciones.)
- Asistente: `capabilities` y `capabilityExamples` ahora reflejan módulos reales
  (Clientes/Operaciones/Expedientes/Tareas/Citas), no facturación.

## 6. Qué NO se tocó (y por qué)
- **`.env.local`, schema, backend, rutas, Auth users, Storage, n8n** — fuera de
  alcance / prohibido.
- **Settings deep cleanup (FASE F)**, **Calendar Google status (FASE J)** y
  **ocultar el modo Inbox completo del asistente (FASE G profundo)**: **diferidos
  a un H4 enfocado**. Son cirugía en ficheros muy grandes (settings y assistant
  ~3k líneas; calendar ~1.3k con estado Google) y hacerlo con prisa **justo antes
  del smoke** arriesga romper la página estrella. Billing/Automatizaciones/
  WhatsApp ya están ocultos del nav (internal). Se documentan con ubicaciones.

## 7. Modo real vs demo (verificado)
- Demo solo se activa por el botón "Ver demo inmobiliaria" (`localStorage`
  `DEMO_MODE_KEY`). El login real **borra** esa clave (`signInWithPassword` →
  `removeItem(DEMO_MODE_KEY)`); el logout también la limpia. No hay caída
  silenciosa a demo; modo real no usa mocks (Data Reality Policy).

## 8. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).

## 9. Riesgos
- El "Invalid API key" es **operativo** (servidor rancio): si Oier no reinicia el
  dev, seguirá viéndolo aunque el `.env.local` esté bien.
- Quedan dormidos visibles en **Settings**, **Calendar (estado Google)** y el
  **modo Inbox del asistente** hasta el H4.

## 10. Próximo paso
1. Reiniciar `next dev` + hard refresh.
2. Resetear contraseña del usuario de prueba a ≥8 en Supabase Auth.
3. **Ejecutar el smoke navegador real** (login → ficha/mutaciones → asistente →
   demo). Tras eso: H4 (settings/calendar/inbox cleanup) y staging.
