import { defineConfig } from 'prisma/config';

// DATABASE_URL comes from the environment (.env is loaded by the npm scripts via process.loadEnvFile below).
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env: rely on the real environment */
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '', shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined },
});
