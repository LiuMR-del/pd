import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { paletteData, type PaletteData } from '@pd/palettes';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

export interface PaletteRelease {
  version: number;
  updatedAt: string;
  data: PaletteData;
}

/**
 * Palette data served to clients. The first start seeds it from @pd/palettes (generated on this
 * machine by `pnpm install`, with the locally downloaded MARD values); admin edits add new revisions.
 */
@Injectable()
export class PalettesService implements OnModuleInit {
  private readonly log = new Logger('Palettes');
  private cache: PaletteRelease | null = null;

  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async onModuleInit(): Promise<void> {
    if ((await this.db.paletteRevision.count()) === 0) {
      await this.db.paletteRevision.create({ data: { data: paletteData as unknown as Prisma.InputJsonValue, note: '初始数据（@pd/palettes）' } });
      this.log.log('palette data seeded from @pd/palettes');
    }
  }

  async current(): Promise<PaletteRelease> {
    if (this.cache) return this.cache;
    const r = await this.db.paletteRevision.findFirstOrThrow({ orderBy: { id: 'desc' } });
    this.cache = { version: r.id, updatedAt: r.createdAt.toISOString(), data: r.data as unknown as PaletteData };
    return this.cache;
  }

  /** Stores a new revision (data already validated by the caller). */
  async publish(data: PaletteData, note: string, adminId: string): Promise<PaletteRelease> {
    await this.db.paletteRevision.create({ data: { data: data as unknown as Prisma.InputJsonValue, note, adminId } });
    this.cache = null;
    return this.current();
  }
}
