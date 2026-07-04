import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { JwtClaims } from './auth.service';

export interface AuthenticatedRequest extends Request {
  auth: {
    userId: string;
    organizationId: string;
    branchId: string | null;
    role: string;
    fullName: string;
  };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    const token = authHeader.slice('Bearer '.length);

    let claims: JwtClaims;
    try {
      claims = this.jwt.verify<JwtClaims>(token);
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.auth = {
      userId: claims.sub,
      organizationId: claims.organizationId,
      branchId: claims.branchId,
      role: claims.role,
      fullName: claims.fullName,
    };

    return true;
  }
}
