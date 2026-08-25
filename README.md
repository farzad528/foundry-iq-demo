

# Microsoft Foundry IQ Demo
<img width="1289" height="495" alt="image" src="https://github.com/user-attachments/assets/7ec01135-f72f-4113-aaaf-8b637fcf27b4" />

Agentic RAG demo with Foundry IQ Knowledge Bases and Microsoft Foundry Agent Service.

🚀 [Live Demo](https://azure-ai-search-knowledge-retrieval.vercel.app/)

## Deploy

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Ffarzad528%2Fazure-ai-search-knowledge-retrieval-demo%2Fmain%2Finfra%2Fmain.json)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ffarzad528%2Fazure-ai-search-knowledge-retrieval-demo)

## Quick Start

```bash
git clone https://github.com/farzad528/azure-ai-search-knowledge-retrieval-demo.git
cd azure-ai-search-knowledge-retrieval-demo
npm install
cp .env.example .env.local
# Edit .env.local with your Azure credentials
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

See `.env.example` for all options. Required:

```
AZURE_SEARCH_ENDPOINT=https://<your-search>.search.windows.net
AZURE_SEARCH_API_KEY=<admin-or-query-key>
NEXT_PUBLIC_AZURE_OPENAI_ENDPOINT=https://<your-openai>.openai.azure.com
AZURE_OPENAI_API_KEY=<openai-key>
```

## Routes

| Route | Description |
|-------|-------------|
| `/knowledge` | Manage knowledge bases and data sources |
| `/playground` | Query knowledge bases with runtime controls |
| `/agents` | Microsoft Foundry Agent Service integration (coming soon) |

## Resources

- [Foundry IQ Blog](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/foundry-iq-unlocking-ubiquitous-knowledge-for-agents/4470812)
- [Azure AI Search Docs](https://learn.microsoft.com/azure/search/)
- [Microsoft Foundry Docs](https://learn.microsoft.com/azure/ai-foundry/)
- [AGENTS.md](./AGENTS.md) – Detailed agent guidance

## License

MIT
