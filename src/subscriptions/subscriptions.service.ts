import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, RequestAuthContext } from '../database/database.service';
import { SubmitRenewalPaymentDto } from './dto/submit-renewal-payment.dto';
import { RejectRenewalPaymentDto } from './dto/reject-renewal-payment.dto';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';

// How long a single subscription period lasts, for both the initial
// approval (AdminService.approveOrganization) and every renewal here.
// Not currently part of platform_settings — the spec only calls the
// *price* and *grace period length* configurable, not the period
// length itself, which it consistently describes as monthly.
const SUBSCRIPTION_PERIOD_DAYS = 30;

const RENEWAL_ELIGIBLE_STATUSES = ['active', 'grace_period', 'suspended'];

@Injectable()
export class SubscriptionsService {
  constructor(private db: DatabaseService) {}

  async getStatus(auth: RequestAuthContext) {
    return this.db.withTransaction(auth, async (client) => {
      const orgResult = await client.query(
        `SELECT plan, status, subscription_expires_at FROM organizations WHERE id = $1`,
        [auth.organizationId],
      );
      const org = orgResult.rows[0];
      if (!org) throw new NotFoundException('Organization not found');

      const settingsResult = await client.query(
        `SELECT subscription_price_ghs, grace_period_days FROM platform_settings WHERE id = 1`,
      );
      const settings = settingsResult.rows[0];

      const expiresAt: Date | null = org.subscription_expires_at;
      const daysRemaining = expiresAt
        ? Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        plan: org.plan,
        status: org.status,
        subscriptionExpiresAt: expiresAt,
        daysRemaining,
        isInGracePeriod: org.status === 'grace_period',
        isSuspended: org.status === 'suspended',
        subscriptionPriceGhs: parseFloat(settings.subscription_price_ghs),
        gracePeriodDays: settings.grace_period_days,
      };
    });
  }

  /** Business Owner submits a renewal payment reference for review. */
  async submitRenewalPayment(auth: RequestAuthContext, dto: SubmitRenewalPaymentDto) {
    return this.db.withTransaction(auth, async (client) => {
      const orgResult = await client.query(`SELECT status FROM organizations WHERE id = $1`, [
        auth.organizationId,
      ]);
      const org = orgResult.rows[0];
      if (!org) throw new NotFoundException('Organization not found');
      if (!RENEWAL_ELIGIBLE_STATUSES.includes(org.status)) {
        throw new BadRequestException(
          `Cannot submit a renewal payment while your account is '${org.status}'.`,
        );
      }

      const result = await client.query(
        `INSERT INTO subscription_payments (organization_id, payment_reference, submitted_by)
         VALUES ($1, $2, $3)
         RETURNING id, created_at`,
        [auth.organizationId, dto.paymentReference, auth.userId],
      );

      return {
        id: result.rows[0].id,
        status: 'pending',
        message: 'Your renewal payment has been submitted for verification.',
        createdAt: result.rows[0].created_at,
      };
    });
  }

  async listMyRenewalPayments(auth: RequestAuthContext) {
    return this.db.withTransaction(auth, async (client) => {
      const result = await client.query(
        `SELECT id, payment_reference, status, rejection_reason, created_at, verified_at
         FROM subscription_payments
         WHERE organization_id = $1
         ORDER BY created_at DESC`,
        [auth.organizationId],
      );
      return result.rows.map(mapPaymentRow);
    });
  }

  async listPendingRenewalPayments() {
    return this.db.withSuperAdminContext(async (client) => {
      const result = await client.query(
        `SELECT p.id, p.organization_id, o.name AS organization_name, p.payment_reference,
                p.status, p.created_at
         FROM subscription_payments p
         JOIN organizations o ON o.id = p.organization_id
         WHERE p.status = 'pending'
         ORDER BY p.created_at ASC`,
      );
      return result.rows.map((row) => ({ ...mapPaymentRow(row), organizationName: row.organization_name }));
    });
  }

  /**
   * Verifying a renewal extends subscription_expires_at by one period
   * from whichever is LATER: the current expiry, or right now. That
   * "whichever is later" matters — renewing a few days early adds a
   * full period on top of remaining time rather than discarding it,
   * but renewing after expiry (having sat in grace_period or even
   * suspended) starts the new period from today rather than
   * compounding on top of a long-past expiry date.
   */
  async verifyRenewalPayment(auth: RequestAuthContext, paymentId: string) {
    return this.db.withSuperAdminContext(async (client) => {
      const paymentResult = await client.query(
        `SELECT id, organization_id, status FROM subscription_payments WHERE id = $1`,
        [paymentId],
      );
      const payment = paymentResult.rows[0];
      if (!payment) throw new NotFoundException('Renewal payment not found');
      if (payment.status !== 'pending') {
        throw new BadRequestException(`Cannot verify a payment with status '${payment.status}'`);
      }

      await client.query(
        `UPDATE subscription_payments
         SET status = 'verified', verified_by = $1, verified_at = now()
         WHERE id = $2`,
        [auth.userId, paymentId],
      );

      await client.query(
        `UPDATE organizations
         SET status = 'active',
             subscription_expires_at = GREATEST(now(), COALESCE(subscription_expires_at, now())) + ($1 || ' days')::interval
         WHERE id = $2`,
        [SUBSCRIPTION_PERIOD_DAYS, payment.organization_id],
      );

      return { message: 'Renewal payment verified. Subscription is active.', paymentId, status: 'verified' };
    });
  }

  async rejectRenewalPayment(auth: RequestAuthContext, paymentId: string, dto: RejectRenewalPaymentDto) {
    return this.db.withSuperAdminContext(async (client) => {
      const paymentResult = await client.query(`SELECT id, status FROM subscription_payments WHERE id = $1`, [
        paymentId,
      ]);
      const payment = paymentResult.rows[0];
      if (!payment) throw new NotFoundException('Renewal payment not found');
      if (payment.status !== 'pending') {
        throw new BadRequestException(`Cannot reject a payment with status '${payment.status}'`);
      }

      await client.query(
        `UPDATE subscription_payments
         SET status = 'rejected', verified_by = $1, verified_at = now(), rejection_reason = $2
         WHERE id = $3`,
        [auth.userId, dto.reason, paymentId],
      );

      return { message: 'Renewal payment rejected.', paymentId, status: 'rejected' };
    });
  }

  async getPlatformSettings() {
    return this.db.withoutRlsContext(async (client) => {
      const result = await client.query(
        `SELECT subscription_price_ghs, grace_period_days, updated_at FROM platform_settings WHERE id = 1`,
      );
      const row = result.rows[0];
      return {
        subscriptionPriceGhs: parseFloat(row.subscription_price_ghs),
        gracePeriodDays: row.grace_period_days,
        updatedAt: row.updated_at,
      };
    });
  }

  async updatePlatformSettings(auth: RequestAuthContext, dto: UpdatePlatformSettingsDto) {
    return this.db.withSuperAdminContext(async (client) => {
      const result = await client.query(
        `UPDATE platform_settings
         SET subscription_price_ghs = COALESCE($1, subscription_price_ghs),
             grace_period_days = COALESCE($2, grace_period_days),
             updated_by = $3,
             updated_at = now()
         WHERE id = 1
         RETURNING subscription_price_ghs, grace_period_days, updated_at`,
        [dto.subscriptionPriceGhs ?? null, dto.gracePeriodDays ?? null, auth.userId],
      );
      const row = result.rows[0];
      return {
        subscriptionPriceGhs: parseFloat(row.subscription_price_ghs),
        gracePeriodDays: row.grace_period_days,
        updatedAt: row.updated_at,
      };
    });
  }

  /**
   * The actual state-transition sweep: active -> grace_period once
   * past subscription_expires_at, then grace_period -> suspended once
   * past expiry + the platform's grace_period_days. Nothing in this
   * codebase calls this on a timer — there's no scheduler installed
   * (no @nestjs/schedule, no cron package) — so it's exposed as an
   * endpoint meant to be hit by an external scheduler (a Render Cron
   * Job or similar) once a day. Safe to call as often as you like:
   * every clause is a plain WHERE-scoped UPDATE, not incremental
   * state, so calling it twice in a row the same day is a no-op the
   * second time.
   */
  async runLifecycleCheck() {
    return this.db.withSuperAdminContext(async (client) => {
      const settingsResult = await client.query(`SELECT grace_period_days FROM platform_settings WHERE id = 1`);
      const gracePeriodDays = settingsResult.rows[0].grace_period_days;

      const toGracePeriod = await client.query(
        `UPDATE organizations
         SET status = 'grace_period'
         WHERE status = 'active' AND subscription_expires_at IS NOT NULL AND subscription_expires_at < now()
         RETURNING id`,
      );

      const toSuspended = await client.query(
        `UPDATE organizations
         SET status = 'suspended'
         WHERE status = 'grace_period'
           AND subscription_expires_at IS NOT NULL
           AND subscription_expires_at + ($1 || ' days')::interval < now()
         RETURNING id`,
        [gracePeriodDays],
      );

      return {
        movedToGracePeriod: toGracePeriod.rows.length,
        movedToSuspended: toSuspended.rows.length,
      };
    });
  }
}

function mapPaymentRow(row: any) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    paymentReference: row.payment_reference,
    status: row.status,
    rejectionReason: row.rejection_reason ?? null,
    createdAt: row.created_at,
    verifiedAt: row.verified_at ?? null,
  };
}
