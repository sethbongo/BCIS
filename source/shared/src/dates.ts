/** Business dates are plain calendar dates ("YYYY-MM-DD"); billing periods are "YYYY-MM". */
export type ISODate = string;
export type BillingPeriod = string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isISODate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isBillingPeriod(value: string): boolean {
  return PERIOD_RE.test(value);
}

function toUTC(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Calendar date in the business timezone (the server may run in UTC). */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromUTC(toUTC(date) + days * 86_400_000);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: ISODate, to: ISODate): number {
  return Math.round((toUTC(to) - toUTC(from)) / 86_400_000);
}

export function periodOf(date: ISODate): BillingPeriod {
  return date.slice(0, 7);
}

export function addMonths(period: BillingPeriod, months: number): BillingPeriod {
  const [y, m] = period.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function daysInPeriod(period: BillingPeriod): number {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function periodBounds(period: BillingPeriod): { start: ISODate; end: ISODate } {
  return { start: `${period}-01`, end: `${period}-${String(daysInPeriod(period)).padStart(2, '0')}` };
}

/** Due date inside the billing period; days beyond month end clamp to the last day. */
export function dueDateFor(period: BillingPeriod, dueDay: number): ISODate {
  const day = Math.min(Math.max(1, dueDay), daysInPeriod(period));
  return `${period}-${String(day).padStart(2, '0')}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function periodLabel(period: BillingPeriod): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatDate(date: ISODate | null | undefined): string {
  if (!date) return '';
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`;
}
