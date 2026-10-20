import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCapabilities, adaptShotToModel, validateInputMedia } from '../src/lib/capabilities';
import { buildPrompt } from '../src/lib/prompt';
import { newProject, newShot, id, validateCapabilities } from '../src/lib/project';
import { explainProviderError, learnedRestriction } from '../src/lib/provider-errors';
import { projectSchema } from '../src/lib/types';
import type { VideoModel } from '../src/lib/types';
const base: VideoModel = {
  id: 'test/video',
  name: 'Test model',
  supported_durations: [5, 10],
  supported_resolutions: ['720p'],
  supported_aspect_ratios: ['16:9'],
  supported_frame_images: ['first_frame'],
  generate_audio: false,
  seed: false,
};

test('frame support never implies general reference support, including reported failing models', () => {
  for (const modelId of [
    'x-ai/grok-imagine-video-1.5-lite',
    'minimax/hailuo-3-max',
    'kwaivgi/kling-v3.0-pro',
    'test/unknown-image-model',
  ]) {
    const caps = getCapabilities({
      ...base,
      id: modelId,
      architecture: { input_modalities: ['text', 'image'] },
    });
    assert.deepEqual(caps.modes, ['text', 'frames']);
    assert.equal(caps.references, false);
  }
});
test('text-only models expose no image roles; specialized editing/avatar models are unavailable', () => {
  assert.deepEqual(getCapabilities({ ...base, supported_frame_images: null }).modes, ['text']);
  assert.equal(getCapabilities({ ...base, supported_durations: null }).available, false);
  assert.equal(getCapabilities().available, false);
});
test('verified reference workflows are separate from opening/ending frame workflows', () => {
  assert.deepEqual(getCapabilities({ ...base, id: 'bytedance/seedance-2.5' }).modes, [
    'text',
    'frames',
    'references',
  ]);
  assert.equal(getCapabilities({ ...base, id: 'alibaba/wan-2.7' }).maxReferences, 1);
  assert.equal(
    getCapabilities({ ...base, supported_input_references: ['image'] }).references,
    true,
  );
});
test('known prompt limits and learned rejection guards are enforced conservatively', () => {
  assert.equal(getCapabilities({ ...base, id: 'kwaivgi/kling-v3.0-pro' }).promptLimit, 2500);
  assert.equal(getCapabilities(base).promptLimit, 1000);
  const caps = getCapabilities({
    ...base,
    id: 'bytedance/seedance-2.5',
    compatibility: { referencesDisabled: true, framesDisabled: true, promptLimit: 500 },
  });
  assert.deepEqual(caps.modes, ['text']);
  assert.equal(caps.promptLimit, 500);
});
test('switching model clears unsupported roles only through an explicit change list and preserves the story', () => {
  const shot = newShot();
  shot.action = 'Mara walks toward the sea.';
  shot.inputMode = 'references';
  shot.referenceImageIds = ['image'];
  shot.firstFrameId = 'first';
  shot.lastFrameId = 'last';
  shot.audio = true;
  shot.seed = 20;
  shot.duration = 8;
  const result = adaptShotToModel(shot, { ...base, supported_frame_images: null });
  assert.equal(result.shot.inputMode, 'text');
  assert.deepEqual(result.shot.referenceImageIds, []);
  assert.equal(result.shot.firstFrameId, undefined);
  assert.equal(result.shot.lastFrameId, undefined);
  assert.equal(result.shot.audio, false);
  assert.equal(result.shot.seed, undefined);
  assert.equal(result.shot.action, shot.action);
  assert.ok(result.changes.length >= 5);
  assert.equal(shot.referenceImageIds.length, 1, 'the original draft must not be mutated');
});
test('prompt compilation bounds context without cutting user direction', () => {
  const p = newProject();
  const scene = p.scenes[0];
  const shot = scene.shots[0];
  shot.action = 'A'.repeat(2300);
  p.style = 'Long style '.repeat(600);
  scene.setting = 'Long setting '.repeat(600);
  const result = buildPrompt(p, scene, shot, { ...base, id: 'kwaivgi/kling-v3.0-pro' });
  assert.ok(result.prompt.startsWith(shot.action));
  assert.ok(result.prompt.length <= 2500);
  assert.deepEqual(result.errors, []);
  assert.ok(result.notes.some((note) => note.includes('shortened')));
  shot.action = 'B'.repeat(2501);
  const over = buildPrompt(p, scene, shot, { ...base, id: 'kwaivgi/kling-v3.0-pro' });
  assert.ok(over.errors.length);
  assert.equal(over.prompt, shot.action);
});
test('simple mode excludes camera/dialogue boxes while director mode includes them', () => {
  const p = newProject();
  const scene = p.scenes[0];
  const shot = scene.shots[0];
  shot.action = 'A bird flies.';
  shot.camera = 'UNIQUE CAMERA DIRECTION';
  shot.dialogue = 'UNIQUE DIALOGUE';
  assert.ok(!buildPrompt(p, scene, shot, base).prompt.includes('UNIQUE CAMERA'));
  shot.directionMode = 'director';
  const directed = buildPrompt(p, scene, shot, base).prompt;
  assert.ok(directed.includes('UNIQUE CAMERA DIRECTION'));
  assert.ok(!directed.includes('UNIQUE DIALOGUE'));
  shot.audio = true;
  assert.ok(
    buildPrompt(p, scene, shot, { ...base, generate_audio: true }).prompt.includes(
      'UNIQUE DIALOGUE',
    ),
  );
});
test('character, prop, and scene mentions resolve to stable IDs and descriptions, not photo attachments', () => {
  const p = newProject();
  const scene = p.scenes[0];
  scene.title = 'The coast';
  scene.setting = 'A windswept coastal cliff.';
  const character = {
    id: id(),
    kind: 'character' as const,
    name: 'Mara',
    description: 'A keeper in a navy coat.',
    imageId: 'private-photo',
  };
  const prop = {
    id: id(),
    kind: 'prop' as const,
    name: 'Compass',
    description: 'A worn brass compass.',
  };
  p.assets.push(character, prop);
  const shot = scene.shots[0];
  shot.action = '@[Mara] holds @[Compass] in @[The coast].';
  shot.mentions = [
    { id: character.id, kind: character.kind, token: '@[Mara]' },
    { id: prop.id, kind: prop.kind, token: '@[Compass]' },
    { id: scene.id, kind: 'scene', token: '@[The coast]' },
  ];
  const result = buildPrompt(p, scene, shot, base);
  assert.ok(result.prompt.startsWith('Mara holds Compass in The coast.'));
  assert.ok(result.prompt.includes(character.description));
  assert.ok(result.prompt.includes(prop.description));
  assert.ok(result.prompt.includes(scene.setting));
  assert.ok(!result.prompt.includes('private-photo'));
  assert.deepEqual(result.errors, []);
  p.assets[0].name = 'Renamed keeper';
  assert.ok(buildPrompt(p, scene, shot, base).prompt.includes('Renamed keeper'));
  p.assets = p.assets.filter((asset) => asset.id !== character.id);
  assert.ok(buildPrompt(p, scene, shot, base).errors.some((error) => error.includes('deleted')));
});
test('unresolved mention syntax is blocked instead of passed to a paid model', () => {
  const p = newProject();
  const shot = p.scenes[0].shots[0];
  shot.action = 'Follow @[Unknown character].';
  assert.ok(
    buildPrompt(p, p.scenes[0], shot, base).errors.some((error) => error.includes('@ menu')),
  );
});
test('policy rejections are not misclassified as unsupported images or used to disable capabilities', () => {
  const raw =
    'OpenRouter (400): InputImageSensitiveContentDetected.PrivacyInformation: The request failed because the input image contained privacy information.';
  assert.equal(explainProviderError(raw).kind, 'policy');
  assert.equal(learnedRestriction(raw), undefined);
  assert.equal(
    explainProviderError('OpenRouter (400): input_references is not supported for this model.')
      .kind,
    'input',
  );
  assert.equal(
    learnedRestriction('OpenRouter (400): input_references is not supported for this model.')
      ?.referencesDisabled,
    true,
  );
  assert.equal(
    learnedRestriction('Provider failed: prompt size must be between 0 and 2500')?.promptLimit,
    2500,
  );
});
test('unsupported roles and oversized/missing images fail preflight', () => {
  const shot = newShot();
  shot.inputMode = 'references';
  shot.referenceImageIds = ['photo'];
  assert.ok(validateCapabilities(shot, base).some((error) => error.includes('not available')));
  assert.ok(validateInputMedia('project', shot, []).length);
  assert.ok(
    validateInputMedia('project', shot, [
      {
        id: 'photo',
        projectId: 'project',
        name: 'large.png',
        mime: 'image/png',
        size: 6 * 1024 * 1024,
        createdAt: '',
      },
    ]).some((error) => error.includes('5 MB')),
  );
  shot.inputMode = 'text';
  assert.deepEqual(
    validateInputMedia('project', shot, []),
    [],
    'inactive images are never sent in text mode',
  );
});
test('legacy projects migrate to a safe text input and simple UI without removing uploaded assets', () => {
  const p = newProject();
  const raw = JSON.parse(JSON.stringify(p));
  delete raw.uiMode;
  const old = raw.scenes[0].shots[0];
  delete old.inputMode;
  delete old.directionMode;
  delete old.referenceImageIds;
  delete old.mentions;
  old.firstFrameId = 'preserved-image';
  const migrated = projectSchema.parse(raw);
  assert.equal(migrated.uiMode, 'simple');
  assert.equal(migrated.scenes[0].shots[0].inputMode, 'text');
  assert.equal(migrated.scenes[0].shots[0].firstFrameId, 'preserved-image');
});
