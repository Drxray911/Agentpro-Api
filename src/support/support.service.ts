import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, RequestAuthContext } from '../database/database.service';
import { CreateTicketDto, AddMessageDto } from './dto/support.dto';

@Injectable()
export class SupportService {
  constructor(private db: DatabaseService) {}

  async list(auth: RequestAuthContext, status?: string) {
    return this.db.withTransaction(auth, async (client) => {
      const conditions = ['branch_id = $1'];
      const params: any[] = [auth.branchId];
      if (status) {
        params.push(status);
        conditions.push(`status = $${params.length}`);
      }

      const result = await client.query(
        `SELECT id, category, subject, description, status, created_at, resolved_at
         FROM support_tickets
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC`,
        params,
      );

      return result.rows.map(this.mapTicket);
    });
  }

  async create(auth: RequestAuthContext, dto: CreateTicketDto) {
    return this.db.withTransaction(auth, async (client) => {
      const result = await client.query(
        `INSERT INTO support_tickets (branch_id, raised_by, related_transaction_id, category, subject, description)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, category, subject, description, status, created_at, resolved_at`,
        [auth.branchId, auth.userId, dto.relatedTransactionId ?? null, dto.category, dto.subject, dto.description ?? null],
      );
      return this.mapTicket(result.rows[0]);
    });
  }

  async addMessage(auth: RequestAuthContext, ticketId: string, dto: AddMessageDto) {
    return this.db.withTransaction(auth, async (client) => {
      // Confirm the ticket exists and belongs to this branch before
      // allowing a message — RLS already enforces the branch boundary
      // at the database layer, but checking explicitly here lets us
      // return a clean 404 rather than a confusing empty success.
      const ticket = await client.query(
        `SELECT id FROM support_tickets WHERE id = $1 AND branch_id = $2`,
        [ticketId, auth.branchId],
      );
      if (ticket.rows.length === 0) {
        throw new NotFoundException('Support ticket not found');
      }

      const result = await client.query(
        `INSERT INTO support_ticket_messages (ticket_id, sender_user_id, is_support_team, message)
         VALUES ($1, $2, false, $3)
         RETURNING id, message, created_at`,
        [ticketId, auth.userId, dto.message],
      );
      return result.rows[0];
    });
  }

  private mapTicket(row: any) {
    return {
      id: row.id,
      category: row.category,
      subject: row.subject,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  }
}
