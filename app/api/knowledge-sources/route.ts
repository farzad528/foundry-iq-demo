import { NextRequest, NextResponse } from 'next/server'

// Force dynamic rendering - this route always needs fresh data
export const dynamic = 'force-dynamic'
export const revalidate = 0

const ENDPOINT = process.env.AZURE_SEARCH_ENDPOINT
const API_KEY = process.env.AZURE_SEARCH_API_KEY
const API_VERSION = process.env.AZURE_SEARCH_API_VERSION

// Demo knowledge sources for when Azure Search is not configured
const DEMO_KNOWLEDGE_SOURCES = {
  value: [
    { name: 'Equipment Manuals', kind: 'azureBlob' },
    { name: 'Process & Instrumentation Diagrams (P&IDs)', kind: 'azureBlob' },
    { name: 'Standard Operating Procedures', kind: 'searchIndex' },
    { name: 'Safety Documentation', kind: 'web' },
    { name: 'Clinical Trial Protocols', kind: 'azureBlob' },
    { name: 'FDA Regulatory Filings', kind: 'searchIndex' },
    { name: 'Medical Research Papers', kind: 'web' },
    { name: 'Treatment Guidelines', kind: 'remoteSharePoint' },
    { name: '10-K Annual Reports', kind: 'azureBlob' },
    { name: '10-Q Quarterly Reports', kind: 'azureBlob' },
    { name: 'Earnings Call Transcripts', kind: 'searchIndex' },
    { name: 'Market Research Reports', kind: 'web' },
    { name: 'Regulatory Compliance Documents', kind: 'indexedSharePoint' },
    { name: 'Marathon Event Documentation', kind: 'azureBlob' },
    { name: 'Popup Safety Guidelines', kind: 'searchIndex' },
    { name: 'Store Operations Manual', kind: 'remoteSharePoint' },
    { name: 'Supply Chain Logistics', kind: 'indexedOneLake' }
  ]
}

export async function GET() {
  try {
    // Check if Azure Search is properly configured (not just set to placeholder)
    if (!ENDPOINT || !API_KEY || !API_VERSION ||
        ENDPOINT.includes('your-search-resource') ||
        API_KEY === 'your-azure-search-admin-or-query-key') {
      // Return demo knowledge sources when Azure Search is not configured
      return NextResponse.json(DEMO_KNOWLEDGE_SOURCES)
    }

    const response = await fetch(
      `${ENDPOINT}/knowledgesources?api-version=${API_VERSION}`,
      {
        headers: {
          'api-key': API_KEY,
          'Cache-Control': 'no-cache'
        },
        cache: 'no-store'
      }
    )

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch knowledge sources' },
        { status: response.status }
      )
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
    console.error('Knowledge sources API error:', error)
    // Return demo knowledge sources when error occurs to allow UI to function
    return NextResponse.json(DEMO_KNOWLEDGE_SOURCES)
  }
}

export async function PUT(req: NextRequest) {
  try {
    if (!ENDPOINT || !API_KEY || !API_VERSION) {
      return NextResponse.json(
        { error: 'Azure Search configuration missing' },
        { status: 500 }
      )
    }

    const body = await req.json()
    const sourceName = body.name

    const response = await fetch(
      `${ENDPOINT}/knowledgesources/${sourceName}?api-version=${API_VERSION}`,
      {
        method: 'PUT',
        headers: {
          'api-key': API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    )

    if (!response.ok) {
      const errorData = await response.json()
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to create knowledge source' },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Knowledge source creation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}