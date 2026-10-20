export const API_VERSION = '2026-08-01-preview';

export function conversationMessages(turns) {
  if (turns.some(turn => turn.result && !turn.result.normalized.text?.trim())) throw new Error('A response has no assistant text to include in conversation history. Start a new chat.');
  return turns.filter(turn => turn.result?.normalized.text?.trim()).flatMap(turn => [
    { role: 'user', content: [{ type: 'text', text: turn.question }] },
    { role: 'assistant', content: [{ type: 'text', text: turn.result.normalized.text }] },
  ]);
}

export function buildRequest({ question, history = [], effort = '', output = '', runtime = '', tokens = '', activity = '', sources = [] }) {
  if (effort === 'minimal' && history.length) throw new Error('Minimal effort cannot send conversation history. Choose another effort or start a new chat.');
  if (effort === 'minimal' && output !== 'extractiveData') throw new Error('Minimal effort requires extractive data.');
  const request = effort === 'minimal'
    ? { intents: [{ type: 'semantic', search: question.trim() }] }
    : { messages: [...structuredClone(history), { role: 'user', content: [{ type: 'text', text: question.trim() }] }] };
  if (effort) request.retrievalReasoningEffort = { kind: effort };
  if (output) request.outputMode = output;
  for (const [field, value, min, max] of [
    ['maxRuntimeInSeconds', runtime, 10, 120],
    ['maxOutputSize', tokens, 5001, 10000],
  ]) {
    if (value === '') continue;
    if (!Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`${field} must be between ${min} and ${max}.`);
    request[field] = Number(value);
  }
  if (activity !== '') request.includeActivity = booleanOverride(activity);
  const overrides = sources.flatMap(source => {
    const flags = Object.fromEntries(['includeReferences', 'includeReferenceSourceData', 'alwaysQuerySource']
      .filter(field => source[field] !== undefined && source[field] !== '')
      .map(field => [field, booleanOverride(source[field])]));
    if (effort === 'minimal' && Object.hasOwn(flags, 'alwaysQuerySource')) throw new Error('Minimal effort requires Always query source to use Service default.');
    return Object.keys(flags).length ? [{ kind: source.kind, knowledgeSourceName: source.name, ...flags }] : [];
  });
  if (overrides.length) request.knowledgeSourceParams = overrides;
  return request;
}

function booleanOverride(value) {
  if (!['true', 'false'].includes(value)) throw new Error('Choose Service default, Enabled, or Disabled.');
  return value === 'true';
}

export function requestSnapshot(scenarioId, body) {
  return {
    method: 'POST',
    path: `/knowledgebases('${scenarioId}')/retrieve?api-version=${API_VERSION}`,
    apiVersion: API_VERSION,
    body: structuredClone(body),
    sent: false,
    redacted: false,
  };
}

export function requestCode(snapshot, format = 'curl') {
  const body = JSON.stringify(snapshot.body, null, 2);
  if (format === 'json') return body;
  if (format !== 'curl') throw new Error('Unsupported code format.');
  const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
  return [
    'curl --request POST \\',
    `  --url "\${AZURE_SEARCH_ENDPOINT}${snapshot.path}" \\`,
    '  --header "Content-Type: application/json" \\',
    '  --header "Accept: application/json" \\',
    '  --header "api-key: ${AZURE_SEARCH_API_KEY}" \\',
    ...(snapshot.clientRequestId ? [`  --header ${quote('x-ms-client-request-id: ' + snapshot.clientRequestId)} \\`] : []),
    `  --data-raw ${quote(body)}`,
  ].join('\n');
}
