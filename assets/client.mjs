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
  metadata: 'Text-only product metadata', image: 'Compatible image-vector retrieval',
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

function showSuggestions() {
  const presets = presetList();
  const list = element('query-suggestions');
  list.replaceChildren(...presets.map((preset, index) => {
    const option = node('button', preset.label, 'suggestion');
    option.type = 'button';
    option.id = `query-example-${index}`;
    option.role = 'option';
    option.tabIndex = -1;
    option.setAttribute('aria-selected', 'false');
    option.addEventListener('mousedown', event => event.preventDefault());
    option.addEventListener('click', () => choosePreset(preset));
    return option;
  }));
  activeSuggestion = -1;
  list.hidden = !presets.length;
  element('query').setAttribute('aria-expanded', String(!!presets.length));
  element('query').removeAttribute('aria-activedescendant');
}

async function choosePreset(preset, fromSelect = false) {
  invalidate();
  element('query').value = preset.query;
  if (!fromSelect) {
    element('query').focus({ preventScroll: true });
    const index = presetList().findIndex(item => item.label === preset.label);
    element('preset').value = index >= 0 ? String(index) : '';
  }
  closeSuggestions();
  setStatus('Demo query selected. Click Search to compare.');
  if (!preset.image) return;
  clearFile();
  const epoch = sequence;
  element('search').disabled = true;
  setStatus('Loading bundled synthetic image locally; no Azure request has been sent.');
  try {
    if (!['/samples/zava-hat-blue.png', '/samples/zava-hat-red.png', '/samples/zava-bowl-blue.png'].includes(preset.image)) throw new Error('Unsupported bundled image.');
    const response = await fetch(preset.image);
    if (!response.ok) throw new Error('The bundled image could not be loaded. Choose a local image instead.');
    const bytes = await response.arrayBuffer();
    if (epoch !== sequence) return;
    await selectFile(new File([bytes], preset.image.split('/').pop(), { type: 'image/png' }), epoch, true);
    if (epoch === sequence && selectedFile) setStatus(selectedScenario().liveAvailable
      ? `Bundled synthetic image ${selectedFile.name} selected. Click Search to send it to the live encoder.`
      : 'Bundled reference selected; live image similarity is unavailable until a compatible encoder is configured.');
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
  const liveDescriptions = {
    S01: 'Compare simple app search with full-text analysis and synonyms.',
    S02: 'Compare keyword matching with text-vector similarity, including exact-identifier counterexamples.',
    S03: 'Compare keyword and hybrid retrieval with identical hard filters.',
    S04: 'Compare the same hybrid candidates before and after semantic reranking: rank movement, not unlike-score differences.',
    S05: 'Find eligible products with inventory, location and price filters, plus facets.',
    S06: 'Compare isolated freshness, price, distance, tag and availability boosts.',
    S07: 'Compare single-pass hybrid retrieval with native single-index agentic retrieval on the same support index. Evidence and citations only; no generated answers.',
    S08: 'Trace sourced component and lot relationships with a custom BOM graph, not a native graph feature.',
    S09: 'Explore versioned topics and their source evidence. EXPERIMENTAL, not a native topic feature.',
    S10: selectedScenario()?.extractionProvider === 'azureContentUnderstanding'
      ? 'Compare Read and Layout processing of the same PDF, with page and table-row citations. Extraction ran at ingestion.'
      : 'Compare custom pre-extracted PDF pages and table rows. Native Content Understanding has not been verified.',
    S11: 'Compare keyword matching with Azure Vision image similarity: use an image, or describe the item in text. Not captions.',
  };
  const scenario = selectedScenario();
  const recorded = scenario?.sample?.recorded;
  // Recorded Sample replays real Live responses, so it uses the Live description.
  element('demo-description').textContent = mode === 'live' || recorded ? liveDescriptions[scenario?.id] || scenario?.liveDescription
    : scenario?.description || scenario?.difference || '';
  element('mode-badge').hidden = true;
  element('mode-badge').textContent = recorded ? `Recorded Sample · ${recorded.recordedAt}` : 'Sample mode';
  element('mode-chip').dataset.mode = mode;
  element('mode-chip').textContent = mode === 'live' ? 'Live data' : 'Sample';
  element('mode-help').textContent = mode === 'live'
    ? 'Live sends real Azure AI Search queries from the server. Failures are shown as errors; Sample results are never substituted.'
    : recorded ? `Recorded Live responses captured on ${recorded.recordedAt}. Curated questions only; no Azure request is sent now.`
      : 'Deterministic, curated synthetic fixtures. No Azure latency, usage or cost claims.';
  element('weight').disabled = mode === 'live';
  element('weight-field').hidden = scenario?.id !== 'S06' || !!(mode === 'sample' && recorded);
  element('query').required = !(mode === 'live' && selectedScenario()?.id === 'S11' && selectedScenario()?.liveAvailable && selectedFile);
  setStatus(mode === 'live'
    ? (selectedScenario()?.status === 'custom_retrieval_verified' ? 'Custom pre-extracted index retrieval verified; native Azure Content Understanding remains blocked.'
      : selectedScenario()?.status === 'live_verified' ? 'Ready to search.'
      : selectedScenario()?.liveAvailable ? 'Live configuration available; not a service-readiness guarantee.' : selectedScenario()?.live?.reason || 'Live unavailable until this scenario’s prerequisites are verified.')
    : 'Curated sample mode ready.', mode === 'live' && selectedScenario()?.liveAvailable);
  element('sample-reference').hidden = selectedScenario()?.id !== 'S11' || mode !== 'sample' || !!selectedScenario()?.sample?.recorded;
  populatePresets();
  if (selectedScenario()?.id === 'S10' && mode === 'live') element('upload-help').textContent = 'Search the bundled original PDF. New document uploads need an approved durable extraction workflow.';
  if (selectedScenario()?.id === 'S11') {
    element('upload-help').textContent = mode === 'sample' && recorded
      ? 'Recorded Sample replays the Live result captured for each bundled example image. Switch to Live data to search with your own JPEG, PNG or WebP image (up to 40 KiB).'
      : mode === 'live' && selectedScenario()?.liveAvailable
      ? 'JPEG/PNG/WebP up to 40 KiB, sent once to Azure AI Search, which vectorizes it with Azure Vision. Nothing is stored or indexed. Without an image, your text is matched against the image vectors (text-to-image).'
      : 'Sample uses a fixed original illustration, not arbitrary image understanding. Live query-image similarity requires a compatible corpus/query encoder; unconfigured uploads are explicitly unsupported.';
  }
}

function scenarioChanged() {
  invalidate();
  clearFile();
  const scenario = selectedScenario();
  document.querySelector('.surface').dataset.tone = ['S10', 'S11'].includes(scenario.id) ? 'blue' : 'lavender';
  element('demo-title').textContent = scenario.title;
  element('demo-description').textContent = scenario.description || scenario.explanation || scenario.difference || 'Compare retrieval on the same synthetic Zava corpus and query.';
  element('query').value = scenario.sampleQuery || queryList(scenario)[0] || '';
  const sampleOption = element('mode').querySelector('[value=sample]');
  sampleOption.disabled = !scenario.sample?.available;
  if (sampleOption.disabled && element('mode').value === 'sample') element('mode').value = 'live';
  element('boost-field').hidden = scenario.id !== 'S06';
  if (scenario.id === 'S06') element('boost').value = scenario.defaultBoostSubtype || 'availability';
  element('weight-field').hidden = scenario.id !== 'S06';
  element('upload-area').hidden = !['S10', 'S11'].includes(scenario.id);
  element('file').accept = scenario.id === 'S10' ? 'application/pdf' : 'image/jpeg,image/png,image/webp';
  element('file-label').textContent = scenario.id === 'S10' ? 'Optional PDF' : 'Optional image';
  if (scenario.id === 'S11') element('sample-reference').src = '/samples/zava-hat-blue.svg';
  element('upload-help').textContent = scenario.id === 'S10'
    ? 'Canonical synthetic PDF evidence is pre-indexed in the sample. New PDF uploads are unsupported until durable, scoped equivalent extraction for both arms is approved.'
    : 'Sample uses a fixed original illustration, not arbitrary image understanding. Upload similarity requires a compatible corpus/query image encoder; unconfigured uploads are explicitly unsupported.';
  modeChanged();
}

function sourceLink(hit) {
  let url = safeUrl(hit.url);
  if (url && Number.isInteger(hit.page)) {
    const pageUrl = new URL(url);
    pageUrl.hash = `page=${hit.page}`;
    url = pageUrl.href;
  }
  return url ? Object.assign(node('a', 'Open synthetic source'), { href: url, target: '_blank', rel: 'noopener noreferrer' }) : node('span', 'Source link unavailable');
}

function renderHit(hit, side, index, baselineIds) {
  const card = node('article', undefined, 'card' + (hit.thumbnailUrl ? ' image-card' : '') + (hit.page !== undefined ? ' pdf-card' : ''));
  card.id = `${side}-evidence-${index}`;
  card.tabIndex = -1;
  const head = node('div', undefined, 'card-top');
  const originalRank = baselineIds?.indexOf(hit.id);
  head.append(node('span', `#${hit.rank || index + 1}`, 'rank'));
  card.append(head);
  const image = safeUrl(hit.thumbnailUrl);
  if (image) card.append(Object.assign(node('img'), { src: image, alt: hit.title || 'Synthetic product illustration', loading: 'lazy' }));
  const content = node('div', undefined, 'hit-body');
  content.append(node('h3', hit.title || hit.id), node('p', hit.snippet || 'No passage returned.', 'snippet'));
  const meta = node('div', undefined, 'meta');
  meta.append(node('span', hit.sourceId || hit.id || 'No source ID'));
  if (hit.page !== undefined) meta.append(node('span', `Page ${hit.page}`));
  if (hit.coordinates) meta.append(node('span', hit.coordinates.cells
    ? `Row ${hit.row}: native ${hit.coordinates.unit} cell coordinates`
    : `Source coordinates: ${JSON.stringify(hit.coordinates)}`));
  if (hit.score !== undefined) meta.append(node('span', `${hit.scoreType || 'Service score'}: ${Number.isFinite(hit.score) ? hit.score.toFixed(3) : hit.score}`));
  if (side === 'enhanced' && originalRank >= 0 && originalRank !== index) meta.append(node('span', `Rank ${originalRank + 1} → ${index + 1}`));
  content.append(meta, sourceLink(hit));
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
  container.replaceChildren(heading);
  if (!arm || arm.status === 'error' || arm.status === 'unavailable' || arm.status === 'failed') {
    container.append(node('p', errorText(arm?.error || 'This arm is unavailable.'), 'error'));
    return;
  }
  if (arm.error) container.append(node('p', `Partial result: ${errorText(arm.error)}`, 'error'));
  if (arm.answer) {
    const answer = node('article', undefined, 'card');
    answer.append(node('h3', arm.answerKind === 'note' ? 'Why this arm can’t answer' : 'Grounded answer'), node('p', arm.answer, 'snippet'));
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
    answer.append(citations);
    container.append(answer);
  }
  if (arm.graph?.edges) {
    const graph = node('div', undefined, 'graph');
    arm.graph.edges.forEach(edge => graph.append(node('span', `${edge.from} → ${edge.to} · ${edge.sourceId || 'source unavailable'}`)));
    container.append(graph);
  }
  if (arm.topics?.length) {
    for (const topic of arm.topics) {
      const card = node('article', undefined, 'card');
      card.append(node('h3', topic.title || topic.id), node('p', topic.summary || '', 'snippet'));
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
  const sampleLabel = result.recorded ? ` · Recorded Sample (captured ${result.recorded.recordedAt})` : ' · Deterministic Sample mode';
  element('results-title').textContent = `Search results for “${result.query}”${result.mode === 'sample' ? sampleLabel : ''} · ${element('count').value} supporting evidence maximum per arm`;
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
      : 'New uploads are unsupported: durable scoped ingestion and a compatible encoder are not configured. Remove the file to use canonical sample evidence.');
    return;
  }
  if (imageCompatible && selectedFile && selectedFile.size > 40960) {
    showError('Live image similarity requires a JPEG/PNG/WebP reference of at most 40 KiB.');
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
    const slow = setTimeout(() => { if (id === sequence) setStatus('Still working… the first Live query after a quiet period can take up to 30 seconds while Azure warms up.'); }, 6000);
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
element('query').addEventListener('focus', showSuggestions);
element('query').addEventListener('click', showSuggestions);
element('query').addEventListener('input', () => { invalidate(); element('preset').value = ''; showSuggestions(); setStatus('Query changed. Search to compare.'); });
element('query').addEventListener('keydown', event => {
  const list = element('query-suggestions');
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (list.hidden) showSuggestions();
    const options = [...list.children];
    if (!options.length) return;
    activeSuggestion = (activeSuggestion + (event.key === 'ArrowDown' ? 1 : activeSuggestion < 0 ? 0 : -1) + options.length) % options.length;
    options.forEach((option, index) => option.setAttribute('aria-selected', String(index === activeSuggestion)));
    element('query').setAttribute('aria-activedescendant', options[activeSuggestion].id);
    options[activeSuggestion].scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter' && !list.hidden && activeSuggestion >= 0) {
    event.preventDefault();
    void choosePreset(presetList()[activeSuggestion]);
  } else if (['Escape', 'Tab', 'Enter'].includes(event.key)) {
    if (event.key === 'Escape') event.preventDefault();
    closeSuggestions();
  }
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
    showError('Invalid file signature/type or file exceeds 5 MiB. No upload was sent.');
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
  if (recordedBundled) setStatus(`Bundled example ${file.name} selected. Recorded Sample replays its recorded Live result; nothing is sent to Azure.`);
  else if (compatible) setStatus(`${file.name} (${Math.ceil(file.size / 1024)} KiB) ready as an ephemeral query reference; not uploaded or indexed.`);
  else showError(`${file.name} (${Math.ceil(file.size / 1024)} KiB) remains local only. New uploads are unsupported until scoped durable ingestion / compatible image encoding is configured (inline images must be at most 40 KiB).`);
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
// Native preset dropdown directly below the query field (four curated examples per scenario).
function populatePresets() {
  const select = element('preset');
  const placeholder = node('option', 'Choose one of the examples…');
  placeholder.value = '';
  select.replaceChildren(placeholder, ...presetList().map((preset, index) => Object.assign(node('option', preset.label), { value: String(index) })));
  select.value = '';
}
element('preset').addEventListener('change', () => {
  const preset = presetList()[Number(element('preset').value)];
  if (element('preset').value !== '' && preset) void choosePreset(preset, true);
});
await loadScenarios();
