# Runbook — Acceso público a Staging (EasyPanel)

> Qué hacer cuando un validador externo ve **ERR_CONNECTION_TIMED_OUT** (u otro error) al abrir
> `https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host/login`.

## TL;DR (P47)
En el diagnóstico de P47 la URL **respondía correctamente** desde fuera:

```
$ curl -I -L --connect-timeout 10 https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host/login
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
X-Nextjs-Cache: HIT
X-Powered-By: Next.js
# DNS: crm-inmobiliario-crm-staging.hvdnby.easypanel.host → 187.77.166.196
```

→ La app **está desplegada y sirve el login**. El `ERR_CONNECTION_TIMED_OUT` que vio el validador es un
problema de **disponibilidad/infraestructura o de la red del propio validador**, NO del código. Este runbook
sirve para reproducir el diagnóstico y actuar según el resultado. **No se puede "arreglar desde código" un
timeout de red**; se diagnostica y se documenta.

## 1. Diagnóstico rápido (30 segundos)
Ejecuta desde cualquier máquina con internet (no la del validador si sospechas de su red):

```bash
curl -I -L --connect-timeout 10 https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host/login
nslookup crm-inmobiliario-crm-staging.hvdnby.easypanel.host
```

Interpretación:

| Síntoma | Significado probable | Acción |
|---|---|---|
| **200 OK** | App arriba y sirviendo | Es la red del validador (firewall corporativo, DNS, VPN, móvil). Que pruebe con datos móviles / otro navegador / modo incógnito. |
| **ERR_CONNECTION_TIMED_OUT** (curl cuelga) | Contenedor parado, proxy caído o puerto mal | EasyPanel → App → **Start/Restart**; revisar puerto y proxy (§2). |
| **502 / 503 Bad Gateway** | Proxy vivo pero la app no responde en su puerto | App caída o escuchando en puerto equivocado. Revisar logs y `PORT` (§2). |
| **404** | Proxy/ruta OK pero dominio no mapeado a esta app | Revisar **Domains** del servicio en EasyPanel. |
| **SSL / certificado inválido** | Certificado no emitido/renovado | EasyPanel → Domains → regenerar certificado (Let's Encrypt). |
| **NXDOMAIN / no resuelve** | DNS del subdominio caído | Problema de EasyPanel/DNS del proveedor; esperar o recrear dominio. |

## 2. Checklist en EasyPanel (si NO responde)
1. **App running**: panel del servicio `crm-staging` → estado *Running* (verde). Si no, **Start**.
2. **Logs**: pestaña *Logs* → buscar `ready`/`started server on 0.0.0.0:3000`. Errores típicos:
   - falta de variable de entorno (Supabase URL/key) → la app arranca pero rutas fallan;
   - `EADDRINUSE` / puerto → revisar puerto expuesto.
3. **Port**: el contenedor Next.js escucha en **3000** por defecto. El proxy de EasyPanel debe apuntar a ese
   puerto. (En este proyecto `next start` usa `PORT` si está definido.)
4. **Proxy / Domains**: el dominio asignado (`…hvdnby.easypanel.host`) debe estar mapeado al servicio y con
   **HTTPS** activado (Let's Encrypt).
5. **Healthcheck**: si hay healthcheck configurado, que apunte a `/login` o `/` (rutas estáticas 200).
6. **Restart** del servicio como último recurso; volver a ejecutar el curl de §1 para confirmar 200.

## 3. Variables de entorno imprescindibles (no bloquean el arranque, pero sí el uso)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (o `ANON_KEY`) — login y datos.
- `OPENAI_API_KEY` (opcional; el Asistente tiene **fallback local** para lecturas básicas — ver P47).
- `ASSISTANT_PROVIDER` — por defecto `n8n`. **Nota P47**: aunque n8n esté caído, "¿qué clientes tengo?" y
  "¿qué pisos hay en cartera?" responden por el layer local (no dependen de n8n).
- Nunca poner `SUPABASE_SERVICE_ROLE_KEY` en variables `NEXT_PUBLIC_*`.

## 4. Qué NO hacer
- No cambiar el dominio final ni tocar DNS "a ciegas".
- No asumir que es código si el `curl` da 200 (es la red del cliente).
- No desplegar cambios de código para "arreglar" un timeout de infra.

## 5. Evidencia de la última comprobación (P47)
`curl -I` → **200 OK**, `X-Nextjs-Cache: HIT`. DNS → `187.77.166.196`. App operativa en el momento del cierre
de P47. Si el validador sigue sin entrar, aislar su red (datos móviles / incógnito / otro dispositivo).
