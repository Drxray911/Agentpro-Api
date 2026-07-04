import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Bootstraps the database on application startup: applies the schema,
 * views, and RLS policies if they don't already exist.
 *
 * EARLIER DESIGN, AND WHY IT CHANGED: the first version of this
 * script tried to create a separate, least-privilege `agentpro_app`
 * role at startup, since PostgreSQL table owners and superusers
 * bypass Row-Level Security by default. Tested directly against a
 * simulated managed-Postgres setup (a database owner role without
 * superuser, matching what Render and most managed providers actually
 * give you), that approach failed outright: CREATE ROLE requires the
 * CREATEROLE privilege, which a regular database owner does not have
 * by default. The fix isn't a workaround for that error — it's a
 * better design that doesn't need CREATEROLE at all: every RLS-enabled
 * table in 04_row_level_security.sql now uses
 *   ALTER TABLE x FORCE ROW LEVEL SECURITY;
 * in addition to ENABLE, which was confirmed by direct testing to
 * make RLS apply even to the table's OWNER — a query with no valid
 * session context returns zero rows, and a query with a valid one
 * returns the correctly-scoped rows, regardless of which role is
 * connected. This means the app can safely use whatever single
 * connection role a managed Postgres provider gives you, with no
 * privilege escalation and no role-creation step required.
 *
 * IDEMPOTENT: safe to run on every deploy/restart, not just the
 * first one. The schema/views application is skipped if a known
 * table already exists; 04_row_level_security.sql itself uses
 * DROP POLICY IF EXISTS immediately before each CREATE POLICY (and
 * CREATE OR REPLACE for its helper functions) so it can be re-applied
 * on every boot without erroring on "already exists" — confirmed by
 * running it twice in a row against the same database.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'sql');

function readSql(filename: string): string {
  return fs.readFileSync(path.join(SQL_DIR, filename), 'utf8');
}

export async function bootstrapDatabase(connectionString: string): Promise<void> {
  const client = new Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    const schemaCheck = await client.query(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'organizations')`,
    );
    const schemaAlreadyApplied = schemaCheck.rows[0].exists;

    const shouldSeed = process.env.SEED_DEMO_DATA === 'true';

    if (!schemaAlreadyApplied) {
      console.log('[bootstrap] Applying 01_schema.sql...');
      await client.query(readSql('01_schema.sql'));
      console.log('[bootstrap] Applying 02_views.sql...');
      await client.query(readSql('02_views.sql'));
    } else {
      console.log('[bootstrap] Schema already applied, skipping 01_schema.sql / 02_views.sql.');
    }

    console.log('[bootstrap] Applying 04_row_level_security.sql...');
    await client.query(readSql('04_row_level_security.sql'));

    if (shouldSeed) {
      // Check if users already exist — seed whenever they don't,
      // not just on first schema application. This handles the case
      // where the schema was applied but seeding failed or was skipped
      // (e.g. the database was reset and schema re-applied separately).
      const userCheck = await client.query(`SELECT COUNT(*) FROM users`);
      const userCount = parseInt(userCheck.rows[0].count, 10);
      if (userCount === 0) {
        console.log('[bootstrap] No users found — seeding demo data...');
        await client.query(
          `SELECT set_config('app.current_org_id', 'a0000000-0000-0000-0000-000000000001', false)`,
        );
        await client.query(`SELECT set_config('app.current_user_role', 'business_owner', false)`);
        await client.query(readSql('03_seed_data.sql'));
        console.log('[bootstrap] Demo data seeded successfully.');
      } else {
        console.log(`[bootstrap] ${userCount} user(s) already exist, skipping seed.`);
      }
    }

    console.log('[bootstrap] Database bootstrap complete.');
  } finally {
    await client.end();
  }
}
