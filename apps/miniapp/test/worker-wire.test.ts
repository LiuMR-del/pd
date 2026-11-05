import { describe, expect, it } from 'vitest';
import { decodeWire, encodeWire } from '../src/lib/worker-wire';

/** What a WeChat Worker can carry: JSON-like data only. */
function overTheWire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe('worker wire codec', () => {
  it('round-trips typed arrays nested in plain objects and arrays', () => {
    const msg = {
      id: 7,
      image: { data: new Uint8ClampedArray([0, 128, 255, 255, 1, 2, 3, 4]), width: 2, height: 1 },
      cells: new Uint16Array([0, 1, 0xffff, 513]),
      raw: new Uint8Array([9, 8, 7]),
      list: [{ key: 'A1', hex: '#FFFFFF' }, null, 3, 'x', true],
      none: null,
    };
    const back = decodeWire(overTheWire(encodeWire(msg))) as typeof msg;
    expect(back.image.data).toBeInstanceOf(Uint8ClampedArray);
    expect(Array.from(back.image.data)).toEqual([0, 128, 255, 255, 1, 2, 3, 4]);
    expect(back.cells).toBeInstanceOf(Uint16Array);
    expect(Array.from(back.cells)).toEqual([0, 1, 0xffff, 513]);
    expect(back.raw).toBeInstanceOf(Uint8Array);
    expect(Array.from(back.raw)).toEqual([9, 8, 7]);
    expect(back.list).toEqual(msg.list);
    expect(back.none).toBeNull();
    expect(back.id).toBe(7);
  });

  it('encodes only the viewed part of a shared buffer', () => {
    const buf = new ArrayBuffer(16);
    const all = new Uint16Array(buf);
    all.set([1, 2, 3, 4, 5, 6, 7, 8]);
    const view = new Uint16Array(buf, 4, 3); // elements 2..4
    const back = decodeWire(overTheWire(encodeWire(view))) as Uint16Array;
    expect(Array.from(back)).toEqual([3, 4, 5]);
  });

  it('handles empty typed arrays', () => {
    const back = decodeWire(overTheWire(encodeWire({ a: new Uint16Array(0), b: new Uint8Array(0) }))) as { a: Uint16Array; b: Uint8Array };
    expect(back.a).toBeInstanceOf(Uint16Array);
    expect(back.a.length).toBe(0);
    expect(back.b.length).toBe(0);
  });

  it('rejects typed arrays it cannot represent', () => {
    expect(() => encodeWire({ x: new Float32Array(2) })).toThrow(/unsupported/);
  });

  it('rejects a Uint16 payload with an odd byte length', () => {
    expect(() => decodeWire({ $typed: 'u16', b64: 'AAAA' })).toThrow(/odd byte length/);
  });

  it('leaves look-alike plain objects untouched', () => {
    const v = { $typed: 'f32', b64: 'AAAA' };
    expect(decodeWire(v)).toEqual(v);
  });
});
