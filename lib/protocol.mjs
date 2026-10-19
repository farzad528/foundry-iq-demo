export const API_VERSION = '2026-08-01-preview';
export const MAX_REQUEST_BYTES = 65536;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_RUNTIME_SECONDS = 120;

export class HttpError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function canonicalOrigin(value) {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Invalid origin');
    }
    return url.origin;
  } catch {
    throw new HttpError(503, 'configuration_unavailable', 'A canonical PUBLIC_ORIGIN must be configured.');
  }
}

export async function readBounded(stream, limit, signal) {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, 'body_too_large', 'The streamed body exceeded its byte limit.');
      }
      chunks.push(value);
    }
    const buffer = Buffer.concat(chunks, size);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new HttpError(400, 'invalid_encoding', 'The body must contain valid UTF-8.');
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.hasOwn(value, key);
const invalid = message => { throw new HttpError(400, 'invalid_request', message); };

function keys(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    invalid(`Unsupported ${label} fields.`);
  }
}

export function capabilities(kb, env = {}) {
  const web = kb.sources.some(source => source.kind === 'web');
  return {
    efforts: [
      'low',
      ...(env.FOUNDRY_IQ_MEDIUM_ENABLED === 'true' ? ['medium'] : []),
      ...(!web ? ['minimal'] : []),
      'auto',
    ],
    outputModes: ['answerSynthesis', 'extractiveData'],
    maxRuntimeInSeconds: MAX_RUNTIME_SECONDS,
    maxOutputSize: 10000,
    web,
  };
}

export function validateRequest(body, catalog, env) {
  keys(body, ['scenarioId', 'mode', 'request'], 'envelope');
  const scenario = catalog.find(item => item.id === body.scenarioId);
  if (!scenario) invalid('Unknown knowledge base.');
  if (!['live', 'sample'].includes(body.mode) || body.mode !== scenario.execution) {
    invalid('This catalog entry does not support that execution mode. Choose an explicitly labeled sample or live knowledge base.');
  }
  const request = body.request;
  keys(request, [
    'messages', 'intents', 'retrievalReasoningEffort', 'outputMode', 'includeActivity',
    'maxRuntimeInSeconds', 'maxOutputSize', 'knowledgeSourceParams',
  ], 'retrieval');
  const effort = request.retrievalReasoningEffort?.kind;
  keys(request.retrievalReasoningEffort, ['kind'], 'reasoning effort');
  const supported = body.mode === 'sample' ? ['low', 'medium', 'minimal', 'auto'] : capabilities(scenario, env).efforts;
  if (!supported.includes(effort)) invalid('Unsupported reasoning effort for this knowledge base or deployment.');
  if (!['extractiveData', 'answerSynthesis'].includes(request.outputMode)) invalid('Unsupported output mode.');
  if (effort === 'minimal' && request.outputMode !== 'extractiveData') invalid('Minimal effort requires extractive data.');
  let question;
  if (effort === 'minimal') {
    if (has(request, 'messages') || !Array.isArray(request.intents) || request.intents.length !== 1) invalid('Minimal effort requires one semantic intent and no messages.');
    keys(request.intents[0], ['type', 'search'], 'intent');
    if (request.intents[0].type !== 'semantic') invalid('Only semantic intents are supported.');
    question = request.intents[0].search;
  } else {
    if (has(request, 'intents') || !Array.isArray(request.messages) || request.messages.length !== 1) invalid('Use one user message and no intents.');
    const message = request.messages[0];
    keys(message, ['role', 'content'], 'message');
    if (message.role !== 'user' || !Array.isArray(message.content) || message.content.length !== 1) invalid('Use one user text message.');
    keys(message.content[0], ['type', 'text'], 'message content');
    if (message.content[0].type !== 'text') invalid('Only text questions are supported.');
    question = message.content[0].text;
  }
  if (typeof question !== 'string' || !question.trim() || question.length > 8000) invalid('Enter a question between 1 and 8,000 characters.');
  const outbound = effort === 'minimal'
    ? { intents: [{ type: 'semantic', search: question.trim() }] }
    : { messages: [{ role: 'user', content: [{ type: 'text', text: question.trim() }] }] };
  outbound.retrievalReasoningEffort = { kind: effort };
  outbound.outputMode = request.outputMode;
  for (const [field, min, max] of [
    ['maxRuntimeInSeconds', 10, MAX_RUNTIME_SECONDS],
    ['maxOutputSize', 5001, 10000],
  ]) {
    if (has(request, field)) {
      if (!Number.isInteger(request[field]) || request[field] < min || request[field] > max) invalid(`Invalid ${field}; allowed range ${min}-${max}.`);
      outbound[field] = request[field];
    }
  }
  if (has(request, 'includeActivity')) {
    if (typeof request.includeActivity !== 'boolean') invalid('includeActivity must be boolean.');
    outbound.includeActivity = request.includeActivity;
  }
  if (has(request, 'knowledgeSourceParams')) {
    const params = request.knowledgeSourceParams;
    if (!Array.isArray(params) || params.length > scenario.sources.length) invalid('Invalid knowledge source parameters.');
    const names = new Set();
    outbound.knowledgeSourceParams = params.map(param => {
      keys(param, ['kind', 'knowledgeSourceName', 'includeReferences', 'includeReferenceSourceData', 'alwaysQuerySource'], 'source');
      const source = scenario.sources.find(item => item.name === param.knowledgeSourceName && item.kind === param.kind);
      if (!source || names.has(source.name)) invalid('Unknown, mismatched, or duplicate knowledge source.');
      names.add(source.name);
      const normalized = { kind: source.kind, knowledgeSourceName: source.name };
      for (const field of ['includeReferences', 'includeReferenceSourceData', 'alwaysQuerySource']) {
        if (!has(param, field)) continue;
        if (typeof param[field] !== 'boolean') invalid(`${field} must be boolean.`);
        if (field === 'alwaysQuerySource' && effort === 'minimal') invalid('Minimal effort searches all sources; omit alwaysQuerySource.');
        normalized[field] = param[field];
      }
      return normalized;
    });
  }
  return { scenario, outbound, question: question.trim() };
}

export function retryAfter(value) {
  if (!value) return 5;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.min(86400, Math.max(1, seconds)) : 5;
}
