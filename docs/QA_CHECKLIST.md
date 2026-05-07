# NowCRM QA Checklist

## Auth

- Abrir `/login`.
- Entrar con usuario real confirmado.
- Comprobar overlay de carga.
- Cerrar sesion real y volver a `/login`.
- Probar forgot password y `/reset-password`.

## Modo demo

- Entrar en modo demo desde `/login`.
- Comprobar `/dashboard`.
- Comprobar que Sidebar muestra modo demo.
- Cerrar sesion demo y volver a `/login`.

## Clients

- Cargar `/clients` con usuario real.
- Crear cliente con notas.
- Editar cliente y notas.
- Eliminar cliente con confirmacion.
- Recargar y verificar persistencia.
- Repetir en modo demo y confirmar fallback local.

## Billing

- Cargar `/billing`.
- Crear factura.
- Editar factura.
- Marcar pagada.
- Eliminar factura.
- Recargar y verificar persistencia.
- Revisar metricas: total, pendiente, cobrado y vencidas.

## Calendar

- Cargar `/calendar`.
- Crear evento.
- Editar evento.
- Eliminar evento.
- Recargar y verificar persistencia.
- Revisar vista semanal y panel de proximos eventos.

## Assistant

- Cargar `/assistant`.
- Crear conversacion demo/real.
- Enviar mensaje.
- Ver respuesta IA mock.
- Recargar y verificar mensajes persistentes con usuario real.
- Marcar conversacion como resuelta.

## Settings

- Cargar `/settings`.
- Revisar estado de modulos.
- Inicializar flujos n8n con usuario real.
- Editar endpoint de flujo.
- Guardar flujo.
- Probar flujo.
- Cambiar estado de una integracion.
- Recargar y verificar persistencia si RLS/schema lo permiten.

## n8n Trigger

- Probar desde Settings con URL por defecto: debe simular.
- Probar con endpoint localhost/HTTPS si existe n8n real.
- Verificar respuesta `ok`, `simulated`, `skipped` o `error`.

## Dashboard

- Comprobar KPIs con usuario real.
- Comprobar activities recientes si existen.
- Confirmar badges de datos reales/IA mock/n8n preparado.

## Deploy

- Ejecutar `npm run lint`.
- Ejecutar `npm run build`.
- Configurar variables en proveedor.
- Configurar URLs de callback/reset en Supabase.
- Activar Confirm email ON cuando exista dominio + Resend.
