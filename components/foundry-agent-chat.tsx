import React, { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { AgentAvatar } from '@/components/agent-avatar'
import { InlineCitationsText } from '@/components/inline-citations'
import { TraceExplorer } from '@/components/trace-explorer'
import { useConversationStarters } from '@/lib/conversationStarters'
import { retrieveFromKnowledgeBase } from '@/lib/api'
import { 
  ArrowLeft20Regular, 
  Send20Regular, 
  Person20Regular,
  Bot20Regular,
  Database20Regular,
  Copy20Regular,
  CheckmarkCircle20Regular,
  Attach20Regular
} from '@fluentui/react-icons'
import { motion, AnimatePresence } from 'framer-motion'
import { cn, formatRelativeTime } from '@/lib/utils'

interface MessageContent {
  type: 'text' | 'image'
  text?: string
  image?: { url: string }
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: MessageContent[]
  timestamp: Date
  isLoading?: boolean
  references?: Reference[]
  activity?: Activity[]
}

interface Reference {
  type: string
  id: string
  activitySource: number
  sourceData?: any
  rerankerScore?: number
  docKey?: string
  blobUrl?: string
  toolName?: string
  serverURL?: string
  content?: string
  webUrl?: string
}

interface Activity {
  type: string
  id: number
  inputTokens?: number
  outputTokens?: number
  elapsedMs?: number
  knowledgeSourceName?: string
  queryTime?: string
  count?: number
}

interface FoundryAgent {
  id: string
  name: string
  description?: string
  model: string
  knowledgeBases: string[]
}

interface FoundryAgentChatProps {
  agent: FoundryAgent
  onBack: () => void
}

export function FoundryAgentChat({ agent, onBack }: FoundryAgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load conversation starters based on agent's knowledge bases
  const agentKBId = agent.knowledgeBases?.[0] // Use first knowledge base for starters
  const { starters, isGeneralFallback: isGeneral } = useConversationStarters(agentKBId)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    // Focus input on mount
    inputRef.current?.focus()
  }, [])

  const sendMessage = async (text?: string) => {
    const messageText = text || input.trim()
    if (!messageText || isLoading) return

    const userMessage: Message = {
      id: Date.now() + '-user',
      role: 'user',
      content: [{ type: 'text', text: messageText }],
      timestamp: new Date()
    }

    const loadingMessage: Message = {
      id: Date.now() + '-loading',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      timestamp: new Date(),
      isLoading: true
    }

    setMessages(prev => [...prev, userMessage, loadingMessage])
    setInput('')
    setIsLoading(true)

    try {
      // Use the same knowledge base query API as the playground
      const knowledgeBaseId = agent.knowledgeBases?.[0] || 'demo-manufacturing-kb'
      
      // Construct messages in the same format as playground
      const azureMessages = [
        {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: messageText }]
        }
      ]

      // Use default API parameters similar to playground
      const apiParams = {
        outputMode: 'answerSynthesis' as const,
        reasoningEffort: { kind: 'medium' as const },
        globalHeaders: {},
        answerInstructions: '',
        retrievalInstructions: '',
        knowledgeSourceParams: []
      }

      // Call the exact same function the playground uses
      const response = await retrieveFromKnowledgeBase(knowledgeBaseId, azureMessages, apiParams)

      // Extract response text exactly like the playground does
      let assistantText = 'I apologize, but I was unable to generate a response.'
      if (response.response && response.response.length > 0) {
        const rc = response.response[0].content
        if (rc && rc.length > 0) assistantText = rc[0].text || assistantText
      }

      // Create assistant message with the EXACT same data structure as playground
      const assistantMessage: Message = {
        id: Date.now() + '-assistant',
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }],
        timestamp: new Date(),
        references: response.references || [],
        activity: response.activity || []
      }

      setMessages(prev => prev.slice(0, -1).concat(assistantMessage))

    } catch (error) {
      console.error('❌ Agent Chat API Error:', error)
      
      // Extract meaningful error message like the playground does
      let errorText = 'Error processing request. Please try again.'
      if (error instanceof Error) {
        errorText = `❌ Error: ${error.message}`
      } else if (typeof error === 'string') {
        errorText = `❌ Error: ${error}`
      }
      
      const errorMessage: Message = {
        id: Date.now() + '-error',
        role: 'assistant',
        content: [{ type: 'text', text: errorText }],
        timestamp: new Date()
      }

      setMessages(prev => prev.slice(0, -1).concat(errorMessage))
    } finally {
      setIsLoading(false)
    }
  }

  const copyMessage = async (message: Message) => {
    try {
      const textContent = message.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('')
      await navigator.clipboard.writeText(textContent)
      setCopiedMessageId(message.id)
      setTimeout(() => setCopiedMessageId(null), 2000)
    } catch (error) {
      console.error('Failed to copy message:', error)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      {/* Header */}
      <Card className="rounded-b-none border-b-0">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="gap-2"
            >
              <ArrowLeft20Regular className="w-4 h-4" />
              Back
            </Button>
            
            <div className="flex items-center gap-3 flex-1">
              <AgentAvatar size={40} iconSize={20} variant="solid" />
              <div>
                <CardTitle className="text-lg">{agent.name}</CardTitle>
                <div className="flex items-center gap-4 text-sm text-fg-muted mt-1">
                  <div className="flex items-center gap-1">
                    <Database20Regular className="w-3 h-3" />
                    <span>{agent.knowledgeBases.length} KB{agent.knowledgeBases.length !== 1 ? 's' : ''}</span>
                  </div>
                  <span>{agent.model}</span>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Messages */}
      <Card className="flex-1 rounded-t-none rounded-b-none border-y-0 overflow-hidden">
        <CardContent className="p-0 h-full flex flex-col">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 ? (
              <div className="space-y-8">
                {/* Welcome message */}
                <div className="text-center py-8">
                  <AgentAvatar size={64} iconSize={32} variant="solid" className="mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-fg-default mb-2">
                    Chat with {agent.name}
                  </h3>
                  <p className="text-fg-muted max-w-md mx-auto">
                    I can help you with information from {agent.knowledgeBases.length} connected knowledge base{agent.knowledgeBases.length !== 1 ? 's' : ''}. 
                    Choose a question below or ask me anything!
                  </p>
                </div>

                {/* Conversation starters */}
                {starters.length > 0 && (
                  <div className="space-y-4">
                    <h4 className="text-sm font-medium text-fg-muted uppercase tracking-wide px-2">
                      Sample Questions
                    </h4>
                    <div className="grid gap-3">
                      {starters.map((starter, index) => (
                        <motion.button
                          key={index}
                          onClick={() => sendMessage(starter.prompt)}
                          className="group p-4 rounded-lg border border-stroke-divider hover:border-stroke-focus hover:bg-surface-subtle transition-all duration-200 text-left"
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          disabled={isLoading}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-fg-default group-hover:text-accent text-sm leading-relaxed">
                                {starter.label}
                              </p>
                              {starter.complexity && (
                                <div className="flex items-center gap-2 mt-2">
                                  <span className={cn(
                                    "px-2 py-1 rounded text-xs font-medium",
                                    starter.complexity === 'Simple' && "bg-status-success/10 text-status-success",
                                    starter.complexity === 'Moderate' && "bg-status-warning/10 text-status-warning", 
                                    starter.complexity === 'Advanced' && "bg-status-critical/10 text-status-critical"
                                  )}>
                                    {starter.complexity}
                                  </span>
                                </div>
                              )}
                            </div>
                            <Send20Regular className="w-4 h-4 text-fg-muted group-hover:text-accent shrink-0 mt-0.5" />
                          </div>
                        </motion.button>
                      ))}
                    </div>
                    
                    {isGeneral && (
                      <p className="text-xs text-fg-muted text-center pt-2">
                        These are general questions. Agent-specific questions will be available once configured.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <AnimatePresence>
                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className={cn(
                      'flex gap-3 max-w-4xl',
                      message.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'
                    )}
                  >
                    <div className="shrink-0">
                      {message.role === 'user' ? (
                        <div className="w-8 h-8 rounded-full bg-accent text-fg-on-accent flex items-center justify-center">
                          <Person20Regular className="w-4 h-4" />
                        </div>
                      ) : (
                        <AgentAvatar size={32} iconSize={16} variant="subtle" />
                      )}
                    </div>
                    
                    <div
                      className={cn(
                        'flex-1 min-w-0 space-y-2',
                        message.role === 'user' ? 'text-right' : 'text-left'
                      )}
                    >
                      <div
                        className={cn(
                          'inline-block max-w-full rounded-lg p-3 relative group',
                          message.role === 'user'
                            ? 'bg-accent text-fg-on-accent'
                            : 'bg-surface-subtle text-fg-default border border-stroke-divider'
                        )}
                      >
                        {message.isLoading ? (
                          <div className="flex items-center gap-2">
                            <div className="flex space-x-1">
                              <div className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <div className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <div className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                            <span className="text-sm">Thinking...</span>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {message.content.map((content, i) => (
                              <div key={i} className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                                {content.type === 'text' && content.text && (
                                  message.role === 'assistant' ? (
                                    <InlineCitationsText
                                      text={content.text}
                                      references={message.references || []}
                                      activity={message.activity || []}
                                      messageId={message.id}
                                    />
                                  ) : (
                                    content.text
                                  )
                                )}
                                {content.type === 'image' && content.image && (
                                  <img
                                    src={content.image.url}
                                    alt="Message image"
                                    className="max-w-full h-auto rounded border border-stroke-divider"
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {!message.isLoading && message.role === 'assistant' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-2 -right-2 p-1 h-auto bg-background border border-stroke-divider"
                            onClick={() => copyMessage(message)}
                          >
                            {copiedMessageId === message.id ? (
                              <CheckmarkCircle20Regular className="w-3 h-3 text-status-success" />
                            ) : (
                              <Copy20Regular className="w-3 h-3" />
                            )}
                          </Button>
                        )}
                      </div>

                      {/* Show trace explorer for assistant messages with activity */}
                      {message.role === 'assistant' && !message.isLoading && message.activity && (
                        <div className="max-w-full">
                          <TraceExplorer 
                            response={{
                              response: [{ 
                                role: 'assistant', 
                                content: message.content.map(c => 
                                  c.type === 'text' 
                                    ? { type: 'text' as const, text: c.text || '' }
                                    : { type: 'image' as const, image: { url: c.image?.url || '' } }
                                ) 
                              }],
                              activity: message.activity as any || [],
                              references: message.references as any || []
                            }}
                          />
                        </div>
                      )}

                      <div className="text-xs text-fg-muted px-3">
                        {formatRelativeTime(message.timestamp)}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </CardContent>
      </Card>

      {/* Input */}
      <Card className="rounded-t-none">
        <CardContent className="p-4">
          <div className="flex gap-3">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask me anything..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
              className="gap-2"
            >
              <Send20Regular className="w-4 h-4" />
              Send
            </Button>
          </div>
          
          {agent.knowledgeBases.length > 0 && (
            <div className="flex items-center gap-2 mt-3 text-xs text-fg-muted">
              <Database20Regular className="w-3 h-3" />
              <span>Connected to: {agent.knowledgeBases.join(', ')}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}