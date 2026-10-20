import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/desktop',
  outputDir: 'desktop-test-results',
  timeout: 180000,
  workers: 1,
  fullyParallel: false,
  use: { trace: 'retain-on-failure' },
});
