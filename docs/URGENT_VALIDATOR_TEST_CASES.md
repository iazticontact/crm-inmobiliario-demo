# Casos de prueba para validación urgente (P47)

> Guion para que un jefe/validador pruebe el CRM en 15 minutos sin encontrarse fallos básicos.
> Cada caso: **qué hacer → qué debe pasar**. Prueba en ordenador y en móvil.

## Flujo 1 — Acceso
1. Abre la URL de staging → **carga el login** (si da timeout, ver `STAGING_PUBLIC_ACCESS_RUNBOOK.md`).
2. Entra con tu cuenta → **Dashboard** con KPIs.

## Flujo 2 — Asistente · Clientes (P0)
Abre **Asistente IA** y escribe:
- `¿Qué clientes tengo?` → lista los clientes con nombre y email/teléfono + total. **Nunca** "no puedo acceder".
- `Lista de clientes` / `clientes registrados` → misma respuesta.
- `Busca el cliente Javier` → muestra a Javier Ortega Ruiz.
- Si no hubiera clientes → "No hay clientes registrados todavía" (no un error).

> Funciona aunque el cerebro n8n esté caído (layer local, sesión RLS del usuario).

## Flujo 3 — Asistente · Inmuebles / cartera (P0)
- `Dime qué pisos tenemos en cartera` → lista pisos disponibles con precio, zona, operación, m²/habs/baños.
- `Y el de Malasaña?` → mantiene contexto y filtra → **Piso - Avenida San Pedro 66 · Venta · 375.000 € · Madrid/Malasaña · 3 hab · 2 baños · 110 m²**.
- `¿Qué pisos hay con 3 habs, 2 baños y más de 80 m²?` → devuelve el de San Pedro 66 (110 m²). Si no hubiera exactos, muestra los más cercanos.
- `¿Qué inmuebles tienen urgencia por vender?` → el de San Pedro 66 (nota de urgencia).
- `¿Qué propiedades pueden bajar de precio?` → el de San Pedro 66 (dispuesto a bajar hasta 315.000 €).

## Flujo 4 — Cartera (UI)
En **Cartera → Inmuebles**: filtra por localidad/tipo/operación/precio; abre un inmueble; comprueba que se ven precio, zona, tipo, operación, estado, m², habitaciones, baños.

## Flujo 5 — Inmueble en móvil (P0)
1. En móvil, **edita** un inmueble.
2. Verás el bloque **Características** con **Superficie (m²) · Habitaciones · Baños** (teclado numérico, sin zoom al enfocar).
3. Cambia m²/habs/baños y **Guardar** → se persiste.
4. Pregunta al Asistente por ese filtro → aparece.

## Flujo 6 — Comisiones (P46, no regresión)
En **Cartera → Comisiones**: pestañas Por hacer / Facturadas / Cobradas / Potenciales; "Crear factura" → editor sin parpadeo → volver → aparece en Facturadas; marcar cobrada → Cobradas (chip verde "Cerrado").

## Flujo 7 — Facturación
Emite una factura → PDF → "Marcar cobrada" (mensaje "operación cerrada económicamente"). Papelera si procede.

## Flujo 8 — Asistente · resto
- `¿Qué citas tengo esta semana?` → próximas citas.
- `¿Cuánto he facturado este mes?` → remite a Facturación (el Asistente **no** lee facturas).
- Documentos: el Asistente solo da **metadata** (nombre/tipo/fecha), nunca contenido.

## Flujo 9 — Asistente robusto por categorías (P48)
> El Asistente debe entender muchas formas de pedir lo mismo, mantener el hilo y no contradecirse.

**Clientes**
- Listar: `clientes`, `¿qué clientes tengo?`, `muéstrame mis clientes`, `¿cuántos clientes hay?` → misma respuesta.
- Buscar: `busca el cliente Javier` → lo encuentra.
- Confirmar: tras listar, `¿seguro?` / `confírmame` → confirma el resultado anterior (no lo sustituye por un error).

**Inmuebles**
- Listar: `¿qué pisos hay en cartera?`; filtrar por zona: `¿y el de Malasaña?` (mantiene el tema).
- Características: `¿pisos con 3 habs, 2 baños y más de 80 m²?`; pedir alternativas si no hay exactos.

**Operaciones / citas / tareas**
- `mis operaciones abiertas`, `próximas citas`, `tareas pendientes` → responden con datos reales (local-first, sin depender de n8n).

**Comisiones**
- `¿cuánto he comisionado?` → remite a Cartera → Comisiones (control interno).

**Facturación**
- `¿cuánto he facturado?` / `facturas pendientes` → el Asistente **redirige** al módulo Facturación (no lee facturas).

**Ambigüedad**
- Una frase vaga (`y eso?` sin contexto) → pide aclaración (`¿clientes, inmuebles, operaciones o citas?`), nunca un error genérico.

## Flujo 10 — Preguntas sobre capacidades y funcionamiento (P49)
> El Asistente debe distinguir entre **preguntar** y **pedir datos**. Mencionar una entidad no debe disparar un listado.

- **Capacidad**: `¿tienes acceso a los clientes?`, `¿puedes acceder a los trámites?`, `¿qué puedes hacer?` → explica qué puede/no puede, **sin** listar datos.
- **Cómo funciona**: `¿cómo funciona la cartera?`, `¿para qué sirve el módulo de comisiones?` → explica el módulo, **sin** consultar datos.
- **Futuro**: `si creo un cliente nuevo, ¿podrás verlo?` → responde condicional (“en cuanto quede guardado…”), **sin** leer nada ahora.
- **Facturación**: `¿puedes leer las facturas?` → redirige al módulo Facturación (no lee facturas).
- **Contraste (sí lee)**: `muéstrame los clientes`, `¿qué inmuebles hay?`, `¿puedes mostrarme las citas?` → devuelven datos reales.

**No debería pasar:** que una pregunta de capacidad/funcionamiento/futuro conteste con una lista mecánica o un “no puedo acceder”.

## Flujo 11 — El Asistente razona el turno (P50)
> Mencionar una entidad NO debe disparar un listado. Cuando hablas del propio Asistente o lo corriges, no debe volver a consultar datos.

- **Metapregunta**: `¿por qué me listas los clientes?` → explica su interpretación, **no** vuelve a listar.
- **Corrección**: `no me refiero a los inmuebles` → repara y pregunta qué necesitas; **no** repite la lectura.
- **Queja**: `esto está mal, no me ayudas` → se disculpa y pregunta qué esperabas; **no** lista datos.
- **Capacidad/funcionamiento/futuro** (Flujo 10): no listan datos.
- **Contraste (sí lee)**: `muéstrame los clientes`, `¿qué inmuebles hay?` → devuelven datos reales.
- **Traza** (para soporte): en los logs del servidor cada turno registra `[assistant.turn] {turnType, shouldReadData…}`; si `shouldReadData=false` no debe llamarse ningún reader.

**No debería pasar:** que una corrección, queja o metapregunta con una entidad dispare un listado.

## Flujo 12 — Guía de producto (P53)
> El Asistente distingue **aprender** de **consultar datos**. Preguntar por una pantalla no lista datos.

- **Explicar módulo**: `¿qué muestra el dashboard?`, `¿para qué sirve la cartera?`, `explícame los trámites` → explica el módulo (qué es, qué muestra, qué puedes hacer) y **ofrece** mostrar datos; **no** lista nada por su cuenta.
- **Usuario nuevo**: `soy nuevo, ¿por dónde empiezo?` → tour breve por bloques (Clientes/Cartera/Agenda/Facturación) + una pregunta.
- **No entiendo**: `no entiendo` (tras hablar de un módulo) → lo explica más simple, **del mismo tema**, sin listar datos.
- **Navegación**: `¿dónde está la facturación?` → dice dónde está en el menú.
- **Cambio de módulo**: tras listar pisos, `¿qué muestra el dashboard?` → explica el dashboard, **no** vuelve a listar pisos.
- **Contraste (sí lee)**: `muéstrame los clientes`, `¿qué pisos hay en cartera?`, `¿cuántas tareas tengo?` → datos reales.

**No debería pasar:** que «¿qué muestra X?» devuelva un listado, ni que «no entiendo» repita datos.

## Señales de fallo (reportar)
- El Asistente dice "no puedo acceder a los clientes/cartera" con datos existentes.
- "Y el de Malasaña?" no filtra o pierde el contexto.
- No se pueden poner m²/habitaciones/baños al editar un inmueble.
- Se ve un UUID, SQL, o un error técnico crudo.
