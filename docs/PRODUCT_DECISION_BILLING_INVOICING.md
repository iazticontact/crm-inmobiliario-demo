# Product Decision — Facturación / Invoicing

> **Fecha:** 2026-06-15 · **Estado:** DECISIÓN (no implementar ahora) ·
> Relacionado: [PRODUCT_ARCHITECTURE_AUDIT.md](PRODUCT_ARCHITECTURE_AUDIT.md),
> [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)

## 1. Objetivo (visión)
Apartado **Facturación** para que la inmobiliaria vea y gestione su facturación:
emitir facturas, generar PDF, registrar cobros/pendientes, vincular factura a
cliente/operación/expediente, y que el asistente IA **prepare** facturas
(siempre con confirmación). Más adelante, envío automático.

## 2. Estado actual (verificado)
- **NO existe tabla `invoices`** en Supabase (solo 10 tablas core).
- La ruta `/billing` existe pero usa **mock** y está **oculta** del cliente
  (`internal: true` + flag `billing`). El nav del cliente NO la muestra.
- El executor del asistente (`/api/assistant/confirm`) tiene un tipo de acción
  `invoice` con validación de importe (`numeric(12,2)`, cap 9.999.999,99), pero
  **apunta a una tabla inexistente** → hoy **no se puede ejecutar end-to-end**.
- Existe `/api/reports/invoice` (generación de PDF/HTML) como utilidad de informe.

**Conclusión:** la facturación está **andamiada pero dormida**. No hay riesgo de
datos inventados en modo real porque está oculta.

## 3. ¿Core o addon?
**ADDON de alto valor**, no core del MVP inmobiliario. El CRM vende sin
facturación; la facturación es un upsell potente pero con **riesgo legal/fiscal**
que no debe contaminar el MVP. → **Fase 3 del roadmap (2E-4)**, después de
staging y QA del core.

## 4. MVP de facturación (cuando toque)
1. Tabla `invoices` (workspace-scoped, RLS) con: `number`, `client_id`,
   `opportunity_id?`, `service_case_id?`, `issue_date`, `due_date`, `status`
   (draft/issued/paid/overdue/void), `subtotal`, `tax`, `total`, `currency`,
   `notes`, `created_by`, timestamps.
2. Numeración correlativa por workspace (serie + año), **inmutable** tras emitir.
3. CRUD con RLS + estados es-ES + empty states (sin mocks en real).
4. PDF desde datos reales (ya hay base en `/api/reports/invoice`).
5. Cobros/pendientes (estado + fecha de pago); vista de cartera.
6. Vínculos: factura ↔ cliente/operación/expediente.
7. IA: el asistente **prepara** una factura (PREPARE) y **solo crea tras
   confirmación** (CONFIRM, reutilizando el patrón del executor); demo no persiste.

## 5. Schema futuro (no aplicar ahora)
- `invoices` + posible `invoice_lines` (línea: concepto, cantidad, precio,
  impuesto) para facturas con múltiples conceptos.
- Triggers `enforce_member_refs` para `created_by`/`assigned_to` (como el resto).
- Índices por `workspace_id`, `client_id`, `status`, `due_date`.

## 6. Riesgos legales/fiscales (decisivos)
- **Numeración fiscal:** correlativa, sin huecos, inmutable tras emisión.
- **IVA/IRPF y normativa ES** (y futura UE): tipos, retenciones, facturas
  rectificativas, conservación. **No improvisar** — requiere validación de un
  asesor o integración con software de facturación homologado.
- **Veri*factu / facturación electrónica (España):** la AEAT exige requisitos de
  software de facturación; emitir facturas "reales" con valor fiscal puede
  obligar a cumplir normativa. **Evaluar si el CRM "emite" facturas con valor
  fiscal o solo genera borradores/PDF informativos.**
- **Datos personales (RGPD):** las facturas contienen datos fiscales del cliente.

## 7. Qué NO hacer ahora
- No crear la tabla ni el CRUD.
- No exponer `/billing` al cliente (mantener `internal`/flag off).
- No prometer "emisión de facturas con validez fiscal" hasta resolver §6.
- No conectar el action `invoice` del asistente hasta que exista la tabla.

## 8. Cuándo implementarlo
**Fase 3 (2E-4)**, tras: smoke navegador OK + staging OK + QA del core. Empezar
por **borradores + PDF informativo** (bajo riesgo) y separar claramente
"borrador" de "factura con validez fiscal" (que depende de §6).

## 9. Recomendación
Mantener oculto y dormido. Cuando se aborde, **MVP = borradores + PDF + estados +
vínculos**, y tratar la **validez fiscal (Veri*factu/AEAT) como decisión legal
previa**, no como detalle de implementación.
