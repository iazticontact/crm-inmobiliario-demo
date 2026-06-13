# Checklist de onboarding cliente inmobiliario

> Qué pedir y acordar con el cliente **cuando compra**, para arrancar la implantación con todo lo necesario y sin sorpresas.
> Se usa después de cerrar la venta (ver [SALES_MEETING_SCRIPT.md](SALES_MEETING_SCRIPT.md)) y antes de tocar la Fase 2 técnica (ver [PHASE_2_SUPABASE_BLUEPRINT.md](PHASE_2_SUPABASE_BLUEPRINT.md)).

> **Cómo usarlo:** conviértelo en un formulario/email de bienvenida. Cuanto más completo llegue, más rápido y barato sale el arranque. Lo que falte, retrasa.

---

## 1. Datos básicos

- [ ] **Nombre de la empresa** (razón social + nombre comercial).
- [ ] **Usuarios** que van a entrar (nombre + email de cada uno).
- [ ] **Roles** de cada usuario (administrador / comercial / coordinador…).
- [ ] **Email** de contacto principal (y técnico, si hay).
- [ ] **Teléfono** de contacto.
- [ ] **Dominio** propio (si quieren la app en `crm.suempresa.com` o similar).
- [ ] **Logo y branding** si aplica (logo en alta, colores corporativos) — opcional según pack.

---

## 2. Datos comerciales

- [ ] **Tipos de clientes** que manejan (comprador, vendedor, inquilino, propietario, inversor…).
- [ ] **Estados de lead** que usan (nuevo, contactado, cualificado, frío, descartado…).
- [ ] **Pipeline actual** — sus fases de venta reales, en su propio lenguaje.
- [ ] **Comerciales** — cuántos son y cómo se reparten el trabajo.
- [ ] **Zonas** geográficas en las que operan.
- [ ] **Tipos de propiedades** (piso, chalet, ático, local, obra nueva, alquiler…).
- [ ] **Fuentes de leads** (Idealista, Fotocasa, web, Instagram, recomendaciones, WhatsApp…).

> Esto define cómo se configura el CRM a su medida (fases del pipeline, tipos de inmueble, campos). No te lo inventes: recógelo de ellos.

---

## 3. Datos para importar

- [ ] **Excel de clientes** (exportación de lo que tengan: nombre, teléfono, email, estado, notas).
- [ ] **Excel de propiedades** (referencia, tipo, operación, precio, estado, dirección).
- [ ] **Calendario actual** (Google Calendar u otro) si quieren migrar/conectar visitas.
- [ ] **Documentos** relevantes (plantillas, contratos tipo) si entra en alcance.
- [ ] ℹ️ **Conversaciones** (WhatsApp/email históricas) **NO se importan** salvo que sea un alcance específico y presupuestado. Por defecto el histórico de chats no migra.

> ⚠️ Aviso de calidad de datos: si el Excel está sucio (duplicados, columnas inconsistentes, campos mezclados), la migración requiere limpieza y se **presupuesta aparte**. Pídelo pronto para dimensionar.

---

## 4. Integraciones

> Cada integración se activa según pack y alcance. Recoge qué quieren y qué cuentas/accesos tienen.

- [ ] **WhatsApp Business / Meta** — ¿tienen cuenta de WhatsApp Business? ¿número dedicado? (Requiere verificación y **aprobación de Meta**, tiempos no controlados por nosotros.)
- [ ] **Google Calendar** — ¿qué cuenta(s)? ¿calendario compartido del equipo o por comercial?
- [ ] **Email** — ¿quieren notificaciones/avisos por email? ¿con qué dirección de envío?
- [ ] **Web** — ¿tienen formularios de contacto en su web que deban volcar leads al CRM?
- [ ] **Formularios** — landing pages, formularios de captación, etc.
- [ ] **Portales inmobiliarios** (Idealista/Fotocasa) — ¿qué plan tienen? (define qué conexión es posible; no se promete por defecto).
- [ ] **n8n / workflows** — qué automatizaciones quieren desde el inicio.

---

## 5. Decisiones de configuración

A acordar con el cliente antes de configurar:

- [ ] **Etapas del pipeline** — la lista exacta y su orden.
- [ ] **Roles** — qué puede ver/hacer cada rol.
- [ ] **Permisos** — ¿los comerciales ven solo sus leads o todos? ¿quién accede a facturación?
- [ ] **Automatizaciones iniciales** — cuáles entran en el arranque (recordatorios, avisos de lead nuevo…).
- [ ] **Plantillas de mensajes** — respuestas tipo para leads, seguimiento, etc.
- [ ] **Horarios** — horario comercial (para automatizaciones y SLA).
- [ ] **SLA de seguimiento** — en cuánto tiempo se debe contactar un lead nuevo (p. ej. «antes de 1 h»).

---

## 6. Entregables (qué reciben)

Deja por escrito en la propuesta qué se entrega:

- [ ] **CRM funcionando** con sus datos, fases, propiedades y usuarios.
- [ ] **Formación** al equipo (sesión(es) según pack).
- [ ] **Soporte inicial** durante las primeras semanas.
- [ ] **Documentación** básica de uso (cómo entrar, cómo usar lo esencial).
- [ ] **Mantenimiento mensual** (soporte, ajustes, actualizaciones) según pack.
- [ ] **Accesos** entregados al administrador del cliente.

---

## 7. Riesgos del onboarding (anticípalos)

- ⚠️ **Datos mal formateados** — Excel sucio retrasa y encarece la migración. Mitigación: revisar los datos pronto y presupuestar limpieza si hace falta.
- ⚠️ **El cliente no entrega los accesos** (Google, WhatsApp, web) — bloquea integraciones. Mitigación: pedirlos por adelantado y dejar claro que sin ellos esa parte no avanza.
- ⚠️ **Meta tarda en aprobar WhatsApp** — fuera de nuestro control. Mitigación: arrancar el CRM sin depender de WhatsApp y gestionar la aprobación en paralelo; comunicarlo desde el principio.
- ⚠️ **El equipo no adopta la herramienta** — mayor riesgo de fracaso percibido. Mitigación: configuración a su medida, formación, empezar simple, y que el dueño empuje.
- ⚠️ **El alcance se dispara** («ya que estás, ¿puedes también…?») — come margen y tiempo. Mitigación: alcance cerrado por escrito; lo nuevo se presupuesta aparte.
- ⚠️ **Expectativas infladas** sobre IA/WhatsApp — Mitigación: honestidad desde la venta (ver «Qué NO prometer»); reforzar qué entra en cada fase.

---

## Resumen de arranque (orden recomendado)

1. Recoger datos básicos + comerciales + accesos (secciones 1, 2, 4).
2. Recibir y revisar los Excel a importar (sección 3) → detectar limpieza necesaria.
3. Acordar configuración (sección 5) por escrito.
4. Implantar el CRM base con sus datos (Fase 2 técnica).
5. Formar al equipo y entregar accesos.
6. Activar integraciones según alcance y disponibilidad (WhatsApp en paralelo por lo de Meta).
7. Soporte inicial + paso a mantenimiento mensual.
