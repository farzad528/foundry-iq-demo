import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, dirname, basename, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { API_VERSION, readBounded, canonicalOrigin } from '../lib/protocol.mjs';
import { sanitize } from '../lib/normalize.mjs';
import { emptyQuotaState } from '../lib/quota.mjs';

export const root = fileURLToPath(new URL('..', import.meta.url));
export class OperatorError extends Error {}
const required = (condition, message) => { if (!condition) throw new OperatorError(message); };
const marker = '[foundryiq-customer-demos]';
const json = async path => JSON.parse(await readFile(path, 'utf8'));

export function parseArgs(args, booleans, values = []) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    required(!Object.hasOwn(result, name), 'Duplicate command-line option.');
    if (booleans.includes(name)) result[name] = true;
    else if (values.includes(name)) {
      required(typeof args[i + 1] === 'string' && !args[i + 1].startsWith('--'), 'An option requires a value.');
      result[name] = args[++i];
    } else throw new OperatorError('Unknown command-line option; see the repository operator guide.');
  }
  return result;
}

export async function loadInputs() {
  const [definitions, corpus] = await Promise.all([
    json(new URL('../config/knowledge-definitions.json', import.meta.url)),
    json(new URL('../samples/public-corpus.json', import.meta.url)),
  ]);
  required(definitions.version === 1 && definitions.owner === 'foundryiq-customer-demos'
    && definitions.subscriptionId === 'ee787b9b-a25f-4d20-86e9-45fcea5253dd'
    && definitions.resourceGroup === 'rg-foundryiq-customer-demos' && definitions.location === 'westus2'
    && definitions.onboardingSessionId === '515ff723-36c3-4399-a4e7-1bb9bbc9ece1'
    && definitions.keyVault === 'kv-fiq-customer-demos'
    && definitions.apiVersion === API_VERSION && definitions.foundry.kind === 'AIServices'
    && definitions.foundry.allowProjectManagement === true, 'Definitions do not match the approved subscription/topology.');
  const exact = {
    searchService: 'srch-foundryiq-customer-demos', storageAccount: 'stfoundryiqcustomerdemos',
    contentContainer: 'demo-content', quotaContainer: 'demo-quotas',
    manualSource: 'foundryiq-customer-demos-manuals', maintenanceSource: 'foundryiq-customer-demos-maintenance',
    webSource: 'foundryiq-customer-demos-web-guidance', maintenanceIndex: 'foundryiq-customer-demos-maintenance-index',
    indexedKnowledgeBase: 'foundryiq-customer-demos-indexed', webKnowledgeBase: 'foundryiq-customer-demos-web',
  };
  required(Object.entries(exact).every(([key, value]) => definitions[key] === value)
    && definitions.foundry.resource === 'ai-foundryiq-customer-demos'
    && definitions.foundry.project === 'proj-foundryiq-customer-demos'
    && definitions.foundry.retrievalDeployment === 'foundryiq-customer-demos-retrieval'
    && definitions.foundry.retrievalModel === 'gpt-5.1'
    && definitions.foundry.retrievalVersion === '2025-11-13' && definitions.foundry.retrievalCapacity === 100
    && definitions.foundry.embeddingDeployment === 'foundryiq-customer-demos-embedding'
    && definitions.foundry.embeddingModel === 'text-embedding-3-small'
    && definitions.foundry.embeddingVersion === '1' && definitions.foundry.embeddingCapacity === 20
    && definitions.foundry.embeddingDimensions === 1536, 'Resource identity differs from the approved demo scope.');
  return { definitions, corpus };
}

export function expandCorpus(corpus) {
  required(corpus.license === 'MIT' && typeof corpus.version === 'string' && corpus.version.length <= 64
    && Array.isArray(corpus.documents) && corpus.documents.length === 12
    && corpus.recordRecipe?.count === 200 && Number.isInteger(corpus.recordRecipe.revision)
    && corpus.recordRecipe.revision >= 1 && typeof corpus.disclaimer === 'string', 'Expected 12 fictional documents and a 200-record recipe.');
  const ids = new Set();
  for (const doc of corpus.documents) {
    required(/^[a-z0-9-]{1,64}$/.test(doc.id) && !ids.has(doc.id)
      && /^[A-Z]-\d{3}$/.test(doc.equipmentId) && typeof doc.title === 'string'
      && typeof doc.content === 'string' && doc.content.length <= 4000
      && Number.isInteger(doc.revision) && doc.revision > 0, 'Invalid or duplicate fictional document.');
    ids.add(doc.id);
  }
  const recipe = corpus.recordRecipe;
  for (const key of ['ownerTeams', 'recordTypes', 'statuses']) required(Array.isArray(recipe[key])
    && recipe[key].length > 0 && recipe[key].every(value => typeof value === 'string' && value.length <= 80), 'Invalid record recipe.');
  required(recipe.statuses.join('|') === 'pending|recorded|superseded'
    && /^\d{4}-\d{2}-\d{2}$/.test(recipe.firstDate)
    && Number.isFinite(Date.parse(recipe.firstDate))
    && new Date(recipe.firstDate).toISOString().slice(0, 10) === recipe.firstDate, 'Invalid synthetic date/status dictionary.');
  const records = Array.from({ length: 200 }, (_, i) => {
    const doc = corpus.documents[i % 12];
    const recordType = recipe.recordTypes[Math.floor(i / 12) % recipe.recordTypes.length];
    const reviewStatus = doc.equipmentId === 'P-104' && ['reviewer acknowledgement', 'owner approval'].includes(recordType)
      ? 'pending' : recipe.statuses[Math.floor(i / 12) % 3];
    const record = {
      id: `MR-${String(i + 1).padStart(4, '0')}`, equipmentId: doc.equipmentId,
      recordType, reviewStatus, ownerTeam: recipe.ownerTeams[i % recipe.ownerTeams.length],
      eventDate: new Date(Date.parse(recipe.firstDate) + i * 86400000).toISOString().slice(0, 10),
      revision: recipe.revision, documentId: doc.id,
    };
    const override = recipe.overrides?.[record.id];
    if (override) {
      required(Object.keys(override).every(key => ['reviewStatus', 'revision'].includes(key))
        && recipe.statuses.includes(override.reviewStatus)
        && Number.isInteger(override.revision) && override.revision > record.revision, 'Invalid controlled record revision.');
      Object.assign(record, override);
    }
    return { ...record, title: `${record.id}: ${record.equipmentId} ${record.recordType}`,
      content: `${record.id}: ${record.equipmentId}; ${record.recordType}; status ${record.reviewStatus}; ${record.ownerTeam}; ${record.eventDate}; revision ${record.revision}. ${corpus.disclaimer}` };
  });
  required(Object.keys(recipe.overrides || {}).every(id => records.some(record => record.id === id)), 'A record override has an unknown identifier.');
  required(records.reduce((size, row) => size + row.content.length, 0) <= 160000, 'Synthetic ingestion exceeds the approved text budget.');
  return { documents: corpus.documents, records };
}

function modelEndpoint(value, definitions) {
  const url = new URL(value);
  required(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && url.pathname === '/' && !url.port && [
    `${definitions.foundry.resource}.openai.azure.com`, `${definitions.foundry.resource}.services.ai.azure.com`,
  ].includes(url.hostname), 'FOUNDRY_MODEL_ENDPOINT must be the dedicated Foundry resource OpenAI-compatible origin, not a project endpoint.');
  return url.origin;
}

export function buildPlan(definitions, corpus, env = {}, execute = false, { local = false } = {}) {
  const data = expandCorpus(corpus);
  const missing = ['PUBLIC_ORIGIN', 'FOUNDRY_MODEL_ENDPOINT'].filter(key => !env[key]);
  required(!execute || !missing.length, 'PUBLIC_ORIGIN and FOUNDRY_MODEL_ENDPOINT must be confirmed before execution.');
  const origin = env.PUBLIC_ORIGIN ? canonicalOrigin(env.PUBLIC_ORIGIN) : 'https://confirmed-public-origin.invalid';
  if (local) required(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Explicit local ingestion requires an exact HTTP 127.0.0.1 port origin.');
  else required(!execute || origin.startsWith('https://'), 'The deployed public origin must use HTTPS.');
  const endpoint = env.FOUNDRY_MODEL_ENDPOINT ? modelEndpoint(env.FOUNDRY_MODEL_ENDPOINT, definitions)
    : `https://${definitions.foundry.resource}.openai.azure.com`;
  const makeModel = (deploymentId, modelName) => ({ kind: 'azureOpenAI', azureOpenAIParameters: { resourceUri: endpoint, deploymentId, modelName } });
  const embedding = makeModel(definitions.foundry.embeddingDeployment, definitions.foundry.embeddingModel);
  const retrieval = makeModel(definitions.foundry.retrievalDeployment, definitions.foundry.retrievalModel);
  const description = `${marker} Original fictional fixture ${corpus.version}. Not operating instructions.`;
  const storageId = `/subscriptions/${definitions.subscriptionId}/resourceGroups/${definitions.resourceGroup}/providers/Microsoft.Storage/storageAccounts/${definitions.storageAccount}`;
  const index = {
    name: definitions.maintenanceIndex, description,
    fields: [
      { name: 'id', type: 'Edm.String', key: true, filterable: true },
      ...['title', 'content'].map(name => ({ name, type: 'Edm.String', searchable: true, retrievable: true })),
      ...['url', 'equipmentId', 'reviewStatus', 'recordType', 'ownerTeam', 'eventDate', 'documentId'].map(name => ({
        name, type: 'Edm.String', retrievable: true, filterable: true,
      })),
      { name: 'revision', type: 'Edm.Int32', retrievable: true, filterable: true },
      { name: 'contentVector', type: 'Collection(Edm.Single)', searchable: true, retrievable: false,
        dimensions: definitions.foundry.embeddingDimensions, vectorSearchProfile: 'hybrid-profile' },
    ],
    vectorSearch: {
      algorithms: [{ name: 'hnsw', kind: 'hnsw' }],
      profiles: [{ name: 'hybrid-profile', algorithm: 'hnsw', vectorizer: 'foundry-vectorizer' }],
      vectorizers: [{ name: 'foundry-vectorizer', kind: 'azureOpenAI', azureOpenAIParameters: embedding.azureOpenAIParameters }],
    },
    semantic: { configurations: [{ name: 'default', prioritizedFields: {
      titleField: { fieldName: 'title' }, prioritizedContentFields: [{ fieldName: 'content' }],
    } }] },
  };
  const sources = [
    { name: definitions.manualSource, kind: 'azureBlob', description, azureBlobParameters: {
      connectionString: `ResourceId=${storageId};`, containerName: definitions.contentContainer, folderPath: 'manuals',
      ingestionParameters: {
        contentExtractionMode: 'minimal', disableImageVerbalization: true, ingestionPermissionOptions: [],
        embeddingModel: embedding, ingestionSchedule: null,
      },
    } },
    { name: definitions.maintenanceSource, kind: 'searchIndex', description, searchIndexParameters: {
      searchIndexName: index.name, semanticConfigurationName: 'default',
      sourceDataFields: ['title', 'content', 'url', 'equipmentId', 'reviewStatus', 'revision'].map(name => ({ name })),
      searchFields: [{ name: 'title' }, { name: 'content' }],
    } },
    { name: definitions.webSource, kind: 'web', description, webParameters: { domains: {
      allowedDomains: definitions.proposedWebDomains.map(address => ({ address, includeSubpages: true })),
    } } },
  ];
  required(definitions.proposedWebDomains?.length === 1 && definitions.proposedWebDomains[0] === 'osha.gov', 'Web domains differ from the proposed scope; obtain a plan edit.');
  const knowledgeBases = [definitions.indexedKnowledgeBase, definitions.webKnowledgeBase].map((name, i) => ({
    name, description, knowledgeSources: sources.slice(0, i ? 3 : 2).map(source => ({ name: source.name })),
    models: [retrieval], outputMode: 'answerSynthesis', retrievalReasoningEffort: { kind: 'low' },
    answerInstructions: 'Cite each claim. Distinguish fictional record evidence from public Web summaries. State missing evidence; never provide operating instructions or claim actual equipment safety or compliance.',
  }));
  return { dryRun: !execute, missing, endpointConfirmed: !!env.FOUNDRY_MODEL_ENDPOINT, origin,
    index, sources, knowledgeBases, data, embeddingRequestLimit: 8, documents: 12, records: 200,
    publicDocumentUrl: `${origin}/samples/public-corpus.json` };
}

export async function outsideOutput(path, workspace = root) {
  required(isAbsolute(path), 'Output must be an absolute path outside the repository.');
  const parent = await realpath(dirname(path));
  const base = await realpath(workspace);
  const target = resolve(parent, basename(path));
  const rel = relative(base, target);
  required(rel !== '' && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)), 'Operational output must stay outside the repository.');
  return target;
}

export async function operatorCredential(definitions, { Credential, request = boundedRequest } = {}) {
  Credential ||= (await import('@azure/identity')).AzureCliCredential;
  // Azure CLI rejects --tenant together with --subscription; verify the selected tenant through ARM.
  const credential = new Credential({ subscription: definitions.subscriptionId, processTimeoutInMs: 10000 });
  const result = await request(`https://management.azure.com/subscriptions/${definitions.subscriptionId}?api-version=2022-12-01`, {}, {
    credential, scope: 'https://management.azure.com/.default',
  });
  required(result.response.ok && result.body?.subscriptionId === definitions.subscriptionId && result.body?.tenantId === definitions.tenantId,
    'The explicit subscription/tenant could not be verified. CLI default was not changed; no data operation permitted.');
  return credential;
}

export async function boundedRequest(url, options = {}, { credential, scope, fetchImpl = fetch, limit = 1024 * 1024 } = {}) {
  const signal = options.signal || AbortSignal.timeout(60000);
  const token = credential ? await credential.getToken(scope, { abortSignal: signal }) : null;
  const response = await fetchImpl(url, { ...options, signal, redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token.token}` } : {}), ...options.headers } });
  const text = await readBounded(response.body, limit, signal);
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { throw new OperatorError('Service returned invalid JSON; response not logged.'); }
  }
  return { response, body };
}

export async function provision({ definitions, corpus, env = {}, apply = false, paidApproved = false,
  webApproved = false, local = false, credential, request, container, quotaBlob, sleep = delay } = {}) {
  const plan = buildPlan(definitions, corpus, env, apply, { local });
  if (!apply) return { dryRun: true, azureCalls: 0, documents: plan.documents, records: plan.records,
    embeddingRequests: plan.embeddingRequestLimit, missing: plan.missing,
    resources: [plan.index.name, ...plan.sources.map(item => item.name), ...plan.knowledgeBases.map(item => item.name)],
    webDomains: definitions.proposedWebDomains, webTermsApproved: false };
  required(paidApproved && webApproved, '--apply requires separate --paid-ingestion-approved and --web-terms-approved authorization.');
  const expectedSearch = `https://${definitions.searchService}.search.windows.net`;
  required(env.AZURE_SEARCH_ENDPOINT?.replace(/\/$/, '') === expectedSearch, 'Search endpoint differs from the dedicated approved service.');
  credential ||= await operatorCredential(definitions);
  const send = request || ((url, options, scope = 'https://search.azure.com/.default') => boundedRequest(url, options, { credential, scope }));
  const armId = `/subscriptions/${definitions.subscriptionId}/resourceGroups/${definitions.resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${definitions.foundry.resource}`;
  for (const suffix of ['', `/projects/${definitions.foundry.project}`]) {
    const result = await send(`https://management.azure.com${armId}${suffix}?api-version=2025-06-01`, {}, 'https://management.azure.com/.default');
    required(result.response.ok && result.body?.id?.toLowerCase() === (armId + suffix).toLowerCase(), 'Required NEW Foundry resource/project could not be verified.');
    if (!suffix) required(result.body.kind === 'AIServices' && result.body.properties?.allowProjectManagement === true, 'Refusing a standalone OpenAI or non-project-enabled resource.');
  }
  const targets = [['indexes', plan.index], ...plan.sources.map(item => ['knowledgesources', item]),
    ...plan.knowledgeBases.map(item => ['knowledgebases', item])];
  const existing = new Map();
  const observedDates = new Map();
  for (const [kind, definition] of targets) {
    const url = `${expectedSearch}/${kind}/${definition.name}?api-version=${API_VERSION}`;
    const result = await send(url, {});
    required(result.response.status === 404 || result.response.ok, 'Ownership preflight failed; no data has been uploaded.');
    observedDates.set(definition.name, Date.parse(result.response.headers.get('date')));
    if (result.response.ok) {
      required(result.body.name === definition.name && result.body.description?.startsWith(marker), 'Refusing to adopt an existing unowned Search object.');
      const etag = result.response.headers.get('etag') || result.body['@odata.etag'];
      required(typeof etag === 'string' && etag.length > 0, 'Existing object has no ETag; refusing an unconditional update.');
      existing.set(definition.name, etag);
    }
  }
  if (!container || !quotaBlob) {
    const { ContainerClient } = await import('@azure/storage-blob');
    const options = { retryOptions: { maxTries: 1 }, loggingOptions: { logger: () => {} } };
    container ||= new ContainerClient(`https://${definitions.storageAccount}.blob.core.windows.net/${definitions.contentContainer}`, credential, options);
    quotaBlob ||= new ContainerClient(`https://${definitions.storageAccount}.blob.core.windows.net/${definitions.quotaContainer}`, credential, options).getBlockBlobClient('quotas.json');
  }
  try {
    const state = JSON.stringify(emptyQuotaState());
    await quotaBlob.upload(state, Buffer.byteLength(state), { conditions: { ifNoneMatch: '*' }, abortSignal: AbortSignal.timeout(10000) });
  } catch (error) {
    if (error.statusCode !== 409 && error.statusCode !== 412) throw error;
    // Existing counters and kill-switch state are never overwritten.
    const existingBlob = await quotaBlob.getProperties({ abortSignal: AbortSignal.timeout(10000) });
    required(existingBlob.contentLength > 0 && existingBlob.contentLength <= 256 * 1024, 'Existing quota blob needs operator review; it was not changed.');
  }
  for (const doc of plan.data.documents) {
    const text = `# ${doc.title}\n\n${marker} ${corpus.version}; revision ${doc.revision}; MIT; fictional.\n\n${doc.content}\n`;
    const blob = container.getBlockBlobClient(`manuals/${doc.id}.md`);
    try {
      const old = await blob.getProperties({ abortSignal: AbortSignal.timeout(10000) });
      required(old.metadata?.owner === definitions.owner && old.etag, 'Refusing to overwrite an unowned content blob.');
      await blob.upload(text, Buffer.byteLength(text), { conditions: { ifMatch: old.etag },
        metadata: { owner: definitions.owner, revision: String(doc.revision) }, blobHTTPHeaders: { blobContentType: 'text/markdown' }, abortSignal: AbortSignal.timeout(10000) });
    } catch (error) {
      if (error.statusCode !== 404) throw error;
      await blob.upload(text, Buffer.byteLength(text), { conditions: { ifNoneMatch: '*' },
        metadata: { owner: definitions.owner, revision: String(doc.revision) }, blobHTTPHeaders: { blobContentType: 'text/markdown' }, abortSignal: AbortSignal.timeout(10000) });
    }
  }
  const expectedBlobs = new Set(plan.data.documents.map(doc => `manuals/${doc.id}.md`));
  for await (const item of container.listBlobsFlat({ prefix: 'manuals/', includeMetadata: true })) {
    required(expectedBlobs.delete(item.name) && item.metadata?.owner === definitions.owner, 'Unexpected content in the isolated manuals prefix; ingestion stopped.');
  }
  required(expectedBlobs.size === 0, 'The 12-document Blob corpus was not verified.');
  const put = async (kind, definition) => {
    const result = await send(`${expectedSearch}/${kind}/${definition.name}?api-version=${API_VERSION}`, {
      method: 'PUT', headers: existing.has(definition.name) ? { 'If-Match': existing.get(definition.name) } : { 'If-None-Match': '*' },
      body: JSON.stringify(definition),
    });
    required(result.response.ok, `Search ${kind} write failed (${result.response.status}); no retry performed.`);
    return result;
  };
  await put('indexes', plan.index);
  const records = [];
  for (let offset = 0; offset < 200; offset += 25) {
    const batch = plan.data.records.slice(offset, offset + 25);
    const url = `${modelEndpoint(env.FOUNDRY_MODEL_ENDPOINT, definitions)}/openai/deployments/${definitions.foundry.embeddingDeployment}/embeddings?api-version=2024-10-21`;
    const embedded = await send(url, { method: 'POST', body: JSON.stringify({
      input: batch.map(record => record.content), dimensions: 1536,
    }) }, 'https://cognitiveservices.azure.com/.default');
    required(embedded.response.ok && embedded.body?.data?.length === batch.length, 'Embedding batch failed; no retry or partial success assumed.');
    const vectors = new Map();
    for (const item of embedded.body.data) {
      required(Number.isInteger(item.index) && item.index >= 0 && item.index < batch.length && !vectors.has(item.index)
        && Array.isArray(item.embedding) && item.embedding.length === 1536 && item.embedding.every(Number.isFinite), 'Malformed embedding index/vector.');
      vectors.set(item.index, item.embedding);
    }
    records.push(...batch.map((record, i) => ({ ...record,
      url: `${plan.publicDocumentUrl}#${record.id}`, contentVector: vectors.get(i), '@search.action': 'mergeOrUpload',
    })));
  }
  const indexed = await send(`${expectedSearch}/indexes/${plan.index.name}/docs/index?api-version=${API_VERSION}`, {
    method: 'POST', body: JSON.stringify({ value: records }),
  });
  required(indexed.response.ok && indexed.body?.value?.length === 200
    && indexed.body.value.every(result => result.status === true)
    && new Set(indexed.body.value.map(result => result.key)).size === 200
    && indexed.body.value.every(result => records.some(record => record.id === result.key)), 'Document indexing was partial or failed; inspect the service privately.');
  const manual = await put('knowledgesources', plan.sources[0]);
  for (const source of plan.sources.slice(1)) await put('knowledgesources', source);
  let manualState = manual.body;
  if (!manualState?.azureBlobParameters?.createdResources?.indexer) {
    const observed = await send(`${expectedSearch}/knowledgesources/${definitions.manualSource}?api-version=${API_VERSION}`, {});
    required(observed.response.ok && observed.body?.name === definitions.manualSource
      && observed.body.kind === 'azureBlob' && observed.body.description?.startsWith(marker),
    'Updated Blob source could not be verified after its response omitted generated resources.');
    manualState = observed.body;
  }
  const indexer = manualState?.azureBlobParameters?.createdResources?.indexer;
  required(typeof indexer === 'string' && /^[a-z0-9-]+$/.test(indexer) && indexer.startsWith(definitions.manualSource), 'Generated Blob indexer identity was not confirmed.');
  let previousStart;
  if (existing.has(definitions.manualSource)) {
    const previous = await send(`${expectedSearch}/indexers/${indexer}/status?api-version=${API_VERSION}`, {});
    required(previous.response.ok, 'Could not observe the preceding Blob ingestion before starting a fresh run.');
    previousStart = previous.body?.lastResult?.startTime;
  }
  // Creation starts initial ingestion; an owned existing source needs an explicit fresh run.
  const run = existing.has(definitions.manualSource)
    ? await send(`${expectedSearch}/indexers/${indexer}/run?api-version=${API_VERSION}`, { method: 'POST' })
    : manual;
  required(run.response.ok, 'Blob indexer did not start; no automatic reset/retry performed.');
  const started = existing.has(definitions.manualSource)
    ? Date.parse(run.response.headers.get('date')) : observedDates.get(definitions.manualSource);
  required(Number.isFinite(started), 'Indexer response lacks a trustworthy service date; freshness is unverified.');
  let ready = false;
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    const status = await send(`${expectedSearch}/indexers/${indexer}/status?api-version=${API_VERSION}`, {
      signal: AbortSignal.timeout(Math.min(60000, Math.max(1, deadline - Date.now()))),
    });
    required(status.response.ok, 'Could not verify Blob ingestion status.');
    const last = status.body?.lastResult;
    if (last?.startTime !== previousStart && Date.parse(last?.startTime) >= started - 1000 && last?.endTime) {
      required(last.status === 'success' && last.itemsFailed === 0 && last.itemsProcessed === 12
        && !(last.errors?.length), 'Blob ingestion did not complete successfully for all 12 documents.');
      ready = true;
      break;
    }
    await sleep(Math.min(10000, Math.max(0, deadline - Date.now())));
  }
  required(ready, 'Blob ingestion timed out; no live readiness is claimed.');
  for (const kb of plan.knowledgeBases) await put('knowledgebases', kb);
  return { applied: true, documents: 12, records: 200, embeddingRequests: 8, blobIngestionVerified: true,
    liveAcceptance: false, message: 'Ingestion is not Retrieve compatibility, Web acceptance, cost/latency or public readiness.' };
}

export function reportFailure(error) {
  process.stderr.write(`${error instanceof OperatorError ? error.message : 'Operator operation failed; raw diagnostics and credentials were not logged.'}\n`);
  process.exitCode = 1;
}

export const isMain = url => !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === url;
if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2), ['--apply', '--paid-ingestion-approved', '--web-terms-approved', '--local']);
    const inputs = await loadInputs();
    const result = await provision({ ...inputs, env: process.env, apply: !!args['--apply'],
      paidApproved: !!args['--paid-ingestion-approved'], webApproved: !!args['--web-terms-approved'], local: !!args['--local'] });
    process.stdout.write(JSON.stringify(sanitize(result)) + '\n');
  } catch (error) { reportFailure(error); }
}
