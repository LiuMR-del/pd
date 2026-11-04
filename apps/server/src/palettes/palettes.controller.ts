import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PalettesService } from './palettes.service';

@Controller('palettes')
export class PalettesController {
  constructor(@Inject(PalettesService) private readonly palettes: PalettesService) {}

  /** Public. Clients cache it and send If-None-Match; the bundled palette is their offline fallback. */
  @Get()
  async get(@Req() req: Request, @Res() res: Response) {
    const p = await this.palettes.current();
    const etag = `"palette-${p.version}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.json(p);
  }
}
