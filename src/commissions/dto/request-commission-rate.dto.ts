import { IsString, IsIn, IsNumber, Min, IsOptional, Max } from 'class-validator';
import { NETWORK_CODES, TRANSACTION_TYPES } from './update-commission-rates.dto';

export class RequestCommissionRateDto {
  @IsString()
  @IsIn(NETWORK_CODES)
  network: string;

  @IsString()
  @IsIn(TRANSACTION_TYPES)
  transactionType: string;

  @IsNumber()
  @Min(0)
  ratePercent: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  thresholdAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  providerSharePercent?: number;
}
