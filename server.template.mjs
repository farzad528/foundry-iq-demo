import { randomUUID } from 'node:crypto';
import { API_VERSION, HttpError, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, MAX_RUNTIME_SECONDS, canonicalOrigin, capabilities, readBounded, retryAfter, validateRequest } from './lib/protocol.mjs';
import { normalizeResponse, sanitize } from './lib/normalize.mjs';
import { anonymousSession, createQuotaCoordinator } from './lib/quota.mjs';
import { createReportPageReader, reportPageNumber, reportPageForReference } from './lib/report-pages.mjs';

const catalog = __DATA__;
const page = __PAGE__;
const sourceArchive = '__ARCHIVE__';
const samples = __SAMPLES__;
const assets = __ASSETS__;
const serviceId = value => /^[a-zA-Z0-9_-]{1,128}$/.test(value || '') ? value : null;

function searchEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.search\.windows\.net$/.test(url.hostname)
      || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid endpoint');
    return url;
  } catch {
    throw new HttpError(503, 'configuration_unavailable', 'A valid server-side Azure AI Search endpoint must be configured.');
  }
}

export function createApplication({ fetchUpstream = (...args) => fetch(...args), coordinator, readReportPage = createReportPageReader(), log = event => process.stdout.write(`${JSON.stringify(event)}\n`) } = {}) {
  return {
    async fetch(request, env = {}, context = {}) {
      const requestId = randomUUID();
      const started = performance.now();
      let status = 500;
      let errorCode;
      let mode;
      let scenarioId;
      let upstreamStatus;
      let upstreamRequestId;
      let referenceCount;
      let effectiveRequest;
      let sessionCookie;
      let timer;
      let slotId;
      let quotas;
      const url = new URL(request.url);
      const headers = {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        'X-Request-Id': requestId,
      };
      const respond = (body, responseStatus = 200, extra = {}) => {
        status = responseStatus;
        const safe = sanitize(body, [env.AZURE_SEARCH_API_KEY, env.SESSION_SECRET]);
        const text = JSON.stringify(safe);
        if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES * 3) {
          status = 502;
          return Response.json({ error: 'The normalized response exceeded the application output bound.', errorCode: 'response_too_large', requestId }, { status, headers });
        }
        return new Response(text, { status, headers: { ...headers, 'Content-Type': 'application/json', ...(sessionCookie ? { 'Set-Cookie': sessionCookie } : {}), ...extra } });
      };
      const resource = (body, type, extra = {}) => {
        status = 200;
        return new Response(body, { headers: { ...headers, 'Content-Type': type, ...extra } });
      };
      try {
        const origin = canonicalOrigin(env.PUBLIC_ORIGIN);
        if (origin.startsWith('https:')) headers['Strict-Transport-Security'] = 'max-age=31536000';
        if (request.method === 'GET' && url.pathname === '/healthz') {
          return respond({ status: 'ok', liveEnabled: env.FOUNDRY_IQ_LIVE_ENABLED === 'true', requestId });
        }
        if (request.method === 'GET' && url.pathname === '/') return resource(page, 'text/html; charset=utf-8');
        if (request.method === 'GET' && url.pathname === '/download') {
          return resource(Buffer.from(sourceArchive, 'base64'), 'application/zip', {
            'Content-Disposition': 'attachment; filename="foundryiq-customer-demos-source.zip"',
          });
        }
        if (request.method === 'GET' && Object.hasOwn(samples, url.pathname)) {
          return resource(samples[url.pathname], 'text/plain; charset=utf-8');
        }
        if (request.method === 'GET' && Object.hasOwn(assets, url.pathname)) {
          const asset = assets[url.pathname];
          return resource(asset.body, asset.type);
        }
        if (request.method === 'GET' && url.pathname === '/favicon.ico') {
          status = 204;
          return new Response(null, { status, headers });
        }
        if (url.pathname.startsWith('/api/report-pages/')) {
          const pageNumber = reportPageNumber(url.pathname);
          if (pageNumber === null || url.search) throw new HttpError(404, 'report_page_not_found', 'Unknown original PDF page.');
          if (request.method !== 'GET') {
            headers.Allow = 'GET';
            throw new HttpError(405, 'method_not_allowed', 'Use GET for original PDF pages.');
          }
          if (env.FOUNDRY_IQ_LIVE_ENABLED !== 'true') throw new HttpError(503, 'live_disabled', 'Original page previews are paused.');
          return resource(await readReportPage(pageNumber, request.signal), 'image/png', { 'Cache-Control': 'public, max-age=3600' });
        }
        if (request.method === 'GET' && url.pathname === '/api/config') {
          return respond({
            configured: !!(env.AZURE_SEARCH_ENDPOINT && env.AZURE_SEARCH_API_KEY && env.SESSION_SECRET && env.FOUNDRY_IQ_QUOTA_CONTAINER_URL),
            liveEnabled: env.FOUNDRY_IQ_LIVE_ENABLED === 'true',
            contractStatus: 'Pinned preview contract; verify each configured knowledge base with real retrieval evidence.',
            apiVersion: API_VERSION,
            available: catalog.filter(item => item.execution === 'live').map(item => item.id),
            capabilities: Object.fromEntries(catalog.filter(item => item.execution === 'live').map(item => [item.id, capabilities(item, env)])),
          });
        }
        if (url.pathname !== '/api/retrieve') throw new HttpError(404, 'not_found', 'Not found.');
        if (request.method !== 'POST') {
          headers.Allow = 'POST';
          throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
        }
        const suppliedOrigin = request.headers.get('origin');
        if ((suppliedOrigin && suppliedOrigin !== origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
          throw new HttpError(403, 'cross_origin', 'Cross-origin requests are not accepted.');
        }
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
          throw new HttpError(415, 'unsupported_media_type', 'Use Content-Type: application/json.');
        }
        if (request.headers.get('content-encoding') && request.headers.get('content-encoding') !== 'identity') {
          throw new HttpError(415, 'unsupported_encoding', 'Compressed request bodies are not supported.');
        }
        const length = request.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) throw new HttpError(413, 'body_too_large', 'Request too large.');
        const readSignal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
        let body;
        try {
          body = JSON.parse(await readBounded(request.body, MAX_REQUEST_BYTES, readSignal));
        } catch (error) {
          if (error instanceof SyntaxError) throw new HttpError(400, 'invalid_json', 'Invalid request JSON.');
          if (readSignal.aborted && !request.signal.aborted) throw new HttpError(408, 'body_timeout', 'The request body took too long to arrive.');
          throw error;
        }
        const { scenario, outbound } = validateRequest(body, catalog, env);
        mode = body.mode;
        scenarioId = scenario.id;
        effectiveRequest = {
          method: 'POST',
          path: `/knowledgebases('${scenario.id}')/retrieve?api-version=${API_VERSION}`,
          apiVersion: API_VERSION,
          clientRequestId: requestId,
          body: outbound,
          sent: false,
          redacted: JSON.stringify(outbound) !== JSON.stringify(sanitize(outbound, [env.AZURE_SEARCH_API_KEY, env.SESSION_SECRET])),
        };
        if (env.FOUNDRY_IQ_LIVE_ENABLED !== 'true') throw new HttpError(503, 'live_disabled', 'Live queries are paused. No recorded answer is substituted.');
        if (!env.AZURE_SEARCH_API_KEY || env.AZURE_SEARCH_API_KEY.startsWith('@Microsoft.KeyVault(')) {
          throw new HttpError(503, 'configuration_unavailable', 'The server Search credential is not configured or its Key Vault reference is unresolved.');
        }
        const endpoint = searchEndpoint(env.AZURE_SEARCH_ENDPOINT);
        const session = anonymousSession(request.headers.get('cookie'), env.SESSION_SECRET, origin.startsWith('https:'));
        sessionCookie = session.cookie;
        quotas = coordinator || await createQuotaCoordinator(env);
        timer = new AbortController();
        const budgetMs = (outbound.maxRuntimeInSeconds || MAX_RUNTIME_SECONDS) * 1000 + 5000;
        const timeout = setTimeout(() => timer.abort(new DOMException('Retrieval budget elapsed', 'TimeoutError')), budgetMs);
        timeout.unref?.();
        timer.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
        const signal = AbortSignal.any([request.signal, timer.signal]);
        slotId = await quotas.reserve({
          sessionId: session.id,
          ip: context.clientIp || 'unknown',
          secret: env.SESSION_SECRET,
          lifetimeMs: budgetMs + 30000,
          signal,
        });
        signal.throwIfAborted();
        const target = new URL(effectiveRequest.path, endpoint);
        let upstream;
        try {
          effectiveRequest.sent = true;
          upstream = await fetchUpstream(target, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'api-key': env.AZURE_SEARCH_API_KEY,
              'x-ms-client-request-id': requestId,
            },
            body: JSON.stringify(outbound),
            signal,
            redirect: 'error',
          });
        } catch (error) {
          if (signal.aborted) throw error;
          throw new HttpError(502, 'upstream_unavailable', 'The Azure retrieval connection failed. No sample content was substituted.');
        }
        upstreamStatus = upstream.status;
        upstreamRequestId = serviceId(upstream.headers.get('request-id') || upstream.headers.get('x-ms-request-id'));
        if ([env.AZURE_SEARCH_API_KEY, env.SESSION_SECRET].some(secret => secret && upstreamRequestId?.includes(secret))) upstreamRequestId = null;
        let data;
        try {
          if (Number(upstream.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
            await upstream.body?.cancel();
            throw new Error('Response too large');
          }
          if (!/^application\/json(?:\s*;|$)/i.test(upstream.headers.get('content-type') || '')) {
            await upstream.body?.cancel();
            throw new Error('Non-JSON response');
          }
          data = JSON.parse(await readBounded(upstream.body, MAX_RESPONSE_BYTES, signal));
        } catch (error) {
          if (signal.aborted) throw error;
          throw new HttpError(502, 'invalid_upstream_response', 'Azure returned a non-JSON, malformed, or oversized response.', { upstreamStatus });
        }
        const secrets = [env.AZURE_SEARCH_API_KEY, env.SESSION_SECRET];
        if (upstream.status !== 200 && upstream.status !== 206) {
          const mapped = upstream.status === 429 ? 429 : upstream.status === 408 || upstream.status === 504 ? 504 : 502;
          throw new HttpError(mapped, upstream.status === 429 ? 'upstream_throttled' : 'upstream_error',
            `Azure retrieval returned HTTP ${upstream.status}. No sample content was substituted.`, {
              upstreamStatus,
              upstreamRequestId,
              serviceError: sanitize(data.error || { code: 'UnknownServiceError' }, secrets),
              ...(mapped === 429 ? { retryAfter: retryAfter(upstream.headers.get('retry-after')) } : {}),
            });
        }
        const normalized = normalizeResponse(data, { partial: upstream.status === 206, secrets });
        const exposesUnsupportedSource = normalized.normalized.references.some(reference =>
          !scenario.sources.some(source => source.kind === reference.kind)
          || (reference.sourceName && !scenario.sources.some(source => source.name === reference.sourceName && source.kind === reference.kind)))
          || normalized.normalized.activities.some(activity => activity.knowledgeSourceName
            && !scenario.sources.some(source => source.name === activity.knowledgeSourceName));
        if (exposesUnsupportedSource) {
          throw new HttpError(502, 'source_membership_drift', 'Azure returned evidence outside this public knowledge base source allowlist. Live configuration must be corrected before publishing.');
        }
        if (scenario.report) {
          for (const reference of normalized.normalized.references) {
            const reportPage = reportPageForReference(reference);
            if (reportPage !== null) reference.reportPage = reportPage;
          }
        }
        referenceCount = normalized.normalized.references.length;
        await quotas.release(slotId);
        slotId = null;
        return respond({
          sample: false,
          ...normalized,
          effectiveRequest,
          requestId,
          upstreamRequestId,
          upstreamStatus,
          contractStatus: 'Pinned preview contract; verify each configured knowledge base with real retrieval evidence.',
        }, normalized.normalized.partial ? 206 : 200);
      } catch (error) {
        let failure = error;
        if (slotId) {
          try {
            await quotas.release(slotId);
            slotId = null;
          } catch {
            failure = new HttpError(503, 'quota_unavailable', 'Quota slot release could not be verified. The reservation will expire; live retrieval is unavailable until coordination recovers.');
          }
        }
        if (request.signal.aborted) failure = new HttpError(499, 'request_cancelled', 'The client cancelled this request.');
        else if (timer?.signal.aborted) failure = new HttpError(504, 'retrieval_timeout', 'The total retrieval budget expired. No sample content was substituted.');
        if (!(failure instanceof HttpError)) failure = new HttpError(500, 'internal_error', 'Retrieval could not complete. Use the request ID when contacting the operator.');
        errorCode = failure.code;
        return respond({
          error: failure.message,
          errorCode,
          requestId,
          ...(effectiveRequest ? { effectiveRequest } : {}),
          ...failure.details,
        }, failure.status, failure.details.retryAfter ? { 'Retry-After': String(failure.details.retryAfter) } : {});
      } finally {
        timer?.abort();
        if (url.pathname === '/api/retrieve') {
          log(Object.fromEntries(Object.entries({
            event: 'retrieval',
            requestId,
            mode,
            scenarioId,
            status,
            errorCode,
            elapsedMs: Math.round(performance.now() - started),
            upstreamStatus,
            upstreamRequestId,
            referenceCount,
          }).filter(([, value]) => value !== undefined)));
        }
      }
    },
  };
}

export default createApplication();
