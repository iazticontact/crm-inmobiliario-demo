# FASE P4.4 — Ficha cliente 360 final (resumen coherente + operaciones premium)

> **Fecha:** 2026-06-22 · HEAD previo `66321b7`. Solo `/clients/[id]` + docs. **Sin** migraciones,
> sin documentos reales, sin tocar otros módulos. Delete seguro P3.9A intacto. Requiere redeploy.

## 1. Diagnóstico (tras screenshots)
- **Incoherencia clave**: el "Resumen ejecutivo" mostraba **"Perfil: No consta / Interés: No
  consta"** aunque el cliente sí tenía info. **Causa (verificada en BD)**: los 6 clientes
  originales del ejemplo guardan el perfil en el campo **`company`** ("Inversor - atico",
  "Comprador - local"…) con `client_type` vacío; los 3 resembrados tienen `client_type` +
  `city_area`. El resumen solo leía `client_type`/`service_interest` → "No consta".
- **Datos personales/fiscales**: muchas cajas vacías "frías".
- **Documentos**: bloque correcto pero ocupaba mucho para no tener upload.
- **Operaciones**: filas simples, poco comerciales.
- **Expedientes/propiedades vacíos**: empty states grandes y poco explicativos.

## 2. Resumen ejecutivo — coherencia (lo más importante)
Fallbacks para no mostrar "No consta" si hay info derivable de datos ya cargados:
- **Perfil** = `client_type` → **`company`** (subtítulo descriptivo) → `—`.
- **Interés** = `service_interest` → `main_area` → **zona de interés** → **ciudad/zona** → `—`.
Resultado: Roberto Díaz ya muestra **"Inversor - atico"** (no "No consta"); los 3 resembrados
muestran su tipo + zona. El resto de ítems (Operación activa, Próxima cita, Tarea pendiente,
Expediente abierto) ya usaban datos reales.

## 3. Operaciones — cards premium
Las operaciones pasan de **filas simples** a **cards comerciales** (borde + sombra suave):
título destacado + **valor potencial** (negrita) · **probabilidad** · **cierre estimado** +
**badge de etapa** + botón **Editar**. Compacto pero claramente comercial. Botón "Nueva
operación" intacto (funciona). Empty state: "Aún no hay operaciones abiertas… crea una para
empezar el seguimiento comercial."

## 4. Expedientes y trámites
Empty state **compacto y explicativo**: "Sin expedientes abiertos" + "Aquí aparecerán trámites
como documentación, contrato, tasación o financiación." (lenguaje de negocio, no `service_case`).
Orden de la pestaña (P4.3): Operaciones → Expedientes y trámites → Propiedades. Propiedades
vacías → "Sin propiedades vinculadas." (compacto).

## 5. Datos personales/fiscales — empties que receden
`DetailItem`: los campos **vacíos pierden la caja** (borde/fondo transparentes) y muestran un
**"—" discreto**; los campos con dato mantienen su caja y destacan. Se acabaron las "grandes
cajas vacías frías" sin quitar la información.

## 6. Documentos
Reauditado: sigue **sin tabla `public.documents` ni buckets** → **diferido (D1)**, sin upload
falso. El bloque "Documentos y recursos" se hizo **compacto** (card horizontal, no media
columna) con copy honesto: "Centraliza aquí la documentación vinculada: identificación,
contratos, nota simple, reservas y justificantes." Sin botón falso. Roadmap
`docs/CLIENT_DOCUMENTS_ROADMAP.md`.

## 7. Email mailto — confirmado
`mailto:${email}` puro en header de ficha, listado y cards: abre el cliente de correo con el
destinatario, **sin asunto, sin cuerpo, sin plantilla**. Si no hay email, no se muestra. (Ya
estaba correcto; sin cambios.)

## 8. Qué NO se tocó
RLS, auth, asistente, documentos reales/Storage, operations page, dashboard, n8n, delete
seguro P3.9A. Header, resumen operativo, actividad reciente, señal de operaciones del listado
(ya bien).

## 9. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅.

## 10. Archivos tocados
- `src/app/(saas)/clients/[id]/page.tsx` (resumen fallbacks; DetailItem empties; operaciones
  cards; empty states; documentos compacto).
- Docs: este report.

## 11. Qué probar en staging (ejemplo "Inmobiliaria Costa Azul")
- **Roberto Díaz / Inversiones Atlántico / Marcos / Marta / Carmen / David**: Resumen ejecutivo
  → "Perfil" muestra su descripción (no "No consta").
- **Familia Soler / Lucía / Javier**: Perfil = tipo, Interés = zona.
- **Datos personales**: campos vacíos discretos ("—" sin caja), no festival.
- **Pestaña Operaciones**: operaciones como **cards** con valor/etapa/cierre; expedientes y
  propiedades vacíos compactos y explicativos.
- **Documentos**: bloque compacto y honesto.
- **Email**: abre el correo con el destinatario.

## Veredicto
**P4.4 PARCIAL SEGURO — FICHA CLIENTE 360 (resumen coherente + operaciones premium + empties
discretos).** Se corrigió la incoherencia "No consta" del resumen (fallback a `company`/zona),
las operaciones son cards comerciales, los campos vacíos receden, los empty states son
compactos y explicativos, y los documentos quedan honestamente compactos (D1). tsc/lint/build
verdes. **Requiere redeploy** + ojo humano para firmar el "100% premium".
