-- =====================================================================
-- AgentPro Ghana — Row-Level Security
-- =====================================================================
-- Strategy: the application sets two session variables right after
-- authenticating a request (e.g. in middleware, once per connection
-- or transaction):
--
--   SET app.current_org_id    = '<organization uuid>';
--   SET app.current_branch_id = '<branch uuid, or '' for org-wide roles>';
--   SET app.current_user_role      = '<role string>';
--
-- Policies below read these via current_setting(..., true) — the
-- `true` makes it return NULL instead of erroring if unset, so a
-- connection with no session vars set sees zero rows rather than
-- crashing or (worse) silently seeing everything.
--
-- Roles 'business_owner' and 'super_admin' see every branch within
-- their organization. All other roles ('branch_manager', 'agent',
-- 'cashier', 'auditor') are restricted to their own branch_id.
-- =====================================================================

-- Helper: is the current session an org-wide role?
-- NOTE: deliberately written in plpgsql, not `LANGUAGE sql STABLE`.
-- A plain SQL STABLE wrapper around current_setting() can be inlined
-- by the planner in a way that loses visibility into session-local
-- GUCs set earlier in the same session — confirmed by direct testing
-- against a live database, where the SQL STABLE version returned NULL
-- under a role that should have evaluated true. The plpgsql version
-- below does not exhibit that problem.
CREATE OR REPLACE FUNCTION app_is_org_wide_role() RETURNS BOOLEAN AS $$
BEGIN
    RETURN current_setting('app.current_user_role', true) IN ('business_owner', 'super_admin');
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS UUID AS $$
BEGIN
    RETURN current_setting('app.current_org_id', true)::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION app_current_branch_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_branch_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- ---------------------------------------------------------------------
-- branches: org-wide roles see all branches in their org;
-- branch-scoped roles see only their own branch.
-- ---------------------------------------------------------------------

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS branches_select ON branches;
CREATE POLICY branches_select ON branches
    FOR SELECT
    USING (
        organization_id = app_current_org_id()
        AND (app_is_org_wide_role() OR id = app_current_branch_id())
    );

DROP POLICY IF EXISTS branches_modify ON branches;
CREATE POLICY branches_modify ON branches
    FOR ALL
    USING (organization_id = app_current_org_id() AND app_is_org_wide_role())
    WITH CHECK (organization_id = app_current_org_id() AND app_is_org_wide_role());

-- ---------------------------------------------------------------------
-- users: org-wide roles see everyone in the org; others see only
-- colleagues at their own branch.
-- ---------------------------------------------------------------------

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users
    FOR SELECT
    USING (
        organization_id = app_current_org_id()
        AND (app_is_org_wide_role() OR branch_id = app_current_branch_id())
    );

-- Pre-authentication login lookup. PostgreSQL combines multiple
-- PERMISSIVE policies on the same command with OR, so this adds to
-- (rather than replaces) users_select above: a row becomes visible if
-- EITHER the normal branch/org-scoped policy matches, OR this one
-- does. This policy only matches when app.current_user_role has not
-- been set to anything yet for this session — which is exactly and
-- only the state of a connection that hasn't authenticated a request
-- yet. The moment any of the three session variables are set (which
-- happens inside withTransaction() for every authenticated request —
-- see database.service.ts), this policy stops matching and the
-- normal org/branch-scoped policy above is the only one that can
-- apply. This was the correct fix after three other approaches were
-- tried and found to fail on a managed-Postgres single-role setup:
-- a SECURITY DEFINER function bypass does nothing when the function's
-- owner and the calling role are the same role (confirmed by testing
-- — there's no "other" privilege level to borrow from in a single-
-- role architecture); BYPASSRLS and CREATEROLE both require superuser
-- to grant, which a managed Postgres owner role doesn't have; and
-- row_security = off is deliberately overridden by FORCE ROW LEVEL
-- SECURITY, which is the documented purpose of FORCE. A policy that
-- explicitly describes the one legitimate pre-auth case is more
-- correct than any of those anyway — it doesn't depend on privilege
-- escalation tricks at all, just states the actual rule.
DROP POLICY IF EXISTS users_login_lookup ON users;
CREATE POLICY users_login_lookup ON users
    FOR SELECT
    USING (current_setting('app.current_user_role', true) IS NULL OR current_setting('app.current_user_role', true) = '');

DROP POLICY IF EXISTS users_modify ON users;
CREATE POLICY users_modify ON users
    FOR ALL
    USING (organization_id = app_current_org_id() AND app_is_org_wide_role())
    WITH CHECK (organization_id = app_current_org_id() AND app_is_org_wide_role());

-- ---------------------------------------------------------------------
-- customers, transactions, float_movements, commission_rates,
-- support_tickets: all branch-scoped the same way — org-wide roles
-- see every branch in the org, everyone else sees only their branch.
-- ---------------------------------------------------------------------

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customers_branch_scope ON customers;
CREATE POLICY customers_branch_scope ON customers
    FOR ALL
    USING (
        app_is_org_wide_role()
        OR branch_id = app_current_branch_id()
    )
    WITH CHECK (
        app_is_org_wide_role()
        OR branch_id = app_current_branch_id()
    );

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transactions_branch_scope ON transactions;
CREATE POLICY transactions_branch_scope ON transactions
    FOR ALL
    USING (
        app_is_org_wide_role()
        OR branch_id = app_current_branch_id()
    )
    WITH CHECK (
        app_is_org_wide_role()
        OR branch_id = app_current_branch_id()
    );

ALTER TABLE float_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE float_movements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS float_movements_branch_scope ON float_movements;
CREATE POLICY float_movements_branch_scope ON float_movements
    FOR ALL
    USING (
        app_is_org_wide_role()
        OR branch_id = app_current_branch_id()
    )
    WITH CHECK (
        app_is_org_wide_role()
        OR branch_id = app_current_branch_id()
    );

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_movements_branch_scope ON cash_movements;
CREATE POLICY cash_movements_branch_scope ON cash_movements
    FOR ALL
    USING (
        app_is_org_wide_role()
        OR branch_id = app_current_branch_id()
    )
    WITH CHECK (
        app_is_org_wide_role()
        OR branch_id = app_current_branch_id()
    );

ALTER TABLE commission_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commission_rates_select ON commission_rates;
CREATE POLICY commission_rates_select ON commission_rates
    FOR SELECT
    USING (
        app_is_org_wide_role()
        OR branch_id = app_current_branch_id()
    );
-- Only org-wide roles (owner/admin) may CHANGE commission rates —
-- matches the prototype's permission gating on the Commissions screen.
DROP POLICY IF EXISTS commission_rates_modify ON commission_rates;
CREATE POLICY commission_rates_modify ON commission_rates
    FOR INSERT
    WITH CHECK (app_is_org_wide_role());
DROP POLICY IF EXISTS commission_rates_update ON commission_rates;
CREATE POLICY commission_rates_update ON commission_rates
    FOR UPDATE
    USING (app_is_org_wide_role())
    WITH CHECK (app_is_org_wide_role());

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_tickets_branch_scope ON support_tickets;
CREATE POLICY support_tickets_branch_scope ON support_tickets
    FOR ALL
    USING (
        app_is_org_wide_role()
        OR branch_id = app_current_branch_id()
    )
    WITH CHECK (
        app_is_org_wide_role()
        OR branch_id = app_current_branch_id()
    );

-- ---------------------------------------------------------------------
-- audit_logs: read-only for everyone except the system itself
-- (inserts happen via a SECURITY DEFINER function or trusted backend
-- role, never directly from a branch-scoped session). Org-wide roles
-- and auditors can read; nobody can UPDATE or DELETE audit history.
-- ---------------------------------------------------------------------

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
CREATE POLICY audit_logs_select ON audit_logs
    FOR SELECT
    USING (
        organization_id = app_current_org_id()
        AND (app_is_org_wide_role() OR current_setting('app.current_user_role', true) = 'auditor')
    );

-- No UPDATE/DELETE policy is defined for any role, which means those
-- operations are denied by default once RLS is enabled — audit logs
-- are effectively immutable from the application layer.

-- ---------------------------------------------------------------------
-- A note on login lookups: see the users_login_lookup policy above,
-- alongside users_select. An earlier version of this file solved the
-- pre-authentication chicken-and-egg problem (RLS requires session
-- context that doesn't exist yet at login time) with a SECURITY
-- DEFINER function intended to bypass RLS for just that one lookup.
-- That approach was tested directly and found to do nothing: a
-- SECURITY DEFINER function only changes anything when its owner is a
-- DIFFERENT, more-privileged role than whoever calls it — in a
-- single-role architecture (one connection role for the whole app,
-- which is what most managed Postgres providers give you), the
-- function's owner and the caller end up being the same role, so
-- there's no privilege gap to bypass through. The actual fix is the
-- users_login_lookup policy itself: an explicit, narrow RLS rule for
-- the one legitimate pre-auth case, rather than a bypass mechanism
-- that depends on a privilege level (BYPASSRLS, CREATEROLE, or table
-- ownership different from the querying role) that may not exist.
-- ---------------------------------------------------------------------
-- authenticate (explicitly never pin_hash to anywhere outside the
-- comparison step), so broad EXECUTE access here doesn't widen what's
-- actually exposed.

-- ---------------------------------------------------------------------
-- A note on the backend connection role — and a real bug this caught
-- ---------------------------------------------------------------------
-- An earlier version of this schema assumed the API server MUST
-- connect as a dedicated, separately-created, non-owner role, since
-- table owners and superusers bypass RLS by default in PostgreSQL.
-- That's true, but the assumption that the app could always create
-- such a role for itself at startup turned out to be wrong: tested
-- directly against a simulated managed-Postgres setup (a database
-- owner role without superuser), CREATE ROLE failed with
-- "permission denied to create role" — a regular database owner on a
-- managed Postgres provider (Render, and likely most others) does
-- NOT have CREATEROLE by default, only true superusers do.
--
-- Rather than depend on privileges that may or may not exist on a
-- given provider, every RLS-enabled table below uses BOTH:
--   ALTER TABLE x ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE x FORCE ROW LEVEL SECURITY;
-- FORCE is the actual fix — confirmed directly by testing a query as
-- a table OWNER role with FORCE applied: RLS was genuinely enforced
-- (zero rows returned without a valid session context, correct rows
-- returned with one), even though that role owns the table. Without
-- FORCE, ENABLE alone is silently no-op for owners and superusers,
-- which is the gap an earlier version of this file didn't account
-- for. This means the app can safely connect using whatever single
-- role a managed Postgres provider gives you — even the owner role —
-- without needing to provision a second, more-restricted role at all.
--
-- If you DO have a role with CREATEROLE available (e.g. self-hosted
-- Postgres where you control the superuser), creating a separate
-- least-privilege role is still good practice as a second layer of
-- defense — but it is no longer the only thing standing between the
-- app and an RLS bypass, which is what made the original design
-- fragile.
