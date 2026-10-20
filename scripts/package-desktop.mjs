process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'])
  delete process.env[key];
await import('./prepare-desktop.mjs');
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const { build, Platform, Arch } = require('electron-builder');
await build({
  targets: Platform.WINDOWS.createTarget(['nsis', 'zip'], Arch.x64),
  config: require('../electron-builder.cjs'),
});
await import('./finalize-release.mjs');
