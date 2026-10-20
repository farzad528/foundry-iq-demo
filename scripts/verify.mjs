import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request as httpRequest, createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createApplication } from '../dist/server/index.mjs';
import { BlobQuotaCoordinator, anonymousSession } from '../dist/server/lib/quota.mjs';
import { API_VERSION, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, readBounded, validateRequest } from '../dist/server/lib/protocol.mjs';
import { normalizeResponse, safeUrl } from '../dist/server/lib/normalize.mjs';
import { createNodeServer, clientIp } from '../lib/http.mjs';
import { publicCatalog, knowledgeBases, legacyKnowledgeBases } from '../config/knowledge-bases.mjs';
import { sourceIcon, sourceFamilies } from '../assets/source-icons.mjs';
import { REPORT, MAX_PAGE_BYTES, createReportPageReader, reportPageNumber, reportPageForReference } from '../dist/server/lib/report-pages.mjs';
import { API_VERSION as CLIENT_API_VERSION, buildRequest, conversationMessages, requestSnapshot, requestCode } from '../assets/request.mjs';
import { FakeBlob } from './test-support.mjs';
import { archiveFiles, operationalFiles } from './source-files.mjs';

const samples = JSON.parse(readFileSync(new URL('../config/scenarios.json', import.meta.url)));
const catalog = publicCatalog();
const fixture = JSON.parse(readFileSync(new URL('./fixtures/published-response.json', import.meta.url)));
const indexed = knowledgeBases[0];
const web = legacyKnowledgeBases[1];
const indexedFixture = structuredClone(fixture);
indexedFixture.references = indexedFixture.references.filter(reference => reference.type === 'azureBlob');
indexedFixture.activity = indexedFixture.activity.filter(activity => !['web', 'searchIndex', 'modelWebSummarization'].includes(activity.type));
indexedFixture.activity.find(activity => activity.type === 'azureBlob').knowledgeSourceName = indexed.sources[0].name;
const sourceIconCases = [
  ['azureBlob', { icon: '/assets/blob.svg', label: 'Blob', access: 'Indexed' }],
  ['searchIndex', { icon: '/assets/search.svg', label: 'Search index', access: 'Indexed' }],
  ['web', { icon: '/assets/web.svg', label: 'Web', access: 'Remote' }],
  ['fabricDataAgent', { icon: '/assets/fabric.svg', label: 'Fabric data agent', access: 'Remote' }],
  ['remoteSharePoint', { icon: '/assets/sharepoint.svg', label: 'SharePoint', access: 'Remote' }],
];
const sourceIconFiles = [...new Set([...sourceIconCases.map(([, entry]) => entry.icon.slice(1)), ...sourceFamilies.map(entry => entry.icon.slice(1)), 'assets/source.svg'])];
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
  maxOutputSize: 5001,
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

test('the public catalog contains exactly four use-case live KBs with isolated Blob sources', () => {
  assert.deepEqual(knowledgeBases.map(kb => kb.id), ['zava-hr-policy', 'zava-finance-documents', 'zava-technical-manuals', 'zava-state-of-ai-report']);
  for (const kb of knowledgeBases) {
    assert.equal(kb.sources.length, 1);
    assert.equal(kb.sources[0].name, kb.id + '-source');
    assert.equal(kb.sources[0].kind, 'azureBlob');
    assert.equal(kb.suggestions.length, 2);
    assert.equal(kb.question, kb.suggestions[0].question);
  }
  assert.ok(catalog.every(item => item.execution === 'live' && !Object.hasOwn(item, 'fixture') && !Object.hasOwn(item, 'answer')));
  assert.deepEqual(knowledgeBases[3].report, { version: REPORT.version, pageCount: REPORT.pageCount });
});

test('source icon registry covers every catalog kind without changing source labels or access modes', () => {
  const kinds = [...new Set(catalog.flatMap(scenario => scenario.sources.map(source => source.kind)))];
  assert.deepEqual(kinds, ['azureBlob']);
  for (const [kind, expected] of sourceIconCases) assert.deepEqual(sourceIcon(kind), expected, kind);
  assert.equal(new Set(sourceIconCases.map(([kind]) => sourceIcon(kind).icon)).size, sourceIconCases.length);
});

test('on-demand source gallery names all twelve source families without inventing REST enum mappings', () => {
  assert.deepEqual(sourceFamilies.map(item => item.id), ['search-index', 'blob', 'sql', 'file', 'onelake',
    'sharepoint-indexed', 'sharepoint-remote', 'fabric-agent', 'fabric-ontology', 'mcp', 'workiq', 'web']);
  assert.ok(sourceFamilies.every(item => ['Indexed', 'Remote'].includes(item.access) && !Object.hasOwn(item, 'kind')));
});

test('all four actual public catalog entries dispatch defaults unchanged to their own OData target', async () => {
  for (const kb of knowledgeBases) {
    const data = structuredClone(indexedFixture);
    data.activity.find(activity => activity.type === 'azureBlob').knowledgeSourceName = kb.sources[0].name;
    const { app, blob } = setup(async (url, options) => {
      assert.equal(url.pathname, `/knowledgebases('${kb.id}')/retrieve`);
      assert.deepEqual(JSON.parse(options.body), buildRequest({ question: kb.question }));
      return Response.json(data);
    });
    const response = await post(app, { scenarioId: kb.id, mode: 'live', request: buildRequest({ question: kb.question }) });
    assert.equal(response.status, 200, kb.id);
    assert.equal((await response.json()).sample, false);
    assert.equal(blob.state.count, 1);
  }
});

test('report page mapping requires exact versioned original Blob provenance, never titles or citation IDs', () => {
  const path = page => `https://stfoundryiqcustomerdemos.blob.core.windows.net/demo-content/zava/report-text/${REPORT.version}/page-${String(page).padStart(3, '0')}.txt`;
  const reference = { kind: 'azureBlob', sourceName: REPORT.sourceName,
    id: 'page-99', title: 'Page 77', annotation: { blobUrl: path(8) } };
  assert.equal(reportPageForReference(reference), 8);
  assert.equal(reportPageForReference({ ...reference, annotation: { sourceData: { blob_url: path(244) } } }), 244);
  for (const url of [path(0), path(245), path(8).replace(REPORT.version, 'other-version'),
    path(8).replace('stfoundryiqcustomerdemos.', 'other.'), path(8).replace('https:', 'http:'),
    path(8) + '?url=elsewhere', path(8) + '#page=8', path(8).replace('page-008', '%70age-008')]) {
    assert.equal(reportPageForReference({ ...reference, annotation: { blobUrl: url } }), null, url);
  }
  assert.equal(reportPageForReference({ ...reference, sourceName: 'other-source' }), null);
  assert.equal(reportPageForReference({ ...reference, annotation: { docKey: 'page-008', sourceData: { page: '8' } } }), null);
  assert.equal(reportPageForReference({ ...reference, annotation: { blobUrl: path(8), sourceData: { blob_url: path(9) } } }), null);
});

test('report references expose a page preview only after exact source membership and Blob mapping', async () => {
  const kb = knowledgeBases[3];
  const data = structuredClone(indexedFixture);
  data.activity.find(activity => activity.type === 'azureBlob').knowledgeSourceName = REPORT.sourceName;
  data.references[0].blobUrl = `https://stfoundryiqcustomerdemos.blob.core.windows.net/demo-content/zava/report-text/${REPORT.version}/page-008.txt`;
  const { app } = setup(async () => Response.json(data));
  const response = await post(app, bodyFor(kb));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).normalized.references[0].reportPage, 8);
  data.activity.find(activity => activity.type === 'azureBlob').knowledgeSourceName = indexed.sources[0].name;
  assert.equal((await post(app, bodyFor(kb))).status, 502);
});

// Header-level stream double, not report content or live image evidence.
const pageBytes = Buffer.alloc(33);
Buffer.from('89504e470d0a1a0a', 'hex').copy(pageBytes);
pageBytes.writeUInt32BE(13, 8);
pageBytes.write('IHDR', 12);
pageBytes.writeUInt32BE(1, 16);
pageBytes.writeUInt32BE(1, 20);
function pageResponse(bytes = pageBytes, page = 8) {
  return {
    readableStreamBody: Readable.from([bytes]), contentType: 'image/png', contentLength: bytes.length,
    metadata: { owner: 'foundryiq-zava-20261020', reportsha256: REPORT.sha256, originalpage: String(page),
      contentsha256: createHash('sha256').update(bytes).digest('hex') },
  };
}

test('the image reader selects only the fixed private container path, verifies bytes and disables stream retries', async () => {
  let calls = 0;
  const reader = createReportPageReader({ containerClient: {
    getBlobClient(path) {
      assert.equal(path, `${REPORT.version}/page-008.png`);
      return { async download(offset, count, options) {
        calls++;
        assert.equal(offset, 0);
        assert.equal(count, MAX_PAGE_BYTES + 1);
        assert.equal(options.maxRetryRequests, 0);
        assert.ok(options.abortSignal instanceof AbortSignal);
        return pageResponse();
      } };
    },
  } });
  assert.deepEqual(await reader(8), pageBytes);
  assert.equal(calls, 1);
  await assert.rejects(reader(245), error => error.status === 404);
  assert.equal(calls, 1);
});

test('page MIME, ownership, version, page, size, content digest and image dimensions all fail closed', async () => {
  for (const mutate of [
    response => { response.contentType = 'image/svg+xml'; },
    response => { response.contentLength = MAX_PAGE_BYTES + 1; },
    response => { response.metadata.owner = 'other-owner'; },
    response => { response.metadata.reportsha256 = '0'.repeat(64); },
    response => { response.metadata.originalpage = '9'; },
    response => { response.metadata.contentsha256 = '0'.repeat(64); },
    response => { response.contentLength--; },
    response => { response.readableStreamBody = Readable.from([Buffer.from('not a PNG')]); },
    response => {
      const bytes = Buffer.from(pageBytes);
      bytes.writeUInt32BE(1601, 16);
      Object.assign(response, pageResponse(bytes));
    },
    response => { response.readableStreamBody = Readable.from([Buffer.alloc(MAX_PAGE_BYTES + 1)]); },
  ]) {
    let calls = 0;
    const response = pageResponse();
    mutate(response);
    const reader = createReportPageReader({ containerClient: { getBlobClient() {
      return { async download() { calls++; return response; } };
    } } });
    await assert.rejects(reader(8), error => error.code === 'invalid_report_page', mutate.toString());
    assert.equal(calls, 1);
    assert.equal(response.readableStreamBody.destroyed, true);
  }
});

test('page access errors are explicit without leaking provider diagnostics or using a replacement image', async () => {
  for (const statusCode of [403, 404, 500]) {
    let calls = 0;
    const reader = createReportPageReader({ containerClient: { getBlobClient() {
      return { async download() { calls++; throw Object.assign(new Error('secret provider diagnostic'), { statusCode }); } };
    } } });
    await assert.rejects(reader(8), error => error.status === (statusCode === 404 ? 404 : 503)
      && error.code === 'report_page_unavailable' && !error.message.includes('secret'));
    assert.equal(calls, 1);
  }
});

test('image concurrency is bounded independently from Retrieve and releases reservations after completion', async () => {
  const waiting = [];
  const reader = createReportPageReader({ containerClient: { getBlobClient() {
    return { download() { return new Promise(resolve => waiting.push(resolve)); } };
  } } });
  const pending = [reader(8), reader(8), reader(8), reader(8)];
  await assert.rejects(reader(8), error => error.status === 429);
  assert.equal(waiting.length, 4);
  waiting.splice(0).forEach(resolve => resolve(pageResponse()));
  await Promise.all(pending);
  const next = reader(8);
  waiting.pop()(pageResponse());
  await next;
});

test('image cancellation and its total deadline abort stalled response streams without retries', async () => {
  for (const cancellation of [true, false]) {
    const controller = new AbortController();
    const reader = createReportPageReader({ timeoutMs: 15, containerClient: { getBlobClient() {
      return { async download() { return { ...pageResponse(), readableStreamBody: new Readable({ read() {} }) }; } };
    } } });
    const pending = reader(8, controller.signal);
    if (cancellation) setTimeout(() => controller.abort(), 1);
    const keepAlive = setTimeout(() => {}, 100);
    try { await assert.rejects(pending, error => error.status === (cancellation ? 499 : 504)); }
    finally { clearTimeout(keepAlive); }
  }
});

test('the report route accepts only exact in-range PNG GETs, never arbitrary Storage URLs or paths', async () => {
  let calls = 0;
  const { coordinator, blob } = setup();
  const app = createApplication({ coordinator, readReportPage: async page => { calls++; assert.equal(page, 8); return pageBytes; } });
  const base = `/api/report-pages/${REPORT.version}/`;
  assert.equal(reportPageNumber(base + '1.png'), 1);
  assert.equal(reportPageNumber(base + '244.png'), 244);
  for (const path of [base + '0.png', base + '245.png', base + '008.png', base + '-1.png',
    base + '8.svg', base + '%2f8.png', base + '8.png?url=https://other.test', '/api/report-pages/other/8.png']) {
    assert.equal((await app.fetch(new Request(env.PUBLIC_ORIGIN + path), env)).status, 404, path);
  }
  const url = env.PUBLIC_ORIGIN + base + '8.png';
  const postResponse = await app.fetch(new Request(url, { method: 'POST' }), env);
  assert.equal(postResponse.status, 405);
  assert.equal(postResponse.headers.get('allow'), 'GET');
  assert.equal((await app.fetch(new Request(url), { ...env, FOUNDRY_IQ_LIVE_ENABLED: 'false' })).status, 503);
  assert.equal(calls, 0);
  const response = await app.fetch(new Request(url), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pageBytes);
  assert.equal(calls, 1);
  assert.equal(blob.state.count, 0);
});

test('unknown source kinds, including Object prototype names, use the neutral fallback', () => {
  for (const kind of [undefined, null, '', 'futureSource', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.deepEqual(sourceIcon(kind), {
      icon: '/assets/source.svg', label: kind || 'Source', access: 'Unclassified',
    }, String(kind));
  }
});

test('built public registry and every source icon serve exact local bytes with correct content types', async () => {
  const { app, blob } = setup(() => assert.fail('Serving source icons must not call Azure'));
  const publicEnv = { ...env, FOUNDRY_IQ_LIVE_ENABLED: 'false' };
  for (const path of ['assets/source-icons.mjs', ...sourceIconFiles]) {
    assert.ok(archiveFiles.includes(path), path + ' must be in the standalone source allowlist');
    const response = await app.fetch(new Request(env.PUBLIC_ORIGIN + '/' + path), publicEnv);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('content-type'),
      path.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript; charset=utf-8', path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path);
    assert.equal(response.headers.get('set-cookie'), null, path);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), readFileSync(new URL('../' + path, import.meta.url)), path);
  }
  assert.equal(blob.state.count, 0);
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

test('every retired replay identity and all non-live modes fail before any quota or Azure call', async () => {
  const { app, blob } = setup(() => assert.fail('Recorded examples must not be executable'));
  for (const scenario of [...samples, indexed]) {
    assert.equal((await post(app, { scenarioId: scenario.id, mode: 'sample', request: requestFor(scenario) })).status, 400);
  }
  for (const mode of [undefined, null, 'replay', 'LIVE']) assert.equal((await post(app, { ...bodyFor(), mode })).status, 400);
  assert.equal(blob.state.count, 0);
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
    body => { body.request.maxOutputSize = 0; },
    body => { body.request.maxOutputSize = 5000; },
    body => { body.request.maxOutputSize = 10001; },
    body => { body.request.maxOutputSizeInTokens = 4000; },
    body => { delete body.request.maxOutputSize; body.request.maxOutputSizeInTokens = 4000; },
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

test('actual-service output token bounds match UI, canaries and explicit request snapshots', async () => {
  const page = readFileSync(new URL('../page.html', import.meta.url), 'utf8');
  assert.match(page, /id="tokens"[^>]*min="5001"[^>]*max="10000"[^>]*placeholder="Service default"/);
  assert.doesNotMatch(page.match(/<input id="tokens"[^>]*>/)[0], /\bvalue=/);
  const { app } = setup();
  for (const maxOutputSize of [5001, 10000]) {
    const body = bodyFor();
    body.request.maxOutputSize = maxOutputSize;
    const response = await post(app, body);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).effectiveRequest.body.maxOutputSize, maxOutputSize);
  }
});

test('browser defaults omit every runtime and source override, while explicit false is preserved', () => {
  const defaults = buildRequest({ question: '  First question  ', sources: indexed.sources });
  assert.deepEqual(defaults, { messages: [{ role: 'user', content: [{ type: 'text', text: 'First question' }] }] });
  const explicit = buildRequest({
    question: 'First question', effort: 'auto', output: 'extractiveData', runtime: '120', tokens: '10000', activity: 'false',
    sources: indexed.sources.map(source => ({ ...source, includeReferences: 'false', includeReferenceSourceData: 'true', alwaysQuerySource: '' })),
  });
  assert.deepEqual(explicit.retrievalReasoningEffort, { kind: 'auto' });
  assert.equal(explicit.includeActivity, false);
  assert.equal(explicit.maxRuntimeInSeconds, 120);
  assert.equal(explicit.maxOutputSize, 10000);
  assert.equal(explicit.knowledgeSourceParams[0].includeReferences, false);
  assert.equal(explicit.knowledgeSourceParams[0].includeReferenceSourceData, true);
  assert.ok(!Object.hasOwn(explicit.knowledgeSourceParams[0], 'alwaysQuerySource'));
  assert.deepEqual(buildRequest({ question: 'First question', sources: indexed.sources }), defaults, 'Reset returns to omitted overrides');
  for (const options of [{ runtime: '9' }, { runtime: '121' }, { tokens: '5000' }, { tokens: '10001' }, { activity: 'invalid' }]) {
    assert.throws(() => buildRequest({ question: 'Question', ...options }));
  }
});

test('conversation payloads include completed text in order without mutating retained turns or draft snapshots', () => {
  const turns = [
    { question: 'First question', result: { normalized: { text: 'First answer [ref_id:0]' } } },
    { question: 'Failed question', error: 'Network error' },
    { question: 'Second question', result: { normalized: { text: 'Second answer' } } },
  ];
  const history = conversationMessages(turns);
  const request = buildRequest({ question: 'Follow-up', history });
  assert.deepEqual(request.messages.map(message => message.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  assert.deepEqual(request.messages.map(message => message.content[0].text),
    ['First question', 'First answer [ref_id:0]', 'Second question', 'Second answer', 'Follow-up']);
  const snapshot = requestSnapshot(indexed.id, request);
  request.messages[0].content[0].text = 'Changed draft';
  assert.equal(history[0].content[0].text, 'First question');
  assert.equal(snapshot.body.messages[0].content[0].text, 'First question');
  assert.equal(snapshot.sent, false);
  assert.throws(() => conversationMessages([{ result: { normalized: { text: '' } } }]), /no assistant text/);
});

test('minimal browser code honestly uses intents, and cannot silently drop conversation history or source overrides', () => {
  const options = { question: 'Question', effort: 'minimal', output: 'extractiveData' };
  assert.deepEqual(buildRequest(options).intents, [{ type: 'semantic', search: 'Question' }]);
  assert.ok(!Object.hasOwn(buildRequest(options), 'messages'));
  assert.throws(() => buildRequest({ ...options, history: requestFor(indexed).messages }), /conversation history/);
  assert.throws(() => buildRequest({ ...options, output: '' }), /extractive/);
  assert.throws(() => buildRequest({ ...options, sources: [{ ...indexed.sources[0], alwaysQuerySource: 'false' }] }), /Service default/);
});

test('Show code keeps the pinned OData route, full messages and shell-safe text without server credentials', () => {
  assert.equal(CLIENT_API_VERSION, API_VERSION);
  const request = buildRequest({
    question: "What's $(echo unsafe) `command` and \"quoted\"?",
    history: [{ role: 'user', content: [{ type: 'text', text: 'Earlier' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }] }],
  });
  const snapshot = { ...requestSnapshot(indexed.id, request), clientRequestId: 'test-request-id', sent: true };
  const curl = requestCode(snapshot);
  assert.ok(curl.includes(`\${AZURE_SEARCH_ENDPOINT}/knowledgebases('${indexed.id}')/retrieve?api-version=${API_VERSION}`));
  assert.ok(curl.includes('api-key: ${AZURE_SEARCH_API_KEY}'));
  assert.ok(curl.includes('x-ms-client-request-id: test-request-id'));
  assert.ok(curl.includes("What'\\''s $(echo unsafe)"));
  assert.deepEqual(JSON.parse(requestCode(snapshot, 'json')), request);
  assert.ok(!curl.includes(env.AZURE_SEARCH_API_KEY));
  assert.throws(() => requestCode(snapshot, 'unknown'), /Unsupported code format/);
});

test('service-default requests reach Search unchanged and follow-ups retain every validated message', async () => {
  const dispatched = [];
  const { app, blob } = setup(async (_url, options) => { dispatched.push(JSON.parse(options.body)); return Response.json(indexedFixture); });
  const request = buildRequest({ question: 'A first question' });
  const first = await post(app, { scenarioId: indexed.id, mode: 'live', request });
  assert.equal(first.status, 200);
  const result = await first.json();
  assert.deepEqual(dispatched[0], request);
  assert.deepEqual(result.effectiveRequest.body, request);
  assert.equal(result.effectiveRequest.sent, true);
  const history = conversationMessages([{ question: 'A first question', result }]);
  const followup = buildRequest({ question: 'What about the remaining evidence?', history });
  const next = await post(app, { scenarioId: indexed.id, mode: 'live', request: followup });
  assert.equal(next.status, 200);
  assert.deepEqual(dispatched[1], followup);
  assert.equal((await next.json()).effectiveRequest.body.messages.length, 3);
  assert.equal(blob.state.count, 2);
  assert.equal(blob.state.slots.length, 0);
});

test('conversation validation rejects role injection, malformed history and invalid overrides before reserving quota', async () => {
  const { app, blob } = setup(() => assert.fail('Invalid history must not reach Search'));
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'First question' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'First answer' }] },
    { role: 'user', content: [{ type: 'text', text: 'Follow-up' }] },
  ];
  for (const mutate of [
    request => { request.messages[0].role = 'assistant'; },
    request => { request.messages[1].role = 'system'; },
    request => { request.messages[1].role = 'tool'; },
    request => { request.messages[1].role = 'user'; },
    request => { request.messages.pop(); },
    request => { request.messages[0].content[0].text = 'x'.repeat(8001); },
    request => { request.messages[1].content[0].text = ''; },
    request => { request.messages[1].content[0].text = null; },
    request => { request.messages[1].content.push({ type: 'text', text: 'Extra' }); },
    request => { request.messages[1].content[0].type = 'image'; },
    request => { request.messages[1].tool_calls = []; },
    request => { request.retrievalReasoningEffort = {}; },
    request => { request.outputMode = null; },
  ]) {
    const request = { messages: structuredClone(messages) };
    mutate(request);
    assert.equal((await post(app, { scenarioId: indexed.id, mode: 'live', request })).status, 400, mutate.toString());
  }
  assert.equal(blob.state.count, 0);
});

test('full conversation envelopes honor the exact 64-KiB streaming bound without truncation', async () => {
  const dispatched = [];
  const { app, blob } = setup(async (_url, options) => { dispatched.push(JSON.parse(options.body)); return Response.json(indexedFixture); });
  const body = { scenarioId: indexed.id, mode: 'live', request: { messages: [
    { role: 'user', content: [{ type: 'text', text: 'First' }] },
    { role: 'assistant', content: [{ type: 'text', text: '' }] },
    { role: 'user', content: [{ type: 'text', text: 'Follow-up' }] },
  ] } };
  body.request.messages[1].content[0].text = 'a'.repeat(MAX_REQUEST_BYTES - Buffer.byteLength(JSON.stringify(body)));
  assert.equal(Buffer.byteLength(JSON.stringify(body)), MAX_REQUEST_BYTES);
  assert.equal((await post(app, body)).status, 200);
  assert.deepEqual(dispatched[0], body.request);
  body.request.messages[1].content[0].text += 'é';
  assert.equal((await post(app, body)).status, 413);
  assert.equal(dispatched.length, 1);
  assert.equal(blob.state.count, 1);
});

test('recorded replay mode cannot bypass rejection by supplying valid conversation history', async () => {
  const { app, blob } = setup(() => assert.fail('Replay must never call Search'));
  const request = buildRequest({ question: samples[0].question, history: [
    { role: 'user', content: [{ type: 'text', text: samples[0].question }] },
    { role: 'assistant', content: [{ type: 'text', text: 'A prior answer' }] },
  ] });
  const response = await post(app, { scenarioId: samples[0].id, mode: 'sample', request });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).errorCode, 'invalid_request');
  assert.equal(blob.state.count, 0);
});

test('chat UI starts with closed dialogs and blank service-default controls rather than permanent inspectors', async () => {
  const { app } = setup();
  const page = await (await app.fetch(new Request(env.PUBLIC_ORIGIN), env)).text();
  for (const id of ['knowledge-base', 'messages', 'chat-form', 'settings-button', 'show-code', 'code', 'code-request', 'evidence', 'reset-settings', 'help-button']) {
    assert.ok(page.includes(`id="${id}"`), id);
  }
  assert.doesNotMatch(page, /<dialog[^>]*\sopen(?:\s|>)/);
  assert.match(page, /id="source-gallery"/);
  assert.match(page, /id="report"/);
  const client = readFileSync(new URL('../assets/client.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(client, /Not sent to Azure|Auto is an explicit effort|Synthetic replay|mode === 'sample'/);
  for (const id of ['effort', 'output', 'include-activity']) assert.match(page, new RegExp(`id="${id}"><option value="">Service default</option>`));
  for (const path of ['assets/request.mjs', 'assets/client.mjs']) {
    assert.ok(archiveFiles.includes(path));
    const response = await app.fetch(new Request(env.PUBLIC_ORIGIN + '/' + path), env);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
  }
});

test('service defaults still enforce the application total runtime budget and release quota slots', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let begin;
  const began = new Promise(resolve => { begin = resolve; });
  const { app, blob } = setup(async (_url, options) => {
    begin();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  });
  const pending = post(app, { scenarioId: indexed.id, mode: 'live', request: buildRequest({ question: 'Question' }) });
  await began;
  t.mock.timers.tick(125001);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.equal((await response.json()).errorCode, 'retrieval_timeout');
  assert.equal(blob.state.count, 1);
  assert.equal(blob.state.slots.length, 0);
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
  assert.throws(() => validateRequest(withWeb, legacyKnowledgeBases.map(kb => ({ ...kb, execution: 'live' })), env), /Unsupported reasoning/);
  const medium = bodyFor();
  medium.request.retrievalReasoningEffort.kind = 'medium';
  assert.equal((await post(app, medium, { env: { FOUNDRY_IQ_MEDIUM_ENABLED: 'true' } })).status, 200);
});

test('published OData route, exact normalized snapshot, request-level maxOutputSize token budget, no invented defaults', async () => {
  const body = bodyFor();
  body.request.messages[0].content[0].text = '  An arbitrary question  ';
  delete body.request.maxRuntimeInSeconds;
  delete body.request.includeActivity;
  delete body.request.knowledgeSourceParams;
  let sent;
  const { app } = setup(async (url, options) => {
    assert.equal(url.hostname, 'demo.search.windows.net');
    assert.equal(url.pathname, `/knowledgebases('${indexed.id}')/retrieve`);
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
  assert.equal(sent.body.maxOutputSize, 5001);
  assert.equal(Object.hasOwn(sent.body, 'maxOutputSizeInTokens'), false);
  for (const field of ['maxRuntimeInSeconds', 'includeActivity', 'knowledgeSourceParams']) assert.equal(Object.hasOwn(sent.body, field), false);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(env.AZURE_SEARCH_API_KEY));
  assert.match(result.contractStatus, /real retrieval evidence/);
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

test('actual Blob sourceData.snippet is a returned passage, not missing or invented evidence', () => {
  const snippet = '# Fictional review\n\nRevision 2; reviewer acknowledgement remains pending.';
  const input = { response: [{ content: [{ type: 'text', text: 'Reviewer acknowledgement is pending.[ref_id:0]' }] }],
    activity: [{ id: 7, type: 'azureBlob', knowledgeSourceName: 'foundryiq-customer-demos-manuals' }],
    references: [{ id: '0', type: 'azureBlob', activitySource: 7,
      blobUrl: 'https://example.blob.core.windows.net/demo-content/manuals/review.md',
      sourceData: { uid: 'opaque-service-key', blob_url: 'https://example.blob.core.windows.net/demo-content/manuals/review.md', snippet } }] };
  const { normalized } = normalizeResponse(input);
  assert.equal(normalized.references[0].passage, snippet);
  assert.equal(normalized.references[0].activityLinked, true);
  assert.equal(normalized.citations[0].resolved, true);
  assert.equal(normalized.references[0].annotation.sourceData.snippet, snippet);
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
  const data = structuredClone(indexedFixture);
  data.references[0].url = 'https://public.example.test/doc?sig=secret&se=expiry&topic=safe';
  data.references[0].sourceData.apiKey = env.AZURE_SEARCH_API_KEY;
  data.references[0].sourceData.content = '<img src=x onerror=alert(1)> ' + env.AZURE_SEARCH_API_KEY;
  const { app } = setup(async () => Response.json(data));
  const result = await (await post(app, bodyFor())).json();
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(env.AZURE_SEARCH_API_KEY));
  assert.ok(!serialized.includes('sig=secret'));
  assert.equal(result.normalized.references[0].url, 'https://public.example.test/doc?topic=safe');
  assert.match(result.normalized.references[0].passage, /<img/);
});

test('partial results and activity errors retain evidence and safe original annotations', async () => {
  const partial = structuredClone(indexedFixture);
  partial.activity.find(activity => activity.id === 42).error = { code: 'DependencyUnavailable', message: 'Blob result incomplete' };
  const { app } = setup(async () => Response.json(partial, { status: 206, headers: { 'request-id': 'service-request-7' } }));
  const response = await post(app, bodyFor());
  assert.equal(response.status, 206);
  const result = await response.json();
  assert.equal(result.normalized.partial, true);
  assert.equal(result.upstreamStatus, 206);
  assert.equal(result.upstreamRequestId, 'service-request-7');
  assert.equal(result.normalized.references.length, 1);
  assert.ok(result.normalized.limitations.some(item => item.includes('42') && item.includes('failed')));
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
  assert.equal(events[0].referenceCount, 1);
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

test('downloaded source ZIP retains passive self-contained icons, provenance and reproducible packaging', async () => {
  const { app } = setup(() => assert.fail('Downloading source must not call Azure'));
  const archive = await app.fetch(new Request(env.PUBLIC_ORIGIN + '/download'),
    { ...env, FOUNDRY_IQ_LIVE_ENABLED: 'false' });
  assert.equal(archive.status, 200);
  assert.equal(archive.headers.get('content-type'), 'application/zip');
  assert.match(archive.headers.get('content-disposition'), /^attachment; filename="[^"]+\.zip"$/);
  const bytes = Buffer.from(await archive.arrayBuffer());
  assert.deepEqual(bytes, readFileSync(new URL('../dist/source.zip', import.meta.url)));
  for (const path of ['assets/source-icons.mjs', 'assets/PROVENANCE.md', ...sourceIconFiles]) {
    assert.ok(archiveFiles.includes(path), path);
  }
  const python = (process.env.PYTHON ? [process.env.PYTHON] : process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'])
    .find(command => {
      const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
      return result.status === 0 && result.stdout.startsWith('Python 3.');
    });
  assert.ok(python, 'Python 3 used by the build is required to inspect the downloaded source ZIP');
  const entries = JSON.parse(execFileSync(python, ['-c', `
import io,json,math,pathlib,re,stat,sys,zipfile
import xml.etree.ElementTree as ET
expected=json.loads(sys.argv[1])
icons=json.loads(sys.argv[2])
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 names=z.namelist()
 assert names==expected, 'Downloaded ZIP must exactly match the source allowlist'
 assert len(names)==len(set(names)), 'Downloaded ZIP must not contain duplicate entries'
 for name in names:
  info=z.getinfo(name)
  assert info.date_time==(1980,1,1,0,0,0), f'Non-reproducible ZIP timestamp: {name}'
  assert stat.S_ISREG(info.external_attr >> 16), f'ZIP entry must be a regular file: {name}'
  assert z.read(name)==pathlib.Path(name).read_bytes(), f'Archived source bytes differ: {name}'
 for name in icons:
  data=z.read(name)
  assert not re.search(br'<!DOCTYPE|<!ENTITY|<\\?xml-stylesheet',data,re.I), f'External XML declarations: {name}'
  root=ET.fromstring(data)
  namespace='{http://www.w3.org/2000/svg}'
  assert root.tag==namespace+'svg', f'Invalid SVG root: {name}'
  view_box=[float(value) for value in re.split(r'[\\s,]+',root.attrib.get('viewBox','').strip()) if value]
  assert len(view_box)==4 and all(math.isfinite(value) for value in view_box) and all(value>0 for value in view_box[2:]), f'Invalid SVG viewBox: {name}'
  ids={node.attrib['id'] for node in root.iter() if 'id' in node.attrib}
  active={'script','foreignobject','image','iframe','object','embed','audio','video','a','animate','animatemotion','animatetransform','set','discard'}
  for node in root.iter():
   assert node.tag.startswith(namespace) and node.tag[len(namespace):].lower() not in active, f'Active or foreign SVG element: {name}'
   values=list(node.attrib.values())+([node.text] if node.tag==namespace+'style' and node.text else [])
   for attribute,value in node.attrib.items():
    local=attribute.rsplit('}',1)[-1].lower()
    assert not local.startswith('on'), f'SVG event handler: {name}'
    if local=='href':
     assert value.startswith('#') and value[1:] in ids, f'External or unresolved SVG reference: {name}'
   for value in values:
    assert not re.search(r'@import|(?:javascript|vbscript|data)\\s*:',value,re.I), f'Active SVG attribute or style: {name}'
    for reference in re.findall(r'url\\s*\\(([^)]*)\\)',value,re.I):
     reference=reference.strip().strip(chr(34)+chr(39))
     assert reference.startswith('#') and reference[1:] in ids, f'External or unresolved SVG paint reference: {name}'
 print(json.dumps(names))
`, JSON.stringify(archiveFiles), JSON.stringify(sourceIconFiles)], {
    cwd: new URL('..', import.meta.url), input: bytes, maxBuffer: 10 * 1024 * 1024,
  }).toString());
  assert.deepEqual(entries, archiveFiles);
  assert.ok(operationalFiles.every(path => !entries.includes(path)));
});

test('public corpus is original, versioned and included without operator configuration', async () => {
  const corpus = JSON.parse(readFileSync(new URL('../samples/public-corpus.json', import.meta.url)));
  assert.equal(corpus.license, 'MIT');
  assert.equal(corpus.documents.length, 12);
  assert.equal(corpus.recordRecipe.count, 200);
  assert.match(corpus.disclaimer, /fictional/i);
  assert.ok(archiveFiles.includes('samples/public-corpus.json'));
  assert.ok(operationalFiles.every(path => !archiveFiles.includes(path)));
});

const operatorToolsPresent = operationalFiles.every(path => existsSync(new URL('../' + path, import.meta.url)));
test('repository-only operators are deliberately omitted from the standalone app ZIP', { skip: !operatorToolsPresent
  && 'App-only source ZIP: provisioning/capture/packaging tools intentionally excluded.' }, async t => {
  const { loadInputs, expandCorpus, buildPlan, provision, parseArgs, outsideOutput, operatorCredential, OperatorError } = await import('./provision-search.mjs');
  const { captureCanaries, canaryRequests } = await import('./capture-canary.mjs');
  const { runtimeFiles, packageRuntime } = await import('./package-appservice.mjs');
  const { localEnvironment, localLive } = await import('./local-live.mjs');
  const inputs = await loadInputs();
  const { definitions, corpus } = inputs;
  const directory = await mkdtemp(join(tmpdir(), 'foundryiq-operator-tests-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const operatorEnv = {
    ...env, AZURE_SEARCH_ENDPOINT: `https://${definitions.searchService}.search.windows.net`,
    FOUNDRY_MODEL_ENDPOINT: `https://${definitions.foundry.resource}.openai.azure.com`,
  };

  await t.test('deterministic exact 12/200 corpus, explicit approval statuses and controlled revisions', () => {
    const a = expandCorpus(corpus);
    assert.deepEqual(a, expandCorpus(corpus));
    assert.equal(a.documents.length, 12);
    assert.equal(a.records.length, 200);
    assert.equal(new Set(a.records.map(record => record.id)).size, 200);
    for (const record of a.records.filter(record => record.equipmentId === 'P-104'
      && ['reviewer acknowledgement', 'owner approval'].includes(record.recordType))) {
      assert.equal(record.reviewStatus, corpus.recordRecipe.overrides[record.id]?.reviewStatus || 'pending');
    }
    const changed = structuredClone(corpus);
    changed.recordRecipe.overrides['MR-0013'] = { reviewStatus: 'recorded', revision: 2 };
    const b = expandCorpus(changed);
    assert.equal(b.records[12].revision, 2);
    assert.equal(b.records[12].reviewStatus, 'recorded');
    assert.deepEqual(b.records[11], a.records[11]);
    changed.recordRecipe.overrides['missing-record'] = { reviewStatus: 'recorded', revision: 2 };
    assert.throws(() => expandCorpus(changed), OperatorError);
    const invalid = structuredClone(corpus);
    invalid.recordRecipe.firstDate = '2026-99-99';
    assert.throws(() => expandCorpus(invalid), OperatorError);
  });

  await t.test('protected original hybrid/model/source definitions retain their explicit legacy identities', () => {
    const plan = buildPlan(definitions, corpus, operatorEnv);
    assert.equal(definitions.foundry.kind, 'AIServices');
    assert.equal(plan.index.fields.find(field => field.name === 'contentVector').dimensions, 1536);
    assert.equal(plan.index.vectorSearch.profiles[0].vectorizer, 'foundry-vectorizer');
    assert.deepEqual(plan.knowledgeBases.map(kb => kb.name), legacyKnowledgeBases.map(kb => kb.id));
    for (let i = 0; i < 2; i++) assert.deepEqual(plan.knowledgeBases[i].knowledgeSources.map(source => source.name),
      legacyKnowledgeBases[i].sources.map(source => source.name));
    assert.deepEqual(plan.sources[2].webParameters.domains.allowedDomains, [{ address: 'osha.gov', includeSubpages: true }]);
    assert.throws(() => buildPlan(definitions, corpus, { ...operatorEnv,
      FOUNDRY_MODEL_ENDPOINT: 'https://unapproved.openai.azure.com' }, true), OperatorError);
  });

  await t.test('dry runs and failed explicit approvals cannot dispatch Azure calls', async () => {
    let calls = 0;
    const request = async () => { calls++; throw new Error('Network forbidden'); };
    assert.equal((await provision({ ...inputs, request })).azureCalls, 0);
    assert.equal((await captureCanaries({ definitions, fetchImpl: request })).azureCalls, 0);
    assert.equal((await localLive({ ...inputs, request })).azureCalls, 0);
    await assert.rejects(provision({ ...inputs, env: operatorEnv, apply: true, request }), /separate/);
    await assert.rejects(captureCanaries({ definitions, env: operatorEnv, execute: true, fetchImpl: request }), /requires/);
    await assert.rejects(localLive({ ...inputs, action: 'ingest', request }), /requires/);
    await assert.rejects(localLive({ ...inputs, action: 'capture', request }), /requires/);
    assert.equal(calls, 0);
    assert.throws(() => parseArgs(['--apply', '--apply'], ['--apply']), OperatorError);
    await assert.rejects(outsideOutput(resolve('capture.json')), /outside/);
    assert.equal(await outsideOutput(join(directory, 'safe.json')), join(await realpath(directory), 'safe.json'));
  });

  await t.test('local ingestion explicitly permits only loopback without weakening public HTTPS', () => {
    const local = { ...operatorEnv, PUBLIC_ORIGIN: 'http://127.0.0.1:3000' };
    assert.throws(() => buildPlan(definitions, corpus, local, true), /HTTPS/);
    assert.equal(buildPlan(definitions, corpus, local, true, { local: true }).publicDocumentUrl,
      'http://127.0.0.1:3000/samples/public-corpus.json');
    for (const origin of ['http://example.test:3000', 'http://localhost:3000', 'https://example.test']) {
      assert.throws(() => buildPlan(definitions, corpus, { ...local, PUBLIC_ORIGIN: origin }, true, { local: true }),
        /canonical PUBLIC_ORIGIN|exact HTTP 127/);
    }
  });

  function localDouble({ foreign = false, modelMismatch = false, location = definitions.location } = {}) {
    const calls = [];
    const secrets = new Map();
    const blob = new FakeBlob();
    blob.state.enabled = false;
    blob.state.count = 765;
    blob.state.day = '2026-10-18';
    const upload = blob.upload.bind(blob);
    blob.upload = async (text, length, options) => {
      if (options.conditions.ifNoneMatch === '*') throw { statusCode: 412 };
      return upload(text, length, options);
    };
    const result = (body, status = 200) => ({ body, response: Response.json(body, { status }) });
    const request = async (address, options = {}, scope) => {
      const url = new URL(address);
      calls.push({ url, method: options.method || 'GET', scope });
      if (url.hostname.endsWith('.vault.azure.net')) {
        const name = url.pathname.split('/').at(-1);
        if (options.method === 'PUT') secrets.set(name, JSON.parse(options.body).value);
        return secrets.has(name) ? result({ value: secrets.get(name) }) : result({}, 404);
      }
      if (url.pathname.endsWith('/listAdminKeys')) return result({ primaryKey: env.AZURE_SEARCH_API_KEY });
      if (url.hostname.endsWith('.search.windows.net')) {
        const name = url.pathname.split('/').at(-1);
        const sources = [definitions.manualSource, definitions.maintenanceSource, ...(name.endsWith('-web') ? [definitions.webSource] : [])];
        return result({ name, description: '[foundryiq-customer-demos] test', knowledgeSources: sources.map(name => ({ name })) });
      }
      if (url.pathname.includes('/deployments/')) {
        const kind = url.pathname.endsWith(definitions.foundry.retrievalDeployment) ? 'retrieval' : 'embedding';
        return result({ properties: { provisioningState: 'Succeeded',
          model: { name: definitions.foundry[kind + 'Model'], version: modelMismatch ? 'wrong' : definitions.foundry[kind + 'Version'] } },
        sku: { name: 'Standard', capacity: definitions.foundry[kind + 'Capacity'] } });
      }
      return result({ id: url.pathname, kind: 'AIServices', location,
        tags: { 'app-onboard-session-id': foreign ? 'someone-else' : definitions.onboardingSessionId, environment: definitions.owner },
        properties: { allowSharedKeyAccess: false, allowBlobPublicAccess: false, enableRbacAuthorization: true,
          allowProjectManagement: true, endpoints: { 'OpenAI Language Model Instance API': operatorEnv.FOUNDRY_MODEL_ENDPOINT + '/' } } });
    };
    return { calls, secrets, blob, request, quotaBlob: blob, credential: {} };
  }

  await t.test('local configuration isolates dedicated secrets, origin and proxy from inherited environments', () => {
    const local = localEnvironment(definitions, env, 32123);
    assert.equal(local.PUBLIC_ORIGIN, 'http://127.0.0.1:32123');
    assert.equal(local.FOUNDRY_IQ_TRUST_APP_SERVICE_PROXY, 'false');
    assert.equal(local.FOUNDRY_IQ_MEDIUM_ENABLED, 'false');
    assert.equal(local.AZURE_SEARCH_ENDPOINT, `https://${definitions.searchService}.search.windows.net`);
    assert.equal(local.AZURE_CLIENT_ID, undefined);
    assert.ok(Object.isFrozen(local));
    for (const port of [0, 65536, 3.5, '3000']) assert.throws(() => localEnvironment(definitions, env, port), OperatorError);
    assert.throws(() => localEnvironment(definitions, { ...env, SESSION_SECRET: '@Microsoft.KeyVault(test)' }), OperatorError);
  });

  await t.test('CLI auth selects the subscription and verifies tenant without mutually exclusive CLI flags', async () => {
    let options;
    class Credential {
      constructor(value) { options = value; }
    }
    const request = async (url, _options, auth) => {
      assert.ok(url.startsWith(`https://management.azure.com/subscriptions/${definitions.subscriptionId}?`));
      assert.ok(auth.credential instanceof Credential);
      assert.equal(auth.scope, 'https://management.azure.com/.default');
      return { response: { ok: true }, body: { subscriptionId: definitions.subscriptionId, tenantId: definitions.tenantId } };
    };
    assert.ok(await operatorCredential(definitions, { Credential, request }) instanceof Credential);
    assert.deepEqual(options, { subscription: definitions.subscriptionId, processTimeoutInMs: 10000 });
    await assert.rejects(operatorCredential(definitions, { Credential, request: async () => ({
      response: { ok: true }, body: { subscriptionId: definitions.subscriptionId, tenantId: 'wrong-tenant' },
    }) }), /subscription\/tenant/);
  });

  await t.test('local bootstrap exclusively seeds stable Vault secrets and never resets the ledger', async () => {
    const fake = localDouble();
    const before = structuredClone(fake.blob.state);
    const options = { ...inputs, ...fake, action: 'initialize' };
    const first = await localLive(options);
    const session = fake.secrets.get('session-secret');
    assert.equal(first.secretsCreated, 2);
    assert.ok(session.length >= 32 && session !== env.SESSION_SECRET);
    assert.equal(fake.secrets.get('search-api-key'), env.AZURE_SEARCH_API_KEY);
    assert.deepEqual(fake.blob.state, before);
    assert.equal(fake.blob.lease, null);
    const second = await localLive(options);
    assert.equal(second.secretsCreated, 0);
    assert.equal(second.secretsReused, 2);
    assert.equal(fake.secrets.get('session-secret'), session);
    assert.equal(fake.calls.filter(call => call.url.pathname.endsWith('/listAdminKeys')).length, 1);
    assert.equal(fake.calls.filter(call => call.method === 'PUT').length, 2);
    assert.deepEqual(fake.blob.state, before);
    assert.ok(fake.calls.every(call => !call.url.href.includes(session) && !call.url.href.includes(env.AZURE_SEARCH_API_KEY)));
  });

  await t.test('ARM region display names normalize without accepting a different deployment region', async () => {
    const same = localDouble({ location: 'West US 2' });
    assert.equal((await localLive({ ...inputs, ...same, action: 'initialize' })).initialized, true);
    const other = localDouble({ location: 'East US 2' });
    await assert.rejects(localLive({ ...inputs, ...other, action: 'initialize' }), /ownership\/topology/);
    assert.equal(other.secrets.size, 0);
    assert.equal(other.blob.state.count, 765);
  });

  await t.test('foreign topology, wrong models and missing secrets fail closed before live startup', async () => {
    for (const issue of [{ foreign: true }, { modelMismatch: true }]) {
      const fake = localDouble(issue);
      await assert.rejects(localLive({ ...inputs, ...fake, action: 'initialize' }), OperatorError);
      assert.equal(fake.secrets.size, 0);
      assert.equal(fake.calls.filter(call => call.method === 'PUT').length, 0);
    }
    const fake = localDouble();
    await assert.rejects(localLive({ ...inputs, ...fake, action: 'start' }), /secrets/);
    fake.blob.state.enabled = true;
    await assert.rejects(localLive({ ...inputs, ...fake, action: 'initialize' }), /Pause/);
    assert.equal(fake.secrets.size, 0);
    assert.equal(fake.blob.state.count, 765);
  });

  await t.test('local kill switch preserves counters and can pause without Search, Vault or models', async () => {
    const fake = localDouble();
    await localLive({ ...inputs, ...fake, action: 'initialize' });
    const enabled = await localLive({ ...inputs, ...fake, action: 'enable-live' });
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.count, 765);
    fake.calls.length = 0;
    const disabled = await localLive({ ...inputs, ...fake, action: 'disable-live' });
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.count, 765);
    assert.equal(fake.calls.length, 1);
    assert.ok(fake.calls[0].url.pathname.includes('Microsoft.Storage/storageAccounts/'));
    assert.equal(fake.blob.lease, null);
  });

  await t.test('prebuilt local live startup serves only IPv4 loopback without Python or a production credential fallback', async () => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const fake = localDouble();
    fake.secrets.set('search-api-key', env.AZURE_SEARCH_API_KEY);
    fake.secrets.set('session-secret', env.SESSION_SECRET);
    const { server, origin } = await localLive({ ...inputs, ...fake, action: 'start', port, log: () => {} });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    assert.equal(server.address().address, '127.0.0.1');
    assert.equal(origin, `http://127.0.0.1:${port}`);
    assert.equal((await fetch(origin + '/healthz')).status, 200);
    const config = await (await fetch(origin + '/api/config')).json();
    assert.equal(config.liveEnabled, true);
    assert.ok(!JSON.stringify(config).includes(env.SESSION_SECRET) && !JSON.stringify(config).includes(env.AZURE_SEARCH_API_KEY));
    assert.ok(fake.calls.every(call => call.method === 'GET'));
    const retrieve = () => fetch(origin + '/api/retrieve', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyFor()) });
    const paused = await retrieve();
    assert.equal(paused.status, 503);
    assert.equal((await paused.json()).errorCode, 'live_disabled');
    fake.blob.state.enabled = true;
    fake.blob.state.count = 1000;
    const daily = await retrieve();
    assert.equal(daily.status, 429);
    const denied = await daily.json();
    assert.equal(denied.errorCode, 'daily_limit');
    assert.equal(denied.effectiveRequest.sent, false);
    assert.equal(fake.blob.state.count, 1000);
    fake.blob.available = false;
    const unavailable = await retrieve();
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).errorCode, 'quota_unavailable');
  });

  function ingestionDouble({ unowned = false, partialIndex = false, malformedVectors = false, manualUpdateNoContent = false } = {}) {
    const calls = [];
    const blobs = new Map();
    let indexerWasRun = false;
    const oldStart = new Date(Date.now() - 60000).toISOString();
    const quota = { count: 765, enabled: false };
    const container = {
      getBlockBlobClient: name => ({
        getProperties: async () => { throw { statusCode: 404 }; },
        upload: async (text, length, options) => {
          assert.equal(length, Buffer.byteLength(text));
          assert.equal(options.conditions.ifNoneMatch, '*');
          blobs.set(name, options.metadata);
        },
      }),
      async *listBlobsFlat() { for (const [name, metadata] of blobs) yield { name, metadata }; },
    };
    const quotaBlob = {
      upload: async (text, length, options) => {
        assert.equal(JSON.parse(text).enabled, false);
        assert.equal(options.conditions.ifNoneMatch, '*');
        throw { statusCode: 412 };
      },
      getProperties: async () => ({ contentLength: 99 }),
    };
    const result = (body, status = 200) => ({ body, response: Response.json(body, { status, headers: { date: new Date().toUTCString() } }) });
    const request = async (address, options = {}, scope) => {
      const url = new URL(address);
      calls.push({ url, ...options, scope });
      if (url.hostname === 'management.azure.com') return result({ id: url.pathname,
        kind: 'AIServices', properties: { allowProjectManagement: true } });
      if (url.pathname.endsWith('/embeddings')) {
        const rows = JSON.parse(options.body).input;
        return result({ data: rows.map((_, i) => ({ index: malformedVectors ? 0 : i, embedding: Array(1536).fill(i) })).reverse() });
      }
      if (url.pathname.endsWith('/docs/index')) return result({ value: JSON.parse(options.body).value.map((row, i) => ({
        key: row.id, status: !(partialIndex && i === 0),
      })) });
      if (url.pathname.endsWith('/status')) return result({ lastResult: {
        startTime: manualUpdateNoContent && !indexerWasRun ? oldStart : new Date().toISOString(),
        endTime: new Date().toISOString(), status: 'success', itemsFailed: 0, itemsProcessed: 12,
      } });
      if (url.pathname.endsWith('/run')) {
        indexerWasRun = true;
        return result(null, 202);
      }
      if (options.method === 'PUT') {
        const body = JSON.parse(options.body);
        if (body.kind === 'azureBlob' && manualUpdateNoContent) {
          assert.equal(options.headers['If-Match'], '"owned-manual"');
          return { body: null, response: new Response(null, { status: 204, headers: { date: new Date().toUTCString() } }) };
        }
        assert.equal(options.headers['If-None-Match'], '*');
        if (body.kind === 'azureBlob') body.azureBlobParameters.createdResources = { indexer: `${definitions.manualSource}-indexer` };
        return result(body, 201);
      }
      if (manualUpdateNoContent && url.pathname === `/knowledgesources/${definitions.manualSource}`) {
        return result({ name: definitions.manualSource, kind: 'azureBlob', description: '[foundryiq-customer-demos] test',
          '@odata.etag': '"owned-manual"', azureBlobParameters: { createdResources: { indexer: `${definitions.manualSource}-indexer` } } });
      }
      return unowned ? result({ name: url.pathname.split('/').at(-1), description: 'another owner' }) : result({}, 404);
    };
    return { calls, blobs, quota, container, quotaBlob, request };
  }

  const { publicHosting, publicHostingOrigin, publicHostingTarget } = await import('./public-hosting.mjs');
  function publicDouble({ foreignHost = false, partial = false, uncertain = false, changed = false, unresolved = false,
    remoteDebuggingEnabled = false, missingDebugging = false, mappedReferences = false, duplicateReference = false,
    pagedReferences = false, wrongReferenceSecret = false, referenceIdentityType = 'SystemAssigned' } = {}) {
    const fake = localDouble();
    fake.secrets.set('search-api-key', env.AZURE_SEARCH_API_KEY);
    fake.secrets.set('session-secret', env.SESSION_SECRET);
    const hostname = `${publicHostingTarget.app}-test.westus2-01.azurewebsites.net`;
    const origin = `https://${hostname}`;
    const principal = '11111111-2222-3333-4444-555555555555';
    const prefix = `/subscriptions/${definitions.subscriptionId}/resourceGroups/${definitions.resourceGroup}/providers/`;
    const appId = prefix + `Microsoft.Web/sites/${publicHostingTarget.app}`;
    const planId = prefix + `Microsoft.Web/serverfarms/${publicHostingTarget.plan}`;
    const rows = expandCorpus(corpus).records.map(record => ({ ...record,
      url: `http://127.0.0.1:3000/samples/public-corpus.json#${record.id}`, contentVector: [1, 2, 3] }));
    if (changed) rows[0].revision = 999;
    const result = (body, status = 200) => ({ body, response: Response.json(body, { status }) });
    const request = async (address, options = {}, scope) => {
      const url = new URL(address);
      const own = url.pathname.startsWith(appId) || url.pathname === planId
        || url.pathname.includes('/roleAssignments') || url.hostname.endsWith('.search.windows.net');
      if (!own) return fake.request(address, options, scope);
      fake.calls.push({ url, ...options, scope });
      if (url.pathname.endsWith('/roleAssignments')) {
        const resourceScope = url.pathname.split('/providers/Microsoft.Authorization')[0];
        const role = resourceScope.includes('/secrets/') ? '4633458b-17de-408a-b874-0445c86b69e6'
          : resourceScope.endsWith('/zava-report-pages') ? '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1' : 'ba92f5b4-2d11-453d-a403-e96b0029c9fe';
        return result({ value: [{ properties: { scope: resourceScope, principalId: principal,
          roleDefinitionId: `/subscriptions/${definitions.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${role}` } }] });
      }
      if (url.pathname.endsWith('/config/web')) return result({ properties: { linuxFxVersion: 'NODE|24-lts',
        appCommandLine: 'npm start', alwaysOn: true, minTlsVersion: '1.2', scmMinTlsVersion: '1.2',
        ftpsState: 'Disabled', ...(missingDebugging ? { remoteDebugEnabled: false } : { remoteDebuggingEnabled }),
        healthCheckPath: '/healthz' } });
      if (url.pathname.includes('/basicPublishingCredentialsPolicies/')) return result({ properties: { allow: false } });
      if (url.pathname.endsWith('/config/configreferences/appsettings')) {
        const references = [['AZURE_SEARCH_API_KEY', 'search-api-key'], ['SESSION_SECRET', 'session-secret']]
          .map(([name, secretName]) => ({ name, id: url.pathname + '/' + name, properties: {
            status: unresolved ? 'AccessToKeyVaultDenied' : 'Resolved', identityType: referenceIdentityType,
            vaultName: definitions.keyVault, secretName: wrongReferenceSecret ? 'unapproved-secret' : secretName,
          } }));
        if (mappedReferences) return result({ properties: Object.fromEntries(references.map(item => [item.name, item.properties])) });
        return result({ value: duplicateReference ? [...references, references[0]] : references,
          nextLink: pagedReferences ? address + '&nextPage=2' : null });
      }
      if (url.pathname === appId || url.pathname === planId) return result({
        id: url.pathname, location: 'West US 2',
        tags: { 'app-onboard-session-id': foreignHost ? 'other-owner' : publicHostingTarget.sessionId, environment: definitions.owner },
        identity: { type: 'SystemAssigned', principalId: principal }, sku: { name: 'S1', capacity: 1 },
        properties: { reserved: true, httpsOnly: true, serverFarmId: planId, defaultHostName: hostname },
      });
      if (url.pathname.endsWith('/docs/search')) {
        assert.equal(JSON.parse(options.body).select.includes('contentVector'), false);
        return result({ '@odata.count': rows.length, value: rows.map(({ contentVector, ...row }) => ({ ...row })) });
      }
      if (url.pathname.endsWith('/docs/index')) {
        const updates = JSON.parse(options.body).value;
        for (const [i, update] of updates.entries()) {
          assert.deepEqual(Object.keys(update).sort(), ['@search.action', 'id', 'url']);
          assert.equal(update['@search.action'], 'merge');
          if (!(partial && i === 0)) rows.find(row => row.id === update.id).url = update.url;
        }
        if (uncertain) throw new Error(env.AZURE_SEARCH_API_KEY);
        return result({ value: updates.map((row, i) => ({ key: row.id, status: !(partial && i === 0),
          statusCode: partial && i === 0 ? 503 : 200 })) }, partial ? 207 : 200);
      }
      return result({ name: definitions.maintenanceIndex, description: '[foundryiq-customer-demos] owned',
        fields: [{ name: 'id', key: true, type: 'Edm.String' }, { name: 'url', type: 'Edm.String' },
          { name: 'contentVector', dimensions: 1536, retrievable: false }] });
    };
    return { ...fake, request, origin, rows };
  }

  await t.test('public operator dry runs and missing approval make no cloud calls; actual hostname is mandatory', async () => {
    let calls = 0;
    const request = async () => { calls++; throw new Error('Network forbidden'); };
    assert.equal((await publicHosting({ ...inputs, request })).azureCalls, 0);
    await assert.rejects(publicHosting({ ...inputs, action: 'update-citation-urls', request }), /approved/);
    await assert.rejects(publicHosting({ ...inputs, action: 'verify', origin: 'http://127.0.0.1:3000', request }), /HTTPS/);
    assert.equal(calls, 0);
    for (const host of ['example.test', 'other.azurewebsites.net', `${publicHostingTarget.app}.scm.azurewebsites.net`,
      `${publicHostingTarget.app}.azurewebsites.net/path`, `${publicHostingTarget.app}.azurewebsites.net:443`]) {
      assert.throws(() => publicHostingOrigin(host), OperatorError);
    }
  });

  await t.test('public URL merge updates exactly 200 URLs without content/vector/ledger mutation and is idempotent', async () => {
    const fake = publicDouble();
    const before = structuredClone(fake.rows);
    const options = { ...inputs, ...fake, action: 'update-citation-urls', urlUpdateApproved: true };
    const updated = await publicHosting(options);
    assert.equal(updated.updated, 200);
    assert.equal(updated.paidRetrieveCalls, 0);
    assert.equal(updated.ledgerTouched, false);
    assert.equal(fake.blob.state.count, 765);
    assert.deepEqual(fake.rows.map(({ url, ...row }) => row), before.map(({ url, ...row }) => row));
    assert.ok(fake.rows.every(row => row.url === `${fake.origin}/samples/public-corpus.json#${row.id}`));
    assert.equal((await publicHosting(options)).updated, 0);
    assert.equal(fake.calls.filter(call => call.url.pathname.endsWith('/docs/index')).length, 1);
    assert.ok(fake.calls.every(call => !call.url.pathname.includes('retrieve') && !call.url.pathname.includes('embeddings')));
    assert.ok(!JSON.stringify(updated).includes(env.AZURE_SEARCH_API_KEY) && !JSON.stringify(updated).includes(env.SESSION_SECRET));
  });

  await t.test('foreign host, mismatched origin/corpus and unresolved app references stop before any URL write', async () => {
    for (const issue of [{ foreignHost: true }, { changed: true }, { unresolved: true }, { origin: 'https://other.example.test' }]) {
      const fake = publicDouble(issue);
      await assert.rejects(publicHosting({ ...inputs, ...fake, action: 'update-citation-urls',
        urlUpdateApproved: true, origin: issue.origin || fake.origin }), OperatorError);
      assert.equal(fake.calls.filter(call => call.url.pathname.endsWith('/docs/index')).length, 0);
    }
  });

  await t.test('actual SiteConfig remoteDebuggingEnabled must be explicitly false; the misspelled alias never qualifies', async () => {
    for (const issue of [{ remoteDebuggingEnabled: true }, { missingDebugging: true }]) {
      const fake = publicDouble(issue);
      await assert.rejects(publicHosting({ ...inputs, ...fake, action: 'update-citation-urls',
        urlUpdateApproved: true }), /runtime\/security/);
      assert.equal(fake.calls.filter(call => call.url.pathname.endsWith('/docs/index')).length, 0);
    }
  });

  await t.test('actual Vault reference collection requires unique, complete and correctly scoped app-MI resolutions', async () => {
    for (const issue of [{ mappedReferences: true }, { duplicateReference: true }, { pagedReferences: true },
      { wrongReferenceSecret: true }, { referenceIdentityType: 'UserAssigned' }]) {
      const fake = publicDouble(issue);
      await assert.rejects(publicHosting({ ...inputs, ...fake, action: 'update-citation-urls',
        urlUpdateApproved: true }), /reference collection/);
      assert.equal(fake.calls.filter(call => call.url.pathname.endsWith('/docs/index')).length, 0);
    }
  });

  await t.test('hosting declarations use canonical debug and lowercase live settings understood by the runtime', async () => {
    const hosting = await readFile(new URL('../infra/hosting-resources.bicep', import.meta.url), 'utf8');
    assert.match(hosting, /remoteDebuggingEnabled:\s*false/);
    assert.doesNotMatch(hosting, /remoteDebugEnabled:/);
    assert.match(hosting, /FOUNDRY_IQ_LIVE_ENABLED:\s*liveEnabled\s*\?\s*'true'\s*:\s*'false'/);
  });

  await t.test('partial and uncertain URL writes fail explicitly with no automatic retry or secret diagnostics', async () => {
    for (const issue of [{ partial: true }, { uncertain: true }]) {
      const fake = publicDouble(issue);
      await assert.rejects(publicHosting({ ...inputs, ...fake, action: 'update-citation-urls', urlUpdateApproved: true }),
        error => error instanceof OperatorError && /partial|uncertain/.test(error.message)
          && !error.message.includes(env.AZURE_SEARCH_API_KEY));
      assert.equal(fake.calls.filter(call => call.url.pathname.endsWith('/docs/index')).length, 1);
      assert.ok(fake.rows.every(row => row.contentVector.join(',') === '1,2,3'));
    }
  });

  await t.test('local ingestion keeps Search, ARM, Vault and model token audiences explicit on the real request path', async t => {
    const local = localDouble();
    local.secrets.set('search-api-key', env.AZURE_SEARCH_API_KEY);
    local.secrets.set('session-secret', env.SESSION_SECRET);
    const ingestion = ingestionDouble();
    const scopes = [];
    const credential = { getToken: async scope => {
      assert.equal(typeof scope, 'string');
      scopes.push(scope);
      return { token: 'unit-test-token-not-a-credential', expiresOnTimestamp: Date.now() + 60000 };
    } };
    t.mock.method(globalThis, 'fetch', async (address, options) => {
      const hostname = new URL(address).hostname;
      const scope = hostname === 'management.azure.com' ? 'https://management.azure.com/.default'
        : hostname.endsWith('.vault.azure.net') ? 'https://vault.azure.net/.default'
          : hostname.endsWith('.search.windows.net') ? 'https://search.azure.com/.default'
            : 'https://cognitiveservices.azure.com/.default';
      assert.equal(scopes.at(-1), scope);
      const request = hostname === 'management.azure.com' || hostname.endsWith('.vault.azure.net')
        ? local.request : ingestion.request;
      return (await request(address, options, scope)).response;
    });
    const result = await localLive({ ...inputs, credential, container: ingestion.container,
      quotaBlob: ingestion.quotaBlob, action: 'ingest', paidApproved: true, webApproved: true });
    assert.equal(result.applied, true);
    assert.equal(scopes.filter(scope => scope === 'https://cognitiveservices.azure.com/.default').length, 8);
    assert.ok(scopes.includes('https://search.azure.com/.default'));
  });

  await t.test('operator ingestion orders vectors by exact index, checks all 200 and never resets the ledger', async () => {
    const fake = ingestionDouble();
    const result = await provision({ ...inputs, env: operatorEnv, apply: true, paidApproved: true, webApproved: true,
      ...fake, credential: {} });
    assert.equal(result.liveAcceptance, false);
    assert.equal(fake.blobs.size, 12);
    assert.equal(fake.quota.count, 765);
    assert.equal(fake.calls.filter(call => call.url.pathname.endsWith('/embeddings')).length, 8);
    const documents = JSON.parse(fake.calls.find(call => call.url.pathname.endsWith('/docs/index')).body).value;
    assert.equal(documents.length, 200);
    assert.equal(documents[1].contentVector[0], 1);
    assert.equal(fake.calls.filter(call => call.url.pathname.endsWith('/run')).length, 0);
    assert.equal(fake.calls.filter(call => call.url.pathname.startsWith('/knowledgebases/') && call.method === 'PUT').length, 2);
  });

  await t.test('unowned objects, malformed embeddings and partial indexing halt without retries/KB publication', async () => {
    for (const issue of [{ unowned: true }, { malformedVectors: true }, { partialIndex: true }]) {
      const fake = ingestionDouble(issue);
      await assert.rejects(provision({ ...inputs, env: operatorEnv, apply: true, paidApproved: true, webApproved: true,
        ...fake, credential: {} }), OperatorError);
      assert.equal(fake.calls.filter(call => call.url.pathname.startsWith('/knowledgebases/') && call.method === 'PUT').length, 0);
      if (issue.unowned) assert.equal(fake.blobs.size, 0);
      if (issue.malformedVectors) assert.equal(fake.calls.filter(call => call.url.pathname.endsWith('/embeddings')).length, 1);
    }
  });

  await t.test('owned Blob source204 update reads generated resources before one explicit fresh indexer run', async () => {
    const fake = ingestionDouble({ manualUpdateNoContent: true });
    const result = await provision({ ...inputs, env: operatorEnv, apply: true, paidApproved: true, webApproved: true,
      ...fake, credential: {} });
    assert.equal(result.blobIngestionVerified, true);
    assert.equal(fake.quota.count, 765);
    assert.equal(fake.calls.filter(call => call.url.pathname.endsWith('/embeddings')).length, 8);
    assert.equal(fake.calls.filter(call => call.url.pathname.endsWith('/run')).length, 1);
    assert.equal(fake.calls.filter(call => call.url.pathname === `/knowledgesources/${definitions.manualSource}`
      && !call.method).length, 2);
  });

  await t.test('sanitized indexed/Web captures charge shared quotas before every dispatch', async () => {
    const blob = new FakeBlob();
    const coordinator = new BlobQuotaCoordinator(blob);
    const output = join(directory, 'success');
    let calls = 0;
    const result = await captureCanaries({ definitions, env: operatorEnv, execute: true, paidApproved: true,
      webApproved: true, output, coordinator, evidence: 'protocol-double-NOT-AZURE',
      fetchImpl: async (address, options) => {
        assert.equal(blob.state.count, ++calls);
        assert.ok(address.includes("/knowledgebases('foundryiq-customer-demos-"));
        assert.equal(options.redirect, 'error');
        const body = JSON.parse(options.body);
        assert.equal(body.maxOutputSize, 5001);
        assert.equal(Object.hasOwn(body, 'maxOutputSizeInTokens'), false);
        return Response.json({ ...fixture, diagnostic: operatorEnv.AZURE_SEARCH_API_KEY });
      } });
    assert.equal(calls, 2);
    assert.equal(blob.state.count, 2);
    assert.equal(blob.state.slots.length, 0);
    assert.equal(result.liveAcceptance, false);
    const capture = await readFile(result.captured[0], 'utf8');
    assert.ok(!capture.includes(operatorEnv.AZURE_SEARCH_API_KEY) && !capture.includes(operatorEnv.SESSION_SECRET));
    assert.equal(JSON.parse(capture).evidence, 'protocol-double-NOT-AZURE');
    assert.equal(canaryRequests().length, 2);
  });

  await t.test('failed/partial canaries retain safe evidence, charge once and stop without a Web retry', async () => {
    for (const mode of ['partial', 'network']) {
      const blob = new FakeBlob();
      let calls = 0;
      const output = join(directory, mode);
      await assert.rejects(captureCanaries({ definitions, env: operatorEnv, execute: true, paidApproved: true,
        webApproved: true, output, coordinator: new BlobQuotaCoordinator(blob), evidence: 'protocol-double-NOT-AZURE',
        fetchImpl: async () => {
          calls++;
          if (mode === 'network') throw new Error(operatorEnv.AZURE_SEARCH_API_KEY);
          return Response.json(fixture, { status: 206 });
        } }), OperatorError);
      assert.equal(calls, 1);
      assert.equal(blob.state.count, 1);
      assert.equal(blob.state.slots.length, 0);
      const capture = JSON.parse(await readFile(join(output, 'indexed.json'), 'utf8'));
      assert.equal(capture.response.status, mode === 'partial' ? 206 : null);
      assert.ok(!JSON.stringify(capture).includes(operatorEnv.AZURE_SEARCH_API_KEY));
    }
  });

  await t.test('denied quota performs no Retrieve and capture directories cannot be clobbered', async () => {
    const blob = new FakeBlob();
    blob.state.enabled = false;
    let calls = 0;
    const output = join(directory, 'denied');
    const options = { definitions, env: operatorEnv, execute: true, paidApproved: true, webApproved: true,
      output, coordinator: new BlobQuotaCoordinator(blob), fetchImpl: async () => { calls++; } };
    await assert.rejects(captureCanaries(options), /paused/);
    await assert.rejects(captureCanaries(options), { code: 'EEXIST' });
    assert.equal(calls, 0);
    assert.equal(blob.state.count, 0);
  });

  await t.test('prebuilt runtime uses an explicit source boundary and locked production packages', async () => {
    const files = await runtimeFiles();
    assert.ok(files.includes('dist/server/index.mjs') && files.includes('scripts/start.mjs'));
    assert.ok(files.some(path => path.startsWith('node_modules/@azure/identity/')));
    assert.ok(!files.some(path => /^(?:infra|config|samples|\.git|\.github)\//.test(path) || operationalFiles.includes(path)));
    assert.equal((await packageRuntime()).azureCalls, 0);
    await assert.rejects(packageRuntime({ output: resolve('runtime.zip') }), /outside/);
  });
});
