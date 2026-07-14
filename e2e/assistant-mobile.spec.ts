// P70 Wave B — E2E móvil (Pixel 7, proyecto `mobile`): el chat agéntico es usable en pantalla táctil.
// La sidebar de hilos queda oculta (<lg); «Nueva consulta» del header sigue disponible y las cards
// con botones son operables. Cleanup: cancelación desde la propia card + fixture de precio.

import { test, expect } from '@playwright/test'
import { getQaProperty, getPropertyPrice, restorePropertyPrice, expirePendingActions, cleanupQaThreads, qaUserId } from './support/db'

let prop: { id: string; title: string; price: number }
const suiteStartIso = new Date().toISOString()

test.beforeAll(async () => {
  prop = await getQaProperty()
  await expirePendingActions()
})

test.afterAll(async () => {
  await restorePropertyPrice(prop.id, prop.price)
  await expirePendingActions()
  await cleanupQaThreads(suiteStartIso, qaUserId())
})

test('mobile: card de acción operable con el pulgar y sin scroll horizontal', async ({ page }) => {
  await page.goto('/assistant')
  await page.getByRole('button', { name: 'Nueva consulta' }).first().click()
  await expect(page.getByText('Consulta interna lista')).toBeVisible({ timeout: 20_000 })
  const composer = page.getByPlaceholder(/Pregunta por clientes/)
  await expect(composer).toBeVisible()

  await composer.fill('Cambia el precio de Avenida San Pedro 66 a 284.000 €')
  await composer.press('Enter')
  await expect(page.getByText('Cambia el precio de Avenida San Pedro 66 a 284.000 €').last()).toBeVisible({ timeout: 20_000 })

  const card = page.getByRole('group', { name: /Acción:/ }).first()
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(card.getByText('Pendiente de confirmación')).toBeVisible()

  // Sin desbordamiento horizontal del documento (responsive real).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  await page.waitForTimeout(7_000) // hueco de rate limit entre mensaje y botón (10 peticiones/min)
  await card.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByText('Cambio descartado. No se ha aplicado nada.')).toBeVisible()
  expect(await getPropertyPrice(prop.id)).toBe(prop.price)
})
