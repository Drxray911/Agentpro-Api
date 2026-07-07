import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { UssdTemplatesService } from './ussd-templates.service';
import { SetUssdTemplateDto } from './dto/set-ussd-template.dto';

function authContext(req: AuthenticatedRequest) {
  return {
    userId: req.auth.userId,
    organizationId: req.auth.organizationId,
    branchId: req.auth.branchId,
    role: req.auth.role,
  };
}

@Controller('ussd-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UssdTemplatesController {
  constructor(private ussdTemplatesService: UssdTemplatesService) {}

  // No @Roles restriction — every authenticated user's app needs these
  // to actually run a USSD session, not just Superusers.
  @Get()
  async getActiveTemplates(@Req() req: AuthenticatedRequest) {
    return this.ussdTemplatesService.getActiveTemplates(authContext(req));
  }

  @Post()
  @Roles('super_admin')
  async setTemplate(@Req() req: AuthenticatedRequest, @Body() dto: SetUssdTemplateDto) {
    return this.ussdTemplatesService.setTemplate(authContext(req), dto);
  }
}
