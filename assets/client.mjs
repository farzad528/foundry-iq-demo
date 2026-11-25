import { initHeader, currentLanguage, currentLanguageLabel } from './header.mjs';

const element = id => document.getElementById(id);
let scenarios = [];
let sequence = 0;
let active;
let selectedFile;
let objectUrl;
let configuration;
let activeSuggestion = -1;
let bundledFile = false;
let lastResult;
const recordedSampleMode = () => element('mode').value === 'sample' && !!selectedScenario()?.sample?.recorded;

const node = (tag, text, className) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
};
const selectedScenario = () => scenarios.find(item => item.id === element('scenario').value);
function setStatus(message, quiet = false) {
  element('status').textContent = message;
  element('status').classList.toggle('sr-only', quiet);
}
const safeUrl = value => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith('/samples/') || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
};
const armLabels = {
  substring: 'Simple app search', fulltext: 'Analyzers + synonyms', lexical: 'Lexical relevance',
  vector: 'Vector similarity', hybrid: 'Hybrid retrieval', rerank: 'Semantic reranking',
  retail: 'Filtered retail + merchandising', boost: 'Scoring-profile boost',
  singlePass: 'Single-pass retrieval', planned: 'Single-index agentic retrieval',
  documents: 'Source-document retrieval', graph: 'Custom graph-enhanced retrieval',
  topic: 'Experimental topics + entries', basic: 'Basic text extraction', layout: 'Layout-aware extraction',
  metadata: 'Text-only product metadata', image: 'Image-vector similarity',
};
const label = (value, fallback) => typeof value === 'string' ? armLabels[value] || value : value?.label || fallback;
const errorText = value => typeof value === 'string' ? value : value?.message || value?.code || 'This arm could not complete.';
const queryList = scenario => (scenario?.queries || scenario?.curatedQueries || [scenario?.sampleQuery]).map(item => typeof item === 'string' ? item : item.query).filter(Boolean);
const presetList = () => selectedScenario()?.id === 'S11' && element('mode').value === 'sample' && !selectedScenario()?.sample?.recorded
  ? queryList(selectedScenario()).slice(0, 4).map(query => ({ label: `${query} (fixed blue-hat Sample)`, query }))
  : selectedScenario()?.demoPresets || queryList(selectedScenario()).slice(0, 4).map(query => ({ label: query, query }));

function closeSuggestions() {
  element('query-suggestions').hidden = true;
  element('query').setAttribute('aria-expanded', 'false');
  element('query').removeAttribute('aria-activedescendant');
  activeSuggestion = -1;
}

// Presets shown in the search-bar listbox. Typing filters them; focus or click shows all of the scenario's examples.
let visiblePresets = [];
function showSuggestions(filter = false) {
  const text = filter ? element('query').value.trim().toLocaleLowerCase() : '';
  visiblePresets = presetList().filter(preset => !text || `${preset.label} ${preset.query}`.toLocaleLowerCase().includes(text));
  const list = element('query-suggestions');
  list.setAttribute('aria-label', `Example queries for ${selectedScenario()?.title || 'this scenario'}`);
  list.replaceChildren(...visiblePresets.map((preset, index) => {
    const option = node('div', undefined, 'suggestion');
    option.id = `query-example-${index}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    if (preset.image) {
      const thumb = Object.assign(node('img'), { src: preset.image, alt: '', width: 28, height: 28 });
      option.append(thumb);
    }
    option.append(node('span', preset.label || preset.query));
    option.addEventListener('mousedown', event => event.preventDefault());
    option.addEventListener('click', () => choosePreset(preset));
    return option;
  }));
  activeSuggestion = -1;
  list.hidden = !visiblePresets.length;
  element('query').setAttribute('aria-expanded', String(!list.hidden));
  element('query').removeAttribute('aria-activedescendant');
}
function moveSuggestion(next) {
  const options = [...element('query-suggestions').children];
  if (!options.length) return;
  activeSuggestion = (next + options.length) % options.length;
  options.forEach((option, index) => option.setAttribute('aria-selected', String(index === activeSuggestion)));
  element('query').setAttribute('aria-activedescendant', options[activeSuggestion].id);
  options[activeSuggestion].scrollIntoView({ block: 'nearest' });
}

async function choosePreset(preset) {
  invalidate();
  element('query').value = preset.query;
  // S06 examples each demonstrate one boost; choosing one selects it.
  if (preset.boostSubtype && selectedScenario()?.id === 'S06') element('boost').value = preset.boostSubtype;
  element('query').focus({ preventScroll: true });
  closeSuggestions();
  setStatus('Demo query selected. Click Search to compare.');
  if (!preset.image) return;
  clearFile();
  const epoch = sequence;
  element('search').disabled = true;
  setStatus('Loading bundled synthetic image locally; nothing has been sent to Foundry IQ.');
  try {
    if (!['/samples/zava-hat-blue.png', '/samples/zava-hat-red.png', '/samples/zava-bowl-blue.png'].includes(preset.image)) throw new Error('Unsupported bundled image.');
    const response = await fetch(preset.image);
    if (!response.ok) throw new Error('The bundled image could not be loaded. Choose a local image instead.');
    const bytes = await response.arrayBuffer();
    if (epoch !== sequence) return;
    await selectFile(new File([bytes], preset.image.split('/').pop(), { type: 'image/png' }), epoch, true);
    const name = selectedFile?.name;
    if (epoch === sequence && selectedFile) setStatus(recordedSampleMode()
      ? `Bundled example image ${name} selected. Click Search to replay its recorded result; nothing is sent to Foundry IQ.`
      : element('mode').value !== 'live' ? `Bundled synthetic image ${name} selected. Switch to Live data to search with it.`
        : selectedScenario().liveAvailable ? `Bundled synthetic image ${name} selected. Click Search to send it to Foundry IQ.`
          : `Bundled synthetic image ${name} selected, but Live image search is currently unavailable. Switch to Sample to try the bundled examples.`);
  } catch (error) {
    if (epoch === sequence) showError(error.message);
  } finally {
    if (epoch === sequence) element('search').disabled = false;
  }
}

function clearFile() {
  bundledFile = false;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
  selectedFile = undefined;
  element('file').value = '';
  element('file-preview').removeAttribute('src');
  element('file-preview').hidden = true;
  element('remove-file').hidden = true;
  element('query').required = true;
}

function invalidate() {
  sequence++;
  lastResult = undefined;
  active?.abort();
  active = undefined;
  closeSuggestions();
  element('search').disabled = false;
  element('search').textContent = 'Search';
  element('cancel').hidden = true;
  element('results').hidden = true;
  element('baseline').replaceChildren();
  element('enhanced').replaceChildren();
  element('metrics').replaceChildren();
  element('error').hidden = true;
  element('error').textContent = '';
}

function showError(message) {
  element('error').textContent = message;
  element('error').hidden = false;
}

function modeChanged() {
  invalidate();
  const mode = element('mode').value;
  const scenario = selectedScenario();
  const recorded = scenario?.sample?.recorded;
  // Recorded Sample replays real Live responses, so it uses the Live description.
  element('demo-description').textContent = (mode === 'live' || recorded ? scenario?.liveDescription : scenario?.description) || '';
  element('mode-badge').hidden = true;
  element('mode-badge').textContent = recorded ? `Recorded Sample · ${recorded.recordedAt}` : 'Sample mode';
  element('mode-help').textContent = mode === 'live'
    ? 'Live sends real Foundry IQ queries from the server. Failures are shown as errors; Sample results are never substituted.'
    : recorded ? `Recorded Live responses captured on ${recorded.recordedAt}. Curated questions only; nothing is sent to Foundry IQ now.`
      : 'Curated synthetic examples computed in the app. Nothing is sent to Foundry IQ, and timings are not service measurements.';
  element('weight').disabled = mode === 'live';
  element('weight-field').hidden = scenario?.id !== 'S06' || !!(mode === 'sample' && recorded);
  element('query').required = !(mode === 'live' && selectedScenario()?.id === 'S11' && selectedScenario()?.liveAvailable && selectedFile);
  setStatus(mode === 'live'
    ? (selectedScenario()?.status === 'custom_retrieval_verified' ? 'Ready to search. This example uses custom pre-extracted PDF content.'
      : selectedScenario()?.liveAvailable ? 'Ready to search.' : selectedScenario()?.live?.reason || 'Live data is currently unavailable for this scenario.')
    : 'Curated sample mode ready.', mode === 'live' && selectedScenario()?.liveAvailable);
  element('sample-reference').hidden = selectedScenario()?.id !== 'S11' || mode !== 'sample' || !!selectedScenario()?.sample?.recorded;
  closeSuggestions();
  if (['S10', 'S11'].includes(scenario?.id)) element('upload-help').textContent = uploadHelp(scenario, mode);
}

function uploadHelp(scenario, mode) {
  if (scenario.id === 'S10') return 'Both arms search the same bundled product manual PDF, and citations open the exact page. Uploading new PDFs isn’t supported in this demo.';
  if (mode === 'live' && scenario.liveAvailable) return 'PNG, JPEG or WebP up to 40 KiB, sent once to Foundry IQ, which vectorizes it with Azure Vision. Nothing is stored or indexed. Without an image, your text is matched against the image vectors (text-to-image).';
  if (mode === 'live') return 'Live image search is currently unavailable for this scenario. Switch to Sample to try the bundled example images.';
  if (scenario.sample?.recorded) return 'Sample replays recorded results for the bundled example images and queries. Switch to Live data to search with your own PNG, JPEG or WebP image (up to 40 KiB).';
  return 'Sample uses the bundled blue hat illustration with curated example queries. Switch to Live data, where available, to search with your own PNG, JPEG or WebP image (up to 40 KiB).';
}

function scenarioChanged() {
  invalidate();
  clearFile();
  const scenario = selectedScenario();
  document.querySelector('.surface').dataset.tone = ['S10', 'S11'].includes(scenario.id) ? 'blue' : 'lavender';
  element('demo-title').textContent = scenario.title;
  element('demo-description').textContent = scenario.description || 'Compare retrieval on the same synthetic Zava corpus and query.';
  element('query').value = scenario.sampleQuery || queryList(scenario)[0] || '';
  const sampleOption = element('mode').querySelector('[value=sample]');
  sampleOption.disabled = !scenario.sample?.available;
  if (sampleOption.disabled && element('mode').value === 'sample') element('mode').value = 'live';
  element('boost-field').hidden = scenario.id !== 'S06';
  if (scenario.id === 'S06') element('boost').value = scenario.defaultBoostSubtype || 'availability';
  element('weight-field').hidden = scenario.id !== 'S06';
  element('upload-area').hidden = !['S10', 'S11'].includes(scenario.id);
  element('file').accept = scenario.id === 'S10' ? 'application/pdf' : 'image/jpeg,image/png,image/webp';
  element('file-label').textContent = 'Optional image';
  // S10 always searches the bundled manual; new PDF uploads are not supported, so no picker is offered.
  element('file').closest('.field').hidden = scenario.id === 'S10';
  if (scenario.id === 'S11') element('sample-reference').src = '/samples/zava-hat-blue.svg';
  modeChanged();
}

function sourceLink(hit) {
  let url = safeUrl(hit.url);
  if (url && Number.isInteger(hit.page)) {
    const pageUrl = new URL(url);
    pageUrl.hash = `page=${hit.page}`;
    url = pageUrl.href;
  }
  if (!url) return node('span', 'Source link unavailable', 'source-missing');
  const name = Number.isInteger(hit.page) ? `Open source document, page ${hit.page}` : 'Open source document';
  const link = Object.assign(node('a', undefined, 'source-link'), { href: url, target: '_blank', rel: 'noopener noreferrer', title: `${name} (opens in a new tab)` });
  link.setAttribute('aria-label', `${name} (opens in a new tab)`);
  link.innerHTML = OPEN_ICON;
  return link;
}
const OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

function renderHit(hit, side, index, baselineIds) {
  const card = node('article', undefined, 'card' + (hit.thumbnailUrl ? ' image-card' : '') + (hit.page !== undefined ? ' pdf-card' : ''));
  card.id = `${side}-evidence-${index}`;
  card.tabIndex = -1;
  const head = node('div', undefined, 'card-top');
  const originalRank = baselineIds?.indexOf(hit.id);
  head.append(node('span', `#${hit.rank || index + 1}`, 'rank'), sourceLink(hit));
  card.append(head);
  const image = safeUrl(hit.thumbnailUrl);
  if (image) card.append(Object.assign(node('img'), { src: image, alt: hit.title || 'Synthetic product illustration', loading: 'lazy' }));
  const content = node('div', undefined, 'hit-body');
  // The title opens the result details drawer; its hit area covers the card (links and disclosures stay on top).
  const open = node('button', hit.title || hit.id, 'hit-open');
  open.type = 'button';
  open.setAttribute('aria-haspopup', 'dialog');
  open.addEventListener('click', () => openDrawer(side, index, open));
  const heading = node('h3');
  heading.append(open);
  content.append(heading, node('p', hit.snippet || 'No passage returned.', 'snippet'));
  const meta = node('div', undefined, 'meta');
  meta.append(node('span', hit.sourceId || hit.id || 'No source ID'));
  if (hit.page !== undefined) meta.append(node('span', `Page ${hit.page}`));
  if (hit.coordinates) meta.append(node('span', hit.coordinates.cells
    ? `Row ${hit.row}: native ${hit.coordinates.unit} cell coordinates`
    : `Source coordinates: ${JSON.stringify(hit.coordinates)}`));
  if (hit.score !== undefined) meta.append(node('span', `${hit.scoreType || 'Service score'}: ${Number.isFinite(hit.score) ? hit.score.toFixed(3) : hit.score}`));
  if (side === 'enhanced' && originalRank >= 0 && originalRank !== index) meta.append(node('span', `Rank ${originalRank + 1} → ${index + 1}`));
  content.append(meta);
  if (hit.coordinates?.cells) {
    const coordinates = node('details');
    coordinates.append(node('summary', 'Source cell coordinates'), node('pre', JSON.stringify(hit.coordinates, null, 2)));
    content.append(coordinates);
  }
  card.append(content);
  return card;
}

function renderArm(side, arm, scenario, result) {
  const container = element(side);
  const heading = node('div', undefined, 'arm-heading');
  heading.append(node('div', side === 'baseline' ? 'BEFORE' : 'AFTER', 'arm-label'),
    node('h2', arm?.label || label(scenario[side], side === 'baseline' ? 'Baseline' : 'Enhanced')));
  if (Array.isArray(arm?.apiLog) && arm.apiLog.length) {
    const calls = arm.apiLog.length;
    const button = node('button', undefined, 'apilog-btn');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'dialog');
    button.title = 'Show the exact Foundry IQ requests and responses for this arm';
    // The accessible name starts with the visible text (WCAG 2.5.3) and adds hidden context.
    button.append(node('span', 'API log'), ' ', node('span', String(calls), 'count'),
      node('span', ` Foundry IQ call${calls === 1 ? '' : 's'} for ${side === 'baseline' ? 'BEFORE' : 'AFTER'}`, 'sr-only'));
    button.addEventListener('click', () => openApiLog(side, button));
    heading.append(button);
  }
  container.replaceChildren(heading);
  if (!arm || arm.status === 'error' || arm.status === 'unavailable' || arm.status === 'failed') {
    container.append(node('p', errorText(arm?.error || 'This arm is unavailable.'), 'error'));
    return;
  }
  if (arm.error) container.append(node('p', `Partial result: ${errorText(arm.error)}`, 'error'));
  // "Insufficient evidence." is a refusal, not an answer: without hits the empty state says it; with hits, say so plainly.
  const noAnswer = arm.answer === 'Insufficient evidence.';
  // An "answer" that only concatenates the ranked snippets adds nothing beyond the results themselves.
  const first = arm.hits?.[0];
  // S10's AFTER answer is the extracted table row itself, so it is always shown.
  const extractOnly = scenario.id !== 'S10' && !!first && typeof arm.answer === 'string' && arm.answer.startsWith(`[${first.id}] ${first.snippet}`);
  if (arm.answer && !extractOnly && !(noAnswer && !arm.hits?.length)) {
    const answer = node('article', undefined, 'card');
    answer.append(node('h3', arm.answerKind === 'note' ? 'Why this arm can’t answer' : noAnswer ? 'No grounded answer' : 'Grounded answer'),
      node('p', noAnswer ? 'The retrieved evidence doesn’t answer this question.' : arm.answer, 'snippet answer-text'));
    // Long answers are clamped so the ranked results stay visible; the full text is one click away.
    if (!noAnswer && arm.answer.length > 220) {
      const text = answer.querySelector('.answer-text');
      text.classList.add('clamped');
      const more = node('button', 'Show full answer', 'link-btn');
      more.type = 'button';
      more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', () => {
        const expanded = text.classList.toggle('clamped') === false;
        more.textContent = expanded ? 'Show less' : 'Show full answer';
        more.setAttribute('aria-expanded', String(expanded));
      });
      answer.append(more);
    }
    const citations = node('div', undefined, 'citations');
    (arm.citations || []).forEach((citation, i) => {
      const id = typeof citation === 'string' ? citation : citation.sourceId || citation.id || citation.referenceId;
      const index = arm.hits?.findIndex(hit => hit.sourceId === id || hit.id === id);
      if (index >= 0) {
        const link = node('a', `[${i + 1}] ${id}`);
        link.href = `#${side}-evidence-${index}`;
        link.addEventListener('click', () => element(`${side}-evidence-${index}`).focus());
        citations.append(link);
      } else citations.append(node('span', `Unresolved citation: ${id || i + 1}`));
    });
    // Four citations stay visible; the rest are one click away so rankings remain above the fold.
    if (citations.children.length > 4) {
      const hidden = [...citations.children].slice(4);
      hidden.forEach(item => { item.hidden = true; });
      const more = node('button', `+${hidden.length} more`, 'link-btn');
      more.type = 'button';
      more.setAttribute('aria-expanded', 'false');
      more.setAttribute('aria-label', `Show ${hidden.length} more citations`);
      more.addEventListener('click', () => { hidden.forEach(item => { item.hidden = false; }); more.remove(); });
      citations.append(more);
    }
    if (!noAnswer) answer.append(citations);
    container.append(answer);
  }
  if (arm.graph?.edges) {
    const details = node('details', undefined, 'graph-details');
    const graph = node('div', undefined, 'graph');
    arm.graph.edges.forEach(edge => graph.append(node('span', `${edge.from} → ${edge.to} · ${edge.sourceId || 'source unavailable'}`)));
    details.append(node('summary', `Graph path · ${arm.graph.edges.length} sourced edge${arm.graph.edges.length === 1 ? '' : 's'}`), graph);
    container.append(details);
  }
  if (arm.topics?.length) {
    for (const topic of arm.topics) {
      const card = node('article', undefined, 'card');
      card.append(node('h3', topic.title || topic.id), node('p', topic.summary || '', 'snippet clamped'));
      card.append(node('p', `Experimental · ${topic.id || topic.topicId} · revision ${topic.revision || topic.version} · ${topic.accessScope || 'scope unavailable'} · refreshed ${topic.lastRefreshedAt || topic.updatedAt || 'unavailable'}`, 'meta'));
      card.append(node('p', `Source IDs: ${(topic.sourceDocumentIds || []).join(', ') || 'unavailable'}`, 'meta'));
      container.append(card);
    }
  }
  if (arm.facets) {
    const facets = node('div', undefined, 'metrics');
    Object.entries(arm.facets).forEach(([field, values]) => {
      (Array.isArray(values) ? values : []).forEach(value => facets.append(node('span', `${field}: ${value.value} (${value.count})`, 'metric')));
    });
    container.append(facets);
  }
  const hits = node('div', undefined, arm.kind === 'gallery' || arm.hits?.some(hit => hit.thumbnailUrl) ? 'gallery' : '');
  const baselineIds = result.baseline?.hits?.map(hit => hit.id);
  (arm.hits || []).forEach((hit, index) => hits.append(renderHit(hit, side, index, baselineIds)));
  if (!arm.hits?.length) hits.append(node('p', 'No matching results for this query in this arm.', 'empty'));
  container.append(hits);
  const trace = node('details', undefined, 'trace');
  trace.append(node('summary', 'Technical details'), node('pre', JSON.stringify({ executionMode: result.mode, status: arm.status, trace: arm.trace, usage: arm.usage, sharedComparison: result.comparison }, null, 2)));
  container.append(trace);
}

function renderResults(result, scenario) {
  lastResult = result;
  const sampleLabel = result.recorded ? `Recorded Sample (captured ${result.recorded.recordedAt})` : 'Deterministic Sample mode';
  element('results-title').replaceChildren(node('span', `Results for “${result.query}”`), ' ',
    node('span', `${result.mode === 'sample' ? `${sampleLabel} · ` : ''}up to ${element('count').value} per arm`, 'results-meta'));
  const note = element('why-note');
  note.hidden = !result.note?.text;
  if (result.note?.text) note.replaceChildren(node('strong', 'Why AFTER wins'), node('span', result.note.text), node('span', result.note.source, 'note-source'));
  renderArm('baseline', result.baseline, scenario, result);
  renderArm('enhanced', result.enhanced, scenario, result);
  element('metrics').replaceChildren();
  for (const side of ['baseline', 'enhanced']) {
    const evaluation = result.comparison?.evaluation?.[side];
    if (!evaluation) continue;
    const metric = node('div', undefined, 'metric');
    metric.append(node('strong', side === 'baseline' ? 'BEFORE' : 'AFTER'));
    metric.append(node('span', ` · Recall@K ${evaluation.recallAtK.toFixed(2)} · nDCG@K ${evaluation.ndcgAtK.toFixed(2)} · MRR ${evaluation.mrr.toFixed(2)}`));
    if (evaluation.exactTableValue !== undefined) metric.append(node('span', ` · Exact table value: ${evaluation.exactTableValue ? 'matches gold' : 'does not match gold'}`));
    element('metrics').append(metric);
  }
  if (result.groundTruth) {
    const details = node('details', undefined, 'trace');
    details.append(node('summary', 'Applicable curated gold-label evaluation'), node('pre', JSON.stringify(result.groundTruth, null, 2)));
    element('metrics').append(details);
  }
  element('results').hidden = false;
  setStatus(result.executionStatus === 'partial_success' ? 'Partial success. One arm failed; the other is shown.'
    : result.executionStatus === 'error' ? 'Both comparison arms failed.' : 'Comparison complete.', result.executionStatus === 'success');
}

// Tolerates non-JSON platform responses and the Vercel Firewall's 429 body ({ error: { code, message } }).
async function readResult(response) {
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (response.ok) return data;
  if (response.status === 429) {
    const seconds = Number.parseInt(response.headers.get('retry-after') || data.retryAfter, 10);
    throw new Error(`Too many requests from this network in the last minute. Wait ${Number.isInteger(seconds) && seconds > 0 && seconds <= 600 ? `${seconds} seconds` : 'about a minute'}, then Search again.`);
  }
  throw new Error(typeof data.error === 'string' ? data.error : 'The request failed. Try again shortly.');
}

async function run(event) {
  event?.preventDefault();
  const scenario = selectedScenario();
  const imageCompatible = scenario.id === 'S11' && element('mode').value === 'live' && scenario.liveAvailable;
  const recordedSample = recordedSampleMode();
  const query = element('query').value.trim() || ((imageCompatible || recordedSample) && selectedFile
    ? scenario.imageOnlyQuery : '');
  if (!query) {
    showError('Enter a query.');
    return;
  }
  const keepBundled = bundledFile;
  invalidate();
  const id = sequence;
  if (selectedFile && !imageCompatible && !(recordedSample && keepBundled)) {
    showError(recordedSample ? 'Recorded Sample replays the bundled example images only. Switch to Live data to search with your own image.'
      : scenario.id !== 'S11' ? 'Uploading new PDFs isn’t supported in this demo. Remove the file to search the bundled manual.'
        : element('mode').value === 'live' ? 'Live image search is currently unavailable for this scenario. Remove the image, or switch to Sample to try the bundled examples.'
          : 'Searching with your own image needs Live data. Remove the image, or switch to Live data.');
    return;
  }
  if (imageCompatible && selectedFile && selectedFile.size > 40960) {
    showError('Live image search accepts PNG, JPEG or WebP images up to 40 KiB.');
    return;
  }
  const controller = new AbortController();
  active = controller;
  element('search').disabled = true;
  element('search').textContent = 'Searching…';
  element('cancel').hidden = false;
  setStatus('Running both comparison arms…');
  try {
    const body = { scenarioId: scenario.id, query, topK: Number(element('count').value), mode: element('mode').value,
      language: currentLanguage() };
    if (selectedFile && imageCompatible) {
      const bytes = new Uint8Array(await selectedFile.arrayBuffer());
      if (id !== sequence) return;
      body.imageInput = { mimeType: selectedFile.type, base64: btoa(String.fromCharCode(...bytes)) };
    }
    if (scenario.id === 'S06') {
      body.options = { boostSubtype: element('boost').value };
      if (body.mode === 'sample' && !recordedSample) body.options.weight = Number(element('weight').value);
    }
    if (body.mode === 'live') {
      const deadline = Date.now() + 180000;
      for (;;) {
        setStatus('Checking live configuration and request limits…');
        const prepared = await fetch('/api/demo/prepare', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
        });
        const plan = await readResult(prepared);
        if (id !== sequence) return;
        if (plan.ready === true) break;
        if (!Number.isInteger(plan.retryAfter) || plan.retryAfter < 1 || plan.retryAfter > 61 || Date.now() + plan.retryAfter * 1000 > deadline) {
          throw new Error('The live allowance is still busy. Wait a minute, then Search again.');
        }
        element('search').textContent = 'Waiting…';
        for (let seconds = plan.retryAfter + 1; seconds > 0; seconds--) {
          setStatus(`Live allowance resets in ${seconds}s. Your comparison will start automatically; Cancel to stop.`);
          await new Promise((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(controller.signal.reason); };
            const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, 1000);
            controller.signal.addEventListener('abort', abort, { once: true });
            if (controller.signal.aborted) abort();
          });
        }
      }
      element('search').textContent = 'Searching…';
      setStatus('Running both comparison arms…');
    }
    const slow = setTimeout(() => { if (id === sequence) setStatus('Still working… the first Live query after a quiet period can take up to 30 seconds while the service warms up.'); }, 6000);
    let response;
    try {
      response = await fetch('/api/demo/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
      });
    } finally { clearTimeout(slow); }
    const result = await readResult(response);
    if (id !== sequence) return;
    renderResults(result, scenario);
  } catch (error) {
    if (id !== sequence) return;
    if (controller.signal.aborted) setStatus('Comparison cancelled.');
    else {
      showError(error.message);
      setStatus('Comparison could not complete. No fallback results.');
    }
  } finally {
    if (id === sequence) {
      active = undefined;
      element('search').disabled = false;
      element('search').textContent = 'Search';
      element('cancel').hidden = true;
    }
  }
}

element('search-form').addEventListener('submit', run);
element('scenario').addEventListener('change', scenarioChanged);
const scenarioSelector = element('scenario').closest('.selector');
element('scenario').addEventListener('pointerdown', () => { scenarioSelector.dataset.pointerFocus = 'true'; });
document.addEventListener('keydown', () => { delete scenarioSelector.dataset.pointerFocus; }, { capture: true });
element('mode').addEventListener('change', modeChanged);
element('count').addEventListener('change', () => { invalidate(); setStatus('Result count changed. Search again to apply.'); });
element('boost').addEventListener('change', () => { invalidate(); setStatus('Boost changed. Search again to apply.'); });
element('weight').addEventListener('change', () => { invalidate(); setStatus('Weight changed. Search again to apply.'); });
element('query').addEventListener('focus', () => showSuggestions());
element('query').addEventListener('click', () => { if (element('query-suggestions').hidden) showSuggestions(); });
element('query').addEventListener('input', () => { invalidate(); showSuggestions(true); setStatus('Query changed. Search to compare.'); });
element('query').addEventListener('keydown', event => {
  const list = element('query-suggestions');
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (list.hidden) showSuggestions();
    moveSuggestion(event.key === 'ArrowDown' ? activeSuggestion + 1 : activeSuggestion < 0 ? -1 : activeSuggestion - 1);
  } else if ((event.key === 'Home' || event.key === 'End') && !list.hidden && activeSuggestion >= 0) {
    event.preventDefault();
    moveSuggestion(event.key === 'Home' ? 0 : list.children.length - 1);
  } else if (event.key === 'Enter' && !list.hidden && activeSuggestion >= 0) {
    event.preventDefault();
    void choosePreset(visiblePresets[activeSuggestion]);
  } else if (event.key === 'Escape') {
    // Never the native search-field clear: Escape only closes the list.
    event.preventDefault();
    closeSuggestions();
  } else if (['Tab', 'Enter'].includes(event.key)) closeSuggestions();
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.query')) closeSuggestions();
});
element('query').parentElement.addEventListener('focusout', event => {
  if (!event.currentTarget.contains(event.relatedTarget)) closeSuggestions();
});
element('cancel').addEventListener('click', () => { invalidate(); setStatus('Comparison cancelled.'); });
element('reset').addEventListener('click', () => {
  invalidate();
  clearFile();
  element('query').value = '';
  element('settings').hidden = true;
  element('settings-toggle').setAttribute('aria-expanded', 'false');
  setStatus('Search reset. Scenario and result count retained.');
  element('query').focus();
  closeSuggestions();
});
element('settings-toggle').addEventListener('click', () => {
  element('settings').hidden = !element('settings').hidden;
  element('settings-toggle').setAttribute('aria-expanded', String(!element('settings').hidden));
});
element('remove-file').addEventListener('click', () => { invalidate(); clearFile(); setStatus('Reference file removed.'); });
async function selectFile(file, epoch, bundled = false) {
  const scenarioId = selectedScenario().id;
  if (!file) return clearFile();
  clearFile();
  const limit = 5 * 1024 * 1024;
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (epoch !== sequence) return;
  const pdf = bytes.length >= 5 && bytes.slice(0, 5).every((byte, i) => byte === [37, 80, 68, 70, 45][i]);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.length >= 8 && bytes.slice(0, 8).every((byte, i) => byte === [137, 80, 78, 71, 13, 10, 26, 10][i]);
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  const valid = scenarioId === 'S10' ? file.type === 'application/pdf' && pdf
    : (file.type === 'image/jpeg' && jpeg) || (file.type === 'image/png' && png) || (file.type === 'image/webp' && webp);
  if (file.size > limit || !valid) {
    showError('Invalid file signature or type, or the file is larger than 5 MiB. Nothing was sent.');
    return;
  }
  selectedFile = file;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  element('file').files = transfer.files;
  const recordedBundled = bundled && recordedSampleMode();
  const compatible = (scenarioId === 'S11' && element('mode').value === 'live' && selectedScenario().liveAvailable && file.size <= 40960) || recordedBundled;
  bundledFile = bundled;
  element('query').required = !compatible;
  element('remove-file').hidden = false;
  if (!pdf) {
    objectUrl = URL.createObjectURL(file);
    element('file-preview').src = objectUrl;
    element('file-preview').hidden = false;
  }
  if (recordedBundled) setStatus(`Bundled example ${file.name} selected. Recorded Sample replays its recorded Live result; nothing is sent to Foundry IQ.`);
  else if (compatible) setStatus(`${file.name} (${Math.ceil(file.size / 1024)} KiB) ready as an ephemeral query reference; not uploaded or indexed.`);
  else showError(scenarioId === 'S10' ? `Uploading new PDFs isn’t supported in this demo, so ${file.name} won’t be searched. Remove it to search the bundled manual.`
    : file.size > 40960 ? `${file.name} is ${Math.ceil(file.size / 1024)} KiB. Live image search accepts images up to 40 KiB. Nothing was sent.`
      : element('mode').value === 'live' ? `Live image search is currently unavailable, so ${file.name} won’t be searched. Nothing was sent.`
        : `Switch to Live data to search with ${file.name}. Sample replays only the bundled example images. Nothing was sent.`);
}

element('file').addEventListener('change', async () => {
  const file = element('file').files[0];
  invalidate();
  const epoch = sequence;
  try {
    await selectFile(file, epoch);
  } catch (error) {
    if (epoch === sequence) showError(`Reference file could not be read: ${error.message}`);
  }
});

async function loadScenarios(changed = false) {
  invalidate();
  clearFile();
  const epoch = sequence;
  const previous = element('scenario').value;
  const language = currentLanguage();
  element('search').disabled = true;
  const controller = new AbortController();
  active = controller;
  try {
    const response = await fetch(`/api/scenarios${language === 'en' ? '' : `?language=${language}`}`, { signal: controller.signal });
    if (!response.ok) throw new Error('Scenario catalog could not be loaded.');
    const next = await response.json();
    if (epoch !== sequence) return;
    configuration = next;
    scenarios = Array.isArray(configuration) ? configuration : configuration.scenarios;
    if (!Array.isArray(scenarios) || scenarios.length !== 11) throw new Error('The S01–S11 catalog is unavailable.');
    element('scenario').replaceChildren(...scenarios.map(item => Object.assign(node('option', item.title), { value: item.id })));
    if (scenarios.some(item => item.id === previous)) element('scenario').value = previous;
    if (language !== 'en' || configuration.defaultMode === 'live' && !changed) element('mode').value = 'live';
    active = undefined;
    scenarioChanged();
    if (changed) setStatus(`Document language changed to ${currentLanguageLabel()}. Search to compare; nothing has run.`);
  } catch (error) {
    if (epoch !== sequence || controller.signal.aborted) return;
    element('search').disabled = true;
    showError(error.message);
  }
}
// Shared header (Share, menu, settings); language changes reload the localized catalog.
const header = initHeader({ onLanguageChange: () => { void loadScenarios(true); } });
document.addEventListener('keydown', event => {
  const target = event.target;
  const typing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    header.closeAll();
    element('query').focus();
    element('query').select();
  }
});

// ---------- Result details drawer and API log (native modal dialogs) ----------
const armName = side => side === 'baseline' ? 'BEFORE' : 'AFTER';
const pretty = value => JSON.stringify(value, null, 2) ?? '';
const FOCUSABLE = 'button:not([disabled]), [href], summary, [tabindex]:not([tabindex="-1"])';
function setupDialog(dialog) {
  dialog.addEventListener('close', () => {
    const opener = dialog.returnFocus;
    dialog.returnFocus = undefined;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  // Clicks on the backdrop (outside the sheet) close it.
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  // Explicit focus trap: Tab and Shift+Tab cycle inside the dialog.
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll(FOCUSABLE)].filter(item => item.getClientRects().length && !item.closest('[hidden]'));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  });
}
function showDialog(dialog, opener, focusTarget) {
  dialog.returnFocus = opener;
  if (!dialog.open) dialog.showModal();
  (focusTarget || dialog.querySelector('.sheet-head .icon-btn')).focus({ preventScroll: true });
}
function copyButton(label, text, status) {
  const button = node('button', label, 'copy-btn');
  button.type = 'button';
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text()); status.textContent = `${label}: copied to the clipboard.`; button.textContent = 'Copied'; }
    catch { status.textContent = 'Copy failed. Select the text and copy it manually.'; }
    setTimeout(() => { button.textContent = label; }, 1800);
  });
  return button;
}
function codeBlock(text, name) {
  const pre = node('pre', text, 'code');
  pre.tabIndex = 0;
  pre.setAttribute('aria-label', name);
  return pre;
}
function definition(list, term, value) {
  if (value === undefined || value === null || value === '') return;
  list.append(node('dt', term));
  const detail = node('dd');
  if (value instanceof Node) detail.append(value); else detail.textContent = String(value);
  list.append(detail);
}
function section(title, ...children) {
  const box = node('section', undefined, 'sheet-section');
  box.append(node('h3', title), ...children.filter(Boolean));
  return box;
}
const sameDocument = (a, b) => a.id === b.id || (a.sourceId && a.sourceId === b.sourceId && a.id === b.id);
function vectorUse(arm) {
  const queries = (arm.apiLog || []).flatMap(entry => entry.request?.body?.vectorQueries || []);
  const configuration = arm.trace?.configuration || {};
  return queries.map(query => ({ field: query.fields, kind: query.kind,
    dimensions: query.fields === (configuration.imageEncoder?.field || 'imageVector') ? configuration.imageEncoder?.dimensions : configuration.embedding?.dimensions }));
}
function openDrawer(side, index, opener) {
  const result = lastResult;
  const arm = result?.[side];
  const hit = arm?.hits?.[index];
  if (!hit) return;
  const otherSide = side === 'baseline' ? 'enhanced' : 'baseline';
  const otherIndex = (result[otherSide]?.hits || []).findIndex(other => sameDocument(other, hit));
  const configuration = arm.trace?.configuration || {};
  const document_ = hit.document || {};
  element('drawer-eyebrow').textContent = `${armName(side)} · #${hit.rank || index + 1} · ${arm.label || label(selectedScenario()?.[side], armName(side))}`;
  element('drawer-title').textContent = hit.title || hit.id;
  const status = node('p', undefined, 'sr-only');
  status.setAttribute('role', 'status');

  const overview = node('dl', undefined, 'facts');
  definition(overview, 'Document key', hit.id);
  if (hit.sourceId && hit.sourceId !== hit.id) definition(overview, 'Parent document', hit.sourceId);
  definition(overview, 'Index', configuration.index);
  definition(overview, 'Language', hit.language || document_.language || configuration.language || 'en');
  if (Number.isInteger(hit.page)) definition(overview, 'PDF location', `Page ${hit.page}${Number.isInteger(hit.row) ? `, table row ${hit.row}` : ''}`);
  const source = safeUrl(hit.url);
  if (source) {
    const link = Object.assign(node('a', new URL(source).pathname), { href: source, target: '_blank', rel: 'noopener noreferrer' });
    definition(overview, 'Source', link);
  }
  definition(overview, 'License', document_.license || 'Synthetic demo content (MIT License, this repository)');
  definition(overview, 'Published or updated', document_.publishedAt || document_.updatedAt || document_.lastRefreshedAt || 'Not recorded in the index');

  const ranking = node('dl', undefined, 'facts');
  const before = side === 'baseline' ? index : otherIndex;
  const after = side === 'enhanced' ? index : otherIndex;
  definition(ranking, 'BEFORE rank', before >= 0 ? `#${before + 1}` : `Not in BEFORE's top ${result.baseline?.hits?.length || 0}`);
  definition(ranking, 'AFTER rank', after >= 0 ? `#${after + 1}` : `Not in AFTER's top ${result.enhanced?.hits?.length || 0}`);
  definition(ranking, 'Change', before >= 0 && after >= 0
    ? before === after ? 'Same position in both arms' : `${before > after ? 'Up' : 'Down'} ${Math.abs(before - after)} in AFTER`
    : after >= 0 ? 'Found only by AFTER' : 'Found only by BEFORE');
  const scores = node('dl', undefined, 'facts');
  definition(scores, '@search.score', hit.search?.score ?? hit.score);
  definition(scores, '@search.rerankerScore', hit.search?.rerankerScore);
  if (hit.scoreType) definition(scores, 'Score type', hit.scoreType);
  if (hit.search?.captions) definition(scores, 'Captions', codeBlock(pretty(hit.search.captions), 'Semantic captions'));
  if (hit.search?.highlights) definition(scores, 'Highlights', codeBlock(pretty(hit.search.highlights), 'Highlights'));
  if (!scores.children.length) definition(scores, 'Scores', 'This arm does not expose comparable scores for this result.');

  const retrieval = node('dl', undefined, 'facts');
  definition(retrieval, 'Retrieval', label(configuration.mechanism || selectedScenario()?.[side], configuration.mechanism));
  definition(retrieval, 'Search API version', configuration.searchApiVersion);
  if (configuration.scoringProfile) definition(retrieval, 'Scoring profile', `${configuration.scoringProfile}${configuration.scoringParameters?.length ? ` (${configuration.scoringParameters.join(', ')})` : ''}`);
  if (configuration.synonymMaps?.length) definition(retrieval, 'Synonym expansion', `Synonym map ${configuration.synonymMaps.join(', ')} applied to keyword matching on title and content`);
  if (configuration.semanticConfiguration) definition(retrieval, 'Semantic configuration', configuration.semanticConfiguration);
  for (const use of vectorUse(arm)) definition(retrieval, 'Vector field', `${use.field}${use.dimensions ? ` · ${use.dimensions} dimensions` : ''} · ${use.kind} query (vector values are never shown)`);
  if (configuration.agenticSearch) definition(retrieval, 'Agentic retrieval', `${configuration.agenticSearch.subQueryCount} sub-queries · ${configuration.agenticSearch.terminationReason}`);

  const related = [];
  const edges = (arm.graph?.edges || []).filter(edge => edge.sourceId === hit.sourceId || edge.sourceId === hit.id);
  if (edges.length) related.push(section('Graph path', node('p', edges.map(edge => `${edge.from} —${edge.relation || 'links to'}→ ${edge.to}`).join('\n'), 'path')));
  const topics = (arm.topics || []).filter(topic => (topic.sourceDocumentIds || []).includes(hit.sourceId) || (topic.sourceDocumentIds || []).includes(hit.id));
  if (topics.length) related.push(section('Topic', ...topics.map(topic => node('p', `${topic.title || topic.id} · revision ${topic.revision ?? '?'} (experimental)`))));
  if (hit.coordinates?.cells) related.push(section('Table cell coordinates', codeBlock(pretty(hit.coordinates), 'Table cell coordinates')));

  const fieldsList = node('dl', undefined, 'facts fields');
  const allFields = { ...document_, content: hit.snippet };
  for (const [name, value] of Object.entries(allFields)) definition(fieldsList, name, typeof value === 'string' ? value : JSON.stringify(value));
  const raw = { ...(hit.search?.score !== undefined ? { '@search.score': hit.search.score } : {}),
    ...(hit.search?.rerankerScore !== undefined ? { '@search.rerankerScore': hit.search.rerankerScore } : {}),
    ...(hit.search?.captions ? { '@search.captions': hit.search.captions } : {}), ...(hit.search?.highlights ? { '@search.highlights': hit.search.highlights } : {}),
    ...(Object.keys(document_).length ? allFields : hit) };
  const rawSection = section('Raw hit JSON', copyButton('Copy JSON', () => pretty(raw), status), codeBlock(pretty(raw), 'Raw hit JSON'));
  element('drawer-body').replaceChildren(status, section('Document', overview), section('Ranking', ranking), section('Scores', scores),
    section('Retrieval', retrieval), ...related, section('Retrievable fields', fieldsList), rawSection);
  element('drawer-body').scrollTop = 0;
  showDialog(element('drawer'), opener);
}
function openApiLog(side, opener) {
  const result = lastResult;
  const log = result?.[side]?.apiLog || [];
  if (!log.length) return;
  element('apilog-eyebrow').textContent = `${armName(side)} · ${result[side].label || label(selectedScenario()?.[side], armName(side))}`;
  element('apilog-title').textContent = `API log · ${log.length} Foundry IQ call${log.length === 1 ? '' : 's'}`;
  element('apilog-note').textContent = result.recorded
    ? `Recorded Sample: these calls were captured from Live on ${result.recorded.recordedAt} and replayed without sending a request. Request IDs were removed.`
    : 'Live calls made by this server for this arm. The service host is a placeholder and the query key is never sent to your browser.';
  const tabs = element('apilog-tabs');
  const panels = element('apilog-panels');
  const status = node('p', undefined, 'sr-only');
  status.setAttribute('role', 'status');
  const select = (index, focus = false) => {
    [...tabs.children].forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
    [...panels.children].forEach((panel, i) => { if (panel.getAttribute('role') === 'tabpanel') panel.hidden = Number(panel.dataset.index) !== index; });
    if (focus) tabs.children[index].focus();
  };
  tabs.replaceChildren(...log.map((entry, index) => {
    const path = (() => { try { return new URL(entry.url.replace('<your-search-service>', 'service')).pathname.split('/').slice(-2).join('/'); } catch { return 'call'; } })();
    const tab = node('button', `${index + 1} · ${path}${entry.shared ? ' · shared' : ''}`, 'tab');
    tab.type = 'button';
    tab.id = `apilog-tab-${index}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `apilog-panel-${index}`);
    tab.addEventListener('click', () => select(index));
    return tab;
  }));
  tabs.onkeydown = event => {
    const current = [...tabs.children].findIndex(tab => tab.getAttribute('aria-selected') === 'true');
    const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: log.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select((next + log.length) % log.length, true);
  };
  panels.replaceChildren(status, ...log.map((entry, index) => {
    const panel = node('div', undefined, 'apilog-panel');
    panel.id = `apilog-panel-${index}`;
    panel.dataset.index = String(index);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `apilog-tab-${index}`);
    const request = node('section', undefined, 'apilog-side');
    const endpoint = node('p', undefined, 'endpoint');
    endpoint.append(node('span', entry.method, 'method'), node('code', entry.url));
    const requestText = `${entry.method} ${entry.url}\n\n${pretty(entry.request?.body)}`;
    request.append(node('h3', 'Request'), endpoint,
      codeBlock(Object.entries(entry.request?.headers || {}).map(([name, value]) => `${name}: ${value}`).join('\n'), `Request ${index + 1} headers`),
      node('div', undefined, 'code-head'), codeBlock(pretty(entry.request?.body), `Request ${index + 1} body`));
    request.querySelector('.code-head').append(node('span', 'Body'), copyButton('Copy request', () => requestText, status));
    const response = node('section', undefined, 'apilog-side');
    const summary = node('p', undefined, 'endpoint');
    const ok = entry.response?.status >= 200 && entry.response?.status < 300;
    summary.append(node('span', entry.response?.status ? `HTTP ${entry.response.status}` : 'No response', `status ${ok ? 'ok' : 'bad'}`),
      node('span', Number.isFinite(entry.response?.latencyMs) ? `${entry.response.latencyMs} ms measured` : '', 'latency'));
    if (entry.response?.error) summary.append(node('span', entry.response.error, 'latency'));
    const headerText = Object.entries(entry.response?.headers || {}).map(([name, value]) => `${name}: ${value}`).join('\n');
    const headerHead = node('div', undefined, 'code-head');
    headerHead.append(node('span', 'Headers'), copyButton('Copy headers', () => headerText, status));
    const bodyHead = node('div', undefined, 'code-head');
    bodyHead.append(node('span', 'Body'), copyButton('Copy body', () => pretty(entry.response?.body), status));
    response.append(node('h3', 'Response'), summary, headerHead, codeBlock(headerText || '(none)', `Response ${index + 1} headers`),
      bodyHead, codeBlock(entry.response?.body === undefined ? '(no body)' : pretty(entry.response.body), `Response ${index + 1} body`));
    panel.append(request, response);
    return panel;
  }));
  select(0);
  showDialog(element('apilog'), opener, tabs.children[0]);
}
setupDialog(element('drawer'));
setupDialog(element('apilog'));
element('drawer-close').addEventListener('click', () => element('drawer').close());
element('apilog-close').addEventListener('click', () => element('apilog').close());
await loadScenarios();
