import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service';
import { RegisterOwnerDto } from './dto/register-owner.dto';

@Injectable()
export class RegistrationService {
  constructor(private db: DatabaseService) {}

  /**
   * Registers a new Business Owner + their organization in
   * 'pending_approval' status. Deliberately does NOT issue any JWT —
   * the account cannot be used until a Superuser confirms the
   * subscription payment and approves it (see AdminService.approveOrganization).
   * This replaces the old flow, which created the org/user and signed
   * tokens in the same request — that was fine for seeded demo
   * accounts, but bypassed the payment-verification gate the product
   * requires for real Business Owners.
   */
  async registerOwner(dto: RegisterOwnerDto) {
    const existingPhone = await this.db.withoutRlsContext(async (client) => {
      const result = await client.query(`SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL`, [
        dto.phone,
      ]);
      return result.rows[0] ?? null;
    });

    if (existingPhone) {
      throw new ConflictException('An account with this phone number already exists. Try signing in instead.');
    }

    const existingEmail = await this.db.withoutRlsContext(async (client) => {
      const result = await client.query(
        `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [dto.email.toLowerCase()],
      );
      return result.rows[0] ?? null;
    });

    if (existingEmail) {
      throw new ConflictException('An account with this email already exists. Try signing in instead.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const created = await this.db.withoutRlsContext(async (client) => {
      await client.query('BEGIN');
      try {
        const orgResult = await client.query(
          `INSERT INTO organizations (name, status, business_reg_number)
           VALUES ($1, 'pending_approval', $2)
           RETURNING id`,
          [dto.businessName, dto.businessRegNumber ?? null],
        );
        const organizationId = orgResult.rows[0].id;

        await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [organizationId]);
        await client.query(`SELECT set_config('app.current_user_role', 'business_owner', true)`);

        const branchResult = await client.query(
          `INSERT INTO branches (organization_id, name) VALUES ($1, $2) RETURNING id`,
          [organizationId, 'Main Branch'],
        );
        const branchId = branchResult.rows[0].id;

        const userResult = await client.query(
          `INSERT INTO users (organization_id, branch_id, full_name, phone, email, role, password_hash, is_active)
           VALUES ($1, $2, $3, $4, $5, 'business_owner', $6, true)
           RETURNING id, full_name`,
          [organizationId, branchId, dto.fullName, dto.phone, dto.email.toLowerCase(), passwordHash],
        );
        const userId = userResult.rows[0].id;

        await client.query(`UPDATE organizations SET owner_user_id = $1 WHERE id = $2`, [
          userId,
          organizationId,
        ]);

        if (dto.deviceId) {
          await client.query(
            `INSERT INTO user_devices (user_id, device_id, last_seen_at) VALUES ($1, $2, now())`,
            [userId, dto.deviceId],
          );
        }

        await client.query('COMMIT');
        return { userId, organizationId, branchId, fullName: userResult.rows[0].full_name };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    return {
      status: 'pending_approval',
      message:
        'Your account has been created and is pending approval. Pay your subscription fee via MTN MoMo and submit the payment reference in-app; a Superuser will review and activate your account.',
      organizationId: created.organizationId,
      userId: created.userId,
    };
  }
}
