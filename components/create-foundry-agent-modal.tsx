'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LoadingSkeleton } from '@/components/shared/loading-skeleton'
import { useToast } from '@/components/ui/toast'
import { fetchKnowledgeBases } from '@/lib/api'
import { 
  Bot20Regular, 
  Database20Regular
} from '@fluentui/react-icons'

interface CreateFoundryAgentModalProps {
  onClose: () => void
  onSubmit: (data: any) => Promise<void>
  isSubmitting: boolean
}

interface KnowledgeBase {
  name: string
  description?: string
}

export function CreateFoundryAgentModal({ 
  onClose, 
  onSubmit, 
  isSubmitting 
}: CreateFoundryAgentModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    model: 'gpt-4o',
    knowledgeBases: [] as string[]
  })
  
  const [error, setError] = useState<string | null>(null)
  const [availableKnowledgeBases, setAvailableKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([])
  const [isLoadingKBs, setIsLoadingKBs] = useState(true)
  const [isLoadingModels, setIsLoadingModels] = useState(true)
  const { toast } = useToast()

  // Fetch actual knowledge bases from the project
  useEffect(() => {
    const loadKnowledgeBases = async () => {
      try {
        const response = await fetchKnowledgeBases()
        const kbs = response.value || []
        setAvailableKnowledgeBases(kbs)
      } catch (err) {
        console.error('Failed to fetch knowledge bases:', err)
        setError('Failed to load knowledge bases')
      } finally {
        setIsLoadingKBs(false)
      }
    }
    loadKnowledgeBases()
  }, [])

  // Fetch available models from the project
  useEffect(() => {
    const loadModels = async () => {
      try {
        const response = await fetch('/api/foundry/models')
        const data = await response.json()
        const models = data.models || []
        setAvailableModels(models)
        // Set default model if available
        if (models.length > 0 && !formData.model) {
          setFormData(prev => ({ ...prev, model: models[0].id }))
        }
      } catch (err) {
        console.error('Failed to fetch models:', err)
        // Use fallback models if fetch fails
        setAvailableModels([
          { id: 'gpt-4o', name: 'gpt-4o' },
          { id: 'gpt-4o-mini', name: 'gpt-4o-mini' }
        ])
      } finally {
        setIsLoadingModels(false)
      }
    }
    loadModels()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      setError('Agent name is required')
      return
    }

    if (!formData.model) {
      setError('Model selection is required')
      return
    }

    if (formData.knowledgeBases.length === 0) {
      setError('At least one knowledge base must be selected')
      return
    }

    try {
      setError(null)
      await onSubmit(formData)
      toast({
        title: 'Success',
        description: 'Foundry agent created successfully',
        type: 'success'
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
    }
  }

  const toggleKnowledgeBase = (kbName: string) => {
    setFormData(prev => ({
      ...prev,
      knowledgeBases: prev.knowledgeBases.includes(kbName)
        ? prev.knowledgeBases.filter(kb => kb !== kbName)
        : [...prev.knowledgeBases, kbName]
    }))
  }

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Foundry Agent</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6 p-8 pt-0">
          {/* Agent Name */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg-default">
              Agent Name *
            </label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Enter agent name..."
              required
              disabled={isSubmitting}
              className="w-full"
            />
            <p className="text-xs text-fg-muted">
              Choose a unique name for your agent (e.g., "hr-assistant", "sales-expert")
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg-default">
              Description
            </label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe your agent's purpose and capabilities..."
              disabled={isSubmitting}
              rows={3}
              className="w-full resize-none"
            />
            <p className="text-xs text-fg-muted">
              Optional description to help identify this agent's purpose
            </p>
          </div>

          {/* Model Selection */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg-default">
              Model *
            </label>
            {isLoadingModels ? (
              <div className="space-y-2">
                <LoadingSkeleton />
              </div>
            ) : (
              <Select
                value={formData.model}
                onValueChange={(value) => setFormData(prev => ({ ...prev, model: value }))}
                disabled={isSubmitting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a model..." />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-fg-muted">
              Choose the language model for your agent
            </p>
          </div>

          {/* Knowledge Bases */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg-default">
              Knowledge Bases *
            </label>
            
            {isLoadingKBs ? (
              <div className="space-y-2">
                <LoadingSkeleton />
                <LoadingSkeleton />
                <LoadingSkeleton />
              </div>
            ) : availableKnowledgeBases.length === 0 ? (
              <div className="p-4 text-center text-sm text-fg-muted border rounded-lg">
                No knowledge bases found. Create a knowledge base first.
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {availableKnowledgeBases.map((kb) => (
                  <div
                    key={kb.name}
                    className="flex items-start gap-3 p-3 border rounded-lg hover:bg-surface-subtle transition-colors"
                  >
                    <Checkbox
                      id={`kb-${kb.name}`}
                      checked={formData.knowledgeBases.includes(kb.name)}
                      onCheckedChange={() => toggleKnowledgeBase(kb.name)}
                      disabled={isSubmitting}
                    />
                    <div className="p-2 rounded-lg bg-blue-500/10">
                      <Database20Regular className="w-4 h-4 text-blue-600 dark:text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label
                        htmlFor={`kb-${kb.name}`}
                        className="block text-sm font-medium text-fg-default cursor-pointer"
                      >
                        {kb.name}
                      </label>
                      {kb.description && (
                        <p className="text-xs text-fg-muted mt-0.5 line-clamp-2">
                          {kb.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            <p className="text-xs text-fg-muted">
              Select knowledge bases that this agent can query for information
            </p>
            
            {formData.knowledgeBases.length > 0 && (
              <div className="text-xs text-accent">
                {formData.knowledgeBases.length} knowledge base{formData.knowledgeBases.length !== 1 ? 's' : ''} selected
              </div>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-status-critical-subtle border border-status-critical-subtle-stroke rounded-lg">
              <p className="text-sm text-status-critical">{error}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || formData.knowledgeBases.length === 0}
              className="gap-2"
            >
              {isSubmitting ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Bot20Regular className="w-4 h-4" />
              )}
              {isSubmitting ? 'Creating...' : 'Create Agent'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}