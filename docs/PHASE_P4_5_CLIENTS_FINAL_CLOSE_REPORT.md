# FASE P4.5 — Clientes final cierre (lenguaje Operación/Trámite/Documento + interés sin huecos)

> **Fecha:** 2026-06-22 · HEAD previo `e9a06ac`. Solo `/clients/[id]` + docs. **Sin** migraciones,
> sin documentos reales, sin tocar otros módulos. Delete seguro P3.9A intacto. Requiere redeploy.

## 1. Diagnóstico final (tras screenshots)
Los screenshots del usuario son del estado **pre-P4.4** (P4.4 aún no desplegado): se ven todavía
las cajas vacías "frías" y el lenguaje "Expediente". Con P4.4 ya desplegado, las cajas vacías
**receden** (borderless + "—") y el resumen es coherente (fallback a `company`/zona). Lo que
quedaba realmente por cerrar:
1. **Lenguaje de producto ambiguo**: convivían "Operación", "Expediente" y "trámite" sin una
   distinción clara. La inmobiliaria no piensa en "expedientes".
2. **"Interés y servicio"** mostraba **4 celdas vacías** para los 6 clientes originales del
   ejemplo (no tienen `main_area`/`service_interest`/`budget`/`zona`) → bloque frío.

## 2. Listado de clientes — revisión final
Auditado: ya está cerrado (P4/P4.1/P4.2/P4.3). Se mantiene **sin cambios** (no se reinventa lo
que funciona): tabla desktop simple + cards móvil, stats superiores, búsqueda/filtros, "Ver
ficha" dominante, editar/eliminar secundarios, señal "● N operaciones abiertas", columna
"Perfil" con fallback al tipo de cliente. No se recargó con más iconos.

## 3. Ficha resumen — pulido
- **Header**: sin cambios (ya correcto en P4.3/P4.4): nombre, estado, "Origen · …", email
  (`mailto:` puro), teléfono visible+copiable, Editar, Copiloto. Sin botón "Llamar".
- **Resumen ejecutivo (6 ítems)**: coherente con fallbacks (P4.4). En P4.5 el ítem antes
  llamado **"Expediente abierto" → "Trámite abierto"** (default "Sin trámites abiertos").
- **Interés y servicio**: si no hay ningún dato de interés (área/servicio/presupuesto/zona/
  ciudad) ya **no pinta 4 celdas vacías**, sino una línea útil: *"Añade preferencias (zona,
  presupuesto o tipo de inmueble) para afinar el seguimiento comercial."* Si hay algún dato,
  muestra la rejilla (con "Zona de interés" cayendo a `city_area` si falta la zona explícita).
- **Datos personales / contacto**: empties que receden (borderless "—", P4.4); sin cambios
  adicionales (la sensación de "formulario medio vacío" la resuelve P4.4 al desplegarse).
- **Resumen operativo**: StatPill **"Expedientes" → "Trámites"** (hint "Gestiones abiertas").
- **Actividad reciente**: sin cambios (ya limpia, sin texto técnico).

## 4. Pestaña Operaciones — cierre
Orden (P4.3) intacto: **Operaciones del cliente → Trámites y documentación → Propiedades
vinculadas**.
- **Operaciones**: cards comerciales (P4.4) — título + valor potencial (negrita) ·
  probabilidad · cierre + badge de etapa + Editar. Sin cambios (ya premium).
- **Trámites y documentación** (antes "Expedientes y trámites"): renombrado para que se
  entienda **sin saber qué es un "expediente"**. Descripción nueva: "Gestiones asociadas:
  documentación, contrato, tasación, financiación…". Empty state compacto (P4.4).
- **Propiedades vinculadas**: empty state compacto (P4.4). Sin cambios.

## 5. Trámites y documentación — decisión de producto
La UI ahora distingue con claridad, **sin lenguaje interno** (`service_case` nunca visible):
- **Operación** = negocio comercial abierto (venta/alquiler/captación/compra).
- **Trámite** = gestión/documentación asociada (contrato, tasación, financiación, documentación).
- **Documento** = archivo real vinculado (D1 futuro).

## 6. Documentos
Sin tabla `public.documents` ni buckets (reconfirmado) → **diferido (D1)**, sin upload falso.
Bloque "Documentos y recursos" compacto y honesto (P4.4): "Centraliza aquí la documentación
vinculada: identificación, contratos, nota simple, reservas y justificantes." Sin botón falso.

## 7. Email mailto — confirmado
`mailto:${email}` puro en header de ficha, listado y cards de operación: abre el cliente de
correo con el destinatario, **sin asunto, sin cuerpo, sin plantilla**. Si no hay email, no se
muestra. Sin cambios (ya correcto).

## 8. Qué NO se tocó
Dashboard, n8n, RLS, auth, delete seguro P3.9A, documentos reales/Storage (D1), assistant
backend, operations page global, calendar. Listado de clientes (ya cerrado). Header, resumen
ejecutivo (estructura), operaciones cards, actividad reciente.

## 9. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅.
Verificado: sin `service_case`, sin label "Expediente abierto"/"Expedientes" visible.

## 10. Archivos tocados
- `src/app/(saas)/clients/[id]/page.tsx` (renombres Trámites; "Trámite abierto"; empty-state de
  Interés; "Zona de interés" → fallback `city_area`).
- Docs: este report.

## 11. Commit / push
`polish(clients): client/operation/trámite/documento language + interés empty-state (P4.5)`.
Push a `origin/main`.

## 12. Redeploy
**Requiere redeploy.** Los cambios son de UI (copy/condicional), sin migración.

## 13. Qué probar en staging (ejemplo "Inmobiliaria Costa Azul")
- **Roberto Díaz / un cliente original**: "Interés y servicio" → línea "Añade preferencias…"
  (no 4 celdas vacías); resumen "Perfil" con su descripción.
- **Lucía Herrera / Familia Soler / Javier Ortega**: Interés con zona/datos; Perfil = tipo.
- **Pestaña Operaciones**: cabecera **"Trámites y documentación"** (no "Expedientes");
  operaciones como cards; trámites/propiedades vacíos compactos.
- **Resumen operativo**: pill **"Trámites"** (no "Expedientes").
- **Email**: abre el correo con el destinatario; sin UUID/lead_score/texto técnico.

## 14. Veredicto
**P4.5 PARCIAL SEGURO — CLIENTES FINAL (lenguaje Operación/Trámite/Documento + interés sin
huecos).** Se cerró la distinción de producto (operación = negocio, trámite = gestión,
documento = archivo) eliminando "Expediente" de la UI, y se quitó el bloque frío de "Interés"
vacío. El resto del módulo ya estaba premium (P4–P4.4). tsc/lint/build verdes. **Requiere
redeploy** + ojo humano sobre staging (P4.4 incluido, aún sin desplegar) para firmar el "100%".
