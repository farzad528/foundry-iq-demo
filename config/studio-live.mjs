import { validDocumentLanguage } from './studio-languages.mjs';

export const SEARCH_API_VERSION = '2025-09-01';
export const AGENTIC_SEARCH_API_VERSION = '2026-11-01-preview';
export const KB_API_VERSION = '2026-08-01-preview';
export const KB_CANDIDATE_API_VERSION = '2026-11-01-preview'; // Documentation only, never sent.
export const ANSWER_API_VERSION = '2024-10-21';
export const IMAGE_API_VERSION = '2024-02-01';
const name = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const attested = value => exact(value, ['checkedAt', 'region', 'evidenceVersion'])
  && /^\d{4}-\d\d-\d\d$/.test(value.checkedAt || '') && name(value.region) && name(value.evidenceVersion);
export function searchOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.search\.windows\.net$/.test(url.hostname)
      || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
export function answerOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.openai\.azure\.com$/.test(url.hostname)
      || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
export function imageOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.cognitiveservices\.azure\.com$/.test(url.hostname)
      || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
// This server-only JSON is an explicit operator allowlist, never accepted from a request.
// ETags bind schema checks to the reviewed resource revision. An attestation is not a live canary.
export function liveConfiguration(env, id, language = 'en') {
  const unavailable = reason => ({ available: false, reason });
  if (!validDocumentLanguage(language)) return unavailable('Unsupported document language.');
  if (env.FOUNDRY_IQ_LIVE_ENABLED !== 'true') return unavailable('Live disabled by operator kill switch.');
  if (env.FOUNDRY_IQ_KILL_SWITCH === 'true') return unavailable('Live disabled by emergency kill switch.');
  if (!searchOrigin(env.AZURE_SEARCH_ENDPOINT) || !env.AZURE_SEARCH_API_KEY) return unavailable('Canonical Search endpoint and server-side Search credentials required.');
  let all;
  try { all = JSON.parse(env.STUDIO_LIVE_CONFIG || '{}'); } catch { return unavailable('Invalid server scenario allowlist.'); }
  if (!exact(all, ['datasetVersion', 'resourceVersion', 'scenarios', 'languages'])
    || all.datasetVersion !== 'zava-studio-2026-01' || !name(all.resourceVersion) || !record(all.scenarios)
    || Object.keys(all.scenarios).some(key => !/^S(?:0[1-9]|1[01])$/.test(key))) return unavailable('Versioned server scenario allowlist required.');
  if (language !== 'en') {
    const localized = all.languages?.[language];
    if (!exact(localized, ['resourceVersion', 'scenarios']) || !name(localized.resourceVersion)
      || !record(localized.scenarios) || Object.keys(localized.scenarios).some(key => !/^S(?:0[1-9]|1[01])$/.test(key))) {
      return unavailable(`The ${language} document corpus has not been configured or verified. English retrieval is not substituted.`);
    }
    all = { ...all, ...localized };
  }
  const config = all.scenarios[id];
  if (!exact(config, ['index', 'indexETag', 'standardIndex', 'standardIndexETag', 'attestation', 'vector',
    'synonymMaps', 'scoringProfiles', 'scoringParameters', 'kb', 'kbETag', 'kbEffort', 'graphRetrieval', 'projectionIndex', 'projectionIndexETag', 'sources', 'answer', 'agentic', 'customDatasetVersion', 'extraction', 'semantic', 'image', 'language', 'corpusHash'])
    || !attested(config.attestation)) return unavailable('Scenario resource/schema attestation required.');
  const index = (n, etag) => name(n) && typeof etag === 'string' && etag.length > 0 && etag.length < 200;
  if (!index(config.index, config.indexETag)) return unavailable('Reviewed index and exact schema ETag required.');
  if (language !== 'en' && (config.language !== language || !config.index.startsWith(`zava-studio-${language}-`)
    || config.standardIndex && !config.standardIndex.startsWith(`zava-studio-${language}-`)
    || config.projectionIndex && !config.projectionIndex.startsWith(`zava-studio-${language}-`))) {
    return unavailable('Every comparison index must belong to the selected document language; English fallback is forbidden.');
  }
  if (['S02', 'S03', 'S04', 'S05', 'S06', 'S07'].includes(id)) {
    const v = config.vector;
    if (!exact(v, ['field', 'profile', 'vectorizer', 'provider', 'deployment', 'model', 'modelVersion', 'dimensions'])
      || ![v.field, v.profile, v.vectorizer, v.deployment, v.model, v.modelVersion].every(name)
      || !Number.isInteger(v.dimensions) || v.dimensions < 1 || v.dimensions > 4096) return unavailable('Pinned corpus/query Azure OpenAI vectorizer, model/version and dimensions required.');
    if (v.provider !== undefined && v.provider !== 'serverAzureOpenAI') return unavailable('Unknown text embedding provider.');
    if (v.provider === 'serverAzureOpenAI' && (!answerOrigin(env.STUDIO_TEXT_ENDPOINT)
      || !(env.STUDIO_TEXT_API_KEY || env.STUDIO_MODEL_AUTH === 'entra'))) return unavailable('Reviewed server text embedding endpoint and credentials required.');
    if (v.provider === 'serverAzureOpenAI' && language !== 'en' && !/^[a-f0-9]{64}$/.test(config.corpusHash || '')) {
      return unavailable('Reviewed localized corpus hash and pinned encoder required.');
    }
  }
  if (id === 'S04' && (!exact(config.semantic, ['configuration', 'carrier'])
    || !name(config.semantic.configuration) || config.semantic.carrier !== 'keyword-id')) {
    return unavailable('Reviewed semantic configuration and searchable keyword ID carrier required; wildcard-only semantic ranking is unsupported.');
  }
  if (id === 'S11') {
    const image = config.image;
    if (!exact(image, ['provider', 'field', 'profile', 'model', 'modelVersion', 'dimensions', 'corpus', 'vectorizer'])
      || image.provider !== 'azureVision' || !name(image.field) || !name(image.profile)
      || image.model !== 'azure-vision-multimodal' || !['2023-04-15', '2022-04-11'].includes(image.modelVersion)
      || image.dimensions !== 1024 || !exact(image.corpus, ['model', 'modelVersion', 'dimensions', 'manifestHash'])
      || image.corpus.model !== image.model || image.corpus.modelVersion !== image.modelVersion
      || image.corpus.dimensions !== image.dimensions || !/^[a-f0-9]{64}$/.test(image.corpus.manifestHash || '')
      || (image.vectorizer !== undefined ? !name(image.vectorizer)
        : !imageOrigin(env.STUDIO_IMAGE_ENDPOINT) || !(env.STUDIO_IMAGE_API_KEY || env.STUDIO_MODEL_AUTH === 'entra'))) {
      return unavailable('Compatible pinned Azure Vision image encoder, corpus metadata, dimensions and server-only credentials required; no text-vector substitute.');
    }
  }
  if (id === 'S01' && (!Array.isArray(config.synonymMaps) || !config.synonymMaps.length || !config.synonymMaps.every(name))) return unavailable('Reviewed synonym map configuration required.');
  if (id === 'S06' && (!exact(config.scoringProfiles, ['freshness', 'magnitude', 'distance', 'tags', 'availability'])
    || ['freshness', 'magnitude', 'distance', 'tags', 'availability'].some(subtype => !name(config.scoringProfiles[subtype])))) return unavailable('Reviewed subtype scoring profiles required.');
  if (id === 'S06') {
    const parameters = config.scoringParameters;
    if (!exact(parameters, ['distance', 'tags'])
      || !exact(parameters.distance, ['parameter', 'longitude', 'latitude']) || !name(parameters.distance.parameter)
      || !Number.isFinite(parameters.distance.longitude) || Math.abs(parameters.distance.longitude) > 180
      || !Number.isFinite(parameters.distance.latitude) || Math.abs(parameters.distance.latitude) > 90
      || !exact(parameters.tags, ['parameter', 'values']) || !name(parameters.tags.parameter)
      || !Array.isArray(parameters.tags.values) || !parameters.tags.values.length || parameters.tags.values.length > 20
      || parameters.tags.values.some(value => !name(value))) return unavailable('Reviewed server-only scoring parameters for distance and tags are required.');
  }
  if (id === 'S08' && config.graphRetrieval !== 'index') {
    if (!index(config.kb, config.kbETag) || !Array.isArray(config.sources) || !config.sources.length
      || config.sources.length > 10 || config.sources.some(s => !exact(s, ['name', 'kind']) || !name(s.name) || s.kind !== 'searchIndex')
      || new Set(config.sources.map(s => s.name)).size !== config.sources.length) return unavailable('Pinned indexed-only KB and source allowlist required.');
  }
  if (config.graphRetrieval !== undefined && (id !== 'S08' || config.graphRetrieval !== 'index')) return unavailable('Unknown custom graph evidence retrieval mode.');
  if (config.projectionIndex !== undefined && (!['S08', 'S09'].includes(id) || !index(config.projectionIndex, config.projectionIndexETag))) return unavailable('Reviewed projection index/ETag required.');
  if (id === 'S07') {
    if (!exact(config.agentic, ['apiVersion', 'maxRuntimeInSeconds', 'knowledgeRetrievalPlan'])
      || config.agentic.apiVersion !== AGENTIC_SEARCH_API_VERSION || !Number.isInteger(config.agentic.maxRuntimeInSeconds)
      || config.agentic.maxRuntimeInSeconds < 1 || config.agentic.maxRuntimeInSeconds > 30) {
      return unavailable('Reviewed single-index agentic Search preview configuration required; KB fallback is not supported.');
    }
    if (config.agentic.knowledgeRetrievalPlan !== 'standard') {
      return unavailable('Single-index agentic Search requires paid Standard Knowledge Retrieval on foundry-iq-demos. The current Free plan is unsupported; operator approval is required to change it.');
    }
    // Without a reviewed answer model, S07 is an evidence-only retrieval comparison (no generated answers).
    if (config.answer !== undefined && (!exact(config.answer, ['deployment', 'modelVersion', 'instructionsVersion', 'reasoningEffort'])
      || ![config.answer.deployment, config.answer.modelVersion, config.answer.instructionsVersion].every(name)
      || config.answer.reasoningEffort !== undefined && config.answer.reasoningEffort !== 'none'
      || config.answer.instructionsVersion !== 'studio-grounded-answer-v1'
      || !answerOrigin(env.STUDIO_ANSWER_ENDPOINT) || !(env.STUDIO_ANSWER_API_KEY || env.STUDIO_MODEL_AUTH === 'entra'))) return unavailable('Same reviewed answer model and instructions for both arms required.');
  }
  if (config.kbEffort !== undefined && (id !== 'S08' || !['minimal', 'low'].includes(config.kbEffort))) return unavailable('Only S08 explicitly supports a minimal indexed-only KB baseline.');
  if (['S08', 'S09'].includes(id) && config.customDatasetVersion !== 'zava-studio-2026-01') return unavailable('Custom graph/topic must be explicitly bound to the public synthetic manifest.');
  if (id === 'S10' && (!index(config.standardIndex, config.standardIndexETag)
    || config.index === config.standardIndex || !exact(config.extraction, ['sourceHash', 'basicVersion', 'standardVersion',
      'provider', 'apiVersion', 'basicAnalyzer', 'standardAnalyzer', 'basicOperationId', 'standardOperationId'])
    || !/^[a-f0-9]{64}$/.test(config.extraction.sourceHash || '')
    || !name(config.extraction.basicVersion) || !name(config.extraction.standardVersion))) return unavailable('Equivalent pre-indexed PDF extraction revisions and shared source hash required; uploads unavailable.');
  if (id === 'S10' && config.extraction.provider !== undefined) {
    const extraction = config.extraction;
    if (extraction.provider !== 'azureContentUnderstanding' || extraction.apiVersion !== '2025-11-01'
      || extraction.basicAnalyzer !== 'prebuilt-read' || extraction.standardAnalyzer !== 'prebuilt-layout'
      || ![extraction.basicOperationId, extraction.standardOperationId].every(value => /^[a-f0-9-]{36}$/.test(value || ''))
      || extraction.basicOperationId === extraction.standardOperationId) return unavailable('Executed, distinct native CU Read/Layout operations and pinned API required.');
  } else if (id === 'S10' && Object.keys(config.extraction).length !== 3) return unavailable('Native CU provenance cannot be attached to a custom extraction.');
  return { available: true, config, datasetVersion: all.datasetVersion, resourceVersion: all.resourceVersion };
}
