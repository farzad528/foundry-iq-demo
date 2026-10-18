import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { HttpError, readBounded } from './protocol.mjs';

export const QUOTA_LIMITS = Object.freeze({ session: 5, ip: 30, concurrent: 10, daily: 1000 });
const STATE_LIMIT = 256 * 1024;
const unavailable = () => new HttpError(503, 'quota_unavailable', 'Live retrieval is unavailable because shared quota coordination could not be verified.');
const hash = (secret, value) => createHmac('sha256', secret).update(value).digest('hex');

export function anonymousSession(cookie, secret, secure) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.startsWith('@Microsoft.KeyVault(')) throw unavailable();
  const values = (cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith('fiq_session='));
  const supplied = values.length === 1 ? values[0].slice('fiq_session='.length) : '';
  const parts = supplied.split('.');
  const [id, signature] = parts;
  if (parts.length === 2 && /^[0-9a-f-]{36}$/.test(id || '') && /^[0-9a-f]{64}$/.test(signature || '')) {
    const expected = hash(secret, `session:${id}`);
    if (timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return { id, cookie: null };
  }
  const next = randomUUID();
  return {
    id: next,
    cookie: `fiq_session=${next}.${hash(secret, `session:${next}`)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
  };
}

export function emptyQuotaState() {
  return { version: 1, enabled: false, day: '', count: 0, sessions: {}, ips: {}, slots: [] };
}

function validateState(state) {
  const map = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!map(state) || state.version !== 1 || typeof state.enabled !== 'boolean'
    || typeof state.day !== 'string' || (state.day && !/^\d{4}-\d{2}-\d{2}$/.test(state.day))
    || !Number.isInteger(state.count) || state.count < 0 || (!state.day && state.count !== 0)
    || !map(state.sessions) || !map(state.ips) || !Array.isArray(state.slots) || state.slots.length > 10) throw unavailable();
  for (const bucket of [state.sessions, state.ips]) {
    if (Object.keys(bucket).length > 2000 || Object.entries(bucket).some(([key, times]) =>
      !/^[a-f0-9]{64}$/.test(key) || !Array.isArray(times) || times.length > 1000 || times.some(time => !Number.isFinite(time) || time < 0))) throw unavailable();
  }
  if (state.slots.some(slot => !slot || typeof slot.id !== 'string' || !Number.isFinite(slot.expiresAt))) throw unavailable();
}

export class BlobQuotaCoordinator {
  constructor(blob) {
    this.blob = blob;
  }

  async transaction(mutate, signal) {
    const budget = AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]);
    const lease = this.blob.getBlobLeaseClient(randomUUID());
    let acquired = false;
    try {
      for (let attempt = 0; ; attempt++) {
        budget.throwIfAborted();
        try {
          await lease.acquireLease(15, { abortSignal: budget });
          acquired = true;
          break;
        } catch (error) {
          if (error.statusCode !== 409 || error.code !== 'LeaseAlreadyPresent' || attempt >= 12) throw error;
          await delay(40 + Math.random() * 80, undefined, { signal: budget });
        }
      }
      const download = await this.blob.download(0, STATE_LIMIT + 1, {
        conditions: { leaseId: lease.leaseId }, abortSignal: budget, maxRetryRequests: 0,
      });
      if (!download.etag || !download.date || !download.readableStreamBody
        || download.contentLength > STATE_LIMIT) throw unavailable();
      const now = new Date(download.date).getTime();
      if (!Number.isFinite(now)) throw unavailable();
      const { Readable } = await import('node:stream');
      const state = JSON.parse(await readBounded(Readable.toWeb(download.readableStreamBody), STATE_LIMIT, budget));
      validateState(state);
      const result = mutate(state, now);
      const text = JSON.stringify(state);
      if (Buffer.byteLength(text) > STATE_LIMIT) throw unavailable();
      await this.blob.upload(text, Buffer.byteLength(text), {
        conditions: { leaseId: lease.leaseId, ifMatch: download.etag },
        abortSignal: budget,
        blobHTTPHeaders: { blobContentType: 'application/json' },
      });
      return result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw unavailable();
    } finally {
      if (acquired) {
        try {
          await lease.releaseLease({ abortSignal: AbortSignal.timeout(2000) });
        } catch {
          // Never proceed to Azure when the commit/release outcome is uncertain.
          throw unavailable();
        }
      }
    }
  }

  async reserve({ sessionId, ip, secret, lifetimeMs, signal }) {
    const slotId = randomUUID();
    await this.transaction((state, now) => {
      if (!state.enabled) throw new HttpError(503, 'live_disabled', 'Live queries are paused by the operator.');
      const day = new Date(now).toISOString().slice(0, 10);
      if (state.day > day) throw unavailable();
      if (state.day !== day) {
        state.day = day;
        state.count = 0;
      }
      for (const bucket of [state.sessions, state.ips]) {
        for (const [key, times] of Object.entries(bucket)) {
          bucket[key] = times.filter(time => time > now - 60000);
          if (!bucket[key].length) delete bucket[key];
        }
      }
      state.slots = state.slots.filter(slot => slot.expiresAt > now);
      const sessionKey = hash(secret, `browser:${sessionId}`);
      const ipKey = hash(secret, `ip:${ip}`);
      const browserTimes = state.sessions[sessionKey] || [];
      const ipTimes = state.ips[ipKey] || [];
      const reject = (code, message, seconds) => { throw new HttpError(429, code, message, { retryAfter: Math.max(1, Math.ceil(seconds)) }); };
      if (state.count >= QUOTA_LIMITS.daily) reject('daily_limit', 'The global live-query allowance for this UTC day has been reached.', (Date.parse(`${day}T00:00:00Z`) + 86400000 - now) / 1000);
      if (browserTimes.length >= QUOTA_LIMITS.session) reject('session_limit', 'This anonymous browser session has reached 5 live calls per minute.', (browserTimes[0] + 60000 - now) / 1000);
      if (ipTimes.length >= QUOTA_LIMITS.ip) reject('ip_limit', 'This IP address has reached 30 live calls per minute.', (ipTimes[0] + 60000 - now) / 1000);
      if (state.slots.length >= QUOTA_LIMITS.concurrent) reject('concurrency_limit', 'All 10 global live-query slots are busy.', 5);
      state.sessions[sessionKey] = [...browserTimes, now];
      state.ips[ipKey] = [...ipTimes, now];
      state.count++;
      state.slots.push({ id: slotId, expiresAt: now + lifetimeMs });
    }, signal);
    return slotId;
  }

  async release(slotId) {
    await this.transaction(state => { state.slots = state.slots.filter(slot => slot.id !== slotId); });
  }
}

export async function createQuotaCoordinator(env) {
  try {
    const url = new URL(env.FOUNDRY_IQ_QUOTA_CONTAINER_URL);
    if (url.protocol !== 'https:' || !/^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(url.hostname)
      || !/^\/[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\/?$/.test(url.pathname)
      || url.search || url.hash || url.username || url.password) throw unavailable();
    const [{ ContainerClient }, { ManagedIdentityCredential }] = await Promise.all([
      import('@azure/storage-blob'), import('@azure/identity'),
    ]);
    const credential = env.AZURE_CLIENT_ID
      ? new ManagedIdentityCredential({ clientId: env.AZURE_CLIENT_ID })
      : new ManagedIdentityCredential();
    const container = new ContainerClient(url.href, credential, { retryOptions: { maxTries: 1 }, loggingOptions: { logger: () => {} } });
    return new BlobQuotaCoordinator(container.getBlockBlobClient('quotas.json'));
  } catch {
    throw unavailable();
  }
}
