-- =====================================================================
-- Migration 08: Subscription lifecycle (spec section 10).
-- =====================================================================
-- Lifecycle per spec: Register -> Pending Approval -> Superuser
-- Approves After Payment -> Active -> Renewal Reminders (7,3,1 days
-- before) -> Grace Period -> Suspension if unpaid (data preserved) ->
-- Restored after renewal.
--
-- Design notes:
--   * 'grace_period' is a NEW organization_status value, added via
--     ALTER TYPE ... ADD VALUE. This is only safe outside of (or at
--     the start of) a transaction that also tries to USE the new
--     value — adding it here and nothing else in this file references
--     it, so it's safe under bootstrap.ts's per-migration transaction
--     wrapper. Confirmed directly against a scratch database rather
--     than assumed from general Postgres knowledge.
--   * Grace period does NOT block login — only 'suspended' does (see
--     AuthService.login). The whole point of a grace period is
--     continued, functional access with a warning, not a soft lockout;
--     an org only actually loses access once truly suspended.
--   * subscription_payments is deliberately separate from the
--     approval fields already on organizations (payment_reference,
--     approved_at, approved_by from migration 05) — those cover the
--     ONE-TIME initial registration approval. Every subsequent
--     renewal is its own row here, so the history of renewal payments
--     isn't overwritten each cycle the way a single column would be.
--   * platform_settings is a single-row table (enforced by the CHECK
--     constraint below) rather than a key-value table, since there
--     are only two settings right now (subscription price, grace
--     period length) and a single-row table is simpler to read and
--     update than a KV table for something this small. Superuser
--     endpoints read/write this one row directly.
-- =====================================================================

ALTER TYPE organization_status ADD VALUE 'grace_period' AFTER 'active';

CREATE TYPE subscription_plan AS ENUM ('free', 'business');

ALTER TABLE organizations
    ADD COLUMN plan                  subscription_plan NOT NULL DEFAULT 'business',
    ADD COLUMN subscription_expires_at TIMESTAMPTZ;

CREATE TYPE subscription_payment_status AS ENUM ('pending', 'verified', 'rejected');

CREATE TABLE subscription_payments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    payment_reference VARCHAR(100) NOT NULL,
    amount_ghs        NUMERIC(10,2),
    status            subscription_payment_status NOT NULL DEFAULT 'pending',
    submitted_by      UUID NOT NULL REFERENCES users(id),
    verified_by       UUID REFERENCES users(id),
    verified_at       TIMESTAMPTZ,
    rejection_reason  VARCHAR(255),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscription_payments_org_status ON subscription_payments(organization_id, status);

ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;

-- Business Owner sees/creates only their own org's renewal payment
-- submissions. Superuser review endpoints use withoutRlsContext (same
-- reasoning as everywhere else a Superuser needs cross-org access).
CREATE POLICY subscription_payments_select ON subscription_payments
    FOR SELECT
    USING (organization_id = app_current_org_id() AND app_is_org_wide_role());

CREATE POLICY subscription_payments_insert ON subscription_payments
    FOR INSERT
    WITH CHECK (organization_id = app_current_org_id() AND app_is_org_wide_role());

CREATE TABLE platform_settings (
    id                     SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- enforces a single row
    subscription_price_ghs NUMERIC(10,2) NOT NULL DEFAULT 10.00,
    grace_period_days      INTEGER NOT NULL DEFAULT 7,
    updated_by             UUID REFERENCES users(id),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (id) VALUES (1);
