-- =====================================================================
-- Migration 11: USSD Templates (spec section 7).
-- =====================================================================
-- "Superuser can edit flows without requiring an app update" — the
-- app fetches the active template for a given network/transaction
-- type at the moment it starts a USSD session, rather than shipping
-- them baked into the APK.
--
-- Design notes:
--   * steps is a JSONB array rather than a normalized child table.
--     A step sequence is only ever read/written as a whole unit (the
--     native automation engine walks it in order; a Superuser editing
--     a template edits the whole flow at once) — there's no query
--     that needs to filter or join on an individual step, so the
--     normalization a child table would buy isn't used anywhere and
--     would only add join complexity for the one consumer that reads
--     it. Each element is expected to look like:
--       { "inputType": "menu_option" | "amount" | "phone" | "literal" | "pin_wait",
--         "value": "1"              -- for menu_option/literal
--         "placeholder": "amount"   -- for amount/phone, resolved by the
--                                      app from the transaction being performed
--       }
--     "pin_wait" is a special step with no value/placeholder — the
--     native engine treats reaching it as "stop automated input here,
--     wait for the person to enter their MoMo PIN on the real network
--     screen, then resume watching (read-only) for success/failure."
--   * success_patterns / failure_patterns / pin_prompt_patterns are
--     text arrays (not regex objects) — plain substrings the native
--     engine matches case-insensitively against the USSD dialog's
--     displayed text, editable by a Superuser without needing to
--     understand regex.
--   * Versioned the same way commission_rates already is in this
--     project (effective_from/effective_to, partial unique index for
--     "one active template per network+type") rather than editing a
--     row in place — so a change a Superuser makes doesn't retroactively
--     alter what an in-flight USSD session started against.
-- =====================================================================

CREATE TABLE ussd_templates (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id            SMALLINT NOT NULL REFERENCES networks(id),
    transaction_type      transaction_type NOT NULL,
    ussd_code             VARCHAR(30) NOT NULL,          -- e.g. "*170#"
    steps                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    success_patterns      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- string[]
    failure_patterns      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- string[]
    pin_prompt_patterns   JSONB NOT NULL DEFAULT '["PIN"]'::jsonb, -- string[]
    step_timeout_ms       INTEGER NOT NULL DEFAULT 20000,
    max_retries           INTEGER NOT NULL DEFAULT 2,
    effective_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to          TIMESTAMPTZ,
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_ussd_templates_one_active
    ON ussd_templates(network_id, transaction_type)
    WHERE effective_to IS NULL;

-- No RLS: templates are platform-wide configuration (like
-- platform_commission_defaults), not organization-scoped data. Every
-- authenticated app instance reads the same active template for a
-- given network/type; only a Superuser writes them, enforced at the
-- API layer (@Roles('super_admin') on the write endpoints), same
-- pattern as platform_settings.
