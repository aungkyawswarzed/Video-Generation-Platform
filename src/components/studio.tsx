'use client';

import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Aperture,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AudioLines,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Clock3,
  Copy,
  Download,
  Film,
  FolderOpen,
  ImagePlus,
  Layers3,
  Loader2,
  MapPin,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  WandSparkles,
  X,
  FileText,
  AlertTriangle,
  History,
  ExternalLink,
  Upload,
  Volume2,
  GripVertical,
} from 'lucide-react';
import type {
  Catalog,
  Job,
  LibraryAsset,
  Media,
  Project,
  Scene,
  Shot,
  VideoModel,
} from '@/lib/types';
import { activeStatuses } from '@/lib/types';
import {
  compilePrompt,
  estimateCost,
  id,
  newShot,
  shotDuration,
  timelineDuration,
  validateCapabilities,
} from '@/lib/project';
import Artwork from './artwork';
import SimpleStudio from './simple-studio';
import ModelInputs, { type UploadPurpose } from './model-inputs';
import MentionEditor from './mention-editor';
import ProviderErrorNotice from './provider-error';
import {
  adaptShotToModel,
  getCapabilities,
  inputModeLabels,
  validateInputMedia,
  activeImageIds,
} from '@/lib/capabilities';
import { buildPrompt } from '@/lib/prompt';

type SafeJob = Omit<Job, 'snapshot' | 'request'> & { shotTitle?: string; referenceCount?: number };
const NoticeContext = createContext<{ message: string; error: boolean } | null>(null);
type Tab = 'storyboard' | 'script' | 'library' | 'activity' | 'settings';
type Modal =
  'new-project' | 'models' | 'prompt' | 'generate' | 'export' | 'asset' | 'plan' | 'history' | null;
const money = (value: number) => `$${value.toFixed(2)}`;
const statusLabel = (status: string) => status.replaceAll('_', ' ');
async function api<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options?.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}
const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) });
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
function Button({
  children,
  onClick,
  primary,
  className = '',
  disabled,
  title,
  small,
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  className?: string;
  disabled?: boolean;
  title?: string;
  small?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`button ${primary ? 'primary' : ''} ${small ? 'small' : ''} ${className}`}
    >
      {children}
    </button>
  );
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const fieldId = useId();
  return (
    <div className="field">
      <span>
        <label htmlFor={fieldId}>{label}</label>
      </span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<Record<string, unknown>>, {
            id: fieldId,
            'aria-describedby': hint ? `${fieldId}-hint` : undefined,
          })
        : children}
      {hint && <small id={`${fieldId}-hint`}>{hint}</small>}
    </div>
  );
}
function ModalShell({
  title,
  subtitle,
  close,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const notice = useContext(NoticeContext);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="modal-head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="Close dialog" onClick={close}>
          <X size={19} />
        </button>
      </div>
      {notice?.error && (
        <div className="notice warning modal-error" role="alert">
          <AlertTriangle size={16} />
          <span>{notice.message}</span>
        </div>
      )}
      {children}
    </dialog>
  );
}

export default function Studio() {
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef<Project | null>(null);
  const dirty = useRef(false);
  const saving = useRef<Promise<Project> | null>(null);
  const [saveStatus, setSaveStatus] = useState('Saved');
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<Tab>('storyboard');
  const [selectedSceneId, setSelectedSceneId] = useState('');
  const [selectedShotId, setSelectedShotId] = useState('');
  const [jobs, setJobs] = useState<SafeJob[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [configured, setConfigured] = useState(false);
  const [envKey, setEnvKey] = useState(false);
  const [keyWarning, setKeyWarning] = useState('');
  const [workerOnline, setWorkerOnline] = useState(false);
  const [desktopMode, setDesktopMode] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [audioFilter, setAudioFilter] = useState(false);
  const [planningModels, setPlanningModels] = useState<{ id: string; name: string }[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [notification, setNotification] = useState<{ message: string; error: boolean } | null>(
    null,
  );
  const [newName, setNewName] = useState('');
  const [assetDraft, setAssetDraft] = useState<LibraryAsset | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [reservation, setReservation] = useState(2);
  const [approved, setApproved] = useState(false);
  const [requestPreview, setRequestPreview] = useState<Record<string, unknown> | null>(null);
  const [proposedScenes, setProposedScenes] = useState<Scene[]>([]);
  const [revisions, setRevisions] = useState<{ id: number; project: Project }[]>([]);
  const [inspectorTab, setInspectorTab] = useState<'direction' | 'takes'>('direction');
  const [assetFilter, setAssetFilter] = useState('all');
  const [dragShot, setDragShot] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadPurpose = useRef<UploadPurpose>('library');
  const requestIdRef = useRef(id());
  const notify = useCallback(
    (message: string, error = false) => setNotification({ message, error }),
    [],
  );
  useEffect(() => {
    if (notification) {
      const timeout = setTimeout(() => setNotification(null), notification.error ? 11000 : 5000);
      return () => clearTimeout(timeout);
    }
  }, [notification]);

  const install = useCallback((p: Project) => {
    projectRef.current = p;
    dirty.current = false;
    setProject(p);
    setSaveStatus('Saved');
    try {
      localStorage.setItem('frame-project', p.id);
    } catch {
      /* storage may be disabled */
    }
    setSelectedSceneId(p.scenes[0]?.id || '');
    setSelectedShotId(p.scenes[0]?.shots[0]?.id || '');
  }, []);
  useEffect(() => {
    api<{
      projects: Project[];
      configured: boolean;
      envKey: boolean;
      workerOnline: boolean;
      lastProjectId?: string;
      credentialWarning?: string;
    }>('bootstrap')
      .then((data) => {
        let remembered = '';
        try {
          remembered = localStorage.getItem('frame-project') || '';
        } catch {
          /* use newest project */
        }
        setProjectList(data.projects);
        const selected =
          data.projects.find((p) => p.id === remembered) ||
          data.projects.find((p) => p.id === data.lastProjectId) ||
          data.projects[0];
        if (!selected)
          throw new Error(
            'No workspace project could be loaded. Restart Frame Studio or restore a workspace backup.',
          );
        install(selected);
        setConfigured(data.configured);
        setEnvKey(data.envKey);
        setKeyWarning(data.credentialWarning || '');
        setWorkerOnline(data.workerOnline);
      })
      .catch((e) => setLoadError(e.message));
  }, [install]);

  const edit = useCallback((fn: (p: Project) => void) => {
    if (!projectRef.current) return;
    const next = structuredClone(projectRef.current);
    fn(next);
    projectRef.current = next;
    dirty.current = true;
    setProject(next);
    setSaveStatus('Unsaved');
  }, []);
  const flush = useCallback(async (): Promise<Project> => {
    if (saving.current) {
      await saving.current;
      // Another save may have started while the previous request was resolving.
      // In particular, native window-close must wait for the entire save chain.
      return flush();
    }
    if (!projectRef.current) throw new Error('No project loaded');
    if (!dirty.current) return projectRef.current;
    const snapshot = projectRef.current;
    dirty.current = false;
    setSaveStatus('Saving…');
    const operation = api<Project>(`projects/${snapshot.id}`, put(snapshot));
    saving.current = operation;
    try {
      const saved = await operation;
      const latest = projectRef.current!;
      projectRef.current = { ...latest, revision: saved.revision, updatedAt: saved.updatedAt };
      setProject(projectRef.current);
      setProjectList((list) => list.map((p) => (p.id === saved.id ? saved : p)));
      setSaveStatus(dirty.current ? 'Unsaved' : 'Saved');
    } catch (e) {
      dirty.current = true;
      setSaveStatus('Save failed');
      throw e;
    } finally {
      saving.current = null;
    }
    if (dirty.current) return flush();
    return projectRef.current!;
  }, []);
  useEffect(() => {
    if (!dirty.current || saveStatus === 'Save failed') return;
    const timer = setTimeout(() => {
      void flush().catch((e) => notify(e.message, true));
    }, 900);
    return () => clearTimeout(timer);
  }, [project, flush, notify, saveStatus]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty.current || saving.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void flush()
          .then(() => notify('Project saved'))
          .catch((e) => notify(e.message, true));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flush, notify]);
  useEffect(() => {
    const bridge = window.frameDesktop;
    if (!bridge) return;
    setDesktopMode(true);
    return bridge.onBeforeClose(async () => {
      if (busy)
        throw new Error(
          'An operation is still running. Return to the studio and wait for it to finish. A provider request may still be billed if you close now.',
        );
      if (modal === 'asset' && assetDraft) {
        const original = projectRef.current?.assets.find((asset) => asset.id === assetDraft.id);
        const changed = original
          ? JSON.stringify(original) !== JSON.stringify(assetDraft)
          : Boolean(assetDraft.name.trim() || assetDraft.description.trim() || assetDraft.imageId);
        if (changed)
          throw new Error(
            'The asset editor has unapplied changes. Save the asset or cancel its editor before closing.',
          );
      }
      if (modal === 'new-project' && newName.trim())
        throw new Error(
          'The new project has not been created yet. Create it or cancel before closing.',
        );
      if (modal === 'plan' && proposedScenes.length)
        throw new Error(
          'The AI scene proposal has not been applied. Append or discard it before closing.',
        );
      if (projectRef.current) await flush();
    });
  }, [flush, busy, modal, assetDraft, newName, proposedScenes]);
  useEffect(() => {
    if (!window.frameDesktop) return;
    return window.frameDesktop.onNewProject(() => {
      if (modal) {
        notify('Finish or close the current dialog before creating a project.', true);
        return;
      }
      setNewName('');
      setApproved(false);
      setModal('new-project');
    });
  }, [modal, notify]);
  const refreshJobs = useCallback(async (projectId: string) => {
    const data = await api<{ jobs: SafeJob[]; media: Media[]; workerOnline: boolean }>(
      `projects/${projectId}/jobs`,
    );
    if (projectRef.current?.id !== projectId) return;
    setJobs(data.jobs);
    setMedia(data.media);
    setWorkerOnline(data.workerOnline);
  }, []);
  useEffect(() => {
    if (!project?.id) return;
    const projectId = project.id;
    void refreshJobs(projectId).catch((e) => notify(e.message, true));
    const timer = setInterval(() => {
      void refreshJobs(projectId).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [project?.id, refreshJobs, notify]);
  const loadModels = useCallback(async (refresh = false) => {
    setModelsLoading(true);
    setCatalogError('');
    try {
      setCatalog(await api<Catalog>(`models${refresh ? '?refresh=1' : ''}`));
    } catch (e) {
      setCatalogError((e as Error).message);
    } finally {
      setModelsLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadModels();
  }, [loadModels]);
  const failedJobsSignature = jobs
    .filter((job) => job.status === 'failed')
    .map((job) => `${job.id}:${job.updatedAt}`)
    .join('|');
  useEffect(() => {
    if (failedJobsSignature) void loadModels();
  }, [failedJobsSignature, loadModels]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const scene = project?.scenes.find((s) => s.id === selectedSceneId) || project?.scenes[0];
  const shot = scene?.shots.find((s) => s.id === selectedShotId) || scene?.shots[0];
  const allShots = project?.scenes.flatMap((s) => s.shots) || [];
  const shotIndex = shot ? allShots.findIndex((s) => s.id === shot.id) : 0;
  const selectedModel = catalog?.models.find(
    (m) => m.id === (shot?.model || project?.defaultModel),
  );
  const studioMode = project?.uiMode || 'simple';
  const effectiveShot = shot ? { ...shot, directionMode: studioMode } : undefined;
  const promptCheck =
    project && scene && effectiveShot
      ? buildPrompt(project, scene, effectiveShot, selectedModel)
      : undefined;
  const generationIssues =
    selectedModel && effectiveShot
      ? [
          ...validateCapabilities(effectiveShot, selectedModel),
          ...(promptCheck?.errors || []),
          ...validateInputMedia(project!.id, effectiveShot, media),
        ]
      : [];
  const takes = jobs.filter((j) => j.shotId === shot?.id && j.kind === 'video');
  const selectedTake = takes.find((t) => t.id === shot?.selectedTakeId && t.status === 'ready');
  const activeJob = takes.find(
    (t) => activeStatuses.includes(t.status) || t.status === 'submission_unknown',
  );
  const totalDuration = timelineDuration(allShots);
  const spent = jobs.reduce((sum, j) => sum + (j.cost || 0), 0);
  const reserved = jobs.reduce(
    (sum, j) =>
      sum +
      (j.kind === 'video' &&
      j.cost === undefined &&
      (activeStatuses.includes(j.status) ||
        j.status === 'submission_unknown' ||
        j.status === 'ready' ||
        j.providerId)
        ? j.approvedMax
        : 0),
    0,
  );
  const readyShots = allShots.filter((s) =>
    jobs.some((j) => j.id === s.selectedTakeId && j.status === 'ready'),
  ).length;
  const editShot = (fn: (shot: Shot) => void) => {
    if (shot)
      edit((p) => {
        const target = p.scenes.flatMap((s) => s.shots).find((s) => s.id === shot.id);
        if (target) fn(target);
      });
  };
  const openModal = (value: Modal) => {
    setApproved(false);
    setRequestPreview(null);
    requestIdRef.current = id();
    setModal(value);
  };
  const selectShot = (s: Shot, sc: Scene) => {
    setSelectedSceneId(sc.id);
    setSelectedShotId(s.id);
  };
  const addScene = () =>
    edit((p) => {
      const s: Scene = {
        id: id(),
        title: `Scene ${p.scenes.length + 1}`,
        setting: '',
        shots: [{ ...newShot('First shot'), aspectRatio: p.aspectRatio }],
      };
      p.scenes.push(s);
      setSelectedSceneId(s.id);
      setSelectedShotId(s.shots[0].id);
    });
  const addShot = () => {
    if (!scene) {
      addScene();
      return;
    }
    edit((p) => {
      const s = { ...newShot(`Shot ${allShots.length + 1}`), aspectRatio: p.aspectRatio };
      p.scenes.find((sc) => sc.id === scene.id)!.shots.push(s);
      setSelectedShotId(s.id);
    });
  };
  const moveShot = (shotId: string, offset: number) =>
    edit((p) => {
      const s = p.scenes.find((sc) => sc.shots.some((sh) => sh.id === shotId));
      if (!s) return;
      const index = s.shots.findIndex((sh) => sh.id === shotId);
      const target = index + offset;
      if (target >= 0 && target < s.shots.length)
        [s.shots[index], s.shots[target]] = [s.shots[target], s.shots[index]];
    });
  const switchProject = (projectId: string) => {
    if (projectId === '__new__') {
      setNewName('');
      openModal('new-project');
      return;
    }
    void act(async () => {
      await flush();
      const next = await api<Project>(`projects/${projectId}`);
      setJobs([]);
      setMedia([]);
      install(next);
    });
  };
  const applyModel = (model: VideoModel) => {
    const caps = getCapabilities(model);
    if (!caps.available) {
      notify(caps.unavailableReason!, true);
      return;
    }
    if (!shot) {
      edit((p) => {
        p.defaultModel = model.id;
      });
      setModal(null);
      return;
    }
    const adapted = adaptShotToModel(shot, model);
    const changes = adapted.changes;
    if (
      changes.length &&
      !window.confirm(
        `This model needs the following changes:\n\n${changes.join('\n')}\n\nApply to this shot?`,
      )
    )
      return;
    editShot((s) => {
      for (const key of Object.keys(s)) delete (s as unknown as Record<string, unknown>)[key];
      Object.assign(s, adapted.shot);
    });
    setModal(null);
    notify('Model applied to this shot');
  };
  const upload = (purpose: typeof uploadPurpose.current) => {
    uploadPurpose.current = purpose;
    if (uploadRef.current)
      uploadRef.current.accept = ['reference', 'first-frame', 'last-frame', 'ingredient'].includes(
        purpose,
      )
        ? 'image/png,image/jpeg,image/webp'
        : purpose === 'take'
          ? 'video/mp4'
          : purpose === 'music'
            ? 'audio/*'
            : 'image/png,image/jpeg,image/webp,video/mp4,audio/*';
    uploadRef.current?.click();
  };
  const handleUpload = async (file: File) => {
    const purpose = uploadPurpose.current;
    if (
      ['reference', 'first-frame', 'last-frame', 'ingredient'].includes(purpose) &&
      file.size > 5 * 1024 * 1024
    )
      throw new Error(
        'Reference images must be 5 MB or smaller. Resize the image before uploading.',
      );
    let importedDuration: number | undefined;
    if (purpose === 'take')
      importedDuration = await new Promise<number>((resolve, reject) => {
        const video = document.createElement('video');
        const url = URL.createObjectURL(file);
        const cleanup = () => {
          clearTimeout(timer);
          video.onloadedmetadata = null;
          video.onerror = null;
          video.removeAttribute('src');
          video.load();
          URL.revokeObjectURL(url);
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('Could not read the video metadata. Use a standard H.264 MP4.'));
        }, 10000);
        video.onloadedmetadata = () => {
          const duration = video.duration;
          cleanup();
          if (!Number.isFinite(duration) || duration <= 0 || duration > 120)
            reject(
              new Error('Imported MP4 takes must be playable clips between 0 and 120 seconds.'),
            );
          else resolve(duration);
        };
        video.onerror = () => {
          cleanup();
          reject(new Error('This MP4 could not be read. Try an H.264 MP4 file.'));
        };
        video.preload = 'metadata';
        video.src = url;
      });
    const p = await flush();
    const form = new FormData();
    form.set('file', file);
    const item = await api<Media>(`projects/${p.id}/upload`, { method: 'POST', body: form });
    if (['first-frame', 'last-frame', 'ingredient'].includes(purpose)) {
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(item.mime) ||
        item.size > 5 * 1024 * 1024
      )
        throw new Error('Use a PNG, JPEG, or WebP image up to 5 MB for generation.');
      editShot((s) => {
        if (purpose === 'first-frame') {
          s.inputMode = 'frames';
          s.firstFrameId = item.id;
        } else if (purpose === 'last-frame') {
          s.inputMode = 'frames';
          s.lastFrameId = item.id;
        } else {
          s.inputMode = 'references';
          s.referenceImageIds = [...new Set([...(s.referenceImageIds || []), item.id])];
        }
      });
    }
    if (purpose === 'reference') {
      if (!item.mime.startsWith('image/')) throw new Error('Choose an image for a reference.');
      setAssetDraft((draft) => (draft ? { ...draft, imageId: item.id } : draft));
    }
    if (purpose === 'music') {
      if (!item.mime.startsWith('audio/'))
        throw new Error('Choose an audio file for the music track.');
      edit((p) => {
        p.musicId = item.id;
      });
    }
    if (purpose === 'take' && shot) {
      const take = await api<SafeJob>(
        `projects/${p.id}/import-take`,
        post({ shotId: shot.id, mediaId: item.id }),
      );
      editShot((s) => {
        s.selectedTakeId = take.id;
        if (importedDuration) {
          s.duration = Math.ceil(importedDuration);
          s.trimStart = 0;
          s.trimEnd = Math.round(importedDuration * 1000) / 1000;
        }
      });
      setInspectorTab('takes');
    }
    await refreshJobs(p.id);
    notify('Media added to project');
  };
  const startGenerationReview = () =>
    void act(async () => {
      if (!shot) return;
      editShot((s) => {
        s.directionMode = studioMode;
      });
      const p = await flush();
      const preview = await api<Record<string, unknown>>(
        `projects/${p.id}/preview`,
        post({ shotId: shot.id }),
      );
      openModal('generate');
      setRequestPreview(preview);
      const estimate = selectedModel ? estimateCost(selectedModel, shot.duration) : undefined;
      setReservation(estimate !== undefined ? Math.max(0.01, Math.ceil(estimate * 120) / 100) : 2);
    });
  const generate = () =>
    void act(async () => {
      if (!shot || !approved) return;
      const p = await flush();
      await api(
        `projects/${p.id}/generate`,
        post({
          shotId: shot.id,
          revision: p.revision,
          requestId: requestIdRef.current,
          approvedMax: reservation,
          acceptedCharges: true,
        }),
      );
      await refreshJobs(p.id);
      setModal(null);
      setInspectorTab('takes');
      notify('Shot queued. You can keep editing while it generates.');
    });
  const jobAction = (job: SafeJob, operation: string, providerId?: string) =>
    void act(async () => {
      await api(`projects/${project!.id}/jobs/${job.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ operation, providerId }),
      });
      await refreshJobs(project!.id);
      notify('Job updated');
    });
  const renderStatus = (job: SafeJob) => (
    <span
      className={`status ${job.status === 'ready' ? 'ready' : job.status === 'failed' || job.status === 'submission_unknown' ? 'failed' : 'working'}`}
    >
      {activeStatuses.includes(job.status) ? (
        <Loader2 size={11} className="spin" />
      ) : job.status === 'ready' ? (
        <Check size={11} />
      ) : (
        <AlertTriangle size={11} />
      )}
      {statusLabel(job.status)}
    </span>
  );

  if (!project)
    return (
      <div className="loading-screen">
        <Aperture size={42} />
        <h1>
          Frame<span>®</span>
        </h1>
        {loadError ? (
          <>
            <p>{loadError}</p>
            <Button onClick={() => location.reload()}>Try again</Button>
          </>
        ) : (
          <p>
            <Loader2 size={14} className="spin" /> Opening your studio…
          </p>
        )}
      </div>
    );

  return (
    <NoticeContext.Provider value={notification}>
      <div className={`studio ${studioMode === 'simple' ? 'simple-mode' : 'director-mode'}`}>
        <input
          type="file"
          ref={uploadRef}
          className="sr-only"
          aria-label="Upload project media"
          accept="image/png,image/jpeg,image/webp,video/mp4,audio/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void act(() => handleUpload(file));
          }}
        />
        <aside className="rail">
          <a className="brand" href="/" aria-label="Frame home">
            <Aperture size={29} strokeWidth={1.6} />
          </a>
          <div className="rail-top">
            {(
              [
                { key: 'storyboard', icon: Clapperboard, label: 'Storyboard' },
                { key: 'script', icon: FileText, label: 'Script' },
                { key: 'library', icon: Layers3, label: 'Asset library' },
                { key: 'activity', icon: Clock3, label: 'Generation activity' },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                className={`rail-item ${tab === item.key ? 'active' : ''}`}
                title={item.label}
                aria-label={item.label}
                onClick={() => setTab(item.key)}
              >
                <item.icon size={21} />
              </button>
            ))}
          </div>
          <div className="rail-bottom">
            <button
              className={`rail-item ${tab === 'settings' ? 'active' : ''}`}
              onClick={() => setTab('settings')}
              title="Project & API settings"
              aria-label="Settings"
            >
              <Settings2 size={21} />
            </button>
            <a
              className="rail-item"
              title="OpenRouter documentation"
              href="https://openrouter.ai/docs/guides/overview/multimodal/video-generation"
              target="_blank"
              rel="noreferrer"
              aria-label="Documentation"
            >
              <CircleHelp size={21} />
            </a>
            <div className="avatar">Y</div>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="wordmark">
              frame<span> / </span>
              <small>STUDIO</small>
            </div>
            <div className="studio-mode-switch" role="group" aria-label="Studio mode">
              {(['simple', 'director'] as const).map((mode) => (
                <button
                  key={mode}
                  aria-pressed={studioMode === mode}
                  className={studioMode === mode ? 'active' : ''}
                  onClick={() =>
                    edit((p) => {
                      p.uiMode = mode;
                    })
                  }
                >
                  {mode === 'simple' ? 'Simple mode' : 'Director mode'}
                </button>
              ))}
            </div>
            <div className="header-divider" />
            <div className="project-switch">
              <FolderOpen size={15} />
              <select
                aria-label="Select project"
                value={project.id}
                onChange={(e) => switchProject(e.target.value)}
              >
                {projectList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === project.id ? project.name : p.name}
                  </option>
                ))}
                <option value="__new__">+ New project…</option>
              </select>
              <ChevronDown size={12} />
            </div>
            <button
              className="icon-button"
              aria-label="New project"
              title="New project"
              onClick={() => {
                setNewName('');
                openModal('new-project');
              }}
            >
              <Plus size={16} />
            </button>
            <span className={`save-indicator ${saveStatus === 'Save failed' ? 'danger-text' : ''}`}>
              <span className={saveStatus === 'Saved' ? 'live-dot' : 'pending-dot'} />
              {saveStatus === 'Saved' ? 'All changes saved' : saveStatus}
            </span>
            <div className="header-actions">
              <span className="private-badge">
                <ShieldCheck size={13} /> LOCAL WORKSPACE
              </span>
              <Button small onClick={() => openModal('export')}>
                <Download size={14} /> Export film
              </Button>
            </div>
          </header>

          <div className="workspace-body">
            <aside className="project-sidebar">
              <div className="sidebar-label">
                YOUR PRODUCTION{' '}
                <button
                  className="icon-button"
                  aria-label="Project settings"
                  onClick={() => setTab('settings')}
                >
                  <MoreHorizontal size={17} />
                </button>
              </div>
              <div className="project-title">
                <span className="project-icon">
                  <Film size={19} />
                </span>
                <div>
                  <h2>{project.name}</h2>
                  <p>
                    {project.scenes.length} scene{project.scenes.length !== 1 ? 's' : ''}{' '}
                    <span>·</span> {allShots.length} shot{allShots.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <div className="sidebar-section-title">
                <span>SCENES</span>
                <button
                  className="icon-button"
                  title="Add scene"
                  aria-label="Add scene"
                  onClick={addScene}
                >
                  <Plus size={15} />
                </button>
              </div>
              <div className="scene-list">
                {project.scenes.map((sc, i) => (
                  <div key={sc.id}>
                    <button
                      className={`scene-nav ${scene?.id === sc.id && tab === 'storyboard' ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedSceneId(sc.id);
                        setSelectedShotId(sc.shots[0]?.id || '');
                        setTab('storyboard');
                      }}
                    >
                      <span className="scene-number">{String(i + 1).padStart(2, '0')}</span>
                      <span>{sc.title}</span>
                      <ChevronDown size={13} />
                    </button>
                    {scene?.id === sc.id && (
                      <div className="shot-navs">
                        {sc.shots.map((s, j) => (
                          <button
                            key={s.id}
                            className={shot?.id === s.id ? 'current' : ''}
                            onClick={() => {
                              selectShot(s, sc);
                              setTab('storyboard');
                            }}
                          >
                            <span className={`shot-dot ${s.selectedTakeId ? 'complete' : ''}`} />
                            {String(j + 1).padStart(2, '0')} <span>{s.title}</span>
                            {jobs.some(
                              (job) => job.shotId === s.id && activeStatuses.includes(job.status),
                            ) && <Loader2 size={11} className="spin" />}
                          </button>
                        ))}
                        <button className="add-shot-nav" onClick={addShot}>
                          <Plus size={12} /> Add shot
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button className="new-scene" onClick={addScene}>
                <Plus size={14} /> Add a scene
              </button>
              <div className="sidebar-section-title library-label">PROJECT LIBRARY</div>
              {[
                { label: 'Characters', icon: Users, kind: 'character' },
                { label: 'Props', icon: Box, kind: 'prop' },
                { label: 'Locations', icon: MapPin, kind: 'location' },
              ].map((item) => (
                <button
                  key={item.kind}
                  className="library-nav"
                  onClick={() => {
                    setAssetFilter(item.kind);
                    setTab('library');
                  }}
                >
                  <item.icon size={16} />
                  <span>{item.label}</span>
                  <small>{project.assets.filter((a) => a.kind === item.kind).length}</small>
                </button>
              ))}
              <button
                className="library-nav"
                onClick={() => {
                  setAssetFilter('media');
                  setTab('library');
                }}
              >
                <ImagePlus size={16} />
                <span>Media uploads</span>
                <small>{media.length}</small>
              </button>
              <div className="sidebar-bottom">
                <div className="budget-label">
                  <span>Production budget</span>
                  <span>
                    {money(spent + reserved)} <em>/ {money(project.budget)}</em>
                  </span>
                </div>
                <div className="budget-track">
                  <div
                    style={{
                      width: `${Math.min(100, project.budget ? ((spent + reserved) / project.budget) * 100 : 0)}%`,
                    }}
                  />
                </div>
                <p>
                  {money(spent)} spent · {money(reserved)} reserved
                </p>
                <button
                  onClick={() => setTab('settings')}
                  className={`connection ${configured ? 'connected' : ''}`}
                >
                  <span className={configured ? 'live-dot' : 'pending-dot'} />
                  {configured ? 'OpenRouter connected' : 'Connect OpenRouter'}
                  <ChevronRight size={12} />
                </button>
              </div>
            </aside>

            <main
              className={`main-panel ${tab !== 'storyboard' || studioMode === 'simple' ? 'full' : ''}`}
            >
              {tab === 'storyboard' && studioMode === 'simple' && (
                <SimpleStudio
                  project={project}
                  scene={scene}
                  shot={shot}
                  model={selectedModel}
                  media={media}
                  jobs={jobs}
                  configured={configured}
                  busy={busy}
                  onChange={(change) => editShot((s) => Object.assign(s, change))}
                  onSelect={selectShot}
                  onSelectScene={(sc) => {
                    setSelectedSceneId(sc.id);
                    setSelectedShotId(sc.shots[0]?.id || '');
                  }}
                  onAddShot={addShot}
                  onAddScene={addScene}
                  onSceneChange={(change) =>
                    edit((p) => {
                      const sc = p.scenes.find((s) => s.id === scene?.id);
                      if (sc) Object.assign(sc, change);
                    })
                  }
                  onPickModel={() => openModal('models')}
                  onUpload={upload}
                  onGenerate={startGenerationReview}
                  onInspect={() => openModal('prompt')}
                  onLibrary={() => {
                    setAssetFilter('all');
                    setTab('library');
                  }}
                  onSettings={() => setTab('settings')}
                />
              )}
              {tab === 'storyboard' && studioMode === 'director' && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">
                        THE DIRECTOR’S DESK <span>/</span> SCENE{' '}
                        {String(project.scenes.findIndex((s) => s.id === scene?.id) + 1).padStart(
                          2,
                          '0',
                        )}
                      </div>
                      <h1>{scene?.title || 'Your story starts here'}</h1>
                      <p>
                        {scene?.setting || 'Set the scene. Build your world. Bring it to life.'}
                      </p>
                    </div>
                    <Button small onClick={addShot}>
                      <Plus size={15} /> Add shot
                    </Button>
                  </div>
                  <div className="view-tabs">
                    <button className="active">
                      <Clapperboard size={14} /> Storyboard
                    </button>
                    <button onClick={() => setTab('script')}>
                      <FileText size={14} /> Script
                    </button>
                    <span />
                    <span className="shot-count">
                      {scene?.shots.length || 0} SHOTS <span>·</span>{' '}
                      {timelineDuration(scene?.shots || [])}s
                    </span>
                  </div>
                  <div className="mobile-scene-switch">
                    <select
                      aria-label="Select scene"
                      value={scene?.id || ''}
                      onChange={(e) => {
                        const next = project.scenes.find((s) => s.id === e.target.value);
                        if (next) {
                          setSelectedSceneId(next.id);
                          setSelectedShotId(next.shots[0]?.id || '');
                        }
                      }}
                    >
                      {!project.scenes.length && <option value="">No scenes yet</option>}
                      {project.scenes.map((s, i) => (
                        <option key={s.id} value={s.id}>
                          {String(i + 1).padStart(2, '0')} · {s.title}
                        </option>
                      ))}
                    </select>
                    <Button small onClick={addScene}>
                      <Plus size={13} /> Scene
                    </Button>
                  </div>
                  {shot && (
                    <>
                      <div className="preview-container">
                        <div className="preview-top">
                          <span className="preview-label">
                            <span className="live-dot" /> SHOT{' '}
                            {String(shotIndex + 1).padStart(2, '0')} <span>/</span>{' '}
                            {selectedTake ? 'SELECTED TAKE' : 'STORYBOARD PREVIEW'}
                          </span>
                          <span>
                            {shot.aspectRatio} <span>·</span> {shot.resolution}
                          </span>
                        </div>
                        <div
                          className="preview-image"
                          style={{ aspectRatio: shot.aspectRatio.replace(':', ' / ') }}
                        >
                          {selectedTake?.mediaId ? (
                            <video
                              key={selectedTake.mediaId}
                              src={`/api/media/${selectedTake.mediaId}`}
                              controls
                              playsInline
                              preload="metadata"
                            />
                          ) : (
                            <>
                              <Artwork variant={shotIndex} />
                              <div className="preview-vignette" />
                              <div className="frame-corner tl" />
                              <div className="frame-corner tr" />
                              <div className="frame-corner bl" />
                              <div className="frame-corner br" />
                              <div className="illustration-label">
                                CONCEPT ILLUSTRATION · NOT GENERATED FOOTAGE
                              </div>
                              <div className="preview-story">
                                <span>{project.name.toUpperCase()}</span>
                                <h2>{shot.title}</h2>
                                <p>
                                  {shot.action || 'Describe what happens in this shot to begin.'}
                                </p>
                              </div>
                              {activeJob && (
                                <div className="generation-overlay">
                                  <Loader2 size={19} className="spin" />
                                  <span>{statusLabel(activeJob.status)}</span>
                                </div>
                              )}
                            </>
                          )}
                          {shot.overlay && <div className="overlay-preview">{shot.overlay}</div>}
                        </div>
                        <div className="preview-bottom">
                          <div>
                            <span className="shot-tag">
                              {shotIndex + 1 < 10 ? '0' : ''}
                              {shotIndex + 1}
                            </span>
                            <span>{shot.title}</span>
                          </div>
                          <span>
                            <Clock3 size={12} /> {shotDuration(shot)}s{' '}
                            <span className="muted">
                              / {selectedTake ? 'Ready to edit' : 'Not generated'}
                            </span>
                          </span>
                          <button
                            className="icon-button"
                            title="View compiled prompt"
                            aria-label="View prompt"
                            onClick={() => openModal('prompt')}
                          >
                            <FileText size={15} />
                          </button>
                        </div>
                      </div>
                      <div className="shot-strip-title">
                        <span>SCENE SHOTS</span>
                        <span>Drag to reorder</span>
                      </div>
                      <div className="shot-grid">
                        {scene?.shots.map((s, i) => {
                          const take = jobs.find(
                            (j) => j.id === s.selectedTakeId && j.status === 'ready',
                          );
                          return (
                            <button
                              key={s.id}
                              className={`shot-card ${s.id === shot.id ? 'active' : ''}`}
                              draggable
                              onDragStart={() => setDragShot(s.id)}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                if (dragShot && dragShot !== s.id)
                                  edit((p) => {
                                    const sc = p.scenes.find((sc) => sc.id === scene.id)!;
                                    const from = sc.shots.findIndex((s) => s.id === dragShot);
                                    const to = sc.shots.findIndex((shot) => shot.id === s.id);
                                    if (from >= 0) {
                                      const [moved] = sc.shots.splice(from, 1);
                                      sc.shots.splice(to, 0, moved);
                                    }
                                  });
                                setDragShot('');
                              }}
                              onClick={() => selectShot(s, scene)}
                            >
                              <div className="shot-thumbnail">
                                {take?.mediaId ? (
                                  <video
                                    src={`/api/media/${take.mediaId}#t=0.1`}
                                    muted
                                    preload="metadata"
                                  />
                                ) : (
                                  <Artwork variant={allShots.findIndex((sh) => sh.id === s.id)} />
                                )}
                                <span className="thumbnail-number">
                                  {String(i + 1).padStart(2, '0')}
                                </span>
                                <span className="thumbnail-time">{shotDuration(s)}s</span>
                                {take && (
                                  <span className="take-ready">
                                    <Check size={11} />
                                  </span>
                                )}
                              </div>
                              <div className="shot-card-title">{s.title}</div>
                              <div className="shot-card-caption">
                                {take ? 'Take selected' : 'Ready for direction'}
                                <GripVertical size={12} />
                              </div>
                            </button>
                          );
                        })}
                        <button className="add-shot-card" onClick={addShot}>
                          <Plus size={22} />
                          <span>Add shot</span>
                        </button>
                      </div>
                    </>
                  )}
                  {!shot && (
                    <div className="empty-state">
                      <Clapperboard size={35} />
                      <h2>Every film starts with a shot.</h2>
                      <p>Add your first shot and give it some direction.</p>
                      <Button primary onClick={addShot}>
                        <Plus size={15} /> Add shot
                      </Button>
                    </div>
                  )}
                </>
              )}

              {tab === 'script' && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">WRITE THE WORLD</div>
                      <h1>The script</h1>
                      <p>A rough idea, a full screenplay, or anything in between.</p>
                    </div>
                    <Button
                      primary
                      disabled={busy}
                      onClick={() => {
                        setProposedScenes([]);
                        openModal('plan');
                      }}
                    >
                      <WandSparkles size={15} /> Plan with AI
                    </Button>
                  </div>
                  <div className="script-layout">
                    <div className="script-paper">
                      <div className="script-paper-head">
                        <FileText size={15} />
                        <span>{project.name.toUpperCase()}</span>
                        <span>{project.script.length.toLocaleString()} characters</span>
                      </div>
                      <textarea
                        aria-label="Project script"
                        className="script-editor"
                        placeholder={'EXT. YOUR WORLD — DAY\n\nYour story begins here…'}
                        value={project.script}
                        onChange={(e) =>
                          edit((p) => {
                            p.script = e.target.value;
                          })
                        }
                      />
                    </div>
                    <div className="writing-notes">
                      <Sparkles size={23} />
                      <h3>From words to a world</h3>
                      <p>
                        Your script is the starting point. The AI director can suggest scenes and
                        shots using your existing characters, props, and visual style.
                      </p>
                      <div className="note-rule" />
                      <h4>Three kinds of text</h4>
                      <p>
                        <strong>Direction</strong> guides generation.
                      </p>
                      <p>
                        <strong>Dialogue</strong> describes intended speech. Accuracy depends on the
                        model.
                      </p>
                      <p>
                        <strong>On-screen text</strong> is composited during export, not drawn by
                        the AI.
                      </p>
                      <div className="note-rule" />
                      <Button small onClick={() => upload('library')}>
                        <Upload size={14} /> Upload media
                      </Button>
                      <p className="tiny">
                        Paste screenplay text directly into the editor. File-based screenplay import
                        is not enabled.
                      </p>
                    </div>
                  </div>
                </>
              )}

              {tab === 'library' && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">A CONSISTENT WORLD</div>
                      <h1>Your project library</h1>
                      <p>The people, places, and details that make this story yours.</p>
                    </div>
                    <Button
                      primary
                      onClick={() => {
                        setAssetDraft({
                          id: id(),
                          name: '',
                          kind: ['character', 'prop', 'location'].includes(assetFilter)
                            ? (assetFilter as LibraryAsset['kind'])
                            : 'character',
                          description: '',
                        });
                        openModal('asset');
                      }}
                    >
                      <Plus size={15} /> New asset
                    </Button>
                  </div>
                  <div className="filter-row">
                    {['all', 'character', 'prop', 'location', 'media'].map((filter) => (
                      <button
                        key={filter}
                        className={assetFilter === filter ? 'active' : ''}
                        onClick={() => setAssetFilter(filter)}
                      >
                        {filter === 'all'
                          ? 'All assets'
                          : filter === 'media'
                            ? 'Media uploads'
                            : `${filter}s`}
                      </button>
                    ))}
                    <span />
                    <Button small disabled={busy} onClick={() => upload('library')}>
                      <Upload size={14} /> Upload
                    </Button>
                  </div>
                  {assetFilter !== 'media' && (
                    <div className="asset-grid">
                      {project.assets
                        .filter((a) => assetFilter === 'all' || assetFilter === a.kind)
                        .map((asset, i) => (
                          <button
                            className="asset-card"
                            key={asset.id}
                            onClick={() => {
                              setAssetDraft(structuredClone(asset));
                              openModal('asset');
                            }}
                          >
                            <div className={`asset-visual ${asset.kind}`}>
                              {asset.imageId ? (
                                <img src={`/api/media/${asset.imageId}`} alt={asset.name} />
                              ) : asset.kind === 'character' ? (
                                <Users size={45} strokeWidth={1} />
                              ) : asset.kind === 'prop' ? (
                                <Box size={45} strokeWidth={1} />
                              ) : (
                                <Artwork variant={i} />
                              )}
                              <span>{asset.kind}</span>
                            </div>
                            <div className="asset-content">
                              <h3>{asset.name}</h3>
                              <p>{asset.description || 'Add a description and reference image.'}</p>
                              <small>
                                {asset.imageId ? 'Image reference attached' : 'Description only'}
                                <ArrowRight size={13} />
                              </small>
                            </div>
                          </button>
                        ))}
                      <button
                        className="asset-add"
                        onClick={() => {
                          setAssetDraft({ id: id(), name: '', kind: 'character', description: '' });
                          openModal('asset');
                        }}
                      >
                        <Plus size={25} />
                        <span>Create a reusable asset</span>
                      </button>
                    </div>
                  )}
                  {(assetFilter === 'media' || assetFilter === 'all') && (
                    <>
                      <div className="section-heading">
                        <h3>Media uploads</h3>
                        <span>{media.length} files</span>
                      </div>
                      <div className="media-grid">
                        {media.map((item) => (
                          <div key={item.id} className="media-card">
                            <div>
                              {item.mime.startsWith('image/') ? (
                                <img src={`/api/media/${item.id}`} alt={item.name} />
                              ) : item.mime.startsWith('video/') ? (
                                <video src={`/api/media/${item.id}`} controls preload="metadata" />
                              ) : (
                                <audio src={`/api/media/${item.id}`} controls preload="metadata" />
                              )}
                            </div>
                            <strong>{item.name}</strong>
                            <span>
                              {(item.size / 1024 / 1024).toFixed(1)} MB
                              <a href={`/api/media/${item.id}?download`} title="Download file">
                                <Download size={14} />
                              </a>
                            </span>
                          </div>
                        ))}
                      </div>
                      {!media.length && (
                        <div className="inline-empty">
                          Upload reference images, video takes, or a music track. Files stay in your
                          local workspace.
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {tab === 'activity' && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">BEHIND THE SCENES</div>
                      <h1>Production activity</h1>
                      <p>Every generation, every take, every export. Nothing lost.</p>
                    </div>
                    <Button small onClick={() => void act(() => refreshJobs(project.id))}>
                      <RefreshCw size={14} /> Refresh
                    </Button>
                  </div>
                  {!workerOnline && (
                    <div className="notice warning">
                      <AlertTriangle size={17} />
                      <span>
                        {desktopMode ? (
                          'The background service is offline. Close and reopen Frame Studio. Your queued jobs remain safely stored.'
                        ) : (
                          <>
                            Worker offline. Start the full app with <code>npm run dev</code> or run{' '}
                            <code>npm run worker</code>. Queued jobs remain safely stored.
                          </>
                        )}
                      </span>
                    </div>
                  )}
                  <div className="stat-grid">
                    <div>
                      <span>Actual generation spend</span>
                      <strong>{money(spent)}</strong>
                    </div>
                    <div>
                      <span>Reserved / unreported</span>
                      <strong>{money(reserved)}</strong>
                    </div>
                    <div>
                      <span>Shots with a selected take</span>
                      <strong>
                        {readyShots}
                        <em> / {allShots.length}</em>
                      </strong>
                    </div>
                    <div>
                      <span>Queue worker</span>
                      <strong className="worker-stat">
                        <span className={workerOnline ? 'live-dot' : 'pending-dot'} />
                        {workerOnline ? 'Online' : 'Offline'}
                      </strong>
                    </div>
                  </div>
                  <div className="activity-list">
                    {jobs.map((job) => (
                      <div key={job.id} className="activity-card">
                        <div className="activity-icon">
                          {job.kind === 'export' ? <Download size={20} /> : <Film size={20} />}
                        </div>
                        <div className="activity-main">
                          <h3>
                            {job.kind === 'export'
                              ? 'Final film export'
                              : job.shotTitle || 'Deleted shot'}{' '}
                            {renderStatus(job)}
                          </h3>
                          <p>
                            {job.model || 'FFmpeg · 1080p · 24 fps'} <span>·</span>{' '}
                            {new Date(job.createdAt).toLocaleString()}
                          </p>
                          {job.providerId && <code>Provider: {job.providerId}</code>}
                          {job.error && <ProviderErrorNotice error={job.error} />}
                          <div className="job-actions">
                            {job.status === 'queued' && (
                              <button disabled={busy} onClick={() => jobAction(job, 'cancel')}>
                                Cancel before submission
                              </button>
                            )}
                            {job.status === 'submission_unknown' && (
                              <>
                                <button
                                  onClick={() => {
                                    const providerId = window.prompt(
                                      'Find this submission in your OpenRouter activity and paste its video job ID. No new generation will be submitted.',
                                    );
                                    if (providerId) jobAction(job, 'reconcile', providerId.trim());
                                  }}
                                >
                                  Reconcile provider ID
                                </button>
                                <button
                                  onClick={() => {
                                    if (
                                      confirm(
                                        'Acknowledge the unknown charge and release the shot for another generation? The spending reservation will be retained.',
                                      )
                                    )
                                      jobAction(job, 'abandon');
                                  }}
                                >
                                  Acknowledge unresolved charge
                                </button>
                              </>
                            )}
                            {job.status === 'failed' &&
                              job.providerId &&
                              job.providerId !== 'unknown' && (
                                <button onClick={() => jobAction(job, 'retry-download')}>
                                  Recover existing provider job
                                </button>
                              )}
                            {job.mediaId && (
                              <a href={`/api/media/${job.mediaId}?download`}>
                                Download {job.kind === 'export' ? 'film' : 'take'}{' '}
                                <Download size={12} />
                              </a>
                            )}
                            {job.prompt && (
                              <button
                                onClick={() =>
                                  void navigator.clipboard
                                    .writeText(job.prompt!)
                                    .then(() => notify('Prompt copied'))
                                    .catch(() => notify('Clipboard access denied', true))
                                }
                              >
                                Copy prompt
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="activity-cost">
                          {job.cost !== undefined ? (
                            money(job.cost)
                          ) : job.kind === 'video' ? (
                            <>
                              {money(job.approvedMax)}
                              <small>reserved</small>
                            </>
                          ) : (
                            '—'
                          )}
                        </div>
                      </div>
                    ))}
                    {!jobs.length && (
                      <div className="empty-state">
                        <Clock3 size={32} />
                        <h2>The production floor is quiet.</h2>
                        <p>Generate your first shot or upload a video take to get started.</p>
                        <Button onClick={() => setTab('storyboard')}>
                          Back to storyboard <ArrowRight size={14} />
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}

              {tab === 'settings' && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">MAKE IT YOURS</div>
                      <h1>Project & connections</h1>
                      <p>Your production preferences. Your models. Your keys.</p>
                    </div>
                    <Button
                      small
                      onClick={() =>
                        void act(async () => {
                          await flush();
                          notify('Project saved');
                        })
                      }
                    >
                      <Save size={14} /> Save now
                    </Button>
                  </div>
                  <div className="settings-grid">
                    <section className="settings-card">
                      <h3>
                        <Film size={17} /> Project details
                      </h3>
                      <Field label="Film title">
                        <input
                          value={project.name}
                          onChange={(e) =>
                            edit((p) => {
                              p.name = e.target.value;
                            })
                          }
                        />
                      </Field>
                      <Field label="Logline">
                        <textarea
                          rows={3}
                          value={project.description}
                          onChange={(e) =>
                            edit((p) => {
                              p.description = e.target.value;
                            })
                          }
                        />
                      </Field>
                      <Field label="Visual style / project bible">
                        <textarea
                          rows={5}
                          value={project.style}
                          onChange={(e) =>
                            edit((p) => {
                              p.style = e.target.value;
                            })
                          }
                        />
                      </Field>
                      <div className="field-pair">
                        <Field label="Export aspect ratio">
                          <select
                            value={project.aspectRatio}
                            onChange={(e) =>
                              edit((p) => {
                                p.aspectRatio = e.target.value as Project['aspectRatio'];
                              })
                            }
                          >
                            {[
                              '16:9',
                              '9:16',
                              '1:1',
                              '4:3',
                              '3:4',
                              '3:2',
                              '2:3',
                              '21:9',
                              '9:21',
                            ].map((r) => (
                              <option key={r}>{r}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Budget limit (USD)">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={project.budget}
                            onChange={(e) =>
                              edit((p) => {
                                p.budget = Math.max(0, Number(e.target.value));
                              })
                            }
                          />
                        </Field>
                      </div>
                      <Field
                        label="Default video model"
                        hint="Shot-specific selections override this default. No silent model fallback."
                      >
                        <select
                          value={project.defaultModel}
                          onChange={(e) =>
                            edit((p) => {
                              p.defaultModel = e.target.value;
                            })
                          }
                        >
                          <option value="">Choose from OpenRouter…</option>
                          {project.defaultModel &&
                            !catalog?.models.some((m) => m.id === project.defaultModel) && (
                              <option>{project.defaultModel}</option>
                            )}
                          {catalog?.models.map((m) => (
                            <option
                              key={m.id}
                              value={m.id}
                              disabled={!getCapabilities(m).available}
                            >
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Button
                        small
                        onClick={() => {
                          void act(async () => {
                            const p = await flush();
                            const result = await api<{ revisions: typeof revisions }>(
                              `projects/${p.id}/revisions`,
                            );
                            setRevisions(result.revisions);
                            openModal('history');
                          });
                        }}
                      >
                        <History size={14} /> Version history
                      </Button>
                    </section>
                    <div>
                      <section className="settings-card">
                        <h3>
                          <Aperture size={17} /> OpenRouter connection{' '}
                          <span className={`status ${configured ? 'ready' : ''}`}>
                            {configured ? 'Connected' : 'Not connected'}
                          </span>
                        </h3>
                        <p>
                          One server-side key for every available video model. Encrypted at rest;
                          never returned to your browser.
                        </p>
                        <Field
                          label={envKey ? 'API key managed by environment' : 'OpenRouter API key'}
                        >
                          <input
                            type="password"
                            autoComplete="off"
                            placeholder={
                              configured ? '•••••••••••••••••••• (key configured)' : 'sk-or-v1-…'
                            }
                            value={apiKeyDraft}
                            disabled={envKey}
                            onChange={(e) => setApiKeyDraft(e.target.value)}
                          />
                        </Field>
                        <div className="button-row">
                          <Button
                            primary
                            small
                            disabled={busy || envKey || !apiKeyDraft.trim()}
                            onClick={() =>
                              void act(async () => {
                                const result = await api<{ configured: boolean }>(
                                  'settings',
                                  put({ apiKey: apiKeyDraft }),
                                );
                                setConfigured(result.configured);
                                setKeyWarning('');
                                setApiKeyDraft('');
                                await loadModels(true);
                                notify('API key saved securely');
                              })
                            }
                          >
                            <ShieldCheck size={14} /> Save key
                          </Button>
                          {configured && !envKey && (
                            <Button
                              small
                              onClick={() =>
                                void act(async () => {
                                  if (
                                    !confirm(
                                      'Remove your saved API key? Active jobs cannot be polled until a key is restored.',
                                    )
                                  )
                                    return;
                                  await api('settings', put({ apiKey: '' }));
                                  setConfigured(false);
                                  setKeyWarning('');
                                  notify('Saved key removed');
                                })
                              }
                            >
                              Remove key
                            </Button>
                          )}
                          <a
                            href="https://openrouter.ai/settings/keys"
                            target="_blank"
                            rel="noreferrer"
                            className="text-link"
                          >
                            Get a key <ExternalLink size={12} />
                          </a>
                        </div>
                        <div className="notice">
                          <ShieldCheck size={16} />
                          <span>
                            {desktopMode
                              ? 'Windows desktop edition. Your workspace stays on this computer. API access is restricted to this desktop session.'
                              : 'Local, single-user edition. Bound to 127.0.0.1. Do not deploy this build publicly without authentication and tenant isolation.'}
                          </span>
                        </div>
                        {keyWarning && (
                          <div className="notice warning">
                            <AlertTriangle size={16} />
                            <span>{keyWarning}</span>
                          </div>
                        )}
                      </section>
                      <section className="settings-card">
                        <h3>
                          <WandSparkles size={17} /> AI director
                        </h3>
                        <p>
                          The planning model turns scripts into proposed scenes and shots. It does
                          not generate video or submit jobs without approval.
                        </p>
                        <Field label="Planning model">
                          <input
                            list="planning-models"
                            placeholder="Select or enter an OpenRouter text model ID"
                            value={project.planningModel}
                            onChange={(e) =>
                              edit((p) => {
                                p.planningModel = e.target.value;
                              })
                            }
                          />
                          <datalist id="planning-models">
                            {planningModels.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </datalist>
                        </Field>
                        <Button
                          small
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const result = await api<{ models: typeof planningModels }>(
                                'planning-models',
                              );
                              setPlanningModels(result.models);
                              notify(
                                `${result.models.length} planning models loaded. Use the model field to search.`,
                              );
                            })
                          }
                        >
                          <RefreshCw size={14} /> Load text models
                        </Button>
                        <p className="tiny">
                          Planning requests may incur separate OpenRouter text-token charges; these
                          are not included in the video budget ledger.
                        </p>
                      </section>
                      <section className="settings-card">
                        <h3>
                          <FolderOpen size={17} /> Data & recovery
                        </h3>
                        <p>
                          Projects, media, credentials, and jobs are saved in the local{' '}
                          <code>{desktopMode ? '%APPDATA%\\Frame Studio\\data' : 'data/'}</code>{' '}
                          directory. Close Frame Studio before backing up the whole directory,
                          including its encryption key.
                        </p>
                        {desktopMode && (
                          <Button
                            small
                            onClick={() =>
                              void window.frameDesktop
                                ?.openDataFolder()
                                .catch((error) => notify(error.message, true))
                            }
                          >
                            <FolderOpen size={14} /> Open workspace folder
                          </Button>
                        )}
                        <Button
                          small
                          onClick={() =>
                            void act(async () => {
                              const p = await flush();
                              window.location.href = `/api/projects/${p.id}/archive`;
                            })
                          }
                        >
                          <Download size={14} /> Download project manifest
                        </Button>
                        <p className="tiny">
                          The JSON manifest includes metadata, not media files or your API key. It
                          is not a self-contained backup.
                        </p>
                        <div className="button-row">
                          <Button
                            small
                            onClick={() =>
                              void act(async () => {
                                if (
                                  !confirm(
                                    'Reload the saved project and discard any unsaved edits in this tab?',
                                  )
                                )
                                  return;
                                const saved = await api<Project>(`projects/${project.id}`);
                                install(saved);
                                notify('Saved project reloaded');
                              })
                            }
                          >
                            <RefreshCw size={14} /> Reload saved version
                          </Button>
                        </div>
                      </section>
                    </div>
                  </div>
                </>
              )}
            </main>

            {tab === 'storyboard' && studioMode === 'director' && (
              <aside className="inspector">
                <div className="inspector-heading">
                  <div>
                    <Settings2 size={15} /> SHOT INSPECTOR
                  </div>
                  <button
                    className="icon-button"
                    aria-label="View prompt"
                    title="View prompt"
                    onClick={() => openModal('prompt')}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </div>
                {shot ? (
                  <>
                    <div className="inspector-shot">
                      <span>SHOT {String(shotIndex + 1).padStart(2, '0')}</span>
                      <input
                        aria-label="Shot title"
                        value={shot.title}
                        onChange={(e) =>
                          editShot((s) => {
                            s.title = e.target.value;
                          })
                        }
                      />
                      <div className="shot-tool-row">
                        <button
                          title="Move shot earlier"
                          aria-label="Move shot earlier"
                          onClick={() => moveShot(shot.id, -1)}
                        >
                          <ArrowLeft size={13} />
                        </button>
                        <button
                          title="Move shot later"
                          aria-label="Move shot later"
                          onClick={() => moveShot(shot.id, 1)}
                        >
                          <ArrowRight size={13} />
                        </button>
                        <button
                          title="Duplicate shot"
                          aria-label="Duplicate shot"
                          onClick={() =>
                            edit((p) => {
                              const sc = p.scenes.find((s) => s.id === scene!.id)!;
                              const duplicate = {
                                ...structuredClone(shot),
                                id: id(),
                                title: `${shot.title} (copy)`,
                                selectedTakeId: undefined,
                              };
                              sc.shots.splice(
                                sc.shots.findIndex((s) => s.id === shot.id) + 1,
                                0,
                                duplicate,
                              );
                              setSelectedShotId(duplicate.id);
                            })
                          }
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          className="danger-text"
                          title="Delete shot"
                          aria-label="Delete shot"
                          onClick={() => {
                            if (
                              confirm(
                                'Delete this shot? Generated takes remain in activity and media.',
                              )
                            )
                              edit((p) => {
                                const sc = p.scenes.find((s) => s.id === scene!.id)!;
                                sc.shots = sc.shots.filter((s) => s.id !== shot.id);
                                setSelectedShotId(sc.shots[0]?.id || '');
                              });
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <div className="inspector-tabs">
                      <button
                        className={inspectorTab === 'direction' ? 'active' : ''}
                        onClick={() => setInspectorTab('direction')}
                      >
                        Direction
                      </button>
                      <button
                        className={inspectorTab === 'takes' ? 'active' : ''}
                        onClick={() => setInspectorTab('takes')}
                      >
                        Takes <span>{takes.length}</span>
                      </button>
                    </div>
                    <div className="inspector-scroll">
                      {inspectorTab === 'direction' ? (
                        <>
                          <section className="inspector-section">
                            <div className="section-label">
                              <FileText size={13} /> THE SCENE
                            </div>
                            <Field label="Scene title">
                              <input
                                value={scene!.title}
                                onChange={(e) =>
                                  edit((p) => {
                                    p.scenes.find((s) => s.id === scene!.id)!.title =
                                      e.target.value;
                                  })
                                }
                              />
                            </Field>
                            <Field label="Setting & atmosphere">
                              <textarea
                                rows={3}
                                value={scene!.setting}
                                placeholder="Location, time of day, atmosphere…"
                                onChange={(e) =>
                                  edit((p) => {
                                    p.scenes.find((s) => s.id === scene!.id)!.setting =
                                      e.target.value;
                                  })
                                }
                              />
                            </Field>
                            <div className="scene-controls">
                              <button
                                onClick={() =>
                                  edit((p) => {
                                    const i = p.scenes.findIndex((s) => s.id === scene!.id);
                                    if (i > 0)
                                      [p.scenes[i - 1], p.scenes[i]] = [
                                        p.scenes[i],
                                        p.scenes[i - 1],
                                      ];
                                  })
                                }
                              >
                                <ArrowUp size={11} /> Earlier
                              </button>
                              <button
                                onClick={() =>
                                  edit((p) => {
                                    const i = p.scenes.findIndex((s) => s.id === scene!.id);
                                    if (i < p.scenes.length - 1)
                                      [p.scenes[i + 1], p.scenes[i]] = [
                                        p.scenes[i],
                                        p.scenes[i + 1],
                                      ];
                                  })
                                }
                              >
                                <ArrowDown size={11} /> Later
                              </button>
                              <button
                                className="danger-text"
                                onClick={() => {
                                  if (
                                    confirm(
                                      'Delete this scene and all its shots? Take files remain saved.',
                                    )
                                  )
                                    edit((p) => {
                                      p.scenes = p.scenes.filter((s) => s.id !== scene!.id);
                                      setSelectedSceneId(p.scenes[0]?.id || '');
                                      setSelectedShotId(p.scenes[0]?.shots[0]?.id || '');
                                    });
                                }}
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </section>
                          <section className="inspector-section">
                            <div className="section-label">
                              <Clapperboard size={13} /> SHOT DIRECTION
                            </div>
                            <MentionEditor
                              project={project}
                              shot={shot}
                              label="What happens?"
                              value={shot.action}
                              onChange={(action, mentions, assetIds) =>
                                editShot((s) => {
                                  s.action = action;
                                  s.mentions = mentions;
                                  s.assetIds = assetIds;
                                  s.promptOverride = '';
                                })
                              }
                            />
                            <Field label="Camera & composition">
                              <textarea
                                rows={3}
                                value={shot.camera}
                                onChange={(e) =>
                                  editShot((s) => {
                                    s.camera = e.target.value;
                                  })
                                }
                              />
                            </Field>
                            {selectedModel?.generate_audio === true && shot.audio && (
                              <Field
                                label="Dialogue / sound intentions"
                                hint="Spoken wording and lip-sync are not guaranteed."
                              >
                                <textarea
                                  rows={2}
                                  placeholder="Mara: ‘Did you hear that?’"
                                  value={shot.dialogue}
                                  onChange={(e) =>
                                    editShot((s) => {
                                      s.dialogue = e.target.value;
                                    })
                                  }
                                />
                              </Field>
                            )}
                            <Field label="On-screen text" hint="Composited exactly during export.">
                              <input
                                value={shot.overlay}
                                placeholder="Optional title or caption"
                                onChange={(e) =>
                                  editShot((s) => {
                                    s.overlay = e.target.value;
                                  })
                                }
                              />
                            </Field>
                          </section>
                          <section className="inspector-section">
                            <div className="section-label">
                              <Users size={13} /> IN THIS SHOT{' '}
                              <button
                                className="icon-button"
                                aria-label="Add library asset"
                                onClick={() => {
                                  setAssetDraft({
                                    id: id(),
                                    name: '',
                                    kind: 'character',
                                    description: '',
                                  });
                                  openModal('asset');
                                }}
                              >
                                <Plus size={13} />
                              </button>
                            </div>
                            <div className="asset-chips">
                              {project.assets.map((asset) => (
                                <button
                                  key={asset.id}
                                  title={asset.description}
                                  className={shot.assetIds.includes(asset.id) ? 'selected' : ''}
                                  onClick={() =>
                                    editShot((s) => {
                                      s.assetIds = s.assetIds.includes(asset.id)
                                        ? s.assetIds.filter((a) => a !== asset.id)
                                        : [...s.assetIds, asset.id];
                                    })
                                  }
                                >
                                  {asset.kind === 'character' ? (
                                    <Users size={12} />
                                  ) : asset.kind === 'prop' ? (
                                    <Box size={12} />
                                  ) : (
                                    <MapPin size={12} />
                                  )}
                                  {asset.name}
                                  {shot.assetIds.includes(asset.id) && <Check size={11} />}
                                </button>
                              ))}
                            </div>
                            <p className="tiny">
                              Selected descriptions guide the prompt. Photos are never sent
                              automatically; choose a supported image input below. Consistency is
                              guidance, not a guarantee.
                            </p>
                          </section>
                          <section className="inspector-section">
                            <div className="section-label">
                              <Aperture size={13} /> GENERATION MODEL
                            </div>
                            <button className="model-select" onClick={() => openModal('models')}>
                              <span className="model-icon">
                                <Aperture size={19} />
                              </span>
                              <span>
                                <strong>
                                  {selectedModel?.name ||
                                    shot.model ||
                                    project.defaultModel ||
                                    'Select a video model'}
                                </strong>
                                <small>
                                  {selectedModel
                                    ? 'Live from OpenRouter'
                                    : 'Browse OpenRouter models'}
                                </small>
                              </span>
                              <ChevronDown size={13} />
                            </button>
                            <ModelInputs
                              project={project}
                              shot={shot}
                              model={selectedModel}
                              media={media}
                              onChange={(change) => editShot((s) => Object.assign(s, change))}
                              onPickModel={() => openModal('models')}
                              onUpload={upload}
                              busy={busy}
                              compact
                              advanced
                            />
                            {promptCheck && (
                              <div className="prompt-budget">
                                <span>
                                  {promptCheck.prompt.length.toLocaleString()} /{' '}
                                  {promptCheck.limit.toLocaleString()} prompt characters
                                </span>
                              </div>
                            )}
                            {!!generationIssues.length && (
                              <div className="composer-validation">
                                {[...new Set(generationIssues)].map((issue) => (
                                  <p key={issue}>{issue}</p>
                                ))}
                              </div>
                            )}
                            <button
                              className="text-link prompt-link"
                              onClick={() => openModal('prompt')}
                            >
                              <FileText size={12} /> Inspect compiled prompt{' '}
                              <ArrowRight size={12} />
                            </button>
                          </section>
                          <section className="inspector-section">
                            <div className="section-label">EDIT / TRIM</div>
                            <div className="field-pair">
                              <Field label="Start (seconds)">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  max={shot.duration}
                                  value={shot.trimStart}
                                  onChange={(e) =>
                                    editShot((s) => {
                                      s.trimStart = Number(e.target.value);
                                    })
                                  }
                                />
                              </Field>
                              <Field label="End (0 = full clip)">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  max={shot.duration}
                                  value={shot.trimEnd}
                                  onChange={(e) =>
                                    editShot((s) => {
                                      s.trimEnd = Number(e.target.value);
                                    })
                                  }
                                />
                              </Field>
                            </div>
                          </section>
                        </>
                      ) : (
                        <>
                          <div className="takes-heading">
                            <p>
                              Generate variations, compare, then select the take for your timeline.
                            </p>
                            <Button small disabled={busy} onClick={() => upload('take')}>
                              <Upload size={13} /> Import MP4 take
                            </Button>
                          </div>
                          {takes.map((take, i) => (
                            <div
                              className={`take-card ${take.id === shot.selectedTakeId ? 'selected' : ''}`}
                              key={take.id}
                            >
                              <div className="take-card-head">
                                <strong>Take {takes.length - i}</strong>
                                {renderStatus(take)}
                              </div>
                              {take.mediaId && (
                                <video
                                  src={`/api/media/${take.mediaId}`}
                                  controls
                                  preload="metadata"
                                />
                              )}
                              <p>{take.model}</p>
                              {take.error && <ProviderErrorNotice error={take.error} />}
                              {take.status === 'ready' && (
                                <Button
                                  small
                                  primary={take.id === shot.selectedTakeId}
                                  onClick={() =>
                                    editShot((s) => {
                                      s.selectedTakeId = take.id;
                                    })
                                  }
                                >
                                  {take.id === shot.selectedTakeId ? (
                                    <CheckCheck size={13} />
                                  ) : (
                                    <Check size={13} />
                                  )}
                                  {take.id === shot.selectedTakeId
                                    ? 'Selected for timeline'
                                    : 'Use this take'}
                                </Button>
                              )}
                              {take.status === 'submission_unknown' && (
                                <Button small onClick={() => setTab('activity')}>
                                  Reconcile in activity
                                </Button>
                              )}
                            </div>
                          ))}
                          {!takes.length && (
                            <div className="takes-empty">
                              <Film size={28} />
                              <h3>No takes yet</h3>
                              <p>Generate this shot, or import your own footage.</p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="generate-footer">
                      <div>
                        <span>Estimated generation</span>
                        <strong>
                          {selectedModel && estimateCost(selectedModel, shot.duration) !== undefined
                            ? `~${money(estimateCost(selectedModel, shot.duration)!)}`
                            : 'Estimate unavailable'}
                        </strong>
                      </div>
                      <Button
                        primary
                        disabled={
                          busy ||
                          !configured ||
                          !selectedModel ||
                          Boolean(activeJob) ||
                          generationIssues.length > 0
                        }
                        onClick={startGenerationReview}
                      >
                        {activeJob ? (
                          <Loader2 size={16} className="spin" />
                        ) : (
                          <Sparkles size={16} />
                        )}
                        {activeJob ? 'Generation in progress' : 'Generate shot'}
                        {!activeJob && <ArrowRight size={15} />}
                      </Button>
                      {!configured && (
                        <button className="connect-link" onClick={() => setTab('settings')}>
                          Add your OpenRouter key to begin
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="inline-empty">Add a shot to start directing.</div>
                )}
              </aside>
            )}
          </div>

          <footer className="timeline">
            <div className="timeline-header">
              <div>
                <Layers3 size={14} />
                <strong>Film timeline</strong>
                <span>
                  {readyShots} / {allShots.length} shots ready
                </span>
              </div>
              <span className="timeline-runtime">
                {String(Math.floor(totalDuration / 60)).padStart(2, '0')}:
                {String(Math.floor(totalDuration % 60)).padStart(2, '0')}{' '}
                <span>/ TOTAL DURATION</span>
              </span>
              <button onClick={() => openModal('export')}>
                <Download size={12} /> Export
              </button>
            </div>
            <div className="timeline-body">
              <div className="track-labels">
                <span>
                  <Film size={13} /> VIDEO
                </span>
                <span>
                  <AudioLines size={13} /> MUSIC
                </span>
              </div>
              <div className="tracks">
                <div className="video-track">
                  {allShots.map((s, i) => {
                    const sc = project.scenes.find((sc) => sc.shots.some((sh) => sh.id === s.id))!;
                    return (
                      <button
                        key={s.id}
                        style={{ flexGrow: Math.max(1, shotDuration(s)) }}
                        className={`timeline-clip ${s.id === shot?.id ? 'active' : ''} ${s.selectedTakeId ? 'has-take' : ''}`}
                        onClick={() => {
                          selectShot(s, sc);
                          setTab('storyboard');
                        }}
                      >
                        <Film size={12} />
                        <span>
                          {String(i + 1).padStart(2, '0')} · {s.title}
                        </span>
                        <small>{shotDuration(s)}s</small>
                      </button>
                    );
                  })}
                  {!allShots.length && (
                    <span className="timeline-empty">Your story will take shape here.</span>
                  )}
                </div>
                <div className="music-track">
                  {project.musicId ? (
                    <>
                      <AudioLines size={13} />
                      <span>
                        {media.find((m) => m.id === project.musicId)?.name || 'Music track'}
                      </span>
                      <label>
                        Volume{' '}
                        <input
                          aria-label="Music volume"
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={project.musicVolume}
                          onChange={(e) =>
                            edit((p) => {
                              p.musicVolume = Number(e.target.value);
                            })
                          }
                        />
                      </label>
                      <button
                        className="icon-button"
                        aria-label="Remove music"
                        onClick={() =>
                          edit((p) => {
                            delete p.musicId;
                          })
                        }
                      >
                        <X size={12} />
                      </button>
                    </>
                  ) : (
                    <button onClick={() => upload('music')}>
                      <Plus size={12} /> Add a music track <span>MP3, WAV, FLAC, OGG, M4A</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </footer>
        </div>

        {notification && (
          <div className={`toast ${notification.error ? 'error' : ''}`} role="status">
            {notification.error ? <AlertTriangle size={18} /> : <Check size={18} />}
            <span>{notification.message}</span>
            <button onClick={() => setNotification(null)} aria-label="Dismiss notification">
              <X size={15} />
            </button>
          </div>
        )}
        {busy && (
          <div className="busy-indicator">
            <Loader2 size={13} className="spin" /> Working…
          </div>
        )}

        {modal === 'new-project' && (
          <ModalShell
            title="A new story starts here."
            subtitle="Create a local project. You can change every detail later."
            close={() => setModal(null)}
          >
            <div className="modal-body">
              <Field label="Film title">
                <input
                  autoFocus
                  placeholder="Untitled film"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newName.trim() && !busy)
                      void act(async () => {
                        await flush();
                        const p = await api<Project>('projects', post({ name: newName.trim() }));
                        setProjectList((list) => [p, ...list]);
                        install(p);
                        setModal(null);
                      });
                  }}
                />
              </Field>
            </div>
            <div className="modal-footer">
              <Button onClick={() => setModal(null)}>Cancel</Button>
              <Button
                primary
                disabled={!newName.trim() || busy}
                onClick={() =>
                  void act(async () => {
                    await flush();
                    const p = await api<Project>('projects', post({ name: newName.trim() }));
                    setProjectList((list) => [p, ...list]);
                    setJobs([]);
                    setMedia([]);
                    install(p);
                    setModal(null);
                  })
                }
              >
                Create project <ArrowRight size={14} />
              </Button>
            </div>
          </ModalShell>
        )}

        {modal === 'models' && (
          <ModalShell
            title="Choose your video model"
            subtitle="Live model settings, with conservative input guards where the catalog is incomplete. Only compatible controls will be offered."
            close={() => setModal(null)}
            wide
          >
            <div className="model-toolbar">
              <div className="search-input">
                <Search size={16} />
                <input
                  autoFocus
                  aria-label="Search models"
                  placeholder="Search models or providers…"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                />
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={audioFilter}
                  onChange={(e) => setAudioFilter(e.target.checked)}
                />{' '}
                Native audio
              </label>
              <Button small disabled={modelsLoading} onClick={() => void loadModels(true)}>
                <RefreshCw size={14} className={modelsLoading ? 'spin' : ''} />
              </Button>
            </div>
            <div className="model-list">
              {catalogError && (
                <div className="notice warning">
                  <AlertTriangle size={16} />
                  <span>{catalogError}</span>
                </div>
              )}
              {catalog?.stale && (
                <div className="notice warning">
                  Cached catalog — refresh failed. Generation requires a current catalog.
                </div>
              )}
              {modelsLoading && !catalog && (
                <div className="inline-empty">
                  <Loader2 size={20} className="spin" /> Loading OpenRouter catalog…
                </div>
              )}
              {catalog?.models
                .filter(
                  (m) =>
                    (!audioFilter || m.generate_audio) &&
                    `${m.name} ${m.id}`.toLowerCase().includes(modelSearch.toLowerCase()),
                )
                .map((model) => (
                  <button
                    key={model.id}
                    className={`model-option ${model.id === selectedModel?.id ? 'selected' : ''}`}
                    disabled={!getCapabilities(model).available}
                    onClick={() => applyModel(model)}
                  >
                    <div className="model-option-icon">
                      <Aperture size={23} />
                    </div>
                    <div>
                      <h3>
                        {model.name}
                        {model.id === selectedModel?.id && <Check size={15} />}
                      </h3>
                      <code>{model.id}</code>
                      <p>{model.description?.slice(0, 170)}</p>
                      <div className="capability-tags">
                        <span>
                          {model.supported_durations?.length
                            ? `${Math.min(...model.supported_durations)}–${Math.max(...model.supported_durations)} seconds`
                            : 'Specialized workflow required'}
                        </span>
                        {getCapabilities(model).modes.map((mode) => (
                          <span key={mode}>{inputModeLabels[mode]}</span>
                        ))}
                        {getCapabilities(model).available && (
                          <span>
                            Prompt ≤ {getCapabilities(model).promptLimit.toLocaleString()}{' '}
                            characters
                          </span>
                        )}
                        {model.supported_resolutions?.map((r) => (
                          <span key={r}>{r}</span>
                        ))}
                        {model.generate_audio && (
                          <span>
                            <AudioLines size={10} /> Audio
                          </span>
                        )}
                        {model.supported_frame_images?.length ? <span>Frame guidance</span> : null}
                      </div>
                      {!getCapabilities(model).available && (
                        <p>{getCapabilities(model).unavailableReason}</p>
                      )}
                      {studioMode === 'director' && (
                        <div className="sku-prices">
                          {Object.entries(model.pricing_skus || {}).map(([sku, price]) => (
                            <span key={sku}>
                              {sku}: {price}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <ArrowRight size={17} />
                  </button>
                ))}
              {catalog?.models.length === 0 && (
                <div className="inline-empty">No video models returned by OpenRouter.</div>
              )}
            </div>
            <div className="model-footer">
              <ShieldCheck size={13} /> No hardcoded catalog. No automatic model substitution.
              <span>
                {catalog ? `Updated ${new Date(catalog.fetchedAt).toLocaleTimeString()}` : ''}
              </span>
            </div>
          </ModalShell>
        )}

        {modal === 'asset' && assetDraft && (
          <ModalShell
            title={
              project.assets.some((a) => a.id === assetDraft.id)
                ? 'Edit your asset'
                : 'Build your world'
            }
            subtitle="Reusable descriptions and image references help guide continuity."
            close={() => setModal(null)}
          >
            <div className="modal-body">
              <div className="field-pair">
                <Field label="Name">
                  <input
                    autoFocus
                    value={assetDraft.name}
                    placeholder="Character, prop, or place name"
                    onChange={(e) => setAssetDraft({ ...assetDraft, name: e.target.value })}
                  />
                </Field>
                <Field label="Asset type">
                  <select
                    value={assetDraft.kind}
                    onChange={(e) =>
                      setAssetDraft({ ...assetDraft, kind: e.target.value as LibraryAsset['kind'] })
                    }
                  >
                    <option value="character">Character</option>
                    <option value="prop">Prop</option>
                    <option value="location">Location</option>
                  </select>
                </Field>
              </div>
              <Field label="Description / continuity notes">
                <textarea
                  rows={6}
                  value={assetDraft.description}
                  placeholder="Appearance, materials, wardrobe, distinctive features…"
                  onChange={(e) => setAssetDraft({ ...assetDraft, description: e.target.value })}
                />
              </Field>
              <Field label="Reference image">
                <select
                  value={assetDraft.imageId || ''}
                  onChange={(e) =>
                    setAssetDraft({ ...assetDraft, imageId: e.target.value || undefined })
                  }
                >
                  <option value="">Description only</option>
                  {media
                    .filter((m) => m.mime.startsWith('image/'))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </Field>
              {assetDraft.imageId && (
                <img
                  className="asset-reference-preview"
                  src={`/api/media/${assetDraft.imageId}`}
                  alt="Asset reference"
                />
              )}
              <Button small disabled={busy} onClick={() => upload('reference')}>
                <ImagePlus size={14} /> Upload a reference
              </Button>
              <p className="tiny">
                PNG, JPEG, or WebP, up to 5 MB for generation. You must have rights and consent to
                use uploaded likenesses. Inline reference support can vary by provider.
              </p>
            </div>
            <div className="modal-footer">
              {project.assets.some((a) => a.id === assetDraft.id) && (
                <Button
                  className="danger-text"
                  onClick={() => {
                    if (confirm('Delete this asset and remove it from all shots?')) {
                      edit((p) => {
                        p.assets = p.assets.filter((a) => a.id !== assetDraft.id);
                        p.scenes.forEach((sc) =>
                          sc.shots.forEach((s) => {
                            s.assetIds = s.assetIds.filter((a) => a !== assetDraft.id);
                          }),
                        );
                      });
                      setModal(null);
                    }
                  }}
                >
                  <Trash2 size={14} /> Delete
                </Button>
              )}
              <span />
              <Button
                primary
                disabled={!assetDraft.name.trim() || busy}
                onClick={() => {
                  edit((p) => {
                    const index = p.assets.findIndex((a) => a.id === assetDraft.id);
                    if (index >= 0) p.assets[index] = assetDraft;
                    else p.assets.push(assetDraft);
                  });
                  setModal(null);
                }}
              >
                Save asset <Check size={14} />
              </Button>
            </div>
          </ModalShell>
        )}

        {modal === 'prompt' && shot && scene && (
          <ModalShell
            title="The generation prompt"
            subtitle="Inspect the final direction. Editing here makes an exact custom override. Only explicitly selected, supported image inputs are attached."
            close={() => setModal(null)}
            wide
          >
            <div className="modal-body">
              <div className="prompt-meta">
                <span>{selectedModel?.name || 'No model selected'}</span>
                <span>
                  {shot.duration}s · {shot.resolution} · {shot.aspectRatio}
                </span>
              </div>
              <Field
                label={
                  shot.promptOverride ? 'Custom prompt override' : 'Compiled from your project'
                }
              >
                <textarea
                  className="prompt-editor"
                  rows={14}
                  value={
                    promptCheck?.prompt ||
                    compilePrompt(project, scene, effectiveShot || shot, selectedModel)
                  }
                  onChange={(e) =>
                    editShot((s) => {
                      s.promptOverride = e.target.value;
                    })
                  }
                />
              </Field>
              <div className="notice">
                <ImagePlus size={16} />
                <span>
                  {activeImageIds(shot).length} explicitly attached image
                  {activeImageIds(shot).length === 1 ? '' : 's'} in{' '}
                  {inputModeLabels[shot.inputMode || 'text']} mode. Library photos are never
                  attached automatically. Prompts and asset descriptions are snapshotted when you
                  approve generation.
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <Button
                onClick={() =>
                  editShot((s) => {
                    s.promptOverride = '';
                  })
                }
              >
                <RefreshCw size={13} /> Reset to compiled
              </Button>
              <span />
              <Button primary onClick={() => setModal(null)}>
                Done <Check size={14} />
              </Button>
            </div>
          </ModalShell>
        )}

        {modal === 'generate' && shot && (
          <ModalShell
            title="Ready to call action?"
            subtitle="Review the request before spending OpenRouter credits."
            close={() => !busy && setModal(null)}
          >
            <div className="modal-body">
              <div className="generation-summary">
                <div>
                  <span>SHOT</span>
                  <strong>{shot.title}</strong>
                </div>
                <div>
                  <span>MODEL</span>
                  <strong>{selectedModel?.name || 'No model'}</strong>
                </div>
                <div>
                  <span>OUTPUT</span>
                  <strong>
                    {shot.duration}s · {shot.resolution} · {shot.aspectRatio}
                  </strong>
                </div>
                <div>
                  <span>ESTIMATE</span>
                  <strong>
                    {selectedModel && estimateCost(selectedModel, shot.duration) !== undefined
                      ? money(estimateCost(selectedModel, shot.duration)!)
                      : 'Unavailable — inspect model pricing'}
                  </strong>
                </div>
              </div>
              <details className="request-details">
                <summary>Inspect request & attached references</summary>
                <pre>{JSON.stringify(requestPreview, null, 2)}</pre>
              </details>
              <Field
                label="Budget reservation (USD)"
                hint="Internal reservation, not a provider-enforced price cap. Actual charges can exceed this value. Unknown/unreported charges retain the reservation."
              >
                <input
                  type="number"
                  min="0.01"
                  step="0.25"
                  value={reservation}
                  onChange={(e) => setReservation(Number(e.target.value))}
                />
              </Field>
              {!workerOnline && (
                <div className="notice warning">
                  <AlertTriangle size={15} />
                  <span>The worker is offline. This job will wait until it starts.</span>
                </div>
              )}
              <label className="approval">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                <span>
                  I approve this billable OpenRouter request and confirm that I have rights to the
                  provided content. Output quality, continuity, and dialogue are not guaranteed.
                </span>
              </label>
            </div>
            <div className="modal-footer">
              <Button disabled={busy} onClick={() => setModal(null)}>
                Keep editing
              </Button>
              <Button
                primary
                disabled={busy || !approved || !reservation || !selectedModel}
                onClick={generate}
              >
                {busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} Generate
                shot
              </Button>
            </div>
          </ModalShell>
        )}

        {modal === 'export' && (
          <ModalShell
            title="From shots to a film."
            subtitle="Render the saved timeline into a downloadable MP4."
            close={() => setModal(null)}
          >
            <div className="modal-body">
              <div className="export-preview">
                <Film size={36} />
                <h3>{project.name}</h3>
                <p>
                  {totalDuration}s · {project.aspectRatio} · 1080p · 24 fps
                </p>
                <span>
                  {readyShots} of {allShots.length} shot{allShots.length === 1 ? ' has' : 's have'}{' '}
                  a selected take
                </span>
              </div>
              <div className="notice">
                <Layers3 size={16} />
                <span>
                  FFmpeg assembles selected takes with trims, exact text captions, and optional
                  background music. Mixed aspect ratios are letterboxed. This version supports hard
                  cuts, not transitions or arbitrary multitrack editing.
                </span>
              </div>
              {readyShots !== allShots.length && (
                <div className="notice warning">
                  <AlertTriangle size={16} />
                  <span>
                    Every shot needs a selected, ready take. Open its Takes tab to generate or
                    import footage.
                  </span>
                </div>
              )}
              {!workerOnline && (
                <div className="notice warning">Start the worker before rendering.</div>
              )}
              <div className="recent-exports">
                {jobs
                  .filter((j) => j.kind === 'export')
                  .slice(0, 3)
                  .map((j) => (
                    <div key={j.id}>
                      <div>
                        <strong>{new Date(j.createdAt).toLocaleString()}</strong>
                        {renderStatus(j)}
                        {j.error && <p className="danger-text">{j.error}</p>}
                      </div>
                      {j.mediaId && (
                        <a className="button small" href={`/api/media/${j.mediaId}?download`}>
                          <Download size={13} /> MP4
                        </a>
                      )}
                    </div>
                  ))}
              </div>
            </div>
            <div className="modal-footer">
              <Button onClick={() => setModal(null)}>Back to studio</Button>
              <Button
                primary
                disabled={
                  busy ||
                  !allShots.length ||
                  readyShots !== allShots.length ||
                  jobs.some((j) => j.kind === 'export' && activeStatuses.includes(j.status))
                }
                onClick={() =>
                  void act(async () => {
                    const p = await flush();
                    await api(`projects/${p.id}/export`, post({ revision: p.revision }));
                    await refreshJobs(p.id);
                    notify('Export queued. Download here when it is ready.');
                  })
                }
              >
                <Download size={15} /> Render film
              </Button>
            </div>
          </ModalShell>
        )}

        {modal === 'plan' && (
          <ModalShell
            title="Your AI assistant director"
            subtitle="Turn your script into a proposed scene and shot breakdown."
            close={() => !busy && setModal(null)}
            wide
          >
            <div className="modal-body">
              {!proposedScenes.length ? (
                <>
                  <div className="notice">
                    <WandSparkles size={18} />
                    <span>
                      Using <strong>{project.planningModel || 'no planning model selected'}</strong>
                      . This makes a billable text request, separate from the video budget. No video
                      generation will be submitted.
                    </span>
                  </div>
                  {!project.planningModel && (
                    <Button
                      onClick={() => {
                        setModal(null);
                        setTab('settings');
                      }}
                    >
                      Choose a planning model <ArrowRight size={14} />
                    </Button>
                  )}
                  <p className="plan-intro">
                    The director reads your script, visual style, and library descriptions. You
                    review the proposal before anything is added. Existing scenes are never
                    overwritten.
                  </p>
                  <label className="approval">
                    <input
                      type="checkbox"
                      checked={approved}
                      onChange={(e) => setApproved(e.target.checked)}
                    />
                    <span>
                      I approve sending this script and asset descriptions to the selected text
                      model and any associated OpenRouter charges.
                    </span>
                  </label>
                </>
              ) : (
                <div className="proposed-scenes">
                  {proposedScenes.map((sc, index) => (
                    <div key={sc.id}>
                      <h3>
                        {String(index + 1).padStart(2, '0')} · {sc.title}
                      </h3>
                      <p>{sc.setting}</p>
                      {sc.shots.map((s) => (
                        <div key={s.id}>
                          <strong>{s.title}</strong>
                          <p>{s.action}</p>
                          <small>{s.camera}</small>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <Button disabled={busy} onClick={() => setModal(null)}>
                Cancel
              </Button>
              {proposedScenes.length ? (
                <Button
                  primary
                  onClick={() => {
                    edit((p) => {
                      p.scenes.push(...proposedScenes);
                    });
                    setSelectedSceneId(proposedScenes[0].id);
                    setSelectedShotId(proposedScenes[0].shots[0].id);
                    setModal(null);
                    setTab('storyboard');
                    notify('Proposed scenes appended. Your existing scenes were preserved.');
                  }}
                >
                  <Plus size={15} /> Append {proposedScenes.length} scenes
                </Button>
              ) : (
                <Button
                  primary
                  disabled={busy || !approved || !project.planningModel || !project.script.trim()}
                  onClick={() =>
                    void act(async () => {
                      const p = await flush();
                      const result = await api<{ scenes: Scene[] }>(
                        `projects/${p.id}/plan`,
                        post({ approved: true }),
                      );
                      setProposedScenes(result.scenes);
                    })
                  }
                >
                  {busy ? <Loader2 size={15} className="spin" /> : <WandSparkles size={15} />}{' '}
                  Create a proposal
                </Button>
              )}
            </div>
          </ModalShell>
        )}

        {modal === 'history' && (
          <ModalShell
            title="Project version history"
            subtitle="The last 30 saved revisions. Restoring makes a new revision."
            close={() => setModal(null)}
          >
            <div className="modal-body history-list">
              {revisions.map((revision) => (
                <div key={revision.id}>
                  <div>
                    <strong>Revision {revision.project.revision}</strong>
                    <p>
                      {new Date(revision.project.updatedAt).toLocaleString()} ·{' '}
                      {revision.project.scenes.length} scenes
                    </p>
                  </div>
                  <Button
                    small
                    onClick={() => {
                      if (
                        confirm(
                          'Restore this revision? Your current saved version will remain in history.',
                        )
                      ) {
                        edit((p) => {
                          const currentRevision = p.revision;
                          const currentId = p.id;
                          Object.assign(p, revision.project, {
                            revision: currentRevision,
                            id: currentId,
                          });
                        });
                        setModal(null);
                        notify('Revision restored. Saving as a new version.');
                      }
                    }}
                  >
                    Restore
                  </Button>
                </div>
              ))}
              {!revisions.length && <p>No previous saves yet.</p>}
            </div>
          </ModalShell>
        )}
      </div>
    </NoticeContext.Provider>
  );
}
