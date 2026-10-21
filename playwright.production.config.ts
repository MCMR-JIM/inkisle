import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'production.spec.ts',
  use: { channel: 'msedge', baseURL: 'http://127.0.0.1:14173', viewport: { width: 1440, height: 960 } },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 14173 --strictPort', url: 'http://127.0.0.1:14173', reuseExistingServer: true },
});
