import { Module, type DynamicModule } from '@nestjs/common';
import { CONFIG, type AppConfig } from './config';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AdminGuard, UserGuard } from './auth/guard';
import { WechatClient, WX_FETCH, type WxFetch } from './auth/wechat';
import { RATE_LIMIT_EXEMPT, RateLimiter } from './common/rate-limit';
import { FileStore } from './files/file-store';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { MeController } from './users/me.controller';

export interface AppOverrides {
  wxFetch?: WxFetch;
  /** Rate-limit key prefixes to skip (tests only). */
  rateLimitExempt?: string[];
}

@Module({})
export class AppModule {
  static register(config: AppConfig, overrides: AppOverrides = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, AuthController, MeController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: WX_FETCH, useValue: overrides.wxFetch ?? ((url: string) => fetch(url)) },
        { provide: RATE_LIMIT_EXEMPT, useValue: overrides.rateLimitExempt ?? [] },
        PrismaService,
        RateLimiter,
        WechatClient,
        AuthService,
        UserGuard,
        AdminGuard,
        FileStore,
      ],
    };
  }
}
