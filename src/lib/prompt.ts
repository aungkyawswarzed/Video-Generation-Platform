import type { Project, Scene, Shot, VideoModel } from './types';
import { getCapabilities } from './capabilities';
import { resolveMentions } from './mentions';

export interface CompiledPrompt {
  prompt: string;
  limit: number;
  errors: string[];
  notes: string[];
}
const excerpt = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
export function buildPrompt(
  p: Project,
  scene: Scene,
  shot: Shot,
  model?: VideoModel,
): CompiledPrompt {
  const limit = getCapabilities(model).promptLimit;
  const source = shot.promptOverride.trim() || shot.action.trim();
  const mentions = resolveMentions(p, shot, source);
  const director = (shot.directionMode || 'director') === 'director';
  let prompt =
    director && !shot.promptOverride.trim()
      ? [
          mentions.text,
          shot.camera.trim() ? `Camera: ${shot.camera.trim()}` : '',
          model?.generate_audio === true && shot.audio && shot.dialogue.trim()
            ? `Dialogue/sound: ${shot.dialogue.trim()}`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : mentions.text;
  const errors = [...mentions.errors];
  const notes: string[] = [];
  if (!mentions.text.trim()) errors.push('Describe the video you want to create.');
  if (prompt.length > limit)
    errors.push(
      `Your written direction is ${prompt.length.toLocaleString()} characters. This input is limited to ${limit.toLocaleString()} (${getCapabilities(model).promptLimitSource}). Shorten it before generating; your text has not been cut.`,
    );
  // A custom director override remains exact. Simple mode still expands explicitly selected mentions.
  if (shot.promptOverride.trim()) return { prompt, limit, errors, notes };
  const context = [...mentions.context];
  for (const asset of p.assets.filter((a) => shot.assetIds.includes(a.id)))
    if (!context.some((c) => c.id === asset.id && c.kind === asset.kind))
      context.push({ ...asset });
  const parts = context.map((c) => `${c.name}: ${c.description}`);
  if (
    scene.setting.trim() &&
    !mentions.context.some((c) => c.kind === 'scene' || c.kind === 'location')
  )
    parts.push(`Setting: ${scene.setting.trim()}`);
  if (p.style.trim()) parts.push(`Look: ${p.style.trim()}`);
  let shortened = false;
  for (let i = 0; i < parts.length; i++) {
    const remaining = limit - prompt.length - 2;
    if (remaining < 24) {
      shortened = true;
      break;
    }
    const allowance = Math.min(350, Math.floor(remaining / (parts.length - i)));
    if (allowance < 24) {
      shortened = true;
      continue;
    }
    const addition = excerpt(parts[i], allowance);
    if (addition !== parts[i]) shortened = true;
    prompt += `\n\n${addition}`;
  }
  if (shortened)
    notes.push(
      'Some library/scene/style context was shortened or omitted to fit the model. Your written direction was preserved. Inspect the final prompt before approval.',
    );
  if ((shot.mentions || []).some((m) => source.includes(m.token)))
    notes.push(
      '@ mentions add text descriptions. Photos are attached only when you explicitly choose an image input.',
    );
  return { prompt, limit, errors: [...new Set(errors)], notes };
}
