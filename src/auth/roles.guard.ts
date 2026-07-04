import { SetMetadata, CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './jwt-auth.guard';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Mirrors app_is_org_wide_role() from 04_row_level_security.sql exactly —
 * this list must stay in sync with that function. It's intentionally
 * duplicated here (rather than queried from the database on every
 * request) so that a role check can happen before any database round
 * trip; the database-level RLS policy remains the authoritative
 * enforcement, this is a fast-fail convenience at the API layer.
 */
export const ORG_WIDE_ROLES = ['business_owner', 'super_admin'];

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // @Roles() can be applied at the method level or the class level
    // (FloatController uses it at the class level, applying to every
    // route in the controller). reflector.getAllAndOverride() checks
    // the handler first, falling back to the class — getHandler()
    // alone (what an earlier version of this guard used) only ever
    // finds method-level decorators and silently allows every request
    // through on a class-level @Roles(), which was confirmed as a real
    // bug by testing: an Agent successfully reached a Branch-Manager-
    // only endpoint instead of being blocked.
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // no @Roles() decorator means no restriction beyond authentication
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!requiredRoles.includes(request.auth.role)) {
      throw new ForbiddenException(
        `This action requires one of the following roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
