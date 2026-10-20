import { setting, setSetting, transaction } from './db';
import { learnedRestriction } from './provider-errors';
import type { VideoModel } from './types';
type Guard = NonNullable<VideoModel['compatibility']>;
function storedGuards(): Record<string, Guard> {
  try {
    const parsed: unknown = JSON.parse(setting('videoCompatibility') || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, Guard>)
      : {};
  } catch {
    return {};
  }
}
export function withCompatibility(models: VideoModel[]): VideoModel[] {
  const guards = storedGuards();
  return models.map((model) => ({ ...model, compatibility: guards[model.id] }));
}
export function recordCompatibilityFailure(model: string | undefined, error: string) {
  if (!model) return;
  const restriction = learnedRestriction(error);
  if (!restriction) return;
  transaction(() => {
    const guards = storedGuards();
    const previous = guards[model] || {};
    guards[model] = {
      ...previous,
      ...restriction,
      ...(restriction.promptLimit
        ? { promptLimit: Math.min(previous.promptLimit || Infinity, restriction.promptLimit) }
        : {}),
    };
    setSetting('videoCompatibility', JSON.stringify(guards));
  });
}
