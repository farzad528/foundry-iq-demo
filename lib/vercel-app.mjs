import { randomUUID } from 'node:crypto';
import { HttpError, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, readBounded } from './protocol.mjs';
import { sanitize } from './normalize.mjs';
import { prepareComparison, runComparison, studioScenarios } from './studio.mjs';
import { industryCatalog, industryById, industryScenarios, industryBinding, industryPreset, runIndustryComparison, prepareIndustryComparison } from './industry.mjs';
import { documentLanguages, validDocumentLanguage } from '../config/studio-languages.mjs';
import {
  LIVE_SCENARIOS, PER_CALL_TIMEOUT_MS, COMPARISON_BUDGET_MS, MAX_SEARCH_CALLS_PER_COMPARISON, MAX_LIVE_IN_FLIGHT_PER_INSTANCE,
  internalEnvironment, attestedMetadata, searchOnlyFetch, attemptBudget, disabledScenarios, disabledIndustries,
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
// Server file-system paths (Windows drives, Vercel/Lambda task roots, file URLs) never belong in a client payload.
const INTERNAL_PATH = /\b[A-Za-z]:\\[^\s"'<>]+|file:\/\/[^\s"'<>]+|(?<![\w.:/])\/(?:var\/task|vercel\/path\d*|tmp|home|Users|opt|private)\/[^\s"'<>]*/g;
const scrubPaths = (value, depth = 0) => depth > 24 ? value
  : typeof value === 'string' ? value.replace(INTERNAL_PATH, '[internal path removed]')
    : Array.isArray(value) ? value.map(item => scrubPaths(item, depth + 1))
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubPaths(item, depth + 1)]))
        : value;
const hostOf = value => { try { return new URL(value).host || undefined; } catch { return undefined; } };

/**
 * Stateless Vercel handler for the Studio API. Live mode sends only Azure AI Search docs/search POSTs
 * with the server-side query key; schema checks use the private attestation bundle compiled into the build.
 */
export function createVercelApp({ liveConfig, attestations, recorded = { entries: {} }, notes = { entries: {} }, industries = { enabled: [] },
  fetchUpstream = (...args) => fetch(...args), log = event => console.log(JSON.stringify(event)), limits = {} } = {}) {
  const settings = { perCallMs: PER_CALL_TIMEOUT_MS, budgetMs: COMPARISON_BUDGET_MS,
    maxCalls: MAX_SEARCH_CALLS_PER_COMPARISON, maxInFlight: MAX_LIVE_IN_FLIGHT_PER_INSTANCE, ...limits };
  const liveConfigText = JSON.stringify(liveConfig);
  const metadata = attestedMetadata(attestations);
  const indexes = attestations.entries.map(entry => entry.index);
  const allScenarios = [liveConfig.scenarios, ...Object.values(liveConfig.languages || {}).map(locale => locale.scenarios)];
  // Native graph and topic bindings (S08/S09): preview API, ~10 s per call, and graph indexes accept graph queries only.
  const nativeBindings = allScenarios.flatMap(scenarios => ['S08', 'S09'].map(id => scenarios?.[id]).filter(config => config?.nativeGraph));
  const graphIndexes = [...new Set(nativeBindings.map(config => config.nativeGraph.graphIndex).filter(Boolean))];
  const timeouts = Object.fromEntries(nativeBindings.flatMap(config => [config.index, config.nativeGraph.graphIndex, config.nativeGraph.topicIndex]
    .filter(Boolean).map(index => [index, config.nativeGraph.timeoutMs])));
  // Only S07 (native agentic), S11 (image vector queries) and the native S08/S09 indexes may use the preview Search API.
  // Industry demos compiled into this build (behind build configuration); each needs a valid private binding.
  const enabledIndustries = (industries.enabled || []).filter(id => industryById(id) && industryBinding(industries.bindings, id));
  const industryBindings = Object.fromEntries(enabledIndustries.map(id => [id, industryBinding(industries.bindings, id)]));
  const previewIndexes = [...allScenarios.flatMap(scenarios => [scenarios?.S07?.index, scenarios?.S11?.index]).filter(Boolean),
    ...nativeBindings.flatMap(config => [config.index, config.nativeGraph.topicIndex].filter(Boolean)),
    ...Object.values(industryBindings).map(binding => binding.index)];
  const industryList = enabledIndustries.length ? [industryCatalog.zava, ...enabledIndustries.map(industryById)]
    .map(({ id, label, short, group, blurb }) => ({ id, label, short, group, blurb })) : [];
  const industryDescriptor = id => {
    const item = id === 'zava' ? industryCatalog.zava : industryById(id);
    return { id: item.id, label: item.label, short: item.short, group: item.group, blurb: item.blurb, sources: item.sources,
      ...(id === 'zava' ? { languages: documentLanguages.map(entry => entry.code ?? entry) } : { languages: ['en'], englishOnly: true, sourceHosts: item.sourceHosts,
        dataNote: 'Public U.S. government data', status: item.status }) };
  };
  const knownIndustry = id => id === 'zava' || enabledIndustries.includes(id);
  let inFlight = 0;
  // Recorded Sample: verified Live responses (request IDs removed) replayed for curated non-English examples. Never a Live fallback.
  const recordings = new Map(Object.entries(recorded.entries || {}));
  // Zava keys are "language|scenario|query"; industry keys add an "industry|" prefix.
  const recordKey = (industry, language, scenarioId, query) => `${industry && industry !== 'zava' ? `${industry}|` : ''}${language ?? 'en'}|${scenarioId}|${String(query ?? '').trim()}`;
  const recordedFor = (industry, language, scenarioId) => [...recordings.values()].filter(entry => (entry.industry || 'zava') === industry
    && entry.language === language && entry.scenarioId === scenarioId);
  // Curated "Why AFTER wins" notes, authored from verified Live results per language and preset; never generated at runtime.
  // Industry notes come from the Industry datasets contract, written from its verified Live evaluation.
  const noteFor = (industry, language, scenarioId, query) => {
    if (industry && industry !== 'zava') {
      const item = industryById(industry);
      const why = industryPreset(item, scenarioId, query)?.why;
      return why ? { text: why, source: `From the verified Live evaluation, ${String(item.evaluatedAt || '').slice(0, 10)}` } : undefined;
    }
    const text = notes.entries?.[recordKey('zava', language, scenarioId, query)];
    return text ? { text, source: `From the recorded Live run, ${notes.recordedAt}` } : undefined;
  };
  const withNote = (result, body) => {
    const note = noteFor(body?.industry, body?.language ?? 'en', result.scenarioId, result.query);
    return note ? { ...result, note } : result;
  };
  const recordedLabel = `Recorded Sample: Live Foundry IQ responses captured on ${recorded.recordedAt}; replayed without sending a query.`;
  function replayRecorded(body) {
    const allowed = ['industry', 'scenarioId', 'mode', 'query', 'topK', 'options', 'language'];
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => !allowed.includes(key))) {
      throw new HttpError(400, 'recorded_sample_invalid', 'Recorded Sample replays bundled examples only. Switch to Live to search with your own image or options.');
    }
    const entry = typeof body.query === 'string' && recordings.get(recordKey(body.industry, body.language, body.scenarioId, body.query));
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
    return { ...result, runId: `recorded-${body.industry && body.industry !== 'zava' ? `${body.industry}-` : ''}${body.language ?? 'en'}-${body.scenarioId}`, mode: 'sample', sample: true,
      recorded: { recordedAt: recorded.recordedAt, source: 'Live Foundry IQ response recorded from this deployment; request IDs removed.', ...(entry.image ? { image: entry.image } : {}) } };
  }

  const publicScenarios = (context, language, rawEnv = {}) => studioScenarios(context.env, language).map(item => {
    const industryPaused = industryList.length && disabledIndustries(rawEnv.LIVE_DISABLED_INDUSTRIES, enabledIndustries).set.has('zava');
    const paused = disabledScenarios(rawEnv.LIVE_DISABLED_SCENARIOS).set.has(item.id) || industryPaused;
    const enabled = context.status.ready && LIVE_SCENARIOS.includes(item.id) && item.liveAvailable && !paused;
    const nativePdf = item.id === 'S10' && item.extractionProvider === 'azureContentUnderstanding';
    const customPdf = item.id === 'S10' && !nativePdf;
    const reason = enabled
      ? customPdf ? 'Custom pre-extracted index retrieval only; Azure Content Understanding is not executed.' : 'Live Foundry IQ retrieval from this server; no Sample fallback.'
      : !context.status.ready ? context.status.reason
        : paused ? `Live ${item.id} is paused by the operator (${industryPaused ? 'LIVE_DISABLED_INDUSTRIES' : 'LIVE_DISABLED_SCENARIOS'}). Sample results are never substituted.` : item.live.reason;
    const recordedQueries = recordedFor('zava', language, item.id).map(entry => entry.query);
    // Recorded Sample replays these same Live comparisons, so both modes describe the Live behavior.
    const demoPresets = item.demoPresets?.map(preset => {
      const note = noteFor('zava', language, item.id, preset.query || item.imageOnlyQuery)?.text;
      return note ? { ...preset, note } : preset;
    });
    return { ...item, liveAvailable: enabled, ...(demoPresets ? { demoPresets } : {}),
      ...(recordedQueries.length ? { description: item.liveDescription, difference: item.liveDescription,
        sample: { available: true, label: recordedLabel, curatedQueries: recordedQueries, recorded: { recordedAt: recorded.recordedAt } } } : {}),
      status: enabled ? customPdf ? 'custom_retrieval_verified' : 'live_verified' : item.status,
      ...(nativePdf ? { nativeTreatment: { provider: 'Azure Content Understanding', status: enabled ? 'verified' : 'unverified', extractionTiming: 'ingestion, not query time' } }
        : customPdf ? { nativeTreatment: { provider: 'Azure Content Understanding', status: 'blocked', reason: 'Custom pre-extracted example.' } } : {}),
      live: { ...item.live, available: enabled, status: enabled ? customPdf ? 'custom_preextracted_index_retrieval_verified' : 'actual_retrieval_verified' : 'unavailable', reason } };
  });

  // Industry catalog: applicable scenarios only, English only, recorded Sample for curated examples, Live per binding and pause lists.
  const industryPublicScenarios = (context, id, rawEnv = {}) => {
    const item = industryById(id);
    const pausedIndustries = disabledIndustries(rawEnv.LIVE_DISABLED_INDUSTRIES, enabledIndustries);
    return industryScenarios(item).map(scenario => {
      const pausedScenario = disabledScenarios(rawEnv.LIVE_DISABLED_SCENARIOS).set.has(scenario.id);
      const pausedIndustry = pausedIndustries.set.has(id);
      const enabled = context.status.ready && !pausedScenario && !pausedIndustry;
      const reason = enabled ? 'Live Foundry IQ retrieval from this server; no Sample fallback.'
        : !context.status.ready ? context.status.reason
          : pausedIndustry ? `Live ${item.short} is paused by the operator (LIVE_DISABLED_INDUSTRIES). Sample results are never substituted.`
            : `Live ${scenario.id} is paused by the operator (LIVE_DISABLED_SCENARIOS). Sample results are never substituted.`;
      const recordedQueries = recordedFor(id, 'en', scenario.id).map(entry => entry.query);
      const demoPresets = scenario.demoPresets.map(preset => {
        const note = noteFor(id, 'en', scenario.id, preset.query)?.text;
        return note ? { ...preset, note } : preset;
      });
      return { ...scenario, demoPresets, liveAvailable: enabled, status: enabled ? 'live_verified' : 'sample_only',
        sample: recordedQueries.length ? { available: true, label: recordedLabel, curatedQueries: recordedQueries, recorded: { recordedAt: recorded.recordedAt } }
          : { available: false, label: 'Recorded Sample is not available for this industry yet; use Live data.', curatedQueries: [] },
        live: { available: enabled, status: enabled ? 'actual_retrieval_verified' : 'unavailable', reason } };
    });
  };

  return {
    async handle(route, request, rawEnv = {}) {
      const requestId = randomUUID();
      const started = performance.now();
      const context = internalEnvironment(rawEnv, liveConfigText, attestations.service);
      // Keys and the Search hostname are redacted from every payload; index/binding names remain as intended provenance.
      const secrets = [context.env.AZURE_SEARCH_API_KEY, rawEnv.AZURE_SEARCH_QUERY_KEY, hostOf(rawEnv.AZURE_SEARCH_ENDPOINT)];
      const url = new URL(request.url);
      const headers = { ...SECURITY_HEADERS, 'X-Request-Id': requestId, ...(url.protocol === 'https:' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}) };
      let status = 500;
      let errorCode;
      let mode;
      let industry;
      let scenarioId;
      let language;
      let executionStatus;
      let timer;
      let counted = false;
      const respond = (body, responseStatus = 200, extra = {}) => {
        status = responseStatus;
        const text = JSON.stringify(scrubPaths(sanitize(body, secrets)));
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
              ...(context.status.ready ? {} : { reason: context.status.reason }), upstream: 'Foundry IQ docs/search and graph queries only', requestId });
          }
          language = url.searchParams.get('language') ?? 'en';
          if (!validDocumentLanguage(language)) throw new HttpError(400, 'invalid_document_language', 'Select a supported document language.');
          const industry = url.searchParams.get('industry') ?? 'zava';
          if (!knownIndustry(industry)) throw new HttpError(400, 'invalid_industry', 'Select a supported industry.');
          const shared = industryList.length ? { industry: industryDescriptor(industry), industries: industryList } : {};
          if (industry !== 'zava') {
            if (language !== 'en') throw new HttpError(400, 'invalid_document_language', 'This industry demo is English-only.');
            const items = industryPublicScenarios(context, industry, rawEnv);
            return respond({ scenarios: items, language: 'en', documentLanguages, ...shared,
              defaultMode: items.some(item => item.sample.available) && !context.status.ready ? 'sample' : 'live' });
          }
          return respond({ scenarios: publicScenarios(context, language, rawEnv), language, documentLanguages, ...shared,
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
        industry = body?.industry ?? 'zava';
        if (typeof industry !== 'string' || !knownIndustry(industry)) { industry = undefined; throw new HttpError(400, 'invalid_industry', 'Select a supported industry.'); }
        // The Zava path is unchanged: an explicit "zava" industry is the default demo.
        if (industry === 'zava' && body && typeof body === 'object') delete body.industry;
        const isIndustry = industry !== 'zava';
        timer = new AbortController();
        const timeout = setTimeout(() => timer.abort(new DOMException('Comparison budget elapsed', 'TimeoutError')), settings.budgetMs);
        timeout.unref?.();
        timer.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
        const signal = AbortSignal.any([request.signal, timer.signal]);
        if (mode === 'live') {
          if (!context.status.ready) throw new HttpError(503, context.status.code, context.status.reason);
          const item = scenarioId && (isIndustry ? industryPublicScenarios(context, industry, rawEnv) : publicScenarios(context, language, rawEnv)).find(entry => entry.id === scenarioId);
          if (item && !item.liveAvailable) throw new HttpError(503, 'studio_live_unavailable', item.live.reason);
          if (route === 'run') {
            if (inFlight >= settings.maxInFlight) throw new HttpError(503, 'live_busy', 'The live demo is busy. Wait a few seconds, then Search again.', { retryAfter: 5 });
            inFlight += 1;
            counted = true;
          }
        }
        if (route === 'prepare' && isIndustry) {
          return respond(await prepareIndustryComparison(body, { env: context.env, metadata, signal, bindings: industries.bindings, ...attemptBudget(0) }));
        }
        if (route === 'prepare') {
          // Attested metadata only: preparation never contacts Azure.
          const result = await prepareComparison(body, { env: context.env, signal, fetchUpstream: noNetwork, metadata,
            ...attemptBudget(0), schemaCache: new Map(), availability: async () => ({}) });
          return respond(result);
        }
        const live = mode === 'live';
        if (route === 'run' && mode === 'sample' && recordedFor(industry, isIndustry ? 'en' : language, scenarioId).length) {
          const replay = replayRecorded(body);
          executionStatus = replay.executionStatus;
          return respond(withNote(replay, body));
        }
        const budget = attemptBudget(settings.maxCalls);
        if (isIndustry) {
          const result = await runIndustryComparison(body, { env: context.env, signal, requestId, metadata, bindings: industries.bindings,
            fetchUpstream: live ? searchOnlyFetch(fetchUpstream, context.status.origin, indexes, settings.perCallMs, previewIndexes, { graphIndexes, timeouts }) : noNetwork,
            reserveAttempt: budget.reserveAttempt, releaseAttempt: budget.releaseAttempt });
          signal.throwIfAborted();
          executionStatus = result.executionStatus;
          return respond(withNote(result, body));
        }
        const result = await runComparison(body, { env: live ? context.env : {}, signal, requestId, metadata: live ? metadata : undefined,
          fetchUpstream: live ? searchOnlyFetch(fetchUpstream, context.status.origin, indexes, settings.perCallMs, previewIndexes, { graphIndexes, timeouts }) : noNetwork,
          reserveAttempt: budget.reserveAttempt, releaseAttempt: budget.releaseAttempt });
        signal.throwIfAborted();
        executionStatus = result.executionStatus;
        return respond(withNote(result, body));
      } catch (error) {
        let failure = error;
        if (request.signal.aborted) failure = new HttpError(499, 'request_cancelled', 'The client cancelled this comparison.');
        else if (timer?.signal.aborted) failure = new HttpError(504, 'comparison_timeout', 'The comparison time budget expired. No Sample results were substituted.');
        if (!(failure instanceof HttpError)) failure = new HttpError(500, 'internal_error', 'The comparison could not complete. Use the request ID when contacting the operator.');
        errorCode = failure.code;
        // Every app-level 429 carries Retry-After (the Vercel Firewall's own 429 cannot be customized).
        const retryAfter = Number.isInteger(failure.details?.retryAfter) ? failure.details.retryAfter : failure.status === 429 ? 60 : undefined;
        return respond({ error: failure.message, errorCode, requestId, ...(retryAfter ? { retryAfter } : {}) },
          failure.status, retryAfter ? { 'Retry-After': String(retryAfter) } : {});
      } finally {
        if (counted) inFlight -= 1;
        timer?.abort();
        // Allowlisted telemetry only: never questions, answers, passages, cookies, IPs or credentials.
        log(Object.fromEntries(Object.entries({ event: 'studio', route, requestId, mode, industry, scenarioId, language, status, errorCode, executionStatus,
          elapsedMs: Math.round(performance.now() - started) }).filter(([, value]) => value !== undefined)));
      }
    },
  };
}
