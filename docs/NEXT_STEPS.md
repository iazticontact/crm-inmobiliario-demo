# NowCRM Next Steps

## Prioridad inmediata

1. Pasar QA manual completo con `docs/QA_CHECKLIST.md`.
2. Ensayar el guion comercial de `docs/DEMO_SCRIPT.md`.
3. Probar `/assistant` con reservas: pedir datos, completar duracion, confirmar y verificar `/calendar`.
4. Probar `/assistant` con facturas: preparar factura, pedir vencimiento y confirmar si procede.
5. Probar en Settings el workflow real `NowCRM - Assistant Agent`.
6. Configurar secreto server-only para Agent Tools cuando n8n empiece a ejecutar acciones CRM desde workflows externos.
7. Conectar WhatsApp/Whapi como siguiente canal real.
8. Crear buckets de Supabase Storage y tabla `documents` para PDFs, propuestas y adjuntos.
9. Conectar nuevos workflows n8n: `new_lead`, `invoice_overdue`, `daily_summary`.
10. Deploy en Vercel/Hostinger.
11. Configurar Resend cuando haya dominio.
12. Conectar Stripe/pagos si la demo pasa a piloto.

## Fase IA real

- Assistant Agent ya usa OpenAI dentro de n8n para `assistant_message`.
- El frontend detecta intenciones operativas locales para ahorrar tokens: reservas, facturas, cliente, cobros y proximas acciones.
- Las acciones criticas se preparan como cards y requieren confirmacion antes de escribir.
- Ampliar contexto de workspace, cliente, conversacion, facturas y eventos en el payload solo cuando aporte valor.
- Guardar cada respuesta en `messages`.
- Registrar activity por recomendacion/accion.
- Mantener fallback mock si falta clave o proveedor.

## Coste y rendimiento

- OpenAI vive en n8n, no en el cliente.
- Usar un modelo ligero como `gpt-4o-mini` o equivalente cuando baste para la demo.
- Mantener `max_tokens` bajo en respuestas comerciales operativas.
- Usar deteccion local para reservas/facturas antes de llamar a n8n.
- No enviar historiales completos salvo que la conversacion lo necesite.
- Las escrituras CRM siguen bloqueadas por confirmacion humana.

## Fase n8n real

- Revisar que `n8n_flows` persiste desde Settings.
- `assistant_message` ya tiene endpoint real conectado.
- Guardar endpoint real para los siguientes flujos.
- Usar `/api/n8n/trigger` como unica salida desde cliente.
- Anadir firma, timeout, retries y logs.
- Empezar por `new_lead`, `invoice_overdue`, `appointment_booked` y `calendar_event_created`.
- Eventos recomendados iniciales: `assistant_message`, `new_lead`, `invoice_overdue`, `appointment_booked`.

## Fase canales

- WhatsApp/Whapi con QR, channel id y webhook entrante.
- Email SMTP/Resend.
- Stripe para cobros.
- Slack o Teams para alertas internas.

## Fase documentos / PDFs

- Crear buckets en Supabase Storage: `client-files`, `invoice-pdfs`, `proposal-pdfs`, `conversation-attachments`, `workspace-assets`.
- Ejecutar la migracion opcional de `documents` cuando se quiera indexar archivos por workspace/cliente.
- Generar PDFs de facturas y propuestas desde una API server-side o desde n8n, nunca desde el cliente con secretos.
- Usar URLs firmadas para documentos privados.
- Añadir tools futuras: `create_proposal_document`, `generate_invoice_pdf`, `attach_file_to_client` y `list_client_documents`.
- Mantener adjuntos de WhatsApp/Whapi como siguiente fase, vinculados a conversaciones y clientes.

## Fase producto

- Detalle de cliente.
- Pipeline comercial.
- Historial unificado por cliente.
- Roles por workspace.
- Billing real con Stripe.
