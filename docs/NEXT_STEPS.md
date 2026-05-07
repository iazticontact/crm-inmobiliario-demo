# NowCRM Next Steps

## Prioridad inmediata

1. Revisar schema real de Supabase y generar tipos.
2. Probar usuario real con CRUD completo: clients, billing, calendar y assistant.
3. Persistir Settings para n8n/integrations.
4. Conectar primer workflow n8n real.
5. Preparar dominio, email transaccional y deploy.

## Fase IA real

- Crear endpoint server para IA.
- Incluir contexto de workspace, cliente, conversacion, facturas y eventos.
- Guardar cada respuesta en `messages`.
- Registrar activity por recomendacion/accion.
- Mantener fallback mock si falta clave o proveedor.

## Fase n8n real

- Persistir `n8n_flows`.
- Guardar endpoint por flujo.
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
