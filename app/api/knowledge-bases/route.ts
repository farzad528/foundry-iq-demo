import { NextResponse } from 'next/server'

// Force dynamic rendering - this route always needs fresh data
export const dynamic = 'force-dynamic'
export const revalidate = 0

const ENDPOINT = process.env.AZURE_SEARCH_ENDPOINT
const API_KEY = process.env.AZURE_SEARCH_API_KEY
const API_VERSION = process.env.AZURE_SEARCH_API_VERSION

// Demo knowledge bases for when Azure Search is not configured
const DEMO_KNOWLEDGE_BASES = {
  value: [
    {
      name: 'manufacturing-knowledge-base',
      description: 'Comprehensive manufacturing knowledge including equipment manuals, P&IDs, SOPs, safety documentation, and maintenance procedures.',
      retrievalInstructions: 'Focus on safety protocols and detailed technical specifications when answering manufacturing questions.',
      models: [{ azureOpenAIParameters: { modelName: 'gpt-4o' } }],
      knowledgeSources: [
        { name: 'Equipment Manuals', kind: 'azureBlob' },
        { name: 'Process & Instrumentation Diagrams (P&IDs)', kind: 'azureBlob' },
        { name: 'Standard Operating Procedures', kind: 'searchIndex' },
        { name: 'Safety Documentation', kind: 'web' }
      ],
      outputMode: 'answerSynthesis',
      retrievalReasoningEffort: { kind: 'medium' },
      '@odata.etag': '"demo-etag-manufacturing"'
    },
    {
      name: 'healthcare-knowledge-base',
      description: 'Healthcare and life sciences knowledge base containing clinical trial protocols, FDA filings, research papers, and treatment guidelines.',
      retrievalInstructions: 'Provide evidence-based medical information with appropriate disclaimers about professional medical advice.',
      models: [{ azureOpenAIParameters: { modelName: 'gpt-4o' } }],
      knowledgeSources: [
        { name: 'Clinical Trial Protocols', kind: 'azureBlob' },
        { name: 'FDA Regulatory Filings', kind: 'searchIndex' },
        { name: 'Medical Research Papers', kind: 'web' },
        { name: 'Treatment Guidelines', kind: 'remoteSharePoint' }
      ],
      outputMode: 'answerSynthesis',
      retrievalReasoningEffort: { kind: 'high' },
      '@odata.etag': '"demo-etag-healthcare"'
    },
    {
      name: 'financial-knowledge-base',
      description: 'Financial services knowledge base with 10-Ks, 10-Qs, earnings reports, market research, and regulatory compliance documentation.',
      retrievalInstructions: 'Analyze financial data thoroughly and provide insights with appropriate risk disclaimers.',
      models: [{ azureOpenAIParameters: { modelName: 'gpt-4o' } }],
      knowledgeSources: [
        { name: '10-K Annual Reports', kind: 'azureBlob' },
        { name: '10-Q Quarterly Reports', kind: 'azureBlob' },
        { name: 'Earnings Call Transcripts', kind: 'searchIndex' },
        { name: 'Market Research Reports', kind: 'web' },
        { name: 'Regulatory Compliance Documents', kind: 'indexedSharePoint' }
      ],
      outputMode: 'answerSynthesis',
      retrievalReasoningEffort: { kind: 'high' },
      '@odata.etag': '"demo-etag-financial"'
    },
    {
      name: 'zava-knowledge-base',
      description: 'Retail and events knowledge base covering marathon event data, popup safety guidelines, store operations, and supply chain logistics.',
      retrievalInstructions: 'Focus on operational excellence and customer safety in retail and event management contexts.',
      models: [{ azureOpenAIParameters: { modelName: 'gpt-4o' } }],
      knowledgeSources: [
        { name: 'Marathon Event Documentation', kind: 'azureBlob' },
        { name: 'Popup Safety Guidelines', kind: 'searchIndex' },
        { name: 'Store Operations Manual', kind: 'remoteSharePoint' },
        { name: 'Supply Chain Logistics', kind: 'indexedOneLake' }
      ],
      outputMode: 'answerSynthesis',
      retrievalReasoningEffort: { kind: 'medium' },
      '@odata.etag': '"demo-etag-zava"'
    }
  ]
}

export async function GET() {
  try {
    // Check if Azure Search is properly configured (not just set to placeholder)
    if (!ENDPOINT || !API_KEY || !API_VERSION ||
        ENDPOINT.includes('your-search-resource') ||
        API_KEY === 'your-azure-search-admin-or-query-key') {
      console.error('Missing or placeholder environment variables:', {
        hasEndpoint: !!ENDPOINT,
        hasApiKey: !!API_KEY,
        hasApiVersion: !!API_VERSION
      })
      // Return demo knowledge bases when Search is not configured
      return NextResponse.json(DEMO_KNOWLEDGE_BASES)
    }

    const url = `${ENDPOINT}/knowledgebases?api-version=${API_VERSION}`
    console.log('Fetching knowledge bases from:', url.replace(API_KEY, '***'))

    const response = await fetch(url, {
      headers: {
        'api-key': API_KEY,
        'Cache-Control': 'no-cache'
      },
      cache: 'no-store'
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Knowledge bases API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      })
      // Return empty array when API fails to allow UI to function
      return NextResponse.json({ value: [] })
    }

    const data = await response.json()

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
  } catch (error) {
    console.error('Knowledge bases API error:', error)
    // Return empty array instead of error to allow UI to function gracefully
    return NextResponse.json({ value: [] })
  }
}
