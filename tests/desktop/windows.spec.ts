import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, stat, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const version = require('../../package.json').version as string;
let application: ElectronApplication | undefined;
let workspace: string;
let extracted: string;
let userProfile: string;
let servicePids: number[] = [];
let allPassed = true;
const run = promisify(execFile);

test('installer contains the same verified application and runtimes as the tested ZIP', async () => {
  const setupPath = path.resolve('release', `Frame-Studio-${version}-Windows-x64.exe`);
  const executable = await readFile(setupPath);
  expect(executable.subarray(0, 2).toString()).toBe('MZ');
  const pe = executable.readUInt32LE(0x3c);
  expect(executable.subarray(pe, pe + 4).equals(Buffer.from([0x50, 0x45, 0, 0]))).toBe(true);
  const installerFiles = path.join(workspace, 'Verified installer payload');
  await mkdir(installerFiles, { recursive: true });
  await run(require('7zip-bin').path7za, ['x', '-y', setupPath, `-o${installerFiles}`]);
  for (const file of [
    'Frame Studio.exe',
    'resources/app.asar',
    'resources/runtime/node.exe',
    'resources/runtime/ffmpeg.exe',
    'resources/service/worker.mjs',
    'resources/service/web/server.js',
  ]) {
    const zipBytes = await readFile(path.join(extracted, file));
    const installerBytes = await readFile(path.join(installerFiles, file));
    expect(createHash('sha256').update(installerBytes).digest('hex')).toBe(
      createHash('sha256').update(zipBytes).digest('hex'),
    );
  }
});

test.beforeAll(async () => {
  const temporaryRoot = path.join(process.env.LOCALAPPDATA!, 'Temp', 'opencode');
  await mkdir(temporaryRoot, { recursive: true });
  // Outside the repository: missing modules must not accidentally resolve from development node_modules.
  workspace = await mkdtemp(path.join(temporaryRoot, 'frame-packaged-'));
  extracted = path.join(workspace, 'Ready to run — Windows application');
  userProfile = path.join(workspace, 'Windows profile — no system runtimes');
  await mkdir(extracted, { recursive: true });
  await run(require('7zip-bin').path7za, [
    'x',
    '-y',
    path.resolve('release', `Frame-Studio-${version}-Windows-x64.zip`),
    `-o${extracted}`,
  ]);
});
test.afterAll(async () => {
  await application?.close().catch(() => {});
  if (allPassed && workspace) await rm(workspace, { recursive: true, force: true });
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) allPassed = false;
  await application?.close().catch(() => {});
  application = undefined;
});

async function launch() {
  application = await _electron.launch({
    executablePath: path.join(extracted, 'Frame Studio.exe'),
    cwd: workspace,
    env: {
      ...process.env,
      PATH: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
      FRAME_TEST_USER_DATA: userProfile,
      OPENROUTER_API_KEY: 'must-not-be-inherited',
      STUDIO_DATA_DIR: 'must-not-be-used',
    },
    timeout: 60000,
  });
  const page = await application.firstWindow();
  await expect(page.getByLabel('Select project', { exact: true })).toBeVisible({ timeout: 60000 });
  await expect
    .poll(async () =>
      application!.evaluate(
        () => (globalThis as unknown as { frameRuntime: { ready: boolean } }).frameRuntime.ready,
      ),
    )
    .toBe(true);
  const state = await application.evaluate(({ app, BrowserWindow }) => {
    const runtime = (
      globalThis as unknown as { frameRuntime: { origin: string; servicePids: number[] } }
    ).frameRuntime;
    return { ...runtime, packaged: app.isPackaged, userData: app.getPath('userData') };
  });
  servicePids = state.servicePids;
  expect(state.packaged).toBe(true);
  expect(state.userData).toBe(userProfile);
  expect(await page.evaluate(() => window.frameDesktop?.security)).toEqual({
    contextIsolated: true,
    sandboxed: true,
  });
  const unauthorized = await fetch(`${state.origin}/api/bootstrap`);
  expect(unauthorized.status).toBe(403);
  expect(
    await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require),
  ).toBe('undefined');
  return page;
}
async function closeNormally() {
  const process = application!.process();
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => process.exitCode, { timeout: 45000, intervals: [200, 500] }).toBe(0);
  for (const pid of servicePids) expect(() => globalThis.process.kill(pid, 0)).toThrow();
  await application!.close().catch(() => {});
  application = undefined;
}
async function chooseFile(page: Page, action: () => Promise<void>, file: string) {
  const chooser = page.waitForEvent('filechooser');
  await action();
  await (await chooser).setFiles(file);
}

test('packaged ZIP runs without system Node/npm, saves on close, and survives relaunch', async () => {
  const page = await launch();
  await expect(page.getByRole('heading', { name: 'The last light', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Video prompt', exact: true })).toBeVisible();
  await expect(page.getByLabel('Camera & composition')).toHaveCount(0);
  await page.screenshot({ path: 'desktop-test-results/packaged-first-launch.png' });
  await application!.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()!.items[0].submenu!.items[0];
    Reflect.apply(item.click, item, [item, BrowserWindow.getAllWindows()[0], {}]);
  });
  await page
    .getByRole('textbox', { name: 'Film title', exact: true })
    .fill('Windows packaged production');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('button', { name: 'Director mode', exact: true }).click();
  let firstSaveStarted!: () => void;
  const inFlightSave = new Promise<void>((resolve) => {
    firstSaveStarted = resolve;
  });
  let delayed = false;
  await page.route('**/api/projects/*', async (route) => {
    if (route.request().method() === 'PUT' && !delayed) {
      delayed = true;
      firstSaveStarted();
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    await route.continue();
  });
  await page.getByLabel('Shot title', { exact: true }).fill('Saved by the Windows close button');
  await inFlightSave;
  await page
    .getByLabel('What happens?', { exact: true })
    .fill('A working Windows application without a terminal.');
  // Close with one save in flight and a second edit not yet persisted. Both must finish.
  await closeNormally();
  const relaunched = await launch();
  await run(path.join(extracted, 'Frame Studio.exe'), [], {
    cwd: workspace,
    env: {
      ...process.env,
      FRAME_TEST_USER_DATA: userProfile,
      PATH: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
    },
    timeout: 15000,
  });
  expect(
    await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
  ).toBe(1);
  await expect(relaunched.getByLabel('Shot title', { exact: true })).toHaveValue(
    'Saved by the Windows close button',
  );
  await expect(relaunched.getByLabel('What happens?', { exact: true })).toHaveValue(
    'A working Windows application without a terminal.',
  );
  await relaunched.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(relaunched.getByText('Windows desktop edition.', { exact: false })).toBeVisible();
  await expect(relaunched.getByLabel('OpenRouter API key', { exact: true })).toHaveValue('');
  await expect(
    relaunched.getByRole('button', { name: 'Open workspace folder', exact: true }),
  ).toBeVisible();
  await relaunched.route('**/api/models*', (route) =>
    route.fulfill({ json: { models: [], fetchedAt: new Date().toISOString() } }),
  );
  await relaunched
    .getByLabel('OpenRouter API key', { exact: true })
    .fill('sk-or-desktop-smoke-only');
  await relaunched.getByRole('button', { name: 'Save key', exact: true }).click();
  await expect(relaunched.getByLabel('OpenRouter API key', { exact: true })).toHaveValue('');
  await expect(relaunched.getByText('API key saved securely', { exact: true })).toBeVisible();
  expect(
    (await readFile(path.join(userProfile, 'data', 'studio.sqlite'))).includes(
      Buffer.from('sk-or-desktop-smoke-only'),
    ),
  ).toBe(false);
  await closeNormally();
});

test('packaged video engine imports, trims, captions, mixes music, exports, and saves an MP4', async () => {
  const ffmpeg = path.join(extracted, 'resources', 'runtime', 'ffmpeg.exe');
  const source = path.join(workspace, 'source clip with spaces.mp4');
  const music = path.join(workspace, 'music.m4a');
  await run(ffmpeg, [
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x31463b:s=320x180:d=1:r=24',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    source,
  ]);
  await run(ffmpeg, [
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:a',
    'aac',
    music,
  ]);
  const page = await launch();
  await application!.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()!.items[0].submenu!.items[0];
    Reflect.apply(item.click, item, [item, BrowserWindow.getAllWindows()[0], {}]);
  });
  await page
    .getByRole('textbox', { name: 'Film title', exact: true })
    .fill('Packaged export validation');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('button', { name: 'Director mode', exact: true }).click();
  await page.getByRole('button', { name: /^Takes/ }).click();
  await chooseFile(
    page,
    () => page.getByRole('button', { name: 'Import MP4 take' }).click(),
    source,
  );
  await expect(
    page.getByRole('button', { name: 'Selected for timeline', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Direction', exact: true }).click();
  await page.getByLabel('On-screen text', { exact: true }).fill('Packaged Windows export — 01');
  await page.getByLabel('Start (seconds)', { exact: true }).fill('0.1');
  await page.getByLabel('End (0 = full clip)', { exact: true }).fill('0.8');
  await chooseFile(
    page,
    () => page.getByRole('button', { name: /Add a music track/ }).click(),
    music,
  );
  await expect(page.locator('.music-track')).toContainText('music.m4a');
  await page.getByRole('button', { name: 'Export film', exact: true }).click();
  await page.getByRole('button', { name: 'Render film', exact: true }).click();
  const download = page.getByRole('link', { name: 'MP4', exact: true }).first();
  await expect(download).toBeVisible({ timeout: 90000 });
  const destination = path.join(workspace, 'Finished Windows film.mp4');
  await application!.evaluate(({ BrowserWindow }, savePath) => {
    BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => {
      item.setSavePath(savePath);
      item.once('done', (_event, state) => {
        (globalThis as unknown as { smokeDownloadState: string }).smokeDownloadState = state;
      });
    });
  }, destination);
  await download.click();
  await expect
    .poll(
      () =>
        application!.evaluate(
          () => (globalThis as unknown as { smokeDownloadState: string }).smokeDownloadState,
        ),
      { timeout: 30000 },
    )
    .toBe('completed');
  expect((await stat(destination)).size).toBeGreaterThan(1000);
  const decoded = await run(ffmpeg, ['-i', destination, '-f', 'null', '-']);
  expect(decoded.stderr).toContain('Duration: 00:00:00.7');
  await page.screenshot({ path: 'desktop-test-results/packaged-export.png' });
  await page.getByRole('button', { name: 'Back to studio', exact: true }).click();
  await closeNormally();
  const keyBytes = await readFile(path.join(userProfile, 'data', '.encryption-key'));
  expect(keyBytes.length).toBe(32);
});
