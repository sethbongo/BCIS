import { keepPreviousData, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import type { HttpMethod, QueryParams } from '../../../shared/bridge';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

type SessionListener = (event: 'expired' | 'locked') => void;
const listeners = new Set<SessionListener>();
export const onSessionEvent = (listener: SessionListener) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

async function request<T>(method: HttpMethod, path: string, options: { query?: QueryParams; body?: unknown } = {}): Promise<T> {
  const result = await window.bcis.api.request<T>({ method, path, ...options });
  if (result.ok) return result.data;
  if (result.status === 401 && result.error.code === 'UNAUTHENTICATED') listeners.forEach((l) => l('expired'));
  if (result.status === 423) listeners.forEach((l) => l('locked'));
  throw new ApiError(result.status, result.error.code, result.error.message, result.error.fields);
}

export const api = {
  get: <T>(path: string, query?: QueryParams) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, { body }),
  /** Saves a server-generated file (report export) to a location chosen by the user. */
  async download(path: string, query?: QueryParams): Promise<void> {
    const result = await window.bcis.api.download({ path, query });
    if (result.saved) toast.success('File saved', { description: result.filePath });
    else if (result.error) toast.error(result.error);
  },
};

/** Server-state query keyed by path + parameters. */
export function useApi<T>(path: string | null, query?: QueryParams, options?: Partial<UseQueryOptions<T, ApiError>>) {
  return useQuery<T, ApiError>({
    queryKey: [path, query ?? null],
    queryFn: () => api.get<T>(path!, query),
    enabled: path !== null,
    placeholderData: keepPreviousData,
    ...options,
  });
}

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'Something went wrong.');

/** Shows a failed action to the user; field-level problems go back onto the form. */
export function handleError<T extends FieldValues>(err: unknown, setError?: UseFormSetError<T>): void {
  if (err instanceof ApiError && err.fields && setError) {
    for (const [field, message] of Object.entries(err.fields)) setError(field as Path<T>, { message });
  }
  toast.error(errorMessage(err));
}

export async function saveCsv(suggestedName: string, header: string[], rows: (string | number | null | undefined)[][]): Promise<void> {
  const cell = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? '' : String(value);
    const safe = /^[=+\-@]/.test(text) && typeof value === 'string' ? `'${text}` : text;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const content = [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
  const result = await window.bcis.files.saveText({ suggestedName, content });
  if (result.saved) toast.success('CSV saved', { description: result.filePath });
  else if (result.error) toast.error(result.error);
}
