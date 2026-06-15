# Product Decision — WhatsApp / Meta API

> **Fecha:** 2026-06-15 · **Estado:** DECISIÓN ·
> Relacionado: [PRODUCT_ARCHITECTURE_AUDIT.md](PRODUCT_ARCHITECTURE_AUDIT.md),
> [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)

## 1. Objetivo (visión)
WhatsApp **oficial** vía Meta WhatsApp Business (Cloud) API: que el asistente
pueda responder por WhatsApp y que las conversaciones se puedan sincronizar al
CRM. **Nunca WhatsApp fake.** No prometer integración que no existe.

## 2. Estado actual (verificado)
- **NO existen tablas `conversations`/`messages`** en Supabase.
- La página `/inbox` está etiquetada **"WhatsApp"** y es **visible en el nav del
  cliente** (flag `inbox` ON, no `internal`), pero **no tiene backing**: en modo
  real la API (`/api/inbox/conversations`) no encuentra tabla → vacío + banners
  "Meta no configurado / OpenAI no configurado".
- `META_*` no configurado (integración dormida). Las rutas
  `/api/integrations/meta/whatsapp/*` y `/api/inbox/*` existen pero sin datos.
- **Bien hecho ya:** la API de inbox autoriza por `profiles.role` server-side y
  fuerza `channel='whatsapp'` para usuarios normales (no eludible por query param).
- **No hay fuga de datos:** en real NO se muestran conversaciones mock (cumple
  Data Reality Policy). El problema es de **UX/promesa**, no de integridad.

## 3. Problema inmediato (UX)
El cliente ve **"WhatsApp"** en la barra y al entrar no hay nada → promesa vacía.
**Recomendación H1 (audit):** ocultar `WhatsApp`/Inbox del nav del cliente
(marcar `internal: true` en `Sidebar.tsx` o `NEXT_PUBLIC_ENABLE_INBOX=false` en
clones) hasta que la integración sea real. Cambio de 1 línea, reversible.
*(No aplicado en esta fase — es decisión de producto/demo de Oier.)*

## 4. Opciones de arquitectura
- **A) Inbox espejo en el CRM:** sincronizar conversaciones de WhatsApp a tablas
  `conversations`/`messages` y operarlas desde el CRM. Máximo valor (todo en un
  sitio, IA con contexto), máximo coste (Meta API, plantillas, webhooks, ventana
  de 24h, compliance).
- **B) WhatsApp externo (móvil) + IA/n8n:** el agente vive en n8n/servicio
  externo; el CRM no replica el chat. Más barato y rápido, pero el CRM no es la
  central de conversaciones.
- **C) Híbrido (recomendado por fases):** empezar por **registrar/loggear**
  interacciones clave de WhatsApp como `activities`/notas en la ficha (valor CRM
  sin Meta API), y más adelante construir el **inbox espejo real (A)** vía n8n +
  Meta Cloud API.

## 5. Riesgos Meta WhatsApp Business
- **Permisos/verificación Meta:** Business verification, número, display name
  approval, revisión de la app.
- **Plantillas (templates):** fuera de la ventana de 24h solo se pueden enviar
  mensajes con plantilla **pre-aprobada** por Meta. Limita el "responde lo que
  quieras" del asistente.
- **Costes:** facturación por conversación/categoría (marketing/utility/service).
- **Compliance/RGPD:** consentimiento, opt-out, conservación de mensajes, datos
  personales en `messages`.
- **Soporte/operación:** webhooks fiables, reintentos, estados de entrega.

## 6. Recomendación por fases
1. **Ahora:** ocultar el nav "WhatsApp" del cliente (H1). No prometer nada.
2. **Fase intermedia (parte de IA-6 / Fase 6):** logging de interacciones de
   WhatsApp como actividad/nota en la ficha (sin Meta API) — valor CRM real.
3. **Fase 6 completa:** inbox espejo real (tablas `conversations`/`messages` +
   RLS) alimentado por **n8n + Meta Cloud API**; el asistente responde con
   plantillas aprobadas dentro de las reglas de Meta; confirmación para acciones.
4. **n8n como orquestador externo**, nunca como cerebro (el razonamiento sigue en
   el CRM/agente).

## 7. Qué NO hacer ahora
- No implementar Meta/WhatsApp real, ni webhooks productivos, ni plantillas.
- No crear tablas `conversations`/`messages` todavía.
- No dejar "WhatsApp" visible como si funcionara en clones de cliente.
- No mostrar conversaciones mock a usuarios reales (ya se cumple).

## 8. Decisión
**Híbrido por fases (C).** Comercialmente: vender la *visión* de WhatsApp como
roadmap, no como feature lista. Técnicamente: ocultar el módulo hasta que exista
el inbox espejo real con Meta API + n8n. Mantener el andamiaje seguro y dormido.
