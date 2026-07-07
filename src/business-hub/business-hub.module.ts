import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessHubController } from './business-hub.controller';
import { BusinessHubService } from './business-hub.service';

@Module({
  imports: [AuthModule],
  controllers: [BusinessHubController],
  providers: [BusinessHubService],
})
export class BusinessHubModule {}
