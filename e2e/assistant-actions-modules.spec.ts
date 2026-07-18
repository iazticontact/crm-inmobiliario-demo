// P70 Wave C — Playwright de los MÓDULOS NUEVOS del catálogo de acciones (calendar / operations / cases)
// contra staging con la sesión QA real. Cada test: frase → card estructurada → Confirmar → verificado en
// BD real. Fixtures QA con sufijo «Uiqa» creados server-side y borrados al final.

import { test, expect, type Page } from '@playwright/test'
import { serviceClient, QA_WORKSPACE, cleanupQaThreads, qaUserId } from './support/db'

const COMPOSER = /Pregunta por clientes/
const suiteStartIso = new Date().toISOString()
let opId = ''
let caseId = ''

// Pacing del rate limit real (10 peticiones/min, botones incluidos).
let lastReq = 0
async function paceRequest(page: Page) {
  const wait = Math.max(0, lastReq + 7_000 - Date.now())
  if (wait > 0) await page.waitForTimeout(wait)
  lastReq = Date.now()
}

async function cleanupUiqa() {
  const db = serviceClient()
  await db.from('calendar_events').delete().eq('workspace_id', QA_WORKSPACE).ilike('client_name', '%Uiqa%')
  await db.from('opportunities').delete().eq('workspace_id', QA_WORKSPACE).ilike('title', '%Uiqa%')
  await db.from('service_cases').delete().eq('workspace_id', QA_WORKSPACE).ilike('title', '%Uiqa%')
  await db.from('assistant_actions').update({ status: 'cancelled' }).eq('workspace_id', QA_WORKSPACE).eq('status', 'prepared')
}

test.beforeAll(async () => {
  await cleanupUiqa()
  const db = serviceClient()
  const { data: op } = await db.from('opportunities').insert({ workspace_id: QA_WORKSPACE, title: 'Operacion Piso Uiqa', stage: 'new', value: 100000 }).select('id').single()
  const { data: sc } = await db.from('service_cases').insert({ workspace_id: QA_WORKSPACE, title: 'Tramite Nota Uiqa', status: 'open', priority: 'normal' }).select('id').single()
  opId = String(op?.id ?? '')
  caseId = String(sc?.id ?? '')
})

test.afterAll(async () => {
  await cleanupUiqa()
  await cleanupQaThreads(suiteStartIso, qaUserId())
})

async function newConsulta(page: Page) {
  await page.goto('/assistant')
  await page.getByRole('button', { name: 'Nueva consulta' }).first().click()
  // Post-condición DETERMINISTA de «hilo nuevo activo»: composer editable + CERO mensajes (evita el toast
  // transitorio y la carrera del hilo viejo auto-seleccionado). No debilita ninguna aserción.
  await expect(page.getByPlaceholder(COMPOSER)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('assistant-msg')).toHaveCount(0)
  await expect(page.getByPlaceholder(COMPOSER)).toBeEnabled()
}

async function sendChat(page: Page, text: string) {
  await paceRequest(page)
  const box = page.getByPlaceholder(COMPOSER)
  await box.fill(text)
  await box.press('Enter')
  await expect(page.getByText(text).last()).toBeVisible({ timeout: 20_000 })
}

const actionCard = (page: Page) => page.getByRole('group', { name: /Acción:/ })

test('calendario: crear cita desde el chat con card verificada', async ({ page }) => {
  await newConsulta(page)
  await sendChat(page, 'Agenda una visita con Roberta Uiqa mañana a las 11')
  const preview = actionCard(page).first()
  await expect(preview).toBeVisible()
  await expect(preview.getByText('Pendiente de confirmación')).toBeVisible()
  await paceRequest(page)
  await preview.getByRole('button', { name: 'Confirmar' }).click()
  await expect(page.getByText(/Cambio aplicado y verificado/)).toBeVisible()

  const { data } = await serviceClient().from('calendar_events').select('type, start_hour, start_at').eq('workspace_id', QA_WORKSPACE).ilike('client_name', '%Uiqa%').limit(2)
  expect(data?.length).toBe(1)
  expect(data?.[0]?.type).toBe('visit')
  expect(Number(data?.[0]?.start_hour)).toBe(11)
  expect(data?.[0]?.start_at).toBeTruthy()
})

test('operaciones: cambiar etapa desde el chat con card verificada', async ({ page }) => {
  await newConsulta(page)
  await sendChat(page, 'Pasa la operación Piso Uiqa a negociación')
  const preview = actionCard(page).first()
  await expect(preview).toBeVisible()
  await expect(preview.getByText('Negociación')).toBeVisible()
  await paceRequest(page)
  await preview.getByRole('button', { name: 'Confirmar' }).click()
  await expect(page.getByText(/Cambio aplicado y verificado/)).toBeVisible()

  const { data } = await serviceClient().from('opportunities').select('stage').eq('id', opId).maybeSingle()
  expect(String(data?.stage)).toBe('negotiation')
})

test('trámites: cambiar estado desde el chat con card verificada', async ({ page }) => {
  await newConsulta(page)
  await sendChat(page, 'Marca el trámite Nota Uiqa como resuelto')
  const preview = actionCard(page).first()
  await expect(preview).toBeVisible()
  await expect(preview.getByText('Resuelto')).toBeVisible()
  await paceRequest(page)
  await preview.getByRole('button', { name: 'Confirmar' }).click()
  await expect(page.getByText(/Cambio aplicado y verificado/)).toBeVisible()

  const { data } = await serviceClient().from('service_cases').select('status').eq('id', caseId).maybeSingle()
  expect(String(data?.status)).toBe('resolved')
})
