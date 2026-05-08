# NowCRM Deployment

## Variables necesarias

No incluir valores en el repositorio. Configurar en el proveedor:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Variables opcionales para integraciones:

- `N8N_WEBHOOK_SECRET`
- `N8N_DEFAULT_TIMEOUT_MS`
- `N8N_BASE_URL`
- `AGENT_TOOL_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY` (SERVER ONLY, nunca `NEXT_PUBLIC`)
- `AI_PROVIDER`
- `AI_API_KEY`

## Vercel

1. Importar el repositorio de GitHub.
2. Anadir variables de entorno en Project Settings.
3. Build command: `npm run build`.
4. Start command: gestionado por Vercel.
5. Anadir URLs de Vercel en Supabase Auth:
   - `https://tu-proyecto.vercel.app/auth/callback`
   - `https://tu-proyecto.vercel.app/reset-password`
6. Desplegar.

## Hostinger Business

El proyecto puede desplegarse en Hostinger Business si se usa hosting Node.js/Next.js.

- No usar static export.
- Usar runtime Node.js/Next.js, no solo alojamiento estatico.
- Build command: `npm run build`.
- Start command: `npm start`.
- Variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

En Supabase Auth, anadir:

- `https://dominio.com/auth/callback`
- `https://dominio.com/reset-password`

Despues del deploy:

- Configurar dominio y SSL.
- Actualizar Site URL en Supabase.
- Probar login real, reset password y logout.
- Probar `/assistant`, `/calendar`, `/billing` y Settings.
- Comprobar que el webhook production de n8n sigue respondiendo.
- Revisar CORS solo si algun endpoint externo lo requiere.

## EasyPanel / n8n en VPS

Para n8n real:

1. Desplegar n8n en EasyPanel/VPS con HTTPS.
2. Crear workflows con Webhook POST.
3. Copiar cada URL publica en Settings.
4. Si se usa secreto, configurar `N8N_WEBHOOK_SECRET` en NowCRM y validar `x-nowcrm-secret` en n8n.
5. Para Agent Tools de escritura, configurar `AGENT_TOOL_SECRET` o reutilizar `N8N_WEBHOOK_SECRET`.
6. Mantener credenciales IA/Supabase dentro de n8n Credentials.

## Email transaccional

Cuando haya dominio:

1. Configurar Resend SMTP.
2. Mantener Confirm email OFF solo para pruebas locales si hace falta.
3. Activar Confirm email ON en Supabase para demo publica/produccion.
4. Usar remitente tipo `no-reply@dominio.com`.
5. Verificar que signup y reset password usan URLs absolutas del dominio.

## Checklist previo a demo publica

- `npm run lint`
- `npm run build`
- Probar login real.
- Probar modo demo.
- Probar clients/billing/calendar.
- Probar callback y reset password.
- Revisar URLs autorizadas en Supabase.
- Probar `POST /api/n8n/trigger` en modo simulado antes de meter endpoints reales.
- Probar `POST /api/n8n/trigger` contra una URL n8n HTTPS real antes de la demo final.
- Verificar que WhatsApp/Whapi sigue marcado como pendiente si no hay QR real.
- Revisar que no hay valores de `.env.local` en capturas, docs o UI.
