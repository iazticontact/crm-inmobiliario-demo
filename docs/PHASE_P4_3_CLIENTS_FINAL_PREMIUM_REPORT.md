# FASE P4.3 — Clientes final premium (declutter + ficha 360 + operaciones)

> **Fecha:** 2026-06-22 · HEAD previo `d5e4ad9`. Solo `/clients` y `/clients/[id]` + docs. **Sin**
> migraciones, sin dependencias nuevas, sin tocar otros módulos. Delete seguro P3.9A intacto.
> Requiere redeploy.

## Causa / diagnóstico
Auditoría de los puntos que el usuario marcó como "flojos":
- **Ficha**: `DetailItem` pintaba **"Sin completar"** en cursiva para cada campo vacío → un
  "festival" frío y administrativo.
- **Header**: badge de canal mostraba un pill **"WhatsApp"/"Instagram"** ambiguo (parece un
  módulo activo) + un botón **"Llamar"** que en escritorio no llama (sobrepromesa) y es
  redundante (el teléfono ya está inline y se puede copiar).
- **Pestaña "Expedientes"**: las **operaciones** (lo más comercial) estaban **al final**, tras
  "Expedientes" (trámites de gestoría, a menudo vacíos) → sensación de "panel interno vacío".
- **Listado**: la columna **"Área / servicio"** salía casi siempre **"—"** (usa `main_area`/
  `service_interest`, que los clientes del ejemplo no tienen; sí tienen `client_type`).
- **Documentos**: sin tabla `public.documents` ni buckets (reconfirmado) → no se implementa
  upload real.

## Qué cambié y por qué
1. **DetailItem `"Sin completar"` → `"—"`** (gris discreto, no cursiva): quita el "festival"
   de campos vacíos; la ficha respira.
2. **Header sin botón "Llamar"**: el teléfono sigue visible inline + copiable; se elimina la
   sobrepromesa de llamar desde escritorio y un botón redundante.
3. **Badge de canal `"WhatsApp"` → `"Origen · WhatsApp"`** (variant neutro): deja claro que es
   el **origen de captación**, no un módulo de mensajería activo.
4. **Pestaña "Expedientes" → "Operaciones"**, con las **operaciones primero** (reordenado por
   CSS `flex` + `order-*`, sin mover bloques → riesgo cero): "Operaciones del cliente"
   (compraventas/alquileres) arriba, luego "Expedientes y trámites", luego "Propiedades
   vinculadas". Empty state más comercial ("Aún no hay operaciones abiertas… crea una para
   empezar el seguimiento").
5. **Listado: columna "Área / servicio" → "Perfil"** con **fallback al tipo de cliente**
   (Comprador/Vendedor/Inversor…) cuando no hay área/servicio → la columna deja de ser "—".
6. **Email = `mailto:` puro** (ya estaba bien en listado, cards y ficha): abre el cliente de
   correo con el destinatario, sin plantilla/asunto/cuerpo. Confirmado, sin cambios.

## Qué NO toqué y por qué
- **Documentos**: siguen en **D1** (sin tabla/bucket; un upload real sería un medio módulo
  roto). Bloque "Documentos y recursos" con empty state honesto. Roadmap
  `docs/CLIENT_DOCUMENTS_ROADMAP.md`.
- **Resumen ejecutivo (6 ítems)**, header, stats, cards móvil, señal de operaciones, delete
  seguro: ya estaban bien (P4/P4.1/P4.2) → no se rehicieron por ego.
- **Asistente / copiloto deep-link**: el asistente no acepta contexto por enlace (P4.2) →
  fuera de alcance; el botón abre `/assistant`. Pendiente documentado.

## Archivos tocados
- `src/app/(saas)/clients/page.tsx` (describeArea con fallback a perfil; cabecera "Perfil").
- `src/app/(saas)/clients/[id]/page.tsx` (DetailItem "—"; sin "Llamar"; "Origen ·"; pestaña
  Operaciones reordenada + renombrada).
- Docs: este report.

## Riesgos
Bajos: cambios de copy/orden CSS/clases. El reorden es por `order-*` (no se movió JSX). Sin
tocar datos, RLS, queries ni delete. tsc/lint/build verdes.

## Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅.

## Qué probar en staging (ejemplo "Inmobiliaria Costa Azul")
- **Listado**: columna **"Perfil"** muestra Comprador/Vendedor/Inversor (no "—"); señal de
  operaciones; "Ver ficha" dominante; móvil cards.
- **Ficha**: header sin "Llamar", badge **"Origen · …"**, campos vacíos como **"—"** discreto.
- **Pestaña "Operaciones"**: las **operaciones aparecen primero**, luego trámites y propiedades.
- **Email**: abre el cliente de correo con el destinatario puesto.

## Veredicto
**P4.3 PARCIAL SEGURO — CLIENTES FINAL PREMIUM (declutter + operaciones primero + perfil en el
listado).** Se atacaron los puntos concretos que enfriaban la experiencia (Sin completar,
botón Llamar, pill WhatsApp, operaciones enterradas, columna en "—") con cambios quirúrgicos y
de riesgo bajo; documentos siguen honestamente en D1. tsc/lint/build verdes. **Requiere
redeploy** + QA visual humano (sin navegador aquí) para firmar el "100% premium".
