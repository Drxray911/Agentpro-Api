import { IsString, IsIn, IsNumber, Min, IsOptional, Max } from 'class-validator';

export const NETWORK_CODES = ['MTN', 'TELECEL', 'AT'];
export const TRANSACTION_TYPES = [
  'cash_in',
  'cash_out',
  'airtime',
  'data_bundle',
  'send_money',
  'bill_payment',
  'merchant_payment',
];

// openapi.yaml defines the PUT /commission-rates request body as a
// bare JSON array, not an object wrapping an array — this DTO
// represents one element of that array. NestJS validates array
// bodies by applying ValidationPipe to each element when the
// controller parameter type is declared as CommissionRateUpdateItem[]
// (see commissions.controller.ts), so no top-level wrapper class is
// needed or correct here.
export class CommissionRateUpdateItem {
  @IsString()
  @IsIn(NETWORK_CODES)
  network: string;

  @IsString()
  @IsIn(TRANSACTION_TYPES)
  transactionType: string;

  // As a percentage, e.g. 0.33 means 0.33% — matches openapi.yaml and
  // the prototype's commission settings screen, which also displays
  // and edits rates as a percentage rather than a raw decimal.
  @IsNumber()
  @Min(0)
  ratePercent: number;

  // Tiering (spec section 8): below thresholdAmount, ratePercent
  // applies normally; at or above it, capAmount (a flat GHS amount)
  // applies instead. Both optional — omitting either means "no cap
  // tier for this rate", not "cap at zero".
  @IsOptional()
  @IsNumber()
  @Min(0)
  thresholdAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capAmount?: number;

  // As a percentage of the gross commission (e.g. 5 means the
  // provider takes 5% of the commission earned), matching the
  // percentage convention ratePercent already uses at this API layer.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  providerSharePercent?: number;
}
