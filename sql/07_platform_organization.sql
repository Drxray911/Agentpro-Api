-- =====================================================================
-- Migration 07: Platform organization support, for Superuser bootstrap.
-- =====================================================================
-- Problem: users.organization_id is NOT NULL (every user row must
-- reference a real organizations row) — reasonable for every role
-- except super_admin, who doesn't belong to any business. Loosening
-- that NOT NULL constraint would weaken a guarantee every other part
-- of the schema and RLS design relies on, for the sake of a single
-- role. Instead: exactly one reserved "platform organization" row
-- exists, flagged via is_platform_org, that Superuser accounts attach
-- to. It's inert everywhere else — it's never pending_approval, never
-- shown in AdminService.listPendingOrganizations() (that query is
-- unaffected since it filters on status = 'pending_approval' and this
-- row is created directly as 'active'), and nothing else references
-- it by anything other than "is this org.is_platform_org = true".
-- =====================================================================

ALTER TABLE organizations
    ADD COLUMN is_platform_org BOOLEAN NOT NULL DEFAULT false;

-- At most one platform organization can ever exist. A partial unique
-- index on a boolean column enforces "at most one TRUE row" — trying
-- to insert a second one fails with a unique-violation, the same
-- mechanism idx_commission_rates_one_active already relies on
-- elsewhere for a different invariant.
CREATE UNIQUE INDEX idx_organizations_one_platform_org
    ON organizations(is_platform_org)
    WHERE is_platform_org = true;
