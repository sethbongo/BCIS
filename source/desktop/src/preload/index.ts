import { contextBridge, ipcRenderer } from 'electron';
import type { BcisBridge } from '../shared/bridge';

// The only bridge between the sandboxed renderer and the main process.
// Each function maps to exactly one IPC channel; ipcRenderer itself is never exposed.
const bridge: BcisBridge = {
  api: {
    request: (request) => ipcRenderer.invoke('api:request', request),
    download: (request) => ipcRenderer.invoke('api:download', request),
    blob: (request) => ipcRenderer.invoke('api:blob', request),
  },
  auth: {
    login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
    logout: () => ipcRenderer.invoke('auth:logout'),
    current: () => ipcRenderer.invoke('auth:current'),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    setServerUrl: (url) => ipcRenderer.invoke('config:setServerUrl', url),
    test: (url) => ipcRenderer.invoke('config:test', url),
  },
  print: {
    print: () => ipcRenderer.invoke('print:print'),
    savePdf: (options) => ipcRenderer.invoke('print:savePdf', options),
  },
  files: {
    saveText: (options) => ipcRenderer.invoke('files:saveText', options),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
  },
};

contextBridge.exposeInMainWorld('bcis', bridge);
