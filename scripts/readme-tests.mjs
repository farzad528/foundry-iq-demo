// README accuracy: every search example is a shipped curated preset for its industry and scenario, deep links use the app's
// URL state, scenario and industry names match the app, and every local link, image and anchor resolves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { studioScenarios } from '../lib/studio.mjs';
import { industryCatalog } from '../lib/industry.mjs';

const root = new URL('../', import.meta.url);
const readme = readFileSync(new URL('README.md', root), 'utf8');
const APP = 'https://foundry-iq-demo-studio.vercel.app/';
const zava = studioScenarios({}, 'en');
const industries = JSON.parse(readFileSync(new URL('config/studio-industries.json', root), 'utf8')).industries;
const labels = { [industryCatalog.zava.label]: 'zava', ...Object.fromEntries(industries.map(item => [item.label, item.id])) };
const section = heading => {
  const start = readme.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `missing section ${heading}`);
  const end = readme.indexOf('\n## ', start + 4);
  return readme.slice(start, end < 0 ? undefined : end);
};
const rows = text => text.split('\n').filter(line => /^\| (?!-)/.test(line)).slice(1).map(line => line.slice(1, -1).split(' | ').map(cell => cell.trim()));
const slug = heading => heading.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-');

test('README search examples are shipped presets with working deep links and short reasons', () => {
  const examples = rows(section('Search examples'));
  assert.deepEqual(examples.map(([id]) => id), zava.map(item => item.id), 'one example per scenario, S01–S11');
  for (const [scenarioId, label, query, why, link] of examples) {
    const industry = labels[label];
    assert.ok(industry, `${scenarioId}: unknown industry ${label}`);
    const text = query.match(/^`(.+)`$/)?.[1];
    const presets = industry === 'zava' ? zava.find(item => item.id === scenarioId).demoPresets.map(preset => preset.query)
      : (industries.find(item => item.id === industry).presets?.[scenarioId] || []).map(preset => preset.query);
    assert.ok(presets.includes(text), `${scenarioId} ${industry}: "${text}" is not a shipped preset`);
    assert.ok(why.split(/\s+/).length <= 12, `${scenarioId}: keep "Why AFTER wins" to 12 words`);
    const params = industry === 'zava' ? `scenario=${scenarioId}` : `industry=${industry}&scenario=${scenarioId}`;
    assert.equal(link, `[Open](${APP}?${params})`, `${scenarioId}: deep link`);
    if (industry !== 'zava') assert.ok(industries.find(item => item.id === industry).scenarios.includes(scenarioId), `${industry} has no ${scenarioId}`);
  }
});

test('README scenario and industry tables use the app names and scenario coverage', () => {
  const scenarios = rows(section('Demonstrated scenarios'));
  assert.deepEqual(scenarios.map(([name]) => name), zava.map(item => `${item.id} ${item.title.replace(/ \(.*\)$/, '')}`));
  const table = rows(section('Industries & supported languages'));
  assert.deepEqual(table.map(([name]) => name.replace(' (default)', '')), [industryCatalog.zava.label, ...industries.map(item => item.label)]);
  for (const [name, , languages, range] of table) {
    const id = labels[name.replace(' (default)', '')];
    const ids = id === 'zava' ? zava.map(item => item.id) : industries.find(item => item.id === id).scenarios;
    assert.equal(range, `${ids[0]}–${ids.at(-1)}`, `${name} scenarios`);
    assert.equal(languages, id === 'zava' ? 'en, fr, es, ja, de' : 'en', `${name} languages`);
  }
});

test('README links, anchors and images resolve', () => {
  const anchors = new Set([...readme.matchAll(/^#{2,3} (.+)$/gm)].map(([, heading]) => slug(heading)));
  for (const [, target] of readme.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (target.startsWith('#')) assert.ok(anchors.has(target.slice(1)), `anchor ${target}`);
    else if (!/^https:\/\//.test(target)) assert.ok(existsSync(new URL(target, root)), `missing ${target}`);
  }
  assert.ok(readme.includes('](docs/images/foundry-iq-demo-agentic-graph-search.png)'));
  assert.equal(readme.split('Azure AI Search').length - 1, 1, '"Foundry IQ (Azure AI Search)" appears once');
});
