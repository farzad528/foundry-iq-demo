# Foundry IQ customer demos

The approved three-column Explorer companion, isolated from the root Next.js
application. One Node/App Service host serves the UI and `/api/retrieve`; Azure
AI Search owns planning, retrieval, Web summarization, and answer synthesis.
There is no visitor sign-in, separately hosted agent, browser credential,
Cloudflare, or arbitrary endpoint/knowledge-base proxy.

**Status:** application contract tests are not live acceptance. No demo resources,
real Azure response capture, approved Web domains, measured costs/latency, or
published Azure URL are established by this source. Live queries are disabled
by default. Both indexed and indexed-plus-Web canaries and public-host acceptance
remain required before claiming compatibility or release. Keep PR #7 draft.

## Local replay and production artifact

Use Node.js **22+** (22/24 LTS compatible), npm, and Python 3. Python is used only
by the build to create the sanitized source ZIP. Build discovers `python` /
`python3`, or an explicit `PYTHON` executable; Python is not required to start.

```powershell
Set-Location explorer
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Live entries are intentionally the first catalog
group; choose an explicitly labeled **Synthetic replay** to run offline. Each
replay accepts only its curated question. Controls do not alter replay evidence,
activity, or timings. A failed live query never falls back to a replay.

```powershell
npm run build
npm test
npm run validate
npm start
```

`npm start` serves **prebuilt** `dist/server/index.mjs`, binds `0.0.0.0:$PORT`,
and does not build or invoke Python. Set `PUBLIC_ORIGIN` to the exact public
HTTPS origin in production. For App Service use startup `npm start` from the
Explorer component, not the repository root. Deployment must include this
component's scripts, `lib/`, `dist/`, `package.json`, lockfile and production
dependencies (`npm ci --omit=dev`). Build artifacts before publication.
`/healthz` checks the HTTP host without calling Search, Storage, or a model;
it is liveness, not proof of live dependency readiness.

The two added runtime dependencies are `@azure/storage-blob` for Blob lease/ETag
coordination and `@azure/identity` for deterministic managed identity credentials.
Search still uses its existing server-side API-key design. There is no
framework, frontend build dependency, test framework, or monitoring SDK addition.

## Explicit live deployment dependencies

These are **planned names**, not an inventory of existing resources:

| Object | Identity |
| --- | --- |
| Resource group / App Service | `rg-foundryiq-customer-demos` / `app-foundryiq-customer-demos` |
| Search | `srch-foundryiq-customer-demos` |
| Storage / Key Vault | `stfoundryiqcustomerdemos` / `kv-fiq-customer-demos` |
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
through their separately approved owner. No provisioning files or cloud writes
are included here. Set App Service Key Vault references for `AZURE_SEARCH_API_KEY`
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

## Pinned request and response contract

The adapter uses the published `2026-08-01-preview` REST contract:

```http
POST /knowledgebases('foundryiq-customer-demos-indexed')/retrieve?api-version=2026-08-01-preview
Content-Type: application/json
api-key: <server only>
x-ms-client-request-id: <opaque request ID>
```

The reference lists **both** `maxOutputSize` and `maxOutputSizeInTokens`.
This application deliberately retains **only `maxOutputSizeInTokens`** and labels
its control in tokens. It does not rename the field, send both, or assume the
generic field has equivalent units. A real canary must verify this choice.
Limits in the public application are runtime 10-120 seconds and output 100-10,000
tokens. Omitting optional fields preserves service defaults; a separate total
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
ZIP includes only explicitly allowlisted reproducible code, examples, neutral
icons and approved synthetic files; never `.env.local`, runtime state, logs,
generated deployment files, dependency trees, or symlinks. Icon provenance and
redistribution terms are in `assets/PROVENANCE.md`.

Local tests use a Storage protocol double, **not real Blob or Azure retrieval
acceptance**. Still required: real indexed and Web contract captures; actual
Storage coordination under overlapping deployed instances and restart; proxy
header verification; arbitrary questions; a controlled document-change retrieval;
both-source grounding; measured costs/latency; and public HTTPS/mobile/keyboard
checks without sign-in. No local mock result substitutes for these milestones.

## Official evidence

- [Retrieve REST reference (both output fields and OData route)](https://learn.microsoft.com/rest/api/searchservice/knowledge-retrieval/retrieve?view=rest-searchservice-2026-08-01-preview)
- [Retrieve responses, activity, partial/error handling](https://learn.microsoft.com/azure/search/agentic-retrieval-how-to-retrieve)
- [Reasoning effort capabilities](https://learn.microsoft.com/azure/search/agentic-retrieval-how-to-set-retrieval-reasoning-effort)
- [Web cited summaries, terms and boundaries](https://learn.microsoft.com/azure/search/agentic-knowledge-source-how-to-web)
- [Node on App Service: port, dependencies and startup](https://learn.microsoft.com/azure/app-service/configure-language-nodejs)
- [Blob lease code samples and finite lease semantics](https://learn.microsoft.com/azure/storage/blobs/storage-blob-lease-javascript)
- [Managed identity / Blob client code sample](https://learn.microsoft.com/azure/app-service/tutorial-connect-app-access-storage-javascript)

MIT licensed. No official product logos are redistributed.
