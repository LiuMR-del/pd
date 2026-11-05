import { base64ToBytes, bytesToBase64 } from '@pd/editor-core';
import type { PaletteInput, PatternOptions, PatternResult, RgbaImage } from '@pd/pattern-core';

/**
 * Messages between the page and the generate worker (workers/generate.ts).
 *
 * WeChat Worker messages are only guaranteed to carry plain JSON-like objects, so typed arrays
 * (image pixels, pattern cells) are wrapped as `{ $typed, b64 }` on send and restored on receive.
 * Uint16 data is sent as its little-endian bytes (every WeChat runtime is little-endian).
 */
export interface GenerateRequest {
  id: number;
  image: RgbaImage;
  palette: PaletteInput[];
  options: PatternOptions;
}

export type GenerateReply = { id: number; ok: true; result: PatternResult } | { id: number; ok: false; error: string };

type TypedKind = 'u8' | 'u8c' | 'u16';

interface WrappedTyped {
  $typed: TypedKind;
  b64: string;
}

export function encodeWire(value: unknown): unknown {
  if (value instanceof Uint8ClampedArray) return wrap('u8c', new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (value instanceof Uint8Array) return wrap('u8', value);
  if (value instanceof Uint16Array) return wrap('u16', new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (ArrayBuffer.isView(value)) throw new Error('worker-wire: unsupported typed array');
  if (Array.isArray(value)) return value.map(encodeWire);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) out[key] = encodeWire(src[key]);
    return out;
  }
  return value;
}

export function decodeWire(value: unknown): unknown {
  if (isWrapped(value)) {
    const bytes = base64ToBytes(value.b64);
    // copy into a fresh buffer: the decoded bytes may not start at offset 0 / be 2-byte aligned
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    if (value.$typed === 'u8') return new Uint8Array(buf);
    if (value.$typed === 'u8c') return new Uint8ClampedArray(buf);
    if (buf.byteLength % 2 !== 0) throw new Error('worker-wire: odd byte length for Uint16Array');
    return new Uint16Array(buf);
  }
  if (Array.isArray(value)) return value.map(decodeWire);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) out[key] = decodeWire(src[key]);
    return out;
  }
  return value;
}

function wrap(kind: TypedKind, bytes: Uint8Array): WrappedTyped {
  return { $typed: kind, b64: bytesToBase64(bytes) };
}

function isWrapped(value: unknown): value is WrappedTyped {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<WrappedTyped>;
  return (v.$typed === 'u8' || v.$typed === 'u8c' || v.$typed === 'u16') && typeof v.b64 === 'string';
}
