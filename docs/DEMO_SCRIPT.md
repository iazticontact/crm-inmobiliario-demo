# NowCRM Demo Script

## Demo de 3 minutos

1. Abrir `/login` y entrar con usuario real.
2. Enseñar `/dashboard`: "No es solo una web bonita: es un CRM con IA y automatizaciones reales".
3. Abrir `/assistant` y señalar: "Mensajes reales", "n8n/OpenAI activo" y "Workspace real".
4. Enviar: `Reserva a Ana mañana a las 10 para corte`.
5. Si pide duracion, responder: `30 minutos`.
6. Mostrar la card de accion preparada y explicar: "El Assistant puede preparar acciones, pero las operaciones importantes requieren confirmacion".
7. Confirmar la cita y abrir `/calendar`.
8. Cierre: "La siguiente fase es WhatsApp/Whapi para que estas reservas entren solas desde mensajes reales".

## Demo de 5 minutos

### 1. Entrada

- Abrir `/login`.
- Explicar: "NowCRM es un CRM operativo con IA para centralizar clientes, conversaciones, calendario, facturas y automatizaciones".
- Entrar con usuario real o modo demo si se quiere evitar auth.

### 2. Dashboard

- Enseñar KPIs reales del workspace.
- Señalar badges de estado: Supabase conectado, Assistant persistente, n8n/OpenAI activo.
- Frase comercial: "La idea no es solo ver datos, sino convertir cada dato en una acción comercial".

### 3. Clientes

- Crear o abrir un cliente.
- Mostrar notas, estado, canal y score.
- Frase comercial: "Cada cliente queda listo para alimentar conversaciones, facturas, citas y automatizaciones".

### 4. Assistant IA

- Abrir `/assistant`.
- Confirmar visualmente: "Mensajes reales", "n8n/OpenAI activo", "Workspace real".
- Enviar: `Soy una peluquería y quiero que la IA gestione reservas`.
- Enviar: `Reserva a Ana mañana a las 10 para corte`.
- Mostrar card de acción preparada y explicar que no escribe nada sin confirmación.
- Si falta duración, responder `30 minutos` y confirmar.
- Abrir `/calendar` y enseñar el evento.

### 5. Facturación

- Volver a `/assistant`.
- Enviar: `Crea una factura a Ana de 299€ por Plan Pro`.
- Si falta vencimiento, responder: `Vence el 30 de este mes`.
- Mostrar la card de factura y confirmar solo si los datos estan completos.
- Abrir `/billing` y enseñar la factura.

### 6. Cierre

- Abrir `/settings`.
- Enseñar Assistant Agent activo y n8n preparado.
- Frase comercial: "El siguiente paso es conectar WhatsApp/Whapi para que estas reservas entren desde mensajes reales".

## Demo de 10 minutos

1. Login real y dashboard.
2. Cliente real: crear, editar nota y revisar estado.
3. Assistant: conversación real con n8n/OpenAI.
4. Reserva: preparar card, completar datos, confirmar y verificar en Calendario.
5. Factura: enviar `Crea una factura a Ana de 299€ por Plan Pro`; enseñar card y pedir vencimiento.
6. Billing: confirmar factura si procede y verificar en Facturación.
7. Settings: explicar Supabase, n8n, Assistant Agent, WhatsApp pendiente y Agent Tools.
8. Automations: enseñar flujos preparados y estados reales/pendientes.

## Frases comerciales útiles

- "No es solo una web bonita: es un CRM con IA y automatizaciones reales".
- "NowCRM no es solo un CRM de registros: convierte mensajes en tareas, citas, facturas y seguimiento".
- "La IA no ejecuta acciones críticas a ciegas; prepara la acción y pide confirmación".
- "Supabase guarda los datos reales; n8n orquesta procesos; OpenAI aporta razonamiento desde el workflow".
- "Puede preparar citas, facturas y proximas acciones desde el mismo chat".
- "La siguiente fase es WhatsApp/Whapi para que los mensajes entren solos".

## Qué no prometer todavía

- WhatsApp/Whapi no está conectado aún.
- Stripe/pagos reales no están conectados aún.
- Los workflows n8n distintos de Assistant Agent están preparados, pero no todos tienen URL real.
- La disponibilidad avanzada de calendario todavía no calcula huecos reales complejos.
- Las acciones críticas requieren confirmación humana antes de escribir en Supabase.
