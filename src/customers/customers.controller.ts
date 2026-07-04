import { Body, Controller, Get, NotFoundException, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { CustomersService } from './customers.service';
import { SetFavoriteDto } from './dto/set-favorite.dto';

function authContext(req: AuthenticatedRequest) {
  return {
    userId: req.auth.userId,
    organizationId: req.auth.organizationId,
    branchId: req.auth.branchId,
    role: req.auth.role,
  };
}

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('query') query?: string,
    @Query('favorites_only') favoritesOnly?: string,
  ) {
    return this.customersService.list(authContext(req), query, favoritesOnly === 'true');
  }

  @Put(':id/favorite')
  async setFavorite(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: SetFavoriteDto,
  ) {
    const updated = await this.customersService.setFavorite(authContext(req), id, dto.isFavorite);
    if (!updated) {
      throw new NotFoundException('Customer not found');
    }
    return updated;
  }
}
