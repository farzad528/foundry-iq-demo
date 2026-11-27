import { createHash } from 'node:crypto';

const counts = [5, 10];
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

export function reviewedEvidenceNote(result, body, entry, assessments, imageDigests, recordedAt) {
  const note = assessments?.[body.topK ?? 10];
  if (!note || !entry || !successful(result)) return undefined;
  if (result.mode === 'live') {
    if (body.imageInput || entry.image) {
      if (body.imageInput?.mimeType !== 'image/png'
        || hash(Buffer.from(body.imageInput.base64, 'base64')) !== imageDigests?.[entry.image]) return undefined;
    }
  }
  if (comparisonEvidenceDigest(result) !== note.evidence) return undefined;
  return { label: note.label, text: note.text, source: `Evidence reviewed against the ${recordedAt} Live recording` };
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
