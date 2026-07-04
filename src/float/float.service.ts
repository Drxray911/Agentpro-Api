import { Injectable, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { DatabaseService, RequestAuthContext } from '../database/database.service';
import { CreateFloatMovementDto } from './dto/create-float-movement.dto';

const NETWORK_IDS: Record<string, number> = { MTN: 1, TELECEL: 2, AT: 3 };

class InsufficientFundsException extends HttpException {
  constructor(message: string) {
    super({ errorCode: 'insufficient_funds', message }, HttpStatus.PAYMENT_REQUIRED);
  }
}

@Injectable()
export class FloatService {
  constructor(private db: DatabaseService) {}

  async getBalances(auth: RequestAuthContext) {
    return this.db.withTransaction(auth, async (client) => {
      const result = await client.query(
        `SELECT network_code, current_balance FROM v_float_balances WHERE branch_id = $1`,
        [auth.branchId],
      );
      return result.rows.map((row) => ({
        network: row.network_code,
        currentBalance: row.current_balance,
        isLow: parseFloat(row.current_balance) < 3000,
      }));
    });
  }

  async listMovements(auth: RequestAuthContext, network?: string, page = 1) {
    return this.db.withTransaction(auth, async (client) => {
      const conditions = ['branch_id = $1'];
      const params: any[] = [auth.branchId];
      if (network) {
        params.push(NETWORK_IDS[network]);
        conditions.push(`network_id = $${params.length}`);
      }
      const pageSize = 25;
      params.push(pageSize, (page - 1) * pageSize);

      const result = await client.query(
        `SELECT fm.id, n.code AS network_code, fm.movement_type, fm.amount, fm.note,
                fm.performed_by, fm.created_at
         FROM float_movements fm
         JOIN networks n ON n.id = fm.network_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY fm.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      return result.rows.map((row) => ({
        id: row.id,
        network: row.network_code,
        movementType: row.movement_type,
        amount: row.amount,
        note: row.note,
        performedBy: row.performed_by,
        createdAt: row.created_at,
      }));
    });
  }

  async createMovement(auth: RequestAuthContext, dto: CreateFloatMovementDto) {
    return this.db.withTransaction(auth, async (client) => {
      // Idempotency check, same pattern as transactions.
      const existing = await client.query(
        `SELECT fm.id, n.code AS network_code, fm.movement_type, fm.amount, fm.note, fm.created_at
         FROM float_movements fm
         JOIN networks n ON n.id = fm.network_id
         WHERE fm.client_generated_id = $1`,
        [dto.clientGeneratedId],
      );
      if (existing.rows.length > 0) {
        return { movement: this.mapRow(existing.rows[0]), wasIdempotentReplay: true };
      }

      const networkId = NETWORK_IDS[dto.network];
      const amount = parseFloat(dto.amount);

      if (dto.movementType === 'transfer') {
        if (!dto.toNetwork) {
          throw new BadRequestException('toNetwork is required for transfer movements');
        }
        if (dto.toNetwork === dto.network) {
          throw new BadRequestException('toNetwork must differ from network');
        }
        if (amount <= 0) {
          throw new BadRequestException('Transfer amount must be positive');
        }

        const balanceResult = await client.query(
          `SELECT COALESCE(SUM(amount), 0) AS balance FROM float_movements
           WHERE branch_id = $1 AND network_id = $2`,
          [auth.branchId, networkId],
        );
        const currentBalance = parseFloat(balanceResult.rows[0].balance);
        if (currentBalance < amount) {
          throw new InsufficientFundsException(
            `Insufficient ${dto.network} float: have ${currentBalance.toFixed(2)}, need ${amount.toFixed(2)}`,
          );
        }

        const toNetworkId = NETWORK_IDS[dto.toNetwork];
        await client.query(
          `INSERT INTO float_movements (branch_id, network_id, movement_type, amount, related_branch_id, note, performed_by, client_generated_id)
           VALUES ($1, $2, 'transfer_out', $3, $1, $4, $5, $6)`,
          [auth.branchId, networkId, -amount, dto.note ?? null, auth.userId, dto.clientGeneratedId],
        );
        const inserted = await client.query(
          `INSERT INTO float_movements (branch_id, network_id, movement_type, amount, related_branch_id, note, performed_by)
           VALUES ($1, $2, 'transfer_in', $3, $1, $4, $5)
           RETURNING id, created_at`,
          [auth.branchId, toNetworkId, amount, dto.note ?? `Transferred from ${dto.network}`, auth.userId],
        );

        return {
          movement: {
            id: inserted.rows[0].id,
            network: dto.toNetwork,
            movementType: 'transfer_in',
            amount: amount.toFixed(2),
            note: dto.note ?? `Transferred from ${dto.network}`,
            createdAt: inserted.rows[0].created_at,
          },
          wasIdempotentReplay: false,
        };
      }

      if (dto.movementType === 'purchase') {
        if (amount <= 0) {
          throw new BadRequestException('Purchase amount must be positive');
        }
        const cashResult = await client.query(
          `SELECT COALESCE(SUM(amount), 0) AS balance FROM cash_movements WHERE branch_id = $1`,
          [auth.branchId],
        );
        const currentCash = parseFloat(cashResult.rows[0].balance);
        if (currentCash < amount) {
          throw new InsufficientFundsException(
            `Insufficient cash on hand: have ${currentCash.toFixed(2)}, need ${amount.toFixed(2)}`,
          );
        }

        const inserted = await client.query(
          `INSERT INTO float_movements (branch_id, network_id, movement_type, amount, note, performed_by, client_generated_id)
           VALUES ($1, $2, 'purchase', $3, $4, $5, $6)
           RETURNING id, created_at`,
          [auth.branchId, networkId, amount, dto.note ?? null, auth.userId, dto.clientGeneratedId],
        );
        await client.query(
          `INSERT INTO cash_movements (branch_id, movement_type, amount, note, performed_by)
           VALUES ($1, 'float_purchase_payment', $2, $3, $4)`,
          [auth.branchId, -amount, `Float purchase: ${dto.network}`, auth.userId],
        );

        return {
          movement: {
            id: inserted.rows[0].id,
            network: dto.network,
            movementType: 'purchase',
            amount: amount.toFixed(2),
            note: dto.note,
            createdAt: inserted.rows[0].created_at,
          },
          wasIdempotentReplay: false,
        };
      }

      // adjustment — amount can be positive or negative, no balance check
      const inserted = await client.query(
        `INSERT INTO float_movements (branch_id, network_id, movement_type, amount, note, performed_by, client_generated_id)
         VALUES ($1, $2, 'adjustment', $3, $4, $5, $6)
         RETURNING id, created_at`,
        [auth.branchId, networkId, amount, dto.note ?? null, auth.userId, dto.clientGeneratedId],
      );

      return {
        movement: {
          id: inserted.rows[0].id,
          network: dto.network,
          movementType: 'adjustment',
          amount: amount.toFixed(2),
          note: dto.note,
          createdAt: inserted.rows[0].created_at,
        },
        wasIdempotentReplay: false,
      };
    });
  }

  private mapRow(row: any) {
    return {
      id: row.id,
      network: row.network_code,
      movementType: row.movement_type,
      amount: row.amount,
      note: row.note,
      createdAt: row.created_at,
    };
  }
}
