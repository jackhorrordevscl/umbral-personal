import { defineConfig, devices } from '@playwright/test'

const BRAVE_EXECUTABLE_PATH =
  process.env.PLAYWRIGHT_BRAVE_PATH ??
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
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
    reuseExistingServer: !process.env.CI,
  },
})
