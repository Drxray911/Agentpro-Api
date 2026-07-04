import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { SupportService } from './support.service';
import { CreateTicketDto, AddMessageDto } from './dto/support.dto';

function authContext(req: AuthenticatedRequest) {
  return {
    userId: req.auth.userId,
    organizationId: req.auth.organizationId,
    branchId: req.auth.branchId,
    role: req.auth.role,
  };
}

@Controller('support/tickets')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private supportService: SupportService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query('status') status?: string) {
    return this.supportService.list(authContext(req), status);
  }

  @Post()
  async create(@Req() req: AuthenticatedRequest, @Body() dto: CreateTicketDto) {
    return this.supportService.create(authContext(req), dto);
  }

  @Post(':id/messages')
  async addMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AddMessageDto,
  ) {
    return this.supportService.addMessage(authContext(req), id, dto);
  }
}
