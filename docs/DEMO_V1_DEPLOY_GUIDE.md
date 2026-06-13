# Deploy temporal de demo-v1 en Vercel

> ⚠️ **Esta guía NO ejecuta ningún deploy.** Son los pasos para que **Oier** lo haga cuando lo decida.
> Versión a desplegar: **tag `demo-v1`** → commit `ca04af9`.
> Stack: **Next.js 16.2.4 · React 19 · Tailwind 4**. Build: `next build`.
> Documentos hermanos: [DEMO_V1_SALES_GUIDE.md](DEMO_V1_SALES_GUIDE.md) · [DEMO_V1_SCREENSHOTS.md](DEMO_V1_SCREENSHOTS.md)

---

## Resumen en una frase

La demo es **100% offline** (funciona vía `localStorage`), así que **NO necesita ninguna variable de entorno obligatoria** para desplegarse y enseñarse. Eso hace el deploy trivial: importar el repo en Vercel, framework Next.js, deploy. Sin Supabase, sin secrets.

---

## Antes de empezar (importante)

- ✅ La demo funciona **sin** Supabase, sin OpenAI, sin Meta, sin Google. No configures **ninguna** de esas variables para la demo de venta.
- ❌ **NO** metas el Supabase antiguo ni el `.env.local` viejo en Vercel. No se reutiliza nada de la infraestructura anterior.
- ❌ **NO** subas secrets a Vercel para esta demo. No hacen falta y solo añaden riesgo.
- ✅ Empieza siempre por un deploy **Preview privado**. Solo si necesitas un enlace estable para una reunión, promociónalo o pon dominio temporal.
- ℹ️ El repo ya hace `build` verde en local (`npm run build`), así que Vercel debería compilar sin sorpresas.

---

## Opción A — Deploy desde GitHub `main`

**Cuándo usarla:** quieres lo más rápido y no te importa que la URL refleje los cambios futuros de `main`.

**Ventajas**
- Lo más rápido de configurar. Vercel detecta el repo y cada push a `main` redeploya solo.
- Cero fricción: «conectar y listo».

**Riesgo**
- `main` **seguirá cambiando** (Fase 2 y siguientes). Cuando empieces a conectar Supabase real, la URL de demo podría empezar a pedir variables o cambiar de comportamiento. La URL de venta dejaría de ser «la demo congelada».

**Pasos en Vercel**
1. Entra en [vercel.com](https://vercel.com) → **Add New… → Project**.
2. **Import Git Repository** → selecciona `iazticontact/crm-inmobiliario-demo`.
3. **Framework Preset:** Vercel detectará **Next.js** automáticamente. Déjalo así.
4. **Build & Output Settings** (déjalos por defecto; solo verifica):
   - Build Command: `next build` (o «Next.js default»).
   - Output Directory: por defecto de Next.js (no lo cambies, no pongas `out/`).
   - Install Command: `npm install` (por defecto).
5. **Environment Variables:** **NINGUNA** (deja la sección vacía). La demo es offline.
6. **Production Branch:** `main`.
7. Pulsa **Deploy** y espera a que termine.

---

## Opción B — Deploy congelado desde el tag `demo-v1` (recomendado para venta)

**Cuándo usarla:** quieres una **URL de demo estable** que NO cambie aunque sigas trabajando en `main`. Es la opción correcta para material comercial.

**Ventajas**
- Versión **fija** de venta: la URL siempre muestra exactamente `demo-v1` (commit `ca04af9`).
- No se rompe ni cambia cuando arranques Fase 2 en `main`.

**Riesgo / coste**
- Configuración algo más manual: Vercel despliega ramas, no tags directamente. Hay que apuntar el deploy de producción a algo fijo.

**Estrategia recomendada: crear una rama de release desde el tag.**

Vercel sigue ramas de Git, no tags. La forma limpia de «congelar» es crear una rama que apunte al tag y desplegar esa rama como producción:

> Estos comandos los ejecuta **Oier** cuando quiera (no se ejecutan en esta fase). Crean una rama de solo-release; **no** tocan `main`.

```bash
# Crear una rama de release anclada al tag demo-v1
git checkout -b release/demo-v1 demo-v1

# Subirla a GitHub (NO es force push, es una rama nueva)
git push -u origin release/demo-v1

# Volver a main para seguir trabajando con normalidad
git checkout main
```

Luego en Vercel:
1. **Add New… → Project** → importa `iazticontact/crm-inmobiliario-demo` (si ya lo importaste en la Opción A, puedes usar el mismo proyecto y cambiar la Production Branch, o crear un proyecto separado «crm-demo-v1» para no mezclar).
2. **Framework Preset:** Next.js (auto-detectado).
3. **Production Branch:** `release/demo-v1` (en lugar de `main`).
4. **Environment Variables:** **NINGUNA**.
5. **Deploy.**

Como `release/demo-v1` no recibirá más commits, la URL de producción de ese proyecto queda **congelada** en la demo vendible. Cuando saques `demo-v2` en el futuro, repites el patrón con una rama `release/demo-v2`.

> Alternativa sin rama: en cada deploy manual podrías hacer `git checkout demo-v1` y desplegar con la **Vercel CLI** (`vercel --prod`) desde ese estado. Funciona, pero es más manual y propenso a olvidos. La rama de release es más robusta.

---

## Variables de entorno necesarias para la demo offline

**Ninguna es obligatoria.** Para la demo de venta, deja Vercel **sin variables**.

Referencia (NO configurar para la demo; es solo contexto de qué existe para la versión real — ver [`.env.example`](../.env.example)):

| Variable | Para qué | ¿Demo la necesita? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `..._PUBLISHABLE_KEY` | Base de datos real | ❌ No |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend (solo servidor) | ❌ No — **nunca** en la demo |
| `OPENAI_API_KEY` | Asistente IA real | ❌ No |
| `META_*`, `NOWCRM_WEBHOOK_SECRET` | WhatsApp real | ❌ No |
| `N8N_*` | Automatizaciones reales | ❌ No |
| `GOOGLE_*` | Google Calendar real | ❌ No |
| `AGENT_TOOL_SECRET` | Endpoint server-to-server | ❌ No |

> ⚠️ Si en el futuro despliegas la versión **real** (Fase 2), esas variables sí se configuran en Vercel → Settings → Environment Variables, **nunca** en el código ni en el repo. Para la demo: cero.

**¿Y si el build de Vercel se queja de variables al importar módulos?**
- El código está escrito para **degradar a vacío** cuando Supabase no está configurado (los helpers devuelven arrays vacíos), así que el build no debería requerir envs. El `npm run build` ya pasa en local sin `.env.local` cargado para la ruta offline.
- Si aun así Vercel fallara el build por una variable concreta, **documenta el error exacto** (no inventes valores): anótalo y se revisa. La solución correcta sería un valor placeholder vacío, **nunca** un secret real ni el Supabase antiguo.

---

## Cómo probar la URL desplegada

Cuando Vercel te dé la URL (algo como `https://crm-inmobiliario-demo-xxxx.vercel.app`):

1. Ábrela y ve a **`/login`**.
2. Pulsa **«Ver demo inmobiliaria»**.
3. Recorre la checklist visual completa (la de Fase 1J / [DEMO_V1_SALES_GUIDE.md](DEMO_V1_SALES_GUIDE.md)):
   - Dashboard, Clientes, Ficha 360, Pipeline, Propiedades, Expedientes, Calendario (crear/editar/borrar visita), Asistente, Settings, Logout.
4. Verifica que **no** aparezca ningún error técnico ni marca antigua, y que el badge **«Modo demo»** se vea donde corresponde.

---

## Riesgos y cosas a tener en cuenta

- **`localStorage` es por navegador y por dispositivo.** El «modo demo» se activa con una marca en el navegador de quien la abre. Si enseñas la demo en el portátil de un cliente, el flag vive en su navegador, no en el tuyo. Normal y esperado.
- **Los cambios de demo son efímeros.** Crear una visita, mover una oportunidad, editar notas: todo desaparece al **refrescar** la página. Es a propósito (es una muestra offline). No lo vendas como persistencia.
- **No es producción.** Es una demo de venta. No metas datos reales de un cliente en ella.
- **Si Vercel exige envs por imports:** documenta el mensaje exacto y trátalo con placeholders vacíos, nunca con secrets reales (ver sección anterior).
- **Coste:** un Preview/Hobby de Vercel es gratuito para esto. No necesitas plan de pago para enseñar la demo.

---

## Recomendaciones de despliegue

1. **Primero, Preview privada.** Haz un deploy y prueba la URL tú solo antes de enseñarla a nadie.
2. **Para venta, usa la Opción B** (rama `release/demo-v1`) para que la URL no cambie cuando arranques Fase 2.
3. **Dominio temporal solo si hace falta.** Si necesitas una URL bonita para una reunión importante, asígnale un subdominio en Vercel (p. ej. `demo.tudominio.com`). Para el día a día, la URL `*.vercel.app` sirve.
4. **No toques `vercel.json`.** El proyecto no necesita configuración especial; Next.js se auto-detecta. (A día de hoy el repo no tiene `vercel.json`, y no hace falta crearlo.)
5. **Una demo, un propósito.** Mantén el proyecto de demo separado del futuro proyecto real en Vercel para no mezclar configuraciones ni variables.
