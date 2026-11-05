import { generatePattern } from '@pd/pattern-core';
import { decodeWire, encodeWire, type GenerateRequest } from './worker-wire';

/**
 * Worker-side handling of one wire message: decode, run @pd/pattern-core, encode the reply.
 * Kept out of workers/generate.ts so unit tests can drive it without a WeChat Worker.
 */
export function handleGenerateMessage(message: unknown): unknown {
  let id = -1;
  try {
    const req = decodeWire(message) as GenerateRequest;
    id = req.id;
    const result = generatePattern(req.image, req.palette, req.options);
    return encodeWire({ id, ok: true, result });
  } catch (err) {
    return { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
