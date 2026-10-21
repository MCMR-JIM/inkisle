import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: 'production.spec.ts',
  fullyParallel: false,
  workers: 1,
  use: { channel: 'msedge', baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 960 } },
  webServer: {
    command: 'npm run dev -- --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
  },
});
