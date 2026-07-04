import { IsString, IsIn, IsOptional, IsNumberString, IsUUID, IsNotEmpty } from 'class-validator';

const MOVEMENT_TYPES = ['purchase', 'transfer', 'adjustment'];
const NETWORK_CODES = ['MTN', 'TELECEL', 'AT'];

export class CreateFloatMovementDto {
  @IsString()
  @IsIn(MOVEMENT_TYPES)
  movementType: string;

  @IsString()
  @IsIn(NETWORK_CODES)
  network: string;

  @IsOptional()
  @IsString()
  @IsIn(NETWORK_CODES)
  toNetwork?: string;

  // Confirmed directly against the validator.js isNumeric() function
  // that class-validator's @IsNumberString() wraps: it accepts a
  // leading minus sign by default, so negative adjustment amounts
  // (e.g. "-50.00") pass validation correctly without extra config.
  @IsNumberString()
  amount: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsUUID()
  @IsNotEmpty()
  clientGeneratedId: string;
}
