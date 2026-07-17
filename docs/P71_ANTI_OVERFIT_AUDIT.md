# P71 — Auditoría anti-hardcode y anti-sobreajuste

> Alcance: diff completo `553ed64...59cf00e` (módulos de producto P71 + modificaciones a local-answers/route/
> references) + verificación de patrones. Método: búsquedas textuales y semánticas + clasificación de cada
> match. Fecha: 2026-07-17.

## Búsquedas ejecutadas
1. Nombres demo/incidente (`David|Iglesias|San Pedro|Roberto|Diaz|Los Robles|Marina|Malasaña|Las Encinas|Plaza España`)
   sobre `src/lib/agents/conversation-*.ts` y el diff de `local-answers.ts`.
2. `\.includes\('...')` / `startsWith('...')` / `switch` sobre mensajes en módulos P71.
3. Regex con oraciones completas (>4 palabras literales consecutivas) en el diff.
4. Listas manuales que dupliquen registries.
5. Fixtures/IDs importados en producto.
6. Thresholds ajustados a tests.

## Resultados y clasificación

| Patrón | Matches en producto | Clasificación |
|---|---|---|
| Nombres demo/incidente | **0** (1 comentario ilustrativo genericizado en It3: `<chalet …>`) | limpio |
| `message.includes('frase')` | **0** en módulos P71 | limpio |
| `startsWith` | 1 — `k.startsWith('__')` (clave interna de metadatos de slot) | legítimo |
| `switch` sobre frases | **0** (switches sobre TIPOS: ReferenceKind, granularity, slot) | legítimo |
| Regex de oración completa | **0** en P71. Los léxicos son CLASES de palabra (posesivos, demostrativos, ordinales, verbos de mutación con sufijo abierto `\w*`, sustantivos de tipo, meses, partículas) | parser general |
| Listas manuales vs registry | Slots de acciones **derivados de `ASSISTANT_ACTIONS`** con auto-verificación dev de `allowedFields`. `DETECT` (campo+módulo→capability) es mapeo léxico de superficie a capability — inevitable y acotado; cada entrada referencia un `AssistantActionId` real (typo = error de compilación) | legítimo, acotado |
| Fixtures en producto | **0** (entidades de tests descubiertas en runtime) | limpio |
| Ids/posiciones esperadas en producto | **0** | limpio |
| Thresholds por test | TTLs (24h estado, 6min pending), límites (8 entidades, 12 referentes, 25 refs), umbral slot-filler (≤8 palabras) — constantes de diseño, no calibradas contra un test concreto | legítimo |

## Heurísticas identificadas y su respaldo
| Heurística | Respaldo | Veredicto |
|---|---|---|
| Elisión 3ª persona («tiene» sin «tengo/tienes») → entidad activa | estado + etiqueta visible en la respuesta | FRÁGIL ante nombre explícito distinto → **corregida en F3.1** (candidatos reales ganan a la elisión) |
| `extractEntityNeedle` (recortes de andamiaje) | candidatos reales del workspace + desambiguación + validación del plano de acciones | legítima tras F3.4 (partículas excluidas) |
| `looksLikeSlotFiller` (≤8 palabras sin verbo de acción) | solo decide si se INTENTA completar; el schema valida después | legítima tras F3.4 |
| Detección de shift temporal («la siguiente/anterior») | estado previo (granularidad real) + reconsulta | legítima |
| `CAPABILITY_NOUN` / `NOUN_TO_TYPE` | mapeo sustantivo→tipo; la resolución final es contra datos reales | legítima |

**Ninguna regex decide por sí sola** entidad definitiva, autorización, workspace, mutación ni éxito:
- entidad → candidatos reales (searchClients/searchProperties/ilike) + desambiguación;
- autorización/workspace → sesión + RLS + turn policy firmado (server);
- mutación → plano P65 (preview+confirm+verify);
- éxito → verificación read-after-write del plano.

## Gate anti-overfit
- Cero nombres demo en producto ✓
- Cero frases literales de incidentes ✓
- Cero respuestas precocinadas (las respuestas se componen de datos consultados; las plantillas de texto
  genéricas —preguntas de slot, cabeceras— no codifican casos) ✓
- Cero rutas exclusivas para tests ✓
- Cero duplicación manual de las 21 acciones (slots derivados del registry; auto-check en dev) ✓

## Acciones derivadas de esta auditoría
1. F3.1: la elisión cede ante candidato explícito (cierra la única heurística frágil encontrada).
2. F3.4: clase de partículas discursivas (asentimiento/negación) excluida de needles y fillers.
3. Held-out adicional en la suite de inteligencia P71 (frases nunca usadas durante el desarrollo).
