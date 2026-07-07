/**
 * Core commission math (spec section 8). Deliberately NOT
 * marginal/bracket-based — this is the simpler two-state model the
 * spec describes with its own example:
 *   "2% on transactions up to GHS 1,000; capped at GHS 20 above
 *    threshold."
 * i.e. amount <= threshold -> ratePercent * amount
 *      amount >  threshold -> a flat capAmount (not ratePercent
 *                             applied only to the excess)
 *
 * ratePercent and providerSharePercent are both decimals here (0.02 =
 * 2%), matching how rate_percent is stored in commission_rates —
 * callers translating from a user-facing percentage (e.g. an API
 * request body using "2" to mean 2%) must divide by 100 before
 * calling this, the same convention CommissionsService already uses
 * for rate_percent.
 */
export interface CommissionInputs {
  amount: number;
  ratePercent: number;
  thresholdAmount: number | null;
  capAmount: number | null;
  providerSharePercent: number;
}

export interface CommissionResult {
  grossCommission: number;
  providerCommission: number;
  netCommission: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeCommission(inputs: CommissionInputs): CommissionResult {
  const { amount, ratePercent, thresholdAmount, capAmount, providerSharePercent } = inputs;

  let grossCommission: number;
  if (thresholdAmount !== null && capAmount !== null && amount > thresholdAmount) {
    grossCommission = capAmount;
  } else {
    grossCommission = amount * ratePercent;
  }
  grossCommission = round2(grossCommission);

  const providerCommission = round2(grossCommission * providerSharePercent);
  const netCommission = round2(grossCommission - providerCommission);

  return { grossCommission, providerCommission, netCommission };
}
