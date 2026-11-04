import { Body, Controller, HttpCode, Inject, Ip, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../common/http';
import { RateLimiter } from '../common/rate-limit';
import { AuthService } from './auth.service';

export const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;
const username = z.string().regex(USERNAME_RE, '用户名为 3~32 位字母、数字或下划线');
export const passwordSchema = z.string().min(8, '密码至少 8 位').max(72, '密码最多 72 位');
const credentials = z.object({ username, password: z.string().min(1, '请输入密码').max(72) });
const registerBody = z.object({ username, password: passwordSchema });
const refreshBody = z.object({ refreshToken: z.string().min(10).max(200) });
const wxBody = z.object({ code: z.string().min(1).max(200) });

const MIN = 60_000;
const ua = (req: Request) => String(req.headers['user-agent'] ?? '');

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Post('register')
  async register(@Body() body: unknown, @Ip() ip: string, @Req() req: Request) {
    this.limiter.hit(`register:${ip}`, 10, 60 * MIN);
    const b = parse(registerBody, body);
    return this.auth.register(b.username, b.password, ua(req));
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Ip() ip: string, @Req() req: Request) {
    const b = parse(credentials, body);
    this.limiter.hit(`login:${ip}`, 30, 10 * MIN);
    this.limiter.hit(`login-user:${b.username.toLowerCase()}`, 10, 10 * MIN);
    const r = await this.auth.login(b.username, b.password, ua(req));
    this.limiter.reset(`login-user:${b.username.toLowerCase()}`);
    return r;
  }

  @Post('wx-login')
  @HttpCode(200)
  async wxLogin(@Body() body: unknown, @Ip() ip: string, @Req() req: Request) {
    this.limiter.hit(`wx-login:${ip}`, 30, 10 * MIN);
    return this.auth.wxLogin(parse(wxBody, body).code, ua(req));
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown, @Ip() ip: string, @Req() req: Request) {
    this.limiter.hit(`refresh:${ip}`, 120, 10 * MIN);
    return this.auth.refresh(parse(refreshBody, body).refreshToken, ua(req));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: unknown) {
    await this.auth.logout(parse(refreshBody, body).refreshToken);
  }
}
