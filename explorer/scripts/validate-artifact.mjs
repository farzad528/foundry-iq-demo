import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const { default: application } = await import('../dist/server/index.mjs');
assert.equal(typeof application.fetch, 'function');
for (const legacy of ['worker/index.js', 'dist/server/index.js', 'dist/.openai/hosting.json']) assert.equal(existsSync(legacy), false);
const origin = 'https://demo.example.test';
const page = await (await application.fetch(new Request(origin), { PUBLIC_ORIGIN: origin })).text();
assert.ok(page.includes('grid-template-columns:272px minmax(0,1fr) 350px'));
const python = (process.env.PYTHON ? [process.env.PYTHON] : ['python', 'python3'])
  .find(command => {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
    return result.status === 0 && result.stdout.startsWith('Python 3.');
  });
assert.ok(python);
const entries = JSON.parse(execFileSync(python, ['-c', `
import json,zipfile
with zipfile.ZipFile('dist/source.zip') as z:
 names=z.namelist()
 assert all(not n.startswith('/') and '..' not in n.split('/') for n in names)
 assert not any(n.endswith(('.env.local','.log')) or n.startswith(('dist/','node_modules/','worker/','infra/')) for n in names)
 for n in names:
  assert z.getinfo(n).date_time==(1980,1,1,0,0,0)
 print(json.dumps(names))
`]).toString());
assert.ok(entries.includes('package-lock.json') && entries.includes('assets/PROVENANCE.md'));
assert.ok(entries.every(name => !/quota.*\.json|deployment|hosting\.json/.test(name)));
const before = readFileSync('dist/server/index.mjs');
const { createNodeServer } = await import('../lib/http.mjs');
const server = createNodeServer(application, { PUBLIC_ORIGIN: origin, FOUNDRY_IQ_LIVE_ENABLED: 'false' });
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).liveEnabled, false);
  assert.deepEqual(before, readFileSync('dist/server/index.mjs'));
} finally {
  server.closeAllConnections();
  server.close();
}
process.stdout.write(`Artifact valid: prebuilt ESM, health endpoint, ${entries.length} allowlisted ZIP files; no Azure retrieval performed.\n`);
