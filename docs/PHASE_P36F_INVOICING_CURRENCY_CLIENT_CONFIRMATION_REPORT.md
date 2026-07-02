# FASE P36F — Facturación PRO final: series claras, divisas, cliente autofill, aviso pre-emisión y PDF natural

> **Fecha:** 2026-07-02 · Cierre PRO del módulo: **serie explicada**, **selector de divisas** profesional con
> **conversión a EUR** (snapshot de tipo de cambio), **cliente autofill** (manual y por texto/voz mejorado),
> **checklist de revisión antes de emitir** y **último polish del PDF** (nota de divisa incluida). **Aislado
> del Asistente IA**, **n8n intacto**, RLS respetada. Una **migración additiva** (3 columnas de tipo de cambio).

---

## 25. Diagnóstico
«Serie A» no se entendía. La moneda era un input libre sin conversión. No había forma profesional de facturar
en divisa (sin tipo de cambio ni equivalente EUR). El cliente se rellenaba pero sin avisar de datos fiscales
faltantes. No existía confirmación previa a emitir. El PDF, ya aprobado, admitía un último pulido.

## 26. Series explicadas
Campo **«Serie de numeración»** con helper: «Separa la numeración. Normalmente puedes dejar «A». Ejemplo:
FAC-A/2026/0001.» Normalización a mayúsculas/alfanumérico (máx. 4) sin romper la numeración atómica.

## 27. Selector de divisas
Nuevo `currencies.ts` (EUR, USD, GBP, CHF, MXN, COP, ARS, CLP, PEN, MAD, BRL, CAD, AED) reutilizando el
**AutocompleteSelect** (búsqueda por código o nombre, tolerante a acentos, 16px en móvil). Se guarda el
**código ISO**; **EUR por defecto**. En solo-lectura se muestra «EUR — Euro».

## 28. Cambio de divisa
Cuando `currency != EUR`, bloque profesional en la cabecera: **tipo de cambio (1 CUR = X EUR)**, **fecha** y
**fuente** (por defecto «Manual»), con **equivalente orientativo en EUR** en vivo. Copy: «Conversión
orientativa para control interno. Revisa el tipo de cambio aplicable con tu asesor fiscal.» Se guarda el
**snapshot** (`exchange_rate_to_eur`, `exchange_rate_source`, `exchange_rate_date`). **Sin proveedor FX
hardcodeado**: entrada manual robusta (auto-fetch queda como extensión futura documentada).
**Guardrail:** no se puede emitir en divisa sin tipo de cambio (bloqueo en repo + UI).

## 29. Cliente autofill (manual)
Al elegir cliente se rellena el `customer_snapshot` con **todos** los datos disponibles (nombre, NIF/CIF,
dirección, email, teléfono, país…) — ya cargados en `loadClientsLite`. La sección «Facturar a» y el preview
se actualizan solos. **Aviso** si faltan NIF/dirección: «Este cliente no tiene NIF/CIF ni dirección. Puedes
emitir, pero revisa si necesitas completarlo en su ficha.» No se inventan datos.

## 30. Cliente por texto/audio
Parser mejorado (`matchClient`): (1) nombre completo, (2) **coincidencia parcial por token** (apellido/razón
social, tolerante a acentos, sin stopwords), (3) pista «factura a/para <Nombre>». Coincidencia única →
preselecciona; varias → aviso + pendiente; inexistente → no inventa. La propuesta abre el editor mostrando lo
detectado (cliente/importe/concepto/IVA/IRPF) y lo que falta.

## 31. Confirmación pre-emisión
Nuevo **modal «Revisar antes de emitir»** (checklist): cliente, NIF/CIF (aviso si falta), emisor (aviso si
incompleto), serie, fechas, moneda + tipo de cambio, nº de líneas, base/IVA/IRPF/**Total** (+ equivalente
EUR), y notas: «Se generará el PDF» y «**La numeración no se reutiliza**». **Bloquea** si falta cliente,
líneas con importe o tipo de cambio en divisa; **avisa** si faltan datos fiscales del emisor/cliente.

## 32. PDF polish
Último pulido sobre el PDF v2 aprobado: panel de totales un poco más ancho y, en divisa extranjera, **nota
discreta de tipo de cambio** bajo el total («Tipo de cambio de referencia: 1 USD = 0,92 EUR · fecha» +
«Equivalente orientativo»). Se mantiene: cabecera+logo, banda de metadatos, tarjetas, tabla alineada, TOTAL
destacado, footer al pie, acentos/€, multipágina y degradación elegante. El importe va en la **divisa de la
factura**.

## 33. Dashboard y divisas
El resumen se muestra **en EUR (moneda base)**: convierte cada factura con su `exchange_rate_to_eur`
guardado; **no suma divisas sin convertir**. Aviso: «Hay N facturas en moneda extranjera sin tipo de cambio:
no se incluyen en los totales en EUR.» Se mantiene simple (Facturado/Cobrado/Pendiente/IVA) con detalle
fiscal plegable.

## 34. Tests / evals
- **Evals puros (tsx)** → **PASS**: calc, parser (+ **coincidencia parcial de cliente**), PDF (+ **divisa
  USD con nota de tipo de cambio**, sin «???»), summary (+ **conversión EUR**, **fxMissing**), y
  **currencies** (EUR por defecto, USD/GBP válidas, XXX no).
- **RLS E2E (ROLLBACK, sin tocar datos reales)**: factura en **USD** con `exchange_rate_to_eur=0.92` persiste
  bajo rol autenticado y su equivalente EUR = 920,00. (P36D/E ya verificaron papelera/purga/hard-delete.)

## 35. Validaciones
`npx tsc --noEmit` **OK** · `npm run lint -- --max-warnings=0` **OK** · `npm run build` **OK** ·
`node --check scripts/check-agent-deploy.mjs` **OK** · evals **PASS** · PDF smoke **PASS** · secretos/
service_role **sin hallazgos** · `git status` limpio tras commit.

## 36. Archivos tocados
**Nuevos**: `src/lib/invoicing/currencies.ts`, `docs/supabase/p36f_invoices_exchange_rate.sql`, este informe.
**Modificados**: `invoice-repo.ts` (FX en form/row/save/emit-guardrail/PDF), `invoice-parse.ts` (match parcial
+ FX en draft), `invoice-summary.ts` (EUR + fxMissing), `invoice-pdf.ts` (nota FX + polish), `InvoiceEditor.tsx`
(serie/divisa/FX/aviso cliente/checklist), `InvoicePreview.tsx` (nota FX), `InvoiceDashboard.tsx` (EUR +
aviso FX), `facturacion/page.tsx` (form FX + dashboard), evals de parser/pdf/summary.

## 37. Migraciones
**Una, additiva y verificada** (`p36f_invoices_exchange_rate`, aplicada a `ylhdbawrllqygfvllhdo`):
`invoices` += `exchange_rate_to_eur numeric`, `exchange_rate_source text`, `exchange_rate_date date`. Sin
cambios de políticas RLS. SQL en `docs/supabase/p36f_invoices_exchange_rate.sql`.

## 38. Qué NO se hizo (límites / decisiones)
- **No** proveedor FX en tiempo real (sin API hardcodeada ni dependencia frágil): entrada **manual** robusta;
  auto-fetch queda como extensión futura documentada.
- **No** pagos/pasarelas, emails, notificaciones, OCR, import/export, Verifactu/TicketBAI, contabilidad
  oficial, n8n ni Asistente de facturas.
- **No** gestión avanzada de series (varias series activas, reinicio anual configurable): «A» editable cubre
  el caso; ampliable.
- **No** conversión fiscal oficial: todo lo de divisa es orientativo (copys claros).

## 39. Commit / 40. Push
Ver `feat(p36f)` en `main` (push a `origin/main`). Detalle tras publicar.

## 41. Pendientes honestos
- Verificación **visual** del PDF (bytes/estructura automatizados; el diseño requiere abrir el PDF).
- **Auto-fetch** de tipo de cambio (proveedor) no implementado (manual por ahora).
- **Parser multi-concepto**: 1 línea por propuesta (el editor permite añadir más).
- Restaurar mantiene la decisión contable previa (no re-pregunta).

## 42. Veredicto
**P36F COMPLETADO — FACTURACIÓN PRO FINAL: SERIES CLARAS, DIVISAS PROFESIONALES CON CONVERSIÓN A EUR
(SNAPSHOT DE TIPO DE CAMBIO), CLIENTE AUTOFILL POR UI/TEXTO/VOZ, CONFIRMACIÓN PRE-EMISIÓN CON CHECKLIST Y PDF
MÁS NATURAL. ASISTENTE IA AISLADO, N8N INTACTO, TODO COMPILA Y PASA VALIDACIONES.**
