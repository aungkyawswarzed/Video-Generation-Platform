module.exports = {
  appId: 'studio.frame.desktop',
  productName: 'Frame Studio',
  electronVersion: '44.9.0',
  electronDist: require('node:path').resolve('node_modules/electron/dist'),
  artifactName: 'Frame-Studio-${version}-Windows-x64.${ext}',
  directories: {
    app: 'desktop-staging/app',
    output: 'release',
    buildResources: 'desktop-staging/icons',
  },
  asar: true,
  files: ['main.cjs', 'preload.cjs', 'splash.html', 'assets/**/*', 'package.json'],
  extraResources: [
    { from: 'desktop-staging/runtime', to: 'runtime', filter: ['**/*'] },
    { from: 'desktop-staging/service', to: 'service', filter: ['**/*', '!**/*.map'] },
    { from: 'desktop-staging/licenses', to: 'licenses', filter: ['**/*'] },
  ],
  win: {
    icon: 'desktop-staging/icons/frame.ico',
    target: ['nsis', 'zip'],
    executableName: 'Frame Studio',
    // No signing identity was provided. Do not pretend this is a signed release.
    signAndEditExecutable: true,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Frame Studio',
    uninstallDisplayName: 'Frame Studio',
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
    license: 'desktop/WINDOWS-README.txt',
    installerIcon: 'desktop-staging/icons/frame.ico',
    uninstallerIcon: 'desktop-staging/icons/frame.ico',
  },
  compression: 'normal',
  // Dependencies are already in the standalone service payload. The desktop shell has none.
  // Returning false prevents the collector from falling back to the repository's node_modules.
  npmRebuild: true,
  beforeBuild: async () => false,
  afterPack: async (context) => {
    const { createRequire } = require('node:module');
    const fromBuilder = createRequire(require.resolve('app-builder-lib/package.json'));
    const archive = fromBuilder('@electron/asar');
    const files = archive.listPackage(
      require('node:path').join(context.appOutDir, 'resources', 'app.asar'),
    );
    if (
      files.some(
        (file) =>
          file.includes('node_modules') || /(?:studio\.sqlite|\.encryption-key|\/\.env)/.test(file),
      )
    )
      throw new Error(
        'The desktop shell archive contains unintended dependencies or private data.',
      );
    const unpacked = require('node:path').join(context.appOutDir, 'resources', 'app.asar.unpacked');
    if (require('node:fs').existsSync(unpacked) && require('node:fs').readdirSync(unpacked).length)
      throw new Error('Unexpected unpacked desktop dependencies were found.');
  },
  buildDependenciesFromSource: false,
};
