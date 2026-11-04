import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config';
import { badRequest } from '../common/http';

/** Image types accepted for upload, recognized by their first bytes (the client's Content-Type is not trusted). */
const SIGNATURES: { type: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { type: 'image/png', ext: 'png', test: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a },
  { type: 'image/jpeg', ext: 'jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/webp', ext: 'webp', test: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
];

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const KEY_RE = /^[a-f0-9]{24}\.(png|jpg|webp)$/;
const USER_RE = /^[a-z0-9]{8,32}$/;

export function sniffImage(b: Buffer): { type: string; ext: string } | null {
  const s = SIGNATURES.find((x) => x.test(b));
  return s ? { type: s.type, ext: s.ext } : null;
}

export function contentTypeOf(key: string): string {
  return key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
}

/**
 * Files on the local disk under STORAGE_DIR/<userId>/<key>. Keys are generated here, never taken
 * from the client as paths. Swap for Tencent COS at deployment (same interface).
 */
@Injectable()
export class FileStore {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  static isKey(key: string): boolean {
    return KEY_RE.test(key);
  }

  private dir(userId: string): string {
    if (!USER_RE.test(userId)) throw new Error('bad user id');
    return join(this.config.storageDir, userId);
  }

  async put(userId: string, data: Buffer): Promise<string> {
    if (data.length === 0) throw badRequest('文件是空的', 'file_empty');
    if (data.length > MAX_FILE_BYTES) throw badRequest('文件超过 8MB', 'file_too_large');
    const kind = sniffImage(data);
    if (!kind) throw badRequest('只支持 PNG、JPG、WebP 图片', 'file_type');
    const key = `${randomBytes(12).toString('hex')}.${kind.ext}`;
    const dir = this.dir(userId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, key), data, { flag: 'wx' });
    return key;
  }

  async get(userId: string, key: string): Promise<Buffer | null> {
    if (!FileStore.isKey(key)) return null;
    try {
      return await readFile(join(this.dir(userId), key));
    } catch {
      return null;
    }
  }

  async remove(userId: string, key: string | null | undefined): Promise<void> {
    if (!key || !FileStore.isKey(key)) return;
    await rm(join(this.dir(userId), key), { force: true });
  }

  async removeUser(userId: string): Promise<void> {
    await rm(this.dir(userId), { recursive: true, force: true });
  }
}
