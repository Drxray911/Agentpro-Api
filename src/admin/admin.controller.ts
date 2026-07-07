import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AdminService } from './admin.service';
import { ApproveOrganizationDto } from './dto/approve-organization.dto';
import { RejectOrganizationDto } from './dto/reject-organization.dto';

@Controller('admin/organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('pending')
  async listPending() {
    return this.adminService.listPendingOrganizations();
  }

  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @Body() dto: ApproveOrganizationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.adminService.approveOrganization(id, dto, req.auth.userId);
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: RejectOrganizationDto) {
    return this.adminService.rejectOrganization(id, dto);
  }
}
