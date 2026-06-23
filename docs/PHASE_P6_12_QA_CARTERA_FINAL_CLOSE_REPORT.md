# FASE P6.12-QA — Cierre final de Cartera (5 estados)

> **Fecha:** 2026-06-23 · Microfase de QA y pulido fino sobre P6.12. **No** es rediseño ni
> funcionalidad nueva. Cambios mínimos de copy + coherencia Cartera↔Dashboard. Requiere redeploy.

## 1. Diagnóstico
Tras P6.12 (Cartera ya en 5 estados), una auditoría de copy visible y de coherencia entre módulos
detectó **3 incoherencias reales** y varios falsos positivos:

- **(A) Modal de cierre** usaba "cerrada" como etiqueta de resultado: *"¿Marcar la operación como
  cerrada?"* / botón *"Marcar cerrada"*. Contradice la regla "Cerrada no es label visible".
- **(B) Dashboard — embudo comercial** seguía agrupando por las **6 etapas antiguas**
  (Nuevo/Contactado/Cualificado/Visita/Oferta/Negociación), desalineado con los 5 estados de Cartera.
- **(C) Dashboard — "Operación a revisar"** mostraba la etapa interna cruda con el mapa viejo
  (`Ganada`/`Cerrada`/`Negociación`…), no el estado comercial.
- **Falsos positivos (correctos, se mantienen):** `pipeline`/`service_case`/`expediente` solo como
  **claves internas, comentarios o `type`** (no visibles; la pestaña se llama "Operaciones", la tabla
  "Trámites"); `lead` solo en automations/n8n internas; "operaciones **cerradas**" como **categoría**
  (= vendidas/alquiladas, término que el propio brief usa); todas las apariciones de
  `facturación/impuestos/ingresos` en Cartera son los **disclaimers obligatorios** ("no es
  facturación", "no genera impuestos ni contabilidad").

## 2. ¿Tocaste código o solo auditaste?
**Auditoría + cambios mínimos de código.** Sin rediseño, sin migraciones, sin nuevas features.

## 3. Cambios exactos
**Cartera — `src/app/(saas)/opportunities/page.tsx`**
- Modal de cierre reescrito: título/descr./botón ahora **"¿Marcar la operación como vendida /
  alquilada?"**, *"…quedará registrada como vendida/alquilada… pasa al histórico…"*, botón
  **"Marcar vendida/alquilada"** según `operation_kind`. Sin "cerrada".
- Modal **"Registrar cobro"**: añadido campo **Fecha de cobro** (date, por defecto hoy; permite
  registrar un cobro con fecha pasada). Se mantiene simple: fecha + importe real opcional + nota
  opcional. **Sin** impuestos/gastos/factura.

**Dashboard — `src/app/(saas)/dashboard/page.tsx`** (copy/coherencia mínima, no rediseño)
- Embudo reagrupado a los **3 estados comerciales abiertos** (Nueva · En gestión · Reserva) vía
  `commStateOf`; eliminados `PIPELINE_ORDER`/`STAGE_LABELS` con la vieja nomenclatura.
- "Operación a revisar" usa `commStateLabel(stage)` → muestra el estado comercial, no la etapa cruda.
- Empty-state del embudo: "aparecerán aquí **por estado**" (antes "por etapa").

## 4. Copy limpiado / justificado
| Término | Estado |
|---|---|
| **cerrada** (como label de op) | **Eliminado** del modal de cierre. Se mantiene "operaciones cerradas" como **categoría** (vendidas/alquiladas). |
| **probabilidad** | **0 apariciones** en Cartera y Dashboard (ya retirado en P6.10). |
| **pipeline / expediente / service_case** | Solo claves internas/`type`/comentarios. **No visibles.** |
| **lead** | Solo automations/n8n internas (no Cartera). |
| **facturación / impuesto / ingreso / beneficio** | En Cartera, solo como **disclaimers** ("no es facturación / no genera impuestos ni contabilidad"). `beneficio`: 0 apariciones. |
| **Ganada / Cerrada (Dashboard)** | **Eliminados** del Dashboard al reagrupar por estado comercial. |

## 5. Comisiones — comunicación (revisada, correcta)
- KPIs: **Comisión prevista** (orientativa · no es facturación) · **Pendiente de cobro** ·
  **Cobrada** (registrada, no fiscal) · **Cerradas con comisión**.
- Pie de pestaña + pie de modal: *"…es orientativa… control interno; no genera factura, impuestos ni
  contabilidad."* → cubre **no es factura / no es contabilidad fiscal / no es beneficio neto**.
- Modal "Registrar cobro": **fecha + importe real opcional + nota opcional**. Nada de impuestos/gastos.

## 6. Inmuebles vendidos/alquilados (revisado, correcto)
Cerrar **no borra nada** (fotos/documentos/trámites/operación/cliente intactos); el inmueble pasa a
**histórico** (`sold`/`rented`), oculto por defecto con toggle **"Ver vendidos y alquilados (N)" /
"Ocultar cerrados"**. La **vista principal sigue siendo los inmuebles activos**.

## 7. QA funcional (checklist de staging)
- [ ] Crear **operación nueva** → estado por defecto **Nueva** (selector de 5 estados).
- [ ] Cambiar a **En gestión** · **Reserva** desde el cambio rápido del tablero.
- [ ] Cambiar a **Vendida/Alquilada** con inmueble → **modal "¿Marcar como vendida/alquilada?"** →
      confirmar → inmueble marcado vendido/alquilado y operación en el grupo "Vendida / Alquilada".
- [ ] **Histórico**: el inmueble cerrado desaparece de la lista activa y aparece con "Ver vendidos y
      alquilados"; fotos/documentos/trámites/cliente intactos.
- [ ] **Registrar comisión cobrada**: modal con **fecha** (hoy por defecto) + importe real opcional +
      nota; tras guardar, badge **Cobrada** y suma en KPI **Cobrada**; "Pendiente" revierte.
- [ ] **Refrescar** (F5) → persisten estado de operación, cierre de inmueble y cobro de comisión.
- [ ] **Operación legacy** (Cualificado/Negociación) sigue **visible**, agrupada en **En gestión**,
      sin perder datos.
- [ ] **Borrar operación con trámites** → sigue **bloqueado** (guía a resolver trámites).
- [ ] **Borrar trámite con documento** → sigue **borrando el documento** asociado.
- [ ] **Dashboard**: el embudo muestra **Nueva/En gestión/Reserva**; "Operación a revisar" muestra el
      estado comercial; KPI "Operaciones abiertas" + "valor potencial" coherentes.

## 8. Validaciones
- `npx tsc --noEmit` ✅
- `npm run lint -- --max-warnings=0` ✅
- `npm run build` ✅ (`✓ Compiled successfully`)
- Verificación de datos de ejemplo (P6.12, MCP): buckets **En gestión 5 · Vendida/Alquilada 3**;
  3 inmuebles cerrados ocultos por defecto, 4 activos.

## 9. Qué NO se tocó
n8n · Asistente (Agent V2) · Auth/onboarding · Storage policies · `.env.local`/secretos ·
**sin service_role en frontend** · datos reales fuera del workspace de ejemplo · **sin facturación
real** · sin migraciones. **Clientes/Calendario/Inbox/Settings/Billing no se modificaron.**

## 10. Pendiente fuera de alcance (ojo humano)
Coherencia plena exigiría, en una pasada del **módulo Clientes** (excluido aquí), alinear el
formulario de operación de la ficha de cliente
(`src/app/(saas)/clients/[id]/page.tsx`, inputs **"Probabilidad (%)"**) y el panel del Asistente
(`assistant/page.tsx`, etiqueta "Probabilidad") con el modelo de 5 estados + comisión. **No** se tocan
en esta microfase de Cartera por estar fuera de su ámbito.

## Veredicto
**P6.12-QA COMPLETADO — CARTERA FINAL CERRADA.** Cartera queda coherente y lista para enseñar:
5 estados en todos los puntos, sin "Cerrada" como etiqueta, Comisiones con cobro registrable
(fecha + importe real + nota) y copy claro de "control interno, no facturación", e inmuebles cerrados
como histórico oculto. El **Dashboard** queda alineado (embudo y "operación a revisar" por estado
comercial). `tsc`/`lint`/`build` en verde; sin tocar n8n/asistente/auth/storage/datos reales.
*(Nota: queda como pendiente de otra fase la "Probabilidad" del formulario de operación en Clientes y
Asistente — fuera del ámbito de Cartera.)* Requiere redeploy.
