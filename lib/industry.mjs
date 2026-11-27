import { readFileSync } from 'node:fs';
import { HttpError } from './protocol.mjs';
import { liveContext, searchHits, withRetrievable, agenticDiagnostics, failure, validateImage } from './studio.mjs';
import { SEARCH_API_VERSION, AGENTIC_SEARCH_API_VERSION, imageOrigin } from '../config/studio-live.mjs';
import { industryScenarioCopy } from '../config/studio-scenarios.mjs';
import { prepareIndustryGraph, runIndustryGraphComparison } from './industry-graph.mjs';

// Industry demos on public U.S. government data (English only). Each industry is one Foundry IQ index with the same
// schema contract; requests follow the Industry datasets evaluation exactly. Filters, facets, scoring profiles and S10
// documents come only from the server-side preset allowlist in config/studio-industries.json; index names come from the
// private binding compiled into the server bundle.
export const industryCatalog = JSON.parse(readFileSync(new URL('../config/studio-industries.json', import.meta.url), 'utf8'));
export const INDUSTRY_IDS = Object.freeze(industryCatalog.industries.map(industry => industry.id));
export const industryById = id => industryCatalog.industries.find(industry => industry.id === id);
export const BASE_FILTER = "scope eq 'public' and variant eq 'primary'";
const SELECT = 'id,sourceId,title,content,url,scope';
const name = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = message => { throw new HttpError(400, 'invalid_studio_request', message); };
const badSchema = () => { throw new HttpError(503, 'studio_schema_unverified', 'Reviewed resource schema or ETag does not match.'); };
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
// Base fields plus every retrievable attested field; url only when the index has one.
const selectFor = fields => withRetrievable(fields?.has?.('url') === false ? SELECT.replace(',url', '') : SELECT, fields);

// Arm kinds per scenario (BEFORE, AFTER); labels are shown in the arm headers.
export const INDUSTRY_KINDS = {
  S01: ['plainKeyword', 'fulltext'], S02: ['lexical', 'vector'], S03: ['lexical', 'hybrid'], S04: ['hybrid', 'rerank'],
  S05: ['lexical', 'filteredHybrid'], S06: ['hybrid', 'boost'], S07: ['singlePass', 'planned'], S08: ['passages', 'graph'], S09: ['hybrid', 'topics'],
  S10: ['basic', 'layout'], S11: ['metadata', 'image'],
};
// Native entity (S08) and topic (S09) graphs for an industry run on the optional graph Search service (graph contract pending).
export const GRAPH_SCENARIOS = Object.freeze(['S08', 'S09']);
const ARM_LABELS = {
  S01: ['Plain keyword: every term', 'Full-text analyzers + synonyms'], S02: ['Keyword matching', 'Vector similarity'],
  S03: ['Keyword search', 'Hybrid search'], S04: ['Hybrid candidates', 'Semantic reranking'],
  S05: ['Keyword search, no filter', 'Filtered hybrid + facets'], S06: ['Hybrid search', 'Hybrid + scoring profile'],
  S07: ['Single-pass hybrid retrieval', 'Single-index agentic retrieval'], S08: ['Plain retrieval: hybrid + semantic ranker', 'Foundry IQ entity graph'],
  S09: ['Hybrid search, topic diversification off', 'Topic-balanced retrieval + themes'], S10: ['Read: page text', 'Layout: table rows'],
  S11: ['Keyword search: product text', 'Image similarity: Foundry IQ image vectors'],
};
// Reviewed S05 sort and S06 scoring-parameter expressions (from presets and catalog defaults only, never from the client).
export const isOrderBy = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63} (?:asc|desc)$/.test(value);
export const isScoringParameter = value => typeof value === 'string' && value.length <= 200
  && /^[A-Za-z][A-Za-z0-9_]{0,63}-[^,;\\'"\u0000-\u001f]{1,60}(?:,[^,;\\'"\u0000-\u001f]{1,60}){0,9}$/.test(value);
// Azure Vision multimodal text input is limited to 70 words.
const VISION_TEXT_WORDS = 70;
const words = text => text.split(/\s+/).filter(Boolean).length;

/** Field names a reviewed OData preset filter reads (string literals and any() lambda variables excluded); checked at build time. */
export function filterFields(filter) {
  const text = String(filter ?? '').replace(/'(?:[^']|'')*'/g, "''");
  const lambdas = new Set([...text.matchAll(/\/any\(\s*([A-Za-z_]\w*)\s*:/g)].map(match => match[1]));
  const names = [...text.matchAll(/\b([A-Za-z_]\w*)(?=\/any\(|\s+(?:eq|ne|gt|ge|lt|le)\s)/g), ...text.matchAll(/\bsearch\.in\(\s*([A-Za-z_]\w*)/g)].map(match => match[1]);
  return [...new Set(names.filter(name => !lambdas.has(name)))];
}

/** Exact curated example for this industry and scenario, or undefined for free text. */
export function industryPreset(industry, scenarioId, query) {
  const text = String(query ?? '').trim();
  return (industry?.presets?.[scenarioId] || []).find(preset => preset.query === text);
}

/** Validates a private industry binding (built from attestations); returns null when it isn't usable. */
export function industryBinding(bindings, id) {
  const binding = bindings?.industries?.[id];
  const subtypes = industryById(id)?.boostSubtypes || [];
  if (!object(binding) || !name(binding.index) || typeof binding.indexETag !== 'string' || !binding.indexETag || binding.indexETag.length > 200
    || !name(binding.semanticConfiguration) || !name(binding.vectorField) || !object(binding.scoringProfiles)
    || Object.entries(binding.scoringProfiles).some(([subtype, profile]) => !subtypes.includes(subtype) || !name(profile))
    || binding.image !== undefined && !validImageBinding(binding.image)
    || !Number.isInteger(bindings.agentic?.maxRuntimeInSeconds) || bindings.agentic.maxRuntimeInSeconds < 1 || bindings.agentic.maxRuntimeInSeconds > 30) return null;
  return { ...binding, maxRuntimeInSeconds: bindings.agentic.maxRuntimeInSeconds };
}
/** S11 image binding: the image vector field, its profile and Search-side Azure Vision vectorizer, and the indexed corpus. */
function validImageBinding(image) {
  return object(image) && name(image.field) && name(image.profile) && name(image.vectorizer) && name(image.model)
    && typeof image.modelVersion === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(image.modelVersion)
    && Number.isInteger(image.dimensions) && image.dimensions > 0 && image.dimensions <= 4096 && /^[a-f0-9]{64}$/.test(image.manifestHash || '');
}

/** Public scenario descriptors for one industry (status and Sample availability are added by the handler). */
export function industryScenarios(industry) {
  return industry.scenarios.map(id => {
    const copy = industryScenarioCopy[id];
    const presets = industry.presets?.[id] || [];
    const [baseline, enhanced] = INDUSTRY_KINDS[id];
    const description = industry.scenarioDescriptions?.[id] || copy.description;
    return {
      id, industry: industry.id, title: copy.title, description, liveDescription: description, difference: description,
      baseline, enhanced, renderer: id === 'S10' ? 'pdfEvidence' : id === 'S11' ? 'imageGallery' : 'documentCards', limits: copy.limits,
      sampleQuery: presets[0]?.query || '', queries: presets.map(preset => preset.query),
      demoPresets: presets.map(({ label, hint, query, boostSubtype }) => ({ label: label || query, query, ...(hint ? { hint } : {}), ...(boostSubtype ? { boostSubtype } : {}) })),
      input: ['text'], acceptedInputTypes: ['text'], defaultTopK: 10, topK: [5, 10, 20, 50], language: 'en',
      ...(id === 'S06' ? { boostSubtypes: [...industry.boostSubtypes], defaultBoostSubtype: industry.boostSubtypes[0], liveWeightConfigurable: false } : {}),
      ...(id === 'S11' ? { imageOnlyQuery: 'Image-only reference search' } : {}),
    };
  });
}

/** Validates an industry comparison request. Filters, facets, sorts, scoring parameters and documents are never accepted from the client. */
export function validateIndustryRequest(body) {
  if (!object(body) || Object.keys(body).some(key => !['industry', 'scenarioId', 'mode', 'query', 'topK', 'options', 'language', 'imageInput'].includes(key))) {
    invalid('Unsupported comparison fields.');
  }
  const industry = industryById(body.industry);
  if (!industry) invalid('Select a supported industry.');
  if ((body.language ?? 'en') !== 'en') invalid('This industry demo is English-only.');
  if (!['sample', 'live'].includes(body.mode)) invalid('Select an explicit sample/live mode.');
  if (!industry.scenarios.includes(body.scenarioId)) invalid('This scenario does not apply to the selected industry.');
  if (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 8000) invalid('Question must be 1–8,000 characters.');
  const topK = body.topK ?? 10;
  if (![5, 10, 20, 50].includes(topK)) invalid('Evidence count must be 5, 10, 20 or 50.');
  const options = body.options ?? {};
  if (!object(options) || Object.keys(options).some(key => key !== 'boostSubtype')) invalid('Unsupported options.');
  if ('boostSubtype' in options && (body.scenarioId !== 'S06' || !industry.boostSubtypes.includes(options.boostSubtype))) invalid('Unknown boost subtype.');
  if ('imageInput' in body && (body.scenarioId !== 'S11' || body.mode !== 'live')) invalid('Inline images are accepted only for Live image search.');
  const imageBytes = 'imageInput' in body ? validateImage(body.imageInput) : null;
  const query = body.query.trim();
  if (body.scenarioId === 'S11' && !imageBytes && words(query) > VISION_TEXT_WORDS) invalid(`Text-to-image search accepts up to ${VISION_TEXT_WORDS} words.`);
  return { industry, scenarioId: body.scenarioId, query, topK, options: { ...options }, mode: body.mode, preset: industryPreset(industry, body.scenarioId, query), imageBytes };
}

/** Checks the bundled, ETag-pinned attestation for an industry index against what each scenario needs. */
export async function verifyIndustryIndex(http, binding, scenarioId, industry) {
  const result = await http(`/indexes/${encodeURIComponent(binding.index)}?api-version=${SEARCH_API_VERSION}`);
  const schema = result.data;
  if (result.etag !== binding.indexETag || schema?.name !== binding.index || !Array.isArray(schema.fields)) badSchema();
  const fields = new Map(schema.fields.map(field => [field.name, field]));
  const field = key => fields.get(key);
  const id = field('id');
  if (!id?.key || !id.searchable || !id.filterable || id.analyzer !== 'keyword') badSchema();
  for (const key of ['title', 'content']) if (!field(key)?.searchable || field(key).retrievable === false) badSchema();
  if (scenarioId === 'S01') for (const key of ['titlePlain', 'contentPlain']) if (!field(key)?.searchable) badSchema();
  for (const key of ['scope', 'variant']) if (!field(key)?.filterable) badSchema();
  // Citation links are optional (a product catalog may have none); when present they must be returned.
  if (field('url')?.retrievable === false) badSchema();
  const vector = field(binding.vectorField);
  const profile = schema.vectorSearch?.profiles?.find(item => item.name === vector?.vectorSearchProfile);
  const vectorizer = schema.vectorSearch?.vectorizers?.find(item => item.name === profile?.vectorizer);
  // Query text is vectorized by Search through its own identity: no key and no identity override. A text embedding
  // (Azure OpenAI) or the Azure Vision multimodal model (text-to-image over image vectors) are accepted.
  const vectorizerParameters = vectorizer?.kind === 'azureOpenAI' ? vectorizer.azureOpenAIParameters
    : vectorizer?.kind === 'aiServicesVision' ? vectorizer.aiServicesVisionParameters : undefined;
  if (vector?.type !== 'Collection(Edm.Single)' || !vector.searchable || !vectorizerParameters
    || vectorizerParameters.apiKey || vectorizerParameters.authIdentity) badSchema();
  if (vectorizer.kind === 'aiServicesVision' && (!imageOrigin(vectorizerParameters.resourceUri)
    || binding.image && vectorizerParameters.modelVersion !== binding.image.modelVersion)) badSchema();
  if (['S04', 'S07'].includes(scenarioId) && !schema.semantic?.configurations?.some(item => item.name === binding.semanticConfiguration)) badSchema();
  if (scenarioId === 'S06') {
    for (const subtype of industry.boostSubtypes) {
      if (!binding.scoringProfiles[subtype] || !schema.scoringProfiles?.some(item => item.name === binding.scoringProfiles[subtype])) badSchema();
    }
  }
  if (scenarioId === 'S10') {
    for (const key of ['sourceHash', 'extractionAnalyzer']) if (!field(key)?.filterable || field(key).retrievable === false) badSchema();
    for (const key of ['page', 'row', 'coordinates']) if (!field(key)) badSchema();
  }
  if (scenarioId === 'S11') {
    const image = binding.image;
    if (!image) throw new HttpError(503, 'studio_capability_unavailable', 'Image search isn’t configured for this industry.');
    const imageField = field(image.field);
    const imageProfile = schema.vectorSearch?.profiles?.find(item => item.name === image.profile);
    const imageVectorizer = schema.vectorSearch?.vectorizers?.find(item => item.name === image.vectorizer);
    const p = imageVectorizer?.aiServicesVisionParameters;
    // Search-side Azure Vision vectorizer through the Search system identity: same model version, no key or identity override.
    if (imageField?.type !== 'Collection(Edm.Single)' || !imageField.searchable || imageField.dimensions !== image.dimensions
      || imageField.vectorSearchProfile !== image.profile || imageProfile?.vectorizer !== image.vectorizer || imageVectorizer.kind !== 'aiServicesVision'
      || !p || p.modelVersion !== image.modelVersion || !imageOrigin(p.resourceUri) || p.apiKey || p.authIdentity) badSchema();
    for (const [key, type] of Object.entries({ imageModel: 'Edm.String', imageModelVersion: 'Edm.String', imageDimensions: 'Edm.Int32', imageManifestHash: 'Edm.String' })) {
      if (field(key)?.type !== type || !field(key).filterable || field(key).retrievable === false) badSchema();
    }
    if (field('thumbnailUrl')?.type !== 'Edm.String' || field('thumbnailUrl').retrievable === false) badSchema();
  }
  fields.vectorizerKind = vectorizer.kind;
  fields.synonymMaps = [...new Set(['title', 'content'].flatMap(key => field(key)?.synonymMaps || []))];
  fields.scoringProfiles = schema.scoringProfiles || [];
  return fields;
}

/** Reviewed facet expressions: a field plus optional count, sort and interval parameters (e.g. "publishedDate,interval:year"). */
export const isFacet = value => typeof value === 'string' && value.length <= 100
  && /^[A-Za-z][A-Za-z0-9]*(?:,(?:count:\d{1,3}|sort:-?(?:count|value)|interval:(?:year|quarter|month|week|day|hour|minute|\d{1,6})))*$/.test(value);
/** Request bodies for one arm, matching the Industry datasets evaluation. */
export function industryPayload(scenarioId, side, { query, topK, imageBytes }, binding, industry, preset, options, fields) {
  const select = selectFor(fields);
  const keyword = (filter = BASE_FILTER) => ({ search: query, searchFields: 'title,content', queryType: 'simple', searchMode: 'any', select, top: topK, filter });
  const vectorQueries = [{ kind: 'text', text: query, fields: binding.vectorField, k: 50 }];
  const visionText = () => {
    if (words(query) > VISION_TEXT_WORDS) invalid(`Image-vector text search accepts up to ${VISION_TEXT_WORDS} words.`);
  };
  const hybrid = (filter = BASE_FILTER) => {
    if (fields.vectorizerKind === 'aiServicesVision') visionText();
    return { ...keyword(filter), vectorQueries, vectorFilterMode: 'preFilter' };
  };
  const scoped = filter => filter ? `${BASE_FILTER} and (${filter})` : BASE_FILTER;
  const applied = [];
  let payload;
  switch (scenarioId) {
    case 'S01':
      payload = side === 'baseline' ? { ...keyword(), searchFields: 'titlePlain,contentPlain', searchMode: 'all' } : keyword();
      break;
    case 'S02':
      if (side === 'enhanced' && fields.vectorizerKind === 'aiServicesVision') visionText();
      payload = side === 'baseline' ? keyword() : { vectorQueries, vectorFilterMode: 'preFilter', select, top: topK, filter: BASE_FILTER };
      break;
    case 'S03':
      payload = side === 'baseline' ? keyword(scoped(preset?.filter)) : hybrid(scoped(preset?.filter));
      if (preset?.filter) applied.push({ label: 'Filter (both arms)', value: preset.filter });
      break;
    case 'S04':
      payload = hybrid();
      break;
    case 'S05': {
      if (side === 'baseline') { payload = keyword(); break; }
      const facets = preset ? preset.facets || [] : industry.defaults?.S05?.facets || [];
      if (facets.some(facet => !isFacet(facet) || !fields.get(facet.split(',')[0])?.facetable)) badSchema();
      payload = { ...hybrid(scoped(preset?.filter)), ...(facets.length ? { facets: [...facets] } : {}) };
      if (preset?.orderby !== undefined) {
        // Reviewed sort from the preset only, on a field the attested schema marks sortable.
        if (!isOrderBy(preset.orderby) || !fields.get(preset.orderby.split(' ')[0])?.sortable) badSchema();
        payload.orderby = preset.orderby;
      }
      if (preset?.filter) applied.push({ label: 'Filter', value: preset.filter });
      if (payload.orderby) applied.push({ label: 'Sort', value: payload.orderby });
      if (facets.length) applied.push({ label: 'Facets', value: facets.map(facet => industry.facetLabels?.[facet.split(',')[0]] || facet.split(',')[0]).join(', ') });
      break;
    }
    case 'S06':
      payload = hybrid();
      if (side === 'enhanced') {
        const subtype = options.boostSubtype || preset?.boostSubtype || industry.boostSubtypes[0];
        payload.scoringProfile = binding.scoringProfiles[subtype];
        if (!payload.scoringProfile) badSchema();
        // Tag-boost values come from the example that demonstrates this subtype, else the catalog default for it.
        const parameters = preset?.boostSubtype === subtype && preset.scoringParameters ? preset.scoringParameters
          : industry.defaults?.S06?.scoringParameters?.[subtype];
        if (parameters !== undefined) {
          if (!Array.isArray(parameters) || !parameters.length || parameters.length > 4 || !parameters.every(isScoringParameter)) badSchema();
          payload.scoringParameters = [...parameters];
        }
        applied.push({ label: 'Scoring profile', value: `${subtype} (${payload.scoringProfile})` });
        if (payload.scoringParameters) applied.push({ label: 'Scoring parameters', value: payload.scoringParameters.join('; ') });
      }
      break;
    case 'S11':
      if (side === 'baseline') { payload = keyword(); break; }
      if (!binding.image) throw new HttpError(503, 'studio_capability_unavailable', 'Image search isn’t configured for this industry.');
      if (!imageBytes) visionText();
      // Pure image-vector retrieval: the uploaded image, or the text, vectorized by Search with the indexed Vision model.
      payload = { vectorQueries: [imageBytes
        ? { kind: 'imageBinary', base64Image: imageBytes.toString('base64'), fields: binding.image.field, k: topK, exhaustive: true }
        : { kind: 'text', text: query, fields: binding.image.field, k: topK, exhaustive: true }],
      vectorFilterMode: 'preFilter', select, top: topK, filter: BASE_FILTER };
      applied.push({ label: 'Query input', value: imageBytes ? 'Image (sent once, not stored)' : 'Text-to-image' });
      break;
    case 'S07':
      payload = side === 'baseline' ? hybrid()
        : { search: query, queryType: 'agentic', agenticOptions: { maxRuntimeInSeconds: binding.maxRuntimeInSeconds }, debug: 'agentic', filter: BASE_FILTER, select, top: topK };
      break;
    case 'S10': {
      const sourceHash = preset?.sourceHash || industry.defaults?.S10?.sourceHash;
      if (!/^[a-f0-9]{64}$/.test(sourceHash || '')) throw new HttpError(503, 'studio_capability_unavailable', 'No reviewed PDF is configured for this industry.');
      const analyzer = side === 'baseline' ? 'prebuilt-read' : 'prebuilt-layout';
      payload = keyword(`scope eq 'public' and extractionAnalyzer eq ${quote(analyzer)} and sourceHash eq ${quote(sourceHash)}`);
      applied.push({ label: 'Document', value: `${preset ? 'Example PDF' : 'First example’s PDF'} · source hash ${sourceHash.slice(0, 12)}…` });
      break;
    }
    default:
      invalid('This scenario does not apply to the selected industry.');
  }
  return { payload, applied };
}

const SCORE_TYPES = { keyword: 'Foundry IQ keyword score (BM25)', vector: 'Foundry IQ vector similarity', hybrid: 'Foundry IQ fused score' };
const scoreTypeOf = payload => payload.vectorQueries && payload.search ? SCORE_TYPES.hybrid : payload.vectorQueries ? SCORE_TYPES.vector : SCORE_TYPES.keyword;
/** Keeps citation links only for https URLs on this industry's public source hosts. */
export function industryLinks(hits, industry) {
  const hosts = new Set(industry.sourceHosts);
  return hits.map(hit => {
    let link = null;
    try {
      const url = new URL(hit.url);
      if (url.protocol === 'https:' && hosts.has(url.host) && !url.username && !url.password && !url.port) link = url.href;
    } catch { /* no link */ }
    const { url, thumbnailUrl, ...rest } = hit;
    // Thumbnails are served only from this build's own /datasets/<industry>/thumbs/ (CSP img-src 'self').
    const thumb = typeof thumbnailUrl === 'string' && new RegExp(`^/datasets/${industry.id}/thumbs/[a-z0-9-]+\\.webp$`).test(thumbnailUrl) ? thumbnailUrl : null;
    return { ...rest, ...(link ? { url: link } : {}), ...(thumb ? { thumbnailUrl: thumb } : {}) };
  });
}
const cites = hits => hits.map(hit => ({ id: hit.id, sourceId: hit.sourceId, ...(hit.url ? { url: hit.url } : {}), ...(hit.page ? { page: hit.page } : {}) }));

async function industryArm(scenarioId, side, request, binding, context, verified, shared) {
  const { industry, preset, options, query, topK } = request;
  const fields = await verified;
  const kind = INDUSTRY_KINDS[scenarioId][side === 'baseline' ? 0 : 1];
  const trace = { steps: ['Schema and ETag checked against the bundled private attestation for this build; no runtime schema request was sent. No retries.'],
    configuration: { query, topK, industry: industry.id, datasetVersion: industryCatalog.datasetVersion, index: binding.index, searchApiVersion: SEARCH_API_VERSION,
      mechanism: kind, scope: 'public', ...(preset ? { presetId: preset.id } : {}),
      embedding: { field: binding.vectorField, scope: 'Foundry IQ vectorized the query text with the index vectorizer; the app sent no embedding request or model credential.' } } };
  const arm = { status: 'success', kind, label: ARM_LABELS[scenarioId][side === 'baseline' ? 0 : 1], hits: [], trace };
  const index = `/indexes/${encodeURIComponent(binding.index)}/docs/search`;
  let response, hits;
  if (scenarioId === 'S04') {
    const candidates = await shared;
    trace.configuration.candidateIds = candidates.hits.map(hit => hit.id);
    trace.configuration.semanticConfiguration = binding.semanticConfiguration;
    trace.configuration.filter = BASE_FILTER;
    response = candidates.response;
    hits = structuredClone(candidates.hits);
    if (side === 'enhanced' && hits.length) {
      const ids = hits.map(hit => hit.id);
      const lucene = value => value.replace(/[\\+\-&|!(){}\[\]^"~*?:/]/g, '\\$&');
      // Keyword IDs give every fixed candidate nonzero L1 relevance; semanticQuery is solely the L2 text.
      response = await context.http(`${index}?api-version=${SEARCH_API_VERSION}`, {
        search: ids.map(id => `id:"${lucene(id)}"`).join(' OR '), queryType: 'full', semanticQuery: query, semanticConfiguration: binding.semanticConfiguration,
        select: selectFor(fields), top: ids.length, filter: `${BASE_FILTER} and (${ids.map(id => `id eq ${quote(id)}`).join(' or ')})`,
        semanticMaxWaitInMilliseconds: 5000 });
      const reranked = searchHits(response.data, topK, undefined, fields);
      const originals = new Map(hits.map(hit => [hit.id, hit]));
      if (reranked.length !== hits.length || reranked.some(hit => !originals.has(hit.id) || hit.snippet !== originals.get(hit.id).snippet)
        || response.data.value.some(item => !Number.isFinite(item['@search.rerankerScore']))) {
        throw new HttpError(502, 'studio_candidate_drift', 'Semantic ranking did not preserve exact candidate IDs/content or report semantic scores.');
      }
      hits = reranked;
      trace.steps.push('Semantic-only L2 query over the exact shared IDs; keyword-ID L1 carrier, no hybrid re-retrieval.');
    } else trace.steps.push('One shared hybrid candidate retrieval; baseline order retained.');
    hits = hits.map(({ score, scoreType, ...hit }) => hit);
  } else {
    const { payload, applied } = industryPayload(scenarioId, side, request, binding, industry, preset, options, fields);
    if (applied.length) arm.applied = applied;
    const agentic = payload.queryType === 'agentic';
    const imageArm = scenarioId === 'S11' && side === 'enhanced';
    // Queries vectorized by the preview Azure Vision vectorizer use the preview Search API, as Zava S11 does.
    const vision = !!payload.vectorQueries && (imageArm || fields.vectorizerKind === 'aiServicesVision');
    const version = agentic || vision ? AGENTIC_SEARCH_API_VERSION : SEARCH_API_VERSION;
    if (imageArm) {
      const image = binding.image;
      trace.configuration.imageEncoder = { provider: 'Azure Vision multimodal embeddings', model: image.model, modelVersion: image.modelVersion,
        dimensions: image.dimensions, field: image.field, corpusManifestHash: image.manifestHash,
        queryVectorization: { mode: 'Foundry IQ aiServicesVision vectorizer', vectorizer: image.vectorizer, kind: request.imageBytes ? 'imageBinary' : 'text', searchApiVersion: version } };
      trace.configuration.embedding = { field: image.field, scope: 'Foundry IQ vectorized the query with the index’s Azure Vision vectorizer; the app sent no embedding request or model credential.' };
      trace.steps.push(request.imageBytes
        ? 'Ephemeral validated image bytes sent once to Foundry IQ, which vectorized them with the pinned Azure Vision multimodal model; not stored or indexed.'
        : 'Text-to-image: Foundry IQ vectorized the query text with the same Azure Vision multimodal model used for the indexed product images.');
    }
    response = await context.http(`${index}?api-version=${version}`, payload);
    trace.configuration.searchApiVersion = version;
    trace.configuration.filter = payload.filter;
    if (payload.scoringProfile) trace.configuration.scoringProfile = payload.scoringProfile;
    if (payload.scoringParameters) trace.configuration.scoringParameters = payload.scoringParameters;
    if (payload.orderby) trace.configuration.orderby = payload.orderby;
    if (payload.facets) trace.configuration.facets = payload.facets;
    if (scenarioId === 'S01' && side === 'enhanced' && fields.synonymMaps.length) trace.configuration.synonymMaps = fields.synonymMaps;
    if (scenarioId === 'S01' && side === 'baseline') trace.steps.push('Unanalyzed title and text fields; every term must match (searchMode all), with no stemming or synonyms.');
    hits = searchHits(response.data, topK, agentic ? undefined : scoreTypeOf(payload), fields);
    if (imageArm && response.data.value.some(item => item.imageModel !== binding.image.model || item.imageModelVersion !== binding.image.modelVersion
      || item.imageDimensions !== binding.image.dimensions || item.imageManifestHash !== binding.image.manifestHash)) {
      throw new HttpError(502, 'studio_image_corpus_mismatch', 'Returned image corpus metadata differs from reviewed encoder compatibility.');
    }
    if (agentic) {
      trace.configuration.agenticSearch = agenticDiagnostics(response.data, context.secrets);
      trace.steps.push('Native single-index agentic Search on the same index as the baseline; no knowledge-base retrieval or external planner.');
      if (response.status === 206 || trace.configuration.agenticSearch.terminationReason !== 'modelStopped') {
        arm.status = 'partial';
        arm.error = { code: 'studio_agentic_incomplete', message: 'Agentic retrieval stopped before completing. Available sources are shown; try Search again shortly.' };
      }
    }
    if (payload.facets && object(response.data['@search.facets'])) arm.facets = response.data['@search.facets'];
    if (scenarioId === 'S10') {
      const analyzer = side === 'baseline' ? 'prebuilt-read' : 'prebuilt-layout';
      if (response.data.value.some(item => item.extractionAnalyzer !== analyzer || !Number.isInteger(item.page) || item.page <= 0
        || side === 'enhanced' && item.chunkType === 'table-row' && (!Number.isInteger(item.row) || !item.coordinates))) {
        throw new HttpError(502, 'studio_pdf_source_mismatch', 'Returned PDF analyzer/page/row does not match the reviewed extraction.');
      }
      trace.configuration.extraction = { provider: 'azureContentUnderstanding', analyzer, timing: 'ingestion, not query time' };
    }
  }
  arm.hits = industryLinks(hits, industry);
  arm.citations = cites(arm.hits);
  trace.requestId = response.requestId || undefined;
  trace.latencyMs = response.latencyMs;
  trace.configuration.latencyScope = scenarioId === 'S04' && side === 'baseline' ? 'shared candidate HTTP attempt' : 'observed retrieval HTTP attempt; schema excluded';
  return arm;
}

/** Validates attested schemas for an industry comparison without contacting Azure. */
const graphUnavailable = () => { throw new HttpError(503, 'studio_graph_not_configured', 'Graph search isn’t configured for this industry yet. The other scenarios work as usual, and Sample results are never substituted.'); };

export async function prepareIndustryComparison(body, { env, metadata, signal, bindings, reserveAttempt, releaseAttempt, graph }) {
  const request = validateIndustryRequest(body);
  if (GRAPH_SCENARIOS.includes(request.scenarioId)) {
    if (!graph) graphUnavailable();
    if (Object.keys(request.options).length) invalid('Unsupported options.');
    return prepareIndustryGraph(request, graph, { signal, reserveAttempt, releaseAttempt });
  }
  const binding = industryBinding(bindings, request.industry.id);
  if (!binding) throw new HttpError(503, 'studio_live_unavailable', 'This industry is not configured on this deployment.');
  const context = liveContext({ env, signal, fetchUpstream: () => { throw new HttpError(503, 'studio_capability_unavailable', 'Preparation never contacts Foundry IQ.'); },
    reserveAttempt, releaseAttempt, metadata });
  await verifyIndustryIndex(context.http, binding, request.scenarioId, request.industry);
  return { ready: true, phase: 'comparison', maxComparisonAttempts: 2 };
}

/** Runs both arms of an industry comparison with per-arm API logs; every upstream call is a bounded Search read. */
export async function runIndustryComparison(body, { env, signal, fetchUpstream, reserveAttempt, releaseAttempt, requestId, metadata, bindings, graph }) {
  const request = validateIndustryRequest(body);
  if (GRAPH_SCENARIOS.includes(request.scenarioId)) {
    if (request.mode !== 'live') invalid('Industry Sample replays recorded examples only.');
    if (!graph) graphUnavailable();
    if (Object.keys(request.options).length) invalid('Unsupported options.');
    return runIndustryGraphComparison(request, graph, { signal, requestId, reserveAttempt, releaseAttempt });
  }
  if (request.mode !== 'live') invalid('Industry Sample replays recorded examples only.');
  const binding = industryBinding(bindings, request.industry.id);
  if (!binding) throw new HttpError(503, 'studio_live_unavailable', 'This industry is not configured on this deployment.');
  const context = liveContext({ env, signal, fetchUpstream, reserveAttempt, releaseAttempt, metadata });
  const verified = verifyIndustryIndex(context.http, binding, request.scenarioId, request.industry);
  void verified.catch(() => {});
  const apiLogs = { shared: [], baseline: [], enhanced: [] };
  let shared;
  if (request.scenarioId === 'S04') {
    shared = verified.then(async fields => {
      const { payload } = industryPayload('S04', 'baseline', request, binding, request.industry, request.preset, request.options, fields);
      const version = fields.vectorizerKind === 'aiServicesVision' ? AGENTIC_SEARCH_API_VERSION : SEARCH_API_VERSION;
      const response = await context.withLog(apiLogs.shared).http(`/indexes/${encodeURIComponent(binding.index)}/docs/search?api-version=${version}`, payload);
      return { response, hits: searchHits(response.data, request.topK, SCORE_TYPES.hybrid, fields) };
    });
    void shared.catch(() => {});
  }
  const snapshot = { query: request.query, topK: request.topK, industry: request.industry.id };
  const settled = await Promise.allSettled(['baseline', 'enhanced'].map(side =>
    industryArm(request.scenarioId, side, request, binding, context.withLog(apiLogs[side]), verified, shared)));
  const arms = settled.map((result, i) => result.status === 'fulfilled' ? result.value
    : failure(signal?.aborted ? new DOMException('Comparison cancelled', 'AbortError') : result.reason, INDUSTRY_KINDS[request.scenarioId][i], snapshot, requestId));
  arms.forEach((arm, i) => {
    arm.apiLog = [...apiLogs.shared.map(entry => ({ ...entry, shared: true })), ...apiLogs[i ? 'enhanced' : 'baseline']];
    if (!arm.label) arm.label = ARM_LABELS[request.scenarioId][i];
  });
  const [baseline, enhanced] = arms;
  const ranks = new Map(baseline.hits.map(hit => [hit.id, hit.rank]));
  const completed = arms.filter(arm => ['success', 'partial'].includes(arm.status)).length;
  return {
    runId: requestId, mode: 'live', industry: request.industry.id, scenarioId: request.scenarioId, query: request.query, baseline, enhanced,
    comparison: { intendedDifference: industryScenarioCopy[request.scenarioId].description, snapshot,
      scoreComparison: 'Unlike score types are not numerically compared.',
      rankMovement: enhanced.hits.filter(hit => ranks.has(hit.id)).map(hit => ({ id: hit.id, before: ranks.get(hit.id), after: hit.rank, movement: ranks.get(hit.id) - hit.rank })) },
    executionStatus: completed === 2 && arms.every(arm => arm.status === 'success') ? 'success' : completed ? 'partial_success'
      : arms.every(arm => arm.status === 'cancelled') ? 'cancelled' : 'error',
  };
}
