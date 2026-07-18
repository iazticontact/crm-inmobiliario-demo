// P70 Wave B — E2E REAL de la UI agéntica contra staging (sesión QA de .auth/, workspace demo).
//
// Cubre: smoke, card de acción (preview → Cancelar / Confirmar verificado), persistencia tras refresh,
// multitab (BroadcastChannel), automatizaciones (Descartar neutraliza / Activar programa) y findings
// (card + centro). Fixtures QA server-side con cleanup (precio restaurado, reglas y hilos borrados).
// Los mensajes van espaciados: el rate limit real es 10 msg/min por usuario.

import { test, expect, type Page } from '@playwright/test'
import {
  getQaProperty, getPropertyPrice, restorePropertyPrice, expirePendingActions,
  cleanupAutomationRules, cleanupQaThreads, qaUserId,
} from './support/db'

const COMPOSER = /Pregunta por clientes/

let prop: { id: string; title: string; price: number }
const suiteStartIso = new Date().toISOString()

test.beforeAll(async () => {
  prop = await getQaProperty()
  await expirePendingActions()
})

test.afterAll(async () => {
  await restorePropertyPrice(prop.id, prop.price)
  await expirePendingActions()
  await cleanupAutomationRules(suiteStartIso)
  await cleanupQaThreads(suiteStartIso, qaUserId())
})

async function newConsulta(page: Page) {
  await page.goto('/assistant')
  const btn = page.getByRole('button', { name: 'Nueva consulta' }).first()
  await expect(btn).toBeVisible()
  await btn.click()
  // Post-condición DETERMINISTA de «hilo nuevo activo»: composer editable + CERO mensajes. Un hilo viejo
  // auto-seleccionado tendría ≥1 mensaje; el toast «Consulta interna lista» es transitorio y esperarlo es
  // una carrera. Así se evita escribir en el hilo equivocado sin depender de un elemento efímero.
  await expect(page.getByPlaceholder(COMPOSER)).toBeVisible({ timeout: 20_000 })
  // count=0 espera al SWITCH al hilo nuevo (alta por red); mismo presupuesto de 20s que el composer.
  await expect(page.getByTestId('assistant-msg')).toHaveCount(0, { timeout: 20_000 })
  await expect(page.getByPlaceholder(COMPOSER)).toBeEnabled()
}

// El rate limit real es 10 peticiones/min por usuario en ventana deslizante, y los BOTONES de las
// cards también cuentan (uiAction/quick-reply). Se impone un hueco mínimo de 7s entre CUALQUIER
// petición al asistente: máx ~8,5/min, nunca dispara el límite.
let lastAssistantRequestAt = 0
async function paceRequest(page: Page) {
  const wait = Math.max(0, lastAssistantRequestAt + 7_000 - Date.now())
  if (wait > 0) await page.waitForTimeout(wait)
  lastAssistantRequestAt = Date.now()
}

async function sendChat(page: Page, text: string) {
  await paceRequest(page)
  const box = page.getByPlaceholder(COMPOSER)
  await box.fill(text)
  await box.press('Enter')
  // El mensaje del usuario debe quedar registrado en el hilo VISIBLE antes de seguir.
  await expect(page.getByText(text).last()).toBeVisible({ timeout: 20_000 })
}

// Click en un botón de card que dispara una petición al asistente (Confirmar/Cancelar/Activar/Descartar).
async function clickAssistantButton(page: Page, locator: ReturnType<Page['getByRole']>) {
  await paceRequest(page)
  await locator.click()
}

const actionCard = (page: Page) => page.getByRole('group', { name: /Acción:/ })

test('smoke: /assistant carga con la sesión QA real', async ({ page }) => {
  await page.goto('/assistant')
  await expect(page.getByText('Conectado a datos reales')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nueva consulta' }).first()).toBeVisible()
})

test('card de acción: preview con campos y Cancelar no aplica nada', async ({ page }) => {
  await newConsulta(page)
  await sendChat(page, 'Cambia el precio de Avenida San Pedro 66 a 281.000 €')
  const preview = actionCard(page).first()
  await expect(preview).toBeVisible()
  await expect(preview.getByText('Pendiente de confirmación')).toBeVisible()
  await expect(preview.getByText(/281\.000/)).toBeVisible()
  await expect(preview.getByRole('button', { name: 'Modificar' })).toBeVisible()

  await clickAssistantButton(page, preview.getByRole('button', { name: 'Cancelar' }))
  await expect(page.getByText('Cambio descartado. No se ha aplicado nada.')).toBeVisible()
  // La preview histórica pierde los botones (acción resuelta más abajo) y la nueva card marca Cancelado.
  await expect(page.getByText('Este cambio ya se gestionó más abajo.')).toBeVisible()
  await expect(preview.getByRole('button', { name: 'Confirmar' })).toHaveCount(0)
  await expect(actionCard(page).filter({ hasText: 'Cancelado' }).first()).toBeVisible()
  expect(await getPropertyPrice(prop.id)).toBe(prop.price)
})

test('card de acción: Confirmar aplica el cambio real y lo verifica', async ({ page }) => {
  await newConsulta(page)
  await sendChat(page, 'Cambia el precio de Avenida San Pedro 66 a 281.000 €')
  const preview = actionCard(page).first()
  await expect(preview.getByRole('button', { name: 'Confirmar' })).toBeVisible()
  await clickAssistantButton(page, preview.getByRole('button', { name: 'Confirmar' }))

  await expect(page.getByText(/Cambio aplicado y verificado/)).toBeVisible()
  await expect(actionCard(page).filter({ hasText: 'Aplicado y verificado' }).first()).toBeVisible()
  await expect.poll(() => getPropertyPrice(prop.id), { timeout: 15_000 }).toBe(281000)
  // Restauración como fixture server-side (no consume rate limit del chat).
  await restorePropertyPrice(prop.id, prop.price)
})

test('persistencia: la card sobrevive al refresh con botones activos', async ({ page }) => {
  await newConsulta(page)
  await sendChat(page, 'Cambia el precio de Avenida San Pedro 66 a 282.000 €')
  await expect(actionCard(page).first()).toBeVisible()

  await page.reload()
  // Tras F5 el hilo más reciente se auto-selecciona y la card se reconstruye desde
  // assistant_messages.metadata.ui (nunca desde el texto).
  const card = actionCard(page).first()
  await expect(card).toBeVisible()
  await expect(card.getByText('Pendiente de confirmación')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Confirmar' })).toBeVisible()

  await clickAssistantButton(page, card.getByRole('button', { name: 'Cancelar' }))
  await expect(page.getByText('Cambio descartado. No se ha aplicado nada.')).toBeVisible()
  expect(await getPropertyPrice(prop.id)).toBe(prop.price)
})

test('multitab: la segunda pestaña ve la card y su resolución sin recargar', async ({ page }) => {
  await newConsulta(page)
  await sendChat(page, 'Cambia el precio de Avenida San Pedro 66 a 283.000 €')
  await expect(actionCard(page).first()).toBeVisible()

  // Segunda pestaña (mismo contexto/navegador): auto-selecciona el hilo más reciente.
  const page2 = await page.context().newPage()
  await page2.goto('/assistant')
  await expect(actionCard(page2).first()).toBeVisible()
  await expect(actionCard(page2).first().getByText(/283\.000/)).toBeVisible()

  // La pestaña 1 cancela → la 2 recibe el BroadcastChannel y relee de BD (sin reload).
  await clickAssistantButton(page, actionCard(page).first().getByRole('button', { name: 'Cancelar' }))
  await expect(page.getByText('Cambio descartado. No se ha aplicado nada.')).toBeVisible()
  await expect(page2.getByText('Cambio descartado. No se ha aplicado nada.')).toBeVisible({ timeout: 30_000 })
  // Y la preview de la pestaña 2 ya no ofrece botones (acción resuelta).
  await expect(actionCard(page2).first().getByRole('button', { name: 'Confirmar' })).toHaveCount(0)
  await page2.close()
  expect(await getPropertyPrice(prop.id)).toBe(prop.price)
})

test('automatización: Descartar neutraliza y Activar programa de verdad', async ({ page }) => {
  await newConsulta(page)
  await sendChat(page, 'activa un resumen diario a las 9')
  const autoCard = page.getByRole('group', { name: /Automatización:/ })
  await expect(autoCard.first()).toBeVisible()
  await expect(autoCard.first().getByText('Pendiente de confirmación')).toBeVisible()

  // Higiene visible: el marcador interno [AUTO:…] del flujo P69 nunca se pinta.
  await expect(page.getByText('[AUTO:')).toHaveCount(0)

  // Descartar → quick reply del flujo P69; no se crea nada.
  await clickAssistantButton(page, autoCard.first().getByRole('button', { name: 'Descartar' }))
  await expect(page.getByText(/no activo la automatización/i)).toBeVisible()

  // Nuevo preview → Activar → regla real programada (cleanup en afterAll).
  await sendChat(page, 'activa un resumen diario a las 9')
  const pending = page.getByRole('group', { name: /Automatización:/ }).filter({ hasText: 'Pendiente de confirmación' })
  await expect(pending.last()).toBeVisible()
  await clickAssistantButton(page, pending.last().getByRole('button', { name: 'Activar' }))
  await expect(page.getByText(/Automatización activada y programada/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('group', { name: /Automatización:/ }).filter({ hasText: 'Activa' }).last()).toBeVisible()
})

test('findings: card en el chat y centro visual con filtros', async ({ page }) => {
  await newConsulta(page)
  await sendChat(page, '¿Qué incidencias hay?')
  const findingsCard = page.getByRole('group', { name: 'Incidencias detectadas' })
  await expect(findingsCard).toBeVisible({ timeout: 30_000 })

  // Higiene visible del hilo completo: sin markdown crudo ni marcadores internos.
  await expect(page.getByText('**')).toHaveCount(0)
  await expect(page.getByText('[AUTO:')).toHaveCount(0)

  await findingsCard.getByRole('link', { name: /Ver centro de incidencias/ }).click()
  await page.waitForURL(/\/assistant\/findings/)
  await expect(page.getByText('Centro de incidencias').first()).toBeVisible()
  await expect(page.getByText('Críticas abiertas')).toBeVisible()
  // La carga RLS real debe funcionar (grant p70): ni error de carga ni datos fantasma.
  await expect(page.getByText('No se han podido cargar las incidencias')).toHaveCount(0)
  // Filtros de estado y severidad operativos.
  await page.getByRole('group', { name: 'Filtrar por severidad' }).getByRole('button', { name: 'Avisos' }).click()
  await expect(page.getByRole('group', { name: 'Filtrar por severidad' }).getByRole('button', { name: 'Avisos' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('group', { name: 'Filtrar por estado' }).getByRole('button', { name: 'Todas' }).click()
  await expect(page.getByRole('group', { name: 'Filtrar por estado' }).getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true')
})
