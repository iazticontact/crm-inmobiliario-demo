# NowCRM Demo Lockdown

## No tocar antes de enseñar

- `.env.local`, API keys, secretos o credenciales.
- Workflow n8n `NowCRM - Assistant Agent` si ya responde.
- RLS de Supabase.
- Redirect URLs de auth si login/reset funcionan.
- Nuevos paquetes o cambios grandes de UI.
- Service role en frontend.
- WhatsApp Business si no hay verificacion Meta y webhook real probados.
- Ramas Git sin revisar ni cambios masivos de ultima hora.

## Probar antes de abrir la demo

1. Login real.
2. Dashboard.
3. Assistant con `NowLabs AI backend activo`.
4. Reserva: `Reserva a Ana mañana a las 10 para corte` y completar `30 minutos`.
5. Confirmar cita y verificar `/calendar`.
6. Factura: `Crea una factura a Ana de 299€ por Plan Pro` y completar vencimiento.
7. Confirmar factura y verificar `/billing`.
8. Settings > Probar Assistant Agent.
9. Logout.

## Si algo falla

- Mantener la narrativa comercial: "esto ya esta preparado y el fallback permite seguir la demo".
- Usar modo demo si auth real falla.
- No tocar produccion ni n8n en directo durante la reunion.
- No editar `.env.local`.
- Revisar consola/logs despues de la demo, no delante del cliente.

## Mensaje comercial seguro

- NowCRM ya centraliza clientes, facturas, calendario y conversaciones.
- El Assistant ya responde con NowLabs AI backend.
- Las acciones criticas se preparan y requieren confirmacion.
- WhatsApp Business Platform oficial es la siguiente fase para entrada automatica de mensajes.
