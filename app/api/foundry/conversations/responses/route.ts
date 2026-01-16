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

// Fetch current agent configuration
async function getAgentConfig(agentName: string, token: string): Promise<{ toolChoice?: string, hasTools: boolean }> {
  try {
    const response = await fetch(
      `${FOUNDRY_ENDPOINT}/agents/${agentName}?api-version=${FOUNDRY_API_VERSION}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    )
    if (response.ok) {
      const data = await response.json()
      const definition = data.versions?.latest?.definition
      return {
        toolChoice: definition?.tool_choice,
        hasTools: Array.isArray(definition?.tools) && definition.tools.length > 0
      }
    }
  } catch (error) {
    console.warn('Failed to fetch agent configuration:', error)
  }
  return { hasTools: false }
}

// Determine appropriate tool_choice value
function determineToolChoice(currentToolChoice: string | undefined, hasTools: boolean): string | undefined {
  // Don't set tool_choice if agent has no tools
  if (!hasTools) {
    return undefined
  }
  
  // Always force to 'required' when agent has tools to ensure knowledge base usage
  return 'required'
}

// Log response details for debugging
function logFoundryResponse(data: any) {
  console.log('\n=== FOUNDRY RESPONSE ===')
  console.log(`ID: ${data.id} | Status: ${data.status} | Model: ${data.model}`)
  console.log(`Agent: ${data.agent?.name}:${data.agent?.version} | Tool Choice: ${data.tool_choice}`)
  console.log(`Usage: ${data.usage?.input_tokens}→${data.usage?.output_tokens} (${data.usage?.total_tokens} total)`)
  if (data.output?.length) {
    console.log(`Output: ${data.output.length} items`)
    data.output.forEach((item: any, i: number) => {
      const detail = item.type === 'mcp_call' ? ` (${item.name})` : ''
      console.log(`  [${i}] ${item.type}${detail}`)
    })
  }
  console.log('Full JSON:', JSON.stringify(data, null, 2))
  console.log('========================\n')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { conversation_id, input, agent, version } = body

    if (!conversation_id || !input || !agent) {
      return NextResponse.json(
        { error: 'conversation_id, input, and agent are required' },
        { status: 400 }
      )
    }

    if (!isFoundryConfigured()) {
      return NextResponse.json({
        id: `demo-${Date.now()}`,
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: `Demo response to: "${input}"` }]
        }],
        usage: { input_tokens: 50, output_tokens: 100, total_tokens: 150 }
      })
    }

    const token = await getFoundryBearerToken()
    const agentConfig = await getAgentConfig(agent, token)
    const toolChoice = determineToolChoice(agentConfig.toolChoice, agentConfig.hasTools)

    const requestBody: any = {
      conversation: conversation_id,
      input,
      agent: version ? { name: agent, version, type: 'agent_reference' } : { name: agent, type: 'agent_reference' }
    }
    
    if (toolChoice) {
      requestBody.tool_choice = toolChoice
    }

    const response = await fetch(
      `${FOUNDRY_ENDPOINT}/openai/responses?api-version=${FOUNDRY_API_VERSION}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Foundry API error:', response.status, errorText)
      return NextResponse.json(
        { error: `API error: ${response.status} ${response.statusText}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    logFoundryResponse(data)
    return NextResponse.json(data)

  } catch (error) {
    console.error('Error in Foundry responses API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}