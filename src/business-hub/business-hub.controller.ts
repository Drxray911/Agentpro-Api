import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { BusinessHubService } from './business-hub.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { RejectListingContentDto } from './dto/reject-listing-content.dto';
import { SubmitListingPaymentDto } from './dto/submit-listing-payment.dto';
import { RejectListingPaymentDto } from './dto/reject-listing-payment.dto';

function authContext(req: AuthenticatedRequest) {
  return {
    userId: req.auth.userId,
    organizationId: req.auth.organizationId,
    branchId: req.auth.branchId,
    role: req.auth.role,
  };
}

@Controller('business-hub')
export class BusinessHubController {
  constructor(private businessHubService: BusinessHubService) {}

  @Post('listings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('business_owner')
  async createListing(@Req() req: AuthenticatedRequest, @Body() dto: CreateListingDto) {
    return this.businessHubService.createListing(authContext(req), dto);
  }

  // Browsing is intentionally open to every authenticated role — the
  // spec's Free Plan explicitly includes "Marketplace browsing,
  // search, ratings" without requiring the paid Business Plan.
  @Get('listings')
  @UseGuards(JwtAuthGuard)
  async browseListings(
    @Req() req: AuthenticatedRequest,
    @Query('category') category?: string,
    @Query('location') location?: string,
  ) {
    return this.businessHubService.browseListings(authContext(req), category, location);
  }

  @Get('listings/mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('business_owner')
  async listMyListings(@Req() req: AuthenticatedRequest) {
    return this.businessHubService.listMyListings(authContext(req));
  }

  @Get('listings/pending-review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  async listPendingReview() {
    return this.businessHubService.listPendingReview();
  }

  @Post('listings/:id/approve-content')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  async approveContent(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.businessHubService.approveContent(authContext(req), id);
  }

  @Post('listings/:id/reject-content')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  async rejectContent(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: RejectListingContentDto,
  ) {
    return this.businessHubService.rejectContent(authContext(req), id, dto);
  }

  @Post('listings/:id/payments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('business_owner')
  async submitPayment(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: SubmitListingPaymentDto,
  ) {
    return this.businessHubService.submitPayment(authContext(req), id, dto);
  }

  @Get('listing-payments/pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  async listPendingPayments() {
    return this.businessHubService.listPendingPayments();
  }

  @Post('listing-payments/:id/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  async verifyPayment(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.businessHubService.verifyPayment(authContext(req), id);
  }

  @Post('listing-payments/:id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  async rejectPayment(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: RejectListingPaymentDto,
  ) {
    return this.businessHubService.rejectPayment(authContext(req), id, dto);
  }

  // Same shared-secret cron pattern as SubscriptionsController.runLifecycleCheck.
  @Post('lifecycle/run')
  async runLifecycleCheck(@Headers('x-cron-secret') providedSecret: string | undefined) {
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret || providedSecret !== expectedSecret) {
      throw new ForbiddenException('Invalid or missing cron secret');
    }
    return this.businessHubService.runLifecycleCheck();
  }
}
