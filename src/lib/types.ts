import { z } from 'zod';

export const assetSchema = z.object({
  id: z.string(),
  name: z.string().max(180),
  kind: z.enum(['character', 'prop', 'location']),
  description: z.string().max(6000),
  imageId: z.string().optional(),
});
export const shotSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(180),
  action: z.string().max(12000),
  camera: z.string().max(2000),
  dialogue: z.string().max(6000),
  overlay: z.string().max(500),
  assetIds: z.array(z.string()).max(30),
  directionMode: z.enum(['simple', 'director']).default('director'),
  inputMode: z.enum(['text', 'frames', 'references']).default('text'),
  referenceImageIds: z.array(z.string()).max(12).default([]),
  mentions: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(['character', 'prop', 'location', 'scene']),
        token: z.string().min(1).max(240),
      }),
    )
    .max(50)
    .default([]),
  model: z.string().max(180),
  duration: z.number().int().min(1).max(120),
  resolution: z.string().max(20),
  aspectRatio: z.string().max(10),
  audio: z.boolean(),
  seed: z.number().int().nonnegative().optional(),
  firstFrameId: z.string().optional(),
  lastFrameId: z.string().optional(),
  promptOverride: z.string().max(20000),
  selectedTakeId: z.string().optional(),
  trimStart: z.number().min(0).max(120),
  trimEnd: z.number().min(0).max(120),
});
export const sceneSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(180),
  setting: z.string().max(6000),
  shots: z.array(shotSchema).max(100),
});
export const projectSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(180),
  description: z.string().max(6000),
  style: z.string().max(6000),
  script: z.string().max(50000),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21']),
  budget: z.number().min(0).max(100000),
  defaultModel: z.string().max(180),
  planningModel: z.string().max(180),
  uiMode: z.enum(['simple', 'director']).default('simple'),
  assets: z.array(assetSchema).max(200),
  scenes: z.array(sceneSchema).max(100),
  musicId: z.string().optional(),
  musicVolume: z.number().min(0).max(1),
  revision: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;
export type Shot = z.infer<typeof shotSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type LibraryAsset = z.infer<typeof assetSchema>;
export interface VideoModel {
  id: string;
  name: string;
  description?: string;
  supported_durations: number[] | null;
  supported_resolutions: string[] | null;
  supported_aspect_ratios: string[] | null;
  supported_frame_images: string[] | null;
  generate_audio: boolean | null;
  seed: boolean | null;
  pricing_skus?: Record<string, string> | null;
  canonical_slug?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_input_references?: string[] | null;
  max_prompt_length?: number | null;
  compatibility?: {
    referencesDisabled?: boolean;
    framesDisabled?: boolean;
    promptLimit?: number;
    reason?: string;
  };
}
export type InputMode = Shot['inputMode'];
export interface Media {
  id: string;
  projectId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}
export type JobStatus =
  | 'queued'
  | 'submitting'
  | 'generating'
  | 'downloading'
  | 'ready'
  | 'failed'
  | 'submission_unknown'
  | 'rendering';
export interface Job {
  id: string;
  projectId: string;
  shotId?: string;
  kind: 'video' | 'export';
  status: JobStatus;
  providerId?: string;
  model?: string;
  prompt?: string;
  request?: Record<string, unknown>;
  snapshot: Project;
  mediaId?: string;
  error?: string;
  cost?: number;
  estimate?: number;
  approvedMax: number;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  nextPollAt: number;
  heartbeat?: number;
}
export interface Catalog {
  models: VideoModel[];
  fetchedAt: string;
  stale?: boolean;
  warning?: string;
}
export const activeStatuses: JobStatus[] = [
  'queued',
  'submitting',
  'generating',
  'downloading',
  'rendering',
];
