import { readFile, readdir, lstat } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, sep } from 'node:path';
import { root, outsideOutput, parseArgs, OperatorError, isMain, reportFailure } from './provision-search.mjs';

export async function runtimeFiles(workspace = root) {
  const files = new Set();
  const add = async path => {
    const entry = await lstat(join(workspace, path));
    if (!entry.isFile() || entry.isSymbolicLink()) throw new OperatorError('Runtime input must be a regular non-symlink file.');
    files.add(path.split(sep).join('/'));
  };
  const walk = async path => {
    const stat = await lstat(join(workspace, path));
    if (stat.isSymbolicLink()) throw new OperatorError('Runtime packaging refuses symlinks.');
    if (stat.isFile()) return add(path);
    if (!stat.isDirectory()) throw new OperatorError('Unsupported runtime input.');
    for (const entry of await readdir(join(workspace, path))) {
      if (entry !== 'node_modules') await walk(join(path, entry));
    }
  };
  for (const path of ['package.json', 'package-lock.json', 'scripts/start.mjs', 'dist/source.zip']) await add(path);
  for (const path of ['dist/server/index.mjs', 'dist/server/package.json']) await add(path);
  for (const name of ['http.mjs', 'protocol.mjs', 'normalize.mjs', 'quota.mjs', 'report-pages.mjs']) {
    await add(join('lib', name));
    await add(join('dist/server/lib', name));
  }
  const lock = JSON.parse(await readFile(join(workspace, 'package-lock.json'), 'utf8'));
  if (!lock.packages || lock.lockfileVersion < 2) throw new OperatorError('A complete npm lockfile is required.');
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || entry.dev || entry.devOptional) continue;
    if (!/^node_modules\/(?:[@a-zA-Z0-9_.-]+\/)*[@a-zA-Z0-9_.-]+$/.test(path)
      || path.split('/').some(part => part === '.' || part === '..') || entry.link) {
      throw new OperatorError('The production lockfile contains an unsupported package path/link.');
    }
    const installed = JSON.parse(await readFile(join(workspace, path, 'package.json'), 'utf8'));
    if (installed.version !== entry.version) throw new OperatorError('Installed production dependencies differ from the lockfile; run npm ci before packaging.');
    await walk(path);
  }
  const sorted = [...files].sort();
  if (!sorted.includes('dist/server/index.mjs') || !sorted.some(path => path.startsWith('node_modules/@azure/identity/'))
    || !sorted.some(path => path.startsWith('node_modules/@azure/storage-blob/'))
    || sorted.some(path => path.split('/').some(part => part.startsWith('.env'))
      || /^(?:infra|\.git|\.github|config|samples)\//.test(path))) {
    throw new OperatorError('Runtime allowlist is incomplete or includes a forbidden source/state path.');
  }
  for (const name of ['http.mjs', 'protocol.mjs', 'normalize.mjs', 'quota.mjs', 'report-pages.mjs']) {
    const [source, built] = await Promise.all([readFile(join(workspace, 'lib', name)), readFile(join(workspace, 'dist/server/lib', name))]);
    if (!source.equals(built)) throw new OperatorError('Prebuilt libraries differ from source; rebuild before packaging.');
  }
  return sorted;
}

export async function packageRuntime({ output, workspace = root, python = process.env.PYTHON } = {}) {
  const files = await runtimeFiles(workspace);
  if (!output) return { dryRun: true, azureCalls: 0, files: files.length, startup: 'npm start', pythonAtStartup: false };
  const target = await outsideOutput(output, workspace);
  const executable = (python ? [python] : process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'])
    .find(command => {
      const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
      return result.status === 0 && result.stdout.startsWith('Python 3.');
    });
  if (!executable) throw new OperatorError('Python 3 is needed only to create the local deployment ZIP.');
  execFileSync(executable, ['-c', `
import json,pathlib,stat,sys,zipfile
base=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'x',zipfile.ZIP_DEFLATED) as archive:
 for name in json.load(sys.stdin):
  path=base/name
  if not path.is_file() or path.is_symlink():
   raise ValueError('Unsafe runtime archive input')
  entry=zipfile.ZipInfo(name,(1980,1,1,0,0,0))
  entry.compress_type=zipfile.ZIP_DEFLATED
  entry.external_attr=0o100644 << 16
  archive.writestr(entry,path.read_bytes())
`, workspace, target], { input: JSON.stringify(files), stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 });
  return { packaged: true, azureCalls: 0, output: target, files: files.length, startup: 'npm start', pythonAtStartup: false };
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2), [], ['--output']);
    process.stdout.write(JSON.stringify(await packageRuntime({ output: args['--output'] })) + '\n');
  } catch (error) { reportFailure(error); }
}
