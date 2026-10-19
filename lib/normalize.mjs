import { HttpError } from './protocol.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const credentialKey = /^(?:api[-_]?key|authorization|password|secret|client[-_]?secret|access[-_]?token|refresh[-_]?token|connection[-_]?string|cookie|credential|sas[-_]?token)$/i;
const sensitiveQuery = /^(?:sig|se|sp|sv|sr|skt|ske|sks|skv|st|skoid|sktid|code|key|api[-_]?key|token|access_token)$/i;

export function safeUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  if (/^\/samples\/[a-z0-9-]+\.(?:md|csv)$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveQuery.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

export function sanitize(value, secrets = [], depth = 0) {
  if (depth > 24) return '[depth limit]';
  if (typeof value === 'string') {
    let text = value;
    for (const secret of secrets.filter(item => typeof item === 'string' && item.length > 3)) {
      text = text.split(secret).join('[redacted]');
    }
    return text.replace(/https?:\/\/[^\s<>"']+/gi, url => safeUrl(url) || '[unsafe URL removed]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]');
  }
  if (Array.isArray(value)) return value.map(item => sanitize(item, secrets, depth + 1));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, credentialKey.test(key) ? '[redacted]' : sanitize(item, secrets, depth + 1),
  ]));
  return value;
}

const textField = (...values) => values.find(value => typeof value === 'string' && value.trim()) || null;
const identity = value => typeof value === 'string' || (Number.isInteger(value) && value >= 0) ? String(value) : null;

export function normalizeResponse(input, { partial = false, secrets = [] } = {}) {
  if (!record(input) || !Array.isArray(input.response)
    || (input.references != null && !Array.isArray(input.references))
    || (input.activity != null && !Array.isArray(input.activity))) {
    throw new HttpError(502, 'invalid_upstream_response', 'Azure returned an unexpected retrieval response shape.');
  }
  const data = sanitize(input, secrets);
  const limitations = [];
  const activities = data.activity || [];
  const byActivity = new Map();
  for (const activity of activities) {
    if (!record(activity)) throw new HttpError(502, 'invalid_upstream_response', 'Azure returned a malformed activity.');
    const id = identity(activity.id);
    if (id !== null && byActivity.has(id)) {
      byActivity.set(id, null);
      limitations.push(`Activity ID ${id} is duplicated; source linkage is ambiguous.`);
    } else if (id !== null) byActivity.set(id, activity);
  }
  const byReference = new Map();
  const references = (data.references || []).map(annotation => {
    if (!record(annotation)) throw new HttpError(502, 'invalid_upstream_response', 'Azure returned a malformed reference.');
    const id = identity(annotation.id);
    const activityId = identity(annotation.activitySource);
    const activity = activityId === null ? null : byActivity.get(activityId);
    const sourceData = record(annotation.sourceData) ? annotation.sourceData : {};
    const reference = {
      id,
      kind: textField(annotation.type, activity?.type) || 'unknown',
      sourceName: textField(annotation.knowledgeSourceName, activity?.knowledgeSourceName),
      activityId,
      activityLinked: !!activity,
      title: textField(annotation.title, sourceData.title, sourceData.document_title, sourceData.docName, annotation.docKey) || 'Untitled reference',
      passage: textField(sourceData.text, sourceData.content, sourceData.chunk, sourceData.snippet, sourceData.passage, sourceData.summary, sourceData.fabricAnswer),
      location: textField(sourceData.location, sourceData.page,
        Number.isFinite(sourceData.pageNumber) ? String(sourceData.pageNumber) : sourceData.pageNumber, annotation.docKey, annotation.blobUrl),
      url: [annotation.url, sourceData.url, sourceData.document_url, sourceData.metadata_storage_path, annotation.blobUrl, annotation.citationUrl].map(safeUrl).find(Boolean) || null,
      annotation,
    };
    if (id === null) limitations.push('A reference has no valid ID and cannot resolve inline citations.');
    else if (byReference.has(id)) {
      byReference.set(id, null);
      limitations.push(`Reference ID ${id} is duplicated; its inline citations are unresolved.`);
    } else byReference.set(id, reference);
    return reference;
  });
  const texts = [];
  for (const message of data.response) {
    if (!record(message) || !Array.isArray(message.content)) throw new HttpError(502, 'invalid_upstream_response', 'Azure returned malformed response content.');
    for (const content of message.content) {
      if (content?.type === 'text' && typeof content.text === 'string') texts.push(content.text);
      else limitations.push('Non-text response content is available only in the sanitized response inspector.');
    }
  }
  const text = texts.join('\n\n');
  const citations = [...text.matchAll(/\[ref_id:([^\]]+)\]/g)].map(([, id]) => ({
    id,
    resolved: !!byReference.get(id),
  }));
  const unresolved = [...new Set(citations.filter(citation => !citation.resolved).map(citation => citation.id))];
  if (unresolved.length) limitations.push(`Unresolved citation IDs: ${unresolved.join(', ')}.`);
  if (!references.length) limitations.push('No reference evidence was returned. This response is not proof of grounding.');
  const failed = activities.filter(activity => activity.error);
  if (failed.length) {
    partial = true;
    for (const activity of failed) limitations.push(`Activity ${identity(activity.id) ?? '(ID not reported)'} (${activity.type || 'unknown'}) failed: ${textField(activity.error?.code) || 'service error'}.`);
  }
  for (const activity of activities) {
    if (typeof activity.warning === 'string') limitations.push(`Activity ${identity(activity.id) ?? '(ID not reported)'} warning: ${activity.warning}`);
  }
  if (data.error) {
    partial = true;
    limitations.push(`The service reported ${textField(data.error.code) || 'an error'}; inspect the sanitized response.`);
  }
  if (partial) limitations.unshift('Partial service response: evidence or processing stages may be missing.');
  return {
    data,
    normalized: {
      text,
      references,
      citations,
      activities,
      activityReported: Array.isArray(data.activity),
      partial,
      limitations,
    },
  };
}
