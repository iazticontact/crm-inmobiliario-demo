// P70 Wave D — Playwright de AUTOMATIZACIONES contra staging (sesión QA real, sin mocks):
// crear con card → confirmar → cambiar horario con preview antes/después → verificar próxima ejecución
// visible → ejecutar ahora (botón) → ver ejecuciones → pausar → reactivar → refresh. Cleanup server-side.

import { test, expect, type Page } from '@playwright/test'
import { serviceClient, QA_WORKSPACE, cleanupQaThreads, qaUserId } from './support/db'

const COMPOSER = /Pregunta por clientes/
// Margen de 2 min contra el skew reloj local vs now() de Postgres (cleanup por timestamp).
const suiteStartIso = new Date(Date.now() - 120_000).toISOString()

let lastReq = 0
async function paceRequest(page: Page) {
  const wait = Math.max(0, lastReq + 7_000 - Date.now())
  if (wait > 0) await page.waitForTimeout(wait)
  lastReq = Date.now()
}

async function cleanupRules() {
  const db = serviceClient()
  const { data: rules } = await db.from('assistant_automation_rules').select('id').eq('workspace_id', QA_WORKSPACE).gte('created_at', suiteStartIso)
  for (const r of rules ?? []) {
    await db.from('assistant_automation_runs').delete().eq('rule_id', r.id)
    await db.from('assistant_automation_rules').delete().eq('id', r.id)
  }
  await db.from('assistant_findings').delete().eq('workspace_id', QA_WORKSPACE).gte('detected_at', suiteStartIso)
}

test.beforeAll(async () => { await cleanupRules() })
test.afterAll(async () => {
  await cleanupRules()
  await cleanupQaThreads(suiteStartIso, qaUserId())
})

async function newConsulta(page: Page) {
  await page.goto('/assistant')
  // El botón queda deshabilitado hasta que el bootstrap resuelve workspace+usuario (P71); el click auto-espera.
  await page.getByRole('button', { name: 'Nueva consulta' }).first().click()
  // Post-condición DETERMINISTA de «hilo nuevo activo»: composer editable + CERO mensajes en el panel. Esto
  // evita a la vez (a) el toast transitorio «Consulta interna lista» (sonner lo auto-descarta → carrera) y
  // (b) la carrera del hilo viejo auto-seleccionado (tendría ≥1 mensaje). No debilita ninguna aserción.
  await expect(page.getByPlaceholder(COMPOSER)).toBeVisible({ timeout: 20_000 })
  // count=0 espera a que el SWITCH al hilo nuevo (alta por red) complete; bajo carga puede tardar, por eso
  // el mismo presupuesto de 20s que el composer (causa demostrada: round-trip de creación, no timeout ciego).
  await expect(page.getByTestId('assistant-msg')).toHaveCount(0, { timeout: 20_000 })
  await expect(page.getByPlaceholder(COMPOSER)).toBeEnabled()
}

async function sendChat(page: Page, text: string) {
  await paceRequest(page)
  const box = page.getByPlaceholder(COMPOSER)
  await box.fill(text)
  await box.press('Enter')
  await expect(page.getByText(text).last()).toBeVisible({ timeout: 20_000 })
}

const autoCard = (page: Page) => page.getByRole('group', { name: /Automatización:/ })

test('automatización: crear + cambiar horario con preview + próxima ejecución visible', async ({ page }) => {
  await newConsulta(page)
  // Crear con preview opt-in
  await sendChat(page, 'activa un resumen diario a las 8')
  await expect(autoCard(page).first().getByText('Pendiente de confirmación')).toBeVisible()
  await paceRequest(page)
  await autoCard(page).first().getByRole('button', { name: 'Activar' }).click()
  await expect(page.getByText(/Automatización activada y programada/)).toBeVisible({ timeout: 30_000 })
  const activeCard = autoCard(page).filter({ hasText: 'Activa' }).last()
  await expect(activeCard).toBeVisible()
  await expect(activeCard.getByText(/Próxima ejecución:/)).toBeVisible()

  // Cambiar horario: preview antes→después SIN escribir, luego confirmar
  await sendChat(page, 'cámbialo a las 9')
  await expect(page.getByText(/Antes: Todos los días a las 8:00/)).toBeVisible()
  await expect(page.getByText(/Después: Todos los días a las 9:00/)).toBeVisible()
  const editCard = autoCard(page).filter({ hasText: 'Pendiente de confirmación' }).last()
  await paceRequest(page)
  await editCard.getByRole('button', { name: 'Confirmar' }).click()
  await expect(page.getByText(/Horario actualizado y verificado/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Todos los días a las 9:00/).last()).toBeVisible()

  // Marcadores internos jamás visibles
  await expect(page.getByText('[AUTO')).toHaveCount(0)

  // La BD refleja el horario verificado
  const { data } = await serviceClient().from('assistant_automation_rules').select('schedule_json, enabled, next_run_at').eq('workspace_id', QA_WORKSPACE).gte('created_at', suiteStartIso).limit(1)
  expect(Number((data?.[0]?.schedule_json as Record<string, unknown>)?.hour)).toBe(9)
  expect(data?.[0]?.enabled).toBe(true)
})

test('automatización: ejecutar ahora, ver ejecuciones, pausar y reactivar (botones de card)', async ({ page }) => {
  await newConsulta(page)
  // Estado actual con botones de gestión
  await sendChat(page, 'muéstrame la configuración del resumen diario')
  const card = autoCard(page).last()
  await expect(card.getByText('Activa')).toBeVisible()

  // Ejecutar ahora (botón)
  await paceRequest(page)
  await card.getByRole('button', { name: 'Ejecutar ahora' }).click()
  await expect(page.getByText(/Ejecutada ahora mismo/)).toBeVisible({ timeout: 30_000 })

  // Ver ejecuciones (botón de la card de resultado)
  const resultCard = autoCard(page).last()
  await paceRequest(page)
  await resultCard.getByRole('button', { name: 'Ver ejecuciones' }).click()
  await expect(page.getByText(/Ejecuciones de/)).toBeVisible({ timeout: 30_000 })

  // Pausar por chat → card Desactivada con botón Reactivar
  await sendChat(page, 'pausa el resumen diario')
  await expect(page.getByText(/queda desactivada \(en pausa\)/)).toBeVisible()
  const pausedCard = autoCard(page).filter({ hasText: 'Desactivada' }).last()
  await expect(pausedCard).toBeVisible()
  await paceRequest(page)
  await pausedCard.getByRole('button', { name: 'Reactivar' }).click()
  await expect(page.getByText(/vuelve a estar activa/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Próxima ejecución:/).last()).toBeVisible()

  // Refresh: las cards se reconstruyen desde metadata.ui persistida
  await page.reload()
  await expect(autoCard(page).last()).toBeVisible({ timeout: 20_000 })

  // BD: la regla queda activa con next_run_at futuro (cleanup en afterAll)
  const { data } = await serviceClient().from('assistant_automation_rules').select('enabled, next_run_at').eq('workspace_id', QA_WORKSPACE).gte('created_at', suiteStartIso).limit(1)
  expect(data?.[0]?.enabled).toBe(true)
  expect(new Date(String(data?.[0]?.next_run_at)).getTime()).toBeGreaterThan(Date.now())
})
