import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createApplication } from '../dist/server/index.mjs';
import { studioScenarios } from '../dist/server/lib/studio.mjs';

const env = {
  PUBLIC_ORIGIN: 'https://demo.example.test',
  FOUNDRY_IQ_LIVE_ENABLED: 'false',
  AZURE_SEARCH_API_KEY: 'not-a-real-key-for-redaction-tests',
};
const app = createApplication({ fetchUpstream: () => assert.fail('Sample and validation must not call Azure'), log: () => {} });
const get = path => app.fetch(new Request(env.PUBLIC_ORIGIN + path), env);
const post = (body, headers = {}, path = '/api/demo/run') => app.fetch(new Request(env.PUBLIC_ORIGIN + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
}), env);

test('studio public catalog and health expose S01–S11 without credential or readiness claims', async () => {
  const response = await get('/api/scenarios');
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes(env.AZURE_SEARCH_API_KEY));
  const scenarios = JSON.parse(text).scenarios;
  assert.deepEqual(scenarios.map(item => item.id), Array.from({ length: 11 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`));
  const health = await (await get('/api/health')).json();
  assert.equal(health.dependencyReadiness, 'unverified');
  assert.equal(health.liveEnabled, false);
  assert.equal(health.uploads.status, 'unsupported');
});

test('all scenarios run explicitly selected bounded sample comparisons through HTTP', async () => {
  for (const scenario of studioScenarios()) {
    const response = await post({ scenarioId: scenario.id, query: scenario.sampleQuery, topK: 5, mode: 'sample' });
    assert.equal(response.status, 200, scenario.id);
    const result = await response.json();
    assert.equal(result.mode, 'sample');
    assert.equal(result.scenarioId, scenario.id);
    assert.ok(result.baseline && result.enhanced && result.comparison);
    for (const arm of [result.baseline, result.enhanced]) {
      assert.ok(arm.hits.length <= 5);
      assert.equal(arm.usage?.cost, undefined);
      assert.equal(arm.trace?.latencyMs, undefined);
    }
  }
});

test('studio invalid input cannot smuggle auth, endpoints or oversized queries', async () => {
  const base = { scenarioId: 'S01', query: studioScenarios()[0].sampleQuery, topK: 10, mode: 'sample' };
  for (const change of [
    { topK: 11 }, { scenarioId: 'S12' }, { mode: 'unknown' }, { query: 'a'.repeat(8001) },
    { principalContext: { administrator: true } }, { endpoint: 'https://attacker.example' },
    { headers: { Authorization: 'Bearer fake' } }, { uploadId: 'other-user-upload' },
  ]) {
    const response = await post({ ...base, ...change });
    assert.ok(response.status >= 400, JSON.stringify(change).slice(0, 60));
  }
  assert.equal((await post(base, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post(base, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post({ ...base, query: 'a'.repeat(65536) })).status, 413);
});

test('unconfigured live never silently replays and uploads are explicitly unsupported', async () => {
  const response = await post({ scenarioId: 'S01', query: studioScenarios()[0].sampleQuery, topK: 10, mode: 'live' });
  assert.ok(response.status >= 400);
  assert.equal((await response.json()).baseline, undefined);
  for (const path of ['/api/uploads', '/api/uploads/another-scope']) {
    const upload = await post({}, {}, path);
    assert.equal(upload.status, 501);
    assert.equal((await upload.json()).errorCode, 'uploads_unsupported');
  }
});

test('retired management URLs redirect to the one root application and APIs stay absent', async () => {
  for (const path of ['/agents', '/knowledge', '/playground']) {
    const response = await get(path);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), '/');
  }
  assert.equal((await post({}, {}, '/api/agents')).status, 404);
  const page = await (await get('/')).text();
  // One user-requested top bar (Share, GitHub, menu) is allowed; no management sidebar or navigation shell.
  assert.ok(!/<aside|<nav/.test(page));
  assert.equal((page.match(/<header/g) || []).length, 1);
});

test('invalid studio envelopes cannot leak arbitrary objects through operational telemetry', async () => {
  const events = [];
  const local = createApplication({ log: event => events.push(event) });
  await local.fetch(new Request(env.PUBLIC_ORIGIN + '/api/demo/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarioId: { privateText: 'unlogged-private-question' }, mode: { token: 'unlogged-private-token' } }),
  }), env);
  assert.ok(events.length);
  assert.ok(!JSON.stringify(events).includes('unlogged-private'));
});

test('approved provisioning script verifies exact resources and does not mutate by default', {
  skip: !existsSync(new URL('./studio-provision.mjs', import.meta.url)),
}, async () => {
  const { target, provision, verifyService } = await import('./studio-provision.mjs');
  const service = {
    name: target.service, location: 'West Central US', sku: { name: 'standard' },
    tags: { description: 'Do not delete' },
    properties: { replicaCount: 1, partitionCount: 1, disableLocalAuth: false, authOptions: { apiKeyOnly: {} }, provisioningState: 'succeeded' },
  };
  assert.equal(verifyService(service).authentication, 'apiKeyOnly');
  assert.throws(() => verifyService({ ...service, location: 'westus2' }));
  assert.throws(() => verifyService({ ...service, sku: { name: 'standard2' } }));
  const calls = [];
  const run = args => {
    calls.push(args.join(' '));
    if (args[0] === 'account') return { id: target.subscription, state: 'Enabled' };
    if (args[0] === 'resource') return [];
    if (args.includes('check-name-availability')) return { nameAvailable: true };
    if (args.includes('post')) return { regions: [{ regionName: target.location, skus: [{ sku: { name: target.sku } }] }] };
    if (args.includes('get')) return { value: [{ name: { value: target.sku }, currentValue: 3, limit: 12 }] };
    assert.fail('Unexpected provisioning action');
  };
  assert.equal(provision({ run }).action, 'dry-run');
  assert.ok(!calls.some(call => /\bcreate\b|\bdelete\b|list-admin-keys/.test(call)));
});

test('studio ingestion/cleanup require additional approval and can never target the service/group', {
  skip: !existsSync(new URL('./studio-ingest.mjs', import.meta.url)),
}, async () => {
  const { ingestionPlan, ingest, cleanup } = await import('./studio-ingest.mjs');
  const manifest = {
    synthetic: true, datasetVersion: 'synthetic-test-v1',
    indexes: [{
      name: 'zava-studio-products', definition: { name: 'zava-studio-products', description: 'Zava Studio synthetic dataset synthetic-test-v1', fields: [] },
      documents: [{ id: 'DRILL-1001', datasetVersion: 'synthetic-test-v1' }],
    }],
  };
  const never = () => assert.fail('Dry-run or unapproved mutation cannot make HTTP requests');
  assert.throws(() => ingestionPlan({ ...manifest, indexes: [{ ...manifest.indexes[0],
    definition: { ...manifest.indexes[0].definition, description: undefined } }] }), /ownership/);
  assert.equal((await ingest(manifest, { fetchUpstream: never })).action, 'dry-run');
  assert.equal((await cleanup(manifest, { fetchUpstream: never })).servicesDeleted, 0);
  await assert.rejects(ingest(manifest, { apply: true, env: {}, fetchUpstream: never }), /approval/);
  await assert.rejects(cleanup(manifest, { apply: true, env: {}, fetchUpstream: never }), /approval/);
  for (const name of ['foundry-iq-demos', 'rg-foundry-iq-demos', '../searchServices/foundry-iq-demos']) {
    assert.throws(() => ingestionPlan({
      ...manifest, indexes: [{ ...manifest.indexes[0], name, definition: { name, fields: [] } }],
    }));
  }
  assert.throws(() => ingestionPlan({ ...manifest, knowledgeSources: [{ name: 'zava-studio-remote', definition: { name: 'zava-studio-remote', kind: 'workIQ' } }] }));
});

test('only server-verified scenarios can default to Live; unverified requests dispatch no Azure calls', async () => {
  const liveEnv = { ...env, FOUNDRY_IQ_LIVE_ENABLED: 'true', AZURE_SEARCH_ENDPOINT: 'https://zava-demo.search.windows.net',
    STUDIO_LIVE_CONFIG: JSON.stringify({ datasetVersion: 'zava-studio-2026-01', resourceVersion: 'test-v1', scenarios: {
      S01: { index: 'zava-index', indexETag: '"v1"', synonymMaps: ['zava-synonyms'], attestation: { checkedAt: '2026-11-24', region: 'westcentralus', evidenceVersion: 'test-v1' } },
    } }) };
  const server = createApplication({ verifiedScenarios: new Set(['S01']), fetchUpstream: () => assert.fail('Unverified cannot dispatch'), log: () => {} });
  const catalog = await (await server.fetch(new Request(env.PUBLIC_ORIGIN + '/api/scenarios'), liveEnv)).json();
  assert.equal(catalog.defaultMode, 'live');
  assert.equal(catalog.scenarios[0].status, 'live_verified');
  assert.equal(catalog.scenarios.find(item => item.id === 'S07').liveAvailable, false);
  const rejected = await server.fetch(new Request(env.PUBLIC_ORIGIN + '/api/demo/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenarioId: 'S07', mode: 'live', query: 'battery warranty' }),
  }), liveEnv);
  assert.equal(rejected.status, 503);
  assert.equal((await rejected.json()).errorCode, 'studio_live_unverified');
});

test('resuming live evidence cannot refresh an old scenario proof or accept future timestamps', {
  skip: !existsSync(new URL('./studio-live.mjs', import.meta.url)),
}, async () => {
  const { reusableScenarioProof } = await import('./studio-live.mjs');
  const now = Date.parse('2026-11-24T12:00:00Z');
  const proof = { status: 'success', mode: 'live', verifiedAt: '2026-11-24T11:30:00Z',
    baseline: { trace: { requestId: 'actual-before' } }, enhanced: { trace: { requestId: 'actual-after' } } };
  assert.equal(reusableScenarioProof(proof, '2026-11-24T12:00:00Z', now), true);
  assert.equal(reusableScenarioProof({ ...proof, id: 'S10', status: 'custom_retrieval_verified' }, '2026-11-24T12:00:00Z', now), true);
  assert.equal(reusableScenarioProof({ ...proof, id: 'S04', status: 'custom_retrieval_verified' }, '2026-11-24T12:00:00Z', now), false);
  assert.equal(reusableScenarioProof({ ...proof, verifiedAt: '2026-11-24T10:59:59Z' }, '2026-11-24T12:00:00Z', now), false);
  assert.equal(reusableScenarioProof({ ...proof, verifiedAt: '2026-11-24T12:00:01Z' }, '2026-11-24T12:00:00Z', now), false);
  assert.equal(reusableScenarioProof({ ...proof, enhanced: { trace: {} } }, '2026-11-24T12:00:00Z', now), false);
});

test('every live catalog citation resolves its exact document ID and content, including scale fillers', {
  skip: !existsSync(new URL('./studio-live.mjs', import.meta.url)),
}, async () => {
  const { syntheticAssets } = await import('./studio-live.mjs');
  const { readFile } = await import('node:fs/promises');
  const csv = await readFile(new URL('../samples/zava-catalog.csv', import.meta.url), 'utf8');
  for (const document of syntheticAssets().indexes.find(item => item.name === 'zava-studio-products').documents) {
    const line = csv.split('\n').find(row => row.startsWith(`"${document.id}",`));
    assert.ok(line, `missing citation source for ${document.id}`);
    assert.ok(line.includes(document.content.replaceAll('"', '""')), `missing actual evidence for ${document.id}`);
  }
});

test('S10 verified index evidence is a custom example, never verified Azure Content Understanding', async () => {
  const { readFile } = await import('node:fs/promises');
  const extraction = JSON.parse(await readFile(new URL('../config/studio-extraction.json', import.meta.url), 'utf8'));
  const liveEnv = { ...env, FOUNDRY_IQ_LIVE_ENABLED: 'true', AZURE_SEARCH_ENDPOINT: 'https://zava-demo.search.windows.net',
    STUDIO_LIVE_CONFIG: JSON.stringify({ datasetVersion: 'zava-studio-2026-01', resourceVersion: 'test-v1', scenarios: {
      S10: { index: 'zava-basic', indexETag: '"v1"', standardIndex: 'zava-layout', standardIndexETag: '"v2"',
        extraction: { sourceHash: extraction.sourceHash, basicVersion: 'basic-v1', standardVersion: 'layout-v1' },
        attestation: { checkedAt: '2026-11-24', region: 'westcentralus', evidenceVersion: 'test-v1' } },
    } }) };
  const server = createApplication({ verifiedScenarios: new Set(['S10']), nativeCuBlocker: 'GA API is not supported in this region.',
    fetchUpstream: () => assert.fail('Catalog inspection cannot dispatch'), log: () => {} });
  const catalog = await (await server.fetch(new Request(env.PUBLIC_ORIGIN + '/api/scenarios'), liveEnv)).json();
  const pdf = catalog.scenarios.find(item => item.id === 'S10');
  assert.equal(pdf.liveAvailable, true);
  assert.equal(pdf.status, 'custom_retrieval_verified');
  assert.match(pdf.title, /custom pre-extracted/);
  assert.equal(pdf.nativeTreatment.status, 'blocked');
  assert.match(pdf.live.reason, /GA API is not supported/);
  assert.equal(pdf.live.status, 'custom_preextracted_index_retrieval_verified');
});

test('only verified native CU bindings advertise native treatment, with downloadable real raster originals', async () => {
  const liveEnv = { ...env, FOUNDRY_IQ_LIVE_ENABLED: 'true', AZURE_SEARCH_ENDPOINT: 'https://zava-demo.search.windows.net',
    STUDIO_LIVE_CONFIG: JSON.stringify({ datasetVersion: 'zava-studio-2026-01', resourceVersion: 'test-v1', scenarios: {
      S10: { index: 'zava-basic', indexETag: '"v1"', standardIndex: 'zava-layout', standardIndexETag: '"v2"',
        extraction: { sourceHash: 'a'.repeat(64), basicVersion: 'cu-read-v1', standardVersion: 'cu-layout-v1',
          provider: 'azureContentUnderstanding', apiVersion: '2025-11-01', basicAnalyzer: 'prebuilt-read', standardAnalyzer: 'prebuilt-layout',
          basicOperationId: '860fab08-db6a-47b8-92e3-6174556d361d', standardOperationId: '8a82bf6e-d499-40ed-8dfb-10718a8c85a5' },
        attestation: { checkedAt: '2026-11-24', region: 'westcentralus', evidenceVersion: 'test-v1' } },
    } }) };
  for (const verified of [false, true]) {
    const app = createApplication({ verifiedScenarios: new Set(verified ? ['S10'] : []), log: () => {} });
    const catalog = await (await app.fetch(new Request(env.PUBLIC_ORIGIN + '/api/scenarios'), liveEnv)).json();
    const pdf = catalog.scenarios.find(item => item.id === 'S10');
    assert.equal(pdf.liveAvailable, verified);
    assert.equal(pdf.nativeTreatment.status, verified ? 'verified' : 'unverified');
    if (verified) {
      assert.equal(pdf.status, 'live_verified');
      assert.equal(pdf.title, 'PDF layout extraction');
      assert.match(pdf.liveDescription, /Content Understanding/);
      assert.equal(pdf.nativeTreatment.extractionTiming, 'ingestion, not query time');
    }
    const image = await app.fetch(new Request(env.PUBLIC_ORIGIN + '/samples/zava-hat-blue.png'), liveEnv);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    const { illustrationPng } = await import('./generate-studio.mjs');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), illustrationPng(0));
  }
});

test('native approval operators default to zero-Azure-call dry-runs and examples retain eleven sibling bindings', {
  skip: !existsSync(new URL('./studio-native-provision.mjs', import.meta.url)),
}, async () => {
  const { provisionNative } = await import('./studio-native-provision.mjs');
  const { nativeBindings } = await import('./studio-native-bindings.mjs');
  assert.equal((await provisionNative()).azureCalls, 0);
  assert.equal((await nativeBindings()).azureCalls, 0);
  const { readFile } = await import('node:fs/promises');
  const example = JSON.parse(await readFile(new URL('../config/studio-live.example.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(example.scenarios).length, 11);
  assert.equal(example.scenarios.S07.S08, undefined);
  assert.equal(example.scenarios.S10.extraction.provider, 'azureContentUnderstanding');
});
