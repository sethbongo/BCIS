import type { InvoiceRow, LedgerResult, PaymentDetail, RoleCode, ServiceAccountRow, SubscriberDetail } from '@bcis/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../source/api/src/app';
import { config } from '../../source/api/src/config';
import { createDatabase, rows, type Database } from '../../source/api/src/db/client';
import { placeholderProofPng } from '../../database/seeds/png';
import { TEST_PASSWORD } from './global-setup';

export { TEST_PASSWORD };

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

export interface Harness {
  app: FastifyInstance;
  database: Database;
  /** Calls the API as the test user holding the given role (a real login + bearer token). */
  call<T = any>(role: RoleCode | null, method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, body?: unknown): Promise<ApiResponse<T>>;
  login(role: RoleCode): Promise<string>;
  forgetSessions(): void;
  sql<T = Record<string, any>>(query: ReturnType<typeof sql>): Promise<T[]>;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  if (!config.isTest || config.databaseUrl !== config.testDatabaseUrl) throw new Error('Acceptance tests must run against TEST_DATABASE_URL.');
  const database = createDatabase(config.databaseUrl, 10);
  const app = await buildApp({ database });
  const tokens = new Map<RoleCode, string>();

  const login = async (role: RoleCode): Promise<string> => {
    const cached = tokens.get(role);
    if (cached) return cached;
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: role.toLowerCase(), password: TEST_PASSWORD, clientName: 'acceptance-test' } });
    if (res.statusCode !== 200) throw new Error(`Login as ${role} failed: ${res.body}`);
    tokens.set(role, res.json().token);
    return res.json().token;
  };

  return {
    app,
    database,
    login,
    forgetSessions: () => tokens.clear(),
    async call(role, method, url, body) {
      const headers: Record<string, string> = role ? { authorization: `Bearer ${await login(role)}` } : {};
      const res = await app.inject({ method, url: `/api${url}`, headers, payload: body as object | undefined });
      const isJson = String(res.headers['content-type'] ?? '').includes('application/json');
      return { status: res.statusCode, body: (isJson ? res.json() : res.rawPayload) as never };
    },
    sql: (query) => rows(database.db, query),
    async close() {
      await app.close();
      await database.pool.end();
    },
  };
}

let counter = 0;
const unique = () => `${Date.now().toString(36).slice(-5)}${(++counter).toString(36)}`.toUpperCase();

export interface Fixture {
  subscriber: SubscriberDetail;
  account: ServiceAccountRow;
  planId: number;
}

/** A subscriber with one service account on a brand-new plan priced at `monthlyPrice` centavos. */
export async function createSubscriberWithService(
  h: Harness,
  monthlyPrice: number,
  options: { dueDay?: number; areaId?: number; collectorId?: number; billingStartDate?: string; serviceType?: 'INTERNET' | 'CABLE' | 'COMBO' } = {},
): Promise<Fixture> {
  const tag = unique();
  const plan = await h.call('ADMIN', 'POST', '/plans', {
    code: `T-${tag}`,
    name: `Test Plan ${tag}`,
    serviceType: options.serviceType ?? 'INTERNET',
    monthlyPrice,
    installationFee: 0,
    reconnectionFee: 30000,
    speedMbps: 50,
    isActive: true,
  });
  if (plan.status !== 200) throw new Error(`plan: ${JSON.stringify(plan.body)}`);
  const subscriber = await h.call<SubscriberDetail>('ADMIN', 'POST', '/subscribers', {
    firstName: 'Test',
    lastName: `Subscriber ${tag}`,
    phone: '0917 555 0100',
    dueDay: options.dueDay ?? 28,
    collectionAreaId: options.areaId ?? null,
    collectorId: options.collectorId ?? null,
    address: { line1: `Purok ${counter}`, barangay: 'Test Barangay', city: 'Malaybalay City', province: 'Bukidnon' },
  });
  if (subscriber.status !== 200) throw new Error(`subscriber: ${JSON.stringify(subscriber.body)}`);
  const start = options.billingStartDate ?? '2025-01-01';
  const account = await h.call<ServiceAccountRow>('ADMIN', 'POST', '/service-accounts', {
    subscriberId: subscriber.body.id,
    planId: plan.body.id,
    activationDate: start,
    billingStartDate: start,
    dueDay: options.dueDay ?? 28,
    monthlyDiscount: 0,
  });
  if (account.status !== 200) throw new Error(`service account: ${JSON.stringify(account.body)}`);
  return { subscriber: subscriber.body, account: account.body, planId: plan.body.id };
}

/** Generates and finalizes the invoice for one service account and returns it. */
export async function bill(h: Harness, fixture: Fixture, period: string): Promise<InvoiceRow> {
  const run = await h.call('ADMIN', 'POST', '/billing/generate', { period, finalize: true, serviceAccountIds: [fixture.account.id] });
  if (run.status !== 200) throw new Error(`billing: ${JSON.stringify(run.body)}`);
  return (await invoicesOf(h, fixture)).find((i) => i.billingPeriod === period)!;
}

export async function invoicesOf(h: Harness, fixture: Fixture): Promise<InvoiceRow[]> {
  const res = await h.call('ADMIN', 'GET', `/invoices?subscriberId=${fixture.subscriber.id}&pageSize=100&sort=dueDate&dir=asc`);
  return res.body.rows;
}

export async function pay(h: Harness, fixture: Fixture, amount: number, extra: Record<string, unknown> = {}, role: RoleCode = 'CASHIER'): Promise<ApiResponse<PaymentDetail>> {
  return h.call<PaymentDetail>(role, 'POST', '/payments', { subscriberId: fixture.subscriber.id, amount, method: 'CASH', idempotencyKey: randomUUID(), ...extra });
}

export async function ledgerOf(h: Harness, fixture: Fixture): Promise<LedgerResult> {
  return (await h.call<LedgerResult>('ADMIN', 'GET', `/subscribers/${fixture.subscriber.id}/ledger`)).body;
}

export const proofFile = (seed = 1) => ({ fileName: `proof-${seed}.png`, dataBase64: placeholderProofPng(seed).toString('base64') });
export const gcashReference = () => `7${Date.now().toString().slice(-8)}${String(++counter).padStart(4, '0')}`;
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: config.timeZone });
