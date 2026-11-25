export const scenarios = [
  ['S01', 'Keyword search', 'DeWalt DCD796 cordless drill', 'substring', 'fulltext', 'productCards', 'App substring vs local token analysis/synonyms; fictional Zava records, not branded product data.'],
  ['S02', 'Vector search', 'A lightweight tool for making holes in brick walls', 'lexical', 'vector', 'productCards', 'Lexical vs illustrative description features; exact identifiers can favor lexical.'],
  ['S03', 'Hybrid search', 'Lightweight cordless masonry drill under £200', 'lexical', 'hybrid', 'productCards', 'Identical category=drill and price<200 hard filters; local reciprocal rank fusion.'],
  ['S04', 'Semantic reranking', 'Best drill for small home renovations', 'hybrid', 'rerank', 'rankChangeCards', 'SAME hybrid candidates, local phrase-based illustrative reranker; rank movement only.'],
  ['S05', 'Retail search', '18V cordless drill, available in London, under £200', 'lexical', 'retail', 'productCards', 'Identical London, stock>0, category=drill and price<200 filters; facets over the filtered set.'],
  ['S06', 'Document boosting', 'Best cordless drill for renovation', 'hybrid', 'boost', 'rankChangeCards', 'Identical candidates; configurable local first-stage boosts, not guaranteed downstream semantic boosts.'],
  ['S07', 'Agentic search', 'My drill battery stopped charging after 45 days. Can I return it?', 'singlePass', 'planned', 'groundedAnswer', 'Local one-pass vs multi-query evidence gathering; same extractive synthesis rules both arms, not an LLM comparison.'],
  ['S08', 'Agentic + graph search', 'Which drill models could be affected by supplier battery defect B-17?', 'documents', 'graph', 'graphAnswer', 'Explicit custom sourced graph traversal, NOT native Foundry IQ graph support.'],
  ['S09', 'Topics + entries', 'What do we know about recurring battery failures?', 'documents', 'topic', 'topicPanel', 'Experimental versioned public topic projection, not native topic support or graph diversification.'],
  ['S10', 'Content Understanding', 'What is the maximum concrete drilling diameter of model DCD796?', 'basic', 'layout', 'pdfEvidence', 'Canonical pre-indexed original PDF; local basic flattened vs row-aware extraction, NOT measured Content Understanding.'],
  ['S11', 'Multimodal image search', 'Find visually similar hats or products', 'metadata', 'image', 'imageGallery', 'Fixed original illustrative blue-hat reference only; local visual features, NOT arbitrary image understanding.'],
].map(([id, title, sampleQuery, baseline, enhanced, renderer, difference]) => ({
  id, title, sampleQuery, baseline, enhanced, renderer, difference,
  input: ['text'], acceptedInputTypes: ['text'], defaultTopK: 10, topK: [5, 10, 20, 50],
}));
export const boostSubtypes = ['freshness', 'magnitude', 'distance', 'tags', 'availability'];
// What each Live comparison actually executes on Azure AI Search (Sample text above describes local fixtures).
export const liveDifferences = {
  S01: 'App-style substring matching over the complete index vs Azure full-text search with language analyzers and synonym maps.',
  S02: 'Azure keyword (BM25) search vs Azure vector search; the index vectorizer embeds the query with text-embedding-3-small.',
  S03: 'Identical category and price filters; Azure keyword search vs Azure hybrid search (keyword + vector, reciprocal rank fusion).',
  S04: 'The SAME Azure hybrid candidates; the Azure semantic ranker reorders them. Rank movement only, no new documents.',
  S05: 'Identical London, in-stock, drill and under-£200 filters; Azure keyword results vs hybrid results with category facets.',
  S06: 'The same Azure hybrid query; the enhanced arm adds a reviewed first-stage scoring profile.',
  S07: 'Single-pass Azure hybrid retrieval vs native single-index agentic retrieval on the same support index. Evidence only: compare documents and citations; no generated answers.',
  S08: 'Azure Search evidence vs the same evidence plus an Azure-indexed custom graph projection. Custom, NOT native graph support.',
  S09: 'Azure Search evidence vs an experimental Azure-indexed topic projection expanded to its sources. Not a native topic feature.',
  S10: 'Azure Content Understanding Read pages vs Layout table rows, extracted at ingestion from the same PDF and retrieved live.',
  S11: 'Azure keyword search over image metadata vs Azure Vision multimodal vectors computed by Azure AI Search (image upload or text-to-image).',
};
export const liveLimits = {
  S04: 'Live needs a reviewed semantic configuration and searchable keyword ID field. Same-candidate membership and semantic scores are checked; wildcard-only semantic ranking is unsupported.',
  S07: 'Live uses paid Standard knowledge retrieval for native agentic Search with a bounded runtime. Evidence-only: no generated answers on this deployment.',
  S10: 'Pre-indexed equivalent original PDF extraction only; arbitrary uploads/ingestion unavailable.',
  S11: 'Live uses the Azure Vision multimodal model through the Search vectorizer. Inline JPEG/PNG/WebP queries are ephemeral and bounded to 40 KiB; no corpus ingestion. Sample stays a fixed illustrative reference.',
};
