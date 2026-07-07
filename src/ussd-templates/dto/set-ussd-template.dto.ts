import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { NETWORK_CODES, TRANSACTION_TYPES } from '../../commissions/dto/update-commission-rates.dto';
import { UssdTemplateStepDto } from './ussd-template-step.dto';

export class SetUssdTemplateDto {
  @IsString()
  @IsIn(NETWORK_CODES)
  network: string;

  @IsString()
  @IsIn(TRANSACTION_TYPES)
  transactionType: string;

  @IsString()
  ussdCode: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UssdTemplateStepDto)
  steps: UssdTemplateStepDto[];

  @IsArray()
  @IsString({ each: true })
  successPatterns: string[];

  @IsArray()
  @IsString({ each: true })
  failurePatterns: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pinPromptPatterns?: string[];

  @IsOptional()
  @IsInt()
  @Min(1000)
  stepTimeoutMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  maxRetries?: number;
}
