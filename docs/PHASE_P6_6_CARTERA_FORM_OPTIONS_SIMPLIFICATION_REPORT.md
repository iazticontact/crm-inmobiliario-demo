# FASE P6.6 — Simplificación de opciones en Cartera (operación + trámite)

> **Fecha:** 2026-06-23 · HEAD previo `c9fc17e`. Solo opciones/labels de formularios + pipeline
> labels. **Sin migración** (claves internas intactas; valores antiguos compatibles). Requiere redeploy.

## 1-2. Diagnóstico
Tras P6.5 los formularios funcionaban pero las listas eran largas/técnicas: tipo de operación con
orden raro, etapas con labels genéricos ("Nuevo lead", "Oferta/propuesta"), origen desordenado,
**11 tipos de trámite** y **8 estados**. Demasiado para una inmobiliaria normal.

## 3. Opciones finales — Tipo de operación (7)
**Venta · Alquiler · Captación · Compra · Valoración · Inversión · Otro.** (mismo set, orden más
natural). "Otro" → input "Especifica el tipo" → `metadata.operation_kind='otro'` + `custom_type`.

## 4. Opciones finales — Etapa (labels simples, claves intactas + "Reserva")
Relabel de `REAL_ESTATE_PIPELINE` (claves internas SIN cambiar):
`new`→**Nueva** · `contacted`→Contactado · `qualified`→Cualificado · `visit_scheduled`→**Visita** ·
`offer`→**Oferta** · `negotiation`→Negociación · `won`→**Cerrada** · `lost`→**Perdida**.
**Añadida etapa `reserved` → "Reserva"** (clave nueva, segura: el tablero oculta etapas vacías y
ningún dato usaba 'reserved'; cuenta como abierta en KPIs). Cambio coherente en formulario **y**
tablero (misma constante).

## 5. Opciones finales — Origen (7)
**Web · Portal inmobiliario · WhatsApp · Llamada · Oficina · Referido · Otro.** "Otro" → campo
libre (placeholder "Ej: Instagram, cartel, colaboración…"), guardado en `source`.

## 6. Opciones finales — Tipo de trámite (8 + Otro)
**Nota simple · Contrato / arras · Reserva · Tasación · Certificado energético · Financiación /
hipoteca · Escritura / notaría · Documentación · Otro.** Simplificaciones: "Documentación cliente"
+ "Documentación inmueble" → **"Documentación"**; "Encargo de venta" y "Due diligence" salen de la
lista principal (van por "Otro" o se mantienen si ya hay datos). "Otro" → input "Especifica el
trámite". El tipo se guarda como **label** en `case_type` (texto libre).

## 7. Estados finales — Trámite (5 + compatibilidad)
Primarios: **Abierto · En revisión · Pendiente de documentación · Bloqueado · Completado.**
Compatibilidad: estados antiguos (`signature_pending`→"Pendiente de firma", `submitted`→
"Presentado", `closed`→"Cerrado") se muestran bien donde aparezcan mediante el helper
`serviceCaseStatusLabel()`; la edición rápida de la lista **añade el valor actual** si no está en
los 5 primarios (no se pierde ni se ve en blanco). Verificado: el ejemplo solo usa
open/in_review/documentation_pending (todos primarios).

## 8. Prioridad
Sin cambios: Baja · Normal · Alta · Urgente.

## 9. "Otro"
Igual que P6.5: input requerido si se elige Otro; persistencia en `metadata` (`custom_type`,
`source: 'user_custom'`) para operación; `case_type = <texto>` + metadata para trámite.

## 10. Datos antiguos (compatibilidad, sin migración)
- **Etapas**: solo se cambiaron *labels*; las claves (`new`/`offer`/`won`…) son las mismas → datos
  intactos. `reserved` es aditivo.
- **Estados**: valores antiguos se siguen mostrando vía helper + fallback en la edición rápida.
- **Tipos de trámite**: `case_type` es texto libre; los tipos antiguos en datos ("Venta de
  vivienda", "Inversión"…) se muestran tal cual; la lista corta es solo para crear nuevos.

## 11. Copy eliminado
Sin "Pipeline comercial", "Expediente", "Renovación NIE" ni "Extranjería" en los formularios de
Cartera. (Las definiciones de extranjería siguen en `vertical-templates` como vertical opcional,
no visibles en una inmobiliaria normal.)

## 12. Validaciones
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Sin secretos/PII.

## 13. Archivos
`src/lib/demo/vertical-templates.ts` (labels REAL_ESTATE_PIPELINE + etapa `reserved`),
`src/components/VerticalForms.tsx` (opciones operación/origen/trámite/estado + helper de estado),
`src/app/(saas)/opportunities/page.tsx` (edición rápida de estado con fallback legacy), este report.

## 16. Qué probar
- **Nueva operación**: tipo (7) y origen (7) cortos; **Etapa** con "Nueva/Visita/Oferta/Reserva/
  Cerrada/Perdida"; tipo/origen **Otro** + custom; inmueble vinculado.
- **Nuevo trámite**: tipo (8+Otro), estado (5); vincular operación; aparece en Trámites.
- **Tablero**: las operaciones por etapa muestran los nuevos labels; "Reserva" aparece si hay
  operaciones en esa etapa.
- Sin Extranjería/expediente/NIE; la edición rápida de estado no se rompe con datos antiguos.

## Veredicto
**P6.6 COMPLETADO — FORMULARIOS SIMPLES Y PROFESIONALES.** Listas cortas y estándar inmobiliarias
(operación 7 · etapa 9 con "Reserva" · origen 7 · trámite 8+Otro · estado 5), "Otro" flexible,
claves internas intactas y datos antiguos compatibles. Requiere redeploy.
