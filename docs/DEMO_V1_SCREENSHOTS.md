# Screenshots necesarios para vender

> Versión congelada: **tag `demo-v1`** → commit `ca04af9`.
> Objetivo: tener un set limpio y profesional de capturas de la demo offline para material comercial (propuestas, web, redes, emails de venta).
> Documentos hermanos: [DEMO_V1_SALES_GUIDE.md](DEMO_V1_SALES_GUIDE.md) · [DEMO_V1_DEPLOY_GUIDE.md](DEMO_V1_DEPLOY_GUIDE.md)

---

## Cómo preparar el navegador antes de capturar

Reglas de higiene visual (aplican a **todas** las capturas):

- **Resolución / ventana:** ventana del navegador a **1920×1080** (Full HD). Si tu pantalla es más pequeña, usa 1440×900 como mínimo y mantén la misma en todas para que el set sea homogéneo.
- **Zoom del navegador:** **100%** (Ctrl+0 para resetear). Si en alguna pantalla el contenido se ve apretado, 90% es aceptable — pero usa el **mismo zoom en todo el set**.
- **Oculta la barra de favoritos** (Ctrl+Shift+B en Chrome/Edge) — no debe verse tu lista de marcadores personales.
- **Modo incógnito** recomendado: sin extensiones, sin barras raras, sin avatar de tu cuenta de Google.
- **NO muestres la consola de desarrollador** (F12 cerrado). Nada de paneles técnicos.
- **NO muestres la URL completa con rutas internas raras.** Para capturas de marketing, recorta la barra de direcciones o céntrate en el contenido de la app. `localhost:3000` o el dominio limpio de Vercel está bien; rutas largas con parámetros, no.
- **NO enseñes** `.env`, secrets, terminal, editor de código ni nada técnico de fondo.
- **Tema claro** (la app es clara por defecto) — coherente y luminoso para marketing.
- **Datos demo frescos:** las fechas de la demo son relativas a hoy, así que las visitas/tareas siempre se ven actuales. Captura el **mismo día** todo el set para máxima coherencia.
- **Tamaño de fuente del SO al 100%** para que no se vea todo gigante.

**Formato y nombrado de archivos:**
- Formato: **PNG** (mejor para UI con texto nítido).
- Carpeta local recomendada (NO se crea en el repo, es para tu disco):
  ```
  /sales-assets/demo-v1/screenshots/
  ```
- Nombra los archivos exactamente como se indica en cada ficha de abajo para mantener orden.

> Nota: esta carpeta `sales-assets/` es **solo para tu equipo en local**. No hace falta crearla en el repositorio ni subir las imágenes a git.

---

## Flujo para llegar a cada pantalla

1. Abre la app (local `http://localhost:3000` o la URL de Vercel cuando despliegues).
2. En **`/login`**, pulsa **«Ver demo inmobiliaria»**.
3. A partir de ahí navega por el menú lateral a cada sección.

---

## Screenshots mínimos

### 1. Login demo
- **Pantalla:** página de acceso.
- **Ruta:** `/login`
- **Qué preparar antes:** ventana limpia, sin favoritos, sin sesión previa. Que se vea bien el botón «Ver demo inmobiliaria».
- **Qué debe verse:** marca «CRM Inmobiliario Demo», formulario de acceso y el botón de demo destacado.
- **Por qué vende:** es la primera impresión; transmite que es un producto serio y que probar es fácil («un clic y dentro»).
- **Nombre de archivo:** `01-login-demo.png`

### 2. Dashboard completo
- **Pantalla:** panel principal.
- **Ruta:** `/dashboard`
- **Qué preparar antes:** scroll arriba del todo; ventana ancha para que entren los KPIs y los gráficos sin cortarse.
- **Qué debe verse:** saludo con badge **«Modo demo»**, tarjetas de KPIs, gráfico de pipeline/leads, agenda de la semana y tareas pendientes.
- **Por qué vende:** es la imagen «wow». Resume en una sola foto el control total del negocio. Es la captura estrella para portada/propuesta.
- **Nombre de archivo:** `02-dashboard.png`

### 3. Clientes
- **Pantalla:** listado de clientes.
- **Ruta:** `/clients`
- **Qué preparar antes:** vista por defecto, sin filtros aplicados.
- **Qué debe verse:** tabla/listado de clientes con nombre, estado (lead, cliente…) y canal de entrada (WhatsApp, web, portal…).
- **Por qué vende:** muestra orden y volumen; el cliente se imagina su propia cartera ahí dentro.
- **Nombre de archivo:** `03-clients-list.png`

### 4. Ficha cliente 360
- **Pantalla:** detalle de un cliente.
- **Ruta:** `/clients/[id]` (entra desde el listado, p. ej. «Lucía Herrera» o «Familia Soler»).
- **Qué preparar antes:** elige un cliente con datos ricos (oportunidades + visitas + actividad). Pestaña principal visible.
- **Qué debe verse:** datos del cliente, oportunidades asociadas, propiedades de interés, actividad reciente, conversaciones, facturas y visitas.
- **Por qué vende:** es el argumento «memoria de empresa». Demuestra que todo de un cliente vive en un solo sitio.
- **Nombre de archivo:** `04-client-360.png`

### 5. Pipeline de oportunidades
- **Pantalla:** embudo comercial.
- **Ruta:** `/opportunities`
- **Qué preparar antes:** vista de pipeline (kanban por etapas) con las columnas pobladas. Scroll para que se vean varias fases.
- **Qué debe verse:** columnas por etapa (nuevo → contactado → cualificado → visita → oferta → negociación → ganado) con tarjetas de oportunidades y valor total.
- **Por qué vende:** es el argumento del dueño: «aquí veo el dinero vivo de mi negocio». Muy visual y convincente.
- **Nombre de archivo:** `05-pipeline.png`

### 6. Propiedades
- **Pantalla:** cartera de inmuebles.
- **Ruta:** `/opportunities` → pestaña **Propiedades**.
- **Qué preparar antes:** pestaña de propiedades activa, con varios inmuebles visibles.
- **Qué debe verse:** inmuebles con tipo (piso, chalet, ático…), operación (venta/alquiler), estado (disponible, reservado, vendido) y precio.
- **Por qué vende:** la inmobiliaria ve su cartera ordenada; contraste directo con su Excel actual.
- **Nombre de archivo:** `06-properties.png`

### 7. Expedientes
- **Pantalla:** gestión de trámites/documentación.
- **Ruta:** `/opportunities` → pestaña **Expedientes**.
- **Qué preparar antes:** pestaña de expedientes activa.
- **Qué debe verse:** expedientes por tipo (venta de vivienda, hipoteca, tasación) con estado, prioridad y vencimiento próximo.
- **Por qué vende:** muestra que la parte «aburrida pero crítica» (papeleo, hipoteca) también está controlada y no frena las firmas.
- **Nombre de archivo:** `07-expedientes.png`

### 8. Calendario semanal
- **Pantalla:** agenda.
- **Ruta:** `/calendar`
- **Qué preparar antes:** vista **semana** con la semana actual (la demo siempre tiene visitas esta semana porque las fechas son relativas a hoy). Opcional: deja abierto el formulario de «nueva visita» a medias para enseñar que se crean citas.
- **Qué debe verse:** rejilla semanal con visitas, llamadas y firmas en distintos colores por tipo.
- **Por qué vende:** transmite operativa real y la promesa de sincronización con Google Calendar.
- **Nombre de archivo:** `08-calendar-week.png`

### 9. Asistente IA demo
- **Pantalla:** copiloto.
- **Ruta:** `/assistant`
- **Qué preparar antes:** envía 1-2 mensajes de ejemplo para que se vea una conversación («prepara una cita con…», «haz una propuesta para…»). Que se vean burbujas de chat y, si aparece, una acción preparada para confirmar.
- **Qué debe verse:** conversación con el asistente, badge «Asistente IA», y idealmente una acción preparada (cita/propuesta) lista para confirmar.
- **Por qué vende:** es el factor diferencial moderno. Posiciona el producto como «CRM con IA», no como una agenda más.
- **Nombre de archivo:** `09-assistant-ai.png`

### 10. Settings modo demo
- **Pantalla:** configuración.
- **Ruta:** `/settings`
- **Qué preparar antes:** vista principal de settings. Asegúrate de que **no** se vea ninguna sección técnica interna (las internas están ocultas por defecto; no actives flags internos).
- **Qué debe verse:** badge **«Modo demo»**, secciones de configuración (integraciones, equipo, vertical) presentadas de forma limpia.
- **Por qué vende:** transmite que es configurable y que se conecta a las herramientas del cliente; refuerza «se adapta a vosotros».
- **Nombre de archivo:** `10-settings-demo.png`

---

## Extras opcionales (si quieres un set más rico)

- **Crear visita en calendario (en acción):** el formulario de nueva cita abierto → `11-calendar-create.png`. Vende la interactividad.
- **Mover oportunidad de etapa (toast «Modo demo»):** captura el momento del cambio → `12-pipeline-move.png`.
- **Vista móvil del dashboard:** redimensiona a ~390px de ancho (responsive) → `13-dashboard-mobile.png`. Útil si vendes el uso desde el móvil del comercial.

---

## Checklist rápida antes de mandar las capturas

- [ ] ¿Mismo zoom y misma resolución en todo el set?
- [ ] ¿Sin barra de favoritos, sin extensiones, sin avatar personal?
- [ ] ¿Sin consola, sin terminal, sin código de fondo?
- [ ] ¿Sin rutas internas raras ni parámetros largos en la URL?
- [ ] ¿Sin nada de `.env`/secrets a la vista?
- [ ] ¿Badge «Modo demo» visible donde aplica (no parece producción falsa)?
- [ ] ¿Fechas frescas (capturado el mismo día)?
- [ ] ¿Archivos nombrados `01-...` a `10-...` en `/sales-assets/demo-v1/screenshots/`?
