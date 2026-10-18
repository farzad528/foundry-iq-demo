# Foundry IQ Explorer

A forkable, inspectable knowledge-base retrieval playground. Choose a scenario, ask the curated question, and inspect cited passages, raw sources, activity records, and request/response JSON. No Foundry Agent Service or external answer-generation call is used.

## Run locally

Requires Node.js 22+ and Python 3 (used only to package the downloadable source ZIP). No npm dependencies.

```bash
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Synthetic replays work immediately without credentials. Settings are displayed in the request inspector, but do not alter the fixed sample replay. Custom questions require live retrieval. A replay is always labeled synthetic.

## Connect live retrieval

1. Provision an Azure AI Search service, model deployment, knowledge sources and knowledge base separately. This template does not provision Azure resources.
2. Set `AZURE_SEARCH_ENDPOINT` and `AZURE_SEARCH_API_KEY` on the server. Never place keys in browser code, the scenario manifest, GitHub, or a GitHub Pages site.
3. Set `FOUNDRY_IQ_KB_MAP` to a JSON object mapping scenario IDs to deployed knowledge-base names.
4. Edit `config/scenarios.json` to match your actual knowledge-source names, kinds, descriptions, and openly shareable source URLs. The built-in raw sources are synthetic examples; upload them to Blob/indexed sources if you want the same questions to work live. For live use, these manifests must accurately describe your deployed resources.
5. Configure source-to-model credentials and permissions on the Azure side. The app key authenticates the Search retrieval request, not all downstream systems.
6. Restart/rebuild and select Live knowledge base.

Example server environment:

```dotenv
AZURE_SEARCH_ENDPOINT=https://your-service.search.windows.net
AZURE_SEARCH_API_KEY=<server-side-key>
FOUNDRY_IQ_KB_MAP={"manufacturing":"manufacturing-kb"}
GITHUB_REPOSITORY_URL=https://github.com/your-account/your-repo
```

The server calls `POST /knowledgebases/{name}/retrieve?api-version=2026-08-01-preview`. The request exposes reasoning effort, output mode, runtime budget, output-token budget, source-data inclusion and always-query settings. Minimal effort uses semantic intents and extractive output. Activity collection is enabled. Only the server-configured endpoint, mapped knowledge bases, and manifest-listed sources can be queried. Unrecognized request fields are not forwarded.

The knowledge base handles model query planning and answer synthesis. The browser renders service text, references and activity records; it does not invent missing service diagnostics. Activity timings may overlap and are not summed. Reference links are restricted to HTTP(S), and service text is escaped before rendering.

## Source authentication and Fabric

| Source | Key-only app experience |
| --- | --- |
| Indexed Blob / search index | Supported when the deployed sources do not require caller identity |
| Indexed SharePoint / OneLake | Requires separate ingestion configuration and source-side permissions; assess ACL requirements before anonymous use |
| Remote SharePoint | Requires end-user authorization; synthetic replay only in this adapter |
| Fabric Data Agent / ontology | Requires end-user authorization; synthetic replay only in this adapter |

A Search API key does not replace the `x-ms-query-source-authorization` end-user token for remote Fabric/SharePoint sources. This implementation deliberately blocks the live Fabric scenario rather than bypassing that requirement. A public demo must use only content you intend every visitor to access.

Fabric sample SQL is an authored illustrative example. It is not claimed to be captured service SQL. Live Fabric retrieval can return `fabricAnswer` and `fabricEmbeddedResources`; generated SQL is not guaranteed in retrieval diagnostics. The full source annotation remains inspectable.

## Customize

- `page.html`: responsive application, controls, evidence inspector and styling.
- `config/scenarios.json`: scenario manifests, curated questions and synthetic fixtures.
- `samples/`: openly inspectable synthetic raw files.
- `server.template.mjs`: server-only adapter, validation and Azure request.
- `scripts/build.mjs`: produces a self-contained Worker plus downloadable source ZIP.
- `scripts/dev.mjs`: dependency-free local Node server.

Update the repository URL environment variable to point at the deployed source repository. The default GitHub link points to Farzad's original demo; this version is a standalone companion implementation. It can live in `explorer/` in that repository without changing the existing Next.js app.

## Build and host

```bash
npm run build
npm test
```

Deploy `dist/server/index.js` as an ESM Cloudflare Worker and configure runtime secrets with your host. The Sites build also includes `.openai/hosting.json`. For another Worker host, use the entrypoint directly and omit Sites metadata. For Azure App Service or another Node host, run `npm run dev` with runtime environment variables. GitHub hosts the source; GitHub Pages alone cannot run the API-key backend.

This initial private preview has no configured Azure credentials and no live Azure verification. Before enabling an anonymous production endpoint, configure rate limits and spending controls at your hosting boundary. No visitor login is required by the application code; the initial Sites preview is owner-private.

## Verification

`npm test` verifies all synthetic scenarios, endpoint restrictions, validation, missing credentials, the live adapter with a stubbed Azure response, and the downloadable source archive. Browser visual QA was unavailable in the authoring environment.

## API references

- https://learn.microsoft.com/azure/search/agentic-retrieval-how-to-retrieve
- https://learn.microsoft.com/azure/search/agentic-retrieval-how-to-set-retrieval-reasoning-effort
- https://learn.microsoft.com/azure/search/agentic-knowledge-source-how-to-fabric-data-agent
- https://learn.microsoft.com/azure/search/agentic-knowledge-source-how-to-sharepoint-remote

MIT licensed.
