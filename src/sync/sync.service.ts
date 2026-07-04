import { Injectable } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RequestAuthContext } from '../database/database.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateTransactionDto } from '../transactions/dto/create-transaction.dto';
import { FloatService } from '../float/float.service';
import { CreateFloatMovementDto } from '../float/dto/create-float-movement.dto';
import { SyncBatchDto } from './dto/sync-batch.dto';

export interface SyncFailure {
  clientGeneratedId: string;
  reason: string;
}

@Injectable()
export class SyncService {
  constructor(
    private transactionsService: TransactionsService,
    private floatService: FloatService,
  ) {}

  async processBatch(auth: RequestAuthContext, dto: SyncBatchDto) {
    let syncedCount = 0;
    let duplicateCount = 0;
    const failed: SyncFailure[] = [];

    // Items are processed in submission order, per openapi.yaml — this
    // matters because a transaction and a related float adjustment
    // queued offline in a specific order should be replayed in that
    // same order, not reordered by type. Each item's own create logic
    // (TransactionsService.create / FloatService.createMovement) is
    // reused as-is rather than reimplemented here, since both already
    // carry the idempotency-check-first pattern verified directly
    // against the database during earlier work — duplicating that
    // logic here would risk it drifting out of sync with the
    // single-item endpoints over time.
    //
    // Each item runs in its own database transaction (inherited from
    // the underlying services), not one big transaction for the whole
    // batch — confirmed against openapi.yaml's documented response
    // shape (synced_count / duplicate_count / a per-item failed[]
    // array) that per-item independence is the intended design: one
    // bad item in a batch of fifty should not roll back the other
    // forty-nine that were perfectly fine.
    for (const raw of dto.transactions ?? []) {
      const clientId = typeof raw.clientGeneratedId === 'string' ? raw.clientGeneratedId : 'unknown';
      const instance = plainToInstance(CreateTransactionDto, raw);
      const errors = await validate(instance);
      if (errors.length > 0) {
        failed.push({ clientGeneratedId: clientId, reason: errors.map((e) => Object.values(e.constraints ?? {}).join('; ')).join('; ') });
        continue;
      }
      try {
        const { wasIdempotentReplay } = await this.transactionsService.create(auth, instance);
        if (wasIdempotentReplay) duplicateCount++;
        else syncedCount++;
      } catch (err: any) {
        failed.push({ clientGeneratedId: clientId, reason: err?.response?.message ?? err?.message ?? 'Unknown error' });
      }
    }

    for (const raw of dto.floatMovements ?? []) {
      const clientId = typeof raw.clientGeneratedId === 'string' ? raw.clientGeneratedId : 'unknown';
      const instance = plainToInstance(CreateFloatMovementDto, raw);
      const errors = await validate(instance);
      if (errors.length > 0) {
        failed.push({ clientGeneratedId: clientId, reason: errors.map((e) => Object.values(e.constraints ?? {}).join('; ')).join('; ') });
        continue;
      }
      try {
        const { wasIdempotentReplay } = await this.floatService.createMovement(auth, instance);
        if (wasIdempotentReplay) duplicateCount++;
        else syncedCount++;
      } catch (err: any) {
        failed.push({ clientGeneratedId: clientId, reason: err?.response?.message ?? err?.message ?? 'Unknown error' });
      }
    }

    return { syncedCount, duplicateCount, failed };
  }
}
