import { createParamDecorator, Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { CONFIG, type AppConfig } from '../config';
import { unauthorized } from '../common/http';
import { verifyAccess } from './crypto';

export interface AuthedRequest extends Request {
  userId?: string;
  adminId?: string;
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  return h && h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Requires a user access token; sets req.userId. */
@Injectable()
export class UserGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearer(req);
    const claims = token ? verifyAccess(token, this.config.jwtSecret) : null;
    if (!claims || claims.adm) throw unauthorized(token ? '登录已过期，请重新登录' : '请先登录', token ? 'token_expired' : 'unauthorized');
    req.userId = claims.sub;
    return true;
  }
}

/** Requires an admin access token; sets req.adminId. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearer(req);
    const claims = token ? verifyAccess(token, this.config.jwtSecret) : null;
    if (!claims || !claims.adm) throw unauthorized(token ? '登录已过期，请重新登录' : '请先登录', token ? 'token_expired' : 'unauthorized');
    req.adminId = claims.sub;
    return true;
  }
}

export const UserId = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().userId!);
export const AdminId = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().adminId!);
