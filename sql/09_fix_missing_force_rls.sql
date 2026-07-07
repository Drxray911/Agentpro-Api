-- =====================================================================
-- Migration 09: Fix RLS gaps in commission_rate_requests and
-- subscription_payments (migrations 06 and 08).
-- =====================================================================
-- Three distinct bugs, all caught by testing cross-org access against
-- a genuine non-superuser database role rather than assuming the
-- earlier tests (which ran as a superuser and therefore silently
-- bypassed RLS entirely) proved anything:
--
-- 1. Missing FORCE ROW LEVEL SECURITY. Without it, Postgres does not
--    apply RLS policies to a table's OWNER — and the app's own
--    database connection typically IS the owner (whichever role ran
--    the migrations). Every policy on these two tables was silently
--    never enforced against the app's normal connection.
--
-- 2. No UPDATE policy at all. CommissionsService and
--    SubscriptionsService both UPDATE these tables when a Superuser
--    approves/rejects/verifies something. With FORCE now actually
--    applying policies and zero permissive UPDATE policy present,
--    every one of those UPDATEs would silently affect zero rows —
--    not an error, just nothing happening.
--
-- 3. No Superuser cross-org bypass. The existing SELECT/INSERT
--    policies require organization_id = app_current_org_id(), which a
--    Superuser (who isn't scoped to one organization) can never
--    satisfy. Application code has been updated to use
--    DatabaseService.withSuperAdminContext(), which sets
--    app.current_user_role = 'super_admin' explicitly (see
--    database.service.ts) — these new policies are what that context
--    actually needs to work.
-- =====================================================================

ALTER TABLE commission_rate_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments FORCE ROW LEVEL SECURITY;

CREATE POLICY commission_rate_requests_super_admin_all ON commission_rate_requests
    FOR ALL
    USING (current_setting('app.current_user_role', true) = 'super_admin')
    WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');

CREATE POLICY subscription_payments_super_admin_all ON subscription_payments
    FOR ALL
    USING (current_setting('app.current_user_role', true) = 'super_admin')
    WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');
