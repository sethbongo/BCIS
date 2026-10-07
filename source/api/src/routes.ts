/**
 * HTTP routes. Each route does three things only: authorize (app.can), validate (Zod),
 * and delegate to a service. Business rules live in the services, not here.
 */
import {
  AdjustmentInput,
  AddressInput,
  AreaInput,
  BackupCreateInput,
  BackupRestoreInput,
  BatchCollectInput,
  BatchCreateInput,
  BatchOutcomeInput,
  BillingGenerateInput,
  CloseBatchInput,
  CollectorInput,
  FinalizeDraftsInput,
  GcashRejectInput,
  GcashSubmissionInput,
  GcashVerifyInput,
  InvoiceVoidInput,
  ListQuery,
  PaymentInput,
  PaymentPreviewInput,
  PaymentReverseInput,
  PlanInput,
  PlanUpdateInput,
  ReconcileInput,
  ReconnectionCompleteInput,
  ReconnectionRequestInput,
  RemittanceInput,
  ResetPasswordInput,
  ServiceAccountInput,
  ServiceAccountUpdateInput,
  SettingsUpdateInput,
  SubscriberInput,
  SubscriberUpdateInput,
  SuspendInput,
  TerminateInput,
  UserCreateInput,
  UserUpdateInput,
  zDate,
  zPeriod,
} from '@bcis/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can } from './lib/context';
import { getSettings, updateSettings } from './lib/settings';
import * as admin from './modules/admin/service';
import * as backup from './modules/admin/backup';
import { runIntegrityCheck } from './modules/admin/integrity';
import * as billing from './modules/billing/service';
import * as collections from './modules/collections/service';
import { getDashboard } from './modules/dashboard/service';
import * as gcash from './modules/gcash/service';
import * as master from './modules/masterdata/service';
import * as payments from './modules/payments/service';
import * as receivables from './modules/receivables/service';
import { ReportQuery } from './modules/reports/definitions';
import * as reports from './modules/reports/service';
import * as services from './modules/services/service';
import * as subscribers from './modules/subscribers/service';
import * as users from './modules/users/service';
import { ctx, idParam, sessionOf } from './plugins/auth';

const UPLOAD_LIMIT = 8 * 1024 * 1024;

function sendFile(reply: FastifyReply, file: { data: Buffer; contentType: string; fileName: string }, inline = false) {
  return reply
    .header('content-type', file.contentType)
    .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename="${file.fileName.replace(/[^\w.-]/g, '_')}"`)
    .header('cache-control', 'no-store')
    .send(file.data);
}

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const c = (req: FastifyRequest) => ctx(app, req);
  const list = (req: FastifyRequest) => ListQuery.parse(req.query);

  // ------------------------------------------------------------ lookups & search
  app.get('/lookups', { preHandler: app.authenticated() }, async () => {
    const [plans, areas, collectorList, technicians] = await Promise.all([master.listPlans(db), master.listAreas(db), master.listCollectors(db), services.listTechnicians(db)]);
    return { plans, areas, collectors: collectorList, technicians };
  });

  app.get('/search', { preHandler: app.authenticated() }, async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(80) }).parse(req.query);
    const { actor } = sessionOf(req);
    return admin.globalSearch(db, q, { subscribers: can(actor, 'subscriber.view'), billing: can(actor, 'billing.view'), payments: can(actor, 'payment.view') });
  });

  app.get('/dashboard', { preHandler: app.can('dashboard.view') }, async () => getDashboard(db));

  // ------------------------------------------------------------ users & roles (Owner only)
  app.get('/users', { preHandler: app.can('user.manage') }, async () => users.listUsers(db));
  app.get('/roles', { preHandler: app.can('user.manage') }, async () => users.listRoles(db));
  app.post('/users', { preHandler: app.can('user.manage') }, async (req) => users.createUser(c(req), UserCreateInput.parse(req.body)));
  app.patch('/users/:id', { preHandler: app.can('user.manage') }, async (req) => users.updateUser(c(req), idParam(req), UserUpdateInput.parse(req.body)));
  app.post('/users/:id/reset-password', { preHandler: app.can('user.manage') }, async (req) => {
    await users.resetPassword(c(req), idParam(req), ResetPasswordInput.parse(req.body).newPassword);
    return { ok: true };
  });

  // ------------------------------------------------------------ plans
  app.get('/plans', { preHandler: app.can('plan.view', 'service.view') }, async () => master.listPlans(db));
  app.post('/plans', { preHandler: app.can('plan.manage') }, async (req) => master.createPlan(c(req), PlanInput.parse(req.body)));
  app.patch('/plans/:id', { preHandler: app.can('plan.manage') }, async (req) => master.updatePlan(c(req), idParam(req), PlanUpdateInput.parse(req.body)));

  // ------------------------------------------------------------ subscribers
  app.get('/subscribers', { preHandler: app.can('subscriber.view') }, async (req) => subscribers.listSubscribers(db, list(req)));
  app.post('/subscribers', { preHandler: app.can('subscriber.create') }, async (req) => subscribers.createSubscriber(c(req), SubscriberInput.parse(req.body)));
  app.get('/subscribers/:id', { preHandler: app.can('subscriber.view') }, async (req) => subscribers.getSubscriber(db, idParam(req)));
  app.patch('/subscribers/:id', { preHandler: app.can('subscriber.update') }, async (req) => subscribers.updateSubscriber(c(req), idParam(req), SubscriberUpdateInput.parse(req.body)));
  app.post('/subscribers/:id/addresses', { preHandler: app.can('subscriber.update') }, async (req) => {
    await subscribers.addAddress(c(req), idParam(req), AddressInput.parse(req.body));
    return subscribers.listAddresses(db, idParam(req));
  });
  app.get('/subscribers/:id/ledger', { preHandler: app.can('billing.view') }, async (req) => {
    const range = z.object({ from: zDate.optional(), to: zDate.optional() }).parse(req.query);
    return billing.getLedger(db, idParam(req), range);
  });
  app.get('/subscribers/:id/service-events', { preHandler: app.can('service.view') }, async (req) => services.listServiceEvents(db, { subscriberId: idParam(req) }));
  app.get('/subscribers/:id/collections', { preHandler: app.can('collection.view') }, async (req) => collections.listSubscriberCollections(db, idParam(req)));

  // ------------------------------------------------------------ service accounts, suspension, reconnection
  app.get('/service-accounts', { preHandler: app.can('service.view') }, async (req) => services.listServiceAccounts(db, list(req)));
  app.post('/service-accounts', { preHandler: app.can('service.manage') }, async (req) => services.createServiceAccount(c(req), ServiceAccountInput.parse(req.body)));
  app.get('/service-accounts/:id', { preHandler: app.can('service.view') }, async (req) => services.getServiceAccount(db, idParam(req)));
  app.patch('/service-accounts/:id', { preHandler: app.can('service.manage') }, async (req) => services.updateServiceAccount(c(req), idParam(req), ServiceAccountUpdateInput.parse(req.body)));
  app.get('/service-accounts/:id/events', { preHandler: app.can('service.view') }, async (req) => services.listServiceEvents(db, { serviceAccountId: idParam(req) }));
  app.post('/service-accounts/:id/suspend', { preHandler: app.can('service.suspend') }, async (req) => services.suspendServiceAccount(c(req), idParam(req), SuspendInput.parse(req.body)));
  app.post('/service-accounts/:id/reconnection', { preHandler: app.can('service.suspend') }, async (req) => services.requestReconnection(c(req), idParam(req), ReconnectionRequestInput.parse(req.body)));
  app.post('/service-accounts/:id/terminate', { preHandler: app.can('service.manage') }, async (req) => services.terminateServiceAccount(c(req), idParam(req), TerminateInput.parse(req.body)));
  app.get('/suspensions', { preHandler: app.can('service.view') }, async (req) => services.listSuspensions(db, list(req)));
  app.get('/reconnections', { preHandler: app.can('service.view') }, async (req) => services.listReconnections(db, list(req)));
  app.post('/reconnections/:id/complete', { preHandler: app.can('service.reconnect') }, async (req) => services.completeReconnection(c(req), idParam(req), ReconnectionCompleteInput.parse(req.body)));

  // ------------------------------------------------------------ billing & invoices
  app.get('/billing/current', { preHandler: app.can('billing.view') }, async (req) => {
    const { period } = z.object({ period: zPeriod.optional() }).parse(req.query);
    return billing.currentBilling(db, period);
  });
  app.get('/billing/cycles', { preHandler: app.can('billing.view') }, async () => billing.listCycles(db));
  app.get('/billing/preview', { preHandler: app.can('billing.generate') }, async (req) => billing.previewBilling(db, z.object({ period: zPeriod }).parse(req.query).period));
  app.post('/billing/generate', { preHandler: app.can('billing.generate') }, async (req) => billing.generateBilling(c(req), BillingGenerateInput.parse(req.body)));
  app.post('/billing/finalize-drafts', { preHandler: app.can('billing.generate') }, async (req) => billing.finalizeDrafts(c(req), FinalizeDraftsInput.parse(req.body).period));
  app.post('/billing/discard-drafts', { preHandler: app.can('billing.generate') }, async (req) => billing.discardDrafts(c(req), FinalizeDraftsInput.parse(req.body).period));
  app.get('/invoices', { preHandler: app.can('billing.view') }, async (req) => billing.listInvoices(db, list(req)));
  app.get('/invoices/:id', { preHandler: app.can('billing.view') }, async (req) => billing.getInvoice(db, idParam(req)));
  app.post('/invoices/:id/void', { preHandler: app.can('invoice.void') }, async (req) => billing.voidInvoice(c(req), idParam(req), InvoiceVoidInput.parse(req.body).reason));
  app.get('/adjustments', { preHandler: app.can('billing.view') }, async (req) => billing.listAdjustments(db, list(req)));
  app.post('/adjustments', { preHandler: app.can('adjustment.create') }, async (req) => billing.createAdjustment(c(req), AdjustmentInput.parse(req.body)));

  // ------------------------------------------------------------ payments & receipts
  app.get('/payments', { preHandler: app.can('payment.view') }, async (req) => payments.listPayments(db, list(req)));
  app.get('/payments/:id', { preHandler: app.can('payment.view') }, async (req) => payments.getPayment(db, idParam(req)));
  app.post('/payments/preview', { preHandler: app.can('payment.create') }, async (req) => payments.previewAllocation(c(req), PaymentPreviewInput.parse(req.body)));
  app.post('/payments', { preHandler: app.can('payment.create'), bodyLimit: UPLOAD_LIMIT }, async (req) => payments.postPayment(c(req), PaymentInput.parse(req.body)));
  app.post('/payments/:id/reverse', { preHandler: app.can('payment.reverse') }, async (req) => payments.reversePayment(c(req), idParam(req), PaymentReverseInput.parse(req.body).reason));
  app.post('/payments/:id/printed', { preHandler: app.can('payment.view') }, async (req) => {
    await payments.markReceiptPrinted(c(req), idParam(req));
    return { ok: true };
  });

  // ------------------------------------------------------------ GCash verification
  app.get('/gcash/proofs', { preHandler: app.can('gcash.submit', 'gcash.verify', 'payment.view') }, async (req) => gcash.listProofs(db, list(req)));
  app.get('/gcash/proofs/:id', { preHandler: app.can('gcash.submit', 'gcash.verify', 'payment.view') }, async (req) => gcash.getProof(db, idParam(req)));
  app.get('/gcash/proofs/:id/file', { preHandler: app.can('gcash.submit', 'gcash.verify', 'payment.view') }, async (req, reply) => {
    const file = await gcash.readProofFile(db, idParam(req));
    return sendFile(reply, { data: file.data, contentType: file.mimeType, fileName: file.fileName }, true);
  });
  app.get('/gcash/check-reference', { preHandler: app.can('gcash.submit', 'gcash.verify') }, async (req) => {
    const { referenceNo } = z.object({ referenceNo: z.string().trim().min(1).max(80) }).parse(req.query);
    return gcash.findDuplicates(db, referenceNo);
  });
  app.post('/gcash/proofs', { preHandler: app.can('gcash.submit'), bodyLimit: UPLOAD_LIMIT }, async (req) => gcash.submitProof(c(req), GcashSubmissionInput.parse(req.body)));
  app.post('/gcash/proofs/:id/verify', { preHandler: app.can('gcash.verify') }, async (req) => gcash.verifyProof(c(req), idParam(req), GcashVerifyInput.parse(req.body ?? {}).notes));
  app.post('/gcash/proofs/:id/reject', { preHandler: app.can('gcash.verify') }, async (req) => gcash.rejectProof(c(req), idParam(req), GcashRejectInput.parse(req.body).reason));

  // ------------------------------------------------------------ collections
  app.get('/areas', { preHandler: app.can('collection.view') }, async () => master.listAreas(db));
  app.post('/areas', { preHandler: app.can('collection.manage') }, async (req) => master.saveArea(c(req), null, AreaInput.parse(req.body)));
  app.patch('/areas/:id', { preHandler: app.can('collection.manage') }, async (req) => master.saveArea(c(req), idParam(req), AreaInput.parse(req.body)));
  app.get('/collectors', { preHandler: app.can('collection.view') }, async () => master.listCollectors(db));
  app.post('/collectors', { preHandler: app.can('collection.manage') }, async (req) => master.saveCollector(c(req), null, CollectorInput.parse(req.body)));
  app.patch('/collectors/:id', { preHandler: app.can('collection.manage') }, async (req) => master.saveCollector(c(req), idParam(req), CollectorInput.parse(req.body)));
  app.get('/collections/route-sheet', { preHandler: app.can('collection.view') }, async (req) => {
    const q = z.object({ areaId: z.coerce.number().int().positive(), collectorId: z.coerce.number().int().positive(), asOf: zDate.optional() }).parse(req.query);
    return collections.getRouteSheet(db, q.areaId, q.collectorId, q.asOf);
  });
  app.get('/batches', { preHandler: app.can('collection.view') }, async (req) => collections.listBatches(db, list(req)));
  app.post('/batches', { preHandler: app.can('collection.manage') }, async (req) => collections.createBatch(c(req), BatchCreateInput.parse(req.body)));
  app.get('/batches/:id', { preHandler: app.can('collection.view') }, async (req) => collections.getBatch(db, idParam(req)));
  app.post('/batches/:id/start', { preHandler: app.can('collection.manage', 'collection.record') }, async (req) => collections.startBatch(c(req), idParam(req)));
  app.post('/batches/:id/collections', { preHandler: app.can('collection.record') }, async (req) => collections.recordCollection(c(req), idParam(req), BatchCollectInput.parse(req.body)));
  app.post('/batches/:id/outcomes', { preHandler: app.can('collection.record') }, async (req) => collections.recordOutcome(c(req), idParam(req), BatchOutcomeInput.parse(req.body)));
  app.post('/batches/:id/submit', { preHandler: app.can('collection.record') }, async (req) => collections.submitBatch(c(req), idParam(req)));
  app.post('/batches/:id/remittances', { preHandler: app.can('collection.remit') }, async (req) => collections.addRemittance(c(req), idParam(req), RemittanceInput.parse(req.body)));
  app.post('/batches/:id/reconcile', { preHandler: app.can('collection.reconcile') }, async (req) => collections.reconcileBatch(c(req), idParam(req), ReconcileInput.parse(req.body ?? {}).varianceReason));
  app.post('/batches/:id/close', { preHandler: app.can('collection.close') }, async (req) => collections.closeBatch(c(req), idParam(req), CloseBatchInput.parse(req.body).notes));

  // ------------------------------------------------------------ receivables
  app.get('/receivables/summary', { preHandler: app.can('receivable.view') }, async () => receivables.getReceivableSummary(db));
  app.get('/receivables/outstanding', { preHandler: app.can('receivable.view') }, async (req) => receivables.listOutstanding(db, list(req)));
  app.get('/receivables/overdue', { preHandler: app.can('receivable.view') }, async (req) => receivables.listOverdue(db, list(req)));
  app.get('/receivables/aging', { preHandler: app.can('receivable.view') }, async (req) => receivables.getAging(db, list(req)));
  app.get('/receivables/suspension-candidates', { preHandler: app.can('receivable.view', 'service.view') }, async (req) => receivables.listSuspensionCandidates(db, list(req)));

  // ------------------------------------------------------------ reports
  app.get('/reports', { preHandler: app.can('report.view') }, async () => reports.listReports());
  app.get('/reports/:key', { preHandler: app.can('report.view') }, async (req, reply) => {
    const query = ReportQuery.parse(req.query);
    const key = (req.params as { key: string }).key;
    if (query.format === 'json') return reports.buildReport(c(req), key, query);
    return sendFile(reply, await reports.exportReport(c(req), key, query));
  });

  // ------------------------------------------------------------ administration
  app.get('/settings', { preHandler: app.authenticated() }, async () => getSettings(db));
  app.put('/settings', { preHandler: app.can('settings.manage') }, async (req) => updateSettings(c(req), SettingsUpdateInput.parse(req.body).values));
  app.get('/audit-logs', { preHandler: app.can('audit.view') }, async (req) => {
    const extra = z.object({ action: z.string().max(60).optional(), entityType: z.string().max(40).optional(), actor: z.string().max(40).optional() }).parse(req.query);
    return admin.listAuditLogs(db, { ...list(req), ...extra });
  });
  app.get('/integrity-check', { preHandler: app.can('audit.view', 'backup.create') }, async () => runIntegrityCheck(db));
  app.get('/backups', { preHandler: app.can('backup.create', 'backup.restore') }, async () => backup.listBackups(db));
  app.post('/backups', { preHandler: app.can('backup.create') }, async (req) => backup.createBackup(c(req), BackupCreateInput.parse(req.body ?? {}).notes));
  app.post('/backups/:id/verify', { preHandler: app.can('backup.create') }, async (req) => backup.verifyBackup(c(req), idParam(req)));
  app.post('/backups/:id/restore', { preHandler: app.can('backup.restore') }, async (req) => {
    const input = BackupRestoreInput.parse(req.body);
    return backup.restoreBackup(c(req), idParam(req), input.reason, sessionOf(req).sessionId);
  });
}
