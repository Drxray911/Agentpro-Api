import { IsIn, IsOptional, IsString } from 'class-validator';

export const USSD_STEP_INPUT_TYPES = ['menu_option', 'amount', 'phone', 'literal', 'pin_wait'];

export class UssdTemplateStepDto {
  @IsString()
  @IsIn(USSD_STEP_INPUT_TYPES)
  inputType: string;

  // Required for menu_option/literal (a fixed value to send, e.g. "1").
  // Absent for amount/phone (resolved by the app from the transaction
  // being performed) and for pin_wait (no input at all).
  @IsOptional()
  @IsString()
  value?: string;

  @IsOptional()
  @IsString()
  placeholder?: string;
}
