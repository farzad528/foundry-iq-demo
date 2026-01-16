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
      // In demo mode, return a mock conversation ID
      return NextResponse.json({
        id: `demo-conversation-${Date.now()}`,
        created_at: Date.now(),
        object: 'conversation'
      })
    }

    const token = await getFoundryBearerToken()
    
    // Use the full project endpoint - OpenAI APIs are at project level
    // Format: {project_endpoint}/openai/conversations
    const response = await fetch(`${FOUNDRY_ENDPOINT}/openai/conversations?api-version=${FOUNDRY_API_VERSION}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({})
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Foundry conversation creation error:', errorText)
      return NextResponse.json(
        { error: `Failed to create conversation: ${response.status} ${response.statusText}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error) {
    console.error('Error creating Foundry conversation:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}