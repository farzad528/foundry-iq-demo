'use client'

import React, { useState, useEffect } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/empty-state'
import { ErrorState } from '@/components/shared/error-state'
import { LoadingSkeleton } from '@/components/shared/loading-skeleton'
import { FoundryAgentChat } from '@/components/foundry-agent-chat'
import { CreateFoundryAgentModal } from '@/components/create-foundry-agent-modal'
import { AgentAvatar } from '@/components/agent-avatar'
import { 
  Bot20Regular, 
  Add20Regular, 
  ChatSparkle20Regular,
  Database20Regular,
  Settings20Regular
} from '@fluentui/react-icons'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface FoundryAgent {
  id: string
  name: string
  description?: string
  model: string
  knowledgeBases: string[]
  version?: string
  created: string
  lastUsed?: string
  needsUpdate?: boolean
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<FoundryAgent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<FoundryAgent | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  // Load agents on mount
  useEffect(() => {
    loadAgents()
  }, [])

  const loadAgents = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const response = await fetch('/api/foundry/agents')
      if (!response.ok) {
        throw new Error('Failed to load agents')
      }
      const data = await response.json()
      const loadedAgents = data.agents || []
      
      // Auto-fix agents that need updating (require_approval: 'always' -> 'never')
      const agentsNeedingFix = loadedAgents.filter((a: FoundryAgent) => a.needsUpdate)
      if (agentsNeedingFix.length > 0) {
        console.log(`Auto-fixing ${agentsNeedingFix.length} agent(s) with require_approval='always'`)
        await Promise.all(
          agentsNeedingFix.map((agent: FoundryAgent) => 
            fetch(`/api/foundry/agents/${agent.id}/fix-approval`, { method: 'POST' })
              .then(res => {
                if (res.ok) {
                  console.log(`✓ Fixed agent: ${agent.name}`)
                } else {
                  console.warn(`Failed to fix agent: ${agent.name}`)
                }
              })
              .catch(err => console.warn(`Error fixing agent ${agent.name}:`, err))
          )
        )
        // Reload agents to get updated versions
        const refreshResponse = await fetch('/api/foundry/agents')
        if (refreshResponse.ok) {
          const refreshData = await refreshResponse.json()
          setAgents(refreshData.agents || [])
          return
        }
      }
      
      setAgents(loadedAgents)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents')
    } finally {
      setIsLoading(false)
    }
  }

  const createAgent = async (agentData: any) => {
    try {
      setIsCreating(true)
      const response = await fetch('/api/foundry/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentData)
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create agent')
      }
      
      const newAgent = await response.json()
      setAgents(prev => [...prev, newAgent])
      setShowCreateModal(false)
    } catch (err) {
      throw err // Re-throw to be handled by the modal
    } finally {
      setIsCreating(false)
    }
  }

  if (selectedAgent) {
    return (
      <FoundryAgentChat
        agent={selectedAgent}
        onBack={() => setSelectedAgent(null)}
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Foundry Agents"
        description="Manage your Foundry agents with knowledge retrieval capabilities."
        primaryAction={{
          label: "Create Agent",
          onClick: () => setShowCreateModal(true),
          icon: Add20Regular
        }}
      />

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-6">
              <LoadingSkeleton className="h-6 w-32 mb-2" />
              <LoadingSkeleton className="h-4 w-full mb-4" />
              <LoadingSkeleton className="h-8 w-20" />
            </Card>
          ))}
        </div>
      )}

      {error && (
        <ErrorState
          title="Failed to load agents"
          description={error}
          action={{
            label: "Retry",
            onClick: loadAgents,
            variant: "outline"
          }}
        />
      )}

      {!isLoading && !error && agents.length === 0 && (
        <EmptyState
          icon={Bot20Regular}
          title="No agents yet"
          description="Create your first Foundry agent to start intelligent conversations with knowledge retrieval"
          action={{
            label: "Create First Agent",
            onClick: () => setShowCreateModal(true)
          }}
        />
      )}

      {!isLoading && !error && agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent, index) => (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card className="cursor-pointer hover:bg-surface-subtle transition-colors">
                <CardHeader className="pb-4">
                  <div className="flex items-start gap-3">
                    <AgentAvatar size={48} iconSize={24} variant="subtle" />
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate">{agent.name}</CardTitle>
                      <p className="text-sm text-fg-muted mt-1 line-clamp-2">
                        {agent.description || 'AI agent with knowledge retrieval capabilities'}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-4 text-sm text-fg-muted mb-4">
                    <div className="flex items-center gap-1">
                      <Database20Regular className="w-4 h-4" />
                      <span>{agent.knowledgeBases.length} KB{agent.knowledgeBases.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Settings20Regular className="w-4 h-4" />
                      <span>{agent.model}</span>
                    </div>
                  </div>
                  
                  <Button
                    onClick={() => setSelectedAgent(agent)}
                    className="w-full gap-2"
                    variant="outline"
                  >
                    <ChatSparkle20Regular className="w-4 h-4" />
                    Start Chat
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateFoundryAgentModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={createAgent}
          isSubmitting={isCreating}
        />
      )}
    </div>
  )
}
