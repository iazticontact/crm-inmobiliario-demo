// PROTOTIPO AISLADO (general-semantic-planner) — FEATURE FLAG (FASE 26).
// Contrato del rollout controlado. AISLADO: este helper NO está importado por la route productiva; define
// CÓMO se consumiría el planner sin activarlo. Por defecto OFF → P71 sigue siendo el sistema vigente.
//   OFF    → P71 responde. El planner ni se invoca.
//   SHADOW → P71 responde al usuario; el planner se ejecuta EN PARALELO solo para observar/registrar;
//            todas las escrituras del planner quedan en DRY-RUN. Sin doble respuesta, sin doble acción.
//   ON     → el planner responde. P71 legacy permanece disponible para rollback instantáneo a OFF.
// No hay dual writes ni doble ejecución en ningún estado. La seguridad no depende del flag: el executor
// mantiene las acciones en dry-run en el prototipo con independencia de este valor.

export type PlannerMode = 'off' | 'shadow' | 'on'

export function plannerMode(env: NodeJS.ProcessEnv = process.env): PlannerMode {
  const raw = (env.GENERAL_SEMANTIC_PLANNER ?? '').trim().toLowerCase()
  return raw === 'on' ? 'on' : raw === 'shadow' ? 'shadow' : 'off'
}

// ¿Debe RESPONDER el planner (vs. solo observar)? Solo en ON. En SHADOW observa; en OFF ni se invoca.
export function plannerAnswers(mode: PlannerMode): boolean { return mode === 'on' }
// ¿Debe EJECUTARSE el planner (para responder u observar)? En SHADOW y ON.
export function plannerRuns(mode: PlannerMode): boolean { return mode === 'shadow' || mode === 'on' }
// El prototipo NUNCA ejecuta escrituras reales, sea cual sea el modo (defensa independiente del flag).
export function writesAreDryRun(_mode: PlannerMode): boolean { return true }
