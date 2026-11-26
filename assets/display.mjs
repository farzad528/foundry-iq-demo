/** A scenario this deployment hasn't configured (industry graph search): Search and the query box stay disabled. */
export const notConfigured = scenario => scenario?.live?.status === 'not_configured' && !scenario?.sample?.available;

// Some graph-service passages were stored as UTF-8 decoded with the Thai code page (TIS-620): bytes 0xA1–0xFB became Thai
// letters and 0x80–0xA0 became U+FFFD, so an em dash (E2 80 94) reads "โ��" and "§" (C2 A7) reads "ยง". Display text reverses
// the mapping; where the lost byte makes a sequence ambiguous (dashes, quotes, apostrophes share "โ��"), the surrounding text
// decides. Only the English-only industry corpora use this; raw values are unchanged.
const MOJIBAKE_RUN = /[\u0E01-\u0E5B\uFFFD]+/g;
const WORD = /[\p{L}\p{N}]/u;
// E2 xx yy with the middle byte lost (0x80–0xA0): the last byte names the character.
const E2_BY_LAST = { 0xA2: '•', 0xA4: '≤', 0xA5: '≥', 0xA6: '…', 0xAC: '€', 0xAF: ' ', 0xB0: '‰', 0xB2: '′', 0xB3: '″' };
export function repairMojibake(value) {
  if (typeof value !== 'string' || !/[\u0E01-\u0E5B\uFFFD]/.test(value)) return value;
  let open = false;
  return value.replace(MOJIBAKE_RUN, (run, offset, whole) => {
    const bytes = [...run].map(char => char === '\uFFFD' ? null : 0xA1 + char.codePointAt(0) - 0x0E01);
    const known = byte => byte !== null && byte !== undefined;
    const tail = byte => known(byte) && byte >= 0x80 && byte <= 0xBF;
    let out = '';
    for (let i = 0; i < bytes.length;) {
      const lead = bytes[i];
      const before = (whole.slice(0, offset) + out).slice(-1);
      if (known(lead) && lead >= 0xC2 && lead <= 0xDF) {
        out += tail(bytes[i + 1]) ? String.fromCodePoint(((lead & 0x1F) << 6) | (bytes[i + 1] & 0x3F)) : ' ';
        i += 2;
      } else if (known(lead) && lead >= 0xE0 && lead <= 0xEF) {
        const [b1, b2] = [bytes[i + 1], bytes[i + 2]];
        const after = run.slice(i + 3) + whole.slice(offset + run.length);
        const next = after.charAt(0);
        if (tail(b1) && tail(b2)) out += String.fromCodePoint(((lead & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F));
        else if (lead === 0xE2 && b1 === null && tail(b2)) out += b2 === 0xA2 ? (WORD.test(before) ? '™' : '•') : E2_BY_LAST[b2] || ' ';
        else if (lead === 0xE2 && b1 === null && b2 === null) {
          // General punctuation E2 80 80–A0: dashes, curly quotes and apostrophes.
          if (WORD.test(before) && WORD.test(next)) out += /\d/.test(before) && /\d/.test(next) ? '–' : /^(?:s|t|d|m|ll|re|ve)(?![\p{L}\p{N}])/iu.test(after) ? '’' : '—';
          // After a closing bracket, a word continues the sentence: "(ERCOT)—the grid operator" (a possessive "(FERC)’s" stays).
          else if (/[)\]]/.test(before) && WORD.test(next)) out += /^s(?![\p{L}\p{N}])/iu.test(after) ? '’' : '—';
          else if ((!before || /\s/.test(before)) && (!next || /\s/.test(next))) out += '—';
          else if (!before || /[\s([{/]/.test(before)) { open = true; out += '“'; }
          else { out += open ? '”' : '’'; open = false; }
        } else out += ' ';
        i += 3;
      } else {
        // Not a UTF-8 lead byte: keep a genuine character, drop a lost byte.
        out += known(lead) ? run[i] : '';
        i += 1;
      }
    }
    return out;
  });
}

// Graph-service passages can carry the source file's metadata header: a leading "---" YAML block (docId, title, url, agency,
// license, metadata: {…}), a chunk that starts or ends inside that block, or a JSON object header. Display text shows the body;
// a passage that is only the header reads "Metadata only". The header's fields still fill the drawer's document facts.
const HEADER_KEY = /^(?:docId|title|url|agency|publisher|docType|publishedDate|license|retrievedAt|metadata):\s/;
const KEY_LINE = /^([A-Za-z][\w-]*):\s?(.*)$/;
export const METADATA_ONLY = 'Metadata only: this passage is the document’s header (title, source, license and dates), with no body text.';
const headerValue = text => { try { return JSON.parse(text); } catch { return text.replace(/^"|"$/g, ''); } };
export function frontMatter(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/^\s+/, '');
  if (text.startsWith('{')) {
    let depth = 0, quoted = false, end = -1;
    for (let i = 0; i < text.length && end < 0; i++) {
      const char = text[i];
      if (quoted) { if (char === '\\') i++; else if (char === '"') quoted = false; }
      else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) end = i;
    }
    let fields = null;
    try { fields = end > 0 ? JSON.parse(text.slice(0, end + 1)) : null; } catch { fields = null; }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !Object.keys(fields).some(key => HEADER_KEY.test(`${key}: `))) return null;
    const body = text.slice(end + 1).trim();
    return { body, fields, metadataOnly: !body };
  }
  const lines = text.split('\n');
  const explicit = /^---[ \t]*$/.test(lines[0]);
  const start = explicit ? 1 : 0;
  // A header line must follow "---" (so a Markdown rule isn't mistaken for one); a chunk that starts mid-header may begin
  // with the tail of a wrapped value, so its first or second line must be a header key.
  if (explicit ? !HEADER_KEY.test(lines[1] || '') : !lines.slice(0, 2).some(line => HEADER_KEY.test(line))) return null;
  const fields = {};
  let i = start;
  for (; i < lines.length && !/^---[ \t]*$/.test(lines[i]); i++) {
    const match = lines[i].match(KEY_LINE);
    if (match) fields[match[1]] = headerValue(match[2].trim());
    else if (!(i === 0 && !explicit) && i !== lines.length - 1) return null;
  }
  const closed = i < lines.length;
  if (!explicit && !closed && Object.keys(fields).filter(key => HEADER_KEY.test(`${key}: `)).length < 2) return null;
  const body = closed ? lines.slice(i + 1).join('\n').trim() : '';
  return { body, fields, metadataOnly: !body };
}

// Display-only plain text for retrieved titles and passages. Public industry documents carry Markdown (headings, emphasis,
// bullets, tables, links); cards and the details drawer show readable text, while Raw hit JSON and the API log keep raw values.
// englishOnly (public U.S. government corpora): a token mixing kana with Latin letters or digits is a PDF extraction artifact
// (e.g. "N-ム99O" for "N=2999") and is shown as "[unreadable]", and code-page mojibake is repaired; the raw value is unchanged.
export function displayText(value, { englishOnly = false } = {}) {
  if (typeof value !== 'string') return value;
  const text = englishOnly ? repairMojibake(value).replace(/\S+/g, token => /[\u3040-\u30FF]/.test(token) && /[A-Za-z0-9]/.test(token) ? '[unreadable]' : token) : value;
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

/** What a result card and the details drawer show for a hit: its title and passage as display text, plus the passage's
 * metadata header fields (industry graph passages). englishOnly enables the industry-corpus repairs. A header-only chunk
 * without its own title borrows one from another chunk of the same document in the response (siblings); "Passage" is the
 * last resort. */
export function passageView(hit, { englishOnly = false, siblings = [] } = {}) {
  const header = englishOnly ? frontMatter(hit?.snippet) : null;
  const untitled = !hit?.title || hit.title === 'Passage';
  let title = untitled && typeof header?.fields?.title === 'string' ? header.fields.title : hit?.title;
  if (header?.metadataOnly && (!title || title === 'Passage')) {
    const same = (siblings || []).filter(other => other && other !== hit && other.id !== hit.id && other.sourceId && other.sourceId === hit?.sourceId);
    title = same.map(other => frontMatter(other.snippet)?.fields?.title).find(value => typeof value === 'string' && value.trim())
      || same.map(other => other.title).find(value => typeof value === 'string' && value.trim() && value !== 'Passage') || 'Passage';
  }
  return { title: displayText(title, { englishOnly }), header: header?.fields || {},
    passage: header?.metadataOnly ? METADATA_ONLY : displayText(header ? header.body : hit?.snippet, { englishOnly }) };
}
