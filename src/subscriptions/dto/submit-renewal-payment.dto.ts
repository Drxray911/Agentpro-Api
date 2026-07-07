import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitRenewalPaymentDto {
  @IsString()
  @IsNotEmpty({ message: 'A payment reference is required' })
  paymentReference: string;
}
