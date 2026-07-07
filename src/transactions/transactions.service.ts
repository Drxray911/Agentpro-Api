import {
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService, RequestAuthContext } from '../database/database.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { mapTransactionRow } from '../dashboard/dashboard.service';
import { computeCommission } from '../commissions/commission-calculator';

// NestJS does not ship a built-in 402 exception class (only a curated
// subset of HTTP statuses have dedicated classes), so this is a thin
// HttpException subclass to get the same ergonomic throw-and-catch
// pattern as e.g. NotFoundException for the one place this API spec
// (openapi.yaml) calls for a 402 Payment Required.
class InsufficientFloatException extends HttpException {
  constructor(message: string) {
    super({ errorCode: 'insufficient_float', message }, HttpStatus.PAYMENT_REQUIRED);
  }
}

const NETWORK_IDS: Record<string, number> = { MTN: 1, TELECEL: 2, AT: 3 };

// Maps the API's transaction type strings to which "direction" they
// move float and cash — mirrors recordTransaction() in the prototype
// exactly, now enforced server-side rather than only client-side.
const FLOAT_CONSUMING_TYPES = ['cash_in', 'airtime', 'data_bundle'];
const FLOAT_REPLENISHING_TYPES = ['cash_out'];

@Injectable()
export class TransactionsService {
  constructor(private db: DatabaseService) {}

  async create(auth: RequestAuthContext, dto: CreateTransactionDto) {
    return this.db.withTransaction(auth, async (client) => {
      // Idempotency check first: if this client_generated_id was already
      // processed, return the original record rather than creating a
      // duplicate or erroring. This is the same guarantee tested
      // directly against the database during schema development.
      const existing = await client.query(
        `SELECT t.id, t.transaction_type, n.code AS network_code, t.amount, t.commission, t.provider_commission, t.net_commission,
                t.status, t.created_at, c.full_name AS customer_name, c.phone AS customer_phone
         FROM transactions t
         JOIN networks n ON n.id = t.network_id
         LEFT JOIN customers c ON c.id = t.customer_id
         WHERE t.client_generated_id = $1`,
        [dto.clientGeneratedId],
      );
      if (existing.rows.length > 0) {
        return { transaction: mapTransactionRow(existing.rows[0]), wasIdempotentReplay: true };
      }

      const networkId = NETWORK_IDS[dto.network];
      const amount = parseFloat(dto.amount);

      // Branch-specific custom rate first; if this branch has no
      // active custom rate for this network/type, fall back to the
      // Superuser-managed platform default. Only if neither exists is
      // this genuinely unconfigured — that's the only case that should
      // block the transaction outright.
      let rateResult = await client.query(
        `SELECT id, rate_percent, threshold_amount, cap_amount, provider_share_percent
         FROM commission_rates
         WHERE branch_id = $1 AND network_id = $2 AND transaction_type = $3
           AND effective_to IS NULL`,
        [auth.branchId, networkId, dto.type],
      );

      let commissionRateId: string | null = null;
      let ratePercent: number;
      let thresholdAmount: number | null;
      let capAmount: number | null;
      let providerSharePercent: number;

      if (rateResult.rows.length > 0) {
        const row = rateResult.rows[0];
        commissionRateId = row.id;
        ratePercent = parseFloat(row.rate_percent);
        thresholdAmount = row.threshold_amount !== null ? parseFloat(row.threshold_amount) : null;
        capAmount = row.cap_amount !== null ? parseFloat(row.cap_amount) : null;
        providerSharePercent = parseFloat(row.provider_share_percent);
      } else {
        const defaultResult = await client.query(
          `SELECT rate_percent, threshold_amount, cap_amount, provider_share_percent
           FROM platform_commission_defaults
           WHERE network_id = $1 AND transaction_type = $2 AND effective_to IS NULL`,
          [networkId, dto.type],
        );
        if (defaultResult.rows.length === 0) {
          throw new HttpException(
            { errorCode: 'no_active_rate', message: `No active commission rate configured for ${dto.network}/${dto.type}` },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        const row = defaultResult.rows[0];
        // commission_rate_id stays NULL when a platform default is what
        // applied — there's no commission_rates row to point at, and
        // forcing one would misrepresent this as a branch-specific rate.
        ratePercent = parseFloat(row.rate_percent);
        thresholdAmount = row.threshold_amount !== null ? parseFloat(row.threshold_amount) : null;
        capAmount = row.cap_amount !== null ? parseFloat(row.cap_amount) : null;
        providerSharePercent = parseFloat(row.provider_share_percent);
      }

      const { grossCommission, providerCommission, netCommission } = computeCommission({
        amount,
        ratePercent,
        thresholdAmount,
        capAmount,
        providerSharePercent,
      });

      // Float sufficiency check — only relevant for float-consuming
      // transaction types. This is the server-side enforcement of the
      // same rule the prototype's transaction modal checks client-side;
      // the client-side check is a UX nicety, this is the real
      // safeguard, since a client can always be bypassed.
      if (FLOAT_CONSUMING_TYPES.includes(dto.type)) {
        const floatResult = await client.query(
          `SELECT COALESCE(SUM(amount), 0) AS balance FROM float_movements
           WHERE branch_id = $1 AND network_id = $2`,
          [auth.branchId, networkId],
        );
        const currentFloat = parseFloat(floatResult.rows[0].balance);
        if (currentFloat < amount) {
          throw new InsufficientFloatException(
            `Insufficient ${dto.network} float: have ${currentFloat.toFixed(2)}, need ${amount.toFixed(2)}`,
          );
        }
      }

      // Resolve or create the customer record, if a phone was given.
      let customerId: string | null = null;
      if (dto.customerPhone) {
        const customerResult = await client.query(
          `INSERT INTO customers (branch_id, phone, full_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (branch_id, phone)
           DO UPDATE SET full_name = COALESCE(EXCLUDED.full_name, customers.full_name)
           RETURNING id`,
          [auth.branchId, dto.customerPhone, dto.customerName ?? null],
        );
        customerId = customerResult.rows[0].id;
      }

      const txResult = await client.query(
        `INSERT INTO transactions
           (branch_id, performed_by, customer_id, network_id, transaction_type,
            amount, commission, provider_commission, net_commission, commission_rate_id, external_reference,
            status, client_generated_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'completed', $12)
         RETURNING id, created_at`,
        [
          auth.branchId,
          auth.userId,
          customerId,
          networkId,
          dto.type,
          amount,
          grossCommission,
          providerCommission,
          netCommission,
          commissionRateId,
          dto.externalReference ?? null,
          dto.clientGeneratedId,
        ],
      );

      const transactionId = txResult.rows[0].id;
      const createdAt = txResult.rows[0].created_at;

      // Ledger effects use NET commission — that's the cash the
      // business actually retains after the provider's cut, which is
      // what cash-on-hand and the commission_earned entry should
      // reflect. The gross figure stays on the transaction record
      // itself for audit/reporting, but was never real spendable cash
      // in full.
      await this.applyLedgerEffects(client, auth, dto.type, dto.network, networkId, amount, netCommission, transactionId);

      return {
        transaction: {
          id: transactionId,
          type: dto.type,
          network: dto.network,
          customer: { fullName: dto.customerName ?? 'Walk-in Customer', phone: dto.customerPhone ?? null },
          amount: amount.toFixed(2),
          commission: grossCommission.toFixed(2),
          providerCommission: providerCommission.toFixed(2),
          netCommission: netCommission.toFixed(2),
          status: 'completed',
          createdAt,
        },
        wasIdempotentReplay: false,
      };
    });
  }

  private async applyLedgerEffects(
    client: PoolClient,
    auth: RequestAuthContext,
    type: string,
    networkCode: string,
    networkId: number,
    amount: number,
    commission: number,
    transactionId: string,
  ) {
    if (FLOAT_CONSUMING_TYPES.includes(type)) {
      await client.query(
        `INSERT INTO float_movements (branch_id, network_id, movement_type, amount, related_transaction_id, performed_by)
         VALUES ($1, $2, 'transaction_consumption', $3, $4, $5)`,
        [auth.branchId, networkId, -amount, transactionId, auth.userId],
      );
    } else if (FLOAT_REPLENISHING_TYPES.includes(type)) {
      await client.query(
        `INSERT INTO float_movements (branch_id, network_id, movement_type, amount, related_transaction_id, performed_by)
         VALUES ($1, $2, 'transaction_replenishment', $3, $4, $5)`,
        [auth.branchId, networkId, amount, transactionId, auth.userId],
      );
    }

    // Cash effects, mirroring the prototype's recordTransaction() exactly:
    // cash-in: +amount +commission. cash-out: -amount +commission.
    // airtime/data: +commission only.
    if (type === 'cash_in') {
      await client.query(
        `INSERT INTO cash_movements (branch_id, movement_type, amount, related_transaction_id, performed_by)
         VALUES ($1, 'cash_in_received', $2, $3, $4)`,
        [auth.branchId, amount + commission, transactionId, auth.userId],
      );
    } else if (type === 'cash_out') {
      await client.query(
        `INSERT INTO cash_movements (branch_id, movement_type, amount, related_transaction_id, performed_by)
         VALUES ($1, 'cash_out_paid', $2, $3, $4)`,
        [auth.branchId, -amount + commission, transactionId, auth.userId],
      );
    } else {
      await client.query(
        `INSERT INTO cash_movements (branch_id, movement_type, amount, related_transaction_id, performed_by)
         VALUES ($1, 'commission_earned', $2, $3, $4)`,
        [auth.branchId, commission, transactionId, auth.userId],
      );
    }
  }

  async list(auth: RequestAuthContext, filters: { network?: string; type?: string; query?: string; page: number; pageSize: number }) {
    return this.db.withTransaction(auth, async (client) => {
      const conditions: string[] = ['t.branch_id = $1'];
      const params: any[] = [auth.branchId];

      if (filters.network) {
        params.push(NETWORK_IDS[filters.network]);
        conditions.push(`t.network_id = $${params.length}`);
      }
      if (filters.type) {
        params.push(filters.type);
        conditions.push(`t.transaction_type = $${params.length}`);
      }
      if (filters.query) {
        params.push(`%${filters.query}%`);
        conditions.push(`(c.full_name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR t.id::text ILIKE $${params.length})`);
      }

      const whereClause = conditions.join(' AND ');
      const offset = (filters.page - 1) * filters.pageSize;

      params.push(filters.pageSize, offset);
      const results = await client.query(
        `SELECT t.id, t.transaction_type, n.code AS network_code, t.amount, t.commission, t.provider_commission, t.net_commission,
                t.status, t.created_at, c.full_name AS customer_name, c.phone AS customer_phone
         FROM transactions t
         JOIN networks n ON n.id = t.network_id
         LEFT JOIN customers c ON c.id = t.customer_id
         WHERE ${whereClause}
         ORDER BY t.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      const totalsParams = params.slice(0, params.length - 2);
      const totals = await client.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(t.amount),0) AS volume, COALESCE(SUM(t.commission),0) AS commission
         FROM transactions t
         JOIN networks n ON n.id = t.network_id
         LEFT JOIN customers c ON c.id = t.customer_id
         WHERE ${whereClause}`,
        totalsParams,
      );

      return {
        results: results.rows.map(mapTransactionRow),
        totals: {
          count: parseInt(totals.rows[0].count, 10),
          volume: totals.rows[0].volume,
          commission: totals.rows[0].commission,
        },
        page: filters.page,
        pageSize: filters.pageSize,
      };
    });
  }
}
