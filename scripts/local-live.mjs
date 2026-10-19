import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createNodeServer } from '../lib/http.mjs';
import { BlobQuotaCoordinator, emptyQuotaState } from '../lib/quota.mjs';
import { API_VERSION, readBounded } from '../lib/protocol.mjs';
import { captureCanaries } from './capture-canary.mjs';
import { loadInputs, operatorCredential, boundedRequest, provision, parseArgs, OperatorError, isMain, reportFailure } from './provision-search.mjs';

const required = (condition, message) => { if (!condition) throw new OperatorError(message); };
const vaultScope = 'https://vault.azure.net/.default';
const armScope = 'https://management.azure.com/.default';
const secretNames = Object.freeze({ AZURE_SEARCH_API_KEY: 'search-api-key', SESSION_SECRET: 'session-secret' });

export function localEnvironment(definitions, secrets, port = 3000) {
  required(Number.isInteger(port) && port > 0 && port <= 65535, 'Local PORT must be an integer from 1 to 65535.');
  required(typeof secrets.AZURE_SEARCH_API_KEY === 'string' && secrets.AZURE_SEARCH_API_KEY.length > 0
    && secrets.AZURE_SEARCH_API_KEY.length <= 4096 && !secrets.AZURE_SEARCH_API_KEY.startsWith('@Microsoft.KeyVault(')
    && typeof secrets.SESSION_SECRET === 'string' && secrets.SESSION_SECRET.length >= 32
    && secrets.SESSION_SECRET.length <= 4096 && !secrets.SESSION_SECRET.startsWith('@Microsoft.KeyVault('),
  'Dedicated Vault secrets are absent, unresolved or invalid; no live startup.');
  return Object.freeze({
    PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    AZURE_SEARCH_ENDPOINT: `https://${definitions.searchService}.search.windows.net`,
    FOUNDRY_IQ_QUOTA_CONTAINER_URL: `https://${definitions.storageAccount}.blob.core.windows.net/${definitions.quotaContainer}`,
    AZURE_SEARCH_API_KEY: secrets.AZURE_SEARCH_API_KEY, SESSION_SECRET: secrets.SESSION_SECRET,
    FOUNDRY_IQ_LIVE_ENABLED: 'true', FOUNDRY_IQ_MEDIUM_ENABLED: 'false', FOUNDRY_IQ_TRUST_APP_SERVICE_PROXY: 'false',
  });
}

export async function verifyResources(definitions, send, { storageOnly = false } = {}) {
  const prefix = `https://management.azure.com/subscriptions/${definitions.subscriptionId}/resourceGroups/${definitions.resourceGroup}/providers/`;
  const resources = [
    ['search', `Microsoft.Search/searchServices/${definitions.searchService}`, '2025-05-01'],
    ['storage', `Microsoft.Storage/storageAccounts/${definitions.storageAccount}`, '2026-09-01'],
    ['vault', `Microsoft.KeyVault/vaults/${definitions.keyVault}`, '2026-05-15'],
    ['foundry', `Microsoft.CognitiveServices/accounts/${definitions.foundry.resource}`, '2025-06-01'],
    ['project', `Microsoft.CognitiveServices/accounts/${definitions.foundry.resource}/projects/${definitions.foundry.project}`, '2025-06-01'],
  ];
  const verified = {};
  for (const [key, suffix, version] of resources.filter(([key]) => !storageOnly || key === 'storage')) {
    const url = `${prefix}${suffix}`;
    const result = await send(`${url}?api-version=${version}`, {}, armScope);
    required(result.response.ok && result.body?.id?.toLowerCase() === new URL(url).pathname.toLowerCase()
      && typeof result.body.location === 'string'
      && result.body.location.toLowerCase().replace(/\s+/g, '') === definitions.location
      && result.body.tags?.['app-onboard-session-id'] === definitions.onboardingSessionId
      && result.body.tags?.environment === definitions.owner, 'Dedicated resource ownership/topology could not be verified; no setup or live startup.');
    verified[key] = result.body;
  }
  required(verified.storage.properties?.allowSharedKeyAccess === false && verified.storage.properties?.allowBlobPublicAccess === false,
    'Dedicated Storage protections do not match the approved setup.');
  if (storageOnly) return { prefix };
  required(verified.foundry.kind === 'AIServices' && verified.foundry.properties?.allowProjectManagement === true,
    'A NEW project-enabled AIServices Foundry parent is required; never use an OpenAI-kind account.');
  required(verified.vault.properties?.enableRbacAuthorization === true, 'Dedicated Vault RBAC does not match the approved setup.');
  for (const kind of ['retrieval', 'embedding']) {
    const model = definitions.foundry;
    const result = await send(`${prefix}Microsoft.CognitiveServices/accounts/${model.resource}/deployments/${model[kind + 'Deployment']}?api-version=2025-06-01`, {}, armScope);
    required(result.response.ok && result.body?.properties?.provisioningState === 'Succeeded'
      && result.body.properties.model?.name === model[kind + 'Model']
      && result.body.properties.model?.version === model[kind + 'Version']
      && result.body.sku?.name === 'Standard' && result.body.sku.capacity === model[kind + 'Capacity'],
    'Exact approved Foundry model version/Standard capacity is not ready; no paid call made.');
  }
  const endpoint = Object.values(verified.foundry.properties.endpoints || {}).find(value => {
    try { return new URL(value).origin === `https://${definitions.foundry.resource}.openai.azure.com` && new URL(value).pathname === '/'; }
    catch { return false; }
  });
  required(endpoint, 'Foundry did not report the dedicated OpenAI-compatible resource origin; do not guess its endpoint.');
  return { prefix, modelEndpoint: new URL(endpoint).origin };
}

export async function readSecrets(definitions, send, signal) {
  const secrets = {};
  for (const [key, name] of Object.entries(secretNames)) {
    const result = await send(`https://${definitions.keyVault}.vault.azure.net/secrets/${name}?api-version=7.4`, { signal }, vaultScope);
    required(result.response.ok || result.response.status === 404, `Dedicated Vault secret read failed (${result.response.status}); verify scoped role/network propagation.`);
    if (result.response.ok) {
      required(typeof result.body?.value === 'string' && result.body.value.length > 0 && result.body.value.length <= 4096,
        'Dedicated Vault returned an invalid secret; value not logged.');
      secrets[key] = result.body.value;
    }
  }
  return secrets;
}

async function initialize(definitions, send, quotaBlob, prefix) {
  const initial = JSON.stringify(emptyQuotaState());
  try {
    await quotaBlob.upload(initial, Buffer.byteLength(initial), {
      conditions: { ifNoneMatch: '*' }, abortSignal: AbortSignal.timeout(10000),
      blobHTTPHeaders: { blobContentType: 'application/json' },
    });
  } catch (error) {
    if (![409, 412].includes(error.statusCode)) throw error;
  }
  // Bootstrap locks out competing initializers; normal runtime transactions retain 15-second leases.
  const lease = quotaBlob.getBlobLeaseClient(randomUUID());
  await lease.acquireLease(60, { abortSignal: AbortSignal.timeout(5000) });
  const signal = AbortSignal.timeout(30000);
  try {
    const stateBlob = await quotaBlob.download(0, 256 * 1024 + 1, {
      conditions: { leaseId: lease.leaseId }, abortSignal: signal, maxRetryRequests: 0,
    });
    required(stateBlob.contentLength > 0 && stateBlob.contentLength <= 256 * 1024 && stateBlob.readableStreamBody,
      'Existing ledger is missing or invalid; it was not reset.');
    const state = JSON.parse(await readBounded(Readable.toWeb(stateBlob.readableStreamBody), 256 * 1024, signal));
    required(state.version === 1 && typeof state.enabled === 'boolean', 'Existing ledger requires operator review; it was not reset.');
    const secrets = await readSecrets(definitions, send, signal);
    const missing = Object.keys(secretNames).filter(key => !secrets[key]);
    required(!state.enabled || missing.length === 0, 'Pause the shared ledger before initializing missing secrets. Existing counters were not changed.');
    let searchKey;
    if (missing.includes('AZURE_SEARCH_API_KEY')) {
      const result = await send(`${prefix}Microsoft.Search/searchServices/${definitions.searchService}/listAdminKeys?api-version=2025-05-01`,
        { method: 'POST', signal }, armScope);
      required(result.response.ok && typeof result.body?.primaryKey === 'string' && result.body.primaryKey.length > 0,
        'Dedicated Search credential read failed; no keys regenerated and no secret value logged.');
      searchKey = result.body.primaryKey;
    }
    for (const key of missing) {
      signal.throwIfAborted();
      const value = key === 'SESSION_SECRET' ? randomBytes(48).toString('base64url') : searchKey;
      const result = await send(`https://${definitions.keyVault}.vault.azure.net/secrets/${secretNames[key]}?api-version=7.4`, {
        method: 'PUT', signal, body: JSON.stringify({ value,
          attributes: { enabled: true, exp: Math.floor(Date.now() / 1000) + 365 * 86400 },
          contentType: 'application/x-foundry-iq-credential', tags: { owner: definitions.owner } }),
      }, vaultScope);
      required(result.response.ok, `Dedicated Vault secret write failed (${result.response.status}); no raw diagnostics logged.`);
    }
    return { initialized: true, secretsCreated: missing.length, secretsReused: 2 - missing.length, ledgerReset: false, liveEnabled: state.enabled };
  } finally {
    try { await lease.releaseLease({ abortSignal: AbortSignal.timeout(2000) }); }
    catch { throw new OperatorError('Bootstrap lease release is uncertain; live setup stopped. Never reset counters or retry automatically.'); }
  }
}

export async function localLive({ definitions, corpus, action = 'dry-run', port = 3000,
  paidApproved = false, webApproved = false, output, credential, request, quotaBlob, container, log } = {}) {
  const actions = ['initialize', 'ingest', 'enable-live', 'disable-live', 'capture', 'start'];
  required(action === 'dry-run' || actions.includes(action), 'Unknown local-live action.');
  if (action === 'dry-run') return { dryRun: true, azureCalls: 0, actions, bind: '127.0.0.1', secretFiles: false,
    message: 'Repository-only local operator. Real setup requires explicit actions and approved dedicated resources.' };
  required(Number.isInteger(port) && port > 0 && port <= 65535, 'Local PORT must be an integer from 1 to 65535.');
  if (action === 'ingest' || action === 'capture') required(paidApproved && webApproved,
    'Ingestion/capture requires the matching --paid-ingestion-approved/--paid-queries-approved and --web-terms-approved.');
  if (action === 'capture') required(output, 'Capture requires a new external --output directory.');
  let createApplication;
  let RuntimeQuotaCoordinator = BlobQuotaCoordinator;
  if (action === 'start') {
    try {
      ({ createApplication } = await import('../dist/server/index.mjs'));
      // Keep the injected coordinator's HttpError identity in the prebuilt handler's module tree.
      ({ BlobQuotaCoordinator: RuntimeQuotaCoordinator } = await import('../dist/server/lib/quota.mjs'));
    }
    catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
      throw new OperatorError('Prebuilt application is missing. Run npm run build before npm run start:live.');
    }
  }
  credential ||= await operatorCredential(definitions);
  const send = request || ((url, options, scope = 'https://search.azure.com/.default') => boundedRequest(url, options, { credential, scope }));
  const verified = await verifyResources(definitions, send, { storageOnly: action === 'disable-live' });
  if (!quotaBlob) {
    const { ContainerClient } = await import('@azure/storage-blob');
    quotaBlob = new ContainerClient(`https://${definitions.storageAccount}.blob.core.windows.net/${definitions.quotaContainer}`,
      credential, { retryOptions: { maxTries: 1 }, loggingOptions: { logger: () => {} } }).getBlockBlobClient('quotas.json');
  }
  if (action === 'initialize') return initialize(definitions, send, quotaBlob, verified.prefix);
  const coordinator = new RuntimeQuotaCoordinator(quotaBlob);
  if (action === 'enable-live' || action === 'disable-live') {
    if (action === 'enable-live') {
      localEnvironment(definitions, await readSecrets(definitions, send), port);
      for (const name of [definitions.indexedKnowledgeBase, definitions.webKnowledgeBase]) {
        const result = await send(`https://${definitions.searchService}.search.windows.net/knowledgebases/${name}?api-version=${API_VERSION}`, {}, 'https://search.azure.com/.default');
        const sources = name === definitions.indexedKnowledgeBase ? [definitions.manualSource, definitions.maintenanceSource]
          : [definitions.manualSource, definitions.maintenanceSource, definitions.webSource];
        required(result.response.ok && result.body?.name === name
          && result.body.description?.startsWith('[foundryiq-customer-demos]')
          && result.body.knowledgeSources?.length === sources.length
          && new Set(result.body.knowledgeSources.map(source => source.name)).size === sources.length
          && result.body.knowledgeSources.every(source => sources.includes(source.name)),
        'Required dedicated knowledge bases are not ready; shared live switch was not enabled.');
      }
    }
    return coordinator.transaction(state => {
      state.enabled = action === 'enable-live';
      return { enabled: state.enabled, day: state.day, count: state.count, ledgerReset: false };
    });
  }
  const env = localEnvironment(definitions, await readSecrets(definitions, send), port);
  if (action === 'ingest') return provision({ definitions, corpus, env: { ...env, FOUNDRY_MODEL_ENDPOINT: verified.modelEndpoint },
    apply: true, local: true, paidApproved, webApproved, credential, container, quotaBlob, request: send });
  if (action === 'capture') return captureCanaries({ definitions, env, execute: true, paidApproved, webApproved, output, coordinator });
  const server = createNodeServer(createApplication({ coordinator, log }), env);
  await new Promise((resolve, reject) => {
    const fail = error => { server.off('listening', ready); reject(error); };
    const ready = () => { server.off('error', fail); resolve(); };
    server.once('error', fail);
    server.once('listening', ready);
    server.listen(port, '127.0.0.1');
  });
  return { server, origin: env.PUBLIC_ORIGIN };
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2),
      ['--initialize', '--ingest', '--enable-live', '--disable-live', '--capture', '--start',
        '--paid-ingestion-approved', '--paid-queries-approved', '--web-terms-approved'], ['--output', '--port']);
    const selected = ['initialize', 'ingest', 'enable-live', 'disable-live', 'capture', 'start'].filter(action => args['--' + action]);
    required(selected.length <= 1, 'Select exactly one local-live action; never combine startup, seeding, switches, ingestion or captures.');
    const inputs = await loadInputs();
    const result = await localLive({ ...inputs, action: selected[0] || 'dry-run', port: Number(args['--port'] || process.env.PORT || 3000),
      paidApproved: selected[0] === 'ingest' ? !!args['--paid-ingestion-approved'] : !!args['--paid-queries-approved'],
      webApproved: !!args['--web-terms-approved'], output: args['--output'] });
    if (result.server) {
      process.stdout.write(`Local Foundry IQ live demo listening at ${result.origin}\n`);
      for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
        result.server.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 10000).unref();
      });
    } else process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) { reportFailure(error); }
}
