import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PW_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  timeout: 60000,
  workers: 2,
  use: {
    baseURL: 'http://localhost:' + PORT,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    launchOptions: {
      executablePath: '/opt/pw-browsers/chromium',
    },
  },
  projects: [
    { name: 'iphone-light', use: { colorScheme: 'light' } },
    { name: 'iphone-dark', use: { colorScheme: 'dark' } },
  ],
  webServer: {
    command: 'npm run preview -- --port ' + PORT + ' --strictPort',
    port: PORT,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
