import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { SyncService } from './sync.service';
import { SyncBatchDto } from './dto/sync-batch.dto';

function authContext(req: AuthenticatedRequest) {
  return {
    userId: req.auth.userId,
    organizationId: req.auth.organizationId,
    branchId: req.auth.branchId,
    role: req.auth.role,
  };
}

@Controller('sync')
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(private syncService: SyncService) {}

  @Post('batch')
  async processBatch(@Req() req: AuthenticatedRequest, @Body() dto: SyncBatchDto) {
    return this.syncService.processBatch(authContext(req), dto);
  }
}
