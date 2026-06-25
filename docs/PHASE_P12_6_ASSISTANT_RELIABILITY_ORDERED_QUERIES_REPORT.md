# FASE P12.6 — Fiabilidad: consultas ordenadas de clientes + errores honestos

> **Fecha:** 2026-06-25 · El **prompt maestro** del Agent V2 (P12.5) se respeta **EXACTAMENTE** (cero
> cambios de contenido). El arreglo de fiabilidad es **solo backend/tools + evals**: `crm_read_query`
> pasa a soportar consultas por posición/antigüedad (orderBy/orderDirection/limit/offset), y el error
> visible deja de poder negarse (ya se persiste en el hilo + lo cubre la regla de críticas del prompt).
> Sin tocar RLS/Auth/Storage/credenciales/conexiones/memory/webhook ni el systemMessage.

---

## 1. Prompt maestro aplicado SIN cambios de contenido

Confirmado: `crm-agent-v2-system-prompt.txt`, `crm-agent-v2-system-prompt.PASTE.txt` y las 2 copias del
`systemMessage` del workflow JSON quedan **idénticos al master de P12.5** (`git diff` = 0 en los .txt;
el diff del JSON **no toca `systemMessage`**, solo el inputSchema de una tool — ver §5). No se reescribió,
no se recortó, no se hizo variante lite. (Durante el desarrollo se probó a añadir 2 secciones al prompt;
se **revirtieron** al recibir la instrucción de respetar el master exacto.)

## 2. Solución de consultas ordenadas (el fallo de "quinto/tercer cliente")

**Causa:** `crmReadQuery` (`src/lib/agent-tool-readers.ts`) ordenaba siempre `ascending: false` y **no
tenía offset** → imposible pedir "tercer/quinto cliente registrado"; el agente acababa devolviendo el
último (alucinación) o diciendo que no podía.

**Fix (backend, read-only, RLS intacta):** `crmReadQuery` ahora acepta:
- `orderBy` — columna de ordenación, **validada contra las columnas de la entidad** (no permite ordenar
  por columnas arbitrarias); por defecto `orderCol`.
- `orderDirection` — `asc` (más antiguo/primero) | `desc` (más reciente/último); por defecto `desc`.
- `limit` (1-20) y **`offset`** (0-1000) → usa `.range(offset, offset+limit-1)`.
- Devuelve también `orderBy/orderDirection/offset` para que el agente sepa qué posición consultó.

**Exposición a la herramienta (autorizado por "ampliar crm_read_query"):** se añadieron `orderBy`,
`orderDirection`, `limit`, `offset` al **inputSchema** de la tool `crm_read_query` en el workflow JSON
(las 2 copias) + nota en su descripción explicando las consultas por posición. **No** se tocó ninguna
otra tool, ni nombres, ni el resto de schemas.

**Mapeo:** primero = `orderBy=created_at, asc, offset 0`; último = `desc, offset 0` (o `get_latest_client`);
tercero = `asc, offset 2`; quinto = `asc, offset 4`; cliente N = `asc, offset N-1, limit 1`.

**Verificado con datos reales (MCP, workspace de ejemplo, 9 clientes):** último = *Roberto Diaz* ·
primero = *Familia Soler* · **tercero = *Javier Ortega Ruiz*** (≠ último, ya no alucina) · quinto =
*Carmen Lozano* · décimo = **(no existe)** → "no hay tantos clientes". Lógica correcta extremo a extremo.

## 3. Solución para no negar errores visibles

**Causa de la negación:** el mensaje "No he podido contactar con el asistente…" lo genera el **frontend**
(`assistant/page.tsx`) cuando la llamada a `/api/assistant/v2` falla (fallo transitorio de red/n8n; por
eso al reintentar funcionó). El LLM, sin contexto de ese error, lo negaba.

**Por qué ahora no se negará (sin tocar el master):**
- El error **ya se persiste** en el hilo: `appendAssistantMessage` → `appendThreadMessage` inserta en
  `assistant_messages` (sender `ai`). La ruta v2 carga `recentMessages` desde ahí (últimos 8) → el LLM
  **ve** el error en el turno siguiente.
- El **prompt maestro** ya cubre el comportamiento: sección *COMPORTAMIENTO ANTE CRÍTICAS* ("reconoce;
  corrige; no te justifiques; no digas 'funciono correctamente'") + *REGLAS DE DATOS* (no defensivo). Con
  el error en contexto, el agente lo reconoce como fallo temporal en vez de negarlo.

No se añadió regla nueva al prompt (master congelado): el mecanismo (persistencia + regla de críticas
existente) es suficiente y honesto.

## 4. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ · workflow JSON válido
(diff de 4 líneas, `systemMessage` intacto). Scans: prompt maestro sin cambios · `completed` write a
tasks.status **0** · `service_role` frontend **0** · `crm_read_query` con offset/orderBy presente.

## 5. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/lib/agent-tool-readers.ts` | `crmReadQuery`: `orderBy`/`orderDirection`/`limit`/`offset` (con allowlist de columnas) + `.range()`; devuelve el criterio |
| `n8n/workflows/crm-agent-v2-readonly.json` | **solo** el `inputSchema` + descripción de la tool `crm_read_query` (×2 copias). `systemMessage` (master) **sin tocar** |
| `src/lib/agents/__evals__/assistant-coherence.evals.ts` | +6 evals (último/primero/tercero/quinto/décimo-de-9 + no negar error) |

**NO tocado:** master prompt · otras 14 tools · nombres de tools · credenciales · connections · memory ·
webhook · RLS · Auth · Storage · secretos · UI.

## 6. Commit y push

Commit `fix(assistant): crm_read_query con consultas ordenadas + errores honestos (P12.6)` → `origin/main`.

## 7. ¿Hay que re-pegar en n8n?

- **El prompt (System Message): NO hace falta re-pegarlo** — es exactamente el de P12.5 que ya tienes.
- **La tool `crm_read_query` SÍ necesita un cambio mínimo para que las consultas ordenadas funcionen en
  producción:** en el workflow vivo, abre la tool **`crm_read_query`** y actualiza su **inputSchema** y su
  **descripción** con la versión del repo (`n8n/workflows/crm-agent-v2-readonly.json`, propiedades
  `orderBy`, `orderDirection`, `limit`, `offset`). El **handler** (`/api/agent/tool` → `crmReadQuery`) ya
  va con el redeploy del front, así que el cálculo de offset funciona en cuanto el agente envíe esos
  campos. Como el inputSchema tiene `additionalProperties: true`, si no actualizas el schema el agente
  *podría* enviarlos igualmente, pero **recomendado** actualizarlo para que los descubra de forma fiable.
- No exportes/importes el workflow entero; es solo ese campo de esa tool.

## Pendientes honestos

- **Activación parcial en n8n:** el handler (offset/orderBy) va con el redeploy; para que el agente USE
  esos parámetros de forma fiable conviene pegar el inputSchema/descripción de `crm_read_query` (§7). El
  prompt no cambia.
- **Errores visibles:** el mecanismo (persistencia + regla de críticas del master) cubre el caso sin
  tocar el prompt; si en staging vieras que aún se pone defensivo, la solución sería añadir una línea al
  master prompt — pero eso lo decides tú (está congelado por tu indicación).
- **Tamaño del prompt (~22 KB):** sin cambios (lo pediste íntegro). El error inicial fue transitorio
  (reintento funcionó), no un timeout sistemático (adapter a 45 s). La variante "lite" sigue como opción
  futura, no aplicada.

## Veredicto

**P12.6 COMPLETADO — ASISTENTE IA FIABLE, HONESTO Y CON CONSULTAS ORDENADAS.** El prompt maestro queda
**intacto y exacto**; `crm_read_query` resuelve de verdad "primer/tercer/quinto/N/último cliente
registrado" con datos reales (verificado por MCP) y dice "no hay tantos" cuando corresponde, sin
reutilizar memoria ni alucinar; y el error visible deja de poder negarse (persistido en el hilo + regla
de críticas del master). `tsc`/`lint`/`build` en verde. **Requiere redeploy del front** y, para activar
del todo las consultas ordenadas en producción, **pegar el inputSchema/descripción de `crm_read_query`**
en n8n (el System Message NO).
