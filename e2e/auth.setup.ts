// P70 Wave B — setup de autenticación: login REAL por la UI con el usuario QA de .auth/
// (creado por scripts/p70-create-qa-session.mjs; TEST_SESSION_MISSING resuelto en la fase previa).
// Guarda el storage state con las cookies EXACTAS que escribe la app (@supabase/ssr).

import { readFileSync, existsSync } from 'node:fs'
import { test as setup, expect } from '@playwright/test'

setup('login QA y storage state', async ({ page }) => {
  if (!existsSync('.auth/qa-credentials.json')) {
    throw new Error('Falta .auth/qa-credentials.json — ejecuta: node scripts/p70-create-qa-session.mjs')
  }
  const creds = JSON.parse(readFileSync('.auth/qa-credentials.json', 'utf8')) as { email: string; password: string }

  await page.goto('/login')
  await page.getByPlaceholder('nombre@inmobiliaria.com').fill(creds.email)
  await page.getByPlaceholder('Introduce tu contraseña').fill(creds.password)
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 })
  await expect(page.getByText('Dashboard').first()).toBeVisible()

  await page.context().storageState({ path: '.auth/qa-storage-state.json' })
})
