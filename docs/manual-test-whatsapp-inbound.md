# Manual test: WhatsApp inbound simulator

1. Reinicia el dev server para cargar `.env.local`.
2. Entra en `/settings`.
3. En WhatsApp Business / Meta Cloud API, rellena un numero demo o deja el valor de prueba `+34600000000`.
4. Pulsa `Preparar WhatsApp`.
5. Pulsa `Simular lead`.
6. Debe aparecer el toast: `Mensaje entrante simulado guardado en Inbox.`
7. Entra en `/assistant`.
8. Selecciona `Inbox Assistant`.
9. Debe aparecer una conversacion de `Lead WhatsApp Demo` o el telefono usado.
10. Abre la conversacion.
11. Debe verse el mensaje entrante como cliente.
12. No debe aparecer respuesta automatica, cita, factura ni tarea.

## SQL opcional de verificacion

```sql
select * from public.conversations order by updated_at desc limit 10;
select * from public.messages order by created_at desc limit 10;
```

## Troubleshooting

- `401 authorize_request`: falta sesion en Settings o falta `x-nowcrm-webhook-secret` desde n8n.
- `401 validate_user_token`: JWT caducado; recarga la app e inicia sesion de nuevo.
- `403 authorize_workspace`: el usuario no tiene profile asociado al `workspaceId`.
- `500 server_config`: falta service role en el backend de NowCRM o el dev server no se reinicio.
- `create_conversation`: revisa columnas obligatorias/constraints de `conversations`.
- `create_message`: revisa columnas obligatorias/constraints de `messages`; este paso es bloqueante.
- Si el toast es OK pero no ves Inbox, entra de nuevo en `/assistant` o cambia a `Inbox Assistant` para refrescar conversaciones.
