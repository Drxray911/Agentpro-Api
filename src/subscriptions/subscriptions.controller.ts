import { Body, Controller, ForbiddenException, Get, Headers, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { SubscriptionsService } from './subscriptions.service';
import { SubmitRenewalPaymentDto } from './dto/submit-renewal-payment.dto';
import { RejectRenewalPaymentDto } from './dto/reject-renewal-payment.dto';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';

function authContext(req: AuthenticatedRequest) {
  return {
    userId: req.auth.userId,
    organizationId: req.auth.organizationId,
    branchId: req.auth.branchId,
    role: req.auth.role,
  };
}

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private subscriptionsService: SubscriptionsService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Req() req: AuthenticatedRequest) {
    return this.subscriptionsService.getStatus(authContext(req));
  }

  @Post('renewal-payments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('business_owner')
  async submitRenewalPayment(@Req() req: AuthenticatedRequest, @Body() dto: SubmitRenewalPaymentDto) {
    return this.subscriptionsService.submitRenewalPayment(authContext(req), dto);
  }

  @Get('renewal-payments/mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('business_owner')
  async listMyRenewalPayments(@Req() req: AuthenticatedRequest) {
    return this.subscriptionsService.listMyRenewalPayments(authContext(req));
  }

  @Get('renewal-payments/pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  async listPendingRenewalPayments() {
    return this.subscriptionsService.listPendingRenewalPayments();
  }

  @Post('renewal-payments/:id/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  async verifyRenewalPayment(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.subscriptionsService.verifyRenewalPayment(authContext(req), id);
  }

  @Post('renewal-payments/:id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  async rejectRenewalPayment(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: RejectRenewalPaymentDto,
  ) {
    return this.subscriptionsService.rejectRenewalPayment(authContext(req), id, dto);
  }

  // No @Roles restriction — any authenticated user can see what the
  // subscription costs (a Business Owner needs this to know how much
  // to pay before submitting a reference), matching how GET
  // /commission-rates has no role restriction either.
  @Get('platform-settings')
  @UseGuards(JwtAuthGuard)
  async getPlatformSettings() {
    return this.subscriptionsService.getPlatformSettings();
  }

  @Put('platform-settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  async updatePlatformSettings(@Req() req: AuthenticatedRequest, @Body() dto: UpdatePlatformSettingsDto) {
    return this.subscriptionsService.updatePlatformSettings(authContext(req), dto);
  }

  /**
   * Deliberately NOT behind JwtAuthGuard — this is meant to be called
   * by an external scheduler (a daily Render Cron Job, for instance),
   * which has no user to log in as. Protected instead by a shared
   * secret in an env var, checked directly here. If CRON_SECRET isn't
   * set at all, this endpoint refuses every request rather than
   * silently running unprotected — a missing secret should fail
   * closed, not open.
   */
  @Post('lifecycle/run')
  async runLifecycleCheck(@Headers('x-cron-secret') providedSecret: string | undefined) {
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret || providedSecret !== expectedSecret) {
      throw new ForbiddenException('Invalid or missing cron secret');
    }
    return this.subscriptionsService.runLifecycleCheck();
  }
}
