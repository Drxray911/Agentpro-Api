import { IsNotEmpty, IsString } from 'class-validator';

export class ApproveOrganizationDto {
  @IsString()
  @IsNotEmpty({ message: 'A payment reference is required to approve a registration' })
  paymentReference: string;
}
