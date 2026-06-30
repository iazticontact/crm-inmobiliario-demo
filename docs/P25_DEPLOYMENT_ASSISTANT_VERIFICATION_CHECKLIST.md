# P25 — Checklist operativo de despliegue y verificación del Asistente

> Cómo comprobar, paso a paso, que el CRM desplegado (EasyPanel) y el Asistente leen los datos reales.
> Pensado para ejecutarse tras cada redeploy. No requiere tocar código.

## 0. Datos de referencia (verificados en Supabase, 2026-07-01)

- **Proyecto Supabase:** `ylhdbawrllqygfvllhdo` (`crm-inmobiliario-demo`, ACTIVE_HEALTHY, eu-west-1).
  Es el `supabaseRef` que debe reportar `/api/agent/diag`.
- **Cuentas y datos reales por workspace:**

  | Cuenta (email) | workspace_id | clientes | citas | inmuebles | operaciones | trámites | tareas | actividad |
  |---|---|---:|---:|---:|---:|---:|---:|---:|
  | **odunabeitia14@gmail.com** | `d0000000-0000-4000-8000-000000000001` | 9 | 12 | 8 | 8 | 5 | 11 | 70 |
  | gabriel.peralta@opendeusto.es | `ffc49d1b-12ba-465f-8f5a-d43f5e473fe7` | 0 | 0 | 1 | 0 | 0 | 0 | 4 |
  | asier.comba@opendeusto.es | `b43f73fc-f634-4b2c-bacf-10380e6b5c5d` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

  → **Para probar fiabilidad usa odunabeitia14** (cuenta con datos). **asier.comba = cuenta vacía**
  (debe responder "esta cuenta aún no tiene datos", no un error). gabriel = cuenta casi vacía (1 inmueble).

## 1. Verificar el commit y la Supabase del backend desplegado

Con el dominio del **CRM** (no el de n8n):

```bash
node scripts/check-agent-deploy.mjs https://<TU_DOMINIO_CRM>
```

Comprueba que:
- `supabaseRef` == `ylhdbawrllqygfvllhdo` (mismo proyecto que la UI). **Si difiere → el backend apunta a otra
  base**: corrige `NEXT_PUBLIC_SUPABASE_URL` / envs del backend en EasyPanel.
- `commit` == el último de `main` (`git rev-parse --short=12 HEAD`). Si es `unknown`, configura
  `SOURCE_COMMIT` o `NEXT_PUBLIC_COMMIT_SHA` en EasyPanel para poder verificarlo. Si difiere → **redeploy**.
- `toolVersion` == el esperado (`2026-07-01.p24`). Si difiere → el build desplegado es viejo.
- `config`: `agentToolSecret/serviceRole/n8nWebhook/n8nSecret` todos `true`.

> El endpoint manual equivalente: `GET https://<TU_DOMINIO_CRM>/api/agent/diag`.

## 2. Verificar lo que ve el backend por cuenta (conteos reales)

```bash
# AGENT_TOOL_SECRET se lee de .env.local automáticamente (no se imprime)
node scripts/check-agent-deploy.mjs https://<TU_DOMINIO_CRM> --workspace d0000000-0000-4000-8000-000000000001
```

- Debe devolver `clients=9, events=12, properties=8, opportunities=8, service_cases=5, tasks=11, ...`
  (coincidiendo con la tabla del §0 y con la UI de esa cuenta).
- **Si devuelve 0 en todo** → no es bug del Asistente: el backend desplegado apunta a otra base / commit
  viejo, o estás sondeando una cuenta vacía. Revisa `CRM_BASE_URL` en n8n y los envs del backend.

> Manual: `GET /api/agent/diag?workspace_id=<uuid>` con header `x-nowcrm-secret: <AGENT_TOOL_SECRET>`.

## 3. Verificar `CRM_BASE_URL` en n8n (EasyPanel)

n8n no se toca salvo que esto falle. Estado verificado (2026-07-01): **1 solo** workflow CRM activo
(`[CRM Inmobiliario] Agent V2 — Read Only`, 24 nodos, webhook `crm-agent-v2`), usa `$env.CRM_BASE_URL`
en sus 15 tools y **no tiene ningún host hardcodeado**. Por tanto solo hay que comprobar el **valor** de la
variable de entorno:

1. EasyPanel → servicio de **n8n** → Environment → `CRM_BASE_URL`.
2. Debe ser exactamente el dominio del backend del CRM desplegado (el mismo del §1), con `https://` y **sin**
   `/` final. (Las tools añaden `/api/agent/tool`.)
3. Si apunta a un dominio viejo / a otro proyecto → corrígelo y **reinicia** el servicio n8n.
4. Tras cualquier cambio, confirma que el workflow sigue **activo** (no se desactiva al editar envs).

## 4. Confirmar que el workflow está activo y es el correcto

- n8n → Workflows → `[CRM Inmobiliario] Agent V2 — Read Only` debe estar **Active**.
- No debe existir otro workflow con webhook `crm-agent-v2` (no hay duplicados a 2026-07-01).
- El adaptador del backend llama a `N8N_BASE_URL` + `/webhook/crm-agent-v2`; deben coincidir.

## 5. QA E2E con la cuenta con datos (odunabeitia14)

Inicia sesión con **odunabeitia14** y pregunta al Asistente (debe usar tool y dar datos reales, sin IDs):

- **Calendario:** "¿qué citas tengo?" (rango próximo), "¿y hoy?", "¿y esta semana?", "detalles de mi próxima cita".
- **Clientes:** "lista de clientes", "busca a <nombre>", "ficha completa de <cliente>", "último cliente registrado".
- **Inmuebles:** "inmuebles activos", "inmuebles en <localidad>", "detalle del inmueble de <zona>".
- **Operaciones:** "operaciones en gestión", "operaciones cerradas", "detalle con cliente e inmueble".
- **Trámites:** "trámites activos", "trámites finalizados", "trámites que vencen".
- **Tareas:** "tareas pendientes", "tareas completadas", "vencimientos".
- **Comisiones:** "comisiones pendientes" (derivadas de operaciones: `commission_status`/`commission_paid_*`).
- **Configuración:** "¿cuál es el logo de mi empresa?", "¿puedo cambiar mi foto de perfil?".
- **Resumen:** "dame una visión general de cómo va todo" (cruza varias entidades, conteos reales).

Criterios: siempre tool para datos vivos · sin IDs/UUID · "No consta" en campos ausentes · error ≠ vacío ·
rangos correctos (Europe/Madrid) · cuenta correcta · respuesta ordenada y útil.

## 6. QA de freshness (crear/editar en UI → preguntar)

Con odunabeitia14: crea/edita una **cita**, un **inmueble**, un **cliente**, un **trámite** y una **tarea** en la
UI; pregunta al Asistente inmediatamente → debe reflejarlo (lectura `force-dynamic`). Marca un elemento como
finalizado/completado y pregunta activos vs finalizados → debe responder actualizado.

> Si un registro guardado y visible en la UI NO aparece en el Asistente con la **misma cuenta y dominio
> correcto** → vuelve al §1–§3 (mismatch de entorno), no es lógica del Asistente.

## 7. QA de cuenta vacía / error

- **Cuenta vacía (asier.comba):** pregunta clientes/citas → debe decir con naturalidad que **esta cuenta aún
  no tiene datos** (no "el CRM está roto", no tecnicismos como "workspace/tabla").
- **Error técnico:** si una tool falla → "no he podido consultar ahora, reintenta", **no** "no hay datos".

## 8. Diferenciar "cuenta vacía" de "bug" de "deploy viejo" (resumen)

| Síntoma | diag §1 | sondeo §2 (cuenta con datos) | Causa | Acción |
|---|---|---|---|---|
| Asistente no ve datos | supabaseRef OK, commit OK | conteos reales (9,12,…) | Probaste cuenta vacía | Usar odunabeitia14 |
| Asistente no ve datos | supabaseRef distinto | — | Backend a otra Supabase | Corregir envs backend |
| Asistente no ve datos | supabaseRef OK | conteos 0 | `CRM_BASE_URL` mal / base distinta | Corregir CRM_BASE_URL en n8n |
| UI nueva, asistente raro | commit viejo / toolVersion viejo | — | Build desplegado viejo | Redeploy |

## 9. Settings/logo — RESUELTO (migración P25)

`workspace-settings.ts` y el **logo de empresa** (P22) consultaban la tabla `workspace_settings`, que **no
existía** en la BD → no persistían al recargar. **Resuelto** con la migración `p25_create_workspace_settings`
(additiva, no destructiva; ver `docs/supabase/p25_workspace_settings.sql`), aplicada y verificada (11
columnas, RLS ON, 4 policies, trigger). QA: con odunabeitia14, sube un logo en Configuración → Empresa,
recarga → debe seguir ahí; cambia nombre/ai_tone → debe persistir.
