import { docFromPattern, docToDraft, EMPTY_CELL, type PatternDoc } from '@pd/editor-core';
import { getPalette } from '@pd/palettes';
import { generatePattern, presetOptions } from '@pd/pattern-core';
import { describe, expect, it } from 'vitest';
import { EXPORT_CELL, fitSheet, MAX_EXPORT_PIXELS, MAX_EXPORT_SIDE } from '../src/lib/export-size';
import { makeTestImage } from '../src/lib/self-test';
import { defaultWorkName, WorksStore, type FileStore, type KeyValue } from '../src/lib/works';

class MemFiles implements FileStore {
  files = new Map<string, string>();
  dirs = new Set<string>();
  readText(path: string): string | null {
    return this.files.get(path) ?? null;
  }
  writeText(path: string, text: string): void {
    this.files.set(path, text);
  }
  copy(src: string, dest: string): void {
    const v = this.files.get(src);
    if (v === undefined) throw new Error(`no such file ${src}`);
    this.files.set(dest, v);
  }
  remove(path: string): void {
    if (!this.files.delete(path)) throw new Error(`no such file ${path}`);
  }
  ensureDir(path: string): void {
    this.dirs.add(path);
  }
}

class MemKV implements KeyValue {
  map = new Map<string, unknown>();
  get(key: string): unknown {
    return this.map.has(key) ? JSON.parse(JSON.stringify(this.map.get(key))) : '';
  }
  set(key: string, value: unknown): void {
    this.map.set(key, JSON.parse(JSON.stringify(value)));
  }
}

function makeDoc(id: string, name = '测试图纸', longSide = 24): PatternDoc {
  const r = generatePattern(makeTestImage(), getPalette('MARD', 221), { ...presetOptions('cartoon', 'balanced'), longSide });
  return docFromPattern(r, { id, name, brand: 'MARD', tier: '221', settings: { kind: 'image' } });
}

function setup() {
  let t = 1000;
  const files = new MemFiles();
  const kv = new MemKV();
  files.files.set('tmp/photo.png', 'PHOTO');
  files.files.set('tmp/thumb.png', 'THUMB');
  const user = { uid: null as string | null };
  const store = new WorksStore(files, kv, 'user/works', () => ++t, () => user.uid);
  return { files, kv, store, user };
}

describe('WorksStore cloud fields', () => {
  const remote = (doc: PatternDoc, revision: number, sourceKey: string | null = null) => ({
    id: doc.id, name: doc.name, revision, updatedAt: '', deleted: false, sourceKey, draft: docToDraft(doc), meta: { crop: null },
  });

  it('new works belong to the signed-in account; signed out, other accounts are hidden', () => {
    const { store, user } = setup();
    store.save(makeDoc('anon', '没登录'));
    user.uid = 'u1';
    store.save(makeDoc('mine', '我的'));
    expect(store.syncWork('mine')).toMatchObject({ owner: 'u1', dirty: true, cloud: null });
    expect(store.visible().map((w) => w.id).sort()).toEqual(['anon', 'mine']);
    user.uid = 'u2';
    expect(store.visible().map((w) => w.id)).toEqual(['anon']);
    user.uid = null;
    expect(store.visible().map((w) => w.id)).toEqual(['anon']);
    // saving keeps the owner even when someone else is signed in
    store.save(makeDoc('mine', '我的'));
    expect(store.syncWork('mine')!.owner).toBe('u1');
  });

  it('claim gives signed-out works to an account', () => {
    const { store } = setup();
    store.save(makeDoc('a'));
    store.save(makeDoc('b'));
    expect(store.claim('u1')).toBe(2);
    expect(store.syncWorks().every((w) => w.owner === 'u1' && w.dirty)).toBe(true);
    expect(store.claim('u1')).toBe(0);
  });

  it('upload bookkeeping: clean after upload, still dirty when edited meanwhile', () => {
    const { store, user } = setup();
    user.uid = 'u1';
    const doc = makeDoc('w1');
    store.save(doc);
    const snap = store.syncWork('w1')!;
    expect(store.uploaded('w1', snap, { revision: 1, sourceKey: null })).toBe(false);
    expect(store.list()[0]).toMatchObject({ dirty: false, inCloud: true });
    doc.updatedAt += 5;
    store.save(doc);
    const snap2 = store.syncWork('w1')!;
    doc.updatedAt += 5;
    store.save(doc, { baseRevision: 1 });
    expect(store.uploaded('w1', snap2, { revision: 2, sourceKey: null })).toBe(true);
    expect(store.syncWork('w1')).toMatchObject({ dirty: true, cloud: { revision: 2 } });
    expect(store.revisionOf('w1')).toBe(2);
  });

  it('stores downloaded versions (photo replaced or kept) as clean', () => {
    const { files, store } = setup();
    files.files.set('tmp/dl.jpg', 'REMOTE');
    const doc = makeDoc('w1', '云端');
    store.storeRemote('u1', remote(doc, 3, 'k1'), 'tmp/dl.jpg');
    expect(store.syncWork('w1')).toMatchObject({ owner: 'u1', dirty: false, cloud: { revision: 3, sourceKey: 'k1' }, hasSource: true, name: '云端' });
    expect(files.files.get(store.sourceOf('w1')!)).toBe('REMOTE');
    store.storeRemote('u1', remote(doc, 4, 'k1'), undefined);
    expect(files.files.get(store.sourceOf('w1')!)).toBe('REMOTE');
    store.storeRemote('u1', remote(doc, 5, null), null);
    expect(store.sourceOf('w1')).toBeNull();
    expect(store.load('w1')!.doc.cols).toBe(doc.cols);
  });

  it('a save based on an older revision goes to a 「（冲突副本）」 instead of overwriting', () => {
    const { store, user } = setup();
    user.uid = 'u1';
    const doc = makeDoc('w1', '小猫');
    store.save(doc, { source: 'tmp/photo.png' });
    store.uploaded('w1', store.syncWork('w1')!, { revision: 1, sourceKey: 'k' });
    store.storeRemote('u1', remote(makeDoc('w1', '小猫'), 2, 'k'), undefined);
    // the editor opened revision 1 and saves its edits
    const saved = store.save(doc, { baseRevision: 1 });
    expect(saved.id).not.toBe('w1');
    expect(saved.name).toBe('小猫（冲突副本）');
    expect(store.syncWork(saved.id)).toMatchObject({ owner: 'u1', dirty: true, cloud: null, hasSource: true });
    expect(store.revisionOf('w1')).toBe(2);
  });

  it('fork copies the work, its photo and thumbnail as a new, not uploaded work', () => {
    const { files, store, user } = setup();
    user.uid = 'u1';
    store.save(makeDoc('w1', '原来'), { source: 'tmp/photo.png', thumb: 'tmp/thumb.png' });
    store.uploaded('w1', store.syncWork('w1')!, { revision: 1, sourceKey: 'k' });
    const nid = store.fork('u1', 'w1', '原来（冲突副本）');
    expect(store.syncWork(nid)).toMatchObject({ name: '原来（冲突副本）', cloud: null, dirty: true, hasSource: true });
    expect(store.load(nid)!.doc.id).toBe(nid);
    expect(files.files.get(store.list().find((w) => w.id === nid)!.thumb!)).toBe('THUMB');
  });

  it('copies (conflict, backup) keep the owner of the original, also when signed out meanwhile', () => {
    const { store, user } = setup();
    user.uid = 'u1';
    const doc = makeDoc('w1', '小猫');
    store.save(doc);
    store.uploaded('w1', store.syncWork('w1')!, { revision: 1, sourceKey: null });
    user.uid = null;
    expect(store.saveCopy(doc, '小猫（修改前）').owner).toBe('u1');
    store.storeRemote('u1', remote(makeDoc('w1', '小猫'), 2), undefined);
    const conflict = store.save(doc, { baseRevision: 1 });
    expect(conflict.name).toBe('小猫（冲突副本）');
    expect(store.syncWork(conflict.id)!.owner).toBe('u1');
    expect(store.claim('u2')).toBe(0);
  });

  it('remove reports the cloud revision for deleting it there', () => {
    const { store, user } = setup();
    user.uid = 'u1';
    store.save(makeDoc('w1'));
    store.uploaded('w1', store.syncWork('w1')!, { revision: 4, sourceKey: null });
    expect(store.remove('w1')).toEqual({ owner: 'u1', revision: 4 });
    expect(store.remove('w1')).toEqual({ owner: null, revision: null });
  });
});

describe('WorksStore', () => {
  it('saves and loads a work with its source photo and thumbnail', () => {
    const { files, store } = setup();
    const doc = makeDoc('w1');
    doc.cells[0] = EMPTY_CELL;
    const crop = { x: 1, y: 2, w: 30, h: 40 };
    const s = store.save(doc, { source: 'tmp/photo.png', crop, thumb: 'tmp/thumb.png' });
    expect(s).toMatchObject({ id: 'w1', name: '测试图纸', cols: doc.cols, rows: doc.rows, thumb: 'user/works/w1.thumb.png' });
    expect(files.files.get('user/works/w1.src.png')).toBe('PHOTO');
    expect(files.files.get('user/works/w1.thumb.png')).toBe('THUMB');
    expect(files.dirs.has('user/works')).toBe(true);

    const loaded = store.load('w1')!;
    expect(loaded.file.source).toBe('user/works/w1.src.png');
    expect(loaded.file.crop).toEqual(crop);
    expect(Array.from(loaded.doc.cells)).toEqual(Array.from(doc.cells));
    expect(loaded.doc.palette).toEqual(doc.palette.map((p) => ({ key: p.key, hex: p.hex.toUpperCase() })));
    expect(loaded.doc.settings).toEqual({ kind: 'image' });
  });

  it('keeps the source, crop and thumbnail on later saves that do not pass them', () => {
    const { store } = setup();
    const doc = makeDoc('w1');
    store.save(doc, { source: 'tmp/photo.png', crop: { x: 0, y: 0, w: 5, h: 5 }, thumb: 'tmp/thumb.png' });
    doc.cells[1] = EMPTY_CELL;
    const s = store.save(doc);
    expect(s.thumb).toBe('user/works/w1.thumb.png');
    const loaded = store.load('w1')!;
    expect(loaded.file.source).toBe('user/works/w1.src.png');
    expect(loaded.file.crop).toEqual({ x: 0, y: 0, w: 5, h: 5 });
    expect(loaded.doc.cells[1]).toBe(EMPTY_CELL);
  });

  it('attaches a thumbnail to an already saved work', () => {
    const { files, store } = setup();
    store.save(makeDoc('w1'));
    expect(store.list()[0].thumb).toBeNull();
    store.setThumb('w1', 'tmp/thumb.png');
    expect(store.list()[0].thumb).toBe('user/works/w1.thumb.png');
    expect(files.files.get('user/works/w1.thumb.png')).toBe('THUMB');
    // later saves without a thumbnail keep it
    store.save(makeDoc('w1'));
    expect(store.list()[0].thumb).toBe('user/works/w1.thumb.png');
    // unknown ids are ignored
    store.setThumb('nope', 'tmp/thumb.png');
    expect(store.list().length).toBe(1);
  });

  it('lists newest first with counts, renames and removes', () => {
    const { files, store } = setup();
    store.save(makeDoc('a', '甲'), { source: 'tmp/photo.png', thumb: 'tmp/thumb.png' });
    store.save(makeDoc('b', '乙'));
    expect(store.list().map((w) => w.id)).toEqual(['b', 'a']);
    expect(store.list()[0].beads).toBeGreaterThan(0);
    expect(store.list()[0].colors).toBeGreaterThan(0);

    store.rename('a', '甲改');
    expect(store.list().map((w) => [w.id, w.name])).toEqual([
      ['a', '甲改'],
      ['b', '乙'],
    ]);
    expect(store.load('a')!.doc.name).toBe('甲改');

    store.remove('a');
    expect(store.list().map((w) => w.id)).toEqual(['b']);
    expect(store.load('a')).toBeNull();
    expect(files.files.has('user/works/a.src.png')).toBe(false);
    expect(files.files.has('user/works/a.thumb.png')).toBe(false);
    // removing again is harmless
    store.remove('a');
  });

  it('saves a backup copy with its own id and source file', () => {
    const { files, store } = setup();
    const doc = makeDoc('w1');
    store.save(doc, { source: 'tmp/photo.png' });
    const original = store.load('w1')!;
    const copy = store.saveCopy(doc, '测试图纸（修改前）', { source: original.file.source, crop: original.file.crop });
    expect(copy.id).not.toBe('w1');
    expect(copy.name).toBe('测试图纸（修改前）');
    const c = store.load(copy.id)!;
    expect(c.file.source).toBe(`user/works/${copy.id}.src.png`);
    expect(files.files.get(c.file.source!)).toBe('PHOTO');
    // deleting the copy keeps the original's photo
    store.remove(copy.id);
    expect(files.files.get('user/works/w1.src.png')).toBe('PHOTO');
    expect(doc.id).toBe('w1');
  });

  it('reports a damaged work file in Chinese', () => {
    const { files, store } = setup();
    files.files.set('user/works/bad.json', '{not json');
    expect(() => store.load('bad')).toThrow(/作品文件已损坏/);
    files.files.set('user/works/bad2.json', JSON.stringify({ version: 1, id: 'bad2', name: 'x', draft: { format: 'nope' } }));
    expect(() => store.load('bad2')).toThrow(/作品文件已损坏/);
  });

  it('ignores a missing or broken index', () => {
    const { kv, store } = setup();
    expect(store.list()).toEqual([]);
    kv.set('pd:works:index', { not: 'an array' });
    expect(store.list()).toEqual([]);
  });

  it('makes default names from the date', () => {
    expect(defaultWorkName(new Date(2026, 10, 6, 0, 5))).toBe('图纸 11-06 00:05');
  });
});

describe('fitSheet', () => {
  it('keeps the preferred cell size for normal patterns', () => {
    const { sheet, cell } = fitSheet(makeDoc('x', 'x', 48), { mirror: false, showCodes: true });
    expect(cell).toBe(EXPORT_CELL);
    expect(sheet.width).toBeLessThanOrEqual(MAX_EXPORT_SIDE);
  });

  it('keeps the full cell size for a typical 72×41 pattern', () => {
    const base = makeDoc('k', 'k', 24);
    const doc: PatternDoc = { ...base, cols: 72, rows: 41, cells: new Uint16Array(72 * 41) };
    expect(fitSheet(doc, { mirror: false, showCodes: true }).cell).toBe(EXPORT_CELL);
  });

  it('shrinks cells so a 200-cell pattern fits the phone limits', () => {
    const big = makeDoc('y', 'y', 24);
    const doc: PatternDoc = { ...big, cols: 200, rows: 200, cells: new Uint16Array(200 * 200) };
    const { sheet, cell } = fitSheet(doc, { mirror: true, showCodes: true });
    expect(cell).toBeLessThan(EXPORT_CELL);
    expect(sheet.width).toBeLessThanOrEqual(MAX_EXPORT_SIDE);
    expect(sheet.height).toBeLessThanOrEqual(MAX_EXPORT_SIDE);
    expect(sheet.width * sheet.height).toBeLessThanOrEqual(MAX_EXPORT_PIXELS);
  });
});
