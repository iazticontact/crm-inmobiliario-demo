# Phase 2E-2 H13 — Assistant product knowledge + UI premium + no false promises

> **Fecha:** 2026-06-16 · **Base:** `96a8454` · System prompt (product knowledge +
> scrub falsas promesas) + limpieza UI del asistente. Sin features, sin n8n, sin
> schema, sin service_role frontend. Cerebro en el CRM.

## 1. Problemas observados (conversación real)
- Dashboard descrito con **facturas/cobros** (módulo no implementado).
- "¿Cómo funciona Configuración?" → "no tengo acceso" (debía explicar el apartado).
- Confundía "Configuración" (apartado del menú) con su propia arquitectura.
- Capacidades incluían facturas/Inbox/mensajes (falsas promesas).
- Cerraba respuestas con preguntas forzadas ("¿te gustaría…?").
- Panel derecho con relleno técnico (Estado operativo, Sentimiento, Estado técnico).

## 2. Falsas promesas eliminadas (system prompt)
- QUÉ PUEDES HACER reescrito a módulos REALES (clientes, operaciones, expedientes,
  propiedades, tareas, calendario, actividad). Quitadas facturas/Inbox/mensajes/n8n.
- Bloque explícito **NO PROMETAS**: facturación/cobros, documentos/Storage,
  WhatsApp/Inbox, Google sync, automatizaciones externas → "fase futura, no activo".

## 3. Product knowledge añadido (system prompt)
Bloque **SECCIONES DEL CRM**: el agente explica Dashboard / Clientes / Operaciones
/ Calendario / Configuración / Asistente, con lo que cada apartado contiene HOY y
sin mencionar módulos futuros como funcionales. Incluye guía para demo/venta.
Configuración: si preguntan "qué es / cómo funciona", lo explica (nunca "no tengo
acceso").

## 4. Cambios de comportamiento
- No terminar cada respuesta con pregunta forzada (reforzado).
- Demo/venta: recomienda qué enseñar (ficha cliente, operaciones, calendario,
  acciones con confirmación).
- "¿Cómo funcionas?"/"¿qué puedes hacer?": honesto, con ejemplos (ya en H11/H12,
  reforzado).

## 5. UI assistant antes/después
- **Quick chip:** "Estado del inbox" → **"Operaciones abiertas"** (real).
- **Panel derecho:** tarjetas técnicas **"Estado operativo", "Sentimiento",
  "Estado técnico"** y "Último documento generado (Factura PDF)" → **ocultas al
  cliente** (solo `NEXT_PUBLIC_NOWLABS_INTERNAL`). El cliente ve: tarjeta del hilo
  + tarjeta de capacidades reales (Clientes/Operaciones/Expedientes/Tareas/Citas).
- (H12 ya había ocultado el badge técnico y relabelado "Backend agent"→"Copiloto
  activo"; H11 ocultó Lead Score.)

## 6. Panel derecho antes/después
- Antes: client card + Estado operativo (OK) + Sentimiento + Estado técnico
  (backend/n8n/Meta) + doc (Factura PDF) + capacidades.
- Después (cliente): client card + capacidades reales. (Lo técnico solo internal.)

## 7. Evals añadidos
`ASSISTANT_CRM_INTELLIGENCE_EVALS.md` §11 — 7 casos H13 (enseñar/demo, Configuración,
dashboard sin facturas, operaciones sin pregunta, cómo funcionas, no-question-loop,
facturas/WhatsApp = futuro).

## 8. Qué NO se tocó
Cerebro v2/confirm, executor, tools (solo prompt + 1 chip label), n8n, WhatsApp/
Inbox, Storage, Google, facturación, schema/migraciones, `.env.local`, service_role
frontend, demo, persistencia (assistant_threads/messages).

## 9. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).

## 10. Riesgos / próximo paso
- La mejora principal (product knowledge + sin falsas promesas) es del **prompt
  del agente OpenAI**: se verifica en conversación. Smoke (Oier): repetir el guion
  real (saludo→demo/venta→Configuración→Calendario→Dashboard→Operaciones→cierre).
- Rediseño visual aún más profundo del panel/cabecera = follow-up opcional (no
  crítico; ya está mucho más limpio).

## 11. Veredicto
**H13 COMPLETADO — ASISTENTE 9/10 PRE-STAGING:** product knowledge del CRM actual,
sin falsas promesas (facturas/WhatsApp/Google/docs), explica las secciones del
menú, tono de empleado IA sin preguntas en bucle, y panel derecho limpio para el
cliente. Falta el smoke conversacional de Oier para certificar.
