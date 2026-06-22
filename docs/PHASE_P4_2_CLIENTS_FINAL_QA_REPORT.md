# FASE P4.2 — Clientes final: señal de operaciones + cierre

> **Fecha:** 2026-06-22 · HEAD previo `78cfdc9`. Solo `/clients` (+ docs). **Sin** migraciones,
> sin Storage/documentos, sin tocar otros módulos. Requiere redeploy.

## 1. Diagnóstico visual (honesto)
**No hay screenshots reales disponibles en este entorno** (sin navegador/Playwright, y el modo
demo necesita sesión) → P4.2 es **auditoría estática + cambios seguros de alto valor**, no una
revisión por captura. El cierre visual fino (espaciados, contraste exactos) necesita ojo humano
sobre staging tras redeploy. Lo que se puede afirmar por código: el listado ya tiene tabla
premium (desktop) + cards (móvil, P4.1), stats, búsqueda/filtros, "Ver ficha" dominante,
acciones agrupadas, delete seguro; la ficha tiene resumen ejecutivo de 6 ítems, header con
mailto/tel/copy/editar/copiloto, secciones con "No consta" elegante.

## 2-3. Listado / móvil
Sin cambios estructurales (ya cerrados en P4.1). **Añadido**: la **señal de operaciones
abiertas** por cliente (ver §5), visible bajo el nombre tanto en la **tabla desktop** como en
las **cards móvil**.

## 4. Ficha 360
Sin cambios en P4.2 (P4.1 dejó el resumen ejecutivo de 6 ítems + documentos empty state). La
ficha ya se siente 360 (header + ejecutivo + datos + operaciones + expedientes + tareas +
citas + actividad + documentos). Pulido visual fino = pendiente de screenshots.

## 5. Señales por cliente — AÑADIDA (operaciones abiertas)
- **Auditoría**: el listado cargaba solo `clients`. Añadir señal por-fila con N+1 (una query
  por cliente) está **prohibido**; pero un **agregado** es eficiente.
- **Implementado**: una sola lectura agregada `listOpportunities(workspaceId)` **en paralelo**
  con `getClients` (`Promise.all`), agrupada en memoria por `client_id` (`groupOpenOps`). En
  modo ejemplo offline se calcula igual desde `demoOpportunities` (ids '1'..'N' coinciden).
- **UI**: bajo el nombre del cliente → "● N operación(es) abierta(s)" (solo si > 0). Ej. en el
  workspace de ejemplo: Roberto Díaz "2 operaciones abiertas", otros 6 clientes "1".
- **Performance**: 1 query extra agregada (no N+1). El listado sigue ligero.
- **Descartadas por coste**: próxima cita / tarea pendiente / expediente abierto en el listado
  requerirían 3 fetches más → no se añaden (se ven en la **ficha**, que ya las muestra).

## 6. Copiloto con cliente — PENDIENTE (no soportado hoy)
**Auditado**: la página del asistente **no** lee un query param de cliente
(`useSearchParams`/`?client=`) ni acepta deep-link de contexto; el activeEntity se escribe por
el servidor desde el agente, no desde un enlace. Pasar contexto exigiría **tocar el asistente**
(fuera de alcance). → El botón "Copiloto" de la ficha abre `/assistant` (sin preseleccionar) y
el **deep-link con activeEntity queda como pendiente** (futuro: `/assistant?client=<id>` que
fije el cliente activo). No se finge contexto.

## 7. Documentos
Siguen en **D1** (sin tabla/bucket). Bloque "Documentos y recursos" con empty state premium.
Sin upload falso, sin RAG/PDF. Roadmap `docs/CLIENT_DOCUMENTS_ROADMAP.md`.

## 8. QA
Verificado por código/SQL: la señal renderiza en 7/9 clientes del ejemplo (datos reales del
workspace). tsc/lint/build verdes. Sin UUID/lead_score/PII/textos demo en lo añadido. Visual
humano (desktop/móvil/vacío) pendiente de staging.

## 9. Validaciones
`tsc --noEmit` ✅ · `lint --max-warnings=0` ✅ · `build` ✅.

## 10-11. Commit / push / redeploy
Ver hash `feat(clients): per-client open-operations signal (P4.2)`. Push a `origin/main`.
**Requiere redeploy**.

## 12. Veredicto
**P4.2 PARCIAL SEGURO — CLIENTES FINAL (señal de operaciones añadida; copiloto deep-link y
visual fino pendientes).** Se añadió la señal de operaciones abiertas por cliente (1 agregado,
sin N+1) en tabla y cards; se auditó el copiloto (deep-link con contexto **no soportado** sin
tocar el asistente → pendiente) y los documentos siguen en D1. tsc/lint/build verdes.
**Requiere redeploy** + QA visual humano para declarar "CLIENTES FINAL PREMIUM" al 100%.

## Pendientes honestos
- QA visual humano con screenshots reales (desktop 1440, móvil 390, ficha, vacío).
- Copiloto: deep-link `/assistant?client=<id>` con activeEntity (requiere tocar el asistente).
- D1 — Documentos (tabla + bucket + RLS + signed URLs + upload).
- Más señales en el listado (cita/tarea) si se acepta el coste de fetches adicionales.
