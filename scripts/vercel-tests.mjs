import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createVercelApp } from '../lib/vercel-app.mjs';
import { liveStatus, searchOnlyFetch, attemptBudget, attestedMetadata, disabledScenarios, LIVE_SCENARIOS } from '../lib/search-adapter.mjs';
import { transformBindings, reduceAttestations } from './build-vercel.mjs';
import { SEARCH_API_VERSION, AGENTIC_SEARCH_API_VERSION } from '../config/studio-live.mjs';
import { illustrationPng } from './generate-studio.mjs';
import { retryAfterSeconds } from '../lib/studio.mjs';
import { imageOnlyQuery } from '../config/studio-languages.mjs';

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
function harness({ handler = async () => searchResponse(), schema, etag, limits, config = liveConfig, extra = [] } = {}) {
  const calls = [];
  const logs = [];
  const app = createVercelApp({ liveConfig: config, attestations: attestations(schema, etag, extra), limits, log: event => logs.push(event),
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
  assert.match(byId.S11.live.reason, /Azure Vision image encoder/);
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
    S09: { index: 'zava-studio-support', indexETag: '"s1"', projectionIndex: 'zava-studio-topics', projectionIndexETag: '"t1"', attestation },
  }, languages: {} };
  const full = { service: 'foundry-iq-demos', apiVersion: SEARCH_API_VERSION, capture: { vectorizerUpdate: { changedIndexes: ['zava-studio-products'] } },
    entries: [{ index: 'zava-studio-products', etag: '"new"', schema: {} }, { index: 'zava-studio-support', etag: '"s1"', schema: {} },
      { index: 'zava-studio-topics', etag: '"t1"', schema: {} }, { index: 'zava-studio-unused', etag: '"u"', schema: {}, usages: [] }] };
  const { config, used } = transformBindings(bindings, full);
  assert.equal(config.scenarios.S02.indexETag, '"new"');
  assert.equal(config.scenarios.S02.vector.provider, undefined);
  assert.equal(config.scenarios.S02.vector.vectorizer, 'zava-text-vectorizer');
  assert.equal(bindings.scenarios.S02.vector.provider, 'serverAzureOpenAI');
  assert.deepEqual(reduceAttestations(full, used).entries.map(entry => Object.keys(entry).join()), ['index,etag,schema', 'index,etag,schema', 'index,etag,schema']);
  full.entries[1].etag = '"drifted"';
  assert.throws(() => transformBindings(bindings, full), /Unexpected ETag drift/);
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
        subQueries: [{ iteration: 1, search: 'private planner text' }], usage: { agenticPlanningTokens: 12, reasoningTokens: 8 } } } }, 'agentic-request')
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
  assert.equal(result.enhanced.trace.configuration.agenticSearch.subQueryCount, 1);
  assert.ok(!JSON.stringify(result).includes('private planner text'));
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

test('visible copy says Foundry IQ; "Azure AI Search" appears only in title, meta and the first About mention', async () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const app = createVercelApp({ liveConfig, attestations: attestations(), log: () => {} });
  for (const language of ['en', 'fr', 'es', 'ja', 'de']) {
    const catalog = await (await app.handle('scenarios', new Request(`${ORIGIN}/api/scenarios?language=${language}`), env())).json();
    assert.ok(!JSON.stringify(catalog).includes('Azure AI Search'), language);
  }
  const body = html => html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<[^>]+>/g, ' ');
  for (const file of ['page.html', '404.html']) assert.ok(!body(read(file)).includes('Azure AI Search'), file);
  assert.match(read('page.html').match(/<head>[\s\S]*?<\/head>/)[0], /Foundry IQ \(Azure AI Search\)/);
  const about = body(read('about.html'));
  assert.equal(about.split('Azure AI Search').length - 1, 1, 'About names Azure AI Search once');
  assert.ok(about.includes('Foundry IQ (Azure AI Search)'));
  // Client strings, server messages and score labels (comments excluded).
  const literal = /(['`])[^'`\n]*Azure AI Search[^'`\n]*\1/;
  for (const file of ['assets/client.mjs', 'assets/header.mjs', 'assets/about.mjs', 'lib/studio.mjs', 'lib/vercel-app.mjs', 'lib/search-adapter.mjs', 'config/studio-scenarios.mjs']) {
    const code = read(file).split(/\r?\n/).filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
    assert.doesNotMatch(code, literal, file);
  }
  assert.ok(!read('config/studio-recorded.json').includes('Azure AI Search'), 'recorded narration');
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
        if (preset.criterion === 'graph') assert.ok(enhanced.graph?.edges?.length && !baseline.graph, key);
        else if (preset.criterion === 'row') assert.ok(Number.isInteger(enhanced.hits[0]?.row) && !Number.isInteger(baseline.hits?.[0]?.row), key);
        else {
          const delta = ndcg3(enhanced, preset) - ndcg3(baseline, preset);
          assert.ok(delta >= 0.15, `${key}: AFTER must clearly win (delta ${delta.toFixed(2)})`);
          assert.ok(ids(enhanced.hits[0]).some(id => preset.relevant.includes(id)), `${key}: AFTER #1 must be relevant`);
        }
        checked++;
      }
    }
  }
  assert.equal(checked, 220);
  assert.equal(Object.keys(notesFile.entries).length, 220);
});
