const { app, BrowserWindow, Menu, dialog, shell, ipcMain, screen } = require('electron');
const { spawn } = require('node:child_process');
const {
  mkdirSync,
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomBytes } = require('node:crypto');

app.setName('Frame Studio');
if (process.env.FRAME_TEST_USER_DATA) {
  const testingProfile = path.resolve(process.env.FRAME_TEST_USER_DATA);
  mkdirSync(testingProfile, { recursive: true });
  app.setPath('userData', testingProfile);
}
app.setAppUserModelId('studio.frame.desktop');

const locked = app.requestSingleInstanceLock();
let window;
let origin = '';
let services = [];
let quitting = false;
let closing = false;
let ready = false;
let logFile;
const token = randomBytes(32).toString('hex');
const downloads = new Set();
const allowedExternalHosts = new Set(['openrouter.ai', 'www.openrouter.ai']);
global.frameRuntime = { origin: '', servicePids: [], ready: false };

function log(message) {
  if (logFile) {
    try {
      appendFileSync(logFile, `${new Date().toISOString()} ${String(message).slice(0, 12000)}\n`);
    } catch {
      /* diagnostics must not crash the app */
    }
  }
}
function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === 'https:' &&
      allowedExternalHosts.has(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    ) {
      void shell.openExternal(parsed.toString()).catch((error) => log(error.message));
    }
  } catch {
    /* reject malformed links */
  }
}
function childEnvironment(dataDirectory, port) {
  const env = { ...process.env };
  // The desktop edition does not inherit a developer's key, data path, or Node injection flags.
  for (const key of Object.keys(env)) {
    if (
      /^(NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|OPENROUTER_API_KEY|STUDIO_|FRAME_DESKTOP_BUILD|__NEXT_)/i.test(
        key,
      )
    )
      delete env[key];
  }
  return {
    ...env,
    NODE_ENV: 'production',
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: '1',
    STUDIO_DATA_DIR: dataDirectory,
    STUDIO_DESKTOP_TOKEN: token,
    FFMPEG_PATH: path.join(process.resourcesPath, 'runtime', 'ffmpeg.exe'),
  };
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
function startService(name, file, cwd, env) {
  const executable = path.join(process.resourcesPath, 'runtime', 'node.exe');
  if (!existsSync(executable) || !existsSync(file))
    throw new Error(`A packaged ${name} component is missing. Reinstall Frame Studio.`);
  const child = spawn(executable, [file], {
    cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  services.push(child);
  child.stdout.on('data', (data) => log(`[${name}] ${data.toString().trim()}`));
  child.stderr.on('data', (data) => log(`[${name}] ${data.toString().trim()}`));
  child.on('error', (error) => {
    child.frameError = error;
    log(`${name}: ${error.message}`);
  });
  child.on('exit', (code, signal) => {
    log(`${name} exited (${code}, ${signal})`);
    if (ready && !quitting && !closing) {
      ready = false;
      dialog.showErrorBox(
        'Frame Studio service stopped',
        `The ${name} service stopped unexpectedly. Your saved projects remain on disk. Close and reopen Frame Studio.\n\nDiagnostics: ${logFile}`,
      );
    }
  });
  return child;
}
async function terminate(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  // Terminate only the process tree started by this app, including active FFmpeg children.
  await new Promise((resolve) => {
    const killer = spawn(
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' },
    );
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, 5000);
    killer.on('error', () => {
      clearTimeout(timer);
      child.kill();
      resolve();
    });
    killer.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
async function stopServices() {
  ready = false;
  for (const child of [...services].reverse()) {
    if (child.connected) {
      try {
        child.send({ type: 'shutdown' });
      } catch {
        /* already exited */
      }
    }
  }
  const deadline = Date.now() + 2500;
  while (
    Date.now() < deadline &&
    services.some((child) => child.exitCode === null && child.signalCode === null)
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  await Promise.all(services.map(terminate));
  services = [];
}
async function api(endpoint) {
  return fetch(`${origin}/api/${endpoint}`, {
    headers: { 'X-Frame-Desktop-Token': token },
    signal: AbortSignal.timeout(2500),
  });
}
async function waitForServer(child) {
  // Trust IPC from our own child before sending its secret to a loopback port.
  // This avoids authenticating an unrelated program if a port is taken during startup.
  await waitForWorker(child, 'server-ready', 60000);
  const response = await api('desktop-status');
  if (!response.ok) throw new Error('The workspace service failed its startup health check.');
}
async function waitForWorker(child, expected = 'ready', timeout = 20000) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          'An application service did not become ready in time. Check the application logs.',
        ),
      );
    }, timeout);
    const message = (data) => {
      if (data?.type === expected) {
        cleanup();
        resolve();
      }
    };
    const exit = () => {
      cleanup();
      reject(new Error('An application service could not start. Check the application logs.'));
    };
    const error = (problem) => {
      cleanup();
      reject(problem);
    };
    function cleanup() {
      clearTimeout(timer);
      child.removeListener('message', message);
      child.removeListener('exit', exit);
      child.removeListener('error', error);
    }
    child.on('message', message);
    child.once('exit', exit);
    child.once('error', error);
  });
}
function validSender(event) {
  return (
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url.startsWith(`${origin}/`)
  );
}
async function saveRenderer() {
  if (
    !window ||
    window.isDestroyed() ||
    !origin ||
    !window.webContents.getURL().startsWith(`${origin}/`)
  )
    return;
  await new Promise((resolve, reject) => {
    const requestId = randomBytes(12).toString('hex');
    const timer = setTimeout(() => {
      ipcMain.removeListener('frame:save-result', listener);
      reject(new Error('The editor did not finish saving within 20 seconds.'));
    }, 20000);
    const listener = (event, result) => {
      if (!validSender(event) || result?.requestId !== requestId) return;
      clearTimeout(timer);
      ipcMain.removeListener('frame:save-result', listener);
      result?.ok
        ? resolve()
        : reject(new Error(String(result?.message || 'The project could not be saved.')));
    };
    ipcMain.on('frame:save-result', listener);
    window.webContents.send('frame:save-before-close', requestId);
  });
}
async function pendingWork() {
  try {
    const response = await api('desktop-status');
    if (response.ok) return (await response.json()).activeJobs > 0;
  } catch {
    return true;
  }
  return false;
}
async function requestClose() {
  if (closing || quitting) return;
  closing = true;
  try {
    await saveRenderer();
    if (downloads.size || (ready && (await pendingWork()))) {
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: 'Work is still in progress',
        message: 'Close Frame Studio while work is still running?',
        detail:
          'Local rendering, tracking, and downloads will stop. A video already submitted to OpenRouter may keep running and may still be charged. Reopen Frame Studio to resume tracking. An uncertain submission will not be automatically resubmitted.',
        buttons: ['Keep working', 'Close Frame Studio'],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response !== 1) return;
    }
  } catch (error) {
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      title: 'Your last changes may not be saved',
      message: error.message,
      detail:
        'Return to the studio to fix the save problem, or close without saving the latest changes.',
      buttons: ['Return to studio', 'Close without saving'],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response !== 1) return;
  } finally {
    closing = false;
  }
  quitting = true;
  await stopServices();
  if (window && !window.isDestroyed()) window.destroy();
  app.quit();
}
function installMenu(dataDirectory, logDirectory) {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          {
            label: 'New project',
            accelerator: 'Ctrl+N',
            click: () => {
              if (ready) window?.webContents.send('frame:new-project');
            },
          },
          {
            id: 'workspace-folder',
            label: 'Open workspace folder',
            click: () => void shell.openPath(dataDirectory),
          },
          { type: 'separator' },
          { label: 'Quit Frame Studio', accelerator: 'Alt+F4', click: () => void requestClose() },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'OpenRouter video documentation',
            click: () =>
              openExternal(
                'https://openrouter.ai/docs/guides/overview/multimodal/video-generation',
              ),
          },
          {
            id: 'logs-folder',
            label: 'Open logs folder',
            click: () => void shell.openPath(logDirectory),
          },
          {
            label: 'Windows instructions',
            click: () =>
              void shell.openPath(
                path.join(process.resourcesPath, 'licenses', 'WINDOWS-README.txt'),
              ),
          },
          {
            label: 'About Frame Studio',
            click: () =>
              void dialog.showMessageBox(window, {
                type: 'info',
                title: 'About Frame Studio',
                message: `Frame Studio ${app.getVersion()}`,
                detail:
                  'Windows x64 · Local, single-user AI film studio\n\nNode.js, FFmpeg, and the application server are included. No terminal is required. AI generation requires your own funded OpenRouter account.\n\nThis build is unsigned. Third-party license notices are included with the application.',
              }),
          },
        ],
      },
    ]),
  );
}
async function boot() {
  const userDirectory = app.getPath('userData');
  const dataDirectory = path.join(userDirectory, 'data');
  const logDirectory = path.join(userDirectory, 'logs');
  mkdirSync(dataDirectory, { recursive: true });
  mkdirSync(logDirectory, { recursive: true });
  logFile = path.join(
    logDirectory,
    `desktop-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
  );
  for (const file of readdirSync(logDirectory)
    .filter((f) => /^desktop-[0-9T-Z-]+\.log$/.test(f))
    .sort()
    .slice(0, -9)) {
    try {
      unlinkSync(path.join(logDirectory, file));
    } catch {
      /* in use */
    }
  }
  log(`Frame Studio ${app.getVersion()} starting. User workspace: ${dataDirectory}`);
  const boundsFile = path.join(userDirectory, 'window.json');
  let dimensions = { width: 1440, height: 960 };
  try {
    const stored = JSON.parse(readFileSync(boundsFile, 'utf8'));
    if (Number.isFinite(stored.width) && Number.isFinite(stored.height))
      dimensions = {
        width: Math.max(1000, Math.min(stored.width, 2560)),
        height: Math.max(700, Math.min(stored.height, 1600)),
      };
  } catch {
    /* first launch */
  }
  const display = screen.getPrimaryDisplay().workAreaSize;
  window = new BrowserWindow({
    ...dimensions,
    width: Math.min(dimensions.width, display.width),
    height: Math.min(dimensions.height, display.height),
    minWidth: 900,
    minHeight: 650,
    title: 'Frame Studio',
    backgroundColor: '#151b15',
    icon: path.join(__dirname, 'assets', 'frame.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: Boolean(process.env.FRAME_TEST_USER_DATA),
    },
  });
  window.once('ready-to-show', () => window.show());
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      void requestClose();
    }
  });
  window.on('resize', () => {
    if (!window.isDestroyed() && !window.isMaximized() && !window.isMinimized()) {
      const bounds = window.getBounds();
      try {
        writeFileSync(boundsFile, JSON.stringify({ width: bounds.width, height: bounds.height }));
      } catch {
        /* state is optional */
      }
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!origin || !url.startsWith(`${origin}/`)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  const session = window.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.on('will-download', (_event, item) => {
    downloads.add(item);
    const filename = path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    item.setSaveDialogOptions({
      title: 'Save file from Frame Studio',
      defaultPath: path.join(app.getPath('downloads'), filename || 'Frame-export.mp4'),
    });
    item.once('done', (_event, state) => {
      downloads.delete(item);
      if (state !== 'completed' && state !== 'cancelled')
        void dialog.showMessageBox(window, {
          type: 'error',
          title: 'Download interrupted',
          message: 'The file could not be saved. Please try the download again.',
        });
    });
  });
  ipcMain.handle('frame:open-data-folder', (event) =>
    validSender(event) ? shell.openPath(dataDirectory) : Promise.reject(new Error('Not allowed')),
  );
  installMenu(dataDirectory, logDirectory);
  await window.loadFile(path.join(__dirname, 'splash.html'));
  if (quitting) return;
  const serviceRoot = path.join(process.resourcesPath, 'service');
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  const env = childEnvironment(dataDirectory, port);
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.startsWith(`${origin}/`))
      details.requestHeaders['X-Frame-Desktop-Token'] = token;
    callback({ requestHeaders: details.requestHeaders });
  });
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    if (details.url.startsWith(`${origin}/`))
      headers['Content-Security-Policy'] = [
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'self'",
      ];
    callback({ responseHeaders: headers });
  });
  const server = startService(
    'workspace',
    path.join(serviceRoot, 'server-runner.cjs'),
    serviceRoot,
    env,
  );
  await waitForServer(server);
  if (quitting) return;
  await waitForWorker(
    startService('generation worker', path.join(serviceRoot, 'worker.mjs'), dataDirectory, env),
  );
  if (quitting) return;
  await window.loadURL(origin);
  ready = true;
  global.frameRuntime = { origin, servicePids: services.map((child) => child.pid), ready: true };
  log(`Desktop ready at ${origin}.`);
}
if (!locked) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.on('before-quit', (event) => {
    if (!quitting) {
      event.preventDefault();
      void requestClose();
    }
  });
  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });
  app
    .whenReady()
    .then(boot)
    .catch(async (error) => {
      log(`Startup failure: ${error.stack || error.message}`);
      quitting = true;
      await stopServices();
      dialog.showErrorBox(
        'Frame Studio could not start',
        `${error.message}\n\nReinstall or extract the entire application folder, and make sure your user profile has free disk space.\n\nLogs: ${logFile || app.getPath('userData')}`,
      );
      app.quit();
    });
}
