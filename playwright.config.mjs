import { defineConfig, devices } from '@playwright/test';

// Všechny projekty běží v nainstalovaném Google Chrome (iPhone 13 = emulace viewportu a dotyku) – nic se nestahuje, šetří čas.
const chromium = { browserName: 'chromium', defaultBrowserType: 'chromium' };
export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.mjs/,
  timeout: 20000,
  reporter: [['list']],
  use: { channel: 'chrome', baseURL: 'http://localhost:8124', locale: 'cs-CZ', timezoneId: 'Europe/Prague', serviceWorkers: 'block' },
  webServer: { command: 'node tests/serve.mjs 8124', url: 'http://localhost:8124', reuseExistingServer: true },
  projects: [
    { name: 'iPhone 13', use: { ...devices['iPhone 13'], ...chromium } },
    { name: 'Pixel 7', use: { ...devices['Pixel 7'] } },
    { name: 'w320', use: { ...chromium, viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true } },
    { name: 'w390', use: { ...chromium, viewport: { width: 390, height: 844 } } },
    { name: 'w768', use: { ...chromium, viewport: { width: 768, height: 1024 } } },
    { name: 'w1280', use: { ...chromium, viewport: { width: 1280, height: 800 } } }
  ]
});
