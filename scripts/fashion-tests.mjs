import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildManifest, exclusionReason, parseStyles, selectProducts, toProductDocument } from './prepare-fashion.mjs';
import { verifyIndustryIndex } from '../lib/industry.mjs';

const template = name => JSON.parse(readFileSync(new URL(`../templates/fashion/${name}.json`, import.meta.url), 'utf8'));
const header = 'id,gender,masterCategory,subCategory,articleType,baseColour,season,year,usage,productDisplayName';
const styles = [
  header,
  '15970,Men,Apparel,Topwear,Shirts,Navy Blue,Fall,2011,Casual,Turtle Check Men Navy Blue Shirt',
  '39386,Men,Apparel,Bottomwear,Jeans,Blue,Summer,2012,Casual,Peter England Men Party Blue Jeans',
  '59263,Women,Accessories,Watches,Watches,Silver,Winter,2016,Casual,Titan Women Silver Watch, with box',
  '21379,Men,Apparel,Bottomwear,Track Pants,Black,Fall,2011,Casual,Manchester United Men Solid Black Track Pants',
  '53759,Boys,Apparel,Topwear,Tshirts,Grey,Summer,2012,Casual,Puma Boys Grey T-shirt',
  '1855,Women,Apparel,Innerwear,Bra,Black,Summer,2011,Casual,Inkfruit Women Black Bra',
  '30805,Men,Personal Care,Fragrance,Perfume and Body Mist,Black,Spring,2017,Casual,Davidoff Men Cool Water',
  '26960,Women,Footwear,Shoes,Casual Shoes,White,Summer,,,Nike Women White Shoes',
  '26961,Women,Footwear,Shoes,Casual Shoes,White,Summer,2012,Casual,Nike Women White Shoes',
  '12345,Unisex,Accessories,Bags,Backpacks,,Fall,2011,Casual,Wildcraft Unisex Backpack',
].join('\r\n');

test('the fashion prep script parses styles.csv, keeps names with commas and excludes minors, sensitive and off-topic rows', () => {
  const rows = parseStyles(`\uFEFF${styles}`);
  assert.equal(rows.length, 10);
  assert.equal(rows[2].productDisplayName, 'Titan Women Silver Watch, with box');
  assert.deepEqual(rows.map(exclusionReason), [null, null, null, null, 'gender', 'sensitive-subcategory', 'category', null, null, 'missing-field']);
  assert.throws(() => parseStyles('id,name\n1,x'), /must start with/);
});

test('the fashion subset is deterministic, de-duplicated, capped per article type and honours manual exclusions', () => {
  const rows = parseStyles(styles);
  const first = selectProducts(rows, { size: 10, seed: 's' });
  assert.deepEqual(first.selected.map(row => row.id), ['15970', '21379', '26960', '39386', '59263'], 'duplicate shoe (same type, name and colour) kept once');
  assert.deepEqual(first.excluded, { gender: 1, 'sensitive-subcategory': 1, category: 1, duplicate: 1, 'missing-field': 1 });
  assert.deepEqual(selectProducts([...rows].reverse(), { size: 10, seed: 's' }).selected.map(row => row.id), first.selected.map(row => row.id), 'input order does not matter');
  assert.equal(selectProducts(rows, { size: 2, seed: 's' }).selected.length, 2);
  assert.equal(selectProducts(rows, { size: 10, cap: 1, seed: 's' }).selected.length, 5, 'one per article type');
  const reviewed = selectProducts(rows, { size: 10, seed: 's', exclude: new Set(['59263']), hasImage: id => id !== '21379' });
  assert.deepEqual(reviewed.selected.map(row => row.id), ['15970', '26960', '39386']);
  assert.equal(reviewed.excluded['manual-review'], 1);
  assert.equal(reviewed.excluded['missing-image'], 1);
});

test('fashion product documents use real metadata only, a same-origin thumbnail and a stable corpus hash', () => {
  const [shirt, , , , , , , shoes] = parseStyles(styles);
  const document = toProductDocument(shirt, { source: 'Fixture', imageSha256: 'a'.repeat(64) });
  assert.equal(document.id, 'fpi-15970');
  assert.equal(document.content, "Men's navy blue shirts · Topwear · Casual · Fall 2011");
  assert.equal(document.thumbnailUrl, '/datasets/fashion/thumbs/fpi-15970.webp');
  assert.equal(document.collectionDate, '2011-01-01T00:00:00Z');
  assert.ok(!['price', 'rating', 'popularity', 'inventory', 'stock'].some(key => key in document), 'no fabricated commerce signals');
  const sparse = toProductDocument(shoes);
  assert.deepEqual([sparse.year, sparse.usage, sparse.collectionDate, sparse.content], [null, null, null, "Women's white casual shoes · Shoes · Summer"]);
  const options = { seed: 's', size: 1, cap: 1 };
  const manifest = buildManifest([document], options);
  assert.match(manifest.imageManifestHash, /^[a-f0-9]{64}$/);
  assert.equal(manifest.imagesHashed, true);
  assert.notEqual(buildManifest([{ ...document, image: { blob: 'x', sha256: 'c'.repeat(64) } }], options).imageManifestHash, manifest.imageManifestHash);
  assert.equal(buildManifest([sparse], options).imagesHashed, false);
});

test('the fashion index template passes the industry S05, S06 and S11 schema checks', async () => {
  const index = template('index');
  index.vectorSearch.vectorizers[0].aiServicesVisionParameters.resourceUri = 'https://fixture.cognitiveservices.azure.com';
  const http = async () => ({ data: index, etag: '"1"' });
  const binding = { index: index.name, indexETag: '"1"', semanticConfiguration: 'fashion-semantic', vectorField: 'imageVector',
    scoringProfiles: { newest: 'fashion-newest', season: 'fashion-season', occasion: 'fashion-occasion', colour: 'fashion-colour' },
    image: { field: 'imageVector', profile: 'image-profile', vectorizer: 'image-vectorizer', model: 'azure-vision-multimodal', modelVersion: '2023-04-15', dimensions: 1024, manifestHash: 'a'.repeat(64) } };
  const industry = { boostSubtypes: Object.keys(binding.scoringProfiles) };
  for (const scenarioId of ['S05', 'S06', 'S11']) {
    const fields = await verifyIndustryIndex(http, binding, scenarioId, industry);
    assert.equal(fields.vectorizerKind, 'aiServicesVision');
  }
  const tags = index.scoringProfiles.flatMap(profile => profile.functions.filter(fn => fn.type === 'tag').map(fn => fn.tag.tagsParameter));
  assert.deepEqual(tags, ['seasonTags', 'usageTags', 'colourTags']);
  assert.ok(index.fields.find(field => field.name === 'year').sortable, 'S05 sorts on year');
  const products = template('indexer-products');
  assert.equal(products.parameters.configuration.parsingMode, 'json', 'one JSON blob per product');
  const images = template('indexer-images');
  assert.equal(images.fieldMappings[0].targetFieldName, 'id');
  assert.equal(template('skillset-images').skills[0].modelVersion, binding.image.modelVersion);
  for (const name of ['datasource-products', 'datasource-images']) {
    assert.equal(template(name).dataDeletionDetectionPolicy.softDeleteColumnName, 'IsDeleted');
    assert.doesNotMatch(JSON.stringify(template(name)), /AccountKey|SharedAccessSignature|sig=/, 'managed identity, no keys');
  }
});
