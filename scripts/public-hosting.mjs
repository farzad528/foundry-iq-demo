import { API_VERSION, canonicalOrigin } from '../lib/protocol.mjs';
import { verifyResources, readSecrets, localEnvironment } from './local-live.mjs';
import { loadInputs, expandCorpus, operatorCredential, boundedRequest, parseArgs, OperatorError, isMain, reportFailure } from './provision-search.mjs';

export const publicHostingTarget = Object.freeze({
  app: 'app-foundryiq-customer-demos', plan: 'plan-foundryiq-customer-demos',
  sessionId: 'd432e314-2aaa-47fc-ae17-779393c6dc8d',
});
const armScope = 'https://management.azure.com/.default';
const required = (condition, message) => { if (!condition) throw new OperatorError(message); };

export function publicHostingOrigin(hostname) {
  required(typeof hostname === 'string' && /^[a-z0-9][a-z0-9.-]*\.azurewebsites\.net$/.test(hostname)
    && !hostname.includes('.scm.') && (hostname.startsWith(publicHostingTarget.app + '.')
      || hostname.startsWith(publicHostingTarget.app + '-')),
  'The owned App Service must report its actual public defaultHostName; never guess a host.');
  return canonicalOrigin(`https://${hostname}`);
}

async function verifyHosting(definitions, prefix, send) {
  const id = `${prefix}Microsoft.Web/sites/${publicHostingTarget.app}`;
  const planId = `${prefix}Microsoft.Web/serverfarms/${publicHostingTarget.plan}`;
  const bodies = [];
  for (const address of [id, planId]) {
    const result = await send(`${address}?api-version=2026-08-01`);
    const value = result.body;
    required(result.response.ok && value?.id?.toLowerCase() === new URL(address).pathname.toLowerCase()
      && value.location?.toLowerCase().replace(/\s+/g, '') === definitions.location
      && value.tags?.['app-onboard-session-id'] === publicHostingTarget.sessionId
      && value.tags?.environment === definitions.owner, 'Public hosting ownership/region differs from the approved target.');
    bodies.push(value);
  }
  const [app, plan] = bodies;
  const principal = app.identity?.principalId;
  required(app.identity?.type === 'SystemAssigned' && /^[a-f0-9-]{36}$/i.test(principal || '')
    && app.properties?.serverFarmId?.toLowerCase() === new URL(planId).pathname.toLowerCase()
    && app.properties.httpsOnly === true && plan.sku?.name === 'S1' && plan.sku.capacity === 1
    && plan.properties?.reserved === true, 'Public hosting identity, HTTPS or one-worker Linux S1 configuration is invalid.');
  const web = await send(`${id}/config/web?api-version=2024-11-01`);
  const config = web.body?.properties;
  required(web.response.ok && config?.linuxFxVersion === 'NODE|24-lts' && config.appCommandLine === 'npm start'
    && config.alwaysOn === true && ['1.2', '1.3'].includes(config.minTlsVersion)
    && ['1.2', '1.3'].includes(config.scmMinTlsVersion) && config.ftpsState === 'Disabled'
    && config.remoteDebuggingEnabled === false && config.healthCheckPath === '/healthz',
  'Public runtime/security configuration is not ready; no citation update.');
  for (const policy of ['scm', 'ftp']) {
    const result = await send(`${id}/basicPublishingCredentialsPolicies/${policy}?api-version=2024-11-01`);
    required(result.response.ok && result.body?.properties?.allow === false, 'Basic publishing must remain disabled.');
  }
  const references = await send(`${id}/config/configreferences/appsettings?api-version=2024-11-01`);
  const expectedReferences = [['AZURE_SEARCH_API_KEY', 'search-api-key'], ['SESSION_SECRET', 'session-secret']];
  required(references.response.ok && !references.body?.nextLink && Array.isArray(references.body?.value)
    && references.body.value.length === expectedReferences.length && expectedReferences.every(([key, secret]) => {
      const matches = references.body.value.filter(item => item.name === key);
      return matches.length === 1 && matches[0].properties?.status === 'Resolved'
        && matches[0].properties.identityType === 'SystemAssigned'
        && matches[0].properties.vaultName === definitions.keyVault && matches[0].properties.secretName === secret;
    }),
  'App managed-identity Vault reference collection is incomplete, unexpected or unresolved; do not replace secrets.');
  const grants = [
    [`Microsoft.KeyVault/vaults/${definitions.keyVault}/secrets/search-api-key`, '4633458b-17de-408a-b874-0445c86b69e6'],
    [`Microsoft.KeyVault/vaults/${definitions.keyVault}/secrets/session-secret`, '4633458b-17de-408a-b874-0445c86b69e6'],
    [`Microsoft.Storage/storageAccounts/${definitions.storageAccount}/blobServices/default/containers/${definitions.quotaContainer}`,
      'ba92f5b4-2d11-453d-a403-e96b0029c9fe'],
    [`Microsoft.Storage/storageAccounts/${definitions.storageAccount}/blobServices/default/containers/zava-report-pages`,
      '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'],
  ];
  for (const [suffix, role] of grants) {
    const scope = new URL(prefix + suffix).pathname;
    const result = await send(`https://management.azure.com${scope}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&$filter=atScope()`);
    const assignments = result.body?.value?.filter(item => item.properties?.principalId?.toLowerCase() === principal.toLowerCase()
      && item.properties.scope?.toLowerCase() === scope.toLowerCase());
    required(result.response.ok && !result.body?.nextLink && assignments?.length === 1
      && assignments[0].properties.roleDefinitionId?.toLowerCase()
        === `/subscriptions/${definitions.subscriptionId}/providers/microsoft.authorization/roledefinitions/${role}`.toLowerCase(),
    'An exact app-MI secret/container grant is absent or unexpected; no automatic permission changes.');
  }
  return publicHostingOrigin(app.properties.defaultHostName);
}

function checkedRecords(body, expected, origin) {
  required(body?.['@odata.count'] === 200 && Array.isArray(body.value) && body.value.length === 200
    && !body['@odata.nextLink'] && !body['@search.nextPageParameters'],
  'The owned index must contain exactly 200 fully returned records; no URL update.');
  const rows = new Map();
  for (const row of body.value) {
    const record = expected.get(row.id);
    required(record && !rows.has(row.id) && Object.keys(record).every(key => row[key] === record[key]),
      'Record content/revision differs from the approved corpus; URL-only operation stopped.');
    required([origin, 'http://127.0.0.1:3000'].some(base =>
      row.url === `${base}/samples/public-corpus.json#${row.id}`), 'An existing citation URL is outside the approved local/public origins.');
    rows.set(row.id, row);
  }
  return rows;
}

export async function publicHosting({ definitions, corpus, action = 'dry-run', origin, urlUpdateApproved = false,
  credential, request } = {}) {
  required(['dry-run', 'verify', 'update-citation-urls'].includes(action), 'Unknown public-hosting action.');
  required(!urlUpdateApproved || action === 'update-citation-urls', 'URL-only approval applies only to its explicit action.');
  if (action === 'dry-run') return { dryRun: true, azureCalls: 0, target: publicHostingTarget,
    actions: ['verify', 'update-citation-urls'], createsResources: false, initializesState: false, paidRetrieveCalls: 0 };
  required(action !== 'update-citation-urls' || urlUpdateApproved && origin,
    'URL changes require --url-only-update-approved and --origin matching the observed App Service.');
  if (origin) required(canonicalOrigin(origin).startsWith('https://'), 'The public origin must use HTTPS.');
  const expected = new Map(expandCorpus(corpus).records.map(record => [record.id, record]));
  credential ||= await operatorCredential(definitions);
  const signal = AbortSignal.timeout(180000);
  const transport = request || ((url, options, scope) => boundedRequest(url, options, {
    credential: scope ? credential : undefined, scope,
  }));
  const send = (url, options = {}, scope = armScope) => {
    signal.throwIfAborted();
    return transport(url, { ...options, signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal }, scope);
  };
  const verified = await verifyResources(definitions, send);
  const observed = await verifyHosting(definitions, verified.prefix, send);
  required(!origin || canonicalOrigin(origin) === observed, 'Requested origin differs from the actual owned App Service hostname.');
  const secrets = await readSecrets(definitions, send, signal);
  const validated = localEnvironment(definitions, secrets);
  const headers = { 'api-key': validated.AZURE_SEARCH_API_KEY };
  const base = `https://${definitions.searchService}.search.windows.net/indexes/${definitions.maintenanceIndex}`;
  const index = await send(`${base}?api-version=${API_VERSION}`, { headers }, null);
  required(index.response.ok && index.body?.name === definitions.maintenanceIndex
    && index.body.description?.startsWith('[foundryiq-customer-demos]')
    && index.body.fields?.some(field => field.name === 'id' && field.key === true && field.type === 'Edm.String')
    && index.body.fields.some(field => field.name === 'url' && field.type === 'Edm.String' && field.retrievable !== false)
    && index.body.fields.some(field => field.name === 'contentVector' && field.dimensions === 1536 && field.retrievable === false),
  'The dedicated owned hybrid index/schema could not be verified.');
  const readRecords = async () => {
    const result = await send(`${base}/docs/search?api-version=${API_VERSION}`, { method: 'POST', headers,
      body: JSON.stringify({ search: '*', count: true, top: 201, select: [...Object.keys(expected.values().next().value), 'url'].join(',') }) }, null);
    required(result.response.ok, 'Citation record readback failed; no automatic retry.');
    return checkedRecords(result.body, expected, observed);
  };
  const before = await readRecords();
  const changes = [...before.values()].filter(row => row.url !== `${observed}/samples/public-corpus.json#${row.id}`);
  if (action === 'update-citation-urls' && changes.length) {
    const value = changes.map(row => ({ '@search.action': 'merge', id: row.id,
      url: `${observed}/samples/public-corpus.json#${row.id}` }));
    let result;
    try {
      result = await send(`${base}/docs/index?api-version=${API_VERSION}`,
        { method: 'POST', headers, body: JSON.stringify({ value }) }, null);
    } catch {
      throw new OperatorError('Citation URL merge outcome is uncertain; no automatic retry. Inspect existing records before any repeat.');
    }
    const results = result.body?.value;
    const keys = new Set(changes.map(row => row.id));
    const acknowledged = result.response.ok && Array.isArray(results) && results.length === changes.length
      && new Set(results.map(row => row.key)).size === changes.length
      && results.every(row => keys.has(row.key) && row.status === true && row.statusCode === 200);
    const after = await readRecords();
    const confirmed = [...after.values()].filter(row => row.url === `${observed}/samples/public-corpus.json#${row.id}`).length;
    required(acknowledged && confirmed === 200,
      `Citation URL merge is partial or unacknowledged (${confirmed}/200 confirmed); no automatic retry. Inspect before repeating.`);
  }
  return { verified: true, origin: observed, records: before.size,
    updated: action === 'update-citation-urls' ? changes.length : 0, pendingUrls: action === 'verify' ? changes.length : 0,
    protectedRecordFieldsVerified: true, embeddingsIssued: 0, paidRetrieveCalls: 0, ledgerTouched: false,
    runtimeDependencyReadiness: 'Requires actual public indexed/Web canaries; this operator performs no Retrieve.' };
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2), ['--verify', '--update-citation-urls', '--url-only-update-approved'], ['--origin']);
    required(!(args['--verify'] && args['--update-citation-urls']), 'Choose only one public-hosting action.');
    const inputs = await loadInputs();
    const result = await publicHosting({ ...inputs,
      action: args['--verify'] ? 'verify' : args['--update-citation-urls'] ? 'update-citation-urls' : 'dry-run',
      origin: args['--origin'], urlUpdateApproved: !!args['--url-only-update-approved'] });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) { reportFailure(error); }
}
