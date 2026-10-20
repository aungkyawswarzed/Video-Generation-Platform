import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tempBase =
  process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA!, 'Temp', 'opencode')
    : os.tmpdir();
mkdirSync(tempBase, { recursive: true });
const temp = mkdtempSync(path.join(tempBase, 'frame-test-'));
process.env.STUDIO_DATA_DIR = temp;
delete process.env.OPENROUTER_API_KEY;
const storage = await import('../src/lib/db');
const { queueGeneration, compileRequest, validateProjectMedia } =
  await import('../src/lib/generation');
const { newProject, id } = await import('../src/lib/project');
const { processJob } = await import('../src/lib/worker');
const model = {
  id: 'test/video',
  name: 'Test Video',
  supported_durations: [5],
  supported_resolutions: ['720p'],
  supported_aspect_ratios: ['16:9'],
  supported_frame_images: ['first_frame'],
  generate_audio: false,
  seed: false,
  pricing_skus: { 'per-video-second': '0.1' },
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async () =>
  new Response(JSON.stringify({ data: [model] }), { status: 200 })) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
  storage.db.close();
  rmSync(temp, { recursive: true, force: true });
});

test('SQLite persistence, secure key storage, and transactional queue', async (t) => {
  await t.test('seed data is available and changes are revision checked', () => {
    assert.equal(storage.projects().length, 1);
    const p = newProject('Test project');
    storage.createProject(p);
    const saved = storage.saveProject({ ...p, description: 'Persist me' });
    assert.equal(saved.revision, 1);
    assert.equal(storage.getProject(p.id).description, 'Persist me');
    assert.throws(() => storage.saveProject(p), /Conflict/);
  });
  await t.test('credentials are encrypted and never stored in plaintext', () => {
    storage.setApiKey('sk-or-private-secret');
    assert.equal(storage.apiKey(), 'sk-or-private-secret');
    assert.ok(!storage.setting('apiKey')!.includes('private-secret'));
    storage.setApiKey('');
    assert.equal(storage.apiKey(), undefined);
  });
  await t.test('a failed transaction rolls back', () => {
    assert.throws(() =>
      storage.transaction(() => {
        storage.setSetting('rollback', 'no');
        throw new Error('stop');
      }),
    );
    assert.equal(storage.setting('rollback'), undefined);
  });
  await t.test('damaged credential storage does not make projects inaccessible', () => {
    storage.setSetting('apiKey', 'corrupted-encrypted-credential');
    assert.equal(storage.apiKey(), undefined);
    assert.match(storage.credentialWarning()!, /projects are intact/);
    assert.ok(storage.projects().length);
    storage.setApiKey('new-key');
    assert.equal(storage.apiKey(), 'new-key');
    assert.equal(storage.credentialWarning(), undefined);
    storage.setApiKey('');
  });
  const p = newProject('Queue test');
  p.defaultModel = model.id;
  p.budget = 1;
  p.scenes[0].shots[0].action = 'A bird crosses the sky.';
  storage.createProject(p);
  const shotId = p.scenes[0].shots[0].id;
  let jobId = '';
  await t.test(
    'submission reserves budget, preserves inputs, and deduplicates retries',
    async () => {
      const requestId = id();
      const input = {
        shotId,
        revision: 0,
        requestId,
        approvedMax: 0.6,
        acceptedCharges: true as const,
      };
      const first = await queueGeneration(p.id, input);
      jobId = first.id;
      const duplicate = await queueGeneration(p.id, input);
      assert.equal(duplicate.id, first.id);
      const job = storage.getJob(first.id);
      assert.equal(job.status, 'queued');
      assert.equal(job.approvedMax, 0.6);
      assert.equal(job.request?.model, model.id);
      assert.equal(job.snapshot.scenes[0].shots[0].action, p.scenes[0].shots[0].action);
      assert.equal(storage.jobs(p.id).length, 1);
    },
  );
  await t.test(
    'parallel clicks with different IDs cannot submit the same active shot',
    async () => {
      await assert.rejects(
        queueGeneration(p.id, {
          shotId,
          revision: 0,
          requestId: id(),
          approvedMax: 0.6,
          acceptedCharges: true,
        }),
        /active or unresolved/,
      );
    },
  );
  await t.test('a request identifier cannot refer to a different project or shot', async () => {
    const requestId = storage.db.prepare('SELECT id FROM requests WHERE job_id=?').get(jobId) as {
      id: string;
    };
    const foreign = newProject('Unrelated project');
    storage.createProject(foreign);
    await assert.rejects(
      queueGeneration(foreign.id, {
        shotId: foreign.scenes[0].shots[0].id,
        revision: 0,
        requestId: requestId.id,
        approvedMax: 0.6,
        acceptedCharges: true,
      }),
      /different shot/,
    );
  });
  await t.test('unknown submissions retain reservation and prevent duplicates', async () => {
    storage.patchJob(jobId, { status: 'submission_unknown' });
    await assert.rejects(
      queueGeneration(p.id, {
        shotId,
        revision: 0,
        requestId: id(),
        approvedMax: 0.6,
        acceptedCharges: true,
      }),
      /unresolved/,
    );
  });
  await t.test('reserved spending is atomic across different shots', async () => {
    const updated = storage.getProject(p.id);
    const next = { ...updated.scenes[0].shots[0], id: id() };
    updated.scenes[0].shots.push(next);
    const saved = storage.saveProject(updated);
    await assert.rejects(
      queueGeneration(p.id, {
        shotId: next.id,
        revision: saved.revision,
        requestId: id(),
        approvedMax: 0.6,
        acceptedCharges: true,
      }),
      /budget exceeded/,
    );
  });
  await t.test('reference bytes are attached and foreign media is rejected', () => {
    const local = storage.getProject(p.id);
    const mediaId = id();
    storage.putMedia({
      id: mediaId,
      projectId: p.id,
      name: 'test.png',
      mime: 'image/png',
      size: 4,
      createdAt: new Date().toISOString(),
    });
    writeFileSync(storage.mediaPath(mediaId), Buffer.from([1, 2, 3, 4]));
    local.assets.push({
      id: id(),
      name: 'Bird',
      kind: 'character',
      description: 'Blue feathers',
      imageId: mediaId,
    });
    local.scenes[0].shots[0].assetIds = [local.assets[0].id];
    local.scenes[0].shots[0].inputMode = 'references';
    local.scenes[0].shots[0].referenceImageIds = [mediaId];
    const request = compileRequest(local, shotId, {
      ...model,
      supported_input_references: ['image'],
    });
    assert.ok(JSON.stringify(request.input_references).includes('data:image/png;base64,AQIDBA=='));
    const foreign = newProject('Foreign');
    foreign.assets = local.assets;
    assert.throws(() => validateProjectMedia(foreign), /does not belong/);
    assert.deepEqual(readFileSync(storage.mediaPath(mediaId)), Buffer.from([1, 2, 3, 4]));
  });
  await t.test('media paths cannot escape storage', () => {
    assert.throws(() => storage.mediaPath('../secret'), /Invalid/);
    assert.throws(() => storage.mediaPath('C:\\secret'), /Invalid/);
  });
  await t.test(
    'library photos are never automatically sent, and frame inputs never become references',
    () => {
      const local = storage.getProject(p.id);
      const picture = storage.allMedia(p.id)[0];
      local.assets.push({
        id: id(),
        name: 'Keeper',
        kind: 'character',
        description: 'A blue coat.',
        imageId: picture.id,
      });
      const shot = local.scenes[0].shots[0];
      shot.assetIds = [local.assets[0].id];
      shot.inputMode = 'text';
      const text = compileRequest(local, shot.id, model);
      assert.equal(text.input_references, undefined);
      assert.equal(text.frame_images, undefined);
      assert.equal(text.generate_audio, undefined);
      assert.equal(text.seed, undefined);
      shot.inputMode = 'frames';
      shot.firstFrameId = picture.id;
      shot.referenceImageIds = [picture.id];
      const frame = compileRequest(local, shot.id, model);
      assert.equal(frame.input_references, undefined);
      assert.ok(Array.isArray(frame.frame_images));
    },
  );
  await t.test(
    'a deleted reference is reported by preflight instead of a raw lookup failure',
    () => {
      const local = storage.getProject(p.id);
      const shot = local.scenes[0].shots[0];
      shot.action = 'A short prompt';
      shot.model = 'bytedance/seedance-2.5';
      shot.inputMode = 'references';
      shot.referenceImageIds = ['deleted-media'];
      assert.throws(
        () =>
          compileRequest(local, shot.id, {
            ...model,
            id: 'bytedance/seedance-2.5',
            supported_input_references: ['image'],
          }),
        /missing from this project/i,
      );
    },
  );
  await t.test(
    'invalid input roles and prompt limits are rejected before a queued/billable job is created',
    async () => {
      const invalid = newProject('Preflight validation');
      invalid.defaultModel = model.id;
      const shot = invalid.scenes[0].shots[0];
      shot.action = 'A short prompt';
      shot.inputMode = 'references';
      shot.referenceImageIds = ['missing'];
      storage.createProject(invalid);
      await assert.rejects(
        queueGeneration(invalid.id, {
          shotId: shot.id,
          revision: 0,
          requestId: id(),
          approvedMax: 0.6,
          acceptedCharges: true,
        }),
        /not available/,
      );
      assert.equal(storage.jobs(invalid.id).length, 0);
      shot.inputMode = 'text';
      shot.action = 'x'.repeat(1001);
      const saved = storage.saveProject(invalid);
      await assert.rejects(
        queueGeneration(invalid.id, {
          shotId: shot.id,
          revision: saved.revision,
          requestId: id(),
          approvedMax: 0.6,
          acceptedCharges: true,
        }),
        /1,000/,
      );
      assert.equal(storage.jobs(invalid.id).length, 0);
    },
  );
  await t.test('ambiguous submission is never automatically resubmitted', async () => {
    storage.setApiKey('test-only-key');
    storage.patchJob(jobId, { status: 'submitting' });
    let submissions = 0;
    globalThis.fetch = (async () => {
      submissions++;
      throw new Error('Network connection lost');
    }) as typeof fetch;
    await processJob(storage.getJob(jobId));
    assert.equal(storage.getJob(jobId).status, 'submission_unknown');
    assert.equal(submissions, 1);
    await processJob(storage.getJob(jobId));
    assert.equal(submissions, 1);
  });
  await t.test('definitive rejection fails safely; provider 500 remains ambiguous', async () => {
    storage.patchJob(jobId, { status: 'submitting' });
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'No credits' } }), {
        status: 402,
      })) as typeof fetch;
    await processJob(storage.getJob(jobId));
    assert.equal(storage.getJob(jobId).status, 'failed');
    storage.patchJob(jobId, { status: 'submitting' });
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'Server error' } }), {
        status: 500,
      })) as typeof fetch;
    await processJob(storage.getJob(jobId));
    assert.equal(storage.getJob(jobId).status, 'submission_unknown');
  });
  await t.test(
    'submission, polling, and authenticated content download preserve cost and provenance',
    async () => {
      storage.patchJob(jobId, { status: 'submitting' });
      const calls: { url: string; method: string; authorization?: string }[] = [];
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        calls.push({
          url: target,
          method: init?.method || 'GET',
          authorization: (init?.headers as Record<string, string>)?.Authorization,
        });
        if (init?.method === 'POST')
          return new Response(
            JSON.stringify({
              id: 'test-provider-job',
              status: 'pending',
              polling_url: 'https://evil.example/steal-key',
            }),
            { status: 202 },
          );
        if (target.includes('/content'))
          return new Response(new Uint8Array([0, 1, 2, 3]), {
            headers: { 'Content-Type': 'video/mp4' },
          });
        return new Response(
          JSON.stringify({
            status: 'completed',
            usage: { cost: 0.45 },
            unsigned_urls: ['https://evil.example/steal-key'],
          }),
        );
      }) as typeof fetch;
      await processJob(storage.getJob(jobId));
      assert.equal(storage.getJob(jobId).status, 'generating');
      assert.equal(storage.getJob(jobId).providerId, 'test-provider-job');
      await processJob(storage.getJob(jobId));
      const ready = storage.getJob(jobId);
      assert.equal(ready.status, 'ready');
      assert.equal(ready.cost, 0.45);
      assert.ok(ready.mediaId);
      assert.equal(calls.length, 3);
      assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
      assert.ok(
        calls.every(
          (c) =>
            c.url.startsWith('https://openrouter.ai/api/v1/') &&
            c.authorization === 'Bearer test-only-key',
        ),
      );
      assert.deepEqual(readFileSync(storage.mediaPath(ready.mediaId!)), Buffer.from([0, 1, 2, 3]));
    },
  );
  await t.test('poll failure schedules backoff and never resubmits', async () => {
    storage.patchJob(jobId, { status: 'generating', attempts: 0 });
    const methods: string[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      methods.push(init?.method || 'GET');
      throw new Error('Temporary outage');
    }) as typeof fetch;
    await processJob(storage.getJob(jobId));
    const job = storage.getJob(jobId);
    assert.equal(job.status, 'generating');
    assert.equal(job.attempts, 1);
    assert.ok(job.nextPollAt > Date.now());
    assert.deepEqual(methods, ['GET']);
  });
});
