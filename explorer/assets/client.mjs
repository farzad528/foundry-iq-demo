import { sourceIcon } from './source-icons.mjs';

const DATA = JSON.parse(document.getElementById('catalog').textContent);
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const pretty = value => JSON.stringify(value, null, 2);
let scenario = DATA[0];
let tab = 'sources';
let result = null;
let selectedRef = null;
let busy = false;
let config = {};
let lastRequest = null;
let cancellation;
let previewId = 0;

function safeLink(value) {
  if (typeof value !== 'string') return null;
  if (/^\/samples\/[a-z0-9-]+\.(?:md|csv)$/.test(value)) return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function badge(kind) {
  const entry = sourceIcon(kind);
  return `<span class="source-badge"><img src="${entry.icon}" alt="" width="18" height="18">${esc(entry.label)} · ${esc(entry.access)}</span>`;
}

function sourceParams() {
  return scenario.sources.map((source, index) => ({
    kind: source.kind,
    knowledgeSourceName: source.name,
    includeReferences: true,
    includeReferenceSourceData: $('include-' + index)?.checked ?? true,
    ...($('effort').value !== 'minimal' ? { alwaysQuerySource: $('always-' + index)?.checked ?? false } : {}),
  }));
}

function payload() {
  return {
    ...($('effort').value === 'minimal'
      ? { intents: [{ type: 'semantic', search: $('question').value.trim() }] }
      : { messages: [{ role: 'user', content: [{ type: 'text', text: $('question').value.trim() }] }] }),
    includeActivity: $('include-activity').checked,
    retrievalReasoningEffort: { kind: $('effort').value },
    outputMode: $('output').value,
    ...($('runtime').value ? { maxRuntimeInSeconds: Number($('runtime').value) } : {}),
    ...($('tokens').value ? { maxOutputSizeInTokens: Number($('tokens').value) } : {}),
    knowledgeSourceParams: sourceParams(),
  };
}

function updateCapabilities() {
  const allowed = scenario.execution === 'sample'
    ? ['low', 'medium', 'minimal', 'auto']
    : config.capabilities?.[scenario.id]?.efforts || ['low', ...(scenario.sources.some(source => source.kind === 'web') ? [] : ['minimal']), 'auto'];
  for (const option of $('effort').options) option.disabled = !allowed.includes(option.value);
  if (!allowed.includes($('effort').value)) $('effort').value = 'low';
  const minimal = $('effort').value === 'minimal';
  if (minimal) $('output').value = 'extractiveData';
  $('output').disabled = minimal || busy;
  scenario.sources.forEach((_, index) => { if ($('always-' + index)) $('always-' + index).disabled = minimal || busy; });
  $('mode').value = scenario.execution;
  $('mode-badge').textContent = scenario.execution === 'sample' ? 'SYNTHETIC REPLAY' : 'LIVE KNOWLEDGE BASE';
  $('composer-label').textContent = scenario.execution === 'sample'
    ? 'Fixed synthetic example · never a live fallback'
    : config.liveEnabled ? 'Public content only · server-side retrieval' : 'Live queries paused / not configured';
  $('privacy').textContent = scenario.sources.some(source => source.kind === 'web')
    ? 'Public demo: do not enter sensitive information. Web queries can leave Azure compliance and geographic boundaries. Web evidence is a cited summary, not verbatim source text.'
    : 'Public demo: do not enter sensitive information. Samples are fictional and are not operational instructions.';
}

function selectScenario(id) {
  if (busy) return;
  scenario = DATA.find(item => item.id === id);
  $('question').value = scenario.question;
  $('current-title').textContent = scenario.name;
  $('kb-label').textContent = scenario.execution === 'live' ? 'LIVE CATALOG' : 'SAMPLE';
  $('source-count').textContent = `${scenario.sources.length} knowledge sources`;
  $('scenario-list').innerHTML = ['live', 'sample'].map(execution =>
    `<div class="eyebrow catalog-group">${execution === 'live' ? 'Live public knowledge bases' : 'Synthetic replays'}</div>` +
    DATA.filter(item => item.execution === execution).map(item => `
      <button class="scenario ${item.id === id ? 'active' : ''}" data-id="${esc(item.id)}" aria-pressed="${item.id === id}">
        <span class="symbol">${badge(item.sources[0]?.kind)}</span>
        <div><strong>${esc(item.name)}</strong><small>${item.sources.length} sources · ${execution === 'live' ? 'Live / public' : 'Sample only'}</small></div>
      </button>`).join('')).join('');
  $('scenario-list').querySelectorAll('button').forEach(button => { button.onclick = () => selectScenario(button.dataset.id); });
  $('source-controls').innerHTML = scenario.sources.map((source, index) => `
    <div class="source-mini">${badge(source.kind)} ${esc(source.title)}</div>
    <label class="hint"><input type="checkbox" id="include-${index}" checked> Include source data</label><br>
    <label class="hint"><input type="checkbox" id="always-${index}"> Always query source</label>`).join('');
  $('source-controls').querySelectorAll('input').forEach(input => { input.onchange = renderInspector; });
  $('error').textContent = '';
  updateCapabilities();
  renderInspector();
}

function referenceFor(id) {
  const matches = result?.normalized.references.filter(reference => reference.id === id) || [];
  return matches.length === 1 ? matches[0] : null;
}

function citation(id) {
  const reference = referenceFor(id);
  if (!reference) return `<span class="unresolved">[unresolved citation ${esc(id)}]</span>`;
  const index = previewId++;
  return `<span class="citation-wrap">
    <button class="cite" data-ref="${esc(id)}" aria-label="Inspect citation ${esc(id)}: ${esc(reference.title)}" aria-describedby="preview-${index}">${esc(id)}</button>
    <span class="citation-preview" role="tooltip" id="preview-${index}">${badge(reference.kind)}<strong>${esc(reference.title)}</strong>${esc(reference.passage?.slice(0, 280) || 'No passage text returned. Inspect the annotation.')}</span>
  </span>`;
}

function inspectReference(id) {
  selectedRef = id;
  setTab('sources');
  const index = result.normalized.references.findIndex(reference => reference.id === id);
  const article = $('reference-' + index);
  article?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  article?.focus({ preventScroll: true });
}

function positionPreview(wrapper) {
  wrapper.classList.remove('preview-dismissed');
  const preview = wrapper.querySelector('.citation-preview');
  preview.style.left = '';
  if (!preview.getClientRects().length) return;
  const bounds = preview.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const shift = bounds.left < 12 ? 12 - bounds.left : bounds.right > width - 12 ? width - 12 - bounds.right : 0;
  preview.style.left = `${(parseFloat(getComputedStyle(preview).left) || 0) + shift}px`;
}

function renderResult() {
  if (!result) {
    $('result').innerHTML = '<div class="answer"><div class="answer-head">Grounded answer <span class="muted">Ready to explore</span></div><div class="answer-body empty">Choose a live knowledge base to ask a question, or explicitly select a synthetic replay.</div></div>';
    return;
  }
  const normalized = result.normalized;
  previewId = 0;
  const answer = result.output === 'extractiveData' ? `<pre>${esc(normalized.text)}</pre>` : normalized.text.split('\n\n')
    .map(paragraph => `<p>${esc(paragraph).replace(/\[ref_id:([^\]]+)\]/g, (_, id) => citation(id))}</p>`).join('');
  $('result').innerHTML = `<div class="answer">
    <div class="answer-head"><span>${result.output === 'extractiveData' ? 'Retrieved content' : 'Grounded answer'}</span><span class="pill">${result.sample ? 'SYNTHETIC SAMPLE' : normalized.partial ? 'PARTIAL LIVE RESPONSE' : 'LIVE RESPONSE'}</span></div>
    <div class="run-context hint">Last completed run · ${esc(result.scenarioName)} · request ${esc(result.requestId)}</div>
    <div class="answer-body">${answer || '<p>No text response returned. Inspect the sanitized response.</p>'}</div>
    <div class="answer-foot"><span>${normalized.references.length} references</span><span>${normalized.activityReported ? normalized.activities.length + ' reported activities' : 'Activity not reported'}</span><span>${result.sample ? 'Illustrative fixture timings' : result.elapsed + ' ms round trip (not service duration)'}</span></div></div>
    ${normalized.limitations.map(limitation => `<p class="notice">${esc(limitation)}</p>`).join('')}
    <div class="evidence-list">${normalized.references.map(reference => `<button class="evidence-chip" data-ref="${esc(reference.id)}">${badge(reference.kind)}<span>${esc(reference.id ?? 'Missing ID')}</span>${esc(reference.title)}</button>`).join('')}</div>`;
  $('result').querySelectorAll('[data-ref]').forEach(button => { button.onclick = () => inspectReference(button.dataset.ref); });
  $('result').querySelectorAll('.citation-wrap').forEach(wrapper => {
    wrapper.onmouseenter = () => positionPreview(wrapper);
    wrapper.addEventListener('focusin', () => positionPreview(wrapper));
  });
}

function setTab(next) {
  tab = next;
  document.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $('inspect').setAttribute('aria-labelledby', 'tab-' + next);
  renderInspector();
}

function renderInspector() {
  if (tab === 'request') {
    const snapshot = lastRequest;
    $('inspect').innerHTML = `<p class="hint">${snapshot ? 'Retained request for the last run; editing controls does not change it.' : 'Draft request; the effective sent payload will be retained after a run.'}<br>api-version=2026-08-01-preview · maxOutputSizeInTokens</p>
      <pre>${esc(pretty(snapshot || payload()))}</pre><button class="plain" id="copy">Copy request</button>
      <details><summary class="hint">Sanitized service response</summary><pre>${esc(result ? pretty(result.data) : 'Run retrieval to inspect the service response.')}</pre></details>`;
    $('copy').onclick = async () => {
      try { await navigator.clipboard.writeText(pretty(snapshot || payload())); $('copy').textContent = 'Copied'; }
      catch { $('copy').textContent = 'Select the JSON to copy'; }
    };
    return;
  }
  if (tab === 'activity') {
    if (!result) { $('inspect').innerHTML = '<div class="empty">Run retrieval to inspect reported activity.</div>'; return; }
    const activities = result.normalized.activities;
    $('inspect').innerHTML = `<div class="notice">${result.sample ? 'Illustrative fixture timings; controls do not change this replay.' : 'Only service-reported activities and timings. IDs link evidence; array order is not identity. Parallel durations are not added.'}</div>
      ${!activities.length ? '<p class="empty">No activities returned.</p>' : ''}
      <div class="trace">${activities.map(activity => `<div class="step"><b>${esc(activity.type || 'Unreported type')} · ID ${esc(activity.id ?? 'not reported')}</b>
        <small>${Number.isFinite(activity.elapsedMs) ? esc(activity.elapsedMs) + ' ms' : 'Timing not reported'}</small>
        <p>${badge(activity.type)} ${esc(activity.knowledgeSourceName || 'Knowledge base')}</p>
        ${activity.error ? `<p class="error">Service activity failed: ${esc(activity.error.code || 'unknown error')}</p>` : ''}
        <details><summary class="hint">Inspect activity</summary><pre>${esc(pretty(activity))}</pre></details></div>`).join('')}</div>
      ${result.sample && result.sql ? `<div class="notice">Illustrative SQL, not service diagnostics. Live Fabric is out of scope.</div><pre>${esc(result.sql)}</pre>` : ''}`;
    return;
  }
  const references = result?.normalized.references || [];
  $('inspect').innerHTML = `<div class="eyebrow">${result ? 'CITED EVIDENCE · LAST RUN' : 'KNOWLEDGE MANIFEST'}</div>
    <p class="hint">${result ? 'Inspect passages and the safe original annotation. Sensitive URL parameters and credential fields are redacted.' : 'Live entries describe planned public sources; catalog membership is not evidence that any source was queried.'}</p>` +
    (result ? references.map((reference, index) => {
      const link = safeLink(reference.url);
      return `<article tabindex="-1" id="reference-${index}" class="source-card ${reference.id === selectedRef ? 'selected-ref' : ''}">
        ${badge(reference.kind)}<span class="pill">REFERENCE ${esc(reference.id ?? 'ID missing')}</span><h3>${esc(reference.title)}</h3>
        <p>${esc(reference.sourceName || 'Source name not reported')} · ${reference.activityLinked ? 'activity ID ' + esc(reference.activityId) : 'Activity linkage not reported / unresolved'}</p>
        ${reference.location ? `<p>Location: ${esc(reference.location)}</p>` : ''}
        ${reference.kind === 'web' ? '<p class="notice">Service-provided cited Web summary, not a guaranteed verbatim passage.</p>' : ''}
        <blockquote>${esc(reference.passage || 'No passage text returned. Inspect the annotation below.')}</blockquote>
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open source ↗</a><p class="hint">Some source URLs may require separate authorization; the demo never proxies them.</p>` : '<p class="hint">No safe public source link was returned.</p>'}
        <details ${reference.id === selectedRef ? 'open' : ''}><summary>Full sanitized annotation</summary><pre>${esc(pretty(reference.annotation))}</pre></details></article>`;
    }).join('') || '<p class="empty">No references returned; grounding is unverified.</p>' : scenario.sources.map(source => `<article class="source-card">
      ${badge(source.kind)}<span class="pill">${scenario.execution === 'sample' ? 'SAMPLE' : 'LIVE CATALOG'}</span><h3>${esc(source.title)}</h3><p>${esc(source.detail)}</p>
      <p class="hint">${esc(source.name)}</p>
      ${source.files.map(file => `<details><summary>${esc(file.title)}</summary><blockquote>${esc(file.text)}</blockquote><a href="${esc(safeLink(file.url) || '#')}" target="_blank" rel="noopener noreferrer">Open public synthetic source ↗</a></details>`).join('')}</article>`).join('')) +
    (scenario.requiresIdentity ? '<div class="notice">Fabric and remote SharePoint are synthetic replay only. No anonymous access to private content is implemented.</div>' : '');
}

async function run() {
  if (busy) return;
  if (!$('question').value.trim()) { $('error').textContent = 'Enter a question.'; return; }
  if (!$('runtime').checkValidity() || !$('tokens').checkValidity()) { $('error').textContent = 'Check the runtime and token limits.'; return; }
  const request = payload();
  const submitted = scenario;
  busy = true;
  result = null;
  lastRequest = null;
  cancellation = new AbortController();
  $('run').disabled = true;
  $('cancel').hidden = false;
  $('run').textContent = 'Retrieving…';
  $('error').textContent = '';
  $('result').innerHTML = '<div class="answer"><p class="run-context" role="status">Retrieval in progress. No replay will replace a failed live query.</p></div>';
  updateCapabilities();
  try {
    const start = performance.now();
    const response = await fetch('/api/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: submitted.id, mode: submitted.execution, request }),
      signal: cancellation.signal,
    });
    const body = await response.json();
    lastRequest = body.effectiveRequest || null;
    if (!response.ok) throw new Error(`${body.error || 'Retrieval failed'}${body.serviceError?.message ? ' ' + body.serviceError.message : ''} (request ${body.requestId || response.headers.get('x-request-id') || 'unavailable'}${body.retryAfter ? '; retry after ' + body.retryAfter + 's' : ''})`);
    result = {
      ...body,
      elapsed: Math.round(performance.now() - start),
      output: request.outputMode,
      scenarioName: submitted.name,
      sql: submitted.sql,
    };
    renderResult();
  } catch (error) {
    $('error').className = 'error';
    $('error').textContent = cancellation.signal.aborted ? 'Retrieval cancelled. A reserved live call still counts against quotas.' : error.message;
    renderResult();
  } finally {
    busy = false;
    $('run').disabled = false;
    $('cancel').hidden = true;
    $('run').textContent = 'Run retrieval ↗';
    updateCapabilities();
    renderInspector();
  }
}

$('run').onclick = run;
$('cancel').onclick = () => cancellation?.abort();
$('suggest').onclick = () => { $('question').value = scenario.question; renderInspector(); };
$('question').oninput = renderInspector;
$('question').onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void run(); } };
document.querySelectorAll('[data-tab]').forEach((button, index, buttons) => {
  button.onclick = () => setTab(button.dataset.tab);
  button.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    setTab(buttons[next].dataset.tab);
    buttons[next].focus();
  };
});
['effort', 'output', 'runtime', 'tokens', 'include-activity'].forEach(id => {
  $(id).onchange = () => { updateCapabilities(); renderInspector(); };
});
$('mode').onchange = () => { selectScenario(DATA.find(item => item.execution === $('mode').value).id); };
$('connect').onclick = () => $('connection').showModal();
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.querySelectorAll('.citation-wrap').forEach(wrapper => wrapper.classList.add('preview-dismissed'));
});
window.addEventListener('resize', () => document.querySelectorAll('.citation-wrap').forEach(wrapper => {
  if (!wrapper.classList.contains('preview-dismissed')) positionPreview(wrapper);
}));
selectScenario(DATA[0].id);
renderResult();
try {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('Server status unavailable.');
  config = await response.json();
  $('connection-status').textContent = `${config.configured ? 'Dependencies configured' : 'Server dependencies missing'} · ${config.liveEnabled ? 'Live switch enabled' : 'Live switch paused'}. ${config.contractStatus}`;
  $('contract-status').textContent = config.contractStatus;
  updateCapabilities();
} catch (error) {
  $('connection-status').textContent = error.message;
  $('error').textContent = 'Could not load server status. Live availability is unverified.';
}
