import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';

export interface RequestAuthContext {
  userId: string;
  organizationId: string;
  branchId: string | null;
  role: string;
}

/**
 * Wraps the pg Pool and provides a withTransaction() helper that:
 *   1. Checks out a client from the pool
 *   2. Begins a transaction
 *   3. Sets the three RLS session variables for this request
 *      (app.current_org_id, app.current_branch_id, app.current_user_role)
 *   4. Runs the caller's queries
 *   5. Commits (or rolls back on error) and always releases the client
 *      back to the pool
 *
 * This exists specifically because pooled connections are reused across
 * different users' requests. Setting RLS session variables once per
 * connection (rather than once per transaction) would let one request's
 * branch scope leak into the next request that happens to reuse the same
 * pooled connection — exactly the risk flagged in DEPLOYMENT_GUIDE.md.
 * Scoping the SET calls to the same transaction as the actual queries,
 * and never reusing a client across requests, is what closes that gap.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private pool: Pool;

  constructor(private config: ConfigService) {
    // Render's managed Postgres (and most cloud Postgres providers)
    // require SSL and use a certificate that node-postgres won't
    // verify against a standard CA bundle by default, which throws a
    // connection error with no real fix available except disabling
    // strict verification — standard practice for these providers'
    // internal network connections, not a meaningful security
    // reduction since the connection is already inside the provider's
    // private network. Controlled by an explicit env var rather than
    // sniffing the connection string, so local development (no SSL
    // needed) and any future provider needing different SSL behavior
    // both stay easy to reason about.
    const useSsl = this.config.get<string>('DATABASE_SSL') === 'true';
    this.pool = new Pool({
      connectionString: this.config.get<string>('DATABASE_URL'),
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    });
  }

  async withTransaction<T>(
    auth: RequestAuthContext,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Parameterized via set_config() rather than string-interpolated
      // SET, since SET itself does not accept query parameters in
      // PostgreSQL — set_config() does, which avoids building this SQL
      // string from request-derived values directly.
      await client.query(
        `SELECT set_config('app.current_org_id', $1, true)`,
        [auth.organizationId],
      );
      await client.query(
        `SELECT set_config('app.current_branch_id', $1, true)`,
        [auth.branchId ?? ''],
      );
      await client.query(
        `SELECT set_config('app.current_user_role', $1, true)`,
        [auth.role],
      );

      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * For auth endpoints (login) that run before any RLS context exists.
   * Deliberately does NOT set any session variables — queries run here
   * rely only on table-level grants, and should be limited to exactly
   * what's needed to authenticate (looking up a user by phone).
   */
  async withoutRlsContext<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
