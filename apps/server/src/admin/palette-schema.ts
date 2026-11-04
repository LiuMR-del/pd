import type { PaletteData } from '@pd/palettes';
import { z } from 'zod';

const hex = z.string().regex(/^#[0-9A-F]{6}$/, '色值必须是 #RRGGBB（大写）');

const schema = z.object({
  _source: z.record(z.string(), z.string()),
  schemaVersion: z.literal(1),
  brands: z.array(z.string().min(1).max(20)).min(1).max(20),
  colors: z
    .array(
      z.object({
        id: z.number().int().min(0),
        hex,
        codes: z.record(z.string(), z.string().max(20)),
        altCodes: z.record(z.string(), z.array(z.string().max(20))).optional(),
        vendorHex: hex.optional(),
      }),
    )
    .min(1)
    .max(2000),
  tiers: z
    .array(
      z.object({
        id: z.string().min(1).max(20),
        size: z.number().int().min(1),
        synthetic: z.boolean(),
        method: z.string().max(200),
        colorIds: z.array(z.number().int().min(0)),
      }),
    )
    .min(1),
  knownIssues: z.array(z.object({ brand: z.string(), code: z.string(), hexes: z.array(z.string()), note: z.string() })),
});

/** Structural + consistency checks for palette data edited in the admin. Returns problems in Chinese. */
export function validatePalette(raw: unknown): { ok: true; data: PaletteData } | { ok: false; errors: string[] } {
  const r = schema.safeParse(raw);
  if (!r.success) return { ok: false, errors: r.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}：${i.message}`) };
  const d = r.data as PaletteData;
  const errors: string[] = [];
  d.colors.forEach((c, i) => {
    if (c.id !== i) errors.push(`第 ${i + 1} 个颜色的编号应为 ${i}`);
  });
  for (const b of d.brands) {
    const seen = new Map<string, number>();
    d.colors.forEach((c) => {
      const code = c.codes[b];
      if (!code) return errors.push(`颜色 ${c.id} 缺少 ${b} 色号`);
      // the known one-code-two-colors cases of the source data are allowed (see knownIssues)
      const known = d.knownIssues.some((k) => k.brand === b && k.code === code);
      if (seen.has(code) && !known) errors.push(`${b} 色号 ${code} 重复（颜色 ${seen.get(code)} 和 ${c.id}）`);
      seen.set(code, c.id);
    });
  }
  const ids = new Set<string>();
  for (const t of d.tiers) {
    if (ids.has(t.id)) errors.push(`色数档 ${t.id} 重复`);
    ids.add(t.id);
    if (new Set(t.colorIds).size !== t.colorIds.length) errors.push(`色数档 ${t.id} 里有重复颜色`);
    if (t.colorIds.some((id) => id >= d.colors.length)) errors.push(`色数档 ${t.id} 引用了不存在的颜色`);
    if (t.size !== t.colorIds.length) errors.push(`色数档 ${t.id} 的数量 ${t.size} 与颜色个数 ${t.colorIds.length} 不一致`);
  }
  if (!d.tiers.some((t) => t.id === 'all')) errors.push('缺少「全部颜色」色数档（id 为 all）');
  return errors.length ? { ok: false, errors: errors.slice(0, 20) } : { ok: true, data: d };
}
