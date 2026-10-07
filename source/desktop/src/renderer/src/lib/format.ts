import { formatDate, formatMoney, periodLabel } from '@bcis/shared';

export const peso = (centavos: number | null | undefined): string => (centavos === null || centavos === undefined ? '' : formatMoney(centavos, { symbol: true }));
export const money = (centavos: number | null | undefined): string => (centavos === null || centavos === undefined ? '' : formatMoney(centavos));
export const date = (value: string | null | undefined): string => (value ? formatDate(value) : '—');
export const period = (value: string | null | undefined): string => (value ? periodLabel(value) : '—');

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Compact peso figure for KPI tiles: ₱1.23M, ₱45.6K, ₱999.00. */
export function compactPeso(centavos: number): string {
  const pesos = centavos / 100;
  const abs = Math.abs(pesos);
  if (abs >= 1_000_000) return `₱${(pesos / 1_000_000).toFixed(2)}M`;
  if (abs >= 100_000) return `₱${(pesos / 1000).toFixed(1)}K`;
  return peso(centavos);
}

export const todayIso = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
export const count = (n: number): string => n.toLocaleString('en-US');
