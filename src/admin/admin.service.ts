import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ApproveOrganizationDto } from './dto/approve-organization.dto';
import { RejectOrganizationDto } from './dto/reject-organization.dto';

/**
 * All queries here run via withSuperAdminContext() rather than
 * withTransaction(). A Superuser's job is explicitly to act across
 * every organization, not just the one in their own JWT — organizations
 * itself carries no RLS at all, but the users JOIN in
 * listPendingOrganizations() below does need the explicit
 * super_admin-bypass policy withSuperAdminContext sets up (see
 * users_super_admin_select in 04_row_level_security.sql).
 */
@Injectable()
export class AdminService {
  constructor(private db: DatabaseService) {}

  async listPendingOrganizations() {
    const rows = await this.db.withSuperAdminContext(async (client) => {
      const result = await client.query(
        `SELECT o.id, o.name, o.business_reg_number, o.payment_reference, o.created_at,
                u.id AS owner_user_id, u.full_name AS owner_full_name, u.email AS owner_email, u.phone AS owner_phone
         FROM organizations o
         JOIN users u ON u.id = o.owner_user_id
         WHERE o.status = 'pending_approval'
         ORDER BY o.created_at ASC`,
      );
      return result.rows;
    });

    // Mapped to camelCase here, same convention as mapTransactionRow
    // in dashboard.service.ts — raw SQL stays snake_case, the mapper
    // at the edge of the service is what the frontend actually reads.
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      businessRegNumber: row.business_reg_number,
      paymentReference: row.payment_reference,
      createdAt: row.created_at,
      ownerUserId: row.owner_user_id,
      ownerFullName: row.owner_full_name,
      ownerEmail: row.owner_email,
      ownerPhone: row.owner_phone,
    }));
  }

  async approveOrganization(organizationId: string, dto: ApproveOrganizationDto, approvedByUserId: string) {
    const org = await this.getOrganizationOrThrow(organizationId);

    if (org.status !== 'pending_approval') {
      throw new BadRequestException(`Cannot approve an organization with status '${org.status}'`);
    }

    await this.db.withSuperAdminContext(async (client) => {
      await client.query(
        `UPDATE organizations
         SET status = 'active', payment_reference = $1, approved_at = now(), approved_by = $2,
             rejected_at = NULL, rejection_reason = NULL,
             subscription_expires_at = now() + interval '30 days'
         WHERE id = $3`,
        [dto.paymentReference, approvedByUserId, organizationId],
      );
    });

    return { message: 'Organization approved and activated.', organizationId, status: 'active' };
  }

  async rejectOrganization(organizationId: string, dto: RejectOrganizationDto) {
    const org = await this.getOrganizationOrThrow(organizationId);

    if (org.status !== 'pending_approval') {
      throw new BadRequestException(`Cannot reject an organization with status '${org.status}'`);
    }

    await this.db.withSuperAdminContext(async (client) => {
      await client.query(
        `UPDATE organizations
         SET status = 'rejected', rejected_at = now(), rejection_reason = $1
         WHERE id = $2`,
        [dto.reason, organizationId],
      );
    });

    return { message: 'Organization registration rejected.', organizationId, status: 'rejected' };
  }

  private async getOrganizationOrThrow(organizationId: string) {
    const org = await this.db.withSuperAdminContext(async (client) => {
      const result = await client.query(`SELECT id, status FROM organizations WHERE id = $1`, [
        organizationId,
      ]);
      return result.rows[0] ?? null;
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return org;
  }
}
