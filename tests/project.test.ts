import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compilePrompt,
  demoProject,
  estimateCost,
  newProject,
  newShot,
  shotDuration,
  timelineDuration,
  validateCapabilities,
} from '../src/lib/project';
import { projectSchema, type VideoModel } from '../src/lib/types';

const model: VideoModel = {
  id: 'test/video',
  name: 'Test',
  supported_durations: [4, 8],
  supported_resolutions: ['720p'],
  supported_aspect_ratios: ['16:9'],
  supported_frame_images: ['first_frame'],
  generate_audio: false,
  seed: false,
  pricing_skus: { 'per-video-second': '0.15' },
};
test('new and demo projects satisfy the persisted schema', () => {
  projectSchema.parse(newProject());
  const p = demoProject();
  projectSchema.parse(p);
  assert.equal(p.scenes[0].shots.length, 3);
  assert.equal(p.assets.length, 3);
  assert.equal(new Set(p.scenes[0].shots.map((s) => s.id)).size, 3);
});
test('compiled prompt includes only assigned assets and excludes composited overlays', () => {
  const p = demoProject();
  const scene = p.scenes[0];
  const shot = scene.shots[0];
  shot.overlay = 'SECRET TITLE';
  const prompt = compilePrompt(p, scene, shot);
  assert.ok(prompt.includes(p.style));
  assert.ok(prompt.includes('Northpoint lighthouse'));
  assert.ok(!prompt.includes('The brass compass'));
  assert.ok(!prompt.includes('SECRET TITLE'));
});
test('custom prompt overrides compiled text', () => {
  const p = demoProject();
  const shot = p.scenes[0].shots[0];
  shot.promptOverride = '  My exact prompt.  ';
  assert.equal(compilePrompt(p, p.scenes[0], shot), 'My exact prompt.');
});
test('capability validation rejects all unsupported controls', () => {
  const shot = newShot();
  shot.duration = 5;
  shot.resolution = '4K';
  shot.aspectRatio = '1:1';
  shot.audio = true;
  shot.seed = 2;
  shot.firstFrameId = 'x';
  shot.lastFrameId = 'y';
  shot.inputMode = 'frames';
  const errors = validateCapabilities(shot, model);
  assert.equal(errors.length, 6);
  shot.duration = 4;
  shot.resolution = '720p';
  shot.aspectRatio = '16:9';
  shot.audio = false;
  delete shot.seed;
  delete shot.lastFrameId;
  assert.deepEqual(validateCapabilities(shot, model), []);
});
test('unknown capability metadata does not imply native audio or seed support', () => {
  const shot = newShot();
  shot.audio = true;
  shot.seed = 1;
  assert.equal(
    validateCapabilities(shot, { ...model, generate_audio: null, seed: null }).length,
    3,
  );
});
test('pricing estimates only interpret an unambiguous per-second SKU', () => {
  assert.equal(estimateCost(model, 8), 1.2);
  assert.equal(estimateCost({ ...model, pricing_skus: { generate: '0.5' } }, 8), undefined);
  assert.equal(
    estimateCost(
      { ...model, pricing_skus: { 'per-video-second': '0.1', 'per-video-second-1080p': '0.5' } },
      8,
    ),
    undefined,
  );
  assert.equal(estimateCost({ ...model, pricing_skus: null }, 8), undefined);
  assert.equal(
    estimateCost({ ...model, pricing_skus: { 'per-video-second': 'NaN' } }, 8),
    undefined,
  );
});
test('trim duration is independent of model generation duration', () => {
  const shot = newShot();
  shot.duration = 8;
  shot.trimStart = 1;
  shot.trimEnd = 5;
  assert.equal(shotDuration(shot), 4);
  shot.trimEnd = 0;
  assert.equal(shotDuration(shot), 7);
  shot.trimStart = 20;
  assert.equal(shotDuration(shot), 0);
});
test('fractional trims and timeline duration do not expose floating-point noise', () => {
  const shot = newShot();
  shot.duration = 1;
  shot.trimStart = 0.1;
  shot.trimEnd = 0.8;
  assert.equal(shotDuration(shot), 0.7);
  assert.equal(timelineDuration([shot, { ...shot, trimStart: 0.2, trimEnd: 0.8 }]), 1.3);
});
