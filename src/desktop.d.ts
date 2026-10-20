export {};
declare global {
  interface Window {
    frameDesktop?: {
      version: string;
      security: { contextIsolated: boolean; sandboxed: boolean };
      onBeforeClose: (callback: () => Promise<unknown>) => () => void;
      onNewProject: (callback: () => void) => () => void;
      openDataFolder: () => Promise<string>;
    };
  }
}
