import { IsArray, IsOptional } from 'class-validator';

// Deliberately NOT using @ValidateNested() + @Type() here, even though
// that's the normal NestJS pattern (and what CommissionRateUpdateItem
// uses elsewhere). Confirmed directly by testing: NestJS's global
// ValidationPipe rejects the ENTIRE request with a 400 the instant any
// nested item fails validation, before the controller method even
// runs — which makes it impossible to ever produce the per-item
// `failed: []` array openapi.yaml documents for this endpoint. Each
// item here is validated manually inside SyncService instead, so one
// malformed item becomes one entry in `failed`, not a whole-batch
// rejection that silently drops every valid item alongside it.
export class SyncBatchDto {
  @IsOptional()
  @IsArray()
  transactions?: Record<string, any>[];

  @IsOptional()
  @IsArray()
  floatMovements?: Record<string, any>[];
}
