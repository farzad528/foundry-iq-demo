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

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const out = join(root, 'dist', 'vercel');
const VECTORIZER = 'zava-text-vectorizer';
const IMAGE_VECTORIZER = 'zava-image-vectorizer';
// Verified on foundry-iq-demos: knowledgeRetrieval=standard; agentic canaries complete well within 10 s in all five languages.
const AGENTIC_MAX_RUNTIME_SECONDS = 10;
const LANGUAGES = ['en', 'fr', 'es', 'ja', 'de'];

export function transformBindings(bindings, attestations) {
  const etags = new Map(attestations.entries.map(entry => [entry.index, entry.etag]));
  const next = structuredClone(bindings);
  const used = new Set();
  const changed = new Set(attestations.capture?.vectorizerUpdate?.changedIndexes || []);
  const visit = scenarios => {
    for (const [id, config] of Object.entries(scenarios)) {
      for (const [nameKey, etagKey] of [['index', 'indexETag'], ['standardIndex', 'standardIndexETag'], ['projectionIndex', 'projectionIndexETag']]) {
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

export function reduceAttestations(attestations, used) {
  return { service: attestations.service, apiVersion: attestations.apiVersion,
    entries: attestations.entries.filter(entry => used.has(entry.index)).map(({ index, etag, schema }) => ({ index, etag, schema })) };
}

async function verifyOffline(liveConfig, attestations) {
  const { createVercelApp } = await import(pathToFileURL(join(root, 'lib', 'vercel-app.mjs')));
  const { LIVE_SCENARIOS } = await import(pathToFileURL(join(root, 'lib', 'search-adapter.mjs')));
  const app = createVercelApp({ liveConfig, attestations, log: () => {},
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
  return matrix;
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
  if (!bindingsPath || !attestationsPath || !existsSync(bindingsPath) || !existsSync(attestationsPath)) {
    throw new Error('Set STUDIO_PRIVATE_BINDINGS and STUDIO_PRIVATE_ATTESTATIONS to the private studio-live-config.json and search-schema-attestations.json files.');
  }
  const bindings = JSON.parse(readFileSync(bindingsPath, 'utf8'));
  const fullAttestations = JSON.parse(readFileSync(attestationsPath, 'utf8'));
  const { config: liveConfig, used } = transformBindings(bindings, fullAttestations);
  const attestations = reduceAttestations(fullAttestations, used);
  // Recorded Sample (verified Live responses, request IDs removed) must cover every scenario in every language.
  const recorded = existsSync('config/studio-recorded.json') ? JSON.parse(readFileSync('config/studio-recorded.json', 'utf8')) : { entries: {} };
  const missingSamples = LANGUAGES.flatMap(language => Array.from({ length: 11 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`)
    .filter(id => !Object.values(recorded.entries).some(entry => entry.language === language && entry.scenarioId === id)).map(id => `${language}:${id}`));
  if (missingSamples.length && process.env.STUDIO_RECORDED_OPTIONAL !== '1') throw new Error(`Recorded Sample coverage is incomplete: ${missingSamples.join(', ')}`);
  if (missingSamples.length) process.stdout.write(`WARNING: development build without complete recorded Sample coverage (${missingSamples.length} gaps).\n`);
  if (/requestId|"runId"|api-key/i.test(JSON.stringify(recorded))) throw new Error('Recorded Sample data must not contain request IDs or credentials.');
  const matrix = await verifyOffline(liveConfig, attestations);

  rmSync(out, { recursive: true, force: true });
  // Public, static UI. The source download link is removed in this build.
  const fixtures = JSON.parse(readFileSync('config/scenarios.json', 'utf8'));
  const catalog = publicCatalog(fixtures);
  const page = readFileSync('page.html', 'utf8').replace('__SCENARIOS__', () => JSON.stringify(catalog).replace(/</g, '\\u003c'));
  if (page.includes('/download') || !page.includes('/assets/foundry.svg') || !page.includes('rel="icon"')) throw new Error('Public page must link the Foundry logo and favicons and must not expose the source download route.');
  write('public/index.html', page);
  write('public/about.html', readFileSync('about.html'));
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
  for (const path of ['lib/protocol.mjs', 'lib/normalize.mjs', 'lib/studio.mjs', 'lib/search-adapter.mjs', 'lib/vercel-app.mjs',
    ...archiveFiles.filter(path => /^config\/studio-(?!live\.example|recorded).*\.(?:mjs|json)$/.test(path))]) {
    mkdirSync(dirname(join(out, 'server', path)), { recursive: true });
    copyFileSync(path, join(out, 'server', path));
  }
  write('server/private-data.mjs', '// PRIVATE server-only bindings and schema attestations. Never serve or publish.\n'
    + `export const liveConfig = ${JSON.stringify(liveConfig)};\nexport const attestations = ${JSON.stringify(attestations)};\n`);
  write('server/recorded-data.mjs', `export const recorded = ${JSON.stringify(recorded)};\n`);
  write('server/app.mjs', "import { createVercelApp } from './lib/vercel-app.mjs';\nimport { liveConfig, attestations } from './private-data.mjs';\nimport { recorded } from './recorded-data.mjs';\n\nexport const app = createVercelApp({ liveConfig, attestations, recorded });\n");
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
    ['private bindings marker', /indexETag|projectionIndexETag|corpusHash|evidenceVersion/],
    ['attestation marker', /INTERNAL deployment metadata|"etag"\s*:|search-schema-attestations/],
    ['server environment name', /AZURE_SEARCH_QUERY_KEY|AZURE_SEARCH_API_KEY|LIVE_ENABLED/],
    ['credential-shaped value', /\bapi-key\s*[:=]\s*["'][A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|AccountKey=|SharedAccessSignature|sig=[A-Za-z0-9%]{20,}/],
    ['vectorizer endpoint', /openai\.azure\.com/],
  ]);
  if (findings.length) throw new Error(`Public output scan failed:\n${findings.join('\n')}`);
  const digest = createHash('sha256').update(readFileSync(join(out, 'server/private-data.mjs'))).digest('hex');
  process.stdout.write(`Built dist/vercel (${matrix.filter(item => item.endsWith('attested')).length} attested live scenario/language pairs, `
    + `${matrix.filter(item => item.endsWith('gated')).length} gated). Private data SHA-256 ${digest}. Public scan clean. No Azure calls performed.\n`);
}
