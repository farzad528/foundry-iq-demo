# Foundry IQ Explorer contributor rules

## Application and scope

Foundry IQ Explorer is the primary application at the repository root. The
legacy Next.js/React app and its deployment templates have been retired, not
retained as an alternate app. Preserve Git history; do not resurrect a second
application or add a component wrapper directory.

Runtime: Node.js **22+**, ECMAScript modules, native HTTP and browser JavaScript.
Python **3** is build-time only, for a deterministic sanitized source ZIP.
Dependencies: `@azure/identity` and `@azure/storage-blob`. Use the npm lockfile.
No frontend framework, TypeScript compiler, external test runner or bundler is
required. Match surrounding two-space JavaScript style and explicit imports.

## Source map

- `page.html`, `assets/client.mjs`, `assets/request.mjs`, `assets/source-icons.mjs`:
  chat playground, on-demand settings/evidence dialogs, request/code helpers,
  keyboard/citation interactions and locally bundled source icons.
- `server.template.mjs`: application handler template. Build embeds only the
  approved live-only catalog, source ZIP and local public assets. Test fixtures
  are never embedded as executable replay responses.
- `lib/protocol.mjs`: pinned contract, capability validation and streaming bounds.
- `lib/normalize.mjs`: evidence/citation joins, safe URLs and redaction.
- `lib/quota.mjs`: managed-identity Blob leases/ETags and durable shared limits.
- `lib/http.mjs`: Node bridge, bounded direct clients and cancellation.
- `lib/report-pages.mjs`: exact original-page provenance and bounded, keyless
  private-Blob PNG reads; no arbitrary URL proxy or image interpretation.
- `config/`: four explicit Zava KB/source identities and tests-only fixtures;
  protected legacy identities are exported only for repository operators.
- `samples/`: fictional, public example documents, never real customer content.
- `scripts/`: build/dev/start, Node tests, Storage double, ZIP allowlist and
  artifact validation. `scripts/fixtures/published-response.json` is hand-authored
  from published shapes, **not a real Azure capture**.
- `dist/`: ignored generated artifacts; never edit or commit manually.
- `.github/workflows/azure-static-web-apps.yml`: historical filename for
  **build/test-only** CI on Node 22/24; no deployment, cloud login or secrets.

## Local development and required validation

Run from the repository root (or the root of a newly extracted source ZIP):

```powershell
npm ci
npm test
npm run build
npm run validate
git diff --check
```

`npm test` first builds, then uses Node's built-in test runner for contract,
normalization, quotas, cancellation, HTTP and root-migration regressions.
Python is required for build and artifact validation, not startup.
Use `node --check` for changed `.mjs` source files and the generated handler.
The handler template intentionally contains build placeholders.

`npm run dev` builds once and starts the app; restart after source changes.
`npm start` starts only prebuilt `dist/server/index.mjs`, without build/Python.
It binds `0.0.0.0:$PORT` (default 3000). For local UI inspection, set
`PUBLIC_ORIGIN=http://localhost:3000` or the exact local port.
No credentials are needed to inspect UI/code. Retrieval is live-only and stays
paused without configured backends; there is no offline answer mode.
Never overwrite an existing `.env.local`; use `.env.example` only as an optional
template. Existing private environments and ignored artifacts must stay private.

Full-repository local live operation uses `npm run start:live` after separately
approved backend setup. `scripts/local-live.mjs` binds only `127.0.0.1`, uses
subscription-selected `AzureCliCredential` with ARM tenant verification, resolves dedicated Vault
secrets in memory and injects shared Blob coordination. It never loads private
env files or adds a developer-auth fallback to production. This operator and
`config/knowledge-definitions.json` remain outside the app-only source ZIP.
Operator initialization is explicit, create-if-missing only, and never resets
ledger state or replaces an existing session secret.
Inject the Blob coordinator from the same prebuilt module tree as the handler;
mixing source and built error classes turns expected quota 429/503 responses
into generic 500 errors.

Smoke `/healthz`, `/api/config`, `/`, local assets and `/download` with **live
disabled**; verify replay rejection without an Azure call. Verify keyboard tabs,
citation focus, retained requests and responsive layout when a browser is
available. Stop temporary processes by their exact tracked PID/tool handle.
Local tests and Storage doubles do not establish live dependency readiness.

## Non-negotiable runtime invariants

- The public catalog/API are live-only. Reject every replay mode and retired
  replay identity before quota reservation. Keep fixtures/doubles for tests,
  never as demo responses or fallbacks.
- Retain the pinned published preview request contract and typed capability
  checks, exact KB/source allowlists, indexed-only minimal/extractive rules,
  operator-gated medium effort, and optional request-level `maxOutputSize` in
  tokens. `maxOutputSizeInTokens` is a stored KB default, not a Retrieve field.
- All runtime and per-source overrides start unset (Service default), including
  reasoning effort, output, limits, diagnostics and source flags. Omit unset
  fields; never equate an explicit `auto` effort with Service default.
- Live follow-ups retain alternating user/assistant text messages within the
  existing request bounds. No system/tool roles or silent history truncation.
  Changing KB clears the chat and overrides; new chat clears only history.
  Minimal uses one intent without history.
  Code views use immutable per-turn effective snapshots and server-credential
  placeholders, never reveal secrets or claim unconfirmed dispatch was not sent.
- Preserve 64-KiB request, 8,000-character question and 1-MiB upstream limits,
  streaming byte enforcement, cancellation and total runtime budgets.
- Never add automatic Search retries. Every upstream attempt consumes quota.
- Preserve shared durable Blob coordination: finite leases, ETag plus lease-ID
  conditional writes, bounded contention, no Storage retries, uncertain-write
  fail-closed behavior, conservative expiring reservations and both kill switches.
  Never initialize/reset the container, quota blob or counters automatically.
- Enforce 5 calls/session/minute, 30/IP/minute, 10 concurrent and 1,000/day.
  Anonymous signed cookies are anti-abuse aids, not visitor authentication.
- Keep immutable effective-request snapshots, explicit redaction, exact string
  reference/activity-ID joins, safe source links, visible partial/errors and
  absent/missing evidence. Never invent passages, citations or timings.
- Credentials remain server-side. Preserve canonical-origin checks, trusted
  proxy gates, security headers and allowlisted redacted telemetry. Never log
  questions, answers, passages, cookies, IPs, quota keys or raw diagnostics.
- Build the source ZIP solely from `scripts/source-files.mjs`; update validation
  and regression coverage with allowlist changes. Exclude secrets, state, logs,
  symlinks, generated output, Git/CI metadata and deployment/IaC artifacts.
  Extraction must reproduce a standalone root application, not a nested app.
- Never package the supplied report PDF, extracted report text, PNG pages,
  manifests or cloud receipts. Original fictional Zava Markdown is public.
  Report page previews may use only exact trusted Blob identities, never guessed
  citation IDs/titles/page numbers. Page browsing is not grounding evidence.

## Approval gates and limitations

Source replacement does **not** approve Azure discovery, provisioning, RBAC,
key/secret creation, uploads, paid retrieval/canaries, deployment or cleanup.
No deployment workflow, `azure.yaml`, IaC or deployment scaffolding may be added
without separate explicit resource/cost approval. No GitHub writes, commits,
pushes, PR changes, branch changes or history rewriting without authorization.
Use the repository's normal reviewed pull-request flow for authorized
publication; never bypass branch protection or change repository settings.

Live is OFF by default. Resource names are not automatic inventory or proof of
another deployment's health. Each rollout needs real retrieval/citation
evidence for every enabled KB and source family, Blob coordination/restart,
unrelated questions, cost/latency and anonymous HTTPS/mobile/keyboard evidence.
Multi-source and controlled-change claims need their own evidence. Web canaries
apply only to explicitly approved Web integration. The dedicated hosted demo's
accepted scope and remaining limits are documented in `README.md`; that
acceptance does not authorize another rollout or establish its proxy contract
or billed cost. Do not treat fixtures as real captures.
Web approval, terms, domains and boundary/cost review are separate gates.
Visitor auth, Fabric, Work IQ, remote SharePoint and OneLake live integration
remain out of scope. MCP, SQL, File and Fabric ontology logos likewise describe
source families, not provisioned connectors or fabricated activity. All four
Zava KBs use actual Blob sources. Preserve the supplied SVGs' shapes,
colors, aspect ratios and separate artwork terms in `assets/PROVENANCE.md`.
Only the original neutral `source.svg` fallback is covered by the app's MIT
license; do not claim that license covers product artwork.

Make precise changes, add focused regression tests and update directly related
source documentation. Do not read/expose credentials, touch another worktree,
delete untracked/ignored user data, alter onboarding artifacts, or edit Git
internals. Clean up only your own bounded helper files/processes. Preserve
private environment files and Git history even during a full app replacement.
