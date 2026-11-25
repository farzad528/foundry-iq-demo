import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HttpError } from './protocol.mjs';
import { nativeGraphArm } from './native-graph.mjs';
import { liveContext, failure } from './studio.mjs';
import { SEARCH_API_VERSION } from '../config/studio-live.mjs';
import { industryScenarioCopy } from '../config/studio-scenarios.mjs';

// Native Foundry IQ entity-graph (S08) and topic-graph (S09) search for the industry datasets. They run on a dedicated
// Search service (AZURE_SEARCH_GRAPH_ENDPOINT / AZURE_SEARCH_GRAPH_QUERY_KEY) with the same calls as the Zava graph.
// Curated questions, allowlisted GQL, notes and topic maps come from config/studio-industry-graph.json (copied from the
// graph session's runtime contract); passage UIDs and blob URLs are keyed by SHA-256 prefixes, and index names stay in the
// private binding. The browser never sends GQL.
export const industryGraphConfig = JSON.parse(readFileSync(new URL('../config/studio-industry-graph.json', import.meta.url), 'utf8'));
export const GRAPH_TIMEOUT_MS = 10000;
export const GRAPH_KINDS = { S08: ['passages', 'graph'], S09: ['hybrid', 'topics'] };
const TOPIC_FIELDS = ['subject_id', 'predicate', 'object_id', 'object_string', 'object_double'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const name = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
const etag = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const hash = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
const badSchema = () => { throw new HttpError(503, 'studio_schema_unverified', 'Reviewed resource schema or ETag does not match.'); };

const profiles = new Map();
/** Dataset profile for nativeGraphArm: source IDs from blob URLs, topic leaves per passage (with a per-source fallback). */
export function industryGraphProfile(id) {
  const data = industryGraphConfig.industries?.[id];
  if (!data) return null;
  if (!profiles.has(id)) {
    profiles.set(id, {
      zava: false, dataset: data.dataset, presets: { s08: data.s08, s09: data.s09 }, select: 'uid,snippet,blob_url',
      sourceOf: item => (typeof item?.blob_url === 'string' ? data.sourceOfBlob[hash(item.blob_url)] : undefined),
      passageId: (item, sourceId) => (typeof item?.uid === 'string' ? `${sourceId}#${hash(item.uid).slice(0, 8)}` : sourceId),
      urlOf: sourceId => data.sourceUrls[sourceId],
      leafOf: (item, sourceId) => (typeof item?.uid === 'string' && data.topics.leafOfPassage[hash(item.uid)]) || data.topics.leafOfSource[sourceId],
      leaves: data.topics.leaves,
    });
  }
  return profiles.get(id);
}

/** Validates the private industry graph binding for one industry; null when it isn't usable. */
export function industryGraphBinding(graph, id) {
  const binding = graph?.industries?.[id];
  if (!object(binding) || ![binding.content, binding.graph, binding.topic, binding.semanticConfiguration, binding.vectorField].every(name)
    || ![binding.contentETag, binding.graphETag, binding.topicETag].every(etag) || !industryGraphProfile(id)) return null;
  return binding;
}

/** Checks the bundled, ETag-pinned attestations of the industry content, graph and topic indexes (no runtime schema GET). */
export async function verifyIndustryGraph(http, binding, scenarioId) {
  const read = async (index, expected) => {
    const result = await http(`/indexes/${encodeURIComponent(index)}?api-version=${SEARCH_API_VERSION}`);
    if (result.etag !== expected || result.data?.name !== index || !Array.isArray(result.data.fields)) badSchema();
    return { schema: result.data, fields: new Map(result.data.fields.map(field => [field.name, field])) };
  };
  const content = await read(binding.content, binding.contentETag);
  const field = key => content.fields.get(key);
  if (!field('uid')?.key || !field('snippet')?.searchable || field('snippet').retrievable === false || !field('blob_url') || field('blob_url').retrievable === false
    || field(binding.vectorField)?.type !== 'Collection(Edm.Single)' || !field(binding.vectorField).vectorSearchProfile) badSchema();
  const profile = content.schema.vectorSearch?.profiles?.find(item => item.name === field(binding.vectorField).vectorSearchProfile);
  const vectorizer = content.schema.vectorSearch?.vectorizers?.find(item => item.name === profile?.vectorizer);
  // Query text is vectorized by Search through its own identity: no key and no identity override.
  if (vectorizer?.kind !== 'azureOpenAI' || vectorizer.azureOpenAIParameters?.apiKey || vectorizer.azureOpenAIParameters?.authIdentity) badSchema();
  if (scenarioId === 'S08') {
    if (!content.schema.semantic?.configurations?.some(item => item.name === binding.semanticConfiguration)) badSchema();
    const graph = await read(binding.graph, binding.graphETag);
    if (!graph.schema.graphProfile || !['subject_id', 'predicate', 'object_id', 'chunk_id'].every(key => graph.fields.has(key))) badSchema();
  } else {
    const topic = await read(binding.topic, binding.topicETag);
    if (TOPIC_FIELDS.some(key => !topic.fields.has(key) || topic.fields.get(key).retrievable === false) || !topic.fields.get('predicate').filterable) badSchema();
  }
}

const graphConfigFor = (binding, graph, profile) => ({ index: binding.content, nativeGraph: { graphIndex: binding.graph, topicIndex: binding.topic,
  semanticConfiguration: binding.semanticConfiguration, vectorField: binding.vectorField, apiVersion: graph.apiVersion, dataset: profile.dataset, timeoutMs: GRAPH_TIMEOUT_MS } });

/** Attested-schema preparation for an industry graph comparison; never contacts Search. */
export async function prepareIndustryGraph(request, graph, { signal, reserveAttempt, releaseAttempt }) {
  const context = liveContext({ env: graph.env, signal, metadata: graph.metadata, reserveAttempt, releaseAttempt,
    fetchUpstream: () => { throw new HttpError(503, 'studio_capability_unavailable', 'Preparation never contacts Foundry IQ.'); } });
  await verifyIndustryGraph(context.http, graph.binding, request.scenarioId);
  return { ready: true, phase: 'comparison', maxComparisonAttempts: 2 };
}

/** Runs both arms of an industry S08/S09 comparison on the graph service, with per-arm API logs; Search reads only. */
export async function runIndustryGraphComparison(request, graph, { signal, requestId, reserveAttempt, releaseAttempt }) {
  const context = liveContext({ env: graph.env, signal, fetchUpstream: graph.fetchUpstream, metadata: graph.metadata, reserveAttempt, releaseAttempt });
  await verifyIndustryGraph(context.http, graph.binding, request.scenarioId);
  const [baselineKind, enhancedKind] = GRAPH_KINDS[request.scenarioId];
  const scenario = { id: request.scenarioId, baseline: baselineKind, enhanced: enhancedKind };
  const snapshot = { query: request.query, topK: request.topK, industry: request.industry.id };
  const config = graphConfigFor(graph.binding, graph, graph.profile);
  const apiLogs = { baseline: [], enhanced: [] };
  const settled = await Promise.allSettled(['baseline', 'enhanced'].map(side =>
    nativeGraphArm(scenario, side, snapshot, config, context.withLog(apiLogs[side]), graph.profile)));
  const arms = settled.map((result, i) => result.status === 'fulfilled' ? result.value
    : failure(signal?.aborted ? new DOMException('Comparison cancelled', 'AbortError') : result.reason, GRAPH_KINDS[request.scenarioId][i], snapshot, requestId));
  arms.forEach((arm, i) => {
    arm.apiLog = apiLogs[i ? 'enhanced' : 'baseline'];
    arm.label ||= { S08: ['Plain retrieval: hybrid + semantic ranker', 'Foundry IQ entity graph'], S09: ['Hybrid search, topic diversification off', 'Topic-balanced retrieval + themes'] }[request.scenarioId][i];
  });
  const [baseline, enhanced] = arms;
  const completed = arms.filter(arm => ['success', 'partial'].includes(arm.status)).length;
  return {
    runId: requestId, mode: 'live', industry: request.industry.id, scenarioId: request.scenarioId, query: request.query, baseline, enhanced,
    comparison: { intendedDifference: industryScenarioCopy[request.scenarioId].description, snapshot, scoreComparison: 'Unlike score types are not numerically compared.' },
    executionStatus: completed === 2 && arms.every(arm => arm.status === 'success') ? 'success' : completed ? 'partial_success'
      : arms.every(arm => arm.status === 'cancelled') ? 'cancelled' : 'error',
  };
}
