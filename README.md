# Foundry IQ Explorer

The three-column Explorer is this repository's primary **root application**.
It replaces the legacy Next.js application; no companion directory or frontend
framework build is required. One Node host serves the UI and `/api/retrieve`; Azure
AI Search owns planning, retrieval, Web summarization, and answer synthesis.
There is no visitor sign-in, separately hosted agent, browser credential,
Cloudflare, or arbitrary endpoint/knowledge-base proxy.

**Hosted demo:** [Foundry IQ Explorer](https://app-foundryiq-customer-demos.azurewebsites.net)
passed separately approved anonymous public-demo acceptance on **2026-10-19**,
including real indexed and Web retrieval. See [deployment evidence and limits](#hosted-demo-evidence-and-limits).
This is a deployment-specific snapshot, not an uptime guarantee or evidence that
a fresh checkout is configured. Live queries remain **disabled by default** in
source and example parameters. Publishing or merging source does not authorize
provisioning, paid canaries, uploads, or deployment; CI is build/test only.

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

Open `http://localhost:3000`. Live entries are intentionally the first catalog
group; choose an explicitly labeled **Synthetic replay** to run offline. Each
replay accepts only its curated question. Controls do not alter replay evidence,
activity, or timings. A failed live query never falls back to a replay.
No environment file is required for offline replay. `.env.example` documents
optional local settings and fixed, non-secret resource names; it does not
discover resources. If needed, copy it to `.env.local` **only if that file does not already
exist**. Existing private environments are not migrated, overwritten, or uploaded.
Review legacy local settings privately rather than reusing them automatically.

```powershell
npm test
npm run build
npm run validate
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

The two added runtime dependencies are `@azure/storage-blob` for Blob lease/ETag
coordination and `@azure/identity` for deterministic managed identity credentials.
Search still uses its existing server-side API-key design. There is no
framework, frontend build dependency, external test framework, or monitoring SDK.

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
| `page.html`, `assets/` | Local three-column UI, client code and bundled product/source icons |
| `server.template.mjs`, `lib/` | Built HTTP application, strict protocol, normalization and quota coordination |
| `config/`, `samples/` | Explicit live catalog and clearly labeled fixed synthetic replays |
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
