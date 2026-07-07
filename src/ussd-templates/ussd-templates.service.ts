import { Injectable } from '@nestjs/common';
import { DatabaseService, RequestAuthContext } from '../database/database.service';
import { SetUssdTemplateDto } from './dto/set-ussd-template.dto';

const NETWORK_IDS: Record<string, number> = { MTN: 1, TELECEL: 2, AT: 3 };
const NETWORK_CODES_BY_ID: Record<number, string> = { 1: 'MTN', 2: 'TELECEL', 3: 'AT' };

@Injectable()
export class UssdTemplatesService {
  constructor(private db: DatabaseService) {}

  /**
   * Every active template, across every network/transaction type — the
   * app fetches this whole set once (e.g. on login or when opening the
   * transaction screen) rather than one at a time, since there are at
   * most a handful of network x type combinations and the native
   * automation engine needs to have the right one on hand the instant
   * the person confirms a transaction, not fetch-on-demand mid-dial.
   * No RLS/org scoping — these are platform-wide, same for every user.
   */
  async getActiveTemplates(auth: RequestAuthContext) {
    return this.db.withTransaction(auth, async (client) => {
      const result = await client.query(
        `SELECT network_id, transaction_type, ussd_code, steps, success_patterns,
                failure_patterns, pin_prompt_patterns, step_timeout_ms, max_retries, effective_from
         FROM ussd_templates
         WHERE effective_to IS NULL
         ORDER BY network_id, transaction_type`,
      );
      return result.rows.map(mapTemplateRow);
    });
  }

  /** Superuser: same data, but via withSuperAdminContext for consistency (this table has no RLS, so either works — see AdminService's comment on the same point). */
  async getActiveTemplatesForAdmin() {
    return this.db.withSuperAdminContext(async (client) => {
      const result = await client.query(
        `SELECT network_id, transaction_type, ussd_code, steps, success_patterns,
                failure_patterns, pin_prompt_patterns, step_timeout_ms, max_retries, effective_from
         FROM ussd_templates
         WHERE effective_to IS NULL
         ORDER BY network_id, transaction_type`,
      );
      return result.rows.map(mapTemplateRow);
    });
  }

  /**
   * Sets (versions) the active template for one network/transaction
   * type. Superuser-only, matching how platform_commission_defaults
   * and platform_settings are both Superuser-only writes with no
   * per-organization variation — a USSD flow is defined by the network
   * operator, not by which business is using the app.
   */
  async setTemplate(auth: RequestAuthContext, dto: SetUssdTemplateDto) {
    return this.db.withSuperAdminContext(async (client) => {
      const networkId = NETWORK_IDS[dto.network];

      await client.query(
        `UPDATE ussd_templates
         SET effective_to = now()
         WHERE network_id = $1 AND transaction_type = $2 AND effective_to IS NULL`,
        [networkId, dto.transactionType],
      );

      const inserted = await client.query(
        `INSERT INTO ussd_templates
           (network_id, transaction_type, ussd_code, steps, success_patterns, failure_patterns,
            pin_prompt_patterns, step_timeout_ms, max_retries, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING network_id, transaction_type, ussd_code, steps, success_patterns,
                   failure_patterns, pin_prompt_patterns, step_timeout_ms, max_retries, effective_from`,
        [
          networkId,
          dto.transactionType,
          dto.ussdCode,
          JSON.stringify(dto.steps),
          JSON.stringify(dto.successPatterns),
          JSON.stringify(dto.failurePatterns),
          JSON.stringify(dto.pinPromptPatterns ?? ['PIN']),
          dto.stepTimeoutMs ?? 20000,
          dto.maxRetries ?? 2,
          auth.userId,
        ],
      );

      return mapTemplateRow(inserted.rows[0]);
    });
  }
}

function mapTemplateRow(row: any) {
  return {
    network: NETWORK_CODES_BY_ID[row.network_id],
    transactionType: row.transaction_type,
    ussdCode: row.ussd_code,
    steps: row.steps,
    successPatterns: row.success_patterns,
    failurePatterns: row.failure_patterns,
    pinPromptPatterns: row.pin_prompt_patterns,
    stepTimeoutMs: row.step_timeout_ms,
    maxRetries: row.max_retries,
    effectiveFrom: row.effective_from,
  };
}
