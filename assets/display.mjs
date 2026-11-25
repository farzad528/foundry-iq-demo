/** A scenario this deployment hasn't configured (industry graph search): Search and the query box stay disabled. */
export const notConfigured = scenario => scenario?.live?.status === 'not_configured' && !scenario?.sample?.available;

// Display-only plain text for retrieved titles and passages. Public industry documents carry Markdown (headings, emphasis,
// bullets, tables, links); cards and the details drawer show readable text, while Raw hit JSON and the API log keep raw values.
// englishOnly (public U.S. government corpora): a token mixing kana with Latin letters or digits is a PDF extraction artifact
// (e.g. "N-ム99O" for "N=2999") and is shown as "[unreadable]"; the raw value is unchanged.
export function displayText(value, { englishOnly = false } = {}) {
  if (typeof value !== 'string') return value;
  const text = englishOnly ? value.replace(/\S+/g, token => /[\u3040-\u30FF]/.test(token) && /[A-Za-z0-9]/.test(token) ? '[unreadable]' : token) : value;
  return text
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '')
    .replace(/\[([^\]\n]+)\]\([^)\s]+(?:\s+"[^"\n]*")?\)/g, '$1')
    .replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*(?::?-{3,}:?)?[ \t]*$/gm, '')
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (row, cells) => cells.split('|').map(cell => cell.trim()).filter(Boolean).join(' · '))
    .replace(/^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
    .replace(/(^|\s)#{1,6}(?=\s)/g, '$1')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^([ \t]*)[-*+][ \t]+(?=\S)/gm, '$1• ')
    .replace(/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*/g, '$1')
    .replace(/__([^_\s](?:[^_]*[^_\s])?)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\s](?:[^_\n]*[^_\s])?)_(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
