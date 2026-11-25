export const scenarios = [
  ['S01', 'Keyword search', 'DeWalt DCD796 cordless drill', 'substring', 'fulltext', 'productCards', 'Simple app substring matching vs token analysis with synonyms, on fictional Zava product records.'],
  ['S02', 'Vector search', 'A lightweight tool for making holes in brick walls', 'lexical', 'vector', 'productCards', 'Keyword matching vs description similarity; exact identifiers can still favor keywords.'],
  ['S03', 'Hybrid search', 'Lightweight cordless masonry drill under £200', 'lexical', 'hybrid', 'productCards', 'Identical drill and under-£200 filters; keyword results vs hybrid results merged with reciprocal rank fusion.'],
  ['S04', 'Semantic reranking', 'Best drill for small home renovations', 'hybrid', 'rerank', 'rankChangeCards', 'The same hybrid candidates before and after reranking; only the order changes.'],
  ['S05', 'Retail search', '18V cordless drill, available in London, under £200', 'lexical', 'retail', 'productCards', 'Identical London, in-stock, drill and under-£200 filters, with facets over the filtered set.'],
  ['S06', 'Document boosting', 'Best cordless drill for renovation', 'hybrid', 'boost', 'rankChangeCards', 'The same candidates with and without a first-stage boost.'],
  ['S07', 'Agentic search', 'My drill battery stopped charging after 45 days. Can I return it?', 'singlePass', 'planned', 'groundedAnswer', 'Single-pass retrieval vs agentic retrieval that can issue follow-up sub-queries, with the same extraction rules for both arms.'],
  ['S08', 'Entity graph search', 'Which drill, battery pack, cell and production lots are exposed to the supplier cell incident, and which current recall guidance applies to those lots?', 'documents', 'graph', 'graphAnswer', 'Passages from plain retrieval vs cited relationship paths from the native Foundry IQ entity graph.'],
  ['S09', 'Topic graph search', 'What should a new Zava store associate know?', 'documents', 'topic', 'topicPanel', 'The same hybrid search with topic diversification off vs on, plus the corpus themes from the native Foundry IQ topic graph.'],
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
  S08: 'Compare plain retrieval (hybrid search with the semantic ranker) with native Foundry IQ entity-graph search: curated questions return cited relationship paths, including proof that a path does not exist.',
  S09: 'Compare the same hybrid search with topic diversification off and on, and see the corpus themes from the native Foundry IQ topic graph.',
  S10: 'Compare Read and Layout processing of the same PDF, with page and table-row citations. Extraction ran at ingestion.',
  S11: 'Compare keyword matching with Azure Vision image similarity: use an image, or describe the item in text.',
};
// The native S08/S09 graphs exist only for English Zava; other languages use them with this note.
export const englishGraphNote = 'The native graph is built from the English Zava content, so these questions and results are in English.';
export const customPdfDescription = 'Compare custom pre-extracted PDF pages and table rows. Azure Content Understanding is not used for this example.';
export const liveLimits = {
  S01: 'Live searches the synthetic Zava product index for the selected document language.',
  S02: 'Foundry IQ vectorizes the query text with its configured vectorizer; the app holds no model key.',
  S03: 'Both arms apply the same category and price filters.',
  S04: 'Live reranks the same hybrid candidates with the semantic ranker; only the order changes.',
  S05: 'Both arms apply the same location, stock, category and price filters.',
  S06: 'Live applies the reviewed scoring profile for the selected boost.',
  S07: 'Live uses agentic retrieval with a bounded runtime and compares evidence only; neither arm generates an answer.',
  S08: 'Graph traversal runs on the four curated questions; other questions show plain retrieval only. The graph is built from the English Zava content.',
  S09: 'Both arms run the same hybrid search without the semantic ranker; only topic diversification differs. Themes come from the English Zava topic graph.',
  S10: 'Both arms search the same bundled PDF, extracted at ingestion; new PDF uploads are not supported.',
  S11: 'Live accepts one PNG, JPEG or WebP image up to 40 KiB per search. Foundry IQ vectorizes it with Azure Vision; the image is not stored or indexed.',
};
// Industry demos (public U.S. government data, English only): titles, descriptions and limits for the scenarios that apply.
export const industryScenarioCopy = {
  S01: { title: 'Keyword search', description: 'Compare a plain keyword match that needs every term with full-text analysis and synonyms.',
    limits: 'BEFORE searches unanalyzed title and text fields and requires every term; AFTER uses language analyzers and the shared synonym map.' },
  S02: { title: 'Vector search', description: 'Compare keyword matching with text-vector similarity for questions asked in everyday words.',
    limits: 'Foundry IQ vectorizes the query text with the index vectorizer; the app holds no model key.' },
  S03: { title: 'Hybrid search', description: 'Compare keyword and hybrid retrieval with the same filter.',
    limits: 'Examples can apply a filter to both arms; free-text questions search all public documents.' },
  S04: { title: 'Semantic reranking', description: 'Compare the same hybrid candidates before and after semantic reranking. Only the order changes.',
    limits: 'The semantic ranker reorders the exact hybrid candidates; no new documents are retrieved.' },
  S05: { title: 'Faceted search', description: 'Compare keyword search over everything with hybrid search narrowed by a filter, plus facets.',
    limits: 'Examples apply their filter in AFTER only; free-text questions keep all public documents and show facets.' },
  S06: { title: 'Document boosting', description: 'Compare hybrid results with and without a scoring profile that boosts fresher, more authoritative or higher-impact documents.',
    limits: 'Live applies the selected scoring profile to the same hybrid query.' },
  S07: { title: 'Agentic search', description: 'Compare single-pass hybrid retrieval with agentic retrieval on the same index. Evidence only: compare the documents and citations; neither arm generates an answer.',
    limits: 'Live uses agentic retrieval with a bounded runtime and compares evidence only; neither arm generates an answer.' },
  S10: { title: 'PDF layout (Azure Content Understanding)', description: 'Compare Read and Layout extraction of the same public PDF, with page and table-row citations. Extraction ran at ingestion.',
    limits: 'Both arms search one public PDF, extracted at ingestion; examples choose the PDF, and free-text questions search the first example’s PDF.' },
};
