# Product Decision — Calendario (interno vs Google Calendar)

> **Fecha:** 2026-06-15 · **Estado:** DECISIÓN ·
> Relacionado: [PRODUCT_ARCHITECTURE_AUDIT.md](PRODUCT_ARCHITECTURE_AUDIT.md)

## 1. La duda
¿Merece la pena Google Calendar OAuth, o basta con un calendario interno?

## 2. Estado actual (verificado)
- **Calendario interno = real y funcional:** tabla `calendar_events`
  (workspace-scoped, RLS), página `/calendar`, eventos por cliente en la ficha,
  crear/editar/reprogramar (RT3/RT4.3). 8 eventos seed. **Es core y funciona.**
- **Google Calendar:** existe mucho andamiaje de rutas
  (`/api/integrations/google/calendar/*`: connect, callback, sync, import,
  webhook, etc.) pero **`GOOGLE_CLIENT_ID/SECRET` están vacíos** → la integración
  está **dormida** (pending_config). No hay OAuth real activo.

## 3. Decisión
- **Calendario interno = CORE.** Cubre lo que una inmobiliaria necesita: visitas,
  llamadas, reuniones, tareas con vencimiento. Es suficiente para el MVP y para
  vender.
- **Google Calendar sync = ADDON OPCIONAL futuro.** No debe bloquear el CRM ni
  ser requisito para usarlo. → **Fase 7 del roadmap.**

## 4. Por qué interno primero
| Criterio | Interno | Google OAuth |
|---|---|---|
| Tiempo a valor | inmediato (ya hecho) | alto (OAuth, verificación Google) |
| Dependencia externa | ninguna | Google Cloud project + consent screen |
| Riesgo | bajo | scopes sensibles, revisión de Google, tokens |
| Mantenimiento | bajo | refresh tokens, webhooks, expiraciones |
| Valor para inmobiliaria | alto (visitas/tareas) | medio (comodidad de sync) |

## 5. Riesgos de Google OAuth (cuando se aborde)
- **Verificación de Google** para scopes de Calendar (proceso + posible auditoría
  si se piden scopes amplios).
- **Gestión de tokens:** almacenamiento seguro (server-side), refresh, revocación,
  expiración; nunca tokens en frontend.
- **Sincronización bidireccional:** conflictos, duplicados, borrados, zonas
  horarias — complejidad real.
- **Privacidad:** leer el calendario personal del agente inmobiliario es dato
  sensible; debe ser **opt-in explícito** y revocable.

## 6. Experiencia simple deseada (usuario no técnico)
- Por defecto: calendario interno, cero configuración.
- Google: un botón opcional "Conectar Google Calendar" en Configuración (solo si
  el addon está activo), con explicación clara y revocación fácil. Si no se
  conecta, **todo sigue funcionando**.

## 7. Qué NO hacer ahora
- No activar OAuth real (no tocar `GOOGLE_*`, no DNS, no consent screen).
- No prometer sync de Google en la UI del cliente hasta la Fase 7.
- No bloquear ninguna función del calendario interno por la ausencia de Google.

## 8. Recomendación
**Quedarse con el calendario interno como core** y dejar Google Calendar como
addon opcional de fase tardía. El andamiaje existente se mantiene **dormido** (sin
exponerlo) hasta que haya demanda comercial que justifique el coste de OAuth.
