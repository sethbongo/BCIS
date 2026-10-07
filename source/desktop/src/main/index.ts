import type { LoginResult } from '@bcis/shared';
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type IpcMainInvokeEvent } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { ApiResult, ConnectionTest, SaveResult, SessionInfo } from '../shared/bridge';

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;
// Lets automated tests and side-by-side demo clients keep separate settings.
if (process.env.BCIS_USER_DATA) app.setPath('userData', process.env.BCIS_USER_DATA);

// ---------------------------------------------------------------- client configuration
const configFile = () => join(app.getPath('userData'), 'client-config.json');
const DEFAULT_SERVER = 'http://localhost:4000';

function normalizeServerUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function loadServerUrl(): string {
  const fromEnv = process.env.BCIS_SERVER_URL && normalizeServerUrl(process.env.BCIS_SERVER_URL);
  if (fromEnv) return fromEnv;
  try {
    if (existsSync(configFile())) return normalizeServerUrl(JSON.parse(readFileSync(configFile(), 'utf8')).serverUrl) ?? DEFAULT_SERVER;
  } catch {
    // An unreadable config file falls back to the default; the login screen lets the user fix it.
  }
  return DEFAULT_SERVER;
}

let serverUrl = DEFAULT_SERVER;
/** The session token lives only here, in main-process memory. It is never sent to the renderer or written to disk. */
let token: string | null = null;
let idleLockMinutes = 10;
const clientName = `${hostname()} desktop`.slice(0, 80);

// ---------------------------------------------------------------- API access
const ApiRequestSchema = z.object({
  method: z.enum(['GET', 'POST', 'PATCH', 'PUT']),
  path: z.string().regex(/^\/[A-Za-z0-9\-_/.]{1,200}$/).refine((p) => !p.includes('..'), 'invalid path'),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()])).optional(),
  body: z.unknown().optional(),
});

function buildUrl(path: string, query?: Record<string, unknown>): string {
  const url = new URL(`/api${path}`, serverUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

type ApiFailure = Extract<ApiResult, { ok: false }>;
const networkError = (): ApiFailure => ({
  ok: false,
  status: 0,
  error: { code: 'NETWORK', message: `Cannot reach the BCIS server at ${serverUrl}. Check that the server PC is on and connected to the office network.` },
});

async function callApi(method: string, path: string, options: { query?: Record<string, unknown>; body?: unknown; timeoutMs?: number } = {}): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return fetch(buildUrl(path, options.query), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });
}

async function jsonResult<T>(response: Response): Promise<ApiResult<T>> {
  const payload = (await response.json().catch(() => null)) as { error?: ApiFailure['error'] } | null;
  if (response.ok) return { ok: true, status: response.status, data: payload as unknown as T };
  if (response.status === 401 && token) token = null;
  return { ok: false, status: response.status, error: payload?.error ?? { code: 'HTTP_ERROR', message: `The server answered with status ${response.status}.` } };
}

async function request<T>(method: string, path: string, options: { query?: Record<string, unknown>; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    return await jsonResult<T>(await callApi(method, path, options));
  } catch {
    return networkError();
  }
}

async function testConnection(url: string): Promise<ConnectionTest> {
  const normalized = normalizeServerUrl(url);
  if (!normalized) return { ok: false, message: 'Enter an address such as http://192.168.1.10:4000' };
  try {
    const response = await fetch(`${normalized}/api/health`, { signal: AbortSignal.timeout(5000) });
    const health = (await response.json()) as { status?: string; version?: string; database?: string };
    if (response.ok && health.status === 'ok') return { ok: true, message: `Connected to BCIS server ${health.version ?? ''} (database ${health.database}).` };
    return { ok: false, message: `The server responded but is not healthy (database ${health.database ?? 'unknown'}).` };
  } catch {
    return { ok: false, message: `No BCIS server answered at ${normalized}.` };
  }
}

// ---------------------------------------------------------------- window
let mainWindow: BrowserWindow | null = null;
const rendererFile = join(__dirname, '../renderer/index.html');

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 700,
    show: false,
    backgroundColor: '#F6F8FB',
    title: 'BCIS Billing and Collection System',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => (mainWindow = null));

  // The window only ever shows the application itself.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });

  if (isDev) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!);
  else void mainWindow.loadFile(rendererFile);
}

function isTrustedUrl(url: string): boolean {
  if (isDev) return url.startsWith(process.env.ELECTRON_RENDERER_URL!);
  return url.split(/[?#]/)[0] === pathToFileURL(rendererFile).toString();
}

/** Every IPC call must come from the application's own page. */
function handle<A, R>(channel: string, schema: z.ZodType<A>, handler: (args: A, event: IpcMainInvokeEvent) => Promise<R> | R): void {
  ipcMain.handle(channel, async (event, raw) => {
    if (!event.senderFrame || !isTrustedUrl(event.senderFrame.url)) throw new Error('Blocked IPC call from an untrusted origin.');
    return handler(schema.parse(raw), event);
  });
}

async function saveWithDialog(suggestedName: string, data: Buffer | string, filters: Electron.FileFilter[]): Promise<SaveResult> {
  if (!mainWindow) return { saved: false };
  const safeName = suggestedName.replace(/[<>:"/\\|?*]/g, '_').slice(0, 120);
  const automatic = process.env.BCIS_AUTOSAVE_DIR; // used by automated tests to avoid the native dialog
  let filePath: string | undefined;
  if (automatic) filePath = join(automatic, safeName);
  else {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: join(app.getPath('documents'), safeName), filters });
    if (result.canceled) return { saved: false };
    filePath = result.filePath;
  }
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
    return { saved: true, filePath };
  } catch (err) {
    return { saved: false, error: `The file could not be saved: ${(err as Error).message}` };
  }
}

function registerIpc(): void {
  const none = z.undefined().or(z.null()).optional();

  handle('api:request', ApiRequestSchema, (req) => request(req.method, req.path, { query: req.query, body: req.body }));

  handle('api:download', ApiRequestSchema.pick({ path: true, query: true }), async (req): Promise<SaveResult> => {
    try {
      const response = await callApi('GET', req.path, { query: req.query });
      if (!response.ok) {
        const failed = await jsonResult(response);
        return { saved: false, error: failed.ok ? 'Download failed.' : failed.error.message };
      }
      const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'bcis-export';
      const extension = extname(name).slice(1) || 'bin';
      return await saveWithDialog(name, Buffer.from(await response.arrayBuffer()), [{ name: extension.toUpperCase(), extensions: [extension] }]);
    } catch {
      return { saved: false, error: networkError().error.message };
    }
  });

  handle('api:blob', z.object({ path: z.string().regex(/^\/gcash\/proofs\/\d+\/file$/) }), async (req): Promise<ApiResult<{ contentType: string; data: ArrayBuffer }>> => {
    try {
      const response = await callApi('GET', req.path);
      if (!response.ok) return (await jsonResult(response)) as ApiResult<never>;
      return { ok: true, status: 200, data: { contentType: response.headers.get('content-type') ?? 'application/octet-stream', data: await response.arrayBuffer() } };
    } catch {
      return networkError();
    }
  });

  handle('auth:login', z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) }), async (credentials): Promise<ApiResult<SessionInfo>> => {
    token = null;
    const result = await request<LoginResult>('POST', '/auth/login', { body: { ...credentials, clientName } });
    if (!result.ok) return result;
    token = result.data.token;
    idleLockMinutes = result.data.idleLockMinutes;
    return { ok: true, status: 200, data: { user: result.data.user, locked: false, idleLockMinutes } };
  });

  handle('auth:logout', none, async () => {
    if (token) await request('POST', '/auth/logout');
    token = null;
  });

  handle('auth:current', none, async (): Promise<SessionInfo | null> => {
    if (!token) return null;
    const me = await request<{ user: SessionInfo['user']; locked: boolean }>('GET', '/auth/me');
    return me.ok ? { ...me.data, idleLockMinutes } : null;
  });

  handle('config:get', none, () => ({ serverUrl, clientName }));
  handle('config:test', z.string().max(200), (url) => testConnection(url));
  handle('config:setServerUrl', z.string().max(200), async (url): Promise<ConnectionTest> => {
    const result = await testConnection(url);
    if (!result.ok) return result;
    serverUrl = normalizeServerUrl(url)!;
    token = null;
    await writeFile(configFile(), JSON.stringify({ serverUrl }, null, 2));
    return result;
  });

  handle('print:print', none, async () => {
    mainWindow?.webContents.print({ printBackground: true });
  });
  handle('print:savePdf', z.object({ suggestedName: z.string().min(1).max(120), landscape: z.boolean().optional() }), async (options): Promise<SaveResult> => {
    if (!mainWindow) return { saved: false };
    const pdf = await mainWindow.webContents.printToPDF({ printBackground: true, landscape: options.landscape ?? false, pageSize: 'A4' });
    return saveWithDialog(options.suggestedName.endsWith('.pdf') ? options.suggestedName : `${options.suggestedName}.pdf`, pdf, [{ name: 'PDF', extensions: ['pdf'] }]);
  });

  handle('files:saveText', z.object({ suggestedName: z.string().regex(/^[\w .()-]{1,100}\.csv$/), content: z.string().max(20_000_000) }), (options) =>
    saveWithDialog(options.suggestedName, `﻿${options.content}`, [{ name: 'CSV', extensions: ['csv'] }]),
  );

  handle('app:info', none, () => ({ version: app.getVersion(), electron: process.versions.electron }));
}

app.whenReady().then(() => {
  serverUrl = loadServerUrl();
  if (!isDev) Menu.setApplicationMenu(null);
  // The application never needs camera, microphone, location or notifications.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('mailto:')) void shell.openExternal(url);
    return { action: 'deny' };
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
