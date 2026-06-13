# Guion de reunión comercial — CRM Inmobiliario

> Guion práctico para reuniones de venta (presencial o videollamada) con inmobiliarias.
> Demo de referencia: **tag `demo-v1`** → commit `ca04af9`.
> Complementa: [DEMO_V1_SALES_GUIDE.md](DEMO_V1_SALES_GUIDE.md) (guiones de 5/12 min) · [SALES_PACKAGE_PRICING.md](SALES_PACKAGE_PRICING.md) · [SALES_OBJECTIONS.md](SALES_OBJECTIONS.md)

---

## Antes de la reunión

Checklist de preparación (5 minutos antes):

- [ ] **Abrir la demo** — local (`http://localhost:3000`) o la URL de Vercel. Tenerla ya cargada.
- [ ] **Comprobar el login demo** — pulsar «Ver demo inmobiliaria» y confirmar que entra y carga el dashboard. Que no te pille un fallo en directo.
- [ ] **Navegador limpio** — incógnito, sin barra de favoritos, zoom 100%, una sola pestaña.
- [ ] **Screenshots a mano** — por si falla internet o quieres dejar material (carpeta `/sales-assets/demo-v1/screenshots/`).
- [ ] **Preparar tus preguntas** de descubrimiento (abajo). Llévalas apuntadas.
- [ ] **NO abrir** código, terminal, `.env`, ni paneles técnicos. Nada que no sea la app.
- [ ] **Tener el guion de 5 min** fresco (de [DEMO_V1_SALES_GUIDE.md](DEMO_V1_SALES_GUIDE.md)) por si hay poco tiempo.
- [ ] **Saber el pricing** orientativo de memoria (Starter/Pro/Premium) por si preguntan.
- [ ] **Móvil cargado** si vas a enseñar la versión móvil del dashboard.

---

## Preguntas de descubrimiento

> Pregunta **primero**, enseña **después**. Cada respuesta del cliente es munición: te dice qué pantalla enseñar y con qué frase. Escucha más de lo que hablas en esta parte.

- **¿De dónde os entran los leads?** (Idealista, Fotocasa, web, Instagram, recomendaciones, WhatsApp directo…)
- **¿Cómo hacéis el seguimiento de un lead desde que entra hasta que firma?**
- **¿Cuántas visitas o leads diríais que se os pierden al mes por falta de seguimiento?**
- **¿Qué usáis hoy: Excel, WhatsApp, algún CRM, papel?**
- **¿Quién asigna los leads a cada comercial? ¿Cómo?**
- **¿Cómo sabéis qué comercial ha seguido a qué cliente y en qué punto está?**
- **¿Qué pasa con los leads fríos? ¿Alguien los recupera o se quedan ahí?**
- **¿Tenéis propiedades duplicadas o desactualizadas entre portales/Excel/equipo?**
- **¿Qué tareas os gustaría automatizar si pudierais?**
- **¿Qué es lo que más tiempo os consume cada día y menos os gusta hacer?**

Cierre del descubrimiento (puente a la demo):
> *«Vale, me queda claro. Justo lo que me cuentas —[repite su dolor principal]— es lo que te voy a enseñar cómo se resuelve. Mira esto.»*

---

## Guion de demo en vivo

> Paso a paso con **frases exactas** que puede decir Oier. Adapta el orden a lo que el cliente haya marcado como dolor en el descubrimiento.

### 1) Login demo
*(Pulsar «Ver demo inmobiliaria».)*
> *«Esto es la aplicación real funcionando, con datos de una inmobiliaria de ejemplo. Entro en modo demo de un clic.»*

### 2) Dashboard
> *«Esta es la foto de tu negocio cada mañana: clientes activos, cuánto dinero tienes en juego en el pipeline, las visitas de esta semana y lo que no se puede caer hoy. De un vistazo sabes dónde estás. Imagina esto en vez de cinco WhatsApps y un Excel.»*

### 3) Cliente / Ficha 360
*(Entrar en un cliente.)*
> *«Cada cliente es una ficha viva: sus datos, qué piso le interesa, las conversaciones, las visitas, las facturas… Cualquiera de tu equipo abre esto y en diez segundos sabe por dónde va. Esto es memoria de empresa: si mañana cambia el comercial, el cliente no se va con él.»*

### 4) Pipeline
> *«Este es tu embudo de ventas. Cada tarjeta es una oportunidad real de dinero, y la mueves según avanza: de lead frío a visita, a oferta, a la firma. Aquí ves de golpe cuántas operaciones tienes vivas y cuáles llevan demasiado tiempo paradas.»*

### 5) Propiedades
*(Pestaña Propiedades.)*
> *«Tu cartera ordenada: qué tienes en venta, en alquiler, reservado o vendido, con precio y estado. Se acabó buscar en carpetas de fotos o preguntar si un piso sigue disponible.»*

### 6) Calendario
*(Crear una visita en directo, editarla, borrarla.)*
> *«Las visitas y llamadas de la semana en una agenda. Mira, creo una visita aquí mismo… la cambio… la quito. Cuando lo conectemos a vuestro Google Calendar, lo que pongas aquí aparece en el móvil del comercial y al revés. Cero solapamientos.»*

### 7) Assistant
*(Lanzar una petición al copiloto.)*
> *«Y este es el copiloto. Le hablas normal —"prepárame una cita con este cliente"— y te deja la acción lista para que tú solo confirmes. La idea es que el equipo dedique el tiempo a vender, no a teclear.»*
*(Honestidad que genera confianza:)*
> *«En la demo las respuestas son de ejemplo. En tu proyecto va conectado de verdad a tus datos, con permisos y con confirmación humana antes de hacer nada.»*

### 8) Futuras automatizaciones
> *«Todo esto se puede automatizar: recordatorios de seguimiento, respuestas a leads nuevos, avisos cuando una operación se queda parada… Empezamos por lo esencial y vamos sumando automatizaciones según lo que más os ahorre tiempo.»*

### 9) Cierre de la demo
> *«Resumiendo: dejas de perder leads, profesionalizas el seguimiento, proteges el conocimiento de tu empresa y empiezas a automatizar. Lo que has visto es la base; el siguiente paso es montarlo con tus datos y tu WhatsApp.»*

---

## Cierre de reunión

> El objetivo de la reunión NO es cerrar la venta a la primera: es **detectar interés** y **dejar un siguiente paso concreto agendado**.

Cómo cerrar:
- **Detecta el nivel de interés** con una pregunta directa:
  > *«¿Esto encajaría con cómo trabajáis? ¿Te ves usándolo con tu equipo?»*
- **Propón un piloto / siguiente paso** según el interés:
  > *«Te propongo que arranquemos con una implantación inicial con vuestros datos: clientes, propiedades y pipeline funcionando en un par de semanas. Empezamos acotado y crecemos.»*
- **Pide los datos / accesos mínimos** para preparar presupuesto realista:
  > *«Para pasarte una propuesta ajustada, necesito saber cuántos comerciales sois y enseñarme cómo tenéis hoy los clientes y las propiedades (aunque sea el Excel).»*
- **Vende el pack adecuado** (normalmente Starter o Pro):
  > *«Por lo que me cuentas, el pack [Starter/Pro] es lo que mejor encaja. Te lo detallo en la propuesta.»*
- **Agenda el siguiente contacto, con fecha:**
  > *«¿Te va bien que te mande la propuesta esta semana y la vemos juntos el [día]?»*
- **Deja claro el siguiente paso** antes de despedirte. Nunca termines con un «ya te diré».

Si hay dudas u objeciones: ver [SALES_OBJECTIONS.md](SALES_OBJECTIONS.md).

---

## Después de la reunión

Checklist (mismo día o día siguiente):

- [ ] **Enviar un resumen** breve de lo hablado (refuerza que escuchaste su dolor).
- [ ] **Enviar la propuesta** con pack, precio orientativo (setup + mensual) y alcance.
- [ ] **Pedir confirmación / siguiente paso** con fecha concreta.
- [ ] **Preparar el presupuesto detallado** si pidieron algo a medida.
- [ ] **Registrar las objeciones** que surgieron (para mejorar el pitch y alimentar [SALES_OBJECTIONS.md](SALES_OBJECTIONS.md)).
- [ ] **Anotar los datos** que te dieron (nº comerciales, fuentes de leads, herramientas) — son la base del onboarding.

---

## Mensaje de follow-up

### Versión corta (WhatsApp)
> Hola [Nombre] 👋 Gracias por el rato de hoy. Te resumo: con el CRM dejáis de perder leads, centralizáis clientes y propiedades, y automatizáis el seguimiento. Te paso la propuesta con las opciones para [nombre inmobiliaria]. ¿Te llamo el [día] para verla juntos? 🙌

### Versión email (profesional)
> **Asunto:** Propuesta CRM para [Nombre inmobiliaria]
>
> Hola [Nombre],
>
> Gracias por tu tiempo en la reunión de hoy. Como hablamos, el objetivo es claro: que **ningún lead se os quede sin seguimiento** y que tengáis clientes, propiedades y visitas centralizados, con el equipo trabajando sobre la misma información.
>
> Te resumo lo que vimos en la demo:
> - **Dashboard** con la foto de vuestro negocio cada mañana.
> - **Ficha 360** de cada cliente (datos, conversaciones, visitas, facturas).
> - **Pipeline** de oportunidades por etapas.
> - **Cartera de propiedades** ordenada.
> - **Calendario** de visitas (sincronizable con Google Calendar).
> - **Asistente IA** que prepara acciones y os ahorra trabajo repetitivo.
>
> Adjunto/abajo te detallo la propuesta para [inmobiliaria] con el alcance y la inversión (setup + mantenimiento mensual). Empezamos acotado para tener resultados rápido y vamos creciendo.
>
> ¿Te viene bien que lo veamos juntos el **[día/hora]**?
>
> Un saludo,
> [Oier] — [contacto]

> Recuerda: en el follow-up **no prometas** WhatsApp/IA/persistencia como si ya funcionaran. Vende el proyecto, no humo. (Ver «Qué NO prometer» en [DEMO_V1_SALES_GUIDE.md](DEMO_V1_SALES_GUIDE.md).)
