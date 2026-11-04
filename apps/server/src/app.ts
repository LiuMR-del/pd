import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppConfig } from './config';
import { AppModule, type AppOverrides } from './app.module';
import { ErrorFilter } from './common/http';

/** Builds the HTTP app (used by main.ts and the tests). */
export async function createApp(config: AppConfig, overrides: AppOverrides = {}, logger = true): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config, overrides), {
    logger: logger ? ['error', 'warn', 'log'] : false,
    bodyParser: false,
  });
  // drafts are small (run-length encoded cells), 2MB leaves room for 200×200 noise
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('raw', { type: ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'], limit: '8mb' });
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.useGlobalFilters(new ErrorFilter());
  app.enableCors({ origin: config.corsOrigins, maxAge: 600 });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
