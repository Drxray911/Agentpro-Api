import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { FloatModule } from '../float/float.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [AuthModule, TransactionsModule, FloatModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
