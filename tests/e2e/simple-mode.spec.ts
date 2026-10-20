import { test, expect } from '@playwright/test';
import type { Project, VideoModel } from '../../src/lib/types';

test('simple mode offers @ mentions, capability-driven inputs, prompt limits, and readable errors without a paid request', async ({
  page,
  request,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  let paidRequests = 0;
  const base = {
    supported_durations: [5],
    supported_resolutions: ['720p'],
    supported_aspect_ratios: ['16:9'],
    generate_audio: false,
    seed: false,
  };
  const models: VideoModel[] = [
    { ...base, id: 'test/text-only', name: 'Text only fixture', supported_frame_images: null },
    {
      ...base,
      id: 'x-ai/grok-imagine-video-1.5-lite',
      name: 'Grok Lite fixture',
      supported_frame_images: ['first_frame'],
    },
    {
      ...base,
      id: 'bytedance/seedance-2.5',
      name: 'Seedance reference fixture',
      supported_frame_images: ['first_frame', 'last_frame'],
      generate_audio: true,
    },
    {
      ...base,
      id: 'test/avatar',
      name: 'Specialized avatar fixture',
      supported_durations: null,
      supported_frame_images: null,
    },
  ];
  const created = await request.post('/api/projects', {
    data: { name: 'Simple mode capability test' },
  });
  let project: Project = await created.json();
  const uploaded = await request.post(`/api/projects/${project.id}/upload`, {
    multipart: {
      file: {
        name: 'keeper-reference.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=',
          'base64',
        ),
      },
    },
  });
  expect(uploaded.status()).toBe(201);
  const image = await uploaded.json();
  project.assets = [
    {
      id: crypto.randomUUID(),
      kind: 'character',
      name: 'Mara',
      description: 'A lighthouse keeper in a navy coat.',
      imageId: image.id,
    },
    {
      id: crypto.randomUUID(),
      kind: 'prop',
      name: 'Brass compass',
      description: 'A worn compass with an amber needle.',
    },
  ];
  project.scenes[0].title = 'Harbor at dusk';
  project.scenes[0].setting = 'A quiet harbor at blue hour.';
  project.scenes[0].shots[0].action = '';
  const saved = await request.put(`/api/projects/${project.id}`, { data: project });
  expect(saved.status()).toBe(200);
  project = await saved.json();
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({ json: { ...json, configured: true } }); // UI-only fixture; no real key is stored.
  });
  await page.route('**/api/models*', (route) =>
    route.fulfill({ json: { models, fetchedAt: new Date().toISOString() } }),
  );
  await page.route('**/api/projects/*/generate', (route) => {
    paidRequests++;
    return route.fulfill({
      status: 400,
      json: { error: 'Paid generation must not run during UI tests.' },
    });
  });
  await page.goto('/');
  await page.getByLabel('Select project', { exact: true }).selectOption(project.id);
  await expect(page.getByRole('button', { name: 'Simple mode', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Camera & composition')).toHaveCount(0);
  const prompt = page.getByRole('textbox', { name: 'Video prompt', exact: true });
  await prompt.fill('@Ma');
  await prompt.press('Enter');
  await expect(prompt).toHaveValue('@[Mara] ');
  await prompt.fill(`${await prompt.inputValue()}holds @Bra`);
  await page.getByRole('option', { name: /Brass compass/ }).click();
  await prompt.fill(`${await prompt.inputValue()}at @Har`);
  await page
    .getByRole('listbox', { name: 'Mention suggestions' })
    .getByRole('option', { name: /Harbor at dusk/ })
    .click();
  await expect(page.locator('.mention-chips > span')).toHaveCount(3);
  const story = await prompt.inputValue();
  async function chooseModel(name: string, changes = false) {
    await page.locator('.guided-model-picker:visible').click();
    if (changes) page.once('dialog', (dialog) => dialog.accept());
    await page
      .getByRole('dialog', { name: 'Choose your video model' })
      .getByRole('button', { name: new RegExp(name) })
      .click();
  }
  await chooseModel('Grok Lite fixture');
  await expect(page.getByRole('button', { name: 'Animate an image', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reference images', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Generate native audio' })).toHaveCount(0);
  await expect(page.getByLabel('Starting image', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Animate an image', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create video', exact: true })).toBeDisabled();
  await page.getByLabel('Starting image', { exact: true }).selectOption(image.id);
  await expect(page.getByLabel('Ending image (optional)', { exact: true })).toHaveCount(0);
  await chooseModel('Text only fixture', true);
  await expect(prompt).toHaveValue(story);
  await expect(page.getByLabel('Starting image', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Animate an image', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create video', exact: true })).toBeEnabled();
  await prompt.fill('A'.repeat(1001));
  await expect(page.locator('.composer-validation')).toContainText('1,001');
  await expect(page.getByRole('button', { name: 'Create video', exact: true })).toBeDisabled();
  await prompt.fill('An evening boat crosses the harbor.');
  await chooseModel('Seedance reference fixture');
  await expect(page.getByRole('button', { name: 'Reference images', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reference images', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create video', exact: true })).toBeDisabled();
  await page.getByLabel('Reference images', { exact: false }).selectOption(image.id);
  await expect(page.getByRole('button', { name: 'Create video', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Inspect final prompt', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Compiled from your project' })).toHaveValue(
    /An evening boat crosses the harbor\./,
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(
    await prompt.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await page.screenshot({ path: 'test-results/simple-mode-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Director mode', exact: true }).click();
  await expect(page.getByLabel('Camera & composition', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Simple mode', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/simple-mode-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.route('**/api/projects/*/jobs', (route) =>
    route.fulfill({
      json: {
        jobs: [
          {
            id: 'policy-failure',
            projectId: project.id,
            shotId: project.scenes[0].shots[0].id,
            kind: 'video',
            status: 'failed',
            model: 'bytedance/seedance-2.5',
            error:
              'OpenRouter (400): InputImageSensitiveContentDetected.PrivacyInformation: The input image contained privacy information.',
            createdAt: new Date().toISOString(),
            updatedAt: '2026-10-20',
            approvedMax: 0,
            attempts: 0,
            nextPollAt: 0,
          },
        ],
        media: [image],
        workerOnline: true,
      },
    }),
  );
  await expect(
    page.getByText('Image or prompt rejected by the provider’s policy', { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  expect(paidRequests).toBe(0);
  expect(failures).toEqual([]);
});
