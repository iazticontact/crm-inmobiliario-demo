# Fase 2E-2 RT1.5 — UX premium + rendimiento + ficha profesional (informe)

**Fecha:** 2026-06-14 · **Base:** `90ea21c` · **Sigue a** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)

## 1. Objetivo
Mejorar la experiencia visible del CRM (listado y ficha de cliente), añadir
contacto básico sin WhatsApp complejo, pulir naming y auditar el lag local —
sin romper la demo offline ni la separación real/demo, y sin abrir
invoices/documents/inbox ni integraciones reales.

## 2. Archivos tocados
- [src/app/(saas)/clients/page.tsx](../src/app/(saas)/clients/page.tsx) — listado.
- [src/app/(saas)/clients/[id]/page.tsx](../src/app/(saas)/clients/[id]/page.tsx) — ficha.
- [docs/PHASE_2E2_RT1_5_UX_PERFORMANCE_REPORT.md](PHASE_2E2_RT1_5_UX_PERFORMANCE_REPORT.md) — este informe.

No se tocó: rutas, schema/SQL, `.env*`, `.mcp.json`, n8n, Auth, Storage,
`package.json`, ni la capa de datos (`supabase-queries`/`vertical-queries`).

## 3. Mejoras en el listado de clientes
- **Botón explícito `Ver ficha`** por cada cliente (con icono), además del
  nombre clicable, que navega a `/clients/[id]`.
- **Chip de score** (`Score N`) bajo el estado, solo cuando `leadScore > 0`
  (dato real; no se inventa nada).
- Se conserva la información útil ya presente: nombre, empresa, email/teléfono
  (con `mailto:`/`tel:`), área/servicio, estado y fecha de alta.
- Empty states ya existentes ("Todavía no hay clientes" / "Ningún cliente con
  esos filtros") intactos. En modo demo se muestran los clientes demo; en real,
  los del workspace o vacío — nunca mocks en real.

## 4. Mejoras en la ficha de cliente
- **Acciones rápidas en el header:** `Llamar` (`tel:`) y `Email` (`mailto:`)
  cuando el dato existe, junto al botón `Editar`.
- **Copiar al portapapeles:** botón de copiar junto al email y al teléfono
  (toast de confirmación), vía `navigator.clipboard`.
- La ficha mantiene su estructura profesional: header con estado/tipo/área,
  tabs (Resumen, Documentos, Expedientes, Visitas y citas, Tareas,
  Conversaciones, Facturación), datos personales/contacto/interés, notas
  editables, resumen operativo y actividad reciente.
- Empty states por sección ya presentes ("Sin operaciones activas", "Sin tareas
  pendientes", "Sin actividad registrada todavía", etc.), nunca datos de ejemplo.

## 5. WhatsApp / contacto
- **No se implementa WhatsApp real** (ni Meta, ni envío de mensajes).
- La pestaña **"WhatsApp" pasa a llamarse "Conversaciones"**; la sección
  "Conversaciones de WhatsApp" → "Conversaciones" y su empty state se neutraliza
  ("Sin conversaciones registradas para este cliente").
- La vista sigue siendo **solo lectura** (lista pasiva de conversaciones que ya
  existan en datos). El canal se muestra como **etiqueta** (`WhatsApp` u otro)
  en la badge — informativo, sin prometer automatización.
- El contacto real del cliente se hace por **Llamar / Email / Copiar**.

## 6. Naming Operaciones
- Verificado: no queda "Oportunidad/Oportunidades" en UI de las zonas tocadas
  (la única coincidencia es un patrón de detección de intención del asistente
  sobre texto del usuario, no UI). La ficha ya usa "Operaciones vinculadas" /
  "Pipeline comercial" desde RT1. La tabla/tipos internos siguen `opportunities`.

## 7. Performance / lag local
**Causas probables del lag:**
- `next dev` (Turbopack) en **Windows + OneDrive** sufre por la sincronización
  de archivos de OneDrive y el watch del FS; el directorio `.next/` y
  `node_modules/` dentro de OneDrive penaliza E/S y recompilaciones.
- Modo desarrollo (HMR, sin minificar) siempre es más lento que producción.

**Mejoras de código (ya presentes / confirmadas):**
- Listado: `filtered` y `counts` memoizados con `useMemo`; `loadClients` con
  `useCallback`.
- Ficha: `meta` y `tabCount` memoizados; cargas con `useCallback`.
- No se detectó fetch duplicado ni cálculos pesados en render (listas de ~8
  filas). No se añadió memoización innecesaria para no sobre-ingeniar.

**Recomendaciones (no aplicadas, requieren decisión de Oier):**
- Para desarrollo fluido, **mover el proyecto fuera de OneDrive** (p. ej.
  `C:\dev\crm-inmobiliario-demo`) elimina gran parte del lag de FS/watch.
- Evaluar `build` + `start` (producción) para demos comerciales: va mucho más
  fluido que `dev`.
- Excluir `.next/` y `node_modules/` de la sincronización de OneDrive si se
  mantiene la ruta actual.

## 8. Demo offline preservada
El gate `localStorage['nowcrm-demo-mode']==='true'` sigue intacto en ambas
páginas; en demo se muestran datos demo y las escrituras siguen bloqueadas con
toast "Modo demo (solo lectura)". El botón "Ver demo inmobiliaria" no se tocó.

## 9. Modo real sin datos inventados
En modo real se consulta Supabase (workspace del usuario, RLS); si no hay datos
→ empty states; si falla → error controlado. No se introdujo ningún mock ni
fallback silencioso. El chip de score y las acciones de contacto solo aparecen
cuando el dato real existe.

## 10. Validaciones
| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ |
| `npm run build` | ✅ (46 rutas) |

## 11. Smoke test
**Pendiente (Oier)** — `npm run dev -- --webpack`:
1. "Ver demo inmobiliaria" → Clientes carga.
2. Cada cliente muestra botón **Ver ficha** → abre `/clients/[id]`.
3. Ficha limpia; header con **Llamar / Email / Copiar**; sin WhatsApp real.
4. Pestaña **Conversaciones** (antes "WhatsApp") es solo lectura.
5. Operaciones vinculadas se ven como "Operaciones" / "Pipeline comercial".
6. Sin errores en consola.
7. (Real, si hay login) Clientes 8 / Inmuebles 7 / Operaciones 7; sin mocks.

## 12. Riesgos pendientes
- Botón de test n8n del asistente usa un payload de muestra (diagnóstico, no
  datos de CRM) — sin cambios.
- Smoke test en navegador pendiente.

## 13. Siguiente fase recomendada
**RT2** — ficha de cliente en profundidad + tasks + activities (lectura sobre
Supabase real), respetando [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md).
