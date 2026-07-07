import { IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CommissionRateUpdateItem } from './update-commission-rates.dto';

/**
 * Used by PUT /commission-rates, now Superuser-only. A Superuser has
 * no organizationId/branchId of their own in their JWT (they aren't a
 * member of any business), so — unlike the original version of this
 * endpoint, which implicitly used the caller's own auth.branchId —
 * the target must be named explicitly in the body.
 *
 * If branchId is omitted, the rate is applied to every branch in
 * organizationId (the common case: a Business Owner's whole business
 * runs one rate, matching the org-wide default in RegistrationService).
 */
export class SetCommissionRatesDto {
  @IsUUID()
  organizationId: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommissionRateUpdateItem)
  items: CommissionRateUpdateItem[];
}
