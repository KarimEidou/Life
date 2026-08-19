import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PW_PORT ?? 4173);

// Only this sandbox image keeps Chromium here; a normal `npx playwright install`
// puts it under ~/.cache/ms-playwright. Pinning it unconditionally makes every
// test fail to launch anywhere else, so resolve it in three steps and fall back
// to Playwright's own managed browser by leaving executablePath unset.
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';

function resolveChromiumPath(): string | undefined {
  const override = process.env.PW_CHROMIUM_PATH;
  if (override !== undefined && override !== '') return override;
  if (existsSync(SANDBOX_CHROMIUM)) return SANDBOX_CHROMIUM;
  return undefined;
}

const chromiumPath = resolveChromiumPath();

export default defineConfig({
  testDir: 'e2e',
  timeout: 60000,
  workers: 2,
  use: {
    baseURL: 'http://localhost:' + PORT,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    ...(chromiumPath === undefined ? {} : { launchOptions: { executablePath: chromiumPath } }),
  },
  projects: [
    { name: 'iphone-light', use: { colorScheme: 'light' } },
    { name: 'iphone-dark', use: { colorScheme: 'dark' } },
  ],
  // `vite preview` only serves what is already in dist/, and dist/ is gitignored,
  // so the build has to run here: without it a run silently tests a stale bundle,
  // or dies with "dist does not exist" on a fresh clone. The timeout covers both.
  webServer: {
    command: 'npm run build && npm run preview -- --port ' + PORT + ' --strictPort',
    port: PORT,
    reuseExistingServer: false,
    timeout: 180000,
  },
});
