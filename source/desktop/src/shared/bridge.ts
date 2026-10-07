/**
 * The complete, typed surface the renderer can reach. It is exposed by the preload
 * script through contextBridge as `window.bcis`. The renderer has no Node.js access,
 * no direct network access to the API and never sees the session token.
 */
import type { AuthUser } from '@bcis/shared';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT';
export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface ApiRequest {
  method: HttpMethod;
  /** Path below /api, e.g. "/subscribers/12". */
  path: string;
  query?: QueryParams;
  body?: unknown;
}

export type ApiResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: { code: string; message: string; fields?: Record<string, string> } };

export interface SessionInfo {
  user: AuthUser;
  locked: boolean;
  idleLockMinutes: number;
}

export interface SaveResult {
  saved: boolean;
  filePath?: string;
  error?: string;
}

export interface ConnectionTest {
  ok: boolean;
  message: string;
}

export interface BcisBridge {
  api: {
    request<T = unknown>(request: ApiRequest): Promise<ApiResult<T>>;
    /** Downloads a server-generated file (report export) and saves it where the user chooses. */
    download(request: { path: string; query?: QueryParams }): Promise<SaveResult>;
    /** Fetches a binary resource for in-app preview (payment proof images). */
    blob(request: { path: string }): Promise<ApiResult<{ contentType: string; data: ArrayBuffer }>>;
  };
  auth: {
    login(credentials: { username: string; password: string }): Promise<ApiResult<SessionInfo>>;
    logout(): Promise<void>;
    /** Restores the session after a window reload, if the main process still holds one. */
    current(): Promise<SessionInfo | null>;
  };
  config: {
    get(): Promise<{ serverUrl: string; clientName: string }>;
    setServerUrl(url: string): Promise<ConnectionTest>;
    test(url: string): Promise<ConnectionTest>;
  };
  print: {
    print(): Promise<void>;
    savePdf(options: { suggestedName: string; landscape?: boolean }): Promise<SaveResult>;
  };
  files: {
    saveText(options: { suggestedName: string; content: string }): Promise<SaveResult>;
  };
  app: {
    info(): Promise<{ version: string; electron: string }>;
  };
}
