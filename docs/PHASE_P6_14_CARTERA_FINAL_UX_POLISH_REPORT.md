# FASE P6.14 — Cartera: pulido final de UX (comisión, documentos de trámites, copy)

> **Fecha:** 2026-06-23 · Microfase final de UX/copy sobre Cartera. **Sin migración**, sin
> facturación real, sin rediseño. Requiere redeploy.

## 1. Diagnóstico (3 problemas detectados en staging)
1. **Operaciones** mostraba un KPI **"Comisión estimada · 51.486 € · Operaciones abiertas"**: dato
   financiero prematuro en una vista que debe ser **operativa**. Confundía.
2. **Trámites** indicaba "1 documento" pero **obligaba a abrir el drawer de edición** para ver/subir
   documentos. Poco accesible.
3. **Comisiones**: KPI "Cerradas con comisión · Vendidas / alquiladas" no se entendía del todo.

## 2. Operaciones — fuera la comisión de la vista operativa
- **Eliminado** el KPI "Comisión estimada". Nueva tira de KPIs **100% operativa**:
  **Operaciones abiertas · Valor potencial · Trámites abiertos · Inmuebles en cartera**
  (este último: activos en cartera; si hay cerrados, "{N} en histórico").
- **Eliminado** el chip secundario **"Com. {€}"** de cada fila del tablero: Operaciones deja de
  mostrar cifras de comisión. La comisión vive **solo** en la pestaña **Comisiones** (y en el drawer
  de edición de la operación).
- **No** se borró `commission_rate` ni la lógica (`commissionOf`, KPIs de Comisiones, modal de cobro
  siguen intactos). `openCommission` (cálculo del KPI retirado) se eliminó por quedar sin uso.

## 3. Trámites — documentos accesibles desde la fila
- La línea de recuento de documentos pasa a ser **acción directa**:
  - con documentos → botón **"{N} documento(s)"** (abre el gestor),
  - sin documentos → botón discreto **"Añadir documento"**.
- Al pulsar se abre un **modal "Documentos del trámite"** que **reutiliza `EntityDocumentsManager`**
  (mismo componente del drawer de edición). Desde ahí: **subir** PDF/imagen (≤10 MB), **abrir/
  descargar**, **borrar**, con estado **"Subiendo…"**.
- El **contador de la fila se actualiza al instante** (sin F5) vía `onCountChange` →
  `handleDocCountChange` (0 → 1 → N y viceversa).
- **No** se duplicó lógica: el drawer de edición sigue gestionando documentos igual; solo se añadió
  un **acceso principal** en la fila. **Storage + RLS por workspace intactos; sin service_role.**
- Copy: "Documentos del trámite" · empty *"Sube contratos, nota simple, tasaciones o justificantes
  vinculados a este trámite."*

## 4. Comisiones — copy del KPI
- "Cerradas con comisión / Vendidas · alquiladas" → **"Operaciones cerradas" / "Con comisión
  pactada"** (más claro y profesional).
- Header ("Control interno de comisiones comerciales."), nota inferior única y botones (Registrar
  cobro / Marcar pendiente) **se mantienen** (P6.13). No se añaden disclaimers.

## 5. Inmuebles vendidos/alquilados — copy de histórico
- Modal de cierre reforzado: *"La operación quedará registrada como vendida/alquilada y el inmueble
  «X» se marcará como vendido/alquilado **y saldrá de la cartera activa**. No se elimina nada:
  **queda en el histórico** (comisión, documentos y trámites se conservan)."* — comunica que **sale
  de la cartera activa** sin decir que se borra (no se borra).
- Toggle **"Ver vendidos y alquilados (N)" / "Ocultar cerrados"** se mantiene: los estados cerrados
  son concretos (vendido/alquilado), así que es más claro que un genérico "histórico".

## 6. Limpieza final (auditoría de copy visible en Cartera)
- "Comisión estimada" como KPI de Operaciones → **eliminada**.
- `probabilidad / pipeline / lead / expediente` visibles → **0** (solo claves internas/comentarios).
- `service_case` → solo identificador de constante/`entityType` (no texto visible).
- `factura/fiscal/contabilidad` visibles en Comisiones → **2 menciones controladas** (nota de pie +
  frase del modal). Sin repetición.
- "Cerrada" como etiqueta de estado de una operación → no aparece (se usa Vendida/Alquilada).

## 7. Qué NO se tocó
n8n · Asistente IA · Auth/onboarding · Clientes · Calendario · Dashboard · Storage **policies** · RLS
· `.env.local`/secretos · **service_role (sigue sin usarse en frontend)** · facturación/impuestos/
gastos/beneficio reales. **Sin migraciones.** Borrado seguro de trámites (avisa y borra sus
documentos) intacto. Lógica de comisiones intacta.

## 8. Validaciones
- `npx tsc --noEmit` ✅
- `npm run lint -- --max-warnings=0` ✅
- `npm run build` ✅ (`✓ Compiled successfully`)
- Scan final: sin "Comisión estimada" KPI, sin probabilidad/pipeline/lead/expediente visibles, sin
  service_role/secretos en frontend, disclaimers reducidos.

## 9. Checklist QA (staging)
**Operaciones**
- [ ] No hay KPI "Comisión estimada"; los KPIs son operativos (abiertas · valor · trámites ·
      inmuebles).
- [ ] Las filas ya no muestran chip "Com. {€}"; siguen mostrando título, cliente/inmueble, valor,
      estado, editar y borrar.
- [ ] Cambiar a Vendida/Alquilada → modal con copy de histórico ("saldrá de la cartera activa… queda
      en el histórico").

**Trámites**
- [ ] Trámite con 1 documento muestra botón "1 documento" → abre gestor.
- [ ] Trámite sin documentos muestra "Añadir documento" → abre gestor.
- [ ] Subir PDF/imagen desde el gestor directo; abrir/descargar; borrar; estado "Subiendo…".
- [ ] El contador de la fila cambia **sin F5** al subir/borrar.
- [ ] Editar trámite sigue funcionando (también gestiona documentos).
- [ ] Borrar trámite con documentos sigue avisando y borra sus documentos.

**Comisiones**
- [ ] KPI "Operaciones cerradas / Con comisión pactada" se entiende.
- [ ] Registrar cobro persiste; Marcar pendiente persiste; sin disclaimers repetidos.

**Inmuebles**
- [ ] Vendido/alquilado sale de la cartera activa, aparece con "Ver vendidos y alquilados (N)", no se
      borra.

## Veredicto
**P6.14 COMPLETADO — CARTERA FINAL UX POLISH.** Operaciones queda **operativa** (sin comisión como
KPI ni chip), los **documentos de trámites son accesibles directamente desde la fila** (subir/abrir/
borrar con contador en vivo, reutilizando el gestor existente y respetando Storage/RLS), y el copy de
Comisiones e histórico de inmuebles es claro y profesional. Sin migración, sin facturación real, sin
tocar módulos externos. `tsc`/`lint`/`build` en verde. Requiere redeploy.
