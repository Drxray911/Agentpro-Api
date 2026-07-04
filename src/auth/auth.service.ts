import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service';
import { PinLoginDto } from './dto/pin-login.dto';

export interface JwtClaims {
  sub: string; // user id
  organizationId: string;
  branchId: string | null;
  role: string;
  fullName: string;
}

@Injectable()
export class AuthService {
  constructor(
    private db: DatabaseService,
    private jwt: JwtService,
  ) {}

  async pinLogin(dto: PinLoginDto) {
    // Login runs with withoutRlsContext() — no session variables are
    // set on this connection at all, which is exactly the condition
    // the users_login_lookup policy in 04_row_level_security.sql
    // checks for (current_setting('app.current_user_role', true) is
    // NULL or empty). This policy is an explicit, narrow exception
    // for the pre-authentication case — see that file for the full
    // reasoning and the dead ends that were tried before landing on
    // this design.
    const user = await this.db.withoutRlsContext(async (client) => {
      const result = await client.query(
        `SELECT id, organization_id, branch_id, role, full_name, pin_hash, is_active
         FROM users
         WHERE phone = $1 AND deleted_at IS NULL`,
        [dto.phone],
      );
      return result.rows[0] ?? null;
    });

    if (!user || !user.is_active) {
      throw new UnauthorizedException('Incorrect phone number or PIN');
    }

    const pinMatches = await bcrypt.compare(dto.pin, user.pin_hash);
    if (!pinMatches) {
      throw new UnauthorizedException('Incorrect phone number or PIN');
    }

    // Device binding: record this device if it's new. Not yet enforced
    // as a hard block on unrecognized devices (the spec calls for device
    // binding as a security feature; whether an unrecognized device is
    // outright rejected or just flagged is a product decision — this
    // reference implementation records and trusts, leaving the stricter
    // "reject unknown device" policy as a follow-up rather than
    // guessing at a default here).
    await this.db.withoutRlsContext(async (client) => {
      await client.query(
        `INSERT INTO user_devices (user_id, device_id, last_seen_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id, device_id)
         DO UPDATE SET last_seen_at = now()`,
        [user.id, dto.deviceId],
      );
    });

    const claims: JwtClaims = {
      sub: user.id,
      organizationId: user.organization_id,
      branchId: user.branch_id,
      role: user.role,
      fullName: user.full_name,
    };

    const accessToken = this.jwt.sign(claims, { expiresIn: '15m' });
    const refreshToken = this.jwt.sign(claims, { expiresIn: '30d' });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        fullName: user.full_name,
        role: user.role,
        branchId: user.branch_id,
        organizationId: user.organization_id,
      },
    };
  }
}
