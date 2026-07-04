import { ConflictException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service';
import { RegisterOwnerDto } from './dto/register-owner.dto';
import { JwtClaims } from './auth.service';

@Injectable()
export class RegistrationService {
  constructor(
    private db: DatabaseService,
    private jwt: JwtService,
  ) {}

  async registerOwner(dto: RegisterOwnerDto) {
    // Runs without RLS context for the same reason login does: at
    // registration time there is no organization yet for this phone
    // number to belong to, so there's nothing for a branch/org-scoped
    // policy to match against. The uniqueness check below (does this
    // phone already exist anywhere) needs to see across ALL
    // organizations, not just one — which is also why it can't run
    // under a normal scoped session.
    const existing = await this.db.withoutRlsContext(async (client) => {
      const result = await client.query(`SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL`, [
        dto.phone,
      ]);
      return result.rows[0] ?? null;
    });

    if (existing) {
      throw new ConflictException('An account with this phone number already exists. Try signing in instead.');
    }

    const pinHash = await bcrypt.hash(dto.pin, 10);

    // Organization, branch, and owner user are created together in one
    // transaction — if any step fails, none of it persists, so we
    // never end up with an orphaned organization that has no owner,
    // or an owner account with no organization to belong to.
    const created = await this.db.withoutRlsContext(async (client) => {
      await client.query('BEGIN');
      try {
        const orgResult = await client.query(
          `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
          [dto.businessName],
        );
        const organizationId = orgResult.rows[0].id;

        // organizations itself has no RLS policy (there's no
        // meaningful "which org can see this org" question at the
        // top of the hierarchy), so that insert above needs no
        // special context. branches and users DO have RLS —
        // branches_modify and users_modify both require
        // app_current_org_id() to match AND an org-wide role, which
        // is NULL/false on a connection with no session context set.
        // Confirmed by checking the actual policy definitions rather
        // than assuming: without this, the INSERT below would fail
        // exactly like the seed-data INSERTs did earlier in this
        // project, for the identical reason. Setting the context to
        // the organization we just created, as the business_owner
        // role being registered, satisfies both policies correctly.
        await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [organizationId]);
        await client.query(`SELECT set_config('app.current_user_role', 'business_owner', true)`);

        const branchResult = await client.query(
          `INSERT INTO branches (organization_id, name) VALUES ($1, $2) RETURNING id`,
          [organizationId, 'Main Branch'],
        );
        const branchId = branchResult.rows[0].id;

        const userResult = await client.query(
          `INSERT INTO users (organization_id, branch_id, full_name, phone, role, pin_hash)
           VALUES ($1, $2, $3, $4, 'business_owner', $5)
           RETURNING id, full_name`,
          [organizationId, branchId, dto.fullName, dto.phone, pinHash],
        );
        const userId = userResult.rows[0].id;

        await client.query(`UPDATE organizations SET owner_user_id = $1 WHERE id = $2`, [
          userId,
          organizationId,
        ]);

        await client.query(
          `INSERT INTO user_devices (user_id, device_id, last_seen_at) VALUES ($1, $2, now())`,
          [userId, dto.deviceId],
        );

        await client.query('COMMIT');
        return { userId, organizationId, branchId, fullName: userResult.rows[0].full_name };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    const claims: JwtClaims = {
      sub: created.userId,
      organizationId: created.organizationId,
      branchId: created.branchId,
      role: 'business_owner',
      fullName: created.fullName,
    };

    const accessToken = this.jwt.sign(claims, { expiresIn: '15m' });
    const refreshToken = this.jwt.sign(claims, { expiresIn: '30d' });

    return {
      accessToken,
      refreshToken,
      user: {
        id: created.userId,
        fullName: created.fullName,
        role: 'business_owner',
        branchId: created.branchId,
        organizationId: created.organizationId,
      },
    };
  }
}
