import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('summary')
  async getSummary(@Req() req: AuthenticatedRequest) {
    return this.dashboardService.getSummary({
      userId: req.auth.userId,
      organizationId: req.auth.organizationId,
      branchId: req.auth.branchId,
      role: req.auth.role,
    });
  }
}
