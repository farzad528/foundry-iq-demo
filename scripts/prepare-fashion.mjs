// Offline preparation of the Fashion Product Images industry corpus (no network and no Azure calls).
// Reads the dataset's styles.csv, selects a deterministic, filtered subset and writes one readable JSON per
// product (products/fpi-<id>.json) plus manifest.json. Image resizing (512 px JPEG for embedding, 256 px WebP
// thumbnails) and the manual image review happen outside this script; pass --images to hash the prepared JPEGs.
//
//   node scripts/prepare-fashion.mjs --styles <styles.csv> --out <dir> [--images <dir>] [--size 3000] [--cap 150] [--seed fashion-v1]
//                                    [--exclude <ids.txt>] [--source <text>] [--license <text>] [--image-model <name>]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COLUMNS = ['id', 'gender', 'masterCategory', 'subCategory', 'articleType', 'baseColour', 'season', 'year', 'usage', 'productDisplayName'];
const GENDERS = new Set(['Men', 'Women', 'Unisex']);
const MASTER_CATEGORIES = new Set(['Apparel', 'Footwear', 'Accessories']);
// Sensitive model imagery is excluded by category; minors are excluded by gender (Boys, Girls).
const EXCLUDED_SUBCATEGORIES = new Set(['Innerwear', 'Loungewear and Nightwear']);
const SEASONS = new Set(['Summer', 'Fall', 'Winter', 'Spring']);
const USAGES = new Set(['Casual', 'Ethnic', 'Formal', 'Sports', 'Smart Casual', 'Travel', 'Party', 'Home']);

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const sha256 = data => createHash('sha256').update(data).digest('hex');

/** Parses styles.csv. Unquoted commas inside productDisplayName (the last column) are kept as part of the name. */
export function parseStyles(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  const header = splitCsv(lines.shift() || '').map(clean);
  if (COLUMNS.some((column, index) => header[index] !== column)) throw new Error(`styles.csv must start with: ${COLUMNS.join(',')}`);
  return lines.map(line => {
    const cells = splitCsv(line);
    const last = COLUMNS.length - 1;
    const values = [...cells.slice(0, last), cells.slice(last).join(',')];
    return Object.fromEntries(COLUMNS.map((column, index) => [column, clean(values[index])]));
  });
}

function splitCsv(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted && char === '"' && line[index + 1] === '"') { cell += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += char;
  }
  cells.push(cell);
  return cells;
}

/** Why a row is excluded, or null when it is eligible. */
export function exclusionReason(row) {
  if (!/^\d{1,9}$/.test(row.id)) return 'invalid-id';
  if (!GENDERS.has(row.gender)) return 'gender';
  if (!MASTER_CATEGORIES.has(row.masterCategory)) return 'category';
  if (EXCLUDED_SUBCATEGORIES.has(row.subCategory)) return 'sensitive-subcategory';
  if (!row.productDisplayName || !row.articleType || !row.baseColour) return 'missing-field';
  return null;
}

/** Normalized search document for one row. Display values stay exact; nothing is invented. */
export function toProductDocument(row, { source, license, imageSha256 } = {}) {
  const year = /^\d{4}$/.test(row.year) ? Number(row.year) : null;
  const season = SEASONS.has(row.season) ? row.season : null;
  const usage = USAGES.has(row.usage) ? row.usage : null;
  const id = `fpi-${row.id}`;
  const who = { Men: "Men's", Women: "Women's", Unisex: 'Unisex' }[row.gender];
  const content = [`${who} ${row.baseColour.toLowerCase()} ${row.articleType.toLowerCase()}`, row.subCategory, usage, [season, year].filter(Boolean).join(' ')]
    .filter(Boolean).join(' · ');
  return {
    id,
    title: row.productDisplayName,
    content,
    gender: row.gender,
    masterCategory: row.masterCategory,
    subCategory: row.subCategory || null,
    articleType: row.articleType,
    baseColour: row.baseColour,
    season,
    year,
    usage,
    // Derived from year only; used for date sorting, not as a real release date.
    collectionDate: year ? `${year}-01-01T00:00:00Z` : null,
    thumbnailUrl: `/datasets/fashion/thumbs/${id}.webp`,
    image: { blob: `images/${id}.jpg`, ...(imageSha256 ? { sha256: imageSha256 } : {}) },
    scope: 'public',
    variant: 'primary',
    ...(source ? { source } : {}),
    ...(license ? { license } : {}),
  };
}

/**
 * Deterministic stratified subset: eligible rows are de-duplicated on (articleType, name, colour), ordered by a
 * seeded hash, capped per articleType, then taken round-robin across articleType × gender so no type dominates.
 */
export function selectProducts(rows, { size = 3000, cap = 150, seed = 'fashion-v1', exclude = new Set(), hasImage = () => true } = {}) {
  const excluded = {};
  const seen = new Set();
  const eligible = [];
  // Rows are visited by numeric ID so the lowest ID of a duplicate group is kept regardless of file order.
  for (const row of [...rows].sort((a, b) => (Number(a.id) - Number(b.id)) || a.id.localeCompare(b.id))) {
    const reason = exclude.has(row.id) ? 'manual-review' : exclusionReason(row) || (hasImage(row.id) ? null : 'missing-image');
    const duplicate = !reason && [row.articleType, row.productDisplayName.toLowerCase(), row.baseColour].join('\u0000');
    if (reason || seen.has(duplicate)) { excluded[reason || 'duplicate'] = (excluded[reason || 'duplicate'] || 0) + 1; continue; }
    seen.add(duplicate);
    eligible.push(row);
  }
  const order = row => sha256(`${seed}:${row.id}`);
  const groups = new Map();
  for (const row of eligible.sort((a, b) => order(a).localeCompare(order(b)))) {
    const key = `${row.articleType}\u0000${row.gender}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const perType = new Map();
  const queues = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, list]) => list);
  const selected = [];
  while (selected.length < size && queues.some(queue => queue.length)) {
    for (const queue of queues) {
      if (selected.length >= size) break;
      const row = queue.shift();
      if (!row) continue;
      const count = perType.get(row.articleType) || 0;
      if (count >= cap) continue;
      perType.set(row.articleType, count + 1);
      selected.push(row);
    }
  }
  return { selected: selected.sort((a, b) => Number(a.id) - Number(b.id)), excluded, eligible: eligible.length };
}

/** Manifest whose hash pins the selected IDs and, when known, their embedding-image hashes (imageManifestHash). */
export function buildManifest(documents, { seed, size, cap }) {
  const entries = documents.map(document => [document.id, document.image.sha256 || null]);
  const imageManifestHash = sha256(entries.map(([id, hash]) => `${id}:${hash ?? ''}`).join('\n'));
  return { seed, size, cap, count: documents.length, imagesHashed: entries.every(([, hash]) => hash), imageManifestHash, products: Object.fromEntries(entries) };
}

function args(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith('--') || argv[index + 1] === undefined) throw new Error(`Unexpected argument: ${argv[index]}`);
    options[argv[index].slice(2)] = argv[index + 1];
  }
  return options;
}

async function main() {
  const options = args(process.argv.slice(2));
  if (!options.styles || !options.out) throw new Error('Usage: node scripts/prepare-fashion.mjs --styles <styles.csv> --out <dir> [--images <dir>]');
  const size = Number(options.size ?? 3000);
  const cap = Number(options.cap ?? 150);
  const seed = options.seed ?? 'fashion-v1';
  if (!Number.isInteger(size) || size < 1 || !Number.isInteger(cap) || cap < 1) throw new Error('--size and --cap must be positive integers.');
  const exclude = new Set(options.exclude ? (await readFile(options.exclude, 'utf8')).split(/\r?\n/).map(clean).filter(Boolean) : []);
  const images = new Map();
  const hasImage = id => !options.images || images.has(id);
  if (options.images) {
    const { readdir } = await import('node:fs/promises');
    for (const file of await readdir(options.images)) {
      const match = /^(?:fpi-)?(\d+)\.jpg$/.exec(file);
      if (match) images.set(match[1], path.join(options.images, file));
    }
  }
  const rows = parseStyles(await readFile(options.styles, 'utf8'));
  const { selected, excluded, eligible } = selectProducts(rows, { size, cap, seed, exclude, hasImage });
  const documents = [];
  for (const row of selected) {
    const imageSha256 = images.has(row.id) ? sha256(await readFile(images.get(row.id))) : undefined;
    documents.push(toProductDocument(row, { source: options.source, license: options.license, imageSha256 }));
  }
  const manifest = { ...buildManifest(documents, { seed, size, cap }), rows: rows.length, eligible, excluded };
  // The S11 corpus contract (same fields Zava S11 checks): written only when every embedding image was hashed.
  const corpus = manifest.imagesHashed
    ? { imageModel: options['image-model'] ?? 'azure-vision-multimodal', imageModelVersion: '2023-04-15', imageDimensions: 1024, imageManifestHash: manifest.imageManifestHash }
    : {};
  await mkdir(path.join(options.out, 'products'), { recursive: true });
  for (const document of documents) await writeFile(path.join(options.out, 'products', `${document.id}.json`), `${JSON.stringify({ ...document, ...corpus }, null, 2)}\n`);
  await writeFile(path.join(options.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Prepared ${documents.length} of ${rows.length} products (${eligible} eligible). imageManifestHash ${manifest.imageManifestHash}${manifest.imagesHashed ? '' : ' (images not hashed)'}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
