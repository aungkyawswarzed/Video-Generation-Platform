import type { Project, Shot, Scene, VideoModel } from './types';
import { buildPrompt } from './prompt';
import { getCapabilities, inputModeLabels } from './capabilities';

export const id = () => crypto.randomUUID();
export function newShot(title = 'Untitled shot'): Shot {
  return {
    id: id(),
    title,
    action: '',
    camera: 'Slow cinematic push-in',
    dialogue: '',
    overlay: '',
    assetIds: [],
    directionMode: 'simple',
    inputMode: 'text',
    referenceImageIds: [],
    mentions: [],
    model: '',
    duration: 5,
    resolution: '720p',
    aspectRatio: '16:9',
    audio: false,
    promptOverride: '',
    trimStart: 0,
    trimEnd: 0,
  };
}
export function newProject(name = 'Untitled film'): Project {
  const now = new Date().toISOString();
  return {
    id: id(),
    name,
    description: '',
    style: 'Cinematic realism, natural light, subtle film grain, deliberate composition.',
    script: '',
    aspectRatio: '16:9',
    budget: 20,
    defaultModel: '',
    planningModel: '',
    uiMode: 'simple',
    assets: [],
    scenes: [{ id: id(), title: 'Opening scene', setting: '', shots: [newShot('Opening shot')] }],
    musicVolume: 0.2,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}
export function demoProject(): Project {
  const p = newProject('The last light');
  p.description =
    'At the edge of the world, a lighthouse keeper discovers a signal that was never meant to reach her.';
  p.style =
    'Atmospheric cinematic realism. Muted ocean blues, warm amber practical lights, anamorphic composition, 35mm film grain. Quiet, contemplative, mysterious.';
  p.assets = [
    {
      id: id(),
      name: 'Mara',
      kind: 'character',
      description:
        'A lighthouse keeper in her early thirties. Short dark hair, weathered navy coat, a rust-colored scarf. Reserved, observant, deliberate movements.',
    },
    {
      id: id(),
      name: 'The brass compass',
      kind: 'prop',
      description:
        'An antique brass compass with a cracked glass face. Its needle glows a faint amber when a signal is near.',
    },
    {
      id: id(),
      name: 'Northpoint lighthouse',
      kind: 'location',
      description:
        'A solitary lighthouse on a rugged coastal headland. Dark basalt cliffs, windswept grass, cold Atlantic mist.',
    },
  ];
  const a = newShot('A world at the edge');
  a.action =
    'A solitary lighthouse rises above dark coastal cliffs. Ocean mist drifts through the grass as the last amber light of dusk fades into blue.';
  a.camera =
    'Extreme wide establishing shot. Slow aerial drift toward the lighthouse, horizon held steady.';
  a.assetIds = [p.assets[2].id];
  const b = newShot('The keeper');
  b.action =
    'Mara stands at the window of the lantern room, looking out over the restless ocean. Warm light brushes the edge of her face. She turns at a faint sound.';
  b.assetIds = [p.assets[0].id, p.assets[2].id];
  const c = newShot('An impossible signal');
  c.action =
    'On a weathered wooden table, an old brass compass begins to glow. Mara’s hand enters the frame and gently opens it. The needle turns toward the sea.';
  c.camera =
    'Macro close-up, shallow depth of field. Slow focus pull from cracked glass to the glowing needle.';
  c.assetIds = [p.assets[0].id, p.assets[1].id];
  p.scenes = [
    {
      id: id(),
      title: 'Where the ocean ends',
      setting: 'Northpoint lighthouse. Blue hour. A gathering storm, wind and distant waves.',
      shots: [a, b, c],
    },
  ];
  p.script =
    'EXT. NORTHPOINT LIGHTHOUSE — DUSK\n\nA lone lighthouse watches the darkening sea.\n\nINT. LANTERN ROOM\n\nMara looks through the glass. A faint metallic hum breaks the silence.\n\nOn the table, a compass begins to glow. Its needle points somewhere that does not exist on any map.';
  return p;
}
export function findShot(p: Project, shotId: string): { scene: Scene; shot: Shot } {
  for (const scene of p.scenes) {
    const shot = scene.shots.find((s) => s.id === shotId);
    if (shot) return { scene, shot };
  }
  throw new Error('Shot not found');
}
export function compilePrompt(p: Project, scene: Scene, shot: Shot, model?: VideoModel): string {
  return buildPrompt(p, scene, shot, model).prompt;
}
export function validateCapabilities(shot: Shot, model: VideoModel) {
  const errors: string[] = [];
  const caps = getCapabilities(model);
  if (!caps.available) errors.push(caps.unavailableReason!);
  const mode = shot.inputMode || 'text';
  if (!caps.modes.includes(mode))
    errors.push(
      `${inputModeLabels[mode]} is not available for this model. Choose one of its supported input styles.`,
    );
  if (mode === 'frames' && !shot.firstFrameId)
    errors.push('Choose a starting image for image-to-video.');
  if (mode === 'references' && !shot.referenceImageIds?.length)
    errors.push('Choose at least one reference image.');
  if (mode === 'references' && (shot.referenceImageIds?.length || 0) > caps.maxReferences)
    errors.push(`This route allows at most ${caps.maxReferences} reference images in this app.`);
  if (model.supported_durations?.length && !model.supported_durations.includes(shot.duration))
    errors.push(`Duration must be ${model.supported_durations.join(', ')} seconds.`);
  if (model.supported_resolutions?.length && !model.supported_resolutions.includes(shot.resolution))
    errors.push(`Resolution must be ${model.supported_resolutions.join(', ')}.`);
  if (
    model.supported_aspect_ratios?.length &&
    !model.supported_aspect_ratios.includes(shot.aspectRatio)
  )
    errors.push(`Aspect ratio must be ${model.supported_aspect_ratios.join(', ')}.`);
  if (shot.audio && !caps.audio) errors.push('This model does not advertise generated audio.');
  if (shot.seed !== undefined && !caps.seed)
    errors.push('This model does not advertise seed support.');
  if (mode === 'frames' && shot.firstFrameId && !caps.firstFrame)
    errors.push('First-frame guidance is not supported.');
  if (mode === 'frames' && shot.lastFrameId && !caps.lastFrame)
    errors.push('Last-frame guidance is not supported.');
  return errors;
}
// Only estimate unambiguous, single-SKU per-second pricing. Complex SKUs require provider-specific interpretation.
export function estimateCost(model: VideoModel, duration: number): number | undefined {
  const entries = Object.entries(model.pricing_skus ?? {});
  if (entries.length !== 1 || entries[0][0] !== 'per-video-second') return undefined;
  const rate = Number(entries[0][1]);
  return Number.isFinite(rate) && rate >= 0 ? rate * duration : undefined;
}
export function shotDuration(shot: Shot) {
  return Math.max(0, Math.round(((shot.trimEnd || shot.duration) - shot.trimStart) * 1000)) / 1000;
}
export function timelineDuration(shots: Shot[]) {
  return (
    shots.reduce((milliseconds, shot) => milliseconds + Math.round(shotDuration(shot) * 1000), 0) /
    1000
  );
}
