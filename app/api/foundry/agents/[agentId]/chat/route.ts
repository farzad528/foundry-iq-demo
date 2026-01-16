import { NextRequest, NextResponse } from 'next/server'
import { getFoundryBearerToken } from '@/lib/token-manager'

// Force dynamic rendering
export const dynamic = 'force-dynamic'
export const revalidate = 0

const FOUNDRY_ENDPOINT = process.env.FOUNDRY_PROJECT_ENDPOINT
const FOUNDRY_API_VERSION = process.env.FOUNDRY_API_VERSION || '2025-11-15-preview'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string | Array<{ type: string; text?: string; image?: any }>
}

export async function POST(
  request: NextRequest,
  { params }: { params: { agentId: string } }
) {
  try {
    const { agentId } = params
    const body = await request.json()
    const { messages, stream = false, conversation_id } = body

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'messages array is required' },
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
    
    // Extract project endpoint for OpenAI client
    const projectEndpoint = FOUNDRY_ENDPOINT.split('/api/projects/')[0]

    // Use OpenAI-compatible API with agent specified in extra_body
    // This is the correct way to call Foundry agents with MCP tools
    const url = `${projectEndpoint}/openai/chat/completions?api-version=${FOUNDRY_API_VERSION}`

    const requestBody: any = {
      messages,
      stream,
      extra_body: {
        agent: agentId
      }
    }

    // Add conversation ID if provided for multi-turn conversations
    if (conversation_id) {
      requestBody.extra_body.conversation = conversation_id
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Foundry agent chat error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        url,
        agentId
      })
      return NextResponse.json(
        { error: `Agent API error: ${response.status} ${response.statusText}`, details: errorText },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error) {
    console.error('Error calling Foundry agent:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
