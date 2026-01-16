import { NextRequest, NextResponse } from 'next/server'
import { getFoundryBearerToken } from '@/lib/token-manager'

// Force dynamic rendering
export const dynamic = 'force-dynamic'
export const revalidate = 0

const FOUNDRY_ENDPOINT = process.env.FOUNDRY_PROJECT_ENDPOINT
const FOUNDRY_API_VERSION = process.env.FOUNDRY_API_VERSION || '2025-11-15-preview'

// Create a thread for agent conversation
export async function POST(
  request: NextRequest,
  { params }: { params: { agentId: string } }
) {
  try {
    const { agentId } = params

    if (!FOUNDRY_ENDPOINT) {
      return NextResponse.json(
        { error: 'FOUNDRY_PROJECT_ENDPOINT not configured' },
        { status: 500 }
      )
    }

    const token = await getFoundryBearerToken()

    // Create thread: POST {project_endpoint}/agents/{agent_name}/threads?api-version={version}
    const url = `${FOUNDRY_ENDPOINT}/agents/${agentId}/threads?api-version=${FOUNDRY_API_VERSION}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({})
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Foundry thread creation error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        url,
        agentId
      })
      return NextResponse.json(
        { error: `Thread creation error: ${response.status} ${response.statusText}`, details: errorText },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error) {
    console.error('Error creating Foundry thread:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
