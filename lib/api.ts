interface ApiResponse<T> {
  value: T[]
  nextLink?: string
}

interface KnowledgeBase {
  name: string
  description?: string
  models?: any[]
  knowledgeSources?: any[]
  outputConfiguration?: any
  outputMode?: 'answerSynthesis' | 'extractiveData'
  retrievalReasoningEffort?: { kind: 'minimal' | 'low' | 'medium' | 'high' }
  retrievalInstructions?: string
  answerInstructions?: string // Add at root level per API spec
  requestLimits?: any
  '@odata.etag'?: string
}

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string | any[]
}

interface RetrieveParams {
  xMsUserToken?: string
  globalHeaders?: Record<string, string>
  [key: string]: any
}

export async function fetchKnowledgeSources(): Promise<ApiResponse<any>> {
  const first = await fetch('/api/knowledge-sources', {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  })

  if (!first.ok) {
    throw new Error('Failed to fetch knowledge sources')
  }

  const initial = await first.json()

  if (!initial.nextLink) {
    return initial
  }

  // Follow pagination if needed
  const all = [...(initial.value || [])]
  let nextLink = initial.nextLink
  let guard = 0

  while (nextLink && guard < 20) {
    guard++
    if (!nextLink.startsWith('/')) break

    const resp = await fetch(nextLink, { cache: 'no-store' })
    if (!resp.ok) break

    const page = await resp.json()
    all.push(...(page.value || []))
    nextLink = page.nextLink
  }

  return { value: all }
}

// Central base path for the app router proxy that speaks to Azure AI Search knowledge bases.
// Keeping the value in one place makes it easier to toggle between legacy and new endpoints during migrations.
const KNOWLEDGE_BASES_BASE_PATH = '/api/knowledge-bases'

export async function fetchKnowledgeBases(): Promise<ApiResponse<KnowledgeBase>> {
  const response = await fetch(KNOWLEDGE_BASES_BASE_PATH, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  })

  if (!response.ok) {
    throw new Error('Failed to fetch knowledge bases')
  }

  return response.json()
}

export async function fetchKnowledgeBase(id: string): Promise<KnowledgeBase> {
  const response = await fetch(`${KNOWLEDGE_BASES_BASE_PATH}/${id}`)

  if (!response.ok) {
    throw new Error('Failed to fetch knowledge base')
  }

  return response.json()
}

export async function updateKnowledgeBase(knowledgeBaseId: string, knowledgeBaseData: KnowledgeBase): Promise<KnowledgeBase> {
  const headers: HeadersInit = { 'Content-Type': 'application/json' }

  if (knowledgeBaseData['@odata.etag']) {
    headers['If-Match'] = knowledgeBaseData['@odata.etag']
  }

  const response = await fetch(`${KNOWLEDGE_BASES_BASE_PATH}/${knowledgeBaseId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(knowledgeBaseData),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || 'Failed to update knowledge base')
  }

  return response.json()
}

export async function deleteKnowledgeBase(knowledgeBaseId: string): Promise<any> {
  const response = await fetch(`${KNOWLEDGE_BASES_BASE_PATH}/${knowledgeBaseId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const errorData = await response.json()
  throw new Error(errorData.error || 'Failed to delete knowledge base')
  }

  return response.json()
}

export async function retrieveFromKnowledgeBase(
  knowledgeBaseId: string,
  messages: Message[] | null,
  params: RetrieveParams = {}
): Promise<any> {
  let userAclToken = params.xMsUserToken

  if (!userAclToken && typeof window !== 'undefined') {
    try {
      userAclToken =
        localStorage.getItem('x-ms-query-source-authorization') ||
        sessionStorage.getItem('x-ms-query-source-authorization') ||
        undefined
    } catch {
      // Ignore storage errors
    }
  }

  // Build headers: start with content-type, add global headers from params, then add ACL token
  const headers: HeadersInit = {
    'Content-Type': 'application/json'
  }

  // Add global headers from runtime settings if provided
  if (params.globalHeaders && typeof params.globalHeaders === 'object') {
    Object.entries(params.globalHeaders as Record<string, string>).forEach(([key, value]) => {
      if (key && value && typeof value === 'string') {
        headers[key] = value
      }
    })
  }

  // Legacy support: add ACL token if provided via xMsUserToken
  if (userAclToken) {
    headers['x-ms-query-source-authorization'] = userAclToken
  }

  // If messages is null, params should already contain the complete payload (intents format)
  // Otherwise, use the standard messages format
  const payload: any = messages !== null ? { messages, ...params } : { ...params }
  
  // Remove client-only and configuration parameters that are not valid for retrieve operation
  delete payload.xMsUserToken
  delete payload.globalHeaders // Don't send globalHeaders in body, only as HTTP headers
  delete payload.reasoningEffort // Configuration parameter, not valid for retrieve
  delete payload.retrievalReasoningEffort // Configuration parameter, not valid for retrieve
  delete payload.answerInstructions // Configuration parameter, not valid for retrieve
  delete payload.retrievalInstructions // Configuration parameter, not valid for retrieve
  delete payload.outputMode // Configuration parameter, not valid for retrieve
  delete payload.models // Configuration parameter, not valid for retrieve
  delete payload.knowledgeSources // Configuration parameter, not valid for retrieve
  delete payload.outputConfiguration // Configuration parameter, not valid for retrieve
  delete payload.requestLimits // Configuration parameter, not valid for retrieve

  const response = await fetch(`${KNOWLEDGE_BASES_BASE_PATH}/${knowledgeBaseId}/retrieve`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    let errorMessage = `Failed to retrieve from knowledge base (${response.status})`
    let detailedError = ''
    
    try {
      const errorData = await response.json()
      console.error('API Error Response:', errorData)
      
      // Extract detailed error information
      if (errorData.azureError) {
        if (typeof errorData.azureError === 'object') {
          detailedError = errorData.azureError.error?.message || errorData.azureError.message || JSON.stringify(errorData.azureError)
        } else {
          detailedError = String(errorData.azureError)
        }
      }
      if (errorData.details) {
        detailedError = detailedError ? `${detailedError} | ${errorData.details}` : errorData.details
      }
      
      errorMessage = errorData.error?.message || errorData.error || errorData.message || errorMessage
      
      // Append detailed error if available
      if (detailedError) {
        errorMessage = `${errorMessage}\n\nDetails: ${detailedError}`
      }
    } catch (parseError) {
      console.error('Failed to parse error response:', parseError)
      try {
        const textError = await response.text()
        errorMessage = `${errorMessage}\n\nRaw error: ${textError}`
      } catch {
        // Ignore
      }
    }
    throw new Error(errorMessage)
  }

  return response.json()
}

export async function createKnowledgeBase(knowledgeBaseData: Partial<KnowledgeBase>): Promise<KnowledgeBase> {
  const response = await fetch(`${KNOWLEDGE_BASES_BASE_PATH}/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(knowledgeBaseData),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || 'Failed to create knowledge base')
  }

  return response.json()
}

export async function createKnowledgeSource(sourceData: any): Promise<any> {
  const response = await fetch('/api/knowledge-sources', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sourceData),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || 'Failed to create knowledge source')
  }

  return response.json()
}

export async function createFoundryAgent(agentData: any): Promise<any> {
  const response = await fetch('/api/foundry/assistants', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(agentData),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || 'Failed to create Foundry agent')
  }

  return response.json()
}

export async function getKnowledgeSourceStatus(sourceName: string): Promise<any> {
  const response = await fetch(`/api/knowledge-sources/${sourceName}/status`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  })

  if (!response.ok) {
    throw new Error('Failed to get knowledge source status')
  }

  return response.json()
}