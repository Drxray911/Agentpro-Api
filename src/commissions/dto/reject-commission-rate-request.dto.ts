import { IsNotEmpty, IsString } from 'class-validator';

export class RejectCommissionRateRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'A rejection reason is required' })
  reason: string;
}
