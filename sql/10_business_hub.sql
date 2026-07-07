-- =====================================================================
-- Migration 09: Business Hub (spec section 11, "Market Centre" —
-- renamed to Business Hub throughout the product).
-- =====================================================================
-- Workflow per spec:
--   User submits listing -> Pending Review -> Superuser reviews content
--   -> Approved: publishing fee = advertisement_fee_percent of the
--   advertised price is calculated -> User pays via MTN MoMo, submits
--   reference -> Superuser verifies payment -> Published (30-day
--   duration, configurable grace period, renewal needs a new payment).
--
-- Design notes:
--   * Two-stage approval, deliberately two different tables:
--     business_hub_listings.status carries the CONTENT review outcome
--     (pending_review / rejected / pending_payment / active / expired
--     / closed); business_hub_listing_payments is a separate,
--     append-only history of payment attempts for that listing —
--     mirroring subscription_payments from migration 08 for the same
--     reason: a listing can have multiple payment submissions (e.g.
--     one rejected, then a corrected resubmission, then later a
--     renewal), and a single column pair would overwrite that history
--     each time rather than preserving it.
--   * Visibility is genuinely cross-organization for published
--     listings — unlike every other table so far, "browse the
--     marketplace" means seeing every business's active listings, not
--     just your own. See the RLS policies below: an org sees its own
--     listings in every status, but ANY authenticated org sees other
--     orgs' listings once (and only once) they're 'active'.
--   * Image/video storage: this migration only stores URLs
--     (image_urls, video_url) as plain text — actual file upload
--     (e.g. to Cloudinary, per the spec's hosting recommendation)
--     isn't wired into this codebase yet. The API expects the client
--     to already have a hosted URL to submit; there's no upload
--     endpoint here.
--   * advertisement_fee_percent joins subscription_price_ghs and
--     grace_period_days on the existing single-row platform_settings
--     table rather than a new table, for the same reason those two
--     live there: a handful of platform-wide knobs, not enough to
--     warrant a key-value table.
--   * business_hub_grace_period_days is deliberately separate from
--     subscription_lifecycle's grace_period_days (migration 08) even
--     though both default to 7 — spec section 10 and section 11 each
--     describe grace periods as their own configurable value for a
--     different kind of lifecycle (subscription vs. listing), and
--     conflating the two would mean changing one always changes the
--     other, which the spec never asks for.
-- =====================================================================

ALTER TABLE platform_settings
    ADD COLUMN advertisement_fee_percent    NUMERIC(6,4) NOT NULL DEFAULT 0.01,
    ADD COLUMN business_hub_grace_period_days INTEGER NOT NULL DEFAULT 7;

CREATE TYPE business_hub_listing_status AS ENUM (
    'pending_review',
    'rejected',
    'pending_payment',
    'active',
    'expired',
    'closed'      -- past the grace period with no renewal; needs a brand-new submission, not just a payment
);

CREATE TABLE business_hub_listings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by        UUID NOT NULL REFERENCES users(id),
    title             VARCHAR(150) NOT NULL,
    description       TEXT NOT NULL,
    price_ghs         NUMERIC(12,2) NOT NULL CHECK (price_ghs >= 0),
    category          VARCHAR(80) NOT NULL,
    location          VARCHAR(150) NOT NULL,
    image_urls        JSONB NOT NULL DEFAULT '[]'::jsonb,
    video_url         TEXT,
    status            business_hub_listing_status NOT NULL DEFAULT 'pending_review',
    rejection_reason  VARCHAR(255),
    fee_ghs           NUMERIC(10,2),              -- snapshotted at content-approval time, from advertisement_fee_percent
    reviewed_by       UUID REFERENCES users(id),
    reviewed_at       TIMESTAMPTZ,
    published_at      TIMESTAMPTZ,
    expires_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_business_hub_listings_org ON business_hub_listings(organization_id);
CREATE INDEX idx_business_hub_listings_status ON business_hub_listings(status);

CREATE TYPE business_hub_payment_status AS ENUM ('pending', 'verified', 'rejected');

CREATE TABLE business_hub_listing_payments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id        UUID NOT NULL REFERENCES business_hub_listings(id) ON DELETE CASCADE,
    payment_reference VARCHAR(100) NOT NULL,
    status            business_hub_payment_status NOT NULL DEFAULT 'pending',
    submitted_by      UUID NOT NULL REFERENCES users(id),
    verified_by       UUID REFERENCES users(id),
    verified_at       TIMESTAMPTZ,
    rejection_reason  VARCHAR(255),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_business_hub_listing_payments_listing ON business_hub_listing_payments(listing_id, status);

ALTER TABLE business_hub_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_hub_listings FORCE ROW LEVEL SECURITY;
ALTER TABLE business_hub_listing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_hub_listing_payments FORCE ROW LEVEL SECURITY;

-- Two permissive SELECT policies, combined with OR (Postgres RLS
-- default for multiple permissive policies on the same command): an
-- org sees every one of ITS OWN listings regardless of status, and
-- everyone (any org) sees any listing that's 'active' — that second
-- policy is what makes "browse the marketplace" actually cross-org.
CREATE POLICY business_hub_listings_select_own_org ON business_hub_listings
    FOR SELECT
    USING (organization_id = app_current_org_id());

CREATE POLICY business_hub_listings_select_published ON business_hub_listings
    FOR SELECT
    USING (status = 'active');

-- Only a Business Owner may create a listing on behalf of their
-- organization — Agents can browse (via the two SELECT policies
-- above) but not post, matching how every other org-configuration
-- write path (commission rates, float rules) is owner-only.
CREATE POLICY business_hub_listings_insert ON business_hub_listings
    FOR INSERT
    WITH CHECK (organization_id = app_current_org_id() AND app_is_org_wide_role());

-- Superuser cross-org access for content review, publishing, and the
-- lifecycle sweep (active -> expired -> closed). Needed via
-- DatabaseService.withSuperAdminContext() — organization_id can never
-- equal app_current_org_id() for a Superuser who isn't scoped to one
-- org, so this has to be its own policy rather than an addition to
-- the owner-scoped ones above. FOR ALL covers the UPDATE this role
-- needs (approve/reject/publish/expire) in the same policy as SELECT,
-- since a Superuser reviewing pending_review listings from every
-- organization needs both.
CREATE POLICY business_hub_listings_super_admin_all ON business_hub_listings
    FOR ALL
    USING (current_setting('app.current_user_role', true) = 'super_admin')
    WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');

CREATE POLICY business_hub_listing_payments_select ON business_hub_listing_payments
    FOR SELECT
    USING (
        app_is_org_wide_role()
        AND listing_id IN (SELECT id FROM business_hub_listings WHERE organization_id = app_current_org_id())
    );

CREATE POLICY business_hub_listing_payments_insert ON business_hub_listing_payments
    FOR INSERT
    WITH CHECK (
        app_is_org_wide_role()
        AND listing_id IN (SELECT id FROM business_hub_listings WHERE organization_id = app_current_org_id())
    );

CREATE POLICY business_hub_listing_payments_super_admin_all ON business_hub_listing_payments
    FOR ALL
    USING (current_setting('app.current_user_role', true) = 'super_admin')
    WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');
