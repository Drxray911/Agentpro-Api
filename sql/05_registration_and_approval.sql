-- =====================================================================
-- Migration 05: Real registration flow (email/password) + Superuser
-- approval workflow for Business Owners.
-- =====================================================================
-- Context: registration previously created an org + business_owner and
-- issued tokens immediately (seeded-demo-account era). Per the product
-- spec, a new Business Owner must land in "pending_approval" and only
-- become active once a Superuser confirms subscription payment.
--
-- Design notes:
--   * organizations.status defaults to 'active' at the column level —
--     this is deliberate so existing rows (seed data, anything created
--     directly by an admin script) are never silently locked out by
--     this migration. New public registrations explicitly pass
--     'pending_approval' at INSERT time instead of relying on the
--     column default, so the default staying 'active' is safe.
--   * pin_hash on users is relaxed to nullable. Business Owners created
--     through the new flow authenticate with email/password only and
--     never set an app PIN at registration; Agents/Managers created
--     in-app can still be issued a PIN separately (unchanged).
--   * email gets a partial unique index (only enforced when NOT NULL
--     and the row isn't soft-deleted) rather than a table-level UNIQUE
--     constraint, since not every user has an email today (phone/PIN
--     accounts).
-- =====================================================================

CREATE TYPE organization_status AS ENUM (
    'pending_approval',
    'active',
    'suspended',
    'rejected'
);

ALTER TABLE organizations
    ADD COLUMN status              organization_status NOT NULL DEFAULT 'active',
    ADD COLUMN business_reg_number VARCHAR(100),          -- Ghana Card or business registration number
    ADD COLUMN payment_reference   VARCHAR(100),           -- MTN MoMo reference submitted at registration/renewal
    ADD COLUMN approved_at         TIMESTAMPTZ,
    ADD COLUMN approved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN rejected_at         TIMESTAMPTZ,
    ADD COLUMN rejection_reason    VARCHAR(255);

CREATE INDEX idx_organizations_status ON organizations(status);

-- Business Owner login no longer requires a PIN.
ALTER TABLE users
    ALTER COLUMN pin_hash DROP NOT NULL;

-- One email per (non-deleted) user across the whole platform, not just
-- per-organization — Superuser login lookups and password reset both
-- need email to be globally unique, unlike phone which is only unique
-- within an organization.
CREATE UNIQUE INDEX users_email_unique
    ON users (email)
    WHERE email IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- Password reset tokens
-- ---------------------------------------------------------------------
CREATE TABLE password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL,   -- hash of the token, never the raw token
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);

-- organizations has no RLS today (see 04_row_level_security.sql — it is
-- not in the ALTER TABLE ... ENABLE ROW LEVEL SECURITY list), which is
-- why Superuser approval endpoints can read/write across every
-- organization via withoutRlsContext() without needing a new bypass
-- policy here. This migration intentionally does not change that.
