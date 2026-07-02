# FASE P36C — Facturación PRO: refinamiento premium (PDF v2, cabecera sobria, estados y ciclo de vida)

> **Fecha:** 2026-07-02 · Refinamiento profundo del módulo **extra premium** para dejarlo con acabado de
> producto final: **PDF rediseñado** (aprovecha mejor la hoja, más sólido y elegante), **cabecera sobria**
> (fuera el bloque oscuro pesado), **navegación por estados con recuentos**, **ciclo de vida definido**
> (borradores se eliminan; emitidas se envían/cobran/anulan), **IVA 21% por defecto editable**, preview fiel
> al PDF y copy profesional. **Aislado del Asistente IA** (P35 intacto). Sin n8n, sin emails, sin OCR, sin
> service_role, **sin dependencias nuevas** y **sin migraciones**.

---

## A. Auditoría (diagnóstico)
Partiendo de P36B (ya sólido): (1) el **PDF** era correcto pero **dejaba la hoja algo vacía** y podía verse
más premium; (2) la **cabecera** del módulo era un **bloque azul oscuro pesado**, poco sobrio; (3) los
**filtros por estado** eran píldoras sueltas sin recuentos y con solapamientos (vencida vs emitida); (4) no
existía **eliminar** ni **marcar enviada**; el ciclo de vida no estaba explícito; (5) el **IVA** ya era 21%
editable, pero sin sugerencias de tipos habituales. Lo que ya funcionaba (motor PDF, emisor/logo, editor con
preview, parser local, aislamiento) **no se tocó salvo para pulir**.

## B. Cambios implementados
1. **PDF v2 (`invoice-pdf.ts`)** — diseño propio que **aprovecha la hoja**: cabecera con logo + **FACTURA** y
   regla de acento; **banda de metadatos** (Número · Emisión · Vencimiento · Estado con pill de color);
   **tarjetas EMISOR / FACTURAR A** con barra de acento; **tabla** con cabecera slate, filas cómodas
   (zebra), importes **alineados a la derecha** y sub-línea de descuento/IRPF; **panel de totales** con
   **TOTAL** en banda de marca; **notas/condiciones** (o «¿Dudas con esta factura?» con contacto real, sin
   inventar); **footer fijado al pie**. Acentos/€ correctos, multipágina, degradación elegante (sin «No
   consta»). *Problema que resuelve:* documento más presentable, sólido y «factura real».
2. **Preview v2 (`InvoicePreview.tsx`)** — reescrita para **reflejar el PDF v2** (banda de metadatos,
   tarjetas, panel de totales, notas, footer). *Resuelve:* «lo que veo ≈ lo que descargo».
3. **Cabecera sobria (página)** — se elimina el bloque oscuro; ahora **título + subtítulo + CTA** limpios y
   **KPIs en tarjetas claras**: Borradores, **Pendiente de cobro**, **Vencido** (en rojo), **Cobrado**,
   **Facturado (mes)**. *Resuelve:* estética premium y menos «banner».
4. **Navegación por estados con recuentos** — barra de pestañas **Todas · Borradores · Emitidas · Enviadas ·
   Vencidas · Pagadas · Canceladas**, cada una con **contador**; **sin solapamientos** (una factura cae en
   una sola pestaña; «Vencidas» = emitidas/enviadas pasadas de vencimiento). Búsqueda por número/cliente.
   *Resuelve:* claridad de estados y foco en lo que importa.
5. **Ciclo de vida definido** — **borrador**: editar · emitir · **eliminar** (soft delete, reversible por
   diseño); **emitida**: ver · descargar · **marcar enviada** · **marcar cobrada** · **anular**; **enviada**:
   ver · descargar · cobrar · anular; **pagada/cancelada**: terminal (ver · descargar). Las emitidas **no se
   borran**: se anulan. Confirmaciones en acciones destructivas. *Resuelve:* reglas de negocio limpias y
   seguras. Repo: nuevo `deleteDraft` (solo borradores) + acción `sent`.
6. **IVA por defecto 21% editable** — se mantiene 21% por defecto y **totalmente editable**; se añaden
   **sugerencias** de tipos habituales (IVA 21/10/4/0, IRPF 0/7/15/19) vía `datalist`, sin bloquear valores.
7. **Editor** — botón **«Eliminar»** para borradores en el pie; presets de IVA/IRPF; copy afinado; se
   mantiene la vista de dos paneles con preview en vivo y el toggle Editar/Vista previa en móvil.
8. **Copy profesional** — títulos, KPIs («Pendiente de cobro», «Cobrado», «Facturado (mes)»), estados,
   toasts («Factura marcada como cobrada», «Borrador eliminado», «PDF actualizado») y vacíos revisados.

## C. Validaciones ejecutadas
- `npx tsc --noEmit` → **OK**.
- `npm run lint -- --max-warnings=0` → **OK** (0 warnings).
- `npm run build` → **OK** (`/facturacion`, `/settings` prerenderizadas).
- **Evals** (`invoicing.evals` + `invoice-parse.evals` + `invoice-pdf.evals`, runner temporal con `tsx`) →
  **PASS** (calc, parser IVA incluido/excluido/exento + notas, PDF v2 válido con acentos/€, sin «???», sin
  «No consta», degradación con emisor vacío). PDF de muestra generado (~6,2 KB) para inspección visual.
- **Aislamiento**: `git status` confirma que **no** se tocó `agent-tool-readers.ts` ni `assistant/`;
  `get_invoices_summary` sigue devolviendo `not_available`. **n8n** intacto.
- `node --check scripts/check-agent-deploy.mjs` → **OK**. Escaneo de secretos/service_role → **sin
  hallazgos** (solo comentarios «SIN/NUNCA service_role»).

## D. Archivos tocados
**Modificados**
- `src/lib/invoicing/invoice-pdf.ts` — PDF v2 (rediseño de layout).
- `src/lib/invoicing/invoice-repo.ts` — `deleteDraft` (ciclo de vida, drafts only).
- `src/components/invoicing/InvoicePreview.tsx` — preview reflejando el PDF v2.
- `src/components/invoicing/InvoiceEditor.tsx` — `onDelete`, presets IVA/IRPF, copy.
- `src/app/(saas)/facturacion/page.tsx` — cabecera sobria, KPIs, pestañas con recuentos, acciones por estado.

*(Sin cambios en el motor `pdf-doc.ts`, en el parser core, en Settings/logo ni en la aislación del
Asistente: lo que ya estaba bien no se tocó.)*

## E. Migraciones
**Ninguna.** El soft delete usa `invoices.deleted_at` (ya existente en P33) y la política UPDATE vigente. El
estado `sent` ya está en el modelo. No hay cambios de esquema.

## F. Commit y push
Ver commit `feat(p36c)` en `main` (push a `origin/main`). Detalle abajo tras publicar.

## G. Pendientes honestos
- **Verificación visual del PDF**: automatizable solo hasta bytes/estructura; el «se ve bonito» requiere
  abrir el PDF de muestra (se genera en el runner de evals). No puedo renderizarlo aquí.
- **Parser multi-concepto**: sigue siendo **una línea por propuesta** (el editor permite añadir más a mano).
- **Regenerar PDF**: no elimina el PDF anterior en Storage (puntero actualizado; huérfano inocuo).
- **Archivar**: no se añadió un estado «archivada» separado (el soft delete de borradores + anulación de
  emitidas cubre el ciclo real; añadir «archivada» sería scope nuevo).

## H. Veredicto
**P36C COMPLETADO — FACTURACIÓN EXTRA PREMIUM MÁS PULIDA: PDF v2 MÁS PROFESIONAL Y MEJOR APROVECHADO,
CABECERA SOBRIA, ESTADOS CLAROS CON RECUENTOS, CICLO DE VIDA DEFINIDO (BORRAR/ENVIAR/COBRAR/ANULAR), IVA 21%
EDITABLE Y ASISTENTE IA COMPLETAMENTE AISLADO. TODO COMPILA Y PASA VALIDACIONES.**
