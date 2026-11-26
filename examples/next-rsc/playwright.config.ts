import { defineConfig, devices } from '@playwright/test';

/**
 * The `examples` smoke (production-ready plan, step 5.4). It runs against `next start` on a
 * production build, never `next dev`: the point is to see what a consumer ships.
 */
const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { NEXT_TELEMETRY_DISABLED: '1' },
  },
});
