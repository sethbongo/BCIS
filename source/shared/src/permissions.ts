/** Granular permissions. The server checks these on every protected route. */
export const PERMISSIONS = {
  'dashboard.view': 'View the management dashboard',
  'subscriber.view': 'Search and view subscribers',
  'subscriber.create': 'Register new subscribers',
  'subscriber.update': 'Edit subscriber details and status',
  'plan.view': 'View service plans',
  'plan.manage': 'Create and edit service plans',
  'service.view': 'View service accounts and service history',
  'service.manage': 'Create and edit service accounts',
  'service.suspend': 'Suspend service accounts and request reconnection',
  'service.reconnect': 'Complete reconnection work',
  'billing.view': 'View invoices and subscriber ledgers',
  'billing.generate': 'Generate and finalize monthly billing',
  'invoice.void': 'Void finalized invoices',
  'adjustment.create': 'Post debit and credit adjustments',
  'payment.view': 'View payments and receipts',
  'payment.create': 'Receive payments and issue receipts',
  'payment.allocate_manual': 'Override oldest-first allocation',
  'payment.reverse': 'Reverse posted payments',
  'gcash.submit': 'Record GCash payment proofs',
  'gcash.verify': 'Verify or reject GCash payment proofs',
  'collection.view': 'View collectors, areas and collection batches',
  'collection.manage': 'Manage collectors, areas, assignments and batches',
  'collection.record': 'Record house-to-house collections',
  'collection.remit': 'Record collector cash remittances',
  'collection.reconcile': 'Reconcile collection batches',
  'collection.close': 'Close reconciled collection batches',
  'receivable.view': 'View outstanding, overdue and aging receivables',
  'report.view': 'View reports',
  'report.export': 'Export reports to PDF, XLSX and CSV',
  'audit.view': 'View audit trail and user activity',
  'user.manage': 'Manage users and role assignments',
  'settings.manage': 'Change application settings',
  'backup.create': 'Create and verify backups',
  'backup.restore': 'Restore the database from a backup',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export interface RoleDefinition {
  code: RoleCode;
  name: string;
  description: string;
  permissions: readonly Permission[];
}

export const ROLE_CODES = ['OWNER', 'ADMIN', 'CASHIER', 'COLLECTION_SUPERVISOR', 'ACCOUNTING', 'TECHNICIAN', 'VIEWER'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

const READ_ONLY: Permission[] = [
  'dashboard.view',
  'subscriber.view',
  'plan.view',
  'service.view',
  'billing.view',
  'payment.view',
  'collection.view',
  'receivable.view',
  'report.view',
];

export const ROLES: readonly RoleDefinition[] = [
  {
    code: 'OWNER',
    name: 'Owner / Super Admin',
    description: 'Full access: dashboards, reports, approvals, configuration, users, audit, backup and restore.',
    permissions: ALL_PERMISSIONS,
  },
  {
    code: 'ADMIN',
    name: 'Administrator',
    description: 'Subscribers, plans, service accounts, billing, collections and operational reports.',
    permissions: [
      ...READ_ONLY,
      'subscriber.create',
      'subscriber.update',
      'plan.manage',
      'service.manage',
      'service.suspend',
      'service.reconnect',
      'billing.generate',
      'invoice.void',
      'adjustment.create',
      'payment.create',
      'payment.allocate_manual',
      'payment.reverse',
      'gcash.submit',
      'gcash.verify',
      'collection.manage',
      'collection.record',
      'collection.remit',
      'collection.reconcile',
      'collection.close',
      'report.export',
      'audit.view',
    ],
  },
  {
    code: 'CASHIER',
    name: 'Cashier',
    description: 'Subscriber search, receive payment, issue receipt, view balances and record GCash proofs.',
    permissions: ['subscriber.view', 'service.view', 'billing.view', 'payment.view', 'payment.create', 'gcash.submit', 'receivable.view'],
  },
  {
    code: 'COLLECTION_SUPERVISOR',
    name: 'Collection Supervisor',
    description: 'Collection areas and routes, batches, remittance, reconciliation and collector performance.',
    permissions: [
      'dashboard.view',
      'subscriber.view',
      'service.view',
      'billing.view',
      'payment.view',
      'collection.view',
      'collection.manage',
      'collection.record',
      'collection.remit',
      'collection.reconcile',
      'receivable.view',
      'report.view',
      'report.export',
    ],
  },
  {
    code: 'ACCOUNTING',
    name: 'Accounting / Auditor',
    description: 'Reports, review of adjustments and reversals, receivables and audit trails.',
    permissions: [...READ_ONLY, 'report.export', 'audit.view'],
  },
  {
    code: 'TECHNICIAN',
    name: 'Technician',
    description: 'Service account, suspension and reconnection operational information only.',
    permissions: ['service.view', 'service.reconnect'],
  },
  {
    code: 'VIEWER',
    name: 'Read-only Viewer',
    description: 'Dashboards and reports without mutation rights.',
    permissions: [...READ_ONLY, 'report.export'],
  },
];

export function permissionsForRoles(roleCodes: readonly string[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of ROLES) {
    if (roleCodes.includes(role.code)) role.permissions.forEach((p) => set.add(p));
  }
  return [...set];
}
