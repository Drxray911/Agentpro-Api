-- =====================================================================
-- AgentPro Ghana — Derived Views
-- =====================================================================
-- These views compute the numbers shown in the dashboard prototype
-- (float balances, today's commission, top network, etc.) directly
-- from the append-only ledgers, so the UI never reads a value that
-- could drift out of sync with the underlying transactions.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Current float balance per branch per network
-- (sum of all float_movements; this is the float strip at the top
-- of the dashboard)
-- ---------------------------------------------------------------------

CREATE VIEW v_float_balances AS
SELECT
    fm.branch_id,
    fm.network_id,
    n.code AS network_code,
    n.display_name AS network_name,
    SUM(fm.amount) AS current_balance
FROM float_movements fm
JOIN networks n ON n.id = fm.network_id
WHERE fm.synced_at IS NOT NULL OR fm.client_generated_id IS NULL
GROUP BY fm.branch_id, fm.network_id, n.code, n.display_name;

-- ---------------------------------------------------------------------
-- Low float alert candidates (matches the "Low — top up" badge and
-- the Alerts panel in the prototype)
-- ---------------------------------------------------------------------

CREATE VIEW v_low_float_alerts AS
SELECT *
FROM v_float_balances
WHERE current_balance < 3000.00;

-- ---------------------------------------------------------------------
-- Current cash on hand per branch (sum of all cash_movements)
-- ---------------------------------------------------------------------

CREATE VIEW v_cash_balance AS
SELECT
    branch_id,
    SUM(amount) AS current_balance
FROM cash_movements
GROUP BY branch_id;

-- ---------------------------------------------------------------------
-- Today's stats per branch (Cash on Hand proxy, Commission, Tx count)
-- "Cash on hand" itself is a separate running total maintained in the
-- application layer since it also depends on opening float purchases;
-- this view supplies the transaction-derived components.
-- ---------------------------------------------------------------------

CREATE VIEW v_daily_branch_stats AS
SELECT
    branch_id,
    created_at::date AS stat_date,
    COUNT(*) AS transaction_count,
    SUM(amount) AS total_volume,
    SUM(commission) AS total_commission
FROM transactions
WHERE status = 'completed'
GROUP BY branch_id, created_at::date;

-- ---------------------------------------------------------------------
-- Commission by network (powers "Which network generated the most
-- revenue?" in the AI assistant)
-- ---------------------------------------------------------------------

CREATE VIEW v_commission_by_network AS
SELECT
    t.branch_id,
    t.network_id,
    n.display_name AS network_name,
    SUM(t.commission) AS total_commission,
    COUNT(*) AS transaction_count
FROM transactions t
JOIN networks n ON n.id = t.network_id
WHERE t.status = 'completed'
GROUP BY t.branch_id, t.network_id, n.display_name;

-- ---------------------------------------------------------------------
-- Most frequent customers per branch (powers "Which customers
-- transact most often?")
-- ---------------------------------------------------------------------

CREATE VIEW v_customer_frequency AS
SELECT
    t.branch_id,
    t.customer_id,
    c.full_name,
    c.phone,
    COUNT(*) AS transaction_count,
    SUM(t.amount) AS total_volume,
    MAX(t.created_at) AS last_transaction_at
FROM transactions t
JOIN customers c ON c.id = t.customer_id
WHERE t.status = 'completed'
GROUP BY t.branch_id, t.customer_id, c.full_name, c.phone;

-- ---------------------------------------------------------------------
-- Pending sync queue (offline-mode indicator in the prototype)
-- ---------------------------------------------------------------------

CREATE VIEW v_pending_sync_transactions AS
SELECT *
FROM transactions
WHERE status = 'pending_sync'
ORDER BY created_at;

-- ---------------------------------------------------------------------
-- Active commission rate lookup (what rate applies right now)
-- ---------------------------------------------------------------------

CREATE VIEW v_active_commission_rates AS
SELECT
    branch_id,
    network_id,
    transaction_type,
    rate_percent,
    effective_from
FROM commission_rates
WHERE effective_to IS NULL;
