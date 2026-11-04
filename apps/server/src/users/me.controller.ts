import { Body, Controller, Delete, Get, HttpCode, Inject, Patch, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { notFound, parse } from '../common/http';
import { RateLimiter } from '../common/rate-limit';
import { passwordSchema } from '../auth/auth.controller';
import { AuthService, publicUser } from '../auth/auth.service';
import { UserGuard, UserId } from '../auth/guard';
import { PrismaService } from '../prisma.service';
import { FileStore } from '../files/file-store';

const patchBody = z.object({ nickname: z.string().trim().min(1, '昵称不能为空').max(32, '昵称最多 32 个字').optional() });
const passwordBody = z.object({ oldPassword: z.string().max(72).optional(), newPassword: passwordSchema });
const deleteBody = z.object({ password: z.string().max(72).default('') });

@Controller('me')
@UseGuards(UserGuard)
export class MeController {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(FileStore) private readonly files: FileStore,
  ) {}

  @Get()
  async get(@UserId() userId: string) {
    const u = await this.db.user.findUnique({ where: { id: userId } });
    if (!u) throw notFound('账号不存在', 'user_not_found');
    return publicUser(u);
  }

  @Patch()
  async patch(@UserId() userId: string, @Body() body: unknown) {
    const b = parse(patchBody, body);
    return publicUser(await this.db.user.update({ where: { id: userId }, data: b }));
  }

  @Put('password')
  async password(@UserId() userId: string, @Body() body: unknown, @Req() req: Request) {
    this.limiter.hit(`password:${userId}`, 10, 10 * 60_000);
    const b = parse(passwordBody, body);
    return this.auth.changePassword(userId, b.oldPassword, b.newPassword, String(req.headers['user-agent'] ?? ''));
  }

  /** Deletes the account and everything that belongs to it (works, history, files, sessions). */
  @Delete()
  @HttpCode(204)
  async remove(@UserId() userId: string, @Body() body: unknown) {
    this.limiter.hit(`delete:${userId}`, 10, 10 * 60_000);
    await this.auth.checkPassword(userId, parse(deleteBody, body ?? {}).password);
    await this.db.user.delete({ where: { id: userId } });
    await this.files.removeUser(userId);
  }
}
