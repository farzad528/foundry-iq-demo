import { NextRequest, NextResponse } from 'next/server'
import { getFoundryBearerToken } from '@/lib/token-manager'

// Force dynamic rendering
export const dynamic = 'force-dynamic'
export const revalidate = 0

const FOUNDRY_ENDPOINT = process.env.FOUNDRY_PROJECT_ENDPOINT
const FOUNDRY_API_VERSION = process.env.FOUNDRY_API_VERSION || '2025-05-01'

// Check if Foundry is properly configured (not just set to placeholder)
function isFoundryConfigured(): boolean {
  return !!(FOUNDRY_ENDPOINT && 
           !FOUNDRY_ENDPOINT.includes('your-resource') && 
           !FOUNDRY_ENDPOINT.includes('your-project'))
}

export async function POST(request: NextRequest) {
  try {
    if (!isFoundryConfigured()) {
      const body = await request.json()
      const { input, agent } = body
      
      // In demo mode, return a mock response with demo content
      const demoResponse = {
        id: `demo-response-${Date.now()}`,
        object: 'response',
        created: Math.floor(Date.now() / 1000),
        choices: [{
          message: {
            role: 'assistant',
            content: `Hello! I'm a demo ${agent?.name || 'Foundry'} agent. This is a simulated response to: "${input}"\n\nIn a fully configured environment, I would:\n• Search through industry-specific knowledge bases\n• Retrieve relevant documents and data\n• Provide detailed, contextual answers with citations\n• Access real-time information from your connected data sources\n\nTo enable full functionality, please configure your Azure AI Foundry project endpoint and authentication credentials.`,
            tool_calls: []
          },
          index: 0,
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 100,
          total_tokens: 150
        }
      }
      
      return NextResponse.json(demoResponse)
    }

    const body = await request.json()
    const { conversation_id, input, agent } = body

    if (!conversation_id || !input || !agent) {
      return NextResponse.json(
        { error: 'conversation_id, input, and agent are required' },
        { status: 400 }
      )
    }

    const token = await getFoundryBearerToken()
    
    // Extract project endpoint for OpenAI client
    const projectEndpoint = FOUNDRY_ENDPOINT.split('/api/projects/')[0]
    
    const response = await fetch(`${projectEndpoint}/openai/responses?api-version=${FOUNDRY_API_VERSION}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation: conversation_id,
        input: input,
        extra_body: {
          agent: agent
        }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Foundry response error:', errorText)
      return NextResponse.json(
        { error: `Failed to get response: ${response.status} ${response.statusText}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error) {
    console.error('Error getting Foundry response:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}