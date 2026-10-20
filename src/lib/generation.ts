import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  db,
  getProject,
  getMedia,
  allMedia,
  mediaPath,
  jobs,
  putJob,
  transaction,
  getJob,
} from './db';
import { catalog } from './openrouter';
import { estimateCost, findShot, id, validateCapabilities } from './project';
import { activeStatuses, type Job, type Project } from './types';
import type { VideoModel } from './types';
import { buildPrompt } from './prompt';
import { getCapabilities, activeImageIds, validateInputMedia } from './capabilities';

export function referenceData(projectId: string, mediaId: string) {
  const m = getMedia(mediaId);
  if (m.projectId !== projectId || !['image/png', 'image/jpeg', 'image/webp'].includes(m.mime))
    throw new Error('Reference must be a project PNG, JPEG, or WebP image.');
  if (m.size > 5 * 1024 * 1024) throw new Error('Reference images must be 5 MB or smaller.');
  return {
    type: 'image_url',
    image_url: { url: `data:${m.mime};base64,${readFileSync(mediaPath(m.id)).toString('base64')}` },
  };
}
export function compileRequest(p: Project, shotId: string, model?: VideoModel) {
  const { scene, shot } = findShot(p, shotId);
  if (!model || model.id !== (shot.model || p.defaultModel))
    throw new Error('Choose an available model before checking generation inputs.');
  const compiled = buildPrompt(p, scene, shot, model);
  const imageIds = activeImageIds(shot);
  const errors = [
    ...validateCapabilities(shot, model),
    ...compiled.errors,
    ...validateInputMedia(p.id, shot, allMedia(p.id)),
  ];
  if (errors.length) throw new Error([...new Set(errors)].join(' '));
  const caps = getCapabilities(model);
  const request: Record<string, unknown> = {
    model: shot.model || p.defaultModel,
    prompt: compiled.prompt,
  };
  if (model.supported_durations?.length) request.duration = shot.duration;
  if (model.supported_resolutions?.length) request.resolution = shot.resolution;
  if (model.supported_aspect_ratios?.length) request.aspect_ratio = shot.aspectRatio;
  if (caps.audio) request.generate_audio = shot.audio;
  if (caps.seed && shot.seed !== undefined) request.seed = shot.seed;
  const mode = shot.inputMode || 'text';
  if (
    imageIds.length > 12 ||
    imageIds.reduce((total, imageId) => total + getMedia(imageId).size, 0) > 20 * 1024 * 1024
  ) {
    throw new Error(
      'A generation supports at most 12 reference/frame images totaling 20 MB in this local edition.',
    );
  }
  const references =
    mode === 'references' ? imageIds.map((imageId) => referenceData(p.id, imageId)) : [];
  if (references.length) request.input_references = references;
  const frames = [];
  if (mode === 'frames' && shot.firstFrameId)
    frames.push({ ...referenceData(p.id, shot.firstFrameId), frame_type: 'first_frame' });
  if (mode === 'frames' && shot.lastFrameId)
    frames.push({ ...referenceData(p.id, shot.lastFrameId), frame_type: 'last_frame' });
  if (frames.length) request.frame_images = frames;
  return request;
}
export const submitSchema = z.object({
  shotId: z.string(),
  revision: z.number().int(),
  requestId: z.string().uuid(),
  approvedMax: z.number().min(0.01).max(10000),
  acceptedCharges: z.literal(true),
});
export async function queueGeneration(projectId: string, input: z.infer<typeof submitSchema>) {
  const models = await catalog(false, false);
  return transaction(() => {
    const existing = db.prepare('SELECT job_id FROM requests WHERE id=?').get(input.requestId) as
      { job_id: string } | undefined;
    if (existing) {
      const original = getJob(existing.job_id);
      if (original.projectId !== projectId || original.shotId !== input.shotId)
        throw new Error('Request identifier was already used for a different shot.');
      return { id: existing.job_id };
    }
    const p = getProject(projectId);
    if (p.revision !== input.revision)
      throw new Error('Conflict: save or reload the project before generating.');
    const { shot } = findShot(p, input.shotId);
    if (!(shot.promptOverride.trim() || shot.action.trim()))
      throw new Error('Describe the shot action before generating.');
    const model = models.models.find((m) => m.id === (shot.model || p.defaultModel));
    if (!model) throw new Error('Select an available OpenRouter video model.');
    const errors = validateCapabilities(shot, model);
    if (errors.length) throw new Error(errors.join(' '));
    const previous = jobs(p.id);
    if (
      previous.some(
        (j) =>
          j.shotId === shot.id &&
          (activeStatuses.includes(j.status) || j.status === 'submission_unknown'),
      )
    )
      throw new Error('This shot already has an active or unresolved generation.');
    const estimate = estimateCost(model, shot.duration);
    if (estimate !== undefined && estimate > input.approvedMax)
      throw new Error('Estimated cost exceeds the approved reservation.');
    const committed = previous.reduce(
      (sum, j) =>
        sum +
        (j.kind === 'export'
          ? 0
          : (j.cost ??
            (activeStatuses.includes(j.status) ||
            j.status === 'submission_unknown' ||
            j.status === 'ready' ||
            j.providerId
              ? j.approvedMax
              : 0))),
      0,
    );
    if (committed + input.approvedMax > p.budget)
      throw new Error(
        `Project budget exceeded. $${committed.toFixed(2)} is spent or reserved. Increase the budget in Settings or lower the reservation.`,
      );
    const request = compileRequest(p, shot.id, model);
    const now = new Date().toISOString();
    const job: Job = {
      id: id(),
      projectId: p.id,
      shotId: shot.id,
      kind: 'video',
      status: 'queued',
      model: model.id,
      prompt: String(request.prompt),
      request,
      snapshot: p,
      estimate,
      approvedMax: input.approvedMax,
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      nextPollAt: 0,
    };
    putJob(job);
    db.prepare('INSERT INTO requests VALUES (?,?)').run(input.requestId, job.id);
    return { id: job.id };
  });
}
export function redactJob(job: Job) {
  // Requests can contain large private inline images. Only return a safe summary to the UI.
  const { request, snapshot, ...safe } = job;
  return {
    ...safe,
    shotTitle: snapshot.scenes.flatMap((s) => s.shots).find((s) => s.id === job.shotId)?.title,
    referenceCount: Array.isArray(request?.input_references) ? request.input_references.length : 0,
  };
}
export function validateProjectMedia(p: Project) {
  const ids = [
    ...p.assets.flatMap((a) => (a.imageId ? [a.imageId] : [])),
    ...p.scenes.flatMap((s) =>
      s.shots.flatMap((shot) => [shot.firstFrameId, shot.lastFrameId].filter(Boolean) as string[]),
    ),
    ...p.scenes.flatMap((scene) => scene.shots.flatMap((shot) => shot.referenceImageIds || [])),
    ...(p.musicId ? [p.musicId] : []),
  ];
  for (const mediaId of ids)
    if (getMedia(mediaId).projectId !== p.id)
      throw new Error('Media does not belong to this project.');
  const assetIds = new Set(p.assets.map((a) => a.id));
  const shotIds = p.scenes.flatMap((s) => s.shots.map((shot) => shot.id));
  if (
    new Set(shotIds).size !== shotIds.length ||
    assetIds.size !== p.assets.length ||
    new Set(p.scenes.map((s) => s.id)).size !== p.scenes.length
  )
    throw new Error('Project identifiers must be unique.');
  const projectJobs = jobs(p.id);
  for (const shot of p.scenes.flatMap((s) => s.shots)) {
    if (shot.assetIds.some((id) => !assetIds.has(id)))
      throw new Error('Shot references a missing library asset.');
    if (shot.selectedTakeId) {
      const take = projectJobs.find((j) => j.id === shot.selectedTakeId);
      if (!take || take.shotId !== shot.id || take.status !== 'ready')
        throw new Error('Selected take is not ready or belongs to a different shot.');
    }
  }
}
