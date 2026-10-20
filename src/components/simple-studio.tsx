'use client';
import { useState } from 'react';
import {
  Aperture,
  Check,
  ChevronRight,
  Clapperboard,
  FileText,
  ImagePlus,
  Loader2,
  Plus,
  Settings2,
  Sparkles,
  Upload,
} from 'lucide-react';
import type { Job, Media, Project, Scene, Shot, VideoModel } from '@/lib/types';
import { activeStatuses } from '@/lib/types';
import { getCapabilities, validateInputMedia } from '@/lib/capabilities';
import { buildPrompt } from '@/lib/prompt';
import { validateCapabilities } from '@/lib/project';
import MentionEditor from './mention-editor';
import ModelInputs, { type UploadPurpose } from './model-inputs';
import ProviderErrorNotice from './provider-error';
import Artwork from './artwork';

type Take = Omit<Job, 'snapshot' | 'request'> & { shotTitle?: string };
export default function SimpleStudio({
  project,
  scene,
  shot,
  model,
  media,
  jobs,
  configured,
  busy,
  onChange,
  onSelect,
  onSelectScene,
  onAddShot,
  onAddScene,
  onSceneChange,
  onPickModel,
  onUpload,
  onGenerate,
  onInspect,
  onLibrary,
  onSettings,
}: {
  project: Project;
  scene?: Scene;
  shot?: Shot;
  model?: VideoModel;
  media: Media[];
  jobs: Take[];
  configured: boolean;
  busy: boolean;
  onChange: (change: Partial<Shot>) => void;
  onSelect: (shot: Shot, scene: Scene) => void;
  onSelectScene: (scene: Scene) => void;
  onAddShot: () => void;
  onAddScene: () => void;
  onSceneChange: (change: Partial<Scene>) => void;
  onPickModel: () => void;
  onUpload: (purpose: UploadPurpose) => void;
  onGenerate: () => void;
  onInspect: () => void;
  onLibrary: () => void;
  onSettings: () => void;
}) {
  const [sceneEditor, setSceneEditor] = useState(false);
  const [showTakes, setShowTakes] = useState(false);
  const allShots = project.scenes.flatMap((s) => s.shots);
  const index = allShots.findIndex((s) => s.id === shot?.id);
  const takes = jobs.filter((job) => job.shotId === shot?.id && job.kind === 'video');
  const take = takes.find((job) => job.id === shot?.selectedTakeId && job.status === 'ready');
  const active = takes.find(
    (job) => activeStatuses.includes(job.status) || job.status === 'submission_unknown',
  );
  const effective = shot ? { ...shot, directionMode: 'simple' as const } : undefined;
  const compiled = effective && scene ? buildPrompt(project, scene, effective, model) : undefined;
  const errors =
    effective && model
      ? [
          ...validateCapabilities(effective, model),
          ...(compiled?.errors || []),
          ...validateInputMedia(project.id, effective, media),
        ]
      : compiled?.errors || [];
  return (
    <div className="flow-studio">
      <header className="flow-heading">
        <div>
          <span className="flow-eyebrow">SIMPLE MODE · YOUR STORY, ONE PROMPT</span>
          <h1>{project.name}</h1>
          <p>Describe it. Add your characters with @. Choose a compatible input and create.</p>
        </div>
      </header>
      <div className="flow-navigation">
        <label>
          Scene
          <select
            aria-label="Simple scene"
            value={scene?.id || ''}
            onChange={(event) => {
              const next = project.scenes.find((s) => s.id === event.target.value);
              if (next) onSelectScene(next);
            }}
          >
            {project.scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <button className="button small" onClick={onAddScene}>
          <Plus size={16} /> Scene
        </button>
        <button
          className="button small"
          onClick={() => setSceneEditor((value) => !value)}
          aria-expanded={sceneEditor}
        >
          <Settings2 size={16} /> Scene details
        </button>
        <span />
        <button className="button small" onClick={onLibrary}>
          <ImagePlus size={16} /> Characters & props
        </button>
      </div>
      {sceneEditor && scene && (
        <div className="flow-scene-editor">
          <label>
            Scene name
            <input
              value={scene.title}
              onChange={(event) => onSceneChange({ title: event.target.value })}
            />
          </label>
          <label>
            Scene description
            <textarea
              rows={2}
              value={scene.setting}
              placeholder="Where are we? What does this place look like?"
              onChange={(event) => onSceneChange({ setting: event.target.value })}
            />
          </label>
        </div>
      )}
      {!shot || !scene ? (
        <div className="empty-state">
          <Clapperboard size={36} />
          <h2>Start with a shot</h2>
          <button className="button primary" onClick={onAddShot}>
            <Plus size={18} /> Add a shot
          </button>
        </div>
      ) : (
        <>
          <div className="flow-preview">
            <div className="flow-preview-label">
              <span>
                SHOT {String(index + 1).padStart(2, '0')} · {shot.title}
              </span>
              <span>
                {take ? 'Selected take' : 'Storyboard illustration — not generated footage'}
              </span>
            </div>
            <div className="flow-stage">
              {take?.mediaId ? (
                <video src={`/api/media/${take.mediaId}`} controls playsInline preload="metadata" />
              ) : (
                <>
                  <Artwork variant={index} />
                  <div className="flow-stage-overlay">
                    <Aperture size={29} />
                    <h2>{shot.title}</h2>
                    <span>
                      {active
                        ? 'Your generation is being tracked in the background.'
                        : 'Your generated video will appear here after you select a take.'}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flow-composer">
            <ModelInputs
              project={project}
              shot={shot}
              model={model}
              media={media}
              onChange={onChange}
              onPickModel={onPickModel}
              onUpload={onUpload}
              busy={busy}
            />
            <MentionEditor
              project={project}
              shot={shot}
              value={shot.promptOverride || shot.action}
              onChange={(action, mentions, assetIds) =>
                onChange({
                  action,
                  promptOverride: '',
                  mentions,
                  assetIds,
                  directionMode: 'simple',
                })
              }
            />
            <div
              className={`prompt-budget ${compiled && compiled.prompt.length > compiled.limit ? 'over' : ''}`}
            >
              <span>
                {compiled?.prompt.length.toLocaleString() || 0} /{' '}
                {compiled?.limit.toLocaleString() || 1000} characters in final prompt
              </span>
              <button onClick={onInspect}>
                <FileText size={15} /> Inspect final prompt
              </button>
            </div>
            {compiled?.notes.map((note) => (
              <p className="composer-note" key={note}>
                {note}
              </p>
            ))}
            {!!model && errors.length > 0 && (
              <div className="composer-validation" role="status">
                {[...new Set(errors)].map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            )}
            <div className="flow-composer-actions">
              <button className="button" disabled={busy} onClick={() => onUpload('take')}>
                <Upload size={16} /> Import a video take
              </button>
              <span />
              {!configured && (
                <button className="text-link" onClick={onSettings}>
                  Connect OpenRouter
                </button>
              )}
              <button
                className="button primary flow-generate"
                onClick={onGenerate}
                disabled={
                  busy ||
                  !configured ||
                  !model ||
                  !getCapabilities(model).available ||
                  !!active ||
                  errors.length > 0
                }
              >
                {busy || active ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
                {active ? 'Generation in progress' : 'Create video'}
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          <div className="flow-strip-head">
            <h2>Shots</h2>
            <button className="button small" onClick={onAddShot}>
              <Plus size={16} /> Add shot
            </button>
            <button
              className="button small"
              aria-expanded={showTakes}
              onClick={() => setShowTakes((value) => !value)}
            >
              Takes ({takes.length})
            </button>
          </div>
          <div className="flow-shot-strip">
            {project.scenes.flatMap((sc) =>
              sc.shots.map((item, i) => (
                <button
                  className={item.id === shot.id ? 'active' : ''}
                  key={item.id}
                  onClick={() => onSelect(item, sc)}
                >
                  <span>
                    {String(allShots.findIndex((s) => s.id === item.id) + 1).padStart(2, '0')}
                  </span>
                  <strong>{item.title}</strong>
                  <small>{sc.title}</small>
                  {item.selectedTakeId && <Check size={15} />}
                </button>
              )),
            )}
          </div>
          {(showTakes || !!active || takes.some((item) => item.status === 'failed')) && (
            <section className="flow-takes" aria-label="Shot takes">
              <h2>Choose a take</h2>
              {takes.map((item, i) => (
                <article
                  key={item.id}
                  className={item.id === shot.selectedTakeId ? 'selected' : ''}
                >
                  <header>
                    <h3>Take {takes.length - i}</h3>
                    <span
                      className={`status ${item.status === 'ready' ? 'ready' : item.status === 'failed' ? 'failed' : 'working'}`}
                    >
                      {item.status.replaceAll('_', ' ')}
                    </span>
                  </header>
                  {item.mediaId && (
                    <video src={`/api/media/${item.mediaId}`} controls preload="metadata" />
                  )}
                  <p className="take-model-name">{item.model}</p>
                  {item.error && <ProviderErrorNotice error={item.error} />}
                  {item.status === 'ready' && (
                    <button
                      className={`button ${item.id === shot.selectedTakeId ? 'primary' : ''}`}
                      onClick={() => onChange({ selectedTakeId: item.id })}
                    >
                      <Check size={16} />
                      {item.id === shot.selectedTakeId ? 'Selected for timeline' : 'Use this take'}
                    </button>
                  )}
                </article>
              ))}
              {!takes.length && <p>No takes yet. Create a video or import an MP4.</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
