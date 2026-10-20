import { apiKey, cachedCatalog, setSetting } from './db';
import type { Catalog, VideoModel } from './types';
import { withCompatibility } from './compatibility-store';
import { z } from 'zod';

const architectureSchema = z.object({
  input_modalities: z.array(z.string()).optional(),
  output_modalities: z.array(z.string()).optional(),
});
const videoModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  canonical_slug: z.string().optional(),
  description: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value || undefined),
  supported_durations: z.array(z.number().int().positive()).nullable().default(null),
  supported_resolutions: z.array(z.string()).nullable().default(null),
  supported_aspect_ratios: z.array(z.string()).nullable().default(null),
  supported_frame_images: z.array(z.string()).nullable().default(null),
  generate_audio: z.boolean().nullable().default(null),
  seed: z.boolean().nullable().default(null),
  pricing_skus: z.record(z.string(), z.string()).nullable().optional(),
  supported_input_references: z.array(z.string()).nullable().optional(),
  max_prompt_length: z.number().int().positive().nullable().optional(),
  architecture: architectureSchema.optional(),
});

const base = 'https://openrouter.ai/api/v1';
export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function routerRequest(endpoint: string, init: RequestInit = {}, requireKey = true) {
  const key = apiKey();
  if (requireKey && !key) throw new Error('Add an OpenRouter API key in Settings first.');
  const res = await fetch(`${base}${endpoint}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(90000),
    redirect: 'error',
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      'Content-Type': 'application/json',
      'X-Title': 'Frame Studio',
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ProviderError(
      `OpenRouter (${res.status}): ${String(body.error?.message || 'Request failed').slice(0, 700)}`,
      res.status,
    );
  }
  return res;
}
export async function catalog(force = false, allowStale = true): Promise<Catalog> {
  const cached = cachedCatalog();
  if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < 5 * 60000)
    return { ...cached, models: withCompatibility(cached.models) };
  try {
    const [response, architectureResponse] = await Promise.all([
      routerRequest('/videos/models', { signal: AbortSignal.timeout(15000) }, false),
      routerRequest(
        '/models?output_modalities=video',
        { signal: AbortSignal.timeout(10000) },
        false,
      ).catch(() => undefined),
    ]);
    const json = await response.json();
    const architectures = architectureResponse
      ? await architectureResponse.json().catch(() => ({}))
      : {};
    if (!Array.isArray(json.data)) throw new Error('OpenRouter returned an invalid model catalog.');
    if (!Array.isArray(json.data))
      throw new Error('OpenRouter returned an unexpected video-model catalog.');
    const generalModels = Array.isArray(architectures.data) ? architectures.data : [];
    const models: VideoModel[] = [];
    for (const entry of json.data) {
      if (!entry || entry.upscale_factor) continue;
      const parsed = videoModelSchema.safeParse(entry);
      if (!parsed.success) continue;
      const architecture = architectureSchema.safeParse(
        generalModels.find((item: { id?: string }) => item?.id === parsed.data.id)?.architecture,
      );
      models.push({
        ...parsed.data,
        architecture: architecture.success ? architecture.data : parsed.data.architecture,
      });
    }
    const value: Catalog = { models, fetchedAt: new Date().toISOString() };
    setSetting('catalog', JSON.stringify(value));
    return { ...value, models: withCompatibility(value.models) };
  } catch (e) {
    if (cached && allowStale)
      return {
        ...cached,
        models: withCompatibility(cached.models),
        stale: true,
        warning: (e as Error).message,
      };
    throw e;
  }
}
