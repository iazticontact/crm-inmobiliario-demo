# P70 — Resultados de mutation testing (Wave F)

Objetivo: demostrar que la batería de tests DETECTA los bugs de clase que P70 no puede permitirse. Cada
mutación se inyecta REALMENTE en el código (o la BD), se ejecuta el detector, se confirma que se pone en
ROJO, y se REVIERTE. `scripts/p70-mutation-check.mts` automatiza las 7 funcionales (inyección en
`.ts` de `lib/` recogida por un proceso `tsx` fresco, sin build); verify y GRANT se verifican aparte por
requerir build / privilegios de BD.

| # | Mutación | Inyección | Detector (se pone en ROJO) | Resultado |
|---|---|---|---|---|
| 1 | `tasks.complete` propone `completed` en vez de `done` | `assistant-action-intent.ts` | probe `tasks-done-not-completed` · p70-parser-tests · action-catalog | ✅ DETECTADA |
| 2 | reintroducir `todo` como señal de tasks (secuestro P63) | `intent.ts` vocab | probe `todo-not-hijacked` · benchmark reg-p63 | ✅ DETECTADA |
| 3 | añadir una acción de facturación al registro | `action-registry.ts` | probe `invoice-not-in-registry` · benchmark gate invoicing · action-catalog (ACTION_UNKNOWN) | ✅ DETECTADA |
| 4 | `isUpcoming` marca cita PASADA como próxima | `assistant-temporal.ts` | probe `past-event-not-upcoming` · benchmark gate temporal | ✅ DETECTADA |
| 5 | `persistFindings` deja de deduplicar por fingerprint | `findings-engine.ts` | probe `findings-dedupe` (2 inserts) · p67-e2e · automation-catalog | ✅ DETECTADA |
| 6 | eliminar la guarda «confirmar sin pending → no ejecuta» | `local-answers.ts` | probe `confirm-without-pending` · p66-chat-action-e2e | ✅ DETECTADA |
| 7 | quitar el scoping por workspace en una lectura | `local-answers.ts` | probe `workspace-scoped-reads` (fuga cross-ws) · benchmark gate workspace · action-catalog 404 | ✅ DETECTADA |
| 8 | quitar el read-after-write (verify) de la acción | `api/agent/action/route.ts` (build) | action-catalog-e2e «confirm verificado» → **45/46 CON FALLOS** | ✅ DETECTADA |
| 9 | eliminar `GRANT SELECT … TO authenticated` | `revoke` real sobre `assistant_findings` | `p70-grants-check` → **11/12 CON FALLOS** (regrant inmediato → 12/12) | ✅ DETECTADA |

**9/9 mutaciones detectadas.** Árbol y BD restaurados tras cada inyección (verificado: San Pedro 66
price=375.000 y area=Malasaña intactos; 0 acciones/reglas residuales).

## Cómo re-ejecutar

- Funcionales (1-7): `npx tsx --tsconfig tsconfig.json scripts/p70-mutation-check.mts` (7/7, autorevert).
- Verify (8): inyectar `let verifyOk = false` en la route, `npm run build`, `next start -p 3211`,
  `AGENT_ACTION_URL=http://localhost:3211 npx tsx … scripts/p70-action-catalog-e2e.mts` → 45/46; revertir + rebuild.
- GRANT (9): `revoke select on assistant_findings from authenticated` → `node scripts/p70-grants-check.mjs`
  (11/12) → `grant select … to authenticated` → 12/12.

## Interpretación

El valor de estas mutaciones no es el número: es que cada invariante crítico de P70 (verdad temporal,
opt-in, confirmación, verify, dedupe, aislamiento por workspace, no-Facturación, vocabulario `done`,
grants RLS) tiene AL MENOS un detector que se pone en rojo si el invariante se rompe. Un cambio futuro
que reintroduzca cualquiera de estos bugs falla el pipeline antes de llegar a release.
