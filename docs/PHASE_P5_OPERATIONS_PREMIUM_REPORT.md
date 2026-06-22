# FASE P5 — Operaciones Premium (centro comercial del CRM)

> **Fecha:** 2026-06-23 · HEAD previo `bb53e3e`. Solo `/opportunities` + docs. **Sin** migraciones,
> sin tocar Dashboard/Clientes/n8n/RLS/auth/Storage. Requiere redeploy.

## 1. Diagnóstico
`/opportunities` (sidebar "Operaciones") **abría en "Expedientes"** y mezclaba 4 pestañas
(Expedientes · Propiedades · Operaciones · Plantillas) → parecía un panel administrativo, no un
centro comercial. KPIs poco comerciales (Expedientes/Propiedades/Operaciones). Botón primario
"Nuevo expediente". Lenguaje técnico ("Pipeline comercial", "Expediente"). No transmitía
rentabilidad ni seguimiento.

## 2. Decisión de lenguaje / producto
- **Operación** = negocio comercial abierto (vender, captar, alquilar, comprar, invertir).
- **Trámite** (tabla `service_cases`) = gestión/documentación asociada (contrato, reserva,
  tasación, financiación, documentación…). "Expediente" **eliminado** de la UI visible.
- **Propiedad** = inmueble (piso, chalet, local, ático, terreno).
- Fuera jerga: "Pipeline comercial" → "Operaciones en seguimiento".

## 3. Nueva estructura
- **Vista por defecto: Operaciones** (antes Expedientes).
- **Tabs visibles**: Operaciones · Trámites · Propiedades.
- **Plantillas**: pasa a **superficie de operador** (solo `NEXT_PUBLIC_NOWLABS_INTERNAL`), junto a
  Automatizaciones. No aportaba al pack básico y confundía → oculta al cliente.

## 4. Header
- Título **"Operaciones"**, subtítulo **"Gestiona oportunidades comerciales, trámites y
  propiedades en seguimiento."**
- Botones: **"Nueva operación"** (primario) · "Nuevo trámite" · "Nueva propiedad" · "Refrescar".
  ("Nuevo expediente" → "Nuevo trámite"; "Nueva operación" ahora es el protagonista.)

## 5. KPIs (comerciales, 4)
1. **Operaciones abiertas** (excluye etapas terminales won/lost/resolved/closed).
2. **Valor potencial** (suma del valor de las operaciones abiertas) — *no* facturación.
3. **Trámites abiertos**.
4. **Propiedades en cartera**.
Responden: cuánto negocio hay abierto, cuánto vale y qué requiere atención.

## 6. Vista Operaciones
Lista premium **agrupada por etapa** (opción más segura sobre el código actual; ya había
estructura de etapas). Cada etapa muestra **nº de operaciones + valor sumado**. Cada operación:
título + **cliente** (resuelto con 1 lectura agregada de clientes, sin N+1) + vertical + **cierre
estimado** + **valor** + **probabilidad** + selector de etapa + editar. Señal de rentabilidad:
badge **"Cierre pronto"** si el cierre estimado está dentro de 30 días (visible en ≥sm).

## 7. Vista Trámites
"Expedientes" → **"Trámites"**. Descripción: "Gestiones asociadas a clientes u operaciones:
documentación, contrato, tasación, financiación…". Cada trámite: título + **cliente** + tipo +
prioridad + vencimiento + estado editable. Empty state: **"Sin trámites abiertos" / "Aquí
aparecerán gestiones como documentación, contrato, tasación o financiación."** Se **eliminó** el
bloque "Tipos de expediente preparados" (chips NIE/residencia) que confundía. Toasts → "Trámite".

## 8. Vista Propiedades
Se mantiene **simple** (no había datos para un rediseño grande). Meta enriquecida: tipo ·
operación · ciudad/zona · precio · **propietario/cliente vinculado**. Estado editable. Empty
state claro.

## 9. Plantillas
Auditada (`WorkspaceTemplatesPanel`): no aporta al cliente básico y mezcla conceptos →
**gateada a `NEXT_PUBLIC_NOWLABS_INTERNAL`** (igual que Automatizaciones). El código se conserva
intacto; solo se oculta la pestaña al cliente.

## 10. Rentabilidad / usabilidad
Derivado de datos ya cargados (sin N+1, sin inventar): **valor potencial** (KPI + por etapa),
**cierres próximos** (badge "Cierre pronto" ≤30 días), **operaciones abiertas vs total**. El
nombre del cliente por operación/trámite se resuelve con **una** lectura agregada de clientes.

## 11. Empty state (workspace real vacío)
"**Todavía no hay operaciones**" + "Crea tu primera operación comercial cuando tengas un
comprador, vendedor o inmueble en seguimiento." CTAs: **"Nueva operación"** (primario) + **"Crear
cliente"** (link a /clients). No se muestran datos de ejemplo.

## 12. Responsive
KPIs `sm:grid-cols-2 lg:grid-cols-4`. Cabeceras de etapa con `min-w-0`/`truncate` (sin overflow).
Badge "Cierre pronto" oculto en móvil (`hidden sm:inline`) para no recargar filas estrechas.
Cards/listas en lugar de tabla plana.

## 13. Datos / performance
1 lectura agregada extra (clientes) en `Promise.all` con los listados (no N+1). En modo demo
offline se mapea desde `mock-data`. Sin UUID/lead_score/service_case/PII visibles.

## 14. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅.

## 15. Archivos
- `src/app/(saas)/opportunities/page.tsx` (estructura, KPIs, header, vistas, lenguaje, cliente
  por fila, cierres próximos, plantillas gateadas).
- Docs: este report.

## 16. Pendiente (futuro)
- Kanban arrastrable por etapa (hoy lista agrupada — más seguro).
- Propiedades: ficha/galería cuando haya datos e imágenes (Storage, D1).
- Deep-link operación → ficha de cliente.
- "Próxima acción" real por operación (requiere modelo de tareas vinculadas a operación).

## 17. Redeploy
**Requiere redeploy** (solo UI; sin migración).

## Veredicto
**P5 PARCIAL SEGURO — OPERACIONES PREMIUM (estructura comercial + lenguaje + KPIs + cierres).**
El módulo deja de abrir en "Expedientes" y de mezclar conceptos: ahora abre en **Operaciones**,
con KPIs comerciales (valor potencial), operaciones por etapa con cliente y cierres próximos,
Trámites claros y Plantillas ocultas. tsc/lint/build verdes. **Requiere redeploy** + ojo humano
sobre staging para firmar el "100%".
