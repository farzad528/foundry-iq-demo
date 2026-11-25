# Foundry IQ Demo Studio

The compact **S01–S11 Demo Studio** is this repository's primary root application.
The existing native Node.js/ESM runtime is retained: no Next.js restoration,
second management app, sidebar or dashboard. Choose a demo, enter a query, select
5/10/20/50 evidence hits (default 10), and compare BEFORE/AFTER on the same gray
surface. Settings and technical traces stay collapsed. Reset clears inputs,
results, errors and traces while retaining scenario/count; scenario changes
cancel and invalidate late responses. Document language changes do the same,
retaining the selected scenario/count without running a query. Desktop panes stack on mobile.
Successful comparisons use the results themselves as the completion cue;
execution provenance stays in collapsed technical details and completion is
announced to screen readers. Sample mode, loading and failures remain explicit.
The pastel scenario banner, compact controls and blue/purple comparison headers
keep the focus on evidence. Focus or click **Search query** to open four
scenario-specific curated examples, even when the field is prefilled. Use the
arrow keys and Enter, mouse or touch to select; Escape closes the list.
Selection only fills the input; **Search** explicitly starts the comparison.
Free-text Live queries remain supported. S11 Live examples disclose and load
bundled synthetic PNGs through the same ephemeral image/encoder path as local
uploads; selecting one never calls Azure. S11 Sample examples retain the fixed,
clearly labeled blue-hat reference rather than claiming arbitrary image input.

One Node host serves the UI and `/api/demo/run`. The original pinned
`/api/retrieve` remains a bounded compatibility endpoint, not a second UI.
There is no visitor sign-in, separately hosted agent, browser credential,
Cloudflare, or arbitrary endpoint/knowledge-base proxy.

**Historical hosted Explorer:** [Foundry IQ Explorer](https://app-foundryiq-customer-demos.azurewebsites.net)
passed separately approved anonymous public-demo acceptance on **2026-10-19**,
including real indexed and Web retrieval. See [deployment evidence and limits](#hosted-demo-evidence-and-limits).
That acceptance is **not** acceptance or deployment of the new studio.
This is a deployment-specific snapshot, not an uptime guarantee or evidence that
a fresh checkout is configured. Live queries remain **disabled by default** in
source and example parameters. Publishing or merging source does not authorize
provisioning, paid canaries, uploads, or deployment; CI is build/test only.

## Personal Vercel deployment (Search-only Live)

A separate build targets the owner's personal, non-commercial Vercel Hobby
project at https://foundry-iq-demo-studio.vercel.app/. **Azure AI Search
(`foundry-iq-demos`) is its only runtime dependency.** It uses no App Service,
Blob quota ledger, Key Vault, session secret or model key. Model calls are made
by the Search service's own identity through index vectorizers. The release's
App Service path above is unchanged.

```powershell
$env:STUDIO_PRIVATE_BINDINGS = '<private>\studio-live-config.json'
$env:STUDIO_PRIVATE_ATTESTATIONS = '<private>\search-schema-attestations.json'
npm run build:vercel   # writes dist/vercel; no Azure calls
```

The build does the following:

- Compiles the private bindings and ETag-pinned schema attestations into
  `server/private-data.mjs`, which only the Functions import. They are never
  copied to `public/` or the source ZIP.
- Compiles `config/studio-recorded.json` (recorded Sample) into the server bundle.
- Checks all 55 scenario/language pairs offline against the attested schemas.
- Fails if recorded Sample coverage is incomplete or contains request IDs.
- Scans `public/` for private markers and credential-shaped values.

Do not commit or publish the private inputs or `dist/vercel`.

| Server variable | Value |
| --- | --- |
| `AZURE_SEARCH_ENDPOINT` | `https://foundry-iq-demos.search.windows.net` (must match the attested service) |
| `AZURE_SEARCH_QUERY_KEY` | A dedicated Search **query** key. Mark it Sensitive and never commit it. |
| `LIVE_ENABLED` | `true` enables Live. Any other value, or no value, pauses Live. |
| `LIVE_DISABLED_SCENARIOS` | Optional, empty by default. A comma-separated list such as `S07,S11` pauses those scenarios for cost control. Invalid values pause all Live. |

If a variable is missing or invalid, Live fails closed with a configuration
message that never includes the value. Sample results are never substituted.

**Scope.** Live covers **S01–S11** in English, French, Spanish, Japanese and German.

- **S07** compares single-pass hybrid retrieval with native single-index agentic
  retrieval (`queryType: "agentic"`, API `2026-11-01-preview`,
  `maxRuntimeInSeconds: 10`) on the same support index. It is **evidence-only**:
  Vercel has no model credential, so neither arm generates an answer. Safe
  diagnostics appear in Technical details: termination reason, sub-query count
  and planning/reasoning token usage.
- **S11** sends an uploaded or bundled image as an `imageBinary` vector query,
  or text as a `text` vector query (text-to-image). Azure AI Search vectorizes
  both with the same Azure Vision multimodal model (`2023-04-15`, 1,024
  dimensions) used for the corpus. Images are bounded to 40 KiB, sent once and
  never stored.
- **Sample** is labeled in every language and replays **recorded** Live responses
  for every curated example (4 per scenario, 220 in total), with request IDs
  removed and the capture date shown. This includes S10 page/row cell polygons
  and S07/S11 evidence. The deterministic fixture engine remains in `lib/studio.mjs`
  for the App Service path and tests. Recorded Sample accepts only curated examples, an evidence count of
  5 or 10, and the default S06 boost. It never stands in for a failed Live request.
- The `/download` source route is omitted.
- The unchanged Microsoft Foundry mark is used for the selector and favicons.
  Knowledge-source kinds keep the neutral fallback icon.

**User interface.** The top-right controls are:

- **Share**: the Web Share API, or copy `https://aka.ms/foundryiq-demo` with a confirmation.
- **GitHub**: a link to the repository.
- **Avatar menu** (no sign-in), with these items:
  - **Settings**: document language, and a System/Light/Dark theme that is saved
    locally and applied before first paint.
  - **Help**: Azure AI Search documentation.
  - **About**: the `/about` wiki page.

The search card has an example picker. Press `/` to focus it. Evidence count,
execution mode and boost settings are under **Advanced options**.

**How it works.** The server sends only `POST /indexes/{attested index}/docs/search`
with the query key. A guard rejects every other origin, path, method and API
version. The preview API is allowed only for the S07 support indexes and the S11
image indexes. Schema and ETag checks use the bundled attestations instead of
runtime Get Index calls, so a query key is sufficient. The vectorizers are:

- **Text:** `zava-text-vectorizer` (`azureOpenAI`, `text-embedding-3-small`,
  1,536 dimensions) on the 10 products and support indexes.
- **Image:** `zava-image-vectorizer` (`aiServicesVision`, preview) on the 5
  image indexes.

Both authenticate with the Search system-assigned identity, with no key and no
identity override.

**Stateless limits.** The build enforces these limits:

- Requests are limited to 64 KiB, questions to 8,000 characters and top-K to 5/10/20/50.
- A comparison can make at most 4 Search calls. Each call has a 45-second
  timeout, and the whole comparison has a 55-second budget. Functions stop at 60 seconds.
- There are no automatic retries.
- Each instance allows at most 8 live comparisons in flight (best effort).
- The Vercel Firewall rule "Rate limit live demo API" allows 30 requests per
  60 seconds per IP on `/api/demo/`.
- The `LIVE_ENABLED` and `LIVE_DISABLED_SCENARIOS` switches pause Live.

The first vector query after a quiet period can take about 20–25 seconds while
the Search-to-model path warms up. The UI says so after 6 seconds.

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

**Trade-offs accepted for this personal demo:**

- The durable shared quotas of the App Service design are **not** enforced.
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

**Revoke or rotate the key.**

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

## Local replay and production artifact

Use Node.js **22+** (22/24 LTS compatible), npm, and Python 3. Python is used only
by the build to create the sanitized source ZIP. Build discovers `python` /
`python3`, or an explicit `PYTHON` executable; Python is not required to start.

```powershell
git clone https://github.com/farzad528/foundry-iq-demo.git
Set-Location foundry-iq-demo
npm ci
npm run dev
```

Open `http://localhost:3000`. **Sample mode** is explicit before running.
Each scenario has curated synthetic questions, independent gold labels and
bounded evidence results. Local fixture rankings are not Azure measurements.
Result count limits displayed evidence, not generated answers or recorded
Azure activity/timing. A failed live query never falls back to a sample.
No environment file is required for offline replay. `.env.example` documents
optional local settings and fixed, non-secret resource names; it does not
discover resources. If needed, copy it to `.env.local` **only if that file does not already
exist**. Existing private environments are not migrated, overwritten, or uploaded.
Review legacy local settings privately rather than reusing them automatically.

```powershell
npm test
npm run build
npm run validate
npx playwright install chromium
npm run test:browser
npm start
```

`npm test` builds first, then runs the built-in Node test suite, so it works
directly after `npm ci`. `npm run dev` builds once and starts the local host;
restart it after source changes (there is no watch/HMR server).

`npm start` serves **prebuilt** `dist/server/index.mjs`, binds `0.0.0.0:$PORT`,
and does not build or invoke Python. Set `PUBLIC_ORIGIN` to the exact public
HTTPS origin before any separately approved public hosting. Startup is
`npm start` **from the repository root**. A prebuilt runtime bundle needs the
root `scripts/start.mjs`, `lib/`, `dist/`, `package.json`, lockfile and production
dependencies (`npm ci --omit=dev`); Python is not a runtime dependency.
The full repository includes separately gated local infrastructure/operator
scaffolds described below, but no deployment workflow or automatically
provisioned services. Hosting/resource/cost approval is a separate gate; these
runtime requirements are not deployment authorization.
`/healthz` checks the HTTP host without calling Search, Storage, or a model;
it is liveness, not proof of live dependency readiness.

The runtime dependencies are `@azure/storage-blob` for Blob lease/ETag
coordination and `@azure/identity` for deterministic managed identity credentials.
Search still uses its existing server-side API-key design. There is no
framework, frontend build dependency, external test runner, or monitoring SDK.
Playwright is a development-only browser automation dependency; tests use Node's
built-in runner. Browser installation is separate from build/start.

## Studio API, capability matrix and approval boundaries

`GET /api/scenarios` exposes only safe scenario metadata; `POST /api/demo/run`
accepts `{scenarioId, query, topK, mode, options?, language?, imageInput?}`.
`language` is one of `en` (default), `fr`, `es`, `ja`, `de`; unknown values are
rejected. The server derives the
anonymous synthetic principal and shared dataset/resource snapshot; the browser
cannot supply authorization claims, credentials, endpoints or headers.
Independent arms return visible partial failures. Requests are capped at
64 KiB, questions at 8,000 characters and upstream streams at 1 MiB, with a
55-second total comparison budget and no automatic Search retries. Every live
upstream attempt consumes the existing durable shared Blob quota.

`GET /api/health` reports **configuration**, not tested dependency readiness.
Durable upload APIs return explicit HTTP 501 with no persistence: additional durable
scoped storage/ingestion has not been approved. S10 starts from a canonical
synthetic PDF with equivalent basic/layout evidence. S11 uses fixed original
illustrations in Sample mode, not arbitrary image understanding. Selecting a
new local file does not claim it has been ingested. Configured S11 accepts an ephemeral inline JPEG/PNG/WebP reference (up to 40 KiB),
not a durable upload. Live image similarity requires an actually compatible
corpus/query image encoder and indexed vectors.
S12–S16, customer data and remote enterprise connectors are not implemented.

### Capability evidence (checked 2026-11-24)

Management preflight confirmed provider registration, exact name availability,
West Central US `standard` (S1) offering and regional Standard usage **3/12**
before creation. Requested capacity is **1 replica × 1 partition**.
These management checks alone do **not** validate data-plane readiness.
Subsequently authorized synthetic ingestion and actual canaries verified
the original eleven paths, including the former native S07 KB implementation,
native CU Read/Layout processing for S10 and compatible image vectors for S11.
S07 has since been replaced with **single-index agentic Search**. Its real
`2026-11-01-preview` canary returned **HTTP 402**: Microsoft Retriever 1 requires
paid **Standard Knowledge Retrieval**, while this S1 service currently has the
Free plan. That separate billing-plan change awaits approval. S07 Live is blocked,
not routed back to the old KB or classic Search; the other ten paths are unchanged.
S08 remains **custom**, and S09 **experimental**; neither becomes a native
graph/topic feature. All eleven retain explicit Sample behavior with no silent
live fallback. These are scoped local canaries, not production-hosting,
all-query/permutation, billed-cost or native-graph acceptance.

| Scenario | API / implementation | West Central US S1 / prerequisites | Tested state / fallback |
| --- | --- | --- | --- |
| S01 Keyword | Search `2025-09-01`; app substring vs analyzer/synonym fulltext | Approved product index/analyzers/synonyms | Actual Azure comparison succeeded |
| S02 Vector | Search `2025-09-01`; lexical vs real text vectors | Server-side Entra embeddings; pinned `text-embedding-3-small@1`, 1536 dimensions | Actual corpus/query embedding and retrieval succeeded; Sample retains SKU-loss cases |
| S03 Hybrid | Search `2025-09-01`; lexical vs hybrid/RRF | Identical typed category/price constraints | Actual Azure comparison succeeded |
| S04 Semantic | Search `2025-09-01`; shared hybrid candidates and rerank | [Semantic regional support](https://learn.microsoft.com/azure/search/search-region-support); strict candidate equivalence | Actual reranking succeeded; rank movement, not unlike-score delta |
| S05 Retail | Search `2025-09-01`; filters/facets/merchandising | Identical mandatory London stock/location/price filters | Actual Azure comparison/facets succeeded |
| S06 Boosting | Search `2025-09-01`; isolated scoring profile | Schema-checked freshness/magnitude/distance/tags/availability profiles | Actual default-profile comparison succeeded; not all profile permutations live-tested |
| S07 Agentic | [Documents Search `2026-11-01-preview`](https://learn.microsoft.com/en-us/rest/api/searchservice/documents/search-post?view=rest-searchservice-2026-11-01-preview&tabs=HTTP#querytype), `queryType: "agentic"`; hosted Microsoft Retriever 1 | Same public-scoped support index as baseline; **Standard Knowledge Retrieval** (distinct from S1 SKU) | Actual canary **402**, request `2a040f30-d7d2-420d-9d73-7732f1086897`; paid-plan approval pending. No KB/classic fallback |
| S08 Graph | Actual Search evidence plus Azure-indexed **custom** BOM edges | Source-ID joins, public scope/version; no native graph claim | Custom index baseline/treatment succeeded; deliberately not an agentic-KB baseline |
| S09 Topics | Azure-indexed **experimental** topic/entry projection | Topic search followed by exact public source-ID expansion, scope/version/freshness | Actual projection retrieval succeeded; not native materialization |
| S10 Extraction | Native CU GA `2025-11-01` Read vs Layout over the same PDF, then Search | Approved East US 2 CU account; exact source hash, operation IDs, page/row/native inch polygons | Actual extraction and indexed retrieval succeeded; headers mapped ordinally from native paragraphs; new uploads unsupported |
| S11 Images | Vision `2024-02-01`, model `2023-04-15`, then Search | Approved East US ComputerVision S1; same 1024-dimensional image encoder for corpus/query | Actual binary PNG encoding and query-image retrieval succeeded; not captions/text embeddings |

Published [knowledge-source](https://learn.microsoft.com/rest/api/searchservice/knowledge-sources/create-or-update?view=rest-searchservice-2026-11-01-preview)
and [knowledge-base](https://learn.microsoft.com/rest/api/searchservice/knowledge-bases/create-or-update?view=rest-searchservice-2026-11-01-preview)
shapes were checked. The legacy Retrieve contract remains pinned to
`2026-08-01-preview`; studio APIs are versioned separately. Explicit request-level
`maxOutputSize` remains the output-token bound; no silent contract migration.
West Central US does not show query rewrite or availability-zone support in the
published matrix; neither is promised by this demo.

### Document languages

The compact **Document language** control selects English, Français, Español,
日本語 or Deutsch. It changes the indexed corpus, source links and four curated
examples per scenario, not the surrounding English application chrome.
Free-text input stays editable. Switching cancels stale work and clears results
and selected files; it never submits a query. Reset retains language/scenario/count.
English Sample remains available; localized Sample is explicitly unavailable
rather than simulating localized retrieval with English fixtures.

The approved localized ingestion adds **28 isolated indexes**, seven per
additional language, without rebuilding or changing the ten English indexes.
The actual service now has **38/50 indexes**, **5/5 synonym maps**, one existing
knowledge source and one existing KB. Each additional language has 40 products,
11 public support records, 11 sourced graph edges, one topic, two native CU Read
pages, two native Layout rows and three image-vector records: 70 records per
locale. Canonical IDs, prices, specifications, inventory and relationships are
preserved. Titles/content use the matching `fr.lucene`, `es.lucene`, `ja.lucene`
or `de.lucene` analyzer; both comparison arms use the same language-specific
index and enforced `language` filter. Semantic reranking uses that localized
candidate set. No query-time snippet translation or English fallback is used.
The [documented language-index design](https://learn.microsoft.com/azure/search/search-language-support)
and [supported analyzers](https://learn.microsoft.com/azure/search/index-add-language-analyzers)
are independent of any claim that a particular deployment has passed canaries.

Localized original PDFs are genuinely typeset, with searchable subset-embedded
fonts, then processed by native CU Read and Layout before indexing. Both arms
cite the same localized two-page PDF and its real page/row/cell evidence; values
remain DCD796 concrete **13 mm**, wood **40 mm**, steel **13 mm**, and adjacent
DCD797 concrete **16 mm**. Images can share the original synthetic PNG bytes,
but their indexed/cited titles and metadata are language-specific. Corpus and
query image vectors use the same pinned encoder. See
[`assets/PROVENANCE.md`](assets/PROVENANCE.md) for separate embedded-font rights.

Actual canaries verified **50 supported scenario/language comparisons**, one
current curated example each at result count 10, with real request IDs,
language-isolated evidence and scenario-specific correctness checks. This
includes the native Japanese PDF values/page/cell evidence and image matching
in all five languages. All 55 four-example dropdown lists are covered by
browser regression tests; not all 220 presets, arbitrary queries or every
scoring-profile permutation have been live-tested.

S07's single-index agentic paid-plan blocker applies to **all five languages**.
No new KB is built to work around that gate. Language-specific live availability
requires actual operator proof (`fr:S01`, for example), not just an index's
existence. Authorized operators can inventory with
`node scripts\studio-localize.mjs --inventory <session-output>`.
`--translate` and `--ingest` are explicit, separately authorized metered
preparation steps; they are not app startup actions. Their configuration,
vectors and native extraction captures stay outside the public source ZIP.

### Exact approved Search resource and operator scripts

The only approved service creation is `foundry-iq-demos` in
`rg-foundry-iq-demos`, West Central US, Azure Search PM (angiesi),
subscription `ee787b9b-a25f-4d20-86e9-45fcea5253dd`, Standard S1,
1 replica/1 partition, key-only authentication. Provisioning succeeded and these
exact settings were verified. Both resources carry
`description=Do not delete`. The tag is advisory, **not a deletion lock**.
No extra model/storage resources or production deployment are authorized.

`node scripts/studio-provision.mjs` performs read-only preflight and verifies an
existing exact-match service. `--apply` is explicit create-if-missing only;
the script never selects an alternate name/region/SKU, resets an existing service,
prints keys or deletes the group/service. Operational scripts stay outside the
downloadable app-only source ZIP.

`node scripts/studio-ingest.mjs <synthetic-manifest.json>` is a local dry-run.
Mutating ingestion additionally requires separate approval,
`STUDIO_INGEST_APPROVED=true` and `--apply`, with the exact server endpoint/key.
Only explicitly named `zava-studio-*` derived indexes/sources/KBs are allowed.
Each definition must carry the exact ownership description
`Zava Studio synthetic dataset <datasetVersion>`. Synonym maps and vector
deployments must already be separately reviewed/configured; this script does
not create them. Generator manifests describe corpus files, not Search schemas:
assemble the ingestion manifest with reviewed `indexes`, `knowledgeSources`
and `knowledgeBases` definitions and matching per-document `datasetVersion`.
New schemas are conditional create-if-missing; incompatible existing schemas
fail rather than being silently replaced. Document writes are deterministic
`mergeOrUpload`, with per-record success verification and no retries.
`--cleanup` is also dry-run unless `STUDIO_CLEANUP_APPROVED=true` and `--apply`;
it checks ownership/version and ETag before deleting only named derived artifacts.
**Neither cleanup nor any other studio script deletes the requested Search
service or resource group.** Approved synthetic ingestion was executed; cleanup
was not. Existing descriptions may append reviewed encoder metadata after the
exact ownership prefix.

### Verified local live operator

`scripts/studio-live.mjs` is repository-only, excluded from the source ZIP.
Its default invocation is a **zero-Azure-call dry-run**. Authorized `--apply`
privately obtains the Search key in process memory, validates the existing
Entra embedding deployment, creates owned schemas/documents and a public Search
knowledge source, and waits for actual counts. It never creates a paid model,
Storage resource or production deployment. Separately approved native-resource
setup is explicit and repository-only; runtime startup never provisions.

```powershell
node scripts\studio-live.mjs
# Only after explicit synthetic ingestion approval:
node scripts\studio-live.mjs --apply --verify --start --port 3018 --output .\dist\studio-live-evidence
# Reuse successful evidence <1 hour old only when current index ETags/counts match:
node scripts\studio-live.mjs --resume --verify --start --port 3018 --output .\dist\studio-live-evidence
# After approved native setup/extraction/indexing below, verify native paths too:
node scripts\studio-live.mjs --native --verify --start --port 3019 --output .\dist\studio-live-evidence
# Include actual reviewed per-language bindings; this verifies all five corpora:
node scripts\studio-live.mjs --native --verify --start --port 3019 --languages <session-bindings.json> --cu-evidence <session-cu.json> --output <session-evidence-directory>
```

The operator uses subscription-selected `AzureCliCredential` with tenant
verification, the existing dedicated model binding and the existing durable
Blob quota/session secret. It does not read private environment files or write
keys/tokens. Existing model local-auth policy remains disabled/unchanged.
The Blob coordinator is imported from the prebuilt handler's module tree.
Canaries keep a fixed operator session/IP and use the same metered
prepare/availability cooldown as the browser: no quota
reset, actor rotation or automatic Search retries. A bounded 32-entry,
five-minute schema cache retains verified ETags; every dispatched request,
including query embedding, still consumes quota.
S07's six cold attempts exceed five/session/minute. When its paid-plan gate is
approved and verified, the operator meters one index-schema warmup read, waits a
quota window, then executes five retrieval/embedding/answer attempts and shares
that cache with the preview. After cache
expiry, direct run-only clients can exhaust their allowance during metadata
checks. The studio calls `POST /api/demo/prepare` with the same validated request
first: schema checks remain metered, then a durable whole-comparison budget
check returns a rolling-window cooldown if needed. The UI shows a cancellable
countdown before starting retrieval. This also handles repeated searches without
beginning arms that cannot fit the current allowance. It never resets counters,
extends the 55-second retrieval budget, or retries a failed Azure request.
Programmatic studio clients should follow the same prepare/wait/run sequence.
The local studio operator warms an SDK-managed Entra bearer-token provider,
which coalesces acquisition and refreshes valid tokens instead of launching
Azure CLI on every model request. It never uses an expired-token fallback.
Credential acquisition, transport failures and Azure HTTP failures have distinct
safe messages; local correlation IDs are not presented as Azure request IDs.
S09 searches actual indexed topics before retrieving their linked sources;
linked policy evidence need not independently match the user's lexical terms.
Only topics whose full provenance fits the returned evidence are displayed.
S07's two independent answer contexts include source titles and stable IDs,
and share instructions to treat support cases as examples rather than assuming
the user owns the example model/lot or already has its receipt. Eligibility
remains conditional on the user's actual details.
S05's dropdown uses eligible inventory examples; out-of-stock negatives remain
in the gold corpus rather than suggesting that hybrid retrieval must return
zero alternative eligible products.

| Real asset | Count | Provenance |
| --- | ---: | --- |
| `zava-studio-products` | 40 | Synthetic products; real 1536-dimensional text vectors |
| `zava-studio-support` | 11 | Public synthetic evidence; real text vectors; restricted/retired records excluded |
| `zava-studio-pdf-basic` | 2 | Canonical original PDF pages |
| `zava-studio-pdf-layout` | 2 | Same PDF, exact table rows/page coordinates |
| `zava-studio-graph` | 11 | Sourced stable-ID custom BOM edges |
| `zava-studio-topics` | 1 | Versioned experimental topic with sourced entries |
| `zava-studio-images` | 3 | Actual gallery metadata only; no image vectors |
| `zava-studio-pdf-cu-basic` | 2 | Actual CU Read page text from the same PDF |
| `zava-studio-pdf-cu-layout` | 2 | Actual CU Layout rows, page 2 and native inch cell polygons |
| `zava-studio-images-vision` | 3 | Actual compatible Vision image vectors plus encoder/manifest provenance |

The dataset version is `zava-studio-2026-01`; actual index ETags/counts and
query IDs are captured in `studio-live-verification.json`. The source
catalog CSV includes all 40 indexed IDs and their exact content, including
explicitly fictional scale fillers, so their citations resolve locally.
The source
`zava-studio-support-source` is real, created with `2026-11-01-preview`;
`zava-studio-support-agentic` historically retrieved it with `2026-08-01-preview`.
It remains intact but is no longer used by S07. The replacement uses
`POST /indexes/zava-studio-support/docs/search?api-version=2026-11-01-preview`
with `queryType: "agentic"`, `debug: "agentic"` and a 30-second agentic runtime
bound. It accepts actual `value` documents and native agentic diagnostics; HTTP
206/early termination remains partial. Traces expose safe diagnostic counts and
metered token usage when supplied, never raw generated subqueries. Do not send
`queryLanguage`, classic semantic/answer/caption options or vector queries to this
treatment. Both arms share the same configured index and public scope.
The existing embedding binding is
`ai-foundryiq-customer-demos` / `foundryiq-customer-demos-embedding` in West US 2,
model `text-embedding-3-small`, version `1`. Recorded model usage covers measured
calls, not a billed-cost or whole-session spend estimate.

The preview binds only `127.0.0.1`. Only successfully verified scenario IDs are
enabled/defaulted to Live; others reject Live before any upstream request.
S10 becomes native-verified only with executed CU operation provenance bound to
the actual indexed documents and schema ETags. The old deterministic indexes
remain intact; configurations using them retain **custom pre-extracted** titles/
arm labels and cannot advertise verified CU.
No verified set means Sample-only studio, even if configuration exists.
Verification records preserve actual arm IDs, citations, filters, status,
latency/usage where returned, and explicit blockers; no quality metric is
inferred from arbitrary live queries.

The user separately approved Search system-assigned identity, **Cognitive
Services OpenAI User** scoped only to `ai-foundryiq-customer-demos`, a CU account
in East US 2 and a compatible image account including usage charges. Executed
resources are `ai-foundry-iq-demos-cu` (AIServices S0, East US 2) and
`vision-foundry-iq-demos` (ComputerVision S1, East US). Azure policy required both
new accounts to disable local auth; all their data-plane calls use Entra.
The existing model remains Entra-only and Search remains key-only. No new
model deployments, Storage resources, broader roles or production deployment
were needed. These specific approvals are not blanket provisioning permission.

Repository-only operators default to zero-call dry-runs. The following mutating
commands are for that specifically approved setup, never ordinary app startup:

```powershell
node scripts\studio-native-provision.mjs --apply --output .\dist\studio-live-evidence
node scripts\studio-native-bindings.mjs --kb --answer --image --output .\dist\studio-live-evidence
node scripts\studio-cu.mjs --execute --paid-extraction-approved --output C:\approved-session\studio-native-cu.json
node scripts\studio-native-bindings.mjs --pdf-evidence C:\approved-session\studio-native-cu.json --output .\dist\studio-live-evidence
node scripts\studio-live.mjs --native --verify --start --port 3019 --cu-evidence C:\approved-session\studio-native-cu.json --output .\dist\studio-live-evidence
```

CU processes the same canonical source separately with `prebuilt-read` and
`prebuilt-layout`; no extra model deployment/default was needed. Extraction
operation IDs and native cell polygons are persisted in evidence and indexed
provenance. Layout's header text is separate native paragraphs, so column-label
association is explicitly ordinal application mapping, not native header-cell
detection. Extraction occurs at ingestion, not on every search. The prior
West US 2 unsupported-region probes remain historical evidence.

Vision corpus/query use the exact same `2023-04-15` multimodal image encoder;
the served original PNG bytes match the versioned corpus manifest. Images are
original geometric illustrations, not photographs. Image Analysis 4.0 is
[deprecated, retiring September 25, 2028](https://learn.microsoft.com/azure/ai-services/computer-vision/overview-image-analysis);
this is an executed compatible demo binding, not a long-term platform commitment.

Gold retrieval evaluation is reported only for exact applicable curated queries.
No arbitrary-query accuracy, invented dollar/quality improvement or single-run
p50/p95 is displayed. Synthetic answer fixtures are not live model output.

`config/studio-live.example.json` is a **non-working**, credential-free operator
example, deliberately invalid until schema checks produce real ETags and
attestations. Load reviewed JSON server-side into `STUDIO_LIVE_CONFIG`; never
accept it from the browser. `index`/`indexETag` pin the common resource;
`vector` binds field/profile/vectorizer/deployment/model/version/dimensions.
The live operator uses `vector.provider: "serverAzureOpenAI"` and
`STUDIO_TEXT_ENDPOINT`/`STUDIO_MODEL_AUTH=entra` with an explicitly injected
server token provider; it does not need to change Search identity or model
local-auth policy. Integrated Search vectorization is a separately configured
alternative, not the verified path.
S01 also needs synonym maps; S04 needs a searchable/filterable keyword-analyzed
ID carrier and `semantic: {configuration, carrier: "keyword-id"}` to rerank the
exact shared candidates, not unsupported wildcard/filter-only semantic ranking.
S06 needs all five named scoring profiles plus reviewed server-only
`scoringParameters.distance` (parameter, longitude, latitude) and
`scoringParameters.tags` (parameter, values);
S07 needs `agentic: {apiVersion: "2026-11-01-preview", maxRuntimeInSeconds: 30,
knowledgeRetrievalPlan: "standard"}` only after the actual paid plan is approved
and verified, plus the shared answer deployment,
model version and `studio-grounded-answer-v1` instructions, with server-only
`STUDIO_ANSWER_ENDPOINT`/`STUDIO_ANSWER_API_KEY`. Its two generation requests have
independent evidence contexts, never a shared prompt containing both arms.
The verified gpt-5.1 binding uses `max_completion_tokens`, `reasoning_effort:
"none"` and identical instructions for both arms. Entra with the injected
provider is supported instead of `STUDIO_ANSWER_API_KEY`.
S08/S09 explicitly bind
`customDatasetVersion` and the actual `projectionIndex`/`projectionIndexETag`.
S08's verified `graphRetrieval: "index"` is not an agentic KB baseline.
S10 pins distinct basic/standard index ETags and
the canonical source hash/extraction versions. Native bindings also pin API,
Read/Layout analyzer IDs and two executed operation UUIDs; each returned document
must carry matching provenance. Both indexes expose filterable `sourceHash`
and page; layout exposes row and JSON source coordinates (native inch polygons,
or points for the explicitly custom example).
S11 needs retrievable safe `thumbnailUrl` values and a reviewed Azure Vision
1024-dimensional model/corpus binding, with server-only `STUDIO_IMAGE_ENDPOINT`
and either `STUDIO_IMAGE_API_KEY` or injected Entra auth. Binary encoding uses `2024-02-01` with model version
`2023-04-15` or `2022-04-11`; no AML adapter or caption-only image substitute is
claimed. The generator's dev/full targets
cover 40/2,000 products, 12/500 original illustrative images, 100/5,000 inventory
records, 20/1,000 orders, 40/3,000 cases, 12/200 manuals and 100/4,000 graph edges.
Use `npm run studio:generate -- --scale dev` or `--scale full`; output includes
deterministic manifests/hashes, original raster PNG illustrations, canonical
PDFs and 110 curated gold queries. Scale filler is
explicitly illustrative, not additional distinct customer evidence; embeddings
are **not generated** without a separately approved compatible model.
These are prerequisites, not
automatically provisioned resources or a substitute for live evidence.

## Downloadable root source

The UI's **Download sanitized source** link (`/download`) serves the same
`dist/source.zip` created by the build. Its explicit allowlist lives in
`scripts/source-files.mjs`. Files extract **directly into a new application
directory**, without a wrapping repository/component folder:

```powershell
Expand-Archive -LiteralPath .\foundryiq-customer-demos-source.zip -DestinationPath .\foundry-iq-explorer
Set-Location .\foundry-iq-explorer
npm ci
npm test
npm run build
npm run validate
npm start
```

Use a fresh destination, not an existing checkout/private environment. The ZIP
includes the license, contributor rules, root source, lockfile, examples and
tests; it excludes Git history, CI metadata, dependencies, build outputs,
private environments, operational state, logs and deployment files. Validation
compares its complete entry list and bytes with the allowlisted root files,
checks deterministic metadata and verifies that `/download` serves that artifact.
The public fictional corpus is included. Repository-only infrastructure,
knowledge definitions and provisioning/capture/runtime-packaging tools are not;
their tests are explicitly skipped when absent from the app-only ZIP.

## Root layout and local checks

| Surface | Responsibility |
| --- | --- |
| `page.html`, `assets/` | Compact studio comparison UI, cancellation/reset client and locally bundled product/source icons |
| `server.template.mjs`, `lib/` | Built HTTP application, strict protocol, normalization and quota coordination |
| `config/`, `samples/` | S01–S11 registry, versioned synthetic Zava fixtures/gold labels and retained bounded compatibility catalog |
| `scripts/` | Build, prebuilt startup, Node tests, fixture double and ZIP validation |
| `infra/` | Separately approved backend and additive hosting Bicep; excluded from the app source ZIP and never executed by CI |
| `dist/` | Ignored generated handler and sanitized source ZIP; never hand-edit |
| `.github/workflows/azure-static-web-apps.yml` | Build/test-only CI (historical filename), Node 22/24 and build-time Python |

CI runs `npm ci`, `npm test`, `npm run build`, and `npm run validate` with
read-only repository permissions. It has no cloud login, deployment action,
secret access, or workflow-dispatch trigger. Contributor rules are in `AGENTS.md`.
For syntax checks, run `node --check` on the `.mjs` source files and the built
handler; `server.template.mjs` intentionally contains build placeholders.

## Explicit live deployment dependencies

The accepted dedicated demo uses the identities below. They are not automatic
resource discovery or proof of another deployment's current health:

| Object | Identity |
| --- | --- |
| Resource group / App Service | `rg-foundryiq-customer-demos` / `app-foundryiq-customer-demos` |
| Search | `srch-foundryiq-customer-demos` |
| Storage / Key Vault | `stfoundryiqcustomerdemos` / `kv-fiq-customer-demos` |
| NEW Foundry parent / NEW project | `ai-foundryiq-customer-demos` / `proj-foundryiq-customer-demos` |
| Indexed KB | `foundryiq-customer-demos-indexed` |
| Indexed + Web KB | `foundryiq-customer-demos-web` |
| Shared Blob / search-index sources | `foundryiq-customer-demos-manuals` / `foundryiq-customer-demos-maintenance` |
| Additional Web source | `foundryiq-customer-demos-web-guidance` |

Both KBs share the same manuals and maintenance sources. Configure the public
maintenance index with the approved **hybrid keyword + vector** ingestion,
embedding deployment, and correct title/content/document-URL mappings. The app
does not create an index, infer vector readiness, or silently downgrade it.
Public KBs must not require document-level caller permission tokens.

Provision the Search/model/storage/monitoring dependencies and permissions only
through their separately approved owner. Scaffolding is local source, not evidence
of cloud writes. Set App Service Key Vault references for `AZURE_SEARCH_API_KEY`
and a stable random `SESSION_SECRET` of at least 32 characters. Resolve these
server-side; an unresolved Search Key Vault expression fails closed. Confirm
the actual key type accepted by Retrieve during the approved canary. Do not
place values in chat, source control, command output, or browser configuration.

The app managed identity needs secret-read access to its required Key Vault
secrets and **Storage Blob Data Contributor scoped to the isolated quota
container**, not account-wide access. Search-to-model and Search-to-corpus
identities/permissions are distinct. A Search key is not a downstream identity.

`FOUNDRY_IQ_QUOTA_CONTAINER_URL` points to an existing private `demo-quotas`
container in the demo Storage account. Its separately authorized operator must
create **one** `quotas.json` block blob before enabling live queries:

```json
{"version":1,"enabled":false,"day":"","count":0,"sessions":{},"ips":{},"slots":[]}
```

Do not recreate/reset this blob on restart, slot swap, or redeployment. The
runtime never creates a container or initializes missing/corrupt quota state.
Enable its `enabled` flag with a lease/conditional write, preserving counters,
only after operational approval. The app setting
`FOUNDRY_IQ_LIVE_ENABLED=true` is also required. Missing/unavailable coordinator
state, credentials, or dependencies fails closed.

Web domains, Web terms/costs, supported models/region, and medium-effort support
must be approved and verified. `FOUNDRY_IQ_MEDIUM_ENABLED` defaults to false.
Web input can leave Azure compliance/geographic boundaries; users must not enter
sensitive data. Web references are **service-provided cited summaries**, not
guaranteed verbatim passages. Fabric, Work IQ, remote SharePoint, OneLake, and
visitor authentication remain out of scope; older fixtures are sample-only.

## Repository-only Azure scaffolds and operator gates

These files exist only in a full checkout, not the UI's app-only source download.
The dedicated operator target is subscription
`ee787b9b-a25f-4d20-86e9-45fcea5253dd`, resource group
`rg-foundryiq-customer-demos`, region `westus2`. Always explicitly select that
subscription; never change or rely on the shared Azure CLI default.
`infra/README.md` documents new-name/ownership checks and the local-first
backend template. ARM upserts are not a new-only ownership guard.

Model hosting is a **new Microsoft Foundry resource, kind `AIServices`, with
`allowProjectManagement=true`, and a new child Foundry project**. It is not a
standalone `OpenAI`-kind account, existing-account upgrade, Azure ML hub or
separately hosted agent. Model deployments belong to the Foundry parent.
`azureOpenAIParameters`, `/openai/deployments/…` and the OpenAI-compatible
resource endpoint are model API terminology, not a different resource topology.
The local-first template includes GPT-5.1 `2025-11-13` Standard capacity 100 and
text-embedding-3-small `1` Standard capacity 20. Actual availability, capacity,
permissions and contracts must be checked, not inferred from compilation.
The operator's necessary resource/container-scoped roles are explicit;
no subscription-wide access is granted. Secret values are never in IaC.

Local operation uses a **loopback app with real Azure backends**. Public
hosting uses the separately approved additive App Service scaffold below.
Insights/Logs and other monitoring resources remain outside that bounded scope.
The illustrative **$74.98/month non-AI infrastructure scenario is not an all-in
quote or spend cap**: Search Basic is about $73.73 while provisioned, plus
assumed Storage/Vault volume. Model/embedding, extra retrieval/semantic, Web,
transfer and tax are excluded. Verify current selected-model unit prices.
Web grounding at $14/1,000 transactions can dominate costs; Retrieve can
produce multiple transactions. Quota attempts are not dollar limits.

`samples/public-corpus.json` contains **12 original MIT-licensed fictional
documents and a deterministic recipe expanding to exactly 200 records**,
with a dictionary, provenance, evaluation questions and versioned-change
instructions. These are administrative review examples, not real equipment
instructions or a safety/compliance determination. Current revision 2 keeps
P-104's reviewer acknowledgement pending while MR-0169 records owner approval;
older pending owner-approval entries remain historical. For controlled-change
acceptance, edit the matching fictional document and latest record override,
increment revisions, reingest with approval, then measure changed retrieval.
A local edit or deterministic mock does not update or prove Search grounding.
Blob references can return passage text as `sourceData.snippet`; the inspector
shows that service-returned text without inferring missing content. Private
Blob URLs still require separate authorization: the demo does not proxy or
make its private container public. The public corpus JSON includes the source
documents and record recipe, not a separate full-document endpoint per record.

All operator scripts default to **zero-cloud-call dry runs**:

```powershell
node scripts\provision-search.mjs
node scripts\capture-canary.mjs
node scripts\package-appservice.mjs
node scripts\local-live.mjs
node scripts\public-hosting.mjs
```

After explicit approval and actual backend deployment, the repository-only
local operator provides these **separate, intentional actions**:

```powershell
npm run build
node scripts\local-live.mjs --initialize
node scripts\local-live.mjs --ingest --paid-ingestion-approved --web-terms-approved
node scripts\local-live.mjs --enable-live
node scripts\local-live.mjs --capture --paid-queries-approved --web-terms-approved --output C:\approved-external-evidence\new-run
npm run start:live
```

`--initialize` verifies dedicated resource ownership, new Foundry topology and
exact models. It creates only a missing disabled ledger and only missing Vault
`search-api-key` / `session-secret` values. The existing Search primary admin
key is read in memory, never regenerated. The session secret is random and
stable. A finite 60-second bootstrap lease excludes competing initializers
within a 30-second operation budget; runtime coordination still uses 15-second
leases. Existing secrets/counters are reused, never reset. An enabled ledger
must be paused before any missing secret is initialized. Vault access or
propagation failures stop explicitly without printing service diagnostics.

`start:live` starts the **prebuilt** app on `http://127.0.0.1:3000` (optional
`PORT` or `--port`), not on the LAN. It uses an explicit tenant/subscription
`AzureCliCredential` (subscription-selected, tenant verified through ARM),
reads dedicated Vault secrets into memory and injects the
CLI-authenticated Blob coordinator. It does not load `.env.local`, write secret
files, use the developer default credential chain, or change the production
managed-identity-only `npm start` path. Local ingestion permits only that exact
explicit HTTP loopback origin; normal public ingestion still requires HTTPS.
The app-only source download intentionally excludes this operator and its
dedicated definitions. It remains a standalone replay/production application.

`node scripts\local-live.mjs --disable-live` pauses the shared switch using a
lease/ETag write, preserving counters. It requires only the owned Storage
resource, so Search, models or Vault failure cannot prevent an operator pause.
Already admitted requests may finish. Re-enabling requires the exact
knowledge-base membership and stable secrets; it does not prove grounding.
An existing knowledge-source update can return HTTP 204 with no body. The
ingestion operator reads back the owned Blob source to resolve its generated
indexer, then verifies a fresh successful indexer run before publishing the
knowledge-base definitions. Failed ingestion is not retried automatically;
inspect the partial state before repeating any paid embedding batches.

These commands are not authorization by themselves. Review the
[Web source terms and boundary notice](https://learn.microsoft.com/azure/search/agentic-knowledge-source-how-to-web)
and [Bing grounding terms](https://www.microsoft.com/en-us/bing/apis/grounding-legal-enterprise)
before passing `--web-terms-approved`. Use only public fictional questions and
the approved `osha.gov` domain; Web input leaves Azure compliance/Geo boundaries
and is not covered by the Microsoft DPA. No private content may be entered.

`provision-search.mjs` requires a separate approved execution with `--apply
--paid-ingestion-approved --web-terms-approved`. Its operator environment needs
an approved HTTPS `PUBLIC_ORIGIN` (or explicit `--local` and exact HTTP
`127.0.0.1:<port>` origin), `AZURE_SEARCH_ENDPOINT`
and `FOUNDRY_MODEL_ENDPOINT` from the new Foundry parent's verified
OpenAI-compatible resource origin, not its project URL. It uses subscription-
scoped `AzureCliCredential`, not the app's managed-identity-only runtime chain.
The operator must already have the approved data-plane permissions;
the script never grants roles, creates accounts/models or reads/writes secrets.
It verifies the AIServices parent/project, rejects unowned existing Search
objects, uses conditional ETags, uploads the twelve owned Blob documents,
embeds eight batches for the 200-record hybrid index, checks each indexing
result and Blob ingestion, and creates the two KBs/three sources. OSHA is the
restricted Web-domain target; the flag is not a substitute for actual terms,
boundary and cost review. The hosted demo's approval does not authorize another
operator or deployment. Partial execution is possible: failures stop
without retries, automatic rollback, deletion or readiness claims.
Only a missing quota blob can be conditionally initialized disabled. Existing
quota state is never reset/overwritten; its content and coordination health
still need independent acceptance.

`capture-canary.mjs` requires `--execute --paid-queries-approved
--web-terms-approved --output <new-absolute-directory-outside-repository>`,
the exact Search/quota endpoints, resolved server-only Search/session secrets
and `FOUNDRY_IQ_LIVE_ENABLED=true` **in the operator process**. The public app
can remain disabled. The shared ledger must already have been enabled by an
authorized lease/conditional write; this script never enables it. Every
indexed/Web Retrieve reserves and consumes shared quota before dispatch,
including failures/cancellations, and releases its slot conservatively.
There are no retries. It writes sanitized JSON requests, real HTTP statuses,
bodies, normalization diagnostics, elapsed time and limitations exclusively
outside the repository; existing output directories are never clobbered.
Failure, partial evidence, adapter mismatch or absent grounding stops the
sequence and retains the failed capture. Never put secrets in arguments,
chat, shell output or source. The coordinator owns producing these captures
after approval; the user is not expected to locate nonexistent captures.
Review the captures for route/output-unit/key-type compatibility and actual
both-source grounding; HTTP success alone is not acceptance.

`package-appservice.mjs --output <new-absolute-zip-outside-repository>` creates
a separate deterministic **prebuilt runtime ZIP**, using build-time Python
and already installed, lockfile-matching production dependencies. It performs
no installation/upload/deployment. Its explicit runtime boundary contains only
startup/manifests, compiled handler, the four runtime libraries, source download
and locked production packages; no private environments, infrastructure,
operator tools, captures or state. Rebuild first; deploy later only with
approval. Start with `npm start`; no Python, build or package install runs on
the host. Provisioning monitoring resources alone does not prove telemetry.

Each deployment needs its own Storage coordination/restart, public
HTTPS/no-sign-in, arbitrary/unanswerable/both-source, controlled-change and
cost/latency evidence. Keep proxy trust off without deployed-host proof.
Local protocol doubles and hand-authored fixtures are never Azure acceptance;
the accepted dedicated demo's evidence is summarized below.

## Additive public App Service hosting

`infra\hosting.bicep`, `infra\hosting-resources.bicep`, and
`infra\hosting.parameters.example.json` deploy only the new Linux Standard S1
plan `plan-foundryiq-customer-demos`, app `app-foundryiq-customer-demos`, its
settings/publishing policies, and three narrow app-managed-identity grants.
They reference the existing resource group/backends without creating,
redeploying or retagging them. **Do not run the old backend entry point for a
hosting rollout.** Never rerun initialization, ingestion or embedding batches
just to publish the app or correct citation links.

Use the allowlisted prebuilt runtime ZIP from `package-appservice.mjs` with
`az webapp deploy --type zip`, explicit subscription and the real artifact path.
Keep SCM/FTP basic publishing disabled throughout; current Azure CLI supports
Entra deployment with basic authentication off. Do not use publishing passwords
or enable basic auth as a workaround. The host runs `npm start` on
`NODE|24-lts`; remote build/Oryx stay disabled and Python is local build-only.
Take the exact HTTPS `PUBLIC_ORIGIN` from the deployed app's `defaultHostName`,
not a guessed DNS name. Preserve the existing stable versionless Vault
references, shared private ledger/counters and old backend ownership tags.

The app identity receives Secrets User only on the two existing
`search-api-key` and `session-secret` secrets, and Blob Data Contributor only
on `demo-quotas`. `liveEnabled=false` is the hosting template's default;
medium and proxy trust remain false. After approved dependency verification,
live enablement/disablement uses that template parameter, not imperative
appsettings drift. `/healthz` is liveness, never proof of Vault/Blob/model
readiness. Verify resolved references, shared coordination, anonymous HTTPS,
actual indexed/Web grounding and browser/citation behavior before publication.
Keep conservative IP grouping unless deployed-host forwarding/bypass proof
justifies trusted proxy mode.

After hosting and exact grants are ready, the repository-only public operator
verifies ownership, runtime/security, resolved Vault references, narrow grants,
owned hybrid schema and all 200 current corpus records. Its dry run makes no
Azure calls. Verification is read-only; URL updates require a distinct action
and the actual observed origin:

```powershell
node scripts\public-hosting.mjs --verify
node scripts\public-hosting.mjs --update-citation-urls --url-only-update-approved --origin https://ACTUAL-DEFAULT-HOSTNAME
```

The updater sends only `merge` records containing the key and URL. It does not
create missing records, change content/revisions/vectors, request embeddings,
invoke Retrieve, initialize secrets or touch the ledger. It checks every
per-document result and reads back all 200 protected records/URLs. Partial or
uncertain writes stop explicitly without automatic retries; inspect state
before intentionally repeating. Operator secret reads stay in memory and are
not app-MI proof by themselves. Non-retrievable vectors cannot be byte-compared;
preservation relies on the URL-only merge payload, not an invented vector
readback. This operator and infrastructure stay outside both public ZIPs.

S1 adds an illustrative **$58.40/month** at 730 hours to the previous
approximately $74.98/month backend scenario. Variable AI/Web usage,
Storage/Vault transactions, egress and taxes are additional; 1,000 attempts/day
is not a dollar cap. Stopping the app does not stop plan billing. One worker,
existing LRS and stdout-only observability are demo tradeoffs, not enterprise
HA. Private original Blob links still require access; public snippets and the
fictional corpus do not make that container public.

Rollout requires explicit resource/cost/permission and paid-canary approval,
fresh Azure template/what-if/permission checks and a validated artifact.
Respect the approved operator-attempt budget, including failures/cancellations;
do not retry Search automatically. Public live use continues under the shared
daily ceiling, not a canary lifetime limit. On failure leave live disabled or
disable it declaratively; never reset counters or rotate stable secrets.
Cleanup is separately approved and limited to exact new compute/grants:
**never delete the shared resource group or existing backends.** Git/CI
publication and aka.ms edits are separate actions, not rollout side effects.

## Pinned request and response contract

The adapter uses the published `2026-08-01-preview` REST contract:

```http
POST /knowledgebases('foundryiq-customer-demos-indexed')/retrieve?api-version=2026-08-01-preview
Content-Type: application/json
api-key: <server only>
x-ms-client-request-id: <opaque request ID>
```

Retrieve requests send **only `maxOutputSize`**, still measured in tokens.
The [knowledge-base defaults documentation](https://learn.microsoft.com/azure/search/agentic-retrieval-how-to-create-knowledge-base#configure-default-retrieve-limits-preview)
distinguishes the stored `retrieveDefaults.maxOutputSizeInTokens` property from
the request override `maxOutputSize`. The dedicated service's actual
`2026-08-01-preview` canary rejected `maxOutputSizeInTokens` as an invalid Retrieve
parameter. The app rejects that stored-property name in requests, including
when both names are supplied; it never retries using another field.
The service also rejected an output budget of 1,000 with "must be greater than
5000". Limits in the application are runtime 10-120 seconds and output
5,001-10,000 tokens; the UI and canaries default to 5,001. These are token
budgets, not promises of consumption or dollar caps.
Omitting optional fields preserves service defaults; a separate total
app budget always applies. Low effort / synthesized answer is the UI default.
Minimal effort uses one semantic intent, extractive output, and indexed sources
only; `alwaysQuerySource` is omitted because minimal searches all sources.
Other efforts use one user text message. Medium is operator-gated; automatic
effort requires the preview API and a configured KB model.

Only typed, supported fields and exact source membership are accepted. Duplicate
sources, unknown fields, mismatched kinds, unsupported effort/output combinations,
arbitrary KBs/endpoints and identity-required live fixtures are rejected. The API
accepts JSON bodies up to 64 KiB and questions up to 8,000 characters. Request
and upstream response bodies are bounded while streaming, including direct or
chunked clients. Upstream JSON is limited to 1 MiB. Cancellation and total runtime
budgets propagate to upstream reads. There are **no automatic Search retries**;
each new upstream attempt must reserve and consume another call.

Every run retains the effective normalized request, pinned version, client
request ID, sent flag and response correlation, even after controls change.
`redacted=true` explicitly marks a snapshot whose sensitive strings were removed;
otherwise its body exactly matches the normalized payload sent to Search.
References are joined by exact string reference ID and `activitySource` ID,
never by array index or numeric citation assumptions. Source data is escaped;
unsafe URL schemes/userinfo and credential/SAS query parameters are removed.
Safe original annotations are retained with explicit redaction. Returned URLs
are never fetched/proxied by this server; protected citation URLs may require
separate authorization. Missing/duplicate references, absent passages, unreported
timings and empty grounding remain visible limitations, not invented evidence.

HTTP 206 and activity errors are visibly partial, with usable evidence retained.
Malformed input, missing configuration, shared quota failures, throttling,
timeouts and upstream failures have distinct error codes. Azure HTTP status,
safe diagnostic body and request ID remain inspectable; credentials never do.
Reported activity durations are not summed; UI round trip is labeled separately.
`scripts/fixtures/published-response.json` is explicitly **hand-authored based on
published shapes**, not a capture of a real call.

## Public-use safeguards and operations

| Limit | Authoritative enforcement |
| --- | --- |
| 5 calls / rolling minute / browser session | Server-issued signed anonymous cookie + shared ledger |
| 30 calls / rolling minute / IP | Shared ledger; direct clients are counted |
| 10 global concurrent upstream calls | Shared, individually expiring reservations |
| 1,000 global calls / UTC day | Durable counter using Storage-observed UTC |
| Kill switch | App setting and shared ledger `enabled` flag |

Blob transactions acquire a finite 15-second lease, read bounded state plus ETag,
and write conditionally with **both lease ID and ETag**. Storage retries are
disabled; lock contention waits are bounded. Uncertain writes/lease release fail
closed before an upstream call. Calls are charged before dispatch, including
failed/cancelled attempts; denied calls do not increment counters. Reservations
last the total app budget plus a 30-second guard and are released on completion,
failure, or cancellation. Crashed instances recover only after expiry. No
process-memory global counters are used. A failed release is surfaced; the
reservation remains conservative until expiry.

Browser IDs are anti-abuse aids, **not authentication**. Visitors can clear
cookies; IP/global limits provide additional bounds. IPs can be shared. Quota
keys are HMAC digests, not raw IP/session identifiers, and stale rolling
buckets are pruned on the next successful transaction. Quotas limit calls, not
guaranteed monetary spend or distributed-denial-of-service exposure.

Never trust browser `Host` / `X-Forwarded-Host` as the canonical origin.
By default IP enforcement uses the socket address. Enable
`FOUNDRY_IQ_TRUST_APP_SERVICE_PROXY=true` **only after verifying** that App Service
appends a trusted client IP on the right of `X-Forwarded-For` and direct backend
access cannot bypass that hop; `WEBSITE_INSTANCE_ID` is also required. Forged
left-side entries are ignored; invalid/missing trusted metadata shares one
conservative unknown-IP bucket.

Redacted NDJSON operational events contain only request ID, mode, configured KB
ID, status/error code, elapsed round trip, safe upstream request ID/status and
reference count. Use approved App Service/Application Insights log collection to
ingest these. Do not enable verbose Azure SDK/HTTP logging, request body capture,
cookie capture, or query/answer logging in hosting diagnostics. Logs exclude
questions, answers, passages, raw errors, credentials, IPs, cookie IDs and quota
keys. Health and a disabled live switch do not prove dependency readiness.

To stop new live calls, set `FOUNDRY_IQ_LIVE_ENABLED=false` across deployment
slots, and/or conditionally set shared `quotas.json.enabled=false`. Existing
admitted calls can finish within their budget; emergency stop requires host
shutdown as a separate operator action. Do not delete/reset counters to recover
availability. Restore coordinator access and verify quotas before re-enabling.
Rotate Search credentials through Key Vault; retain a shared session secret
across app instances/deployments. Session-secret rotation invalidates browser
cookies and changes rolling digest keys: pause all live slots, stop old instances,
and wait out the one-minute rolling window before enabling the new secret.
Never reset the durable global counter or quota blob. Roll
back/redeploy a previously validated prebuilt artifact with unchanged durable
quota state and live disabled until ready. Resource cleanup requires a separate
approved ownership-limited plan.

## Validation and handoff

The built-in Node test runner covers curated replays, realistic **simulated**
indexed/Web shapes, arbitrary live input forwarding, safe annotations/citations,
negative contracts, streaming bounds, partial/errors, cancellation/timeouts,
direct clients, all quota thresholds, independent coordinators sharing lease/
ETag state, restart/overlap/expiry and fail-closed behavior. Artifact validation
checks the prebuilt handler, health route and source-ZIP allowlist. The source
ZIP includes only explicitly allowlisted reproducible code, examples, bundled
source icons and approved synthetic files; never `.env.local`, runtime state, logs,
generated deployment files, dependency trees, or symlinks. Icon provenance and
redistribution terms are in `assets/PROVENANCE.md`.

Local tests use a Storage protocol double, **not real Blob or Azure retrieval
acceptance**. New deployments still need real indexed/Web captures, Storage
coordination/restart, arbitrary and both-source questions, controlled-change
retrieval, cost/latency and anonymous HTTPS/mobile/keyboard evidence. No local
mock result substitutes for those milestones.

## Hosted demo evidence and limits

The dedicated deployment was accepted on **2026-10-19** at
**https://app-foundryiq-customer-demos.azurewebsites.net**. Its S1 App Service
uses the existing dedicated Search, project-enabled Foundry/models, Storage
and Vault resources in `rg-foundryiq-customer-demos`, `westus2`. The application
has exactly two secret-read grants and one private quota-container grant.
Entra-authorized prebuilt publication succeeded with SCM/FTP basic publishing
disabled; Python is not used at startup.

Separate live acceptance, rather than the fixtures, established:

- Real indexed grounding from both Blob and the hybrid maintenance index,
  including P-104's pending reviewer acknowledgement and the controlled
  MR-0169 owner-approval revision 2.
- Actual OSHA Web citations; the real browser Web run returned all three
  source kinds. Web evidence is labeled as cited summaries, not verbatim pages.
- An unsupported-budget question returned insufficient evidence without an
  invented amount or fabricated references.
- Anonymous browser operation, retained effective requests, citation selection,
  Tab/Enter/Escape and 1440/1000/700/390px layouts without horizontal overflow.
- Five approved public operator attempts, all HTTP 200 and non-synthetic.
  Measured round trips were approximately 4.9-58.5 seconds, not a latency SLA.
  The shared ledger advanced from the measured baseline of 1 to 6, with no
  residual slots, reset or secret rotation. Earlier real local tests separately
  exercised Blob overlap/restart; no public multi-worker test is claimed.

Sanitized actual request/response captures and deployment records are retained
privately, not committed or included in either public ZIP. The checked-in
published-response fixture remains hand-authored. Documentation updates for
this source publication do not redeploy the hosted artifact.

Live is enabled on that accepted host only. Medium and trusted-proxy mode
remain disabled. Conservative IP grouping may rate-limit different visitors
together. Private Blob originals remain private; an anonymous original-document
check returned HTTP 409. Current runtime quotas remain shared across instances:
5/browser/minute, 30/IP/minute, 10 concurrent and 1,000 attempts/UTC day.

The illustrative fixed estimates remain $58.40/month additional S1 hosting plus
the earlier approximately $74.98/month backend scenario, with variable AI/Web,
Storage/Vault operations, egress and taxes extra. Final billed cost and the
trusted-proxy contract remain unverified; the call ceiling is not a dollar cap.
One worker, LRS dependencies and stdout-only observability are demo tradeoffs,
not enterprise HA. Inherited policy-detail reads returned HTTP 403 and local
Bicep emitted provider-metadata warnings; actual Provider validation and
deployments passed without a policy bypass.

## Official evidence

- [Retrieve REST reference (both output fields and OData route)](https://learn.microsoft.com/rest/api/searchservice/knowledge-retrieval/retrieve?view=rest-searchservice-2026-08-01-preview)
- [Retrieve responses, activity, partial/error handling](https://learn.microsoft.com/azure/search/agentic-retrieval-how-to-retrieve)
- [Reasoning effort capabilities](https://learn.microsoft.com/azure/search/agentic-retrieval-how-to-set-retrieval-reasoning-effort)
- [Web cited summaries, terms and boundaries](https://learn.microsoft.com/azure/search/agentic-knowledge-source-how-to-web)
- [Node on App Service: port, dependencies and startup](https://learn.microsoft.com/azure/app-service/configure-language-nodejs)
- [Blob lease code samples and finite lease semantics](https://learn.microsoft.com/azure/storage/blobs/storage-blob-lease-javascript)
- [Managed identity / Blob client code sample](https://learn.microsoft.com/azure/app-service/tutorial-connect-app-access-storage-javascript)

Application code and original fixtures are MIT licensed. User-supplied product
artwork retains its own terms; see `assets/PROVENANCE.md`. The same local icons
identify Blob, Search index, Web, Fabric and SharePoint across the catalog,
controls, evidence, citations and activity inspector. Fabric and SharePoint
remain synthetic-only; icon support does not enable those live integrations.
