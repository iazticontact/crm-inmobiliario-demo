# Arquitectura del Asistente IA (consolidada P48→P53)

> Documento de referencia. El Asistente **razona el turno antes de actuar**: ninguna palabra, entidad o
> módulo autoriza por sí sola una lectura de datos.

## Pipeline por turno (orden real)
1. **Entrada** — frontend (`app/(saas)/assistant/page.tsx`) → `POST /api/assistant/v2` con
   `{ message, threadId, lastResults, lastReferencedClient* }`. Quick actions y chat usan la MISMA ruta.
2. **Guardas** — crisis, rate-limit, longitud (`assistant-guard`).
3. **Provider** — `resolveAssistantProvider`: default n8n; legacy V1 solo con `ALLOW_LEGACY_ASSISTANT=true`.
4. **Decisión única de turno** — `decideTurn(message, {priorEntity, priorModule, hasLastResult})`
   (`assistant-turn.ts`) devuelve `AssistantTurnDecision` con prioridad:
   1. **META**: assistant_meta / user_correction / user_complaint / disagreement → nunca leen.
   2. **GUÍA DE PRODUCTO (P53)**: user_confused / onboarding / navigation_help / module_explanation →
      explican desde el catálogo, nunca leen.
   3. **PRAGMÁTICA (P49)**: social / help / capability / how_it_works / hypothetical → no leen;
      data_write → prepara; confirm/detail/filter → contexto.
   4. **DATOS**: data_read / data_followup (Facturación → redirect, sin tools).
   5. **AMBIGUO** → aclaración / cerebro general. Nunca lectura a ciegas.
5. **Catálogo de módulos** — `crm-module-catalog.ts`: fuente de verdad de los 12 módulos (Dashboard,
   Clientes, Cartera, Operaciones, Comisiones, Facturación, Calendario, Tareas, Trámites, Documentos,
   Configuración, Asistente) con aliases/navegación/qué muestra/acciones/límites. `explainModule`,
   `onboardingAnswer`, `confusedAnswer`, `navigationAnswer` — explican SIN leer y ofrecen leer después.
6. **Local-first** — `local-answers.ts` ejecuta lecturas básicas con la sesión RLS del usuario (clientes,
   inmuebles, operaciones, citas, tareas, trámites, documentos-metadata). Vacío ≠ error; códigos humanos
   (`assistant-errors.ts`); anti-contradicción (`context-policy.ts`: un error no borra un resultado válido).
7. **n8n (solo si hace falta)** — la app firma un **Turn Policy Token** (HMAC, `turn-policy.ts`) con
   `allowedTools` (`assistant-tool-permissions.ts`) y lo envía en el webhook. n8n (workflow
   `[CRM Inmobiliario] Agent V2`, parcheado en vivo P51C) reenvía `x-nowcrm-turn-policy` en sus 15 tools.
8. **Enforcement backend** — `/api/agent/tool` con `AGENT_TOOLS_REQUIRE_POLICY=true` (ACTIVO en staging):
   sin token → 403; token inválido/expirado → 403; tool fuera de dominio → 403; facturación → 403 siempre.
9. **Traza** — `[assistant.turn] {turnType, domain, module, action, shouldReadData, shouldCallN8n, reason}`.

## Reglas de contexto (context kinds)
- Seguimiento de **datos** (filtro/detalle/ordinal) → usa `lastResults`.
- **Confirmación** → responde desde el resultado previo (imposible contradecir).
- «No entiendo» → hereda el **módulo** del hilo (explicación), no la última entidad de datos.
- Mensaje que nombra un módulo nuevo → el nuevo GANA (cambio de tema sin arrastre).
- Corrección/queja → recovery: no repite la acción anterior.

## Explicación vs datos (regla crítica P53)
- «qué muestra / resume / significa», «para qué sirve», «qué es este apartado», «cómo se usa», «me
  explicas», «no entiendo», «soy nuevo», «dónde está» → **GUÍA** (sin lectura).
- «muéstrame», «lista», «busca», «cuántos tengo», «qué hay en cartera», «próximas citas» → **LECTURA**.
- Facturación: guía se explica; datos se redirigen al módulo. El Asistente **nunca** lee `invoices`.

## Ficheros clave
`assistant-turn.ts` (decisión) · `crm-module-catalog.ts` (guía) · `assistant-pragmatics.ts` (actos) ·
`intent.ts` (entidad) · `context-policy.ts` · `assistant-errors.ts` · `assistant-tool-permissions.ts` ·
`turn-policy.ts` (token) · `local-answers.ts` (motor) · `/api/assistant/v2` · `/api/agent/tool`.

## Evals (27 suites)
Por propiedades (equivalencia, metamórficas, adversariales): product-guide, decision-router, turn,
pragmatics, intent, context, error-policy, tool-permissions, turn-policy-strict, n8n-contract,
legacy-hardening, local-answers + suites de dominio (real-estate, invoicing, comisiones…).
