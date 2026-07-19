# Safe General CRM Query Layer — decisión Supabase + evidencia

> Rama aislada `general-semantic-planner`. Read-only, allowlist-driven, workspace-pinned. NO SQL libre, NO
> service_role al LLM, NO tabla/campo/relación arbitrarios. `main`/producción = `ad3c06e` (V1) intacta. 2026-07-19.
> Módulo: `src/lib/agents/planner/crm-query-layer.ts`. Prueba: `scripts/planner-query-layer.mts`.

## Problema (FASE 1 · audit de readers)
La ejecución previa mapeaba capability→reader específico (≈20 readers estrechos). Para consultas nuevas que
no encajan en un reader concreto, el planner no podía componer. Síntoma de **tool explosion**: una herramienta
por pregunta imaginable. Eso limita la generalización.

## Solución: UNA capa general componible (FASE 2-13)
El planner emite un **CRM Query Plan** estructurado; la capa lo VALIDA contra allowlists y lo compila a
consultas Supabase seguras:
```
{ entity, operation(list|search|detail|count|filter|relation|aggregate),
  entityRef, relation, filters, temporal{field,range}, aggregate{fn,field},
  selection, selectionCount, ordering, limit }
```
- **Entity allowlist**: `SEMANTIC_ENTITY` mapea nombre semántico → clave de `CRM_QUERY_ENTITIES` (single source
  of truth, exportada de `agent-tool-readers`). Nombre de tabla arbitrario ⇒ `unknown_entity`.
- **Field/filter/order/temporal allowlist**: derivados de `CRM_QUERY_ENTITIES` (cols/filters/dateCol). Campo
  desconocido ⇒ rechazo, sin SQL dinámico.
- **Relation allowlist**: `EXPAND_SPECS` (grafo de relaciones registrado por FK). Relación no registrada ⇒ rechazo.
- **Aggregate allowlist**: `count` libre; `sum/avg/min/max` solo sobre campos numéricos declarados agregables.
- **Selection/cardinality** (all/one/first/last/random/top/bottom/n) sobre el dataset autorizado (RANDOM seedable).
- **Composición**: `search→resolve→relation→filter→temporal→aggregate` como DAG, SIN una tool por frase.

## Decisión de arquitectura Supabase (FASE 5-6)
**Elegido: B — Server Query Layer.** Rechazado: nodo n8n Supabase con acceso directo/SQL libre.
| Criterio | A: n8n → Supabase node directo | B: crm_query server layer (elegido) |
|---|---|---|
| Credenciales | n8n necesitaría clave privilegiada | El LLM/n8n NUNCA ven service_role |
| SQL | el modelo podría generar SQL | jamás SQL libre; solo plan validado |
| Policy | duplicada (n8n + backend) | **centralizada** en el backend |
| Workspace | riesgo de spoofing | pinned por auth del servidor |
| RLS/allowlist | difícil de garantizar | reutiliza la policy de `crmReadQuery` |
El planner **interpreta**; el servidor **valida y ejecuta**; Supabase es la verdad. n8n, si se usa, dispondría
de UNA sola tool `crm_query` que llama a este backend seguro (no conoce credenciales ni schema).

## Evidencia — `scripts/planner-query-layer.mts`
**Seguridad 11/11** (todo rechazado por el CÓDIGO): invoices/facturación aislada, entidad inventada, tabla por
inyección, campo no filtrable, inyección SQL en filtro, campo temporal no permitido, relación no registrada,
agregado sobre campo no agregable, orden por columna arbitraria; plan válido aceptado y workspace-pinned.

**Generalización 7/7** (consultas COMPUESTAS sin tool específica, datos reales):
```
clientes activos (filter)                         SUCCESS count=6
operaciones de «<cliente resuelto>» (relation)    SUCCESS count=1  (entity continuity)
suma valor de sus operaciones (relation+aggregate) SUCCESS agg(sum)=900000
precio medio de la cartera (aggregate avg)         SUCCESS agg(avg)=284663
valor ganado este mes (filter+temporal+aggregate)  SUCCESS agg(sum)=1510000
un inmueble al azar (selection random)             SUCCESS count=1  (no la lista)
top 3 operaciones por valor (ordering+top)         SUCCESS count=3
```
Todo workspace-pinned, sin SQL libre, sin fuga. `tsc` limpio.

## Escrituras (FASE 29)
La query layer es **READ-ONLY**. Las mutaciones siguen el action plane P65 (intent→resolve→preview→confirm→
execute→verify). No hay UPDATE general por esta vía.

## Gates abiertos (honesto)
Falta: cablear `crm.query` como capability emitida por el planner (schema+prompt) y evaluarla a escala; deploy a
staging; ON en staging; hard model benchmark; regresión P70/P71 completa. Sin eso NO hay veredicto de candidato.
