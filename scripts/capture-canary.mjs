import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { knowledgeBases } from '../config/knowledge-bases.mjs';
import { BlobQuotaCoordinator } from '../lib/quota.mjs';
import { API_VERSION, validateRequest, MAX_RESPONSE_BYTES, readBounded } from '../lib/protocol.mjs';
import { sanitize, normalizeResponse } from '../lib/normalize.mjs';
import { loadInputs, operatorCredential, outsideOutput, parseArgs, OperatorError, isMain, reportFailure } from './provision-search.mjs';

export function canaryRequests() {
  return knowledgeBases.map(kb => {
    const request = {
      messages: [{ role: 'user', content: [{ type: 'text', text: kb.question }] }],
      retrievalReasoningEffort: { kind: 'low' }, outputMode: 'answerSynthesis', includeActivity: true,
      maxRuntimeInSeconds: 60, maxOutputSize: 5001,
      knowledgeSourceParams: kb.sources.map(source => ({
        kind: source.kind, knowledgeSourceName: source.name, includeReferences: true,
        includeReferenceSourceData: true, alwaysQuerySource: true,
      })),
    };
    return { kb, body: validateRequest({ scenarioId: kb.id, mode: 'live', request },
      knowledgeBases.map(item => ({ ...item, execution: 'live' })), {}).outbound };
  });
}

export async function captureCanaries({ definitions, env = {}, execute = false, paidApproved = false,
  webApproved = false, output, coordinator, fetchImpl = fetch, save, evidence = 'unverified-service-capture' } = {}) {
  const requests = canaryRequests();
  if (!execute) return { dryRun: true, azureCalls: 0, attempts: 2, apiVersion: API_VERSION,
    knowledgeBases: requests.map(item => item.kb.id), outputSizeField: 'maxOutputSize',
    message: 'No capture exists until separately approved execution. Fixtures are not Azure captures.' };
  if (!paidApproved || !webApproved || !output) throw new OperatorError('--execute requires --paid-queries-approved, --web-terms-approved and an external --output directory.');
  const endpoint = `https://${definitions.searchService}.search.windows.net`;
  if (env.AZURE_SEARCH_ENDPOINT?.replace(/\/$/, '') !== endpoint || env.FOUNDRY_IQ_LIVE_ENABLED !== 'true'
    || typeof env.AZURE_SEARCH_API_KEY !== 'string' || !env.AZURE_SEARCH_API_KEY
    || env.AZURE_SEARCH_API_KEY.startsWith('@Microsoft.KeyVault(')
    || typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 32
    || env.SESSION_SECRET.startsWith('@Microsoft.KeyVault(')) {
    throw new OperatorError('Canary requires the approved endpoint, explicit local live flag and resolved server credentials. Public app live need not be enabled.');
  }
  const expectedQuota = `https://${definitions.storageAccount}.blob.core.windows.net/${definitions.quotaContainer}`;
  if (env.FOUNDRY_IQ_QUOTA_CONTAINER_URL?.replace(/\/$/, '') !== expectedQuota) throw new OperatorError('Quota container differs from the shared demo ledger.');
  const destination = await outsideOutput(output);
  await mkdir(destination, { recursive: false });
  if (!coordinator) {
    const credential = await operatorCredential(definitions);
    const { ContainerClient } = await import('@azure/storage-blob');
    const container = new ContainerClient(expectedQuota, credential, {
      retryOptions: { maxTries: 1 }, loggingOptions: { logger: () => {} },
    });
    coordinator = new BlobQuotaCoordinator(container.getBlockBlobClient('quotas.json'));
  }
  const files = [];
  for (const { kb, body } of requests) {
    const signal = AbortSignal.timeout(75000);
    const requestId = randomUUID();
    const url = `${endpoint}/knowledgebases('${kb.id}')/retrieve?api-version=${API_VERSION}`;
    const slot = await coordinator.reserve({ sessionId: 'operator-canary', ip: 'operator-canary',
      secret: env.SESSION_SECRET, lifetimeMs: 105000, signal });
    const started = performance.now();
    let response;
    let data;
    let failure;
    try {
      response = await fetchImpl(url, { method: 'POST', signal, redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'api-key': env.AZURE_SEARCH_API_KEY,
          'x-ms-client-request-id': requestId }, body: JSON.stringify(body) });
      const raw = await readBounded(response.body, MAX_RESPONSE_BYTES, signal);
      try { data = JSON.parse(raw); } catch { throw new OperatorError('Retrieve returned invalid JSON; no raw text was persisted.'); }
    } catch (error) {
      failure = error instanceof OperatorError ? error.message : 'Retrieve failed or was cancelled; attempt remains charged.';
    } finally {
      try { await coordinator.release(slot); } catch {
        failure = 'Quota release could not be verified; reservation expires conservatively. Do not retry automatically.';
      }
    }
    const secrets = [env.AZURE_SEARCH_API_KEY, env.SESSION_SECRET];
    const sanitized = sanitize(data ?? null, secrets);
    let normalized;
    let shapeError;
    if (response?.ok && data) {
      try { normalized = normalizeResponse(data, { partial: response.status === 206, secrets }).normalized; }
      catch { shapeError = 'Published response shape did not match the adapter; service-contract follow-up is required.'; }
    }
    const capture = sanitize({
      version: 1, evidence, capturedAtUtc: new Date().toISOString(), acceptance: 'UNVERIFIED; human review required',
      request: { method: 'POST', route: `/knowledgebases('${kb.id}')/retrieve?api-version=${API_VERSION}`,
        endpoint: '[approved dedicated Search origin]', authentication: 'api-key (value omitted; key type not inferred)',
        clientRequestId: requestId, body },
      response: { status: response?.status ?? null, requestId: response?.headers.get('x-ms-request-id') ?? null,
        contentType: response?.headers.get('content-type') ?? null, body: sanitized },
      normalized, shapeError, failure, elapsedMs: Math.round(performance.now() - started),
      limitations: ['Sanitization preserves published shapes, not secrets. No inferred passages, timings or key type.',
        'HTTP success does not prove grounding, both-source use, Web terms, cost/latency or public acceptance.'],
    }, secrets);
    const filename = join(destination, `${kb.id.endsWith('-web') ? 'web' : 'indexed'}.json`);
    if (save) await save(filename, capture);
    else await writeFile(filename, JSON.stringify(capture, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    files.push(filename);
    if (failure || shapeError || !response?.ok || normalized?.partial || !normalized?.references?.length) {
      throw new OperatorError('Canary incomplete/failed/partial or ungrounded. Sanitized evidence saved externally; no retry or live enablement performed.');
    }
  }
  return { captured: files, attempts: 2, liveAcceptance: false, message: 'Actual service evidence requires review; no public live setting was changed.' };
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2), ['--execute', '--paid-queries-approved', '--web-terms-approved'], ['--output']);
    const { definitions } = await loadInputs();
    process.stdout.write(JSON.stringify(await captureCanaries({ definitions, env: process.env,
      execute: !!args['--execute'], paidApproved: !!args['--paid-queries-approved'],
      webApproved: !!args['--web-terms-approved'], output: args['--output'] })) + '\n');
  } catch (error) { reportFailure(error); }
}
