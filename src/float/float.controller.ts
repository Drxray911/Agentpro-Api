import { Body, Controller, Get, Post, Query, Req, Res, UseGuards, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { FloatService } from './float.service';
import { CreateFloatMovementDto } from './dto/create-float-movement.dto';

function authContext(req: AuthenticatedRequest) {
  return {
    userId: req.auth.userId,
    organizationId: req.auth.organizationId,
    branchId: req.auth.branchId,
    role: req.auth.role,
  };
}

@Controller('float')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('business_owner', 'super_admin', 'branch_manager')
export class FloatController {
  constructor(private floatService: FloatService) {}

  @Get('balances')
  async getBalances(@Req() req: AuthenticatedRequest) {
    return this.floatService.getBalances(authContext(req));
  }

  @Get('movements')
  async listMovements(
    @Req() req: AuthenticatedRequest,
    @Query('network') network?: string,
    @Query('page') page = '1',
  ) {
    return this.floatService.listMovements(authContext(req), network, parseInt(page, 10) || 1);
  }

  @Post('movements')
  async createMovement(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: CreateFloatMovementDto,
  ) {
    const { movement, wasIdempotentReplay } = await this.floatService.createMovement(
      authContext(req),
      dto,
    );
    res.status(wasIdempotentReplay ? HttpStatus.OK : HttpStatus.CREATED);
    return movement;
  }
}
