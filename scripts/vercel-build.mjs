// Vercel Git build (npm run build:vercel, the buildCommand in vercel.json). The private build inputs (Search bindings, schema attestations and graph
// bindings) stay out of Git: the owner packs them into one gzip+base64 value, STUDIO_PRIVATE_BUNDLE, stored as a Production
// Secret in the Vercel project. This script unpacks it into a temporary directory outside the checkout, runs the normal
// build (scripts/build-vercel.mjs, including its public-output scan) and deletes the files. Without the bundle it builds the
// public Sample-only app, except for production, which fails so a deployment never silently drops Live and industries.
//
// Owner: node scripts/vercel-build.mjs --pack <file outside the repo>   (reads the STUDIO_PRIVATE_* paths; see OPERATIONS)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Marks the dist/vercel built for one Vercel deployment, so a repeated build command in the same deployment is skipped.
const STAMP = join(ROOT, 'dist', '.vercel-build-stamp');
// Vercel allows 64 KB of environment variables per deployment, all variables combined.
export const MAX_BUNDLE_CHARS = 56 * 1024;
const MAX_UNPACKED_BYTES = 8 * 1024 * 1024;
const FILES = Object.freeze({
  bindings: 'STUDIO_PRIVATE_BINDINGS',
  attestations: 'STUDIO_PRIVATE_ATTESTATIONS',
  graph: 'STUDIO_PRIVATE_GRAPH',
  industryBindings: 'STUDIO_PRIVATE_INDUSTRIES',
  industryGraph: 'STUDIO_PRIVATE_INDUSTRY_GRAPH',
  industryGraphAttestations: 'STUDIO_PRIVATE_INDUSTRY_GRAPH_ATTESTATIONS',
});
const REQUIRED = ['bindings', 'attestations', 'graph'];
// Build switches that only development builds may set; a Git build never inherits them.
const BUILD_ENV = [...Object.values(FILES), 'STUDIO_INDUSTRIES', 'STUDIO_RECORDED_OPTIONAL', 'STUDIO_NOTES_OPTIONAL', 'STUDIO_INDUSTRY_SAMPLES_OPTIONAL'];

const fail = message => { throw new Error(`STUDIO_PRIVATE_BUNDLE: ${message}`); };

/** Packs private build inputs ({ bindings: jsonText, ... }) and the industry list into the STUDIO_PRIVATE_BUNDLE value. */
export function packPrivateBundle(files, industries = '') {
  const minified = Object.fromEntries(Object.entries(files).filter(([, text]) => text !== undefined)
    .map(([name, text]) => [name, JSON.stringify(JSON.parse(text))]));
  const value = gzipSync(Buffer.from(JSON.stringify({ version: 1, industries, files: minified })), { level: 9 }).toString('base64');
  return checkBundle(value);
}

/** Decodes and validates a STUDIO_PRIVATE_BUNDLE value without logging any of it. */
export function unpackPrivateBundle(value) {
  checkBundle(value);
  let bundle;
  try {
    bundle = JSON.parse(gunzipSync(Buffer.from(value, 'base64'), { maxOutputLength: MAX_UNPACKED_BYTES }).toString('utf8'));
  } catch { fail('is not a valid packed bundle. Re-create it with node scripts/vercel-build.mjs --pack.'); }
  if (bundle?.version !== 1 || typeof bundle.files !== 'object' || bundle.files === null) fail('has an unsupported format.');
  const industries = typeof bundle.industries === 'string' ? bundle.industries : '';
  if (!/^[a-z]+(,[a-z]+)*$|^$/.test(industries)) fail('lists invalid industry IDs.');
  for (const name of Object.keys(bundle.files)) if (!(name in FILES)) fail(`contains an unexpected file (${name}).`);
  for (const name of REQUIRED) if (typeof bundle.files[name] !== 'string') fail(`is missing ${name}.`);
  if (industries && typeof bundle.files.industryBindings !== 'string') fail('lists industries without industryBindings.');
  if ((typeof bundle.files.industryGraph === 'string') !== (typeof bundle.files.industryGraphAttestations === 'string')) {
    fail('needs industryGraph and industryGraphAttestations together.');
  }
  for (const [name, text] of Object.entries(bundle.files)) {
    try { JSON.parse(text); } catch { fail(`${name} is not valid JSON.`); }
  }
  return { industries, files: bundle.files };
}

function checkBundle(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.trim())) fail('must be base64 text.');
  if (value.length > MAX_BUNDLE_CHARS) fail(`is ${value.length} characters; keep it under ${MAX_BUNDLE_CHARS} (Vercel's 64 KB environment limit).`);
  return value;
}

/**
 * Child environment for scripts/build-vercel.mjs: the unpacked file paths, or none (public Sample-only build).
 * Production (VERCEL_ENV=production) without a bundle is refused.
 */
export function buildEnvironment(env, directory) {
  const child = { ...env };
  for (const name of [...BUILD_ENV, 'STUDIO_PRIVATE_BUNDLE']) delete child[name];
  if (!env.STUDIO_PRIVATE_BUNDLE) {
    if (env.VERCEL_ENV === 'production') {
      fail('is not set for this production build. Add it as a Production Secret (docs/OPERATIONS.md); refusing to deploy the Sample-only app to production.');
    }
    return { env: child, private: false };
  }
  const { industries, files } = unpackPrivateBundle(env.STUDIO_PRIVATE_BUNDLE);
  for (const [name, text] of Object.entries(files)) {
    const path = join(directory, `${name}.json`);
    writeFileSync(path, text, { mode: 0o600 });
    child[FILES[name]] = path;
  }
  if (industries) child.STUDIO_INDUSTRIES = industries;
  return { env: child, private: true };
}

/** Identifies one deployment's build inputs (a hash only), or null outside a Vercel deployment build. */
export function buildStamp(env) {
  if (!env.VERCEL_DEPLOYMENT_ID) return null;
  return createHash('sha256').update(`${env.VERCEL_DEPLOYMENT_ID}\0${env.VERCEL_ENV || ''}\0${env.STUDIO_PRIVATE_BUNDLE || ''}`).digest('hex');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === '--pack') {
      const target = process.argv[3];
      if (!target) fail('usage: node scripts/vercel-build.mjs --pack <output file outside the repository>');
      if (pathToFileURL(target).href.startsWith(pathToFileURL(ROOT).href)) fail('write the packed value outside the repository.');
      const files = Object.fromEntries(Object.entries(FILES).filter(([, variable]) => process.env[variable])
        .map(([name, variable]) => [name, readFileSync(process.env[variable], 'utf8')]));
      for (const name of REQUIRED) if (!files[name]) fail(`set ${FILES[name]} to pack it.`);
      const value = packPrivateBundle(files, process.env.STUDIO_INDUSTRIES || '');
      writeFileSync(target, value, { mode: 0o600 });
      process.stdout.write(`Packed ${Object.keys(files).length} private build inputs (${value.length} characters) into ${target}. Store it as the Production Secret STUDIO_PRIVATE_BUNDLE, then delete the file.\n`);
    } else {
      const stamp = buildStamp(process.env);
      if (stamp && existsSync(STAMP) && readFileSync(STAMP, 'utf8') === stamp && existsSync(join(ROOT, 'dist', 'vercel', 'server', 'app.mjs'))) {
        process.stdout.write('Vercel build: dist/vercel is already built for this deployment; skipping the repeated build.\n');
      } else {
        rmSync(STAMP, { force: true });
        const directory = mkdtempSync(join(tmpdir(), 'studio-private-'));
        try {
          const { env, private: isPrivate } = buildEnvironment(process.env, directory);
          process.stdout.write(isPrivate ? 'Vercel build: private inputs unpacked from STUDIO_PRIVATE_BUNDLE.\n'
            : 'Vercel build: STUDIO_PRIVATE_BUNDLE is not set; building the public Sample-only app.\n');
          const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build-vercel.mjs')], { cwd: ROOT, env, stdio: 'inherit' });
          if (result.status !== 0) process.exitCode = result.status ?? 1;
          else if (stamp) { mkdirSync(join(ROOT, 'dist'), { recursive: true }); writeFileSync(STAMP, stamp); }
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      }
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
