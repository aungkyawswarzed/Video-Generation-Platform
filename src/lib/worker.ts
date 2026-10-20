import { createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getJob, patchJob, putMedia, mediaPath, apiKey } from './db';
import { routerRequest, ProviderError } from './openrouter';
import { renderExport } from './export';
import { id } from './project';
import type { Job } from './types';
import { recordCompatibilityFailure } from './compatibility-store';

async function download(job: Job) {
  const res = await routerRequest(`/videos/${encodeURIComponent(job.providerId!)}/content?index=0`);
  if (!res.body) throw new Error('OpenRouter returned empty video content.');
  const mediaId = id();
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _, callback) {
      size += chunk.length;
      callback(
        size > 1024 * 1024 * 1024 ? new Error('Output exceeds the 1 GB local limit.') : null,
        chunk,
      );
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(res.body as never),
      limiter,
      createWriteStream(mediaPath(mediaId), { flags: 'wx' }),
    );
    if (!size) throw new Error('Downloaded video was empty.');
    putMedia({
      id: mediaId,
      projectId: job.projectId,
      name: `${job.snapshot.scenes.flatMap((s) => s.shots).find((s) => s.id === job.shotId)?.title || 'Take'}.mp4`,
      mime: 'video/mp4',
      size: (await stat(mediaPath(mediaId))).size,
      createdAt: new Date().toISOString(),
    });
    patchJob(job.id, { status: 'ready', mediaId, error: undefined });
  } catch (e) {
    await unlink(mediaPath(mediaId)).catch(() => {});
    throw e;
  }
}
export async function processJob(job: Job) {
  if (job.kind === 'export') {
    try {
      await renderExport(job);
    } catch (e) {
      patchJob(job.id, { status: 'failed', error: (e as Error).message });
    }
    return;
  }
  if (job.status === 'submitting') {
    try {
      if (!apiKey()) throw new ProviderError('Add an OpenRouter key in Settings.', 401);
      const res = await routerRequest('/videos', {
        method: 'POST',
        body: JSON.stringify(job.request),
      });
      const body = await res.json();
      if (typeof body.id !== 'string' || !body.id)
        throw new Error('Provider accepted a submission but returned no job ID.');
      patchJob(job.id, {
        providerId: body.id,
        status: 'generating',
        nextPollAt: Date.now() + 10000,
        error: undefined,
      });
    } catch (e) {
      if (e instanceof ProviderError) recordCompatibilityFailure(job.model, e.message);
      const definitive =
        e instanceof ProviderError && [400, 401, 402, 403, 404, 413, 422, 429].includes(e.status);
      patchJob(job.id, {
        status: definitive ? 'failed' : 'submission_unknown',
        error: `${(e as Error).message}${definitive ? '' : ' Submission may have been billed. Do not resubmit; reconcile the provider job ID.'}`,
      });
    }
    return;
  }
  // Unresolved, failed, and completed jobs must never enter the submission or polling path.
  if (!['generating', 'downloading'].includes(job.status) || !job.providerId) return;
  try {
    if (job.status === 'downloading') {
      await download(job);
      return;
    }
    const res = await routerRequest(`/videos/${encodeURIComponent(job.providerId)}`);
    const body = await res.json();
    if (body.status === 'completed') {
      patchJob(job.id, {
        status: 'downloading',
        cost: typeof body.usage?.cost === 'number' ? body.usage.cost : undefined,
        error: undefined,
      });
      await download(getJob(job.id));
    } else if (['failed', 'cancelled', 'expired'].includes(body.status)) {
      recordCompatibilityFailure(
        job.model,
        typeof body.error === 'string' ? body.error : body.error?.message || '',
      );
      patchJob(job.id, {
        status: 'failed',
        error: `Provider ${body.status}: ${typeof body.error === 'string' ? body.error : body.error?.message || 'No additional details.'}`,
        cost: typeof body.usage?.cost === 'number' ? body.usage.cost : undefined,
      });
    } else patchJob(job.id, { nextPollAt: Date.now() + 10000, error: undefined });
  } catch (e) {
    // Poll/download failures never trigger another billable generation.
    patchJob(job.id, {
      error: (e as Error).message,
      attempts: job.attempts + 1,
      nextPollAt: Date.now() + Math.min(300000, 10000 * 2 ** Math.min(job.attempts, 5)),
    });
  }
}
