import { Body, Controller, Get, HttpCode, Inject, Ip, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../config';
import { badRequest, parse, unauthorized } from '../common/http';
import { RateLimiter } from '../common/rate-limit';
import { DUMMY_HASH, signAccess, verifyPassword } from '../auth/crypto';
import { AdminGuard, AdminId } from '../auth/guard';
import { PalettesService } from '../palettes/palettes.service';
import { PrismaService } from '../prisma.service';
import { validatePalette } from './palette-schema';

/** Admin sessions are short and not refreshable: sign in again after 8 hours. */
export const ADMIN_TTL_SEC = 8 * 60 * 60;

const loginBody = z.object({ username: z.string().min(1).max(32), password: z.string().min(1).max(72) });
const paletteBody = z.object({ data: z.unknown(), note: z.string().trim().min(1, '请填写修改说明').max(200) });
const usersQuery = z.object({
  q: z.string().max(32).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

@Controller('admin')
export class AdminController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(PalettesService) private readonly palettes: PalettesService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Ip() ip: string) {
    const b = parse(loginBody, body);
    this.limiter.hit(`admin-login:${ip}`, 10, 10 * 60_000);
    const a = await this.db.admin.findUnique({ where: { username: b.username.toLowerCase() } });
    const ok = await verifyPassword(b.password, a?.passwordHash ?? DUMMY_HASH);
    if (!a || !ok) throw unauthorized('用户名或密码不对', 'bad_credentials');
    return {
      accessToken: signAccess({ sub: a.id, adm: true }, this.config.jwtSecret, ADMIN_TTL_SEC),
      expiresIn: ADMIN_TTL_SEC,
      admin: { id: a.id, username: a.username, role: a.role },
    };
  }

  @Get('me')
  @UseGuards(AdminGuard)
  async me(@AdminId() id: string) {
    const a = await this.db.admin.findUnique({ where: { id }, select: { id: true, username: true, role: true } });
    if (!a) throw unauthorized('管理员不存在');
    return a;
  }

  @Get('palettes')
  @UseGuards(AdminGuard)
  async palettesCurrent() {
    const cur = await this.palettes.current();
    const history = await this.db.paletteRevision.findMany({ orderBy: { id: 'desc' }, take: 20, select: { id: true, note: true, adminId: true, createdAt: true } });
    return { ...cur, history };
  }

  @Put('palettes')
  @UseGuards(AdminGuard)
  async publish(@AdminId() adminId: string, @Body() body: unknown) {
    const b = parse(paletteBody, body);
    const v = validatePalette(b.data);
    if (!v.ok) throw badRequest(`色卡数据有误：${v.errors.join('；')}`, 'invalid_palette');
    return this.palettes.publish(v.data, b.note, adminId);
  }

  @Get('users')
  @UseGuards(AdminGuard)
  async users(@Query() query: unknown) {
    const q = parse(usersQuery, query);
    const where = q.q ? { OR: [{ username: { contains: q.q.toLowerCase() } }, { nickname: { contains: q.q } }] } : {};
    const [total, rows] = await Promise.all([
      this.db.user.count({ where }),
      this.db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, username: true, nickname: true, wxOpenId: true, createdAt: true, _count: { select: { works: { where: { deletedAt: null } } } } },
      }),
    ]);
    return {
      total,
      items: rows.map((u) => ({ id: u.id, username: u.username, nickname: u.nickname, wechat: !!u.wxOpenId, createdAt: u.createdAt.toISOString(), works: u._count.works })),
    };
  }
}
