import { Type } from 'class-transformer';
import { IsString, IsIn, IsNumber, Min } from 'class-validator';

const NETWORK_CODES = ['MTN', 'TELECEL', 'AT'];
const TRANSACTION_TYPES = ['cash_in', 'cash_out', 'airtime', 'data_bundle', 'send_money', 'bill_payment', 'merchant_payment'];

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
}
