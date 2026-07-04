import { Injectable } from '@nestjs/common';
import { DatabaseService, RequestAuthContext } from '../database/database.service';

@Injectable()
export class CustomersService {
  constructor(private db: DatabaseService) {}

  async list(auth: RequestAuthContext, query?: string, favoritesOnly = false) {
    return this.db.withTransaction(auth, async (client) => {
      const conditions = ['c.branch_id = $1'];
      const params: any[] = [auth.branchId];

      if (query) {
        params.push(`%${query}%`);
        conditions.push(`(c.full_name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`);
      }
      if (favoritesOnly) {
        conditions.push('c.is_favorite = true');
      }

      // Transaction-derived stats joined in, matching how the
      // prototype builds its customer list entirely from transaction
      // history rather than maintaining separate counters that could
      // drift out of sync with the actual ledger.
      const result = await client.query(
        `SELECT c.id, c.phone, c.full_name, c.is_favorite,
                n.code AS preferred_network_code,
                COUNT(t.id) AS transaction_count,
                COALESCE(SUM(t.amount), 0) AS total_volume,
                MAX(t.created_at) AS last_transaction_at
         FROM customers c
         LEFT JOIN networks n ON n.id = c.preferred_network_id
         LEFT JOIN transactions t ON t.customer_id = c.id AND t.status = 'completed'
         WHERE ${conditions.join(' AND ')} AND c.deleted_at IS NULL
         GROUP BY c.id, c.phone, c.full_name, c.is_favorite, n.code
         ORDER BY transaction_count DESC`,
        params,
      );

      return result.rows.map((row) => ({
        id: row.id,
        phone: row.phone,
        fullName: row.full_name,
        network: row.preferred_network_code,
        isFavorite: row.is_favorite,
        transactionCount: parseInt(row.transaction_count, 10),
        totalVolume: row.total_volume,
        lastTransactionAt: row.last_transaction_at,
      }));
    });
  }

  async setFavorite(auth: RequestAuthContext, customerId: string, isFavorite: boolean) {
    return this.db.withTransaction(auth, async (client) => {
      const result = await client.query(
        `UPDATE customers SET is_favorite = $1
         WHERE id = $2 AND branch_id = $3 AND deleted_at IS NULL
         RETURNING id, phone, full_name, is_favorite`,
        [isFavorite, customerId, auth.branchId],
      );
      return result.rows[0] ?? null;
    });
  }
}
