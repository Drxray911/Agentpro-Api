import { IsEmail, IsOptional, IsString, Matches, MinLength, IsNotEmpty } from 'class-validator';

export class RegisterOwnerDto {
  @IsString()
  @IsNotEmpty()
  businessName: string;

  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @IsString()
  @Matches(/^0\d{9}$/, { message: 'Phone must be a 10-digit Ghanaian number starting with 0 (e.g. 0244123456)' })
  phone: string;

  // Ghana Card number or CAC/business registration number — either is
  // accepted per spec ("Ghana Card or business registration number").
  @IsOptional()
  @IsString()
  businessRegNumber?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}
