import { Body, Controller, Get, Param, ParseArrayPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CommissionsService } from './commissions.service';
import { CommissionRateUpdateItem } from './dto/update-commission-rates.dto';
import { SetCommissionRatesDto } from './dto/set-commission-rates.dto';
import { RequestCommissionRateDto } from './dto/request-commission-rate.dto';
import { RejectCommissionRateRequestDto } from './dto/reject-commission-rate-request.dto';

function authContext(req: AuthenticatedRequest) {
  return {
    userId: req.auth.userId,
    organizationId: req.auth.organizationId,
    branchId: req.auth.branchId,
    role: req.auth.role,
  };
}

@Controller('commission-rates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommissionsController {
  constructor(private commissionsService: CommissionsService) {}

  @Get()
  async getActiveRates(@Req() req: AuthenticatedRequest) {
    return this.commissionsService.getActiveRates(authContext(req));
  }

  // Superuser-only as of the commission-engine rework: per spec
  // section 8, a Business Owner cannot unilaterally set their own
  // commission structure — only a Superuser can set/override rates
  // directly, and a Business Owner's only path to a custom rate is
  // POST /commission-rates/requests below, which requires approval.
  @Put()
  @Roles('super_admin')
  async setRates(@Req() req: AuthenticatedRequest, @Body() dto: SetCommissionRatesDto) {
    return this.commissionsService.setRatesForOrganization(authContext(req), dto);
  }

  @Get('platform-defaults')
  @Roles('super_admin')
  async getPlatformDefaults() {
    return this.commissionsService.getPlatformDefaults();
  }

  @Put('platform-defaults')
  @Roles('super_admin')
  async setPlatformDefaults(
    @Req() req: AuthenticatedRequest,
    @Body(new ParseArrayPipe({ items: CommissionRateUpdateItem })) body: CommissionRateUpdateItem[],
  ) {
    return this.commissionsService.setPlatformDefaults(authContext(req), body);
  }

  @Post('requests')
  @Roles('business_owner')
  async submitRateRequest(@Req() req: AuthenticatedRequest, @Body() dto: RequestCommissionRateDto) {
    return this.commissionsService.submitRateRequest(authContext(req), dto);
  }

  @Get('requests/mine')
  @Roles('business_owner')
  async listMyRateRequests(@Req() req: AuthenticatedRequest) {
    return this.commissionsService.listMyRateRequests(authContext(req));
  }

  @Get('requests/pending')
  @Roles('super_admin')
  async listPendingRateRequests() {
    return this.commissionsService.listPendingRateRequests();
  }

  @Post('requests/:id/approve')
  @Roles('super_admin')
  async approveRateRequest(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.commissionsService.approveRateRequest(authContext(req), id);
  }

  @Post('requests/:id/reject')
  @Roles('super_admin')
  async rejectRateRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: RejectCommissionRateRequestDto,
  ) {
    return this.commissionsService.rejectRateRequest(authContext(req), id, dto);
  }
}
