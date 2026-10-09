import { defineConfig, devices } from '@playwright/test'

const BRAVE_EXECUTABLE_PATH =
  process.env.PLAYWRIGHT_BRAVE_PATH ??
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'

// CI runs Playwright's bundled Chromium (`npx playwright install chromium`);
// locally the already-installed Brave is used so no browser download is needed.
const IS_CI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: IS_CI ? [['list'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    IS_CI
      ? {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        }
      : {
          name: 'brave',
          use: {
            ...devices['Desktop Chrome'],
            channel: undefined,
            launchOptions: {
              executablePath: BRAVE_EXECUTABLE_PATH,
            },
          },
        },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !IS_CI,
  },
})
