import { readFileSync } from 'node:fs';
import { HttpError } from './protocol.mjs';

// Native Foundry IQ entity-graph (S08) and topic-graph (S09) search over the English Zava dataset.
// Public content only: curated questions, the server-side GQL allowlist (keyed by preset ID), gold answers and the topic
// hierarchy. Index names come from the private bindings, never from this file or from a request.
export const graphConfig = JSON.parse(readFileSync(new URL('../config/studio-graph.json', import.meta.url), 'utf8'));

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const badSchema = () => { throw new HttpError(503, 'studio_schema_unverified', 'Reviewed resource schema or ETag does not match.'); };
const unexpected = what => { throw new HttpError(502, 'studio_graph_response_unverified', `Foundry IQ returned an unexpected ${what}; nothing was substituted.`); };
export const NATIVE_TOP = 5;
const MAX_GRAPH_ROWS = 50;
const MAX_EVIDENCE = 200;
const TOPIC_SELECT = 'subject_id,predicate,object_id,object_string,object_double';
// A dataset profile maps passages to stable source IDs, links and topic leaves. Zava passages carry a "Source ID:" line;
// industry datasets (lib/industry-graph.mjs) map blob URLs and passage UIDs through hashed tables instead.
const ZAVA = {
  zava: true, dataset: graphConfig.dataset, presets: { s08: graphConfig.s08, s09: graphConfig.s09 }, select: 'uid,snippet',
  sourceOf: (item, passage) => passage.sourceId, urlOf: id => graphConfig.sourceUrls[id],
  leafOf: (item, sourceId) => graphConfig.topics.leafOfSource[sourceId], leaves: graphConfig.topics.leaves,
};
export const zavaGraphProfile = ZAVA;

export const graphPresetFor = (query, profile = ZAVA) => profile.presets.s08.find(preset => preset.question === String(query ?? '').trim());
export const topicPresetFor = (query, profile = ZAVA) => profile.presets.s09.find(preset => preset.question === String(query ?? '').trim());

/** Splits a hydrated passage ("# ID — Title", "Key: value" lines, body) into its stable source ID, title, fields and body. */
export function parsePassage(text) {
  const raw = String(text ?? '');
  const sourceId = raw.match(new RegExp(graphConfig.sourcePattern))?.[1];
  const heading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const fields = {};
  const body = [];
  for (const block of raw.split(/\n\s*\n/).map(item => item.trim()).filter(Boolean)) {
    if (/^#\s/.test(block)) continue;
    const lines = block.split('\n').map(line => line.trim());
    if (lines.every(line => /^[A-Z][A-Za-z ()]{1,40}:\s/.test(line))) {
      for (const line of lines) { const [, key, value] = line.match(/^([^:]+):\s*(.*)$/); fields[key.trim()] = value.trim(); }
    } else body.push(block);
  }
  const title = heading?.includes(' — ') ? heading.split(' — ').slice(1).join(' — ') : heading || sourceId || 'Passage';
  return { sourceId, title, body: body.join('\n\n') || raw, fields };
}

const humanize = name => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
/** Hops (alias —relationship→ alias) of a curated GQL pattern, for path display. Only returned aliases are shown. */
export function pathOf(gql) {
  const aliases = Object.fromEntries([...gql.matchAll(/(\w+)\.name\s+AS\s+(\w+)/gi)].map(match => [match[1], match[2]]));
  const labels = {};
  const pattern = gql.replace(/^\s*MATCH\s+/i, '').split(/\s+(?:WHERE|RETURN)\s+/i)[0];
  const hops = [];
  let previous = null, pending = null;
  for (const token of pattern.matchAll(/\((\w+)(?::`?(\w+)`?)?\)|(<)?-\[:`?(\w+)`?\]-(>)?|,/g)) {
    if (token[0] === ',') { previous = null; pending = null; continue; }
    if (token[1]) {
      if (token[2]) labels[token[1]] = token[2];
      if (pending && previous) {
        const [from, to] = pending.left ? [token[1], previous] : [previous, token[1]];
        // "policyAppliesToLot" from a Policy reads as "applies to lot"; the subject is already the left-hand entity.
        const subject = (labels[from] || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ');
        const words = humanize(pending.name).split(' ');
        const relation = words.length > 1 && subject.includes(words[0]) ? words.slice(1).join(' ') : words.join(' ');
        if (aliases[from] && aliases[to]) hops.push({ from: aliases[from], relation, to: aliases[to] });
      }
      previous = token[1];
      pending = null;
    } else pending = { name: token[4], left: !!token[3] };
  }
  return { hops, labels: Object.fromEntries(Object.entries(labels).filter(([name]) => aliases[name]).map(([name, label]) => [aliases[name], label])) };
}

function passageHit(item, rank, { score, scoreType } = {}, profile = ZAVA) {
  if (!object(item) || typeof item.snippet !== 'string') unexpected('passage');
  const passage = parsePassage(item.snippet);
  const sourceId = profile.sourceOf(item, passage) || passage.sourceId || `passage-${rank}`;
  // Zava has one passage per source; industry documents have many, so each passage keeps its own ID.
  const id = profile.passageId ? profile.passageId(item, sourceId) : sourceId;
  const leaf = profile.leafOf(item, sourceId);
  return {
    id, title: passage.title, sourceType: 'foundry-iq-index', sourceId,
    ...(profile.urlOf(sourceId) ? { url: profile.urlOf(sourceId) } : {}), ...(leaf ? { leafId: leaf } : {}),
    snippet: passage.body, rank, ...(Number.isFinite(score) && scoreType ? { score, scoreType } : {}),
    document: { sourceId, ...passage.fields },
    search: Object.fromEntries([['score', item['@search.score']], ['rerankerScore', item['@search.rerankerScore']]].filter(([, value]) => Number.isFinite(value))),
  };
}
const unique = hits => {
  const seen = new Set();
  return hits.filter(hit => !seen.has(hit.id) && seen.add(hit.id)).map((hit, i) => ({ ...hit, rank: i + 1 }));
};

export function nativeSearchPayload(snapshot, graph, { semantic = false, topicGraph, select = 'uid,snippet' } = {}) {
  return {
    search: snapshot.query, top: Math.min(snapshot.topK, NATIVE_TOP), select,
    ...(semantic ? { queryType: 'semantic', semanticConfiguration: graph.semanticConfiguration } : {}),
    vectorQueries: [{ kind: 'text', text: snapshot.query, fields: graph.vectorField, k: 50, ...(topicGraph ? { topicGraph: { kind: topicGraph } } : {}) }],
  };
}
export function graphStatementPayload(statement, select = 'uid,snippet') {
  return { gql: statement.gql, provenance: { kind: 'hydrate', hydrateDocuments: { select } }, includeDiagnostics: true, includeStatistics: true };
}
export const topicHierarchyPayload = () => ({ search: '*', top: 1000, filter: "predicate ne 'HasCentroidVector'", select: TOPIC_SELECT });

/** Builds the theme tree from topic-index rows (HasRootTopic / HasSubTopic edges and prop:* values). */
export function hierarchyFromRows(rows) {
  if (!Array.isArray(rows) || rows.length > 1000) unexpected('topic hierarchy');
  const topics = new Map();
  const topic = id => { if (!topics.has(id)) topics.set(id, { id, children: [] }); return topics.get(id); };
  const roots = [];
  for (const row of rows) {
    if (!object(row) || typeof row.subject_id !== 'string' || typeof row.predicate !== 'string') unexpected('topic row');
    const { subject_id: subject, predicate, object_id: target, object_string: text, object_double: number } = row;
    if (predicate === 'HasRootTopic' && target) roots.push(target);
    else if (predicate === 'HasSubTopic' && target) { topic(subject).children.push(target); topic(target).parent = subject; }
    else if (predicate === 'prop:title' && typeof text === 'string') topic(subject).title = text;
    else if (predicate === 'prop:description' && typeof text === 'string') topic(subject).description = text.slice(0, 400);
    else if (predicate === 'prop:level' && Number.isFinite(number)) topic(subject).level = number;
    else if (predicate === 'prop:proportion' && Number.isFinite(number)) topic(subject).proportion = number;
  }
  const build = (id, depth = 0) => {
    const node = topics.get(id);
    if (!node?.title || depth > 4) return null;
    return { id, title: node.title, ...(node.description ? { description: node.description } : {}), level: node.level ?? depth,
      proportion: node.proportion ?? null, children: node.children.map(child => build(child, depth + 1)).filter(Boolean) };
  };
  return [...new Set(roots)].sort().map(id => build(id)).filter(Boolean);
}

function coverage(hits, profile = ZAVA) {
  const leaves = profile.leaves;
  const covered = [...new Set(hits.map(hit => hit.topic?.id).filter(Boolean))];
  const scope = `top ${NATIVE_TOP} results; precomputed passage-to-topic assignment for this topic generation`;
  // Large topic graphs (industry datasets): list only the themes these results cover.
  if (!profile.zava) return { covered, total: covered.length, compact: true, leaves: leaves.filter(leaf => covered.includes(leaf.id)).map(leaf => ({ id: leaf.id, title: leaf.title })), scope };
  return { covered: leaves.filter(leaf => covered.includes(leaf.id)).map(leaf => leaf.id), total: leaves.length,
    leaves: leaves.map(leaf => ({ id: leaf.id, title: leaf.title })), scope };
}
const withTopics = (hits, profile = ZAVA) => hits.map(({ leafId, ...hit }) => {
  const id = leafId || profile.leafOf(undefined, hit.sourceId);
  const leaf = profile.leaves.find(item => item.id === id && item.title);
  return leaf ? { ...hit, topic: { id: leaf.id, title: leaf.title } } : hit;
});

/** Checks the bundled, ETag-pinned attestations for the content, graph or topic index of a native binding. */
export async function verifyNativeGraph(http, config, scenarioId, apiVersion) {
  const g = config.nativeGraph;
  const read = async (name, etag) => {
    const result = await http(`/indexes/${encodeURIComponent(name)}?api-version=${apiVersion}`);
    if (result.etag !== etag || result.data?.name !== name || !Array.isArray(result.data.fields)) badSchema();
    return { schema: result.data, fields: new Map(result.data.fields.map(field => [field.name, field])) };
  };
  const content = await read(config.index, config.indexETag);
  const field = name => content.fields.get(name);
  if (!field('uid')?.key || !field('snippet')?.searchable || field('snippet').retrievable === false
    || field(g.vectorField)?.type !== 'Collection(Edm.Single)' || !field(g.vectorField).vectorSearchProfile) badSchema();
  const profile = content.schema.vectorSearch?.profiles?.find(item => item.name === field(g.vectorField).vectorSearchProfile);
  const vectorizer = content.schema.vectorSearch?.vectorizers?.find(item => item.name === profile?.vectorizer);
  // Query text is vectorized by Search through its own identity: no key and no identity override.
  if (!vectorizer || vectorizer.kind !== 'azureOpenAI' || vectorizer.azureOpenAIParameters?.apiKey || vectorizer.azureOpenAIParameters?.authIdentity) badSchema();
  if (scenarioId === 'S08') {
    if (!content.schema.semantic?.configurations?.some(item => item.name === g.semanticConfiguration)) badSchema();
    const graph = await read(g.graphIndex, g.graphIndexETag);
    if (graph.schema.graphProfile?.kind !== 'edgeList' || graph.schema.graphProfile.provenanceIndexName !== config.index) badSchema();
  } else {
    const topic = await read(g.topicIndex, g.topicIndexETag);
    for (const name of TOPIC_SELECT.split(',')) if (!topic.fields.has(name) || topic.fields.get(name).retrievable === false) badSchema();
    if (!topic.fields.get('predicate').filterable) badSchema();
  }
  return content.fields;
}

/** One arm of a native S08 or S09 comparison. Every upstream call is a bounded Search read; no model calls.
 * `profile` selects the dataset (Zava by default; industry datasets come from lib/industry-graph.mjs). */
export async function nativeGraphArm(scenario, side, snapshot, config, context, profile = ZAVA) {
  const g = config.nativeGraph;
  const kind = scenario[side];
  const top = Math.min(snapshot.topK, NATIVE_TOP);
  const trace = { steps: ['Reviewed schema/ETag checked against the bundled attestation; no retries.'], configuration: {
    ...snapshot, index: config.index, searchApiVersion: g.apiVersion, mechanism: kind, dataset: g.dataset, top, perCallTimeoutMs: g.timeoutMs,
    embedding: { field: g.vectorField, scope: 'Foundry IQ vectorized the query text with the content index vectorizer; the app sent no embedding request or model credential.' },
  } };
  if (profile.zava && snapshot.language && snapshot.language !== 'en') trace.steps.push('The native graph is built from the English Zava content, so questions and results are in English.');
  trace.steps.push(`Graph and topic comparisons show up to ${NATIVE_TOP} results, as verified for the curated questions.`);
  const arm = { status: 'success', kind, hits: [], trace, label: {
    S08: { baseline: 'Plain retrieval: hybrid + semantic ranker', enhanced: 'Foundry IQ entity graph' },
    S09: { baseline: 'Hybrid search, topic diversification off', enhanced: 'Topic-balanced retrieval + themes' } }[scenario.id][side] };
  const search = path => `/indexes/${encodeURIComponent(path)}/docs/search?api-version=${g.apiVersion}`;
  let latency = 0;
  const timed = response => { latency += response.latencyMs || 0; trace.requestId ||= response.requestId || undefined; return response; };
  const passages = (values, opts) => unique(values.map((item, i) => passageHit(item, i + 1, typeof opts === 'function' ? opts(item) : opts, profile)));
  // Industry S09 theme questions read the corpus themes from the topic index; diversity questions compare retrieval.
  const topicPreset = scenario.id === 'S09' ? topicPresetFor(snapshot.query, profile) : undefined;
  const themesOnly = !profile.zava && scenario.id === 'S09' && side === 'enhanced' && topicPreset?.mode === 'hierarchy';
  const readThemes = async () => {
    const topics = timed(await context.http(search(g.topicIndex), topicHierarchyPayload()));
    const hierarchy = hierarchyFromRows(topics.data?.value);
    const titles = new Map();
    const visit = node => { titles.set(node.id, node.title); node.children.forEach(visit); };
    hierarchy.forEach(visit);
    // Topic chips use the precomputed passage-to-topic assignment; it must belong to this topic generation.
    if (profile.leaves.some(leaf => leaf.title && titles.has(leaf.id) && titles.get(leaf.id) !== leaf.title)
      || profile.leaves.filter(leaf => leaf.title).some(leaf => !titles.has(leaf.id))) {
      throw new HttpError(502, 'studio_topic_generation_changed', 'The Foundry IQ topic graph changed since these questions were verified; no themes were substituted.');
    }
    trace.configuration.topicIndex = g.topicIndex;
    trace.steps.push('Corpus themes read from the native topic index (HasRootTopic, HasSubTopic and prop:* rows).');
    if (profile.zava) return { kind: 'native', hierarchy, index: g.topicIndex };
    // Large hierarchies: the 8 largest themes, or the curated question's focus theme with its sub-themes.
    const roots = [...hierarchy].sort((a, b) => (b.proportion ?? 0) - (a.proportion ?? 0));
    const sorted = node => ({ ...node, children: [...node.children].sort((a, b) => (b.proportion ?? 0) - (a.proportion ?? 0)).map(sorted) });
    const focus = topicPreset?.focusTopic && roots.find(root => root.title === topicPreset.focusTopic);
    if (topicPreset?.focusTopic && !focus) throw new HttpError(502, 'studio_topic_generation_changed', 'The curated theme is no longer in the Foundry IQ topic graph; no themes were substituted.');
    return focus ? { kind: 'native', hierarchy: [sorted(focus)], focus: focus.id, moreRoots: roots.length - 1, index: g.topicIndex }
      : { kind: 'native', hierarchy: roots.slice(0, 8).map(root => ({ ...root, children: [] })), moreRoots: Math.max(0, roots.length - 8), index: g.topicIndex };
  };

  if (themesOnly) {
    arm.themesOnly = true;
    arm.topics = await readThemes();
    trace.configuration.topicPresetId = topicPreset.id;
    trace.steps.push('Themes and their share of passages come straight from the topic graph; no passage search is needed to answer.');
  } else if (scenario.id === 'S09' || side === 'baseline') {
    const s09 = scenario.id === 'S09';
    const payload = nativeSearchPayload(snapshot, g, { ...(s09 ? { topicGraph: side === 'baseline' ? 'none' : 'balanced' } : { semantic: true }), select: profile.select });
    const response = timed(await context.http(search(config.index), payload));
    const values = response.data?.value;
    if (!Array.isArray(values) || values.length > top) unexpected('result list');
    const scoreType = s09 ? 'Foundry IQ fused score' : 'Foundry IQ semantic ranker score';
    arm.hits = passages(values, item => ({ score: s09 ? item['@search.score'] : item['@search.rerankerScore'], scoreType }));
    if (s09) {
      trace.configuration.topicGraph = side === 'baseline' ? 'none' : 'balanced';
      trace.configuration.semanticRanker = 'off in both arms: reranking would undo topic diversification';
      if (topicPreset) trace.configuration.topicPresetId = topicPreset.id;
      arm.hits = withTopics(arm.hits, profile);
      arm.topicCoverage = coverage(arm.hits, profile);
      trace.steps.push(side === 'baseline'
        ? 'Hybrid search with topic diversification off (topicGraph none).'
        : 'The same hybrid search with native topic-balanced retrieval (topicGraph balanced): results are spread across the corpus themes.');
      if (side === 'enhanced' && profile.zava) arm.topics = await readThemes();
    } else {
      trace.configuration.semanticConfiguration = g.semanticConfiguration;
      trace.steps.push('Plain retrieval: hybrid keyword and vector search with the semantic ranker; passages only, no relationships.');
    }
  } else {
    const preset = graphPresetFor(snapshot.query, profile);
    trace.configuration.graphIndex = g.graphIndex;
    if (!preset) {
      // Free text would need a model to write GQL; this demo never accepts GQL from the browser and never substitutes passages.
      arm.curatedOnly = true;
      arm.answerKind = 'note';
      arm.answer = 'Graph traversal in this demo runs on the curated questions. Pick one from the search-bar list to see Foundry IQ follow the relationships.';
      trace.steps.push('No graph query sent: GQL comes only from the server-side allowlist of curated questions.');
      return arm;
    }
    trace.configuration.presetId = preset.id;
    const statements = [];
    const cited = new Map();
    const order = [];
    for (const statement of preset.statements) {
      const response = timed(await context.http(`/indexes('${encodeURIComponent(g.graphIndex)}')/docs/search.graph?api-version=${g.apiVersion}`,
        graphStatementPayload(statement, profile.select)));
      const data = response.data;
      if (!object(data) || !Array.isArray(data.value) || data.value.length > MAX_GRAPH_ROWS) unexpected('graph result');
      const documents = object(data['@search.graphProvenanceDocuments']) ? data['@search.graphProvenanceDocuments'] : {};
      const rows = data.value.map(row => {
        if (!object(row)) unexpected('graph row');
        const values = Object.fromEntries(Object.entries(row).filter(([key, value]) => !key.startsWith('@')
          && (typeof value === 'string' || Number.isFinite(value)) && !String(value).startsWith('gqlref:')));
        const evidence = Array.isArray(row['@search.graphProvenance']?.evidence) ? row['@search.graphProvenance'].evidence.slice(0, MAX_EVIDENCE) : [];
        const sources = [];
        for (const item of evidence) {
          const passage = typeof item?.chunkId === 'string' && object(documents[item.chunkId]) ? documents[item.chunkId] : null;
          if (!passage || typeof passage.snippet !== 'string') continue;
          const sourceId = profile.sourceOf(passage, parsePassage(passage.snippet));
          if (sourceId && !sources.includes(sourceId)) sources.push(sourceId);
          if (!cited.has(item.chunkId)) { cited.set(item.chunkId, passage); order.push(item.chunkId); }
        }
        // A row without evidence (e.g. Graph.Provenance.CollectionLimit) is shown as "citation unavailable", never invented.
        return { values, sources, evidenceCount: Number.isInteger(row['@search.graphProvenance']?.evidenceCount?.value) ? row['@search.graphProvenance'].evidenceCount.value : evidence.length,
          ...(sources.length ? {} : { citationUnavailable: true }) };
      });
      const stats = object(data['@search.graphStats']) ? Object.fromEntries(['totalMs', 'searchMs', 'planningMs', 'queryCount', 'documentsFetched', 'executionMode']
        .filter(key => data['@search.graphStats'][key] !== undefined).map(key => [key, data['@search.graphStats'][key]])) : undefined;
      const diagnostics = (Array.isArray(data['@search.graphDiagnostics']) ? data['@search.graphDiagnostics'] : []).filter(object).slice(0, 10)
        .map(item => ({ severity: String(item.severity ?? ''), code: String(item.code ?? ''), message: String(item.message ?? '').slice(0, 300) }));
      const outcome = rows.length ? 'rows' : statement.expectRows === 0 ? 'absence' : 'none';
      statements.push({ label: statement.label, gql: statement.gql, expectRows: statement.expectRows, outcome, ...pathOf(statement.gql),
        columns: [...new Set(rows.flatMap(row => Object.keys(row.values)))], rows, ...(stats ? { stats } : {}), diagnostics,
        latencyMs: Math.round(response.latencyMs || 0) });
      if (diagnostics.some(item => item.severity === 'error')) {
        arm.status = 'partial';
        arm.error = { code: 'studio_graph_diagnostics', message: 'Foundry IQ reported a graph query error; the returned rows are shown as is.' };
      }
    }
    arm.graph = { kind: 'native', dataset: g.dataset, statements };
    arm.hits = unique(order.slice(0, 50).map((chunkId, i) => passageHit(cited.get(chunkId), i + 1, {}, profile))).slice(0, 10)
      .map(({ leafId, ...hit }) => ({ ...hit, citedBy: statements.flatMap(statement => statement.rows).filter(row => row.sources.includes(hit.sourceId)).length }));
    trace.configuration.graphStatements = statements.length;
    trace.steps.push('Native Foundry IQ entity-graph query (docs/search.graph) with hydrated provenance: each row is a path, cited by the passages its edges were extracted from.');
    if (statements.some(statement => statement.outcome === 'absence')) trace.steps.push('A statement expected to return no rows returned none: Foundry IQ found no such path in the graph.');
  }
  arm.hits = arm.hits.map(({ leafId, ...hit }) => hit);
  arm.citations = arm.hits.map(hit => ({ id: hit.id, sourceId: hit.sourceId, ...(hit.url ? { url: hit.url } : {}) }));
  trace.latencyMs = latency;
  trace.configuration.latencyScope = 'observed Foundry IQ HTTP attempts for this arm; schema check excluded';
  return arm;
}

const configHierarchy = () => {
  const nodes = new Map(graphConfig.topics.hierarchy.map(node => [node.id, node]));
  const build = id => { const node = nodes.get(id); return { id, title: node.title, level: node.level, proportion: node.proportion,
    children: (node.children || []).map(build) }; };
  return graphConfig.topics.hierarchy.filter(node => !node.parent).map(node => build(node.id));
};

/** Standalone deterministic Sample for the curated native questions: replays the graph session's live-verified rows and
 * source lists over local public records. Returns null for any other question (the local illustration handles those). */
export function nativeSampleArm(scenario, side, snapshot, hitFor) {
  const preset = scenario.id === 'S08' ? graphPresetFor(snapshot.query) : topicPresetFor(snapshot.query);
  if (!preset || (scenario.id === 'S08' && side === 'baseline')) return null;
  const kind = scenario[side];
  const trace = { steps: ['Deterministic Sample: the curated question’s live-verified Foundry IQ results, replayed over local public records; not a live call.'],
    configuration: { ...snapshot, mechanism: kind, dataset: graphConfig.dataset, synthetic: true, presetId: preset.id } };
  const hits = ids => [...new Set(ids)].map((id, i) => hitFor(id, i + 1)).filter(Boolean).slice(0, Math.min(snapshot.topK, 10));
  if (scenario.id === 'S08') {
    const statements = preset.statements.map((statement, i) => {
      const rows = (preset.verified[i]?.rows || []).map(values => ({ values, sources: preset.verified[i].citations || [] }));
      return { label: statement.label, gql: statement.gql, expectRows: statement.expectRows,
        outcome: rows.length ? 'rows' : statement.expectRows === 0 ? 'absence' : 'none', ...pathOf(statement.gql),
        columns: [...new Set(rows.flatMap(row => Object.keys(row.values)))], rows, diagnostics: [] };
    });
    const cited = hits(preset.verified.flatMap(item => item.citations || []));
    return { status: 'success', kind, trace, graph: { kind: 'native', dataset: graphConfig.dataset, statements },
      hits: cited.map(hit => ({ ...hit, citedBy: statements.flatMap(statement => statement.rows).filter(row => row.sources.includes(hit.sourceId)).length })),
      citations: cited.map(hit => ({ id: hit.id, sourceId: hit.sourceId, ...(hit.url ? { url: hit.url } : {}) })) };
  }
  const verified = preset.verified?.[side === 'baseline' ? 'off' : 'on'];
  if (!verified) return null;
  const arm = { status: 'success', kind, trace, hits: withTopics(hits(verified.sources).slice(0, NATIVE_TOP)) };
  arm.topicCoverage = coverage(arm.hits);
  if (side === 'enhanced') arm.topics = { kind: 'native', hierarchy: configHierarchy() };
  arm.citations = arm.hits.map(hit => ({ id: hit.id, sourceId: hit.sourceId, ...(hit.url ? { url: hit.url } : {}) }));
  return arm;
}

/** Corpus themes for the "themes" questions in the standalone Sample (no per-question source list was verified). */
export const sampleTopics = () => ({ kind: 'native', hierarchy: configHierarchy() });
