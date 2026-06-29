# FASE P14 — Configuración honesta + Asistente IA con razonamiento funcional (sin respuestas memorizadas)

> **Fecha:** 2026-06-26 · Dos objetivos: **(1)** que `/settings` sea una pantalla de producto real
> (cada bloque comunica si está Activo, Solo lectura, Configurable o Próximamente — cero humo) y **(2)**
> que el Asistente IA **razone** sobre Configuración por el estado real del producto, sin inventar
> funciones (zonas, plantillas, permisos avanzados, tipos de inmueble). Sin tocar prompt vivo de n8n,
> credenciales, webhook, tools, memory, RLS/Auth/Storage.

---

## 1. Diagnóstico (auditoría en código, sin asumir)

`/settings` ya estaba muy gateada: casi todo lo técnico (infra, n8n, env checks, WhatsApp, Google
Calendar, Inbox Agent, integraciones externas, checklist) sólo se renderiza con
`NEXT_PUBLIC_NOWLABS_INTERNAL=true`. Lo **visible al cliente** era: Tipo de workspace, Mi cuenta,
Equipo, Asistente IA y Notificaciones. Auditado componente a componente y endpoint a endpoint.

## 2. Qué era confuso o humo

- **Notificaciones = humo.** Los toggles ("Nuevos leads", "Resumen diario IA") sólo cambiaban estado
  local + `toast`; **no** persistían, **no** había cron/email/tabla. Parecían activos sin serlo.
- **Vocabulario.** "Nuevos **leads**" (término prohibido) y, en la tarjeta de Vertical, "**Pipeline**".
- **Texto técnico visible.** La tarjeta de Vertical mostraba `workspace_settings` y un toast con
  `RLS` ante error.
- **Tipo de workspace poco claro.** Título "Vertical del workspace" sin explicar para qué sirve;
  copys de opciones desalineados; por defecto "General" en un CRM inmobiliario sin pista visual.
- **Mi cuenta** no indicaba que era **solo lectura** (parecía editable).
- **Typo** "Espanol".

## 3. Qué funciones son reales (verificado en código)

- **Tipo de workspace (Configurable):** `VerticalPreferenceCard` persiste en Supabase
  (`upsertWorkspaceSettings`) con fallback local; badge honesto "Guardado en workspace" / "localmente".
- **Equipo / Invitar usuario (Activo y real):** `/api/team/users` (POST) valida email/rol/permisos,
  hace `auth.admin.inviteUserByEmail` (email real de set-password), crea el profile/membership con
  `workspace_id` del caller, idempotencia, rollback del auth user si falla el profile, RLS. Estados
  loading/error/success en el modal. **No es humo → se mantiene activo.** (Requiere
  `SUPABASE_SERVICE_ROLE_KEY`; si falta devuelve 503 honesto.)
- **Asistente IA (Activo):** incluido, consulta datos reales, prepara acciones con confirmación,
  protección de coste P13.

## 4. Qué queda como futuro

- **Notificaciones (Próximamente):** sin backend (cron/email/tabla). Convertidas a informativas.
- Integraciones externas (WhatsApp/Email/Google Calendar/pagos): ya estaban como operador-interno
  o "Próxima fase".

## 5. Cambios en Configuración (UI)

- **Badges de estado consistentes por sección**, leídos del nuevo *feature registry*: Mi cuenta
  `Solo lectura`, Tipo de workspace `Configurable` (en su badge propio), Equipo `Activo`, Asistente IA
  `Activo`, Notificaciones `Próximamente`.
- La pantalla responde sin preguntar: qué está activo, qué se puede cambiar, qué es informativo, qué
  llegará y qué hace el Asistente.

## 6. Cambios en Vertical / Tipo de workspace

- Título → **"Tipo de workspace"**; subtítulo: "adapta el contexto del CRM, las sugerencias y el
  Asistente IA".
- Copys de opciones reescritos (General / Inmobiliaria / Extranjería / Servicios / Mixto) según P14.
- **"Pipeline" eliminado.** `workspace_settings` y `RLS` **fuera de la UI** (textos y toast honestos
  sin tecnicismos; queda sólo en un comentario de código, no en producto).
- Badge **"Recomendado para este CRM"** en la opción Inmobiliaria (sin tocar el dato persistido: no se
  fuerza un cambio de valor por defecto).

## 7. Cambios en Mi cuenta

- Badge **"Solo lectura"** y subtítulo que aclara que son datos informativos del administrador.
- Typo **"Espanol" → "Español"** (3 ramas: loading, demo, real).
- Sin IDs ni datos técnicos.

## 8. Cambios en Equipo / Invitar usuario

- Es **real** → se mantiene **Activo** con badge. Subtítulo más claro ("invita por email con un rol;
  recibirán un enlace seguro para definir su contraseña"). Modal sin cambios funcionales (ya honesto).

## 9. Cambios en Notificaciones

- Sección reconvertida a **"Próximamente"**: nota honesta arriba ("Ahora mismo el CRM no envía avisos
  automáticos") + cada item como tarjeta informativa con badge `Próximamente` (sin toggles falsos).
- "Nuevos **leads**" → "Nuevos **clientes**"; "Resumen diario IA" → "Resumen diario del CRM".
- Eliminados el estado `notifications` y `toggleNotif` (ya no hay interacción falsa).

## 10. Cambios en Asistente IA (sección de Configuración)

- Copy honesto recomendado (consulta datos reales, prepara acciones de forma segura, deja preparadas
  las no conectadas) + mención a la protección de coste P13.
- Botón **"Abrir Asistente IA"** (`/assistant`). Tarjetas de capacidades honestas (consulta de datos /
  acciones con confirmación; no "auto-guarda").

## 11. Cambios de vocabulario

`lead(s)` → cliente/contacto/mensaje · `pipeline` → operaciones · `workspace_settings`/`RLS` fuera de
UI. (Limpiados además textos operador-internos: Slack, WhatsApp, "Simular mensaje".)

## 12. Feature registry / capabilities

Nuevo **`src/lib/product-capabilities.ts`**: estado real de cada bloque (`active | readonly |
configurable | upcoming | hidden`), explicación de usuario, acciones disponibles/no disponibles, si el
Asistente puede explicarlo, y helpers (`getCapability`, `configCapabilitiesSummary`, labels/variants de
badge). **Lo usa la UI** para los badges (cero humo) **y** alimenta el razonamiento del Asistente.

## 13. Cambios en conocimiento del Asistente

- **Fallback local** (`nowlabs-main-agent.ts`): la línea "Configuración" se reescribe como **bloque de
  razonamiento funcional** (bloques reales + su estado; prohíbe inventar zonas/plantillas/permisos
  avanzados/tipos de inmueble; razona por estado, no por plantilla fija; tono de guía de producto).
- **n8n vivo (producción):** **microparche PREPARADO y documentado**, no aplicado. Está en
  `n8n/patches/P14-configuracion-razonamiento-funcional.txt` con el bloque exacto y el método de INSERT
  quirúrgico (estilo P12.7). **No** se re-pegan los `.txt` del repo porque el systemMessage vivo está
  **más completo** que el repo (microparches previos por API) y re-pegar **regresaría** producción.
  **Pendiente de autorización** para el PUT a la instancia viva.

## 14. Backend / persistencia

Sin cambios de backend nuevos. Vertical persiste (Supabase + RLS por workspace, fallback local con
badge honesto). Invitar usuario usa service-role **solo en servidor** (`/api/team/users`), nunca en
frontend. No se añadieron toggles fake ni invitaciones/notificaciones falsas.

## 15. Responsive / accesibilidad

Layout `xl:grid-cols-[1fr_380px]` intacto; las nuevas tarjetas usan los grids responsive existentes.
Badges con **texto** (no solo color). Botón "Abrir Asistente IA" es un enlace nativo accesible.
Notificaciones: estado comunicado con texto + badge (sin depender del color).

## 16. Tests / evals

- `src/lib/agents/__evals__/product-capabilities.evals.ts`: verifica estados esperados (notificaciones
  `upcoming`, equipo `active`, etc.), que Notificaciones no promete envíos, que Equipo permite invitar,
  y que el resumen para el Asistente **no** contiene términos prohibidos ni funciones inventadas.
- `assistant-coherence.evals.ts` +4: "¿qué hay en Configuración?" (razona, no inventa), "¿qué hace
  Invitar usuario?" (activo, email), "¿me llegan notificaciones?" (no afirmar envíos), "¿puedo cambiar
  el nombre del workspace / permisos avanzados?" (solo lectura, no inventar).

## 17. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅.
Scans: `product-capabilities.ts` sin términos prohibidos/inventados · componentes siempre-visibles sin
`lead`/`pipeline`/`workspace_settings` en UI · Notificaciones sin toggles activos falsos · sin
invitación/notificación falsa · sin `service_role` en frontend.

## 18. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/lib/product-capabilities.ts` | **NUEVO** feature registry (estado real por bloque) |
| `src/components/VerticalPreferenceCard.tsx` | "Tipo de workspace", copys, fuera Pipeline/`workspace_settings`, badge Recomendado |
| `src/components/TeamUsersCard.tsx` | badge "Activo" + subtítulo claro |
| `src/app/(saas)/settings/page.tsx` | badges por sección, Notificaciones→Próximamente, Asistente IA (copy+botón), Mi cuenta solo-lectura, vocabulario, typo |
| `src/lib/agents/nowlabs-main-agent.ts` | bloque de razonamiento funcional de Configuración (fallback local) |
| `n8n/patches/P14-configuracion-razonamiento-funcional.txt` | **NUEVO** microparche preparado para n8n vivo (no aplicado) |
| `src/lib/agents/__evals__/product-capabilities.evals.ts` | **NUEVO** evals del registry |
| `src/lib/agents/__evals__/assistant-coherence.evals.ts` | +4 evals de Configuración |

## 19–20. Commit / Push

Commit `feat(settings): configuración honesta por estado real + Asistente razona Configuración (P14)` →
`origin/main`.

## 21. Instrucciones de deploy

- **Frontend:** redeploy para ver la Configuración honesta y el razonamiento del fallback local.
- **n8n (producción):** aplicar el microparche de `n8n/patches/P14-configuracion-razonamiento-funcional.txt`
  al systemMessage vivo (INSERT quirúrgico, **con autorización previa**, conservando `=` y `{{ }}`).
  Sin eso, el Agent V2 de producción seguirá explicando Configuración de forma genérica.

## 22. Checklist staging

- [ ] Abrir Configuración: cada bloque comunica su estado (Activo / Solo lectura / Configurable / Próximamente).
- [ ] Cambiar Tipo de workspace y Guardar → recargar → persiste; badge "Guardado en workspace".
- [ ] Notificaciones: se ven como "Próximamente", sin toggles que hagan nada.
- [ ] Equipo: "Invitar usuario" abre modal, valida email/rol; con service-role configurado envía invitación real.
- [ ] Abrir Asistente IA desde Configuración.
- [ ] Preguntar al Asistente: "¿qué hay en Configuración?", "¿qué hace Invitar usuario?", "¿me llegan notificaciones?" → razona por estado real, no inventa zonas/plantillas/permisos.
- [ ] Responsive desktop/portátil/tablet.

## 23. Pendientes honestos

- **Microparche n8n vivo:** preparado y documentado; **pendiente de autorización** para el PUT. Hasta
  aplicarlo, producción (n8n) puede seguir explicando Configuración de forma genérica.
- **Mi cuenta editable:** hoy es solo lectura; editar nombre de workspace/idioma sería una mejora futura.
- **Notificaciones reales:** requieren cron + email (Resend) + tabla de preferencias (fase posterior).

## 24. Veredicto

**P14 COMPLETADO — CONFIGURACIÓN HONESTA, ENTENDIBLE Y GUIADA POR ESTADO REAL DEL PRODUCTO.** Cada
bloque dice la verdad (Activo / Solo lectura / Configurable / Próximamente), sin toggles ni
invitaciones ni notificaciones falsas; vocabulario limpio; nuevo *feature registry* como fuente única
de estado que usan la UI y el Asistente. El Asistente IA **razona** sobre Configuración (fallback local
ya actualizado; microparche n8n preparado y a la espera de autorización), sin memorizar una respuesta
fija ni inventar funciones. `tsc`/`lint`/`build` en verde.
