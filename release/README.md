# Release

Installers are large binaries and are not stored in Git. Build them here with:

```powershell
npm run dist
```

Output: `release\BCIS-Billing-Setup-1.0.0.exe` (Windows x64 NSIS installer for the desktop client) and `release\win-unpacked\` (the same application, runnable without installing).

The installer contains only the desktop client. The API server and PostgreSQL run on the server PC; see `docs/deployment-guide.md`.

The build is not code-signed, so Windows SmartScreen shows a warning on first run (**More info › Run anyway**).
