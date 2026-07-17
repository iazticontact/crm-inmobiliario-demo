# P71 — Code review final (revisor independiente)

> Diff revisado: `553ed64...HEAD` archivo por archivo, más los cambios de la fase de auditoría final.
> Fecha: 2026-07-17. Complementa: `P71_FINAL_ARCHITECTURE_AUDIT.md`, `P71_ANTI_OVERFIT_AUDIT.md`.

## Alcance del diff (P71 completo)
Producto: `conversation-state.ts` (estado v2 + upgrade v1→v2 + proyección n8n), `conversation-references.ts`
(referencias estructurales; demostrativo temporal excluido), `conversation-temporal.ts` (motor temporal),
`conversation-pending.ts` (pendingIntent del registry + speech acts + partículas), `conversation-scope.ts`
(QueryScope + metadata temporal), `local-answers.ts` (composición, resolver explícito, readers scoped con
rango, observabilidad), `assistant-turn.ts` (dato concreto gana a onboarding), `route.ts` (estado compartido
+ contrato n8n), `n8n-assistant-client.ts` (campo conversationState). Tests: 8 suites P71 + harness de
mutación + sweep/higiene en automation-catalog.

## Hallazgos de la revisión final y su resolución
| # | Hallazgo | Resolución |
|---|---|---|
| 1 | Elisión podía resolver a la entidad ACTIVA con sujeto explícito distinto (P1) | Resolver por candidatos reales; señal fuerte/débil por ortografía; weak-miss → aclaración, jamás la activa |
| 2 | Entidad explícita + periodo caía a agenda global (P1) | Composición en temporal-followup + marcador relacional en minúsculas |
| 3 | «tienen cierre previsto» bloqueaba como si fuera un nombre | Clase morfológica de participios/adjetivos (recorte de cola) + spans débiles resolve-or-ignore |
| 4 | Partículas («sí, confirma») podían ser slot/needle | Clase de partículas discursivas; afirmación con pending → re-pregunta |
| 5 | «puedo cambiar…» sin ¿? abría intención | Forma modal de capacidad (no depende de la puntuación) |
| 6 | «¿puedes mostrarme…?» abría intención | READ_VERB con morfología abierta (mostra\w*) |
| 7 | «soy nuevo, ¿cuántas…?» → onboarding | El dato concreto gana también a la rama ONBOARDING |
| 8 | Ordinal tras un CONTEO no resolvía | Re-consulta de la lista del módulo con orden estable + indexación |
| 9 | «busca a roberto diaz» (minúsculas, sin «cliente») no resolvía | Verbo de búsqueda + candidatos reales (1/N/0) |
| 10 | «actívame un resumen…» no creaba preview (morfología) | Sufijo abierto en los detectores de creación de automatización |
| 11 | calendar.create multiturno preparaba sin type/title | Finalización por capability (detectCalendarType del parser P70; sin duplicar) |
| 12 | Corrección de slot sin progreso aparente se descartaba | `madeProgress` reconoce cambios de valor (corrección) |
| 13 | Residuos QA de automatización por procesos matados | Sweep pre-run + regresión permanente de no-duplicados (cazó un residuo nuevo el mismo día) |
| 14 | Split-brain parcial n8n | Contrato ampliado (`conversationState` reducido, backward-compatible). El consumo en el prompt del workflow queda para el patch n8n controlado (ver riesgos) |

## Calidad estructural
- **Sin `any` nuevos** en producto; casts `as never` solo en scripts de test (cliente supabase de servicio).
- **Sin dependencias circulares** nuevas (conversation-* → parsers P70/registry; local-answers → conversation-*).
- **Estado acotado**: 8 entidades, 12 referentes, 25 refs, TTL 24 h, pending 6 min. Escrituras fail-soft.
- **Prioridad de handlers**: pending → temporal → contextual → turn-decision → acciones → automatizaciones →
  ventas/agenda/resumen → enrutado. Cada capa tiene guardas de no-secuestro verificadas por mutación.
- **Sin lógica muerta** detectada; `conversation-scope.resolveQueryScope` se usa en suites/diagnóstico y
  como fuente de la metadata temporal (documentado como capa fina de planificación).
- **Tests**: validan comportamiento (tool/entidad/scope/estado), no texto exacto; entidades dinámicas;
  higiene post-run (cancelación de pendings, fixtures intactos) tras el incidente detectado y corregido
  durante esta auditoría (la suite confirmó un pending residual → precio 777.777 → restaurado al seed 1200 y
  la suite ahora lo hace imposible + lo vigila).

## Riesgos aceptados (documentados)
1. **n8n no consume aún** `conversationState` (solo lo recibe): el patch del prompt requiere el protocolo
   backup→GET→diff→PUT→verify→drift sobre el workflow VIVO compartido con P70; se hace como paso post-merge
   controlado (o siguiente ventana de mantenimiento n8n). Riesgo bajo: local-first intercepta las
   continuaciones; n8n ya recibe activeEntity.
2. Typos en el LEXEMA NUCLEAR (p. ej. «ctias») degradan a n8n (cerebro LLM) — comportamiento correcto del
   diseño local-first; documentado en la suite.
3. «citas de <topónimo desconocido> + periodo» con mayúscula → aclaración (protege el gate wrong-entity a
   costa de una pregunta de más). Sin mayúscula → resolve-or-ignore.
4. mutation oficial P70 = 7 en código (harness) + GRANT revoke/regrant (vivo, en grants-check 12/12) +
   verify-removal (comprobación dedicada por inyección+build de Wave F). Las 15 mutaciones del mandato P71:
   10 en harness propio; workspace/verify vía P70; n8n-estado y dato-viejo vía contrato F3.5 + realtime E2E.
