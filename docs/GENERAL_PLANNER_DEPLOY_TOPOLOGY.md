# General Planner — Deploy topology + unblock del staging aislado

> Rama `general-semantic-planner` @ `d9fc52a` (pusheada). `main`/producción = `ad3c06e` (V1). 2026-07-19.
> Objetivo: desplegar la RAMA a un staging AISLADO sin tocar producción ni main.

## Topología real (descubierta, no asumida)
| Pieza | Valor real | Cómo se sabe |
|---|---|---|
| Repo | `git@github.com:iazticontact/crm-inmobiliario-demo.git` (único origin) | `git remote -v` |
| CI/CD en repo | **ninguno** (no hay `vercel.json`, `.github/workflows`, Dockerfile, easypanel config) | glob |
| Scripts deploy | ninguno (`dev/build/start/lint/test:e2e`) | `package.json` |
| Hosting | **EasyPanel** cuenta `hvdnby` (`*.hvdnby.easypanel.host`) | hosts en `.env.local` + scripts |
| App staging CRM | `crm-inmobiliario-crm-staging.hvdnby.easypanel.host` | `/api/agent/diag` responde |
| Runtime staging actual | **`toolVersion 2026-07-17.p71-rc` = V1/P71** (NO el planner) | diag en vivo |
| n8n | `primer-proyecto-prueba-n8n.hvdnby.easypanel.host` | `.env.local` |
| Supabase | proyecto `ylhdbawrllqygfvllhdo` (workspace QA `d000…001` aislado por RLS) | diag + `.env.local` |

## Por qué la rama NO se despliega sola (y por qué NO se fuerza)
- El deploy lo hace EasyPanel tirando de GitHub. **Ningún servicio EasyPanel sigue la rama
  `general-semantic-planner`**, así que `git push` de la rama (ya hecho) NO despliega nada.
- El staging actual (`crm-…-staging`) sirve V1/P71. Cambiar la RAMA que sigue ese servicio a la del planner
  alteraría el entorno que QA usa hoy → no se hace sin decisión explícita.
- Mergear a `main` para conseguir un deploy tocaría el path de producción → **prohibido** por el mandato.
- **No hay credenciales/CLI/API de EasyPanel** en el entorno (ni MCP EasyPanel; los MCP de Vercel/n8n piden
  login no disponible). Por tanto crear el servicio aislado es una acción de UI que debe hacer el usuario.

## Seguridad de infra (garantías)
- Producción `ad3c06e` intacta; staging actual intacto (sigue en p71-rc).
- La rama solo vive en GitHub + local; no está cableada a ningún deploy.
- Con el flag por defecto **OFF**, aunque se desplegara, el comportamiento sería idéntico a P71.

## ACCIÓN MÍNIMA que debe hacer el usuario (crear staging aislado, sin tocar producción)
En el panel de EasyPanel (cuenta `hvdnby`):
1. Abre el servicio de la app CRM que ya existe (el que sirve `crm-inmobiliario-crm-staging`).
2. **Clónalo / duplícalo** como un servicio NUEVO. Nombre sugerido: `crm-general-planner-staging`.
   (No modifiques el servicio existente; crea uno separado.)
3. En el nuevo servicio, fuente = **el mismo repo** `iazticontact/crm-inmobiliario-demo`.
4. **Branch = `general-semantic-planner`** (NO `main`).
5. Variables de entorno: copia las MISMAS que el staging actual (Supabase, n8n, secrets) y **añade**:
   `GENERAL_SEMANTIC_PLANNER=SHADOW`.
   - NO cambies `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `N8N_*` respecto al staging actual.
   - NO toques el servicio/URL de producción ni el staging actual.
6. Deploy del nuevo servicio.
7. Devuélveme la **URL** del nuevo servicio (p. ej. `crm-general-planner-staging.hvdnby.easypanel.host`).

Con esa URL yo puedo: verificar `/api/agent/diag` (SHA/runtime), comprobar en logs `featureFlagState=SHADOW` y
`assistantArchitecture` por turno, correr shadow real, y luego pedirte poner `=ON` en ESE servicio para tu
validación humana — todo sin tocar producción y con rollback instantáneo (`=OFF` o borrar el servicio).

## Alternativa si prefieres no crear servicio nuevo
Si el staging actual ya no lo usa nadie para QA productiva, podrías **cambiar solo su branch** a
`general-semantic-planner` y añadir `GENERAL_SEMANTIC_PLANNER=SHADOW`. Es menos aislado; el servicio nuevo es
la opción segura recomendada. En ningún caso se toca producción ni `main`.

## Gates bloqueados hasta que exista el staging aislado
SHADOW real con tráfico, ON en staging, black-box 100+, freshness en vivo end-to-end. Las evaluaciones
locales (query layer, generalización, security, mecanismos) ya están hechas y son verdes; lo que falta es el
entorno para la validación con tráfico real + tu prueba humana.
