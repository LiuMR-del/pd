import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// ---- passwords: scrypt (built into Node, no native add-on) ----

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** Returns `scrypt$N$r$p$salt$hash` (base64url parts). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  const key = await scryptAsync(password, salt, n, r, p);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash to compare against when the user does not exist, so timing does not reveal usernames. */
export const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

// ---- access tokens: compact HS256 JWT ----

export interface AccessClaims {
  /** user id, or admin id when `adm` is true */
  sub: string;
  adm?: boolean;
  iat: number;
  exp: number;
}

const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
const HEADER = b64({ alg: 'HS256', typ: 'JWT' });

export function signAccess(claims: Omit<AccessClaims, 'iat' | 'exp'>, secret: string, ttlSec: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const body = `${HEADER}.${b64({ ...claims, iat, exp: iat + ttlSec })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/** Returns the claims, or null when the token is malformed, forged or expired. */
export function verifyAccess(token: string, secret: string, now = Date.now()): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  const sig = Buffer.from(parts[2], 'base64url');
  const want = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
  try {
    const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as AccessClaims;
    if (typeof c.sub !== 'string' || typeof c.exp !== 'number' || c.exp * 1000 <= now) return null;
    return c;
  } catch {
    return null;
  }
}

// ---- refresh tokens: random, stored hashed ----

export const newRefreshToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
