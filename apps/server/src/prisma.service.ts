import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { CONFIG, type AppConfig } from './config';
import { PrismaClient } from './generated/prisma/client';

/** MySQL 8 by default uses caching_sha2_password; the MariaDB driver needs the server key for it over plain TCP. */
function withDriverOptions(url: string): string {
  const u = new URL(url);
  if (!u.searchParams.has('allowPublicKeyRetrieval')) u.searchParams.set('allowPublicKeyRetrieval', 'true');
  return u.toString();
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(CONFIG) config: AppConfig) {
    super({ adapter: new PrismaMariaDb(withDriverOptions(config.databaseUrl)) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
