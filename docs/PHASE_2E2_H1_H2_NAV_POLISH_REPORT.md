# Phase 2E-2 — H1/H2 Navigation Polish Report

> **Fecha:** 2026-06-15 · **Base:** `58aa617` · **Cambio mínimo, reversible.**
> Relacionado: [PRODUCT_ARCHITECTURE_AUDIT.md](PRODUCT_ARCHITECTURE_AUDIT.md)
> (§3.4 H1/H2), [PRODUCT_DECISION_WHATSAPP_META.md](PRODUCT_DECISION_WHATSAPP_META.md).

## 1. Objetivo
Limpiar la navegación del cliente antes del smoke navegador y staging:
- **H1:** ocultar **WhatsApp** del nav del cliente (no hay backend real de
  `conversations`/`messages` ni Meta WhatsApp Business API).
- **H2:** labels más naturales para usuarios no técnicos:
  - `Calendar` → `Calendario`
  - `Gestión` → `Operaciones`

## 2. Archivos tocados
- `src/components/Sidebar.tsx` (navegación principal).
- `src/components/Topbar.tsx` (títulos de página por ruta).
- `docs/PHASE_2E2_H1_H2_NAV_POLISH_REPORT.md` (este informe).

**Solo 2 archivos de código** (componentes de chrome). Cero backend, cero schema.

## 3. Qué se ocultó (H1)
- La entrada de nav **WhatsApp** (`/inbox`) pasa a `internal: true` en
  `Sidebar.tsx`, **exactamente el mismo patrón** que `Automatizaciones` y
  `Facturación`. Con `NEXT_PUBLIC_NOWLABS_INTERNAL=false` (clientes), **no aparece
  en el menú**; con `=true` (operadores internos) sigue visible.
- Se reubicó la entrada al grupo "operator-only" y se añadió comentario
  explicando el porqué (sin backend real todavía).

## 4. Qué se renombró (H2)
| Lugar | Antes | Después |
|---|---|---|
| Sidebar | `Gestión` | **`Operaciones`** |
| Sidebar | `Calendar` | **`Calendario`** |
| Topbar `/opportunities` | título `Negocio` / desc `Inmobiliaria · Gestoría · Pipeline` | título **`Operaciones`** / desc **`Pipeline comercial`** |
| Topbar `/calendar` | título `Calendar` | título **`Calendario`** |

## 5. Qué NO se tocó
- **No se borró** ninguna ruta ni archivo (`/inbox`, `/automations`, `/billing`
  siguen existiendo; build muestra las 46 rutas intactas).
- **No se renombraron** rutas/carpetas (`/calendar`, `/opportunities` igual) ni
  tablas (`opportunities` igual) ni variables internas / flags.
- **No se tocó** backend, schema, Supabase, Auth, Storage, n8n, Meta/WhatsApp,
  `.env.local`, `.mcp.json`.
- **No se implementó** WhatsApp.
- Textos del agente/IA y datos demo que mencionan WhatsApp como "siguiente fase"
  se dejaron igual (ya están correctamente enmarcados como futuro).

## 6. Demo / modo real preservados
- El gate demo-primero y la lógica de datos reales no cambian (solo labels y
  visibilidad de nav). El botón "Ver demo inmobiliaria" y el modo real siguen
  igual. La página `/inbox` sigue accesible por URL/operador, sin mocks para
  usuarios reales (Data Reality Policy intacta).

## 7. Navegación resultante (cliente, `NOWLABS_INTERNAL=false`)
`Dashboard · Clientes · Operaciones · Calendario · Asistente IA · Configuración`
→ simple, en es-ES, sin módulos dormidos visibles, sin promesa falsa de WhatsApp.

## 8. Validaciones
| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ TSC=0 |
| `npm run lint -- --max-warnings=0` | ✅ LINT=0 |
| `npm run build` | ✅ BUILD=0 (46 rutas, todas preservadas) |

## 9. Reversibilidad
Revertir = quitar `internal: true` de la entrada `/inbox` y restaurar los 4
labels. Cambio puramente de presentación.

## 10. Siguiente paso
**Smoke navegador** (core + asistente con `OPENAI_API_KEY` real ya configurada):
login real → dashboard/clientes/ficha/operaciones/calendario → asistente
(consultas + acciones preparar→confirmar) → demo. Después: staging (ver
[STAGING_HOSTINGER_STRATEGY.md](STAGING_HOSTINGER_STRATEGY.md)).
