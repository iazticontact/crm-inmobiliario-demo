# NowCRM Next Steps

## Prioridad inmediata

1. Pasar QA manual completo con `docs/QA_CHECKLIST.md`.
2. Revisar schema real de Supabase y generar tipos.
3. Probar usuario real con CRUD completo: clients, billing, calendar, assistant y settings.
4. Conectar primer workflow n8n real.
5. Preparar dominio, email transaccional y deploy.

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
- Empezar por `new_lead`, `invoice_overdue` y `appointment_scheduled`.

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
