import test from 'node:test';
import assert from 'node:assert/strict';
import { studioScenarios, runComparison, prepareComparison } from '../lib/studio.mjs';
import { liveConfiguration } from '../config/studio-live.mjs';
import { documentLanguages, localizedCorpus } from '../config/studio-languages.mjs';
import { documents, topics } from '../config/studio-corpus.mjs';
import { buildStudio } from './generate-studio.mjs';
import { readFileSync } from 'node:fs';

// The localized corpus queries translate the original English gold presets (first four per scenario).
const goldFile = JSON.parse(readFileSync(new URL('../config/studio-gold.json', import.meta.url), 'utf8'));
const goldPresetQueries = id => { const curated = goldFile.filter(entry => entry.scenarioId === id); const presets = curated.slice(0, 4);
  if (id === 'S05') presets[2] = curated.find(entry => entry.category === 'exact'); return presets.map(entry => entry.query); };

const numbers = text => (text.match(/\d+(?:[.,]\d+)?/g) || []).map(value => value.replace(',', '.')).sort();

function fixture(returnedLanguage = 'fr') {
  const config = { index: 'zava-studio-fr-products', indexETag: '"fr1"', language: 'fr',
    attestation: { checkedAt: '2026-11-24', region: 'westcentralus', evidenceVersion: 'localized-v1' },
    synonymMaps: ['zava-studio-fr-synonyms'] };
  const env = { FOUNDRY_IQ_LIVE_ENABLED: 'true', AZURE_SEARCH_ENDPOINT: 'https://zava-demo.search.windows.net',
    AZURE_SEARCH_API_KEY: 'test-only-localized-key', STUDIO_LIVE_CONFIG: JSON.stringify({
      datasetVersion: 'zava-studio-2026-01', resourceVersion: 'english-v1', scenarios: {},
      languages: { fr: { resourceVersion: 'french-v1', scenarios: { S01: config } } },
    }) };
  const schema = { name: config.index, fields: [
    { name: 'id', type: 'Edm.String', key: true, sortable: true },
    ...['title', 'content'].map(name => ({ name, type: 'Edm.String', searchable: true, analyzer: 'fr.lucene', synonymMaps: config.synonymMaps })),
    { name: 'url', type: 'Edm.String' }, { name: 'sourceId', type: 'Edm.String' },
    ...['scope', 'language'].map(name => ({ name, type: 'Edm.String', filterable: true })),
  ] };
  const calls = [];
  let reservations = 0, releases = 0;
  const helpers = { env, reserveAttempt: async () => ++reservations, releaseAttempt: async () => { releases++; },
    fetchUpstream: async (url, request) => {
      calls.push({ url, request });
      if (request.method === 'GET') return new Response(JSON.stringify(schema), { headers: { etag: '"fr1"' } });
      const payload = JSON.parse(request.body);
      assert.match(url, /\/indexes\/zava-studio-fr-products\//);
      assert.match(payload.filter, /language eq 'fr'/);
      assert.match(payload.select, /language/);
      return new Response(JSON.stringify({ '@odata.count': 1, value: [
        { id: 'DRILL-1001', sourceId: 'DRILL-1001', title: 'Perceuse Zava', content: 'Perceuse sans fil 18V.',
          language: returnedLanguage, scope: 'public', url: '/samples/zava-catalog-fr.csv' },
      ] }));
    } };
  return { config, schema, env, calls, helpers, counts: () => ({ reservations, releases }) };
}
test('localized encoder identity includes the exact corpus hash without weakening English validation', async () => {
  for (const matches of [true, false]) {
    const data = fixture();
    const corpusHash = 'a'.repeat(64);
    const configured = JSON.parse(data.env.STUDIO_LIVE_CONFIG);
    configured.languages.fr.scenarios.S02 = { ...data.config, corpusHash, vector: { provider: 'serverAzureOpenAI',
      field: 'contentVector', profile: 'text-profile', vectorizer: 'server-entra', deployment: 'embedding',
      model: 'text-embedding-3-small', modelVersion: '1', dimensions: 1536 } };
    data.env.STUDIO_LIVE_CONFIG = JSON.stringify(configured);
    data.env.STUDIO_TEXT_ENDPOINT = 'https://zava-demo.openai.azure.com';
    data.env.STUDIO_MODEL_AUTH = 'entra';
    data.schema.description = `Zava Studio synthetic dataset zava-studio-2026-01; encoder=text-embedding-3-small@1; dimensions=1536; localized=fr; corpus=${matches ? corpusHash : 'b'.repeat(64)}`;
    data.schema.fields.push({ name: 'contentVector', type: 'Collection(Edm.Single)', searchable: true, dimensions: 1536, vectorSearchProfile: 'text-profile' });
    data.schema.vectorSearch = { profiles: [{ name: 'text-profile' }] };
    const prepare = () => prepareComparison({ scenarioId: 'S02', mode: 'live', query: 'perceuse', language: 'fr' },
      { ...data.helpers, schemaCache: new Map(), availability: async () => ({}) });
    if (matches) assert.equal((await prepare()).ready, true);
    else await assert.rejects(prepare, error => error.code === 'studio_schema_unverified');
    assert.ok(data.calls.every(call => call.request.method === 'GET'));
  }
});
test('document language selects actual isolated indexes and rejects cross-language evidence', async () => {
  for (const language of ['fr', 'en']) {
    const data = fixture(language);
    const result = await runComparison({ scenarioId: 'S01', mode: 'live', query: 'perceuse', language: 'fr' }, data.helpers);
    assert.equal(result.comparison.snapshot.language, 'fr');
    assert.equal(result.executionStatus, language === 'fr' ? 'success' : 'error');
    for (const arm of [result.baseline, result.enhanced]) {
      if (language === 'fr') {
        assert.equal(arm.hits[0].language, 'fr');
        assert.equal(arm.hits[0].url, '/samples/zava-catalog-fr.csv');
      } else {
        assert.equal(arm.hits.length, 0);
        assert.equal(arm.error.code, 'studio_language_mismatch');
      }
    }
    assert.deepEqual(data.counts(), { reservations: 3, releases: 3 });
  }
});
test('unconfigured or forged language bindings cannot substitute English, including Sample', async () => {
  const data = fixture();
  assert.equal(liveConfiguration(data.env, 'S01', 'de').available, false);
  const configured = JSON.parse(data.env.STUDIO_LIVE_CONFIG);
  configured.languages.fr.scenarios.S01.index = 'zava-studio-products';
  data.env.STUDIO_LIVE_CONFIG = JSON.stringify(configured);
  assert.equal(liveConfiguration(data.env, 'S01', 'fr').available, false);
  for (const request of [
    { language: 'unsupported', mode: 'live' }, { language: "fr' or true", mode: 'live' },
    { language: 'fr', mode: 'sample' }, { language: 'de', mode: 'live' },
  ]) {
    await assert.rejects(() => runComparison({ scenarioId: 'S01', query: 'perceuse', ...request }, data.helpers));
  }
  assert.equal(data.calls.length, 0);
});
test('all five catalogs preserve eleven scenarios and switch all curated examples without live claims', () => {
  const english = studioScenarios({});
  for (const { code } of documentLanguages) {
    const catalog = studioScenarios({}, code);
    assert.equal(catalog.length, 11);
    assert.ok(catalog.every(scenario => scenario.demoPresets.length === 4 && !scenario.liveAvailable));
    if (code !== 'en') {
      const local = localizedCorpus(code);
      assert.equal(local.products.length, 40);
      assert.equal(local.support.length, 11);
      assert.ok(catalog.every(scenario => scenario.sample.available === false));
      assert.match(local.support.find(item => item.id === 'INC-2026-017').content, /LOT-2407-A/);
      assert.match(local.support.find(item => item.id === 'INC-2026-017').content, /DRILL-1002/);
      // The prefilled query is the first showcase preset (config/studio-presets.json), verified on Live.
      assert.equal(catalog[0].sampleQuery, catalog[0].demoPresets[0].query);
      for (const [id, presets] of Object.entries(local.queries)) {
        if (id !== 'S11') {
          assert.ok(presets.every(preset => preset.query === preset.label), `${code}:${id} must submit its translated query, not only display its label`);
          presets.forEach((preset, index) => assert.deepEqual(numbers(preset.query),
            numbers(goldPresetQueries(id)[index]), `${code}:${id} preset ${index}`));
        }
        else {
          assert.equal(presets[0].query, '');
          assert.deepEqual(presets.slice(1).map(preset => preset.query), ['HAT-001', 'HAT-002', 'BOWL-001']
            .map(id => local.products.find(product => product.id === id).content));
        }
      }
    }
  }
  assert.match(localizedCorpus('ja').products[0].content, /[\u3040-\u30ff\u3400-\u9fff]/);
});
test('prepared localized text preserves every canonical numeric fact and record identity', () => {
  const collections = { products: buildStudio('dev').records.products, support: documents.filter(item => item.scope === 'public'), topics };
  for (const language of ['fr', 'es', 'ja', 'de']) {
    const localized = localizedCorpus(language);
    for (const [name, originals] of Object.entries(collections)) {
      assert.equal(localized[name].length, originals.length);
      for (const record of originals) {
        const translation = localized[name].find(item => item.id === record.id);
        assert.ok(translation, `${language}:${record.id}`);
        assert.deepEqual(numbers(`${translation.title} ${translation.content}`),
          numbers(`${record.title} ${record.content || record.snippet || record.summary}`), `${language}:${record.id}`);
        if (record.summary) assert.deepEqual(numbers(translation.summary), numbers(record.summary));
      }
    }
  }
});
