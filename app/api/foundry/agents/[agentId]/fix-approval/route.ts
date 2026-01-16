import { NextRequest, NextResponse } from 'next/server'
import { getFoundryBearerToken } from '@/lib/token-manager'

// Force dynamic rendering
export const dynamic = 'force-dynamic'
export const revalidate = 0

const FOUNDRY_ENDPOINT = process.env.FOUNDRY_PROJECT_ENDPOINT
const FOUNDRY_API_VERSION = process.env.FOUNDRY_API_VERSION || '2025-11-15-preview'

// Update agent to fix require_approval from 'always' to 'never'
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

    // Get current agent version
    const getResponse = await fetch(`${FOUNDRY_ENDPOINT}/agents/${agentId}?api-version=${FOUNDRY_API_VERSION}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    })

    if (!getResponse.ok) {
      const errorText = await getResponse.text()
      console.error('Failed to get agent:', errorText)
      return NextResponse.json(
        { error: `Failed to get agent: ${getResponse.status}` },
        { status: getResponse.status }
      )
    }

    const agentData = await getResponse.json()
    const latestVersion = agentData.versions?.latest
    
    if (!latestVersion) {
      return NextResponse.json(
        { error: 'No agent version found' },
        { status: 404 }
      )
    }

    // Fix MCP tools - change require_approval from 'always' to 'never'
    const definition = latestVersion.definition
    let needsUpdate = false
    let toolsUpdated = 0
    
    if (definition.tools && Array.isArray(definition.tools)) {
      definition.tools = definition.tools.map((tool: any) => {
        if (tool.type === 'mcp') {
          // Always set require_approval to 'never' if it's not already set or if it's 'always'
          if (!tool.require_approval || tool.require_approval === 'always') {
            needsUpdate = true
            toolsUpdated++
            console.log(`Updating tool ${tool.server_label}: ${tool.require_approval || 'undefined'} -> never`)
            return {
              ...tool,
              require_approval: 'never'
            }
          }
        }
        return tool
      })
    }

    console.log(`Agent ${agentId}: needsUpdate=${needsUpdate}, toolsUpdated=${toolsUpdated}`)

    if (!needsUpdate) {
      return NextResponse.json({
        message: 'No updates needed - all MCP tools already have require_approval set to never',
        agent: agentData
      })
    }

    // Create new version with fixed tools
    const updatePayload = {
      definition: {
        ...definition,
        kind: 'prompt' // Ensure kind is set
      }
    }

    const updateResponse = await fetch(`${FOUNDRY_ENDPOINT}/agents/${agentId}/versions?api-version=${FOUNDRY_API_VERSION}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload)
    })

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text()
      console.error('Failed to update agent:', errorText)
      return NextResponse.json(
        { error: `Failed to update agent: ${updateResponse.status}`, details: errorText },
        { status: updateResponse.status }
      )
    }

    const updatedAgent = await updateResponse.json()

    return NextResponse.json({
      message: 'Agent updated successfully',
      agent: updatedAgent,
      changes: 'Changed require_approval from "always" to "never" for MCP tools'
    })

  } catch (error) {
    console.error('Error fixing agent approval:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
