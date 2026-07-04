import { IsString, IsIn, IsNotEmpty, IsOptional, IsNumberString, IsUUID } from 'class-validator';

const TRANSACTION_TYPES = [
  'cash_in',
  'cash_out',
  'airtime',
  'data_bundle',
  'send_money',
  'bill_payment',
  'merchant_payment',
];

const NETWORK_CODES = ['MTN', 'TELECEL', 'AT'];

export class CreateTransactionDto {
  @IsString()
  @IsIn(TRANSACTION_TYPES)
  type: string;

  @IsString()
  @IsIn(NETWORK_CODES)
  network: string;

  @IsNumberString()
  amount: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsUUID()
  @IsNotEmpty()
  clientGeneratedId: string;
}
