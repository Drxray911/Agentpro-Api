-- =====================================================================
-- AgentPro Ghana — Seed Data
-- =====================================================================
-- Mirrors the demo data used in the interactive prototype, so anyone
-- comparing the two sees the same business: same shop name, same
-- four demo users/roles/PINs, same starting float and cash figures.
-- =====================================================================

-- Organization & branch
INSERT INTO organizations (id, name) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'Adwoa''s MoMo Shop Group');

INSERT INTO branches (id, organization_id, name, zone, is_active) VALUES
    ('b0000000-0000-0000-0000-000000000001',
     'a0000000-0000-0000-0000-000000000001',
     'Adwoa''s MoMo Shop — Main Branch',
     'Accra Central',
     true);

-- Demo users. pin_hash values below are real bcrypt hashes (cost
-- factor 10) of the PINs shown in each comment — verified to match
-- via bcrypt.compare() before being written here. An earlier version
-- of this file had literal placeholder text instead of real hashes,
-- which worked during local development only because a separate
-- manual `UPDATE users SET pin_hash = ...` step was run by hand after
-- seeding, every time. That manual step isn't possible in an
-- automated deploy (e.g. Render, where this file runs unattended on
-- first boot) — without real hashes here, every demo account would
-- seed with a login that can never succeed.
INSERT INTO users (id, organization_id, branch_id, full_name, phone, role, pin_hash) VALUES
    ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
     'b0000000-0000-0000-0000-000000000001', 'Adwoa Sarpong', '0244111111', 'business_owner', '$2b$10$eqd2lfYTe37PCl.ZaMpiDuLtRlFSdvm64haY5sqRhsANiKZkyWOa.'), -- PIN 1111
    ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001',
     'b0000000-0000-0000-0000-000000000001', 'Kojo Antwi', '0244222222', 'branch_manager', '$2b$10$1t69JIZDgHAcFlxMKW11/OImCulF4STzi4YOB/SB6OkQGYu6U7xxG'), -- PIN 2222
    ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001',
     'b0000000-0000-0000-0000-000000000001', 'Yaw Boateng', '0244333333', 'agent', '$2b$10$p9tJjxdZghxW8mnx7Soqie5J/sINXFKUec.4eCO7ZFeGPrhtF2t92'), -- PIN 3333
    ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001',
     'b0000000-0000-0000-0000-000000000001', 'Efua Owusu', '0244444444', 'cashier', '$2b$10$IfwARQjGrtg/bY/3fF1WZe0pCO5t.HLMc8D8WIn9GoxCioXrttwUK'); -- PIN 4444

UPDATE organizations SET owner_user_id = 'c0000000-0000-0000-0000-000000000001'
    WHERE id = 'a0000000-0000-0000-0000-000000000001';

-- Commission rates (matches COMMISSION_RATES in the prototype)
INSERT INTO commission_rates (branch_id, network_id, transaction_type, rate_percent, created_by) VALUES
    ('b0000000-0000-0000-0000-000000000001', 1, 'cash_in',  0.0033, 'c0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000001', 1, 'cash_out', 0.0067, 'c0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000001', 1, 'airtime',  0.0300, 'c0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000001', 1, 'data_bundle', 0.0500, 'c0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000001', 2, 'cash_in',  0.0030, 'c0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000001', 2, 'cash_out', 0.0060, 'c0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000001', 2, 'airtime',  0.0300, 'c0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000001', 2, 'data_bundle', 0.0500, 'c0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000001', 3, 'cash_in',  0.0030, 'c0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000001', 3, 'cash_out', 0.0060, 'c0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000001', 3, 'airtime',  0.0300, 'c0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000001', 3, 'data_bundle', 0.0500, 'c0000000-0000-0000-0000-000000000001');

-- Opening float purchases (matches initialFloat = { MTN: 8420, TELECEL: 3150, AT: 2680 })
INSERT INTO float_movements (branch_id, network_id, movement_type, amount, note, performed_by) VALUES
    ('b0000000-0000-0000-0000-000000000001', 1, 'purchase', 8420.00, 'Opening float balance', 'c0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000001', 2, 'purchase', 3150.00, 'Opening float balance', 'c0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000001', 3, 'purchase', 2680.00, 'Opening float balance', 'c0000000-0000-0000-0000-000000000001');

-- Opening cash balance (matches the prototype's initialCash = 5230)
INSERT INTO cash_movements (branch_id, movement_type, amount, note, performed_by) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'opening_balance', 5230.00, 'Opening cash balance', 'c0000000-0000-0000-0000-000000000001');

-- Customers (matches the prototype's seed customers)
INSERT INTO customers (id, branch_id, phone, full_name, preferred_network_id) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '0244123456', 'Akosua Mensah', 1),
    ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '0203887210', 'Yaw Boateng', 2),
    ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', '0244667882', 'Efua Owusu', 1),
    ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', '0263245901', 'Kwame Asante', 3),
    ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', '0263998113', 'Adwoa Sarpong', 3),
    ('d0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', '0202334778', 'Kojo Mensah', 2);

-- Sample transactions (matches the prototype's seedTransactions)
INSERT INTO transactions (id, branch_id, performed_by, customer_id, network_id, transaction_type, amount, commission, created_at) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003',
     'd0000000-0000-0000-0000-000000000001', 1, 'cash_in', 500.00, 1.65, '2026-06-25 09:42:00+00'),
    ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003',
     'd0000000-0000-0000-0000-000000000002', 2, 'airtime', 20.00, 0.60, '2026-06-25 09:55:00+00'),
    ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003',
     'd0000000-0000-0000-0000-000000000003', 1, 'cash_out', 300.00, 2.01, '2026-06-25 10:10:00+00'),
    ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003',
     'd0000000-0000-0000-0000-000000000004', 3, 'data_bundle', 15.00, 0.75, '2026-06-25 10:22:00+00'),
    ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003',
     'd0000000-0000-0000-0000-000000000005', 3, 'cash_in', 200.00, 0.60, '2026-06-25 10:48:00+00');

-- Float movements driven by each transaction above. Cash-in and
-- airtime/data sales consume float (agent gives out e-money or
-- airtime from their float balance); cash-out replenishes float
-- (agent receives e-money from the customer). This mirrors the
-- exact logic in the prototype's recordTransaction() function.
INSERT INTO float_movements (branch_id, network_id, movement_type, amount, related_transaction_id, note, performed_by) VALUES
    ('b0000000-0000-0000-0000-000000000001', 1, 'transaction_consumption', -500.00,
     'e0000000-0000-0000-0000-000000000001', 'Cash-in to Akosua Mensah', 'c0000000-0000-0000-0000-000000000003'),
    ('b0000000-0000-0000-0000-000000000001', 2, 'transaction_consumption', -20.00,
     'e0000000-0000-0000-0000-000000000002', 'Airtime sale to Yaw Boateng', 'c0000000-0000-0000-0000-000000000003'),
    ('b0000000-0000-0000-0000-000000000001', 1, 'transaction_replenishment', 300.00,
     'e0000000-0000-0000-0000-000000000003', 'Cash-out from Efua Owusu', 'c0000000-0000-0000-0000-000000000003'),
    ('b0000000-0000-0000-0000-000000000001', 3, 'transaction_consumption', -15.00,
     'e0000000-0000-0000-0000-000000000004', 'Data bundle sale to Kwame Asante', 'c0000000-0000-0000-0000-000000000003'),
    ('b0000000-0000-0000-0000-000000000001', 3, 'transaction_consumption', -200.00,
     'e0000000-0000-0000-0000-000000000005', 'Cash-in to Adwoa Sarpong', 'c0000000-0000-0000-0000-000000000003');

-- Cash movements driven by each transaction above, following the exact
-- math in the prototype's recordTransaction(): cash-in increases cash
-- by amount + commission; cash-out decreases cash by amount but the
-- commission is still earned in cash; airtime/data sales earn only
-- the commission in cash (the sale itself is paid from float/prepaid
-- balance, not cash).
INSERT INTO cash_movements (branch_id, movement_type, amount, related_transaction_id, note, performed_by) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'cash_in_received', 501.65,
     'e0000000-0000-0000-0000-000000000001', 'Cash-in to Akosua Mensah: amount + commission', 'c0000000-0000-0000-0000-000000000003'),
    ('b0000000-0000-0000-0000-000000000001', 'commission_earned', 0.60,
     'e0000000-0000-0000-0000-000000000002', 'Airtime sale to Yaw Boateng: commission only', 'c0000000-0000-0000-0000-000000000003'),
    ('b0000000-0000-0000-0000-000000000001', 'cash_out_paid', -297.99,
     'e0000000-0000-0000-0000-000000000003', 'Cash-out to Efua Owusu: -amount + commission', 'c0000000-0000-0000-0000-000000000003'),
    ('b0000000-0000-0000-0000-000000000001', 'commission_earned', 0.75,
     'e0000000-0000-0000-0000-000000000004', 'Data bundle sale to Kwame Asante: commission only', 'c0000000-0000-0000-0000-000000000003'),
    ('b0000000-0000-0000-0000-000000000001', 'cash_in_received', 200.60,
     'e0000000-0000-0000-0000-000000000005', 'Cash-in to Adwoa Sarpong: amount + commission', 'c0000000-0000-0000-0000-000000000003');
