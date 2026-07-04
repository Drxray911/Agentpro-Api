import { Body, Controller, Get, Post, Query, Req, Res, UseGuards, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';

function authContext(req: AuthenticatedRequest) {
  return {
    userId: req.auth.userId,
    organizationId: req.auth.organizationId,
    branchId: req.auth.branchId,
    role: req.auth.role,
  };
}

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: CreateTransactionDto,
  ) {
    const { transaction, wasIdempotentReplay } = await this.transactionsService.create(
      authContext(req),
      dto,
    );
    // Per openapi.yaml: 201 for a newly created transaction, 200 when
    // this client_generated_id was already processed previously.
    res.status(wasIdempotentReplay ? HttpStatus.OK : HttpStatus.CREATED);
    return transaction;
  }

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('network') network?: string,
    @Query('type') type?: string,
    @Query('query') query?: string,
    @Query('page') page = '1',
    @Query('page_size') pageSize = '25',
  ) {
    return this.transactionsService.list(authContext(req), {
      network,
      type,
      query,
      page: parseInt(page, 10) || 1,
      pageSize: Math.min(parseInt(pageSize, 10) || 25, 100),
    });
  }
}
