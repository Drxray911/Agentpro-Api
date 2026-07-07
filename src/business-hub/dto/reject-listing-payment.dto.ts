import { IsNotEmpty, IsString } from 'class-validator';

export class RejectListingPaymentDto {
  @IsString()
  @IsNotEmpty({ message: 'A rejection reason is required' })
  reason: string;
}
