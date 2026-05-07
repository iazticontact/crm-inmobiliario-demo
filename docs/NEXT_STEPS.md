# NowCRM Next Steps

## Prioridad inmediata

1. Pasar QA manual completo con `docs/QA_CHECKLIST.md`.
2. Pasar URL publica de n8n real.
3. Montar workflow `assistant_message`.
4. Conectar OpenAI dentro de n8n usando `/api/agent/tool`.
5. Configurar secreto server-only para Agent Tools.
6. Deploy en Vercel/Hostinger.
7. Configurar Resend cuando haya dominio.

## Fase IA real

- Crear endpoint server para IA.
- Incluir contexto de workspace, cliente, conversacion, facturas y eventos.
- Guardar cada respuesta en `messages`.
- Registrar activity por recomendacion/accion.
- Mantener fallback mock si falta clave o proveedor.

## Fase n8n real

- Revisar que `n8n_flows` persiste desde Settings.
- Guardar endpoint real por flujo.
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
