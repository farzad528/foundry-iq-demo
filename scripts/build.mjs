import { readFileSync, writeFileSync, mkdirSync, copyFileSync, lstatSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publicCatalog } from '../config/knowledge-bases.mjs';
import { archiveFiles } from './source-files.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
for (const path of archiveFiles) {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`Archive input is not a regular approved file: ${path}`);
}
const python = (process.env.PYTHON ? [process.env.PYTHON] : process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'])
  .find(command => {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
    return result.status === 0 && result.stdout.startsWith('Python 3.');
  });
if (!python) throw new Error('Python 3 is required only at build time to package the sanitized source ZIP. Set PYTHON to its executable path.');
const archive = execFileSync(python, ['-c', `
import zipfile,io,base64,pathlib,json,sys
b=io.BytesIO()
with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
 for name in json.load(sys.stdin):
  info=zipfile.ZipInfo(name,(1980,1,1,0,0,0))
  info.compress_type=zipfile.ZIP_DEFLATED
  info.external_attr=0o100644 << 16
  z.writestr(info,pathlib.Path(name).read_bytes())
print(base64.b64encode(b.getvalue()).decode())
`], { input: JSON.stringify(archiveFiles), maxBuffer: 10 * 1024 * 1024 }).toString().trim();

const fixtures = JSON.parse(readFileSync('config/scenarios.json', 'utf8'));
const catalog = publicCatalog(fixtures);
const html = readFileSync('page.html', 'utf8').replace('__SCENARIOS__', () => JSON.stringify(catalog).replace(/</g, '\\u003c'));
const samples = Object.fromEntries(archiveFiles.filter(path => path.startsWith('samples/')).map(path => ['/' + path, readFileSync(path, 'utf8')]));
const assets = Object.fromEntries(archiveFiles.filter(path => /^assets\/.*\.(?:svg|mjs)$/.test(path)).map(path => [
  '/' + path,
  { type: path.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript; charset=utf-8', body: readFileSync(path, 'utf8') },
]));
const values = {
  '__DATA__': JSON.stringify(catalog),
  '__FIXTURES__': JSON.stringify(Object.fromEntries(fixtures.map(sample => [sample.id, sample.fixture]))),
  '__PAGE__': JSON.stringify(html),
  '__ARCHIVE__': archive,
  '__SAMPLES__': JSON.stringify(samples),
  '__ASSETS__': JSON.stringify(assets),
};
const source = readFileSync('server.template.mjs', 'utf8').replace(/__DATA__|__FIXTURES__|__PAGE__|__ARCHIVE__|__SAMPLES__|__ASSETS__/g, match => values[match]);
mkdirSync('dist/server/lib', { recursive: true });
for (const file of ['protocol.mjs', 'normalize.mjs', 'quota.mjs', 'http.mjs']) copyFileSync('lib/' + file, 'dist/server/lib/' + file);
writeFileSync('dist/server/index.mjs', source);
writeFileSync('dist/server/package.json', JSON.stringify({ type: 'module' }));
writeFileSync('dist/source.zip', Buffer.from(archive, 'base64'));
process.stdout.write('Built precompiled Node handler and allowlisted, reproducible source ZIP. No Azure calls performed.\n');
