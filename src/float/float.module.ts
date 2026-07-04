import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FloatController } from './float.controller';
import { FloatService } from './float.service';

@Module({
  imports: [AuthModule],
  controllers: [FloatController],
  providers: [FloatService],
  exports: [FloatService],
})
export class FloatModule {}
