FRAME STUDIO 0.3.0 — WINDOWS x64
================================

INSTALL AND RUN (recommended)
Double-click Frame-Studio-0.3.0-Windows-x64.exe and follow the setup wizard.
Then open Frame Studio from the desktop or Start menu.
No Node.js, npm, terminal, FFmpeg installation, or browser installation is required.

NO-INSTALL VERSION
Extract the entire Frame-Studio-0.3.0-Windows-x64.zip archive into a normal folder.
Open that folder and double-click Frame Studio.exe.
Do not run the executable from inside the ZIP or separate it from its companion files.

WHAT IS NEW IN 0.3
Simple mode is the default: one large prompt, @ mentions, and a model-aware input menu.
Type @ to choose characters, props, locations, and scenes. Mentions add descriptions;
they never attach library photos automatically.
Choose a video model first. Only compatible input styles and settings are offered:
  Text to video: text only.
  Animate an image: an explicitly selected starting frame, plus an ending frame if supported.
  Reference images: only for a verified reference-image route, with explicit image selection.
Frames and reference images are not interchangeable. Unknown reference support is disabled.
Director mode keeps scene direction, camera, dialogue, trim, and timeline controls.
Text and controls are larger in both modes. Prompt length is checked before a billable job.
Missing prompt limits use a conservative 1,000-character app guard, not a provider claim.
Known Kling 3.0 routes are limited to 2,500 characters. Context may be shortened to fit;
your own written instructions are never silently cut. Inspect the final prompt for details.
Provider safety/privacy policy rejections are explained separately from unsupported inputs.
Compatible inputs can still be rejected by a provider's content policy; no automatic retries.

UPDATING
Close the older Frame Studio before installing or launching 0.3. Your per-user workspace,
API key, characters, media, and past takes are preserved. Back up the data folder first.
Older projects start with a safe text input; choose an image style to reattach saved photos.

FIRST USE
1. Open Settings using the gear icon in the left rail.
2. Paste your OpenRouter API key and click Save key.
3. In Simple mode, choose a model, describe the video, and use @ for story context.
4. Click Create video. Approve generation only when ready to spend OpenRouter credits.
5. Select a ready take for each shot, then Export film.

Editing and exporting your own MP4 files work without an API key.
Internet access and a funded OpenRouter account are needed for AI generation.
The sample lighthouse artwork is an illustration, not generated footage.

YOUR FILES
Projects and credentials are stored under:
  %APPDATA%\Frame Studio\data
Both installed and no-install editions use this same per-user workspace.
Use File > Open workspace folder to find it.
The no-install edition does not store projects next to the executable.

Back up the entire data folder while Frame Studio is closed, including its hidden
.encryption-key file. Do not share this folder; it contains private project data.
Uninstalling does not intentionally delete your workspace.
Logs are available through Help > Open logs folder. Do not post private logs publicly.

CLOSING THE PROGRAM
The app saves before closing and warns if work or downloads are still active.
Closing stops local generation tracking and rendering. A video already submitted
to OpenRouter can continue and can still be charged by the provider. Reopen the app
to resume tracking. Uncertain submissions are never silently resubmitted.

SYSTEM REQUIREMENTS
Windows 10/11, 64-bit (x64), a normal non-administrator user account.
Allow at least 1.5 GB for the application and additional space for video files.
If Windows asks about network access, this app only needs outbound internet access;
its internal service listens on this computer's loopback address, not your LAN.

SIGNATURE / SMARTSCREEN
This build is unsigned because no code-signing certificate was supplied. Windows
may show an unknown-publisher or SmartScreen warning. Verify the source and SHA-256
checksums before choosing to run it. No antivirus exclusions are required or advised.

LIMITS
This is a single-user desktop studio, not a multi-user hosted service.
Native audio does not guarantee exact dialogue or lip sync. Character identity and
seed determinism depend on the selected provider. Budget reservations are local
estimates, not provider-enforced caps. AI planning charges are separate.
The timeline supports shot ordering, trims, text captions, and one music track;
arbitrary multitrack editing and transitions are not implemented.

LICENSES
Bundled third-party software and license notices are in resources\licenses.
The bundled FFmpeg distribution contains GPL components; its license and corresponding
source/build reference are included. No warranty of error-free operation is made.
