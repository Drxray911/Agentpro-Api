import { Injectable } from '@nestjs/common';
import { DatabaseService, RequestAuthContext } from '../database/database.service';

const LOW_FLOAT_THRESHOLD = 3000;

@Injectable()
export class DashboardService {
  constructor(private db: DatabaseService) {}

  async getSummary(auth: RequestAuthContext) {
    return this.db.withTransaction(auth, async (client) => {
      const floatResult = await client.query(
        `SELECT network_code, current_balance FROM v_float_balances WHERE branch_id = $1`,
        [auth.branchId],
      );

      const floatBalances = floatResult.rows.map((row) => ({
        network: row.network_code,
        currentBalance: row.current_balance,
        isLow: parseFloat(row.current_balance) < LOW_FLOAT_THRESHOLD,
      }));

      const totalFloat = floatResult.rows.reduce(
        (sum, row) => sum + parseFloat(row.current_balance),
        0,
      );

      const cashResult = await client.query(
        `SELECT current_balance FROM v_cash_balance WHERE branch_id = $1`,
        [auth.branchId],
      );
      const cashOnHand = cashResult.rows[0]?.current_balance ?? '0.00';

      const todayResult = await client.query(
        `SELECT transaction_count, total_volume, total_commission
         FROM v_daily_branch_stats
         WHERE branch_id = $1 AND stat_date = CURRENT_DATE`,
        [auth.branchId],
      );

      const today = todayResult.rows[0] ?? {
        transaction_count: 0,
        total_volume: '0.00',
        total_commission: '0.00',
      };

      const recentResult = await client.query(
        `SELECT t.id, t.transaction_type, n.code AS network_code, t.amount, t.commission,
                t.status, t.created_at, c.full_name AS customer_name, c.phone AS customer_phone
         FROM transactions t
         JOIN networks n ON n.id = t.network_id
         LEFT JOIN customers c ON c.id = t.customer_id
         WHERE t.branch_id = $1
         ORDER BY t.created_at DESC
         LIMIT 8`,
        [auth.branchId],
      );

      const recentTransactions = recentResult.rows.map(mapTransactionRow);

      const lowFloatAlerts = floatBalances.filter((f) => f.isLow);

      return {
        floatBalances,
        totalFloat: totalFloat.toFixed(2),
        cashOnHand,
        today: {
          transactionCount: parseInt(today.transaction_count, 10) || 0,
          volume: today.total_volume ?? '0.00',
          commission: today.total_commission ?? '0.00',
        },
        recentTransactions,
        lowFloatAlerts,
      };
    });
  }
}

export function mapTransactionRow(row: any) {
  return {
    id: row.id,
    type: row.transaction_type,
    network: row.network_code,
    customer: {
      fullName: row.customer_name ?? 'Walk-in Customer',
      phone: row.customer_phone ?? null,
    },
    amount: row.amount,
    commission: row.commission,
    status: row.status,
    createdAt: row.created_at,
  };
}
