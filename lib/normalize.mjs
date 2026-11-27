import { HttpError } from './protocol.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const credentialKey = /^(?:api[-_]?key|authorization|password|secret|client[-_]?secret|access[-_]?token|refresh[-_]?token|connection[-_]?string|cookie|credential|sas[-_]?token)$/i;
const sensitiveQuery = /^(?:sig|se|sp|sv|sr|skt|ske|sks|skv|st|skoid|sktid|code|key|api[-_]?key|token|access_token)$/i;

export function safeUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  if (/^\/samples\/[a-z0-9-]+\.(?:md|csv)$/.test(value)) return value;
  // Industry product thumbnails are bundled static files served from this origin.
  if (/^\/datasets\/[a-z]+\/thumbs\/[a-z0-9-]+\.webp$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveQuery.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

export function sanitize(value, secrets = [], depth = 0) {
  if (depth > 24) return '[depth limit]';
  if (typeof value === 'string') {
    let text = value;
    for (const secret of secrets.filter(item => typeof item === 'string' && item.length > 3)) {
      text = text.split(secret).join('[redacted]');
    }
    return text.replace(/https?:\/\/[^\s<>"']+/gi, url => safeUrl(url) || '[unsafe URL removed]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]');
  }
  if (Array.isArray(value)) return value.map(item => sanitize(item, secrets, depth + 1));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, credentialKey.test(key) ? '[redacted]' : sanitize(item, secrets, depth + 1),
  ]));
  return value;
}
