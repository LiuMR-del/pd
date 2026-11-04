import { describe, expect, it } from 'vitest';
import { DUMMY_HASH, hashPassword, signAccess, verifyAccess, verifyPassword } from '../src/auth/crypto';

describe('passwords', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('wrong horse', a)).toBe(false);
  });

  it('rejects malformed hashes and the dummy hash', async () => {
    expect(await verifyPassword('x', 'plain')).toBe(false);
    expect(await verifyPassword('', DUMMY_HASH)).toBe(false);
  });
});

describe('access tokens', () => {
  const secret = 's'.repeat(32);
  it('round-trips claims', () => {
    const t = signAccess({ sub: 'u1' }, secret, 60);
    expect(verifyAccess(t, secret)?.sub).toBe('u1');
  });
  it('rejects expired, forged and tampered tokens', () => {
    const t = signAccess({ sub: 'u1' }, secret, 60, Date.now() - 120_000);
    expect(verifyAccess(t, secret)).toBeNull();
    const ok = signAccess({ sub: 'u1' }, secret, 60);
    expect(verifyAccess(ok, 'x'.repeat(32))).toBeNull();
    const [h, , sig] = ok.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'admin', adm: true, iat: 0, exp: 9e9 })).toString('base64url')}.${sig}`;
    expect(verifyAccess(forged, secret)).toBeNull();
    expect(verifyAccess('a.b', secret)).toBeNull();
  });
});
