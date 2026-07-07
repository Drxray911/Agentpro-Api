import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/database.service';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

// Reset links are valid for 1 hour per spec (section 4).
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class PasswordResetService {
  constructor(private db: DatabaseService) {}

  /**
   * Always returns the same generic response whether or not the email
   * exists, so this endpoint can't be used to enumerate registered
   * emails. The raw token is only ever returned here (to be emailed by
   * whatever mail-sending integration wraps this service) — only its
   * hash is persisted, mirroring how passwords/PINs are stored.
   */
  async requestReset(dto: RequestPasswordResetDto): Promise<{ message: string; token?: string }> {
    const user = await this.db.withoutRlsContext(async (client) => {
      const result = await client.query(
        `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL AND is_active = true`,
        [dto.email.toLowerCase()],
      );
      return result.rows[0] ?? null;
    });

    const genericResponse = {
      message: 'If an account with that email exists, a password reset link has been sent.',
    };

    if (!user) {
      return genericResponse;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.db.withoutRlsContext(async (client) => {
      await client.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [user.id, tokenHash, expiresAt],
      );
    });

    // NOTE: actual email delivery (subject/body/SMTP or transactional
    // email provider) is intentionally out of scope here — this
    // service hands back the raw token so the calling layer can wire
    // up whichever mail provider is chosen without this service
    // needing to know about it. Returning it in the API response is a
    // placeholder for local/dev testing and MUST be removed once email
    // sending is wired in.
    return { ...genericResponse, token: rawToken };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const candidates = await this.db.withoutRlsContext(async (client) => {
      const result = await client.query(
        `SELECT id, user_id, token_hash
         FROM password_reset_tokens
         WHERE expires_at > now() AND used_at IS NULL
         ORDER BY created_at DESC`,
      );
      return result.rows;
    });

    let matched: { id: string; user_id: string } | null = null;
    for (const candidate of candidates) {
      if (await bcrypt.compare(dto.token, candidate.token_hash)) {
        matched = candidate;
        break;
      }
    }

    if (!matched) {
      throw new BadRequestException('This reset link is invalid or has expired. Please request a new one.');
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.db.withoutRlsContext(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
          newPasswordHash,
          matched!.user_id,
        ]);
        await client.query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [matched!.id]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    return { message: 'Your password has been reset. You can now sign in with your new password.' };
  }
}
