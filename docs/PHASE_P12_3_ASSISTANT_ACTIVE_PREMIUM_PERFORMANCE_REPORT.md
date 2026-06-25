# FASE P12.3 — Activar Agent V2 final en n8n + Asistente IA premium + rendimiento

> **Fecha:** 2026-06-25 · Cierre del Asistente IA: layout premium chat-first, verificación de que el
> backend/adapter ya es sólido (sin fallback silencioso, payload acotado), pasada ligera de
> rendimiento, y **activación del prompt P12.2 en el n8n vivo** (paso que requiere acción del usuario —
> ver §2/§3). Sin tocar tools/RLS/Auth/Storage/Calendar/secretos.

---

## 1. Diagnóstico

El prompt final de P12.2 está en el repo (`crm-agent-v2-readonly.json` + `crm-agent-v2-system-prompt.txt`)
pero **la instancia n8n viva no cambia hasta reimportarlo/actualizarlo**. La UI del Asistente arrastraba
ruido (selector de modo redundante + fila de KPIs + 3 badges) que restaba protagonismo al chat. El
backend/adapter ya estaba bien resuelto (a confirmar). Rendimiento global: pasada ligera.

## 2. Estado del workflow n8n antes / activación

- **MCP n8n disponible pero SIN autenticar.** El conector `claude.ai n8n`
  (`https://n8n.nowlabs.es/mcp-server/http`) está instalado pero pide OAuth; al intentar usarlo responde:
  *"Ask the user to run /mcp and select 'claude.ai n8n' to authenticate."* → **no puedo actualizar el
  workflow vivo de forma autónoma** en esta sesión.
- **Repo = fuente de verdad:** el `systemMessage` del Agent V2 ya está reescrito (P12.2) en las dos
  copias del JSON (`nodes` y `activeVersion.nodes`) y en `crm-agent-v2-system-prompt.txt`.

## 3. Cómo activar el prompt final en n8n (acción del usuario)

**Opción A (recomendada, automática):** ejecuta **`/mcp` → "claude.ai n8n"** para autenticar el conector.
Una vez autenticado, puedo: leer el workflow activo (`Agent V2 — Read Only`, webhook
`/webhook/crm-agent-v2`), comparar su `systemMessage` con `crm-agent-v2-system-prompt.txt` y
**actualizar SOLO ese campo** (preservando nodos, credenciales, connections, tools, memory, inputSchema
y el estado activo), verificando luego que el webhook responde y no hay errores.

**Opción B (manual, 2 min):** en n8n abre el workflow activo → nodo **AI Agent "ai-agent"** → campo
**System Message** → pega el contenido íntegro de `n8n/workflows/crm-agent-v2-system-prompt.txt` →
guarda. (O reimporta `crm-agent-v2-readonly.json` y reconecta credenciales.) No toques tools ni
credenciales.

> Hasta que se aplique A o B, **staging seguirá usando el prompt viejo** ("copiloto", "Dime qué quieres
> mirar del CRM"). El repo y la UI ya están listos.

## 4. Verificación del Agent V2 activo (tras aplicar)

Checklist a confirmar en n8n después de actualizar: workflow sigue **activo** · webhook
`/webhook/crm-agent-v2` responde 200 · llega la execution · sin schema errors · sin 401 · el
`systemMessage` coincide con el archivo · no responde el fallback viejo. (No ejecutable desde aquí sin
acceso al n8n vivo.)

## 5. Evals reales y resultado

**No ejecutables desde este entorno** (sin acceso al staging vivo ni al LLM de n8n). Quedan como
checklist de staging (§21) + fixture `assistant-coherence.evals.ts` (18 casos, P10+P12.1+P12.2) con las
frases robóticas en `mustNotMention`. Hay que correrlas en `/assistant` **después** de activar n8n
(§3); antes darían el comportamiento viejo.

## 6. Cambios UI/UX del Asistente (premium, chat-first)

- **Header:** badges reducidos de 3 → **2** en producción: "Conectado a datos reales" + "Acciones con
  confirmación" (se elimina la redundancia "Asistente IA activo" + "Workspace real"). El detalle de
  runtime (Agente n8n/respaldo/local) y WhatsApp quedan solo para operadores internos.
- **Selector de modo + fila de KPIs:** **ocultos en producción** (solo internos). Eran redundantes (un
  solo modo) y restaban altura al chat. → el **chat es ahora el protagonista** desde arriba.
- **Panel derecho:** "Acciones seguras" con copy premium *"Prepararé los cambios y te pediré
  confirmación antes de guardarlos."*

## 7. Panel derecho final

1. **Qué puedes pedir** — 7 acciones reales clicables (Resumen del día · Inmuebles activos ·
   Operaciones abiertas · Comisiones pendientes · Vencimientos · Próximas citas · Buscar cliente).
2. **Acciones seguras** — "Prepararé los cambios y te pediré confirmación antes de guardarlos."
3. **Contexto disponible** — Clientes · Inmuebles · Operaciones · Trámites · Citas · Comisiones +
   "Especializado en tu CRM: respondo saludos y dudas rápidas, pero mi foco son tus datos y acciones."

## 8. Quick actions finales

Las 7 de §7 (chips bajo el input + panel). Cada una envía un prompt real con vocabulario final; cero
botones muertos.

## 9. Personalidad / off-topic / tokens

Gobernado por el prompt del Agent V2 (P12.2): saludos humanos breves, sin tools en charla casual,
off-topic graduado (1ª/2ª/3ª), topes de longitud (1-4 líneas, resumen ≤7 bullets, listados ≤5),
emojis ocasionales. La ruta OpenAI (fallback) lleva el mismo bloque.

## 10. Rendimiento del Asistente (auditado — ya sólido)

- **Adapter (`n8n-assistant-client`):** payload acotado — `recentMessages` = **últimos 8 mensajes**,
  contenido recortado a **600 chars**; timeout **45 s**; fail-soft (nunca lanza). → coste/tokens
  controlados, sin enviar la conversación entera.
- **Ruta v2 (`/api/assistant/v2`):** `ASSISTANT_PROVIDER` por defecto **n8n**; V1/OpenAI es un switch de
  rollback **explícito**, **NUNCA fallback silencioso**. Si n8n falla → error humano claro ("No he podido
  contactar con el agente ahora mismo…"). Sin duplicar mensajes.
- **Frontend:** paneles laterales colapsan en móvil; no hay queries al teclear; loading inmediato
  ("Asistente IA consultando el CRM…"). No se tocó la lógica de carga (estable).

## 11. Rendimiento global del CRM (pasada ligera)

- **Imágenes de la cartera** (`opportunities/page.tsx`): añadido `loading="lazy" decoding="async"` a las
  portadas de las tarjetas (la grid renderiza muchas) → menos descargas iniciales y menos signed URLs
  forzadas fuera de pantalla.
- Dashboard / Cartera / Calendario / Clientes: revisados; usan snapshots puros / `Promise.all` /
  `useMemo` ya existentes, sin N+1 evidentes nuevos. **No se hicieron refactors** (fuera de alcance y
  riesgo); pendientes honestos documentados en §22.

## 12. Backend / actions (verificado)

Completar tarea → `done` (3 rutas normalizan: `updateTask`/`detectTaskStatus`/confirm route) · confirm
route normaliza status de tarea · deterministic actions con vocabulario final · "Trámite" (no
"Expediente") en mensajes de confirmación · operación cerrada = "Vendida/Alquilada" · escrituras con
confirmación · sin UUID visible. (`update_service_case` escribe status libre — `service_cases.status`
no tiene constraint, correcto.)

## 13. Responsive

Móvil 390: con el selector de modo y los KPIs ocultos, el chat ocupa el alto disponible; input siempre
visible; conversaciones (< lg) y panel de ayuda (< xl) colapsan; sin overflow horizontal.

## 14. Seguridad

RLS · workspace-scoped · **sin service_role frontend (0)** · sin secretos · sin UUID/lead score visible
· confirmación antes de escrituras · borrados con modal · sin datos fake en modo real · el secreto de
n8n viaja solo server-side (`x-nowcrm-agent-secret`).

## 15. Qué NO se tocó

n8n: nodos/tools/credenciales/connections/triggers (el `systemMessage` se actualizó en P12.2; aquí solo
queda **aplicarlo al vivo**) · `/api/agent/tool` contract · enums · RLS · Auth · Storage · Google
Calendar · secretos/env · service_role · facturación · módulos Cartera/Calendario/Dashboard/Clientes
(salvo el `loading="lazy"` de imágenes).

## 16. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅. **Scans:** Copiloto/
WhatsApp-CTA/Aplicar visibles **0** · `completed` write a tasks.status **0** (line 712 = `service_cases`,
sin constraint) · service_role frontend **0** · UUID visible **0** · botón muerto **0** · robotic
greeting en el prompt n8n **0**.

## 17. Archivos

| Archivo | Cambio |
|---|---|
| `src/app/(saas)/assistant/page.tsx` | header 2 badges; selector de modo + KPIs solo internos (chat-first); copy "Acciones seguras" |
| `src/app/(saas)/opportunities/page.tsx` | `loading="lazy" decoding="async"` en portadas de cartera |

(El prompt del Agent V2 y los evals se entregaron en P12.2/P12.1; aquí no se vuelven a tocar.)

## 18–20. Commit / Push / Redeploy

Commit `polish(assistant): layout premium chat-first + lazy cartera + verificación backend (P12.3)` →
`origin/main`. **Redeploy del front** (UI). **Activar el prompt en n8n** (§3) — paso del usuario, sin él
staging mantiene el comportamiento viejo.

## 21. Checklist de staging (tras activar n8n)

- [ ] `/mcp` → "claude.ai n8n" autenticado **o** prompt pegado en el nodo AI Agent.
- [ ] "Hola buenas" → "¡Buenas! 👋 ¿Qué tal?" (NO "Dime qué quieres mirar del CRM").
- [ ] "Qué tal todo?" → cortesía breve, sin tools.
- [ ] "Estoy leyendo Padre rico padre pobre" → 1 línea + reconduce; insistir 3× → límite amable.
- [ ] "Resumen del día" → ≤7 bullets (citas/vencimientos/operaciones/comisiones).
- [ ] "Qué inmuebles activos tengo?" → cartera activa, sin histórico.
- [ ] "Qué comisiones pendientes?" → pendiente/cobrada/prevista, sin "facturación".
- [ ] "Tiene trámites abiertos?" → "trámites", nunca "expedientes".
- [ ] "Completa la tarea de enviar ficha a Marcos" → confirmación → `done`.
- [ ] UI: chat protagonista, sin selector de modo ni KPIs; 2 badges; panel derecho limpio.
- [ ] Móvil 390: chat usable, sin overflow.

## 22. Pendientes honestos

- **Activación n8n no autónoma:** requiere `/mcp` (OAuth del usuario) o el pegado manual. Documentado.
- **Evals reales:** no ejecutables sin staging/n8n vivo; quedan como checklist + fixture.
- **Rendimiento global:** solo pasada ligera (lazy images). Auditoría profunda de N+1 / memorización por
  módulo = micro-fase futura si se quiere exprimir más (no se tocó nada cerrado).
- **Fallback local** (offline) sigue con flujo genérico; producción = n8n.

## 23. Veredicto

**P12.3 — ASISTENTE IA PREMIUM Y RÁPIDO (repo listo; activación n8n pendiente del usuario).** La pantalla
del Asistente queda premium y chat-first (sin ruido de modo/KPIs, 2 badges, panel derecho limpio y
útil), el backend ya es sólido (payload acotado, sin fallback silencioso, errores humanos) y se añadió
lazy-loading a la cartera. El comportamiento humano/breve/foco-CRM ya está escrito en el prompt del
Agent V2; **falta un paso del usuario para activarlo en el n8n vivo** (`/mcp` → "claude.ai n8n", y lo
aplico yo; o pegar el System Message manualmente). `tsc`/`lint`/`build` en verde y scans limpios.
**Requiere redeploy del front + activar el prompt en n8n.**
