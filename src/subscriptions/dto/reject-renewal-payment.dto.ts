import { IsNotEmpty, IsString } from 'class-validator';

export class RejectRenewalPaymentDto {
  @IsString()
  @IsNotEmpty({ message: 'A rejection reason is required' })
  reason: string;
}
