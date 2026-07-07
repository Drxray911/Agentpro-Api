import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UssdTemplatesController } from './ussd-templates.controller';
import { UssdTemplatesService } from './ussd-templates.service';

@Module({
  imports: [AuthModule],
  controllers: [UssdTemplatesController],
  providers: [UssdTemplatesService],
})
export class UssdTemplatesModule {}
