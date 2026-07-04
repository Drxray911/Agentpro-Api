import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService, RequestAuthContext } from '../database/database.service';
import { CommissionRateUpdateItem } from './dto/update-commission-rates.dto';

const NETWORK_IDS: Record<string, number> = { MTN: 1, TELECEL: 2, AT: 3 };
const NETWORK_CODES_BY_ID: Record<number, string> = { 1: 'MTN', 2: 'TELECEL', 3: 'AT' };

@Injectable()
export class CommissionsService {
  constructor(private db: DatabaseService) {}

  async getActiveRates(auth: RequestAuthContext) {
    return this.db.withTransaction(auth, async (client) => {
      const result = await client.query(
        `SELECT network_id, transaction_type, rate_percent, effective_from
         FROM v_active_commission_rates
         WHERE branch_id = $1`,
        [auth.branchId],
      );
      return result.rows.map((row) => ({
        network: NETWORK_CODES_BY_ID[row.network_id],
        transactionType: row.transaction_type,
        ratePercent: parseFloat(row.rate_percent) * 100, // stored as decimal, returned as %
        effectiveFrom: row.effective_from,
      }));
    });
  }

  async updateRates(auth: RequestAuthContext, items: CommissionRateUpdateItem[]) {
    return this.db.withTransaction(auth, async (client) => {
      const updated: any[] = [];
      for (const item of items) {
        updated.push(await this.updateSingleRate(client, auth, item));
      }
      return updated;
    });
  }

  private async updateSingleRate(client: PoolClient, auth: RequestAuthContext, item: CommissionRateUpdateItem) {
    const networkId = NETWORK_IDS[item.network];
    const rateDecimal = item.ratePercent / 100; // UI/API works in %, storage is decimal

    // Close the currently active rate, if one exists. Versioned, not
    // overwritten in place — this is the entire point of the design
    // verified back in the schema work: a transaction recorded before
    // this change keeps showing the rate that was actually active
    // when it happened, because that rate's row is never edited or
    // deleted, only marked as no-longer-current via effective_to.
    await client.query(
      `UPDATE commission_rates
       SET effective_to = now()
       WHERE branch_id = $1 AND network_id = $2 AND transaction_type = $3
         AND effective_to IS NULL`,
      [auth.branchId, networkId, item.transactionType],
    );

    const inserted = await client.query(
      `INSERT INTO commission_rates (branch_id, network_id, transaction_type, rate_percent, effective_from, created_by)
       VALUES ($1, $2, $3, $4, now(), $5)
       RETURNING rate_percent, effective_from`,
      [auth.branchId, networkId, item.transactionType, rateDecimal, auth.userId],
    );

    return {
      network: item.network,
      transactionType: item.transactionType,
      ratePercent: parseFloat(inserted.rows[0].rate_percent) * 100,
      effectiveFrom: inserted.rows[0].effective_from,
    };
  }
}
