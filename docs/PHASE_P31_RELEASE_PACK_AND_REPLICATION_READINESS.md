# FASE P31 — Release Pack & Replication Readiness

> **Fecha:** 2026-07-02 · Paquete operativo para **desplegar, cambiar de dominio o replicar** el CRM sin
> romper el entorno. **Sin features ni cambios de lógica** (solo documentación). Doc autoritativo y actual;
> complementa `docs/DEPLOYMENT.md` y `docs/ENVIRONMENT_VARIABLES.md` (más genéricos/antiguos).
> Regla de oro ante fallos: **primero envs/entorno, nunca el código.**

---

## 0. Estado base (verificado)
- **Rama:** `main` @ **`ffbd8d7`** — árbol limpio, 0 commits sin subir. **Commit estable de referencia.**
- **Código:** `tsc`/`lint`/`build` verde; Asistente omnicontextual (P30) verificado E2E contra Supabase real;
  móvil sin auto-zoom (P28C); motor inmobiliario sin falsos negativos (P29/P30).
- **Supabase:** proyecto `ylhdbawrllqygfvllhdo` (`crm-inmobiliario-demo`, eu-west-1, ACTIVE_HEALTHY).
- **n8n (verificado 2026-07-02):** workflow `[CRM Inmobiliario] Agent V2 — Read Only` (`6mps8YoWu3syldUc`),
  **activo**, 24 nodos, webhook `crm-agent-v2`, usa `$env.CRM_BASE_URL` **15×**, **sin hosts hardcodeados**.
- **Workspace con datos (QA):** `d0000000-0000-4000-8000-000000000001`.

## 1. Matriz de variables de entorno (sin valores reales)

> `NEXT_PUBLIC_*` viajan al navegador (nunca secretos). `SUPABASE_SERVICE_ROLE_KEY`, `AGENT_TOOL_SECRET`,
> `N8N_ASSISTANT_V2_SECRET`, `OPENAI_API_KEY` y demás claves son **solo servidor**.

### CRM (frontend/backend Next.js) — en EasyPanel del servicio del CRM
| Variable | Ámbito | ¿Req.? | Notas |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | público | **Sí** | `https://ylhdbawrllqygfvllhdo.supabase.co`. Debe coincidir con el de la UI. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | público | **Sí** | (o `NEXT_PUBLIC_SUPABASE_ANON_KEY` legacy). |
| `SUPABASE_SERVICE_ROLE_KEY` | **servidor** | **Sí** | Solo backend (RLS bypass con scoping manual). NUNCA `NEXT_PUBLIC`. |
| `NEXT_PUBLIC_APP_URL` | público | **Sí** | **Dominio público del CRM** (usado por auth/reset/callback y el gate). |
| `AGENT_TOOL_SECRET` | **servidor** | **Sí** | Protege `/api/agent/tool` (n8n→CRM) y el sondeo de `/api/agent/diag`. |
| `N8N_ASSISTANT_V2_SECRET` | **servidor** | **Sí (deploy)** | Header `x-nowcrm-agent-secret` (CRM→n8n Agent V2). **Ausente en local** → por eso el asistente no responde en local. Debe existir en el deploy. |
| `N8N_ASSISTANT_V2_WEBHOOK_URL` | servidor | Opcional | Si falta, usa `N8N_BASE_URL` + `/webhook/crm-agent-v2`. |
| `N8N_BASE_URL` | servidor | **Sí** | Base del n8n (EasyPanel). |
| `OPENAI_API_KEY` | servidor | Opcional | Sin ella, funciones IA locales off (el Agent V2 usa su propia credencial en n8n). |
| `SOURCE_COMMIT` (o `NEXT_PUBLIC_COMMIT_SHA`) | servidor | **Recom.** | Para que `/api/agent/diag` exponga el commit y el gate lo verifique. |
| `NEXT_PUBLIC_NOWLABS_INTERNAL` | público | No | `false` en producción (oculta WhatsApp/Automatizaciones/Facturación y pestañas internas). |
| `LOCATION_PROVIDER` (+ key del proveedor) | servidor | Opcional | `local` por defecto (empresa+catálogo). `google/mapbox/geoapify` para sugerencias amplias. |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | servidor | Opcional | Solo si se usa Google Calendar OAuth. |
| Flags `NEXT_PUBLIC_ENABLE_*` | público | No | Todos ON por defecto; `false` oculta el módulo. |

### n8n (servicio n8n en EasyPanel) — **aquí vive `CRM_BASE_URL`**
| Variable | ¿Req.? | Notas |
|---|---|---|
| **`CRM_BASE_URL`** | **Sí** | Dominio del backend del CRM (**= `NEXT_PUBLIC_APP_URL`**), con `https://` y **sin** `/` final. Las 15 tools añaden `/api/agent/tool`. **No existe en el CRM; es env de n8n.** |
| `N8N_ASSISTANT_V2_SECRET` | **Sí** | Debe **coincidir** con el del CRM (nodo "Check secret"). |
| Credencial OpenAI del workflow | **Sí** | Configurada dentro de n8n (no tocar). |

> **Regla de coherencia:** `NEXT_PUBLIC_APP_URL` (CRM) == `CRM_BASE_URL` (n8n) == dominio público desplegado.
> `AGENT_TOOL_SECRET` (CRM) == secreto que envían las tools de n8n (`x-nowcrm-secret`).
> `N8N_ASSISTANT_V2_SECRET` (CRM) == `N8N_ASSISTANT_V2_SECRET` (n8n).

## 2. Checklist de cambio de dominio
1. **EasyPanel (CRM):** asigna el nuevo dominio al servicio del CRM.
2. **CRM envs:** actualiza `NEXT_PUBLIC_APP_URL` al nuevo dominio. (Deja Supabase/secretos igual.)
3. **n8n:** actualiza **`CRM_BASE_URL`** al nuevo dominio del CRM (mismo valor que `NEXT_PUBLIC_APP_URL`).
4. **Supabase Auth → URL Configuration:**
   - **Site URL:** `https://<NUEVO_DOMINIO>`
   - **Redirect URLs:** añade `https://<NUEVO_DOMINIO>/auth/callback` y `https://<NUEVO_DOMINIO>/reset-password`
     (mantén las antiguas hasta confirmar, luego límpialas).
5. **Reset password / callback:** verifica que los enlaces de email apuntan al nuevo dominio (dependen de Site URL).
6. **Cookies/sesión:** al cambiar de dominio, las sesiones antiguas no migran; se vuelve a iniciar sesión.
7. **Redeploy** del CRM (frontend/backend). **Reinicia n8n** si cambiaste `CRM_BASE_URL` (para releer el env).
8. **Gate** (§3) contra el nuevo dominio.
9. **Smoke test** (§4) + **Asistente** (§5).

## 3. Gate obligatorio (antes de dar por bueno el deploy)
```bash
node scripts/check-agent-deploy.mjs https://<DOMINIO> --workspace d0000000-0000-4000-8000-000000000001
```
Debe cuadrar:
- `supabaseRef` == `ylhdbawrllqygfvllhdo` (misma Supabase que la UI).
- `toolVersion` == `2026-07-01.p24`.
- `commit` == el de `main` desplegado (requiere `SOURCE_COMMIT` en EasyPanel).
- `config`: `agentToolSecret/serviceRole/n8nWebhook/**n8nSecret**` todos `true`.
- **Conteos reales** del workspace con datos (clients 9, events 12, properties 8, opportunities 8,
  service_cases 5, tasks 11) — coincidiendo con la UI.

**Si falla → primero ENTORNO, no código:** (a) `supabaseRef` distinto → envs Supabase del backend; (b) conteos
0 → `CRM_BASE_URL` de n8n apunta a otra base/commit viejo → corregir + reiniciar n8n; (c) `n8nSecret=false` →
falta `N8N_ASSISTANT_V2_SECRET`; (d) commit viejo → redeploy. Repetir el gate tras cada corrección.

## 4. Smoke test post-deploy (UI)
- [ ] Login (sin auto-zoom en móvil).
- [ ] Dashboard carga (métricas reales, sin datos demo).
- [ ] Clientes carga y busca.
- [ ] Cartera/Inmuebles carga (cards con m²/hab/baños).
- [ ] Calendario carga (Agenda por defecto en móvil).
- [ ] Configuración guarda; **logo** (sidebar) y **avatar** (topbar) visibles y persisten al recargar.
- [ ] Búsqueda inmobiliaria funciona.
- [ ] Móvil: sin scroll horizontal, sin zoom al enfocar inputs.
- [ ] Sin errores en consola.

## 5. Asistente IA post-deploy (con la cuenta CON datos)
- [ ] "¿qué citas tengo?" (rango próximo) · "¿y hoy?" · "¿y esta semana?"
- [ ] "¿qué viviendas tengo disponibles?" → lista (no "no hay").
- [ ] "busco un piso hasta 300.000€ de 3 habitaciones" → exactos/parciales con motivos.
- [ ] "¿hay alguna casa o chalet?" → tipos por sinónimo.
- [ ] "¿qué comisión tengo de esa operación y con qué inmueble está?" → comisión + inmueble por nombre.
- [ ] "ficha completa del cliente" (país/idioma si constan) · "ficha del inmueble" (m²/hab/baños).
- [ ] Tareas/trámites (activos vs finalizados).
- **No debe:** mostrar IDs · decir "no hay" con parciales · confundir precio/comisión con factura · mezclar
  datos de otra cuenta · responder de memoria (siempre tool).

## 6. Rollback
- **Commit estable:** `ffbd8d7` (o el `git rev-parse HEAD` de este release). Volver: en EasyPanel, redeploy
  del commit anterior estable (o `git revert`/checkout del SHA y push → redeploy). **No `reset --hard` en main.**
- **Envs:** guarda una copia de los envs actuales antes de cambiarlos; para revertir, restaura los valores
  previos (dominio, `CRM_BASE_URL`, secretos) y redeploy + reinicia n8n.
- **Supabase:** las migraciones aplicadas (P25 `workspace_settings`, P29 `clients.country/preferred_language`)
  son **additivas** → un rollback de código no requiere tocar la BD (las columnas extra no molestan).
- **n8n:** no se ha modificado el workflow en P24–P31; si algún día se toca, exportar el JSON antes. Revertir =
  restaurar `CRM_BASE_URL`/secreto previos y reiniciar.
- **Comprobar tras rollback:** repetir el **gate** (§3) y el **smoke** (§4).

## 7. Replicación (nuevo cliente/tenant)
Dos modelos:
- **Mismo Supabase, nuevo workspace (multi-tenant):** crear el `workspace` + `workspace_members` para el nuevo
  cliente; el aislamiento lo garantiza la **RLS por `current_workspace_ids()`** (verificada: 12 tablas base con
  RLS). No requiere nuevo deploy — el mismo CRM sirve varios workspaces.
- **Instancia separada (nuevo Supabase + nuevo deploy):** aplicar el esquema (migraciones additivas de
  `docs/supabase/`), crear buckets (`entity-files` privado, `company-logos`/`profile-avatars` públicos),
  configurar envs (§1) con la nueva Supabase, importar/clonar el workflow de n8n apuntando su `CRM_BASE_URL`
  al nuevo dominio, y ejecutar el gate. Nunca compartir `service_role`/secretos entre tenants.

## 8. Validaciones (P31)
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ ·
`node --check scripts/check-agent-deploy.mjs` ✅ · git limpio · sin secretos · sin temp files · sin cambios n8n.

## 9. Pendientes honestos
- El gate (§3), smoke (§4) y Asistente (§5) se ejecutan **contra el dominio desplegado** (no reproducible desde
  local sin dominio). Este entorno es local (`NEXT_PUBLIC_APP_URL=http://localhost:3000`).
- **QA humano de dispositivo** (iPhone Safari / Chrome Android) heredado de P28B/C.
- El `docs/DEPLOYMENT.md` antiguo menciona Vercel/Hostinger y vars legacy (AI_PROVIDER/AI_API_KEY); el destino
  real es **EasyPanel** y la matriz autoritativa es la de §1.

## 10. Veredicto
**P31 COMPLETADO — CRM LISTO PARA DESPLIEGUE, CAMBIO DE DOMINIO Y REPLICACIÓN CONTROLADA.** `main` @ `ffbd8d7`
limpio y estable; matriz de envs completa (con la distinción clave `CRM_BASE_URL`=env de n8n y
`N8N_ASSISTANT_V2_SECRET` requerido en deploy); checklists de dominio/Supabase Auth/n8n; gate y smoke test
definidos; rollback y replicación documentados; n8n reverificado alineado (activo, 24 nodos, `$env.CRM_BASE_URL`
×15, sin hosts). Sin tocar código, n8n ni features.
