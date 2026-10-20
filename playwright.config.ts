import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      PORT: '3100',
      STUDIO_DATA_DIR: path.resolve('.frame-e2e-data'),
      STUDIO_DIST_DIR: '.next-e2e',
      OPENROUTER_API_KEY: '',
    },
  },
  projects: [{ name: 'chromium' }],
});
