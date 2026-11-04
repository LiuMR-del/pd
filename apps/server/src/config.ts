import { resolve } from 'node:path';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().startsWith('mysql://', 'DATABASE_URL 必须是 mysql:// 连接串'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET 至少 32 个字符')
    .refine((s) => !/change-me/i.test(s) && new Set(s).size >= 10, 'JWT_SECRET 不能用示例值，请换成随机字符串'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  CORS_ORIGINS: z.string().default(''),
  STORAGE_DIR: z.string().default('./storage'),
  WX_APPID: z.string().default(''),
  WX_SECRET: z.string().default(''),
});

export interface AppConfig {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  corsOrigins: string[];
  storageDir: string;
  wx: { appId: string; secret: string } | null;
}

/** Reads and validates the environment once at startup; a bad value stops the server with a readable message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const r = schema.safeParse(env);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`配置有误（见 apps/server/.env.example）：\n${lines.join('\n')}`);
  }
  const c = r.data;
  return {
    databaseUrl: c.DATABASE_URL,
    jwtSecret: c.JWT_SECRET,
    port: c.PORT,
    corsOrigins: c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    storageDir: resolve(c.STORAGE_DIR),
    wx: c.WX_APPID && c.WX_SECRET ? { appId: c.WX_APPID, secret: c.WX_SECRET } : null,
  };
}

export const CONFIG = Symbol('CONFIG');
