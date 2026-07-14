// P70 Wave B — E2E real de la UI agéntica contra staging.
//
// Autenticación: proyecto `setup` hace login REAL por la UI con las credenciales QA de `.auth/`
// (generadas por scripts/p70-create-qa-session.mjs) y guarda el storage state; los demás proyectos lo
// consumen. workers=1 SIEMPRE: el chat comparte estado por workspace (pending actions, rate limit
// 10 msg/min) y los tests son secuenciales por diseño.

import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL || 'https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host'

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/qa-storage-state.json' },
      dependencies: ['setup'],
      testIgnore: /mobile/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], storageState: '.auth/qa-storage-state.json' },
      dependencies: ['setup'],
      testMatch: /mobile/,
    },
  ],
})
