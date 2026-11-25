// Builds dist/vercel: static public UI plus Search-only Vercel Functions.
// Private bindings and schema attestations are compiled into the server bundle only,
// never into public/ or the source ZIP. No Azure calls are made.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publicCatalog } from '../config/knowledge-bases.mjs';
import { archiveFiles } from './source-files.mjs';
import { illustrationPng } from './generate-studio.mjs';
import { studioScenarios } from '../lib/studio.mjs';
import { filterFields, isFacet } from '../lib/industry.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const out = join(root, 'dist', 'vercel');
const VECTORIZER = 'zava-text-vectorizer';
const IMAGE_VECTORIZER = 'zava-image-vectorizer';
// Verified on foundry-iq-demos: knowledgeRetrieval=standard; agentic canaries complete well within 10 s in all five languages.
const AGENTIC_MAX_RUNTIME_SECONDS = 10;
const LANGUAGES = ['en', 'fr', 'es', 'ja', 'de'];

export function transformBindings(bindings, attestations, graph) {
  const etags = new Map(attestations.entries.map(entry => [entry.index, entry.etag]));
  const next = structuredClone(bindings);
  const used = new Set();
  const changed = new Set(attestations.capture?.vectorizerUpdate?.changedIndexes || []);
  const attested = name => {
    const etag = etags.get(name);
    if (!etag) throw new Error(`No schema attestation for bound index ${name}.`);
    used.add(name);
    return etag;
  };
  const visit = scenarios => {
    for (const [id, config] of Object.entries(scenarios)) {
      if (['S08', 'S09'].includes(id)) {
        // Native Foundry IQ entity graph (S08) and topic graph (S09) on the English Zava dataset, in every language.
        if (!graph) throw new Error('S08/S09 require the private native graph binding (STUDIO_PRIVATE_GRAPH).');
        scenarios[id] = { index: graph.contentIndex, indexETag: attested(graph.contentIndex),
          attestation: { checkedAt: graph.checkedAt, region: 'westcentralus', evidenceVersion: 'foundry-iq-graph-v1' },
          nativeGraph: { dataset: graph.dataset, language: graph.language, apiVersion: graph.apiVersion, vectorField: graph.vectorField, timeoutMs: graph.timeoutMs,
            ...(id === 'S08' ? { graphIndex: graph.graphIndex, graphIndexETag: attested(graph.graphIndex), semanticConfiguration: graph.semanticConfiguration }
              : { topicIndex: graph.topicIndex, topicIndexETag: attested(graph.topicIndex) }) } };
        continue;
      }
      for (const [nameKey, etagKey] of [['index', 'indexETag'], ['standardIndex', 'standardIndexETag']]) {
        if (!config[nameKey]) continue;
        const etag = etags.get(config[nameKey]);
        if (!etag) throw new Error(`No schema attestation for bound index ${config[nameKey]}.`);
        if (config[etagKey] !== etag && !changed.has(config[nameKey])) throw new Error(`Unexpected ETag drift for ${config[nameKey]}.`);
        config[etagKey] = etag;
        used.add(config[nameKey]);
      }
      if (config.vector) {
        delete config.vector.provider;
        config.vector.vectorizer = VECTORIZER;
      }
      if (id === 'S07' && config.agentic) {
        // Evidence-only: Vercel has no model credential, so the grounded-answer step is removed.
        config.agentic = { ...config.agentic, knowledgeRetrievalPlan: 'standard', maxRuntimeInSeconds: AGENTIC_MAX_RUNTIME_SECONDS };
        delete config.answer;
      }
      if (id === 'S11' && config.image) config.image = { ...config.image, vectorizer: IMAGE_VECTORIZER };
      if (changed.has(config.index)) config.attestation = { ...config.attestation, evidenceVersion: 'search-vectorizer-v1' };
    }
  };
  visit(next.scenarios);
  for (const locale of Object.values(next.languages)) visit(locale.scenarios);
  return { config: next, used };
}

/** Industry bindings for the enabled industries, pinned to attested ETags; marks their indexes as used. */
export function industryBindingsFrom(privateBinding, attestations, enabled, used = new Set()) {
  if (!enabled.length) return { agentic: { maxRuntimeInSeconds: AGENTIC_MAX_RUNTIME_SECONDS }, industries: {} };
  const etags = new Map(attestations.entries.map(entry => [entry.index, entry.etag]));
  const industries = {};
  for (const id of enabled) {
    const binding = privateBinding?.industries?.[id];
    if (!binding) throw new Error(`No private industry binding for ${id} (STUDIO_PRIVATE_INDUSTRIES).`);
    const etag = etags.get(binding.index);
    if (!etag) throw new Error(`No schema attestation for industry index ${binding.index}.`);
    used.add(binding.index);
    industries[id] = { index: binding.index, indexETag: etag, semanticConfiguration: binding.semanticConfiguration, vectorField: binding.vectorField,
      scoringProfiles: { ...binding.scoringProfiles } };
  }
  return { agentic: { maxRuntimeInSeconds: AGENTIC_MAX_RUNTIME_SECONDS }, industries };
}

/** Build-time checks of the public industry catalog against the attested schemas. */
export function checkIndustryCatalog(catalog, enabled, attestations, bindings, { notesOptional = false } = {}) {
  const problems = [];
  const schemas = new Map(attestations.entries.map(entry => [entry.index, entry.schema]));
  for (const id of enabled) {
    const industry = catalog.industries.find(item => item.id === id);
    if (!industry) { problems.push(`${id}: not in config/studio-industries.json`); continue; }
    const schema = schemas.get(bindings.industries[id].index);
    const fields = new Map((schema?.fields || []).map(field => [field.name, field]));
    for (const boost of industry.boostSubtypes) if (!bindings.industries[id].scoringProfiles[boost]) problems.push(`${id}: no scoring profile for ${boost}`);
    for (const [scenarioId, presets] of Object.entries(industry.presets || {})) {
      if (!industry.scenarios.includes(scenarioId)) problems.push(`${id}: presets for inapplicable ${scenarioId}`);
      for (const preset of presets) {
        const where = `${id} ${preset.id}`;
        if (typeof preset.query !== 'string' || !preset.query.trim() || preset.query.length > 8000) problems.push(`${where}: query`);
        // Reviewed filters may use search.in(); other search.* functions, parameters and separators are rejected.
        if (preset.filter !== undefined && (!['S03', 'S05'].includes(scenarioId) || typeof preset.filter !== 'string' || /[;\\]|search\.(?!in\()|\$/.test(preset.filter))) problems.push(`${where}: filter`);
        for (const name of preset.filter ? filterFields(preset.filter) : []) if (!fields.get(name)?.filterable) problems.push(`${where}: filter field ${name}`);
        for (const facet of preset.facets || []) if (scenarioId !== 'S05' || !isFacet(facet) || !fields.get(facet.split(',')[0])?.facetable) problems.push(`${where}: facet ${facet}`);
        if (preset.boostSubtype !== undefined && (scenarioId !== 'S06' || !industry.boostSubtypes.includes(preset.boostSubtype))) problems.push(`${where}: boost`);
        if ((scenarioId === 'S10') !== /^[a-f0-9]{64}$/.test(preset.sourceHash || '')) problems.push(`${where}: S10 source hash`);
        if (!notesOptional && (typeof preset.why !== 'string' || !preset.why.trim())) problems.push(`${where}: Why AFTER wins note`);
      }
    }
    for (const facet of industry.defaults?.S05?.facets || []) if (!isFacet(facet) || !fields.get(facet.split(',')[0])?.facetable) problems.push(`${id}: default facet ${facet}`);
    if (industry.scenarios.includes('S10') && !/^[a-f0-9]{64}$/.test(industry.defaults?.S10?.sourceHash || '')) problems.push(`${id}: default S10 document`);
    if (!industry.sourceHosts?.length || industry.sourceHosts.some(host => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host))) problems.push(`${id}: source hosts`);
  }
  return problems;
}

/**
 * Industry recordings must be successful Live comparisons, and an S07 note may claim agentic planning (split, sub-queries)
 * only when the recording that ships shows it: planning varies between runs, so the note must match what visitors see.
 */
export function industryRecordingProblems(catalog, enabled, recorded) {
  const problems = [];
  const planning = /sub-?quer|\bsplit|\bplann|decompos|follow-up quer/i;
  for (const id of enabled) {
    const industry = catalog.industries.find(item => item.id === id);
    for (const [scenarioId, presets] of Object.entries(industry?.presets || {})) {
      for (const preset of presets) {
        const entry = recorded.entries?.[`${id}|en|${scenarioId}|${preset.query}`];
        if (!entry) continue;
        const result = entry.result || {};
        if (result.executionStatus !== 'success' || result.baseline?.status !== 'success' || result.enhanced?.status !== 'success') problems.push(`${id} ${preset.id}: recording is not a successful comparison`);
        const count = result.enhanced?.trace?.configuration?.agenticSearch?.subQueryCount;
        if (scenarioId === 'S07' && planning.test(preset.why || '') && !(count > 0)) problems.push(`${id} ${preset.id}: note claims agentic planning but the recording shows ${count ?? 'no'} sub-queries`);
      }
    }
  }
  return problems;
}

/** Lists the industries compiled into this build on the demo page, so the client never requests an unknown one. */
export function pageWithIndustries(html, enabled) {
  const marker = '<meta name="studio-industries" content="">';
  if (!html.includes(marker)) throw new Error('page.html is missing the studio-industries meta tag.');
  if (enabled.some(id => !/^[a-z]{2,32}$/.test(id))) throw new Error('Industry IDs must be lowercase letters.');
  return html.replace(marker, `<meta name="studio-industries" content="${enabled.join(',')}">`);
}

export function reduceAttestations(attestations, used) {
  return { service: attestations.service, apiVersion: attestations.apiVersion,
    entries: attestations.entries.filter(entry => used.has(entry.index)).map(({ index, etag, schema }) => ({ index, etag, schema })) };
}

async function verifyOffline(liveConfig, attestations, industries = { enabled: [] }) {
  const { createVercelApp } = await import(pathToFileURL(join(root, 'lib', 'vercel-app.mjs')));
  const { LIVE_SCENARIOS } = await import(pathToFileURL(join(root, 'lib', 'search-adapter.mjs')));
  const app = createVercelApp({ liveConfig, attestations, industries, log: () => {},
    fetchUpstream: () => { throw new Error('Offline build verification must not call Azure.'); } });
  const env = { LIVE_ENABLED: 'true', AZURE_SEARCH_ENDPOINT: `https://${attestations.service}.search.windows.net`, AZURE_SEARCH_QUERY_KEY: 'OfflineBuildVerificationPlaceholder0000' };
  const origin = 'https://build.invalid';
  const matrix = [];
  for (const language of LANGUAGES) {
    const scenarios = await (await app.handle('scenarios', new Request(`${origin}/api/scenarios?language=${language}`), env)).json();
    for (const item of scenarios.scenarios) {
      const expected = LIVE_SCENARIOS.includes(item.id);
      if (item.liveAvailable !== expected) throw new Error(`${language}:${item.id} live availability ${item.liveAvailable}; expected ${expected}: ${item.live.reason}`);
      if (!expected) { matrix.push(`${language}:${item.id}=gated`); continue; }
      const response = await app.handle('prepare', new Request(`${origin}/api/demo/prepare`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenarioId: item.id, mode: 'live', language, query: item.queries.find(query => query?.trim()) || item.imageOnlyQuery, ...(item.id === 'S06' ? { options: { boostSubtype: 'availability' } } : {}) }) }), env);
      const plan = await response.json();
      if (response.status !== 200 || plan.ready !== true) throw new Error(`${language}:${item.id} attested schema preparation failed: ${JSON.stringify(plan)}`);
      matrix.push(`${language}:${item.id}=attested`);
    }
  }
  for (const industry of industries.enabled) {
    const scenarios = await (await app.handle('scenarios', new Request(`${origin}/api/scenarios?industry=${industry}`), env)).json();
    if (!Array.isArray(scenarios.scenarios) || !scenarios.scenarios.length) throw new Error(`${industry}: industry catalog unavailable: ${JSON.stringify(scenarios).slice(0, 300)}`);
    for (const item of scenarios.scenarios) {
      if (!item.liveAvailable) throw new Error(`${industry}:${item.id} live unavailable: ${item.live.reason}`);
      const response = await app.handle('prepare', new Request(`${origin}/api/demo/prepare`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ industry, scenarioId: item.id, mode: 'live', query: item.sampleQuery || 'public guidance' }) }), env);
      const plan = await response.json();
      if (response.status !== 200 || plan.ready !== true) throw new Error(`${industry}:${item.id} attested schema preparation failed: ${JSON.stringify(plan)}`);
      matrix.push(`${industry}:${item.id}=attested`);
    }
  }
  return matrix;
}

const escapeHtml = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Replaces the About page's data-sources block with the Zava sources plus every enabled industry's public sources. */
export function aboutWithDataSources(html, catalog, enabled) {
  const start = '<!-- DATA_SOURCES:START -->', end = '<!-- DATA_SOURCES:END -->';
  if (!html.includes(start) || !html.includes(end)) throw new Error('about.html is missing the data-sources markers.');
  const groups = [catalog.zava, ...enabled.map(id => catalog.industries.find(item => item.id === id))];
  const section = groups.map(item => `<article class="source-card"><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.blurb)}</p><ul>${item.sources.map(source =>
    `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.agency)}: ${escapeHtml(source.name)}</a><span class="license">${escapeHtml(source.license)}</span></li>`).join('')}</ul></article>`).join('\n        ');
  const intro = enabled.length
    ? '<p>Public and synthetic demo data. The Zava store is fictional; the industry demos search public U.S. government documents in English, and every result links to its original public source.</p>'
    : '<p>Synthetic demo data: the Zava store, its products, support articles and images are fictional.</p>';
  let page = html.slice(0, html.indexOf(start) + start.length) + `\n        ${intro}\n        ${section}\n        ` + html.slice(html.indexOf(end));
  if (enabled.length) {
    const replace = (from, to) => { if (!page.includes(from)) throw new Error(`about.html changed: ${from}`); page = page.replace(from, to); };
    replace('<li>All content is synthetic (Zava Retail); no customer data.</li>',
      '<li>The Zava store is synthetic. Industry demos search public U.S. government documents, in English only. No customer data.</li>\n          <li>Industry demos cover S01–S07, plus S10 where the corpus has PDFs. Image search (S11) and the graph scenarios (S08, S09) use the Zava store.</li>');
    replace('<footer><span>Synthetic demo content · Zava Retail · S01–S11</span>', '<footer><span>Public and synthetic demo data · <a href="#data-sources">Data sources</a></span>');
  }
  return page;
}

function scanPublic(dir, forbidden) {
  const findings = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { findings.push(...scanPublic(path, forbidden)); continue; }
    const text = readFileSync(path, 'latin1');
    for (const [label, pattern] of forbidden) if (pattern.test(text)) findings.push(`${path}: ${label}`);
  }
  return findings;
}

const write = (path, body) => {
  mkdirSync(dirname(join(out, path)), { recursive: true });
  writeFileSync(join(out, path), body);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bindingsPath = process.env.STUDIO_PRIVATE_BINDINGS;
  const attestationsPath = process.env.STUDIO_PRIVATE_ATTESTATIONS;
  const graphPath = process.env.STUDIO_PRIVATE_GRAPH;
  if (![bindingsPath, attestationsPath, graphPath].every(path => path && existsSync(path))) {
    throw new Error('Set STUDIO_PRIVATE_BINDINGS, STUDIO_PRIVATE_ATTESTATIONS and STUDIO_PRIVATE_GRAPH to the private studio-live-config.json, search-schema-attestations.json and native-graph-binding.json files.');
  }
  const bindings = JSON.parse(readFileSync(bindingsPath, 'utf8'));
  const fullAttestations = JSON.parse(readFileSync(attestationsPath, 'utf8'));
  const { config: liveConfig, used } = transformBindings(bindings, fullAttestations, JSON.parse(readFileSync(graphPath, 'utf8')));
  // Industry demos stay out of a build unless STUDIO_INDUSTRIES lists them (comma-separated industry IDs).
  const enabledIndustries = (process.env.STUDIO_INDUSTRIES || '').split(',').map(item => item.trim()).filter(Boolean);
  const industryCatalog = JSON.parse(readFileSync('config/studio-industries.json', 'utf8'));
  const industryPath = process.env.STUDIO_PRIVATE_INDUSTRIES;
  if (enabledIndustries.length && !(industryPath && existsSync(industryPath))) throw new Error('STUDIO_INDUSTRIES requires STUDIO_PRIVATE_INDUSTRIES (the private industry-bindings.json).');
  const industryBindings = industryBindingsFrom(enabledIndustries.length ? JSON.parse(readFileSync(industryPath, 'utf8')) : null, fullAttestations, enabledIndustries, used);
  const attestations = reduceAttestations(fullAttestations, used);
  const industryProblems = checkIndustryCatalog(industryCatalog, enabledIndustries, attestations, industryBindings, { notesOptional: process.env.STUDIO_NOTES_OPTIONAL === '1' });
  if (industryProblems.length) throw new Error(`Industry catalog check failed:\n${industryProblems.join('\n')}`);
  // Recorded Sample (verified Live responses, request IDs removed) must cover every scenario in every language.
  const recorded = existsSync('config/studio-recorded.json') ? JSON.parse(readFileSync('config/studio-recorded.json', 'utf8')) : { entries: {} };
  const missingSamples = LANGUAGES.flatMap(language => Array.from({ length: 11 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`)
    .filter(id => !Object.values(recorded.entries).some(entry => entry.language === language && entry.scenarioId === id)).map(id => `${language}:${id}`));
  if (missingSamples.length && process.env.STUDIO_RECORDED_OPTIONAL !== '1') throw new Error(`Recorded Sample coverage is incomplete: ${missingSamples.join(', ')}`);
  if (missingSamples.length) process.stdout.write(`WARNING: development build without complete recorded Sample coverage (${missingSamples.length} gaps).\n`);
  if (/requestId|"runId"|api-key/i.test(JSON.stringify(recorded))) throw new Error('Recorded Sample data must not contain request IDs or credentials.');
  const recordedText = JSON.stringify(recorded);
  if (/"request-id":"(?!removed)/.test(recordedText) || /search\.windows\.net/.test(recordedText.split('<your-search-service>.search.windows.net').join(''))) {
    throw new Error('Recorded Sample API logs must use the host placeholder and contain no request IDs.');
  }
  // "Why AFTER wins" notes: one curated note per preset per language, written from the recorded Live results.
  const notes = existsSync('config/studio-notes.json') ? JSON.parse(readFileSync('config/studio-notes.json', 'utf8')) : { entries: {} };
  const missingNotes = LANGUAGES.flatMap(language => studioScenarios({}, language).flatMap(item => item.demoPresets
    .map(preset => `${language}|${item.id}|${(preset.query || item.imageOnlyQuery).trim()}`)))
    .filter(key => typeof notes.entries[key] !== 'string' || !notes.entries[key].trim());
  if (missingNotes.length && process.env.STUDIO_NOTES_OPTIONAL !== '1') throw new Error(`Why-AFTER-wins notes are missing: ${missingNotes.slice(0, 8).join(', ')}${missingNotes.length > 8 ? ' …' : ''}`);
  if (missingNotes.length) process.stdout.write(`WARNING: development build without complete Why-AFTER-wins notes (${missingNotes.length} gaps).\n`);
  // Industry recorded Sample: every curated example of every enabled industry, unless explicitly optional for a development build.
  const missingIndustrySamples = enabledIndustries.flatMap(id => Object.entries(industryCatalog.industries.find(item => item.id === id).presets || {})
    .flatMap(([scenarioId, presets]) => presets.map(preset => `${id}|en|${scenarioId}|${preset.query}`))).filter(key => !recorded.entries[key]);
  if (missingIndustrySamples.length && process.env.STUDIO_INDUSTRY_SAMPLES_OPTIONAL !== '1') {
    throw new Error(`Industry recorded Sample coverage is incomplete (${missingIndustrySamples.length}): ${missingIndustrySamples.slice(0, 4).join(', ')} …`);
  }
  if (missingIndustrySamples.length) process.stdout.write(`WARNING: development build without industry recorded Sample (${missingIndustrySamples.length} gaps).\n`);
  const recordingProblems = industryRecordingProblems(industryCatalog, enabledIndustries, recorded);
  if (recordingProblems.length) throw new Error(`Industry recordings do not support their notes:\n${recordingProblems.join('\n')}`);
  const industries = { enabled: enabledIndustries, bindings: industryBindings };
  const matrix = await verifyOffline(liveConfig, attestations, industries);

  rmSync(out, { recursive: true, force: true });
  // Public, static UI. The source download link is removed in this build.
  const fixtures = JSON.parse(readFileSync('config/scenarios.json', 'utf8'));
  const catalog = publicCatalog(fixtures);
  const page = readFileSync('page.html', 'utf8').replace('__SCENARIOS__', () => JSON.stringify(catalog).replace(/</g, '\\u003c'));
  if (page.includes('/download') || !page.includes('/assets/foundry.svg') || !page.includes('rel="icon"')) throw new Error('Public page must link the Foundry logo and favicons and must not expose the source download route.');
  write('public/index.html', pageWithIndustries(page, enabledIndustries));
  write('public/about.html', aboutWithDataSources(readFileSync('about.html', 'utf8'), industryCatalog, enabledIndustries));
  // Vercel serves public/404.html for unmatched paths; it must stay CSP-clean (external theme loader only).
  const notFound = readFileSync('404.html', 'utf8');
  if (/<script(?![^>]*\bsrc=)|\son[a-z]+=|javascript:/i.test(notFound) || !notFound.includes('href="/"')) {
    throw new Error('404.html must link back to the demo and must not contain inline scripts or event handlers.');
  }
  write('public/404.html', notFound);
  write('public/assets/client.mjs', readFileSync('assets/client.mjs'));
  write('public/assets/header.mjs', readFileSync('assets/header.mjs'));
  write('public/assets/about.mjs', readFileSync('assets/about.mjs'));
  write('public/assets/styles.css', readFileSync('assets/styles.css'));
  write('public/assets/theme.js', readFileSync('assets/theme.js'));
  write('public/assets/source.svg', readFileSync('assets/source.svg'));
  // The unchanged Microsoft Foundry mark (assets/PROVENANCE.md) and favicons rendered from that same file.
  write('public/assets/foundry.svg', readFileSync('assets/foundry.svg'));
  write('public/favicon.svg', readFileSync('assets/foundry.svg'));
  write('public/favicon.ico', readFileSync('assets/favicon.ico'));
  write('public/favicon-32.png', readFileSync('assets/favicon-32.png'));
  write('public/apple-touch-icon.png', readFileSync('assets/apple-touch-icon.png'));
  // Knowledge-source kinds keep the neutral fallback icon; that product artwork has separate terms.
  write('public/assets/source-icons.mjs', readFileSync('assets/source-icons.mjs', 'utf8')
    .replace(/\/assets\/(?:blob|fabric|foundry|search|sharepoint|web)\.svg/g, '/assets/source.svg'));
  write('public/LICENSE', readFileSync('LICENSE'));
  for (const path of archiveFiles.filter(path => path.startsWith('samples/'))) write(`public/${path}`, readFileSync(path));
  for (const [file, index] of [['zava-hat-blue.png', 0], ['zava-hat-red.png', 1], ['zava-bowl-blue.png', 3]]) write(`public/samples/${file}`, illustrationPng(index));

  // Server-only modules and private data.
  for (const path of ['lib/protocol.mjs', 'lib/normalize.mjs', 'lib/studio.mjs', 'lib/native-graph.mjs', 'lib/industry.mjs', 'lib/search-adapter.mjs', 'lib/vercel-app.mjs',
    ...archiveFiles.filter(path => /^config\/studio-(?!live\.example|recorded).*\.(?:mjs|json)$/.test(path))]) {
    mkdirSync(dirname(join(out, 'server', path)), { recursive: true });
    copyFileSync(path, join(out, 'server', path));
  }
  write('server/private-data.mjs', '// PRIVATE server-only bindings and schema attestations. Never serve or publish.\n'
    + `export const liveConfig = ${JSON.stringify(liveConfig)};\nexport const attestations = ${JSON.stringify(attestations)};\nexport const industries = ${JSON.stringify(industries)};\n`);
  write('server/recorded-data.mjs', `export const recorded = ${JSON.stringify(recorded)};\n`);
  write('server/notes-data.mjs', `export const notes = ${JSON.stringify(notes)};\n`);
  write('server/app.mjs', "import { createVercelApp } from './lib/vercel-app.mjs';\nimport { liveConfig, attestations, industries } from './private-data.mjs';\nimport { recorded } from './recorded-data.mjs';\nimport { notes } from './notes-data.mjs';\n\nexport const app = createVercelApp({ liveConfig, attestations, recorded, notes, industries });\n");
  const entry = (route, depth, verb) => `import { app } from '${'../'.repeat(depth)}server/app.mjs';\n\nexport ${verb === 'GET' ? 'function GET' : 'function POST'}(request) {\n  return app.handle('${route}', request, process.env);\n}\n`;
  write('api/scenarios.mjs', entry('scenarios', 1, 'GET'));
  write('api/health.mjs', entry('health', 1, 'GET'));
  write('api/demo/prepare.mjs', entry('prepare', 2, 'POST'));
  write('api/demo/run.mjs', entry('run', 2, 'POST'));
  const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  write('vercel.json', JSON.stringify({
    framework: null, outputDirectory: 'public', cleanUrls: false,
    functions: { 'api/**/*.mjs': { maxDuration: 60, includeFiles: 'server/**' } },
    rewrites: [{ source: '/healthz', destination: '/api/health' }, { source: '/about', destination: '/about.html' }],
    redirects: ['/agents', '/knowledge', '/playground'].map(source => ({ source, destination: '/', permanent: true })),
    headers: [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000' }, { key: 'Content-Security-Policy', value: csp },
    ] }],
  }, null, 2) + '\n');
  write('package.json', JSON.stringify({ name: 'foundry-iq-studio-live', version: '1.0.0', private: true, type: 'module', engines: { node: '26.x' } }) + '\n');
  write('.vercelignore', '.env*\n*.log\n');

  // Public output must not contain private bindings, attestations, server modules or credential-shaped values.
  const findings = scanPublic(join(out, 'public'), [
    ['private bindings marker', /indexETag|corpusHash|evidenceVersion|fiq-zava-[0-9a-f]{8}/i],
    ['attestation marker', /INTERNAL deployment metadata|"etag"\s*:|search-schema-attestations/],
    ['server environment name', /AZURE_SEARCH_QUERY_KEY|AZURE_SEARCH_API_KEY|LIVE_ENABLED/],
    ['credential-shaped value', /\bapi-key\s*[:=]\s*["'][A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|AccountKey=|SharedAccessSignature|sig=[A-Za-z0-9%]{20,}/],
    ['vectorizer endpoint', /openai\.azure\.com/],
  ]);
  if (findings.length) throw new Error(`Public output scan failed:\n${findings.join('\n')}`);
  const digest = createHash('sha256').update(readFileSync(join(out, 'server/private-data.mjs'))).digest('hex');
  process.stdout.write(`Built dist/vercel (${matrix.filter(item => item.endsWith('attested')).length} attested live scenario/language pairs, industries: ${enabledIndustries.join(',') || 'none'}, `
    + `${matrix.filter(item => item.endsWith('gated')).length} gated). Private data SHA-256 ${digest}. Public scan clean. No Azure calls performed.\n`);
}
