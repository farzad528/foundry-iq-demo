import { sourceIcon } from './source-icons.mjs';
import { buildRequest, conversationMessages, requestSnapshot, requestCode } from './request.mjs';

const DATA = JSON.parse(document.getElementById('catalog').textContent);
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const pretty = value => JSON.stringify(value, null, 2);
const fields = ['effort', 'output', 'runtime', 'tokens', 'include-activity'];
let scenario = DATA[0];
let turns = [];
let busy = false;
let config = {};
let cancellation;
let codeSnapshot;
let retainedCode;
let inspectedTurn;
let selectedRef = null;
let tab = 'sources';
let sequence = 0;
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
  return `<span class="source-badge"><img src="${entry.icon}" alt="" width="18" height="18">${esc(entry.label)}</span>`;
}

function payload() {
  return buildRequest({
    question: $('question').value,
    history: conversationMessages(turns),
    effort: $('effort').value, output: $('output').value,
    runtime: $('runtime').value, tokens: $('tokens').value, activity: $('include-activity').value,
    sources: scenario.sources.map((source, index) => ({
      ...source,
      ...Object.fromEntries(['includeReferences', 'includeReferenceSourceData', 'alwaysQuerySource']
        .map(field => [field, $(`${field}-${index}`).value])),
    })),
  });
}

function resetSettings() {
  fields.forEach(id => { $(id).value = ''; });
  $('source-controls').querySelectorAll('select').forEach(input => { input.value = ''; });
  updateCapabilities();
}

function updateCapabilities() {
  const allowed = scenario.execution === 'sample'
    ? ['low', 'medium', 'minimal', 'auto']
    : config.capabilities?.[scenario.id]?.efforts || ['low', ...(scenario.sources.some(source => source.kind === 'web') ? [] : ['minimal']), 'auto'];
  for (const option of $('effort').options) option.disabled = option.value !== '' && !allowed.includes(option.value);
  const minimal = $('effort').value === 'minimal';
  if (minimal) $('output').value = 'extractiveData';
  $('output').disabled = minimal || busy;
  const replayComplete = scenario.execution === 'sample' && turns.some(turn => turn.result);
  $('run').disabled = busy || replayComplete;
  $('question').disabled = busy || replayComplete;
  $('knowledge-base').disabled = busy;
  $('new-chat').disabled = busy;
  fields.filter(id => id !== 'output').forEach(id => { $(id).disabled = busy; });
  $('reset-settings').disabled = busy;
  $('source-controls').querySelectorAll('select').forEach(input => { input.disabled = busy; });
  $('composer-label').textContent = replayComplete ? 'Fixed replay complete · Start a new chat to replay'
    : scenario.execution === 'sample' ? 'Synthetic replay · Fixed example'
      : config.liveEnabled === false ? 'Live paused · Select a synthetic replay to explore'
      : 'Conversation history included · Ctrl / ⌘ + Enter to send';
  $('control-hint').textContent = minimal
    ? 'Minimal requires extractive data and one intent, without conversation history. Start a new chat for a minimal query.'
    : 'Auto is an explicit effort, not Service default. Leave source overrides unset unless needed.';
  $('privacy').textContent = scenario.sources.some(source => source.kind === 'web')
    ? 'Public demo · No sensitive information. Web queries can leave Azure compliance and geographic boundaries.'
    : 'Public demo · Do not enter sensitive information. Fictional content is not operational guidance.';
}

function newChat() {
  if (busy) return;
  turns = [];
  sequence = 0;
  codeSnapshot = null;
  retainedCode = null;
  inspectedTurn = null;
  selectedRef = null;
  $('question').value = '';
  $('error').textContent = '';
  $('run-status').textContent = '';
  renderConversation();
  updateCapabilities();
}

function selectScenario(id) {
  if (busy) return;
  scenario = DATA.find(item => item.id === id);
  $('knowledge-base').value = id;
  $('welcome-description').textContent = scenario.execution === 'sample'
    ? 'A fixed synthetic example. No Azure call is made.'
    : scenario.description;
  $('manifest').innerHTML = scenario.sources.map(source => badge(source.kind)).join('');
  const suggestions = [{ label: scenario.execution === 'sample' ? 'Replay example' : 'Start with an example', question: scenario.question }];
  if (scenario.execution === 'live') suggestions.push({ label: 'Find the gaps', question: 'What information is missing or cannot be confirmed from these sources?' });
  $('suggestions').innerHTML = suggestions.map((item, index) => `<button class="suggestion" data-suggestion="${index}"><span>${esc(item.label)} ↗</span>${esc(item.question)}</button>`).join('');
  $('suggestions').querySelectorAll('button').forEach(button => {
    button.onclick = () => { $('question').value = suggestions[Number(button.dataset.suggestion)].question; $('question').focus(); };
  });
  const booleanOptions = '<option value="">Service default</option><option value="true">Enabled</option><option value="false">Disabled</option>';
  $('source-controls').innerHTML = scenario.sources.map((source, index) => `<details class="source-settings"><summary>${badge(source.kind)} &nbsp; ${esc(source.title)}</summary>
    <p class="hint">${esc(source.name)} · ${esc(sourceIcon(source.kind).access)}</p>
    ${[['includeReferences', 'Include references'], ['includeReferenceSourceData', 'Include source data'], ['alwaysQuerySource', 'Always query source']].map(([field, label]) =>
      `<div class="field"><label for="${field}-${index}">${label}</label><select id="${field}-${index}">${booleanOptions}</select></div>`).join('')}</details>`).join('');
  newChat();
  resetSettings();
}

function referenceFor(turn, id) {
  const matches = turn.result.normalized.references.filter(reference => reference.id === id);
  return matches.length === 1 ? matches[0] : null;
}

function citation(turn, id) {
  const reference = referenceFor(turn, id);
  if (!reference) return `<span class="unresolved">[unresolved citation ${esc(id)}]</span>`;
  const index = previewId++;
  return `<span class="citation-wrap"><button class="cite" data-turn="${turn.id}" data-ref="${esc(id)}" aria-label="Inspect citation ${esc(id)}: ${esc(reference.title)}" aria-describedby="preview-${index}">${esc(id)}</button>
    <span class="citation-preview" role="tooltip" id="preview-${index}">${badge(reference.kind)}<strong>${esc(reference.title)}</strong>${esc(reference.passage?.slice(0, 280) || 'No passage returned. Inspect the annotation.')}</span></span>`;
}

function positionPreview(wrapper) {
  wrapper.classList.remove('preview-dismissed');
  const preview = wrapper.querySelector('.citation-preview');
  if (!preview.getClientRects().length) return;
  const anchor = wrapper.querySelector('.cite').getBoundingClientRect();
  const bounds = preview.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  preview.style.position = 'fixed';
  preview.style.bottom = 'auto';
  preview.style.left = `${Math.max(12, Math.min(anchor.left, width - bounds.width - 12))}px`;
  preview.style.top = `${anchor.top > bounds.height + 12 ? anchor.top - bounds.height - 8 : anchor.bottom + 8}px`;
}

function renderConversation() {
  $('welcome').hidden = turns.length > 0;
  if (!turns.length) { $('messages').replaceChildren(); previewId = 0; }
  turns.forEach(turn => {
    const existing = $('turn-' + turn.id);
    if (existing?.dataset.complete === 'true') return;
    let answer;
    if (turn.pending) answer = '<p class="muted">Retrieving…</p>';
    else if (turn.error) answer = `<p class="error" role="alert">${esc(turn.error)}</p>`;
    else {
      const { normalized, sample } = turn.result;
      const text = turn.request.body.outputMode === 'extractiveData' ? `<pre>${esc(normalized.text)}</pre>` : normalized.text.split('\n\n')
        .map(paragraph => `<p>${paragraph.split(/(\[ref_id:[^\]]+\])/).map(part => {
          const match = /^\[ref_id:([^\]]+)\]$/.exec(part);
          return match ? citation(turn, match[1]) : esc(part);
        }).join('')}</p>`).join('');
      answer = `${sample ? '<p><span class="pill">Synthetic replay · Illustrative timings</span></p>' : ''}
        ${normalized.partial ? '<p class="warning">Partial response. Some retrieval work did not complete.</p>' : ''}
        ${text || '<p class="warning">No text response returned. Inspect the service response.</p>'}
        ${!normalized.references.length ? '<p class="warning">No references returned; grounding is unverified.</p>' : ''}
        <div class="answer-actions"><button class="text-button" data-turn="${turn.id}" data-action="sources">${normalized.references.length} sources</button>
        <button class="text-button" data-turn="${turn.id}" data-action="activity">Activity</button><button class="text-button" data-turn="${turn.id}" data-action="code">Show code</button>
        <span>${sample ? 'Not sent to Azure' : esc(turn.elapsed) + ' ms round trip'}</span></div>
        ${normalized.limitations.length ? `<details class="notes"><summary>Evidence notes (${normalized.limitations.length})</summary>${normalized.limitations.map(note => `<p>${esc(note)}</p>`).join('')}</details>` : ''}`;
    }
    if (turn.error) answer += `<button class="text-button" data-turn="${turn.id}" data-action="code">Show request</button>`;
    if (existing) {
      existing.querySelector('.answer').innerHTML = answer;
      existing.dataset.complete = String(!turn.pending);
    } else $('messages').insertAdjacentHTML('beforeend', `<article class="turn" id="turn-${turn.id}" data-complete="${!turn.pending}" aria-label="Conversation turn ${turn.id}"><div class="user-message"><p>${esc(turn.question)}</p></div>
      <div class="assistant"><span class="assistant-mark" aria-hidden="true">✳</span><div class="answer">${answer}</div></div></article>`);
  });
  $('messages').querySelectorAll('[data-turn]').forEach(button => {
    button.onclick = () => {
      const turn = turns.find(item => item.id === Number(button.dataset.turn));
      if (button.hasAttribute('data-ref')) openEvidence(turn, 'sources', button.dataset.ref);
      else if (button.dataset.action === 'code') openCode(turn.request, 'Retained request');
      else openEvidence(turn, button.dataset.action);
    };
  });
  $('messages').querySelectorAll('.citation-wrap').forEach(wrapper => {
    wrapper.onmouseenter = () => positionPreview(wrapper);
  });
}

function openDialog(id) {
  $(id).showModal();
}

function openCode(snapshot, label, draft = false) {
  retainedCode = draft ? null : { snapshot: structuredClone(snapshot), label };
  $('code-request').innerHTML = `${retainedCode ? `<option value="retained">${esc(label)}</option>` : ''}<option value="draft">Next request (draft)</option>`;
  showCodeSnapshot(snapshot, label);
  openDialog('code');
}

function showCodeSnapshot(snapshot, label) {
  codeSnapshot = structuredClone(snapshot);
  const dispatch = snapshot.sent === true ? 'Sent to Azure' : snapshot.sent === false ? 'Not sent to Azure' : 'Azure dispatch unconfirmed';
  $('code-context').textContent = `${label} · ${dispatch}${snapshot.redacted ? ' · Sensitive values redacted' : ''}. ${snapshot.clientRequestId ? 'Request ' + snapshot.clientRequestId + '. ' : ''}Editing settings does not change this snapshot.`;
  $('copy-status').textContent = '';
  renderCode();
}

function renderCode() {
  $('code-content').textContent = requestCode(codeSnapshot, $('code-format').value);
}

function openEvidence(turn, next, reference = null) {
  inspectedTurn = turn;
  selectedRef = reference;
  setTab(next);
  openDialog('evidence');
  if (reference !== null) {
    const index = turn.result.normalized.references.findIndex(item => item.id === reference);
    const article = $('reference-' + index);
    article?.scrollIntoView({ block: 'nearest' });
    article?.focus({ preventScroll: true });
  }
}

function setTab(next) {
  tab = next;
  document.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === next;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $('inspect').setAttribute('aria-labelledby', 'tab-' + next);
  renderInspector();
}

function renderInspector() {
  const result = inspectedTurn.result;
  if (tab === 'response') {
    $('inspect').innerHTML = `<p class="hint">Sanitized service response · Request ${esc(result.requestId)}. Credential fields and sensitive URL parameters are redacted.</p><pre>${esc(pretty(result.data))}</pre>`;
    return;
  }
  if (tab === 'activity') {
    $('inspect').innerHTML = `<p class="hint">${result.sample ? 'Fixed example; settings do not alter recorded evidence or illustrative timings.' : 'Service-reported activities only. Parallel durations are not added.'}</p>
      ${!result.normalized.activities.length ? '<p class="hint">No activities returned. Enable activity diagnostics for the next request if needed.</p>' : ''}
      <div class="trace">${result.normalized.activities.map(activity => `<div class="step"><b>${esc(activity.type || 'Unreported type')} · ID ${esc(activity.id ?? 'not reported')}</b>
        <small>${Number.isFinite(activity.elapsedMs) ? esc(activity.elapsedMs) + ' ms' : 'Timing not reported'}</small>
        <p class="hint">${esc(activity.knowledgeSourceName || 'Knowledge base')}</p>
        ${activity.error ? `<p class="error">Service activity failed: ${esc(activity.error.code || 'unknown error')}</p>` : ''}
        <details><summary class="hint">Inspect activity</summary><pre>${esc(pretty(activity))}</pre></details></div>`).join('')}</div>
      ${result.sample && scenario.sql ? `<p class="hint">Illustrative SQL, not service diagnostics. Live Fabric is out of scope.</p><pre>${esc(scenario.sql)}</pre>` : ''}`;
    return;
  }
  $('inspect').innerHTML = '<p class="hint">Returned evidence only. Source links may require separate authorization; the demo does not proxy them.</p>' +
    (result.normalized.references.map((reference, index) => {
      const link = safeLink(reference.url);
      return `<article tabindex="-1" id="reference-${index}" class="source-card ${reference.id === selectedRef ? 'selected-ref' : ''}">
        ${badge(reference.kind)} <span class="pill">Reference ${esc(reference.id ?? 'ID missing')}</span><h3>${esc(reference.title)}</h3>
        <p class="muted">${esc(reference.sourceName || 'Source name not reported')} · ${reference.activityLinked ? 'Activity ID ' + esc(reference.activityId) : 'Activity linkage not reported / unresolved'}</p>
        ${reference.location ? `<p>Location: ${esc(reference.location)}</p>` : ''}
        ${reference.kind === 'web' ? '<p class="warning">Cited Web summary, not a guaranteed verbatim passage.</p>' : ''}
        <blockquote>${esc(reference.passage || 'No passage text returned. Inspect the annotation below.')}</blockquote>
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : '<p class="hint">No safe public source link returned.</p>'}
        <details ${reference.id === selectedRef ? 'open' : ''}><summary>Full sanitized annotation</summary><pre>${esc(pretty(reference.annotation))}</pre></details></article>`;
    }).join('') || '<p class="warning">No references returned; grounding is unverified.</p>');
}

async function run() {
  if (busy) return;
  if (scenario.execution === 'sample' && turns.some(turn => turn.result)) return;
  if (!$('question').value.trim()) { $('error').textContent = 'Enter a question.'; $('question').focus(); return; }
  if (!$('runtime').checkValidity() || !$('tokens').checkValidity()) { $('error').textContent = 'Check the runtime and token limits in Runtime settings.'; return; }
  let request;
  let envelope;
  try {
    request = payload();
    envelope = JSON.stringify({ scenarioId: scenario.id, mode: scenario.execution, request });
    if (new TextEncoder().encode(envelope).byteLength > 65536) throw new Error('This conversation exceeds the 64-KiB request limit. Start a new chat; history is never silently truncated.');
  } catch (error) {
    $('error').textContent = error.message;
    return;
  }
  const turn = { id: ++sequence, question: $('question').value.trim(), request: requestSnapshot(scenario.id, request), pending: true };
  turn.request.sent = null;
  turns.push(turn);
  busy = true;
  cancellation = new AbortController();
  $('cancel').hidden = false;
  $('error').textContent = '';
  $('run-status').textContent = 'Retrieval in progress.';
  updateCapabilities();
  renderConversation();
  $('conversation').scrollTop = $('conversation').scrollHeight;
  try {
    const start = performance.now();
    const response = await fetch('/api/retrieve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: envelope, signal: cancellation.signal,
    });
    const body = await response.json();
    if (body.effectiveRequest) turn.request = structuredClone(body.effectiveRequest);
    if (!response.ok) throw new Error(`${body.error || 'Retrieval failed'}${body.serviceError?.message ? ' ' + body.serviceError.message : ''} (request ${body.requestId || response.headers.get('x-request-id') || 'unavailable'}${body.retryAfter ? '; retry after ' + body.retryAfter + 's' : ''})`);
    turn.result = body;
    turn.elapsed = Math.round(performance.now() - start);
    $('question').value = '';
    $('run-status').textContent = body.sample ? 'Synthetic replay complete. No Azure call was made.' : 'Response received.';
  } catch (error) {
    turn.error = cancellation.signal.aborted ? 'Retrieval cancelled. A reserved live call still counts against quotas.' : error.message;
    $('run-status').textContent = 'Retrieval did not complete. No fallback was used.';
  } finally {
    const followBottom = $('conversation').scrollHeight - $('conversation').scrollTop - $('conversation').clientHeight < 100;
    turn.pending = false;
    busy = false;
    $('cancel').hidden = true;
    updateCapabilities();
    renderConversation();
    if (followBottom) $('conversation').scrollTop = $('conversation').scrollHeight;
    if (!$('question').disabled && !document.querySelector('dialog[open]')) $('question').focus();
  }
}

$('knowledge-base').innerHTML = ['live', 'sample'].map(execution => `<optgroup label="${execution === 'live' ? 'Live knowledge bases' : 'Synthetic replays'}">` +
  DATA.filter(item => item.execution === execution).map(item => `<option value="${esc(item.id)}">${esc(item.name)}${execution === 'sample' ? ' · Sample' : ''}</option>`).join('') + '</optgroup>').join('');
$('knowledge-base').onchange = () => selectScenario($('knowledge-base').value);
$('new-chat').onclick = () => { newChat(); $('question').focus(); };
$('reset-settings').onclick = resetSettings;
$('settings-button').onclick = () => openDialog('settings');
$('connect').onclick = () => openDialog('connection');
$('help-button').onclick = () => openDialog('connection');
document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => $(button.dataset.close).close(); });
$('chat-form').onsubmit = event => { event.preventDefault(); void run(); };
$('question').onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void run(); } };
$('cancel').onclick = () => cancellation?.abort();
fields.forEach(id => { $(id).onchange = updateCapabilities; });
$('show-code').onclick = () => {
  try {
    const latest = turns.at(-1);
    openCode(latest?.request || requestSnapshot(scenario.id, payload()), latest ? 'Last request' : 'Draft request', !latest);
  } catch (error) {
    $('error').textContent = error.message;
  }
};
$('code-request').onchange = () => {
  try {
    if ($('code-request').value === 'draft') showCodeSnapshot(requestSnapshot(scenario.id, payload()), 'Draft request');
    else showCodeSnapshot(retainedCode.snapshot, retainedCode.label);
  } catch (error) {
    $('code-request').value = 'retained';
    $('copy-status').textContent = 'Cannot build next request: ' + error.message;
  }
};
$('code-format').onchange = () => { $('copy-status').textContent = ''; renderCode(); };
$('copy-code').onclick = async () => {
  try { await navigator.clipboard.writeText($('code-content').textContent); $('copy-status').textContent = 'Copied.'; }
  catch { $('copy-status').textContent = 'Clipboard unavailable. Select the code and copy it manually.'; $('code-content').focus(); }
};
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
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.querySelectorAll('.citation-wrap').forEach(wrapper => wrapper.classList.add('preview-dismissed'));
});
$('messages').addEventListener('focusin', event => {
  const wrapper = event.target.closest('.citation-wrap');
  if (wrapper) positionPreview(wrapper);
});
$('conversation').addEventListener('scroll', () => {
  document.querySelectorAll('.citation-wrap').forEach(wrapper => wrapper.classList.add('preview-dismissed'));
});
window.addEventListener('resize', () => document.querySelectorAll('.citation-wrap').forEach(wrapper => {
  if (!wrapper.classList.contains('preview-dismissed')) positionPreview(wrapper);
}));
selectScenario(DATA[0].id);
try {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('Server status unavailable.');
  config = await response.json();
  $('connection-status').textContent = `${config.configured ? 'Dependencies configured' : 'Server dependencies missing'} · ${config.liveEnabled ? 'Live switch enabled' : 'Live switch paused'}.`;
  $('contract-status').textContent = config.contractStatus;
  updateCapabilities();
} catch (error) {
  $('connection-status').textContent = error.message;
  $('error').textContent = 'Could not load server status. Live availability is unverified.';
}
