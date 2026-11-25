import { HttpError } from './protocol.mjs';
import { searchOrigin, SEARCH_API_VERSION, AGENTIC_SEARCH_API_VERSION } from '../config/studio-live.mjs';

// Search-only Vercel runtime: Azure AI Search document queries are the sole upstream dependency.
// Query vectors come from the index vectorizers (text, imageBinary), so no model key is needed.
export const LIVE_SCENARIOS = Object.freeze(['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11']);
export const REQUIRED_ENV = Object.freeze(['AZURE_SEARCH_ENDPOINT', 'AZURE_SEARCH_QUERY_KEY']);
export const PER_CALL_TIMEOUT_MS = 45000;
export const COMPARISON_BUDGET_MS = 55000;
export const MAX_SEARCH_CALLS_PER_COMPARISON = 4;
export const MAX_LIVE_IN_FLIGHT_PER_INSTANCE = 8;

const NO_FALLBACK = 'Sample results are never substituted.';

/** Parses the optional cost-control list, e.g. "S07,S11". Invalid input fails closed. */
export function disabledScenarios(value) {
  if (value === undefined || value === null || !String(value).trim()) return { ok: true, set: new Set() };
  const items = String(value).split(',').map(item => item.trim().toUpperCase()).filter(Boolean);
  if (items.some(item => !LIVE_SCENARIOS.includes(item))) return { ok: false, set: new Set(LIVE_SCENARIOS) };
  return { ok: true, set: new Set(items) };
}

/** Evaluates the kill switch and required server variables without echoing their values. */
export function liveStatus(env = {}, service) {
  if (env.LIVE_ENABLED !== 'true') {
    return { ready: false, code: 'live_disabled', reason: `Live search is paused by the operator kill switch (LIVE_ENABLED is not "true"). ${NO_FALLBACK}` };
  }
  if (!disabledScenarios(env.LIVE_DISABLED_SCENARIOS).ok) {
    return { ready: false, code: 'live_not_configured', reason: `Live search is not configured: LIVE_DISABLED_SCENARIOS must be a comma-separated list of S01–S11. ${NO_FALLBACK}` };
  }
  const missing = REQUIRED_ENV.filter(name => typeof env[name] !== 'string' || !env[name].trim());
  if (missing.length) {
    return { ready: false, code: 'live_not_configured', reason: `Live search is not configured: the server is missing ${missing.join(' and ')}. ${NO_FALLBACK}` };
  }
  const origin = searchOrigin(env.AZURE_SEARCH_ENDPOINT.trim());
  if (!origin || (service && new URL(origin).hostname !== `${service}.search.windows.net`)) {
    return { ready: false, code: 'live_not_configured',
      reason: `Live search is not configured: AZURE_SEARCH_ENDPOINT must be https://${service || '<service>'}.search.windows.net, the attested Search service. ${NO_FALLBACK}` };
  }
  const key = env.AZURE_SEARCH_QUERY_KEY.trim();
  if (!/^[A-Za-z0-9]{20,128}$/.test(key)) {
    return { ready: false, code: 'live_not_configured', reason: `Live search is not configured: AZURE_SEARCH_QUERY_KEY is not a valid Search key. ${NO_FALLBACK}` };
  }
  return { ready: true, origin, key };
}

/** Maps Vercel variables onto the release's server-only configuration contract. */
export function internalEnvironment(env, liveConfigText, service) {
  const status = liveStatus(env, service);
  return { status, env: {
    FOUNDRY_IQ_LIVE_ENABLED: status.ready ? 'true' : 'false',
    ...(status.ready ? { AZURE_SEARCH_ENDPOINT: `${status.origin}/`, AZURE_SEARCH_API_KEY: status.key } : {}),
    STUDIO_LIVE_CONFIG: liveConfigText,
  } };
}

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

/** Serves Get Index metadata from the private, ETag-pinned attestation bundle instead of the network. */
export function attestedMetadata(bundle) {
  if (bundle?.apiVersion !== SEARCH_API_VERSION || !Array.isArray(bundle.entries) || !bundle.entries.length) {
    throw new Error('A private schema attestation bundle for the pinned Search API version is required.');
  }
  const byPath = new Map(bundle.entries.map(entry => {
    if (typeof entry.index !== 'string' || typeof entry.etag !== 'string' || entry.schema?.name !== entry.index) {
      throw new Error('Malformed schema attestation entry.');
    }
    return [`/indexes/${encodeURIComponent(entry.index)}?api-version=${bundle.apiVersion}`, freeze({ data: structuredClone(entry.schema), etag: entry.etag })];
  }));
  return path => {
    const hit = byPath.get(path);
    if (!hit) throw new HttpError(503, 'studio_schema_unverified', 'No bundled schema attestation covers this resource.');
    return { data: structuredClone(hit.data), status: 200, etag: hit.etag, requestId: null, latencyMs: 0 };
  };
}

/** Allows only bounded POST docs/search calls to attested indexes on the configured Search origin, plus native graph
 * queries (docs/search.graph) on attested graph indexes. The preview API version is allowed only for indexes that need it
 * (agentic S07, image-vector S11, native graph and topic S08/S09). Graph indexes accept graph queries only. */
export function searchOnlyFetch(fetchImpl, origin, indexes, timeoutMs = PER_CALL_TIMEOUT_MS, previewIndexes = [], { graphIndexes = [], timeouts = {} } = {}) {
  const allowed = new Set(indexes);
  const preview = new Set(previewIndexes);
  const graphs = new Set(graphIndexes);
  return (input, init = {}) => {
    let url = null;
    try { url = new URL(String(input)); } catch { /* rejected below */ }
    const match = url?.pathname.match(/^\/indexes\/([^/]+)\/docs\/search$/);
    const graphMatch = url?.pathname.match(/^\/indexes\('([^'/]+)'\)\/docs\/search\.graph$/);
    let index = null;
    try { index = match ? decodeURIComponent(match[1]) : graphMatch ? decodeURIComponent(graphMatch[1]) : null; } catch { /* rejected below */ }
    const version = url?.searchParams.get('api-version');
    const permitted = graphMatch ? graphs.has(index) && version === AGENTIC_SEARCH_API_VERSION
      : !graphs.has(index) && (version === SEARCH_API_VERSION || (version === AGENTIC_SEARCH_API_VERSION && preview.has(index)));
    if (!url || url.origin !== origin || init.method !== 'POST' || !allowed.has(index) || [...url.searchParams.keys()].length !== 1
      || !permitted || url.hash || typeof init.body !== 'string') {
      throw new HttpError(503, 'studio_capability_unavailable', 'This deployment only sends Foundry IQ document and graph queries to attested indexes.');
    }
    const limit = Number.isInteger(timeouts[index]) ? timeouts[index] : timeoutMs;
    const timer = new AbortController();
    const timeout = setTimeout(() => timer.abort(new HttpError(504, 'studio_upstream_timeout',
      'Foundry IQ did not respond within the per-call time limit.', { upstreamService: 'search' })), limit);
    timeout.unref?.();
    const signal = init.signal ? AbortSignal.any([init.signal, timer.signal]) : timer.signal;
    // The unref'd timer also bounds body reading; aborting an already-read response is a no-op.
    return fetchImpl(url.href, { ...init, signal });
  };
}

/** Stateless per-comparison cap on dispatched Search calls. There are no retries. */
export function attemptBudget(max = MAX_SEARCH_CALLS_PER_COMPARISON) {
  let used = 0;
  return {
    reserveAttempt: () => {
      if (used >= max) throw new HttpError(503, 'studio_attempt_budget', `A comparison may send at most ${max} Search requests.`);
      used += 1;
      return used;
    },
    releaseAttempt: () => {},
    used: () => used,
  };
}
