import type { VarianceType } from '../enums';
import { assertCentavos, type Centavos } from '../money';

export interface RemittanceVariance {
  /** remitted - collected. Negative means the collector turned in less cash than was collected. */
  difference: Centavos;
  type: VarianceType;
  /** Absolute size of the shortage or overage. */
  amount: Centavos;
}

/**
 * Only cash is physically remitted. GCash and other non-cash collections are
 * reported on the batch but never count toward the cash that must be turned in.
 */
export function computeRemittanceVariance(cashCollected: Centavos, cashRemitted: Centavos): RemittanceVariance {
  assertCentavos(cashCollected, 'cash collected');
  assertCentavos(cashRemitted, 'cash remitted');
  const difference = cashRemitted - cashCollected;
  const type: VarianceType = difference === 0 ? 'BALANCED' : difference < 0 ? 'SHORTAGE' : 'OVERAGE';
  return { difference, type, amount: Math.abs(difference) };
}
