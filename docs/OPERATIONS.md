# Foundry IQ Demo Studio: operations guide

How the app is built, run, tested, deployed and rolled back. The overview is in the [README](../README.md).

- [Architecture](#architecture)
- [Local development](#local-development)
- [Tests and CI](#tests-and-ci)
- [Build and deploy](#build-and-deploy)
- [Production deployment (Vercel)](#production-deployment-vercel): environment variables, scope, limits, Azure changes and rollback
- [Industry demos](#industry-demos-behind-build-configuration)
- [Revoke or rotate keys](#revoke-or-rotate-keys)
- [Validation checklist](#validation-checklist)

## Architecture

```text
Browser ── static UI (dist/vercel/public) ──► /api/* Vercel Functions (lib/vercel-app.mjs)
                                               ├─ Sample: recorded Live responses (config/studio-recorded.json)
                                               └─ Live: POST docs/search or docs/search.graph with a query key
                                                    └─► Foundry IQ (Azure AI Search)
```

| Path | Purpose |
| --- | --- |
| `page.html`, `about.html`, `404.html`, `assets/` | Static UI: comparison page, About, 404, styles, logo and favicons |
| `lib/` | Server modules: API handler, Search adapter, Zava, graph and industry comparisons, redaction |
| `config/` | Public catalogs: scenarios, presets, notes, languages, graph and industry allowlists, recorded Sample |
| `samples/` | Fictional Zava documents served for citations, S10 PDFs and S11 images |
| `scripts/` | Build, local server, artifact validation and test suites |
| `docs/` | This guide and the README screenshot |

The API has four routes: `GET /api/scenarios`, `GET /api/health` (also `/healthz`), `POST /api/demo/prepare` and
`POST /api/demo/run`. Private bindings and attestations exist only inside the built server bundle.

AFTER S08 draws each graph statement's returned rows as an entity graph and AFTER S09 draws the topic hierarchy as a topic
map (`assets/graph-viz.mjs`). The entity graph shows each entity once per role and name and each relationship once per
entity pair, in the query pattern's order. Bubble area in the topic map is each theme's share of passages; sub-themes sit
inside their theme and a ✓ marks covered themes. Nothing is added for density. Hover or focus highlights an item with a
one-line readout; click, tap or Enter pins its details below (relations, sub-themes and the citations of the rows that
contain the entity). S08 shows text rows when a statement cannot be drawn (such as a single-column result); all raw
response rows remain in the API log. S09 retains the theme list. Motion is a one-time reveal plus finite pulses on
the highlighted item, and reduced-motion preferences turn it off.

**What the model gets** describes what the displayed retrieval evidence supports, not what a model was prompted
with or answered. The note names one primary BEFORE gap or **No material gap**. `config/studio-notes.json` pins each
takeaway to the reviewed 5- or 10-result evidence from `config/studio-recorded.json`, including both arms' ranks,
content, citations, graph rows, topics and applicable retrieval constraints. Matching Live evidence can use the same
note; different evidence or image bytes, an unreviewed query, or another result count stays **Unassessed**. A new capture
that changes the evidence requires review before its note can be reused.

Green marks identify reviewed, verbatim spans in the visible result snippets on either arm. A mark pulses once and then
stays visible; with reduced motion it is static. When the evidence spans several results, numbered parts show how much
of the reviewed evidence each arm retrieved at the selected count. Highlights require the reviewed comparison and an
exact ranked hit and literal span; graph rows, topic shares and other metadata are not snippet text. The API log and
raw hit JSON stay unchanged.

## Local development

```bash
npm ci
npm run dev        # npm run build, then npm start on http://localhost:3000
```

- Without private inputs, `npm run build` creates the **public Sample-only app**: the recorded Zava Sample in five
  languages, Live unavailable (no index is attested) and no industries. It needs no Azure resources or keys.
- `npm start` serves an existing `dist/vercel` on `127.0.0.1:$PORT` (default 3000) the way Vercel does: static files
  with the `vercel.json` headers, and the four API routes. Restart after rebuilding.
- `npm run build` and `npm start` read `.env.local` if it exists (ignored by Git; see `.env.example`). A private
  build needs the `STUDIO_PRIVATE_*` paths below; Live locally also needs the Live variables.

## Tests and CI

```bash
npm test                         # unit suites: Vercel runtime, Zava comparisons, languages, README, fashion prep
npm run build && npm run validate
npx playwright install chromium
npm run test:browser             # builds, then drives the local app in headless Chromium
```

- `scripts/readme-tests.mjs` fails if the README's retrieval modes, datasets or languages drift from the app, or a
  link, anchor or image breaks.
- `npm run validate` checks the built artifact: layout, the CSP and security headers, public-output hygiene and a
  recorded Sample served through the local server.
- CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm test`, `npm run build` and `npm run validate` on every push and
  pull request with the Node version from `.nvmrc`. It uses no secrets, makes no Azure calls and never deploys.

## Build and deploy

**Production deploys automatically from `main`.** The Vercel project `foundry-iq-demo-studio` is connected to this
repository with `main` as its production branch, so merging to `main` deploys to https://foundry-iq-demo-studio.vercel.app/.
`main` is protected (locked, with a required code-owner review), so the merge is the owner's approval.

- Vercel runs `npm ci`, then `npm run build:vercel` (the `buildCommand` in `vercel.json`). `scripts/vercel-build.mjs`
  unpacks the Production Secret `STUDIO_PRIVATE_BUNDLE` into a temporary directory outside the checkout, runs
  `scripts/build-vercel.mjs` (offline checks and the public-output scan, exactly as below) and deletes the files.
- The committed root `vercel.json` and `api/` wrappers serve the built `dist/vercel` with the same headers, routes and
  Function limits as a manual deployment. `scripts/build-vercel.mjs` generates both, and a unit test fails if they drift.
- A production build without `STUDIO_PRIVATE_BUNDLE` fails, so the previous deployment stays live: Vercel never publishes
  the Sample-only app to production. Other builds without the bundle produce the public Sample-only app.
- Branch pushes and pull requests get preview deployments. These are protected by Vercel Deployment Protection and
  built as the public Sample-only app, because `STUDIO_PRIVATE_BUNDLE` and the query keys are Production-only, so Live
  reports "not configured". Don't add an Ignored Build Step that reads `VERCEL_ENV`: the project briefly had
  `[ "$VERCEL_ENV" != "production" ]`, and it canceled the production build of `main`.
- Roll back with Instant Rollback in the Vercel dashboard, or `npx vercel promote <previous deployment URL>`.

**Update the private bundle** whenever a private input changes (bindings, attestations, graph bindings or industries),
then redeploy. Set the `STUDIO_PRIVATE_*` variables listed below, and keep the packed value outside the repository:

```powershell
node scripts/vercel-build.mjs --pack <outside the repo>\studio-private-bundle.b64
cmd /c "npx vercel env add STUDIO_PRIVATE_BUNDLE production --sensitive --force < <outside the repo>\studio-private-bundle.b64"
Remove-Item <outside the repo>\studio-private-bundle.b64
```

The value is gzip plus base64 (about 24 KB) and must stay under 56 KB, because Vercel allows 64 KB of environment
variables per deployment. The packing script validates the inputs and refuses to write inside the repository.

**Manual deployment (optional).** To stage a build without merging, for example to test new private inputs:

1. Set the private inputs (kept outside Git) and build: `npm run build`, then `npm run validate`. The build prints the
   private data hash and refuses incomplete recordings, notes or attestations.
2. From a folder linked to the Vercel project (`npx vercel link`) that holds the contents of `dist/vercel`, stage it on
   the production environment without moving the domain: `npx vercel deploy --prod --skip-domain`. Delete the
   `.env.local` that `vercel link` may create.
3. Verify the staged URL (see the [validation checklist](#validation-checklist)). Staged URLs are protected; `npx vercel
   curl <url>` bypasses protection by creating an automation-bypass secret, which you revoke afterward.
4. Promote: `npx vercel promote <staged-url>`. The next merge to `main` replaces it.

## Production deployment (Vercel)

The app runs on the owner's personal, non-commercial Vercel Hobby project at
https://foundry-iq-demo-studio.vercel.app/. **Azure AI Search is its only runtime
dependency**: `foundry-iq-demos` for every scenario, plus a dedicated graph service
for industry S08/S09, both reached with query keys. There is no App Service, Blob
ledger, Key Vault, session secret or model key; model calls are made by the Search
service's own identity through index vectorizers.

```powershell
$env:STUDIO_PRIVATE_BINDINGS = '<private>\studio-live-config.json'
$env:STUDIO_PRIVATE_ATTESTATIONS = '<private>\search-schema-attestations.json'
$env:STUDIO_PRIVATE_GRAPH = '<private>\native-graph-binding.json'
npm run build   # writes dist/vercel; no Azure calls
```

The build does the following:

- Compiles the private bindings and ETag-pinned schema attestations into
  `server/private-data.mjs`, which only the Functions import. S08/S09 are bound
  from `native-graph-binding.json` (content, graph and topic index names, the
  semantic configuration, vector field and a 10-second per-call timeout) in every
  language; their ETags come from the attestations. They are never
  copied to `public/`.
- Compiles `config/studio-recorded.json` (recorded Sample) into the server bundle.
- Checks all 55 scenario/language pairs (plus every enabled industry scenario)
  offline against the attested schemas.
- Fails if recorded Sample coverage is incomplete or contains request IDs.
- Scans `public/` for private markers and credential-shaped values.

The page banner shows only the selected search type (the scenario title).
Scenario descriptions (`liveDifferences` in `config/studio-scenarios.mjs`) are
served by `/api/scenarios`; recorded Sample replays Live responses, so both modes
share one description. `scripts/vercel-tests.mjs`
fails if wording from earlier builds returns, such as fixed-illustration Sample,
unconfigured-encoder, App Service or ledger claims, or an S07 generated answer.

Do not commit or publish the private inputs or `dist/vercel`.

| Server variable | Value |
| --- | --- |
| `AZURE_SEARCH_ENDPOINT` | `https://foundry-iq-demos.search.windows.net` (must match the attested service) |
| `AZURE_SEARCH_QUERY_KEY` | A dedicated Search **query** key. Mark it Sensitive and never commit it. |
| `LIVE_ENABLED` | `true` enables Live. Any other value, or no value, pauses Live. |
| `LIVE_DISABLED_SCENARIOS` | Optional, empty by default. A comma-separated list such as `S07,S11` pauses those scenarios for cost control. Invalid values pause all Live. |
| `AZURE_SEARCH_GRAPH_ENDPOINT` | Industry S08/S09 only. The industry graph Search service, `https://fiq-industry-a30bcd4f-search.search.windows.net` (Production). |
| `AZURE_SEARCH_GRAPH_QUERY_KEY` | Industry S08/S09 only. A dedicated **query** key on the industry graph service, set by the owner (Sensitive). Redacted like the main key. |
| `LIVE_DISABLED_INDUSTRIES` | Optional, empty by default; only for builds with industries. A comma-separated list of industry IDs (and `zava`) pauses those demos. Invalid values pause every demo. |
| `STUDIO_PRIVATE_BUNDLE` | Build input, Production only (Secret). The packed private build inputs for Git deployments; see [Build and deploy](#build-and-deploy). |

If a variable is missing or invalid, Live fails closed with a configuration
message that never includes the value. Sample results are never substituted.

**Scope.** Live covers **S01–S11** in English, French, Spanish, Japanese and German.

- **S07** compares single-pass hybrid retrieval with native single-index agentic
  retrieval (`queryType: "agentic"`, API `2026-11-01-preview`,
  `maxRuntimeInSeconds: 10`) on the same support index. It is **evidence-only**:
  Vercel has no model credential, so neither arm generates an answer. AFTER
  shows the agentic plan: the follow-up sub-queries Microsoft Retriever 1
  issued, with their turn (up to 10, 200 characters each, sanitized). The
  drawer, Technical details and API log add the termination reason and
  planning/reasoning token usage. S07 presets use everyday wording ("brick",
  "won't take juice") that the policy documents don't use, so the planner
  visibly issues follow-up sub-queries; their notes state only the recorded
  sub-query count and ranking.
- **S11** sends an uploaded or bundled image as an `imageBinary` vector query,
  or text as a `text` vector query (text-to-image). Azure AI Search vectorizes
  both with the same Azure Vision multimodal model (`2023-04-15`, 1,024
  dimensions) used for the corpus. Images are bounded to 40 KiB, sent once and
  never stored.
- **S08** compares plain retrieval (hybrid search with the semantic ranker on the
  native graph's content index) with native Foundry IQ entity-graph search:
  `POST /indexes('{graph}')/docs/search.graph` (API `2026-11-01-preview`) with
  hydrated provenance. GQL comes only from the server-side allowlist in
  `config/studio-graph.json`, matched to the four curated questions; the browser
  can never send GQL. Each row is a path, drawn as entity —relationship→ entity
  and cited by the passages its edges were extracted from (provenance is per row;
  edge IDs don't name the relationship). A statement that expects no rows proves
  absence (for example, no drill → battery → CELL-X10 path). Free-text questions
  run plain retrieval only and say that graph traversal runs on the curated
  questions; writing GQL from free text would need a model.
- **S09** runs the same hybrid search in both arms without the semantic ranker
  (reranking would undo diversification): BEFORE with `topicGraph: none`, AFTER
  with `topicGraph: balanced`. AFTER also reads the theme hierarchy from the native
  topic index (`HasRootTopic`, `HasSubTopic`, `prop:*` rows). Both arms show
  "Themes covered: n of 4" from the precomputed passage-to-topic assignment; a
  topic-generation change fails visibly instead of mislabeling results.
- S08/S09 use the English Zava graph (`zava-retail-en`) in every language; a
  Technical details step and the About page say so. Graph and topic calls are ordinary Search reads with the query
  key, a 10-second per-call timeout and no retries. Their public content (questions,
  GQL, gold answers, topic hierarchy) is in `config/studio-graph.json`, copied from
  the graph session's runtime contract (`graph-evidence/runtime-contract`, commit
  `c9e2b51`); index names stay in the private binding.
- **Sample** is labeled in every language and replays **recorded** Live responses
  for every curated example (4 per scenario, 220 in total), with request IDs
  removed and the capture date shown. This includes S10 page/row cell polygons
  and S07/S11 evidence. The deterministic fixture engine in `lib/studio.mjs`
  is exercised by unit tests only; the app always replays recordings. Recorded Sample accepts only curated examples, an evidence count of
  5 or 10, and the default S06 boost. It never stands in for a failed Live request.
- There is no source download route.
- The unchanged Microsoft Foundry mark is used for the selector and favicons.

**User interface.** The top-right controls are:

- **Share**: the Web Share API, or copy `https://aka.ms/foundryiq-demo` with a confirmation.
  A non-default industry or scenario shares a link to that exact view.
- **GitHub**: a link to the repository.
- **Avatar menu** (no sign-in), with these items:
  - **Settings**: document language, and a System/Light/Dark theme that is saved
    locally and applied before first paint.
  - **Help**: Azure AI Search documentation.
  - **About**: the `/about` wiki page.

The search card has an example picker. Press `/` to focus it. Evidence count,
execution mode and boost settings are under **Advanced options**.

**How it works.** The server sends only `POST /indexes/{attested index}/docs/search`
and, for S08, `POST /indexes('{attested graph index}')/docs/search.graph`, with
the query key. A guard rejects every other origin, path, method and API version;
graph indexes accept graph queries only. The preview API is allowed only for the
S07 support indexes, the S11 image indexes and the S08/S09 content and topic indexes. Schema and ETag checks use the bundled attestations instead of
runtime Get Index calls, so a query key is sufficient. The vectorizers are:

- **Text:** `zava-text-vectorizer` (`azureOpenAI`, `text-embedding-3-small`,
  1,536 dimensions) on the 10 products and support indexes.
- **Image:** `zava-image-vectorizer` (`aiServicesVision`, preview) on the 5
  image indexes.

Both authenticate with the Search system-assigned identity, with no key and no
identity override.

**Stateless limits.** The build enforces these limits:

- Requests are limited to 64 KiB, questions to 8,000 characters and top-K to 5/10/20/50.
- A comparison can make at most 5 Search calls (Energy's Odessa question uses
  all 5: one plain retrieval plus four graph statements). Each call has a
  12-second timeout (10 seconds for S08/S09), and the whole comparison has a
  55-second budget. Functions stop at 60 seconds.
  - Why 12 seconds: Search's query-time vectorizer occasionally waits about
    30 seconds when the embedding deployment returns `408 Request Timeout`
    (about 1–3% of embedding calls; Search's `elapsed-time` header shows the
    wait), then succeeds. Normal calls finish in under about 7 seconds, so the
    cap shows that stall as a timeout on one arm instead of a 30-second wait.
    The other arm's results stay visible.
- There are no automatic retries.
- Each instance allows at most 8 live comparisons in flight (best effort).
- The Vercel Firewall rule "Rate limit live demo API" allows 30 requests per
  60 seconds per IP on `/api/demo/`. Its 429 response comes from the platform
  and cannot carry a `Retry-After` header; the UI tells visitors to wait about a
  minute. Every app-level 429 (and the per-instance 503) does send
  `Retry-After`, and Search throttling is reported on the affected arm with a
  bounded 1–60 second `retryAfter`, without retrying.
- The `LIVE_ENABLED` and `LIVE_DISABLED_SCENARIOS` switches pause Live.

Unknown paths return the static, CSP-clean `404.html` (theme-aware, links back
to the demo). Technical details intentionally show index and binding names as
provenance. Every API payload is redacted for the query key, the Search
hostname, credentialed URLs and server file paths. The native graph's passage,
chunk and edge IDs are base64-encoded storage URLs; the API log shows each as a
short stable hash (`[id 1a2b3c4d5e]`), and results show the parsed source ID
instead.

After 6 seconds the UI says Foundry IQ is responding slowly; each call stops after
at most 12 seconds and is never retried.

**Azure changes on `foundry-iq-demos` (owner-approved), with rollback:**

| Change | Rollback |
| --- | --- |
| `azureOpenAI` vectorizer `zava-text-vectorizer` bound to `zava-text-profile` on the 10 `zava-studio` products/support indexes | PUT the saved pre-change definition with `If-Match` set to the current ETag. |
| `aiServicesVision` vectorizer `zava-image-vectorizer` bound to `zava-image-profile` on the 5 image indexes | Same as above, using API `2026-11-01-preview`. |
| `Cognitive Services User` for the Search system identity, scoped to `vision-foundry-iq-demos` only | `az role assignment delete` for that assignment. |
| `knowledgeRetrieval: standard` (paid agentic retrieval) and `semanticSearch: standard` | PATCH both back to `free` (Search Management API `2026-03-01-preview` or later). |

SKU, replicas, partitions, authentication and networking are unchanged. The
earlier `Cognitive Services OpenAI User` grant on `ai-foundryiq-customer-demos`
already existed.

Native S08/S09 made **no Azure changes**. The Zava content, graph and topic
indexes (`fiq-zava-…`) were created by the separate Foundry IQ graph session.
This build only read their definitions (`GET`, in-memory admin key) to pin their
ETags in the private attestations. To roll back S08/S09, set
`LIVE_DISABLED_SCENARIOS=S08,S09` and redeploy, or promote the previous
deployment. If the graph or topic indexes are rebuilt, their names and ETags
change: re-run the attestation and binding step, then re-record S08/S09.

**Trade-offs accepted for this personal demo:**

- There are no durable shared quotas.
  Firewall counters are per region, and instance limits are per instance.
- Search S1 has fixed capacity. Semantic ranking and agentic retrieval are now
  billed after their free monthly allowances. Embeddings and Vision calls are
  billed to their Azure AI accounts. Set `LIVE_DISABLED_SCENARIOS` (for example
  `S04,S07,S11`) to cap these costs.
- A query key can read documents in **every** index on the service, not just the
  demo indexes. Keep only public synthetic content on `foundry-iq-demos`, or
  revoke the key.
- Attestations are point-in-time. A later change to a bound index is not detected
  at runtime. After any change, regenerate the attestations, then rebuild and redeploy.

### Industry demos (behind build configuration)

An **Industry** selector beside the scenario picker adds public corpora to the
Zava store demo. They are compiled into a build only when `STUDIO_INDUSTRIES`
lists them; **the default build has none**. Production enables all five:
`retail,financial,healthcare,manufacturing,energy`. Presets, notes, facet labels,
licenses and applicability come from the Industry datasets contract
(`foundry-iq-industry-contract-v1`).

| ID | Selector label | Index | Scenarios |
| --- | --- | --- | --- |
| `zava` (default) | Retail · Zava demo store | `zava-studio-*` | S01–S11, five languages |
| `retail` | Retail · Product recalls | `foundry-iq-retail` | S01–S09 |
| `financial` | Financial services | `foundry-iq-financial` | S01–S10 |
| `healthcare` | Healthcare & life sciences | `foundry-iq-healthcare` | S01–S10 |
| `manufacturing` | Manufacturing | `foundry-iq-manufacturing` | S01–S10 |
| `energy` | Energy & utilities | `foundry-iq-energy` | S01–S10 |

- Industry demos are English-only: the language setting is disabled with a note.
  S11 (images) stays with the Zava store unless an industry is a product-image
  catalog with an image binding (see “Product-image industries” below).
- **Industry S08/S09** run native Foundry IQ entity-graph and topic-graph search
  on a dedicated graph Search service (`lib/industry-graph.mjs`), reached only
  through `AZURE_SEARCH_GRAPH_ENDPOINT` and `AZURE_SEARCH_GRAPH_QUERY_KEY` with the
  same calls as the Zava graph (API `2026-11-01-preview`, 10-second per-call
  timeout, no retries). Each industry has 4 curated S08 and 4 S09 questions from
  the graph session's Phase 2 contract (`config/studio-industry-graph.json`,
  commit `09cf71d`):
  - S08: BEFORE is hybrid + semantic ranker on the content index; AFTER runs the
    question's 1–4 allowlisted GQL statements with hydrated provenance. Source IDs
    come from the contract's blob-URL map (keyed by SHA-256 prefixes, so no
    storage names are published). A row without evidence shows “Citation
    unavailable”; nothing is invented. Free text runs plain retrieval only.
  - S09 theme questions read the topic index: the 8 largest themes plus
    “+N smaller themes”, or the curated focus theme with its sub-themes. S09
    diversity questions compare `topicGraph` none and balanced; theme chips use
    the per-passage leaf map.
  - Index names, ETags and attested schemas (read by the graph session with
    Entra) are in the private binding (`STUDIO_PRIVATE_INDUSTRY_GRAPH`,
    `STUDIO_PRIVATE_INDUSTRY_GRAPH_ATTESTATIONS`); the build fails if catalog
    examples and graph-contract questions differ. API logs show the same host
    placeholder for both services and replace storage URLs with short hashes.
  - Without the graph variables or binding, industry S08/S09 fail closed with
    “Graph search isn’t configured for this industry yet”. `/api/health` reports
    `industryGraph`. Zava S08/S09 stay on the main service.
  - The graph service bills the semantic ranker (Standard) beyond its free
    monthly queries; `LIVE_DISABLED_SCENARIOS=S08` pauses S08 everywhere.
- The URL keeps the view (`/?industry=healthcare&scenario=S04`), and Share copies
  that link. An unknown industry or inapplicable scenario opens the default.
- Citations link to the original public source, only on each industry's reviewed
  hosts. Cards and the details drawer show agency, publisher, document type,
  license and published date. About lists each data source in the corpus, with
  its license (excluded and link-only references are omitted), plus the CFPB
  narratives note for Financial services. Facet rows use the contract's labels.
- Cards and the drawer show titles and passages as plain text: Markdown headings,
  emphasis, bullets, tables, links and images are removed for display
  (`assets/display.mjs`). Raw hit JSON and the API log keep the exact values.
- Each scenario's first (default) example shows a different #1 in BEFORE and
  AFTER whenever one exists; the build checks this against the recordings.
- S10 is named “PDF layout extraction”; its arms read “Read: page text” and
  “Layout: table rows”, and the provider name stays in Technical details.
- A not-configured scenario keeps Search and the query box disabled (typing
  doesn't re-enable them) and sends nothing; any prepare or run failure ends the
  loading state with a visible error.
- Recorded Sample replays every curated industry example (153: Retail 28,
  Financial 31, Healthcare 32, Manufacturing 32, Energy 30), plus the 40
  industry graph questions, recorded from Live on staged releases with request
  IDs removed. Full top-10 lists match the contract evaluation for 305 of 306
  arms; graph recordings match the contract's verified statements and coverage.

**Request shapes** (from the Industry datasets evaluation; every arm filters
`scope eq 'public' and variant eq 'primary'` unless noted):

| Scenario | BEFORE | AFTER |
| --- | --- | --- |
| S01 | `searchMode: all` over `titlePlain,contentPlain` (no stemming or synonyms) | `searchMode: any` over `title,content` (analyzers + `zava-studio-synonyms`) |
| S02 | keyword | `kind: text` vector query on `contentVector`, `k: 50`, pre-filter |
| S03 | keyword + preset filter | hybrid + the same preset filter |
| S04 | one shared hybrid candidate set | semantic L2 over those exact IDs (`<id>-semantic`) |
| S05 | keyword, no preset filter | hybrid + preset filter + preset facets (+ the preset's `orderby`, if any) |
| S06 | hybrid | hybrid + `<id>-freshness`, `-authority` or `-impact` (or the industry's own `boostSubtypes`), with reviewed `scoringParameters` for tag profiles |
| S07 | hybrid | native agentic (`2026-11-01-preview`, `maxRuntimeInSeconds: 10`) |
| S10 | keyword over `extractionAnalyzer eq 'prebuilt-read'` pages | `prebuilt-layout` rows; both filtered to the preset's `sourceHash` (no `variant` filter) |
| S11 | keyword over `title,content` | `imageBinary` (uploaded image) or `text` (text-to-image) vector query on the bound image field, `exhaustive: true`, pre-filter (`2026-11-01-preview`) |

Filters, facets, sorts, scoring parameters, scoring profiles and S10 documents
come only from the preset allowlist in `config/studio-industries.json` (or the
industry's `defaults`), matched by exact question. The browser can't send any of
them. Free text runs without a preset filter (S05 uses the default facets, S06
the default scoring parameters, and S10 searches the first example's PDF).

**Build inputs and checks.**

```powershell
$env:STUDIO_INDUSTRIES = 'retail,financial,healthcare,manufacturing,energy'
$env:STUDIO_PRIVATE_INDUSTRIES = '<private>\industry-bindings.json'
# STUDIO_PRIVATE_ATTESTATIONS must also attest the five industry indexes.
npm run build
```

- `industry-bindings.json` (private) maps each industry to its index, semantic
  configuration, vector field and scoring profiles. Index ETags come from the
  attestations, captured by a read-only Get Index per index.
- The build fails if a preset filter appears outside S03/S05, uses a field that
  isn't filterable or a `search.*` function other than `search.in`; if a facet is
  malformed or not facetable; or if an S10 preset lacks a PDF hash.
- It also fails if a preset `orderby` isn't S05, isn't `<field> asc|desc` or the
  field isn't sortable; if preset or default `scoringParameters` aren't S06, lack
  a `boostSubtype`, or name a `tagsParameter` that the subtype's attested
  scoring profile doesn't define; if an S11 preset carries an image; or if an
  industry lists S11 without an `image` binding.
- A release build also needs a recording and a note for every preset.
  `STUDIO_INDUSTRY_SAMPLES_OPTIONAL=1` relaxes recordings for development builds
  only. S07 planning varies between runs, so an S07 note that claims sub-queries
  fails the build unless the shipped recording shows them.
- `config/studio-industries.json` (public) is generated from the Industry datasets
  contract by an operator importer. It holds labels, sources, licenses, reviewed
  hosts and presets, never index names. Regenerate it when the contract changes.
- Notes describe only what the shipped comparison shows. The build rejects S03
  notes that mention a third (vector-only) arm, and S07 notes that claim
  planning the shipped recording doesn't show.
- Industry recordings add about 20 MB to `config/studio-recorded.json` (25.5 MB
  in total), because public-document passages are long. The server bundle
  imports in about 250 ms locally.

**Azure.** The industry indexes are owned by the Industry datasets session. This
framework made **no Azure changes**: only read-only Get Index calls (attestation)
and read-only queries for local verification. If an index is rebuilt (for
example `foundry-iq-energy`), its ETag changes: re-attest, rebuild and
re-record. The query key reads these public-domain indexes too.

### Product-image industries (S11) and the Fashion Product Images dataset

The industry framework supports a product-image catalog with S05 (facets,
filters and an optional preset sort), S06 (per-industry scoring profiles, for
example `newest`, `season`, `occasion`, `colour`) and S11 (image search). It uses
standard index search only (keyword, vector and hybrid; no agentic retrieval),
with the semantic ranker off unless measured as worthwhile.

**Status: not enabled.** The planned `fashion` industry (Kaggle “Fashion Product
Images”, ~44k products) is blocked on a rights review: the dataset's MIT tag is
set by the uploader, the images were collected from a retailer, and the
Hugging Face mirror declares no license. Nothing is downloaded, provisioned,
recorded or deployed until that review and each Azure step are approved.

- **Catalog entry** (`config/studio-industries.json`): `scenarios` including
  `S11`, its own `boostSubtypes`, an optional `dataNote` (shown instead of
  “Public U.S. government data”), `scenarioDescriptions.S11`, and
  `defaults.S06.scoringParameters` per tag subtype (for example
  `{ "season": ["seasonTags-Summer"] }`). S05 presets may set `orderby`
  (`year desc`); S06 presets may set `scoringParameters`.
- **Private binding**: `industries.<id>.image` with `field`, `profile`,
  `vectorizer` (`aiServicesVision`, Search system identity, no key),
  `model`, `modelVersion` (`2023-04-15`), `dimensions` (1024) and
  `manifestHash`. The key field must be `id` (keyword analyzer); `url` is
  optional for a product catalog.
- **Live S11** accepts an optional PNG, JPEG or WebP up to 40 KiB, sent once as
  `imageBinary` and never stored; without an image the text (up to 70 words, the
  Vision limit) runs text-to-image. Every hit must carry the bound
  `imageModel`, `imageModelVersion`, `imageDimensions` and `imageManifestHash`,
  or the arm fails with `studio_image_corpus_mismatch`.
- **Thumbnails** are returned only as this build's own
  `/datasets/<id>/thumbs/<name>.webp` paths (CSP `img-src 'self'`); any other
  value is dropped on the server. Copying the 256 px WebP thumbnails into the
  build (and its artifact check) is deferred until the rights review allows
  redistribution.

**Ingestion (Blob indexer, one readable JSON per product).**

1. Offline: `node scripts/prepare-fashion.mjs --styles <styles.csv> --out <dir>
   --images <512px-jpgs> --source <text> --license <text> [--size 3000]
   [--cap 150] [--seed fashion-v1] [--exclude <reviewed-ids.txt>]`. It selects a
   deterministic subset (Men, Women and Unisex Apparel, Footwear and
   Accessories; no Boys/Girls, Innerwear, Loungewear and Nightwear, Personal
   Care, Free Items or Sporting Goods; no rows missing a name, type or colour;
   duplicates removed; capped per article type), writes
   `products/fpi-<id>.json` with real metadata only (no price, rating,
   popularity or stock) and `manifest.json` with `imageManifestHash`. Resizing
   images and the manual image review are separate offline steps.
2. Upload `products/` and `images/fpi-<id>.jpg` to a private container.
3. Create the objects in `templates/fashion/` (placeholders only):
   `index.json`, `datasource-products.json` / `indexer-products.json`
   (`parsingMode: json`), and `datasource-images.json` / `skillset-images.json` /
   `indexer-images.json` (Azure Vision multimodal embeddings skill, preview, on
   the blob URL). Both indexers write the same `id`, so each document merges
   metadata and image vector. Data sources use the Search managed identity.
4. Keep it current: edit or add a product's blobs and the hourly schedule picks
   up the change (blob last-modified). To remove a product, set blob metadata
   `IsDeleted=true` on both blobs, let the indexers run, then delete the blobs.
   A schema test (`scripts/fashion-tests.mjs`) checks the templates against
   the industry S05/S06/S11 schema checks.

## Revoke or rotate keys

1. Stop the key immediately: in the Azure portal, go to Search service
   `foundry-iq-demos` > **Settings** > **Keys** > **Manage query keys**, then
   delete the Vercel key. Requests fail at once.
2. Stop Live traffic without a redeploy by publishing a Vercel Firewall deny rule
   for `/api/demo/`. Alternatively, set `LIVE_ENABLED=false`
   (`npx vercel env rm LIVE_ENABLED production`, then add `false`) and redeploy.
   Environment changes apply only to new deployments.
3. To rotate, create a new query key, replace `AZURE_SEARCH_QUERY_KEY` in Vercel
   (Sensitive) for Production and Preview, redeploy, verify, then delete the old key.
   Delete any query key that is no longer in use.
4. The industry graph key (`AZURE_SEARCH_GRAPH_QUERY_KEY`) works the same way on
   the graph service; without it, only industry S08/S09 stop (not configured).

## Validation checklist

Before merging to `main` (which deploys) or promoting a staged deployment:

- `npm test`, `npm run build`, `npm run validate` and `npm run test:browser` pass, and `git diff --check` is clean.
- `/api/health` reports `live: configured` and `industryGraph: configured`; `/download` returns 404.
- A paced Live canary (under 30 requests per minute per IP) passes for every curated industry preset, S08/S09 and the
  Zava scenarios in all five languages. Transient Search timeouts are retried once by hand, never by the app.
- The UI suite passes with no serious or critical axe violations in light and dark themes and on mobile.
- The automation-bypass secret is revoked after verification.
