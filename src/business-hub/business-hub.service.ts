import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, RequestAuthContext } from '../database/database.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { RejectListingContentDto } from './dto/reject-listing-content.dto';
import { SubmitListingPaymentDto } from './dto/submit-listing-payment.dto';
import { RejectListingPaymentDto } from './dto/reject-listing-payment.dto';

const LISTING_DURATION_DAYS = 30;

// A listing can accept a payment submission in any of these states:
// pending_payment (first publication, or after a rejected payment)
// active/expired (renewal, including during the grace period).
const PAYMENT_ELIGIBLE_STATUSES = ['pending_payment', 'active', 'expired'];

@Injectable()
export class BusinessHubService {
  constructor(private db: DatabaseService) {}

  /** Business Owner creates a new listing. Starts in pending_review. */
  async createListing(auth: RequestAuthContext, dto: CreateListingDto) {
    return this.db.withTransaction(auth, async (client) => {
      const result = await client.query(
        `INSERT INTO business_hub_listings
           (organization_id, created_by, title, description, price_ghs, category, location, image_urls, video_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, created_at`,
        [
          auth.organizationId,
          auth.userId,
          dto.title,
          dto.description,
          dto.priceGhs,
          dto.category,
          dto.location,
          JSON.stringify(dto.imageUrls ?? []),
          dto.videoUrl ?? null,
        ],
      );
      return {
        id: result.rows[0].id,
        status: 'pending_review',
        message: 'Your listing has been submitted for review.',
        createdAt: result.rows[0].created_at,
      };
    });
  }

  /**
   * Public browsing — every published listing across every
   * organization. Relies entirely on RLS (business_hub_listings_select_published)
   * rather than a WHERE clause here, since that's the same guarantee
   * every caller gets regardless of role.
   */
  async browseListings(auth: RequestAuthContext, category?: string, location?: string) {
    return this.db.withTransaction(auth, async (client) => {
      const conditions = [`status = 'active'`];
      const params: any[] = [];
      if (category) {
        params.push(category);
        conditions.push(`category = $${params.length}`);
      }
      if (location) {
        params.push(location);
        conditions.push(`location = $${params.length}`);
      }
      const result = await client.query(
        `SELECT id, organization_id, title, description, price_ghs, category, location, image_urls, video_url,
                published_at, expires_at
         FROM business_hub_listings
         WHERE ${conditions.join(' AND ')}
         ORDER BY published_at DESC`,
        params,
      );
      return result.rows.map(mapListingRow);
    });
  }

  /** Business Owner's own listings, every status. */
  async listMyListings(auth: RequestAuthContext) {
    return this.db.withTransaction(auth, async (client) => {
      const result = await client.query(
        `SELECT id, organization_id, title, description, price_ghs, category, location, image_urls, video_url,
                status, rejection_reason, fee_ghs, published_at, expires_at, created_at
         FROM business_hub_listings
         WHERE organization_id = $1
         ORDER BY created_at DESC`,
        [auth.organizationId],
      );
      return result.rows.map(mapListingRow);
    });
  }

  /** Superuser: every listing awaiting content review, across every organization. */
  async listPendingReview() {
    return this.db.withSuperAdminContext(async (client) => {
      const result = await client.query(
        `SELECT l.id, l.organization_id, o.name AS organization_name, l.title, l.description,
                l.price_ghs, l.category, l.location, l.image_urls, l.video_url, l.created_at
         FROM business_hub_listings l
         JOIN organizations o ON o.id = l.organization_id
         WHERE l.status = 'pending_review'
         ORDER BY l.created_at ASC`,
      );
      return result.rows.map((row) => ({ ...mapListingRow(row), organizationName: row.organization_name }));
    });
  }

  /**
   * Approving content calculates the publishing fee from the
   * platform's current advertisement_fee_percent and snapshots it onto
   * the listing — later changes to the platform-wide fee percentage
   * must not retroactively change what an already-approved listing
   * owes.
   */
  async approveContent(auth: RequestAuthContext, listingId: string) {
    return this.db.withSuperAdminContext(async (client) => {
      const listing = await this.getListingOrThrow(client, listingId);
      if (listing.status !== 'pending_review') {
        throw new BadRequestException(`Cannot approve content for a listing with status '${listing.status}'`);
      }

      const settingsResult = await client.query(`SELECT advertisement_fee_percent FROM platform_settings WHERE id = 1`);
      const feePercent = parseFloat(settingsResult.rows[0].advertisement_fee_percent);
      const feeGhs = Math.round(parseFloat(listing.price_ghs) * feePercent * 100) / 100;

      await client.query(
        `UPDATE business_hub_listings
         SET status = 'pending_payment', fee_ghs = $1, reviewed_by = $2, reviewed_at = now(),
             rejection_reason = NULL
         WHERE id = $3`,
        [feeGhs, auth.userId, listingId],
      );

      return {
        message: `Listing content approved. Publishing fee: GH₵${feeGhs.toFixed(2)}.`,
        listingId,
        status: 'pending_payment',
        feeGhs,
      };
    });
  }

  async rejectContent(auth: RequestAuthContext, listingId: string, dto: RejectListingContentDto) {
    return this.db.withSuperAdminContext(async (client) => {
      const listing = await this.getListingOrThrow(client, listingId);
      if (listing.status !== 'pending_review') {
        throw new BadRequestException(`Cannot reject content for a listing with status '${listing.status}'`);
      }

      await client.query(
        `UPDATE business_hub_listings
         SET status = 'rejected', rejection_reason = $1, reviewed_by = $2, reviewed_at = now()
         WHERE id = $3`,
        [dto.reason, auth.userId, listingId],
      );

      return { message: 'Listing content rejected.', listingId, status: 'rejected' };
    });
  }

  /** Business Owner submits the publishing fee payment reference. */
  async submitPayment(auth: RequestAuthContext, listingId: string, dto: SubmitListingPaymentDto) {
    return this.db.withTransaction(auth, async (client) => {
      const listingResult = await client.query(
        `SELECT id, status, organization_id FROM business_hub_listings WHERE id = $1`,
        [listingId],
      );
      const listing = listingResult.rows[0];
      if (!listing) throw new NotFoundException('Listing not found');
      if (listing.organization_id !== auth.organizationId) {
        throw new NotFoundException('Listing not found');
      }
      if (!PAYMENT_ELIGIBLE_STATUSES.includes(listing.status)) {
        throw new BadRequestException(`Cannot submit a payment for a listing with status '${listing.status}'`);
      }

      const result = await client.query(
        `INSERT INTO business_hub_listing_payments (listing_id, payment_reference, submitted_by)
         VALUES ($1, $2, $3)
         RETURNING id, created_at`,
        [listingId, dto.paymentReference, auth.userId],
      );

      return {
        id: result.rows[0].id,
        status: 'pending',
        message: 'Your payment has been submitted for verification.',
        createdAt: result.rows[0].created_at,
      };
    });
  }

  /** Superuser: every listing payment awaiting verification, across every organization. */
  async listPendingPayments() {
    return this.db.withSuperAdminContext(async (client) => {
      const result = await client.query(
        `SELECT p.id, p.listing_id, l.title AS listing_title, o.name AS organization_name,
                p.payment_reference, p.status, p.created_at
         FROM business_hub_listing_payments p
         JOIN business_hub_listings l ON l.id = p.listing_id
         JOIN organizations o ON o.id = l.organization_id
         WHERE p.status = 'pending'
         ORDER BY p.created_at ASC`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        listingId: row.listing_id,
        listingTitle: row.listing_title,
        organizationName: row.organization_name,
        paymentReference: row.payment_reference,
        status: row.status,
        createdAt: row.created_at,
      }));
    });
  }

  /**
   * Verifying publishes (or renews) the listing: expires_at extends by
   * one 30-day period from whichever is later — now, or the current
   * expiry — same "don't discard remaining time, don't compound past
   * expiry" logic as SubscriptionsService.verifyRenewalPayment.
   * published_at is set once, on first publication, and never moves.
   */
  async verifyPayment(auth: RequestAuthContext, paymentId: string) {
    return this.db.withSuperAdminContext(async (client) => {
      const paymentResult = await client.query(
        `SELECT id, listing_id, status FROM business_hub_listing_payments WHERE id = $1`,
        [paymentId],
      );
      const payment = paymentResult.rows[0];
      if (!payment) throw new NotFoundException('Listing payment not found');
      if (payment.status !== 'pending') {
        throw new BadRequestException(`Cannot verify a payment with status '${payment.status}'`);
      }

      await client.query(
        `UPDATE business_hub_listing_payments
         SET status = 'verified', verified_by = $1, verified_at = now()
         WHERE id = $2`,
        [auth.userId, paymentId],
      );

      await client.query(
        `UPDATE business_hub_listings
         SET status = 'active',
             published_at = COALESCE(published_at, now()),
             expires_at = GREATEST(now(), COALESCE(expires_at, now())) + ($1 || ' days')::interval
         WHERE id = $2`,
        [LISTING_DURATION_DAYS, payment.listing_id],
      );

      return { message: 'Payment verified. Listing is now published.', paymentId, status: 'verified' };
    });
  }

  async rejectPayment(auth: RequestAuthContext, paymentId: string, dto: RejectListingPaymentDto) {
    return this.db.withSuperAdminContext(async (client) => {
      const paymentResult = await client.query(
        `SELECT id, status FROM business_hub_listing_payments WHERE id = $1`,
        [paymentId],
      );
      const payment = paymentResult.rows[0];
      if (!payment) throw new NotFoundException('Listing payment not found');
      if (payment.status !== 'pending') {
        throw new BadRequestException(`Cannot reject a payment with status '${payment.status}'`);
      }

      await client.query(
        `UPDATE business_hub_listing_payments
         SET status = 'rejected', verified_by = $1, verified_at = now(), rejection_reason = $2
         WHERE id = $3`,
        [auth.userId, dto.reason, paymentId],
      );

      return { message: 'Listing payment rejected.', paymentId, status: 'rejected' };
    });
  }

  /**
   * active -> expired once past expires_at, then expired -> closed
   * once past expires_at + business_hub_grace_period_days. 'closed' is
   * terminal — per spec, renewal after the grace period needs a brand
   * new submission (full content re-review), not just a new payment.
   * Same cron-callable shape as SubscriptionsService.runLifecycleCheck.
   */
  async runLifecycleCheck() {
    return this.db.withSuperAdminContext(async (client) => {
      const settingsResult = await client.query(
        `SELECT business_hub_grace_period_days FROM platform_settings WHERE id = 1`,
      );
      const gracePeriodDays = settingsResult.rows[0].business_hub_grace_period_days;

      const toExpired = await client.query(
        `UPDATE business_hub_listings
         SET status = 'expired'
         WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now()
         RETURNING id`,
      );

      const toClosed = await client.query(
        `UPDATE business_hub_listings
         SET status = 'closed'
         WHERE status = 'expired'
           AND expires_at IS NOT NULL
           AND expires_at + ($1 || ' days')::interval < now()
         RETURNING id`,
        [gracePeriodDays],
      );

      return { movedToExpired: toExpired.rows.length, movedToClosed: toClosed.rows.length };
    });
  }

  private async getListingOrThrow(client: any, listingId: string) {
    const result = await client.query(
      `SELECT id, status, price_ghs FROM business_hub_listings WHERE id = $1`,
      [listingId],
    );
    const listing = result.rows[0];
    if (!listing) throw new NotFoundException('Listing not found');
    return listing;
  }
}

function mapListingRow(row: any) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    description: row.description,
    priceGhs: row.price_ghs !== undefined ? parseFloat(row.price_ghs) : undefined,
    category: row.category,
    location: row.location,
    imageUrls: row.image_urls ?? [],
    videoUrl: row.video_url ?? null,
    status: row.status,
    rejectionReason: row.rejection_reason ?? undefined,
    feeGhs: row.fee_ghs !== undefined && row.fee_ghs !== null ? parseFloat(row.fee_ghs) : undefined,
    publishedAt: row.published_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at ?? undefined,
  };
}
