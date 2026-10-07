# Security rules

## API

- Every route in `source/api/src/routes.ts` has a `preHandler`: `app.can('permission', ...)` or `app.authenticated()`. Only `/health` and `/auth/login` are public.
- New permission → add it to `PERMISSIONS` and the role matrix in `source/shared/src/permissions.ts`; the base seed syncs the database. Add an AT-10 style test that a lower role gets 403.
- Parse `req.body`, `req.query` and route params with Zod before use. Never pass request objects into services.
- SQL: bound parameters through the Drizzle `sql` tag only. No string concatenation of user input. Sort keys go through the whitelist in `paged()`.
- Errors: throw `AppError` / `DomainError` with a readable message. Never return stack traces or SQL text to the client.
- Do not log request bodies, passwords, tokens or file contents. Keep the Pino `redact` list up to date.
- Passwords: only `hashPassword` / `verifyPassword` (scrypt). Never store or log a plaintext password. Never commit a real password; demo passwords come from `.env`.

## Audit

- Every posted financial mutation calls `audit()` in the same transaction, with actor, action, reason and old/new values.
- `audit_logs` is append-only. Do not add update or delete paths, and do not expose one in the UI.

## Uploads

- Go through `saveAttachment`: type from magic bytes, 5 MB limit, server-generated stored name.
- Never build a file path from a client-supplied name. Read files only through `readAttachment`.

## Electron

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` stay as they are.
- The renderer gets new capabilities only through a new function on `window.bcis` (`src/shared/bridge.ts` → `preload` → an `ipcMain` handler registered with `handle()` and a Zod schema).
- Never expose `ipcRenderer`, `require`, `process`, file paths or the session token to the renderer.
- Keep the Content-Security-Policy in `electron.vite.config.ts` strict: no remote scripts, `connect-src 'none'`.
- No `shell.openExternal` on untrusted URLs; navigation and new windows stay denied.

## Data privacy

- Seeds, tests, screenshots and prompts use synthetic names, numbers and references only.
- Never paste production database contents, real customer details or real credentials into an AI tool.
