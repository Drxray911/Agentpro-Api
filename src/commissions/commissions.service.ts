import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService, RequestAuthContext } from '../database/database.service';
import { CommissionRateUpdateItem } from './dto/update-commission-rates.dto';
import { SetCommissionRatesDto } from './dto/set-commission-rates.dto';
import { RequestCommissionRateDto } from './dto/request-commission-rate.dto';
import { RejectCommissionRateRequestDto } from './dto/reject-commission-rate-request.dto';

const NETWORK_IDS: Record<string, number> = { MTN: 1, TELECEL: 2, AT: 3 };
const NETWORK_CODES_BY_ID: Record<number, string> = { 1: 'MTN', 2: 'TELECEL', 3: 'AT' };

function toDecimalPercent(value: number | undefined): number | null {
  return value === undefined ? null : value / 100;
}

@Injectable()
export class CommissionsService {
  constructor(private db: DatabaseService) {}

  /**
   * Branch-specific active rates, plus platform defaults filled in for
   * any network/transactionType combo the branch has no custom rate
   * for — so the settings screen shows what will actually apply,
   * exactly matching the fallback TransactionsService.create() uses.
   */
  async getActiveRates(auth: RequestAuthContext) {
    return this.db.withTransaction(auth, async (client) => {
      const branchRows = await client.query(
        `SELECT network_id, transaction_type, rate_percent, threshold_amount, cap_amount, provider_share_percent, effective_from
         FROM v_active_commission_rates
         WHERE branch_id = $1`,
        [auth.branchId],
      );

      const defaultRows = await client.query(
        `SELECT network_id, transaction_type, rate_percent, threshold_amount, cap_amount, provider_share_percent, effective_from
         FROM platform_commission_defaults
         WHERE effective_to IS NULL`,
      );

      const covered = new Set(branchRows.rows.map((r) => `${r.network_id}:${r.transaction_type}`));

      const mapRow = (row: any, source: 'custom' | 'platform_default') => ({
        network: NETWORK_CODES_BY_ID[row.network_id],
        transactionType: row.transaction_type,
        ratePercent: parseFloat(row.rate_percent) * 100,
        thresholdAmount: row.threshold_amount !== null ? parseFloat(row.threshold_amount) : null,
        capAmount: row.cap_amount !== null ? parseFloat(row.cap_amount) : null,
        providerSharePercent: parseFloat(row.provider_share_percent) * 100,
        effectiveFrom: row.effective_from,
        source,
      });

      const result = branchRows.rows.map((r) => mapRow(r, 'custom'));
      for (const row of defaultRows.rows) {
        if (!covered.has(`${row.network_id}:${row.transaction_type}`)) {
          result.push(mapRow(row, 'platform_default'));
        }
      }
      return result;
    });
  }

  /**
   * Superuser-only direct rate assignment. Unlike the old version of
   * this method, the caller isn't assumed to belong to the org/branch
   * being updated — a Superuser has neither, so the target is named
   * explicitly. If dto.branchId is omitted, the rate applies to every
   * branch under dto.organizationId at once.
   */
  async setRatesForOrganization(auth: RequestAuthContext, dto: SetCommissionRatesDto) {
    return this.db.withSuperAdminContext(async (client) => {
      const branchIds = await this.resolveBranchIds(client, dto.organizationId, dto.branchId);
      if (branchIds.length === 0) {
        throw new NotFoundException('No branches found for this organization');
      }

      const updated: any[] = [];
      for (const branchId of branchIds) {
        for (const item of dto.items) {
          updated.push(await this.upsertBranchRate(client, branchId, item, auth.userId));
        }
      }
      return updated;
    });
  }

  /** Superuser-only: platform-wide fallback rates. */
  async setPlatformDefaults(auth: RequestAuthContext, items: CommissionRateUpdateItem[]) {
    return this.db.withSuperAdminContext(async (client) => {
      const updated: any[] = [];
      for (const item of items) {
        const networkId = NETWORK_IDS[item.network];

        await client.query(
          `UPDATE platform_commission_defaults
           SET effective_to = now()
           WHERE network_id = $1 AND transaction_type = $2 AND effective_to IS NULL`,
          [networkId, item.transactionType],
        );

        const inserted = await client.query(
          `INSERT INTO platform_commission_defaults
             (network_id, transaction_type, rate_percent, threshold_amount, cap_amount, provider_share_percent, effective_from, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
           RETURNING rate_percent, threshold_amount, cap_amount, provider_share_percent, effective_from`,
          [
            networkId,
            item.transactionType,
            item.ratePercent / 100,
            item.thresholdAmount ?? null,
            item.capAmount ?? null,
            toDecimalPercent(item.providerSharePercent) ?? 0,
            auth.userId,
          ],
        );

        const row = inserted.rows[0];
        updated.push({
          network: item.network,
          transactionType: item.transactionType,
          ratePercent: parseFloat(row.rate_percent) * 100,
          thresholdAmount: row.threshold_amount !== null ? parseFloat(row.threshold_amount) : null,
          capAmount: row.cap_amount !== null ? parseFloat(row.cap_amount) : null,
          providerSharePercent: parseFloat(row.provider_share_percent) * 100,
          effectiveFrom: row.effective_from,
        });
      }
      return updated;
    });
  }

  async getPlatformDefaults() {
    return this.db.withSuperAdminContext(async (client) => {
      const result = await client.query(
        `SELECT network_id, transaction_type, rate_percent, threshold_amount, cap_amount, provider_share_percent, effective_from
         FROM platform_commission_defaults
         WHERE effective_to IS NULL`,
      );
      return result.rows.map((row) => ({
        network: NETWORK_CODES_BY_ID[row.network_id],
        transactionType: row.transaction_type,
        ratePercent: parseFloat(row.rate_percent) * 100,
        thresholdAmount: row.threshold_amount !== null ? parseFloat(row.threshold_amount) : null,
        capAmount: row.cap_amount !== null ? parseFloat(row.cap_amount) : null,
        providerSharePercent: parseFloat(row.provider_share_percent) * 100,
        effectiveFrom: row.effective_from,
      }));
    });
  }

  /**
   * Business Owner submits a proposed custom rate for their own
   * organization. Runs through the normal RLS-scoped transaction (not
   * withoutRlsContext) — commission_rate_requests_insert enforces
   * organization_id = app_current_org_id() at the database level too,
   * so this can't be used to submit a request on another org's behalf
   * even if the auth context were somehow wrong.
   */
  async submitRateRequest(auth: RequestAuthContext, dto: RequestCommissionRateDto) {
    return this.db.withTransaction(auth, async (client) => {
      const networkId = NETWORK_IDS[dto.network];
      const result = await client.query(
        `INSERT INTO commission_rate_requests
           (organization_id, network_id, transaction_type, rate_percent, threshold_amount, cap_amount, provider_share_percent, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, created_at`,
        [
          auth.organizationId,
          networkId,
          dto.transactionType,
          dto.ratePercent / 100,
          dto.thresholdAmount ?? null,
          dto.capAmount ?? null,
          toDecimalPercent(dto.providerSharePercent) ?? 0,
          auth.userId,
        ],
      );
      return {
        id: result.rows[0].id,
        status: 'pending',
        message: 'Your custom commission rate request has been submitted for Superuser review.',
        createdAt: result.rows[0].created_at,
      };
    });
  }

  /** Business Owner's own pending/past requests. RLS-scoped to their org. */
  async listMyRateRequests(auth: RequestAuthContext) {
    return this.db.withTransaction(auth, async (client) => {
      const result = await client.query(
        `SELECT id, network_id, transaction_type, rate_percent, threshold_amount, cap_amount,
                provider_share_percent, status, rejection_reason, created_at, reviewed_at
         FROM commission_rate_requests
         WHERE organization_id = $1
         ORDER BY created_at DESC`,
        [auth.organizationId],
      );
      return result.rows.map(mapRequestRow);
    });
  }

  /** Superuser: every pending request, across every organization. */
  async listPendingRateRequests() {
    return this.db.withSuperAdminContext(async (client) => {
      const result = await client.query(
        `SELECT r.id, r.organization_id, o.name AS organization_name, r.network_id, r.transaction_type,
                r.rate_percent, r.threshold_amount, r.cap_amount, r.provider_share_percent,
                r.status, r.created_at
         FROM commission_rate_requests r
         JOIN organizations o ON o.id = r.organization_id
         WHERE r.status = 'pending'
         ORDER BY r.created_at ASC`,
      );
      return result.rows.map((row) => ({ ...mapRequestRow(row), organizationName: row.organization_name }));
    });
  }

  /**
   * Approving a request applies the approved rate to every branch in
   * the requesting organization — mirroring setRatesForOrganization's
   * "no branchId means all branches" behavior, since a commission
   * rate request is inherently org-wide, not branch-specific.
   */
  async approveRateRequest(auth: RequestAuthContext, requestId: string) {
    return this.db.withSuperAdminContext(async (client) => {
      const reqResult = await client.query(
        `SELECT id, organization_id, network_id, transaction_type, rate_percent, threshold_amount, cap_amount, provider_share_percent, status
         FROM commission_rate_requests WHERE id = $1`,
        [requestId],
      );
      const request = reqResult.rows[0];
      if (!request) throw new NotFoundException('Commission rate request not found');
      if (request.status !== 'pending') {
        throw new BadRequestException(`Cannot approve a request with status '${request.status}'`);
      }

      const branchIds = await this.resolveBranchIds(client, request.organization_id, undefined);

      const item: CommissionRateUpdateItem = {
        network: NETWORK_CODES_BY_ID[request.network_id],
        transactionType: request.transaction_type,
        ratePercent: parseFloat(request.rate_percent) * 100,
        thresholdAmount: request.threshold_amount !== null ? parseFloat(request.threshold_amount) : undefined,
        capAmount: request.cap_amount !== null ? parseFloat(request.cap_amount) : undefined,
        providerSharePercent: parseFloat(request.provider_share_percent) * 100,
      };

      for (const branchId of branchIds) {
        await this.upsertBranchRate(client, branchId, item, auth.userId);
      }

      await client.query(
        `UPDATE commission_rate_requests
         SET status = 'approved', reviewed_by = $1, reviewed_at = now()
         WHERE id = $2`,
        [auth.userId, requestId],
      );

      return { message: 'Commission rate request approved and applied.', requestId, status: 'approved' };
    });
  }

  async rejectRateRequest(auth: RequestAuthContext, requestId: string, dto: RejectCommissionRateRequestDto) {
    return this.db.withSuperAdminContext(async (client) => {
      const reqResult = await client.query(`SELECT id, status FROM commission_rate_requests WHERE id = $1`, [
        requestId,
      ]);
      const request = reqResult.rows[0];
      if (!request) throw new NotFoundException('Commission rate request not found');
      if (request.status !== 'pending') {
        throw new BadRequestException(`Cannot reject a request with status '${request.status}'`);
      }

      await client.query(
        `UPDATE commission_rate_requests
         SET status = 'rejected', reviewed_by = $1, reviewed_at = now(), rejection_reason = $2
         WHERE id = $3`,
        [auth.userId, dto.reason, requestId],
      );

      return { message: 'Commission rate request rejected.', requestId, status: 'rejected' };
    });
  }

  private async resolveBranchIds(
    client: PoolClient,
    organizationId: string,
    branchId: string | undefined,
  ): Promise<string[]> {
    if (branchId) return [branchId];
    const result = await client.query(`SELECT id FROM branches WHERE organization_id = $1`, [organizationId]);
    return result.rows.map((r) => r.id);
  }

  private async upsertBranchRate(
    client: PoolClient,
    branchId: string,
    item: CommissionRateUpdateItem,
    createdBy: string,
  ) {
    const networkId = NETWORK_IDS[item.network];
    const rateDecimal = item.ratePercent / 100;

    // Close the currently active rate, if one exists. Versioned, not
    // overwritten in place — a transaction recorded before this change
    // keeps showing the rate that was actually active when it
    // happened, because that rate's row is never edited or deleted,
    // only marked as no-longer-current via effective_to.
    await client.query(
      `UPDATE commission_rates
       SET effective_to = now()
       WHERE branch_id = $1 AND network_id = $2 AND transaction_type = $3
         AND effective_to IS NULL`,
      [branchId, networkId, item.transactionType],
    );

    const inserted = await client.query(
      `INSERT INTO commission_rates
         (branch_id, network_id, transaction_type, rate_percent, threshold_amount, cap_amount, provider_share_percent, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)
       RETURNING rate_percent, threshold_amount, cap_amount, provider_share_percent, effective_from`,
      [
        branchId,
        networkId,
        item.transactionType,
        rateDecimal,
        item.thresholdAmount ?? null,
        item.capAmount ?? null,
        toDecimalPercent(item.providerSharePercent) ?? 0,
        createdBy,
      ],
    );

    const row = inserted.rows[0];
    return {
      branchId,
      network: item.network,
      transactionType: item.transactionType,
      ratePercent: parseFloat(row.rate_percent) * 100,
      thresholdAmount: row.threshold_amount !== null ? parseFloat(row.threshold_amount) : null,
      capAmount: row.cap_amount !== null ? parseFloat(row.cap_amount) : null,
      providerSharePercent: parseFloat(row.provider_share_percent) * 100,
      effectiveFrom: row.effective_from,
    };
  }
}

function mapRequestRow(row: any) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    network: NETWORK_CODES_BY_ID[row.network_id],
    transactionType: row.transaction_type,
    ratePercent: parseFloat(row.rate_percent) * 100,
    thresholdAmount: row.threshold_amount !== null ? parseFloat(row.threshold_amount) : null,
    capAmount: row.cap_amount !== null ? parseFloat(row.cap_amount) : null,
    providerSharePercent: parseFloat(row.provider_share_percent) * 100,
    status: row.status,
    rejectionReason: row.rejection_reason ?? null,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at ?? null,
  };
}
