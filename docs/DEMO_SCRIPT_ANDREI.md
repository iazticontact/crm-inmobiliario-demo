# NowCRM — guion de demo comercial (Andrei)

> Versión 2026-05-18 · Fase E.
> Pensado para enseñar NowCRM a un cliente real **antes** de tener VPS, n8n
> real, WhatsApp real o Instagram real. Cada sección incluye qué decir, qué
> mostrar y qué evitar prometer.

## 0. Antes de empezar

- Abre [https://nowcrm-demo.vercel.app](https://nowcrm-demo.vercel.app) (o
  la URL actual de Vercel) en un navegador limpio.
- Entra en **modo demo** desde `/login` si vas a enseñar sin datos reales.
  Si tienes datos del workspace real conectados a Supabase, entra con la
  cuenta real — los badges se ponen verdes y los KPIs se llenan solos.
- Cierra notificaciones de extensiones, devtools, pestañas con secretos.
- Ten esta página abierta en una segunda pestaña para recordar el orden.

**Tono:** "Esto es la base operativa de NowCRM. Las integraciones
externas (WhatsApp, Instagram, n8n) se enchufan por workspace cuando
desplegamos el VPS del cliente; lo que vamos a ver ya funciona hoy."

---

## 1. /dashboard — la foto general

**Qué enseñar:**
- Saludo del workspace + badge de estado (`Datos reales conectados` /
  `Sin datos reales`).
- Fila de **badges de readiness**: NowLabs AI, Inbox omnicanal,
  Operaciones (Vertical Pack) y Calendar interno en verde; Google
  Calendar, WhatsApp Meta, Instagram y n8n en ámbar con su motivo
  ("pendiente OAuth", "pendiente claves", "pendiente VPS").
- 3 quick-link cards: **Pipeline · oportunidades**, **Expedientes
  activos**, **Propiedades en cartera** — con contadores reales si hay
  workspace conectado.
- KPIs (clientes, ingresos, Inbox externo, eventos próximos).

**Qué decir:**
- "Aquí el operador ve en una pantalla qué está conectado, qué leads
  hay abiertos, qué expedientes están vivos y qué cobros vencen."
- "Los badges separan **lo que ya tienes funcionando** de **lo que
  requiere claves del cliente**. Nunca pintamos en verde una cosa que no
  está operativa."

**Qué evitar:**
- No digas "WhatsApp ya está conectado" ni "n8n funcionando". Está
  preparado, los webhooks existen, pero las claves reales son del
  cliente.
- No demos por verde el chart de "Leads por canal" si es demo — es de
  ejemplo.

---

## 2. /clients — el centro del CRM

**Qué enseñar:**
- Lista de clientes (con filtros si los hay).
- Abrir un cliente → **Cliente 360 drawer** (icono ojo).
- En el drawer: cabecera con nombre, empresa, canal, lead score; el
  bloque "Próxima acción" con la sugerencia de IA; 4 StatPills
  (oportunidades, expedientes, propiedades, facturas).
- Las 3 CTAs **Crear oportunidad / Crear expediente / Registrar
  propiedad** — pre-rellenan al cliente.
- Las secciones agregadas: Oportunidades, Expedientes, Propiedades,
  Conversaciones, Facturas, Próximas citas, Actividad reciente.

**Qué decir:**
- "Esto es el **Cliente 360**. En una vista tienes todo lo que el
  workspace sabe del cliente: comercial, expedientes, propiedades,
  facturación, agenda y actividad reciente."
- "Cuando creas una oportunidad o un expediente desde aquí, el cliente
  ya queda vinculado real — no es un string libre."

**Qué evitar:**
- No abras un cliente vacío de demo para alardear de "0 oportunidades".
  Elige uno con histórico, o trabaja sobre uno real.

---

## 3. /opportunities — Operaciones (Vertical Pack)

**Qué enseñar:**
- Subtabs **Pipeline / Expedientes / Propiedades / Plantillas /
  Automatizaciones**.
- Tabs por vertical: Todos / Inmobiliaria / Extranjería / Servicios.
- Crear una oportunidad desde el botón "Nueva oportunidad" (drawer
  lateral, campos típicos: título, vertical, etapa, valor,
  probabilidad, cliente vinculado).
- Hacer click en el título de una fila → **drawer de edición** con
  todos los campos editables. Mostrar el botón "Marcar perdida" como
  archivo sin DELETE.
- Cambiar la etapa con el `<select>` inline → optimista + toast.
- Subtab **Expedientes**: crear uno de extranjería (NIE, arraigo, etc.)
  y editar.
- Subtab **Propiedades**: crear una en captación, mostrar inline status
  y edición.
- Subtab **Plantillas**: mostrar el panel del workspace + catálogo base.
  Si hay sesión real, abre "Nueva plantilla", crea una y enséñala
  conviviendo con la base. Demuestra "Duplicar al workspace →" en una
  plantilla base. Archivar (sin DELETE) se mantiene en BD.
- Subtab **Automatizaciones**: mostrar las cards "Preparada" con sus
  requisitos.

**Qué decir:**
- "Tres entidades verticales en una sola pantalla: pipeline comercial,
  expedientes de servicio y propiedades inmobiliarias. **El mismo CRM
  sirve a una inmobiliaria, una gestoría de extranjería y una
  asesoría** cambiando el vertical."
- "Cada cambio queda registrado en `activities` con su fuente —
  `ui_manual` cuando lo hago yo, `nowlabs_agent` cuando lo hace la IA."

**Qué evitar:**
- No prometas que las automatizaciones ya se disparan. Son catálogo
  preparado que se enciende cuando hay n8n + canal real.
- No borres entidades en vivo. El producto **no hace DELETE**; usamos
  `status='archived'`, `stage='lost'` o `status='closed'`.

---

## 4. /inbox — bandeja externa real

**Qué enseñar:**
- Tabs por canal: Todo / WhatsApp / Instagram / Web / Email.
- Los empty states honestos: "WhatsApp aún no está conectado",
  "Instagram preparado para conectarse", etc. — con su explicación
  técnica corta.
- Si hay conversaciones reales: seleccionar una, mostrar el panel
  derecho con el contacto, el badge "Sin vincular" si procede, el
  **ClientPicker** "Vincular cliente →" y la CTA "Crear oportunidad
  desde esta conversación".
- Marcar una conversación como resuelta / archivada desde el selector
  del header.

**Qué decir:**
- "El Inbox es **solo para canales externos** — WhatsApp, Instagram,
  Web. Las consultas internas con la IA viven en `/assistant`, separadas
  a propósito."
- "Cuando un canal aún no tiene claves reales, el composer lo trata
  como **borrador** — no fingimos enviar."
- "Desde aquí el operador convierte una conversación en oportunidad
  CRM real en un click, sin n8n."

**Qué evitar:**
- No envíes mensajes reales en la demo. El botón guardará el mensaje
  como borrador con `pending_config` si no hay token.

---

## 5. /assistant — NowLabs AI

**Qué enseñar:**
- Los dos modos: **Inbox Assistant** (responder conversaciones externas)
  y **Copilot CRM** (asistente operativo interno).
- Una orden típica del Copilot: "Crea un lead inmobiliario para Ana
  que quiere vender un piso en Málaga."
- La IA pide confirmación verbal antes de escribir.
- Tras "sí" / "créala" → crea la oportunidad real, deja activity con
  `metadata.source='nowlabs_agent'`, y se ve en `/opportunities`.
- Más ejemplos: "Abre un expediente de extranjería de renovación de NIE
  para Ana"; "Crea una propiedad en captación en Marbella"; "Qué
  oportunidades tengo abiertas".

**Qué decir:**
- "NowLabs AI es el copiloto del operador. No es un chat genérico — es
  un agente con **9 tools verticales** que tocan las mismas tablas que
  el operador tocaría con la UI."
- "Siempre confirma antes de escribir. Si das una orden inequívoca con
  todos los datos, va directo."

**Qué evitar:**
- No prometas "responde solo a clientes de WhatsApp". Eso será con
  n8n + Meta real.
- No toques la página `/assistant` durante la demo — está cuidada.

---

## 6. /calendar — Google Calendar + agenda interna

**Qué enseñar:**
- La agenda con eventos reales si los hay.
- El estado del OAuth de Google (conectado / no conectado).
- La cancelación de un evento → sincroniza también con Google si está
  conectado.

**Qué decir:**
- "El Calendar funciona local con Supabase y, si conectas la cuenta de
  Google, sincroniza con el calendario real del operador. La
  cancelación desde NowCRM también cancela en Google."

**Qué evitar:**
- Si el OAuth no está conectado en la cuenta que estás demostrando, no
  intentes crear un evento "demo" y pretender que se sincronizó.

---

## 7. /billing — facturación

**Qué enseñar:**
- Lista de facturas con estado (pendiente, pagada, vencida).
- Crear factura, marcar como pagada.
- KPIs de cobros pendientes.

**Qué decir:**
- "Facturación local en Supabase. Cuando conectemos pasarela de pago
  real (Stripe / Redsys), los estados se sincronizan."

**Qué evitar:**
- No digas que cobra automáticamente. No hay pasarela conectada.

---

## 8. /automations — catálogo preparado

**Qué enseñar:**
- Leyenda de **3 categorías** arriba del todo: CRM interno (emerald),
  Vertical Pack (violet), Integraciones pendientes (amber).
- Cards del Vertical Pack: cada una con `trigger:` event chip,
  vertical, canal, requisitos y badge "Preparada".
- Botón disabled "Activar cuando n8n esté conectado".
- Al final, sección **Contrato n8n** — abrir el accordion y mostrar el
  payload JSON que NowCRM enviará a cada workflow (event_type,
  workspace_id, mode, client, conversation, etc.).

**Qué decir:**
- "Aquí separamos lo que ya controlamos hoy (CRM interno), el catálogo
  vertical preparado (Vertical Pack) y lo que requiere el VPS
  (integraciones pendientes)."
- "El contrato JSON con n8n está **cerrado y documentado**. Cuando el
  partner técnico monta los nodos, ya sabe qué espera NowCRM enviarle."
- "Una inmobiliaria activa unas; una gestoría de extranjería activa
  otras. El catálogo es por vertical."

**Qué evitar:**
- No pulses "Activar" como si fuera a ejecutar. El botón está
  intencionadamente desactivado.

---

## 9. /settings — configuración

**Qué enseñar:**
- Card "Vertical del workspace" (5 opciones).
- Sección WhatsApp Business / Instagram / n8n / Google Calendar.
- Cada integración con su estado claro (preparado / pendiente / claves
  registradas).

**Qué decir:**
- "La preferencia de vertical se guarda en `workspace_settings` con RLS
  por workspace — es **multi-dispositivo real**. El badge bajo la
  selección lo deja explícito: 'Guardado en workspace' (Cloud) o
  'Guardado localmente' (HardDrive) si la escritura cayó al fallback."
- "Las claves de Meta / n8n nunca se piden al cliente en el frontend.
  Las metemos como variables de entorno server-side."

**Qué evitar:**
- No abras herramientas de configuración real (DNS, OAuth screens) en
  la demo.

---

## 10. Pitch comercial (cierre)

> "Esto es la **base operativa** de NowCRM. Pipeline, expedientes,
> propiedades, clientes, agenda, facturación, asistente IA y bandeja
> de mensajes externos. Las integraciones reales (WhatsApp Cloud API,
> Instagram, n8n) se conectan **por workspace** cuando desplegamos el
> VPS del cliente — el código ya está preparado para recibirlas sin
> tocar la UI."

---

## ✅ Qué puedo prometer hoy

- CRM multi-tenant con RLS por `workspace_id`.
- Pipeline comercial multi-vertical (inmobiliaria, extranjería,
  servicios profesionales).
- Expedientes con tipos predefinidos (NIE, arraigo, reagrupación,
  estudiante…).
- Propiedades en cartera con estados (captación / publicada /
  contrato / vendida / archivada).
- Cliente 360 con todo lo del cliente en una vista.
- Inbox **externo** con clasificación por canal, vínculo de cliente
  real (no string libre) y conversión a oportunidad CRM.
- NowLabs AI con 9 tools verticales que tocan las mismas tablas que la
  UI, con confirmación verbal.
- Calendario interno + Google Calendar bidireccional.
- Facturación con estados (pendiente / pagada / vencida).
- Catálogo de 10 automatizaciones modeladas.
- Activity log auditable con `metadata.source` (`ui_manual`,
  `nowlabs_agent`, `system`).

## ❌ Qué NO debo prometer todavía

- ❌ Envío real de WhatsApp (necesita Meta Cloud API + claves del
  cliente).
- ❌ Envío real de Instagram (necesita cuenta profesional + permisos
  Meta).
- ❌ Workflows de n8n disparándose (necesita VPS + n8n del cliente).
- ❌ Cobros reales con Stripe/Redsys (sin pasarela conectada).
- ❌ Borrado físico de entidades vía UI — sólo archivado / cierre.
- ❌ Auto-reply activo en WhatsApp (`auto_reply_enabled` queda en false
  hasta que las integraciones reales estén operativas).

## 🛠 Qué falta antes del VPS

- Workflows reales en n8n (los 10 del catálogo, uno a uno).
- Decidir si NowLabs AI v2 lee ya `workspace_settings.ai_tone` y
  `default_language` (helper preparado, falta enchufe).
- Editor multi-usuario de plantillas (hoy cualquiera con acceso al
  workspace edita; sin `created_by`).

## ✨ Lo nuevo de Fase E (mostrar si encaja)

- `/settings` → Vertical persiste **de verdad** en Supabase.
- `/opportunities → Plantillas` → CRUD del workspace conviviendo con el
  catálogo base. Sin DELETE: archivar mantiene historia.
- `/automations` → Leyenda de 3 categorías y accordion "Contrato n8n"
  con el payload JSON exacto que recibirá el partner técnico.

## 🚀 Qué falta tras el VPS

- Activar `whatsapp_lead_inbound → create_opportunity` server-side.
- Recordatorio de cita, post-visita, lead frío, recordatorio de factura.
- Validación phone → client linking en inbound real.
- Resumen diario para el operador.
