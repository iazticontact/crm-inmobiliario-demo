# NowCRM — Packs por sector

Cada pack es un conjunto preconfigurado de automatizaciones, campos de cliente y plantillas de texto optimizados para un tipo de negocio concreto. Se activan en onboarding o desde Settings.

---

## Pack Clínica / Salud

**Trigger principal:** cita médica o de bienestar

| Elemento | Descripción |
|---|---|
| Campo extra cliente | Historial de visitas, fecha última consulta |
| Automatización clave | Confirmación cita 24h + recordatorio 2h antes |
| Lead score | Basado en frecuencia de visitas y derivaciones |
| Plantilla WhatsApp | "Hola [nombre], te recordamos tu cita el [fecha] a las [hora] con [médico]. Confirma respondiendo SÍ." |
| PDF propuesta | Hoja de consentimiento / presupuesto tratamiento |
| Evento n8n | `appointment_booked` → envía confirmación automática |

---

## Pack Consultoría / Servicios Profesionales

**Trigger principal:** nuevo proyecto o propuesta aceptada

| Elemento | Descripción |
|---|---|
| Campo extra cliente | Sector, tamaño empresa, presupuesto estimado |
| Automatización clave | Propuesta PDF al superar lead score 80 + seguimiento en 48h |
| Lead score | Basado en tamaño empresa y número de contactos |
| Plantilla WhatsApp | "Hola [nombre], adjunto la propuesta para [empresa]. ¿Podemos hablar esta semana para resolverle dudas?" |
| PDF propuesta | Propuesta comercial con módulos, hitos y precio |
| Evento n8n | `new_lead` → secuencia cualificación + propuesta |

---

## Pack E-commerce / Retail

**Trigger principal:** pedido, carrito abandonado o cliente inactivo

| Elemento | Descripción |
|---|---|
| Campo extra cliente | Ticket medio, último pedido, categoría favorita |
| Automatización clave | Re-engagement a 15 días sin compra + descuento |
| Lead score | Basado en frecuencia de compra y ticket medio |
| Plantilla WhatsApp | "Hola [nombre], hace tiempo que no te vemos. Aquí tienes un 10% de descuento en tu próxima compra: [enlace]." |
| PDF propuesta | Catálogo personalizado o presupuesto B2B |
| Evento n8n | `reengagement_needed` → oferta personalizada |

---

## Pack Peluquería / Estética / Belleza

**Trigger principal:** reserva de servicio

| Elemento | Descripción |
|---|---|
| Campo extra cliente | Servicio habitual, color/tinte, frecuencia de visita |
| Automatización clave | Recordatorio cita + oferta fidelización cada 45 días |
| Lead score | Basado en frecuencia de visita y gasto acumulado |
| Plantilla WhatsApp | "Hola [nombre], recuerda que mañana tienes cita a las [hora]. ¡Te esperamos!" |
| PDF propuesta | Bono de sesiones con precio especial |
| Evento n8n | `appointment_booked` → confirmación + recordatorio |

---

## Pack Inmobiliaria / Real Estate

**Trigger principal:** nuevo interesado en propiedad

| Elemento | Descripción |
|---|---|
| Campo extra cliente | Tipo de propiedad buscada, presupuesto, zona, urgencia |
| Automatización clave | Seguimiento a 48h + visita preparada si score ≥ 75 |
| Lead score | Basado en presupuesto, urgencia y zona match |
| Plantilla WhatsApp | "Hola [nombre], he visto que te interesa [propiedad]. Tengo hueco esta semana para mostrártela. ¿Cuándo te viene bien?" |
| PDF propuesta | Ficha de propiedad con precio, fotos y condiciones |
| Evento n8n | `new_lead` → cualificación inmediata + alerta agente |

---

## Pack Academia / Formación

**Trigger principal:** inscripción o consulta de curso

| Elemento | Descripción |
|---|---|
| Campo extra cliente | Curso de interés, nivel, disponibilidad horaria |
| Automatización clave | Bienvenida al curso + recordatorio inicio + encuesta post-formación |
| Lead score | Basado en intención declarada y conversaciones previas |
| Plantilla WhatsApp | "Hola [nombre], ya estás inscrito en [curso]. Empieza el [fecha]. Cualquier duda, escríbenos aquí." |
| PDF propuesta | Programa del curso + condiciones de pago |
| Evento n8n | `new_lead` → secuencia onboarding formativo |

---

## Roadmap de activación

| Pack | Estado | Prioridad |
|---|---|---|
| Clínica / Salud | En diseño | Alta |
| Consultoría | En diseño | Alta |
| E-commerce | Pendiente | Media |
| Peluquería / Estética | Pendiente | Media |
| Inmobiliaria | Pendiente | Baja |
| Academia | Pendiente | Baja |

---

## Arquitectura técnica de un pack

1. **Onboarding selector** — en `/settings`, pestaña "Pack de sector", el usuario elige su tipo de negocio
2. **Seed de datos** — el pack crea automáticamente en Supabase: automatizaciones base, plantillas de texto y configuración de lead score
3. **Activación progresiva** — las automatizaciones se crean en estado `draft`; el usuario las revisa y activa desde `/automations`
4. **Personalización** — los textos de plantilla se editan en `/settings > Plantillas`; los campos extra se añaden al perfil de cliente

---

*Documento interno NowCRM — no publicar externamente*
