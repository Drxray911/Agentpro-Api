import { IsString, IsIn, IsOptional, IsUUID, IsNotEmpty } from 'class-validator';

const CATEGORIES = [
  'failed_transaction',
  'wrong_amount',
  'float_discrepancy',
  'airtime_failure',
  'data_bundle_failure',
  'system_error',
  'other',
];

export class CreateTicketDto {
  @IsString()
  @IsIn(CATEGORIES)
  category: string;

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  relatedTransactionId?: string;
}

export class AddMessageDto {
  @IsString()
  @IsNotEmpty()
  message: string;
}
