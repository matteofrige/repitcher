import { contextBridge, ipcRenderer } from 'electron';

export type MicAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

export interface PlatformInfo {
  platform: NodeJS.Platform;
  arch: string;
  appVersion: string;
  electron: string;
  chrome: string;
  node: string;
}

export interface UpdateInfo {
  version: string;
  url: string;
  notes: string;
}

export interface RePitchAPI {
  openExternal: (url: string) => Promise<boolean>;
  openAudioMidiSetup: () => Promise<boolean>;
  getMicAccessStatus: () => Promise<MicAccessStatus>;
  requestMicAccess: () => Promise<boolean>;
  getPlatform: () => Promise<PlatformInfo>;
  setTrayInfo: (text: string) => void;
  setTrayVisible: (visible: boolean) => void;
  checkUpdate: () => Promise<UpdateInfo | null>;
  downloadUpdate: (url: string) => Promise<string>;
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => () => void;
  onUpdateProgress: (cb: (progress: number) => void) => () => void;
}

const api: RePitchAPI = {
  openExternal: (url) => ipcRenderer.invoke('repitch:open-external', url),
  openAudioMidiSetup: () => ipcRenderer.invoke('repitch:open-audio-midi-setup'),
  getMicAccessStatus: () => ipcRenderer.invoke('repitch:get-mic-access-status'),
  requestMicAccess: () => ipcRenderer.invoke('repitch:request-mic-access'),
  getPlatform: () => ipcRenderer.invoke('repitch:get-platform'),
  setTrayInfo: (text) => ipcRenderer.send('repitch:set-tray-info', text),
  setTrayVisible: (visible) => ipcRenderer.send('repitch:set-tray-visible', visible),
  checkUpdate: () => ipcRenderer.invoke('repitch:check-update'),
  downloadUpdate: (url) => ipcRenderer.invoke('repitch:download-update', url),
  onUpdateAvailable: (cb) => {
    const h = (_e: unknown, info: UpdateInfo) => cb(info);
    ipcRenderer.on('repitch:update-available', h);
    return () => ipcRenderer.removeListener('repitch:update-available', h);
  },
  onUpdateProgress: (cb) => {
    const h = (_e: unknown, progress: number) => cb(progress);
    ipcRenderer.on('repitch:update-progress', h);
    return () => ipcRenderer.removeListener('repitch:update-progress', h);
  },
};

contextBridge.exposeInMainWorld('repitch', api);
