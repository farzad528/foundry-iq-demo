import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agenticSearchPayload, prepareComparison, runComparison, studioScenarios, warmAgenticSchema } from '../lib/studio.mjs';
import { HttpError } from '../lib/protocol.mjs';
import { datasetVersion, products, graph, documents } from '../config/studio-corpus.mjs';
import { SEARCH_API_VERSION, AGENTIC_SEARCH_API_VERSION, KB_API_VERSION, liveConfiguration } from '../config/studio-live.mjs';
import { buildStudio, makeManualPdf, extractManualPdf, illustrationPng, scaleTargets } from './generate-studio.mjs';

const gold = JSON.parse(readFileSync(new URL('../config/studio-gold.json', import.meta.url), 'utf8'));
const body = (scenarioId, query, extra = {}) => ({ scenarioId, mode: 'sample', query, ...extra });
const first = id => gold.find(g => g.scenarioId === id).query;
const run = (id, query = first(id), extra) => runComparison(body(id, query, extra));
const samplePath = value => value === null || /^\/samples\/zava[a-z0-9-]*\.(md|csv|pdf|svg)$/.test(value);

for (const label of gold) {
  test(`${label.scenarioId} curated ${label.category}: ${label.query}`, async () => {
    const request = body(label.scenarioId, label.query);
    const a = await runComparison(request);
    const b = await runComparison(request);
    assert.deepEqual(a, b);
    assert.equal(a.executionStatus, 'success');
    assert.equal(a.groundTruth.provenance.includes('never used'), true);
    for (const arm of [a.baseline, a.enhanced]) {
      assert.ok(arm.hits.length <= 10);
      assert.equal(arm.trace.configuration.principal, 'anonymous-synthetic');
      assert.equal(arm.trace.configuration.datasetVersion, datasetVersion);
      assert.equal(arm.trace.configuration.query, request.query);
      assert.equal(arm.trace.latencyMs, undefined);
      assert.equal(arm.usage, undefined);
      assert.match(arm.trace.steps[0], /NOT measured Azure/);
      assert.equal(new Set(arm.hits.map(h => h.id)).size, arm.hits.length);
      arm.hits.forEach((hit, i) => {
        assert.equal(hit.rank, i + 1);
        assert.ok(samplePath(hit.url));
        assert.ok(samplePath(hit.thumbnailUrl || null));
        assert.ok([...products, ...documents].some(item => item.id === hit.sourceId));
        if (hit.score != null) assert.match(hit.scoreType, /local|NOT/);
      });
      for (const citation of arm.citations || []) assert.ok(arm.hits.some(hit => hit.id === citation.id && hit.sourceId === citation.sourceId));
    }
    if (label.category === 'zero-hits' || label.category === 'permission' || label.category === 'absent-model') {
      assert.deepEqual(a.baseline.hits, []);
      assert.deepEqual(a.enhanced.hits, []);
    }
  });
}
test('eleven safe public scenarios, >= five distinct curated questions each, UI aliases', () => {
  const list = studioScenarios({ AZURE_SEARCH_API_KEY: 'do-not-disclose', STUDIO_LIVE_CONFIG: '{"secret":"do-not-disclose"}' });
  assert.equal(list.length, 11);
  for (const scenario of list) {
    assert.ok(scenario.queries.length >= 5);
    assert.equal(scenario.queries.length, new Set(scenario.queries).size);
    assert.ok(scenario.description);
    assert.equal(scenario.demoPresets.length, 4);
    assert.equal(new Set(scenario.demoPresets.map(preset => preset.label)).size, 4);
    for (const preset of scenario.demoPresets) {
      if (scenario.id !== 'S11') assert.ok(scenario.queries.includes(preset.query));
      // S11 examples use a bundled image, or text only for text-to-image search.
      else if (preset.image) assert.match(preset.image, /^\/samples\/zava-(hat-(blue|red)|bowl-blue)\.png$/);
      else assert.ok(preset.query.trim());
    }
    assert.equal(scenario.liveAvailable, false);
    assert.equal(scenario.live.status, 'unavailable');
  }
  assert.ok(list[10].demoPresets.some(preset => preset.image && !preset.query) && list[10].demoPresets.some(preset => !preset.image && preset.query));
  assert.equal(list[10].sampleImageId, 'zava-hat-blue');
  assert.ok(!JSON.stringify(list).includes('do-not-disclose'));
});
test('strict envelope, option and input allowlists reject claims, arbitrary fixtures and uploads', async () => {
  for (const extra of [
    { endpoint: 'https://evil.invalid' }, { headers: {} }, { principal: 'procurement' }, { principalContext: {} },
    { auth: 'a' }, { uploadId: 'fake' }, { sampleImageId: 'evil' }, { options: { endpoint: 'a' } },
    { options: { weight: NaN } }, { topK: 7 }, { query: 'unapproved arbitrary question' }, { query: 'x'.repeat(8001) },
  ]) await assert.rejects(runComparison({ ...body('S01', first('S01')), ...extra }), e => e instanceof HttpError && e.status === 400);
  await assert.rejects(run('S06', undefined, { options: { weight: -1 } }), /0–10/);
  await assert.rejects(run('S11', undefined, { options: { referenceId: 'photo-upload' } }), /fixed/);
  assert.equal((await run('S11', undefined, { sampleImageId: 'zava-hat-blue' })).executionStatus, 'success');
});
test('topK choices, immutable shared snapshot, exact SKU can lose on vector', async () => {
  for (const topK of [5, 10, 20, 50]) {
    const result = await run('S03', undefined, { topK });
    assert.equal(result.comparison.snapshot.topK, topK);
    assert.ok(Object.isFrozen(result.comparison.snapshot));
    assert.ok(result.baseline.hits.length <= topK && result.enhanced.hits.length <= topK);
  }
  const exact = await run('S02', 'DCD796');
  assert.equal(exact.baseline.hits[0].id, 'DRILL-1001');
  assert.deepEqual(exact.enhanced.hits, []);
  assert.equal(exact.comparison.evaluation.baseline.recallAtK, 1);
  assert.equal(exact.comparison.evaluation.enhanced.recallAtK, 0);
});
test('identical hard filters exclude expensive, wrong category, location and unavailable negatives', async () => {
  for (const id of ['S03', 'S05']) {
    const result = await run(id);
    assert.equal(result.baseline.trace.configuration.filter, result.enhanced.trace.configuration.filter);
    for (const arm of [result.baseline, result.enhanced]) for (const hit of arm.hits) {
      const item = products.find(p => p.id === hit.id);
      assert.equal(item.category, 'drill'); assert.ok(item.price < 200);
      if (id === 'S05') { assert.ok(item.stock > 0); assert.equal(item.city, 'London'); }
    }
  }
});
test('same-candidate reranking and zero-weight boosting isolate rank changes', async () => {
  const reranked = await run('S04');
  assert.deepEqual(reranked.baseline.hits.map(h => h.id).sort(), reranked.enhanced.hits.map(h => h.id).sort());
  assert.ok(reranked.enhanced.hits.every(h => h.score === undefined));
  for (const subtype of ['freshness', 'magnitude', 'distance', 'tags', 'availability']) {
    const zero = await run('S06', undefined, { options: { boostSubtype: subtype, weight: 0 } });
    assert.deepEqual(zero.baseline.hits.map(h => h.id), zero.enhanced.hits.map(h => h.id));
    const boosted = await run('S06', undefined, { options: { boostSubtype: subtype, weight: 2 } });
    assert.deepEqual(boosted.baseline.hits.map(h => h.id).sort(), boosted.enhanced.hits.map(h => h.id).sort());
  }
});
test('sourced graph stable IDs distinguish affected lots/products and same-supplier different-part negative', async () => {
  const result = await run('S08');
  assert.match(result.enhanced.answer, /DRILL-1001/);
  assert.match(result.enhanced.answer, /DRILL-1002.*not automatically affected/);
  assert.ok(!result.enhanced.graph.edges.some(edge => edge.to === 'CELL-X10'));
  for (const edge of result.enhanced.graph.edges) {
    assert.ok(graph.some(source => source.id === edge.id && source.sourceId === edge.sourceId));
    assert.ok(result.enhanced.hits.some(hit => hit.sourceId === edge.sourceId));
  }
});
test('experimental topic provenance, scope and freshness are separate from graph', async () => {
  const result = await run('S09');
  const topic = result.enhanced.topics[0];
  assert.equal(topic.revision, '2');
  assert.equal(topic.accessScope, 'public');
  assert.equal(topic.datasetVersion, datasetVersion);
  assert.equal(result.enhanced.graph, undefined);
  assert.ok(!result.enhanced.hits.some(h => h.id === 'POL-RECALL-v1'));
  topic.sourceDocumentIds.forEach(id => assert.ok(result.enhanced.hits.some(hit => hit.sourceId === id)));
});
test('exact original PDF page/row/coordinates reject adjacent value and absent model', async () => {
  assert.deepEqual(readFileSync(new URL('../samples/zava-manual.pdf', import.meta.url)), makeManualPdf());
  const derived = JSON.parse(readFileSync(new URL('../config/studio-extraction.json', import.meta.url), 'utf8'));
  assert.deepEqual(derived, extractManualPdf(makeManualPdf()));
  for (const [query, expected, row] of [[first('S10'), 13, 1], ['What is the concrete drilling diameter of DCD797?', 16, 2]]) {
    const result = await run('S10', query);
    assert.equal(result.enhanced.extractedValue, expected);
    assert.equal(result.enhanced.hits[0].row, row);
    assert.deepEqual(result.enhanced.hits[0].coordinates, { page: 2, unit: 'pt', x: 60, y: 120 + (row - 1) * 24, width: 470, height: 24 });
    assert.equal(result.comparison.evaluation.enhanced.exactTableValue, true);
    assert.equal(result.comparison.evaluation.enhanced.exactCoordinates, true);
    assert.equal(result.comparison.evaluation.baseline.exactTableValue, false);
  }
  const pdf = makeManualPdf().toString();
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.match(pdf, /\/Count 2/);
  assert.match(pdf, /60 648 470 24 re S/);
  assert.match(pdf, /60 624 470 24 re S/);
});
test('fixed illustrative image reference does not become caption/image understanding', async () => {
  const result = await run('S11', 'Find a blue bowl, not a hat');
  assert.equal(result.enhanced.hits[0].id, 'HAT-001'); // Fixed reference can lose to query metadata.
  assert.equal(result.comparison.evaluation.enhanced.mrr < result.comparison.evaluation.baseline.mrr, true);
  assert.match(result.enhanced.trace.steps.join(' '), /not an image encoder/);
});

function liveEnv(id = 'S01', patch = {}) {
  const vector = { field: 'contentVector', profile: 'v-profile', vectorizer: 'v-encoder', deployment: 'embed-deployment',
    model: 'text-embedding-3-small', modelVersion: '1', dimensions: 6 };
  const config = { index: 'zava-index', indexETag: '"v1"',
    attestation: { checkedAt: '2026-11-23', region: 'test-region', evidenceVersion: 'schema-v1' }, synonymMaps: ['zava-synonyms'],
    ...(['S02', 'S03', 'S04', 'S05', 'S06', 'S07'].includes(id) ? { vector } : {}),
    ...(id === 'S04' ? { semantic: { configuration: 'zava-semantic', carrier: 'keyword-id' } } : {}),
    ...(id === 'S11' ? { image: { provider: 'azureVision', field: 'imageVector', profile: 'image-profile',
      model: 'azure-vision-multimodal', modelVersion: '2023-04-15', dimensions: 1024,
      corpus: { model: 'azure-vision-multimodal', modelVersion: '2023-04-15', dimensions: 1024, manifestHash: 'a'.repeat(64) } } } : {}),
    ...(id === 'S08' ? { nativeGraph: { dataset: 'zava-retail-en', language: 'en', apiVersion: AGENTIC_SEARCH_API_VERSION, vectorField: 'snippet_vector', timeoutMs: 10000,
      graphIndex: 'zava-graph', graphIndexETag: '"g1"', semanticConfiguration: 'zava-semantic' } } : {}),
    ...(id === 'S09' ? { nativeGraph: { dataset: 'zava-retail-en', language: 'en', apiVersion: AGENTIC_SEARCH_API_VERSION, vectorField: 'snippet_vector', timeoutMs: 10000,
      topicIndex: 'zava-topics', topicIndexETag: '"t1"' } } : {}),
    ...(id === 'S07' ? { agentic: { apiVersion: AGENTIC_SEARCH_API_VERSION, maxRuntimeInSeconds: 30, knowledgeRetrievalPlan: 'standard' },
      answer: { deployment: 'answer-deployment', modelVersion: '1', instructionsVersion: 'studio-grounded-answer-v1' } } : {}),
    ...patch };
  return { FOUNDRY_IQ_LIVE_ENABLED: 'true', AZURE_SEARCH_ENDPOINT: 'https://zava-demo.search.windows.net',
    AZURE_SEARCH_API_KEY: 'private-search-key', STUDIO_ANSWER_ENDPOINT: 'https://zava-demo.openai.azure.com',
    STUDIO_ANSWER_API_KEY: 'private-answer-key',
    STUDIO_IMAGE_ENDPOINT: 'https://zava-demo.cognitiveservices.azure.com', STUDIO_IMAGE_API_KEY: 'private-image-key',
    STUDIO_LIVE_CONFIG: JSON.stringify({ datasetVersion, resourceVersion: 'schema-v1', scenarios: { [id]: config } }) };
}
function indexSchema() {
  return { name: 'zava-index', description: `Zava Studio synthetic dataset ${datasetVersion}; encoder=text-embedding-3-small@1; dimensions=6`, fields: [
    { name: 'id', type: 'Edm.String', key: true, sortable: true, filterable: true },
    ...['title', 'content'].map(name => ({ name, type: 'Edm.String', searchable: true, synonymMaps: ['zava-synonyms'] })),
    { name: 'url', type: 'Edm.String' }, { name: 'scope', type: 'Edm.String', filterable: true },
    { name: 'category', type: 'Edm.String', filterable: true, facetable: true },
    { name: 'price', type: 'Edm.Double', filterable: true }, { name: 'stock', type: 'Edm.Int32', filterable: true },
    { name: 'city', type: 'Edm.String', filterable: true },
    { name: 'contentVector', type: 'Collection(Edm.Single)', searchable: true, dimensions: 6, vectorSearchProfile: 'v-profile' },
  ], vectorSearch: { profiles: [{ name: 'v-profile', vectorizer: 'v-encoder' }],
    vectorizers: [{ name: 'v-encoder', kind: 'azureOpenAI', azureOpenAIParameters: {
      deploymentId: 'embed-deployment', modelName: 'text-embedding-3-small', resourceUri: 'https://zava-demo.openai.azure.com',
    } }] } };
}
const response = (value, etag, status = 200) => new Response(JSON.stringify(Array.isArray(value?.value) ? { '@odata.count': value.value.length, ...value } : value), { status, headers: { ...(etag ? { etag } : {}), 'x-ms-request-id': 'real-service-request' } });
const searchDoc = (id = 'DRILL-1001', content = 'DCD796 drill') => ({ id, title: 'DCD796 drill', content, url: '/samples/zava-support.md', scope: 'public', '@search.score': 3.2 });
function harness(env, handler = async (url, request) => {
  if (request.method === 'GET') return response(indexSchema(), '"v1"');
  return response({ value: [searchDoc()] });
}) {
  const attempts = [], releases = [], calls = [];
  return { env, attempts, releases, calls,
    reserveAttempt: async () => { const token = `attempt-${attempts.length}`; attempts.push(token); return token; },
    releaseAttempt: async token => { releases.push(token); },
    fetchUpstream: async (url, request) => { calls.push({ url, request }); return handler(url, request); } };
}
const liveRun = (id, helpers, query = first(id)) => runComparison({ scenarioId: id, mode: 'live', query }, helpers);
test('live disabled/config unavailable/credential endpoint guards never call HTTP', async () => {
  for (const env of [{}, { ...liveEnv('S04'), STUDIO_LIVE_CONFIG: '{}' }, { ...liveEnv(), AZURE_SEARCH_ENDPOINT: 'https://evil.invalid' },
    { ...liveEnv(), AZURE_SEARCH_ENDPOINT: 'https://zava-demo.search.windows.net/path' },
    { ...liveEnv(), FOUNDRY_IQ_KILL_SWITCH: 'true' }, { ...liveEnv(), FOUNDRY_IQ_LIVE_ENABLED: 'false' }]) {
    const helpers = harness(env);
    await assert.rejects(liveRun(env === undefined ? 'S04' : 'S01', helpers), e => e.status === 503);
    assert.deepEqual(helpers.attempts, []);
  }
  assert.equal(liveConfiguration({ ...liveEnv('S11'), STUDIO_IMAGE_ENDPOINT: undefined }, 'S11').available, false);
  await assert.rejects(liveRun('S01', { env: liveEnv() }), /reservation/);
});
test('live Search per-attempt quota, canonical endpoint, pinned API and no telemetry leakage', async () => {
  const helpers = harness(liveEnv());
  const result = await liveRun('S01', helpers, 'DCD796 drill');
  assert.equal(result.executionStatus, 'success');
  assert.equal(helpers.attempts.length, 3);
  assert.deepEqual(helpers.attempts.sort(), helpers.releases.sort());
  assert.equal(result.groundTruth, undefined);
  assert.equal(result.comparison.evaluation.baseline, null);
  assert.ok(helpers.calls.every(c => c.url.startsWith('https://zava-demo.search.windows.net/') && c.url.endsWith(SEARCH_API_VERSION)));
  assert.ok(!JSON.stringify(result).includes('private-search-key'));
  assert.ok(!JSON.stringify(studioScenarios(liveEnv())).includes('private-search-key'));
  assert.equal(result.baseline.hits[0].score, undefined);
  assert.equal(result.enhanced.hits[0].scoreType, 'Foundry IQ keyword score (BM25)');
});
test('independent live arms retain partial success and no success-shaped fixture fallback', async () => {
  const helpers = harness(liveEnv(), async (url, request) => {
    if (request.method === 'GET') return response(indexSchema(), '"v1"');
    if (JSON.parse(request.body).search !== '*') return response({ error: { message: 'private-search-key' } }, null, 503);
    return response({ value: [searchDoc()] });
  });
  const result = await liveRun('S01', helpers, 'DCD796 drill');
  assert.equal(result.executionStatus, 'partial_success');
  assert.equal(result.baseline.status, 'success');
  assert.equal(result.enhanced.status, 'error');
  assert.equal(result.enhanced.error.code, 'studio_upstream_failed');
  assert.equal(result.enhanced.error.upstreamStatus, 503);
  assert.equal(result.enhanced.error.upstreamRequestId, 'real-service-request');
  assert.match(result.enhanced.error.message, /Try Search again/);
  assert.deepEqual(result.enhanced.hits, []);
  assert.ok(!JSON.stringify(result).includes('private-search-key'));
  assert.equal(helpers.attempts.length, 3);
  assert.equal(helpers.releases.length, 3);
});
test('zero live hits, unsafe URLs, redaction and duplicate/missing evidence are honest', async () => {
  for (const value of [[], [searchDoc('id', 'No matches')]]) {
    if (value.length) value[0].url = 'javascript:alert(1)';
    const helpers = harness(liveEnv(), async (url, request) => request.method === 'GET' ? response(indexSchema(), '"v1"') : response({ value }));
    const result = await liveRun('S01', helpers, 'No matches');
    assert.equal(result.executionStatus, 'success');
    if (value.length) assert.equal(result.enhanced.hits[0].url, null);
    else assert.deepEqual(result.enhanced.hits, []);
  }
  for (const value of [[{ ...searchDoc(), id: undefined }], [searchDoc(), searchDoc()], [{ ...searchDoc(), scope: 'procurement' }]]) {
    const helpers = harness(liveEnv(), async (url, request) => request.method === 'GET' ? response(indexSchema(), '"v1"') : response({ value }));
    assert.equal((await liveRun('S01', helpers)).executionStatus, 'error');
    assert.equal(helpers.attempts.length, helpers.releases.length);
  }
});
test('vector schema/model/encoder mismatches fail closed before retrieval', async () => {
  for (const mutate of [
    schema => { schema.fields.at(-1).dimensions = 7; },
    schema => { schema.vectorSearch.vectorizers[0].kind = 'imageEncoder'; },
    schema => { schema.vectorSearch.vectorizers[0].azureOpenAIParameters.modelName = 'different-model'; },
    schema => { schema.vectorSearch.vectorizers[0].azureOpenAIParameters.resourceUri = 'http://localhost'; },
  ]) {
    const schema = indexSchema(); mutate(schema);
    const helpers = harness(liveEnv('S02'), async () => response(schema, '"v1"'));
    const result = await liveRun('S02', helpers);
    assert.equal(result.executionStatus, 'error');
    assert.equal(result.baseline.error.code, 'studio_schema_unverified');
    assert.equal(helpers.attempts.length, 1);
    assert.equal(helpers.releases.length, 1);
  }
});
test('live vector query actually uses reviewed integrated text vectorizer, no fake vectors', async () => {
  const helpers = harness(liveEnv('S02'));
  const result = await liveRun('S02', helpers);
  assert.equal(result.executionStatus, 'success');
  const requests = helpers.calls.filter(call => call.request.method === 'POST').map(call => JSON.parse(call.request.body));
  assert.equal(requests[1].vectorQueries[0].kind, 'text');
  assert.equal(requests[1].vectorQueries[0].vector, undefined);
  assert.equal(requests[1].search, undefined);
});
test('pre-cancelled and in-flight cancellation release leases and bound hanging fetch', async () => {
  const controller = new AbortController(); controller.abort();
  const cancelled = await runComparison(body('S01', first('S01')), { signal: controller.signal });
  assert.equal(cancelled.executionStatus, 'cancelled');
  const inFlight = new AbortController();
  const helpers = harness(liveEnv(), async () => {
    setTimeout(() => inFlight.abort(), 10);
    return new Promise(() => {});
  });
  const result = await liveRun('S01', { ...helpers, signal: inFlight.signal });
  assert.equal(result.executionStatus, 'cancelled');
  assert.equal(helpers.attempts.length, 1);
  assert.equal(helpers.releases.length, 1);
  const late = new AbortController(), released = [];
  const lateResult = await liveRun('S01', { env: liveEnv(), signal: late.signal,
    reserveAttempt: () => new Promise(resolve => { setTimeout(() => late.abort(), 1); setTimeout(() => resolve('late'), 10); }),
    releaseAttempt: async token => { released.push(token); }, fetchUpstream: () => assert.fail('No HTTP after cancellation') });
  assert.equal(lateResult.executionStatus, 'cancelled');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(released, ['late']);
});
test('streaming response byte bound rejects >1MiB and releases each attempt without retries', async () => {
  const helpers = harness(liveEnv(), async (url, request) => request.method === 'GET'
    ? response(indexSchema(), '"v1"') : new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024)); controller.enqueue(new Uint8Array(1)); controller.close();
    } })));
  const result = await liveRun('S01', helpers);
  assert.equal(result.executionStatus, 'error');
  assert.equal(result.enhanced.error.code, 'body_too_large');
  assert.equal(helpers.attempts.length, 3);
  assert.equal(helpers.releases.length, 3);
});
function kbResponse() {
  const ids = ['INC-2026-017', 'BOM-2026-01', 'SUP-BUL-017'];
  return { response: [{ content: [{ type: 'text', text: '[ref_id:0] evidence' }] }],
    references: ids.map((id, i) => ({ id: String(i), activitySource: '10', knowledgeSourceName: 'zava-source', docKey: id,
      sourceData: { scope: 'public', title: id, content: documents.find(d => d.id === id).snippet, url: '/samples/zava-support.md' } })),
    activity: [{ id: '10', type: 'searchIndex', knowledgeSourceName: 'zava-source' }] };
}
function agenticResponse(terminationReason = 'modelStopped') {
  return { value: ['INC-2026-017', 'BOM-2026-01', 'SUP-BUL-017'].map(id => ({
    ...searchDoc(id, documents.find(document => document.id === id).snippet), sourceId: id,
  })), '@search.debug': { agentic: { terminationReason,
    subQueries: [{ iteration: 1, search: 'synthetic public evidence' }],
    usage: { agenticPlanningTokens: 12, reasoningTokens: 34 } } } };
}
test('S07 uses exact SAME answer model/instructions, controlled retrieval and checked citations', async () => {
  const helpers = harness(liveEnv('S07'), async (url, request) => {
    if (request.method === 'GET') return url.includes('knowledgebases') ? response({ name: 'zava-kb', knowledgeSources: [{ name: 'zava-source' }] }, '"kb1"') : response(indexSchema(), '"v1"');
    if (url.includes('chat/completions')) {
      const evidence = JSON.parse(JSON.parse(request.body).messages[1].content).evidence;
      return response({ choices: [{ message: { content: JSON.stringify({ answer: `Conditional assessment [${evidence[0].id}]` }) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    }
    if (JSON.parse(request.body).queryType === 'agentic') return response(agenticResponse());
    return response({ value: [searchDoc('POL-RET-2026-01', 'Ordinary returns within 30 days.')] });
  });
  const result = await liveRun('S07', helpers);
  assert.equal(result.executionStatus, 'success');
  assert.match(result.comparison.intendedDifference, /same model and instructions/);
  assert.ok(!result.comparison.intendedDifference.includes('not an LLM'));
  const answers = helpers.calls.filter(call => call.url.includes('chat/completions'));
  assert.equal(answers.length, 2);
  const generations = answers.map(call => JSON.parse(call.request.body));
  assert.deepEqual(generations[0].messages[0], generations[1].messages[0]);
  const inputs = generations.map(generation => JSON.parse(generation.messages[1].content));
  assert.ok(inputs.every(input => !Object.hasOwn(input, 'arms')));
  assert.deepEqual(inputs[0].evidence.map(hit => hit.id), result.baseline.hits.map(hit => hit.id));
  assert.deepEqual(inputs[1].evidence.map(hit => hit.id), result.enhanced.hits.map(hit => hit.id));
  for (const [index, arm] of [result.baseline, result.enhanced].entries()) {
    assert.deepEqual(inputs[index].evidence.map(({ id, title, sourceId }) => ({ id, title, sourceId })),
      arm.hits.map(({ id, title, sourceId }) => ({ id, title, sourceId })));
  }
  const agentic = helpers.calls.find(call => call.request.body && JSON.parse(call.request.body).queryType === 'agentic');
  assert.ok(agentic.url.endsWith(AGENTIC_SEARCH_API_VERSION));
  assert.deepEqual(JSON.parse(agentic.request.body), agenticSearchPayload(
    { query: first('S07'), topK: 10 }, JSON.parse(helpers.env.STUDIO_LIVE_CONFIG).scenarios.S07, new Map(indexSchema().fields.map(field => [field.name, field]))));
  assert.ok(!helpers.calls.some(call => call.url.includes('knowledgebases') || call.url.includes('retrieve')));
  assert.equal(result.enhanced.trace.configuration.agenticSearch.subQueryCount, 1);
  assert.deepEqual(result.enhanced.trace.configuration.agenticSearch.usage, { agenticPlanningTokens: 12, reasoningTokens: 34 });
  assert.deepEqual(result.enhanced.trace.configuration.agenticSearch.subQueries, [{ iteration: 1, search: 'synthetic public evidence' }]);
  assert.equal(result.baseline.usage.total_tokens, 15);
  assert.equal(result.enhanced.usage.total_tokens, 15);
  assert.match(result.baseline.usage.source, /this arm/);
  assert.equal(helpers.attempts.length, 5);
  assert.equal(helpers.releases.length, 5);
});
test('S07 rejects Free/unknown retrieval plans and old KB-only bindings before any Azure request', async () => {
  for (const agentic of [
    { apiVersion: AGENTIC_SEARCH_API_VERSION, maxRuntimeInSeconds: 30, knowledgeRetrievalPlan: 'free' },
    { apiVersion: SEARCH_API_VERSION, maxRuntimeInSeconds: 30, knowledgeRetrievalPlan: 'standard' },
    undefined,
  ]) {
    const helpers = harness(liveEnv('S07', { agentic }));
    await assert.rejects(() => liveRun('S07', helpers), error => error.status === 503 && error.code === 'studio_capability_unavailable');
    assert.equal(helpers.calls.length, 0);
    assert.equal(helpers.attempts.length, 0);
  }
});
test('S07 preserves real partial agentic evidence and rejects non-agentic diagnostics or HTTP402 without fallback', async () => {
  for (const state of ['partial-http', 'maxRuntimeExceeded', 'modelFailed', 'missing-debug', 'payment-required']) {
    const helpers = harness(liveEnv('S07'), async (url, request) => {
      if (request.method === 'GET') return response(indexSchema(), '"v1"');
      const payload = JSON.parse(request.body);
      if (url.includes('chat/completions')) {
        const evidence = JSON.parse(payload.messages[1].content).evidence;
        return response({ choices: [{ message: { content: JSON.stringify({ answer: `Conditional assessment [${evidence[0].id}]` }) } }] });
      }
      if (payload.queryType !== 'agentic') return response({ value: [searchDoc('POL-RET-2026-01')] });
      assert.equal(url, `https://zava-demo.search.windows.net/indexes/zava-index/docs/search?api-version=${AGENTIC_SEARCH_API_VERSION}`);
      assert.deepEqual(Object.keys(payload).sort(), ['agenticOptions', 'debug', 'filter', 'queryType', 'search', 'select', 'top']);
      if (state === 'payment-required') return response({ error: { code: 'PaymentRequired', message: 'Paid plan required.' } }, null, 402);
      if (state === 'missing-debug') return response({ value: [searchDoc()] });
      return response(agenticResponse(state === 'partial-http' ? 'modelStopped' : state), null, state === 'partial-http' ? 206 : 200);
    });
    const result = await liveRun('S07', helpers);
    assert.equal(result.executionStatus, 'partial_success');
    assert.equal(result.baseline.status, 'success');
    const incomplete = ['partial-http', 'maxRuntimeExceeded', 'modelFailed'].includes(state);
    assert.equal(result.enhanced.status, incomplete ? 'partial' : 'error');
    assert.equal(result.enhanced.hits.length > 0, incomplete);
    assert.ok(!helpers.calls.some(call => call.url.includes('knowledgebases') || call.url.includes('retrieve')));
    assert.equal(helpers.calls.filter(call => call.request.body && JSON.parse(call.request.body).queryType === 'agentic').length, 1);
    assert.equal(helpers.attempts.length, helpers.releases.length);
  }
});
test('deterministic dev/full manifests attain corpus scale, include original assets and never fabricate embeddings', () => {
  const image = illustrationPng();
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(image.readUInt32BE(16), 240);
  assert.equal(image.readUInt32BE(20), 180);
  assert.notDeepEqual(image, illustrationPng(3));
  for (const scale of ['dev', 'full']) {
    const a = buildStudio(scale), b = buildStudio(scale);
    assert.ok(a.records.images.every(item => item.mimeType === 'image/png' && item.path.endsWith('.png')));
    assert.equal(a.records.images[0].productId, 'HAT-001');
    assert.equal(a.records.images[3].productId, 'BOWL-001');
    assert.deepEqual(a.manifest, b.manifest);
    for (const [kind, count] of Object.entries(scaleTargets[scale])) assert.equal(a.records[kind].length, count);
    assert.equal(a.manifest.indexed, false);
    assert.match(a.manifest.embeddings, /none/);
    assert.equal(a.records.contracts[0].scope, 'procurement');
    assert.deepEqual(a.records.incidents[0].lotIds, ['LOT-2407-A', 'LOT-2407-B']);
    assert.equal(a.gold.length, gold.length);
  }
});

function semanticSchema() {
  const schema = indexSchema();
  Object.assign(schema.fields[0], { searchable: true, filterable: true, analyzer: 'keyword' });
  schema.semantic = { configurations: [{ name: 'zava-semantic', prioritizedFields: {
    titleField: { fieldName: 'title' }, prioritizedContentFields: [{ fieldName: 'content' }],
  } }] };
  return schema;
}
test('S04 executes ONE shared hybrid set and a non-wildcard semantic-only L2 request over exact IDs', async () => {
  const candidates = [searchDoc('DRILL-1001'), searchDoc('DRILL-1002', 'Compact home drill')];
  const helpers = harness(liveEnv('S04'), async (url, request) => {
    if (request.method === 'GET') return response(semanticSchema(), '"v1"');
    const payload = JSON.parse(request.body);
    return payload.semanticQuery ? response({ value: [...candidates].reverse().map(hit => ({ ...hit, '@search.rerankerScore': 3.5 })) })
      : response({ value: candidates });
  });
  const result = await liveRun('S04', helpers);
  assert.equal(result.executionStatus, 'success');
  assert.deepEqual(result.baseline.hits.map(hit => hit.id), ['DRILL-1001', 'DRILL-1002']);
  assert.deepEqual(result.enhanced.hits.map(hit => hit.id), ['DRILL-1002', 'DRILL-1001']);
  assert.ok([...result.baseline.hits, ...result.enhanced.hits].every(hit => hit.score === undefined && hit.scoreType === undefined));
  const searches = helpers.calls.filter(call => call.request.method === 'POST').map(call => JSON.parse(call.request.body));
  assert.equal(searches.length, 2);
  assert.equal(searches.filter(payload => payload.vectorQueries).length, 1);
  assert.equal(searches[1].queryType, 'full');
  assert.notEqual(searches[1].search, '*');
  assert.equal(searches[1].semanticQuery, first('S04'));
  assert.equal(searches[1].vectorQueries, undefined);
  assert.match(searches[1].filter, /id eq 'DRILL-1001'.*id eq 'DRILL-1002'/);
  assert.equal(helpers.attempts.length, 3);
  assert.equal(helpers.releases.length, 3);
});
test('S04 exact membership/content, actual semantic scores, keyword ID prerequisites and zero-candidate behavior', async () => {
  const original = [searchDoc('a'), searchDoc('b')];
  for (const value of [
    [{ ...original[0], '@search.rerankerScore': 1 }],
    [...original.map(item => ({ ...item, '@search.rerankerScore': 1 })), { ...searchDoc('intruder'), '@search.rerankerScore': 1 }],
    original.map(item => ({ ...item, '@search.rerankerScore': undefined })),
    original.map(item => ({ ...item, content: 'changed snapshot content', '@search.rerankerScore': 1 })),
  ]) {
    const helpers = harness(liveEnv('S04'), async (url, request) => request.method === 'GET' ? response(semanticSchema(), '"v1"')
      : response({ value: JSON.parse(request.body).semanticQuery ? value : original }));
    const result = await liveRun('S04', helpers);
    assert.equal(result.executionStatus, 'partial_success');
    assert.equal(result.baseline.status, 'success');
    assert.equal(result.enhanced.status, 'error');
    assert.deepEqual(result.enhanced.hits, []);
    assert.equal(helpers.attempts.length, helpers.releases.length);
  }
  const unsupported = harness(liveEnv('S04')); // ID is not searchable keyword/analyzer-attested.
  assert.equal((await liveRun('S04', unsupported)).executionStatus, 'error');
  assert.equal(unsupported.attempts.length, 1);
  const empty = harness(liveEnv('S04'), async (url, request) => request.method === 'GET' ? response(semanticSchema(), '"v1"') : response({ value: [] }));
  const result = await liveRun('S04', empty);
  assert.equal(result.executionStatus, 'success');
  assert.deepEqual(result.enhanced.hits, []);
  assert.equal(empty.attempts.length, 2);
});
test('S04 malicious opaque IDs cannot escape the fixed candidate filter/Lucene terms', async () => {
  const id = "a' OR evil:*";
  const candidate = { ...searchDoc(id), '@search.rerankerScore': 1 };
  const helpers = harness(liveEnv('S04'), async (url, request) => request.method === 'GET' ? response(semanticSchema(), '"v1"') : response({ value: [candidate] }));
  const result = await liveRun('S04', helpers);
  assert.equal(result.executionStatus, 'success');
  const payload = JSON.parse(helpers.calls.at(-1).request.body);
  assert.equal(payload.filter, "scope eq 'public' and (id eq 'a'' OR evil:*')");
  assert.equal(payload.search, 'id:"a\' OR evil\\:\\*"');
});
const pngImage = {
  mimeType: 'image/png',
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=',
};
function imageSchema() {
  const schema = indexSchema();
  schema.fields.push(
    { name: 'imageVector', type: 'Collection(Edm.Single)', dimensions: 1024, searchable: true, vectorSearchProfile: 'image-profile' },
    ...['imageModel', 'imageModelVersion', 'imageManifestHash'].map(name => ({ name, type: 'Edm.String', filterable: true })),
    { name: 'imageDimensions', type: 'Edm.Int32', filterable: true },
    { name: 'thumbnailUrl', type: 'Edm.String', retrievable: true },
  );
  schema.vectorSearch.profiles.push({ name: 'image-profile' });
  return schema;
}
const imageDoc = () => ({ ...searchDoc('HAT-001', 'Original illustrative blue hat'), imageModel: 'azure-vision-multimodal',
  imageModelVersion: '2023-04-15', imageDimensions: 1024, imageManifestHash: 'a'.repeat(64),
  thumbnailUrl: '/samples/zava-hat-blue.svg' });
const imageRun = helpers => runComparison({ scenarioId: 'S11', mode: 'live', query: 'Blue hat', imageInput: pngImage }, helpers);
function imageHarness(mutateEncoder, mutateSchema, mutateHit) {
  return harness(liveEnv('S11'), async (url, request) => {
    if (request.method === 'GET') {
      const schema = imageSchema(); mutateSchema?.(schema);
      return response(schema, '"v1"');
    }
    if (url.includes('vectorizeImage')) {
      const encoded = { modelVersion: '2023-04-15', vector: Array(1024).fill(0.01) };
      mutateEncoder?.(encoded);
      return response(encoded);
    }
    const hit = imageDoc(); mutateHit?.(hit);
    return response({ value: [hit] });
  });
}
test('S11 executable binary Azure Vision encoder -> compatible raw image-vector Search, ephemeral and quota-metered', async () => {
  const helpers = imageHarness();
  const result = await imageRun(helpers);
  assert.equal(result.executionStatus, 'success');
  assert.equal(helpers.attempts.length, 4);
  assert.equal(helpers.releases.length, 4);
  const encoder = helpers.calls.find(call => call.url.includes('vectorizeImage'));
  assert.equal(encoder.url, 'https://zava-demo.cognitiveservices.azure.com/computervision/retrieval:vectorizeImage?api-version=2024-02-01&model-version=2023-04-15');
  assert.equal(encoder.request.headers['Ocp-Apim-Subscription-Key'], 'private-image-key');
  assert.equal(encoder.request.headers['content-type'], 'application/octet-stream');
  assert.deepEqual(encoder.request.body, Buffer.from(pngImage.base64, 'base64'));
  const searches = helpers.calls.filter(call => call.url.includes('/docs/search')).map(call => JSON.parse(call.request.body));
  const vectorRequest = searches.find(payload => payload.vectorQueries);
  assert.equal(vectorRequest.search, undefined);
  assert.equal(vectorRequest.vectorQueries[0].kind, 'vector');
  assert.equal(vectorRequest.vectorQueries[0].fields, 'imageVector');
  assert.equal(vectorRequest.vectorQueries[0].vector.length, 1024);
  assert.deepEqual(searches[0].filter, searches[1].filter);
  assert.match(vectorRequest.filter, /imageModelVersion eq '2023-04-15'/);
  assert.ok(!JSON.stringify(result).includes(pngImage.base64));
  assert.ok(!JSON.stringify(result).includes('private-image-key'));
  assert.equal(result.enhanced.hits[0].scoreType, 'Foundry IQ vector similarity');
  const info = studioScenarios(liveEnv('S11')).find(scenario => scenario.id === 'S11');
  assert.equal(info.liveAvailable, true);
  assert.equal(info.imageInput.maxBytes, 40960);
  assert.equal(info.imageInput.ephemeral, true);
});
test('S11 MIME signatures, strict base64, envelope size, inline-only scope and origin allowlist fail before HTTP', async () => {
  for (const imageInput of [
    { ...pngImage, mimeType: 'image/jpeg' }, { mimeType: 'image/svg+xml', base64: pngImage.base64 },
    { ...pngImage, base64: `${pngImage.base64}\n` }, { mimeType: 'image/png', base64: Buffer.from('not-an-image').toString('base64') },
    { ...pngImage, endpoint: 'https://evil.invalid' }, { ...pngImage, base64: Buffer.alloc(40961).toString('base64') },
  ]) {
    const helpers = imageHarness();
    await assert.rejects(runComparison({ scenarioId: 'S11', mode: 'live', query: 'Blue hat', imageInput }, helpers), e => e.status === 400);
    assert.equal(helpers.attempts.length, 0);
  }
  const large = { ...pngImage, base64: Buffer.alloc(40960).toString('base64') };
  await assert.rejects(runComparison({ scenarioId: 'S11', mode: 'live', query: '字'.repeat(8000), imageInput: large }, imageHarness()), e => e.status === 413);
  await assert.rejects(runComparison(body('S11', first('S11'), { imageInput: pngImage })), /only for Live S11/);
  await assert.rejects(runComparison({ scenarioId: 'S01', mode: 'live', query: 'drill', imageInput: pngImage }, harness(liveEnv())), /only for Live S11/);
  for (const endpoint of ['https://evil.invalid', 'http://zava-demo.cognitiveservices.azure.com', 'https://zava-demo.cognitiveservices.azure.com/path', 'https://user:key@zava-demo.cognitiveservices.azure.com']) {
    const helpers = imageHarness(); helpers.env.STUDIO_IMAGE_ENDPOINT = endpoint;
    await assert.rejects(imageRun(helpers), e => e.status === 503);
    assert.equal(helpers.attempts.length, 0);
  }
});
test('S11 model/version/dimension, corpus metadata and returned embedding mismatches fail without text fallback', async () => {
  for (const mutate of [
    encoded => { encoded.modelVersion = '2022-04-11'; },
    encoded => { encoded.vector.pop(); },
    encoded => { encoded.vector[0] = null; },
    encoded => { encoded.vector = 'caption pretending to be vector'; },
  ]) {
    const helpers = imageHarness(mutate);
    const result = await imageRun(helpers);
    assert.equal(result.executionStatus, 'partial_success');
    assert.equal(result.enhanced.error.code, 'studio_image_encoder_mismatch');
    assert.equal(helpers.calls.filter(call => call.url.includes('/docs/search')).length, 1);
    assert.equal(helpers.attempts.length, helpers.releases.length);
  }
  const schemaMismatch = imageHarness(null, schema => { schema.fields.find(field => field.name === 'imageVector').dimensions = 6; });
  assert.equal((await imageRun(schemaMismatch)).executionStatus, 'error');
  assert.equal(schemaMismatch.attempts.length, 1);
  const hitMismatch = imageHarness(null, null, hit => { hit.imageModelVersion = '2022-04-11'; });
  assert.equal((await imageRun(hitMismatch)).executionStatus, 'error');
  const configMismatch = imageHarness();
  const config = JSON.parse(configMismatch.env.STUDIO_LIVE_CONFIG);
  config.scenarios.S11.image.corpus.modelVersion = '2022-04-11';
  configMismatch.env.STUDIO_LIVE_CONFIG = JSON.stringify(config);
  await assert.rejects(imageRun(configMismatch), e => e.status === 503);
  assert.equal(configMismatch.attempts.length, 0);
});
test('S11 encoder HTTP failure and cancellation preserve independent baseline without retries', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    const helpers = harness(liveEnv('S11'), async (url, request) => {
      if (request.method === 'GET') return response(imageSchema(), '"v1"');
      if (url.includes('vectorizeImage')) {
        if (cancel) { setTimeout(() => controller.abort(), 5); return new Promise(() => {}); }
        return response({ error: 'encoder unavailable' }, null, 429);
      }
      return response({ value: [imageDoc()] });
    });
    const result = await imageRun({ ...helpers, signal: controller.signal });
    assert.equal(result.executionStatus, 'partial_success');
    assert.equal(result.baseline.status, 'success');
    assert.equal(result.enhanced.status, cancel ? 'cancelled' : 'error');
    assert.equal(helpers.attempts.length, 3);
    assert.equal(helpers.releases.length, 3);
  }
});
test('S07 preserves independent evidence contexts when cold metadata leaves only four execution attempts', async () => {
  const helpers = harness(liveEnv('S07'), async (url, request) => {
    if (request.method === 'GET') return url.includes('knowledgebases') ? response({ name: 'zava-kb', knowledgeSources: [{ name: 'zava-source' }] }, '"kb1"') : response(indexSchema(), '"v1"');
    if (JSON.parse(request.body).queryType === 'agentic') return response(agenticResponse());
    if (url.includes('chat/completions')) {
      const evidence = JSON.parse(JSON.parse(request.body).messages[1].content).evidence;
      return response({ choices: [{ message: { content: JSON.stringify({ answer: `Assessment required [${evidence[0].id}]` }) } }] });
    }
    return response({ value: [searchDoc('POL-RET-2026-01')] });
  });
  const originalReserve = helpers.reserveAttempt;
  helpers.reserveAttempt = async () => {
    if (helpers.attempts.length >= 4) throw new HttpError(429, 'quota_exceeded', 'Cold metadata consumed the remaining attempt.');
    return originalReserve();
  };
  const result = await liveRun('S07', helpers);
  assert.equal(result.executionStatus, 'partial_success');
  assert.equal(result.baseline.status, 'success');
  assert.ok(result.baseline.answer);
  assert.ok(result.baseline.hits.length);
  assert.equal(result.enhanced.status, 'partial');
  assert.equal(result.enhanced.answer, undefined);
  assert.equal(result.enhanced.error.code, 'quota_exceeded');
  assert.equal(helpers.attempts.length, 4);
  assert.equal(helpers.releases.length, 4);
});
test('S07 independent generation failure retains only live retrieved evidence, not fixture/generated success', async () => {
  const helpers = harness(liveEnv('S07'), async (url, request) => {
    if (request.method === 'GET') return url.includes('knowledgebases') ? response({ name: 'zava-kb', knowledgeSources: [{ name: 'zava-source' }] }, '"kb1"') : response(indexSchema(), '"v1"');
    if (JSON.parse(request.body).queryType === 'agentic') return response(agenticResponse());
    if (url.includes('chat/completions')) return response({ error: 'unsupported JSON generation mode' }, null, 400);
    return response({ value: [searchDoc('POL-RET-2026-01')] });
  });
  const result = await liveRun('S07', helpers);
  assert.equal(result.executionStatus, 'partial_success');
  for (const arm of [result.baseline, result.enhanced]) {
    assert.equal(arm.status, 'partial');
    assert.ok(arm.hits.length);
    assert.equal(arm.answer, undefined);
    assert.equal(arm.usage, undefined);
  }
  assert.equal(helpers.attempts.length, 5);
});

test('S07 grouped exact citations normalize without guessing IDs; rejected output retains actual metered usage', async () => {
  for (const invalid of [false, true]) {
    const helpers = harness(liveEnv('S07'), async (url, request) => {
      if (request.method === 'GET') return url.includes('knowledgebases')
        ? response({ name: 'zava-kb', knowledgeSources: [{ name: 'zava-source' }] }, '"kb1"') : response(indexSchema(), '"v1"');
      if (JSON.parse(request.body).queryType === 'agentic') return response(agenticResponse());
      if (url.includes('chat/completions')) {
        const evidence = JSON.parse(JSON.parse(request.body).messages[1].content).evidence;
        const ids = evidence.slice(0, 2).map(item => item.id);
        if (invalid) ids.push('invented-source');
        return response({ choices: [{ message: { content: JSON.stringify({ answer: `Conditional claim [${ids.join(', ')}]` }) } }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
      }
      return response({ value: [searchDoc('POL-RET-2026-01'), searchDoc('POL-DEF-2026-02')] });
    });
    const result = await liveRun('S07', helpers);
    for (const arm of [result.baseline, result.enhanced]) {
      assert.equal(arm.usage.total_tokens, 30);
      assert.equal(arm.trace.configuration.answerRequestId, 'real-service-request');
      if (invalid) {
        assert.equal(arm.answer, undefined);
        assert.equal(arm.error.code, 'studio_citation_unresolved');
      } else {
        assert.equal(arm.status, 'success');
        assert.ok(arm.answer.includes(']['));
        assert.ok(!arm.answer.includes(', '));
      }
    }
  }
});

test('metered S07 schema warmup enables five-attempt same-model Entra comparison without old token parameters', async () => {
  const env = liveEnv('S07', { answer: { deployment: 'answer-deployment', modelVersion: '2025-11-13',
    instructionsVersion: 'studio-grounded-answer-v1', reasoningEffort: 'none' } });
  const configured = JSON.parse(env.STUDIO_LIVE_CONFIG);
  configured.scenarios.S07.vector.provider = 'serverAzureOpenAI';
  env.STUDIO_LIVE_CONFIG = JSON.stringify(configured);
  env.STUDIO_TEXT_ENDPOINT = env.STUDIO_ANSWER_ENDPOINT;
  env.STUDIO_MODEL_AUTH = 'entra';
  delete env.STUDIO_ANSWER_API_KEY;
  const helpers = harness(env, async (url, request) => {
    if (request.method === 'GET') {
      const schema = indexSchema();
      schema.description = `Zava Studio synthetic dataset ${datasetVersion}; encoder=text-embedding-3-small@1; dimensions=6`;
      return url.includes('knowledgebases') ? response({ name: 'zava-kb', knowledgeSources: [{ name: 'zava-source' }] }, '"kb1"') : response(schema, '"v1"');
    }
    if (url.includes('embeddings')) return response({ data: [{ embedding: Array(6).fill(0.1) }] });
    if (JSON.parse(request.body).queryType === 'agentic') return response(agenticResponse());
    if (url.includes('chat/completions')) {
      const sent = JSON.parse(request.body);
      assert.equal(sent.max_tokens, undefined);
      assert.equal(sent.max_completion_tokens, 2000);
      assert.equal(sent.temperature, 0);
      assert.equal(sent.reasoning_effort, 'none');
      assert.equal(request.headers.Authorization, 'Bearer private-model-token');
      const evidence = JSON.parse(sent.messages[1].content).evidence;
      return response({ choices: [{ message: { content: JSON.stringify({ answer: `Assessment [${evidence[0].id}]` }) } }] });
    }
    return response({ value: [searchDoc()] });
  });
  Object.assign(helpers, { schemaCache: new Map(), getModelToken: async () => 'private-model-token' });
  const budgets = [];
  helpers.availability = async attempts => { budgets.push(attempts); return { retryAfter: attempts === 5 ? 60 : 0 }; };
  const pending = await prepareComparison(body('S07', first('S07'), { mode: 'live' }), helpers);
  assert.equal(pending.ready, false);
  assert.equal(pending.retryAfter, 60);
  assert.deepEqual(budgets, [1, 5]);
  assert.equal(helpers.attempts.length, 1);
  assert.ok(helpers.calls.every(call => call.request.method === 'GET'));
  helpers.availability = async () => ({ retryAfter: 0 });
  assert.equal((await prepareComparison(body('S07', first('S07'), { mode: 'live' }), helpers)).ready, true);
  assert.equal(helpers.attempts.length, 1);
  for (const cached of helpers.schemaCache.values()) cached.expiresAt = Date.now() + 1000;
  await warmAgenticSchema(helpers);
  assert.equal(helpers.attempts.length, 2);
  assert.ok([...helpers.schemaCache.values()].every(cached => cached.expiresAt > Date.now() + 240000));
  const warmed = helpers.attempts.length;
  const reserve = helpers.reserveAttempt;
  helpers.reserveAttempt = () => {
    if (helpers.attempts.length - warmed >= 5) throw new HttpError(429, 'quota_exceeded', 'Five attempts.');
    return reserve();
  };
  const result = await liveRun('S07', helpers);
  assert.equal(result.executionStatus, 'success');
  assert.equal(helpers.attempts.length - warmed, 5);
  assert.equal(helpers.releases.length, 7);
  assert.ok(!JSON.stringify(result).includes('private-model-token'));
});

test('S11 Entra-only binary encoder keeps private Search key isolated and real PNG citations', async () => {
  const helpers = imageHarness(null, null, hit => { hit.url = '/samples/zava-hat-blue.png'; hit.thumbnailUrl = hit.url; });
  delete helpers.env.STUDIO_IMAGE_API_KEY;
  helpers.env.STUDIO_MODEL_AUTH = 'entra';
  helpers.getModelToken = async () => 'private-vision-token';
  const result = await imageRun(helpers);
  assert.equal(result.executionStatus, 'success');
  const encoder = helpers.calls.find(call => call.url.includes('vectorizeImage'));
  assert.equal(encoder.request.headers.Authorization, 'Bearer private-vision-token');
  assert.equal(encoder.request.headers['api-key'], undefined);
  assert.equal(encoder.request.headers['Ocp-Apim-Subscription-Key'], undefined);
  assert.equal(result.enhanced.hits[0].url, '/samples/zava-hat-blue.png');
  assert.equal(result.enhanced.hits[0].thumbnailUrl, '/samples/zava-hat-blue.png');
  assert.ok(!JSON.stringify(result).includes('private-vision-token'));
});

test('model credentials and connection failures are distinct, redacted and never invent Azure request IDs', async () => {
  for (const credentialFailure of [false, true]) {
    const helpers = imageHarness(() => { throw new TypeError('fetch failed private-connection-detail'); });
    if (credentialFailure) {
      delete helpers.env.STUDIO_IMAGE_API_KEY;
      helpers.env.STUDIO_MODEL_AUTH = 'entra';
      helpers.getModelToken = async () => { throw new Error('private-credential-detail'); };
    }
    const result = await imageRun(helpers);
    assert.equal(result.executionStatus, 'partial_success');
    assert.equal(result.baseline.status, 'success');
    assert.equal(result.enhanced.error.code, credentialFailure ? 'studio_model_auth_unavailable' : 'studio_upstream_connection');
    assert.equal(result.enhanced.error.upstreamService, 'image-encoder');
    assert.equal(result.enhanced.trace.requestId, undefined);
    assert.equal(typeof result.enhanced.trace.correlationId, 'string');
    assert.equal(helpers.attempts.length, 3);
    assert.equal(helpers.releases.length, 3);
    assert.ok(!JSON.stringify(result).includes('private-credential-detail'));
    assert.ok(!JSON.stringify(result).includes('private-connection-detail'));
  }
});

test('S06 all five live boost subtypes use reviewed functions and server-only parameters', async () => {
  const scoringProfiles = Object.fromEntries(['freshness', 'magnitude', 'distance', 'tags', 'availability'].map(subtype => [subtype, `boost-${subtype}`]));
  const scoringParameters = {
    distance: { parameter: 'currentLocation', longitude: -0.1278, latitude: 51.5074 },
    tags: { parameter: 'preferredTags', values: ['renovation'] },
  };
  const schema = indexSchema();
  schema.fields.push({ name: 'updatedAt', type: 'Edm.DateTimeOffset' },
    { name: 'storeGeo', type: 'Edm.GeographyPoint' }, { name: 'tags', type: 'Collection(Edm.String)' });
  const definitions = {
    freshness: { type: 'freshness', fieldName: 'updatedAt' },
    magnitude: { type: 'magnitude', fieldName: 'stock' },
    distance: { type: 'distance', fieldName: 'storeGeo', distance: { referencePointParameter: 'currentLocation' } },
    tags: { type: 'tag', fieldName: 'tags', tag: { tagsParameter: 'preferredTags' } },
    availability: { type: 'magnitude', fieldName: 'stock' },
  };
  schema.scoringProfiles = Object.entries(definitions).map(([subtype, definition]) => ({ name: scoringProfiles[subtype], functions: [{ ...definition, boost: 2 }] }));
  for (const subtype of Object.keys(scoringProfiles)) {
    const helpers = harness(liveEnv('S06', { scoringProfiles, scoringParameters }), async (url, request) => request.method === 'GET'
      ? response(schema, '"v1"') : response({ value: [searchDoc()] }));
    const result = await runComparison({ scenarioId: 'S06', query: 'cordless drill', mode: 'live', options: { boostSubtype: subtype } }, helpers);
    assert.equal(result.executionStatus, 'success', subtype);
    const requests = helpers.calls.filter(call => call.request.method === 'POST').map(call => JSON.parse(call.request.body));
    assert.equal(requests[0].scoringProfile, undefined);
    assert.equal(requests[1].scoringProfile, scoringProfiles[subtype]);
    if (subtype === 'distance') assert.deepEqual(requests[1].scoringParameters, ['currentLocation--0.1278,51.5074']);
    if (subtype === 'tags') assert.deepEqual(requests[1].scoringParameters, ['preferredTags-renovation']);
    assert.equal(result.enhanced.trace.configuration.profileFunctions[0].boost, 2);
  }
});

test('S10 custom pre-extracted live retrieval binds hash/coordinates and never claims executed Azure CU', async () => {
  const sourceHash = JSON.parse(readFileSync(new URL('../config/studio-extraction.json', import.meta.url), 'utf8')).sourceHash;
  const config = { standardIndex: 'zava-standard', standardIndexETag: '"v2"',
    extraction: { sourceHash, basicVersion: 'basic-v1', standardVersion: 'standard-v1' } };
  const coordinates = { page: 2, unit: 'pt', x: 60, y: 120, width: 470, height: 24 };
  const make = (wrongHash = false) => harness(liveEnv('S10', config), async (url, request) => {
    const standard = url.includes('zava-standard');
    if (request.method === 'GET') {
      const schema = indexSchema();
      schema.name = standard ? 'zava-standard' : 'zava-index';
      schema.fields.push({ name: 'sourceHash', type: 'Edm.String', filterable: true },
        { name: 'sourceId', type: 'Edm.String' }, { name: 'page', type: 'Edm.Int32' });
      if (standard) schema.fields.push({ name: 'row', type: 'Edm.Int32' }, { name: 'coordinates', type: 'Edm.String' });
      return response(schema, standard ? '"v2"' : '"v1"');
    }
    const hit = { ...searchDoc('MAN-DRILL-1001-row-1', 'DCD796 concrete 13 mm'), sourceId: 'MAN-DRILL-1001', url: '/samples/zava-manual.pdf',
      sourceHash: wrongHash ? 'b'.repeat(64) : sourceHash, page: 2,
      ...(standard ? { row: 1, coordinates: JSON.stringify(coordinates) } : {}) };
    return response({ value: [hit] });
  });
  const helpers = make();
  const result = await liveRun('S10', helpers);
  assert.equal(result.executionStatus, 'success');
  assert.match(result.enhanced.label, /pre-extracted.*custom/i);
  assert.equal(result.enhanced.trace.configuration.contentUnderstandingExecuted, false);
  assert.equal(result.enhanced.trace.configuration.extractionProvider, 'custom-pre-extracted');
  const requests = helpers.calls.filter(call => call.request.method === 'POST').map(call => JSON.parse(call.request.body));
  assert.ok(requests.every(request => request.filter.includes(sourceHash)));
  assert.ok(!requests[0].select.includes('row') && !requests[0].select.includes('coordinates'));
  assert.ok(requests[1].select.includes('row') && requests[1].select.includes('coordinates'));
  assert.deepEqual(result.enhanced.hits[0].coordinates, coordinates);
  assert.equal(result.enhanced.hits[0].sourceId, 'MAN-DRILL-1001');
  assert.equal(result.baseline.hits[0].coordinates, undefined);
  assert.equal((await liveRun('S10', make(true))).executionStatus, 'error');
});

test('S10 native CU requires operation/analyzer provenance and preserves actual inch cell polygons', async () => {
  const extraction = { sourceHash: 'a'.repeat(64), basicVersion: 'cu-read-v1', standardVersion: 'cu-layout-v1',
    provider: 'azureContentUnderstanding', apiVersion: '2025-11-01', basicAnalyzer: 'prebuilt-read', standardAnalyzer: 'prebuilt-layout',
    basicOperationId: '860fab08-db6a-47b8-92e3-6174556d361d', standardOperationId: '8a82bf6e-d499-40ed-8dfb-10718a8c85a5' };
  const coordinates = { page: 2, unit: 'inch', x: 0.8, y: 1.6, width: 6.5, height: 0.3,
    cells: [{ rowIndex: 0, columnIndex: 0, polygon: [0.8, 1.6, 2, 1.6, 2, 1.9, 0.8, 1.9] }] };
  const make = mismatch => harness(liveEnv('S10', { standardIndex: 'zava-standard', standardIndexETag: '"v2"', extraction }), async (url, request) => {
    const standard = url.includes('zava-standard');
    if (request.method === 'GET') {
      const schema = indexSchema();
      schema.name = standard ? 'zava-standard' : 'zava-index';
      schema.fields.push({ name: 'sourceHash', type: 'Edm.String', filterable: true }, { name: 'page', type: 'Edm.Int32' },
        ...['extractionProvider', 'extractionApiVersion', 'extractionAnalyzer', 'extractionOperationId'].map(name => ({ name, type: 'Edm.String', filterable: true })));
      if (standard) schema.fields.push({ name: 'row', type: 'Edm.Int32' }, { name: 'coordinates', type: 'Edm.String' });
      return response(schema, standard ? '"v2"' : '"v1"');
    }
    return response({ value: [{ ...searchDoc('MAN-DRILL-1001-row-1', 'DCD796 concrete 13 mm'), sourceHash: extraction.sourceHash, page: 2,
      extractionProvider: 'azureContentUnderstanding', extractionApiVersion: '2025-11-01', extractionAnalyzer: standard ? 'prebuilt-layout' : 'prebuilt-read',
      extractionOperationId: mismatch ? 'wrong-operation' : standard ? extraction.standardOperationId : extraction.basicOperationId,
      ...(standard ? { row: 1, coordinates: JSON.stringify(coordinates) } : {}) }] });
  });
  const helpers = make(false);
  const result = await liveRun('S10', helpers);
  assert.equal(result.executionStatus, 'success');
  assert.equal(result.enhanced.label, 'Azure CU Layout table rows');
  assert.equal(result.enhanced.trace.configuration.contentUnderstandingExecuted, true);
  assert.deepEqual(result.enhanced.hits[0].coordinates, coordinates);
  assert.equal(result.baseline.hits[0].coordinates, undefined);
  assert.match(result.enhanced.trace.steps.join(' '), /ingestion, not on this retrieval/);
  assert.equal((await liveRun('S10', make(true))).executionStatus, 'error');
  const invalid = liveEnv('S10', { standardIndex: 'zava-standard', standardIndexETag: '"v2"', extraction: { ...extraction, standardOperationId: undefined } });
  assert.equal(liveConfiguration(invalid, 'S10').available, false);
});

test('server query embeddings use private Entra auth and actual compatible vectors; absent provider fails closed', async () => {
  const vector = { provider: 'serverAzureOpenAI', field: 'contentVector', profile: 'v-profile', vectorizer: 'server-entra',
    deployment: 'embed-deployment', model: 'text-embedding-3-small', modelVersion: '1', dimensions: 6 };
  const env = { ...liveEnv('S02', { vector }), STUDIO_TEXT_ENDPOINT: 'https://zava-demo.openai.azure.com', STUDIO_MODEL_AUTH: 'entra' };
  const schema = indexSchema();
  schema.description = `Zava Studio synthetic dataset ${datasetVersion}; encoder=text-embedding-3-small@1; dimensions=6`;
  delete schema.vectorSearch.vectorizers;
  schema.vectorSearch.profiles[0] = { name: 'v-profile' };
  const helpers = harness(env, async (url, request) => {
    if (request.method === 'GET') return response(schema, '"v1"');
    if (url.includes('/embeddings?')) {
      assert.equal(request.headers.Authorization, 'Bearer private-test-token');
      assert.equal(request.headers['api-key'], undefined);
      return response({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] }], usage: { prompt_tokens: 8, total_tokens: 8 } });
    }
    return response({ value: [searchDoc()] });
  });
  const result = await liveRun('S02', { ...helpers, getModelToken: async () => 'private-test-token' });
  assert.equal(result.executionStatus, 'success');
  const request = helpers.calls.filter(call => call.url.includes('/docs/search?')).map(call => JSON.parse(call.request.body)).find(body => body.vectorQueries);
  assert.deepEqual(request.vectorQueries[0].vector, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  assert.equal(request.vectorQueries[0].kind, 'vector');
  assert.equal(result.enhanced.trace.configuration.queryEmbedding.usage.total_tokens, 8);
  assert.ok(!JSON.stringify(result).includes('private-test-token'));
  const missing = harness(env, async (url, request) => request.method === 'GET' ? response(schema, '"v1"') : response({ value: [searchDoc()] }));
  assert.equal((await liveRun('S02', missing)).executionStatus, 'partial_success');
  assert.ok(!missing.calls.some(call => call.url.includes('/embeddings?')));
});

test('verified schema cache reuses only matching resource config and expires without bypassing HTTP quotas', async () => {
  const cache = new Map();
  const helpers = harness(liveEnv());
  await liveRun('S01', { ...helpers, schemaCache: cache }, 'DCD796 drill');
  await liveRun('S01', { ...helpers, schemaCache: cache }, 'DCD796 drill');
  assert.equal(helpers.calls.filter(call => call.request.method === 'GET').length, 1);
  assert.equal(helpers.attempts.length, 5);
  for (const entry of cache.values()) entry.expiresAt = 0;
  await liveRun('S01', { ...helpers, schemaCache: cache }, 'DCD796 drill');
  assert.equal(helpers.calls.filter(call => call.request.method === 'GET').length, 2);
  assert.equal(helpers.attempts.length, 8);
});
