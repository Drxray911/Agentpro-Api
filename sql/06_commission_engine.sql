-- =====================================================================
-- Migration 06: Tiered/capped commission engine, provider share,
-- platform-wide defaults, and the Business Owner -> Superuser custom
-- rate request workflow (spec section 8).
-- =====================================================================
-- Design notes:
--   * Tiering here is NOT marginal/bracket-based (like income tax
--     brackets) — it's the simpler two-state model the spec describes:
--     amount <= threshold_amount -> commission = amount * rate_percent
--     amount >  threshold_amount -> commission = cap_amount (a flat
--     capped commission, not "rate applied only above the threshold").
--     Both threshold_amount and cap_amount are nullable — NULL means
--     "no cap tier configured", so existing flat-rate rows keep working
--     exactly as before with zero behavior change.
--   * provider_share_percent captures the cut MTN/Telecel/AT takes out
--     of the GROSS commission; the business's NET commission is what's
--     actually recorded as owed to them. Existing transactions.commission
--     keeps meaning gross commission (no semantic change, nothing that
--     reads it needs updating) — provider_commission and net_commission
--     are new columns alongside it.
--   * platform_commission_defaults is intentionally a separate table
--     from commission_rates rather than a nullable branch_id on the
--     same table: a platform default is not "a branch's rate", it's a
--     fallback with no branch at all, and keeping it separate avoids
--     every existing commission_rates query needing a
--     "WHERE branch_id = X OR branch_id IS NULL" fallback clause.
--   * commission_rate_requests is per-organization (not per-branch) —
--     the spec frames custom rate requests as something "Business
--     Owners" request, org-wide, not something requested per-branch.
--     On approval, the service applies the approved rate to every
--     branch in that organization (see CommissionsService).
-- =====================================================================

ALTER TABLE commission_rates
    ADD COLUMN threshold_amount      NUMERIC(14,2),
    ADD COLUMN cap_amount            NUMERIC(14,2),
    ADD COLUMN provider_share_percent NUMERIC(6,4) NOT NULL DEFAULT 0
        CHECK (provider_share_percent >= 0 AND provider_share_percent <= 1);

ALTER TABLE transactions
    ADD COLUMN provider_commission NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN net_commission      NUMERIC(14,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- Platform-wide default commission rates (Superuser-managed, apply to
-- any branch that has no active custom commission_rates row).
-- ---------------------------------------------------------------------
CREATE TABLE platform_commission_defaults (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id              SMALLINT NOT NULL REFERENCES networks(id),
    transaction_type        transaction_type NOT NULL,
    rate_percent            NUMERIC(6,4) NOT NULL CHECK (rate_percent >= 0),
    threshold_amount        NUMERIC(14,2),
    cap_amount              NUMERIC(14,2),
    provider_share_percent  NUMERIC(6,4) NOT NULL DEFAULT 0
        CHECK (provider_share_percent >= 0 AND provider_share_percent <= 1),
    effective_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to            TIMESTAMPTZ,
    created_by              UUID REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_platform_commission_defaults_one_active
    ON platform_commission_defaults(network_id, transaction_type)
    WHERE effective_to IS NULL;

-- ---------------------------------------------------------------------
-- Custom commission rate requests (Business Owner -> Superuser)
-- ---------------------------------------------------------------------
CREATE TYPE commission_request_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE commission_rate_requests (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    network_id              SMALLINT NOT NULL REFERENCES networks(id),
    transaction_type        transaction_type NOT NULL,
    rate_percent            NUMERIC(6,4) NOT NULL CHECK (rate_percent >= 0),
    threshold_amount        NUMERIC(14,2),
    cap_amount              NUMERIC(14,2),
    provider_share_percent  NUMERIC(6,4) NOT NULL DEFAULT 0
        CHECK (provider_share_percent >= 0 AND provider_share_percent <= 1),
    status                  commission_request_status NOT NULL DEFAULT 'pending',
    requested_by            UUID NOT NULL REFERENCES users(id),
    reviewed_by             UUID REFERENCES users(id),
    reviewed_at             TIMESTAMPTZ,
    rejection_reason        VARCHAR(255),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_commission_rate_requests_org_status
    ON commission_rate_requests(organization_id, status);

-- ---------------------------------------------------------------------
-- v_active_commission_rates (from 02_views.sql) needs the new columns
-- too — CREATE OR REPLACE rather than editing 02_views.sql directly,
-- since migrations are applied in order and 02 has already run by the
-- time this file does.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_active_commission_rates AS
SELECT
    branch_id,
    network_id,
    transaction_type,
    rate_percent,
    effective_from,
    threshold_amount,
    cap_amount,
    provider_share_percent
FROM commission_rates
WHERE effective_to IS NULL;

-- ---------------------------------------------------------------------
-- RLS on commission_rate_requests: a Business Owner may see/create
-- only their own organization's requests. Superuser review endpoints
-- deliberately use withoutRlsContext() (same reasoning as
-- AdminService for organizations) since a Superuser must see requests
-- across every organization, not just one app.current_org_id.
-- ---------------------------------------------------------------------
ALTER TABLE commission_rate_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY commission_rate_requests_select ON commission_rate_requests
    FOR SELECT
    USING (organization_id = app_current_org_id() AND app_is_org_wide_role());

CREATE POLICY commission_rate_requests_insert ON commission_rate_requests
    FOR INSERT
    WITH CHECK (organization_id = app_current_org_id() AND app_is_org_wide_role());


