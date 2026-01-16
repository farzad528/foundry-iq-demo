import React, { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { AgentAvatar } from '@/components/agent-avatar'
import { InlineCitationsText } from '@/components/inline-citations'
import { useConversationStarters } from '@/lib/conversationStarters'
import { 
  ArrowLeft20Regular, 
  Send20Regular, 
  Person20Regular,
  Bot20Regular,
  Database20Regular,
  Copy20Regular,
  CheckmarkCircle20Regular,
  Attach20Regular,
  ChatSparkle20Regular
} from '@fluentui/react-icons'
import { motion, AnimatePresence } from 'framer-motion'
import { cn, formatRelativeTime } from '@/lib/utils'

interface MessageContent {
  type: 'text' | 'image'
  text?: string
  image?: { url: string }
}

interface Annotation {
  type: string
  url?: string
  start_index?: number
  end_index?: number
  title?: string
  text?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: MessageContent[]
  timestamp: Date
  isLoading?: boolean
  references?: Reference[]
  activity?: Activity[]
  annotations?: Annotation[]
  debugData?: any  // Store full response data for debugging
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
  version?: string
}

interface FoundryAgentChatProps {
  agent: FoundryAgent
  onBack: () => void
}

// Helper: Extract assistant text from various response formats
function extractAssistantText(data: any): string {
  // Foundry response format: output array with message items
  if (data.output && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && item.content && Array.isArray(item.content)) {
        for (const content of item.content) {
          if (content.type === 'output_text' && content.text) {
            return content.text
          }
        }
      }
    }
  }
  
  // OpenAI format fallback
  if (data.choices?.[0]?.message?.content) {
    return data.choices[0].message.content
  }
  
  // Alternative format
  if (data.output_text) {
    return data.output_text
  }
  
  return 'I apologize, but I was unable to generate a response.'
}

// Helper: Extract URL from result object
function extractUrlFromResult(result: any): string | null {
  return result.html_url || result.url || result.web_url || result.webUrl || 
         result.link || result.href || result.blobUrl || null
}

// Helper: Extract knowledge base name from URL
function extractKnowledgeBaseName(url: string): string | null {
  const match = url.match(/\/knowledgebases\/([^\/]+)\/mcp/)
  return match ? match[1] : null
}

// Helper: Extract references from MCP calls and tool responses
function extractReferences(data: any): { references: Reference[], activity: Activity[], annotations: Annotation[] } {
  const references: Reference[] = []
  const activity: Activity[] = []
  const annotations: Annotation[] = []

  // Extract annotations from output
  if (data.output && Array.isArray(data.output)) {
    data.output.forEach((item: any) => {
      if (item.type === 'message' && item.content && Array.isArray(item.content)) {
        item.content.forEach((content: any) => {
          if (content.annotations && Array.isArray(content.annotations)) {
            annotations.push(...content.annotations)
          }
        })
      }
    })
  }

  // Extract from MCP call outputs
  if (data.output && Array.isArray(data.output)) {
    data.output.forEach((item: any, index: number) => {
      if (item.type === 'mcp_call' && item.output) {
        try {
          const mcpOutput = typeof item.output === 'string' ? JSON.parse(item.output) : item.output
          const results = Array.isArray(mcpOutput) ? mcpOutput : mcpOutput.results
          
          if (Array.isArray(results)) {
            results.forEach((result: any) => {
              const url = extractUrlFromResult(result)
              if (url) {
                references.push({
                  type: 'mcp_result',
                  id: result.id || result.sha || `mcp-${index}`,
                  activitySource: index,
                  webUrl: url,
                  content: result.message || result.commit?.message || result.title || result.name || ''
                })
              }
            })
          }
        } catch (e) {
          console.warn('Failed to parse MCP output:', e)
        }
      }
    })
  }

  // Extract from traditional tool calls (if present)
  const toolCalls = data.choices?.[0]?.message?.tool_calls || []
  toolCalls.forEach((toolCall: any, index: number) => {
    if (toolCall.type === 'function' && toolCall.function) {
      try {
        const result = JSON.parse(toolCall.function.arguments || '{}')
        if (result.references) {
          references.push(...result.references.map((ref: any) => ({
            ...ref,
            activitySource: index + (data.output?.length || 0)
          })))
        }
        if (result.activity) {
          activity.push(...result.activity)
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  })

  return { references, activity, annotations }
}

export function FoundryAgentChat({ agent, onBack }: FoundryAgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
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
      // Create or use existing conversation
      let currentConversationId = conversationId
      if (!currentConversationId) {
        // Create a new conversation
        const convResponse = await fetch('/api/foundry/conversations', {
          method: 'POST'
        })
        if (convResponse.ok) {
          const convData = await convResponse.json()
          currentConversationId = convData.id
          setConversationId(currentConversationId)
        } else {
          throw new Error('Failed to create conversation')
        }
      }

      // Validate required fields before calling API
      if (!currentConversationId || !messageText || !agent.id) {
        throw new Error('Missing required fields for agent chat')
      }

      // Call Foundry Agent Service via OpenAI responses API
      const response = await fetch('/api/foundry/conversations/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversation_id: currentConversationId,
          input: messageText,
          agent: agent.id,
          version: agent.version
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }))
        console.error('Agent chat API error:', errorData)
        throw new Error(errorData.error || `API error: ${response.status}`)
      }

      const data = await response.json()

      // Extract assistant message text
      const assistantText = extractAssistantText(data)
      
      // Extract references, activity, and annotations from response
      const { references, activity, annotations } = extractReferences(data)

      const assistantMessage: Message = {
        id: Date.now() + '-assistant',
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }],
        timestamp: new Date(),
        references,
        activity,
        annotations,
        debugData: data
      }

      setMessages(prev => prev.slice(0, -1).concat(assistantMessage))

    } catch (error) {
      console.error('Agent Chat API Error:', error)
      
      let errorText = 'Error processing request. Please try again.'
      if (error instanceof Error) {
        errorText = `Error: ${error.message}`
      } else if (typeof error === 'string') {
        errorText = `Error: ${error}`
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
            
            {messages.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setMessages([])
                  setConversationId(null)
                  inputRef.current?.focus()
                }}
                className="gap-2"
              >
                <ChatSparkle20Regular className="w-4 h-4" />
                New Chat
              </Button>
            )}
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
                                      annotations={message.annotations || []}
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

                      {/* Debug view for assistant messages */}
                      {message.role === 'assistant' && !message.isLoading && message.debugData && (
                        <div id={`debug-${message.id}`} className="max-w-full mt-2">
                          <details open className="bg-surface-subtle border border-stroke-divider rounded-lg p-3">
                            <summary className="cursor-pointer text-xs font-medium text-fg-muted hover:text-fg-default flex items-center gap-2">
                              <span>Debug Info</span>
                              {message.debugData.usage && (
                                <span className="text-fg-subtle">
                                  ({message.debugData.usage.total_tokens} tokens)
                                </span>
                              )}
                            </summary>
                            <div className="mt-3 space-y-3 text-xs">
                              {/* Token Usage */}
                              {message.debugData.usage && (
                                <div className="space-y-1">
                                  <div className="font-medium text-fg-default">Token Usage</div>
                                  <div className="grid grid-cols-3 gap-2 text-fg-muted">
                                    <div>
                                      <div className="text-fg-subtle">Input</div>
                                      <div className="font-mono">{message.debugData.usage.input_tokens}</div>
                                    </div>
                                    <div>
                                      <div className="text-fg-subtle">Output</div>
                                      <div className="font-mono">{message.debugData.usage.output_tokens}</div>
                                    </div>
                                    <div>
                                      <div className="text-fg-subtle">Total</div>
                                      <div className="font-mono font-medium">{message.debugData.usage.total_tokens}</div>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* MCP Call Details - Knowledge Retrieval */}
                              {message.debugData.output && Array.isArray(message.debugData.output) && (() => {
                                const mcpCalls = message.debugData.output.filter((item: any) => item.type === 'mcp_call');
                                if (mcpCalls.length === 0) return null;
                                
                                return (
                                  <div className="space-y-1">
                                    <div className="font-medium text-fg-default">Knowledge Retrieval</div>
                                    <div className="space-y-2">
                                      {mcpCalls.map((call: any, idx: number) => {
                                        let parsedInput;
                                        let parsedOutput;
                                        
                                        try {
                                          parsedInput = JSON.parse(call.arguments);
                                        } catch {
                                          parsedInput = call.arguments;
                                        }
                                        
                                        try {
                                          parsedOutput = JSON.parse(call.output);
                                        } catch {
                                          parsedOutput = call.output;
                                        }
                                        
                                        return (
                                          <div key={idx} className="bg-surface-default border border-stroke-divider rounded p-2 space-y-2">
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs font-mono bg-accent/20 text-accent px-2 py-0.5 rounded">
                                                {call.name}
                                              </span>
                                              {call.server_label && (
                                                <span className="text-fg-subtle text-[10px]">
                                                  ({call.server_label})
                                                </span>
                                              )}
                                            </div>
                                            
                                            <div className="space-y-1.5">
                                              <div>
                                                <div className="text-[10px] font-semibold text-fg-muted mb-0.5">Input:</div>
                                                <pre className="text-[10px] bg-surface-subtle border border-stroke-divider p-1.5 rounded overflow-x-auto max-h-32 overflow-y-auto">
                                                  {typeof parsedInput === 'string' ? parsedInput : JSON.stringify(parsedInput, null, 2)}
                                                </pre>
                                              </div>
                                              
                                              <div>
                                                <div className="text-[10px] font-semibold text-fg-muted mb-0.5">Output:</div>
                                                <div className="text-[10px] bg-surface-subtle border border-stroke-divider p-1.5 rounded overflow-x-auto max-h-32 overflow-y-auto">
                                                  {(() => {
                                                    const outputText = typeof parsedOutput === 'string' ? parsedOutput : JSON.stringify(parsedOutput, null, 2);
                                                    // Match URLs in the output
                                                    const urlRegex = /(https?:\/\/[^\s"']+)/g;
                                                    const parts = outputText.split(urlRegex);
                                                    
                                                    return (
                                                      <pre className="whitespace-pre-wrap break-words font-mono">
                                                        {parts.map((part, i) => {
                                                          if (part.match(urlRegex)) {
                                                            return (
                                                              <a
                                                                key={i}
                                                                href={part}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-accent hover:underline"
                                                              >
                                                                {part}
                                                              </a>
                                                            );
                                                          }
                                                          return <span key={i}>{part}</span>;
                                                        })}
                                                      </pre>
                                                    );
                                                  })()}
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Tools Used */}
                              {message.debugData.output && Array.isArray(message.debugData.output) && (
                                <div className="space-y-1">
                                  <div className="font-medium text-fg-default">Tools Used</div>
                                  {message.debugData.output
                                    .filter((item: any) => item.type === 'mcp_list_tools' || item.type === 'mcp_call_tool')
                                    .map((item: any, idx: number) => (
                                      <div key={idx} className="bg-surface-default border border-stroke-divider rounded p-2 space-y-1">
                                        <div className="flex items-center gap-2">
                                          <span className="text-accent font-medium">{item.type}</span>
                                          {item.server_label && (
                                            <span className="text-fg-subtle">({item.server_label})</span>
                                          )}
                                        </div>
                                        {item.tools && Array.isArray(item.tools) && (
                                          <div className="text-fg-muted">
                                            Available: {item.tools.map((t: any) => t.name).join(', ')}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                </div>
                              )}

                              {/* Full Response */}
                              <div className="space-y-1">
                                <div className="font-medium text-fg-default">Full Response</div>
                                <pre className="bg-surface-default border border-stroke-divider rounded p-2 overflow-x-auto text-[10px] leading-relaxed max-h-96 overflow-y-auto">
                                  {JSON.stringify(message.debugData, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </details>
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