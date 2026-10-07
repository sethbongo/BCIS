# BCIS Deployment Guide

How to install the system for real office use: one **server PC** that runs PostgreSQL and the BCIS API, and three **client PCs** that run the desktop application. The server PC may also be one of the three clients.

```
PC 1  Owner/Admin desktop ─┐
PC 2  Cashier desktop ─────┼── office LAN ──> Server PC: BCIS API (port 4000) ──> PostgreSQL (port 5432, local only)
PC 3  Operations desktop ──┘                             data\attachments, data\backups, data\logs
```

PostgreSQL is **not** opened to the network. Only the API port is reachable from the other PCs.

---

## 1. Server PC

### 1.1 Requirements

| Item | Version | Notes |
|---|---|---|
| Windows | 10 or 11, 64-bit | Give the PC a fixed IP address (router DHCP reservation or manual), e.g. `192.168.1.10` |
| Node.js | 22 LTS or newer | https://nodejs.org |
| PostgreSQL | 15 or newer (17 recommended) | https://www.postgresql.org/download/windows — remember the `postgres` password you choose |
| The project folder | — | Copy the repository to e.g. `C:\BCIS` |

### 1.2 Create the database

Open **SQL Shell (psql)** as the `postgres` user and run (choose your own strong password):

```sql
CREATE ROLE bcis LOGIN PASSWORD 'choose-a-strong-password';
CREATE DATABASE bcis OWNER bcis;
```

### 1.3 Configure

In `C:\BCIS`, copy `.env.example` to `.env` and edit it:

```ini
DATABASE_URL=postgres://bcis:choose-a-strong-password@127.0.0.1:5432/bcis
API_HOST=0.0.0.0
API_PORT=4000
APP_TIMEZONE=Asia/Manila
DATA_DIR=./data
PG_BIN_DIR=C:\Program Files\PostgreSQL\17\bin
NODE_ENV=production
LOG_LEVEL=info
```

Remove the `TEST_DATABASE_URL` and `SEED_DEMO_PASSWORD` lines on a production server. Never commit or share `.env`.

### 1.4 Install, migrate and create the owner

```powershell
cd C:\BCIS
npm ci
npm run build -w @bcis/api
npm run db:seed
npm run owner:create -- owner "Full Name of Owner"
```

* `db:seed` applies all migrations and loads roles, permissions and number sequences. It does **not** load demo data.
* `owner:create` prints a temporary password once. Sign in and change it under **Account**. (To choose the password yourself, set the environment variable `BCIS_OWNER_PASSWORD` before running the command.)
* Do **not** run `db:seed:demo` or `db:reset` on a production database; `db:reset` refuses to run when `NODE_ENV=production`.

### 1.5 Start the API

```powershell
npm run start:api
```

The log prints the addresses the other PCs should use, for example `http://192.168.1.10:4000`. Check it from the server PC: open `http://localhost:4000/api/health` in a browser; it must show `"status":"ok"`.

Pending migrations are applied automatically each time the API starts.

### 1.6 Start automatically with Windows

Run once in an **administrator** PowerShell (adjust the folder):

```powershell
schtasks /Create /TN "BCIS API" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "cmd /c cd /d C:\BCIS && npm run start:api >> C:\BCIS\data\logs\service.log 2>&1"
schtasks /Run /TN "BCIS API"
```

Logs are written to `data\logs\api.log` (structured JSON; passwords and tokens are redacted).

### 1.7 Allow the client PCs through the firewall

Administrator PowerShell on the server PC:

```powershell
New-NetFirewallRule -DisplayName "BCIS API" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Private
```

Make sure the office network is set to **Private** in Windows network settings. Do not open port 5432.

---

## 2. Client PCs

1. Build the installer once on any PC that has the project: `npm run dist` → `release\BCIS-Billing-Setup-1.0.0.exe`.
2. Copy the installer to each office PC and run it. (It is not code-signed, so Windows SmartScreen shows a warning: choose **More info › Run anyway**.)
3. Start **BCIS Billing**. On the sign-in screen click **Change** next to *Server*, type the server address (e.g. `http://192.168.1.10:4000`), click **Test connection**, then **Save**.
4. Sign in.

The address is stored per Windows user in `%APPDATA%\BCIS Billing and Collection\client-config.json`.

---

## 3. First-time setup in the application (Owner)

1. **Administration › Settings** — company name, address and phone (printed on receipts), grace period, suspension threshold.
2. **Administration › Users** — create one account per person and assign roles. Do not share accounts.
3. **Services › Plans** — create the Internet, Cable and Combo plans.
4. **Collections › Areas & Routes** and **Collectors** — create areas, collectors and assignments.
5. Register subscribers and their service accounts, then run **Billing › Generate Billing**.

---

## 4. Backup

### 4.1 In the application

**Administration › Backup & Restore › Create backup now**, then **Verify**. Backups are folders in `data\backups\` on the server PC containing the database dump, the proof attachments and a checksum manifest.

### 4.2 Scheduled nightly backup

```powershell
schtasks /Create /TN "BCIS nightly backup" /SC DAILY /ST 20:00 /RU SYSTEM /TR "cmd /c cd /d C:\BCIS && npm run backup:create >> C:\BCIS\data\logs\backup.log 2>&1"
```

The command creates **and verifies** the backup; the result is in the log and in the app's backup history.

### 4.3 Off-site copy

A backup on the same disk does not survive a disk failure. Copy `data\backups` to an external drive or another PC at least weekly, for example:

```powershell
robocopy C:\BCIS\data\backups E:\BCIS-backups /MIR /R:2 /W:5
```

---

## 5. Restore

### 5.1 Normal restore (system still running)

1. Ask the other users to stop working.
2. Owner: **Administration › Backup & Restore › Restore…** on a verified backup. Type the reason and `RESTORE`.
3. The system verifies the backup, takes a *pre-restore* safety backup, restores inside a single transaction and runs the integrity check. The result is shown on screen and recorded in the backup history.
4. If the integrity check fails, do not continue working; restore the *pre-restore* backup the same way and contact the developer.

### 5.2 Disaster recovery (new server PC)

1. Install Node.js and PostgreSQL, copy the project, create the empty database and `.env` (section 1.2–1.3), run `npm ci` and `npm run build -w @bcis/api`.
2. Copy the backup folder (e.g. `bcis-20261007-200000`) to the new PC.
3. Restore the database and the attachments:

```powershell
$env:PGPASSWORD = 'your-database-password'
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" --clean --if-exists --no-owner --single-transaction --exit-on-error -h 127.0.0.1 -U bcis -d bcis C:\path\to\bcis-20261007-200000\database.dump
robocopy C:\path\to\bcis-20261007-200000\attachments C:\BCIS\data\attachments /E
```

4. Start the API (`npm run start:api`), sign in as the owner and run **Administration › Backup & Restore › Run check**. All checks must pass.

This procedure is exercised automatically by acceptance test AT-12 (`tests/acceptance/at-12-backup-restore.test.ts`).

---

## 6. Updating to a new version

```powershell
schtasks /End /TN "BCIS API"
cd C:\BCIS
npm run backup:create
# replace the project files with the new version (git pull, or copy over), keeping .env and the data folder
npm ci
npm run build -w @bcis/api
schtasks /Run /TN "BCIS API"
```

Migrations run automatically at start. Reinstall the desktop client only if the release notes say the client changed.

---

## 7. Validating three simultaneous clients

Automated: `npm test` runs AT-09, which starts the API on a real network port and has three logged-in clients post payments, generate billing and read reports at the same time, then checks receipt numbering, balances and the integrity check.

Manual check on the real PCs:

| Step | PC 1 (Owner) | PC 2 (Cashier) | PC 3 (Operations) | Expected |
|---|---|---|---|---|
| 1 | Open Dashboard | Receive Payment for subscriber A | Receive Payment for subscriber B | Both payments post; two different, consecutive receipt numbers |
| 2 | Open subscriber A's Ledger | Post a second payment for A | Open **Generate Billing** and run the current month | Ledger on PC 1 shows both payments after refresh; no duplicate invoices |
| 3 | **Generate Billing** for the same month again | — | — | "Already billed … will be skipped"; 0 created |
| 4 | Administration › Backup & Restore › **Run check** | — | — | All checks passed |
| 5 | — | Try to open `Administration` | — | Not in the cashier's menu; direct access is refused by the server |

---

## 8. Development machine (laboratory)

For development and the demo, the project can run its own PostgreSQL instance from the installed binaries, in the folder `.localdb\` on port **5433**, without touching the PostgreSQL service or needing its password:

```powershell
npm install
npm run setup            # creates .env with random local passwords
npm run db:start         # start the local PostgreSQL (run again after every reboot)
npm run db:reset -- --yes   # migrations + base data + demo dataset
npm run dev              # API + desktop app with hot reload
```

See `README.md` for the full list of commands.
