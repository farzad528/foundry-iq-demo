import { randomUUID } from 'node:crypto';
import { HttpError, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, readBounded } from './protocol.mjs';
import { sanitize } from './normalize.mjs';
import { prepareComparison, runComparison, studioScenarios } from './studio.mjs';
import { documentLanguages, validDocumentLanguage } from '../config/studio-languages.mjs';
import {
  LIVE_SCENARIOS, PER_CALL_TIMEOUT_MS, COMPARISON_BUDGET_MS, MAX_SEARCH_CALLS_PER_COMPARISON, MAX_LIVE_IN_FLIGHT_PER_INSTANCE,
  internalEnvironment, attestedMetadata, searchOnlyFetch, attemptBudget, disabledScenarios,
} from './search-adapter.mjs';

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
});
const noNetwork = () => { throw new HttpError(503, 'studio_capability_unavailable', 'This request may not contact Azure.'); };

/**
 * Stateless Vercel handler for the Studio API. Live mode sends only Azure AI Search docs/search POSTs
 * with the server-side query key; schema checks use the private attestation bundle compiled into the build.
 */
export function createVercelApp({ liveConfig, attestations, recorded = { entries: {} }, fetchUpstream = (...args) => fetch(...args),
  log = event => console.log(JSON.stringify(event)), limits = {} } = {}) {
  const settings = { perCallMs: PER_CALL_TIMEOUT_MS, budgetMs: COMPARISON_BUDGET_MS,
    maxCalls: MAX_SEARCH_CALLS_PER_COMPARISON, maxInFlight: MAX_LIVE_IN_FLIGHT_PER_INSTANCE, ...limits };
  const liveConfigText = JSON.stringify(liveConfig);
  const metadata = attestedMetadata(attestations);
  const indexes = attestations.entries.map(entry => entry.index);
  // Only S07 (native agentic) and S11 (image vector queries) indexes may use the preview Search API.
  const previewIndexes = [liveConfig.scenarios, ...Object.values(liveConfig.languages || {}).map(locale => locale.scenarios)]
    .flatMap(scenarios => [scenarios?.S07?.index, scenarios?.S11?.index]).filter(Boolean);
  let inFlight = 0;
  // Recorded Sample: verified Live responses (request IDs removed) replayed for curated non-English examples. Never a Live fallback.
  const recordings = new Map(Object.entries(recorded.entries || {}));
  const recordedFor = (language, scenarioId) => [...recordings.values()].filter(entry => entry.language === language && entry.scenarioId === scenarioId);
  const recordedLabel = `Recorded Sample: Live Azure AI Search responses captured on ${recorded.recordedAt}; replayed without contacting Azure.`;
  function replayRecorded(body) {
    const allowed = ['scenarioId', 'mode', 'query', 'topK', 'options', 'language'];
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => !allowed.includes(key))) {
      throw new HttpError(400, 'recorded_sample_invalid', 'Recorded Sample replays bundled examples only. Switch to Live to search with your own image or options.');
    }
    const entry = typeof body.query === 'string' && recordings.get(`${body.language}|${body.scenarioId}|${body.query.trim()}`);
    if (!entry) throw new HttpError(400, 'recorded_sample_unavailable', 'Recorded Sample replays only the curated examples for this language. Pick an example, or switch to Live for free-text questions.');
    const topK = body.topK ?? 10;
    if (![5, 10].includes(topK)) throw new HttpError(400, 'recorded_sample_topk', 'Recorded Sample was captured with 10 evidence per arm. Choose 5 or 10, or switch to Live.');
    const options = body.options ?? {};
    if (typeof options !== 'object' || Object.keys(options).some(key => key !== 'boostSubtype')
      || (options.boostSubtype !== undefined && options.boostSubtype !== entry.boostSubtype)) {
      throw new HttpError(400, 'recorded_sample_options', `Recorded Sample was captured with the ${entry.boostSubtype || 'default'} settings. Switch to Live to try other boosts.`);
    }
    const result = structuredClone(entry.result);
    for (const side of ['baseline', 'enhanced']) {
      const arm = result[side];
      if (!arm) continue;
      arm.hits = (arm.hits || []).slice(0, topK);
      arm.citations = (arm.citations || []).slice(0, topK);
      arm.trace = { ...arm.trace, steps: [`Recorded Live response from ${recorded.recordedAt}, replayed without an Azure request. Timings are from the recording.`, ...(arm.trace?.steps || [])] };
    }
    return { ...result, runId: `recorded-${body.language}-${body.scenarioId}`, mode: 'sample', sample: true,
      recorded: { recordedAt: recorded.recordedAt, source: 'Live Azure AI Search response recorded from this deployment; request IDs removed.', ...(entry.image ? { image: entry.image } : {}) } };
  }

  const publicScenarios = (context, language, rawEnv = {}) => studioScenarios(context.env, language).map(item => {
    const paused = disabledScenarios(rawEnv.LIVE_DISABLED_SCENARIOS).set.has(item.id);
    const enabled = context.status.ready && LIVE_SCENARIOS.includes(item.id) && item.liveAvailable && !paused;
    const nativePdf = item.id === 'S10' && item.extractionProvider === 'azureContentUnderstanding';
    const customPdf = item.id === 'S10' && !nativePdf;
    const reason = enabled
      ? customPdf ? 'Custom pre-extracted Azure index retrieval only; Azure Content Understanding is not executed.' : 'Live Azure AI Search retrieval from this server; no Sample fallback.'
      : !context.status.ready ? context.status.reason
        : paused ? `Live ${item.id} is paused by the operator (LIVE_DISABLED_SCENARIOS). Sample results are never substituted.` : item.live.reason;
    const recordedQueries = recordedFor(language, item.id).map(entry => entry.query);
    return { ...item, liveAvailable: enabled,
      ...(recordedQueries.length ? { sample: { available: true, label: recordedLabel, curatedQueries: recordedQueries, recorded: { recordedAt: recorded.recordedAt } } } : {}),
      status: enabled ? customPdf ? 'custom_retrieval_verified' : 'live_verified' : item.status,
      ...(nativePdf ? { nativeTreatment: { provider: 'Azure Content Understanding', status: enabled ? 'verified' : 'unverified', extractionTiming: 'ingestion, not query time' } }
        : customPdf ? { nativeTreatment: { provider: 'Azure Content Understanding', status: 'blocked', reason: 'Custom pre-extracted example.' } } : {}),
      live: { ...item.live, available: enabled, status: enabled ? customPdf ? 'custom_preextracted_index_retrieval_verified' : 'actual_retrieval_verified' : 'unavailable', reason } };
  });

  return {
    async handle(route, request, rawEnv = {}) {
      const requestId = randomUUID();
      const started = performance.now();
      const context = internalEnvironment(rawEnv, liveConfigText, attestations.service);
      const secrets = [context.env.AZURE_SEARCH_API_KEY, rawEnv.AZURE_SEARCH_QUERY_KEY];
      const url = new URL(request.url);
      const headers = { ...SECURITY_HEADERS, 'X-Request-Id': requestId, ...(url.protocol === 'https:' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}) };
      let status = 500;
      let errorCode;
      let mode;
      let scenarioId;
      let language;
      let executionStatus;
      let timer;
      let counted = false;
      const respond = (body, responseStatus = 200, extra = {}) => {
        status = responseStatus;
        const text = JSON.stringify(sanitize(body, secrets));
        if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES * 3) {
          status = 502;
          return Response.json({ error: 'The normalized response exceeded the application output bound.', errorCode: 'response_too_large', requestId }, { status, headers });
        }
        return new Response(text, { status, headers: { ...headers, 'Content-Type': 'application/json', ...extra } });
      };
      try {
        if (route === 'health' || route === 'scenarios') {
          if (request.method !== 'GET') { headers.Allow = 'GET'; throw new HttpError(405, 'method_not_allowed', 'Method not allowed.'); }
          if (route === 'health') {
            return respond({ status: 'ok', live: context.status.ready ? 'configured' : context.status.code,
              ...(context.status.ready ? {} : { reason: context.status.reason }), upstream: 'Azure AI Search docs/search only', requestId });
          }
          language = url.searchParams.get('language') ?? 'en';
          if (!validDocumentLanguage(language)) throw new HttpError(400, 'invalid_document_language', 'Select a supported document language.');
          return respond({ scenarios: publicScenarios(context, language, rawEnv), language, documentLanguages,
            defaultMode: language !== 'en' || context.status.ready ? 'live' : 'sample' });
        }
        if (!['prepare', 'run'].includes(route)) throw new HttpError(404, 'not_found', 'Not found.');
        if (request.method !== 'POST') { headers.Allow = 'POST'; throw new HttpError(405, 'method_not_allowed', 'Method not allowed.'); }
        const supplied = request.headers.get('origin');
        if ((supplied && supplied !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
          throw new HttpError(403, 'cross_origin', 'Cross-origin requests are not accepted.');
        }
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new HttpError(415, 'unsupported_media_type', 'Use Content-Type: application/json.');
        if (request.headers.get('content-encoding') && request.headers.get('content-encoding') !== 'identity') throw new HttpError(415, 'unsupported_encoding', 'Compressed request bodies are not supported.');
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
        mode = ['sample', 'live'].includes(body?.mode) ? body.mode : undefined;
        scenarioId = typeof body?.scenarioId === 'string' && /^S(?:0[1-9]|1[01])$/.test(body.scenarioId) ? body.scenarioId : undefined;
        language = body?.language ?? 'en';
        if (!validDocumentLanguage(language)) { language = undefined; throw new HttpError(400, 'invalid_document_language', 'Select a supported document language.'); }
        timer = new AbortController();
        const timeout = setTimeout(() => timer.abort(new DOMException('Comparison budget elapsed', 'TimeoutError')), settings.budgetMs);
        timeout.unref?.();
        timer.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
        const signal = AbortSignal.any([request.signal, timer.signal]);
        if (mode === 'live') {
          if (!context.status.ready) throw new HttpError(503, context.status.code, context.status.reason);
          const item = scenarioId && publicScenarios(context, language, rawEnv).find(entry => entry.id === scenarioId);
          if (item && !item.liveAvailable) throw new HttpError(503, 'studio_live_unavailable', item.live.reason);
          if (route === 'run') {
            if (inFlight >= settings.maxInFlight) throw new HttpError(503, 'live_busy', 'The live demo is busy. Wait a few seconds, then Search again.', { retryAfter: 5 });
            inFlight += 1;
            counted = true;
          }
        }
        if (route === 'prepare') {
          // Attested metadata only: preparation never contacts Azure.
          const result = await prepareComparison(body, { env: context.env, signal, fetchUpstream: noNetwork, metadata,
            ...attemptBudget(0), schemaCache: new Map(), availability: async () => ({}) });
          return respond(result);
        }
        const live = mode === 'live';
        if (route === 'run' && mode === 'sample' && recordedFor(language, scenarioId).length) {
          const replay = replayRecorded(body);
          executionStatus = replay.executionStatus;
          return respond(replay);
        }
        const budget = attemptBudget(settings.maxCalls);
        const result = await runComparison(body, { env: live ? context.env : {}, signal, requestId, metadata: live ? metadata : undefined,
          fetchUpstream: live ? searchOnlyFetch(fetchUpstream, context.status.origin, indexes, settings.perCallMs, previewIndexes) : noNetwork,
          reserveAttempt: budget.reserveAttempt, releaseAttempt: budget.releaseAttempt });
        signal.throwIfAborted();
        executionStatus = result.executionStatus;
        return respond(result);
      } catch (error) {
        let failure = error;
        if (request.signal.aborted) failure = new HttpError(499, 'request_cancelled', 'The client cancelled this comparison.');
        else if (timer?.signal.aborted) failure = new HttpError(504, 'comparison_timeout', 'The comparison time budget expired. No Sample results were substituted.');
        if (!(failure instanceof HttpError)) failure = new HttpError(500, 'internal_error', 'The comparison could not complete. Use the request ID when contacting the operator.');
        errorCode = failure.code;
        return respond({ error: failure.message, errorCode, requestId,
          ...(Number.isInteger(failure.details?.retryAfter) ? { retryAfter: failure.details.retryAfter } : {}) },
        failure.status, Number.isInteger(failure.details?.retryAfter) ? { 'Retry-After': String(failure.details.retryAfter) } : {});
      } finally {
        if (counted) inFlight -= 1;
        timer?.abort();
        // Allowlisted telemetry only: never questions, answers, passages, cookies, IPs or credentials.
        log(Object.fromEntries(Object.entries({ event: 'studio', route, requestId, mode, scenarioId, language, status, errorCode, executionStatus,
          elapsedMs: Math.round(performance.now() - started) }).filter(([, value]) => value !== undefined)));
      }
    },
  };
}
