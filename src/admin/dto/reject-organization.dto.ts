import { IsNotEmpty, IsString } from 'class-validator';

export class RejectOrganizationDto {
  @IsString()
  @IsNotEmpty({ message: 'A rejection reason is required' })
  reason: string;
}
