/**
 * Creates (or resets the password of) an admin account.
 *   pnpm --filter @pd/server admin:create <username> [owner|staff]
 * The password is read from the ADMIN_PASSWORD environment variable or asked for on the terminal.
 */
import { createInterface } from 'node:readline/promises';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { hashPassword } from '../src/auth/crypto';
import { loadConfig } from '../src/config';
import { PrismaClient } from '../src/generated/prisma/client';

try {
  process.loadEnvFile('.env');
} catch {
  /* real environment */
}
const [username, role = 'owner'] = process.argv.slice(2);
if (!username || !/^[A-Za-z0-9_]{3,32}$/.test(username) || !['owner', 'staff'].includes(role)) {
  console.error('用法：pnpm --filter @pd/server admin:create <用户名（3~32 位字母数字下划线）> [owner|staff]');
  process.exit(1);
}
let password = process.env.ADMIN_PASSWORD ?? '';
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('密码（至少 10 位）：');
  rl.close();
}
if (password.length < 10) {
  console.error('密码至少 10 位');
  process.exit(1);
}
const url = new URL(loadConfig().databaseUrl);
url.searchParams.set('allowPublicKeyRetrieval', 'true');
const db = new PrismaClient({ adapter: new PrismaMariaDb(url.toString()) });
const name = username.toLowerCase();
const passwordHash = await hashPassword(password);
await db.admin.upsert({ where: { username: name }, create: { username: name, passwordHash, role }, update: { passwordHash, role } });
console.log(`管理员 ${name}（${role}）已保存`);
await db.$disconnect();
