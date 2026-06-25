# FASE P12.7 — Cero humo: determinismo en consultas ordenadas + no afirmar escrituras inexistentes

> **Fecha:** 2026-06-25 · Dos fallos de fiabilidad de staging cerrados: (1) "primer cliente registrado"
> daba resultados distintos (empate de `created_at` en los seeds) → ahora **determinista** con desempate
> estable; (2) el Asistente afirmó "ha quedado creada" una cita **sin tool de escritura real** (Agent V2
> es read-only) → **microparche CERO HUMO** en el prompt maestro. Backend + microparche autorizado +
> evals. Sin tocar RLS/Auth/Storage/credenciales/conexiones/memory/webhook/otras tools.

---

## 1. Diagnóstico

- **Inconsistencia de "primer cliente":** Familia Soler → Inversiones Atlántico SL → Familia Soler para
  la MISMA pregunta. No era invención del LLM: era **orden no determinista** en la base de datos.
- **Cita falsa:** el usuario pidió una cita y confirmó; el Asistente dijo "ha quedado creada en el
  calendario". Pero el Agent V2 es **read-only**: no tiene ninguna tool de escritura. Eso es **humo**.

## 2. ¿Inventaba datos o era orden ambiguo?

Era **orden ambiguo**, no invención. Verificado por MCP en el workspace de ejemplo: **9 clientes pero
solo 4 fechas `created_at` distintas** → hay empates. `crmReadQuery` ordenaba solo por `created_at`, así
que entre filas con la misma fecha Postgres devolvía una u otra **arbitrariamente** en cada llamada → la
misma pregunta daba clientes distintos.

## 3. Causa exacta de la inconsistencia

`crmReadQuery` aplicaba `.order(orderBy)` con un único criterio. Con `created_at` empatado, el orden de
las filas empatadas es **indeterminado** (depende del plan de ejecución), y con `offset/limit` para
"primero/tercero" el registro devuelto podía cambiar entre llamadas idénticas.

## 4. Fix determinista aplicado

`crmReadQuery` (`src/lib/agent-tool-readers.ts`) añade un **desempate estable** por `id` en la misma
dirección que el orden principal:
`.order(orderBy, { ascending }).order('id', { ascending }).range(offset, offset+limit-1)`.
- Primero/tercero/quinto: `created_at ASC, id ASC`. · Último/más reciente: `created_at DESC, id DESC`.
- `id` es UUID: **estable y determinista** (no semánticamente perfecto si la fecha empata, pero
  reproducible). Documentado en el código. (Si la tabla tuviera un nº de registro real sería preferible.)
- **Verificado (MCP):** con desempate estable, primero = *Familia Soler*, tercero = *Javier Ortega Ruiz*,
  último = *David Iglesias* — **siempre el mismo** para los mismos datos.

## 5. Causa exacta de la cita falsa

El **Agent V2 (n8n) es READ-ONLY**: sus 15 tools son todas de lectura (`crm_read_query`, `get_*`,
`search_*`, `pipeline_summary`) — **ninguna de escritura**. El LLM, tras la confirmación del usuario,
**alucinó** el éxito ("ha quedado creada"). El prompt maestro ya decía "read-only" y "no afirmes que se
ha guardado si solo está preparada", pero la sección READ/WRITE ("si se confirma y el sistema devuelve
éxito, di que quedó actualizado") dejaba un resquicio: el LLM tomó *confirmación del usuario* como
*ejecución*.

## 6. Estado real de escrituras del Agent V2

**Solo lectura.** El agente de producción (webhook `/webhook/crm-agent-v2`) **no puede** crear, editar,
mover, completar, reservar, cancelar, enviar ni generar nada. Las escrituras del CRM las hace el usuario
desde la UI (o, en la app, los flujos de confirmación propios del front, que no pasan por el agente n8n).
Nota: existen handlers de escritura en `/api/agent/tool` (`create_calendar_event`, etc.) pero **no están
cableados como tools del workflow** del Agent V2, así que el agente no los ve ni los llama.

## 7. Fix cero humo aplicado (microparche autorizado del prompt maestro)

Añadida al systemMessage (sin reescribir ni recortar el resto) la sección **MODO REALISTA / CERO HUMO**:
- No afirmar que has creado/guardado/editado/completado/movido/reservado/cancelado/enviado/generado/
  sincronizado/programado nada **sin ejecución real confirmada por una tool de escritura**.
- Si el entorno es read-only o la acción no está conectada: explica que no puedes ejecutarla
  automáticamente y **deja los datos preparados** para que el usuario lo haga desde el CRM.
- **La confirmación del usuario NO equivale a ejecución.** Solo una respuesta exitosa de una tool de
  escritura equivale a ejecución.
- Aplica a citas, tareas, clientes, inmuebles, operaciones, trámites, documentos, comisiones,
  comunicaciones, facturas y automatizaciones.
Y la sección **CONSULTAS POR POSICIÓN Y DETERMINISMO**: misma pregunta → misma respuesta; con fechas
empatadas usa el orden estable y no inventes hora ("No consta la hora exacta"); si antes diste un
resultado contradictorio, reconócelo y corrige sin excusas.

## 8. Cambios backend/tools

- `crmReadQuery`: desempate `id` (determinismo). Ya soportaba orderBy/orderDirection/limit/offset (P12.6).
- `crm_read_query` inputSchema/descripción en el workflow JSON: sin cambios nuevos (los de P12.6 siguen).

## 9. Cambios prompt

Microparche **MODO REALISTA / CERO HUMO** + **DETERMINISMO** en `crm-agent-v2-system-prompt.txt`,
`.PASTE.txt` y las 2 copias del `systemMessage` del workflow JSON. Resto del master **intacto**, sin
ejemplos de conversación, expresiones `{{ }}` intactas, `.PASTE` sin `=`.

## 10. Cambios n8n necesarios

Esta vez **el System Message SÍ cambió** (microparche) → hay que **re-pegarlo**:
1. Workflow `[CRM Inmobiliario] Agent V2 — Read Only` → nodo **"CRM Agent"** → **System Message** (modo
   Expresión) → pega `crm-agent-v2-system-prompt.PASTE.txt` → Save.
2. (De P12.6, si no lo hiciste) tool **`crm_read_query`** → actualiza inputSchema/descripción con
   `orderBy/orderDirection/limit/offset`.
No exportes/importes el workflow; no toques credenciales/conexiones/memory/webhook/otras tools.

## 11. Evals añadidos

`assistant-coherence.evals.ts` +5: primer cliente ×3 (determinista), hora de registro ("No consta"),
cita read-only (no "creada"), tarea read-only (no "completada"), escritura genérica (no afirmar
ejecución). `mustNotMention` incluye "ha quedado creada", "ya está creada", "lo he guardado", etc.

## 12. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ · workflow JSON válido.
Scans: sin "ha quedado creada"/"ya está guardado" fuera de los `mustNotMention` de evals · `completed`
write 0 · términos prohibidos visibles 0 · UUID visible 0 · service_role frontend 0 · `{{ }}` intactas ·
`.PASTE` sin `=`.

## 13. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/lib/agent-tool-readers.ts` | `crmReadQuery`: desempate estable `.order('id', { ascending })` |
| `n8n/workflows/crm-agent-v2-system-prompt.txt` / `.PASTE.txt` | microparche MODO REALISTA + DETERMINISMO |
| `n8n/workflows/crm-agent-v2-readonly.json` | systemMessage (×2) con el microparche |
| `src/lib/agents/__evals__/assistant-coherence.evals.ts` | +5 evals determinismo/cero humo |

## 14–15. Commit / Push

Commit `fix(assistant): determinismo en consultas ordenadas + cero humo en escrituras (P12.7)` →
`origin/main`.

## 16. Qué debe hacer el usuario en n8n

Re-pegar el **System Message** (cambió) desde `crm-agent-v2-system-prompt.PASTE.txt` + (si falta de
P12.6) actualizar inputSchema/descripción de `crm_read_query`. Redeploy del front para el desempate.

## 17. Checklist de staging

- [ ] "Primer cliente registrado" ×3 en la misma conversación → SIEMPRE el mismo.
- [ ] Primero → último → primero → primero vuelve igual; quinto → tercero → quinto → quinto igual.
- [ ] "¿A qué hora exacta se registró?" → "No consta la hora exacta", sin inventar.
- [ ] "¿Por qué antes me diste otro?" → reconoce el fallo, corrige, sin excusas.
- [ ] "Crea una cita… / sí créala" → NO "ha quedado creada"; dice que no puede crearla y la deja
      preparada para Calendario.
- [ ] "Completa la tarea X / confirmo" → NO "completada"; la deja preparada o guía a Tareas.
- [ ] Crear cliente / mover operación / borrar inmueble / enviar WhatsApp → no afirma ejecución.

## 18. Pendientes honestos

- **Re-pegar System Message** (cambió por el microparche) + crm_read_query schema (P12.6). Sin eso,
  producción mantiene el comportamiento anterior.
- **Desempate por `id` (UUID):** estable y determinista, pero si dos seeds comparten `created_at` el
  "primero real" es convencional (orden del sistema). El agente lo dice si preguntan por precisión.
- **Sin write tools:** cuando se añadan tools de escritura reales al Agent V2, habrá que revisar el
  microparche para permitir confirmar éxito SOLO con respuesta exitosa de esas tools.

## Veredicto

**P12.7 COMPLETADO — ASISTENTE IA 100% REALISTA, DETERMINISTA Y SIN HUMO.** "Primer/tercer/quinto/último
cliente" es ahora **determinista** (desempate estable por `id`, verificado por MCP con datos empatados);
y el agente **no puede afirmar** que creó/guardó/envió nada sin ejecución real (microparche CERO HUMO),
dejando las acciones preparadas para el usuario porque el Agent V2 es read-only. `tsc`/`lint`/`build` en
verde. **Requiere redeploy del front + re-pegar el System Message en n8n** (cambió) y el schema de
`crm_read_query`.
