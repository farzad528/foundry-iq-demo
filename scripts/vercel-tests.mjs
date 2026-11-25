import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createVercelApp } from '../lib/vercel-app.mjs';
import { liveStatus, searchOnlyFetch, attemptBudget, attestedMetadata, disabledScenarios, disabledIndustries, graphServiceStatus, LIVE_SCENARIOS } from '../lib/search-adapter.mjs';
import { transformBindings, reduceAttestations, industryBindingsFrom, checkIndustryCatalog, aboutWithDataSources, industryRecordingProblems, pageWithIndustries, industryGraphFrom, industryGraphPresetProblems } from './build-vercel.mjs';
import { industryCatalog, industryById, filterFields, isFacet, BASE_FILTER } from '../lib/industry.mjs';
import { SEARCH_API_VERSION, AGENTIC_SEARCH_API_VERSION } from '../config/studio-live.mjs';
import { illustrationPng } from './generate-studio.mjs';
import { retryAfterSeconds } from '../lib/studio.mjs';
import { imageOnlyQuery } from '../config/studio-languages.mjs';
import { displayText, notConfigured } from '../assets/display.mjs';

const KEY = 'QueryKeyForTestsOnly0123456789abcdefABCDEF';
const ENDPOINT = 'https://foundry-iq-demos.search.windows.net';
const ORIGIN = 'https://studio.example.test';
const env = (patch = {}) => ({ LIVE_ENABLED: 'true', AZURE_SEARCH_ENDPOINT: ENDPOINT, AZURE_SEARCH_QUERY_KEY: KEY, ...patch });
const vector = { field: 'contentVector', profile: 'zava-text-profile', vectorizer: 'zava-text-vectorizer', deployment: 'embed',
  model: 'text-embedding-3-small', modelVersion: '1', dimensions: 6 };
const attestation = { checkedAt: '2026-11-24', region: 'westcentralus', evidenceVersion: 'test-v1' };
const liveConfig = { datasetVersion: 'zava-studio-2026-01', resourceVersion: 'test-v1', languages: {}, scenarios: {
  S01: { index: 'zava-studio-products', indexETag: '"e1"', attestation, synonymMaps: ['zava-studio-synonyms'] },
  S02: { index: 'zava-studio-products', indexETag: '"e1"', attestation, vector },
  S07: { index: 'zava-studio-support', indexETag: '"e2"', attestation, vector,
    answer: { deployment: 'answer', modelVersion: '1', instructionsVersion: 'studio-grounded-answer-v1', reasoningEffort: 'none' },
    agentic: { apiVersion: '2026-11-01-preview', maxRuntimeInSeconds: 30, knowledgeRetrievalPlan: 'free' } },
  S11: { index: 'zava-studio-images-vision', indexETag: '"e3"', attestation, image: { provider: 'azureVision', field: 'imageVector',
    profile: 'zava-image-profile', model: 'azure-vision-multimodal', modelVersion: '2023-04-15', dimensions: 1024,
    corpus: { model: 'azure-vision-multimodal', modelVersion: '2023-04-15', dimensions: 1024, manifestHash: 'a'.repeat(64) } } },
} };
const productsSchema = () => ({ name: 'zava-studio-products',
  description: 'Zava Studio synthetic dataset zava-studio-2026-01; encoder=text-embedding-3-small@1; dimensions=6',
  fields: [
    { name: 'id', type: 'Edm.String', key: true, sortable: true, filterable: true },
    ...['title', 'content'].map(name => ({ name, type: 'Edm.String', searchable: true, synonymMaps: ['zava-studio-synonyms'] })),
    { name: 'url', type: 'Edm.String' }, { name: 'scope', type: 'Edm.String', filterable: true },
    { name: 'contentVector', type: 'Collection(Edm.Single)', searchable: true, dimensions: 6, vectorSearchProfile: 'zava-text-profile' },
  ],
  vectorSearch: { profiles: [{ name: 'zava-text-profile', algorithm: 'hnsw', vectorizer: 'zava-text-vectorizer' }], algorithms: [{ name: 'hnsw', kind: 'hnsw' }],
    vectorizers: [{ name: 'zava-text-vectorizer', kind: 'azureOpenAI', azureOpenAIParameters: {
      resourceUri: 'https://embed-account.openai.azure.com', deploymentId: 'embed', modelName: 'text-embedding-3-small', authIdentity: null } }] } });
const attestations = (schema = productsSchema(), etag = '"e1"', extra = []) => ({ service: 'foundry-iq-demos', apiVersion: SEARCH_API_VERSION,
  entries: [{ index: 'zava-studio-products', etag, schema }, ...extra] });
const searchResponse = () => new Response(JSON.stringify({ '@odata.count': 1, value: [{ id: 'DRILL-1001', title: 'Compact hammer drill',
  content: 'Light hammer drill for brick.', url: '/samples/zava-catalog.csv', scope: 'public', '@search.score': 2.5 }] }),
{ status: 200, headers: { 'content-type': 'application/json', 'request-id': 'svc-request-1' } });
function harness({ handler = async () => searchResponse(), schema, etag, limits, config = liveConfig, extra = [], industries, recorded } = {}) {
  const calls = [];
  const logs = [];
  const app = createVercelApp({ liveConfig: config, attestations: attestations(schema, etag, extra), limits, log: event => logs.push(event), industries, recorded,
    fetchUpstream: async (url, init) => { calls.push({ url, init }); return handler(url, init); } });
  return { app, calls, logs };
}
const post = (route, body, headers = {}) => new Request(`${ORIGIN}/api/demo/${route}`, { method: 'POST',
  headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const liveBody = (scenarioId = 'S02', patch = {}) => ({ scenarioId, mode: 'live', query: 'A lightweight tool for making holes in brick walls', ...patch });

test('kill switch and missing or invalid variables fail closed with clear, value-free messages', () => {
  assert.match(liveStatus({}).reason, /LIVE_ENABLED/);
  assert.equal(liveStatus({ LIVE_ENABLED: 'false', AZURE_SEARCH_ENDPOINT: ENDPOINT, AZURE_SEARCH_QUERY_KEY: KEY }).code, 'live_disabled');
  assert.match(liveStatus({ LIVE_ENABLED: 'true' }).reason, /AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_QUERY_KEY/);
  assert.match(liveStatus(env({ AZURE_SEARCH_QUERY_KEY: ' ' })).reason, /missing AZURE_SEARCH_QUERY_KEY/);
  assert.equal(liveStatus(env({ AZURE_SEARCH_ENDPOINT: 'https://other.search.windows.net' }), 'foundry-iq-demos').code, 'live_not_configured');
  assert.equal(liveStatus(env({ AZURE_SEARCH_ENDPOINT: 'http://foundry-iq-demos.search.windows.net' })).ready, false);
  const invalid = liveStatus(env({ AZURE_SEARCH_QUERY_KEY: 'bad key!' }));
  assert.equal(invalid.ready, false);
  assert.ok(!invalid.reason.includes('bad key!'));
  assert.equal(liveStatus(env(), 'foundry-iq-demos').ready, true);
});

test('scenario catalog gates S07 without Standard retrieval and S11 without a Search image vectorizer', async () => {
  const { app } = harness();
  const ready = await (await app.handle('scenarios', new Request(`${ORIGIN}/api/scenarios`), env())).json();
  const byId = Object.fromEntries(ready.scenarios.map(item => [item.id, item]));
  assert.equal(ready.defaultMode, 'live');
  assert.equal(byId.S01.liveAvailable, true);
  assert.equal(byId.S02.liveAvailable, true);
  assert.equal(byId.S07.liveAvailable, false);
  assert.match(byId.S07.live.reason, /Standard Knowledge Retrieval/);
  assert.equal(byId.S11.liveAvailable, false);
  assert.match(byId.S11.live.reason, /image-embedding encoder/);
  assert.equal(LIVE_SCENARIOS.length, 11);
  assert.ok(!JSON.stringify(ready).includes(KEY));
  const paused = await (await app.handle('scenarios', new Request(`${ORIGIN}/api/scenarios`), env({ LIVE_ENABLED: undefined }))).json();
  assert.equal(paused.defaultMode, 'sample');
  assert.ok(paused.scenarios.every(item => !item.liveAvailable && /LIVE_ENABLED/.test(item.live.reason)));
  const french = await (await app.handle('scenarios', new Request(`${ORIGIN}/api/scenarios?language=fr`), env())).json();
  assert.ok(french.scenarios.every(item => !item.liveAvailable));
  const health = await (await app.handle('health', new Request(`${ORIGIN}/healthz`), env({ AZURE_SEARCH_QUERY_KEY: undefined }))).json();
  assert.equal(health.live, 'live_not_configured');
});

test('live run sends only docs/search POSTs with the query key and integrated text vectors', async () => {
  const { app, calls, logs } = harness();
  const response = await app.handle('run', post('run', liveBody()), env());
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.executionStatus, 'success');
  assert.equal(calls.length, 2);
  for (const { url, init } of calls) {
    assert.equal(init.method, 'POST');
    assert.equal(url, `${ENDPOINT}/indexes/zava-studio-products/docs/search?api-version=${SEARCH_API_VERSION}`);
    assert.equal(init.headers['api-key'], KEY);
    assert.equal(init.headers.Authorization, undefined);
  }
  const vectorRequest = calls.map(call => JSON.parse(call.init.body)).find(body => body.vectorQueries);
  assert.equal(vectorRequest.vectorQueries[0].kind, 'text');
  assert.equal(vectorRequest.vectorQueries[0].vector, undefined);
  assert.deepEqual(result.enhanced.citations, [{ id: 'DRILL-1001', sourceId: 'DRILL-1001', url: '/samples/zava-catalog.csv' }]);
  assert.equal(result.enhanced.hits[0].sourceId, 'DRILL-1001');
  assert.equal(result.enhanced.trace.requestId, 'svc-request-1');
  assert.equal(result.enhanced.trace.configuration.queryEmbedding.integrated, true);
  assert.match(result.enhanced.trace.steps.join(' '), /bundled private attestation/);
  const text = JSON.stringify(result);
  assert.ok(!text.includes(KEY));
  assert.ok(!JSON.stringify(logs).includes(KEY) && !JSON.stringify(logs).includes('brick'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
});

test('preparation uses attested metadata only and never contacts Azure', async () => {
  const { app, calls } = harness();
  const plan = await (await app.handle('prepare', post('prepare', liveBody()), env())).json();
  assert.equal(plan.ready, true);
  assert.equal(calls.length, 0);
  const drifted = harness({ etag: '"changed"' });
  const result = await (await drifted.app.handle('run', post('run', liveBody()), env())).json();
  assert.equal(result.executionStatus, 'error');
  assert.equal(result.baseline.error.code, 'studio_schema_unverified');
  assert.equal(drifted.calls.length, 0);
  const keyed = productsSchema();
  keyed.vectorSearch.vectorizers[0].azureOpenAIParameters.apiKey = 'embedded';
  const withKey = harness({ schema: keyed });
  assert.equal((await (await withKey.app.handle('run', post('run', liveBody()), env())).json()).baseline.error.code, 'studio_schema_unverified');
  assert.equal(withKey.calls.length, 0);
});

test('gated scenarios, kill switch and missing variables reject Live without any upstream call', async () => {
  const { app, calls } = harness();
  for (const [body, variables, code] of [
    [liveBody('S07', { query: 'My drill battery stopped charging after 45 days. Can I return it?' }), env(), 'studio_live_unavailable'],
    [liveBody('S11', { query: 'blue cotton bucket hat' }), env(), 'studio_live_unavailable'],
    [liveBody(), env({ LIVE_ENABLED: 'false' }), 'live_disabled'],
    [liveBody(), env({ AZURE_SEARCH_QUERY_KEY: '' }), 'live_not_configured'],
  ]) {
    for (const route of ['prepare', 'run']) {
      const response = await app.handle(route, post(route, body), variables);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).errorCode, code);
    }
  }
  assert.equal(calls.length, 0);
  const sample = await (await app.handle('run', post('run', { scenarioId: 'S07', mode: 'sample', query: 'My drill battery stopped charging after 45 days. Can I return it?' }), env())).json();
  assert.equal(sample.mode, 'sample');
  assert.equal(calls.length, 0);
});

test('request, question and top-K bounds plus origin and media checks hold before Azure', async () => {
  const { app, calls } = harness();
  const status = async (request, route = 'run') => (await app.handle(route, request, env())).status;
  assert.equal(await status(post('run', liveBody('S02', { topK: 7 }))), 400);
  assert.equal(await status(post('run', liveBody('S02', { query: 'x'.repeat(8001) }))), 400);
  assert.equal(await status(post('run', liveBody('S02', { query: 'x'.repeat(70000) }))), 413);
  assert.equal(await status(post('run', liveBody(), { origin: 'https://evil.example' })), 403);
  assert.equal(await status(post('run', liveBody(), { 'content-type': 'text/plain' })), 415);
  assert.equal(await status(post('run', '{bad json')), 400);
  assert.equal(await status(new Request(`${ORIGIN}/api/demo/run`), 'run'), 405);
  assert.equal(await status(post('run', liveBody(), {}), 'download'), 404);
  assert.equal(calls.length, 0);
});

test('per-call timeout fails each arm once without retries or fallback', async () => {
  const { app, calls } = harness({ limits: { perCallMs: 30 },
    handler: (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })) });
  const result = await (await app.handle('run', post('run', liveBody()), env())).json();
  assert.equal(result.executionStatus, 'error');
  assert.equal(result.baseline.error.code, 'studio_upstream_timeout');
  assert.equal(result.enhanced.error.code, 'studio_upstream_timeout');
  assert.deepEqual(result.enhanced.hits, []);
  assert.equal(calls.length, 2);
});

test('per-instance live concurrency cap returns 503 with Retry-After', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { app } = harness({ limits: { maxInFlight: 1 }, handler: async () => { await gate; return searchResponse(); } });
  const first = app.handle('run', post('run', liveBody()), env());
  await new Promise(resolve => setTimeout(resolve, 20));
  const busy = await app.handle('run', post('run', liveBody()), env());
  assert.equal(busy.status, 503);
  assert.equal(busy.headers.get('retry-after'), '5');
  release();
  assert.equal((await first).status, 200);
  assert.equal((await app.handle('run', post('run', liveBody()), env())).status, 200);
});

test('Search-only fetch guard, attempt budget and attestation lookup reject everything else', async () => {
  const seen = [];
  const guarded = searchOnlyFetch(async url => { seen.push(url); return searchResponse(); }, ENDPOINT, ['zava-studio-products'], 1000);
  const init = { method: 'POST', body: '{}' };
  await guarded(`${ENDPOINT}/indexes/zava-studio-products/docs/search?api-version=${SEARCH_API_VERSION}`, init);
  for (const [url, options] of [
    ['https://embed-account.openai.azure.com/openai/deployments/embed/embeddings?api-version=2024-10-21', init],
    [`${ENDPOINT}/indexes/zava-studio-products?api-version=${SEARCH_API_VERSION}`, { method: 'GET' }],
    [`${ENDPOINT}/indexes/zava-studio-products/docs/search?api-version=2026-11-01-preview`, init],
    [`${ENDPOINT}/knowledgebases('kb')/retrieve?api-version=2026-08-01-preview`, init],
    [`${ENDPOINT}/indexes/other-index/docs/search?api-version=${SEARCH_API_VERSION}`, init],
  ]) assert.throws(() => guarded(url, options), error => error.code === 'studio_capability_unavailable');
  assert.equal(seen.length, 1);
  const budget = attemptBudget(2);
  budget.reserveAttempt(); budget.reserveAttempt();
  assert.throws(() => budget.reserveAttempt(), error => error.code === 'studio_attempt_budget');
  const metadata = attestedMetadata(attestations());
  assert.equal(metadata(`/indexes/zava-studio-products?api-version=${SEARCH_API_VERSION}`).etag, '"e1"');
  assert.throws(() => metadata(`/indexes/unknown?api-version=${SEARCH_API_VERSION}`), error => error.code === 'studio_schema_unverified');
});

test('build transform pins Search vectorizer bindings to attested ETags and rejects unexplained drift', () => {
  const bindings = { datasetVersion: 'zava-studio-2026-01', resourceVersion: 'v1', scenarios: {
    S02: { index: 'zava-studio-products', indexETag: '"old"', attestation, vector: { ...vector, provider: 'serverAzureOpenAI', vectorizer: 'server-entra-text' } },
    S05: { index: 'zava-studio-support', indexETag: '"s1"', attestation },
    S09: { index: 'zava-studio-support', indexETag: '"s1"', projectionIndex: 'zava-studio-topics', projectionIndexETag: '"t1"', attestation },
  }, languages: {} };
  const full = { service: 'foundry-iq-demos', apiVersion: SEARCH_API_VERSION, capture: { vectorizerUpdate: { changedIndexes: ['zava-studio-products'] } },
    entries: [{ index: 'zava-studio-products', etag: '"new"', schema: {} }, { index: 'zava-studio-support', etag: '"s1"', schema: {} },
      { index: 'zava-studio-topics', etag: '"t1"', schema: {} }, { index: 'zava-studio-unused', etag: '"u"', schema: {}, usages: [] },
      { index: 'fiq-content', etag: '"c1"', schema: {} }, { index: 'fiq-topics', etag: '"tp1"', schema: {} }] };
  assert.throws(() => transformBindings(bindings, full), /STUDIO_PRIVATE_GRAPH/);
  const graph = { dataset: 'zava-retail-en', language: 'en', apiVersion: '2026-11-01-preview', contentIndex: 'fiq-content', graphIndex: 'fiq-graph',
    topicIndex: 'fiq-topics', semanticConfiguration: 'fiq-semantic', vectorField: 'snippet_vector', timeoutMs: 10000, checkedAt: '2026-11-25' };
  const { config, used } = transformBindings(bindings, full, graph);
  // The old custom topic projection is replaced by the native topic-graph binding, pinned to attested ETags.
  assert.deepEqual(config.scenarios.S09, { index: 'fiq-content', indexETag: '"c1"', attestation: { checkedAt: '2026-11-25', region: 'westcentralus', evidenceVersion: 'foundry-iq-graph-v1' },
    nativeGraph: { dataset: 'zava-retail-en', language: 'en', apiVersion: '2026-11-01-preview', vectorField: 'snippet_vector', timeoutMs: 10000, topicIndex: 'fiq-topics', topicIndexETag: '"tp1"' } });
  assert.ok(!used.has('zava-studio-topics'));
  assert.equal(config.scenarios.S02.indexETag, '"new"');
  assert.equal(config.scenarios.S02.vector.provider, undefined);
  assert.equal(config.scenarios.S02.vector.vectorizer, 'zava-text-vectorizer');
  assert.equal(bindings.scenarios.S02.vector.provider, 'serverAzureOpenAI');
  assert.deepEqual(reduceAttestations(full, used).entries.map(entry => entry.index), ['zava-studio-products', 'zava-studio-support', 'fiq-content', 'fiq-topics']);
  full.entries[1].etag = '"drifted"';
  assert.throws(() => transformBindings(bindings, full, graph), /Unexpected ETag drift/);
  assert.throws(() => transformBindings({ ...bindings, scenarios: { S08: {} } }, full, graph), /No schema attestation for bound index fiq-graph/);
});

const imageSchema = () => ({ name: 'zava-studio-images-vision', fields: [
  { name: 'id', type: 'Edm.String', key: true, filterable: true }, ...['title', 'content'].map(name => ({ name, type: 'Edm.String', searchable: true })),
  { name: 'url', type: 'Edm.String' }, { name: 'scope', type: 'Edm.String', filterable: true }, { name: 'thumbnailUrl', type: 'Edm.String' },
  ...['imageModel', 'imageModelVersion', 'imageManifestHash'].map(name => ({ name, type: 'Edm.String', filterable: true })),
  { name: 'imageDimensions', type: 'Edm.Int32', filterable: true },
  { name: 'imageVector', type: 'Collection(Edm.Single)', searchable: true, dimensions: 1024, vectorSearchProfile: 'zava-image-profile' },
], vectorSearch: { profiles: [{ name: 'zava-image-profile', algorithm: 'hnsw', vectorizer: 'zava-image-vectorizer' }], algorithms: [{ name: 'hnsw', kind: 'hnsw' }],
  vectorizers: [{ name: 'zava-image-vectorizer', kind: 'aiServicesVision', aiServicesVisionParameters: {
    resourceUri: 'https://vision-test.cognitiveservices.azure.com', modelVersion: '2023-04-15', authIdentity: null } }] } });
const searchVersion = url => new URL(url).searchParams.get('api-version');
const json = (body, requestId = 'svc-request-2') => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'request-id': requestId } });

test('S07 runs evidence-only native agentic retrieval on the preview API with safe diagnostics', async () => {
  const config = structuredClone(liveConfig);
  config.scenarios.S07.agentic = { apiVersion: AGENTIC_SEARCH_API_VERSION, maxRuntimeInSeconds: 10, knowledgeRetrievalPlan: 'standard' };
  delete config.scenarios.S07.answer;
  const support = { ...productsSchema(), name: 'zava-studio-support' };
  const doc = id => ({ id, title: id, content: 'Return policy evidence.', url: '/samples/zava-support.md', scope: 'public', '@search.score': 1 });
  const { app, calls } = harness({ config, extra: [{ index: 'zava-studio-support', etag: '"e2"', schema: support }],
    handler: async (url, init) => JSON.parse(init.body).queryType === 'agentic'
      ? json({ value: [doc('POL-RET-2026-01'), doc('WAR-BAT-2026-01')], '@search.debug': { agentic: { terminationReason: 'modelStopped',
        subQueries: [{ iteration: 1, search: 'battery   return policy after 45 days' }, { iteration: 2, search: `warranty ${'x'.repeat(300)}` },
          ...Array.from({ length: 11 }, (_, i) => ({ iteration: 2, search: `extra ${i}` }))], usage: { agenticPlanningTokens: 12, reasoningTokens: 8 } } } }, 'agentic-request')
      : json({ value: [doc('CASE-001')] }) });
  const result = await (await app.handle('run', post('run', liveBody('S07', { query: 'My drill battery stopped charging after 45 days. Can I return it?' })), env())).json();
  assert.equal(result.executionStatus, 'success');
  assert.equal(calls.length, 2);
  const agentic = calls.find(call => JSON.parse(call.init.body).queryType === 'agentic');
  assert.equal(searchVersion(agentic.url), AGENTIC_SEARCH_API_VERSION);
  assert.equal(JSON.parse(agentic.init.body).agenticOptions.maxRuntimeInSeconds, 10);
  assert.equal(searchVersion(calls.find(call => call !== agentic).url), SEARCH_API_VERSION);
  assert.deepEqual(result.enhanced.citations.map(c => c.id), ['POL-RET-2026-01', 'WAR-BAT-2026-01']);
  assert.equal(result.enhanced.trace.configuration.agenticSearch.terminationReason, 'modelStopped');
  // Sub-queries are the model's follow-up searches: shown with their turn, whitespace-normalized and bounded.
  const agenticTrace = result.enhanced.trace.configuration.agenticSearch;
  assert.equal(agenticTrace.subQueryCount, 13);
  assert.equal(agenticTrace.subQueries.length, 10);
  assert.deepEqual(agenticTrace.subQueries[0], { iteration: 1, search: 'battery return policy after 45 days' });
  assert.equal(agenticTrace.subQueries[1].iteration, 2);
  assert.ok(agenticTrace.subQueries[1].search.length <= 201 && agenticTrace.subQueries[1].search.endsWith('…'));
  const loggedQueries = result.enhanced.apiLog[0].response.body['@search.debug'].agentic.subQueries;
  assert.equal(loggedQueries[0].search, 'battery   return policy after 45 days');
  assert.equal(loggedQueries.length, 13);
  assert.match(result.comparison.intendedDifference, /Evidence only/);
  assert.equal(result.enhanced.answer, undefined);
});

test('S11 sends imageBinary or text-to-image vector queries through the Search vectorizer only', async () => {
  const config = structuredClone(liveConfig);
  config.scenarios.S11.image.vectorizer = 'zava-image-vectorizer';
  const hat = { id: 'HAT-001', title: 'Blue hat', content: 'Blue cotton bucket hat', url: '/samples/zava-hat-blue.svg', scope: 'public',
    thumbnailUrl: '/samples/zava-hat-blue.png', imageModel: 'azure-vision-multimodal', imageModelVersion: '2023-04-15', imageDimensions: 1024,
    imageManifestHash: 'a'.repeat(64), '@search.score': 0.9 };
  const { app, calls } = harness({ config, extra: [{ index: 'zava-studio-images-vision', etag: '"e3"', schema: imageSchema() }], handler: async () => json({ value: [hat] }) });
  const png = illustrationPng(0).toString('base64');
  const withImage = await (await app.handle('run', post('run', liveBody('S11', { query: 'Image-only reference search', imageInput: { mimeType: 'image/png', base64: png } })), env())).json();
  assert.equal(withImage.executionStatus, 'success');
  const vectorCall = calls.find(call => JSON.parse(call.init.body).vectorQueries);
  assert.equal(searchVersion(vectorCall.url), AGENTIC_SEARCH_API_VERSION);
  assert.deepEqual(Object.keys(JSON.parse(vectorCall.init.body).vectorQueries[0]).sort(), ['base64Image', 'exhaustive', 'fields', 'k', 'kind']);
  assert.equal(JSON.parse(vectorCall.init.body).vectorQueries[0].kind, 'imageBinary');
  assert.equal(JSON.parse(vectorCall.init.body).vectorQueries[0].base64Image, png);
  assert.ok(!JSON.stringify(withImage).includes(png));
  assert.ok(calls.every(call => new URL(call.url).origin === ENDPOINT));
  calls.length = 0;
  const textOnly = await (await app.handle('run', post('run', liveBody('S11', { query: 'blue cotton bucket hat' })), env())).json();
  assert.equal(textOnly.executionStatus, 'success');
  assert.deepEqual(JSON.parse(calls.find(call => JSON.parse(call.init.body).vectorQueries).init.body).vectorQueries[0],
    { kind: 'text', text: 'blue cotton bucket hat', fields: 'imageVector', k: 10, exhaustive: true });
  const keyed = imageSchema();
  keyed.vectorSearch.vectorizers[0].aiServicesVisionParameters.apiKey = 'embedded';
  const rejected = harness({ config, extra: [{ index: 'zava-studio-images-vision', etag: '"e3"', schema: keyed }] });
  assert.equal((await (await rejected.app.handle('run', post('run', liveBody('S11', { query: 'blue hat' })), env())).json()).enhanced.error.code, 'studio_schema_unverified');
  assert.equal(rejected.calls.length, 0);
});

test('LIVE_DISABLED_SCENARIOS pauses chosen scenarios and invalid values fail closed', async () => {
  assert.deepEqual([...disabledScenarios(' s07, S11 ').set], ['S07', 'S11']);
  assert.equal(disabledScenarios('S99').ok, false);
  const { app, calls } = harness();
  const catalog = await (await app.handle('scenarios', new Request(`${ORIGIN}/api/scenarios`), env({ LIVE_DISABLED_SCENARIOS: 'S02' }))).json();
  const byId = Object.fromEntries(catalog.scenarios.map(item => [item.id, item]));
  assert.equal(byId.S01.liveAvailable, true);
  assert.equal(byId.S02.liveAvailable, false);
  assert.match(byId.S02.live.reason, /LIVE_DISABLED_SCENARIOS/);
  const paused = await app.handle('run', post('run', liveBody('S02')), env({ LIVE_DISABLED_SCENARIOS: 'S02' }));
  assert.equal(paused.status, 503);
  assert.equal((await paused.json()).errorCode, 'studio_live_unavailable');
  const invalid = await app.handle('run', post('run', liveBody('S01', { query: 'DCD796' })), env({ LIVE_DISABLED_SCENARIOS: 'S1' }));
  assert.equal(invalid.status, 503);
  assert.equal((await invalid.json()).errorCode, 'live_not_configured');
  assert.equal(calls.length, 0);
});

test('preview Search API is allowed only for preview-bound indexes', () => {
  const guarded = searchOnlyFetch(async () => searchResponse(), ENDPOINT, ['zava-studio-products', 'zava-studio-support'], 1000, ['zava-studio-support']);
  const init = { method: 'POST', body: '{}' };
  assert.doesNotThrow(() => guarded(`${ENDPOINT}/indexes/zava-studio-support/docs/search?api-version=${AGENTIC_SEARCH_API_VERSION}`, init));
  assert.throws(() => guarded(`${ENDPOINT}/indexes/zava-studio-products/docs/search?api-version=${AGENTIC_SEARCH_API_VERSION}`, init),
    error => error.code === 'studio_capability_unavailable');
  assert.throws(() => guarded(`${ENDPOINT}/indexes/zava-studio-support/docs/search?api-version=${SEARCH_API_VERSION}&x=1`, init),
    error => error.code === 'studio_capability_unavailable');
});

test('recorded Sample replays curated non-English examples without Azure and never for free text', async () => {
  const arm = side => ({ status: 'success', kind: side, hits: Array.from({ length: 10 }, (_, i) => ({ id: `DOC-${i}`, sourceId: `DOC-${i}`, rank: i + 1 })),
    citations: Array.from({ length: 10 }, (_, i) => ({ id: `DOC-${i}`, sourceId: `DOC-${i}`, url: '/samples/zava-catalog-fr.csv' })), trace: { steps: ['Live step'] } });
  const recorded = { recordedAt: '2026-11-24', entries: { 'fr|S02|Un outil léger': { language: 'fr', scenarioId: 'S02', query: 'Un outil léger', topK: 10,
    result: { mode: 'live', scenarioId: 'S02', query: 'Un outil léger', executionStatus: 'success', baseline: arm('lexical'), enhanced: arm('vector'), comparison: {} } } } };
  const calls = [];
  const app = createVercelApp({ liveConfig, attestations: attestations(), recorded, log: () => {}, fetchUpstream: async (...args) => { calls.push(args); return searchResponse(); } });
  const catalog = await (await app.handle('scenarios', new Request(`${ORIGIN}/api/scenarios?language=fr`), env())).json();
  const s02 = catalog.scenarios.find(item => item.id === 'S02');
  assert.equal(s02.sample.available, true);
  assert.deepEqual(s02.sample.curatedQueries, ['Un outil léger']);
  assert.match(s02.sample.label, /Recorded Sample.*2026-11-24/);
  const body = { scenarioId: 'S02', mode: 'sample', language: 'fr', query: ' Un outil léger ' };
  const replay = await (await app.handle('run', post('run', { ...body, topK: 5 }), env())).json();
  assert.equal(replay.mode, 'sample');
  assert.equal(replay.recorded.recordedAt, '2026-11-24');
  assert.equal(replay.enhanced.hits.length, 5);
  assert.equal(replay.enhanced.citations.length, 5);
  assert.match(replay.enhanced.trace.steps[0], /Recorded Live response from 2026-11-24/);
  for (const [patch, code] of [[{ query: 'texte libre' }, 'recorded_sample_unavailable'], [{ topK: 20 }, 'recorded_sample_topk'],
    [{ options: { boostSubtype: 'freshness' } }, 'recorded_sample_options'], [{ imageInput: { mimeType: 'image/png', base64: 'AAAA' } }, 'recorded_sample_invalid']]) {
    const response = await app.handle('run', post('run', { ...body, ...patch }), env());
    assert.equal(response.status, 400);
    assert.equal((await response.json()).errorCode, code);
  }
  const paused = await (await app.handle('run', post('run', body), env({ LIVE_ENABLED: 'false' }))).json();
  assert.equal(paused.recorded.recordedAt, '2026-11-24');
  assert.equal(calls.length, 0);
});

test('responses redact keys, the Search hostname and server paths while keeping index provenance', async () => {
  const leaky = `key ${KEY} host foundry-iq-demos.search.windows.net path C:\\Users\\op\\private\\studio-live-config.json task /var/task/server/private-data.mjs`;
  const { app } = harness({ handler: async () => new Response(JSON.stringify({ '@odata.count': 1, value: [{ id: 'DRILL-1001', title: 'Compact hammer drill',
    content: leaky, url: 'https://user:pw@foundry-iq-demos.search.windows.net/x?api-key=abc', scope: 'public', '@search.score': 2.5 }] }),
  { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'svc-request-1' } }) });
  const response = await app.handle('run', post('run', liveBody()), env());
  const text = await response.text();
  assert.equal(response.status, 200);
  for (const forbidden of [KEY, 'foundry-iq-demos.search.windows.net', 'user:pw', 'api-key=abc', 'C:\\\\Users', '/var/task', 'private-data.mjs', 'studio-live-config.json']) {
    assert.ok(!text.includes(forbidden), `response must not include ${forbidden}`);
  }
  assert.match(text, /zava-studio-products/);
  assert.match(text, /\[internal path removed\]/);
});

test('Search throttling reaches the arm with a bounded Retry-After and is never retried', async () => {
  assert.deepEqual(['7', '600', '0', null, 'Wed, 21 Oct 2015 07:28:00 GMT'].map(retryAfterSeconds), [7, 60, 1, 10, 10]);
  const { app, calls } = harness({ handler: async () => new Response('{}', { status: 429, headers: { 'retry-after': '7' } }) });
  const result = await (await app.handle('run', post('run', liveBody()), env())).json();
  assert.ok(calls.length <= 2);
  for (const side of ['baseline', 'enhanced']) {
    assert.equal(result[side].error.code, 'studio_upstream_throttled');
    assert.equal(result[side].error.retryAfter, 7);
  }
});

test('S10 labels the flattened-text limitation as a note, not a grounded answer', async () => {
  const { app, calls } = harness();
  const result = await (await app.handle('run', post('run', { scenarioId: 'S10', mode: 'sample',
    query: 'What is the maximum concrete drilling diameter of model DCD796?' }), env())).json();
  assert.equal(calls.length, 0);
  assert.equal(result.baseline.answerKind, 'note');
  assert.match(result.baseline.answer, /row association/);
  assert.equal(result.enhanced.answerKind, undefined);
  assert.match(result.enhanced.answer, /DCD796/);
});

// Wording from earlier builds (local fixtures, gated S07/S11, App Service and Blob ledger) that no longer matches the
// shipped behavior. Negated mentions such as "no generated answers" remain accurate and are allowed.
const STALE_COPY = [
  [/\bNOT\b/, 'all-caps NOT'],
  [/\bKB\b/, 'KB jargon'],
  [/\bAzure CU\b|\bCU (?:Read|Layout)\b/, 'Content Understanding abbreviation'],
  [/\bfixtures?\b/i, 'fixture wording'],
  [/arbitrary image understanding|fixed original illustrat|illustrative/i, 'fixed-illustration Sample claim'],
  [/explicitly unsupported|unsupported until|uploads are unsupported/i, 'stale upload claim'],
  [/compatible (?:corpus|query|image)? ?encoder|until [^.]*configured|\bnot configured\b/i, 'encoder-not-configured claim'],
  [/App Service|ledger|\bBlob\b|managed identity|\bquota\b/i, 'retired App Service architecture'],
  [/Standard Knowledge Retrieval (?:is )?required|requires (?:paid )?Standard/i, 'S07 gated claim'],
  [/remains blocked|readiness (?:guarantee|evidence)|not been verified/i, 'blocked or unverified claim'],
  [/\bcanonical\b|\bdurable\b/i, 'developer wording'],
  [/(?<!\bno |neither arm )generat(?:ed|es) (?:an )?answers?/i, 'generated-answer claim'],
];
const staleIn = text => STALE_COPY.filter(([pattern]) => pattern.test(text)).map(([, name]) => name);

test('catalog copy in every language describes shipped behavior in both modes, not earlier builds', async () => {
  const languages = ['en', 'fr', 'es', 'ja', 'de'];
  const ids = Array.from({ length: 11 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`);
  const entries = Object.fromEntries(languages.flatMap(language => ids.map(id => [`${language}|${id}|q`,
    { language, scenarioId: id, query: 'q', topK: 10, result: {} }])));
  const app = createVercelApp({ liveConfig, attestations: attestations(), recorded: { recordedAt: '2026-11-25', entries }, log: () => {},
    fetchUpstream: async () => { throw new Error('The catalog must not contact Azure.'); } });
  for (const language of languages) {
    const { scenarios } = await (await app.handle('scenarios', new Request(`${ORIGIN}/api/scenarios?language=${language}`), env())).json();
    assert.equal(scenarios.length, 11);
    for (const item of scenarios) {
      assert.equal(item.description, item.liveDescription, `${language} ${item.id}: recorded Sample replays Live, so both modes share one description`);
      assert.equal(typeof item.limits, 'string');
      const shown = [item.title, item.description, item.difference, item.liveDescription, item.limits, item.sample.label,
        ...(item.sampleImages || []).map(image => image.label), ...(item.demoPresets || []).map(preset => preset.label),
        ...(item.liveAvailable ? [item.live.reason] : [])];
      for (const copy of shown) assert.deepEqual(staleIn(copy), [], `${language} ${item.id}: ${copy}`);
    }
    const s11 = scenarios.find(item => item.id === 'S11');
    assert.match(s11.description, /image/);
    assert.ok(!/fixed|only the bundled/i.test(s11.limits), s11.limits);
  }
});

test('recorded Sample narration, client and pages carry no stale claims', () => {
  const recordedFile = JSON.parse(readFileSync(new URL('../config/studio-recorded.json', import.meta.url), 'utf8'));
  for (const entry of Object.values(recordedFile.entries)) {
    const narration = [entry.result.comparison?.intendedDifference,
      ...['baseline', 'enhanced'].flatMap(side => [entry.result[side]?.label, ...(entry.result[side]?.trace?.steps || [])])].filter(Boolean);
    for (const copy of narration) assert.deepEqual(staleIn(copy), [], `${entry.language} ${entry.scenarioId}: ${copy}`);
  }
  for (const file of ['assets/client.mjs', 'assets/header.mjs', 'page.html', 'about.html', '404.html']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.deepEqual(staleIn(source), [], file);
  }
  const client = readFileSync(new URL('../assets/client.mjs', import.meta.url), 'utf8');
  assert.match(client, /Switch to Live data to search with your own PNG, JPEG or WebP image \(up to 40 KiB\)/);
  assert.doesNotMatch(client, /liveDescriptions\s*=/, 'descriptions come from the server catalog only');
});

test('API log records every upstream call per arm with the host placeholder, bounded bodies and no credentials', async () => {
  const doc = { id: 'DRILL-1001', title: 'Compact hammer drill', content: 'x'.repeat(2000), url: '/samples/zava-catalog.csv', scope: 'public',
    category: 'drill', price: 129, contentVector: Array.from({ length: 12 }, (_, i) => i / 10), '@search.score': 2.5, '@search.rerankerScore': 3.1 };
  const { app } = harness({ handler: async () => new Response(JSON.stringify({ '@odata.context': `${ENDPOINT}/indexes('zava-studio-products')/$metadata#docs(*)`, value: [doc] }),
    { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'svc-request-1', 'elapsed-time': '12', 'x-internal': 'internal-header-value' } }) });
  const result = await (await app.handle('run', post('run', liveBody()), env())).json();
  for (const side of ['baseline', 'enhanced']) {
    const [call, ...rest] = result[side].apiLog;
    assert.equal(rest.length, 0);
    assert.equal(call.method, 'POST');
    assert.equal(call.url, `https://<your-search-service>.search.windows.net/indexes/zava-studio-products/docs/search?api-version=${SEARCH_API_VERSION}`);
    assert.equal(call.request.body.search ?? call.request.body.vectorQueries[0].text, 'A lightweight tool for making holes in brick walls');
    assert.equal(call.response.status, 200);
    assert.ok(Number.isInteger(call.response.latencyMs));
    assert.deepEqual(call.response.headers, { 'request-id': 'svc-request-1', 'elapsed-time': '12', 'content-type': 'application/json' });
    assert.match(call.response.body.value[0].content, /… \[2000 characters\]$/);
    assert.equal(call.response.body.value[0].contentVector, '[vector omitted: 12 numbers]');
    assert.match(call.response.body['@odata.context'], /^https:\/\/<your-search-service>\.search\.windows\.net\/indexes/);
  }
  const hit = result.enhanced.hits[0];
  assert.equal(hit.document.category, 'drill');
  assert.equal(hit.document.contentVector, undefined);
  assert.equal(hit.search.rerankerScore, 3.1);
  const logs = JSON.stringify([result.baseline.apiLog, result.enhanced.apiLog]);
  for (const forbidden of [KEY, 'foundry-iq-demos', 'api-key', 'internal-header-value']) assert.ok(!logs.includes(forbidden), forbidden);
  assert.ok(!JSON.stringify(result).includes(KEY));

  const config = structuredClone(liveConfig);
  config.scenarios.S11.image.vectorizer = 'zava-image-vectorizer';
  const hat = { id: 'HAT-001', title: 'Blue hat', content: 'Blue cotton bucket hat', url: '/samples/zava-hat-blue.svg', scope: 'public',
    thumbnailUrl: '/samples/zava-hat-blue.png', imageModel: 'azure-vision-multimodal', imageModelVersion: '2023-04-15', imageDimensions: 1024,
    imageManifestHash: 'a'.repeat(64), '@search.score': 0.9 };
  const image = harness({ config, extra: [{ index: 'zava-studio-images-vision', etag: '"e3"', schema: imageSchema() }],
    handler: async () => json({ value: [hat] }) });
  const png = illustrationPng(0);
  const withImage = await (await image.app.handle('run', post('run', liveBody('S11', { query: 'Image-only reference search',
    imageInput: { mimeType: 'image/png', base64: png.toString('base64') } })), env())).json();
  const vectorQuery = withImage.enhanced.apiLog[0].request.body.vectorQueries[0];
  assert.equal(vectorQuery.kind, 'imageBinary');
  assert.equal(vectorQuery.base64Image, `[image bytes omitted: ${png.length} bytes]`);
});

test('visible copy says Foundry IQ; Azure product names appear only in title, meta and the first About mention', async () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const app = createVercelApp({ liveConfig, attestations: attestations(), log: () => {} });
  // Visible catalog copy: titles, descriptions, limits, Sample labels, examples, notes and Live reasons (all languages).
  const visible = scenario => [scenario.title, scenario.description, scenario.liveDescription, scenario.difference, scenario.limits, scenario.sample?.label,
    scenario.live?.reason, ...(scenario.demoPresets || []).flatMap(preset => [preset.label, preset.hint, preset.note]), ...(scenario.sampleImages || []).map(image => image.label)];
  for (const language of ['en', 'fr', 'es', 'ja', 'de']) {
    const catalog = await (await app.handle('scenarios', new Request(`${ORIGIN}/api/scenarios?language=${language}`), env())).json();
    assert.ok(!JSON.stringify(catalog).includes('Azure AI Search'), language);
    for (const scenario of catalog.scenarios) for (const copy of visible(scenario)) assert.doesNotMatch(String(copy ?? ''), /\bAzure\b/, `${language} ${scenario.id}: ${copy}`);
  }
  const { app: industryApp } = industryHarness({ enabled: industryCatalog.industries.map(item => item.id) });
  for (const item of industryCatalog.industries) {
    const catalog = await (await industryApp.handle('scenarios', new Request(`${ORIGIN}/api/scenarios?industry=${item.id}`), env())).json();
    for (const scenario of catalog.scenarios) for (const copy of visible(scenario)) assert.doesNotMatch(String(copy ?? ''), /\bAzure\b/, `${item.id} ${scenario.id}: ${copy}`);
    assert.doesNotMatch(`${item.label} ${item.blurb}`, /\bAzure\b/, item.id);
  }
  // Visible page text: no Azure product names outside the head, except About’s first mention.
  const text = html => html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<[^>]+>/g, ' ');
  for (const file of ['page.html', '404.html']) assert.doesNotMatch(text(read(file)), /\bAzure\b/, file);
  assert.equal(text(read('about.html')).match(/\bAzure\b/g)?.length, 1, 'About names Azure once: Foundry IQ (Azure AI Search)');
  const strings = /(['`])[^'`\n]*\bAzure\b[^'`\n]*\1/;
  for (const file of ['assets/client.mjs', 'assets/header.mjs', 'assets/about.mjs', 'assets/display.mjs']) {
    const code = read(file).split(/\r?\n/).filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
    assert.doesNotMatch(code, strings, file);
  }
  for (const file of ['lib/vercel-app.mjs', 'lib/industry.mjs', 'lib/search-adapter.mjs']) assert.doesNotMatch(read(file), /HttpError\([^)]*\bAzure\b/, `${file}: error messages are shown to visitors`);
  const body = html => html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<[^>]+>/g, ' ');
  for (const file of ['page.html', '404.html']) assert.ok(!body(read(file)).includes('Azure AI Search'), file);
  assert.match(read('page.html').match(/<head>[\s\S]*?<\/head>/)[0], /Foundry IQ \(Azure AI Search\)/);
  const about = body(read('about.html'));
  assert.equal(about.split('Azure AI Search').length - 1, 1, 'About names Azure AI Search once');
  assert.ok(about.includes('Foundry IQ (Azure AI Search)'));
  // Client strings, server messages and score labels (comments excluded).
  const literal = /(['`])[^'`\n]*Azure AI Search[^'`\n]*\1/;
  for (const file of ['assets/client.mjs', 'assets/header.mjs', 'assets/about.mjs', 'lib/studio.mjs', 'lib/vercel-app.mjs', 'lib/search-adapter.mjs', 'lib/industry.mjs', 'config/studio-scenarios.mjs']) {
    const code = read(file).split(/\r?\n/).filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
    assert.doesNotMatch(code, literal, file);
  }
  assert.ok(!read('config/studio-recorded.json').includes('Azure AI Search'), 'recorded narration');
});

// Native Foundry IQ entity graph (S08) and topic graph (S09): Search reads only, GQL from the server-side allowlist.
const graphConfig = JSON.parse(readFileSync(new URL('../config/studio-graph.json', import.meta.url), 'utf8'));
const nativeBinding = { dataset: 'zava-retail-en', language: 'en', apiVersion: AGENTIC_SEARCH_API_VERSION, vectorField: 'snippet_vector', timeoutMs: 10000 };
const nativeConfig = () => {
  const config = structuredClone(liveConfig);
  config.scenarios.S08 = { index: 'fiq-content', indexETag: '"c1"', attestation, nativeGraph: { ...nativeBinding, graphIndex: 'fiq-graph', graphIndexETag: '"g1"', semanticConfiguration: 'fiq-semantic' } };
  config.scenarios.S09 = { index: 'fiq-content', indexETag: '"c1"', attestation, nativeGraph: { ...nativeBinding, topicIndex: 'fiq-topics', topicIndexETag: '"t1"' } };
  config.languages = { fr: { resourceVersion: 'test-fr', scenarios: { S08: structuredClone(config.scenarios.S08) } } };
  return config;
};
const stringField = (name, extra = {}) => ({ name, type: 'Edm.String', retrievable: true, ...extra });
const nativeSchemas = () => [
  { index: 'fiq-content', etag: '"c1"', schema: { name: 'fiq-content', fields: [stringField('uid', { key: true }), stringField('snippet', { searchable: true }),
    { name: 'snippet_vector', type: 'Collection(Edm.Single)', searchable: true, retrievable: true, dimensions: 1536, vectorSearchProfile: 'p' }],
  semantic: { configurations: [{ name: 'fiq-semantic' }] }, vectorSearch: { profiles: [{ name: 'p', algorithm: 'a', vectorizer: 'v' }], algorithms: [],
    vectorizers: [{ name: 'v', kind: 'azureOpenAI', azureOpenAIParameters: { apiKey: null, authIdentity: null } }] } } },
  { index: 'fiq-graph', etag: '"g1"', schema: { name: 'fiq-graph', fields: [stringField('id', { key: true })], graphProfile: { kind: 'edgeList', provenanceIndexName: 'fiq-content' } } },
  { index: 'fiq-topics', etag: '"t1"', schema: { name: 'fiq-topics', fields: [...['subject_id', 'predicate', 'object_id', 'object_string'].map(name => stringField(name, { filterable: true })),
    { name: 'object_double', type: 'Edm.Double', retrievable: true }] } },
];
// Passage IDs are base64 storage URLs in the real service; the API log must show short hashes instead.
const opaque = id => `ce6718ce47b8_aHR0cHM6Ly9leGFtcGxlc3RvcmFnZS5ibG9iLmNvcmUud2luZG93cy5uZXQvemF2YS9${id}_pages_0`;
const passage = (id, title, body, extra = {}) => ({ uid: opaque(id), snippet: `# ${id} — ${title}\n\nSource ID: ${id}\nPublisher: Zava Retail (fictional)\nRecord type: support knowledge\n\n${body}`, ...extra });
const topicRows = () => {
  const rows = [];
  for (const node of graphConfig.topics.hierarchy) {
    if (!node.parent) rows.push({ subject_id: 'topicgraph:topicgraph-topic', predicate: 'HasRootTopic', object_id: node.id, object_string: null, object_double: null });
    for (const child of node.children || []) rows.push({ subject_id: node.id, predicate: 'HasSubTopic', object_id: child, object_string: null, object_double: null });
    rows.push({ subject_id: node.id, predicate: 'prop:title', object_id: '', object_string: node.title, object_double: null });
    rows.push({ subject_id: node.id, predicate: 'prop:proportion', object_id: '', object_string: null, object_double: node.proportion });
  }
  return rows;
};
function nativeHarness({ graphRows, topics = topicRows(), config = nativeConfig() } = {}) {
  return harness({ config, extra: nativeSchemas(), handler: async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.includes('search.graph')) {
      const rows = graphRows ? graphRows(body.gql) : [{ drill: 'DRILL-1001', battery: 'BAT-18V-A', cell: 'CELL-B17', supplier: 'SUP-017', incident: 'INC-2026-017',
        lot: 'LOT-2407-A', policy: 'POL-RECALL-v2', handle: 'gqlref:opaque', '@search.graphProvenance': { kind: 'hydrate', evidenceCount: { value: 2 },
          evidence: [{ edgeId: `${opaque('BOM-2026-01')}_raw_triples_0`, chunkId: opaque('BOM-2026-01'), confidence: { edge: 0 } }, { edgeId: 'e2', chunkId: opaque('INC-2026-017') }] } }];
      return json({ '@odata.count': rows.length, value: rows, '@search.graphStats': { executionMode: 'execute', queryCount: 2, documentsFetched: 7, totalMs: 9 },
        '@search.graphDiagnostics': [{ code: 'Graph.Execution.Summary', severity: 'info', message: `Returned ${rows.length} rows.` }],
        '@search.graphProvenanceDocuments': { [opaque('BOM-2026-01')]: passage('BOM-2026-01', 'Sourced battery bill of materials', 'DRILL-1001 uses BAT-18V-A.'),
          [opaque('INC-2026-017')]: passage('INC-2026-017', 'Battery incident', 'Defect B-17 affects LOT-2407-A.') } }, 'graph-request');
    }
    if (url.includes('fiq-topics')) return json({ value: topics });
    return json({ value: [passage('DRILL-1006', 'Label printer', 'Not a drill.', { '@search.score': 0.03, '@search.rerankerScore': 2.1 }),
      passage('HAT-002', 'Red bucket hat', 'Cotton hat.', { '@search.score': 0.02, '@search.rerankerScore': 1.4 })] });
  } });
}

test('S08 runs allowlisted native graph queries with hydrated, cited paths; plain retrieval is hybrid plus semantic ranker', async () => {
  const preset = graphConfig.s08[0];
  const { app, calls } = nativeHarness();
  const result = await (await app.handle('run', post('run', liveBody('S08', { query: preset.question })), env())).json();
  assert.equal(result.executionStatus, 'success');
  assert.equal(calls.length, 1 + preset.statements.length);
  const before = calls.find(call => call.url.includes('/indexes/fiq-content/docs/search'));
  assert.equal(before.url, `${ENDPOINT}/indexes/fiq-content/docs/search?api-version=${AGENTIC_SEARCH_API_VERSION}`);
  assert.deepEqual(JSON.parse(before.init.body), { search: preset.question, top: 5, select: 'uid,snippet', queryType: 'semantic', semanticConfiguration: 'fiq-semantic',
    vectorQueries: [{ kind: 'text', text: preset.question, fields: 'snippet_vector', k: 50 }] });
  const graph = calls.find(call => call.url.includes('search.graph'));
  assert.equal(graph.url, `${ENDPOINT}/indexes('fiq-graph')/docs/search.graph?api-version=${AGENTIC_SEARCH_API_VERSION}`);
  assert.equal(graph.init.headers['api-key'], KEY);
  assert.deepEqual(JSON.parse(graph.init.body), { gql: preset.statements[0].gql, provenance: { kind: 'hydrate', hydrateDocuments: { select: 'uid,snippet' } },
    includeDiagnostics: true, includeStatistics: true });
  const statement = result.enhanced.graph.statements[0];
  assert.equal(result.enhanced.graph.kind, 'native');
  assert.equal(statement.outcome, 'rows');
  assert.equal(statement.rows[0].values.handle, undefined, 'gqlref handles are never shown');
  assert.deepEqual(statement.rows[0].sources, ['BOM-2026-01', 'INC-2026-017']);
  assert.deepEqual(statement.hops[0], { from: 'drill', relation: 'uses battery', to: 'battery' });
  assert.ok(statement.hops.some(hop => hop.from === 'policy' && hop.relation === 'applies to lot'));
  assert.deepEqual(result.enhanced.hits.map(hit => [hit.id, hit.title, hit.url, hit.citedBy]), [['BOM-2026-01', 'Sourced battery bill of materials', '/samples/zava-support.md', 1],
    ['INC-2026-017', 'Battery incident', '/samples/zava-support.md', 1]]);
  assert.deepEqual(result.baseline.hits.map(hit => [hit.id, hit.score, hit.document.Publisher]), [['DRILL-1006', 2.1, 'Zava Retail (fictional)'], ['HAT-002', 1.4, 'Zava Retail (fictional)']]);
  assert.equal(result.baseline.graph, undefined);
  // The API log shows the executed GQL, with opaque storage-derived IDs shortened to hashes.
  const log = JSON.stringify(result.enhanced.apiLog);
  assert.equal(result.enhanced.apiLog[0].request.body.gql, preset.statements[0].gql);
  assert.ok(log.includes('[id ') && !log.includes('aHR0cHM6Ly9') && !log.includes(KEY) && !log.includes('foundry-iq-demos'));
  assert.ok(!JSON.stringify(result).includes('aHR0cHM6Ly9'));
});

test('S08 proves absence with an expected zero-row statement and runs free text without a graph query', async () => {
  const preset = graphConfig.s08.find(item => item.statements.some(statement => statement.expectRows === 0));
  const absent = preset.statements.find(statement => statement.expectRows === 0);
  const { app, calls } = nativeHarness({ graphRows: gql => gql === absent.gql ? [] : [{ bulletin: 'SUP-BUL-017', unaffectedCell: 'CELL-X10' }] });
  const result = await (await app.handle('run', post('run', liveBody('S08', { query: preset.question })), env())).json();
  assert.equal(calls.length, 1 + preset.statements.length);
  assert.ok(calls.length <= 4, 'within the per-comparison Search budget');
  assert.deepEqual(result.enhanced.graph.statements.map(statement => statement.outcome), preset.statements.map(statement => statement.expectRows === 0 ? 'absence' : 'rows'));
  const free = nativeHarness();
  const freeResult = await (await free.app.handle('run', post('run', liveBody('S08', { query: 'Which drills use CELL-B17?' })), env())).json();
  assert.equal(free.calls.length, 1);
  assert.ok(!free.calls.some(call => call.url.includes('search.graph')));
  assert.equal(freeResult.enhanced.curatedOnly, true);
  assert.match(freeResult.enhanced.answer, /curated questions/);
  assert.deepEqual(freeResult.enhanced.apiLog, []);
  // GQL is never accepted from the browser.
  const injected = await free.app.handle('run', post('run', liveBody('S08', { query: preset.question, gql: 'MATCH (n:`Product`) RETURN n' })), env());
  assert.equal(injected.status, 400);
});

test('S09 compares topic diversification off and on without the semantic ranker and reads the native theme hierarchy', async () => {
  const preset = graphConfig.s09.find(item => item.kind === 'facet-coverage');
  const { app, calls } = nativeHarness();
  const result = await (await app.handle('run', post('run', liveBody('S09', { query: preset.question })), env())).json();
  assert.equal(result.executionStatus, 'success');
  assert.equal(calls.length, 3);
  const bodies = calls.map(call => [call.url, JSON.parse(call.init.body)]);
  const kinds = bodies.filter(([url]) => url.includes('fiq-content')).map(([, body]) => body.vectorQueries[0].topicGraph.kind).sort();
  assert.deepEqual(kinds, ['balanced', 'none']);
  assert.ok(bodies.every(([, body]) => body.queryType === undefined));
  const topic = bodies.find(([url]) => url.includes('fiq-topics'));
  assert.deepEqual(topic[1], { search: '*', top: 1000, filter: "predicate ne 'HasCentroidVector'", select: 'subject_id,predicate,object_id,object_string,object_double' });
  assert.deepEqual(result.enhanced.topics.hierarchy.map(root => [root.title, root.children.length]),
    graphConfig.topics.hierarchy.filter(node => !node.parent).sort((a, b) => a.id.localeCompare(b.id)).map(node => [node.title, node.children.length]));
  assert.equal(result.baseline.topics, undefined);
  for (const side of ['baseline', 'enhanced']) assert.equal(result[side].topicCoverage.total, graphConfig.topics.leaves.length);
  assert.equal(result.enhanced.hits[0].topic.title, graphConfig.topics.leaves.find(leaf => leaf.id === graphConfig.topics.leafOfSource['DRILL-1006']).title);
  const changed = nativeHarness({ topics: topicRows().map(row => row.predicate === 'prop:title' && row.subject_id === 'topic:5' ? { ...row, object_string: 'Renamed' } : row) });
  const drift = await (await changed.app.handle('run', post('run', liveBody('S09', { query: preset.question })), env())).json();
  assert.equal(drift.enhanced.status, 'error');
  assert.equal(drift.enhanced.error.code, 'studio_topic_generation_changed');
});

test('native graph routing: graph indexes accept graph queries only, on the preview API, with a short per-call timeout', async () => {
  const seen = [];
  const hanging = (url, init) => new Promise((resolve, reject) => { seen.push(url); init.signal.addEventListener('abort', () => reject(init.signal.reason)); });
  const guarded = searchOnlyFetch(hanging, ENDPOINT, ['fiq-graph', 'fiq-content'], 45000, ['fiq-content'], { graphIndexes: ['fiq-graph'], timeouts: { 'fiq-graph': 30 } });
  const init = { method: 'POST', body: '{}' };
  for (const url of [`${ENDPOINT}/indexes/fiq-graph/docs/search?api-version=${AGENTIC_SEARCH_API_VERSION}`,
    `${ENDPOINT}/indexes('fiq-graph')/docs/search.graph?api-version=${SEARCH_API_VERSION}`,
    `${ENDPOINT}/indexes('fiq-content')/docs/search.graph?api-version=${AGENTIC_SEARCH_API_VERSION}`]) {
    assert.throws(() => guarded(url, init), error => error.code === 'studio_capability_unavailable', url);
  }
  const started = Date.now();
  await assert.rejects(guarded(`${ENDPOINT}/indexes('fiq-graph')/docs/search.graph?api-version=${AGENTIC_SEARCH_API_VERSION}`, init), error => error.code === 'studio_upstream_timeout');
  assert.ok(Date.now() - started < 5000);
  assert.equal(seen.length, 1);
});

test('S08/S09 honor LIVE_DISABLED_SCENARIOS, and other languages use the English graph with a visible note', async () => {
  const { app, calls } = nativeHarness();
  const catalog = await (await app.handle('scenarios', new Request(`${ORIGIN}/api/scenarios`), env({ LIVE_DISABLED_SCENARIOS: 'S08,S09' }))).json();
  const byId = Object.fromEntries(catalog.scenarios.map(item => [item.id, item]));
  assert.equal(byId.S08.liveAvailable, false);
  assert.equal(byId.S09.liveAvailable, false);
  const paused = await app.handle('run', post('run', liveBody('S08', { query: graphConfig.s08[0].question })), env({ LIVE_DISABLED_SCENARIOS: 'S08' }));
  assert.equal(paused.status, 503);
  assert.equal(calls.length, 0);
  const french = await (await app.handle('scenarios', new Request(`${ORIGIN}/api/scenarios?language=fr`), env())).json();
  const s08 = french.scenarios.find(item => item.id === 'S08');
  assert.equal(s08.liveAvailable, true);
  assert.match(s08.liveDescription, /English Zava content/);
  const run = await (await app.handle('run', post('run', liveBody('S08', { query: graphConfig.s08[1].question, language: 'fr' })), env())).json();
  assert.equal(run.executionStatus, 'success');
  assert.match(run.enhanced.trace.steps.join(' '), /English Zava content/);
});


test('every showcase preset is recorded with a curated note, and AFTER clearly beats BEFORE in the top 3', () => {
  const load = file => JSON.parse(readFileSync(new URL(`../config/${file}`, import.meta.url), 'utf8'));
  const { presets } = load('studio-presets.json');
  const recordedFile = load('studio-recorded.json');
  const notesFile = load('studio-notes.json');
  const ids = hit => [hit?.id, hit?.sourceId];
  const ndcg3 = (arm, preset) => {
    let dcg = 0;
    (arm.hits || []).slice(0, 3).forEach((hit, i) => {
      if (ids(hit).some(id => preset.relevant.includes(id))) dcg += 1 / Math.log2(i + 2);
      if (ids(hit).some(id => (preset.forbidden || []).includes(id))) dcg -= 1 / Math.log2(i + 2);
    });
    const ideal = Array.from({ length: Math.min(3, preset.relevant.length) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);
    return dcg / ideal;
  };
  let checked = 0;
  for (const [language, byScenario] of Object.entries(presets)) {
    for (const [scenarioId, list] of Object.entries(byScenario)) {
      assert.equal(list.length, 4, `${language} ${scenarioId}`);
      for (const preset of list) {
        const key = `${language}|${scenarioId}|${(preset.query || imageOnlyQuery(language)).trim()}`;
        const entry = recordedFile.entries[key];
        assert.ok(entry, `recorded: ${key}`);
        assert.ok(notesFile.entries[key]?.trim(), `note: ${key}`);
        assert.equal(entry.boostSubtype, scenarioId === 'S06' ? preset.boostSubtype : undefined, key);
        const { baseline, enhanced } = entry.result;
        assert.ok(baseline.apiLog?.length && enhanced.apiLog?.length, `API log: ${key}`);
        if (preset.criterion === 'graph') {
          // Native entity graph: every statement meets its expectation (rows, or proof of absence) and no distractor appears.
          const statements = enhanced.graph?.kind === 'native' ? enhanced.graph.statements : [];
          assert.ok(statements.length && !baseline.graph, key);
          assert.ok(statements.every(statement => statement.expectRows === 0 ? statement.outcome === 'absence' : statement.rows.length > 0), key);
          const values = statements.flatMap(statement => statement.rows.flatMap(row => Object.values(row.values)));
          assert.ok(!(preset.forbidden || []).some(id => values.includes(id)), `${key}: no distractors`);
          assert.equal(enhanced.apiLog.length, statements.length, key);
        } else if (preset.criterion === 'topics') {
          const after = enhanced.topicCoverage?.covered?.length, before = baseline.topicCoverage?.covered?.length;
          assert.ok(enhanced.topics?.kind === 'native' && enhanced.topics.hierarchy.length && !baseline.topics, key);
          assert.ok(preset.topicKind === 'corpus-themes' ? after >= before : after > before, `${key}: themes ${after} vs ${before}`);
        }
        else if (preset.criterion === 'row') assert.ok(Number.isInteger(enhanced.hits[0]?.row) && !Number.isInteger(baseline.hits?.[0]?.row), key);
        else {
          const delta = ndcg3(enhanced, preset) - ndcg3(baseline, preset);
          assert.ok(delta >= 0.15, `${key}: AFTER must clearly win (delta ${delta.toFixed(2)})`);
          assert.ok(ids(enhanced.hits[0]).some(id => preset.relevant.includes(id)), `${key}: AFTER #1 must be relevant`);
        }
        if (scenarioId === 'S07') {
          // The note may describe only the agentic planning the recorded response shows: no invented sub-queries.
          const agentic = enhanced.trace.configuration.agenticSearch;
          const logged = enhanced.apiLog[0].response.body['@search.debug'].agentic.subQueries;
          assert.equal(agentic.subQueryCount, logged.length, key);
          assert.deepEqual(agentic.subQueries.map(query => query.iteration), logged.slice(0, 10).map(query => query.iteration), key);
          assert.ok(logged.every(query => typeof query.search === 'string' && !query.search.includes('omitted')), `${key}: sub-query text shown`);
          const note = notesFile.entries[key];
          assert.doesNotMatch(note, /plans? separate searches|searches .* separately|covers .* separately/i, key);
          if (agentic.subQueryCount) assert.match(note, new RegExp(`issued ${agentic.subQueryCount} follow-up sub-quer`), key);
          else assert.match(note, /without needing follow-up sub-queries/, key);
          if (preset === list[0]) assert.ok(agentic.subQueryCount > 0, `${key}: the first S07 preset must show agentic planning`);
        }
        checked++;
      }
    }
  }
  assert.equal(checked, 220);
  assert.equal(Object.keys(notesFile.entries).length, 220);
});

// Industry demos: public U.S. government corpora compiled in by build configuration; English only; filters, facets,
// scoring profiles and S10 documents come only from the server-side preset allowlist in config/studio-industries.json.
const facetFields = id => [...new Set([...Object.values(industryById(id).presets).flat().flatMap(preset => preset.facets || []),
  ...(industryById(id).defaults?.S05?.facets || [])].map(facet => facet.split(',')[0]))];
// Facet and preset-filter fields are filterable (and facetable) in the test schema, as in the real indexes.
const shapedFields = id => [...new Set([...facetFields(id), ...Object.values(industryById(id).presets).flat().flatMap(preset => filterFields(preset.filter))])]
  .filter(name => !['publishedDate', 'scope', 'variant', 'sourceHash', 'extractionAnalyzer'].includes(name));
const industrySchema = id => ({ name: `foundry-iq-${id}`, fields: [
  { name: 'id', type: 'Edm.String', key: true, searchable: true, filterable: true, analyzer: 'keyword' }, stringField('sourceId', { filterable: true }),
  ...['title', 'content'].map(name => ({ name, type: 'Edm.String', searchable: true, analyzer: 'en.lucene', synonymMaps: ['zava-studio-synonyms'] })),
  ...['titlePlain', 'contentPlain'].map(name => ({ name, type: 'Edm.String', searchable: true, retrievable: false, analyzer: 'standard.lucene' })),
  stringField('url'), ...['scope', 'variant', 'sourceHash', 'extractionAnalyzer'].map(name => stringField(name, { filterable: true })),
  ...['agency', 'publisher', 'license', 'docType', 'chunkType', 'coordinates'].filter(name => !shapedFields(id).includes(name)).map(name => stringField(name)),
  ...shapedFields(id).map(name => stringField(name, { filterable: true, facetable: true })),
  { name: 'publishedDate', type: 'Edm.DateTimeOffset', retrievable: true, filterable: true, facetable: true },
  ...['page', 'row'].map(name => ({ name, type: 'Edm.Int32', retrievable: true })),
  { name: 'contentVector', type: 'Collection(Edm.Single)', searchable: true, retrievable: false, dimensions: 1536, vectorSearchProfile: `${id}-profile` }],
  semantic: { configurations: [{ name: `${id}-semantic` }] }, scoringProfiles: industryById(id).boostSubtypes.map(boost => ({ name: `${id}-${boost}` })),
  vectorSearch: { profiles: [{ name: `${id}-profile`, algorithm: 'hnsw', vectorizer: `${id}-text-vectorizer` }], algorithms: [{ name: 'hnsw', kind: 'hnsw' }],
    vectorizers: [{ name: `${id}-text-vectorizer`, kind: 'azureOpenAI', azureOpenAIParameters: { resourceUri: 'https://embed-account.openai.azure.com',
      deploymentId: 'embed', modelName: 'text-embedding-3-small', apiKey: null, authIdentity: null } }] } });
const industryEntries = ids => ids.map(id => ({ index: `foundry-iq-${id}`, etag: `"${id}-1"`, schema: industrySchema(id) }));
const privateIndustryBinding = ids => ({ industries: Object.fromEntries(ids.map(id => [id, { index: `foundry-iq-${id}`, semanticConfiguration: `${id}-semantic`,
  vectorField: 'contentVector', scoringProfiles: Object.fromEntries(industryById(id).boostSubtypes.map(boost => [boost, `${id}-${boost}`])) }])) });
const industryDoc = (id, extra = {}) => ({ id, sourceId: id.split('#')[0], title: `Title ${id}`, content: `Evidence ${id}`, scope: 'public',
  url: 'https://dailymed.nlm.nih.gov/dailymed/fda/label.pdf', agency: 'FDA', publishedDate: '2025-03-01T00:00:00Z', license: 'CC0 1.0', '@search.score': 1.2, ...extra });
// Responds like Search for each request shape the industry arms send.
const industryHandler = async (url, init) => {
  const body = JSON.parse(init.body);
  const analyzer = /extractionAnalyzer eq '([^']+)'/.exec(body.filter || '')?.[1];
  if (analyzer) return json({ value: [industryDoc('PDF-1#p2', { extractionAnalyzer: analyzer, page: 2, chunkType: 'text' })] });
  if (body.semanticQuery) return json({ value: ['DOC-2', 'DOC-1'].map(id => industryDoc(id, { '@search.rerankerScore': id === 'DOC-2' ? 3.2 : 2.1 })) });
  if (body.queryType === 'agentic') return json({ value: [industryDoc('DOC-2')], '@search.debug': { agentic: { terminationReason: 'modelStopped',
    subQueries: [{ iteration: 1, search: 'renal dosing adjustment' }], usage: { agenticPlanningTokens: 9 } } } });
  return json({ value: [industryDoc('DOC-1'), industryDoc('DOC-2', { url: 'https://evil.example/phish' })], ...(body.facets ? { '@search.facets': { agency: [{ value: 'FDA', count: 2 }] } } : {}) });
};
function industryHarness({ enabled = ['healthcare', 'retail'], handler = industryHandler, recorded } = {}) {
  const bindings = industryBindingsFrom(privateIndustryBinding(enabled), attestations(undefined, undefined, industryEntries(enabled)), enabled);
  return harness({ extra: industryEntries(enabled), industries: { enabled, bindings }, handler, recorded });
}
const catalogFor = async (app, query = '', patch = {}) => app.handle('scenarios', new Request(`${ORIGIN}/api/scenarios${query}`), env(patch));
const industryBody = (scenarioId, patch = {}) => ({ industry: 'healthcare', scenarioId, mode: 'live', query: 'kidney dosing for metformin', ...patch });

test('industries are off by default; when built in, each lists only its applicable English scenarios and Zava is unchanged', async () => {
  const off = harness().app;
  assert.equal((await (await catalogFor(off)).json()).industries, undefined);
  assert.equal((await catalogFor(off, '?industry=healthcare')).status, 400);
  const { app, calls } = industryHarness();
  const zava = await (await catalogFor(app)).json();
  assert.deepEqual(zava.industries.map(item => item.id), ['zava', 'healthcare', 'retail']);
  assert.equal(zava.industry.id, 'zava');
  assert.equal(zava.scenarios.length, 11);
  assert.ok(zava.industry.languages.includes('ja'));
  const healthcare = await (await catalogFor(app, '?industry=healthcare')).json();
  const item = industryById('healthcare');
  assert.deepEqual(healthcare.scenarios.map(scenario => scenario.id), item.scenarios);
  assert.ok(!healthcare.scenarios.some(scenario => scenario.id === 'S11'), 'image search uses the Zava store');
  for (const id of ['S08', 'S09']) {
    const graph = healthcare.scenarios.find(scenario => scenario.id === id);
    assert.equal(graph.live.status, 'not_configured', id);
    assert.equal(graph.liveAvailable, false, id);
    assert.equal(graph.sample.available, false, id);
    assert.deepEqual(graph.demoPresets, [], id);
    assert.match(graph.live.reason, /Graph search isn’t configured for this industry yet/, id);
  }
  const ready = healthcare.scenarios.filter(scenario => !['S08', 'S09'].includes(scenario.id));
  assert.equal(healthcare.industry.englishOnly, true);
  assert.deepEqual(healthcare.industry.sourceHosts, item.sourceHosts);
  assert.equal(healthcare.defaultMode, 'live');
  assert.ok(ready.every(scenario => scenario.liveAvailable && !scenario.sample.available && scenario.language === 'en'));
  const s06 = healthcare.scenarios.find(scenario => scenario.id === 'S06');
  assert.deepEqual(s06.boostSubtypes, item.boostSubtypes);
  const s03 = healthcare.scenarios.find(scenario => scenario.id === 'S03');
  assert.deepEqual(s03.demoPresets.map(preset => preset.query), item.presets.S03.map(preset => preset.query));
  assert.equal(s03.demoPresets[0].note, item.presets.S03[0].why);
  assert.ok(!JSON.stringify(healthcare).includes(item.presets.S03.find(preset => preset.filter).filter), 'preset filters stay on the server');
  const retail = await (await catalogFor(app, '?industry=retail')).json();
  assert.deepEqual(retail.scenarios.map(scenario => scenario.id), industryById('retail').scenarios);
  assert.ok(!retail.scenarios.some(scenario => scenario.id === 'S10'), 'the recall corpus has no PDFs');
  for (const query of ['?industry=healthcare&language=fr', '?industry=energy', '?industry=..%2Fzava']) assert.equal((await catalogFor(app, query)).status, 400, query);
  for (const scenario of [...healthcare.scenarios, ...retail.scenarios]) {
    for (const copy of [scenario.title, scenario.description, scenario.limits, scenario.sample.label, scenario.live.reason]) assert.deepEqual(staleIn(copy), [], copy);
    assert.ok(!/Azure AI Search/.test(JSON.stringify(scenario)));
  }
  assert.equal(calls.length, 0);
});

test('industry requests reject client filters, other languages, inapplicable scenarios and unknown boosts before Azure', async () => {
  const { app, calls } = industryHarness();
  for (const [patch, code] of [[{ filter: "scope eq 'private'" }, 'invalid_studio_request'], [{ options: { filter: 'x' } }, 'invalid_studio_request'],
    [{ language: 'fr' }, 'invalid_studio_request'], [{ scenarioId: 'S11' }, 'invalid_studio_request'],
    [{ scenarioId: 'S06', options: { boostSubtype: 'availability' } }, 'invalid_studio_request'], [{ industry: 'energy' }, 'invalid_industry'],
    [{ industry: 'zava ' }, 'invalid_industry'], [{ topK: 7 }, 'invalid_studio_request'], [{ mode: 'sample' }, 'invalid_studio_request']]) {
    const response = await app.handle('run', post('run', industryBody(patch.scenarioId || 'S03', patch)), env());
    assert.equal(response.status, 400, JSON.stringify(patch));
    assert.equal((await response.json()).errorCode, code, JSON.stringify(patch));
  }
  assert.equal(calls.length, 0);
});

test('industry arms send the evaluated request shapes as docs/search POSTs with the query key only', async () => {
  const { app, calls } = industryHarness();
  const item = industryById('healthcare');
  const bodies = async (scenarioId, query) => {
    calls.length = 0;
    const result = await (await app.handle('run', post('run', industryBody(scenarioId, query ? { query } : {})), env())).json();
    assert.ok(['success', 'partial_success'].includes(result.executionStatus), `${scenarioId}: ${JSON.stringify(result).slice(0, 400)}`);
    for (const call of calls) {
      assert.equal(call.init.method, 'POST');
      assert.match(new URL(call.url).pathname, /^\/indexes\/foundry-iq-healthcare\/docs\/search$/);
      assert.equal(call.init.headers['api-key'], KEY);
    }
    return { result, sent: calls.map(call => JSON.parse(call.init.body)) };
  };
  let { sent, result } = await bodies('S01');
  assert.deepEqual(sent.map(body => [body.searchFields, body.searchMode, body.filter]).sort(),
    [['title,content', 'any', BASE_FILTER], ['titlePlain,contentPlain', 'all', BASE_FILTER]]);
  assert.deepEqual(result.enhanced.hits.map(hit => hit.url), ['https://dailymed.nlm.nih.gov/dailymed/fda/label.pdf', undefined], 'off-allowlist links are dropped');
  assert.equal(result.enhanced.hits[0].document.agency, 'FDA');
  ({ sent } = await bodies('S02'));
  const vectorArm = sent.find(body => !body.search);
  assert.deepEqual(vectorArm.vectorQueries, [{ kind: 'text', text: 'kidney dosing for metformin', fields: 'contentVector', k: 50 }]);
  assert.equal(vectorArm.vectorFilterMode, 'preFilter');
  const filtered = item.presets.S03.find(preset => preset.filter);
  ({ sent, result } = await bodies('S03', filtered.query));
  assert.ok(sent.every(body => body.filter === `${BASE_FILTER} and (${filtered.filter})`));
  assert.ok(sent.some(body => body.vectorQueries) && sent.some(body => !body.vectorQueries));
  assert.deepEqual(result.enhanced.applied, [{ label: 'Filter (both arms)', value: filtered.filter }]);
  assert.equal(result.note.text, filtered.why);
  assert.match(result.note.source, /verified Live evaluation/);
  ({ sent, result } = await bodies('S03', 'free text with no preset'));
  assert.ok(sent.every(body => body.filter === BASE_FILTER));
  assert.equal(result.note, undefined, 'free text gets no curated note');
  ({ sent, result } = await bodies('S04'));
  assert.equal(sent.length, 2, 'one shared candidate call plus one semantic L2 call');
  assert.ok(sent[0].vectorQueries && !sent[0].semanticQuery);
  assert.equal(sent[1].semanticQuery, 'kidney dosing for metformin');
  assert.equal(sent[1].semanticConfiguration, 'healthcare-semantic');
  assert.deepEqual(result.enhanced.hits.map(hit => hit.id), ['DOC-2', 'DOC-1']);
  const faceted = item.presets.S05[0];
  ({ sent, result } = await bodies('S05', faceted.query));
  const [plain, after] = [sent.find(body => !body.vectorQueries), sent.find(body => body.vectorQueries)];
  assert.equal(plain.filter, BASE_FILTER);
  assert.equal(plain.facets, undefined);
  assert.deepEqual(after.facets, faceted.facets);
  assert.equal(after.filter, faceted.filter ? `${BASE_FILTER} and (${faceted.filter})` : BASE_FILTER);
  assert.deepEqual(result.enhanced.facets, { agency: [{ value: 'FDA', count: 2 }] });
  const boosted = item.presets.S06[0];
  ({ sent } = await bodies('S06', boosted.query));
  assert.deepEqual(sent.map(body => body.scoringProfile).filter(Boolean), [`healthcare-${boosted.boostSubtype || item.boostSubtypes[0]}`]);
  ({ sent, result } = await bodies('S07'));
  const agenticCall = calls.find(call => JSON.parse(call.init.body).queryType === 'agentic');
  assert.equal(searchVersion(agenticCall.url), AGENTIC_SEARCH_API_VERSION);
  assert.equal(JSON.parse(agenticCall.init.body).agenticOptions.maxRuntimeInSeconds, 10);
  assert.equal(result.enhanced.trace.configuration.agenticSearch.subQueryCount, 1);
  const pdf = item.presets.S10[0];
  ({ sent, result } = await bodies('S10', pdf.query));
  assert.deepEqual(sent.map(body => body.filter).sort(), ['prebuilt-layout', 'prebuilt-read'].map(analyzer =>
    `scope eq 'public' and extractionAnalyzer eq '${analyzer}' and sourceHash eq '${pdf.sourceHash}'`));
  assert.equal(result.baseline.hits[0].page, 2);
  assert.match(result.enhanced.apiLog[0].url, /^https:\/\/<your-search-service>\.search\.windows\.net\/indexes\/foundry-iq-healthcare\//);
  assert.ok(!JSON.stringify(result).includes(KEY));
});

test('LIVE_DISABLED_INDUSTRIES pauses chosen industries (zava included) and invalid values pause them all', async () => {
  assert.deepEqual([...disabledIndustries(' Healthcare ', ['healthcare']).set], ['healthcare']);
  assert.equal(disabledIndustries('nope', ['healthcare']).ok, false);
  const { app, calls } = industryHarness();
  const paused = await (await catalogFor(app, '?industry=healthcare', { LIVE_DISABLED_INDUSTRIES: 'healthcare' })).json();
  const notGraph = scenario => !['S08', 'S09'].includes(scenario.id);
  assert.ok(paused.scenarios.filter(notGraph).every(scenario => !scenario.liveAvailable && /LIVE_DISABLED_INDUSTRIES/.test(scenario.live.reason)));
  const run = await app.handle('run', post('run', industryBody('S03')), env({ LIVE_DISABLED_INDUSTRIES: 'healthcare' }));
  assert.equal(run.status, 503);
  assert.equal((await run.json()).errorCode, 'studio_live_unavailable');
  assert.ok((await (await catalogFor(app, '?industry=retail', { LIVE_DISABLED_INDUSTRIES: 'healthcare' })).json()).scenarios.filter(notGraph).every(scenario => scenario.liveAvailable));
  assert.ok((await (await catalogFor(app, '', { LIVE_DISABLED_INDUSTRIES: 'zava' })).json()).scenarios.every(scenario => !scenario.liveAvailable));
  for (const query of ['', '?industry=retail']) {
    assert.ok((await (await catalogFor(app, query, { LIVE_DISABLED_INDUSTRIES: 'typo' })).json()).scenarios.every(scenario => !scenario.liveAvailable), query);
  }
  const s01 = await (await catalogFor(app, '?industry=healthcare', { LIVE_DISABLED_SCENARIOS: 'S01' })).json();
  assert.equal(s01.scenarios.find(scenario => scenario.id === 'S01').liveAvailable, false);
  assert.equal(calls.length, 0);
});

test('industry recorded Sample replays only its own curated keys, and an explicit zava industry is the unchanged default demo', async () => {
  const query = industryById('healthcare').presets.S03[0].query;
  const arm = kind => ({ status: 'success', kind, hits: [{ id: 'DOC-1', sourceId: 'DOC-1', rank: 1 }], citations: [{ id: 'DOC-1', sourceId: 'DOC-1' }], trace: { steps: [] } });
  const recorded = { recordedAt: '2026-11-26', entries: { [`healthcare|en|S03|${query}`]: { industry: 'healthcare', language: 'en', scenarioId: 'S03', query, topK: 10,
    result: { mode: 'live', industry: 'healthcare', scenarioId: 'S03', query, executionStatus: 'success', baseline: arm('lexical'), enhanced: arm('hybrid'), comparison: {} } } } };
  const { app, calls } = industryHarness({ recorded });
  const catalog = await (await catalogFor(app, '?industry=healthcare')).json();
  assert.deepEqual(catalog.scenarios.find(scenario => scenario.id === 'S03').sample.curatedQueries, [query]);
  assert.equal((await (await catalogFor(app, '?industry=retail')).json()).scenarios.find(scenario => scenario.id === 'S03').sample.available, false);
  const replay = await (await app.handle('run', post('run', industryBody('S03', { mode: 'sample', query })), env())).json();
  assert.equal(replay.recorded.recordedAt, '2026-11-26');
  assert.equal(replay.runId, 'recorded-healthcare-en-S03');
  assert.equal(replay.note.text, industryById('healthcare').presets.S03[0].why);
  const zavaKey = await app.handle('run', post('run', { scenarioId: 'S03', mode: 'sample', query, language: 'en', industry: 'zava' }), env());
  assert.notEqual((await zavaKey.json()).runId, 'recorded-healthcare-en-S03', 'industry recordings never answer the Zava demo');
  assert.equal(calls.length, 0);
  const zava = await (await app.handle('run', post('run', liveBody('S02', { industry: 'zava' })), env())).json();
  assert.equal(zava.executionStatus, 'success');
  assert.ok(calls.length && calls.every(call => new URL(call.url).pathname === '/indexes/zava-studio-products/docs/search'));
});

test('build pins industry bindings to attested ETags, checks the public catalog and renders data sources', () => {
  const ids = ['healthcare', 'retail'];
  const full = attestations(undefined, undefined, industryEntries(ids));
  const used = new Set();
  const bindings = industryBindingsFrom(privateIndustryBinding(ids), full, ids, used);
  assert.equal(bindings.industries.healthcare.indexETag, '"healthcare-1"');
  assert.equal(bindings.agentic.maxRuntimeInSeconds, 10);
  assert.deepEqual([...used], ['foundry-iq-healthcare', 'foundry-iq-retail']);
  assert.deepEqual(industryBindingsFrom({}, full, []).industries, {}, 'no industries unless the build enables them');
  assert.throws(() => industryBindingsFrom({ industries: {} }, full, ['healthcare']), /STUDIO_PRIVATE_INDUSTRIES/);
  assert.throws(() => industryBindingsFrom(privateIndustryBinding(['energy']), full, ['energy']), /No schema attestation/);
  assert.deepEqual(checkIndustryCatalog(industryCatalog, ids, full, bindings, { notesOptional: true }), []);
  const tampered = structuredClone(industryCatalog);
  const healthcare = tampered.industries.find(item => item.id === 'healthcare');
  healthcare.presets.S01[0].filter = "scope eq 'private'";
  healthcare.presets.S05[0].facets = ['titlePlain'];
  healthcare.presets.S10[0].sourceHash = 'nope';
  healthcare.presets.S03[0].filter = "secretField eq 'x' and search.ismatch('x')";
  healthcare.presets.S03[1].why = 'Keyword misses it; vector-only ranks it #2; hybrid ranks it #1.';
  healthcare.presets.S11 = [{ id: 'x', query: 'hat' }];
  const problems = checkIndustryCatalog(tampered, ids, full, bindings);
  assert.ok(['agency', 'docType,count:5', 'publishedDate,interval:year', 'agency,sort:-count,count:10'].every(isFacet));
  assert.ok(!['agency,interval:fortnight', 'agency,count:5;x', "agency,values:'a'", ''].some(isFacet));
  assert.deepEqual(filterFields("category eq 'A and b eq c' and retailers/any(r: r eq 'Temu') and search.in(genericName, 'x,y', ',') and hospitalized ge 1"),
    ['category', 'retailers', 'hospitalized', 'genericName']);
  for (const expected of [/S01.*filter/, /facet titlePlain/, /S10 source hash/, /inapplicable S11/, /S03-01: filter$/, /filter field secretField/, /S03-02: note describes an arm the app doesn’t show/]) assert.ok(problems.some(problem => expected.test(problem)), `${expected}: ${problems}`);
  // S07 planning varies between runs: a note may claim sub-queries only if the shipped recording shows them.
  const s07 = structuredClone(industryCatalog);
  const planned = s07.industries.find(item => item.id === 'healthcare').presets.S07[0];
  planned.why = 'Agentic retrieval split the question into two sub-queries.';
  const recording = (count, status = 'success') => ({ entries: { [`healthcare|en|S07|${planned.query}`]: { result: { executionStatus: status,
    baseline: { status: 'success' }, enhanced: { status: 'success', trace: { configuration: { agenticSearch: { subQueryCount: count } } } } } } } });
  assert.deepEqual(industryRecordingProblems(s07, ['healthcare'], recording(2)), []);
  assert.match(industryRecordingProblems(s07, ['healthcare'], recording(0))[0], /claims agentic planning.*0 sub-queries/);
  assert.match(industryRecordingProblems(s07, ['healthcare'], recording(2, 'partial_success'))[0], /not a successful comparison/);
  // The default (first) example must show a different #1 whenever another example does.
  const ordered = structuredClone(industryCatalog);
  const s05 = ordered.industries.find(item => item.id === 'healthcare').presets.S05;
  const top1 = (before, after) => ({ executionStatus: 'success', baseline: { status: 'success', hits: [{ id: before }] }, enhanced: { status: 'success', hits: [{ id: after }] } });
  const s05Recordings = first => ({ entries: Object.fromEntries(s05.map((preset, i) => [`healthcare|en|S05|${preset.query}`, { result: i === 0 ? top1('A', first) : top1('A', 'B') }])) });
  assert.deepEqual(industryRecordingProblems(ordered, ['healthcare'], s05Recordings('B')), []);
  assert.match(industryRecordingProblems(ordered, ['healthcare'], s05Recordings('A'))[0], /healthcare S05: the first example has the same #1 in both arms/);
  assert.deepEqual(industryRecordingProblems(s07, ['retail'], recording(0)), [], 'only enabled industries are checked');
  const page = readFileSync(new URL('../page.html', import.meta.url), 'utf8');
  assert.match(pageWithIndustries(page, ids), /<meta name="studio-industries" content="healthcare,retail">/);
  assert.match(pageWithIndustries(page, []), /<meta name="studio-industries" content="">/);
  assert.throws(() => pageWithIndustries(page, ['"><script>']), /lowercase/);
  const about = readFileSync(new URL('../about.html', import.meta.url), 'utf8');
  const withSources = aboutWithDataSources(about, industryCatalog, ['healthcare']);
  assert.match(withSources, /Public and synthetic demo data/);
  assert.match(withSources, /href="https:\/\/api\.fda\.gov\/drug\/label\.json"/);
  assert.ok(!withSources.includes('source-note'), 'only Financial carries the CFPB note');
  assert.match(aboutWithDataSources(about, industryCatalog, ['financial']), /<p class="source-note">Consumer complaint narratives come from the CFPB FOIA narratives archive/);
  assert.match(withSources, /<span class="license">CC0 1\.0/);
  assert.match(withSources, /<footer><span>Public and synthetic demo data · <a href="#data-sources">Data sources<\/a>/);
  assert.ok(!withSources.includes('All content is synthetic (Zava Retail)'));
  const zavaOnly = aboutWithDataSources(about, industryCatalog, []);
  assert.match(zavaOnly, /Synthetic demo data: the Zava store/);
  assert.ok(!zavaOnly.includes('open.fda.gov'));
  assert.throws(() => aboutWithDataSources('<main></main>', industryCatalog, []), /data-sources markers/);
  for (const item of industryCatalog.industries) {
    for (const source of item.sources) assert.match(source.url, /^https:\/\//, `${item.id} ${source.agency}`);
    assert.deepEqual(staleIn(item.blurb), [], item.id);
  }
});

test('industry graph search fails closed on its own without the optional graph service, and graph values are redacted', async () => {
  const GRAPH_KEY = 'GraphQueryKeyForTestsOnly0123456789abcdef';
  const GRAPH_ENDPOINT = 'https://fiq-industry-test-search.search.windows.net';
  const graphEnv = { AZURE_SEARCH_GRAPH_ENDPOINT: GRAPH_ENDPOINT, AZURE_SEARCH_GRAPH_QUERY_KEY: GRAPH_KEY };
  assert.equal(graphServiceStatus({}).ready, false);
  assert.equal(graphServiceStatus({ AZURE_SEARCH_GRAPH_ENDPOINT: GRAPH_ENDPOINT }).ready, false);
  assert.equal(graphServiceStatus({ ...graphEnv, AZURE_SEARCH_GRAPH_ENDPOINT: 'http://fiq-industry-test-search.search.windows.net' }).ready, false);
  assert.equal(graphServiceStatus({ ...graphEnv, AZURE_SEARCH_GRAPH_QUERY_KEY: 'bad key!' }).ready, false);
  assert.ok(!JSON.stringify(graphServiceStatus({ ...graphEnv, AZURE_SEARCH_GRAPH_QUERY_KEY: 'bad key!' })).includes('bad key!'));
  assert.equal(graphServiceStatus(graphEnv).ready, true);
  // A result that echoes the graph key or host must never reach the browser.
  const { app, calls } = industryHarness({ handler: async (url, init) => JSON.parse(init.body).queryType === 'agentic' ? industryHandler(url, init)
    : json({ value: [industryDoc('DOC-1', { title: `leak ${GRAPH_KEY} fiq-industry-test-search.search.windows.net` })] }) });
  for (const patch of [{}, graphEnv]) {
    const health = await (await app.handle('health', new Request(`${ORIGIN}/api/health`), env(patch))).json();
    assert.equal(health.industryGraph, 'not_configured', 'no build ships an industry graph binding yet');
    for (const scenarioId of ['S08', 'S09']) {
      for (const mode of ['live', 'sample']) {
        const response = await app.handle('run', post('run', industryBody(scenarioId, { mode })), env(patch));
        assert.equal(response.status, 503, `${scenarioId} ${mode}`);
        const body = await response.json();
        assert.equal(body.errorCode, 'studio_graph_not_configured');
        assert.match(body.error, /isn’t configured for this industry yet/);
      }
    }
    const zava = await (await catalogFor(app, '', patch)).json();
    assert.ok(['S08', 'S09'].every(id => zava.scenarios.find(scenario => scenario.id === id).live.status !== 'not_configured'), 'Zava graphs use the main service');
  }
  assert.equal(calls.length, 0, 'graph scenarios send nothing');
  const other = await (await app.handle('run', post('run', industryBody('S03')), env(graphEnv))).json();
  assert.equal(other.executionStatus, 'success', 'every other industry scenario keeps working');
  const text = JSON.stringify(other);
  assert.ok(!text.includes(GRAPH_KEY) && !text.includes('fiq-industry-test-search.search.windows.net'));
});

test('passages display as plain text (Markdown removed) while raw values stay unchanged', () => {
  assert.equal(displayText('## 5) The occurrence of drug toxicity ##### (a) Adverse Effect'), '5) The occurrence of drug toxicity (a) Adverse Effect');
  assert.equal(displayText('# Recall\n\n- **Recall number:** 19116\n- **Recall date:** 2019-05-09'), 'Recall\n\n• Recall number: 19116\n• Recall date: 2019-05-09');
  assert.equal(displayText('(d) *Application of control.* See [the label](https://dailymed.nlm.nih.gov/x).'), '(d) Application of control. See the label.');
  assert.equal(displayText('| Hired | Training |\n|---|---|\n| Before 1999 | Done |'), 'Hired · Training\n\nBefore 1999 · Done');
  assert.equal(displayText('BAYER\n![Code128](barcodes/25.1 "8910")\nKerendia®\n----\nNotes'), 'BAYER\n\nKerendia®\n\nNotes');
  for (const kept of ['C# and item #3', 'wire transfers? _____ _____ 2.', '2*3*4 = 24', 'snake_case_name', 'HC-ICD10CM-FY2027-I-C-19']) assert.equal(displayText(kept), kept);
  assert.equal(displayText(undefined), undefined);
  const client = readFileSync(new URL('../assets/client.mjs', import.meta.url), 'utf8');
  assert.match(client, /'hit-open'/);
  assert.match(client, /displayText\(hit\.title\) \|\| hit\.id, 'hit-open'/);
  assert.match(client, /displayText\(hit\.snippet\)/);
  assert.match(client, /const allFields = \{ \.\.\.document_, content: hit\.snippet \}/, 'Raw hit JSON keeps the exact retrieved passage');
});

test('S10 labels read as Read and Layout, and industry facets use the contract labels', async () => {
  const { app } = industryHarness();
  const catalog = await (await catalogFor(app, '?industry=healthcare')).json();
  const s10 = catalog.scenarios.find(scenario => scenario.id === 'S10');
  assert.equal(s10.title, 'PDF layout extraction');
  assert.equal(s10.description.split('Content Understanding').length - 1, 1, 'named once in the description');
  assert.deepEqual(catalog.industry.facetLabels, industryById('healthcare').facetLabels);
  const pdf = industryById('healthcare').presets.S10[0];
  const result = await (await app.handle('run', post('run', industryBody('S10', { query: pdf.query })), env())).json();
  assert.deepEqual([result.baseline.label, result.enhanced.label], ['Read: page text', 'Layout: table rows']);
  assert.equal(result.enhanced.trace.configuration.extraction.provider, 'azureContentUnderstanding', 'Technical details keep the provider');
  const faceted = industryById('healthcare').presets.S05.find(preset => preset.facets?.length);
  const s05 = await (await app.handle('run', post('run', industryBody('S05', { query: faceted.query })), env())).json();
  const labels = industryById('healthcare').facetLabels;
  assert.equal(s05.enhanced.applied.find(item => item.label === 'Facets').value, faceted.facets.map(facet => labels[facet.split(',')[0]] || facet.split(',')[0]).join(', '));
  const zava = await (await app.handle('scenarios', new Request(`${ORIGIN}/api/scenarios`), env())).json();
  assert.ok(!JSON.stringify(zava).includes('Azure CU'));
});

test('a not-configured scenario keeps Search and the query box disabled, even after typing, and sends nothing', () => {
  assert.equal(notConfigured({ live: { status: 'not_configured' }, sample: { available: false } }), true);
  assert.equal(notConfigured({ live: { status: 'not_configured' }, sample: { available: true } }), false);
  assert.equal(notConfigured({ live: { status: 'actual_retrieval_verified' }, sample: { available: false } }), false);
  assert.equal(notConfigured(undefined), false);
  const client = readFileSync(new URL('../assets/client.mjs', import.meta.url), 'utf8');
  const body = name => client.slice(client.indexOf(`function ${name}(`), client.indexOf('\n}\n', client.indexOf(`function ${name}(`)));
  // Every keystroke calls invalidate(); it must not re-enable Search for a not-configured scenario.
  assert.match(body('invalidate'), /const blocked = notConfigured\(selectedScenario\(\)\);\s*element\('search'\)\.disabled = blocked;\s*element\('query'\)\.disabled = blocked;/);
  assert.doesNotMatch(body('invalidate'), /element\('search'\)\.disabled = false/);
  assert.match(body('run'), /if \(notConfigured\(scenario\)\) \{\s*setStatus\(scenario\.live\.reason\);\s*return;/);
  assert.doesNotMatch(body('run'), /element\('search'\)\.disabled = false/);
});

// Industry entity and topic graphs (S08/S09) on the dedicated graph service: curated questions only, Search reads only.
const { industryGraphConfig } = await import('../lib/industry-graph.mjs');
const { createHash: sha } = await import('node:crypto');
const gHash = value => sha('sha256').update(String(value)).digest('hex').slice(0, 16);
const G_ENDPOINT = 'https://fiq-industry-test.search.windows.net';
const G_KEY = 'GraphQueryKeyForTestsOnly0123456789abcdef';
const TEST_BLOB = 'https://teststorageacct.blob.core.windows.net/industry-documents/energy/source-item-test.md';
const gEnv = (patch = {}) => env({ AZURE_SEARCH_GRAPH_ENDPOINT: G_ENDPOINT, AZURE_SEARCH_GRAPH_QUERY_KEY: G_KEY, ...patch });
const gBinding = id => ({ dataset: `${id}-en`, content: `g-${id}-content`, contentETag: '"c1"', graph: `g-${id}-graph`, graphETag: '"g1"',
  topic: `g-${id}-topics`, topicETag: '"t1"', semanticConfiguration: `g-${id}-semantic`, vectorField: 'snippet_vector' });
const gSchemas = id => {
  const b = gBinding(id);
  const f = (name, extra = {}) => ({ name, type: 'Edm.String', retrievable: true, ...extra });
  return [
    { index: b.content, etag: b.contentETag, schema: { name: b.content, fields: [f('uid', { key: true, searchable: true }), f('snippet', { searchable: true }), f('blob_url', { filterable: true }),
      { name: 'snippet_vector', type: 'Collection(Edm.Single)', searchable: true, dimensions: 1536, vectorSearchProfile: 'p' }],
    semantic: { configurations: [{ name: b.semanticConfiguration }] }, vectorSearch: { profiles: [{ name: 'p', algorithm: 'a', vectorizer: 'v' }], vectorizers: [{ name: 'v', kind: 'azureOpenAI' }] } } },
    { index: b.graph, etag: b.graphETag, schema: { name: b.graph, fields: ['subject_id', 'predicate', 'object_id', 'chunk_id'].map(name => f(name)), graphProfile: { present: true } } },
    { index: b.topic, etag: b.topicETag, schema: { name: b.topic, fields: ['subject_id', 'predicate', 'object_id', 'object_string', 'object_double'].map(name => f(name, { filterable: name === 'predicate' })) } },
  ];
};
const gData = id => industryGraphConfig.industries[id];
// Topic rows that reproduce this generation's leaves under titled roots (the first root carries the focus theme's title).
const gTopicRows = id => {
  const data = gData(id);
  const focus = data.s09.find(preset => preset.focusTopic)?.focusTopic;
  const parents = [...new Set(data.topics.leaves.map(leaf => leaf.parent).filter(Boolean))];
  const extraRoots = Array.from({ length: 12 }, (_, i) => `topic:root-${i}`);
  const rows = [];
  [...parents, ...extraRoots].forEach((root, i) => {
    rows.push({ subject_id: 'topicgraph:topicgraph-topic', predicate: 'HasRootTopic', object_id: root, object_string: null, object_double: null });
    rows.push({ subject_id: root, predicate: 'prop:title', object_id: '', object_string: i === 0 ? focus : `Root theme ${i}`, object_double: null });
    rows.push({ subject_id: root, predicate: 'prop:proportion', object_id: '', object_string: null, object_double: 0.5 / (i + 1) });
  });
  for (const leaf of data.topics.leaves) {
    if (!leaf.parent) rows.push({ subject_id: 'topicgraph:topicgraph-topic', predicate: 'HasRootTopic', object_id: leaf.id, object_string: null, object_double: null });
    else rows.push({ subject_id: leaf.parent, predicate: 'HasSubTopic', object_id: leaf.id, object_string: null, object_double: null });
    if (leaf.title) rows.push({ subject_id: leaf.id, predicate: 'prop:title', object_id: '', object_string: leaf.title, object_double: null });
    rows.push({ subject_id: leaf.id, predicate: 'prop:proportion', object_id: '', object_string: null, object_double: leaf.proportion });
  }
  return rows;
};
function graphHarness(id = 'energy', { handler } = {}) {
  gData(id).sourceOfBlob[gHash(TEST_BLOB)] = 'NRG-TEST-1';
  gData(id).sourceUrls['NRG-TEST-1'] = 'https://www.eia.gov/todayinenergy/detail.php?id=1';
  const firstLeaf = gData(id).topics.leaves.find(leaf => leaf.title);
  gData(id).topics.leafOfPassage[gHash('uid-1')] = firstLeaf.id;
  const enabled = ['healthcare', id];
  const passage = (uid, extra = {}) => ({ uid, snippet: `# Test passage ${uid}\n\nEvidence text for ${uid}.`, blob_url: TEST_BLOB, ...extra });
  const graphHandler = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.includes('search.graph')) {
      const statement = gData(id).s08.flatMap(preset => preset.statements).find(item => item.gql === body.gql);
      if (statement?.expectRows === 0) return json({ value: [], '@search.graphDiagnostics': [] });
      return json({ value: [{ a: 'Entity A', b: 'Entity B', '@search.graphProvenance': { evidence: [{ chunkId: 'chunk-1' }] } }, { a: 'Entity C', b: 'Entity D' }],
        '@search.graphProvenanceDocuments': { 'chunk-1': passage('uid-1') },
        '@search.graphDiagnostics': [{ severity: 'warning', code: 'Graph.Provenance.CollectionLimit', message: 'Provenance collection limit reached.' }] });
    }
    if (url.includes(`/indexes/g-${id}-topics/`)) return json({ value: gTopicRows(id) });
    return json({ value: ['uid-1', 'uid-2', 'uid-3'].map((uid, i) => passage(uid, { '@search.score': 1 - i / 10, '@search.rerankerScore': 3 - i })) });
  };
  const bindings = industryBindingsFrom(privateIndustryBinding(enabled), attestations(undefined, undefined, industryEntries(enabled)), enabled);
  const graph = { service: 'fiq-industry-test', apiVersion: AGENTIC_SEARCH_API_VERSION, industries: { [id]: gBinding(id) },
    attestations: { service: 'fiq-industry-test', apiVersion: SEARCH_API_VERSION, entries: gSchemas(id) } };
  return harness({ extra: industryEntries(enabled), industries: { enabled, bindings, graph },
    handler: async (url, init) => url.startsWith(G_ENDPOINT) ? (handler || graphHandler)(url, init) : industryHandler(url, init) });
}
const gBody = (id, scenarioId, query) => ({ industry: id, scenarioId, mode: 'live', query, topK: 10, language: 'en' });

test('industry S08 runs allowlisted graph statements on the graph service with cited paths, and never shows storage or keys', async () => {
  const { app, calls } = graphHarness('energy');
  const catalog = await (await catalogFor(app, '?industry=energy', { AZURE_SEARCH_GRAPH_ENDPOINT: G_ENDPOINT, AZURE_SEARCH_GRAPH_QUERY_KEY: G_KEY })).json();
  const s08 = catalog.scenarios.find(scenario => scenario.id === 'S08');
  assert.equal(s08.liveAvailable, true);
  assert.deepEqual(s08.demoPresets.map(preset => preset.query), gData('energy').s08.map(preset => preset.question));
  assert.equal((await (await app.handle('health', new Request(`${ORIGIN}/api/health`), gEnv())).json()).industryGraph, 'configured');
  const odessa = gData('energy').s08.find(preset => preset.statements.length === 4);
  const result = await (await app.handle('run', post('run', gBody('energy', 'S08', odessa.question)), gEnv())).json();
  assert.equal(result.executionStatus, 'success', JSON.stringify(result).slice(0, 400));
  assert.equal(calls.length, 5, 'one plain retrieval plus four graph statements fit the per-comparison budget');
  assert.ok(calls.every(call => call.url.startsWith(G_ENDPOINT) && call.init.headers['api-key'] === G_KEY && call.init.method === 'POST'));
  const before = JSON.parse(calls.find(call => !call.url.includes('search.graph')).init.body);
  assert.deepEqual(before, { search: odessa.question, top: 5, select: 'uid,snippet,blob_url', queryType: 'semantic', semanticConfiguration: 'g-energy-semantic',
    vectorQueries: [{ kind: 'text', text: odessa.question, fields: 'snippet_vector', k: 50 }] });
  const graphBodies = calls.filter(call => call.url.includes('search.graph')).map(call => JSON.parse(call.init.body));
  assert.deepEqual(graphBodies.map(body => body.gql), odessa.statements.map(statement => statement.gql));
  assert.ok(graphBodies.every(body => body.provenance.hydrateDocuments.select === 'uid,snippet,blob_url'));
  const statements = result.enhanced.graph.statements;
  assert.equal(statements.length, 4);
  assert.deepEqual(statements[0].rows[0].sources, ['NRG-TEST-1'], 'sources come from the hashed blob map');
  assert.equal(statements[0].rows[1].citationUnavailable, true, 'a row without evidence is never given a citation');
  assert.equal(result.enhanced.hits[0].sourceId, 'NRG-TEST-1');
  assert.match(result.enhanced.hits[0].id, /^NRG-TEST-1#[0-9a-f]{8}$/, 'each passage keeps its own ID');
  assert.equal(result.enhanced.hits[0].url, 'https://www.eia.gov/todayinenergy/detail.php?id=1');
  const text = JSON.stringify(result);
  for (const secret of [G_KEY, 'fiq-industry-test.search.windows.net', 'teststorageacct', TEST_BLOB]) assert.ok(!text.includes(secret), secret);
  assert.match(result.enhanced.apiLog[0].url, /^https:\/\/<your-search-service>\.search\.windows\.net\/indexes\('g-energy-graph'\)\/docs\/search\.graph/);
  assert.match(JSON.stringify(result.enhanced.apiLog), /\[document [0-9a-f]{10}\]/);
  assert.equal(result.note.text, odessa.why);
  calls.length = 0;
  const free = await (await app.handle('run', post('run', gBody('energy', 'S08', 'Which grid events were caused by squirrels?')), gEnv())).json();
  assert.equal(free.enhanced.curatedOnly, true);
  assert.ok(calls.every(call => !call.url.includes('search.graph')), 'free text never sends GQL');
  const premise = gData('energy').s08.find(preset => preset.statements.some(statement => statement.expectRows === 0));
  const absence = await (await app.handle('run', post('run', gBody('energy', 'S08', premise.question)), gEnv())).json();
  assert.ok(absence.enhanced.graph.statements.some(statement => statement.outcome === 'absence'));
});

test('industry S09 reads top themes or the focus theme from the topic graph, and diversity questions compare coverage', async () => {
  const { app, calls } = graphHarness('energy');
  const [themes, focus, diversity] = ['hierarchy', 'focus', 'diversity'].map(kind => gData('energy').s09.find(preset =>
    kind === 'focus' ? preset.focusTopic : kind === 'hierarchy' ? preset.mode === 'hierarchy' && !preset.focusTopic : preset.mode === 'diversity'));
  const run = async preset => (await app.handle('run', post('run', gBody('energy', 'S09', preset.question)), gEnv())).json();
  let result = await run(themes);
  assert.equal(result.executionStatus, 'success', JSON.stringify(result).slice(0, 300));
  assert.equal(result.enhanced.themesOnly, true);
  assert.equal(result.enhanced.hits.length, 0);
  assert.equal(result.enhanced.topics.hierarchy.length, 8);
  assert.ok(result.enhanced.topics.moreRoots > 0);
  const shares = result.enhanced.topics.hierarchy.map(root => root.proportion);
  assert.deepEqual(shares, [...shares].sort((a, b) => b - a), 'largest themes first');
  assert.equal(result.baseline.hits.length, 3);
  assert.equal(JSON.parse(calls.find(call => !call.url.includes('topics')).init.body).vectorQueries[0].topicGraph.kind, 'none');
  result = await run(focus);
  assert.deepEqual(result.enhanced.topics.hierarchy.map(root => root.title), [focus.focusTopic]);
  assert.ok(result.enhanced.topics.hierarchy[0].children.length > 0);
  calls.length = 0;
  result = await run(diversity);
  assert.equal(result.enhanced.themesOnly, undefined);
  assert.equal(JSON.parse(calls.at(-1).init.body).vectorQueries[0].topicGraph.kind, calls.length === 2 ? JSON.parse(calls.at(-1).init.body).vectorQueries[0].topicGraph.kind : 'balanced');
  assert.ok(calls.some(call => JSON.parse(call.init.body).vectorQueries?.[0].topicGraph?.kind === 'balanced'));
  assert.ok(!calls.some(call => call.url.includes('topics')), 'diversity questions need no theme read');
  assert.equal(result.enhanced.topicCoverage.compact, true);
  assert.equal(result.enhanced.hits[0].topic.id, gData('energy').topics.leaves.find(leaf => leaf.title).id, 'per-passage topic from the hashed leaf map');
  assert.equal(result.enhanced.topicCoverage.covered.length, result.enhanced.topicCoverage.total);
});

test('the build pins industry graph bindings to attested ETags and requires catalog examples to match the graph contract', () => {
  const graph = { service: 'fiq-industry-test', apiVersion: '2026-11-01-preview', industries: { energy: gBinding('energy') } };
  const attested = { apiVersion: SEARCH_API_VERSION, entries: gSchemas('energy') };
  const built = industryGraphFrom(graph, attested, ['energy', 'retail'], industryGraphConfig);
  assert.deepEqual(Object.keys(built.industries), ['energy']);
  assert.equal(built.attestations.entries.length, 3);
  assert.equal(industryGraphFrom(undefined, attested, ['energy'], industryGraphConfig), undefined);
  assert.throws(() => industryGraphFrom(graph, { ...attested, entries: attested.entries.slice(1) }, ['energy'], industryGraphConfig), /graph schema attestation/);
  assert.deepEqual(industryGraphPresetProblems(industryCatalog, industryGraphConfig, ['energy']), []);
  const changed = structuredClone(industryCatalog);
  changed.industries.find(item => item.id === 'energy').presets.S08[0].query = 'A different question';
  assert.match(industryGraphPresetProblems(changed, industryGraphConfig, ['energy'])[0], /S08: catalog examples and graph-contract questions differ/);
  for (const data of Object.values(industryGraphConfig.industries)) {
    for (const preset of data.s08) for (const statement of preset.statements) assert.doesNotMatch(statement.gql, /NOT\s*\(|;/);
    assert.ok(!JSON.stringify(data).includes('blob.core.windows.net') && !JSON.stringify(data).includes('-index'), 'no storage or index names in public config');
  }
});

test('graph path rows give screen readers the path as text, not a prohibited aria-label on a plain div', () => {
  const client = readFileSync(new URL('../assets/client.mjs', import.meta.url), 'utf8');
  const start = client.indexOf('function renderPathRow(');
  const body = client.slice(start, client.indexOf('\nfunction ', start + 10));
  assert.doesNotMatch(body, /path\.setAttribute\('aria-label'/);
  assert.match(body, /path\.append\(node\('span', pathText\(statement, row\), 'sr-only'\)\)/);
  assert.match(body, /Citation unavailable/);
});
