import { execFileSync } from 'node:child_process';

/**
 * Applies pending migrations to the test database before the run (needs `docker compose up -d`).
 * Non-destructive: nothing is wiped; every test creates its own uniquely named users and works.
 */
export default function setup(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* CI: real environment */
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL 未设置（见 apps/server/.env.example）');
  if (!/\/pd_test(\?|$)/.test(url)) throw new Error('TEST_DATABASE_URL 的库名必须是 pd_test（测试会往里写数据）');
  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url, SHADOW_DATABASE_URL: '' },
      stdio: 'pipe',
    });
  } catch (e) {
    const out = (e as { stderr?: Buffer; stdout?: Buffer }).stderr?.toString() || (e as { stdout?: Buffer }).stdout?.toString() || String(e);
    throw new Error(`无法初始化测试数据库（MySQL 是否已用 docker compose up -d 启动？）\n${out}`);
  }
}
