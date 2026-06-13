# CRM Inmobiliario Demo — Guía comercial demo-v1

> Versión congelada: **tag `demo-v1`** → commit `ca04af9`.
> Esta guía es para **enseñar y vender** la demo, no para desarrollar.
> Documentos hermanos: [DEMO_V1_SCREENSHOTS.md](DEMO_V1_SCREENSHOTS.md) · [DEMO_V1_DEPLOY_GUIDE.md](DEMO_V1_DEPLOY_GUIDE.md) · [HANDOFF_CURRENT_STATE.md](HANDOFF_CURRENT_STATE.md)

---

## Objetivo de la demo

La demo es un **CRM inmobiliario offline** que se enseña a una inmobiliaria para que **vea con sus propios ojos** cómo sería su día a día con un CRM hecho a su medida: clientes, propiedades, pipeline de ventas, visitas en calendario, un asistente de IA y la base para automatizar WhatsApp y tareas repetitivas.

No es un PowerPoint ni un vídeo: es la aplicación real funcionando. El cliente **toca, navega y entiende** en 5 minutos lo que tardaría media hora en explicarse con palabras.

Funciona **sin conexión a ningún servidor**: todo lo que se ve son datos de muestra de una inmobiliaria ficticia coherente. Eso permite enseñarla en cualquier reunión, sin internet fiable, sin riesgo de mostrar datos reales de nadie y sin depender de que «la nube» esté disponible ese día.

**Para qué sirve comercialmente:**
- Romper el hielo y generar el «ajá, esto es justo lo que necesito».
- Pasar de vender una idea abstracta a vender algo que ya existe.
- Recoger feedback concreto del cliente sobre su operativa real.
- Cerrar el siguiente paso: un proyecto a medida conectado a sus datos.

---

## Qué problema resuelve

Las inmobiliarias pequeñas y medianas viven con dolores muy concretos. La demo está construida para tocar cada uno de ellos:

- **Leads que se pierden.** Entran contactos por portales, web, Instagram y WhatsApp, pero nadie centraliza ni hace seguimiento. El lead se enfría y se va a la competencia.
- **WhatsApp desordenado.** Todo el negocio pasa por el móvil de uno o dos comerciales. Si esa persona se va de vacaciones o de la empresa, se va el cliente con ella.
- **Visitas sin seguimiento.** Se enseña un piso y luego nadie llama. No hay recordatorios, no hay siguiente paso, no hay trazabilidad de qué pasó después de la visita.
- **Propiedades dispersas.** La cartera está en Excel, en la cabeza del jefe, en un portal y en fotos sueltas. Nadie tiene la foto completa de qué hay disponible y en qué estado.
- **Comerciales sin trazabilidad.** El dueño no sabe quién está trabajando qué lead, en qué fase está cada operación ni por qué se cae una venta.
- **Cero automatización.** Tareas repetitivas (responder el mismo mensaje, recordar una llamada, preparar una propuesta) consumen horas que deberían dedicarse a vender.
- **Dependencia de Excel + WhatsApp + memoria.** Funciona… hasta que crece el volumen o se va una persona clave. No escala y no es defendible.

La demo enseña el **antídoto**: un sitio único donde el lead entra, se cualifica, se le hace seguimiento, se agenda la visita, se mueve por el pipeline y queda registrado todo lo que pasa — con un asistente que ayuda y, más adelante, automatizaciones reales.

---

## Qué enseña la demo

Pantallas disponibles (todas funcionan offline):

- **Login demo** — punto de entrada con el botón «Ver demo inmobiliaria».
- **Dashboard** — KPIs del negocio, pipeline resumido, leads, agenda de la semana y tareas pendientes.
- **Clientes** — listado de la cartera de contactos con estado y canal de entrada.
- **Ficha 360** — vista completa de un cliente: datos, oportunidades, propiedades de interés, actividad reciente, conversaciones, facturas y visitas, todo en un sitio.
- **Pipeline / Oportunidades** — embudo comercial por etapas (nuevo → contactado → cualificado → visita → oferta → negociación → ganado).
- **Propiedades** — cartera de inmuebles con tipo, operación, estado y precio.
- **Expedientes** — gestión de la documentación y los trámites de cada operación (venta, hipoteca, tasación…).
- **Calendario** — agenda semanal con visitas, llamadas y firmas; se pueden crear/editar/borrar eventos en la propia demo.
- **Asistente IA (demo)** — un copiloto que entiende peticiones del comercial y prepara acciones (citas, propuestas, tareas).
- **Settings / modo demo** — panel de configuración con el distintivo «Modo demo» visible.

---

## Guion de demo de 5 minutos

> Tono: cercano, seguro, orientado a su negocio. No tecnicismos. Habla de **leads, visitas y ventas**, no de «tablas» o «componentes».

**0:00 — Entrada (15s)**
> «Te voy a enseñar cómo sería tu CRM por dentro. Es la aplicación real funcionando, con datos de ejemplo de una inmobiliaria. Mira esto un momento.»
*(Login → pulsar «Ver demo inmobiliaria».)*

**0:15 — El problema (30s)**
> «Ahora mismo, ¿dónde están tus leads? ¿En el WhatsApp de tu comercial, en un Excel, en la cabeza de alguien? El problema no es captar; es que se te escapan después. Esto resuelve justo eso.»

**0:45 — Dashboard (45s)**
> «Esta es la foto de tu negocio cada mañana: cuántos clientes activos, cuánto tienes en juego en el pipeline, qué visitas hay esta semana y qué tienes pendiente hoy. De un vistazo sabes dónde está el dinero y qué no se puede caer.»

**1:30 — Cliente / Ficha 360 (60s)**
> «Entramos en un cliente. Aquí lo tienes todo: sus datos, qué piso le interesa, las conversaciones que has tenido, las visitas, las facturas… Cualquiera de tu equipo abre esto y en 10 segundos sabe por dónde va la operación. Se acabó el "déjame que pregunte a Juan".»

**2:30 — Pipeline (45s)**
> «Este es tu embudo de ventas. Cada tarjeta es una oportunidad real de dinero. La mueves de fase según avanza: de un lead frío a una visita, a una oferta, a la firma. De golpe ves cuántas operaciones tienes vivas y en qué punto está cada una.»

**3:15 — Propiedad (30s)**
> «Tu cartera de inmuebles, ordenada: qué tienes en venta, en alquiler, reservado o vendido, con su precio y su estado. Nada de buscar en carpetas de fotos.»

**3:45 — Calendario (30s)**
> «Las visitas y llamadas de la semana, en una agenda. Mira: puedo crear una visita aquí mismo. Esto luego se conecta a tu Google Calendar para que no se te solape nada.»

**4:15 — Asistente IA (30s)**
> «Y esto es el copiloto. Le pides cosas en lenguaje normal —"prepárame una cita con este cliente"— y te deja la acción lista para confirmar. La idea es que el equipo dedique el tiempo a vender, no a teclear.»

**4:45 — Cierre comercial (15s)**
> «Esto que ves es una demo con datos de ejemplo. El siguiente paso es montarlo con **tus** clientes, **tu** cartera y **tu** WhatsApp. ¿Te encaja que preparemos una propuesta para tu inmobiliaria?»

---

## Guion de demo de 12 minutos

> Versión para reuniones serias con decisor. Misma narrativa, más profundidad y más espacio para que el cliente hable.

**1) Apertura y contexto (1 min)**
Pregunta primero, enseña después:
> «Antes de enseñarte nada: ¿cómo gestionáis hoy los clientes y las visitas? ¿Cuántos comerciales sois? ¿Qué pasa cuando entra un lead un domingo por la noche?»
Escucha. Sus respuestas son tu guion: vas a enseñar la pantalla que resuelve cada cosa que mencione.

**2) Login y entrada (30s)**
> «Esto es la aplicación real, con datos de una inmobiliaria de ejemplo. Entro en modo demo.»
*(Botón «Ver demo inmobiliaria».)*

**3) Dashboard — la foto del negocio (1,5 min)**
Recorre KPIs, pipeline resumido, agenda y tareas.
> «Imagina abrir esto cada mañana en lugar de cinco WhatsApps y un Excel. Aquí ves clientes activos, dinero en el pipeline, las visitas de la semana y lo que no se puede caer hoy.»
Conecta con su dolor:
> «¿Cuántas veces se te ha pasado llamar a alguien que estaba a punto de comprar?»

**4) Clientes y Ficha 360 (2 min)**
Abre el listado, filtra mentalmente, entra en una ficha.
> «Cada cliente es una ficha viva. Datos, qué busca, qué le has enseñado, las conversaciones, las visitas, las facturas. Esto es memoria de empresa: aunque mañana cambie el comercial, el cliente no se pierde.»
Punto fuerte:
> «Esto es lo que te protege si un comercial se va: el conocimiento se queda en la empresa, no en su móvil.»

**5) Pipeline / Oportunidades (2 min)**
Recorre las etapas y mueve una oportunidad.
> «Cada operación viaja por fases. Un vistazo y sabes cuántas ventas tienes vivas, cuáles están calientes y cuáles llevan paradas demasiado tiempo. Aquí es donde el dueño ve la verdad de su negocio.»
Pregunta de cualificación:
> «¿Cuántas operaciones abiertas dirías que tienes ahora mismo? ¿Sabrías decírmelo sin mirar?»

**6) Propiedades y Expedientes (1,5 min)**
> «Tu cartera ordenada por tipo, operación y estado. Y los expedientes: la parte aburrida pero crítica —documentación, hipoteca, tasación— con su responsable y su vencimiento, para que ningún trámite frene una firma.»

**7) Calendario (1,5 min)**
Crea una visita en directo, edítala, bórrala.
> «La agenda del equipo. Creo una visita… la cambio… la quito. Cuando lo conectemos a tu Google Calendar, lo que pongas aquí aparece en el móvil de tu comercial y al revés. Cero visitas solapadas, cero "se me olvidó".»

**8) Asistente IA (1,5 min)**
Lanza un par de peticiones al copiloto.
> «Esto es lo que marca la diferencia. Le hablas normal: "prepara una cita", "haz una propuesta para este cliente". Él deja la acción lista y tú solo confirmas. No es un chatbot tonto: trabaja sobre tus datos.»
Honestidad (genera confianza):
> «En la demo las respuestas son de ejemplo. En tu proyecto real va conectado de verdad a tu información, con permisos y con confirmación humana antes de hacer nada.»

**9) Settings y modo demo (30s)**
> «Y aquí la configuración: integraciones, equipo, verticales. Fíjate que pone "Modo demo": es la señal de que esto es una muestra. En tu versión, esto se conecta a tus cuentas.»

**10) Cierre y siguiente paso (1 min)**
Resume en su idioma:
> «Resumiendo: dejas de perder leads, profesionalizas el seguimiento, proteges el conocimiento de tu empresa y empiezas a automatizar. Lo que has visto es la base; el siguiente paso es montarlo con tus datos y tu WhatsApp. ¿Lo preparamos?»

---

## Frases comerciales útiles

Para tener en la recámara durante la demo:

- «Aquí no solo guardas contactos; **gestionas oportunidades reales de venta**.»
- «El objetivo es que **ningún lead se quede sin seguimiento**.»
- «Esto se conecta después a **vuestro WhatsApp, vuestro calendario y vuestros datos reales**.»
- «La demo es offline, pero **el proyecto real se conecta a vuestra operativa**.»
- «Esto es **memoria de empresa**: si se va un comercial, el cliente no se va con él.»
- «El pipeline es donde el dueño ve **la verdad** de su negocio, sin que nadie se la maquille.»
- «No vendemos software genérico; **lo adaptamos a cómo trabajáis vosotros**.»
- «La IA no decide sola: **prepara y tú confirmas**. Tú mandas.»
- «Empezamos pequeño y sólido, y crecemos cuando lo veas claro.»
- «Lo que ahorras no es tiempo de teclear: es **ventas que hoy se te escapan**.»

---

## Qué NO prometer todavía

> Esto es lo más importante de la guía. La honestidad cierra ventas y evita problemas después. **No prometas lo que aún no está conectado.**

- ❌ **No prometer WhatsApp real** hasta integrar Meta. En la demo es una muestra; el envío/recepción real requiere conectar la cuenta de WhatsApp Business del cliente.
- ❌ **No prometer IA real completa** hasta conectar OpenAI y las tools reales. En la demo el asistente da respuestas de ejemplo; no está leyendo datos reales ni ejecutando acciones de verdad.
- ❌ **No prometer que la demo guarda los cambios.** Lo que se crea/edita en la demo es **efímero**: al refrescar el navegador desaparece. Es a propósito (es una muestra). La persistencia llega con la versión real conectada a base de datos.
- ❌ **No decir que ya está conectado al Supabase nuevo.** La base de datos real (Fase 2) todavía no existe; está planificada, no construida.
- ❌ **No decir que está en producción.** Es una demo de venta, no un producto desplegado y operativo con clientes reales.
- ❌ **No dar fechas cerradas de entrega** sin haber dimensionado el proyecto. Di «lo dimensionamos juntos» en vez de inventar un plazo.

Forma honesta y vendedora de decirlo:
> «Lo que ves hoy es la base real funcionando. Lo que falta es conectarlo a **tus** datos y **tus** cuentas — eso es exactamente el proyecto que te propongo.»

---

## Cómo responder a preguntas típicas del cliente

> Respuestas honestas y profesionales. Nunca prometas de más; convierte cada pregunta en un puente al siguiente paso.

**¿Esto se conecta a WhatsApp?**
> «Sí, está diseñado para conectarse a vuestro WhatsApp Business a través de la API oficial de Meta. En la demo lo ves como muestra; en vuestro proyecto se integra de verdad para que las conversaciones entren directas al CRM.»

**¿Puede leer nuestros clientes reales?**
> «Esa es justo la idea del proyecto: partimos de vuestros datos reales —clientes, cartera, histórico— y los traemos al CRM. La demo lleva datos de ejemplo para no mezclar nada vuestro hasta que arranquemos formalmente.»

**¿Puede crear citas?**
> «Sí. En la demo ya ves cómo se crean y editan visitas en el calendario. En la versión real eso se sincroniza con vuestro Google Calendar y, con el asistente, se pueden preparar citas hablándole en lenguaje normal.»

**¿Cuánto tarda en implantarse?**
> «Depende del tamaño de vuestra cartera y de cuántas integraciones queráis desde el día uno. Lo honesto es dimensionarlo juntos: arrancamos con lo esencial funcionando rápido y vamos sumando. No te voy a dar una fecha al aire.»

**¿Esto sustituye a nuestro Excel?**
> «Lo sustituye y lo mejora. El Excel no te avisa de un lead que se enfría, no guarda las conversaciones y no lo puede usar todo el equipo a la vez sin pisarse. Esto sí. Y migramos vuestro Excel actual como punto de partida.»

**¿Se puede personalizar?**
> «Totalmente. No es un producto cerrado: se adapta a cómo trabajáis —vuestras fases de venta, vuestros tipos de inmueble, vuestros campos. La base es esta; el traje se hace a vuestra medida.»

**¿Tiene IA real?**
> «La arquitectura para IA real está montada: un asistente que lee vuestros datos con permisos y prepara acciones que un humano confirma. En la demo es una muestra; conectarlo de verdad (con OpenAI y acceso seguro a vuestros datos) es parte del proyecto.»

**¿Dónde se alojan los datos?**
> «En una base de datos profesional en la nube (Supabase/PostgreSQL), con aislamiento por empresa: vuestros datos solo los véis vosotros. Seguridad a nivel de fila desde el primer día. La demo no guarda nada porque es una muestra offline.»

**¿Cuánto cuesta?**
> «El precio va según el alcance: número de usuarios, integraciones y personalización. Por eso prefiero dimensionarlo contigo en vez de soltarte un número que no signifique nada. ¿Te preparo una propuesta con un par de opciones?»

**¿Y si somos una inmobiliaria pequeña?**
> «Mejor todavía. Cuanto antes ordenéis esto, más crecéis sin caos. Empezamos con una versión ajustada a vuestro tamaño y vuestro presupuesto, y escala con vosotros. No necesitáis ser grandes para dejar de perder leads.»

---

## Recordatorio de oro

La demo **no se vende sola**: la vendes tú con esta narrativa. La demo es la prueba de que **existe y funciona**. Tu trabajo es conectar cada pantalla con **su** dolor concreto y cerrar el siguiente paso: la propuesta a medida.
