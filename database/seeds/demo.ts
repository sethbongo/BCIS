/**
 * Demo seed: a realistic, fully synthetic dataset for the laboratory demonstration.
 *
 * Nothing here is inserted "by hand" into the financial tables. Billing runs, payments, GCash
 * verification, collection batches, reversals and suspensions all go through the same
 * services the application uses, replayed in date order over the last five months, so every
 * invoice balance, ledger entry, receipt and audit record is exactly what the system would
 * have produced. All names, numbers and references are invented.
 */
import { addDays, addMonths, dueDateFor, periodOf, todayInTimeZone, type AreaRow, type CollectorRow, type PlanRow, type RoleCode } from '@bcis/shared';
import { sql } from 'drizzle-orm';
import { config } from '../../source/api/src/config';
import { one, rows, type Db } from '../../source/api/src/db/client';
import { users } from '../../source/api/src/db/schema';
import { setBusinessDate, type Actor, type Ctx } from '../../source/api/src/lib/context';
import { hashPassword } from '../../source/api/src/lib/passwords';
import { loadAuthUser } from '../../source/api/src/modules/auth/service';
import { refreshOverdue } from '../../source/api/src/modules/billing/core';
import * as billing from '../../source/api/src/modules/billing/service';
import * as collections from '../../source/api/src/modules/collections/service';
import * as gcash from '../../source/api/src/modules/gcash/service';
import * as master from '../../source/api/src/modules/masterdata/service';
import * as payments from '../../source/api/src/modules/payments/service';
import * as services from '../../source/api/src/modules/services/service';
import * as subscribers from '../../source/api/src/modules/subscribers/service';
import { placeholderProofPng } from './png';

const USERS: { username: string; fullName: string; role: RoleCode }[] = [
  { username: 'owner', fullName: 'Olivia Ramos', role: 'OWNER' },
  { username: 'admin', fullName: 'Antonio Bautista', role: 'ADMIN' },
  { username: 'cashier', fullName: 'Carla Mendoza', role: 'CASHIER' },
  { username: 'supervisor', fullName: 'Samuel Torres', role: 'COLLECTION_SUPERVISOR' },
  { username: 'auditor', fullName: 'Aurora Villanueva', role: 'ACCOUNTING' },
  { username: 'tech', fullName: 'Teodoro Aquino', role: 'TECHNICIAN' },
  { username: 'viewer', fullName: 'Victor Navarro', role: 'VIEWER' },
];

const PLANS = [
  { code: 'FIBER-25', name: 'Fiber Internet 25 Mbps', serviceType: 'INTERNET', monthlyPrice: 99900, installationFee: 150000, speedMbps: 25 },
  { code: 'FIBER-50', name: 'Fiber Internet 50 Mbps', serviceType: 'INTERNET', monthlyPrice: 129900, installationFee: 150000, speedMbps: 50 },
  { code: 'FIBER-100', name: 'Fiber Internet 100 Mbps', serviceType: 'INTERNET', monthlyPrice: 169900, installationFee: 150000, speedMbps: 100 },
  { code: 'CABLE-BASIC', name: 'Cable TV Basic', serviceType: 'CABLE', monthlyPrice: 45000, installationFee: 80000, channelCount: 60 },
  { code: 'CABLE-PLUS', name: 'Cable TV Plus', serviceType: 'CABLE', monthlyPrice: 65000, installationFee: 80000, channelCount: 95 },
  { code: 'COMBO-50', name: 'Combo 50 Mbps + Cable Basic', serviceType: 'COMBO', monthlyPrice: 159900, installationFee: 200000, speedMbps: 50, channelCount: 60 },
  { code: 'COMBO-100', name: 'Combo 100 Mbps + Cable Plus', serviceType: 'COMBO', monthlyPrice: 199900, installationFee: 200000, speedMbps: 100, channelCount: 95 },
] as const;

const AREAS = [
  { code: 'AREA-01', name: 'Poblacion', barangay: 'Poblacion', routeNotes: 'Start at the public market, work north along Fortich Street.' },
  { code: 'AREA-02', name: 'Casisang', barangay: 'Casisang', routeNotes: 'Highway side first, then interior puroks 3 to 7.' },
  { code: 'AREA-03', name: 'Sumpong', barangay: 'Sumpong', routeNotes: 'Begin near the capitol grounds; subdivision last.' },
];
const COLLECTORS = [
  { code: 'COL-01', fullName: 'Ramon Dela Cruz', phone: '0917 555 0141', areas: [0, 1] },
  { code: 'COL-02', fullName: 'Liza Mangubat', phone: '0918 555 0152', areas: [2] },
];

const FIRST = ['Andres', 'Beatriz', 'Carlos', 'Dolores', 'Emilio', 'Felisa', 'Gregorio', 'Herminia', 'Isidro', 'Josefina', 'Kristoffer', 'Lourdes', 'Mariano', 'Natividad', 'Oscar', 'Perla', 'Quirino', 'Rosalinda', 'Santiago', 'Teresita', 'Ulysses', 'Violeta', 'Wilfredo', 'Ximena', 'Zenaida'];
const LAST = ['Abellana', 'Balindong', 'Cabrera', 'Dagohoy', 'Escalante', 'Fuentebella', 'Gatchalian', 'Hontiveros', 'Ilagan', 'Jalandoni', 'Katigbak', 'Lacson', 'Macaraeg', 'Nepomuceno', 'Ocampo', 'Pangilinan', 'Quiambao', 'Raymundo', 'Sumulong', 'Tolentino', 'Umali', 'Valenzuela', 'Wenceslao', 'Yulo', 'Zamora'];
const STREETS = ['Fortich St.', 'San Isidro St.', 'Magsaysay Ext.', 'Rizal Ave.', 'Mabini St.', 'Bonifacio Drive', 'Don Carlos St.', 'Sayre Highway'];

type Profile = 'ADVANCE' | 'CHRONIC' | 'DELINQUENT' | 'LATE' | 'PARTIAL' | 'GOOD';
const profileOf = (i: number): Profile => (i <= 2 ? 'ADVANCE' : i <= 5 ? 'CHRONIC' : i <= 12 ? 'DELINQUENT' : i <= 18 ? 'LATE' : i <= 26 ? 'PARTIAL' : 'GOOD');
const MONTHS = 5;

interface Sub {
  i: number;
  id: number;
  name: string;
  phone: string;
  area: number;
  dueDay: number;
  profile: Profile;
  monthly: number;
  accounts: number[];
}

export async function seedDemo(db: Db, password: string, log: (message: string) => void = console.log): Promise<void> {
  const T = todayInTimeZone(config.timeZone);
  const periods = Array.from({ length: MONTHS }, (_, k) => addMonths(periodOf(T), k - (MONTHS - 1)));

  // ---------------------------------------------------------------- users
  const actors: Record<string, Actor> = {};
  for (const user of USERS) {
    const [created] = await db.insert(users).values({ username: user.username, fullName: user.fullName, email: `${user.username}@bcis.example`, passwordHash: await hashPassword(password) }).returning({ id: users.id });
    await db.execute(sql`insert into user_roles (user_id, role_id) select ${created.id}, id from roles where code = ${user.role}`);
    actors[user.username] = { ...(await loadAuthUser(db, created.id))!, ip: null };
  }
  const as = (username: string): Ctx => ({ db, actor: actors[username] });
  const admin = as('admin');
  const cashier = as('cashier');
  const supervisor = as('supervisor');
  log(`Created ${USERS.length} demo users`);

  // ---------------------------------------------------------------- master data
  // Installation fees are switched on after the history is built, so the replayed months
  // look like established accounts rather than fifty brand-new installations.
  const plans: PlanRow[] = [];
  for (const p of PLANS) {
    plans.push(await master.createPlan(admin, { ...p, installationFee: 0, reconnectionFee: 30000, speedMbps: 'speedMbps' in p ? p.speedMbps : null, channelCount: 'channelCount' in p ? p.channelCount : null, description: '', isActive: true }));
  }
  const areas: AreaRow[] = [];
  for (const a of AREAS) areas.push(await master.saveArea(admin, null, { code: a.code, name: a.name, description: `Barangay ${a.barangay}, Malaybalay City`, routeNotes: a.routeNotes, isActive: true }));
  const collectorRows: CollectorRow[] = [];
  for (const c of COLLECTORS) collectorRows.push(await master.saveCollector(admin, null, { code: c.code, fullName: c.fullName, phone: c.phone, isActive: true, areaIds: c.areas.map((x) => areas[x].id) }));
  const collectorOfArea = (area: number) => collectorRows[COLLECTORS.findIndex((c) => c.areas.includes(area))];

  // ---------------------------------------------------------------- subscribers and service accounts
  setBusinessDate(addDays(`${periods[0]}-01`, -30));
  const subs: Sub[] = [];
  for (let i = 0; i < 50; i++) {
    const area = i % 3;
    const firstName = FIRST[i % 25];
    const lastName = LAST[(i * 3 + Math.floor(i / 25)) % 25];
    const phone = `09${17 + (i % 3)} 555 ${String(1000 + i * 37).slice(-4)}`;
    const dueDay = [5, 10, 15, 20][i % 4];
    const created = await subscribers.createSubscriber(admin, {
      firstName,
      lastName,
      phone,
      email: i % 4 === 0 ? `${firstName}.${lastName}`.toLowerCase() + '@mail.example' : '',
      dueDay,
      collectionAreaId: areas[area].id,
      collectorId: collectorOfArea(area).id,
      routeSequence: Math.floor(i / 3) + 1,
      notes: '',
      address: { line1: `Purok ${1 + (i % 9)}, ${STREETS[i % STREETS.length]}`, barangay: AREAS[area].barangay, city: 'Malaybalay City', province: 'Bukidnon', landmark: '' },
    });
    const activation = `2025-${String(1 + (i % 12)).padStart(2, '0')}-10`;
    const planIndexes = [i % 7, ...(i % 4 === 1 && i % 7 < 3 ? [3 + (i % 2)] : i % 8 === 2 ? [(i + 3) % 7] : [])];
    const accounts: number[] = [];
    let monthly = 0;
    for (const planIndex of planIndexes) {
      const account = await services.createServiceAccount(admin, { subscriberId: created.id, planId: plans[planIndex].id, activationDate: activation, billingStartDate: activation, dueDay, monthlyDiscount: i === 31 ? 10000 : 0, notes: '' });
      accounts.push(account.id);
      monthly += account.currentRate - account.monthlyDiscount;
    }
    subs.push({ i, id: created.id, name: created.fullName, phone, area, dueDay, profile: profileOf(i), monthly, accounts });
  }
  log(`Created ${subs.length} subscribers with ${subs.reduce((n, s) => n + s.accounts.length, 0)} service accounts`);

  // ---------------------------------------------------------------- replay of five billing months
  const outstanding = async (subscriberId: number) =>
    (await one<{ amount: number }>(db, sql`select coalesce(sum(balance), 0)::bigint as amount from invoices where subscriber_id = ${subscriberId} and status in ('UNPAID','PARTIALLY_PAID','OVERDUE')`))!.amount;

  let gcashCounter = 0;
  const gcashRef = () => `90${String(1_000_000_007 + ++gcashCounter * 7919).padStart(11, '0')}`;
  const proofFile = (n: number) => ({ fileName: `gcash-screenshot-${n}.png`, dataBase64: placeholderProofPng(n).toString('base64') });

  const pays = (s: Sub, k: number): boolean => {
    if (s.profile === 'GOOD') return k < 4 || s.i % 2 === 0;
    if (s.profile === 'LATE') return k < 3;
    if (s.profile === 'DELINQUENT') return k === 0 || (k === 1 && s.i % 2 === 1);
    if (s.profile === 'PARTIAL') return k < 4 || s.i % 2 === 0;
    if (s.profile === 'ADVANCE') return k === 0 || k === 3;
    return false;
  };
  const amountFor = async (s: Sub): Promise<number> => {
    if (s.profile === 'ADVANCE') return s.monthly * 3;
    if (s.profile === 'PARTIAL') return Math.floor((s.monthly * 6) / 10 / 100) * 100;
    return outstanding(s.id);
  };
  // 0 office, 1 collector, 2 GCash. Derived from i/3 so every area has all three kinds of payer.
  const channelOf = (s: Sub) => (s.profile === 'ADVANCE' ? 0 : Math.floor(s.i / 3) % 3);

  const events: { date: string; order: number; run: () => Promise<void> }[] = [];
  const at = (date: string, run: () => Promise<void>) => events.push({ date, order: events.length, run });

  periods.forEach((period, k) => {
    at(`${period}-01`, async () => {
      const run = await billing.generateBilling(admin, { period, finalize: true });
      log(`Billed ${period}: ${run.created} invoices, credit applied ${run.creditApplied / 100}`);
    });

    // Office and GCash payments around each subscriber's due date.
    for (const s of subs.filter((x) => pays(x, k) && channelOf(x) !== 1)) {
      const date = addDays(dueDateFor(period, s.dueDay), (s.i % 5) - 2);
      if (date > T) continue;
      at(date, async () => {
        const amount = await amountFor(s);
        if (amount <= 0) return;
        if (channelOf(s) === 2) {
          const proof = await gcash.submitProof(cashier, { subscriberId: s.id, referenceNo: gcashRef(), senderName: s.name.split(', ').reverse().join(' '), senderNumber: s.phone, amount, transactionDate: date, notes: '', file: proofFile(gcashCounter) });
          await gcash.verifyProof(admin, proof.id, 'Matched against GCash transaction history');
        } else if (s.profile === 'ADVANCE' && s.i === 1) {
          await payments.postPayment(admin, { subscriberId: s.id, amount, method: 'BANK_TRANSFER', referenceNo: `BT-${period.replace('-', '')}-${1000 + s.i}`, paymentDate: date, notes: 'Advance payment for three months' });
        } else {
          await payments.postPayment(cashier, { subscriberId: s.id, amount, method: 'CASH', paymentDate: date, notes: s.profile === 'ADVANCE' ? 'Advance payment for three months' : '' });
        }
      });
    }

    // House-to-house collection: one batch per area per month.
    for (let area = 0; area < 3; area++) {
      const planned = `${period}-12`;
      const date = planned > T ? addDays(T, -1) : planned;
      const current = k === MONTHS - 1;
      if (current && area === 2) continue;
      at(date, async () => {
        const batch = await collections.createBatch(supervisor, { collectorId: collectorOfArea(area).id, areaId: areas[area].id, collectionDate: date, notes: '' });
        let payers = subs.filter((s) => s.area === area && channelOf(s) === 1 && pays(s, k));
        if (current && area === 0) payers = payers.slice(0, Math.ceil(payers.length / 2));
        for (const s of payers) {
          const amount = Math.min(await amountFor(s), batch.accounts.find((a) => a.subscriberId === s.id)?.totalDue ?? 0);
          if (amount > 0) await collections.recordCollection(supervisor, batch.id, { subscriberId: s.id, amount, method: 'CASH', notes: '' });
        }
        const idle = batch.accounts.filter((a) => !payers.some((p) => p.id === a.subscriberId));
        const visits = [
          ['NOT_HOME', 'Gate locked, left a notice'],
          ['PROMISED', 'Will pay at the office on the 30th'],
          ['REFUSED', 'Disputes the amount; referred to the office'],
        ] as const;
        if (k >= 3) for (const [n, account] of idle.slice(0, 3).entries()) await collections.recordOutcome(supervisor, batch.id, { subscriberId: account.subscriberId, outcome: visits[n][0], notes: visits[n][1] });
        if (current && area === 0) return; // left IN_PROGRESS for the live demo

        const submitted = await collections.submitBatch(supervisor, batch.id);
        if (current) return; // left SUBMITTED, waiting for remittance
        const shortage = k === 2 && area === 0 ? 50000 : 0;
        const overage = k === 3 && area === 1 ? 10000 : 0;
        await collections.addRemittance(supervisor, batch.id, { amount: Math.max(submitted.cashCollected - shortage + overage, 0), notes: '' });
        await collections.reconcileBatch(
          supervisor,
          batch.id,
          shortage ? 'Collector reported PHP 500.00 lost in transit; incident report filed, for salary deduction.' : overage ? 'PHP 100.00 excess from an unidentified payer; held in suspense pending claim.' : undefined,
        );
        await collections.closeBatch(admin, batch.id, 'Reviewed and confirmed');
      });
    }
  });

  // ---------------------------------------------------------------- service control scenarios
  const chronic = subs.filter((s) => s.profile === 'CHRONIC');
  const suspendOn = addDays(T, -12);
  for (const s of chronic) {
    at(suspendOn, async () => {
      for (const accountId of s.accounts) await services.suspendServiceAccount(admin, accountId, { reason: 'Non-payment beyond the suspension threshold', effectiveDate: suspendOn, notes: 'Disconnection notice served by the collector' });
    });
  }
  // Scenario 1: pays in full, reconnection requested and completed.
  at(addDays(T, -4), async () => {
    const s = chronic[1];
    await payments.postPayment(cashier, { subscriberId: s.id, amount: await outstanding(s.id), method: 'CASH', notes: 'Full settlement of arrears for reconnection' });
    for (const accountId of s.accounts) {
      const request = await services.requestReconnection(admin, accountId, { technicianUserId: actors.tech.id, notes: 'Subscriber settled all arrears' });
      setBusinessDate(addDays(T, -3));
      await services.completeReconnection(as('tech'), request.id, { completionDate: addDays(T, -3), notes: 'Line restored and signal tested' });
    }
  });
  // Scenario 2: pays in full, reconnection requested and still waiting for the technician.
  at(addDays(T, -2), async () => {
    const s = chronic[2];
    await payments.postPayment(cashier, { subscriberId: s.id, amount: await outstanding(s.id), method: 'CASH', notes: 'Full settlement of arrears for reconnection' });
    for (const accountId of s.accounts) await services.requestReconnection(admin, accountId, { technicianUserId: actors.tech.id, notes: 'Schedule within 24 hours' });
  });

  // ---------------------------------------------------------------- corrections: reversal, adjustment, void
  const late = subs.filter((s) => s.profile === 'LATE');
  const good = subs.filter((s) => s.profile === 'GOOD');
  at(addDays(T, -3), async () => {
    // A payment keyed into the wrong account is reversed (not deleted) and posted correctly.
    const wrong = good[3];
    const right = late[0];
    const amount = right.monthly;
    const mistaken = await payments.postPayment(cashier, { subscriberId: wrong.id, amount, method: 'CASH', notes: '' });
    await payments.reversePayment(admin, mistaken.id, `Posted to the wrong account. The payer is ${right.name}; corrected under a new receipt.`);
    await payments.postPayment(cashier, { subscriberId: right.id, amount, method: 'CASH', notes: `Replaces voided receipt ${mistaken.receiptNo}` });
  });
  at(addDays(T, -5), async () => {
    const s = subs.find((x) => x.profile === 'PARTIAL')!;
    const invoice = await one<{ id: number }>(db, sql`select id from invoices where subscriber_id = ${s.id} and status in ('UNPAID','PARTIALLY_PAID','OVERDUE') and balance >= 20000 order by due_date limit 1`);
    if (invoice) await billing.createAdjustment(admin, { invoiceId: invoice.id, type: 'CREDIT', amount: 20000, reason: 'Rebate for a six-day service interruption (fiber cut along Sayre Highway)' });
  });
  at(addDays(T, -1), async () => {
    // Service terminated at month end, but the new month was already billed: the invoice is voided, not deleted.
    const s = late[4];
    const accountId = s.accounts[0];
    const invoice = await one<{ id: number }>(db, sql`select id from invoices where service_account_id = ${accountId} and billing_period = ${periods[MONTHS - 1]} and amount_paid = 0 and status <> 'VOID'`);
    await services.terminateServiceAccount(admin, accountId, { reason: 'Subscriber relocated outside the service area', effectiveDate: addDays(`${periods[MONTHS - 1]}-01`, -1) });
    if (invoice) await billing.voidInvoice(admin, invoice.id, 'Billed in error: the service was terminated before this billing period started.');
  });

  // ---------------------------------------------------------------- GCash proofs waiting in the verification queue
  at(T, async () => {
    const reused = await one<{ referenceNo: string }>(db, sql`select reference_no as "referenceNo" from payments where method = 'GCASH' and status = 'POSTED' order by id desc limit 1`);
    const [a, b, c] = [late[1], subs.find((s) => s.profile === 'PARTIAL' && s.i % 2 === 1)!, subs.filter((s) => s.profile === 'DELINQUENT')[0]];
    const sender = (s: Sub) => s.name.split(', ').reverse().join(' ');
    await gcash.submitProof(cashier, { subscriberId: a.id, referenceNo: gcashRef(), senderName: sender(a), senderNumber: a.phone, amount: a.monthly, transactionDate: T, notes: 'Sent to the Facebook Page this morning', file: proofFile(901) });
    await gcash.submitProof(cashier, { subscriberId: b.id, referenceNo: gcashRef(), senderName: sender(b), senderNumber: b.phone, amount: 50000, transactionDate: addDays(T, -1), notes: '', file: proofFile(902) });
    // Same reference as a payment that was already verified and posted: the queue flags it and verification is blocked.
    if (reused) await gcash.submitProof(cashier, { subscriberId: c.id, referenceNo: reused.referenceNo, senderName: sender(c), senderNumber: c.phone, amount: c.monthly, transactionDate: T, notes: 'Screenshot forwarded by a relative', file: proofFile(903) });
    const rejected = await gcash.submitProof(cashier, { subscriberId: late[2].id, referenceNo: gcashRef(), senderName: sender(late[2]), senderNumber: late[2].phone, amount: late[2].monthly, transactionDate: addDays(T, -2), notes: '', file: proofFile(904) });
    await gcash.rejectProof(admin, rejected.id, 'Reference number not found in the GCash transaction history; amount on the screenshot is unreadable.');
  });

  events.sort((x, y) => x.date.localeCompare(y.date) || x.order - y.order);
  for (const event of events) {
    setBusinessDate(event.date);
    await event.run();
  }
  setBusinessDate(null);

  // New installations are charged the plan's installation fee from now on.
  for (const p of PLANS) await db.execute(sql`update service_plans set installation_fee = ${p.installationFee} where code = ${p.code}`);
  await refreshOverdue(db);

  const [summary] = await rows<Record<string, number>>(
    db,
    sql`select (select count(*) from invoices) as invoices, (select count(*) from payments) as payments, (select count(*) from ledger_entries) as ledger,
               (select count(*) from collection_batches) as batches, (select count(*) from payment_proofs where status = 'PENDING') as "pendingProofs"`,
  );
  log(`Demo data ready: ${JSON.stringify(summary)}`);
}
