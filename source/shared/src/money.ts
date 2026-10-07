/**
 * All authoritative money values are integer centavos (PHP 999.00 === 99900).
 * No floating-point arithmetic is used for money anywhere in the system.
 */
export type Centavos = number;

export function isCentavos(value: unknown): value is Centavos {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertCentavos(value: unknown, label = 'amount'): asserts value is Centavos {
  if (!isCentavos(value)) throw new RangeError(`${label} must be a whole number of centavos`);
}

/**
 * Parses user input such as "999", "999.5", "1,234.50" or "₱ 1,234.50" into centavos
 * using string arithmetic only. Returns null when the text is not a valid amount.
 */
export function parseMoney(input: string): Centavos | null {
  const cleaned = input.replace(/[₱,\s]/g, '').replace(/^PHP/i, '');
  const match = /^(-)?(\d{1,13})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const pesos = Number(match[2]);
  const cents = Number((match[3] ?? '').padEnd(2, '0'));
  const value = pesos * 100 + cents;
  return match[1] ? -value : value;
}

/** Formats centavos as "1,234.50" (or "₱1,234.50" with symbol). Negative values use a leading minus. */
export function formatMoney(value: Centavos, options: { symbol?: boolean } = {}): string {
  assertCentavos(value);
  const negative = value < 0;
  const abs = Math.abs(value);
  const pesos = Math.trunc(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = (abs % 100).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${options.symbol ? '₱' : ''}${pesos}.${cents}`;
}

/** Plain decimal string for inputs and spreadsheets: 99900 -> "999.00". */
export function centavosToDecimalString(value: Centavos): string {
  return formatMoney(value).replace(/,/g, '');
}

export function sumCentavos(values: readonly Centavos[]): Centavos {
  let total = 0;
  for (const v of values) {
    assertCentavos(v);
    total += v;
  }
  return total;
}
