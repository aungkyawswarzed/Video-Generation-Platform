import type { Project, Shot } from './types';
export interface MentionOption {
  id: string;
  kind: 'character' | 'prop' | 'location' | 'scene';
  name: string;
  description: string;
  imageId?: string;
}
export function mentionOptions(p: Project): MentionOption[] {
  return [
    ...p.assets.map((a) => ({ ...a })),
    ...p.scenes.map((s) => ({
      id: s.id,
      kind: 'scene' as const,
      name: s.title,
      description: s.setting,
    })),
  ];
}
export function activeMentions(shot: Shot, text: string) {
  return (shot.mentions || []).filter((m) => text.includes(m.token));
}
export function resolveMentions(p: Project, shot: Shot, text: string) {
  let resolved = text;
  const context: MentionOption[] = [];
  const errors: string[] = [];
  const options = mentionOptions(p);
  const bindings = activeMentions(shot, text);
  for (const binding of bindings) {
    const option = options.find((o) => o.id === binding.id && o.kind === binding.kind);
    if (!option) {
      errors.push(`${binding.token} refers to a deleted item. Remove it or choose a new mention.`);
      continue;
    }
    resolved = resolved.split(binding.token).join(option.name);
    if (!context.some((o) => o.id === option.id && o.kind === option.kind)) context.push(option);
  }
  for (const token of text.match(/@\[[^\]\n]+\]/g) || [])
    if (!bindings.some((b) => b.token === token))
      errors.push(`Choose an item from the @ menu for ${token}, or remove its mention brackets.`);
  return { text: resolved, context, errors: [...new Set(errors)] };
}
