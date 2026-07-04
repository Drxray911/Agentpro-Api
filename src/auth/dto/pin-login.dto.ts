import { IsString, Matches, IsNotEmpty } from 'class-validator';

export class PinLoginDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin: string;

  @IsString()
  @IsNotEmpty()
  deviceId: string;
}
