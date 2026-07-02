# FASE P36A — Facturación PRO: módulo extra premium con texto/audio, preview y PDF (sin Asistente IA)

> **Fecha:** 2026-07-02 · **STOP/REPLAN:** antes de continuar con *Documentos avanzados* (P36), se prioriza
> convertir **Facturación** en un **módulo extra premium** con generación inteligente **por texto y por voz
> dentro del propio módulo** (NO en el Asistente IA general). Se mantiene intacto el aislamiento de P35: el
> Asistente **no** lee ni acciona facturas. Sin n8n, sin emails, sin OCR, sin dependencias nuevas, sin
> cambios destructivos de BD.

---

## 1. Objetivo
La facturación existía (P33 modelo/RLS/numeración, P34 UI/PDF/estados) pero **parecía una sección simple**,
colgaba de la **navegación principal** como si fuera core y **no tenía creación inteligente**. P36A la
reposiciona como **extra premium** y añade un **generador texto→factura / audio→factura** local y
determinista, con **preview editable** antes de emitir. No se toca el flujo de emisión (numeración atómica +
PDF) de P34: el generador solo **precarga un borrador** que el usuario revisa y guarda.

## 2. Alcance (lo que SÍ se ha hecho)
- **Navegación reorganizada** — *Core CRM* arriba; **sección separada "Módulos extra"** (con subtítulo
  "Borradores, emisión y PDF") que contiene **Facturación** con badge **PRO**.
- **Experiencia principal premium** en `/facturacion` — **hero** oscuro con badge "Módulo extra · PRO",
  copy comercial y CTA "Crear factura"; **KPIs** (borradores, emitidas, pagadas, pendiente de cobro, total
  facturado) calculados sobre **todas** las facturas; **empty state** premium con CTA manual.
- **Generador por TEXTO/AUDIO dentro del módulo** — componente `InvoicePromptBuilder` (textarea + dictado)
  que llama a un **parser local determinista** y produce una **propuesta editable**.
- **Parser determinista** `invoice-parse.ts` — importe (es-ES, €), IVA (explícito / por defecto 21% /
  "sin IVA" / "IVA incluido" → recalcula base con aviso), IRPF/retención, descuento, vencimiento (N días /
  fin de mes), serie, concepto y **resolución de cliente contra la lista real (bajo RLS)** — nunca inventa:
  si es ambiguo o no existe, avisa y lo marca como pendiente.
- **Audio** vía **Web Speech API del navegador** (`SpeechRecognition`/`webkitSpeechRecognition`), es-ES,
  SSR-safe, **sin subir audio**, sin terceros, sin dependencias; **fallback** claro si no está disponible.
- **Flujo de preview** — Texto/voz → Parsear → **Preview editable (drawer)** → Guardar borrador → Revisar →
  **Emitir (P34)** → PDF. No se salta ningún paso; **nunca** se emite automáticamente.
- **Evals** del parser (`invoice-parse.evals.ts`) — importe, IVA (4 casos), IRPF, descuento, vencimiento
  (días y fin de mes), serie, concepto, cliente (único / acentos / **ambiguo** / inexistente), campos
  faltantes y confianza baja. **Todos en verde.**

## 3. Aislamiento del Asistente IA (P35 intacto)
- **No se ha tocado** `src/lib/agent-tool-readers.ts` ni `src/app/(saas)/assistant/page.tsx`.
- El generador texto/audio vive **exclusivamente** en el módulo Facturación (`components/invoicing/`); **no**
  hay `crm_read_query` de facturas, **no** hay `prepare_invoice`, **no** hay `preparedAction`, **no** hay
  detección de intención de factura en el bot. El Asistente sigue respondiendo que "la facturación se
  gestiona manualmente desde el módulo Facturación".
- Verificado por `git status`: solo cambian `facturacion/page.tsx`, `Sidebar.tsx` y ficheros **nuevos** de
  facturación. `get_invoices_summary` sigue devolviendo `not_available`.

## 4. Ficheros
**Nuevos**
- `src/lib/invoicing/invoice-parse.ts` — parser puro/determinista texto→borrador (`parseInvoiceText`).
- `src/components/invoicing/InvoicePromptBuilder.tsx` — UI texto + dictado (Web Speech) → propuesta.
- `src/lib/invoicing/__evals__/invoice-parse.evals.ts` — evals ejecutables del parser.

**Modificados**
- `src/components/Sidebar.tsx` — sección "Módulos extra" + Facturación con badge PRO (split core/extra).
- `src/app/(saas)/facturacion/page.tsx` — hero premium + KPIs + `InvoicePromptBuilder` + empty state PRO +
  `handleGenerate` (precarga el borrador y abre el drawer con avisos/campos pendientes).

## 5. Seguridad y límites (respetados)
- **Sin** service_role/secretos en frontend (escrituras bajo RLS de P33 con el cliente autenticado).
- **Sin** n8n (credenciales/conexiones/memoria/webhook), **sin** emails/notificaciones, **sin** OCR/IA
  leyendo contenido, **sin** embeddings, **sin** pasarela de pago, **sin** Verifactu/TicketBAI/firma.
- **Sin** dependencias nuevas (audio = API nativa del navegador; PDF = `simple-pdf` de P34, sin jspdf).
- **Sin** cambios de BD (P36A es solo UI + lógica pura; el modelo de P33/P34 no se toca).
- **Sin** que el Asistente IA general lea o accione facturas (P35).

## 6. Validaciones
- `npx tsc --noEmit` → **OK** (sin errores).
- `npm run lint -- --max-warnings=0` → **OK** (0 warnings).
- `npm run build` → **OK** (`/facturacion` prerenderizada).
- Parser evals → **PASS** (todas verdes, ejecutadas con `tsx`).
- `node --check scripts/check-agent-deploy.mjs` → **OK**.
- Escaneo de secretos en ficheros nuevos/cambiados → **sin hallazgos**.

## 7. Flujo de uso (resumen)
1. Entrar en **Módulos extra → Facturación (PRO)**.
2. En "Crear con texto o audio": escribir o **dictar** (p. ej. *"Factura a Inmobiliaria Costa por una
   comisión de venta de 1.200 € + IVA, vencimiento en 15 días"*).
3. **Generar propuesta** → se abre el borrador **precargado y editable** (cliente, concepto, importe,
   IVA/IRPF/descuento, vencimiento, serie).
4. **Revisar/editar** → **Guardar borrador** → **Emitir** (numeración atómica + PDF) → **Descargar**.

---

**Veredicto:** **P36A COMPLETADO — FACTURACIÓN PRO: MÓDULO EXTRA PREMIUM CON TEXTO/AUDIO, PREVIEW Y PDF,
SIN ASISTENTE IA GENERAL.**
