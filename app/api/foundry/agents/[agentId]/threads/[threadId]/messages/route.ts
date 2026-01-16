import { NextRequest, NextResponse } from 'next/server'
import { getFoundryBearerToken } from '@/lib/token-manager'

// Force dynamic rendering
export const dynamic = 'force-dynamic'
export const revalidate = 0

const FOUNDRY_ENDPOINT = process.env.FOUNDRY_PROJECT_ENDPOINT
const FOUNDRY_API_VERSION = process.env.FOUNDRY_API_VERSION || '2025-11-15-preview'

// Add a message to a thread
export async function POST(
  request: NextRequest,
  { params }: { params: { agentId: string; threadId: string } }
) {
  try {
    const { agentId, threadId } = params
    const body = await request.json()
    const { role, content } = body

    if (!role || !content) {
      return NextResponse.json(
        { error: 'role and content are required' },
        { status: 400 }
      )
    }

    if (!FOUNDRY_ENDPOINT) {
      return NextResponse.json(
        { error: 'FOUNDRY_PROJECT_ENDPOINT not configured' },
        { status: 500 }
      )
    }

    const token = await getFoundryBearerToken()

    // Add message: POST {project_endpoint}/agents/{agent_name}/threads/{thread_id}/messages?api-version={version}
    const url = `${FOUNDRY_ENDPOINT}/agents/${agentId}/threads/${threadId}/messages?api-version=${FOUNDRY_API_VERSION}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role,
        content
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Foundry message creation error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        url
      })
      return NextResponse.json(
        { error: `Message creation error: ${response.status} ${response.statusText}`, details: errorText },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error) {
    console.error('Error creating message:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

// Get messages from a thread
export async function GET(
  request: NextRequest,
  { params }: { params: { agentId: string; threadId: string } }
) {
  try {
    const { agentId, threadId } = params

    if (!FOUNDRY_ENDPOINT) {
      return NextResponse.json(
        { error: 'FOUNDRY_PROJECT_ENDPOINT not configured' },
        { status: 500 }
      )
    }

    const token = await getFoundryBearerToken()

    // Get messages: GET {project_endpoint}/agents/{agent_name}/threads/{thread_id}/messages?api-version={version}
    const url = `${FOUNDRY_ENDPOINT}/agents/${agentId}/threads/${threadId}/messages?api-version=${FOUNDRY_API_VERSION}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Foundry get messages error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        url
      })
      return NextResponse.json(
        { error: `Get messages error: ${response.status} ${response.statusText}`, details: errorText },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error) {
    console.error('Error getting messages:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
