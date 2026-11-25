# Foundry IQ Demo Studio contributor rules

## Application and scope

Foundry IQ Demo Studio is the only application in this repository: a compact S01–S11 BEFORE/AFTER retrieval comparison,
deployed to Vercel as static files plus four Search-only Functions. Azure AI Search (Foundry IQ) is the only runtime
dependency, reached with a query key. Do not add a second app, a framework, a bundler or another hosting target.

Runtime: Node.js **26** (`.nvmrc`, `engines`), ECMAScript modules, native `fetch` and browser JavaScript. There are no
runtime npm dependencies; Playwright is development-only and tests use Node's built-in runner. Match the surrounding
two-space JavaScript style and explicit imports.

## Source map

- `page.html`, `about.html`, `404.html`, `assets/`: the static UI. `assets/client.mjs` (comparison UI, industry switch,
  drawer, API log), `assets/display.mjs` (display-only text cleanup), `assets/header.mjs` (Share, settings, theme).
- `lib/vercel-app.mjs`: the API handler (`/api/scenarios`, `/api/health`, `/api/demo/prepare`, `/api/demo/run`), recorded
  Sample replay, stateless limits and the `LIVE_ENABLED` kill switch.
- `lib/search-adapter.mjs`: environment checks, attested schema metadata, the Search-only fetch guard and call budget.
- `lib/studio.mjs`: Zava scenario comparisons and Live request shapes; `lib/protocol.mjs` and `lib/normalize.mjs`: shared
  bounds, errors and redaction.
- `lib/native-graph.mjs`, `config/studio-graph.json`: native S08 entity-graph and S09 topic-graph search. GQL comes only
  from the server-side preset allowlist; never accept GQL from a request.
- `lib/industry.mjs`, `config/studio-industries.json`: industry demos (English public U.S. government corpora). Filters,
  facets, scoring profiles and S10 documents come only from the preset allowlist; never accept them from a request.
- `lib/industry-graph.mjs`, `config/studio-industry-graph.json`: industry S08/S09 on the dedicated graph service
  (`AZURE_SEARCH_GRAPH_*`). Passage and blob keys are hashed; index and storage names stay in private bindings.
- `config/studio-recorded.json`, `config/studio-notes.json`: recorded Live responses replayed as Sample, and the curated
  "Why AFTER wins" notes. `samples/`: fictional Zava documents served for citations.
- `scripts/build-vercel.mjs` (build), `scripts/serve.mjs` (local server), `scripts/validate-artifact.mjs`, the
  `scripts/*-tests.mjs` suites and `scripts/generate-studio.mjs` (Sample illustrations and test corpus).
- `dist/`: generated output; never edit or commit it.

## Commands

```powershell
npm ci
npm test
npm run build
npm run validate
npx playwright install chromium
npm run test:browser
git diff --check
```

`npm run dev` builds and serves `http://localhost:3000`. Without private build inputs the build is the **public
Sample-only app** (recorded Zava Sample in five languages, Live off, no industries); CI builds exactly this. A private
build sets `STUDIO_PRIVATE_BINDINGS`, `STUDIO_PRIVATE_ATTESTATIONS`, `STUDIO_PRIVATE_GRAPH` and, for industries,
`STUDIO_INDUSTRIES` with its private industry and graph files (see `docs/OPERATIONS.md`). Use `node --check` for changed
`.mjs` files. Keep local load light: headless Playwright and sequential runs; stop servers you start.

## Runtime invariants

- Keep Live and Sample visibly distinct. Never fall back from a Live failure to Sample. Sample replays only curated
  examples (evidence count 5 or 10) and never claims controls changed recorded results.
- Live sends only `POST` `docs/search` (and `docs/search.graph` on attested graph indexes) to the configured service with
  the server-side query key. Schema checks use the ETag-pinned attestations compiled into the private server bundle.
- No automatic retries. Preserve the 64 KiB request, 8,000-character question and 1 MiB upstream limits, per-call
  timeouts (12 s main service, 10 s graph), the 5-call comparison budget and the 55 s total budget.
- Missing or invalid variables fail closed with value-free messages. `LIVE_ENABLED`, `LIVE_DISABLED_SCENARIOS` and
  `LIVE_DISABLED_INDUSTRIES` pause Live; industry S08/S09 without the graph service show a not-configured state.
- An industry switch is atomic: the industry changes only with its catalog, and the server rejects another demo's example.
- Credentials stay server-side. Redact keys, hosts, credentialed URLs and server paths from payloads and logs; never log
  questions, answers, passages or IPs. Keep the CSP (`script-src 'self'`, no inline scripts or handlers) and security headers.
- Never invent passages, citations or timings. Display cleanup (Markdown, metadata headers, mojibake) is display-only;
  Raw hit JSON and the API log keep exact values.
- Visible copy says "Foundry IQ"; "Azure" product names stay in titles, meta tags, Technical details, the API log and
  license text.

## Approval gates

Code changes do not approve Azure or Vercel changes. Provisioning, RBAC, key creation, index changes, paid canaries,
deployments, promotions and cleanup each need explicit approval. CI is build and test only: no secrets, no Azure calls,
no deployment. Never commit private bindings, attestations, `.env*` values, Vercel files, evidence or screenshots.
Fixtures and recordings are not proof of another deployment's health. The product artwork keeps its own terms
(`assets/PROVENANCE.md`); only the app code and synthetic content are MIT licensed.
