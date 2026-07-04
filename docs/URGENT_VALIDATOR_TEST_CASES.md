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

## Señales de fallo (reportar)
- El Asistente dice "no puedo acceder a los clientes/cartera" con datos existentes.
- "Y el de Malasaña?" no filtra o pierde el contexto.
- No se pueden poner m²/habitaciones/baños al editar un inmueble.
- Se ve un UUID, SQL, o un error técnico crudo.
