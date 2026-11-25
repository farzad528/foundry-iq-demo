import { readFileSync } from 'node:fs';
import { HttpError } from './protocol.mjs';
import { liveContext, searchHits, withRetrievable, agenticDiagnostics, failure } from './studio.mjs';
import { SEARCH_API_VERSION, AGENTIC_SEARCH_API_VERSION } from '../config/studio-live.mjs';
import { industryScenarioCopy } from '../config/studio-scenarios.mjs';

// Industry demos on public U.S. government data (English only). Each industry is one Foundry IQ index with the same
// schema contract; requests follow the Industry datasets evaluation exactly. Filters, facets, scoring profiles and S10
// documents come only from the server-side preset allowlist in config/studio-industries.json; index names come from the
// private binding compiled into the server bundle.
export const industryCatalog = JSON.parse(readFileSync(new URL('../config/studio-industries.json', import.meta.url), 'utf8'));
export const INDUSTRY_IDS = Object.freeze(industryCatalog.industries.map(industry => industry.id));
export const industryById = id => industryCatalog.industries.find(industry => industry.id === id);
export const BASE_FILTER = "scope eq 'public' and variant eq 'primary'";
const SELECT = 'id,sourceId,title,content,url,scope';
const BOOST_SUBTYPES = ['freshness', 'authority', 'impact'];
const name = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = message => { throw new HttpError(400, 'invalid_studio_request', message); };
const badSchema = () => { throw new HttpError(503, 'studio_schema_unverified', 'Reviewed resource schema or ETag does not match.'); };
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

// Arm kinds per scenario (BEFORE, AFTER); labels are shown in the arm headers.
export const INDUSTRY_KINDS = {
  S01: ['plainKeyword', 'fulltext'], S02: ['lexical', 'vector'], S03: ['lexical', 'hybrid'], S04: ['hybrid', 'rerank'],
  S05: ['lexical', 'filteredHybrid'], S06: ['hybrid', 'boost'], S07: ['singlePass', 'planned'], S10: ['basic', 'layout'],
};
const ARM_LABELS = {
  S01: ['Plain keyword: every term', 'Full-text analyzers + synonyms'], S02: ['Keyword matching', 'Vector similarity'],
  S03: ['Keyword search', 'Hybrid search'], S04: ['Hybrid candidates', 'Semantic reranking'],
  S05: ['Keyword search, no filter', 'Filtered hybrid + facets'], S06: ['Hybrid search', 'Hybrid + scoring profile'],
  S07: ['Single-pass hybrid retrieval', 'Single-index agentic retrieval'], S10: ['Azure CU Read pages', 'Azure CU Layout table rows'],
};

/** Field names a reviewed OData preset filter reads (string literals and any() lambda variables excluded); checked at build time. */
export function filterFields(filter) {
  const text = String(filter ?? '').replace(/'(?:[^']|'')*'/g, "''");
  const lambdas = new Set([...text.matchAll(/\/any\(\s*([A-Za-z_]\w*)\s*:/g)].map(match => match[1]));
  const names = [...text.matchAll(/\b([A-Za-z_]\w*)(?=\/any\(|\s+(?:eq|ne|gt|ge|lt|le)\s)/g), ...text.matchAll(/\bsearch\.in\(\s*([A-Za-z_]\w*)/g)].map(match => match[1]);
  return [...new Set(names.filter(name => !lambdas.has(name)))];
}

/** Exact curated example for this industry and scenario, or undefined for free text. */
export function industryPreset(industry, scenarioId, query) {
  const text = String(query ?? '').trim();
  return (industry?.presets?.[scenarioId] || []).find(preset => preset.query === text);
}

/** Validates a private industry binding (built from attestations); returns null when it isn't usable. */
export function industryBinding(bindings, id) {
  const binding = bindings?.industries?.[id];
  if (!object(binding) || !name(binding.index) || typeof binding.indexETag !== 'string' || !binding.indexETag || binding.indexETag.length > 200
    || !name(binding.semanticConfiguration) || !name(binding.vectorField) || !object(binding.scoringProfiles)
    || Object.entries(binding.scoringProfiles).some(([subtype, profile]) => !BOOST_SUBTYPES.includes(subtype) || !name(profile))
    || !Number.isInteger(bindings.agentic?.maxRuntimeInSeconds) || bindings.agentic.maxRuntimeInSeconds < 1 || bindings.agentic.maxRuntimeInSeconds > 30) return null;
  return { ...binding, maxRuntimeInSeconds: bindings.agentic.maxRuntimeInSeconds };
}

/** Public scenario descriptors for one industry (status and Sample availability are added by the handler). */
export function industryScenarios(industry) {
  return industry.scenarios.map(id => {
    const copy = industryScenarioCopy[id];
    const presets = industry.presets?.[id] || [];
    const [baseline, enhanced] = INDUSTRY_KINDS[id];
    return {
      id, industry: industry.id, title: copy.title, description: copy.description, liveDescription: copy.description, difference: copy.description,
      baseline, enhanced, renderer: id === 'S10' ? 'pdfEvidence' : 'documentCards', limits: copy.limits,
      sampleQuery: presets[0]?.query || '', queries: presets.map(preset => preset.query),
      demoPresets: presets.map(({ label, hint, query, boostSubtype }) => ({ label: label || query, query, ...(hint ? { hint } : {}), ...(boostSubtype ? { boostSubtype } : {}) })),
      input: ['text'], acceptedInputTypes: ['text'], defaultTopK: 10, topK: [5, 10, 20, 50], language: 'en',
      ...(id === 'S06' ? { boostSubtypes: [...industry.boostSubtypes], defaultBoostSubtype: industry.boostSubtypes[0], liveWeightConfigurable: false } : {}),
    };
  });
}

/** Validates an industry comparison request. Filters, facets and documents are never accepted from the client. */
export function validateIndustryRequest(body) {
  if (!object(body) || Object.keys(body).some(key => !['industry', 'scenarioId', 'mode', 'query', 'topK', 'options', 'language'].includes(key))) {
    invalid('Unsupported comparison fields.');
  }
  const industry = industryById(body.industry);
  if (!industry) invalid('Select a supported industry.');
  if ((body.language ?? 'en') !== 'en') invalid('This industry demo is English-only.');
  if (!['sample', 'live'].includes(body.mode)) invalid('Select an explicit sample/live mode.');
  if (!industry.scenarios.includes(body.scenarioId)) invalid('This scenario does not apply to the selected industry.');
  if (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 8000) invalid('Question must be 1–8,000 characters.');
  const topK = body.topK ?? 10;
  if (![5, 10, 20, 50].includes(topK)) invalid('Evidence count must be 5, 10, 20 or 50.');
  const options = body.options ?? {};
  if (!object(options) || Object.keys(options).some(key => key !== 'boostSubtype')) invalid('Unsupported options.');
  if ('boostSubtype' in options && (body.scenarioId !== 'S06' || !industry.boostSubtypes.includes(options.boostSubtype))) invalid('Unknown boost subtype.');
  const query = body.query.trim();
  return { industry, scenarioId: body.scenarioId, query, topK, options: { ...options }, mode: body.mode, preset: industryPreset(industry, body.scenarioId, query) };
}

/** Checks the bundled, ETag-pinned attestation for an industry index against what each scenario needs. */
export async function verifyIndustryIndex(http, binding, scenarioId, industry) {
  const result = await http(`/indexes/${encodeURIComponent(binding.index)}?api-version=${SEARCH_API_VERSION}`);
  const schema = result.data;
  if (result.etag !== binding.indexETag || schema?.name !== binding.index || !Array.isArray(schema.fields)) badSchema();
  const fields = new Map(schema.fields.map(field => [field.name, field]));
  const field = key => fields.get(key);
  const id = field('id');
  if (!id?.key || !id.searchable || !id.filterable || id.analyzer !== 'keyword') badSchema();
  for (const key of ['title', 'content']) if (!field(key)?.searchable || field(key).retrievable === false) badSchema();
  for (const key of ['titlePlain', 'contentPlain']) if (!field(key)?.searchable) badSchema();
  for (const key of ['scope', 'variant']) if (!field(key)?.filterable) badSchema();
  if (field('url')?.retrievable === false || !field('url')) badSchema();
  const vector = field(binding.vectorField);
  const profile = schema.vectorSearch?.profiles?.find(item => item.name === vector?.vectorSearchProfile);
  const vectorizer = schema.vectorSearch?.vectorizers?.find(item => item.name === profile?.vectorizer);
  // Query text is vectorized by Search through its own identity: no key and no identity override.
  if (vector?.type !== 'Collection(Edm.Single)' || !vector.searchable || vectorizer?.kind !== 'azureOpenAI'
    || vectorizer.azureOpenAIParameters?.apiKey || vectorizer.azureOpenAIParameters?.authIdentity) badSchema();
  if (['S04', 'S07'].includes(scenarioId) && !schema.semantic?.configurations?.some(item => item.name === binding.semanticConfiguration)) badSchema();
  if (scenarioId === 'S06') {
    for (const subtype of industry.boostSubtypes) {
      if (!binding.scoringProfiles[subtype] || !schema.scoringProfiles?.some(item => item.name === binding.scoringProfiles[subtype])) badSchema();
    }
  }
  if (scenarioId === 'S10') {
    for (const key of ['sourceHash', 'extractionAnalyzer']) if (!field(key)?.filterable || field(key).retrievable === false) badSchema();
    for (const key of ['page', 'row', 'coordinates']) if (!field(key)) badSchema();
  }
  fields.synonymMaps = [...new Set(['title', 'content'].flatMap(key => field(key)?.synonymMaps || []))];
  fields.scoringProfiles = schema.scoringProfiles || [];
  return fields;
}

/** Reviewed facet expressions: a field plus optional count, sort and interval parameters (e.g. "publishedDate,interval:year"). */
export const isFacet = value => typeof value === 'string' && value.length <= 100
  && /^[A-Za-z][A-Za-z0-9]*(?:,(?:count:\d{1,3}|sort:-?(?:count|value)|interval:(?:year|quarter|month|week|day|hour|minute|\d{1,6})))*$/.test(value);
/** Request bodies for one arm, matching the Industry datasets evaluation. */
export function industryPayload(scenarioId, side, { query, topK }, binding, industry, preset, options, fields) {
  const select = withRetrievable(SELECT, fields);
  const keyword = (filter = BASE_FILTER) => ({ search: query, searchFields: 'title,content', queryType: 'simple', searchMode: 'any', select, top: topK, filter });
  const vectorQueries = [{ kind: 'text', text: query, fields: binding.vectorField, k: 50 }];
  const hybrid = (filter = BASE_FILTER) => ({ ...keyword(filter), vectorQueries, vectorFilterMode: 'preFilter' });
  const scoped = filter => filter ? `${BASE_FILTER} and (${filter})` : BASE_FILTER;
  const applied = [];
  let payload;
  switch (scenarioId) {
    case 'S01':
      payload = side === 'baseline' ? { ...keyword(), searchFields: 'titlePlain,contentPlain', searchMode: 'all' } : keyword();
      break;
    case 'S02':
      payload = side === 'baseline' ? keyword() : { vectorQueries, vectorFilterMode: 'preFilter', select, top: topK, filter: BASE_FILTER };
      break;
    case 'S03':
      payload = side === 'baseline' ? keyword(scoped(preset?.filter)) : hybrid(scoped(preset?.filter));
      if (preset?.filter) applied.push({ label: 'Filter (both arms)', value: preset.filter });
      break;
    case 'S04':
      payload = hybrid();
      break;
    case 'S05': {
      if (side === 'baseline') { payload = keyword(); break; }
      const facets = preset ? preset.facets || [] : industry.defaults?.S05?.facets || [];
      if (facets.some(facet => !isFacet(facet) || !fields.get(facet.split(',')[0])?.facetable)) badSchema();
      payload = { ...hybrid(scoped(preset?.filter)), ...(facets.length ? { facets: [...facets] } : {}) };
      if (preset?.filter) applied.push({ label: 'Filter', value: preset.filter });
      if (facets.length) applied.push({ label: 'Facets', value: facets.map(facet => facet.split(',')[0]).join(', ') });
      break;
    }
    case 'S06':
      payload = hybrid();
      if (side === 'enhanced') {
        const subtype = options.boostSubtype || preset?.boostSubtype || industry.boostSubtypes[0];
        payload.scoringProfile = binding.scoringProfiles[subtype];
        if (!payload.scoringProfile) badSchema();
        applied.push({ label: 'Scoring profile', value: `${subtype} (${payload.scoringProfile})` });
      }
      break;
    case 'S07':
      payload = side === 'baseline' ? hybrid()
        : { search: query, queryType: 'agentic', agenticOptions: { maxRuntimeInSeconds: binding.maxRuntimeInSeconds }, debug: 'agentic', filter: BASE_FILTER, select, top: topK };
      break;
    case 'S10': {
      const sourceHash = preset?.sourceHash || industry.defaults?.S10?.sourceHash;
      if (!/^[a-f0-9]{64}$/.test(sourceHash || '')) throw new HttpError(503, 'studio_capability_unavailable', 'No reviewed PDF is configured for this industry.');
      const analyzer = side === 'baseline' ? 'prebuilt-read' : 'prebuilt-layout';
      payload = keyword(`scope eq 'public' and extractionAnalyzer eq ${quote(analyzer)} and sourceHash eq ${quote(sourceHash)}`);
      applied.push({ label: 'Document', value: `${preset ? 'Example PDF' : 'First example’s PDF'} · source hash ${sourceHash.slice(0, 12)}…` });
      break;
    }
    default:
      invalid('This scenario does not apply to the selected industry.');
  }
  return { payload, applied };
}

const SCORE_TYPES = { keyword: 'Foundry IQ keyword score (BM25)', vector: 'Foundry IQ vector similarity', hybrid: 'Foundry IQ fused score' };
const scoreTypeOf = payload => payload.vectorQueries && payload.search ? SCORE_TYPES.hybrid : payload.vectorQueries ? SCORE_TYPES.vector : SCORE_TYPES.keyword;
/** Keeps citation links only for https URLs on this industry's public source hosts. */
export function industryLinks(hits, industry) {
  const hosts = new Set(industry.sourceHosts);
  return hits.map(hit => {
    let link = null;
    try {
      const url = new URL(hit.url);
      if (url.protocol === 'https:' && hosts.has(url.host) && !url.username && !url.password && !url.port) link = url.href;
    } catch { /* no link */ }
    const { url, ...rest } = hit;
    return link ? { ...rest, url: link } : rest;
  });
}
const cites = hits => hits.map(hit => ({ id: hit.id, sourceId: hit.sourceId, ...(hit.url ? { url: hit.url } : {}), ...(hit.page ? { page: hit.page } : {}) }));

async function industryArm(scenarioId, side, request, binding, context, verified, shared) {
  const { industry, preset, options, query, topK } = request;
  const fields = await verified;
  const kind = INDUSTRY_KINDS[scenarioId][side === 'baseline' ? 0 : 1];
  const trace = { steps: ['Schema and ETag checked against the bundled private attestation for this build; no runtime schema request was sent. No retries.'],
    configuration: { query, topK, industry: industry.id, datasetVersion: industryCatalog.datasetVersion, index: binding.index, searchApiVersion: SEARCH_API_VERSION,
      mechanism: kind, scope: 'public', ...(preset ? { presetId: preset.id } : {}),
      embedding: { field: binding.vectorField, scope: 'Foundry IQ vectorized the query text with the index vectorizer; the app sent no embedding request or model credential.' } } };
  const arm = { status: 'success', kind, label: ARM_LABELS[scenarioId][side === 'baseline' ? 0 : 1], hits: [], trace };
  const index = `/indexes/${encodeURIComponent(binding.index)}/docs/search`;
  let response, hits;
  if (scenarioId === 'S04') {
    const candidates = await shared;
    trace.configuration.candidateIds = candidates.hits.map(hit => hit.id);
    trace.configuration.semanticConfiguration = binding.semanticConfiguration;
    trace.configuration.filter = BASE_FILTER;
    response = candidates.response;
    hits = structuredClone(candidates.hits);
    if (side === 'enhanced' && hits.length) {
      const ids = hits.map(hit => hit.id);
      const lucene = value => value.replace(/[\\+\-&|!(){}\[\]^"~*?:/]/g, '\\$&');
      // Keyword IDs give every fixed candidate nonzero L1 relevance; semanticQuery is solely the L2 text.
      response = await context.http(`${index}?api-version=${SEARCH_API_VERSION}`, {
        search: ids.map(id => `id:"${lucene(id)}"`).join(' OR '), queryType: 'full', semanticQuery: query, semanticConfiguration: binding.semanticConfiguration,
        select: withRetrievable(SELECT, fields), top: ids.length, filter: `${BASE_FILTER} and (${ids.map(id => `id eq ${quote(id)}`).join(' or ')})`,
        semanticMaxWaitInMilliseconds: 5000 });
      const reranked = searchHits(response.data, topK, undefined, fields);
      const originals = new Map(hits.map(hit => [hit.id, hit]));
      if (reranked.length !== hits.length || reranked.some(hit => !originals.has(hit.id) || hit.snippet !== originals.get(hit.id).snippet)
        || response.data.value.some(item => !Number.isFinite(item['@search.rerankerScore']))) {
        throw new HttpError(502, 'studio_candidate_drift', 'Semantic ranking did not preserve exact candidate IDs/content or report semantic scores.');
      }
      hits = reranked;
      trace.steps.push('Semantic-only L2 query over the exact shared IDs; keyword-ID L1 carrier, no hybrid re-retrieval.');
    } else trace.steps.push('One shared hybrid candidate retrieval; baseline order retained.');
    hits = hits.map(({ score, scoreType, ...hit }) => hit);
  } else {
    const { payload, applied } = industryPayload(scenarioId, side, request, binding, industry, preset, options, fields);
    if (applied.length) arm.applied = applied;
    const agentic = payload.queryType === 'agentic';
    const version = agentic ? AGENTIC_SEARCH_API_VERSION : SEARCH_API_VERSION;
    response = await context.http(`${index}?api-version=${version}`, payload);
    trace.configuration.searchApiVersion = version;
    trace.configuration.filter = payload.filter;
    if (payload.scoringProfile) trace.configuration.scoringProfile = payload.scoringProfile;
    if (payload.facets) trace.configuration.facets = payload.facets;
    if (scenarioId === 'S01' && side === 'enhanced' && fields.synonymMaps.length) trace.configuration.synonymMaps = fields.synonymMaps;
    if (scenarioId === 'S01' && side === 'baseline') trace.steps.push('Unanalyzed title and text fields; every term must match (searchMode all), with no stemming or synonyms.');
    hits = searchHits(response.data, topK, agentic ? undefined : scoreTypeOf(payload), fields);
    if (agentic) {
      trace.configuration.agenticSearch = agenticDiagnostics(response.data, context.secrets);
      trace.steps.push('Native single-index agentic Search on the same index as the baseline; no knowledge-base retrieval or external planner.');
      if (response.status === 206 || trace.configuration.agenticSearch.terminationReason !== 'modelStopped') {
        arm.status = 'partial';
        arm.error = { code: 'studio_agentic_incomplete', message: 'Agentic retrieval stopped before completing. Available sources are shown; try Search again shortly.' };
      }
    }
    if (payload.facets && object(response.data['@search.facets'])) arm.facets = response.data['@search.facets'];
    if (scenarioId === 'S10') {
      const analyzer = side === 'baseline' ? 'prebuilt-read' : 'prebuilt-layout';
      if (response.data.value.some(item => item.extractionAnalyzer !== analyzer || !Number.isInteger(item.page) || item.page <= 0
        || side === 'enhanced' && item.chunkType === 'table-row' && (!Number.isInteger(item.row) || !item.coordinates))) {
        throw new HttpError(502, 'studio_pdf_source_mismatch', 'Returned PDF analyzer/page/row does not match the reviewed extraction.');
      }
      trace.configuration.extraction = { provider: 'azureContentUnderstanding', analyzer, timing: 'ingestion, not query time' };
    }
  }
  arm.hits = industryLinks(hits, industry);
  arm.citations = cites(arm.hits);
  trace.requestId = response.requestId || undefined;
  trace.latencyMs = response.latencyMs;
  trace.configuration.latencyScope = scenarioId === 'S04' && side === 'baseline' ? 'shared candidate HTTP attempt' : 'observed retrieval HTTP attempt; schema excluded';
  return arm;
}

/** Validates attested schemas for an industry comparison without contacting Azure. */
export async function prepareIndustryComparison(body, { env, metadata, signal, bindings, reserveAttempt, releaseAttempt }) {
  const request = validateIndustryRequest(body);
  const binding = industryBinding(bindings, request.industry.id);
  if (!binding) throw new HttpError(503, 'studio_live_unavailable', 'This industry is not configured on this deployment.');
  const context = liveContext({ env, signal, fetchUpstream: () => { throw new HttpError(503, 'studio_capability_unavailable', 'Preparation never contacts Azure.'); },
    reserveAttempt, releaseAttempt, metadata });
  await verifyIndustryIndex(context.http, binding, request.scenarioId, request.industry);
  return { ready: true, phase: 'comparison', maxComparisonAttempts: 2 };
}

/** Runs both arms of an industry comparison with per-arm API logs; every upstream call is a bounded Search read. */
export async function runIndustryComparison(body, { env, signal, fetchUpstream, reserveAttempt, releaseAttempt, requestId, metadata, bindings }) {
  const request = validateIndustryRequest(body);
  if (request.mode !== 'live') invalid('Industry Sample replays recorded examples only.');
  const binding = industryBinding(bindings, request.industry.id);
  if (!binding) throw new HttpError(503, 'studio_live_unavailable', 'This industry is not configured on this deployment.');
  const context = liveContext({ env, signal, fetchUpstream, reserveAttempt, releaseAttempt, metadata });
  const verified = verifyIndustryIndex(context.http, binding, request.scenarioId, request.industry);
  void verified.catch(() => {});
  const apiLogs = { shared: [], baseline: [], enhanced: [] };
  let shared;
  if (request.scenarioId === 'S04') {
    shared = verified.then(async fields => {
      const { payload } = industryPayload('S04', 'baseline', request, binding, request.industry, request.preset, request.options, fields);
      const response = await context.withLog(apiLogs.shared).http(`/indexes/${encodeURIComponent(binding.index)}/docs/search?api-version=${SEARCH_API_VERSION}`, payload);
      return { response, hits: searchHits(response.data, request.topK, SCORE_TYPES.hybrid, fields) };
    });
    void shared.catch(() => {});
  }
  const snapshot = { query: request.query, topK: request.topK, industry: request.industry.id };
  const settled = await Promise.allSettled(['baseline', 'enhanced'].map(side =>
    industryArm(request.scenarioId, side, request, binding, context.withLog(apiLogs[side]), verified, shared)));
  const arms = settled.map((result, i) => result.status === 'fulfilled' ? result.value
    : failure(signal?.aborted ? new DOMException('Comparison cancelled', 'AbortError') : result.reason, INDUSTRY_KINDS[request.scenarioId][i], snapshot, requestId));
  arms.forEach((arm, i) => {
    arm.apiLog = [...apiLogs.shared.map(entry => ({ ...entry, shared: true })), ...apiLogs[i ? 'enhanced' : 'baseline']];
    if (!arm.label) arm.label = ARM_LABELS[request.scenarioId][i];
  });
  const [baseline, enhanced] = arms;
  const ranks = new Map(baseline.hits.map(hit => [hit.id, hit.rank]));
  const completed = arms.filter(arm => ['success', 'partial'].includes(arm.status)).length;
  return {
    runId: requestId, mode: 'live', industry: request.industry.id, scenarioId: request.scenarioId, query: request.query, baseline, enhanced,
    comparison: { intendedDifference: industryScenarioCopy[request.scenarioId].description, snapshot,
      scoreComparison: 'Unlike score types are not numerically compared.',
      rankMovement: enhanced.hits.filter(hit => ranks.has(hit.id)).map(hit => ({ id: hit.id, before: ranks.get(hit.id), after: hit.rank, movement: ranks.get(hit.id) - hit.rank })) },
    executionStatus: completed === 2 && arms.every(arm => arm.status === 'success') ? 'success' : completed ? 'partial_success'
      : arms.every(arm => arm.status === 'cancelled') ? 'cancelled' : 'error',
  };
}
