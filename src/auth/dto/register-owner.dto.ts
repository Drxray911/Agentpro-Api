import { IsString, Matches, IsNotEmpty } from 'class-validator';

export class RegisterOwnerDto {
  @IsString()
  @IsNotEmpty()
  businessName: string;

  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @Matches(/^0\d{9}$/, { message: 'Phone must be a 10-digit Ghanaian number starting with 0 (e.g. 0244123456)' })
  phone: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin: string;

  @IsString()
  @IsNotEmpty()
  deviceId: string;
}
