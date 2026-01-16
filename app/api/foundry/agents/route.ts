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
      const tools = latestVersion?.definition?.tools || 
                    agent.definition?.tools || 
                    agent.tools || []
      
      // Fix require_approval for MCP tools
      const fixedTools = tools.map((tool: any) => {
        if (tool.type === 'mcp' && tool.require_approval === 'always') {
          return {
            ...tool,
            require_approval: 'never'
          }
        }
        return tool
      })
      
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
        tools: fixedTools,
        version: latestVersion?.version || agent.version || '1',
        needsUpdate: tools.some((t: any) => t.type === 'mcp' && t.require_approval === 'always'),
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

    // List all RemoteTool project connections
    const connectionsResponse = await fetch(
      `${FOUNDRY_ENDPOINT}/connections?api-version=${FOUNDRY_API_VERSION}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store'
      }
    )

    if (!connectionsResponse.ok) {
      const errorText = await connectionsResponse.text()
      console.error('Failed to fetch connections:', errorText)
      return NextResponse.json(
        { error: 'Failed to fetch project connections. Please check your Foundry configuration.' },
        { status: 500 }
      )
    }

    const connectionsData = await connectionsResponse.json()
    const connections = connectionsData.data || connectionsData.value || []

    // Filter RemoteTool connections
    const remoteToolConnections = connections.filter((conn: any) => 
      conn.type === 'RemoteTool'
    )

    // Create MCP tools for knowledge bases
    const mcpTools = []
    const missingConnections: string[] = []
    
    for (const kbName of knowledgeBases) {
      const mcpEndpoint = `${process.env.AZURE_SEARCH_ENDPOINT}/knowledgebases/${kbName}/mcp?api-version=2025-11-01-preview`
      
      // Find matching connection by target URL
      const matchingConnection = remoteToolConnections.find((conn: any) => {
        const target = conn.target
        // Normalize URLs for comparison (case-insensitive, handle Preview vs preview)
        return target && target.toLowerCase() === mcpEndpoint.toLowerCase()
      })

      if (matchingConnection) {
        const connectionId = matchingConnection.name || matchingConnection.id
        
        // Add MCP tool for this knowledge base
        mcpTools.push({
          type: 'mcp',
          server_label: `knowledge-base-${kbName}`,
          server_url: mcpEndpoint,
          require_approval: 'never',
          allowed_tools: ['knowledge_base_retrieve'],
          project_connection_id: connectionId
        })
      } else {
        missingConnections.push(kbName)
      }
    }

    // If any connections are missing, return error with instructions
    if (missingConnections.length > 0) {
      return NextResponse.json(
        { 
          error: `Missing project connections for knowledge bases: ${missingConnections.join(', ')}.\n\n` +
                 `Please configure Remote Tool connections at https://ai.azure.com/nextgen for each knowledge base:\n` +
                 missingConnections.map(kb => 
                   `  - Target: ${process.env.AZURE_SEARCH_ENDPOINT}/knowledgebases/${kb}/mcp?api-version=2025-11-01-preview\n` +
                   `  - Category: RemoteTool\n` +
                   `  - Auth: Project Managed Identity`
                 ).join('\n')
        },
        { status: 400 }
      )
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
        tool_choice: 'required', // Force the agent to always use knowledge base tools
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