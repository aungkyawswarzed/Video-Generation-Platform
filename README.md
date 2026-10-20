# Frame — AI film studio

A Windows desktop and local-first video production studio. Author scenes and shots, reuse characters and props, inspect prompts, generate video takes, and assemble a film.

**This is the functional single-user edition, not a finished public SaaS.** The production roadmap and remaining boundaries are documented below. The artwork in a new project is explicitly labeled as an illustration, not AI-generated footage.

## Windows — ready to run, no commands

Open the **`release`** folder:

- **`Frame-Studio-0.3.0-Windows-x64.exe`** — double-click the installer, then launch Frame Studio from the Start menu or desktop.
- **`Frame-Studio-0.3.0-Windows-x64.zip`** — extract the entire ZIP, then double-click **`Frame Studio.exe`**. Keep its companion files together.
- **`READ-ME-FIRST.txt`** — plain-English Windows instructions.
- **`SHA256SUMS.txt`** — release artifact checksums.

The desktop package includes Electron, a checksum-verified Node.js 24.21.0 runtime, the production application, its worker, and a checksum-verified FFmpeg 9.0.2 video engine. You do **not** install Node, npm, FFmpeg, or a separate browser. Only AI generation needs internet access and your funded OpenRouter account/key.

Projects are stored in **`%APPDATA%\Frame Studio\data`**, not the installation folder. Both Windows editions share that per-user location. Use **File → Open workspace folder** to find it. The app saves before closing, stops its own processes, and warns about unfinished work. A private per-launch token restricts the internal loopback API to the desktop session. The renderer is sandboxed, context-isolated, and has no Node integration.

**Unsigned build:** no code-signing certificate was supplied. Windows may display an unknown-publisher/SmartScreen warning. Verify the source and checksums before running; do not disable antivirus protections. Target: Windows 10/11 x64. Allow at least 1.5 GB plus media storage.

See `desktop/WINDOWS-README.txt` for backup, closing behavior, and limitations. This is still a single-user product; it is not a hosted collaborative SaaS.

## Developer quick start (not needed to use the Windows package)

Requires **Node.js 24.15+** (tested on Node 24.21), npm, and a modern browser.

```powershell
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. Both the website and background worker start together.

1. Open **Settings** (gear icon in the left rail).
2. Save an OpenRouter API key. Alternatively, copy `.env.example` to `.env.local` and configure `OPENROUTER_API_KEY`, then restart both processes.
3. Create a project or explore **The last light**, the sample storyboard.
4. Add assets in the library. In **Simple mode**, type `@` in the large video prompt to pick characters, scenes, props, and locations. Mentions add text descriptions, not photos.
5. Select a video model from OpenRouter. Review any required parameter changes.
6. Choose an offered input style: **Text to video**, **Animate an image**, or **Reference images** where verified. Attach images explicitly. Click **Create video** in Simple mode or **Generate shot** in Director mode, review the request, and approve the billable request.
7. In **Takes**, select a ready take. Repeat for every shot.
8. Reorder shots, set trims, add on-screen text and optional music, then **Export film**.

No API key is needed to edit projects or test export with your own MP4 footage. Use **Takes → Import MP4 take**, select it, and set the shot duration to match the footage.

### FFmpeg setup

`ffmpeg-static` supplies a platform binary when installation scripts are allowed. npm 12 script approvals for the pinned package versions are included in `package.json`. If the executable is missing:

```powershell
node node_modules/ffmpeg-static/install.js
```

Alternatively install FFmpeg on your system, or set `FFMPEG_PATH` in `.env.local` to its full executable path. Export needs an FFmpeg build with `libx264`, AAC, and the `subtitles`/libass filter. Fonts available to FFmpeg determine subtitle glyph coverage.

### Production-mode local run

```powershell
npm run build
npm start
```

The app deliberately binds to `127.0.0.1`. Keep it local. It has no user authentication or tenant isolation.

## Implemented

### Simple / Director workspaces and compatibility guards (0.3)

- Simple mode is the default: one large prompt with keyboard-accessible `@` suggestions for characters, props, locations, and project scenes. Stable-ID mention bindings survive item renames; deleted/unresolved mentions block submission.
- Director mode keeps the detailed scene/camera/dialogue/trim/timeline tools. Switching views preserves those fields; camera/dialogue instructions are excluded from Simple requests.
- Both modes use the same capability-driven inputs. `frame_images` and `input_references` are separate, mutually exclusive modes. Library photos are **never** automatically sent with character or prop mentions.
- Live video metadata drives durations, resolutions, aspect ratios, first/last frames, native audio, and seeds. Unsupported optional parameters are omitted rather than sent as `false` or guessed values.
- The catalog does not expose all reference-image or prompt-length limits. Unknown reference routes stay disabled. Narrow reference profiles cover documented Seedance 2.x routes (at most 9 images in the app) and the Wan 2.7 reference example (conservative one-image limit). Image/audio-only avatar/edit/upscale workflows are unavailable rather than being sent through the wrong input form. Audio/video reference uploads are not enabled in this release.
- Missing prompt-length metadata uses a conservative **1,000-character app guard**. Kling v3.0 Pro/Standard and Video O1 use a **2,500-character compatibility limit**. The exact final prompt is checked before queueing; user instructions are not silently cut. Library/style context may be excerpted with a visible notice.
- Explicit provider rejections can tighten reference/frame support or prompt limits locally. These guards persist across restarts. A content/privacy-policy rejection never disables an otherwise supported input type and never triggers an automatic retry.
- Larger typography, readable error summaries, collapsed technical details, and automatic duration detection for imported MP4 takes.

Close the older desktop app before upgrading. Existing data and keys remain in the same per-user folder; new fields receive non-destructive defaults on load. Old photos remain in the library; old projects start with text input until an image mode is selected explicitly.

- Multiple persistent projects, automatic saves, Ctrl/Cmd+S, revision conflicts, last-project restoration, and 30-version recovery history.
- Scenes and shots: add, edit, duplicate, remove, reorder, and assign scene atmosphere, camera, action, dialogue, and captions.
- Character, prop, and location library with reusable descriptions and uploaded reference images.
- Script editor and an optional AI director. Text models are discoverable from OpenRouter; proposals are schema-validated and appended only after review.
- Live video model selector, searchable catalog, audio filter, capability badges, raw pricing SKUs, and explicit parameter migration.
- Duration, resolution, aspect ratio, native audio, supported seeds, and supported first/last-frame controls.
- Prompt compiler, editable prompt override, redacted request preview, and reference attachment.
- Billable-request approval, conservative cost estimates, transactional spending reservations, and actual-charge tracking when supplied by OpenRouter.
- Durable SQLite generation queue, polling, automatic downloads to local storage, worker heartbeat, safe recovery, and no blind resubmission of ambiguous generation requests.
- Multiple takes, uploaded MP4 takes, selection, preview, and generation history.
- Shot timeline with drag reordering within a scene, move controls, trims, a music track, and volume.
- Real FFmpeg exports: H.264 MP4, 24 fps, 1080-pixel output height, letterboxing, normalized audio, hard cuts, burned-in text, and optional mixed music.
- Private local media endpoints with byte-range support, file signature validation, manifest download, and mobile layout.
- Encrypted server-side credentials, loopback Host checks, same-origin checks, framing restrictions, and no third-party font requests.

## Costs and generation safety

- **Submitting a video generation spends real OpenRouter credits.** There is no fake generation or hidden fallback model.
- A budget reservation is an **internal accounting safeguard, not a provider price cap**. Final charges can exceed it. Unknown pricing requires an explicit reservation and approval.
- Estimates are calculated only for a single unambiguous `per-video-second` SKU. Complex pricing is shown verbatim, not guessed.
- Unreported completed-job costs and uncertain/possibly billed failed jobs retain their reservations conservatively.
- A network failure during submission results in `submission_unknown`, not an automatic retry. Use **Activity → Reconcile provider ID** with the ID from OpenRouter. Acknowledging an unknown charge frees the shot but retains the reservation.
- Only **queued, unsubmitted** jobs can be cancelled locally. Cancelling a running provider job is not implemented.
- Poll/download failures retry with backoff, without creating a new billable generation. Recover an existing provider job from Activity if needed.
- Planning-model token charges are separate and **not included in the video budget ledger**. The AI director asks for approval before the text request.
- Native audio does not imply accurate dialogue, consistent voices, or reliable lip-sync. Character identity and seed determinism are not guaranteed.
- Reference images use inline data URLs; a provider can reject these or impose smaller reference limits. The job reports the provider error rather than silently dropping references. Input modes are exclusive: at most 12 reference images or 2 frame images in one request, 5 MB per image and 20 MB total.

## Storage, backup, and privacy

The browser/development edition defaults to `./data`. The Windows desktop edition uses `%APPDATA%\Frame Studio\data`. The contents are:

```text
data/
  studio.sqlite         projects, revisions, jobs, settings, media metadata
  studio.sqlite-wal     SQLite write-ahead log when active
  studio.sqlite-shm
  .encryption-key       AES-256-GCM encryption key (keep private)
  media/                original uploads, generated clips, final exports
  renders/              intermediate export files and subtitle files
```

Stop both processes, then back up the **whole data directory**, including `.encryption-key`. A downloaded project manifest is metadata only; it is not a portable media archive or an importable project format yet. Never commit `data/`, `.env.local`, or credentials.

In the development edition, `STUDIO_DATA_DIR` can point to another absolute local directory. The desktop edition manages its own data path and does not inherit developer credentials or data-directory overrides. Both service processes use the same per-user workspace. Do not put SQLite on a network share. There is no automatic media deletion, purge, or disk-space cleanup in this version.

The browser never receives the stored API key. Jobs retain prompt and project snapshots, including private references. Data sent to OpenRouter and its providers is subject to their retention policies. Local encryption protects the key in the database, **not against someone who can read the whole data directory**. Windows users should protect the directory with user-level NTFS permissions; POSIX mode flags do not provide Windows ACL protection.

Only upload trusted media and content you have rights and consent to use. FFmpeg executes as the local user, not in a sandbox. Do not expose this application or reverse-proxy it onto a public host.

## Tests

```powershell
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
```

- Unit/integration tests cover schemas, compilation, capability validation, conservative pricing, trims, encryption, persistence, stale revisions, rollback, deduplication, budgets, and reference ownership.
- Playwright starts its own app and worker on **127.0.0.1:3100**, with isolated `.frame-e2e-data/` and `.next-e2e/` directories. Port 3100 must be free.
- Browser tests exercise persistent editing, Simple/Director switching, `@` mentions, capability-driven input modes and prompt limits, readable provider errors, assets, script planning approval, modal controls, desktop/mobile layout, same-origin security, real FFmpeg rendering with music/captions/trims, and range downloads.
- Tests never submit paid OpenRouter generations. Catalog discovery may access the public OpenRouter endpoint. Live paid generation and text planning need your key and should be verified separately with a small approved request.
- Screenshots and failure traces are written to `test-results/`.

### Desktop packaging and artifact tests (developers only)

```powershell
npm run desktop:package
npm run desktop:test
```

Packaging downloads pinned, SHA-256-verified Windows runtimes, creates a standalone Next.js production build, bundles the worker, embeds a native desktop shell and app icon, and produces the NSIS installer plus no-install ZIP. User projects, API keys, `.env` files, and the development workspace are excluded. Third-party licenses and a runtime build manifest are included under `resources/licenses`.

Desktop tests extract the actual release ZIP to a path containing spaces and non-ASCII characters **outside the repository**, clear Node/npm from `PATH`, use an isolated Windows profile, and launch the real packaged executable. They verify sandboxing, private API access, startup/worker readiness, saving an in-flight edit chain on native close, relaunch persistence, M4A import, real bundled-FFmpeg export with trims/text/music, MP4 saving, and child-process cleanup. No paid AI generations are submitted.

`desktop/main.cjs` manages the native window, per-session access token, process lifecycle, menus, save/download dialogs, and diagnostics. `scripts/prepare-desktop.mjs` builds the redistributable staging tree. The desktop distribution is unsigned; signing is a separate release requirement if public distribution is intended.

## Code map

| Path | Responsibility |
| --- | --- |
| `src/components/studio.tsx` | Authoring UI, save queue, model selector, timeline and dialogs |
| `src/components/artwork.tsx` | Clearly labeled sample storyboard illustration |
| `src/lib/types.ts` | Shared types and runtime validation |
| `src/lib/project.ts` | Project defaults, prompt compiler, capability checks, pricing |
| `src/lib/db.ts` | SQLite, versioning, encrypted credentials, jobs and media |
| `src/lib/openrouter.ts` | Server-only OpenRouter client and catalog caching |
| `src/lib/generation.ts` | Request compilation, references, atomic job/budget reservation |
| `scripts/worker.ts` | Durable asynchronous submission, polling, recovery and downloads |
| `src/lib/worker.ts` | Testable provider submission, polling, safe retry and content handling |
| `src/lib/export.ts` | FFmpeg normalization, assembly, captions and music |
| `src/app/api/[...path]/route.ts` | Local-only application API and media streaming |
| `tests/` | Unit, persistence, browser, and export integration tests |

## Remaining production roadmap

This intentionally uses a local modular app and SQLite rather than pretending to ship the entire SaaS plan in one release. Before a public production launch:

1. **Hosted infrastructure:** PostgreSQL migrations, object storage with signed URLs, Redis/durable distributed queue, isolated media workers, retention policies, monitoring, automated backups and restore drills.
2. **Accounts and workspaces:** real authentication, membership authorization on every resource, workspace-scoped keys, invitations, audit logs, and collaboration conflict handling.
3. **Advanced editor:** arbitrary multitrack editing, splitting, transitions, waveform/proxy generation, crop/pan tools, exact per-word subtitle timing, narration and dedicated speech/lip-sync integrations.
4. **Advanced production:** batch approval with atomic batch reservations, versioned asset variants, explicit per-shot prop states, continuity warnings, model comparison, supported video continuation, webhook verification and reconciliation.
5. **Commercial services:** platform credits/subscriptions, billing webhooks, abuse prevention, rate limits, moderation policy and consent workflows.
6. **Portability and scale:** full project archives/import, background media garbage collection, project deletion/recovery, templates and public API documentation.

## OpenRouter references

- [Video generation guide](https://openrouter.ai/docs/guides/overview/multimodal/video-generation)
- [Video model discovery](https://openrouter.ai/docs/api/api-reference/video-generation/list-all-video-generation-models)
- [Submit video job](https://openrouter.ai/docs/api/api-reference/video-generation/submit-a-video-generation-request)

The implementation uses `GET /videos/models`, `POST /videos`, `GET /videos/{id}`, and authenticated `GET /videos/{id}/content` under `https://openrouter.ai/api/v1`. It constructs these URLs itself and never sends your key to provider-supplied download or polling URLs.
