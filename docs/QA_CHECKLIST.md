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
- Confirmar que eventos creados desde Assistant aparecen tras recargar.
- Editar evento.
- Eliminar evento.
- Recargar y verificar persistencia.
- Revisar vista semanal y panel de proximos eventos.

## Assistant

- Cargar `/assistant`.
- Verificar que no aparece flash demo con usuario real.
- Verificar badges: `Mensajes reales`, `n8n/OpenAI activo`, `Workspace real`.
- Seleccionar `Conversaciones / Inbox Assistant`.
- Crear conversacion real Inbox.
- Enviar `Hola, quiero saber precios`.
- Ir a `/dashboard`, volver a `/assistant` y confirmar que la conversacion Inbox sigue.
- Recargar `/assistant` y confirmar que los mensajes Inbox siguen.
- Seleccionar `Copilot CRM / Asistente interno`.
- Crear consulta real Copilot.
- Enviar `Qué puedes hacer?`.
- Ir a `/settings`, volver a `/assistant` y confirmar que la consulta Copilot sigue.
- Recargar `/assistant` y confirmar que los mensajes Copilot siguen.
- Confirmar que Inbox y Copilot no comparten conversacion activa ni lista filtrada.
- Enviar `Hola buenas, ¿con quién hablo?`.
- Enviar `Soy una peluquería y quiero que la IA gestione reservas`.
- Verificar respuesta corta y operativa sobre reservas.
- Enviar `Reserva a Ana mañana a las 10 para corte`.
- Verificar card `Acción preparada` con datos faltantes y confirmacion bloqueada si falta duracion.
- Enviar `30 minutos`, confirmar card y comprobar evento en `/calendar`.
- Enviar `Crea una factura a Ana de 299€ por Plan Pro`.
- Verificar card de factura y confirmacion bloqueada si falta vencimiento.
- Con flujo `assistant_message` activo, verificar respuesta n8n/OpenAI y mensaje assistant guardado.
- Si n8n falla, verificar fallback seguro sin cambiar la pantalla a demo.
- Probar quick action `Resumen cliente`.
- Probar quick action `Proxima accion`.
- Probar quick action `Crear cita`.
- Probar quick action `Buscar hueco`.
- Probar quick action `Crear factura`.
- Probar quick action `Revisar cobros`.
- Probar quick action `Buscar cliente`.
- Probar quick action `Probar n8n`.
- Recargar y verificar mensajes persistentes con usuario real.
- Confirmar que modo demo no escribe en Supabase.
- Marcar conversacion como resuelta.

## AI Agent Tools

- Probar `POST /api/agent/tool` con `get_workspace_summary`.
- Probar `search_clients`.
- Probar `get_next_best_actions`.
- Probar una tool de escritura en fallback demo.
- Si hay service role y secreto, probar `create_client` desde n8n con `x-nowcrm-secret`.

## Settings

- Cargar `/settings`.
- Revisar estado de modulos.
- Inicializar flujos n8n con usuario real.
- Activar `NowCRM - Assistant Agent`.
- Probar `Probar Assistant Agent`.
- Editar endpoint de flujo.
- Guardar flujo.
- Probar flujo.
- Cambiar estado de una integracion.
- Recargar y verificar persistencia si RLS/schema lo permiten.

## n8n Trigger

- Probar desde Settings con URL por defecto: debe simular.
- Probar con endpoint localhost/HTTPS si existe n8n real.
- Verificar respuesta `ok`, `simulated`, `skipped` o `error`.
- Probar `assistant_message` contra `NowCRM - Assistant Agent`.
- Probar `new_lead`.
- Probar flujo inactivo: debe devolver `skipped`.
- Copiar payload de ejemplo desde docs si hace falta.

## Automations

- Cargar `/automations`.
- Probar una automatizacion.
- Activar/pausar una automatizacion.
- Verificar badge `n8n demo` o `n8n active`.
- Confirmar que los tests pasan por `/api/n8n/trigger`.

## Dashboard

- Comprobar KPIs con usuario real.
- Comprobar activities recientes si existen.
- Confirmar badges de datos reales, Assistant n8n/OpenAI y n8n preparado.

## Lockdown antes de demo

- No tocar `.env.local`.
- No cambiar el webhook real de n8n.
- No editar RLS ni redirects de Supabase si todo funciona.
- No instalar paquetes.
- Revisar `docs/DEMO_LOCKDOWN.md`.

## Deploy

- Ejecutar `npm run lint`.
- Ejecutar `npm run build`.
- Configurar variables en proveedor.
- Configurar URLs de callback/reset en Supabase.
- Activar Confirm email ON cuando exista dominio + Resend.
