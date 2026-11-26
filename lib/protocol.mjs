export const MAX_REQUEST_BYTES = 65536;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_RUNTIME_SECONDS = 120;

export class HttpError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function readBounded(stream, limit, signal) {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, 'body_too_large', 'The streamed body exceeded its byte limit.');
      }
      chunks.push(value);
    }
    const buffer = Buffer.concat(chunks, size);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new HttpError(400, 'invalid_encoding', 'The body must contain valid UTF-8.');
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

export function retryAfter(value) {
  if (!value) return 5;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.min(86400, Math.max(1, seconds)) : 5;
}
