import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createApplication } from '../dist/server/index.mjs';
import { BlobQuotaCoordinator, anonymousSession } from '../dist/server/lib/quota.mjs';
import { MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, readBounded } from '../dist/server/lib/protocol.mjs';
import { normalizeResponse, safeUrl } from '../dist/server/lib/normalize.mjs';
import { createNodeServer, clientIp } from '../lib/http.mjs';
import { publicCatalog, knowledgeBases } from '../config/knowledge-bases.mjs';
import { FakeBlob } from './test-support.mjs';
import { archiveFiles } from './source-files.mjs';

const samples = JSON.parse(readFileSync(new URL('../config/scenarios.json', import.meta.url)));
const catalog = publicCatalog(samples);
const fixture = JSON.parse(readFileSync(new URL('./fixtures/published-response.json', import.meta.url)));
const indexedFixture = structuredClone(fixture);
indexedFixture.references = indexedFixture.references.filter(reference => reference.type !== 'web');
indexedFixture.activity = indexedFixture.activity.filter(activity => !['web', 'modelWebSummarization'].includes(activity.type));
const indexed = knowledgeBases[0];
const web = knowledgeBases[1];
const env = {
  PUBLIC_ORIGIN: 'https://demo.example.test',
  AZURE_SEARCH_ENDPOINT: 'https://demo.search.windows.net',
  AZURE_SEARCH_API_KEY: 'unit-test-key-not-a-credential',
  SESSION_SECRET: 'unit-test-session-secret-not-a-credential-123456789',
  FOUNDRY_IQ_QUOTA_CONTAINER_URL: 'https://stfoundryiqcustomerdemos.blob.core.windows.net/demo-quotas',
  FOUNDRY_IQ_LIVE_ENABLED: 'true',
};
const requestFor = scenario => ({
  messages: [{ role: 'user', content: [{ type: 'text', text: scenario.question }] }],
  retrievalReasoningEffort: { kind: 'low' },
  outputMode: 'answerSynthesis',
  includeActivity: true,
  maxRuntimeInSeconds: 60,
  maxOutputSizeInTokens: 4000,
  knowledgeSourceParams: scenario.sources.map(source => ({
    kind: source.kind, knowledgeSourceName: source.name, includeReferences: true, includeReferenceSourceData: true,
  })),
});
const bodyFor = (scenario = indexed) => ({ scenarioId: scenario.id, mode: 'live', request: requestFor(scenario) });
function setup(fetchUpstream = async url => Response.json(url.pathname.includes("-web')") ? fixture : indexedFixture), blob = new FakeBlob()) {
  const events = [];
  const coordinator = new BlobQuotaCoordinator(blob);
  const app = createApplication({ coordinator, fetchUpstream, log: event => events.push(event) });
  return { app, blob, events, coordinator };
}
const post = (app, body, options = {}) => app.fetch(new Request('https://demo.example.test/api/retrieve', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...options.headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  ...(options.signal ? { signal: options.signal } : {}),
}), { ...env, ...options.env }, { clientIp: options.ip || '192.0.2.1' });
const minimal = request => {
  request.retrievalReasoningEffort.kind = 'minimal';
  request.outputMode = 'extractiveData';
  const question = request.messages[0].content[0].text;
  delete request.messages;
  request.intents = [{ type: 'semantic', search: question }];
};

test('root app scripts and source ZIP manifest are standalone without legacy framework paths', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(manifest.engines.node, '>=22');
  assert.equal(manifest.scripts.pretest, 'node scripts/build.mjs');
  assert.equal(manifest.scripts.build, 'node scripts/build.mjs');
  assert.equal(manifest.scripts.start, 'node --env-file-if-exists=.env.local scripts/start.mjs');
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['@azure/identity', '@azure/storage-blob']);
  assert.equal(new Set(archiveFiles).size, archiveFiles.length);
  for (const name of ['AGENTS.md', 'LICENSE', '.env.example', 'scripts/source-files.mjs', 'scripts/start.mjs']) assert.ok(archiveFiles.includes(name));
  for (const name of archiveFiles) {
    assert.ok(!name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..'));
    assert.ok(!/^(?:explorer|app|components|infra|public|node_modules|dist|\.git|\.github)\//.test(name));
    assert.ok(statSync(new URL('../' + name, import.meta.url)).isFile(), name);
  }
});

test('only two public live KBs share exact approved source identities', () => {
  assert.deepEqual(knowledgeBases.map(kb => kb.id), ['foundryiq-customer-demos-indexed', 'foundryiq-customer-demos-web']);
  assert.deepEqual(indexed.sources.map(source => source.name), web.sources.slice(0, 2).map(source => source.name));
  assert.equal(web.sources[2].name, 'foundryiq-customer-demos-web-guidance');
  assert.ok(catalog.every(item => !Object.hasOwn(item, 'fixture') && !Object.hasOwn(item, 'answer')));
});

test('public routes expose no runtime config, quota state or private files', async () => {
  const { app } = setup();
  for (const path of ['/', '/healthz', '/api/config', '/assets/client.mjs', '/assets/source-icons.mjs', '/assets/web.svg']) {
    const response = await app.fetch(new Request(env.PUBLIC_ORIGIN + path), env);
    assert.equal(response.status, 200, path);
    const text = await response.text();
    assert.ok(!text.includes(env.AZURE_SEARCH_API_KEY) && !text.includes(env.SESSION_SECRET));
    assert.ok(!text.includes('__SCENARIOS__'));
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
  }
  for (const path of ['/.env.local', '/config/knowledge-bases.mjs', '/quotas.json', '/samples/quotas.json', '/assets/PROVENANCE.md', '/server.template.mjs']) {
    assert.equal((await app.fetch(new Request(env.PUBLIC_ORIGIN + path), env)).status, 404);
  }
});

for (const scenario of samples) test('honest fixed replay and public raw sources: ' + scenario.id, async () => {
  const { app } = setup(() => { throw new Error('Replay must not call Azure'); });
  const body = { scenarioId: scenario.id, mode: 'sample', request: requestFor(scenario) };
  const response = await post(app, body);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.sample, true);
  assert.equal(result.effectiveRequest.sent, false);
  for (const reference of result.normalized.references) {
    assert.equal(reference.activityLinked, true);
    const raw = await app.fetch(new Request(env.PUBLIC_ORIGIN + reference.url), env);
    assert.equal(raw.status, 200);
    assert.ok((await raw.text()).length > 20);
  }
  body.request.messages[0].content[0].text = 'Arbitrary live question';
  assert.equal((await post(app, body)).status, 400);
});

test('replay-only sources cannot be used live and live failures never become replays', async () => {
  const { app } = setup();
  for (const scenario of samples) assert.equal((await post(app, bodyFor(scenario))).status, 400);
  const disabled = await post(app, bodyFor(), { env: { FOUNDRY_IQ_LIVE_ENABLED: 'false' } });
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).errorCode, 'live_disabled');
  assert.equal((await post(app, bodyFor(), { env: { AZURE_SEARCH_API_KEY: '' } })).status, 503);
  assert.equal((await post(app, bodyFor(), { env: { AZURE_SEARCH_API_KEY: '@Microsoft.KeyVault(SecretUri=unresolved)' } })).status, 503);
});

test('invalid types, duplicates, unknown fields and source membership are rejected', async () => {
  const { app, blob } = setup();
  const cases = [
    body => { body.scenarioId = 'private-kb'; },
    body => { body.request.maxRuntimeInSeconds = '60'; },
    body => { body.request.maxRuntimeInSeconds = 121; },
    body => { body.request.maxOutputSizeInTokens = 0; },
    body => { body.request.maxOutputSize = 4000; },
    body => { body.request.includeActivity = 'true'; },
    body => { body.request.outputMode = 'invalid'; },
    body => { body.request.messages.push(body.request.messages[0]); },
    body => { body.request.messages[0].role = 'system'; },
    body => { body.request.messages[0].content[0].text = ' '; },
    body => { body.request.messages[0].content[0].text = 'x'.repeat(8001); },
    body => { body.request.knowledgeSourceParams[1] = body.request.knowledgeSourceParams[0]; },
    body => { body.request.knowledgeSourceParams[0].knowledgeSourceName = 'private-source'; },
    body => { body.request.knowledgeSourceParams[0].kind = 'web'; },
    body => { body.request.knowledgeSourceParams[0].includeReferenceSourceData = 'true'; },
    body => { body.request.knowledgeSourceParams[0].filterAddOn = 'private eq true'; },
    body => { body.request.untrusted = true; },
    body => { body.request.retrievalReasoningEffort.kind = 'medium'; },
    body => { body.request.retrievalReasoningEffort = null; },
    body => { body.request.intents = [{ type: 'semantic', search: 'ignored extra question' }]; },
  ];
  for (const mutate of cases) {
    const body = bodyFor();
    mutate(body);
    const response = await post(app, body);
    assert.equal(response.status, 400, mutate.toString());
  }
  assert.equal(blob.state.count, 0);
  assert.equal((await post(app, 'null')).status, 400);
  assert.equal((await post(app, '{')).status, 400);
});

test('minimal is indexed/extractive only; medium is gated by deployment capability', async () => {
  const { app } = setup();
  const body = bodyFor();
  minimal(body.request);
  assert.equal((await post(app, body)).status, 200);
  body.request.knowledgeSourceParams[0].alwaysQuerySource = true;
  assert.equal((await post(app, body)).status, 400);
  delete body.request.knowledgeSourceParams[0].alwaysQuerySource;
  body.request.outputMode = 'answerSynthesis';
  assert.equal((await post(app, body)).status, 400);
  const withWeb = bodyFor(web);
  minimal(withWeb.request);
  assert.equal((await post(app, withWeb)).status, 400);
  const medium = bodyFor();
  medium.request.retrievalReasoningEffort.kind = 'medium';
  assert.equal((await post(app, medium, { env: { FOUNDRY_IQ_MEDIUM_ENABLED: 'true' } })).status, 200);
});

test('published OData route, exact normalized snapshot, explicit token field, no invented defaults', async () => {
  const body = bodyFor();
  body.request.messages[0].content[0].text = '  An arbitrary question  ';
  delete body.request.maxRuntimeInSeconds;
  delete body.request.includeActivity;
  delete body.request.knowledgeSourceParams;
  let sent;
  const { app } = setup(async (url, options) => {
    assert.equal(url.hostname, 'demo.search.windows.net');
    assert.equal(url.pathname, "/knowledgebases('foundryiq-customer-demos-indexed')/retrieve");
    assert.equal(url.searchParams.get('api-version'), '2026-08-01-preview');
    assert.equal(options.headers['api-key'], env.AZURE_SEARCH_API_KEY);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    sent = { body: JSON.parse(options.body), id: options.headers['x-ms-client-request-id'] };
    return Response.json(indexedFixture);
  });
  const result = await (await post(app, body)).json();
  assert.deepEqual(result.effectiveRequest.body, sent.body);
  assert.equal(result.requestId, sent.id);
  assert.equal(result.effectiveRequest.sent, true);
  assert.equal(sent.body.messages[0].content[0].text, 'An arbitrary question');
  assert.equal(sent.body.maxOutputSizeInTokens, 4000);
  assert.equal(Object.hasOwn(sent.body, 'maxOutputSize'), false);
  for (const field of ['maxRuntimeInSeconds', 'includeActivity', 'knowledgeSourceParams']) assert.equal(Object.hasOwn(sent.body, field), false);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(env.AZURE_SEARCH_API_KEY));
  assert.match(result.contractStatus, /canary/);
});

test('content type, origin, encoding and streamed UTF-8 byte bounds apply to direct clients', async () => {
  const { app } = setup();
  assert.equal((await post(app, bodyFor(), { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await post(app, bodyFor(), { headers: { Origin: 'https://evil.example.test' } })).status, 403);
  assert.equal((await post(app, bodyFor(), { headers: { Origin: 'null' } })).status, 403);
  assert.equal((await post(app, bodyFor(), { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await post(app, bodyFor(), { headers: { 'Content-Encoding': 'gzip' } })).status, 415);
  const stream = new ReadableStream({
    start(controller) {
      for (let index = 0; index < 4; index++) controller.enqueue(new TextEncoder().encode('é'.repeat(10000)));
      controller.close();
    },
  });
  const response = await app.fetch(new Request(env.PUBLIC_ORIGIN + '/api/retrieve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half',
  }), env);
  assert.equal(response.status, 413);
  await assert.rejects(readBounded(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(255)); controller.close(); } }), 4), error => error.code === 'invalid_encoding');
});

test('normalizer joins arbitrary reference IDs and activity IDs, not array offsets', () => {
  const { normalized } = normalizeResponse(fixture);
  assert.deepEqual(normalized.citations.map(item => item.id), ['record-b', 'manual-a', 'web-z']);
  assert.ok(normalized.citations.every(item => item.resolved));
  assert.equal(normalized.references.find(item => item.id === 'record-b').sourceName, 'foundryiq-customer-demos-maintenance');
  assert.equal(normalized.references.find(item => item.id === 'manual-a').passage, 'The checklist requires recorded approval.');
  assert.equal(normalized.references[0].kind, 'web');
  assert.equal(normalized.activities.find(activity => activity.id === 88).elapsedMs, undefined);
});

test('missing/duplicate citations and absent passages/timings remain explicit', () => {
  const data = structuredClone(fixture);
  data.response[0].content[0].text += ' Missing [ref_id:unreturned].';
  data.references[1].sourceData = {};
  data.references.push(structuredClone(data.references[0]));
  data.activity = [];
  const { normalized } = normalizeResponse(data);
  assert.equal(normalized.citations.find(item => item.id === 'web-z').resolved, false);
  assert.equal(normalized.citations.find(item => item.id === 'unreturned').resolved, false);
  assert.equal(normalized.references[1].passage, null);
  assert.equal(normalized.references[0].activityLinked, false);
  assert.ok(normalized.limitations.some(item => item.includes('duplicated')));
  const empty = normalizeResponse({ response: [] }).normalized;
  assert.equal(empty.activityReported, false);
  assert.ok(empty.limitations.some(item => item.includes('No reference')));
});

test('unsafe markup, URL credentials/SAS and echoed secrets are never executable or credential-bearing', async () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,evil'), null);
  assert.equal(safeUrl('//evil.test'), null);
  assert.equal(safeUrl('https://user:password@evil.test'), null);
  const data = structuredClone(fixture);
  data.references[0].url = 'https://public.example.test/doc?sig=secret&se=expiry&topic=safe';
  data.references[0].sourceData.apiKey = env.AZURE_SEARCH_API_KEY;
  data.references[0].sourceData.content = '<img src=x onerror=alert(1)> ' + env.AZURE_SEARCH_API_KEY;
  const { app } = setup(async () => Response.json(data));
  const result = await (await post(app, bodyFor(web))).json();
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(env.AZURE_SEARCH_API_KEY));
  assert.ok(!serialized.includes('sig=secret'));
  assert.equal(result.normalized.references[0].url, 'https://public.example.test/doc?topic=safe');
  assert.match(result.normalized.references[0].passage, /<img/);
});

test('partial results and activity errors retain evidence and safe original annotations', async () => {
  const partial = structuredClone(fixture);
  partial.activity[0].error = { code: 'DependencyUnavailable', message: 'Web result incomplete' };
  const { app } = setup(async () => Response.json(partial, { status: 206, headers: { 'request-id': 'service-request-7' } }));
  const response = await post(app, bodyFor(web));
  assert.equal(response.status, 206);
  const result = await response.json();
  assert.equal(result.normalized.partial, true);
  assert.equal(result.upstreamStatus, 206);
  assert.equal(result.upstreamRequestId, 'service-request-7');
  assert.equal(result.normalized.references.length, 3);
  assert.ok(result.normalized.limitations.some(item => item.includes('77') && item.includes('failed')));
});

test('upstream error distinctions, retry guidance and malformed/oversized responses', async () => {
  for (const [upstream, expected, code] of [[400, 502, 'upstream_error'], [401, 502, 'upstream_error'], [429, 429, 'upstream_throttled'], [503, 502, 'upstream_error'], [504, 504, 'upstream_error']]) {
    let attempts = 0;
    const { app, blob } = setup(async () => {
      attempts++;
      return Response.json({ error: { code: 'ServiceFailure', message: env.AZURE_SEARCH_API_KEY } }, { status: upstream, headers: { 'Retry-After': '9' } });
    });
    const response = await post(app, bodyFor());
    assert.equal(response.status, expected);
    const text = await response.text();
    assert.equal(JSON.parse(text).errorCode, code);
    assert.ok(!text.includes(env.AZURE_SEARCH_API_KEY));
    assert.equal(attempts, 1, 'No unmetered automatic retries');
    assert.equal(blob.state.count, 1);
    assert.equal(blob.state.slots.length, 0);
    if (upstream === 429) assert.equal(response.headers.get('retry-after'), '9');
  }
  for (const upstream of [
    () => new Response('not JSON', { headers: { 'Content-Type': 'application/json' } }),
    () => Response.json({ wrongShape: true }),
    () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1), { headers: { 'Content-Type': 'application/json' } }),
    () => { throw new Error('private transport diagnostics'); },
  ]) {
    const { app } = setup(upstream);
    const response = await post(app, bodyFor());
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes('private transport'));
  }
});

test('request cancellation propagates and releases the reserved concurrency slot', async () => {
  const controller = new AbortController();
  let begin;
  const began = new Promise(resolve => { begin = resolve; });
  const { app, blob } = setup(async (_url, options) => {
    begin();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  });
  const pending = post(app, bodyFor(), { signal: controller.signal });
  await began;
  assert.equal(blob.state.slots.length, 1);
  controller.abort();
  assert.equal((await pending).status, 499);
  assert.equal(blob.state.slots.length, 0);
  assert.equal(blob.state.count, 1);
});

test('total runtime budget cancels upstream with a 504 and no fallback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let begin;
  const began = new Promise(resolve => { begin = resolve; });
  const { app, blob } = setup(async (_url, options) => {
    begin();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  });
  const pending = post(app, bodyFor());
  await began;
  t.mock.timers.tick(65001);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.equal((await response.json()).errorCode, 'retrieval_timeout');
  assert.equal(blob.state.slots.length, 0);
});

test('signed browser sessions are anonymous, tamper-resistant and not authentication', () => {
  const first = anonymousSession('', env.SESSION_SECRET, true);
  assert.match(first.cookie, /HttpOnly; SameSite=Lax; Secure/);
  const reused = anonymousSession(first.cookie, env.SESSION_SECRET, true);
  assert.equal(reused.id, first.id);
  assert.equal(reused.cookie, null);
  assert.notEqual(anonymousSession(first.cookie.replace('fiq_session=', 'fiq_session=x'), env.SESSION_SECRET, true).id, first.id);
  assert.throws(() => anonymousSession('', '', true), error => error.status === 503);
});

test('5/session per rolling minute survives coordinator replacement; denied calls do not consume quota', async () => {
  const blob = new FakeBlob();
  for (let index = 0; index < 5; index++) {
    const coordinator = new BlobQuotaCoordinator(blob);
    const slot = await coordinator.reserve({ sessionId: 'same-browser', ip: '192.0.2.8', secret: env.SESSION_SECRET, lifetimeMs: 65000 });
    await coordinator.release(slot);
  }
  const restarted = new BlobQuotaCoordinator(blob);
  await assert.rejects(restarted.reserve({ sessionId: 'same-browser', ip: '192.0.2.8', secret: env.SESSION_SECRET, lifetimeMs: 65000 }), error => error.code === 'session_limit');
  assert.equal(blob.state.count, 5);
  blob.now += 60001;
  await restarted.reserve({ sessionId: 'same-browser', ip: '192.0.2.8', secret: env.SESSION_SECRET, lifetimeMs: 65000 });
  assert.equal(blob.state.count, 6);
});

test('30/IP per rolling minute applies to clients that discard cookies', async () => {
  const blob = new FakeBlob();
  for (let index = 0; index < 30; index++) {
    const coordinator = new BlobQuotaCoordinator(blob);
    const slot = await coordinator.reserve({ sessionId: 'browser-' + index, ip: '192.0.2.9', secret: env.SESSION_SECRET, lifetimeMs: 65000 });
    await coordinator.release(slot);
  }
  await assert.rejects(new BlobQuotaCoordinator(blob).reserve({ sessionId: 'new-cookie', ip: '192.0.2.9', secret: env.SESSION_SECRET, lifetimeMs: 65000 }), error => error.code === 'ip_limit');
  assert.equal(blob.state.count, 30);
  assert.ok(!JSON.stringify(blob.state).includes('192.0.2.9'));
});

test('10 global slots hold across overlapping clients/instances; stale slots expire safely', async () => {
  const blob = new FakeBlob();
  const reservations = await Promise.allSettled(Array.from({ length: 14 }, (_, index) => new BlobQuotaCoordinator(blob).reserve({
    sessionId: 'browser-' + index, ip: '192.0.2.' + index, secret: env.SESSION_SECRET, lifetimeMs: 95000,
  })));
  assert.equal(reservations.filter(result => result.status === 'fulfilled').length, 10);
  assert.equal(reservations.filter(result => result.status === 'rejected' && result.reason.code === 'concurrency_limit').length, 4);
  assert.equal(blob.state.count, 10);
  blob.now += 95001;
  const replacement = new BlobQuotaCoordinator(blob);
  await replacement.reserve({ sessionId: 'after-crash', ip: '192.0.2.99', secret: env.SESSION_SECRET, lifetimeMs: 95000 });
  assert.equal(blob.state.slots.length, 1);
  assert.equal(blob.state.count, 11);
});

test('1000 global calls/UTC day is durable and resets only on Storage-observed UTC rollover', async () => {
  const blob = new FakeBlob();
  const coordinator = new BlobQuotaCoordinator(blob);
  for (let index = 0; index < 1000; index++) {
    const slot = await coordinator.reserve({ sessionId: 'browser-' + index, ip: 'address-' + index, secret: env.SESSION_SECRET, lifetimeMs: 65000 });
    await coordinator.release(slot);
  }
  await assert.rejects(new BlobQuotaCoordinator(blob).reserve({ sessionId: 'one-more', ip: 'new-address', secret: env.SESSION_SECRET, lifetimeMs: 65000 }), error => error.code === 'daily_limit');
  assert.equal(blob.state.count, 1000);
  blob.now = Date.parse('2026-10-19T00:00:01Z');
  await coordinator.reserve({ sessionId: 'new-day', ip: 'new-address', secret: env.SESSION_SECRET, lifetimeMs: 65000 });
  assert.equal(blob.state.count, 1);
  assert.equal(blob.state.day, '2026-10-19');
});

test('quota failures, uncertain writes, invalid state and both kill switches fail closed before Azure', async () => {
  for (const mutation of [
    blob => { blob.available = false; },
    blob => { blob.failWrite = true; },
    blob => { blob.failRelease = true; },
    blob => { blob.state.version = 9; },
    blob => { blob.state.enabled = false; },
  ]) {
    let called = 0;
    const { app, blob } = setup(async () => { called++; return Response.json(indexedFixture); });
    mutation(blob);
    assert.equal((await post(app, bodyFor())).status, 503);
    assert.equal(called, 0);
  }
});

test('operational telemetry is allowlisted, redacted and correlated; no question/IP/session/raw diagnostic', async () => {
  const { app, events } = setup();
  const body = bodyFor();
  body.request.messages[0].content[0].text = 'Do not log this exact question';
  const response = await post(app, body);
  const data = await response.json();
  assert.equal(events[0].requestId, data.requestId);
  assert.equal(events[0].referenceCount, 2);
  assert.deepEqual(Object.keys(events[0]).sort(), ['elapsedMs', 'event', 'mode', 'referenceCount', 'requestId', 'scenarioId', 'status', 'upstreamRequestId', 'upstreamStatus'].sort());
  const text = JSON.stringify(events);
  for (const forbidden of [env.AZURE_SEARCH_API_KEY, env.SESSION_SECRET, '192.0.2.1', 'Do not log this exact question', 'Approval is pending']) assert.ok(!text.includes(forbidden));
});

test('credential-bearing questions and provider request IDs are redacted in snapshots and logs', async () => {
  const { app, events } = setup(async () => Response.json(indexedFixture, { headers: { 'request-id': env.AZURE_SEARCH_API_KEY } }));
  const body = bodyFor();
  body.request.messages[0].content[0].text = 'Accidentally supplied ' + env.AZURE_SEARCH_API_KEY;
  const response = await post(app, body);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(text).effectiveRequest.redacted, true);
  assert.ok(!text.includes(env.AZURE_SEARCH_API_KEY));
  assert.ok(!JSON.stringify(events).includes(env.AZURE_SEARCH_API_KEY));
});

test('trusted proxy uses verified rightmost IP only; arbitrary forwarded host never sets origin', async () => {
  const incoming = { headers: { 'x-forwarded-for': 'forged, 192.0.2.44:1234' }, socket: { remoteAddress: '::ffff:127.0.0.1' } };
  assert.equal(clientIp(incoming, {}), '127.0.0.1');
  assert.equal(clientIp(incoming, { FOUNDRY_IQ_TRUST_APP_SERVICE_PROXY: 'true', WEBSITE_INSTANCE_ID: 'test-instance' }), '192.0.2.44');
  incoming.headers['x-forwarded-for'] = 'forged';
  assert.equal(clientIp(incoming, { FOUNDRY_IQ_TRUST_APP_SERVICE_PROXY: 'true', WEBSITE_INSTANCE_ID: 'test-instance' }), 'unknown');
});

test('rolling browser/IP windows survive UTC midnight and backwards Storage time fails closed', async () => {
  const blob = new FakeBlob();
  blob.now = Date.parse('2026-10-18T23:59:50Z');
  const coordinator = new BlobQuotaCoordinator(blob);
  for (let index = 0; index < 5; index++) {
    const slot = await coordinator.reserve({ sessionId: 'midnight-browser', ip: 'same-ip', secret: env.SESSION_SECRET, lifetimeMs: 65000 });
    await coordinator.release(slot);
  }
  blob.now += 20000;
  await assert.rejects(coordinator.reserve({ sessionId: 'midnight-browser', ip: 'same-ip', secret: env.SESSION_SECRET, lifetimeMs: 65000 }), error => error.code === 'session_limit');
  const slot = await coordinator.reserve({ sessionId: 'other-browser', ip: 'other-ip', secret: env.SESSION_SECRET, lifetimeMs: 65000 });
  await coordinator.release(slot);
  assert.equal(blob.state.count, 1);
  blob.now -= 40000;
  await assert.rejects(coordinator.reserve({ sessionId: 'another-browser', ip: 'another-ip', secret: env.SESSION_SECRET, lifetimeMs: 65000 }), error => error.code === 'quota_unavailable');
});

test('source membership drift is rejected without exposing unexpected source data', async () => {
  const { app } = setup(async () => Response.json(fixture));
  const response = await post(app, bodyFor());
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.equal(result.errorCode, 'source_membership_drift');
  assert.equal(Object.hasOwn(result, 'data'), false);
});

test('real HTTP clients share signed session limits across two overlapping backend instances', async t => {
  const blob = new FakeBlob();
  const first = setup(undefined, blob);
  const second = setup(undefined, blob);
  const servers = [createNodeServer(first.app, env), createNodeServer(second.app, env)];
  for (const server of servers) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  t.after(() => servers.forEach(server => { server.closeAllConnections(); server.close(); }));
  const cookie = anonymousSession('', env.SESSION_SECRET, true).cookie.split(';')[0];
  const statuses = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
    const server = servers[index % 2];
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/retrieve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(bodyFor()),
    });
    return response.status;
  }));
  assert.equal(statuses.filter(status => status === 200).length, 5);
  assert.equal(statuses.filter(status => status === 429).length, 1);
  assert.equal(blob.state.count, 5);
  assert.equal(blob.state.slots.length, 0);
  const restarted = setup(undefined, blob);
  assert.equal((await post(restarted.app, bodyFor(), { headers: { Cookie: cookie } })).status, 429);
});

test('bridge client disconnect cancels the upstream attempt and preserves conservative accounting', async t => {
  let begin;
  let cancelled;
  const began = new Promise(resolve => { begin = resolve; });
  const stopped = new Promise(resolve => { cancelled = resolve; });
  const { app, blob } = setup(async (_url, options) => {
    begin();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { cancelled(); reject(options.signal.reason); }, { once: true }));
  });
  const server = createNodeServer(app, env);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = `http://127.0.0.1:${server.address().port}`;
  const request = httpRequest(address + '/api/retrieve', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  request.on('error', () => {});
  request.end(JSON.stringify(bodyFor()));
  await began;
  request.destroy();
  await stopped;
  for (let index = 0; index < 20 && blob.state.slots.length; index++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(blob.state.slots.length, 0);
  assert.equal(blob.state.count, 1);
  assert.equal((await fetch(address + '/healthz')).status, 200);
});

test('production bridge handles chunked limits, canonical origin, direct clients and health without paid calls', async t => {
  const { app, blob } = setup();
  const server = createNodeServer(app, env);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(address + '/healthz', { headers: { Host: 'untrusted.invalid', 'X-Forwarded-Host': 'untrusted.invalid' } });
  assert.equal(health.status, 200);
  assert.equal(blob.state.count, 0);
  assert.equal((await fetch(address + '/api/retrieve', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: env.PUBLIC_ORIGIN },
    body: JSON.stringify(bodyFor()),
  })).status, 200);
  const oversized = await new Promise((resolve, reject) => {
    const request = httpRequest(address + '/api/retrieve', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    request.write('x'.repeat(MAX_REQUEST_BYTES / 2));
    request.write('x'.repeat(MAX_REQUEST_BYTES / 2 + 1));
    request.end();
  });
  assert.equal(oversized.status, 413);
  assert.equal(JSON.parse(oversized.body).errorCode, 'body_too_large');
});

test('prebuilt artifact and sanitized ZIP are deterministic, allowlisted and start does not rebuild', async () => {
  const { app } = setup();
  const archive = await app.fetch(new Request(env.PUBLIC_ORIGIN + '/download'), env);
  const bytes = Buffer.from(await archive.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  assert.deepEqual(bytes, readFileSync(new URL('../dist/source.zip', import.meta.url)));
  assert.equal(readFileSync(new URL('./start.mjs', import.meta.url), 'utf8').includes('build.mjs'), false);
  const source = readFileSync(new URL('../dist/server/index.mjs', import.meta.url), 'utf8');
  assert.ok(!source.includes('__DATA__') && !source.includes('__ARCHIVE__'));
  assert.ok(statSync(new URL('../dist/server/index.mjs', import.meta.url)).size > 10000);
});
