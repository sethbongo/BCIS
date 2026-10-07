/** Application settings stored in application_settings. Defaults apply until an Owner changes them. */
export interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  type: 'text' | 'int' | 'money' | 'boolean';
  group: string;
  default: string | number | boolean;
  min?: number;
  max?: number;
}

export const SETTING_DEFS = [
  { key: 'company.name', group: 'Company', label: 'Company name', description: 'Printed on receipts, statements and reports.', type: 'text', default: 'Bukidnon Cable and Internet Services' },
  { key: 'company.address', group: 'Company', label: 'Company address', description: 'Printed on receipts and statements.', type: 'text', default: 'Malaybalay City, Bukidnon' },
  { key: 'company.phone', group: 'Company', label: 'Company contact number', description: 'Printed on receipts and statements.', type: 'text', default: '(088) 000-0000' },
  { key: 'billing.autoApplyCredit', group: 'Billing', label: 'Auto-apply advance credit', description: 'Apply a subscriber\'s unapplied advance payments to newly finalized invoices.', type: 'boolean', default: true },
  { key: 'billing.penaltyEnabled', group: 'Billing', label: 'Late payment penalty', description: 'Add a penalty line to the monthly invoice when the service account has overdue invoices.', type: 'boolean', default: false },
  { key: 'billing.penaltyAmount', group: 'Billing', label: 'Penalty amount', description: 'Fixed penalty per billing run when the penalty is enabled.', type: 'money', default: 5000, min: 0, max: 10_000_00 },
  { key: 'suspension.graceDays', group: 'Service control', label: 'Grace period (days)', description: 'Days after the due date before an unpaid invoice counts toward suspension.', type: 'int', default: 15, min: 0, max: 365 },
  { key: 'suspension.thresholdMonths', group: 'Service control', label: 'Suspension threshold (unpaid months)', description: 'Unpaid invoices past the grace period needed before an account becomes a suspension candidate.', type: 'int', default: 2, min: 1, max: 24 },
  { key: 'reconnection.requireFullPayment', group: 'Service control', label: 'Reconnection requires settled arrears', description: 'A suspended account qualifies for reconnection only after all overdue invoices are paid.', type: 'boolean', default: true },
  { key: 'security.maxFailedLogins', group: 'Security', label: 'Failed logins before lockout', description: 'Consecutive wrong passwords before the account is temporarily locked.', type: 'int', default: 5, min: 3, max: 20 },
  { key: 'security.lockoutMinutes', group: 'Security', label: 'Lockout duration (minutes)', description: 'How long an account stays locked after too many failed logins.', type: 'int', default: 15, min: 1, max: 1440 },
  { key: 'security.idleLockMinutes', group: 'Security', label: 'Idle screen lock (minutes)', description: 'The desktop client locks the session after this many minutes without activity.', type: 'int', default: 10, min: 1, max: 240 },
] as const satisfies readonly SettingDefinition[];

export type SettingKey = (typeof SETTING_DEFS)[number]['key'];
export type SettingsMap = Record<SettingKey, string | number | boolean>;

export function defaultSettings(): SettingsMap {
  return Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d.default])) as SettingsMap;
}

/** Returns an error message when the value is not acceptable for the setting, otherwise null. */
export function validateSetting(def: SettingDefinition, value: unknown): string | null {
  if (def.type === 'boolean') return typeof value === 'boolean' ? null : `${def.label} must be on or off.`;
  if (def.type === 'text') return typeof value === 'string' && value.trim().length > 0 && value.length <= 200 ? null : `${def.label} is required.`;
  if (typeof value !== 'number' || !Number.isInteger(value)) return `${def.label} must be a whole number.`;
  if (def.min !== undefined && value < def.min) return `${def.label} must be at least ${def.min}.`;
  if (def.max !== undefined && value > def.max) return `${def.label} must be at most ${def.max}.`;
  return null;
}
