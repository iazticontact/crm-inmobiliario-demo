# Roadmap de producto — Pack básico vs módulos premium

> Fuente de verdad del alcance comercial. La separación NO es solo conceptual: está
> implementada con **feature flags** (`src/lib/feature-flags.ts`) y branding centralizado
> (`src/lib/brand.ts`). Un clon para cliente se configura por **env**, sin tocar código.

## PACK BÁSICO (vendible hoy) — visible para el cliente
| Módulo | Ruta | Estado | Notas |
|---|---|---|---|
| Dashboard | `/dashboard` | ✅ real + demo | KPIs reales: clientes, eventos, expedientes, propiedades; sin cobros/WhatsApp para el cliente |
| Clientes | `/clients`, `/clients/[id]` | ✅ real + demo | listado, búsqueda, ficha 360, datos fiscales/contacto, actividad, operaciones/expedientes/tareas/citas, documentos (metadata) |
| Operaciones | `/opportunities` | ✅ real + demo | pipeline comercial por etapas, cliente/propiedad, importe/probabilidad/fecha |
| Expedientes | dentro de cliente/operaciones | ✅ real | nombre comercial "Expedientes" (tabla técnica `service_cases`) |
| Tareas | dentro de cliente | ✅ real | pendientes, responsable, vencimiento, estado |
| Calendario | `/calendar` | ✅ real + demo | citas/visitas/disponibilidad interna (sin Google OAuth) |
| Documentos | dentro de cliente/inmueble/trámite | ✅ real (P37) | subir/listar/descargar (signed URL) y borrar sobre `entity_files` con RLS; SIN lectura de contenido PDF (sin OCR/RAG). La ficha de cliente usa `EntityDocumentsManager` (fin de la tabla legacy `documents`). |
| Asistente IA (Copiloto) | `/assistant` | ✅ real (n8n Agent V2) | read-only: consulta y resume; memoria, personalidad premium; NO crea/edita aún |
| Demo offline | `?demo` / flag | ✅ | datos mock, solo lectura, claramente demo |
| Configuración básica | `/settings` | ✅ | perfil/workspace; lo técnico se oculta al cliente |

## MÓDULOS PREMIUM / FUTUROS (NO en el pack básico)
Ocultos al cliente por defecto (flags `nowlabsInternal`/`*` en OFF). Se venderán por packs:
- **Facturación PRO** (`/facturacion`) — ✅ **módulo extra premium real** (P33–P36A): borradores, líneas
  con IVA/IRPF/descuento, numeración atómica, emisión, **PDF** y **generador por texto/voz** (parser local
  determinista, Web Speech API) con preview editable. Manual y **AISLADO del Asistente IA** (P35: el bot no
  lee ni acciona facturas). Nav en sección "Módulos extra". Pendiente: email/cobros, Verifactu/TicketBAI.
- **Facturación automática** (`/billing`) — placeholder interno antiguo; emisión/cobros reales pendientes.
- **WhatsApp Business / Inbox** (`/inbox`) — Meta Cloud API; sin tablas conversations/messages aún.
- **Automatizaciones n8n** (`/automations`) — editor de flujos para el operador.
- **Scraper comercial** (Google Maps / email / teléfono) — captación de leads.
- **Landing web comercial + webchat** — adquisición.
- **RAG de documentos / lectura de PDF** — contenido, no solo metadata.
- **Google Calendar real (OAuth)** — sincronización bidireccional.
- **Escritura desde el asistente** (preparar + confirmar) — el agente hoy es read-only.
- **Scoring interno de leads** — existe en datos pero NUNCA visible como "lead score" al cliente.
- **Import/export avanzado, roles/equipos avanzados.**

## Cómo se configura un clon para cliente (env, sin código)
- `NEXT_PUBLIC_NOWLABS_INTERNAL=false` (default) → oculta Facturación, WhatsApp/Inbox,
  Automatizaciones, tiles técnicos de Configuración, chips de score, KPIs de cobros/WhatsApp.
- `NEXT_PUBLIC_ENABLE_DEMO_DATA=true` solo para clones de demo offline.
- `NEXT_PUBLIC_ENABLE_*` (billing/inbox/automations/…) en `false` para apagar módulos extra.
- Branding del producto: editar solo `src/lib/brand.ts` (un único sitio).
- Para el Asistente: `N8N_ASSISTANT_V2_WEBHOOK_URL` + `N8N_ASSISTANT_V2_SECRET` (server-side).

## Principio
Primero el **pack básico perfecto** (este documento, columna izquierda). Los módulos premium
se construyen y venden encima, sin romper el básico ni exponerlos antes de tiempo.
