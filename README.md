# Foundry IQ Demo Studio

See what each Foundry IQ retrieval technique changes, side by side, with real queries and citations.

**Live demo:** <https://foundry-iq-demo-studio.vercel.app/>

![Foundry IQ Demo Studio: agentic search issues its own follow-up sub-query and moves the defective-goods policy from #7 to #1; entity graph search returns relationship paths from drill to recall policy, each cited by its sources](docs/images/foundry-iq-demo-agentic-graph-search.png)

## What is Foundry IQ?

Foundry IQ (Azure AI Search) is the knowledge and retrieval layer for agents and apps built with Microsoft Foundry. It indexes your content and retrieves grounded evidence with keyword, vector, hybrid, semantic, agentic and multimodal retrieval, citing the sources it used. [Read the docs](https://learn.microsoft.com/en-us/azure/search/).

## What this demo does

- Runs one query through two retrieval setups, **BEFORE** and **AFTER**, on the same synthetic Zava Retail corpus and ranks the results side by side.
- Explains why AFTER wins for every curated example, written from the recorded Live run.
- Cites every result back to its source document, page or table row. Open a result for its fields, scores and rank change.
- Shows the exact Foundry IQ request and response for each side in the **API log**, with the service host and key hidden.
- Queries Foundry IQ from the server in **Live data** mode. **Sample** replays recorded Live responses and is always labeled.
- Works in five document languages: English, Français, Español, 日本語 and Deutsch.

## Scenarios at a glance

| | Scenario | BEFORE → AFTER |
| --- | --- | --- |
| S01 | Keyword search | App substring match → full-text search with analyzers and synonyms |
| S02 | Vector search | Keyword search → text-vector similarity |
| S03 | Hybrid search | Keyword search → hybrid search (keyword + vector), same filters |
| S04 | Semantic reranking | Hybrid order → semantic ranker order, same candidates |
| S05 | Retail search | Keyword search → hybrid search with facets, same store, stock and price filters |
| S06 | Document boosting | Hybrid search → hybrid search plus a scoring-profile boost |
| S07 | Agentic search | Single-pass hybrid retrieval → agentic retrieval (evidence only) |
| S08 | Entity graph search | Plain retrieval → native entity-graph paths, each cited by its source passages |
| S09 | Topic graph search | Topic diversification off → on, plus the corpus themes from the native topic graph |
| S10 | Content Understanding | Flattened PDF page text → table rows with cell coordinates |
| S11 | Multimodal image search | Keyword search over metadata → Azure Vision image similarity |

## Run it locally

Sample mode needs no Azure resources or credentials (Node.js 22+ and Python 3):

```bash
npm ci
PUBLIC_ORIGIN=http://localhost:3000 npm run dev
```

In PowerShell, set `$env:PUBLIC_ORIGIN = 'http://localhost:3000'` first, then run `npm run dev`. Open <http://localhost:3000>.

## Operations

Architecture, environment variables, limits, the Azure change log with rollback steps, key revocation and the validation checklist are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## License

[MIT](LICENSE). The Microsoft product artwork has separate terms; see [assets/PROVENANCE.md](assets/PROVENANCE.md).
