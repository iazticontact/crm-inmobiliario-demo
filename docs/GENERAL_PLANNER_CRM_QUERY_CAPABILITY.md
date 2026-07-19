# `crm.query` — primitiva general componible cableada al planner

> Rama aislada `general-semantic-planner`. NO deploy, NO main, NO producción. El planner ya puede DECIDIR
> semánticamente que una consulta nueva requiere una lectura CRM componible y emitir un Structured CRM Query
> Plan hacia la Safe General CRM Query Layer. 2026-07-19.

## 1. Cómo entra en la ontology
Nueva capability `crm.query` en `capability-ontology.ts` (operation `query`, read-only, permission read). Su
descripción es **metadata semántica** (cuándo usarla), no ejemplos de frases: «úsala SOLO cuando el objetivo
requiera COMBINAR entidad + relación + filtros + periodo + agregado + selección + orden y NINGUNA capability
especializada sea la abstracción correcta». Aparece en `ontologyForPrompt()` como una capability más.

## 2. Schema final del plan (campo `query` del goal)
El goal del plan lleva un campo estructurado `query` (solo para `crm.query`):
```
query: {
  entity: string                    // semántica → allowlist (SEMANTIC_ENTITY)
  operation: list|search|detail|count|filter|relation|aggregate
  relation: string|null             // relación registrada (EXPAND_SPECS)
  aggregateFn: count|sum|avg|min|max|null
  aggregateField: string|null       // solo campos declarados agregables
  orderingField: string|null
  orderingDir: asc|desc|null
} | null
```
Se combina con `entityRef` (entidad base), `filters`, `temporal` y `selection`/`selectionCount` del propio goal.
El modelo NUNCA da SQL/tabla/campo/relación/workspace/id: el servidor valida contra allowlists.

## 3. Criterio semántico de selección (no-overuse)
Principio general en el system prompt: **preferir siempre la capability ESPECIALIZADA** cuando exista
(clients.count, calendar.list, operations.aggregate.value, commissions.aggregate, clients.relation.*, …);
`crm.query` SOLO cuando haya que COMPONER algo que ninguna capability fija cubre limpiamente. Además se precisó
que `operations.aggregate.value` es **suma total** (avg/min/max del valor → `crm.query`). No hay ejemplos de
frases; la decisión es semántica y derivada de la ontology.

## 4. Executor path
`capability-executor.ts` caso `crm.query`: construye un `CrmQueryPlan` desde `goal.query` + `entityRef/filters/
temporal/selection`, llama a `executeQueryPlan` (Safe Query Layer), y mapea `CrmQueryEvidence.status`
(SUCCESS/EMPTY/NOT_FOUND/AMBIGUOUS/INVALID_PLAN/…) a la taxonomía de goal. Sin doble selección (la layer la
aplica). Resuelve la entidad base contra la BD (nunca id del modelo).

## 5. Security gates
- `crm.query` es READ-ONLY. Las escrituras siguen EXCLUSIVAMENTE el action plane P65 (intent→registry→resolve→
  preview→confirm→execute→verify). No hay UPDATE por esta vía.
- El plan de consulta pasa por `validateQueryPlan`: entidad/campo/relación/agregado allowlisted; Facturación
  aislada; inyección/tabla arbitraria/workspace spoof rechazados. **Query-layer security 11/11**, **planner
  security 11/11** (crm.query no abrió ningún agujero).

## 6. Resultados (fraseos NO vistos, QA real — `scripts/planner-crm-query.mts`)
**crm.query BEHAVIOR 7/8:**
- ✓ precio medio cartera → `crm.query aggregate avg` (end-to-end SUCCESS)
- ✓ valor medio operaciones ganadas → `crm.query avg`
- ✓ inmueble más caro → `portfolio.list[top]` (composición válida por selection)
- ✗ «suma el valor de las operaciones de <cliente>» → el planner eligió `clients.search` (fallo de composición
  relación→agregado; ver P2)
- **No-overuse 4/4**: «cuántos clientes» → clients.count; «citas esta semana» → calendar.list; «comisiones» →
  commissions.aggregate; «enséñame la cartera» → portfolio.list. **Nunca `crm.query` cuando hay especializada.**

Regresión verde: query-layer generalización **7/7**, mecanismos generales **9/9**, tsc limpio, `next build` OK,
eslint sin errores.

## 7. No-overuse (demostrado)
El planner NO usa `crm.query` como catch-all: en las 4 consultas con capability especializada eligió la
especializada, y solo emitió `crm.query` para agregados avg/relación-compuesta que ninguna capability fija cubre.

## 8. P0/P1/P2
- **P0 = 0 · P1 = 0.**
- **P2**: composición relación→agregado sobre entidad nombrada («suma el valor de las operaciones de X»): el
  planner a veces elige `clients.search` en vez de `crm.query relation+aggregate`. Limitación de selección de
  capability del modelo (gpt-4.1-mini), no del cableado ni de la seguridad. Documentado, no parcheado por frase.

## 9. Estado Git
Rama `general-semantic-planner` (ver commit de cierre). `main`/producción `ad3c06e` intacta. No deploy.
Siguiente gate: staging aislado (infra, pendiente de ti).
