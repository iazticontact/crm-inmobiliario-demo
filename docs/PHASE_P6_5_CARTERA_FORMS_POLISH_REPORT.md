# FASE P6.5 — Formularios de Cartera profesionales (Nueva operación + Nuevo trámite)

> **Fecha:** 2026-06-23 · HEAD previo `d50fcf5`. UI de formularios + helper `createOpportunity`
> (añade `property_id`). **Sin migración** (`opportunities.property_id` ya existía, P7). Requiere
> redeploy.

## 1-2. Diagnóstico
Los drawers (`VerticalForms.tsx`) eran genéricos multi-vertical:
- **Nueva operación**: selector "Vertical" siempre visible, **default `general`**, sin tipo de
  operación, sin selector de inmueble, origen como texto libre, sin cierre estimado.
- **Nuevo trámite**: **default `immigration`** (¡en un CRM inmobiliario!), tipos de `CASE_TYPES`
  de extranjería (NIE…), título "Nuevo expediente", botón "Abrir expediente", placeholder
  "Renovación NIE".
- **Schema**: `opportunities`/`service_cases` **no tienen CHECK constraints** → valores libres OK
  (custom seguro). `createOpportunity` **no** insertaba `property_id`; `createServiceCase` **sí**
  acepta `opportunity_id`. Ambos aceptan `metadata`.

## 3-5. Verticales / Extranjería
- El selector **"Área de negocio" se oculta** salvo workspace mixto (`showVerticalSelect` =
  `showVerticalBar`, data-driven). Una inmobiliaria normal **no lo ve**.
- **Default = `real_estate`** en ambos formularios (antes general/immigration). **Extranjería ya
  no es default** ni aparece salvo workspace con datos de esa vertical.

## 4. Nueva operación — estructura nueva
Título · **Cliente** · **Inmueble vinculado** (selector real de `properties`, opcional, con
helper "puedes vincularlo más tarde") · **Tipo de operación** (Venta/Alquiler/Captación/Compra/
Inversión/Valoración/**Otro**) · **Etapa** (pipeline inmobiliario) · **Valor potencial / Probabilidad
/ Cierre estimado** · **Origen** (Web/WhatsApp/Referido/Portal/Oficina/Llamada/**Otro**) · Notas.
El inmueble se guarda en **`opportunities.property_id`** (real). "Pipeline" no aparece.

## 5. Nuevo trámite — estructura nueva
Título · **Cliente** · **Operación vinculada** (selector de `opportunities`; si la operación tiene
inmueble, se muestra **"Inmueble: …" derivado**) · **Tipo de trámite** inmobiliario (Nota simple,
Contrato de arras, Reserva, Encargo de venta, Certificado energético, Tasación, Hipoteca/
financiación, Due diligence, Escritura/notaría, Documentación cliente, Documentación inmueble,
**Otro**) · **Estado** (Abierto/En revisión/Pendiente de documentación/Pendiente de firma/
Bloqueado/Completado) · **Prioridad** · Fecha límite · Notas. Título "Nuevo trámite", botón "Crear
trámite", toast "Trámite creado". **Sin "expediente" ni NIE.**

## 6-7. "Otro" + relaciones
- **Otro** (operación y trámite): aparece input "Especifica el tipo" (requerido si se elige Otro).
  - Operación: `metadata = { operation_kind: 'otro', custom_type, source: 'user_custom' }`.
  - Trámite: `case_type = <texto>` + `metadata = { custom_type, source: 'user_custom' }`.
  No se crean registros vacíos/ambiguos (validación). Tipo estándar → `metadata.operation_kind`
  (operación) o `case_type = <label>` (trámite).
- **Inmueble↔operación**: real vía `property_id` (selector en la operación).
- **Trámite↔operación**: real vía `opportunity_id` (selector); el **inmueble se deriva** de la
  operación (transitivo). El modelo no tiene `service_cases.property_id` directo → no se finge un
  enlace directo; se documenta como decisión.

## 8. Copy eliminado
"Pipeline comercial", "expediente"/"Abrir expediente"/"Nuevo expediente", "Renovación NIE",
"Vertical" como obligatorio, default Extranjería. (Activity log: "Expediente abierto" → "Trámite
abierto".)

## 10. Compatibilidad con datos antiguos
No se migra nada. Estados antiguos (`submitted`/`closed`) se conservan en las opciones (etiquetados
"Presentado"/"Cerrado") para que la edición inline y los datos existentes se muestren bien. Las
etapas siguen el pipeline real_estate existente (claves intactas).

## 11-12. Validaciones
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Scan: sin Expediente/NIE/Pipeline/service_case
visibles, sin secretos.

## 13. Archivos
`src/components/VerticalForms.tsx` (rework de los dos drawers + constantes), `src/lib/vertical-queries.ts`
(`createOpportunity` añade `property_id`; activity "Trámite abierto"), `src/app/(saas)/opportunities/page.tsx`
(props a los drawers + default real_estate), este report.

## 17. Qué probar
- **Nueva operación**: no aparece "Vertical"; crear con **inmueble vinculado** → aparece en la card
  del inmueble ("N operaciones vinculadas"); tipo **Otro** + custom; valor/probabilidad/cierre.
- **Nuevo trámite**: sin "expediente"/NIE; tipo Nota simple / Contrato de arras / **Otro**; vincular
  a una **operación** → se muestra el inmueble derivado; estado/prioridad/fecha; aparece en Trámites.
- Móvil usable; empty states intactos.

## Veredicto
**P6.5 COMPLETADO — FORMULARIOS DE CARTERA PROFESIONALES.** Nueva operación y Nuevo trámite son
ahora estándar inmobiliarios: simples, con default real_estate, vertical oculto salvo workspace
mixto, **Otro** flexible, **inmueble vinculado real** (property_id) y **operación vinculada real**
(opportunity_id), sin Extranjería ni "expediente". Requiere redeploy.
