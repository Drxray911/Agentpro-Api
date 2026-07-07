import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdatePlatformSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  subscriptionPriceGhs?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  gracePeriodDays?: number;
}
