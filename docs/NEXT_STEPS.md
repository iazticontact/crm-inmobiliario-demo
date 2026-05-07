# NowCRM Next Steps

## Prioridad inmediata

1. Pasar QA manual completo con `docs/QA_CHECKLIST.md`.
2. Probar en Settings el workflow real `NowCRM - Assistant Agent`.
3. Probar `/assistant` con usuario real y confirmar respuesta n8n/OpenAI.
4. Configurar secreto server-only para Agent Tools cuando n8n empiece a ejecutar acciones CRM.
5. Conectar el siguiente workflow real: `new_lead` o `invoice_overdue`.
6. Deploy en Vercel/Hostinger.
7. Configurar Resend cuando haya dominio.

## Fase IA real

- Assistant Agent ya usa OpenAI dentro de n8n para `assistant_message`.
- Ampliar contexto de workspace, cliente, conversacion, facturas y eventos en el payload.
- Guardar cada respuesta en `messages`.
- Registrar activity por recomendacion/accion.
- Mantener fallback mock si falta clave o proveedor.

## Fase n8n real

- Revisar que `n8n_flows` persiste desde Settings.
- `assistant_message` ya tiene endpoint real conectado.
- Guardar endpoint real para los siguientes flujos.
- Usar `/api/n8n/trigger` como unica salida desde cliente.
- Anadir firma, timeout, retries y logs.
- Empezar por `new_lead`, `invoice_overdue` y `appointment_booked`.
- Eventos recomendados iniciales: `assistant_message`, `new_lead`, `invoice_overdue`, `appointment_booked`.

## Fase canales

- WhatsApp Business / Meta Cloud API.
- Email SMTP/Resend.
- Stripe para cobros.
- Slack o Teams para alertas internas.

## Fase producto

- Detalle de cliente.
- Pipeline comercial.
- Historial unificado por cliente.
- Roles por workspace.
- Billing real con Stripe.
