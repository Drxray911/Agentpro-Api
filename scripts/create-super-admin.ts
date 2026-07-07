/**
 * Creates a super_admin account, attached to the reserved platform
 * organization (see 07_platform_organization.sql). This is the only
 * way a Superuser account can come to exist — there is deliberately
 * no public registration path or HTTP endpoint for it, since exposing
 * "create a platform administrator" over the network, even behind a
 * shared secret, is a meaningfully larger attack surface than an
 * operator running a script with direct database access.
 *
 * Run it via the Render/Railway shell (or any environment with
 * DATABASE_URL set) after deploying:
 *
 *   SUPER_ADMIN_EMAIL=you@agentproghana.com \
 *   SUPER_ADMIN_PASSWORD='choose-a-strong-password' \
 *   SUPER_ADMIN_FULL_NAME='Your Name' \
 *   SUPER_ADMIN_PHONE=0244123456 \
 *   npm run bootstrap:super-admin
 *
 * Idempotent and safe to re-run: if a super_admin already exists, it
 * does nothing and exits cleanly rather than creating a second one or
 * erroring — this means it can even be wired into a deploy pipeline
 * unconditionally without risk, though the intended use is a deliberate
 * one-off run.
 */
import { Client } from 'pg';
import * as bcrypt from 'bcrypt';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    console.error(`[bootstrap:super-admin] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const databaseUrl = requireEnv('DATABASE_URL');
  const email = requireEnv('SUPER_ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('SUPER_ADMIN_PASSWORD');
  const fullName = requireEnv('SUPER_ADMIN_FULL_NAME');
  const phone = requireEnv('SUPER_ADMIN_PHONE');

  if (password.length < 8) {
    console.error('[bootstrap:super-admin] SUPER_ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }
  if (!/^0\d{9}$/.test(phone)) {
    console.error(
      '[bootstrap:super-admin] SUPER_ADMIN_PHONE must be a 10-digit Ghanaian number starting with 0 (e.g. 0244123456).',
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    const existing = await client.query(
      `SELECT id, email FROM users WHERE role = 'super_admin' AND deleted_at IS NULL LIMIT 1`,
    );
    if (existing.rows.length > 0) {
      console.log(
        `[bootstrap:super-admin] A Superuser already exists (${existing.rows[0].email}) — doing nothing. ` +
          `Delete that user first if you really intend to replace it.`,
      );
      return;
    }

    const emailTaken = await client.query(
      `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email],
    );
    if (emailTaken.rows.length > 0) {
      console.error(`[bootstrap:super-admin] Email ${email} is already in use by another account.`);
      process.exit(1);
    }

    await client.query('BEGIN');
    try {
      let platformOrgResult = await client.query(
        `SELECT id FROM organizations WHERE is_platform_org = true LIMIT 1`,
      );
      let platformOrgId: string;
      if (platformOrgResult.rows.length === 0) {
        const created = await client.query(
          `INSERT INTO organizations (name, status, is_platform_org)
           VALUES ('Agent Pro Ghana Platform', 'active', true)
           RETURNING id`,
        );
        platformOrgId = created.rows[0].id;
        console.log('[bootstrap:super-admin] Created the reserved platform organization.');
      } else {
        platformOrgId = platformOrgResult.rows[0].id;
      }

      const passwordHash = await bcrypt.hash(password, 10);

      // users is FORCE ROW LEVEL SECURITY-protected (see
      // 04_row_level_security.sql), and this script's plain pg.Client
      // connection sets no session context at all by default — which
      // satisfies the read-only users_login_lookup/users_super_admin_select
      // policies, but not users_modify's INSERT check, since that one
      // requires an org-wide role AND a matching organization_id. Set
      // both explicitly, scoped to this transaction only, mirroring
      // what DatabaseService.withSuperAdminContext does in the running
      // app — this one-off script has no DatabaseService instance to
      // reuse, so it replicates the same two set_config() calls directly.
      await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [platformOrgId]);
      await client.query(`SELECT set_config('app.current_user_role', 'super_admin', true)`);

      const created = await client.query(
        `INSERT INTO users (organization_id, branch_id, full_name, phone, email, role, password_hash, is_active)
         VALUES ($1, NULL, $2, $3, $4, 'super_admin', $5, true)
         RETURNING id`,
        [platformOrgId, fullName, phone, email, passwordHash],
      );

      await client.query('COMMIT');
      console.log(`[bootstrap:super-admin] Superuser created: ${email} (id: ${created.rows[0].id}).`);
      console.log('[bootstrap:super-admin] Sign in via POST /auth/login with this email and password.');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[bootstrap:super-admin] Failed:', err);
  process.exit(1);
});
