import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { HttpError, MAX_REQUEST_BYTES, canonicalOrigin } from './protocol.mjs';

function normalizeIp(value) {
  if (!value) return null;
  const ip = value.trim().replace(/^\[([^\]]+)\](?::\d+)?$/, '$1').replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1').replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1');
  if (!isIP(ip)) return null;
  return isIP(ip) === 6 ? new URL(`http://[${ip}]`).hostname : ip;
}

export function clientIp(request, env) {
  if (env.FOUNDRY_IQ_TRUST_APP_SERVICE_PROXY === 'true' && env.WEBSITE_INSTANCE_ID) {
    const forwarded = request.headers['x-forwarded-for'];
    // App Service must append the verified client address. Never trust the user-controlled left side.
    return normalizeIp(typeof forwarded === 'string' ? forwarded.split(',').at(-1) : null) || 'unknown';
  }
  return normalizeIp(request.socket.remoteAddress) || 'unknown';
}

function incomingBody(request, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      request.removeListener('data', data);
      request.removeListener('end', end);
      request.removeListener('error', fail);
      signal.removeEventListener('abort', abort);
    };
    const fail = error => { cleanup(); request.pause(); reject(error); };
    const abort = () => fail(new HttpError(408, 'body_timeout', 'The request body took too long to arrive.'));
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, size)); };
    const data = chunk => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) fail(new HttpError(413, 'body_too_large', 'Request too large.'));
      else chunks.push(chunk);
    };
    request.on('data', data);
    request.once('end', end);
    request.once('error', fail);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export function createNodeServer(application, env) {
  const origin = canonicalOrigin(env.PUBLIC_ORIGIN);
  const server = createServer({ maxHeaderSize: 16384 }, async (incoming, outgoing) => {
    const cancellation = new AbortController();
    incoming.once('aborted', () => cancellation.abort());
    outgoing.once('close', () => { if (!outgoing.writableEnded) cancellation.abort(); });
    try {
      if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//') || incoming.url.includes('\\')) throw new HttpError(400, 'invalid_url', 'Invalid request target.');
      const length = incoming.headers['content-length'];
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) throw new HttpError(413, 'body_too_large', 'Request too large.');
      const body = ['GET', 'HEAD'].includes(incoming.method) ? undefined
        : await incomingBody(incoming, AbortSignal.any([cancellation.signal, AbortSignal.timeout(10000)]));
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
        else if (value !== undefined) headers.set(key, value);
      }
      const request = new Request(new URL(incoming.url, origin), {
        method: incoming.method,
        headers,
        body,
        signal: cancellation.signal,
      });
      const response = await application.fetch(request, env, { clientIp: clientIp(incoming, env) });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (incoming.method === 'HEAD' || !response.body) outgoing.end();
      else {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            cancellation.signal.throwIfAborted();
            if (!outgoing.write(value)) {
              await new Promise((resolve, reject) => {
                const drain = () => { cleanup(); resolve(); };
                const abort = () => { cleanup(); reject(cancellation.signal.reason); };
                const cleanup = () => { outgoing.removeListener('drain', drain); cancellation.signal.removeEventListener('abort', abort); };
                outgoing.once('drain', drain);
                cancellation.signal.addEventListener('abort', abort, { once: true });
              });
            }
          }
          outgoing.end();
        } finally {
          await reader.cancel();
        }
      }
    } catch (error) {
      const status = cancellation.signal.aborted ? 499 : error instanceof HttpError ? error.status : 500;
      const requestId = randomUUID();
      const errorCode = cancellation.signal.aborted ? 'request_cancelled' : error instanceof HttpError ? error.code : 'bridge_error';
      process.stdout.write(`${JSON.stringify({ event: 'http_bridge_error', requestId, status, errorCode })}\n`);
      if (!outgoing.headersSent && !outgoing.destroyed) {
        outgoing.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Request-Id': requestId,
          Connection: 'close',
        });
        outgoing.end(JSON.stringify({
          error: cancellation.signal.aborted ? 'The client cancelled this request.' : error instanceof HttpError ? error.message : 'The HTTP bridge could not complete this request.',
          errorCode,
          requestId,
        }), () => incoming.destroy());
      } else outgoing.destroy();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}
