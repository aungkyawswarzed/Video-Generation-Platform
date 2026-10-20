export interface ProviderIssue {
  kind: 'policy' | 'input' | 'prompt' | 'auth' | 'credits' | 'other';
  title: string;
  message: string;
  advice: string;
  details: string;
}
export function explainProviderError(raw = ''): ProviderIssue {
  const details = raw;
  const lower = raw.toLowerCase();
  if (
    /sensitivecontent|privacyinformation|content.?policy|content.?moderation|safety.?filter|policy violation/.test(
      lower,
    )
  )
    return {
      kind: 'policy',
      title: 'Image or prompt rejected by the provider’s policy',
      message:
        'The provider declined this content under its privacy or safety rules. This is not an unsupported-input error.',
      advice:
        'Use content the provider permits. Owning an image or having consent does not override its policy. Nothing is automatically retried.',
      details,
    };
  if (
    /input_references|frame_images|does not support.*(?:image|reference)|not supported.*model/.test(
      lower,
    )
  )
    return {
      kind: 'input',
      title: 'This input is not supported by the selected route',
      message: 'The provider rejected an image input or input role.',
      advice:
        'Refresh model capabilities and choose an available input style. Starting frames and reference images are not interchangeable. Nothing is retried automatically.',
      details,
    };
  if (/(?:prompt|text).*(?:size|length|characters|too long|limit)/is.test(raw))
    return {
      kind: 'prompt',
      title: 'Prompt is longer than the model accepts',
      message: 'The provider rejected the prompt length.',
      advice:
        'Shorten the written direction or use the current prompt limit shown in the composer. The app will not cut your own instructions silently.',
      details,
    };
  if (/openrouter \(401\)|invalid api key|unauthorized|authentication/.test(lower))
    return {
      kind: 'auth',
      title: 'Check your OpenRouter key',
      message: 'OpenRouter did not accept the saved API key.',
      advice: 'Replace it in Settings. Do not share your key in error reports.',
      details,
    };
  if (/openrouter \(402\)|insufficient credits/.test(lower))
    return {
      kind: 'credits',
      title: 'OpenRouter credits are needed',
      message: 'The account does not have enough available credits.',
      advice: 'Check your OpenRouter balance before approving another request.',
      details,
    };
  return {
    kind: 'other',
    title: 'Request did not complete',
    message: raw || 'No details were supplied.',
    advice: 'Review the details before deciding whether to submit a new request.',
    details,
  };
}
export function learnedRestriction(raw: string) {
  if (explainProviderError(raw).kind === 'policy') return undefined;
  if (
    /(?:input_references[^\n]{0,180}(?:not supported|does not support)|does not support[^\n]{0,100}(?:image input references|input_references))/i.test(
      raw,
    )
  )
    return {
      referencesDisabled: true,
      reason: 'General references disabled after this route explicitly rejected input_references.',
    };
  if (/frame_images[^\n]{0,120}(?:not supported|does not support)/i.test(raw))
    return {
      framesDisabled: true,
      reason: 'Frame inputs disabled after an explicit provider rejection.',
    };
  const limit = raw.match(
    /prompt[^\n]{0,140}?(?:between\s+\d+\s+and\s+|(?:max(?:imum)?(?:\s+(?:length|size))?\s*[:=]?\s*))(\d{2,6})/i,
  );
  if (limit && Number(limit[1]) > 0)
    return {
      promptLimit: Number(limit[1]),
      reason: `Prompt limit learned from an explicit provider response: ${limit[1]} characters.`,
    };
}
