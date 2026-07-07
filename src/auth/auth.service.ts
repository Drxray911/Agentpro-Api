import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service';
import { PinLoginDto } from './dto/pin-login.dto';
import { LoginDto } from './dto/login.dto';

export interface JwtClaims {
  sub: string; // user id
  organizationId: string;
  branchId: string | null;
  role: string;
  fullName: string;
}

// Statuses that block sign-in outright, for every role in the
// organization — not just the Business Owner. Suspension is meant to
// actually cut off access; if only the owner's login checked this,
// Agents/Managers in a suspended business could keep transacting via
// pin-login, which would defeat the point of suspending it.
// 'grace_period' is deliberately NOT in this list — it's a warning
// state, not a lockout (see subscriptions.service.ts).
const BLOCKED_ORG_STATUSES: Record<string, string> = {
  pending_approval:
    'Your account is still pending approval. You will be able to sign in once a Superuser confirms your subscription payment.',
  suspended: 'Your subscription is suspended. Please renew your subscription to restore access.',
  rejected: 'Your registration was not approved. Contact support for more information.',
};

@Injectable()
export class AuthService {
  constructor(
    private db: DatabaseService,
    private jwt: JwtService,
  ) {}

  /**
   * Email/password login — the primary entry point for Business Owners
   * (and, going forward, any role with an email on file). Checks the
   * owning organization's approval status before issuing tokens, since
   * a pending or suspended org must not be usable even with correct
   * credentials.
   */
  async login(dto: LoginDto) {
    const user = await this.db.withoutRlsContext(async (client) => {
      const result = await client.query(
        `SELECT u.id, u.organization_id, u.branch_id, u.role, u.full_name, u.password_hash, u.is_active,
                o.status AS organization_status, o.subscription_expires_at
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
         WHERE u.email = $1 AND u.deleted_at IS NULL`,
        [dto.email.toLowerCase()],
      );
      return result.rows[0] ?? null;
    });

    if (!user || !user.is_active || !user.password_hash) {
      throw new UnauthorizedException('Incorrect email or password');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password_hash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Incorrect email or password');
    }

    this.assertOrgAccessible(user.organization_status);

    if (dto.deviceId) {
      await this.db.withoutRlsContext(async (client) => {
        await client.query(
          `INSERT INTO user_devices (user_id, device_id, last_seen_at)
           VALUES ($1, $2, now())
           ON CONFLICT (user_id, device_id)
           DO UPDATE SET last_seen_at = now()`,
          [user.id, dto.deviceId],
        );
      });
    }

    await this.db.withoutRlsContext(async (client) => {
      await client.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    });

    return {
      ...this.issueTokens(user),
      subscriptionWarning: this.gracePeriodWarning(user.organization_status, user.subscription_expires_at),
    };
  }

  /**
   * Legacy phone + 4-digit app-PIN login, retained for Agent/Manager
   * accounts created in-app (unaffected by the registration rework —
   * those accounts still get a PIN from their Business Owner rather
   * than an email/password). Now defensively checks pin_hash is set,
   * since it's nullable as of migration 05 (Business Owners registered
   * through the new flow never get one).
   */
  async pinLogin(dto: PinLoginDto) {
    const user = await this.db.withoutRlsContext(async (client) => {
      const result = await client.query(
        `SELECT u.id, u.organization_id, u.branch_id, u.role, u.full_name, u.pin_hash, u.is_active,
                o.status AS organization_status, o.subscription_expires_at
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
         WHERE u.phone = $1 AND u.deleted_at IS NULL`,
        [dto.phone],
      );
      return result.rows[0] ?? null;
    });

    if (!user || !user.is_active || !user.pin_hash) {
      throw new UnauthorizedException('Incorrect phone number or PIN');
    }

    const pinMatches = await bcrypt.compare(dto.pin, user.pin_hash);
    if (!pinMatches) {
      throw new UnauthorizedException('Incorrect phone number or PIN');
    }

    this.assertOrgAccessible(user.organization_status);

    await this.db.withoutRlsContext(async (client) => {
      await client.query(
        `INSERT INTO user_devices (user_id, device_id, last_seen_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id, device_id)
         DO UPDATE SET last_seen_at = now()`,
        [user.id, dto.deviceId],
      );
    });

    return {
      ...this.issueTokens({
        id: user.id,
        organization_id: user.organization_id,
        branch_id: user.branch_id,
        role: user.role,
        full_name: user.full_name,
      }),
      subscriptionWarning: this.gracePeriodWarning(user.organization_status, user.subscription_expires_at),
    };
  }

  private assertOrgAccessible(organizationStatus: string) {
    const blockedMessage = BLOCKED_ORG_STATUSES[organizationStatus];
    if (blockedMessage) {
      throw new ForbiddenException(blockedMessage);
    }
  }

  private gracePeriodWarning(organizationStatus: string, subscriptionExpiresAt: Date | null): string | null {
    if (organizationStatus !== 'grace_period') return null;
    const expiredDate = subscriptionExpiresAt ? subscriptionExpiresAt.toLocaleDateString() : 'recently';
    return `Your subscription expired on ${expiredDate}. Renew now to avoid your account being suspended.`;
  }

  private issueTokens(user: {
    id: string;
    organization_id: string;
    branch_id: string | null;
    role: string;
    full_name: string;
  }) {
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
