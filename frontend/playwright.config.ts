import { defineConfig, devices } from '@playwright/test'

const BRAVE_EXECUTABLE_PATH =
  process.env.PLAYWRIGHT_BRAVE_PATH ??
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'

// CI runs Playwright's bundled Chromium (`npx playwright install chromium`);
// locally the already-installed Brave is used so no browser download is needed.
const IS_CI = !!process.env.CI

const MOBILE_SPEC = '**/*.mobile.e2e.ts'
const DESKTOP_PROJECT_NAME = IS_CI ? 'chromium' : 'brave'
const browserLaunch = IS_CI
  ? {}
  : { channel: undefined, launchOptions: { executablePath: BRAVE_EXECUTABLE_PATH } }

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
    {
      name: DESKTOP_PROJECT_NAME,
      testIgnore: MOBILE_SPEC,
      use: { ...devices['Desktop Chrome'], ...browserLaunch },
    },
    // Issue #419: critical screens at a phone viewport (touch, small screen).
    // Only the *.mobile.e2e.ts specs run here; the desktop project skips them.
    {
      name: 'mobile',
      testMatch: MOBILE_SPEC,
      use: { ...devices['Pixel 7'], ...browserLaunch },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !IS_CI,
    },
    // Fake Flow gateway for public-booking-payment.e2e.ts. The backend must run
    // with FLOW_API_BASE_URL pointing at it (see the spec header).
    {
      command: 'node e2e/support/fake-flow-server.mjs',
      url: 'http://127.0.0.1:4010/__health',
      reuseExistingServer: !IS_CI,
    },
  ],
})
