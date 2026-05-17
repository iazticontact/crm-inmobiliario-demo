# Variables de entorno — NowCRM / NowLabs AI

**Nunca commitear valores.** Esta tabla es solo nombres y descripción.

`.env.local` para desarrollo. Vercel **Environment Variables** (separadas
por entorno) para producción.

## Supabase

| Variable                              | Local | Prod | Obligatoria | Dónde se obtiene |
| ------------------------------------- | :---: | :--: | :---------: | ---------------- |
| `NEXT_PUBLIC_SUPABASE_URL`            | ✅    | ✅   | sí          | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`       | ✅    | ✅   | sí¹         | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`| ✅    | ✅   | sí¹         | Supabase → Project Settings → API (alternativa al anon key) |
| `SUPABASE_SERVICE_ROLE_KEY`           | ✅    | ✅   | sí          | Supabase → Project Settings → API → service_role |

¹ Una de las dos (publishable o anon). Si tienes ambas, NowCRM prefiere la publishable.

## OpenAI / NowLabs AI

| Variable           | Local | Prod | Obligatoria | Dónde se obtiene |
| ------------------ | :---: | :--: | :---------: | ---------------- |
| `OPENAI_API_KEY`   | ✅    | ✅   | sí (para IA)| https://platform.openai.com/api-keys |
| `NOWLABS_MODEL`    | opc   | opc  | no          | default `gpt-4.1-mini` |
| `OPENAI_MODEL`     | opc   | opc  | no          | alias de `NOWLABS_MODEL` para compat |

Sin `OPENAI_API_KEY` el agente devuelve `reason: 'no_api_key'` y los botones
IA del Inbox quedan deshabilitados; el resto del CRM sigue funcionando.

## Meta WhatsApp Cloud API

| Variable                       | Local | Prod | Obligatoria | Dónde se obtiene |
| ------------------------------ | :---: | :--: | :---------: | ---------------- |
| `META_WHATSAPP_ACCESS_TOKEN`   | ✅    | ✅   | sí (para envío) | Business Settings → System Users → Generate Token |
| `META_APP_SECRET`              | ✅    | ✅   | sí          | Meta Developers → App → Settings → Basic |
| `META_WEBHOOK_VERIFY_TOKEN`    | ✅    | ✅   | sí          | **lo generas tú** (UUID) y lo registras en Meta |
| `NOWCRM_WEBHOOK_SECRET`        | ✅    | ✅   | sí          | **lo generas tú** — secreto interno NowCRM |
| `META_GRAPH_VERSION`           | opc   | opc  | no          | default `v21.0` |
| `META_ACCESS_TOKEN`            | opc   | opc  | no          | alias legacy de `META_WHATSAPP_ACCESS_TOKEN` |

Sin estas variables NowCRM **persiste el inbound** (si hay service_role) pero
guarda los outbound como `pending_config` en vez de enviarlos.

## n8n (brazo externo)

| Variable                     | Local | Prod | Obligatoria | Dónde se obtiene |
| ---------------------------- | :---: | :--: | :---------: | ---------------- |
| `N8N_BASE_URL`               | opc   | ✅   | sí (para real)| URL HTTPS de tu instancia n8n |
| `N8N_API_KEY`                | opc   | ✅   | recomendada | n8n → Settings → API |
| `N8N_WEBHOOK_SECRET`         | opc   | ✅   | recomendada | **lo generas tú**, se envía como `x-nowcrm-secret` |
| `N8N_DEFAULT_TIMEOUT_MS`     | opc   | opc  | no          | rango 1000–30000, default 8000 |
| `N8N_LOG_TRIGGERS`           | opc   | opc  | no          | `1` para activar logs en prod |

Sin `N8N_BASE_URL`, `/api/n8n/trigger` responde `simulated` y nunca llama a n8n.
La URL real **siempre** se construye en el servidor a partir de `N8N_BASE_URL` +
un slug de la allowlist. Ningún input de cliente puede redirigir el tráfico.

## Google Calendar OAuth

| Variable                | Local | Prod | Obligatoria | Dónde se obtiene |
| ----------------------- | :---: | :--: | :---------: | ---------------- |
| `GOOGLE_CLIENT_ID`      | ✅    | ✅   | sí          | Google Cloud → Credentials → OAuth 2.0 |
| `GOOGLE_CLIENT_SECRET`  | ✅    | ✅   | sí          | igual                  |
| `GOOGLE_REDIRECT_URI`   | ✅    | ✅   | sí          | igual; debe coincidir exactamente |

Sin estas tres, la integración de Calendar queda como `pending_config` y los
botones de "Conectar Google Calendar" muestran el motivo exacto.

## App / utilidades

| Variable                | Local | Prod | Notas |
| ----------------------- | :---: | :--: | ----- |
| `NEXT_PUBLIC_APP_URL`   | ✅    | ✅   | URL pública canónica para enlaces salientes |
| `NODE_ENV`              | auto  | auto | gestionado por Next.js |

`NEXT_PUBLIC_APP_URL` se usa para textos visibles (p.ej. "URL del webhook NowCRM
en Settings"). **Ya no se usa para self-fetch del webhook de Meta** — eso
ahora va por una función server-side directa.

## Cómo verificar el estado desde la propia app

`GET /api/config/status` (requiere sesión) devuelve booleans + lista de
nombres de variables faltantes por área. Nunca expone valores. Settings e
Inbox lo consumen para mostrar los warnings.

## Qué hacer si una variable falta

| Área         | Falta                              | Comportamiento esperado |
| ------------ | ---------------------------------- | ----------------------- |
| Supabase     | URL / publishable                  | App no arranca / 503    |
| Supabase     | service_role                       | Outbound Meta se guarda como `pending_config` |
| OpenAI       | API key                            | Botones IA disabled; agente devuelve `no_api_key` |
| Meta         | `META_APP_SECRET` en prod          | Webhook rechaza POST con 503 |
| Meta         | `META_WHATSAPP_ACCESS_TOKEN`       | Outbound → `pending_config` (no falla feo) |
| Meta         | `META_WEBHOOK_VERIFY_TOKEN`        | Verificación GET de Meta → 503 |
| Meta         | `NOWCRM_WEBHOOK_SECRET`            | Bridges internos rechazados; webhook Meta sigue funcionando |
| n8n          | `N8N_BASE_URL`                     | `/api/n8n/trigger` → `simulated`; no llamada real |
| Google       | client id/secret/redirect          | OAuth no inicia; el botón muestra el motivo |

## Lo que **nunca** se guarda en cliente, env público ni Settings UI

- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `META_WHATSAPP_ACCESS_TOKEN`
- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`
- `NOWCRM_WEBHOOK_SECRET`
- `N8N_API_KEY`
- `N8N_WEBHOOK_SECRET`
- Cualquier `GOOGLE_*` secreto

Si encuentras alguno en un componente `'use client'`, `NEXT_PUBLIC_*`, en el
campo "Phone Number ID" de Settings, o en un response JSON: bug, abrirlo en
la cola de seguridad.
