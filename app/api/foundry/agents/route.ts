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

interface ProjectConnection {
  name: string
  type: string
  properties: {
    authType: string
    category: string
    target: string
    isSharedToAll: boolean
    audience: string
    metadata: {
      ApiType: string
    }
  }
}

// Helper function to check if agent has knowledge base MCP endpoint
function hasKnowledgeBaseMCP(agent: any): boolean {
  // Check for tools in multiple possible locations (including versions.latest.definition.tools)
  const tools = agent.versions?.latest?.definition?.tools || 
                agent.definition?.tools || 
                agent.tools || []
  const mcpPattern = /\/knowledgebases\/[^/]+\/mcp\?api-version=/i
  
  return tools.some((tool: any) => {
    if (tool.type === 'mcp' && tool.server_url) {
      return mcpPattern.test(tool.server_url)
    }
    return false
  })
}

// Helper function to extract knowledge base names from MCP endpoints
function extractKnowledgeBases(agent: any): string[] {
  // Check for tools in multiple possible locations (including versions.latest.definition.tools)
  const tools = agent.versions?.latest?.definition?.tools || 
                agent.definition?.tools || 
                agent.tools || []
  const kbNames: string[] = []
  const mcpPattern = /\/knowledgebases\/([^/]+)\/mcp\?api-version=/i
  
  tools.forEach((tool: any) => {
    if (tool.type === 'mcp' && tool.server_url) {
      const match = tool.server_url.match(mcpPattern)
      if (match && match[1]) {
        kbNames.push(match[1])
      }
    }
  })
  
  return kbNames
}

export async function GET() {
  try {
    if (!isFoundryConfigured()) {
      // Return empty array when Foundry is not configured
      return NextResponse.json({ agents: [] })
    }

    let token
    try {
      token = await getFoundryBearerToken()
    } catch (authError) {
      console.error('Authentication failed:', authError)
      // Return empty array when authentication fails to allow UI to function
      return NextResponse.json({ agents: [] })
    }
    
    const apiUrl = `${FOUNDRY_ENDPOINT}/agents?api-version=${FOUNDRY_API_VERSION}`
    
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store'
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Foundry API error:', response.status, errorText)
      // Return empty array instead of error to allow UI to function
      return NextResponse.json({ agents: [] })
    }

    const data = await response.json()
    
    // Foundry API returns agents in data.data, not data.value
    const allAgents = data.data || data.value || []
    
    // Filter agents that have knowledge base MCP endpoints
    const agentsWithKnowledge = allAgents.filter((agent: any) => hasKnowledgeBaseMCP(agent))
    
    // Format agents with extracted knowledge base names
    const formattedAgents = agentsWithKnowledge.map((agent: any) => {
      const latestVersion = agent.versions?.latest
      return {
        id: agent.name || agent.id,
        name: agent.name || agent.id,
        description: latestVersion?.definition?.description || 
                     latestVersion?.description ||
                     agent.definition?.description || 
                     agent.description || '',
        model: latestVersion?.definition?.model || 
               agent.definition?.model || 
               'gpt-4o',
        knowledgeBases: extractKnowledgeBases(agent),
        instructions: latestVersion?.definition?.instructions || 
                      agent.definition?.instructions || '',
        tools: latestVersion?.definition?.tools || 
               agent.definition?.tools || 
               agent.tools || [],
        created: agent.created_at || 
                 agent.created || 
                 new Date().toISOString()
      }
    })
    
    return NextResponse.json({ agents: formattedAgents })

  } catch (error) {
    console.error('❌ Error fetching Foundry agents:', error)
    // Return empty array instead of error to allow UI to function gracefully
    return NextResponse.json({ agents: [] })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    if (!isFoundryConfigured()) {
      // Return error when Foundry is not configured
      return NextResponse.json(
        { error: 'Foundry is not properly configured. Please set FOUNDRY_PROJECT_ENDPOINT.' },
        { status: 400 }
      )
    }

    const { name, description, model, knowledgeBases = [] } = body

    if (!name || !model) {
      return NextResponse.json(
        { error: 'Name and model are required' },
        { status: 400 }
      )
    }

    // Sanitize agent name to meet Azure requirements:
    // - Must start and end with alphanumeric characters
    // - Can contain hyphens in the middle
    // - Must not exceed 63 characters
    const sanitizedName = name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-') // Replace non-alphanumeric (except hyphens) with hyphens
      .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
      .replace(/-+/g, '-') // Replace multiple consecutive hyphens with single hyphen
      .substring(0, 63) // Limit to 63 characters
      .replace(/-+$/, '') // Remove any trailing hyphens after truncation

    if (!sanitizedName || !/^[a-z0-9]/.test(sanitizedName) || !/[a-z0-9]$/.test(sanitizedName)) {
      return NextResponse.json(
        { error: 'Invalid agent name. Must start and end with alphanumeric characters.' },
        { status: 400 }
      )
    }

    const token = await getFoundryBearerToken()

    // First, create project connections for knowledge bases
    const mcpTools = []
    
    for (const kbName of knowledgeBases) {
      try {
        // Create project connection for this knowledge base
        const connectionName = `kb-connection-${kbName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
        const mcpEndpoint = `${process.env.AZURE_SEARCH_ENDPOINT}/knowledgebases/${kbName}/mcp?api-version=2025-11-01-preview`
        
        const connectionPayload: ProjectConnection = {
          name: connectionName,
          type: 'Microsoft.MachineLearningServices/workspaces/connections',
          properties: {
            authType: 'ProjectManagedIdentity',
            category: 'RemoteTool',
            target: mcpEndpoint,
            isSharedToAll: true,
            audience: 'https://search.azure.com/',
            metadata: {
              ApiType: 'Azure'
            }
          }
        }

        // Extract resource ID from FOUNDRY_PROJECT_ENDPOINT
        const projectResourceId = FOUNDRY_ENDPOINT.replace('https://management.azure.com', '').replace('/api/projects/', '/workspaces/')
        
        const connectionResponse = await fetch(
          `https://management.azure.com${projectResourceId}/connections/${connectionName}?api-version=2025-10-01-preview`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(connectionPayload)
          }
        )

        if (!connectionResponse.ok) {
          console.warn(`Failed to create connection for KB ${kbName}:`, await connectionResponse.text())
          continue
        }

        // Add MCP tool for this knowledge base
        mcpTools.push({
          type: 'mcp',
          server_label: `knowledge-base-${kbName}`,
          server_url: mcpEndpoint,
          require_approval: 'never',
          allowed_tools: ['knowledge_base_retrieve'],
          project_connection_id: connectionName,
          tool_choice: 'required'
        })
      } catch (connError) {
        console.warn(`Failed to set up connection for KB ${kbName}:`, connError)
      }
    }

    // Optimized agent instructions for knowledge retrieval
    const instructions = `You are a helpful assistant that must use the knowledge base to answer all questions from users. You must never answer from your own knowledge under any circumstances.

Every answer must always provide annotations for using the MCP knowledge base tool and render them as: 【message_idx:search_idx†source_name】

If you cannot find the answer in the provided knowledge base you must respond with "I don't know".

When using knowledge bases:
- Always call the knowledge_base_retrieve tool for any question that could benefit from factual information
- Synthesize information from multiple sources when available
- Provide clear citations using the specified format
- Acknowledge when information is not available in the knowledge base`

    // Create the agent with MCP tools
    const agentPayload = {
      name: sanitizedName,
      definition: {
        kind: 'prompt',
        model: model,
        instructions: instructions,
        tools: mcpTools,
        ...(description && { description })
      }
    }

    const agentResponse = await fetch(`${FOUNDRY_ENDPOINT}/agents/${sanitizedName}/versions?api-version=${FOUNDRY_API_VERSION}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(agentPayload)
    })

    if (!agentResponse.ok) {
      const errorText = await agentResponse.text()
      console.error('Foundry agent creation error:', errorText)
      return NextResponse.json(
        { error: `Failed to create agent: ${agentResponse.status} ${agentResponse.statusText}` },
        { status: agentResponse.status }
      )
    }

    const agentData = await agentResponse.json()

    // Return formatted agent data
    return NextResponse.json({
      id: agentData.name || sanitizedName,
      name: agentData.name || sanitizedName,
      description: description || 'AI agent with knowledge retrieval capabilities',
      instructions: instructions,
      model: model,
      tools: mcpTools,
      knowledgeBases: knowledgeBases,
      created: new Date().toISOString()
    })

  } catch (error) {
    console.error('Error in agents POST:', error)
    
    // Return a more specific error response
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}