import { Inject, Injectable } from '@nestjs/common';
import { docFromDraft, type PatternDraftV1 } from '@pd/editor-core';
import { badRequest, conflict, notFound } from '../common/http';
import { FileStore } from '../files/file-store';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

export const MAX_WORKS_PER_USER = 500;
export const MAX_VERSIONS_PER_WORK = 30;
/** A save creates a history version when the previous one is at least this old. */
export const AUTO_VERSION_MS = 30 * 60 * 1000;

export type SnapshotReason = 'auto' | 'manual' | 'backup' | 'restore';

export interface SaveInput {
  /** The revision the client edited; null / 0 when creating. */
  baseRevision: number | null;
  draft: unknown;
  meta?: unknown;
  thumbKey?: string | null;
  sourceKey?: string | null;
  /** Force a history version for this save ('manual' = user asked, 'backup' = before regenerating). */
  snapshot?: 'manual' | 'backup';
}

type WorkRow = Prisma.WorkGetPayload<object>;

export interface WorkSummaryDto {
  id: string;
  name: string;
  revision: number;
  clientUpdatedAt: number;
  updatedAt: string;
  deleted: boolean;
  thumbKey: string | null;
  sourceKey: string | null;
}

export interface WorkDto extends WorkSummaryDto {
  draft: PatternDraftV1;
  meta: unknown;
}

const summary = (w: WorkRow): WorkSummaryDto => ({
  id: w.id,
  name: w.name,
  revision: w.revision,
  clientUpdatedAt: Number(w.clientUpdatedAt),
  updatedAt: w.updatedAt.toISOString(),
  deleted: !!w.deletedAt,
  thumbKey: w.thumbKey,
  sourceKey: w.sourceKey,
});
const full = (w: WorkRow): WorkDto => ({ ...summary(w), draft: w.draft as unknown as PatternDraftV1, meta: w.meta ?? null });

function validateDraft(id: string, raw: unknown): PatternDraftV1 {
  try {
    docFromDraft(raw);
  } catch (e) {
    throw badRequest(`图纸数据无效：${e instanceof Error ? e.message : String(e)}`, 'invalid_draft');
  }
  const d = raw as PatternDraftV1;
  if (d.id !== id) throw badRequest('图纸编号和地址不一致', 'invalid_draft');
  if (d.name.length > 100) throw badRequest('作品名最多 100 个字', 'invalid_draft');
  return d;
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

@Injectable()
export class WorksService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(FileStore) private readonly files: FileStore,
  ) {}

  /** Without `since`: live works. With `since`: everything changed after it, deletions included (for sync). */
  async list(userId: string, since?: Date): Promise<WorkSummaryDto[]> {
    const rows = await this.db.work.findMany({
      where: since ? { userId, updatedAt: { gt: since } } : { userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, userId: true, name: true, revision: true, clientUpdatedAt: true, updatedAt: true, deletedAt: true, thumbKey: true, sourceKey: true, createdAt: true, lastVersionAt: true, draft: false, meta: false },
    });
    return rows.map((r) => summary(r as WorkRow));
  }

  async get(userId: string, id: string): Promise<WorkDto> {
    const w = await this.db.work.findUnique({ where: { id } });
    if (!w || w.userId !== userId || w.deletedAt) throw notFound('作品不存在或已删除', 'work_not_found');
    return full(w);
  }

  /**
   * Creates or updates a work with optimistic concurrency: the client says which revision it
   * edited; a mismatch is a 409 and nothing is overwritten (the client keeps its copy as a new work).
   */
  async save(userId: string, id: string, input: SaveInput): Promise<WorkDto> {
    const draft = validateDraft(id, input.draft);
    await this.checkFile(userId, input.thumbKey);
    await this.checkFile(userId, input.sourceKey);
    const now = new Date();
    const stale: (string | null)[] = [];

    const result = await this.db.$transaction(async (tx) => {
      const cur = await tx.work.findUnique({ where: { id } });
      if (cur && cur.userId !== userId) throw conflict('作品编号冲突，请另存一份', 'id_taken');
      if (cur?.deletedAt) throw conflict('这个作品已在别处删除', 'work_deleted');
      if (!cur) {
        if (input.baseRevision) throw notFound('作品不存在或已删除', 'work_not_found');
        const count = await tx.work.count({ where: { userId, deletedAt: null } });
        if (count >= MAX_WORKS_PER_USER) throw conflict(`云端最多保存 ${MAX_WORKS_PER_USER} 个作品，请先删除一些`, 'too_many_works');
        const w = await tx.work.create({
          data: {
            id,
            userId,
            name: draft.name,
            draft: json(draft),
            meta: input.meta === undefined ? undefined : json(input.meta),
            thumbKey: input.thumbKey ?? null,
            sourceKey: input.sourceKey ?? null,
            clientUpdatedAt: BigInt(Math.round(draft.updatedAt)),
            lastVersionAt: now,
          },
        });
        await tx.workVersion.create({ data: { workId: id, revision: 1, name: draft.name, draft: json(draft), reason: input.snapshot ?? 'auto' } });
        return w;
      }
      if (input.baseRevision !== cur.revision) {
        throw conflict('这个作品已在别处修改过', 'revision_conflict');
      }
      const reason: SnapshotReason | null =
        input.snapshot ?? (!cur.lastVersionAt || now.getTime() - cur.lastVersionAt.getTime() >= AUTO_VERSION_MS ? 'auto' : null);
      // the guarded update makes two racing saves of the same revision impossible
      const r = await tx.work.updateMany({
        where: { id, revision: cur.revision },
        data: {
          name: draft.name,
          revision: { increment: 1 },
          draft: json(draft),
          ...(input.meta === undefined ? {} : { meta: json(input.meta) }),
          ...(input.thumbKey === undefined ? {} : { thumbKey: input.thumbKey }),
          ...(input.sourceKey === undefined ? {} : { sourceKey: input.sourceKey }),
          clientUpdatedAt: BigInt(Math.round(draft.updatedAt)),
          ...(reason ? { lastVersionAt: now } : {}),
        },
      });
      if (r.count !== 1) throw conflict('这个作品已在别处修改过', 'revision_conflict');
      if (input.thumbKey !== undefined && cur.thumbKey !== input.thumbKey) stale.push(cur.thumbKey);
      if (input.sourceKey !== undefined && cur.sourceKey !== input.sourceKey) stale.push(cur.sourceKey);
      if (reason) await this.snapshot(tx, id, cur.revision + 1, draft, reason);
      return tx.work.findUniqueOrThrow({ where: { id } });
    });
    for (const k of stale) await this.removeIfUnused(userId, k);
    return full(result);
  }

  /** Soft delete: the row stays as a tombstone for sync; history and files are removed. */
  async remove(userId: string, id: string): Promise<void> {
    const w = await this.db.work.findUnique({ where: { id } });
    if (!w || w.userId !== userId) throw notFound('作品不存在或已删除', 'work_not_found');
    if (w.deletedAt) return;
    await this.db.$transaction([
      this.db.workVersion.deleteMany({ where: { workId: id } }),
      this.db.work.update({ where: { id }, data: { deletedAt: new Date(), draft: {}, meta: Prisma.DbNull, thumbKey: null, sourceKey: null, revision: { increment: 1 } } }),
    ]);
    await this.removeIfUnused(userId, w.thumbKey);
    await this.removeIfUnused(userId, w.sourceKey);
  }

  /** A copy of a work may share its source image, so a file is only deleted when nothing refers to it. */
  private async removeIfUnused(userId: string, key: string | null) {
    if (!key) return;
    const used = await this.db.work.count({ where: { userId, OR: [{ thumbKey: key }, { sourceKey: key }] } });
    if (!used) await this.files.remove(userId, key);
  }

  async versions(userId: string, id: string) {
    await this.get(userId, id);
    const rows = await this.db.workVersion.findMany({
      where: { workId: id },
      orderBy: { id: 'desc' },
      select: { id: true, revision: true, name: true, reason: true, createdAt: true },
    });
    return rows.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() }));
  }

  async version(userId: string, id: string, versionId: number) {
    await this.get(userId, id);
    const v = await this.db.workVersion.findUnique({ where: { id: versionId } });
    if (!v || v.workId !== id) throw notFound('历史版本不存在', 'version_not_found');
    return { id: v.id, revision: v.revision, name: v.name, reason: v.reason, createdAt: v.createdAt.toISOString(), draft: v.draft };
  }

  /** Saves the current state as a version (reason 'manual'). */
  async addVersion(userId: string, id: string) {
    const w = await this.get(userId, id);
    await this.db.$transaction(async (tx) => {
      await this.snapshot(tx, id, w.revision, w.draft, 'manual');
      await tx.work.update({ where: { id }, data: { lastVersionAt: new Date() } });
    });
    return this.versions(userId, id);
  }

  /** Makes an old version current again; the state before the restore is kept as a version. */
  async restore(userId: string, id: string, versionId: number, baseRevision: number): Promise<WorkDto> {
    const cur = await this.get(userId, id);
    if (cur.revision !== baseRevision) throw conflict('这个作品已在别处修改过', 'revision_conflict');
    const v = await this.version(userId, id, versionId);
    const draft = { ...(v.draft as unknown as PatternDraftV1), id, updatedAt: Date.now() };
    const result = await this.db.$transaction(async (tx) => {
      await this.snapshot(tx, id, cur.revision, cur.draft, 'restore');
      const r = await tx.work.updateMany({
        where: { id, revision: cur.revision },
        data: { name: draft.name, draft: json(draft), revision: { increment: 1 }, clientUpdatedAt: BigInt(draft.updatedAt), lastVersionAt: new Date() },
      });
      if (r.count !== 1) throw conflict('这个作品已在别处修改过', 'revision_conflict');
      return tx.work.findUniqueOrThrow({ where: { id } });
    });
    return full(result);
  }

  private async snapshot(tx: Prisma.TransactionClient, workId: string, revision: number, draft: PatternDraftV1, reason: SnapshotReason) {
    await tx.workVersion.create({ data: { workId, revision, name: draft.name, draft: json(draft), reason } });
    const old = await tx.workVersion.findMany({ where: { workId }, orderBy: { id: 'desc' }, skip: MAX_VERSIONS_PER_WORK, select: { id: true } });
    if (old.length) await tx.workVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  }

  private async checkFile(userId: string, key: string | null | undefined) {
    if (key == null) return;
    if (!FileStore.isKey(key) || !(await this.files.get(userId, key))) throw badRequest('引用的图片不存在，请重新上传', 'file_not_found');
  }
}
