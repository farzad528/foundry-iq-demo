// Validates the built dist/vercel artifact without contacting Azure: layout, security headers, public-output hygiene,
// and the built app answering health, catalog and a recorded Sample through the local server.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalServer } from './serve.mjs';

const dir = fileURLToPath(new URL('../dist/vercel', import.meta.url));
const files = (root, prefix = '') => readdirSync(join(root, prefix)).flatMap(name => {
  const path = prefix ? `${prefix}/${name}` : name;
  return statSync(join(root, path)).isDirectory() ? files(root, path) : [path];
});
assert.ok(existsSync(dir), 'dist/vercel is missing. Run npm run build first.');
for (const path of ['vercel.json', 'package.json', '.vercelignore', 'server/app.mjs', 'server/private-data.mjs', 'server/recorded-data.mjs', 'server/notes-data.mjs',
  'api/scenarios.mjs', 'api/health.mjs', 'api/demo/prepare.mjs', 'api/demo/run.mjs', 'public/index.html', 'public/about.html', 'public/404.html',
  'public/assets/client.mjs', 'public/assets/foundry.svg', 'public/favicon.ico']) assert.ok(existsSync(join(dir, path)), `missing ${path}`);

// Security headers and routing: CSP without inline scripts, no framing, HSTS; the four API functions only.
const vercel = JSON.parse(readFileSync(join(dir, 'vercel.json'), 'utf8'));
const headers = Object.fromEntries(vercel.headers[0].headers.map(({ key, value }) => [key, value]));
assert.equal(vercel.headers[0].source, '/(.*)');
assert.match(headers['Content-Security-Policy'], /default-src 'none'; script-src 'self';/);
assert.doesNotMatch(headers['Content-Security-Policy'], /script-src[^;]*'unsafe-(?:inline|eval)'/);
assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
assert.equal(headers['X-Frame-Options'], 'DENY');
assert.equal(headers['X-Content-Type-Options'], 'nosniff');
assert.match(headers['Strict-Transport-Security'], /max-age=\d+/);
assert.deepEqual(files(dir, 'api').sort(), ['api/demo/prepare.mjs', 'api/demo/run.mjs', 'api/health.mjs', 'api/scenarios.mjs']);

// Public output: static files only, no server modules, private data, source archives or inline scripts.
const publicFiles = files(join(dir, 'public'));
assert.ok(publicFiles.every(path => !/^(?:server|lib|config)\/|\.zip$|private|attestation/i.test(path)), 'public/ contains server-only files');
for (const page of publicFiles.filter(path => path.endsWith('.html'))) {
  const html = readFileSync(join(dir, 'public', page), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)|\son[a-z]+=|javascript:/i, `${page} has an inline script or handler`);
  assert.ok(!html.includes('/download'), `${page} links a source download`);
}
const publicText = publicFiles.filter(path => /\.(?:html|mjs|js|css|json|md|csv|svg)$/.test(path)).map(path => readFileSync(join(dir, 'public', path), 'utf8')).join('\n');
assert.doesNotMatch(publicText, /indexETag|search-schema-attestations|AZURE_SEARCH_(?:QUERY|API)_KEY|AccountKey=|SharedAccessSignature/);

// The built app through the local server: health, catalog, a recorded Sample and the 404 page. Live is off (no variables).
const server = await createLocalServer({ dir, env: {} });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.ok((await page.text()).includes('id="scenario"'));
  const catalog = await (await fetch(`${origin}/api/scenarios`)).json();
  assert.equal(catalog.scenarios.length, 11);
  const s03 = catalog.scenarios.find(item => item.id === 'S03');
  const run = await fetch(`${origin}/api/demo/run`, { method: 'POST', headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ scenarioId: 'S03', mode: 'sample', query: s03.demoPresets[0].query, topK: 10, language: 'en' }) });
  const result = await run.json();
  assert.equal(run.status, 200);
  assert.ok(result.recorded && result.baseline && result.enhanced, 'recorded Sample replays');
  assert.equal((await fetch(`${origin}/download`)).status, 404);
} finally {
  server.closeAllConnections();
  server.close();
}
process.stdout.write(`Artifact valid: ${publicFiles.length} public files, 4 API functions, security headers and CSP, recorded Sample served locally; no Azure calls performed.\n`);
