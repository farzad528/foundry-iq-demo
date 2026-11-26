// README accuracy: every retrieval mode is a shipped scenario (S01–S11, each once), the datasets and languages match the
// app's catalog, and every link, anchor and image resolves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { studioScenarios } from '../lib/studio.mjs';
import { industryCatalog } from '../lib/industry.mjs';
import { documentLanguages } from '../config/studio-languages.mjs';

const root = new URL('../', import.meta.url);
const readme = readFileSync(new URL('README.md', root), 'utf8');
const APP = 'https://foundry-iq-demo-studio.vercel.app';
const industries = JSON.parse(readFileSync(new URL('config/studio-industries.json', root), 'utf8')).industries;
const section = heading => {
  const start = readme.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `missing section ${heading}`);
  const end = readme.indexOf('\n## ', start + 4);
  return readme.slice(start, end < 0 ? undefined : end);
};
const rows = text => text.split('\n').filter(line => /^\| (?!-)/.test(line)).slice(1).map(line => line.slice(1, -1).split(' | ').map(cell => cell.trim()));
const slug = heading => heading.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-');
// The README's retrieval-mode names for the app's scenarios (in-app titles differ for some, e.g. S06 "Document boosting").
const MODES = { S01: 'Keyword search', S02: 'Vector search', S03: 'Hybrid search', S04: 'Semantic ranking', S05: 'Filtered search with facets',
  S06: 'Scoring profiles', S07: 'Agentic retrieval', S08: 'Graph-enhanced retrieval', S09: 'Topic-based retrieval',
  S10: 'Document layout extraction', S11: 'Multimodal retrieval' };
const LANGUAGE_NAMES = { en: 'English', fr: 'French', es: 'Spanish', ja: 'Japanese', de: 'German' };

test('README retrieval modes are the shipped scenarios, each listed once in scenario order', () => {
  const ids = studioScenarios({}, 'en').map(item => item.id);
  assert.deepEqual(Object.keys(MODES), ids, 'every app scenario has a README retrieval mode');
  assert.deepEqual(rows(section('What you can explore')).map(([mode]) => mode), ids.map(id => MODES[id]));
});

test('README datasets and languages match the app catalog', () => {
  const table = rows(section('Datasets & languages'));
  assert.deepEqual(table.map(([name]) => name.split(' — ')[0]), [industryCatalog.zava.label, ...industries.map(item => item.label)]);
  assert.equal(table[0][1], documentLanguages.map(language => LANGUAGE_NAMES[language.code ?? language]).join(', '));
  for (const [name, languages] of table.slice(1)) assert.equal(languages, 'English', `${name} is English-only`);
  assert.ok(industries.every(item => !item.scenarios.includes('S11')), 'multimodal retrieval is Zava only, as the README says');
});

test('README links, anchors and images resolve, and the playground link is the deployed app', () => {
  assert.ok(readme.includes(`[**Launch the playground →**](${APP})`));
  const anchors = new Set([...readme.matchAll(/^#{2,3} (.+)$/gm)].map(([, heading]) => slug(heading)));
  for (const [, target] of readme.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (target.startsWith('#')) assert.ok(anchors.has(target.slice(1)), `anchor ${target}`);
    else if (!/^https:\/\//.test(target)) assert.ok(existsSync(new URL(target, root)), `missing ${target}`);
  }
  const images = [...readme.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)];
  assert.ok(images.length && images.every(([, alt, path]) => alt.length > 20 && existsSync(new URL(path, root))), 'images exist and have alt text');
});
