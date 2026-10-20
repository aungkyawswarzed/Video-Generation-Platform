import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, writeFile, stat, rm, readdir, rename, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';

if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('Build the Windows x64 release on Windows x64.');
const root = process.cwd();
const require = createRequire(import.meta.url);
const cache = path.join(root, '.desktop-build-cache');
const stage = path.join(root, 'desktop-staging');
const nodeVersion = '24.21.0';
const nodeSha = 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32';
const ffmpegVersion = '9.0.2';
const ffmpegSha = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba';
await mkdir(cache, { recursive: true });

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function download(url, file, expected, byteLength) {
  if ((await exists(file)) && (!expected || (await sha256(file)) === expected)) return;
  console.log(`Downloading verified desktop component: ${url}`);
  if (byteLength) {
    // Bounded range requests also work behind proxies that reject large streamed responses.
    const partial = `${file}.ranged-partial`;
    const handle = await open(partial, 'w');
    await handle.truncate(byteLength);
    const chunkSize = 2 * 1024 * 1024;
    const total = Math.ceil(byteLength / chunkSize);
    let next = 0;
    let completed = 0;
    const controller = new AbortController();
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, async () => {
          while (next < total && !controller.signal.aborted) {
            const index = next++;
            const start = index * chunkSize;
            const end = Math.min(byteLength - 1, start + chunkSize - 1);
            let data;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const response = await fetch(url, {
                  headers: { Range: `bytes=${start}-${end}` },
                  signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]),
                });
                if (
                  response.status !== 206 ||
                  response.headers.get('content-range') !== `bytes ${start}-${end}/${byteLength}`
                ) {
                  await response.body?.cancel();
                  throw new Error('Unexpected HTTP range response.');
                }
                data = Buffer.from(await response.arrayBuffer());
                if (data.length !== end - start + 1) throw new Error('Incomplete HTTP range.');
                break;
              } catch (error) {
                if (attempt === 2 || controller.signal.aborted) {
                  controller.abort();
                  throw error;
                }
              }
            }
            let written = 0;
            while (written < data.length)
              written += (await handle.write(data, written, data.length - written, start + written))
                .bytesWritten;
            completed++;
            if (completed % 8 === 0 || completed === total)
              console.log(`  Received ${completed}/${total} verified-size ranges.`);
          }
        }),
      );
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    } finally {
      await handle.close();
    }
    if (expected && (await sha256(partial)) !== expected) {
      await rm(partial, { force: true });
      throw new Error(`SHA-256 verification failed: ${url}`);
    }
    await rename(partial, file);
    return;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!response.ok || !response.body)
    throw new Error(`Download failed (${response.status}): ${url}`);
  const partial = `${file}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  if (expected && (await sha256(partial)) !== expected) {
    await rm(partial, { force: true });
    throw new Error(`SHA-256 verification failed: ${url}`);
  }
  await rename(partial, file);
}
async function run(executable, args, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(executable)} failed (${code})`)),
    );
  });
}
const nodeFile = path.join(cache, `node-v${nodeVersion}-win-x64.exe`);
if (!(await exists(nodeFile)) && (await sha256(process.execPath)) === nodeSha)
  await cp(process.execPath, nodeFile);
const ffmpegArchive = path.join(cache, `ffmpeg-${ffmpegVersion}-essentials_build.zip`);
await Promise.all([
  download(`https://nodejs.org/dist/v${nodeVersion}/win-x64/node.exe`, nodeFile, nodeSha, 93580104),
  download(
    `https://github.com/GyanD/codexffmpeg/releases/download/${ffmpegVersion}/ffmpeg-${ffmpegVersion}-essentials_build.zip`,
    ffmpegArchive,
    ffmpegSha,
    114768076,
  ),
  download(
    `https://raw.githubusercontent.com/nodejs/node/v${nodeVersion}/LICENSE`,
    path.join(cache, 'NODE-LICENSE.txt'),
  ),
]);
const unpack = path.join(cache, `ffmpeg-${ffmpegVersion}`);
if (!(await exists(path.join(unpack, '.verified')))) {
  await mkdir(unpack, { recursive: true });
  execFileSync(require('7zip-bin').path7za, ['x', '-y', ffmpegArchive, `-o${unpack}`], {
    stdio: 'inherit',
    windowsHide: true,
  });
  await writeFile(path.join(unpack, '.verified'), ffmpegSha);
}
const ffmpegRoot = path.join(unpack, `ffmpeg-${ffmpegVersion}-essentials_build`);
const ffmpegExe = path.join(ffmpegRoot, 'bin', 'ffmpeg.exe');
if (!(await exists(ffmpegExe)))
  throw new Error('Verified FFmpeg archive has an unexpected layout.');
execFileSync(
  nodeFile,
  [
    '--input-type=module',
    '-e',
    "import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(':memory:');db.exec('SELECT 1');db.close();console.log('Bundled Node / SQLite verified.');",
  ],
  { stdio: 'inherit' },
);
execFileSync(ffmpegExe, ['-version'], { stdio: 'inherit', windowsHide: true });

if (await exists(stage)) {
  if (!(await exists(path.join(stage, '.frame-generated-build'))))
    throw new Error('Refusing to overwrite an unmarked desktop-staging directory.');
  await rm(stage, { recursive: true, force: true });
}
await mkdir(stage, { recursive: true });
await writeFile(
  path.join(stage, '.frame-generated-build'),
  'Generated by Frame Studio desktop packaging.',
);
const appStage = path.join(stage, 'app');
const service = path.join(stage, 'service');
const licenses = path.join(stage, 'licenses');
for (const dir of [
  appStage,
  service,
  licenses,
  path.join(stage, 'runtime'),
  path.join(stage, 'icons'),
])
  await mkdir(dir, { recursive: true });

console.log('Building the standalone production workspace…');
await run(
  process.execPath,
  [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'],
  {
    ...process.env,
    FRAME_DESKTOP_BUILD: '1',
    STUDIO_DIST_DIR: '.next-desktop',
    NEXT_TELEMETRY_DISABLED: '1',
    STUDIO_DATA_DIR: path.join(cache, 'build-workspace'),
    OPENROUTER_API_KEY: '',
    STUDIO_DESKTOP_TOKEN: '',
  },
);
const standalone = path.join(root, '.next-desktop', 'standalone');
await cp(standalone, path.join(service, 'web'), {
  recursive: true,
  dereference: true,
  filter: (source) => {
    const parts = path.relative(standalone, source).split(path.sep);
    return (
      !['data', '.frame-e2e-data', '.desktop-test-data'].includes(parts[0]) &&
      !parts.some((part) => part === '.env' || part.startsWith('.env.'))
    );
  },
});
await cp(
  path.join(root, '.next-desktop', 'static'),
  path.join(service, 'web', '.next-desktop', 'static'),
  { recursive: true, dereference: true },
);
const serverEntry = path.join(service, 'web', 'server.js');
const serverSource = await readFile(serverEntry, 'utf8');
const readinessMarker = '}).catch((err) => {';
if (!serverSource.includes('startServer({') || serverSource.split(readinessMarker).length !== 2)
  throw new Error(
    'Next.js standalone bootstrap changed. Review the readiness integration before packaging.',
  );
await writeFile(
  serverEntry,
  serverSource.replace(
    readinessMarker,
    "}).then(() => { if (process.send) process.send({ type: 'server-ready' }); }).catch((err) => {",
  ),
);
await cp(path.join(root, 'desktop', 'server-runner.cjs'), path.join(service, 'server-runner.cjs'));
await build({
  entryPoints: ['scripts/worker.ts'],
  outfile: path.join(service, 'worker.mjs'),
  platform: 'node',
  format: 'esm',
  target: 'node24',
  bundle: true,
  external: ['ffmpeg-static'],
  sourcemap: false,
  legalComments: 'eof',
  logLevel: 'info',
});
await cp(nodeFile, path.join(stage, 'runtime', 'node.exe'));
await cp(ffmpegExe, path.join(stage, 'runtime', 'ffmpeg.exe'));
for (const name of ['main.cjs', 'preload.cjs', 'splash.html'])
  await cp(path.join(root, 'desktop', name), path.join(appStage, name));
await cp(path.join(root, 'desktop', 'assets'), path.join(appStage, 'assets'), { recursive: true });
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await writeFile(
  path.join(appStage, 'package.json'),
  JSON.stringify(
    {
      name: 'frame-studio-desktop',
      version: metadata.version,
      description: metadata.description,
      author: metadata.author,
      dependencies: {},
      license: 'UNLICENSED',
      main: 'main.cjs',
      private: true,
    },
    null,
    2,
  ),
);

const sharp = require('sharp');
const iconSource = await readFile(path.join(root, 'desktop', 'assets', 'frame.svg'));
const sizes = [16, 32, 48, 256];
const pngs = await Promise.all(
  sizes.map((size) => sharp(iconSource).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const base = 6 + index * 16;
  header[base] = size === 256 ? 0 : size;
  header[base + 1] = header[base];
  header.writeUInt16LE(1, base + 4);
  header.writeUInt16LE(32, base + 6);
  header.writeUInt32LE(pngs[index].length, base + 8);
  header.writeUInt32LE(offset, base + 12);
  offset += pngs[index].length;
});
await writeFile(path.join(stage, 'icons', 'frame.ico'), Buffer.concat([header, ...pngs]));
await writeFile(path.join(appStage, 'assets', 'frame.png'), pngs[3]);
await cp(path.join(cache, 'NODE-LICENSE.txt'), path.join(licenses, 'NODE-LICENSE.txt'));
await cp(
  path.join(root, 'desktop', 'WINDOWS-README.txt'),
  path.join(licenses, 'WINDOWS-README.txt'),
);
// Electron 44 installs its binary on demand rather than through npm postinstall.
const electronExecutable = require('electron');
await cp(
  path.join(path.dirname(electronExecutable), 'LICENSE'),
  path.join(licenses, 'ELECTRON-LICENSE.txt'),
);
for (const name of await readdir(ffmpegRoot)) {
  if (/^(license|copying|readme)/i.test(name) && (await stat(path.join(ffmpegRoot, name))).isFile())
    await cp(path.join(ffmpegRoot, name), path.join(licenses, `FFMPEG-${name}`));
}
await writeFile(
  path.join(licenses, 'FFMPEG-SOURCE-AND-BUILD.txt'),
  `FFmpeg ${ffmpegVersion}, Windows x64 essentials build by Gyan Doshi.\nBinary archive: https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-${ffmpegVersion}-essentials_build.zip\nArchive SHA-256: ${ffmpegSha}\nBuild/source information: https://www.gyan.dev/ffmpeg/builds/#sources\nBuild scripts: https://github.com/GyanD/codexffmpeg\nFFmpeg source: https://ffmpeg.org/releases/ffmpeg-${ffmpegVersion}.tar.xz\nFFmpeg licensing: https://ffmpeg.org/legal.html\nThis GPL-enabled binary is a separate executable, invoked through its command-line interface.\nSee the accompanying FFmpeg license and upstream build information for dependency/source details.\n`,
);

// Retain applicable license notices from the development dependency tree as a transparent superset.
const inventory = [];
async function collectNotices(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const location = path.join(directory, entry.name);
    if (entry.name.startsWith('@')) {
      await collectNotices(location);
      continue;
    }
    try {
      const pkg = JSON.parse(await readFile(path.join(location, 'package.json'), 'utf8'));
      const key = `${pkg.name}-${pkg.version}`.replace(/[^a-zA-Z0-9._-]/g, '_');
      inventory.push({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license || 'See package notices',
        repository: pkg.repository || undefined,
      });
      for (const name of await readdir(location)) {
        if (/^(license|copying|notice|ofl)([._-]|$)/i.test(name)) {
          const file = path.join(location, name);
          const info = await stat(file);
          if (info.isFile() && info.size < 1024 * 1024) {
            const dest = path.join(licenses, 'packages', key);
            await mkdir(dest, { recursive: true });
            await cp(file, path.join(dest, name));
          }
        }
      }
    } catch {
      /* not an npm package */
    }
    await collectNotices(path.join(location, 'node_modules'));
  }
}
await collectNotices(path.join(root, 'node_modules'));
await writeFile(
  path.join(licenses, 'THIRD-PARTY-INVENTORY.json'),
  JSON.stringify(inventory, null, 2),
);
await writeFile(
  path.join(licenses, 'BUILD-MANIFEST.json'),
  JSON.stringify(
    {
      appVersion: metadata.version,
      platform: 'win32-x64',
      nodeVersion,
      nodeSha256: nodeSha,
      ffmpegVersion,
      ffmpegArchiveSha256: ffmpegSha,
      ffmpegBinarySha256: await sha256(ffmpegExe),
      electronVersion: '44.9.0',
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
async function verifyPayload(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (
      item.name === '.env' ||
      item.name.startsWith('.env.') ||
      /^studio\.sqlite(?:-wal|-shm)?$/.test(item.name) ||
      item.name === '.encryption-key'
    )
      throw new Error(
        `Private workspace material was found in the application payload: ${item.name}`,
      );
    const file = path.join(directory, item.name);
    if (item.isSymbolicLink())
      throw new Error(`Non-relocatable symlink found in application payload: ${file}`);
    if (item.isDirectory()) await verifyPayload(file);
  }
}
await verifyPayload(service);
for (const file of [
  'web/server.js',
  'web/node_modules/next/package.json',
  'web/.next-desktop/BUILD_ID',
  'worker.mjs',
]) {
  if (!(await exists(path.join(service, file))))
    throw new Error(`Application payload is incomplete: ${file}`);
}
console.log(
  'Desktop staging complete. No API keys, user projects, or development workspace data are included.',
);
