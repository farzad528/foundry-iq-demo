// Builds dist/vercel: static public UI plus Search-only Vercel Functions.
// Private bindings and schema attestations are compiled into the server bundle only, never into public/.
// Without the private files this builds the public Sample-only app (recorded Zava Sample, Live off). No Azure calls are made.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { illustrationPng } from './generate-studio.mjs';
import { studioScenarios } from '../lib/studio.mjs';
import { filterFields, isFacet } from '../lib/industry.mjs';
import { evidenceHighlightProblems, evidenceNoteProblems } from '../lib/evidence-note.mjs';
import { snippetRanges } from '../assets/display.mjs';
import { SEARCH_API_VERSION } from '../config/studio-live.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const out = join(root, 'dist', 'vercel');
// Public files served from /samples (citations, S10 PDFs, S11 example images) and server-side config modules.
export const sampleFiles = () => readdirSync('samples').filter(name => /^zava-[a-z0-9-]+\.(?:md|csv|pdf|svg)$/.test(name)).sort().map(name => `samples/${name}`);
export const serverConfigFiles = () => readdirSync('config').filter(name => /^studio-(?!recorded)[a-z-]+\.(?:mjs|json)$/.test(name)).sort().map(name => `config/${name}`);
export const SERVER_MODULES = Object.freeze(['lib/protocol.mjs', 'lib/normalize.mjs', 'lib/studio.mjs', 'lib/native-graph.mjs', 'lib/industry.mjs', 'lib/industry-graph.mjs',
  'lib/search-adapter.mjs', 'lib/evidence-note.mjs', 'lib/vercel-app.mjs']);
const sampleImages = [['zava-hat-blue', 0], ['zava-hat-red', 1], ['zava-bowl-blue', 3]];
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

/** Private industry graph binding for the enabled industries, pinned to the graph service's attested ETags. */
export function industryGraphFrom(privateGraph, graphAttestations, enabled, graphConfig) {
  if (!privateGraph) return undefined;
  const etags = new Map((graphAttestations?.entries || []).map(entry => [entry.index, entry.etag]));
  const industries = {};
  const used = new Set();
  for (const id of enabled) {
    const binding = privateGraph.industries?.[id];
    if (!binding) continue;
    if (!graphConfig.industries?.[id] || graphConfig.industries[id].dataset !== binding.dataset) throw new Error(`Industry graph dataset mismatch for ${id}.`);
    for (const [index, etag] of [[binding.content, binding.contentETag], [binding.graph, binding.graphETag], [binding.topic, binding.topicETag]]) {
      if (etags.get(index) !== etag) throw new Error(`No matching graph schema attestation for ${index}.`);
      used.add(index);
    }
    industries[id] = { ...binding };
  }
  if (!Object.keys(industries).length) return undefined;
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(privateGraph.service || '') || privateGraph.apiVersion !== '2026-11-01-preview') throw new Error('Industry graph service or API version is invalid.');
  return { service: privateGraph.service, apiVersion: privateGraph.apiVersion, industries,
    attestations: { service: privateGraph.service, apiVersion: graphAttestations.apiVersion, entries: graphAttestations.entries.filter(entry => used.has(entry.index)).map(({ index, etag, schema }) => ({ index, etag, schema })) } };
}

/** Build-time checks of the public industry catalog against the attested schemas. */
export function checkIndustryCatalog(catalog, enabled, attestations, bindings) {
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
      }
    }
    for (const facet of industry.defaults?.S05?.facets || []) if (!isFacet(facet) || !fields.get(facet.split(',')[0])?.facetable) problems.push(`${id}: default facet ${facet}`);
    if (industry.scenarios.includes('S10') && !/^[a-f0-9]{64}$/.test(industry.defaults?.S10?.sourceHash || '')) problems.push(`${id}: default S10 document`);
    if (!industry.sourceHosts?.length || industry.sourceHosts.some(host => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host))) problems.push(`${id}: source hosts`);
  }
  return problems;
}

/** Industry recordings must be successful Live comparisons with the strongest showcase example first. */
export function industryRecordingProblems(catalog, enabled, recorded) {
  const problems = [];
  for (const id of enabled) {
    const industry = catalog.industries.find(item => item.id === id);
    for (const [scenarioId, presets] of Object.entries(industry?.presets || {})) {
      for (const preset of presets) {
        const entry = recorded.entries?.[`${id}|en|${scenarioId}|${preset.query}`];
        if (!entry) continue;
        const result = entry.result || {};
        if (result.executionStatus !== 'success' || result.baseline?.status !== 'success' || result.enhanced?.status !== 'success') problems.push(`${id} ${preset.id}: recording is not a successful comparison`);
      }
      // The first (default) example should show a different #1 in BEFORE and AFTER whenever another example does.
      const sameTop1 = preset => {
        const result = recorded.entries?.[`${id}|en|${scenarioId}|${preset.query}`]?.result;
        const [before, after] = [result?.baseline?.hits?.[0]?.id, result?.enhanced?.hits?.[0]?.id];
        return result ? !!before && before === after : undefined;
      };
      // Graph scenarios (S08/S09) compare paths and themes, not rankings.
      if (!['S08', 'S09'].includes(scenarioId) && sameTop1(presets[0]) === true && presets.some(preset => sameTop1(preset) === false)) problems.push(`${id} ${scenarioId}: the first example has the same #1 in both arms; lead with one that differs`);
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

/** Every curated industry S08/S09 example must be a graph-contract question with allowlisted statements, and vice versa. */
export function industryGraphPresetProblems(catalog, graphConfig, ids) {
  const problems = [];
  for (const id of ids) {
    const industry = catalog.industries.find(item => item.id === id);
    const graph = graphConfig.industries?.[id];
    for (const [scenarioId, key] of [['S08', 's08'], ['S09', 's09']]) {
      const listed = (industry?.presets?.[scenarioId] || []).map(preset => preset.query);
      const allowed = (graph?.[key] || []).map(preset => preset.question);
      if (listed.join('\n') !== allowed.join('\n')) problems.push(`${id} ${scenarioId}: catalog examples and graph-contract questions differ`);
    }
    for (const preset of graph?.s08 || []) {
      if (!preset.statements?.length || preset.statements.length > 4 || preset.statements.some(statement => !/^MATCH\s/i.test(statement.gql) || /NOT\s*\(/i.test(statement.gql))) problems.push(`${id} ${preset.id}: GQL statements`);
    }
  }
  return problems;
}

export function reduceAttestations(attestations, used) {
  return { service: attestations.service, apiVersion: attestations.apiVersion,
    entries: attestations.entries.filter(entry => used.has(entry.index)).map(({ index, etag, schema }) => ({ index, etag, schema })) };
}

// Public Sample-only build: every Zava scenario replays its recorded Live result in every language, and Live stays unavailable
// even when Live variables are set, because no index is attested.
async function verifyPublic(liveConfig, attestations, recorded, notes) {
  const { createVercelApp } = await import(pathToFileURL(join(root, 'lib', 'vercel-app.mjs')));
  const app = createVercelApp({ liveConfig, attestations, recorded, notes, log: () => {},
    fetchUpstream: () => { throw new Error('Offline build verification must not call Azure.'); } });
  const env = { LIVE_ENABLED: 'true', AZURE_SEARCH_ENDPOINT: `https://${attestations.service}.search.windows.net`, AZURE_SEARCH_QUERY_KEY: 'OfflineBuildVerificationPlaceholder0000' };
  const origin = 'https://build.invalid';
  const matrix = [];
  for (const language of LANGUAGES) {
    const scenarios = await (await app.handle('scenarios', new Request(`${origin}/api/scenarios?language=${language}`), env)).json();
    if (scenarios.scenarios?.length !== 11) throw new Error(`${language}: the public catalog must list S01–S11.`);
    for (const item of scenarios.scenarios) {
      if (item.liveAvailable || !item.sample?.available) throw new Error(`${language}:${item.id} must be Sample-only in the public build.`);
      const preset = item.demoPresets[0];
      const response = await app.handle('run', new Request(`${origin}/api/demo/run`, { method: 'POST', headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ scenarioId: item.id, mode: 'sample', language, topK: 10, query: preset.query || item.imageOnlyQuery,
          ...(preset.boostSubtype ? { options: { boostSubtype: preset.boostSubtype } } : {}) }) }), env);
      const result = await response.json();
      if (response.status !== 200 || !result.recorded) throw new Error(`${language}:${item.id} recorded Sample replay failed: ${JSON.stringify(result).slice(0, 300)}`);
      matrix.push(`${language}:${item.id}=sample`);
    }
  }
  return matrix;
}

async function verifyOffline(liveConfig, attestations, industries = { enabled: [] }) {
  const graphEnv = industries.graph ? { AZURE_SEARCH_GRAPH_ENDPOINT: `https://${industries.graph.service}.search.windows.net`, AZURE_SEARCH_GRAPH_QUERY_KEY: 'OfflineGraphVerificationPlaceholder00' } : {};
  const { createVercelApp } = await import(pathToFileURL(join(root, 'lib', 'vercel-app.mjs')));
  const { LIVE_SCENARIOS } = await import(pathToFileURL(join(root, 'lib', 'search-adapter.mjs')));
  const app = createVercelApp({ liveConfig, attestations, industries, log: () => {},
    fetchUpstream: () => { throw new Error('Offline build verification must not call Azure.'); } });
  const env = { LIVE_ENABLED: 'true', AZURE_SEARCH_ENDPOINT: `https://${attestations.service}.search.windows.net`, AZURE_SEARCH_QUERY_KEY: 'OfflineBuildVerificationPlaceholder0000', ...graphEnv };
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
      // Industry graph scenarios are attested when this build binds the industry graph; otherwise they stay visibly not configured.
      if (['S08', 'S09'].includes(item.id) && !industries.graph?.industries?.[industry]) {
        if (item.live.status !== 'not_configured') throw new Error(`${industry}:${item.id} should be not configured without a graph binding.`);
        matrix.push(`${industry}:${item.id}=not_configured`);
        continue;
      }
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
export function aboutWithDataSources(html, catalog, enabled, { graph = false } = {}) {
  const start = '<!-- DATA_SOURCES:START -->', end = '<!-- DATA_SOURCES:END -->';
  if (!html.includes(start) || !html.includes(end)) throw new Error('about.html is missing the data-sources markers.');
  const groups = [catalog.zava, ...enabled.map(id => catalog.industries.find(item => item.id === id))];
  const section = groups.map(item => `<article class="source-card"><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.blurb)}</p><ul>${item.sources.map(source =>
    `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.agency)}: ${escapeHtml(source.name)}</a><span class="license">${escapeHtml(source.license)}</span></li>`).join('')}</ul>${
    item.aboutNote ? `<p class="source-note">${escapeHtml(item.aboutNote)}</p>` : ''}</article>`).join('\n        ');
  const intro = enabled.length
    ? '<p>Public and synthetic demo data. The Zava store is fictional; the industry demos search public U.S. government documents in English, and every result links to its original public source.</p>'
    : '<p>Synthetic demo data: the Zava store, its products, support articles and images are fictional.</p>';
  let page = html.slice(0, html.indexOf(start) + start.length) + `\n        ${intro}\n        ${section}\n        ` + html.slice(html.indexOf(end));
  if (enabled.length) {
    const replace = (from, to) => { if (!page.includes(from)) throw new Error(`about.html changed: ${from}`); page = page.replace(from, to); };
    replace('<li>All content is synthetic (Zava Retail); no customer data.</li>',
      `<li>The Zava store is synthetic. Industry demos search public U.S. government documents, in English only. No customer data.</li>\n          <li>Industry demos cover S01–S07, plus S10 where the corpus has PDFs. ${graph ? 'Industry entity and topic graph search (S08, S09) runs on a dedicated Foundry IQ service for the curated questions' : 'Industry graph search (S08, S09) isn’t configured yet'}, and image search (S11) uses the Zava store.</li>`);
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

// The four Search-only Functions. dist/vercel/api holds the copies a manual deployment uploads; the committed root api/
// wrappers serve the same bundle from dist/vercel/server for Vercel Git builds (npm run build:vercel).
export const API_ROUTES = Object.freeze([
  { file: 'api/scenarios.mjs', route: 'scenarios', verb: 'GET' },
  { file: 'api/health.mjs', route: 'health', verb: 'GET' },
  { file: 'api/demo/prepare.mjs', route: 'prepare', verb: 'POST' },
  { file: 'api/demo/run.mjs', route: 'run', verb: 'POST' },
]);

/** Source of a Function entry point that hands one route to the built server app. */
export function apiEntry(route, verb, appPath) {
  return `import { app } from '${appPath}';\n\nexport function ${verb}(request) {\n  return app.handle('${route}', request, process.env);\n}\n`;
}

/** Root api/ wrapper for Git builds: the dist entry pointed at dist/vercel/server. */
export function rootApiEntry({ file, route, verb }) {
  return `// Vercel Git builds: npm run build:vercel writes dist/vercel; this serves its server bundle. See docs/OPERATIONS.md.\n${
    apiEntry(route, verb, `${'../'.repeat(file.split('/').length - 1)}dist/vercel/server/app.mjs`)}`;
}

const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/** vercel.json: security headers, routes and Function limits shared by manual and Git deployments. */
export function vercelConfig({ outputDirectory, serverFiles, git = false }) {
  return {
    ...(git ? { installCommand: 'npm ci', buildCommand: 'npm run build:vercel' } : {}),
    framework: null, outputDirectory, cleanUrls: false,
    functions: { 'api/**/*.mjs': { maxDuration: 60, includeFiles: serverFiles } },
    rewrites: [{ source: '/healthz', destination: '/api/health' }, { source: '/about', destination: '/about.html' }],
    redirects: ['/agents', '/knowledge', '/playground'].map(source => ({ source, destination: '/', permanent: true })),
    headers: [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000' }, { key: 'Content-Security-Policy', value: CSP },
    ] }],
  };
}

/** The committed root vercel.json for Vercel Git builds of main. */
export const rootVercelConfig = () => vercelConfig({ outputDirectory: 'dist/vercel/public', serverFiles: 'dist/vercel/server/**', git: true });

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bindingsPath = process.env.STUDIO_PRIVATE_BINDINGS;
  const attestationsPath = process.env.STUDIO_PRIVATE_ATTESTATIONS;
  const graphPath = process.env.STUDIO_PRIVATE_GRAPH;
  // Public build: no private bindings at all. Live stays unavailable (no attested index), industries are omitted and the
  // recorded Zava Sample works in every language. A partial set of private variables is a configuration error.
  const publicBuild = ![bindingsPath, attestationsPath, graphPath, process.env.STUDIO_INDUSTRIES].some(Boolean);
  if (!publicBuild && ![bindingsPath, attestationsPath, graphPath].every(path => path && existsSync(path))) {
    throw new Error('Set STUDIO_PRIVATE_BINDINGS, STUDIO_PRIVATE_ATTESTATIONS and STUDIO_PRIVATE_GRAPH to the private studio-live-config.json, search-schema-attestations.json and native-graph-binding.json files, or none of them for the public Sample-only build.');
  }
  const fullAttestations = publicBuild ? { service: 'foundry-iq-demos', apiVersion: SEARCH_API_VERSION, entries: [] } : JSON.parse(readFileSync(attestationsPath, 'utf8'));
  const { config: liveConfig, used } = publicBuild
    ? { config: { datasetVersion: 'zava-studio-2026-01', resourceVersion: 'public-sample-build', scenarios: {}, languages: {} }, used: new Set() }
    : transformBindings(JSON.parse(readFileSync(bindingsPath, 'utf8')), fullAttestations, JSON.parse(readFileSync(graphPath, 'utf8')));
  // Industry demos stay out of a build unless STUDIO_INDUSTRIES lists them (comma-separated industry IDs).
  const enabledIndustries = (process.env.STUDIO_INDUSTRIES || '').split(',').map(item => item.trim()).filter(Boolean);
  const industryCatalog = JSON.parse(readFileSync('config/studio-industries.json', 'utf8'));
  const industryPath = process.env.STUDIO_PRIVATE_INDUSTRIES;
  if (enabledIndustries.length && !(industryPath && existsSync(industryPath))) throw new Error('STUDIO_INDUSTRIES requires STUDIO_PRIVATE_INDUSTRIES (the private industry-bindings.json).');
  const industryBindings = industryBindingsFrom(enabledIndustries.length ? JSON.parse(readFileSync(industryPath, 'utf8')) : null, fullAttestations, enabledIndustries, used);
  const attestations = reduceAttestations(fullAttestations, used);
  const industryProblems = checkIndustryCatalog(industryCatalog, enabledIndustries, attestations, industryBindings);
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
  const notes = existsSync('config/studio-notes.json') ? JSON.parse(readFileSync('config/studio-notes.json', 'utf8')) : { entries: {} };
  const noteProblems = [...evidenceNoteProblems(notes, recorded, { optional: process.env.STUDIO_NOTES_OPTIONAL === '1' }),
    ...evidenceHighlightProblems(notes, recorded, snippetRanges)];
  for (const [image, index] of sampleImages) if (notes.imageDigests?.[image]
    && notes.imageDigests[image] !== createHash('sha256').update(illustrationPng(index)).digest('hex')) noteProblems.push(`${image}: reviewed reference image changed`);
  if (noteProblems.length) throw new Error(`Invalid evidence notes (${noteProblems.length}):\n${noteProblems.slice(0, 8).join('\n')}`);
  // Industry recorded Sample: every curated example of every enabled industry, unless explicitly optional for a development build.
  const missingIndustrySamples = enabledIndustries.flatMap(id => Object.entries(industryCatalog.industries.find(item => item.id === id).presets || {})
    .flatMap(([scenarioId, presets]) => presets.map(preset => `${id}|en|${scenarioId}|${preset.query}`))).filter(key => !recorded.entries[key]);
  if (missingIndustrySamples.length && process.env.STUDIO_INDUSTRY_SAMPLES_OPTIONAL !== '1') {
    throw new Error(`Industry recorded Sample coverage is incomplete (${missingIndustrySamples.length}): ${missingIndustrySamples.slice(0, 4).join(', ')} …`);
  }
  if (missingIndustrySamples.length) process.stdout.write(`WARNING: development build without industry recorded Sample (${missingIndustrySamples.length} gaps).\n`);
  const recordingProblems = industryRecordingProblems(industryCatalog, enabledIndustries, recorded);
  if (recordingProblems.length) throw new Error(`Invalid industry recordings:\n${recordingProblems.join('\n')}`);
  // Industry graph (S08/S09): optional private binding plus the graph service's attested schemas.
  const industryGraphConfig = JSON.parse(readFileSync('config/studio-industry-graph.json', 'utf8'));
  const industryGraphPath = process.env.STUDIO_PRIVATE_INDUSTRY_GRAPH, graphAttestationPath = process.env.STUDIO_PRIVATE_INDUSTRY_GRAPH_ATTESTATIONS;
  if (industryGraphPath && !(existsSync(industryGraphPath) && graphAttestationPath && existsSync(graphAttestationPath))) throw new Error('STUDIO_PRIVATE_INDUSTRY_GRAPH requires STUDIO_PRIVATE_INDUSTRY_GRAPH_ATTESTATIONS.');
  const industryGraph = industryGraphPath ? industryGraphFrom(JSON.parse(readFileSync(industryGraphPath, 'utf8')), JSON.parse(readFileSync(graphAttestationPath, 'utf8')), enabledIndustries, industryGraphConfig) : undefined;
  const graphPresetProblems = industryGraphPresetProblems(industryCatalog, industryGraphConfig, Object.keys(industryGraph?.industries || {}));
  if (graphPresetProblems.length) throw new Error(`Industry graph presets don't match:\n${graphPresetProblems.join('\n')}`);
  const industries = { enabled: enabledIndustries, bindings: industryBindings, ...(industryGraph ? { graph: industryGraph } : {}) };
  const matrix = publicBuild ? await verifyPublic(liveConfig, attestations, recorded, notes) : await verifyOffline(liveConfig, attestations, industries);

  rmSync(out, { recursive: true, force: true });
  // Public, static UI. There is no source download route.
  const page = readFileSync('page.html', 'utf8');
  if (page.includes('/download') || !page.includes('/assets/foundry.svg') || !page.includes('rel="icon"')) throw new Error('Public page must link the Foundry logo and favicons and must not expose a source download route.');
  write('public/index.html', pageWithIndustries(page, enabledIndustries));
  write('public/about.html', aboutWithDataSources(readFileSync('about.html', 'utf8'), industryCatalog, enabledIndustries, { graph: !!industries.graph }));
  // Vercel serves public/404.html for unmatched paths; it must stay CSP-clean (external theme loader only).
  const notFound = readFileSync('404.html', 'utf8');
  if (/<script(?![^>]*\bsrc=)|\son[a-z]+=|javascript:/i.test(notFound) || !notFound.includes('href="/"')) {
    throw new Error('404.html must link back to the demo and must not contain inline scripts or event handlers.');
  }
  write('public/404.html', notFound);
  write('public/assets/client.mjs', readFileSync('assets/client.mjs'));
  write('public/assets/header.mjs', readFileSync('assets/header.mjs'));
  write('public/assets/display.mjs', readFileSync('assets/display.mjs'));
  write('public/assets/graph-viz.mjs', readFileSync('assets/graph-viz.mjs'));
  write('public/assets/about.mjs', readFileSync('assets/about.mjs'));
  write('public/assets/styles.css', readFileSync('assets/styles.css'));
  write('public/assets/theme.js', readFileSync('assets/theme.js'));
  // The unchanged Microsoft Foundry mark (assets/PROVENANCE.md) and favicons rendered from that same file.
  write('public/assets/foundry.svg', readFileSync('assets/foundry.svg'));
  write('public/favicon.svg', readFileSync('assets/foundry.svg'));
  write('public/favicon.ico', readFileSync('assets/favicon.ico'));
  write('public/favicon-32.png', readFileSync('assets/favicon-32.png'));
  write('public/apple-touch-icon.png', readFileSync('assets/apple-touch-icon.png'));
  write('public/LICENSE', readFileSync('LICENSE'));
  for (const path of sampleFiles()) write(`public/${path}`, readFileSync(path));
  for (const [image, index] of sampleImages) write(`public/samples/${image}.png`, illustrationPng(index));

  // Server-only modules and private data.
  for (const path of [...SERVER_MODULES, ...serverConfigFiles()]) {
    mkdirSync(dirname(join(out, 'server', path)), { recursive: true });
    copyFileSync(path, join(out, 'server', path));
  }
  write('server/private-data.mjs', '// PRIVATE server-only bindings and schema attestations. Never serve or publish.\n'
    + `export const liveConfig = ${JSON.stringify(liveConfig)};\nexport const attestations = ${JSON.stringify(attestations)};\nexport const industries = ${JSON.stringify(industries)};\n`);
  write('server/recorded-data.mjs', `export const recorded = ${JSON.stringify(recorded)};\n`);
  write('server/notes-data.mjs', `export const notes = ${JSON.stringify(notes)};\n`);
  write('server/app.mjs', "import { createVercelApp } from './lib/vercel-app.mjs';\nimport { liveConfig, attestations, industries } from './private-data.mjs';\nimport { recorded } from './recorded-data.mjs';\nimport { notes } from './notes-data.mjs';\n\nexport const app = createVercelApp({ liveConfig, attestations, recorded, notes, industries });\n");
  for (const { file, route, verb } of API_ROUTES) write(file, apiEntry(route, verb, `${'../'.repeat(file.split('/').length - 1)}server/app.mjs`));
  write('vercel.json', `${JSON.stringify(vercelConfig({ outputDirectory: 'public', serverFiles: 'server/**' }), null, 2)}\n`);
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
  if (publicBuild) process.stdout.write(`Built dist/vercel as the public Sample-only app (${matrix.length} recorded Sample scenario/language pairs, Live unavailable, no industries). Public scan clean. No Azure calls performed.\n`);
  else process.stdout.write(`Built dist/vercel (${matrix.filter(item => item.endsWith('attested')).length} attested live scenario/language pairs, industries: ${enabledIndustries.join(',') || 'none'}, `
    + `${matrix.filter(item => item.endsWith('gated')).length} gated, ${matrix.filter(item => item.endsWith('not_configured')).length} industry graph not configured). Private data SHA-256 ${digest}. Public scan clean. No Azure calls performed.\n`);
}
