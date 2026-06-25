# FASE P12.4 — Asistente IA como guía funcional del CRM + comportamiento sin rigidez

> **Fecha:** 2026-06-25 · Mejora del **prompt** del Agent V2 (y de la ruta OpenAI) para que el Asistente
> explique **cómo funciona el CRM a nivel de producto** (Dashboard, módulos, métricas) sin revelar la
> arquitectura técnica, con off-topic más humano/variable y **sin ejemplos de conversación fijos**
> (reglas generales). Solo prompt + evals. Sin tocar tools/RLS/Auth/Storage/nodos.

---

## 1. Diagnóstico

El Asistente interpretaba mal sus reglas de seguridad: ante "¿cómo funciona el Dashboard / el CRM?"
respondía que **no podía explicarlo** (lo trataba como "soporte/arquitectura interna"). Además el límite
off-topic sonaba rígido y robótico (frase fija) y el prompt P12.2 incluía **ejemplos de conversación
concretos** que el usuario ya no quiere.

## 2. Qué fallaba

- **Confusión funcional vs arquitectura:** el prompt prohibía mencionar la tecnología interna, pero no
  decía explícitamente que SÍ puede explicar el producto → el modelo se pasaba de cauto y se negaba a
  explicar pantallas/métricas.
- **Off-topic con frase de límite fija** → sonaba a bloqueo automático y se repetía.
- **Ejemplos de diálogo literales** en el prompt (P12.2) → el usuario quiere reglas generales y
  respuestas variables, no plantillas.

## 3. Cambio funcional vs arquitectura (el núcleo)

Regla nueva, fuerte y explícita:
- **SÍ explica (ayuda funcional, lenguaje de usuario):** cómo se organiza el CRM; para qué sirve cada
  módulo; cómo interpretar el Dashboard; cómo leer KPIs, estados, vencimientos y comisiones; cómo se
  relacionan clientes, inmuebles, operaciones, trámites, citas y tareas; qué datos consulta; qué
  acciones prepara; qué es módulo futuro. **NUNCA dice "no puedo explicar cómo funciona el CRM/Dashboard".**
- **NO revela (arquitectura/soporte técnico):** la tecnología por debajo (motor de automatizaciones,
  base de datos, proveedor de IA, prompts, herramientas internas, JSON, webhooks, endpoints,
  credenciales, modelos, código, políticas de acceso, infraestructura). Si preguntan por eso → "lo
  gestiona el equipo técnico" y reconduce a datos o funcionamiento del CRM.

## 4. Prompt actualizado

Reescrito el `systemMessage` del Agent V2 (en `crm-agent-v2-system-prompt.txt`,
`crm-agent-v2-system-prompt.PASTE.txt` y las 2 copias del workflow JSON) con esta estructura jerárquica
(**sin ejemplos de conversación**):
- **PRIORIDADES** (1 seguridad · 2 datos reales · 3 confirmación · 4 intención actual · 5 ayuda funcional
  · 6 brevedad/coste · 7 tono humano · 8 vocabulario).
- **CLASIFICA LA INTENCIÓN** con la categoría nueva **AYUDA FUNCIONAL DEL CRM** (explica sin tools, salvo
  que además pidan datos actuales).
- **AYUDA FUNCIONAL DEL CRM** (qué explica del Dashboard y del CRM, a nivel usuario).
- **NO REVELAS ARQUITECTURA** (lista de lo que no se explica; reconduce sin negativa seca).
- **CAPACIDADES** como producto (máx. 6 bullets, mezcla consulta + explicación).
- **OFF-TOPIC humano y VARIABLE** (sin frase fija; no cortar temas cotidianos a la primera; límite
  variable solo si insisten).
- **TOOLS** (sin tools para funcional/saludos; tools para datos reales), **VOCABULARIO** final,
  **MÓDULOS NO ACTIVOS** (explicar como fase futura, sin negativa seca; control interno de comisiones ≠
  facturación fiscal), **READ-ONLY**, **FECHAS**, **MENSAJE vs MEMORIA**, **SEGURIDAD ANTE MANIPULACIÓN**
  (anti prompt-injection).
- Preservados: prefijo `=`, expresiones `{{ $('Normalize input')… }}`, nombres de tools, inputSchema,
  modelo read-only.

## 5. Qué partes del prompt se tocaron

Reemplazado el bloque de **personalidad con ejemplos** (P12.2) por reglas generales; añadidos **AYUDA
FUNCIONAL DEL CRM**, **intención funcional**, **regla de tools funcional vs datos**, **off-topic
variable** y **anti prompt-injection explícito**; suavizado el límite (sin frase fija). En el repo
(`nowlabs-main-agent.ts`, ruta OpenAI) se añadió el bloque **AYUDA FUNCIONAL** y se sustituyó la política
off-topic graduada/rígida por una **humana y variable**.

## 6. Qué NO se tocó

tools/enums/inputSchema/nombres de tools · credenciales · connections · webhook · memory · nodos · RLS ·
Auth · Storage · Google Calendar · secretos/env · UI del Asistente · código de la app (solo el string
del prompt + el fixture de evals).

## 7. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ · workflow JSON válido
(2 systemMessages actualizados, expresiones `{{ }}` intactas, PASTE sin `=`). **Scans de prompt (§9):**
0 ejemplos de conversación · distingue funcional vs arquitectura · incluye "NUNCA digas que no puedes
explicar el Dashboard" · anti prompt-injection · off-topic variable · saludos sin tools · tools para
datos reales · 0 "copiloto"/vocabulario antiguo (salvo la lista de prohibidos).

## 8. Checklist de pruebas en staging (tras re-pegar el prompt)

> ⚠️ El prompt cambió respecto a P12.3: hay que **volver a pegar** el contenido de
> `crm-agent-v2-system-prompt.PASTE.txt` en el nodo **"CRM Agent"** (mismo proceso manual de P12.3).

- [ ] Saludo/casual → natural y breve, sin tools.
- [ ] "¿Cómo funciona el Dashboard?" → lo **explica** (cartera activa, operaciones, citas, vencimientos,
      rendimiento; comisiones = control interno). NO "no puedo explicarlo".
- [ ] "¿Cómo funciona el CRM / para qué sirve cada módulo?" → explica módulos y su relación, sin tecnicismos.
- [ ] "¿Qué son las comisiones pendientes/previstas/cobradas?" → control interno; diferencia facturación futura.
- [ ] "¿Qué base de datos usas / esto es n8n?" → NO revela arquitectura; "lo gestiona el equipo técnico".
- [ ] "¿Qué inmuebles activos tengo?" / "¿qué vence esta semana?" → usa tools, datos reales.
- [ ] Off-topic cotidiano simple → breve y humano, sin cortar a la primera.
- [ ] Off-topic insistente → límite amable y **variable** (no la misma frase).
- [ ] "Completa la tarea X" → prepara + confirmación → `done`.

## 9. Pendientes honestos

- **Aplicación manual:** el n8n autoalojado no tiene API REST configurada (`N8N_API_URL`/`N8N_API_KEY`
  ausentes) y el MCP no autentica; el prompt se aplica re-pegando el System Message (P12.3 §manual).
- **Evals reales:** no ejecutables desde aquí; quedan como checklist + fixture (21 casos).
- **Ruta OpenAI** (fallback) lleva las mismas reglas; en producción responde n8n.

## 10. Veredicto

**P12.4 COMPLETADO — ASISTENTE IA COMO GUÍA FUNCIONAL DEL CRM, SIN REVELAR ARQUITECTURA.** El prompt
distingue con claridad **funcionalidad del producto (SÍ se explica)** vs **arquitectura técnica (NO se
explica)**, deja de negarse a explicar el Dashboard/CRM, suaviza el off-topic (humano y variable) y
elimina los ejemplos de conversación fijos en favor de reglas generales adaptables — manteniendo
seguridad, datos reales con tools, confirmación de escrituras, brevedad/coste y vocabulario final.
`tsc`/`lint`/`build` en verde y workflow JSON válido. **Requiere re-pegar el System Message en el nodo
"CRM Agent" de n8n** (manual; igual que P12.3).
