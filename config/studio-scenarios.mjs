export const scenarios = [
  ['S01', 'Keyword search', 'DeWalt DCD796 cordless drill', 'substring', 'fulltext', 'productCards', 'Simple app substring matching vs token analysis with synonyms, on fictional Zava product records.'],
  ['S02', 'Vector search', 'A lightweight tool for making holes in brick walls', 'lexical', 'vector', 'productCards', 'Keyword matching vs description similarity; exact identifiers can still favor keywords.'],
  ['S03', 'Hybrid search', 'Lightweight cordless masonry drill under £200', 'lexical', 'hybrid', 'productCards', 'Identical drill and under-£200 filters; keyword results vs hybrid results merged with reciprocal rank fusion.'],
  ['S04', 'Semantic reranking', 'Best drill for small home renovations', 'hybrid', 'rerank', 'rankChangeCards', 'The same hybrid candidates before and after reranking; only the order changes.'],
  ['S05', 'Retail search', '18V cordless drill, available in London, under £200', 'lexical', 'retail', 'productCards', 'Identical London, in-stock, drill and under-£200 filters, with facets over the filtered set.'],
  ['S06', 'Document boosting', 'Best cordless drill for renovation', 'hybrid', 'boost', 'rankChangeCards', 'The same candidates with and without a first-stage boost.'],
  ['S07', 'Agentic search', 'My drill battery stopped charging after 45 days. Can I return it?', 'singlePass', 'planned', 'groundedAnswer', 'Single-pass vs multi-query evidence gathering, with the same extraction rules for both arms.'],
  ['S08', 'Agentic + graph search', 'Which drill models could be affected by supplier battery defect B-17?', 'documents', 'graph', 'graphAnswer', 'Source documents vs a custom, sourced bill-of-materials graph traversal (not a native graph feature).'],
  ['S09', 'Topics + entries', 'What do we know about recurring battery failures?', 'documents', 'topic', 'topicPanel', 'Source documents vs an experimental, versioned topic projection (not a native topic feature).'],
  ['S10', 'Content Understanding', 'What is the maximum concrete drilling diameter of model DCD796?', 'basic', 'layout', 'pdfEvidence', 'The same bundled PDF: flattened page text vs row-aware table extraction.'],
  ['S11', 'Multimodal image search', 'Find visually similar hats or products', 'metadata', 'image', 'imageGallery', 'Text-only product metadata vs image similarity for the bundled blue hat illustration.'],
].map(([id, title, sampleQuery, baseline, enhanced, renderer, difference]) => ({
  id, title, sampleQuery, baseline, enhanced, renderer, difference,
  input: ['text'], acceptedInputTypes: ['text'], defaultTopK: 10, topK: [5, 10, 20, 50],
}));
export const boostSubtypes = ['freshness', 'magnitude', 'distance', 'tags', 'availability'];
// Customer-facing description of what each Live comparison executes on Azure AI Search. Recorded Sample replays
// these same Live comparisons, so the Vercel catalog shows this text in both modes (the `difference` text above
// describes the local, in-app Sample used by the standalone server).
export const liveDifferences = {
  S01: 'Compare simple app search with full-text analysis and synonyms.',
  S02: 'Compare keyword matching with text-vector similarity, including exact-identifier counterexamples.',
  S03: 'Compare keyword and hybrid retrieval with identical hard filters.',
  S04: 'Compare the same hybrid candidates before and after semantic reranking. Only the order changes.',
  S05: 'Find eligible products with inventory, location and price filters, plus facets.',
  S06: 'Compare isolated freshness, price, distance, tag and availability boosts.',
  S07: 'Compare single-pass hybrid retrieval with agentic retrieval on the same support index. Evidence only: compare the documents and citations; neither arm generates an answer.',
  S08: 'Trace sourced component and lot relationships with a custom bill-of-materials graph, not a native graph feature.',
  S09: 'Explore versioned topics and their source evidence. Experimental; not a native topic feature.',
  S10: 'Compare Read and Layout processing of the same PDF, with page and table-row citations. Extraction ran at ingestion.',
  S11: 'Compare keyword matching with Azure Vision image similarity: use an image, or describe the item in text.',
};
export const customPdfDescription = 'Compare custom pre-extracted PDF pages and table rows. Azure Content Understanding is not used for this example.';
export const liveLimits = {
  S01: 'Live searches the synthetic Zava product index for the selected document language.',
  S02: 'Azure AI Search vectorizes the query text with its configured vectorizer; the app holds no model key.',
  S03: 'Both arms apply the same category and price filters.',
  S04: 'Live reranks the same hybrid candidates with the semantic ranker; only the order changes.',
  S05: 'Both arms apply the same location, stock, category and price filters.',
  S06: 'Live applies the reviewed scoring profile for the selected boost.',
  S07: 'Live uses agentic retrieval with a bounded runtime and compares evidence only; neither arm generates an answer.',
  S08: 'The graph is a custom projection indexed in Azure AI Search, not a native graph feature.',
  S09: 'Topics are an experimental projection indexed in Azure AI Search.',
  S10: 'Both arms search the same bundled PDF, extracted at ingestion; new PDF uploads are not supported.',
  S11: 'Live accepts one PNG, JPEG or WebP image up to 40 KiB per search. Azure AI Search vectorizes it with Azure Vision; the image is not stored or indexed.',
};
