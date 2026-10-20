const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'frameDesktop',
  Object.freeze({
    version: '0.3.0',
    security: Object.freeze({
      contextIsolated: process.contextIsolated,
      sandboxed: process.sandboxed,
    }),
    onBeforeClose(callback) {
      const listener = async (_event, requestId) => {
        if (typeof requestId !== 'string' || requestId.length > 128) return;
        try {
          await callback();
          ipcRenderer.send('frame:save-result', { ok: true, requestId });
        } catch (error) {
          ipcRenderer.send('frame:save-result', {
            ok: false,
            requestId,
            message: String(error?.message || 'Save failed').slice(0, 500),
          });
        }
      };
      ipcRenderer.on('frame:save-before-close', listener);
      return () => ipcRenderer.removeListener('frame:save-before-close', listener);
    },
    onNewProject(callback) {
      const listener = () => callback();
      ipcRenderer.on('frame:new-project', listener);
      return () => ipcRenderer.removeListener('frame:new-project', listener);
    },
    openDataFolder: () => ipcRenderer.invoke('frame:open-data-folder'),
  }),
);
