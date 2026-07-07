import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitListingPaymentDto {
  @IsString()
  @IsNotEmpty({ message: 'A payment reference is required' })
  paymentReference: string;
}
