'use client';
import { useId } from 'react';
import { Aperture, ImagePlus, Plus, Volume2, X } from 'lucide-react';
import type { Media, Project, Shot, VideoModel } from '@/lib/types';
import { getCapabilities, inputModeLabels, adaptShotToModel } from '@/lib/capabilities';

export type UploadPurpose =
  'library' | 'take' | 'music' | 'reference' | 'first-frame' | 'last-frame' | 'ingredient';
export default function ModelInputs({
  project,
  shot,
  model,
  media,
  onChange,
  onPickModel,
  onUpload,
  compact = false,
  advanced = false,
  busy = false,
}: {
  project: Project;
  shot: Shot;
  model?: VideoModel;
  media: Media[];
  onChange: (change: Partial<Shot>) => void;
  onPickModel: () => void;
  onUpload: (purpose: UploadPurpose) => void;
  compact?: boolean;
  advanced?: boolean;
  busy?: boolean;
}) {
  const caps = getCapabilities(model);
  const root = useId();
  const images = media.filter((item) =>
    ['image/png', 'image/jpeg', 'image/webp'].includes(item.mime),
  );
  const library = new Map(
    project.assets.filter((asset) => asset.imageId).map((asset) => [asset.imageId, asset.name]),
  );
  const mode = shot.inputMode || 'text';
  const adjustments = model ? adaptShotToModel(shot, model) : undefined;
  function imageSelect(
    label: string,
    selected: string | undefined,
    update: (imageId: string | undefined) => void,
    purpose: UploadPurpose,
  ) {
    const field = `${root}-${purpose}`;
    return (
      <div className="guided-image-field">
        <label htmlFor={field}>{label}</label>
        <div>
          <select
            id={field}
            value={selected || ''}
            onChange={(event) => update(event.target.value || undefined)}
          >
            <option value="">Choose an uploaded image…</option>
            {selected && !images.some((image) => image.id === selected) && (
              <option value={selected}>Missing image — choose another</option>
            )}
            {images.map((image) => (
              <option key={image.id} value={image.id} disabled={image.size > 5 * 1024 * 1024}>
                {library.has(image.id) ? `${library.get(image.id)} · ` : ''}
                {image.name}
                {image.size > 5 * 1024 * 1024 ? ' — resize below 5 MB' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={() => onUpload(purpose)}
            aria-label={`Upload ${label.toLowerCase()}`}
          >
            <Plus size={15} /> Upload
          </button>
        </div>
        {selected && images.some((image) => image.id === selected) && (
          <img src={`/api/media/${selected}`} alt={label} />
        )}
      </div>
    );
  }
  return (
    <div className={`guided-inputs ${compact ? 'compact' : ''}`}>
      <button type="button" className="guided-model-picker" onClick={onPickModel}>
        <Aperture size={23} />
        <span>
          <strong>{model?.name || 'Choose a video model'}</strong>
          <small>
            {model
              ? 'Input controls follow this model’s capabilities'
              : 'Choose the model before attaching images'}
          </small>
        </span>
        <span>Change</span>
      </button>
      {model && !caps.available && <p className="input-warning">{caps.unavailableReason}</p>}
      {caps.available && (
        <>
          {!!adjustments?.changes.length && (
            <div className="input-warning">
              <p>Some saved settings do not match this model: {adjustments.changes.join(' · ')}.</p>
              <button
                type="button"
                className="button small"
                onClick={() => {
                  if (
                    window.confirm(
                      `Apply these compatible settings?\n\n${adjustments.changes.join('\n')}\n\nUploaded files will stay in your library.`,
                    )
                  )
                    onChange(adjustments.shot);
                }}
              >
                Use supported model settings
              </button>
            </div>
          )}
          <div className="input-mode-buttons" role="group" aria-label="Generation input style">
            {caps.modes.map((inputMode) => (
              <button
                type="button"
                key={inputMode}
                className={mode === inputMode ? 'active' : ''}
                aria-pressed={mode === inputMode}
                onClick={() => onChange({ inputMode })}
              >
                {inputModeLabels[inputMode]}
              </button>
            ))}
          </div>
          {!caps.modes.includes(mode) && (
            <div className="input-warning">
              Your saved input style is not available for this model. Choose one of the available
              styles above.
            </div>
          )}
          {mode === 'text' && (
            <p className="input-hint">
              Only text is sent. Character and prop photos stay in the library.
            </p>
          )}
          {mode === 'frames' && caps.firstFrame && (
            <div className="guided-frame-pair">
              {imageSelect(
                'Starting image',
                shot.firstFrameId,
                (firstFrameId) => onChange({ firstFrameId }),
                'first-frame',
              )}
              {caps.lastFrame &&
                imageSelect(
                  'Ending image (optional)',
                  shot.lastFrameId,
                  (lastFrameId) => onChange({ lastFrameId }),
                  'last-frame',
                )}
              <p className="input-hint">
                This image sets the opening frame. It is not a general character-reference slot.
              </p>
            </div>
          )}
          {mode === 'references' && caps.references && (
            <div className="guided-references">
              <label htmlFor={`${root}-ingredient`}>
                Reference images · {(shot.referenceImageIds || []).length}/{caps.maxReferences}
              </label>
              <div className="reference-thumbnails">
                {(shot.referenceImageIds || []).map((imageId) => (
                  <div key={imageId}>
                    <img
                      src={`/api/media/${imageId}`}
                      alt={media.find((m) => m.id === imageId)?.name || 'Reference image'}
                    />
                    <button
                      type="button"
                      aria-label="Remove reference image"
                      onClick={() =>
                        onChange({
                          referenceImageIds: shot.referenceImageIds.filter((id) => id !== imageId),
                        })
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="reference-add-row">
                <select
                  id={`${root}-ingredient`}
                  value=""
                  disabled={(shot.referenceImageIds || []).length >= caps.maxReferences}
                  onChange={(event) => {
                    if (event.target.value)
                      onChange({
                        referenceImageIds: [
                          ...new Set([...(shot.referenceImageIds || []), event.target.value]),
                        ],
                      });
                  }}
                >
                  <option value="">Add a library or uploaded image…</option>
                  {images
                    .filter((image) => !shot.referenceImageIds?.includes(image.id))
                    .map((image) => (
                      <option
                        key={image.id}
                        value={image.id}
                        disabled={image.size > 5 * 1024 * 1024}
                      >
                        {library.get(image.id) || image.name}
                        {image.size > 5 * 1024 * 1024 ? ' — resize below 5 MB' : ''}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="button small"
                  disabled={busy || (shot.referenceImageIds || []).length >= caps.maxReferences}
                  onClick={() => onUpload('ingredient')}
                >
                  <ImagePlus size={15} /> Upload
                </button>
              </div>
              <p className="input-hint">
                Only these explicitly selected images are sent. Provider privacy and safety rules
                still apply; a supported input can still be rejected for its content.
              </p>
            </div>
          )}
          <div className="guided-settings">
            {!!model?.supported_durations?.length && (
              <label>
                Duration
                <select
                  aria-label="Duration"
                  value={shot.duration}
                  onChange={(event) =>
                    onChange({ duration: Number(event.target.value), trimStart: 0, trimEnd: 0 })
                  }
                >
                  {!model.supported_durations.includes(shot.duration) && (
                    <option value={shot.duration} disabled>
                      {shot.duration}s — choose a supported value
                    </option>
                  )}
                  {model.supported_durations
                    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 120)
                    .map((duration) => (
                      <option value={duration} key={duration}>
                        {duration} seconds
                      </option>
                    ))}
                </select>
              </label>
            )}
            {!!model?.supported_resolutions?.length && (
              <label>
                Resolution
                <select
                  aria-label="Resolution"
                  value={shot.resolution}
                  onChange={(event) => onChange({ resolution: event.target.value })}
                >
                  {!model.supported_resolutions.includes(shot.resolution) && (
                    <option value={shot.resolution} disabled>
                      {shot.resolution} — unavailable
                    </option>
                  )}
                  {model.supported_resolutions.map((resolution) => (
                    <option key={resolution}>{resolution}</option>
                  ))}
                </select>
              </label>
            )}
            {!!model?.supported_aspect_ratios?.length && (
              <label>
                Shape
                <select
                  aria-label="Shape"
                  value={shot.aspectRatio}
                  onChange={(event) => onChange({ aspectRatio: event.target.value })}
                >
                  {!model.supported_aspect_ratios.includes(shot.aspectRatio) && (
                    <option value={shot.aspectRatio} disabled>
                      {shot.aspectRatio} — unavailable
                    </option>
                  )}
                  {model.supported_aspect_ratios.map((ratio) => (
                    <option key={ratio}>{ratio}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {caps.audio && (
            <label className="guided-audio">
              <Volume2 size={17} /> Generate native audio
              <input
                aria-label="Generate native audio"
                type="checkbox"
                checked={shot.audio}
                onChange={(event) => onChange({ audio: event.target.checked })}
              />
            </label>
          )}
          {advanced && caps.seed && (
            <label className="guided-seed">
              Seed (optional)
              <input
                aria-label="Seed (optional)"
                type="number"
                min="0"
                placeholder="Random"
                value={shot.seed ?? ''}
                onChange={(event) =>
                  onChange({ seed: event.target.value ? Number(event.target.value) : undefined })
                }
              />
            </label>
          )}
          <p className="capability-footnote">
            {caps.firstFrame
              ? `Image guidance: starting frame${caps.lastFrame ? ' + optional ending frame' : ' only'}.`
              : 'Text inputs only.'}{' '}
            {caps.references
              ? 'Verified reference-image route enabled.'
              : 'General reference images disabled: not verified for this route.'}{' '}
            Prompt: {caps.promptLimit.toLocaleString()} characters ({caps.promptLimitSource}).
          </p>
        </>
      )}
    </div>
  );
}
