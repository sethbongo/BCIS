/**
 * Desktop end-to-end tests (Playwright driving Electron). They follow the live-demo sequence
 * of the laboratory brief and save the UI evidence screenshots to tests/screenshots/.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const shots = resolve(root, 'tests/screenshots');
const password = process.env.SEED_DEMO_PASSWORD ?? '';
const serverUrl = `http://127.0.0.1:${process.env.API_PORT ?? 4000}`;
const downloads = mkdtempSync(join(tmpdir(), 'bcis-e2e-files-'));

let app: ElectronApplication;
let page: Page;

async function launch(): Promise<void> {
  // Some editors export ELECTRON_RUN_AS_NODE to their terminals, which would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  app = await electron.launch({
    args: [resolve(root, 'source/desktop')],
    env: { ...env, BCIS_SERVER_URL: serverUrl, BCIS_USER_DATA: mkdtempSync(join(tmpdir(), 'bcis-e2e-profile-')), BCIS_AUTOSAVE_DIR: downloads } as Record<string, string>,
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

async function signIn(username: string): Promise<void> {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
}

async function signOut(): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

const nav = (name: string) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: true }).click();
const shot = async (name: string) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, `${name}.png`) });
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  expect(password, 'SEED_DEMO_PASSWORD must be set in .env').not.toBe('');
  mkdirSync(shots, { recursive: true });
  await launch();
});
test.afterAll(async () => {
  await app?.close();
});

test('the renderer is sandboxed: no Node.js, only the typed bridge', async () => {
  const exposure = await page.evaluate(() => ({
    hasRequire: typeof (globalThis as any).require !== 'undefined',
    hasProcess: typeof (globalThis as any).process !== 'undefined',
    bridge: Object.keys((window as any).bcis).sort(),
  }));
  expect(exposure).toEqual({ hasRequire: false, hasProcess: false, bridge: ['api', 'app', 'auth', 'config', 'files', 'print'] });
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { contextIsolation: p?.contextIsolation, nodeIntegration: p?.nodeIntegration, sandbox: p?.sandbox };
  });
  expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
  await shot('01-login');
});

test('wrong password is rejected with a readable message', async () => {
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Incorrect username or password.')).toBeVisible();
});

test('administrator: dashboard, subscriber profile, ledger and statement of account', async () => {
  await signIn('admin');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Billing vs collection')).toBeVisible();
  await expect(page.getByText('Overdue receivable')).toBeVisible();
  await shot('02-dashboard');

  await nav('All Subscribers');
  await expect(page.getByRole('heading', { name: 'All Subscribers' })).toBeVisible();
  await expect(page.getByText(/of 50$/)).toBeVisible();
  await shot('03-subscribers');

  await page.getByPlaceholder('Search subscribers…').fill('Hontiveros');
  await page.getByRole('row').filter({ hasText: 'Hontiveros' }).first().click();
  await expect(page.getByRole('tab', { name: 'Ledger' })).toBeVisible();
  await shot('04-subscriber-profile');

  await page.getByRole('tab', { name: 'Ledger' }).click();
  await expect(page.getByText('Closing balance')).toBeVisible();
  await shot('05-subscriber-ledger');
  await page.getByRole('button', { name: 'Statement of Account' }).click();
  await expect(page.getByRole('dialog', { name: /Statement of Account/ })).toBeVisible();
  await shot('06-statement-of-account-print');
  await page.getByRole('button', { name: 'Close preview' }).click();

  await page.getByRole('tab', { name: /Services/ }).click();
  await shot('07-subscriber-services');
});

test('administrator: billing, invoices, receivables and aging', async () => {
  await nav('Current Billing');
  await expect(page.getByText('Invoices by status')).toBeVisible();
  await shot('08-current-billing');

  await nav('Generate Billing');
  await expect(page.getByText(/Nothing left to bill|Preview/).first()).toBeVisible();
  await shot('09-generate-billing');

  await nav('Invoices');
  await page.getByRole('row').nth(1).click();
  await expect(page.getByText('Payments applied', { exact: true })).toBeVisible();
  await shot('10-invoice-detail');
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();

  await nav('Overdue');
  await expect(page.getByRole('heading', { name: 'Overdue Accounts' })).toBeVisible();
  await expect(page.getByText('Months unpaid')).toBeVisible();
  await shot('11-overdue');

  await nav('Aging');
  await expect(page.getByText(/Reconciled: the aging total equals/)).toBeVisible();
  await shot('12-ar-aging');

  await nav('Suspension Candidates');
  await expect(page.getByRole('heading', { name: 'Suspension Candidates' })).toBeVisible();
  await shot('13-suspension-candidates');
});

test('administrator: GCash verification with duplicate-reference protection', async () => {
  await nav('GCash Verification');
  await expect(page.getByRole('tab', { name: /Pending/ })).toBeVisible();
  const duplicate = page.getByRole('button').filter({ hasText: 'Duplicate reference' }).first();
  await duplicate.click();
  await expect(page.getByText('This reference number already backs a posted payment')).toBeVisible();
  await expect(page.getByRole('button', { name: /Verify and post/ })).toBeDisabled();
  await shot('14-gcash-duplicate-blocked');

  const clean = page.locator('li button').filter({ hasNotText: 'Duplicate reference' }).first();
  await clean.click();
  await expect(page.getByRole('button', { name: /Verify and post/ })).toBeEnabled();
  await shot('15-gcash-verification');
  await page.getByLabel('Verification notes').fill('Matched in GCash transaction history');
  await page.getByRole('button', { name: /Verify and post/ }).click();
  await expect(page.getByText(/Verified and posted · Receipt RCPT-/)).toBeVisible();
});

test('administrator: collection batch, remittance shortage and reconciliation', async () => {
  await nav('Remittance');
  await expect(page.getByRole('heading', { name: 'Remittance' })).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'Submitted' }).first().click();
  await expect(page.getByText('Remittance and reconciliation')).toBeVisible();

  // Turn over 500.00 less than the cash collected.
  const cash = page.getByLabel('Cash amount counted');
  const expected = Number((await cash.inputValue()).replace(/,/g, ''));
  await cash.fill((expected - 500).toFixed(2));
  await page.getByRole('button', { name: 'Record remittance' }).click();
  await expect(page.getByText('Shortage of ₱500.00').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Reconcile with shortage/ })).toBeDisabled();
  await shot('16-collector-reconciliation-shortage');

  await page.getByLabel(/Reason for the shortage/).fill('Collector short by 500.00; acknowledged, for salary deduction');
  await page.getByRole('button', { name: /Reconcile with shortage/ }).click();
  await expect(page.getByText(/Reconciled: Shortage of ₱500.00/)).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Close batch' }).click();
  await expect(page.getByText(/Closed by Antonio Bautista/)).toBeVisible();
  await shot('17-batch-closed-with-shortage');

  await nav('Collection Batches');
  await expect(page.getByText('Shortage ₱500.00').first()).toBeVisible();
  await shot('18-collection-batches');
});

test('administrator: reports, export to PDF and XLSX, audit trail', async () => {
  await nav('Reports');
  await page.getByRole('button', { name: 'Accounts Receivable Aging' }).click();
  await page.getByRole('button', { name: 'Run report' }).click();
  await expect(page.getByText(/Accounts receivable aging as of/)).toBeVisible();
  await shot('19-report-ar-aging');
  await page.getByRole('button', { name: 'PDF' }).click();
  await expect(page.getByText('File saved').first()).toBeVisible();
  await page.getByRole('button', { name: 'XLSX' }).click();
  await expect.poll(() => readdirSync(downloads).filter((f) => f.startsWith('ar-aging')).map((f) => f.split('.').pop()).sort()).toEqual(['pdf', 'xlsx']);

  await page.getByRole('button', { name: 'Collection Report' }).click();
  await page.getByLabel('From').fill('2026-01-01');
  await page.getByLabel('Group by').selectOption('month');
  await page.getByRole('button', { name: 'Run report' }).click();
  await expect(page.getByText(/Monthly collections/)).toBeVisible();
  await shot('20-report-collections');

  await nav('Administration');
  await page.getByRole('tab', { name: 'Audit Log' }).click();
  await expect(page.getByText('collection.reconcile').first()).toBeVisible();
  await shot('21-audit-log');
  await signOut();
});

test('cashier: receive a partial cash payment, preview the allocation, print the receipt', async () => {
  await signIn('cashier');
  // The cashier lands on Receive Payment and has no administration or billing-run menu.
  await expect(page.getByRole('heading', { name: 'Receive Payment' })).toBeVisible();
  const menu = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(menu.getByRole('link', { name: 'Administration' })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: 'Generate Billing' })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);

  await page.getByLabel('Find subscriber').fill('Ilagan');
  await page.getByRole('listbox').getByRole('option').first().click();
  await expect(page.getByText('Total due').first()).toBeVisible();
  await page.getByPlaceholder('0.00').first().fill('500');
  await expect(page.getByText('Remaining due after')).toBeVisible();
  await shot('22-receive-payment-allocation-preview');

  await page.getByRole('button', { name: /Post payment/ }).click();
  await expect(page.getByRole('heading', { name: 'Payment posted' })).toBeVisible();
  await shot('23-payment-posted');
  await page.getByRole('button', { name: 'Print receipt' }).click();
  await expect(page.getByText('Official Receipt')).toBeVisible();
  await shot('24-receipt-print-preview');
  await page.getByRole('button', { name: 'Save as PDF' }).click();
  await expect.poll(() => readdirSync(downloads).some((f) => /^receipt-RCPT-\d+\.pdf$/.test(f))).toBe(true);
  await page.getByRole('button', { name: 'Close preview' }).click();
});

test('cashier: role restrictions are enforced by the server, not only by hidden menus', async () => {
  // Call admin-only operations directly through the bridge, bypassing the UI entirely.
  const results = await page.evaluate(async () => {
    const call = (method: 'GET' | 'POST', path: string, body?: unknown) => (window as any).bcis.api.request({ method, path, body }).then((r: any) => r.status);
    return { users: await call('GET', '/users'), createBackup: await call('POST', '/backups', {}), reverse: await call('POST', '/payments/1/reverse', { reason: 'not allowed to do this' }), ownPayments: await call('GET', '/payments') };
  });
  expect(results).toEqual({ users: 403, createBackup: 403, reverse: 403, ownPayments: 200 });

  // Opening an admin screen by URL shows a no-access notice rather than data.
  await page.evaluate(() => (window.location.hash = '#/admin'));
  await expect(page.getByText('You do not have access to this screen')).toBeVisible();
  await shot('25-cashier-no-access');

  await nav('Payment History');
  await page.getByRole('row').nth(1).click();
  await expect(page.getByRole('button', { name: 'Print receipt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reverse payment' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await signOut();
});

test('owner: payment reversal with audit trail, session lock, backup', async () => {
  await signIn('owner');
  await nav('Payment History');
  await page.getByRole('row').nth(1).click();
  await page.getByRole('button', { name: 'Reverse payment' }).click();
  await page.getByLabel('Reason for reversal').fill('Demo: wrong amount keyed in by the cashier');
  await shot('26-payment-reversal-dialog');
  await page.getByRole('button', { name: 'Reverse payment' }).click();
  await expect(page.getByText(/Receipt RCPT-\d+ reversed/)).toBeVisible();
  await page.getByRole('row').nth(1).click();
  await expect(page.getByText(/^Reversed · REV-/)).toBeVisible();
  await shot('27-payment-reversed');
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();

  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('dialog', { name: 'Session locked' })).toBeVisible();
  await shot('28-session-locked');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('dialog', { name: 'Session locked' })).toHaveCount(0);

  await nav('Administration');
  await page.getByRole('tab', { name: 'Backup & Restore' }).click();
  await page.getByRole('button', { name: 'Create backup now' }).click();
  await expect(page.getByText(/Backup bcis-\d+-\d+ created/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Verify' }).first().click();
  await expect(page.getByText(/Checksum OK/).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Run check' }).click();
  await expect(page.getByText('All checks passed')).toBeVisible();
  await shot('29-backup-and-integrity');

  await page.getByRole('tab', { name: 'Roles & Permissions' }).click();
  await expect(page.getByText('Role and permission matrix')).toBeVisible();
  await shot('30-role-matrix');
});
