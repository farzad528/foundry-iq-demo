import { NextResponse } from 'next/server'
import { getFoundryBearerToken } from '@/lib/token-manager'

// Force dynamic rendering
export const dynamic = 'force-dynamic'
export const revalidate = 0

const FOUNDRY_ENDPOINT = process.env.FOUNDRY_PROJECT_ENDPOINT
const FOUNDRY_API_VERSION = process.env.FOUNDRY_API_VERSION || '2025-11-15-preview'

export async function GET() {
  try {
    if (!FOUNDRY_ENDPOINT) {
      // Return default models if Foundry is not configured
      return NextResponse.json({ 
        models: [
          { id: 'gpt-4o', name: 'gpt-4o' },
          { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
          { id: 'gpt-4.1', name: 'gpt-4.1' }
        ] 
      })
    }

    const token = await getFoundryBearerToken()
    
    // Fetch model deployments from Foundry project
    const apiUrl = `${FOUNDRY_ENDPOINT}/deployments?api-version=${FOUNDRY_API_VERSION}`
    
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store'
    })

    if (!response.ok) {
      console.error('Failed to fetch model deployments:', response.status, await response.text())
      // Return default models as fallback
      return NextResponse.json({ 
        models: [
          { id: 'gpt-4o', name: 'gpt-4o' },
          { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
          { id: 'gpt-4.1', name: 'gpt-4.1' }
        ] 
      })
    }

    const data = await response.json()
    
    // Extract models from deployments response
    const deployments = data.data || data.value || []
    const models = deployments
      .map((deployment: any) => ({
        id: deployment.name || deployment.id,
        name: deployment.name || deployment.id,
        model: deployment.model?.name || deployment.name
      }))
      .filter((m: any) => m.id) // Filter out any invalid entries
    
    // If no models found, return defaults
    if (models.length === 0) {
      return NextResponse.json({ 
        models: [
          { id: 'gpt-4o', name: 'gpt-4o' },
          { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
          { id: 'gpt-4.1', name: 'gpt-4.1' }
        ] 
      })
    }
    
    return NextResponse.json({ models })

  } catch (error) {
    console.error('Error fetching model deployments:', error)
    // Return default models as fallback
    return NextResponse.json({ 
      models: [
        { id: 'gpt-4o', name: 'gpt-4o' },
        { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
        { id: 'gpt-4.1', name: 'gpt-4.1' }
      ] 
    })
  }
}
