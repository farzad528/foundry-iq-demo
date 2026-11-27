---
name: studio-dataset-onboarding
description: Use when a user brings a new Foundry IQ Demo Studio dataset or asks for sample queries, demo presets, or evidence that a BEFORE/AFTER retrieval scenario is worth showing.
---

# Onboard a Studio dataset

Produce a small set of audience-relevant queries whose results teach a real retrieval difference. Start with intake, derive candidate questions and expected facts from the corpus, then verify the comparison. A candidate is not a verified preset. Stop at a proposal unless the user also asks to wire it into Studio; approval to inspect data is not approval to provision, change indexes or keys, run paid probes or canaries, or deploy.

## 1. Intake: what to ask the owner

Copy this once, leaving out items the owner already supplied:

```text
Audience and demo goal: Who will watch, and what decision or task should the demo help with?
Dataset and access: Where can I read an approved, representative snapshot or sanitized sample?
Rights and scope: What can I process, quote, link to, record, or redistribute? What must stay private?
Languages and structure: Which locales and record types matter? Share the schema or a representative record, and stable source IDs/links and versions if available.
Distinctive user problems: What do people look for, get wrong, or struggle to connect in this dataset?
Optional accelerators: Known questions, expected answers or authoritative sources, tricky terms, and any scenarios or constraints you need covered.
```

Do not require the user to write sample questions or supply a gold set. Never request credentials in chat. Ask for permissioned access through the approved channel or a sanitized excerpt. If the corpus cannot establish a fact, ask for the specific missing canonical document, version, field definition, or owner confirmation; mark it **unverified** until authoritative evidence is available. If identifiers are absent, agree on a stable mapping to source locators before claiming reproducible results.

## 2. Discovery: derive questions and ground truth

1. **Inventory the corpus.** Identify authoritative vs secondary sources, versions and effective dates, metadata that can actually be filtered or boosted, and record/chunk IDs, page and row locators, and supported asset types. For a locale, check its actual corpus, terminology and identifier behavior, not just translated query text.
2. **Work backward from distinctive facts.** Pick something a viewer would need to know: a precise rule or exception, a product identifier, an eligibility cutoff, two clauses in different chunks, a relationship chain, a table cell, or a visual match. Write the expected fact, source ID and exact permitted supporting span or relationship first. Freeze these judgments before grading the retrieval output. Identify plausible distractors (old editions, near-match IDs, adjacent rows, wrong jurisdictions or lookalike images) and mark which are actually wrong versus merely less useful.
3. **Write a natural question and one revealing variation.** Use audience language and realistic symptoms, not copied policy text. Try the corpus term versus a paraphrase or acronym, an exact ID versus a near match, a broad request versus a hard constraint, or a question needing two separately sourced facts. For relationships, choose a path where the relation or direction matters, not just co-mentions. When applicable, add a false-premise or absence control with a known scope and a positive counterpart; no hits alone do not prove absence.
4. **Probe the smallest useful set.** Predict what BEFORE will miss, bury or confuse; use the matrix to pick an observable contrast and a control. Check candidate order, constraints, source spans and distractors in both arms. If a probe reveals a better question, judge its expected evidence before grading that new comparison. Retain the strongest reproducible example(s), and record ties, regressions and skipped types without padding the demo.

**What is documented:** The [Zava presets](../../../config/studio-presets.json) and [recording assertions](../../../scripts/vercel-tests.mjs) preserve relevant/forbidden IDs and top-three, graph, topic and row criteria. The [operations guide](../../../docs/OPERATIONS.md) documents S07's everyday-language probes and the imported industry and graph evaluations. Those artifacts do not contain a complete history of exploratory or rejected queries; the steps above are a reproducible procedure, not a reconstruction of that history.

## 3. Eligibility and proof by scenario

Use the [scenario catalog](../../../config/studio-scenarios.mjs), [Zava request code](../../../lib/studio.mjs) and [industry request code](../../../lib/industry.mjs) to check what the selected build actually executes. Comparisons in the table list BEFORE first. Prefer relevant, cited evidence in the top three for ranked lists; for structured responses use the scenario-specific proof rather than inventing ranks.

| Type | Eligible when; what to prove |
| --- | --- |
| **S01 Keyword search** | A known term, synonym, inflection or exact identifier has a discriminating source and a plausible near match. Zava compares bounded app substring matching with analyzed full text and synonyms; industries compare plain all-term matching with analyzed any-term matching and synonyms. Show the gained relevant rank and where the distractor landed. Do not isolate a synonym effect if matching rules also changed. |
| **S02 Vector search** | The corpus and query share a compatible text vectorizer, and a natural paraphrase does not simply repeat an indexed phrase. Compare keyword with text-vector results for the same query. Cite the same intended fact and probe an exact identifier separately; keyword winning that control is useful, not a failure to hide. |
| **S03 Hybrid search** | Both lexical cues (such as an ID) and natural-language intent matter. Compare keyword with keyword-plus-vector fusion using the same scope and any hard filter in both arms. Show relevant rank or coverage and check that neither arm violates the filter. Never describe a third, vector-only arm. |
| **S04 Semantic reranking** | A semantic configuration and shared hybrid candidates exist, with a precise intent that separates close results. Verify the same IDs and evidence before and after, then show the relevant candidate's rank change. Adding or dropping a candidate is not a reranking win. |
| **S05 Filtered/faceted search** | A real eligibility condition and useful facet exist in filterable/facetable metadata. Zava keeps the location, stock, category and price filters in both arms; AFTER uses hybrid and adds facets. Industry presets compare keyword without the preset filter with hybrid plus the preset filter and facets; free text gets no preset filter. Show the constraint values and returned facet buckets/counts against their scope. Attribute the industry result to the combined change, not filters or hybrid alone. |
| **S06 Document boosting** | A reviewed first-stage scoring profile and meaningful field can distinguish otherwise comparable results. Compare the same hybrid query without and with one profile. Cite the field values and rank change, and make sure relevance still holds. Say which boost ran; do not claim a boost imposes a hard filter or is semantic reranking. |
| **S07 Agentic search** | A single index holds the needed evidence, and everyday wording, an exception or multiple chunks give single-pass hybrid a real challenge. Compare source ranks and evidence coverage against native agentic retrieval. If claiming follow-up, quote/count only the actual sanitized sub-queries and turns in that response. A partial termination is not a verified win. Neither arm generates an answer. |
| **S08 Entity graph search** | The same corpus generation supports passage search and an attested entity graph with a meaningful typed, directed path. Compare hybrid-plus-semantic passages with hydrated rows from the exact-question server GQL allowlist. Check every claimed relationship against cited source spans and reject uncited paths. For a negative control require the allowlisted zero-row expectation, a successful statement without errors, and a checked positive path in the same graph; say only that this path was not found in that graph version/scope. Free text does not execute graph traversal. |
| **S09 Topic graph search** | A verified topic hierarchy and passage-to-topic mapping exist. For diversity, compare the same hybrid retrieval with diversification off/on and no semantic ranker, at equal evidence depth; count relevant covered themes and cite a returned passage for each claimed theme. Industry hierarchy/focus presets instead read the native theme tree: verify the returned root/subthemes and passage shares against that generation, and do not call it a ranked-list win. |
| **S10 PDF layout extraction** | A scanned or structured table has an exact cell answer and a plausible neighboring-row error. Compare flattened Read pages with Layout rows for the same source hash, using indexed extracts, not PDF uploads. Show BEFORE's page context and AFTER's exact row, column/header, value/unit and page citation or cell coordinates. Check analyzer provenance; a custom extract is not proof of Content Understanding processing. |
| **S11 Multimodal image search** | A rights-cleared image corpus uses a compatible multimodal model for indexing and querying. Compare text metadata with image embedding similarity over that corpus. State whether the input is a text description or an image and what text BEFORE received; use recognizable visual features, cited asset IDs and near-lookalikes to judge ranks. Live accepts one PNG, JPEG or WebP up to 40 KiB and does not store it. |

Current Zava supports S01-S11 in `en`, `fr`, `es`, `ja`, and `de`; S08/S09 explicitly use the English Zava graph. Enabled industry demos are English-only; Product recalls has no S10, and no industry has S11. Industry S08/S09 require the dedicated graph service and private bindings; missing configuration fails closed, not to Sample. New dataset applicability must be checked, not inferred from that list. See the [industry catalog](../../../config/studio-industries.json), [Zava graph contract](../../../config/studio-graph.json) and [industry graph contract](../../../config/studio-industry-graph.json). Keep filters, facets, profiles, PDF selection and GQL in their existing server-side allowlists; never pass them from the client.

## 4. Acceptance: compare the returned evidence

1. **Pin the comparison.** Record the corpus snapshot/hash and index revision or attestation (including graph, PDF or image manifests if applicable). Match corpus/scope, locale, query, evidence depth and settings across the arms except the intended scenario differences. Where two representations are needed, verify the same underlying sources. If other factors changed, report the confound rather than crediting the feature.
2. **Verify the actual response.** With approved access and any required run approval, confirm the dataset, scenario and mode in `GET /api/scenarios` and use the Studio UI or `POST /api/demo/run`. Retain the redacted `baseline` and `enhanced` response evidence and check both arm statuses and the trace/API log; a successful HTTP status alone is not proof. For rank claims compare the first three IDs and their cited facts, including any distractor and the precise rank beyond three if claiming it was buried. Use the same pre-judged IDs or fact checklist in both arms. Zava's checked-in ranking assertion uses a forbidden-ID penalty, a delta of at least 0.15 in nDCG@3 and a relevant AFTER #1; treat those as Zava criteria, not invented requirements for every corpus.
3. **Write only what the evidence supports.** Classify **win** (material verified improvement), **tie** (no material improvement), **regression** (worse evidence), **unverified** (insufficient source/response, inaccessible run, partial or failed mode), or **not applicable** (missing capability or meaningful use case). Use the most specific BEFORE gap supported by the result: **Missing evidence** (not returned at the inspected depth), **Partial evidence** (some required facts only), **Missing connection** (facts present without the needed link), **Wrong context** (e.g. wrong entity, version or scope), **Buried evidence** (relevant result below the useful ranks), **Weak sourcing** (claim lacks a usable citation), or **No material gap**. If the response is partial or unavailable, leave the gap unassessed rather than treating it as missing evidence.
4. **Preserve provenance and replay fidelity.** Say "retrieved passages", "retrieved context" or "cited graph rows", not "the exact LLM prompt". Quote only permitted canonical source text, verbatim with its locator; if quoting an API snippet, label it as such and distinguish it from the canonical source. Do not turn display cleanup, snippets or a graph visualization into new evidence. Keep evidence in approved private storage; redact keys, hosts, credentialed URLs, private index/storage names, server paths and sensitive content before sharing, and use safe aliases or hashes for version tracking. Do not commit raw evidence or private bindings.

[Recorded Sample](../../../config/studio-recorded.json) is a dated, sanitized capture of a curated Live comparison, not a fresh run or a Live fallback. It supports the exact curated question, 5 or 10 evidence (5 slices the recording), and the recorded settings; no free text, custom images or new boosts. State its capture date and never report replay timings as a new measurement. Write any "Why AFTER wins" note against what the shipped recording actually shows. Use the [recorded notes](../../../config/studio-notes.json) or industry `why` entries as examples, not as evidence for a new dataset.

### Worked example: recorded Zava S07

The English Zava capture dated **2026-11-25** (topK 10) used: "My drill's power brick croaked seven weeks in. Do I get my money back?" The [defective-goods source](../../../samples/zava-support.md#pol-def-2026-02--defective-goods-process) says assessment is "not an automatic refund." In the recording, `POL-DEF-2026-02` moves from **#7 to #1**, and `WAR-BAT-2026-01` moves from **#8 to #3**. AFTER reports one follow-up sub-query. This is a recorded ranking win (**Buried evidence**), not a finding that the customer qualifies for a refund.

### Output template

Return a shortlist of verified presets and a compact disposition for the other applicable or requested types. Use one evidence record per candidate:

```text
Preset label / exact user query or asset reference:
Audience task / scenario ID / locale (including actual corpus language):
Dataset snapshot / safe index revision or attestation reference:
Expected facts and canonical citation(s) (ID, version, section/page/row, permitted span):
Relevant IDs / distractors or forbidden IDs / expected paths, topics or constraints:
Mode (Live or Recorded Sample) / run time UTC or capture date / topK / matched controls and intended difference:
BEFORE status / top 3 ranks, IDs and supporting spans or structured evidence:
AFTER status / top 3 ranks, IDs and supporting spans or structured evidence:
Redacted response/trace reference / observed criterion and result:
Outcome / BEFORE gap / one sentence safe to narrate / blocker or next evidence needed:
```

For approved implementation work, use the [operations guide](../../../docs/OPERATIONS.md) and [package scripts](../../../package.json). `npm test` checks current presets and recordings, including Zava's four examples per scenario/locale; that existing catalog count is not a quota for a new dataset. `npm run build` followed by `npm run validate` checks the artifact and local replay. Without private inputs the build produces the public Zava Sample-only app, and `npm run dev` builds and serves it: no Live and no industries. Fixtures, local tests and historical recordings cannot validate a new dataset or deployment.
