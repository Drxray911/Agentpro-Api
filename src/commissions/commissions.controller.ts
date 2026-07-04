import { Body, Controller, Get, ParseArrayPipe, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CommissionsService } from './commissions.service';
import { CommissionRateUpdateItem } from './dto/update-commission-rates.dto';

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

  // @Roles() applied here at the METHOD level deliberately, not the
  // class level — bug #4 in BACKEND_IMPLEMENTATION_NOTES.md was caused
  // by exactly the class-level placement on FloatController, which
  // RolesGuard's reflector call (at the time) couldn't see. The guard
  // was later fixed to check both levels via getAllAndOverride(), but
  // applying it at the method level here as well is an extra layer of
  // protection against the same mistake recurring on a guard
  // implementation that might change in the future.
  @Put()
  @Roles('business_owner', 'super_admin')
  async updateRates(
    @Req() req: AuthenticatedRequest,
    // ParseArrayPipe with an explicit `items` type is the actual
    // correct mechanism for validating a bare-array request body in
    // NestJS — confirmed by reading its type definition directly,
    // after an initial instinct to just pass a bare ValidationPipe
    // (which does not validate array elements against a class on its
    // own) turned out to be unverified guesswork rather than something
    // actually checked.
    @Body(new ParseArrayPipe({ items: CommissionRateUpdateItem }))
    body: CommissionRateUpdateItem[],
  ) {
    return this.commissionsService.updateRates(authContext(req), body);
  }
}
