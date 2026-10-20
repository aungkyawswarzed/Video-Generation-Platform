import type { InputMode, Shot, VideoModel, Media } from './types';

export interface VideoCapabilities {
  available: boolean;
  unavailableReason?: string;
  modes: InputMode[];
  firstFrame: boolean;
  lastFrame: boolean;
  references: boolean;
  maxReferences: number;
  audio: boolean;
  seed: boolean;
  promptLimit: number;
  promptLimitSource: 'provider metadata' | 'compatibility rule' | 'app safety limit';
  notes: string[];
}

// The video catalog advertises frame roles, NOT general image-reference support.
// These narrow routes are backed by the official OpenRouter video guide/model pages.
// Unknown reference routes remain unavailable, even when the architecture accepts images.
const referenceProfiles: Record<string, { max: number; source: string }> = {
  'bytedance/seedance-2.0': {
    max: 9,
    source: 'OpenRouter Seedance 2.x multimodal reference workflow',
  },
  'bytedance/seedance-2.0-fast': {
    max: 9,
    source: 'OpenRouter Seedance 2.x multimodal reference workflow',
  },
  'bytedance/seedance-2.0-mini': {
    max: 9,
    source: 'OpenRouter Seedance 2.x multimodal reference workflow',
  },
  'bytedance/seedance-2.5': {
    max: 9,
    source: 'OpenRouter Seedance 2.5 reference workflow; app limits images to 9',
  },
  'alibaba/wan-2.7': {
    max: 1,
    source: 'OpenRouter video guide reference-to-video example; conservative single-image limit',
  },
};
const promptProfiles: Record<string, number> = {
  'kwaivgi/kling-v3.0-pro': 2500,
  'kwaivgi/kling-v3.0-std': 2500,
  'kwaivgi/kling-video-o1': 2500,
  'runway/gen-4.5': 1000,
};
export function getCapabilities(model?: VideoModel): VideoCapabilities {
  const fallback: VideoCapabilities = {
    available: false,
    unavailableReason: 'Choose a video model to check its available inputs.',
    modes: [],
    firstFrame: false,
    lastFrame: false,
    references: false,
    maxReferences: 0,
    audio: false,
    seed: false,
    promptLimit: 1000,
    promptLimitSource: 'app safety limit',
    notes: [],
  };
  if (!model) return fallback;
  if (model.architecture?.input_modalities && !model.architecture.input_modalities.includes('text'))
    return {
      ...fallback,
      unavailableReason:
        'This is a specialized image/audio-only workflow, not a prompt-directed video model. Choose a text-to-video or text-and-image model.',
    };
  if (!model.supported_durations?.some((d) => Number.isInteger(d) && d >= 1 && d <= 120))
    return {
      ...fallback,
      unavailableReason:
        'This model requires a specialized editing, upscaling, or avatar workflow. It is not available in this text/image generation studio.',
    };
  const acceptsImages =
    !model.architecture?.input_modalities || model.architecture.input_modalities.includes('image');
  const firstFrame =
    acceptsImages &&
    !!model.supported_frame_images?.includes('first_frame') &&
    !model.compatibility?.framesDisabled;
  const lastFrame = firstFrame && !!model.supported_frame_images?.includes('last_frame');
  const referenceProfile = referenceProfiles[model.id];
  const advertisedReferences =
    model.supported_input_references?.includes('image') ||
    model.supported_input_references?.includes('image_url');
  const references =
    acceptsImages &&
    !!(referenceProfile || advertisedReferences) &&
    !model.compatibility?.referencesDisabled;
  const rawLimit = model.max_prompt_length;
  const published =
    typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0
      ? rawLimit
      : undefined;
  const profileLimit = promptProfiles[model.id];
  const learnedLimit = model.compatibility?.promptLimit;
  const promptLimit = Math.min(
    12000,
    published ?? profileLimit ?? 1000,
    profileLimit ?? Infinity,
    learnedLimit ?? Infinity,
  );
  const notes = [
    references
      ? referenceProfile?.source || 'Explicit image-reference capability metadata'
      : 'General image references are not verified for this route. Library photos are never attached automatically.',
    'First/last-frame inputs and character/style reference images are different generation modes.',
    ...(model.compatibility?.reason ? [model.compatibility.reason] : []),
  ];
  return {
    available: true,
    modes: [
      'text',
      ...(firstFrame ? ['frames' as const] : []),
      ...(references ? ['references' as const] : []),
    ],
    firstFrame,
    lastFrame,
    references,
    maxReferences: references ? referenceProfile?.max || 1 : 0,
    audio: model.generate_audio === true,
    seed: model.seed === true,
    promptLimit,
    promptLimitSource:
      profileLimit === promptLimit || learnedLimit === promptLimit
        ? 'compatibility rule'
        : published && published === promptLimit
          ? 'provider metadata'
          : 'app safety limit',
    notes,
  };
}
export const inputModeLabels: Record<InputMode, string> = {
  text: 'Text to video',
  frames: 'Animate an image',
  references: 'Reference images',
};
export function activeImageIds(shot: Shot): string[] {
  return shot.inputMode === 'references'
    ? [...new Set(shot.referenceImageIds || [])]
    : shot.inputMode === 'frames'
      ? [shot.firstFrameId, shot.lastFrameId].filter((id): id is string => !!id)
      : [];
}
export function validateInputMedia(projectId: string, shot: Shot, media: Media[]) {
  const ids = activeImageIds(shot);
  const errors: string[] = [];
  let total = 0;
  for (const id of ids) {
    const image = media.find((item) => item.id === id && item.projectId === projectId);
    if (!image) {
      errors.push('An attached image is missing from this project. Choose it again.');
      continue;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mime))
      errors.push(`${image.name} is not a supported reference image. Use PNG, JPEG, or WebP.`);
    if (image.size > 5 * 1024 * 1024)
      errors.push(
        `${image.name} is larger than the app's 5 MB image limit. Resize it before attaching.`,
      );
    total += image.size;
  }
  if (ids.length > 12 || total > 20 * 1024 * 1024)
    errors.push('Attached images must total at most 20 MB, with no more than 12 images.');
  return [...new Set(errors)];
}
export function adaptShotToModel(shot: Shot, model: VideoModel): { shot: Shot; changes: string[] } {
  const next = structuredClone(shot);
  const changes: string[] = [];
  const caps = getCapabilities(model);
  if (!caps.available) return { shot: next, changes: [caps.unavailableReason!] };
  const durations = (model.supported_durations || []).filter(
    (d) => d >= 1 && d <= 120 && Number.isInteger(d),
  );
  if (!durations.includes(next.duration)) {
    next.duration = [...durations].sort(
      (a, b) => Math.abs(a - next.duration) - Math.abs(b - next.duration),
    )[0];
    changes.push(`Duration: ${next.duration} seconds`);
  }
  if (
    model.supported_resolutions?.length &&
    !model.supported_resolutions.includes(next.resolution)
  ) {
    next.resolution = model.supported_resolutions[0];
    changes.push(`Resolution: ${next.resolution}`);
  }
  if (
    model.supported_aspect_ratios?.length &&
    !model.supported_aspect_ratios.includes(next.aspectRatio)
  ) {
    next.aspectRatio = model.supported_aspect_ratios[0];
    changes.push(`Aspect ratio: ${next.aspectRatio}`);
  }
  if (!caps.modes.includes(next.inputMode || 'text')) {
    next.inputMode = 'text';
    changes.push('Input style: text only (the previous image mode is not supported)');
  }
  if (!caps.firstFrame && next.firstFrameId) {
    delete next.firstFrameId;
    changes.push('Detach unsupported starting frame');
  }
  if (!caps.lastFrame && next.lastFrameId) {
    delete next.lastFrameId;
    changes.push('Detach unsupported ending frame');
  }
  if (!caps.references && next.referenceImageIds?.length) {
    next.referenceImageIds = [];
    changes.push('Detach unsupported reference images');
  }
  if (caps.references && (next.referenceImageIds?.length || 0) > caps.maxReferences) {
    next.referenceImageIds = next.referenceImageIds.slice(0, caps.maxReferences);
    changes.push(`Keep at most ${caps.maxReferences} reference images`);
  }
  if (!caps.audio && next.audio) {
    next.audio = false;
    changes.push('Turn off unsupported native audio');
  }
  if (!caps.seed && next.seed !== undefined) {
    delete next.seed;
    changes.push('Remove unsupported seed');
  }
  next.model = model.id;
  if (next.duration !== shot.duration) {
    next.trimStart = 0;
    next.trimEnd = 0;
    changes.push('Reset trims for the new clip duration');
  }
  return { shot: next, changes };
}
