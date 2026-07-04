import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { PinLoginDto } from './dto/pin-login.dto';
import { RegisterOwnerDto } from './dto/register-owner.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private registrationService: RegistrationService,
  ) {}

  @Post('pin-login')
  async pinLogin(@Body() dto: PinLoginDto) {
    return this.authService.pinLogin(dto);
  }

  @Post('register')
  async register(@Body() dto: RegisterOwnerDto) {
    return this.registrationService.registerOwner(dto);
  }
}
