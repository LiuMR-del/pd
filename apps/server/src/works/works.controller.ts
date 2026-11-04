import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { badRequest, parse } from '../common/http';
import { UserGuard, UserId } from '../auth/guard';
import { WorksService } from './works.service';

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const fileKey = z.string().max(100).nullable().optional();
const saveBody = z.object({
  baseRevision: z.number().int().min(0).nullable(),
  draft: z.unknown(),
  meta: z.unknown().optional(),
  thumbKey: fileKey,
  sourceKey: fileKey,
  snapshot: z.enum(['manual', 'backup']).optional(),
});
const restoreBody = z.object({ baseRevision: z.number().int().min(1) });
const listQuery = z.object({ since: z.string().datetime({ offset: true }).optional() });

function workId(id: string): string {
  if (!ID_RE.test(id)) throw badRequest('作品编号格式不对', 'invalid_id');
  return id;
}

function versionId(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw badRequest('历史版本编号不对', 'invalid_id');
  return n;
}

@Controller('works')
@UseGuards(UserGuard)
export class WorksController {
  constructor(@Inject(WorksService) private readonly works: WorksService) {}

  @Get()
  list(@UserId() userId: string, @Query() query: unknown) {
    const q = parse(listQuery, query);
    return this.works.list(userId, q.since ? new Date(q.since) : undefined);
  }

  @Get(':id')
  get(@UserId() userId: string, @Param('id') id: string) {
    return this.works.get(userId, workId(id));
  }

  @Put(':id')
  save(@UserId() userId: string, @Param('id') id: string, @Body() body: unknown) {
    return this.works.save(userId, workId(id), parse(saveBody, body));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@UserId() userId: string, @Param('id') id: string, @Query() query: unknown) {
    const q = parse(z.object({ baseRevision: z.coerce.number().int().min(1).optional() }), query);
    await this.works.remove(userId, workId(id), q.baseRevision);
  }

  @Get(':id/versions')
  versions(@UserId() userId: string, @Param('id') id: string) {
    return this.works.versions(userId, workId(id));
  }

  @Post(':id/versions')
  addVersion(@UserId() userId: string, @Param('id') id: string) {
    return this.works.addVersion(userId, workId(id));
  }

  @Get(':id/versions/:vid')
  version(@UserId() userId: string, @Param('id') id: string, @Param('vid') vid: string) {
    return this.works.version(userId, workId(id), versionId(vid));
  }

  @Post(':id/versions/:vid/restore')
  @HttpCode(200)
  restore(@UserId() userId: string, @Param('id') id: string, @Param('vid') vid: string, @Body() body: unknown) {
    return this.works.restore(userId, workId(id), versionId(vid), parse(restoreBody, body).baseRevision);
  }
}
