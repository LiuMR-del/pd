import { Controller, Get, Inject } from '@nestjs/common';
import { ApiError } from './common/http';
import { PrismaService } from './prisma.service';

/** AGPL-3.0 §13: users of the network service are offered the source. */
export const SOURCE_URL = 'https://github.com/LiuMR-del/pd';

@Controller()
export class HealthController {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  @Get('health')
  async health() {
    try {
      await this.db.$queryRaw`SELECT 1`;
    } catch {
      throw new ApiError(503, 'db_unavailable', '数据库不可用');
    }
    return { ok: true, source: SOURCE_URL };
  }
}
