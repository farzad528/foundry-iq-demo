import { createHash } from 'node:crypto';

const counts = [5, 10];
const arms = ['baseline', 'enhanced'];
const labels = new Set(['Missing evidence', 'Partial evidence', 'Missing connection', 'Wrong context',
  'Buried evidence', 'Weak sourcing', 'No material gap']);
const hash = value => createHash('sha256').update(value).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;
const successful = result => result?.executionStatus === 'success'
  && result.baseline?.status === 'success' && result.enhanced?.status === 'success';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export function comparisonEvidenceDigest(result, replayCount) {
  const arm = ({ hits, citations, answer, answerKind, graph, topics, topicCoverage, facets, apiLog }) => {
    const shown = items => replayCount === undefined ? items || [] : (items || []).slice(0, replayCount);
    return {
      hits: shown(hits).map(({ score, scoreType, search, ...hit }) => ({ ...hit, captions: search?.captions })),
      citations: shown(citations), answer, answerKind, statements: graph?.statements, topicCoverage, facets,
      topics: topics && { hierarchy: topics.hierarchy, focus: topics.focus, moreRoots: topics.moreRoots },
      // Match evidence and the constraints that produced it, not timings, scores, count limits or service names.
      constraints: apiLog?.map(({ request: { body = {} } = {} }) => {
        const { filter, facets, scoringProfile, scoringParameters, queryType } = body;
        return { filter, facets, scoringProfile, scoringParameters, queryType };
      }),
    };
  };
  return hash(JSON.stringify(canonical([arm(result.baseline), arm(result.enhanced)])));
}

function literalSnippet(hit, { id, spans }) {
  return hit?.id === id && typeof hit.snippet === 'string' && Array.isArray(spans) && spans.length
    && spans.every(span => typeof span === 'string' && span.trim() && hit.snippet.includes(span));
}

function matchedHighlights(result, review) {
  if (!review) return undefined;
  const found = Object.fromEntries(arms.map(side => [side, (review[side] || [])
    .filter(item => literalSnippet(result[side].hits?.[item.rank - 1], item))]));
  if (!arms.some(side => found[side].length)) return undefined;
  return { ...found, ...(review.parts ? { parts: review.parts } : {}) };
}

export function reviewedEvidenceNote(result, body, entry, assessments, imageDigests, recordedAt, highlightReview) {
  const count = body.topK ?? 10;
  const note = assessments?.[count];
  if (!note || !entry || !successful(result)) return undefined;
  if (result.mode === 'live') {
    if (body.imageInput || entry.image) {
      if (body.imageInput?.mimeType !== 'image/png'
        || hash(Buffer.from(body.imageInput.base64, 'base64')) !== imageDigests?.[entry.image]) return undefined;
    }
  }
  if (comparisonEvidenceDigest(result) !== note.evidence) return undefined;
  const highlights = matchedHighlights(result, highlightReview);
  return { label: note.label, text: note.text, source: `Evidence reviewed against the ${recordedAt} Live recording`,
    ...(highlights ? { highlights } : {}) };
}

export function evidenceHighlightProblems(notes, recorded, snippetRanges) {
  const problems = [];
  for (const [key, review] of Object.entries(notes.highlights || {})) {
    const entry = recorded.entries[key];
    if (!entry || !notes.entries[key]?.[10] || !review || typeof review !== 'object'
      || arms.some(side => review[side] !== undefined && !Array.isArray(review[side]))
      || !arms.some(side => review[side]?.length)) {
      problems.push(`${key}: highlights require reviewed evidence`);
      continue;
    }
    if (review.parts !== undefined && (!Number.isInteger(review.parts) || review.parts < 2)) problems.push(`${key}: invalid highlight part count`);
    for (const side of arms) {
      const seen = new Set();
      const parts = new Set();
      for (const item of review[side] || []) {
        const rank = item?.rank;
        const hit = entry.result[side].hits[rank - 1];
        if (!Number.isInteger(rank) || rank < 1 || seen.has(rank) || !literalSnippet(hit, item)
          || snippetRanges(hit, item.spans, { englishOnly: !!entry.industry }).ranges.length !== item.spans.length) {
          problems.push(`${key} ${side} #${rank}: each span must match literal text in this snippet and be visible`);
          continue;
        }
        seen.add(rank);
        if (item.part !== undefined) {
          if (!Number.isInteger(item.part) || item.part < 1 || !(item.part <= review.parts) || parts.has(item.part)) {
            problems.push(`${key} ${side} #${item.rank}: invalid or duplicate highlight part`);
          }
          parts.add(item.part);
        }
      }
      if (side === 'enhanced' && review.parts && parts.size !== review.parts) problems.push(`${key}: AFTER does not contain every reviewed part`);
    }
  }
  return problems;
}

export function evidenceNoteProblems(notes, recorded, { optional = false } = {}) {
  const problems = [];
  for (const [key, entry] of Object.entries(recorded.entries)) {
    const assessments = notes.entries[key];
    if (!assessments && optional) continue;
    for (const count of counts) {
      const note = assessments?.[count];
      if (note === null) continue; // Deliberately unassessed.
      if (!note || !labels.has(note.label) || typeof note.text !== 'string' || !note.text.trim()
        || /[\r\n]/.test(note.text) || !digestPattern.test(note.evidence)) {
        problems.push(`${key} (${count}): missing or invalid evidence note`);
      } else if (!successful(entry.result) || note.evidence !== comparisonEvidenceDigest(entry.result, count)) {
        problems.push(`${key} (${count}): evidence changed since review`);
      }
    }
    if (entry.image && assessments && counts.some(count => assessments[count])
      && !digestPattern.test(notes.imageDigests?.[entry.image])) problems.push(`${key}: missing reviewed image digest`);
  }
  return problems;
}
