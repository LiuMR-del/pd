import { Body, Controller, Get, Inject, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { badRequest, notFound } from '../common/http';
import { RateLimiter } from '../common/rate-limit';
import { UserGuard, UserId } from '../auth/guard';
import { contentTypeOf, FileStore } from './file-store';

@Controller('files')
@UseGuards(UserGuard)
export class FilesController {
  constructor(
    @Inject(FileStore) private readonly files: FileStore,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  /** Raw image body (Content-Type image/png, image/jpeg or image/webp). */
  @Post()
  async upload(@UserId() userId: string, @Body() body: unknown) {
    if (!Buffer.isBuffer(body)) throw badRequest('请用图片格式上传（Content-Type: image/png、image/jpeg 或 image/webp）', 'file_type');
    this.limiter.hit(`upload:${userId}`, 300, 60 * 60_000);
    return { key: await this.files.put(userId, body) };
  }

  @Get(':key')
  async get(@UserId() userId: string, @Param('key') key: string, @Res() res: Response) {
    const data = await this.files.get(userId, key);
    if (!data) throw notFound('文件不存在', 'file_not_found');
    res.setHeader('Content-Type', contentTypeOf(key));
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(data);
  }
}
