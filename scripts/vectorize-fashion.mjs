// Offline ingest step for the fashion industry index: embeds each prepared product image with the same Azure Vision
// multimodal model the index's query vectorizer uses, then merges { id, imageVector } into the index.
// Used where the Search service's region has no Vision VectorizeSkill, so an indexer can't embed images.
// Credentials come only from the environment and are never written anywhere. The Vision call uses a Microsoft Entra
// token (the resource disables keys): az account get-access-token --resource https://cognitiveservices.azure.com
//
//   AZURE_VISION_ENDPOINT=https://<vision>.cognitiveservices.azure.com AZURE_VISION_TOKEN=... \
//   AZURE_SEARCH_ENDPOINT=https://<search>.search.windows.net AZURE_SEARCH_ADMIN_KEY=... \
//   node scripts/vectorize-fashion.mjs --manifest <subset>/manifest.json --images <512px jpg dir> --index <index-name>
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_VERSION = '2023-04-15';
const VISION_API_VERSION = '2024-02-01';
const SEARCH_API_VERSION = '2025-09-01';
const DIMENSIONS = 1024;
const BATCH = 100;
const CONCURRENCY = 4;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function call(url, init, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, init);
    if (response.ok) return response.json();
    // Offline ingest only: back off on throttling. The runtime never retries.
    if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
      await sleep(Number(response.headers.get('retry-after')) * 1000 || 2000 * attempt);
      continue;
    }
    throw new Error(`${new URL(url).pathname} failed with HTTP ${response.status}`);
  }
}

async function main() {
  const options = {};
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 2) options[argv[index].replace(/^--/, '')] = argv[index + 1];
  const env = name => process.env[name] || (() => { throw new Error(`Set ${name}.`); })();
  const vision = env('AZURE_VISION_ENDPOINT').replace(/\/+$/, '');
  const search = env('AZURE_SEARCH_ENDPOINT').replace(/\/+$/, '');
  if (!options.manifest || !options.images || !options.index) throw new Error('Usage: --manifest <file> --images <dir> --index <name>');
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8'));
  const entries = Object.entries(manifest.products);
  const vectors = [];
  let next = 0;
  async function worker() {
    while (next < entries.length) {
      const [id, sha256] = entries[next++];
      const image = await readFile(path.join(options.images, `${id}.jpg`));
      if (sha256 && createHash('sha256').update(image).digest('hex') !== sha256) throw new Error(`${id}: image does not match the manifest.`);
      const { vector } = await call(`${vision}/computervision/retrieval:vectorizeImage?api-version=${VISION_API_VERSION}&model-version=${MODEL_VERSION}`, {
        method: 'POST', headers: { Authorization: `Bearer ${env('AZURE_VISION_TOKEN')}`, 'Content-Type': 'application/octet-stream' }, body: image,
      });
      if (!Array.isArray(vector) || vector.length !== DIMENSIONS) throw new Error(`${id}: unexpected vector.`);
      vectors.push({ '@search.action': 'merge', id, imageVector: vector });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  let merged = 0;
  for (let start = 0; start < vectors.length; start += BATCH) {
    const result = await call(`${search}/indexes/${encodeURIComponent(options.index)}/docs/index?api-version=${SEARCH_API_VERSION}`, {
      method: 'POST', headers: { 'api-key': env('AZURE_SEARCH_ADMIN_KEY'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: vectors.slice(start, start + BATCH) }),
    });
    const failed = result.value.filter(item => !item.status);
    if (failed.length) throw new Error(`${failed.length} merges failed, first: ${failed[0].key}`);
    merged += result.value.length;
  }
  console.log(`Embedded and merged ${merged} of ${entries.length} image vectors (model ${MODEL_VERSION}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
