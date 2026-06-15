# Staging Strategy — Hostinger / VPS (sin desplegar)

> **Fecha:** 2026-06-15 · **Estado:** ESTRATEGIA (no se despliega nada) ·
> Relacionado: [PRE_HOSTINGER_PRODUCTION_READINESS.md](PRE_HOSTINGER_PRODUCTION_READINESS.md)

## 1. Problema
- El dev local va **muy lento** (Windows + OneDrive + Next dev). No representa el
  rendimiento real de producción en un VPS Linux.
- Necesitamos un **entorno real** para probar el flujo end-to-end (login real,
  ficha, mutaciones, asistente IA con OpenAI live) sin el lastre de OneDrive.

## 2. Opciones
| Opción | Pros | Contras | Veredicto |
|---|---|---|---|
| **Hostinger VPS (Ubuntu) + Node + PM2/Nginx** | control total, `npm run build`/`start`, logs, SSL con Certbot, barato | hay que administrar el servidor | ✅ **Recomendado para staging y producción** |
| Hostinger "Node.js App" (hosting gestionado) | setup más simple | menos control de versión Node/procesos/SSR Next 16, posibles límites | ⚠️ Solo si el VPS no es opción |
| Vercel (temporal) | deploy Next trivial, preview URLs | otra plataforma/infra; el objetivo es Hostinger/VPS | ⚠️ Solo como prueba puntual, no como destino |
| VPS Contabo/antiguo | ya existe | **riesgo de mezclar con infra/secretos legacy** | ❌ **No** (regla: nada legacy) |

> **Recomendación:** **Hostinger VPS Ubuntu LTS** para staging, y la **misma
> receta** para producción (otro VPS o el mismo con dominio distinto). Supabase
> sigue siendo el cloud actual (`ylhdbawrllqygfvllhdo`).

## 3. Arquitectura de staging
- **App:** Next.js 16 (Turbopack) en VPS, `next start` detrás de **Nginx**
  (reverse proxy + SSL), gestionado por **PM2** (o systemd).
- **DB/Auth:** Supabase cloud actual (no cambia). Staging y prod pueden compartir
  el mismo proyecto al inicio (mismo workspace demo) o, mejor, **un proyecto
  Supabase separado para prod cliente** más adelante.
- **Secrets:** en `.env` del servidor (NO en Git). `SUPABASE_SERVICE_ROLE_KEY` y
  `AGENT_TOOL_SECRET` solo en el server.
- **OpenAI:** `OPENAI_API_KEY` real en el `.env` del server.

## 3b. n8n en el VPS (orquestador externo)
Ver estrategia completa en [N8N_AUTOMATION_STRATEGY.md](N8N_AUTOMATION_STRATEGY.md)
y el rol en [AI_N8N_MCP_RUNTIME_ARCHITECTURE.md](AI_N8N_MCP_RUNTIME_ARCHITECTURE.md).
- **Subdominios sugeridos:**
  - `staging.crm.tudominio.com` → CRM Next.js (staging)
  - `crm.tudominio.com` → CRM (producción)
  - `n8n.tudominio.com` → n8n self-host (panel + webhooks)
- **¿Mismo VPS o separado?** Staging: el mismo VPS que el CRM es aceptable.
  Producción: **n8n en instancia/VPS separada** (aísla carga y fallos; el CRM no
  debe caer si n8n se satura).
- **SSL:** Certbot para cada subdominio. n8n **nunca expuesto sin auth** (basic
  auth / login n8n) detrás de Nginx.
- **Secretos:** `N8N_BASE_URL`/`N8N_WEBHOOK_SECRET`/`N8N_API_KEY` en el `.env` del
  CRM; credenciales de integraciones (Meta/email) en **n8n credentials**, no en
  Git ni en el CRM. Webhooks CRM↔n8n con secreto + SSRF-guard (ya implementado).
- **Backups n8n:** exportar workflows (JSON) + backup de la BD de n8n + snapshots
  del VPS. **Staging y prod con instancias y secretos separados.**
- **Estado:** n8n se mantiene **dormido** hasta su fase (Fases C-E del roadmap);
  el CRM ya trae el puente seguro sin necesidad de tocar el frontend.

## 4. Requisitos
- **Node.js:** misma major LTS que en dev (Next 16 requiere Node ≥ 20; usar 20 o
  22 LTS).
- npm, git, Nginx, PM2 (o systemd), Certbot (Let's Encrypt) para SSL.
- Dominio/subdominio (p. ej. `staging.tudominio.com`) apuntando al VPS.

## 5. Comandos (en el servidor, NO ejecutar ahora)
```bash
git clone git@github.com:iazticontact/crm-inmobiliario-demo.git
cd crm-inmobiliario-demo
npm ci
# crear .env con TODAS las variables (ver PRE_HOSTINGER §4) — valores de staging
npm run build
npm run start          # next start (sirve .next); PM2: pm2 start "npm run start" --name crm
node -v                # confirmar major LTS correcta
```
Nginx: reverse proxy `:443 → 127.0.0.1:3000` + `proxy_set_header` host/upgrade.
Certbot: `certbot --nginx -d staging.tudominio.com`.

## 6. Variables de entorno (NOMBRES, sin valores)
Ver lista canónica en
[PRE_HOSTINGER_PRODUCTION_READINESS.md](PRE_HOSTINGER_PRODUCTION_READINESS.md) §4.
Mínimo para staging: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (o `ANON_KEY`),
`SUPABASE_SERVICE_ROLE_KEY` (server), `OPENAI_API_KEY` (server),
`OPENAI_ASSISTANT_MODEL`, `AGENT_TOOL_SECRET` (server),
`NEXT_PUBLIC_APP_URL=https://staging...`, `NODE_ENV=production`,
`NEXT_PUBLIC_ENABLE_DEMO_DATA=false`, **sin** `NEXT_PUBLIC_FORCE_OFFLINE_DEV`.
Dejar `GOOGLE_*`, `N8N_*`, `META_*` **sin configurar** (módulos futuros).

## 7. Checklist PRE-deploy
- [ ] `.env` del server con todas las variables §6 (valores de staging).
- [ ] `NEXT_PUBLIC_SUPABASE_URL` → `ylhdbawrllqygfvllhdo` (no legacy).
- [ ] `OPENAI_API_KEY` real; `AGENT_TOOL_SECRET` fuerte; ambos solo server.
- [ ] `NEXT_PUBLIC_ENABLE_DEMO_DATA=false`; `FORCE_OFFLINE_DEV` ausente.
- [ ] Decidir flags de módulos futuros (p. ej. `NEXT_PUBLIC_ENABLE_INBOX=false`
      si se aplica la recomendación de ocultar WhatsApp — ver decisión WhatsApp).
- [ ] `npm run build` verde en el server.
- [ ] Supabase Auth: Site URL / redirect URLs apuntando al dominio de staging.
- [ ] NO subir: `.env*`, `.mcp.json`, `node_modules`, `.next`, `memory/`, secretos.

## 8. Checklist POST-deploy (smoke en staging)
- [ ] App levanta sin errores en logs (PM2/Nginx).
- [ ] Login owner real → dashboard/clientes/operaciones con datos reales (no demo).
- [ ] Ficha: crear/editar tarea/operación/expediente/evento; persiste al recargar.
- [ ] Asistente: consultas reales + acciones (preparar→confirmar) sin errores RLS,
      sin UUIDs, sin datos inventados.
- [ ] Botón "Ver demo inmobiliaria" sigue funcionando (si `demoData` ON en staging).
- [ ] Rendimiento aceptable (el objetivo de staging es medir esto sin OneDrive).

## 9. Logs / observabilidad
- PM2 (`pm2 logs crm`) + Nginx access/error logs.
- Logs de app: el asistente ya emite `[assistant.v2.invoke]` y similares en
  consola del server (útil para diagnosticar OpenAI/RLS).
- Supabase: `get_logs` / advisors desde el panel.

## 10. Rollback
- Mantener el commit/tag estable desplegable (`demo-v1` o el último verde).
- Revertir = `git checkout <commit estable> && npm ci && npm run build` + recargar
  PM2 (`pm2 reload crm`). **No hay migraciones destructivas** en este corte → el
  rollback de código no requiere rollback de DB.

## 11. Seguridad
- Secretos solo en `.env` del server; nunca en Git ni en logs.
- `service_role` y `AGENT_TOOL_SECRET` solo server-side.
- SSL obligatorio (Certbot). Firewall: exponer solo 80/443 (y SSH restringido).
- Nada de infra/secretos legacy (`ktsgfukjgldeylfzrayr`, NowLabs/CostaDelSol).

## 12. Qué queda manual (Oier / no Claude)
- Contratar/crear el VPS, DNS, SSL, crear el `.env` del server, ejecutar el
  deploy. Claude NO despliega, NO toca DNS, NO instala en remoto.

## 13. Veredicto
- **LISTO PARA STAGING** en cuanto el **smoke navegador local (core + asistente)**
  pase con la `OPENAI_API_KEY` real (ya añadida).
- **NO producción cliente final** hasta: smoke en staging OK + decisiones de
  módulo aplicadas (WhatsApp/billing ocultos) + leaked-password-protection ON +
  (si aplica) proyecto Supabase dedicado del cliente.
