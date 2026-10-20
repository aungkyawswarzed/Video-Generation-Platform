import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../../src/lib/types';

test('studio supports persistent editing, assets, scripts, and a responsive layout', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Deterministic selector fixture. Production discovery still uses the real OpenRouter endpoint.
  await page.route('**/api/models*', (route) =>
    route.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        models: [
          {
            id: 'test/browser-fixture',
            name: 'Browser fixture model',
            supported_durations: [4, 8],
            supported_resolutions: ['720p', '1080p'],
            supported_aspect_ratios: ['16:9', '9:16'],
            supported_frame_images: ['first_frame', 'last_frame'],
            generate_audio: true,
            seed: true,
            pricing_skus: { 'per-video-second': '0.1' },
          },
        ],
      },
    }),
  );
  await page.goto('/');
  const bootstrap = await (await request.get('/api/bootstrap')).json();
  const demo = bootstrap.projects.find((p: Project) => p.name === 'The last light');
  if (demo) await page.getByLabel('Select project', { exact: true }).selectOption(demo.id);
  await page.getByRole('button', { name: 'Director mode', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where the ocean ends' })).toBeVisible();
  await expect(page.getByText('CONCEPT ILLUSTRATION · NOT GENERATED FOOTAGE')).toBeVisible();
  await page.screenshot({ path: 'test-results/studio-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByPlaceholder('Untitled film', { exact: true }).fill('Browser test film');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('button', { name: 'Director mode', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Opening scene', exact: true })).toBeVisible();
  await page.getByLabel('Shot title', { exact: true }).fill('Arrival');
  await page
    .getByLabel('What happens?', { exact: true })
    .fill('A traveler arrives at a quiet railway station.');
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Shot title', { exact: true })).toHaveValue('Arrival');
  await expect(page.getByLabel('What happens?', { exact: true })).toHaveValue(
    'A traveler arrives at a quiet railway station.',
  );
  await page.getByRole('button', { name: 'Add library asset', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('The traveler');
  await page
    .getByLabel('Description / continuity notes')
    .fill('A woman in a green coat carrying a red suitcase.');
  await page.getByRole('button', { name: 'Save asset', exact: true }).click();
  await page.getByRole('button', { name: 'The traveler', exact: true }).click();
  await page.getByRole('button', { name: 'View prompt', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Compiled from your project' })).toHaveValue(
    /The traveler/,
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Script', exact: true }).first().click();
  await page
    .getByLabel('Project script')
    .fill('EXT. RAILWAY STATION — DAY\nThe traveler steps onto the platform.');
  await page.getByRole('button', { name: 'Plan with AI' }).click();
  await expect(page.getByRole('button', { name: 'Create a proposal' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Storyboard', exact: true }).first().click();
  await page.getByRole('button', { name: 'Select a video model' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your video model' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /Browser fixture model/ }).click();
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('4');
  await expect(page.getByRole('checkbox', { name: 'Generate native audio' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Generate shot', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Select scene', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/studio-mobile.png', fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await page.getByLabel('Select project', { exact: true }).selectOption('__new__');
  await expect(page.getByRole('dialog', { name: 'A new story starts here.' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('uploaded footage renders with trims, captions, and music; downloads support ranges', async ({
  request,
}) => {
  test.setTimeout(120000);
  const ffmpeg = process.env.FFMPEG_PATH || createRequire(import.meta.url)('ffmpeg-static');
  await mkdir('test-results', { recursive: true });
  const clipPath = path.resolve('test-results', 'source.mp4');
  const musicPath = path.resolve('test-results', 'music.mp3');
  const run = promisify(execFile);
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
    clipPath,
  ]);
  await run(ffmpeg, [
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:a',
    'libmp3lame',
    musicPath,
  ]);
  const create = await request.post('/api/projects', { data: { name: 'Export integration film' } });
  let p: Project = await create.json();
  expect(create.status()).toBe(201);
  const uploaded = await request.post(`/api/projects/${p.id}/upload`, {
    multipart: {
      file: { name: 'source.mp4', mimeType: 'video/mp4', buffer: await readFile(clipPath) },
    },
  });
  expect(uploaded.status()).toBe(201);
  const video = await uploaded.json();
  const musicResponse = await request.post(`/api/projects/${p.id}/upload`, {
    multipart: {
      file: { name: 'music.mp3', mimeType: 'audio/mpeg', buffer: await readFile(musicPath) },
    },
  });
  expect(musicResponse.status()).toBe(201);
  const music = await musicResponse.json();
  const takeResponse = await request.post(`/api/projects/${p.id}/import-take`, {
    data: { shotId: p.scenes[0].shots[0].id, mediaId: video.id },
  });
  expect(takeResponse.status()).toBe(201);
  const take = await takeResponse.json();
  const shot = p.scenes[0].shots[0];
  shot.selectedTakeId = take.id;
  shot.duration = 1;
  shot.trimStart = 0.1;
  shot.trimEnd = 0.8;
  shot.overlay = 'Arrival — 01';
  p.musicId = music.id;
  p.musicVolume = 0.1;
  const save = await request.put(`/api/projects/${p.id}`, { data: p });
  expect(save.status()).toBe(200);
  p = await save.json();
  const queued = await request.post(`/api/projects/${p.id}/export`, {
    data: { revision: p.revision },
  });
  expect(queued.status()).toBe(202);
  const exportJob = await queued.json();
  let result: { status: string; mediaId: string; error?: string } | undefined;
  await expect
    .poll(
      async () => {
        const status = await request.get(`/api/projects/${p.id}/jobs`);
        const body = await status.json();
        result = body.jobs.find((j: { id: string }) => j.id === exportJob.id);
        if (result?.status === 'failed') throw new Error(result.error);
        return result?.status;
      },
      { timeout: 90000, intervals: [1000, 2000] },
    )
    .toBe('ready');
  const download = await request.get(`/api/media/${result!.mediaId}?download`);
  expect(download.status()).toBe(200);
  expect(download.headers()['content-type']).toBe('video/mp4');
  expect((await download.body()).length).toBeGreaterThan(1000);
  const partial = await request.get(`/api/media/${result!.mediaId}`, {
    headers: { Range: 'bytes=0-99' },
  });
  expect(partial.status()).toBe(206);
  expect((await partial.body()).length).toBe(100);
  const invalid = await request.get(`/api/media/${result!.mediaId}`, {
    headers: { Range: 'bytes=999999999-' },
  });
  expect(invalid.status()).toBe(416);
});

test('local API blocks cross-origin writes and validates bad payloads', async ({ request }) => {
  const crossOrigin = await request.post('/api/projects', {
    headers: { Origin: 'https://evil.example' },
    data: { name: 'Forbidden' },
  });
  expect(crossOrigin.status()).toBe(403);
  const sameOrigin = await request.post('/api/projects', {
    headers: { Origin: 'http://127.0.0.1:3100' },
    data: { name: 'Same-origin test' },
  });
  expect(sameOrigin.status()).toBe(201);
  const invalid = await request.post('/api/projects', { data: { name: '' } });
  expect(invalid.status()).toBe(400);
  const bootstrap = await request.get('/api/bootstrap');
  const body = await bootstrap.json();
  expect(body).not.toHaveProperty('apiKey');
  expect(body.projects.length).toBeGreaterThan(0);
});
