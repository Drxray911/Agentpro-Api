-- =====================================================================
-- AgentPro Ghana — Core Database Schema (PostgreSQL)
-- =====================================================================
-- Design notes:
--   * Money columns use NUMERIC(14,2) — never FLOAT/REAL for currency.
--   * All primary keys are UUIDs (gen_random_uuid()) so records can be
--     created offline (per the spec's offline-mode requirement) without
--     waiting for a server-assigned auto-increment ID.
--   * Ledger tables (float_movements, transactions) are APPEND-ONLY.
--     Balances are never edited directly — they are always the sum of
--     ledger entries, ensuring the books can always be reconciled.
--   * Soft-deletes (deleted_at) are used instead of hard deletes on
--     anything customer- or money-facing, for audit and dispute
--     resolution purposes.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Organizations & Branches (multi-shop / multi-tenant support)
-- ---------------------------------------------------------------------

CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(150) NOT NULL,
    owner_user_id   UUID, -- FK added after users table exists
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE branches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    zone            VARCHAR(100),              -- e.g. "Accra Central", "Kumasi North"
    address         VARCHAR(255),
    gps_lat         NUMERIC(10,7),
    gps_lng         NUMERIC(10,7),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_branches_org ON branches(organization_id);

-- ---------------------------------------------------------------------
-- Roles & Users
-- ---------------------------------------------------------------------

CREATE TYPE user_role AS ENUM (
    'super_admin',
    'business_owner',
    'branch_manager',
    'agent',
    'cashier',
    'auditor'
);

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id       UUID REFERENCES branches(id) ON DELETE SET NULL, -- NULL for org-level roles (owner/admin)
    full_name       VARCHAR(150) NOT NULL,
    phone           VARCHAR(20) NOT NULL,
    email           VARCHAR(150),
    role            user_role NOT NULL,
    pin_hash        VARCHAR(255) NOT NULL,     -- bcrypt/argon2 hash, never plaintext
    password_hash   VARCHAR(255),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE (organization_id, phone)
);

CREATE INDEX idx_users_branch ON users(branch_id);
CREATE INDEX idx_users_org ON users(organization_id);

ALTER TABLE organizations
    ADD CONSTRAINT fk_org_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Device binding (security requirement from spec: "Device Binding")
CREATE TABLE user_devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id       VARCHAR(255) NOT NULL,     -- hardware/installation identifier
    device_label    VARCHAR(150),              -- e.g. "Samsung A14 - Shop Counter"
    last_seen_at    TIMESTAMPTZ,
    is_trusted      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, device_id)
);

-- ---------------------------------------------------------------------
-- Networks (reference table, not hardcoded — supports new networks
-- being added without a schema migration)
-- ---------------------------------------------------------------------

CREATE TABLE networks (
    id              SMALLINT PRIMARY KEY,
    code            VARCHAR(20) NOT NULL UNIQUE,   -- 'MTN', 'TELECEL', 'AT'
    display_name    VARCHAR(50) NOT NULL,          -- 'MTN MoMo'
    brand_color     VARCHAR(7),                    -- '#FFCC08'
    is_active       BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO networks (id, code, display_name, brand_color) VALUES
    (1, 'MTN', 'MTN MoMo', '#FFCC08'),
    (2, 'TELECEL', 'Telecel Cash', '#E4002B'),
    (3, 'AT', 'AT Money', '#0072CE');

-- ---------------------------------------------------------------------
-- Commission Rates (versioned — never overwrite, insert a new
-- effective-dated row so historical transactions keep the rate that
-- was actually in effect when they happened)
-- ---------------------------------------------------------------------

CREATE TYPE transaction_type AS ENUM (
    'cash_in',
    'cash_out',
    'airtime',
    'data_bundle',
    'send_money',
    'bill_payment',
    'merchant_payment'
);

CREATE TABLE commission_rates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    network_id      SMALLINT NOT NULL REFERENCES networks(id),
    transaction_type transaction_type NOT NULL,
    rate_percent    NUMERIC(6,4) NOT NULL CHECK (rate_percent >= 0), -- e.g. 0.0033 = 0.33%
    effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to    TIMESTAMPTZ,                    -- NULL = currently active
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_commission_rates_lookup
    ON commission_rates(branch_id, network_id, transaction_type, effective_from);

-- Ensures only one "open" (effective_to IS NULL) rate per
-- branch/network/type combination at any time.
CREATE UNIQUE INDEX idx_commission_rates_one_active
    ON commission_rates(branch_id, network_id, transaction_type)
    WHERE effective_to IS NULL;

-- ---------------------------------------------------------------------
-- Float Ledger (append-only) + cached balance view
-- ---------------------------------------------------------------------

CREATE TYPE float_movement_type AS ENUM (
    'purchase',     -- bought float with cash
    'transfer_out',
    'transfer_in',
    'adjustment',   -- manual correction, +/-
    'transaction_consumption', -- float consumed by a cash-in/airtime/data sale
    'transaction_replenishment' -- float added back by a cash-out
);

CREATE TABLE float_movements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    network_id      SMALLINT NOT NULL REFERENCES networks(id),
    movement_type   float_movement_type NOT NULL,
    amount          NUMERIC(14,2) NOT NULL,        -- signed: positive = float increase
    related_branch_id UUID REFERENCES branches(id), -- for transfers, the counterpart branch
    related_transaction_id UUID,                    -- FK added after transactions table exists
    note            VARCHAR(255),
    performed_by    UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Offline-mode support: client generates this locally before sync
    client_generated_id UUID,
    synced_at       TIMESTAMPTZ                     -- NULL until confirmed by server
);

CREATE INDEX idx_float_movements_branch_network
    ON float_movements(branch_id, network_id, created_at);
CREATE UNIQUE INDEX idx_float_movements_client_id
    ON float_movements(client_generated_id) WHERE client_generated_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Cash Ledger (append-only) — tracks physical cash on hand, separate
-- from the float ledger above. Cash has no network dimension (it's
-- just money in the drawer), unlike float which is split per network.
-- Added because the API spec (openapi.yaml) and prototype both surface
-- a "Cash on Hand" figure that needs a real, traceable source rather
-- than being computed ad hoc — this ledger is that source, following
-- the same append-only design as float_movements for the same
-- reconciliation reasons.
-- ---------------------------------------------------------------------

CREATE TYPE cash_movement_type AS ENUM (
    'opening_balance',
    'cash_in_received',       -- customer pays cash during a cash-in transaction
    'cash_out_paid',          -- agent pays cash out during a cash-out transaction
    'commission_earned',      -- commission received in cash
    'float_purchase_payment', -- cash spent buying float
    'adjustment'
);

CREATE TABLE cash_movements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    movement_type   cash_movement_type NOT NULL,
    amount          NUMERIC(14,2) NOT NULL,   -- signed: positive = cash increase
    related_transaction_id UUID,               -- FK added after transactions table exists
    note            VARCHAR(255),
    performed_by    UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    client_generated_id UUID,
    synced_at       TIMESTAMPTZ
);

CREATE INDEX idx_cash_movements_branch ON cash_movements(branch_id, created_at);
CREATE UNIQUE INDEX idx_cash_movements_client_id
    ON cash_movements(client_generated_id) WHERE client_generated_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Customers (per-branch — same phone number can exist at multiple
-- branches as separate customer relationships)
-- ---------------------------------------------------------------------

CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    phone           VARCHAR(20) NOT NULL,
    full_name       VARCHAR(150),
    preferred_network_id SMALLINT REFERENCES networks(id),
    notes           TEXT,
    is_favorite     BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE (branch_id, phone)
);

CREATE INDEX idx_customers_branch ON customers(branch_id);
CREATE INDEX idx_customers_phone ON customers(phone);

-- ---------------------------------------------------------------------
-- Transactions (append-only core ledger)
-- ---------------------------------------------------------------------

CREATE TYPE transaction_status AS ENUM (
    'completed',
    'pending_sync',  -- recorded offline, awaiting server confirmation
    'failed',
    'reversed'
);

CREATE TABLE transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id           UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    performed_by        UUID NOT NULL REFERENCES users(id),
    customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
    network_id          SMALLINT NOT NULL REFERENCES networks(id),
    transaction_type    transaction_type NOT NULL,
    amount               NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    charges              NUMERIC(14,2) NOT NULL DEFAULT 0,
    commission           NUMERIC(14,2) NOT NULL DEFAULT 0,
    commission_rate_id   UUID REFERENCES commission_rates(id), -- rate actually applied
    external_reference   VARCHAR(100),   -- USSD/telecom transaction ID, if available
    status                transaction_status NOT NULL DEFAULT 'completed',
    failure_reason         VARCHAR(255),
    -- Offline-mode support
    client_generated_id   UUID,
    synced_at             TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_branch_date ON transactions(branch_id, created_at);
CREATE INDEX idx_transactions_customer ON transactions(customer_id);
CREATE INDEX idx_transactions_network ON transactions(network_id);
CREATE INDEX idx_transactions_status ON transactions(status) WHERE status = 'pending_sync';
CREATE UNIQUE INDEX idx_transactions_client_id
    ON transactions(client_generated_id) WHERE client_generated_id IS NOT NULL;

ALTER TABLE float_movements
    ADD CONSTRAINT fk_float_movement_transaction
    FOREIGN KEY (related_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;

ALTER TABLE cash_movements
    ADD CONSTRAINT fk_cash_movement_transaction
    FOREIGN KEY (related_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- Receipts (delivery tracking — SMS / WhatsApp / PDF / Bluetooth print)
-- ---------------------------------------------------------------------

CREATE TYPE receipt_channel AS ENUM ('sms', 'whatsapp', 'pdf', 'bluetooth_print');

CREATE TABLE receipts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    channel         receipt_channel NOT NULL,
    delivered_at    TIMESTAMPTZ,
    delivery_status VARCHAR(50) DEFAULT 'pending', -- pending / sent / failed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_receipts_transaction ON receipts(transaction_id);

-- ---------------------------------------------------------------------
-- Audit Logs (required by spec: "Audit Logs")
-- ---------------------------------------------------------------------

CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id       UUID REFERENCES branches(id) ON DELETE SET NULL,
    actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(100) NOT NULL,     -- e.g. 'commission_rate.updated'
    entity_type     VARCHAR(50) NOT NULL,      -- e.g. 'commission_rates'
    entity_id       UUID,
    before_value    JSONB,
    after_value     JSONB,
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_org_date ON audit_logs(organization_id, created_at);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- ---------------------------------------------------------------------
-- Support Tickets
-- ---------------------------------------------------------------------

CREATE TYPE ticket_category AS ENUM (
    'failed_transaction',
    'wrong_amount',
    'float_discrepancy',
    'airtime_failure',
    'data_bundle_failure',
    'system_error',
    'other'
);

CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');

CREATE TABLE support_tickets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    raised_by       UUID NOT NULL REFERENCES users(id),
    related_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    category        ticket_category NOT NULL,
    subject         VARCHAR(200) NOT NULL,
    description     TEXT,
    status          ticket_status NOT NULL DEFAULT 'open',
    rating          SMALLINT CHECK (rating BETWEEN 1 AND 5),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX idx_support_tickets_branch ON support_tickets(branch_id, status);

CREATE TABLE support_ticket_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id       UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    file_url        VARCHAR(500) NOT NULL,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE support_ticket_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id       UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_user_id  UUID REFERENCES users(id),
    is_support_team BOOLEAN NOT NULL DEFAULT false,
    message         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- updated_at auto-touch trigger (applied to mutable tables)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_touch_organizations BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_branches BEFORE UPDATE ON branches
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_users BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_customers BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_transactions BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
