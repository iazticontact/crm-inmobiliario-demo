# NowCRM Deployment

## Variables necesarias

No incluir valores en el repositorio. Configurar en el proveedor:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

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
- Build command: `npm run build`.
- Start command: `npm start`.
- Variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

En Supabase Auth, anadir:

- `https://dominio.com/auth/callback`
- `https://dominio.com/reset-password`

## Email transaccional

Cuando haya dominio:

1. Configurar Resend SMTP.
2. Activar Confirm email ON en Supabase.
3. Usar remitente tipo `no-reply@dominio.com`.
4. Verificar que signup y reset password usan URLs absolutas del dominio.

## Checklist previo a demo publica

- `npm run lint`
- `npm run build`
- Probar login real.
- Probar modo demo.
- Probar clients/billing/calendar.
- Probar callback y reset password.
- Revisar URLs autorizadas en Supabase.
