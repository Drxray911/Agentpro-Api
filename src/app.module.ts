import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { BusinessHubModule } from './business-hub/business-hub.module';
import { UssdTemplatesModule } from './ussd-templates/ussd-templates.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { TransactionsModule } from './transactions/transactions.module';
import { FloatModule } from './float/float.module';
import { CustomersModule } from './customers/customers.module';
import { CommissionsModule } from './commissions/commissions.module';
import { SupportModule } from './support/support.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    AdminModule,
    SubscriptionsModule,
    BusinessHubModule,
    UssdTemplatesModule,
    DashboardModule,
    TransactionsModule,
    FloatModule,
    CustomersModule,
    CommissionsModule,
    SupportModule,
    SyncModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
