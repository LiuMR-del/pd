import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app';
import type { AppOverrides } from '../src/app.module';
import { loadConfig, type AppConfig } from '../src/config';

try {
  process.loadEnvFile('.env');
} catch {
  /* real environment */
}

export const JWT_SECRET = 'test-secret-test-secret-test-secret-0123';

export function testConfig(): AppConfig {
  return loadConfig({
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    JWT_SECRET,
    STORAGE_DIR: mkdtempSync(join(tmpdir(), 'pd-files-')),
    WX_APPID: 'wx-test',
    WX_SECRET: 'wx-secret',
  });
}

export interface TestServer {
  app: INestApplication;
  config: AppConfig;
  call(method: string, path: string, opts?: { body?: unknown; token?: string; raw?: Buffer; type?: string }): Promise<{ status: number; body: any; headers: Headers; bytes: Buffer }>;
  close(): Promise<void>;
}

export async function startServer(overrides: AppOverrides = {}): Promise<TestServer> {
  const config = testConfig();
  const app = await createApp(config, { rateLimitExempt: ['register:'], ...overrides }, false);
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');
  return {
    app,
    config,
    async call(method, path, opts = {}) {
      const headers: Record<string, string> = {};
      if (opts.token) headers.authorization = `Bearer ${opts.token}`;
      let body: Uint8Array | string | undefined;
      if (opts.raw) {
        headers['content-type'] = opts.type ?? 'application/octet-stream';
        body = new Uint8Array(opts.raw);
      } else if (opts.body !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }
      const res = await fetch(base + path, { method, headers, body });
      const bytes = Buffer.from(await res.arrayBuffer());
      const text = bytes.toString();
      let parsed: unknown = text;
      if ((res.headers.get('content-type') ?? '').includes('json')) parsed = JSON.parse(text);
      return { status: res.status, body: parsed, headers: res.headers, bytes };
    },
    close: () => app.close(),
  };
}

let n = 0;
/** A username that is unique within the test run. */
const RUN = Math.random().toString(36).slice(2, 8);
export const uniqueName = (prefix = "u") => `${prefix}_${RUN}_${++n}`;

export async function registerUser(s: TestServer, password = 'password123') {
  const username = uniqueName();
  const r = await s.call('POST', '/auth/register', { body: { username, password } });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { username, password, token: r.body.tokens.accessToken as string, refresh: r.body.tokens.refreshToken as string, id: r.body.user.id as string };
}
