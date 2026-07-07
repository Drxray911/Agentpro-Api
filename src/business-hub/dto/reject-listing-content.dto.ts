import { IsNotEmpty, IsString } from 'class-validator';

export class RejectListingContentDto {
  @IsString()
  @IsNotEmpty({ message: 'A rejection reason is required' })
  reason: string;
}
