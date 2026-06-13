# Próximo plan de acción — CRM Inmobiliario Demo

> Hoja de ruta de **negocio** (no técnica): qué hacer, en qué orden, para pasar de «demo lista» a «primera venta» y luego a «implantación real».
> Estado base: **tag `demo-v1`** → commit `ca04af9`. Demo offline vendible. Fase 2 NO iniciada.
> Documentos de apoyo: [SALES_PACKAGE_PRICING.md](SALES_PACKAGE_PRICING.md) · [SALES_MEETING_SCRIPT.md](SALES_MEETING_SCRIPT.md) · [SALES_OBJECTIONS.md](SALES_OBJECTIONS.md) · [CLIENT_ONBOARDING_CHECKLIST.md](CLIENT_ONBOARDING_CHECKLIST.md) · [PHASE_2_SUPABASE_BLUEPRINT.md](PHASE_2_SUPABASE_BLUEPRINT.md) · [HANDOFF_CURRENT_STATE.md](HANDOFF_CURRENT_STATE.md)

---

## Ahora mismo (esta semana)

- [ ] **Prueba visual manual** de la demo — recorrer la checklist completa (de [DEMO_V1_SALES_GUIDE.md](DEMO_V1_SALES_GUIDE.md) / Fase 1J) y confirmar que todo va fino.
- [ ] **Sacar screenshots** comerciales — las 10 capturas de [DEMO_V1_SCREENSHOTS.md](DEMO_V1_SCREENSHOTS.md).
- [ ] **Revisar el guion** de demo (5 y 12 min) y practicarlo en voz alta 2–3 veces hasta que salga natural.
- [ ] **Preparar lista de inmobiliarias objetivo** — 15–30 nombres que encajen con el cliente ideal (pequeñas/medianas, mucho WhatsApp, leads de portales). Anota contacto y por qué encajan.
- [ ] **Preparar el mensaje de contacto** (primer acercamiento) — versión WhatsApp y versión email (ver plantillas abajo).

---

## Antes de vender (tener listo el «kit de venta»)

- [ ] **Screenshots** guardados y ordenados (`/sales-assets/demo-v1/screenshots/`).
- [ ] **Demo accesible** — local funcionando o, mejor, un **deploy Preview en Vercel** desde el tag (`release/demo-v1`, ver [DEMO_V1_DEPLOY_GUIDE.md](DEMO_V1_DEPLOY_GUIDE.md)) para poder mandar un enlace.
- [ ] **Pricing** claro de memoria (Starter / Pro / Premium, setup + mensual) — de [SALES_PACKAGE_PRICING.md](SALES_PACKAGE_PRICING.md).
- [ ] **Propuesta base** — una plantilla de propuesta reutilizable (alcance + pack + inversión + siguiente paso) que solo tengas que personalizar por cliente.
- [ ] **Preguntas de discovery** preparadas (de [SALES_MEETING_SCRIPT.md](SALES_MEETING_SCRIPT.md)).
- [ ] **Manual de objeciones** repasado (de [SALES_OBJECTIONS.md](SALES_OBJECTIONS.md)) para no quedarte en blanco.

---

## Primera venta (las primeras 1–3 implantaciones)

- [ ] **Vender un piloto acotado** — Starter o Pro, con alcance cerrado por escrito.
- [ ] **Limitar el alcance** — define exactamente qué entra; lo demás, fases siguientes o presupuesto aparte.
- [ ] **Cobrar el setup SIEMPRE** — aunque sea precio beta con descuento. Sin setup, no hay compromiso.
- [ ] **Definir entregables** claros (CRM funcionando, formación, soporte, mantenimiento).
- [ ] **No prometer integraciones** hasta confirmar APIs/cuentas/accesos del cliente (WhatsApp depende de Meta; portales, de su plan).
- [ ] **Recoger el onboarding** del cliente (de [CLIENT_ONBOARDING_CHECKLIST.md](CLIENT_ONBOARDING_CHECKLIST.md)) — datos, accesos, Excel a importar.
- [ ] **Pedir testimonio** al entregar (a cambio del precio beta), para el siguiente cliente.

---

## Después de la primera venta (implantación real = Fase 2)

Cuando ya hay un cliente que ha pagado y necesita datos reales:

- [ ] **Fase 2 — Supabase nuevo** — crear proyecto, schema multi-tenant, RLS, seed (ver [PHASE_2_SUPABASE_BLUEPRINT.md](PHASE_2_SUPABASE_BLUEPRINT.md)).
- [ ] **OpenAI** — conectar el asistente IA real (read tools + prepared actions + confirm) si el pack lo incluye.
- [ ] **n8n** — automatizaciones acordadas.
- [ ] **Meta / WhatsApp** — gestionar aprobación y conectar (en paralelo, porque Meta tarda).
- [ ] **Google Calendar** — sincronización real de visitas.
- [ ] **Deploy real** — entorno de producción del cliente (con sus variables de entorno, nunca secrets en código).
- [ ] **Soporte y mantenimiento** — pasar a la mensualidad recurrente.

---

## Checklist de decisión: ¿cuándo conectar Supabase MCP?

> ⚠️ **No conectar Supabase MCP por adelantado.** Es trabajo técnico de Fase 2 y solo tiene sentido cuando hay venta y plan. Conectar antes solo añade riesgo y complejidad sin valor comercial.

**Supabase MCP / Fase 2 solo se arranca cuando se cumplen TODAS:**
- [ ] La **demo visual está validada** (probada y sin fallos).
- [ ] Hay un **plan de schema aprobado** (el blueprint revisado y dado por bueno).
- [ ] Se ha **decidido crear un proyecto Supabase nuevo** (no se reutiliza el viejo).
- [ ] Está claro **qué módulos serán reales primero** (no «todo a la vez»).
- [ ] **Hay un cliente / razón de negocio** que lo justifique (idealmente una venta cerrada).

Si falta cualquiera de estas, **todavía no es momento**. Sigue vendiendo con la demo offline.

---

## Plantillas de primer contacto

### WhatsApp / DM (corto)
> Hola [Nombre] 👋 Soy [Oier]. Trabajo con inmobiliarias para que dejen de perder leads y tengan clientes, propiedades y visitas centralizados en un CRM hecho a su medida (con seguimiento automático y un asistente IA). ¿Te enseño una demo de 5 minutos sin compromiso? Creo que encaja con [inmobiliaria].

### Email (profesional)
> **Asunto:** Que no se os escape ningún lead — CRM para [inmobiliaria]
>
> Hola [Nombre],
>
> Ayudo a inmobiliarias como la vuestra a **dejar de perder leads** y a tener clientes, propiedades, visitas y seguimiento en un solo sitio — un CRM **a vuestra medida**, no un programa genérico.
>
> Lo veréis claro en una demo de 5 minutos: cómo entra un lead, cómo se le hace seguimiento, cómo se gestiona la cartera y la agenda, y cómo un asistente os ahorra el trabajo repetitivo.
>
> ¿Te viene bien que te la enseñe esta semana, sin compromiso? Te dejo también un enlace para que la veas tú mismo: [URL demo].
>
> Un saludo,
> [Oier] — [contacto]

---

## Norte estratégico

1. **Vender con la demo offline** (ya está lista) → genera ingresos sin construir infraestructura.
2. **Cerrar 1–3 pilotos** con precio beta + testimonio.
3. **Solo entonces, Fase 2** para esos clientes reales.
4. **Crecer** sobre casos de éxito: cada implantación hace la siguiente más fácil de vender.

> Regla de oro: **la venta financia la construcción, no al revés.** No montes la infraestructura «por si acaso»; móntala cuando un cliente la pague.
