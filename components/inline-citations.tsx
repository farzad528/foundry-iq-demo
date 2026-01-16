import React from 'react'

/**
 * InlineCitationsText
 * Renders text content replacing [ref_id:n] markers with interactive citation chips.
 * Props:
 *  - text: original assistant text containing markers
 *  - references: array of reference objects (optional)
 *  - activity: array of activity objects (optional) to resolve knowledgeSourceName
 *  - annotations: array of annotation objects from Foundry response
 *  - messageId: id of the parent message (used for scroll targets)
 *  - onActivate: optional callback when a citation chip is clicked (receives index & reference)
 *  - className: optional wrapper class
 */
export interface InlineCitationsTextProps {
  text: string
  references?: any[]
  activity?: any[]
  annotations?: any[]
  messageId: string | number
  onActivate?: (idx: number, ref?: any) => void
  className?: string
}

export const InlineCitationsText: React.FC<InlineCitationsTextProps> = ({
  text,
  references = [],
  activity = [],
  annotations = [],
  messageId,
  onActivate,
  className
}) => {
  const render = React.useMemo(() => {
    if (!text) return null
    const nodes: React.ReactNode[] = []
    
    // Helper: Extract knowledge base name from URL
    const extractKBName = (url: string): string | null => {
      const match = url.match(/\/knowledgebases\/([^\/]+)\/mcp/)
      return match ? match[1] : null
    }
    
    // Support three citation formats:
    // 1. [ref_id:N] - Original format from knowledge base API
    // 2. 【message_idx:search_idx†source_name】 - Foundry agent format
    // 3. source #N or source#N - Annotation-based citations from url_citation annotations
    const refIdRegex = /\[ref_id:(\d+)\]/g
    const foundryRegex = /【(\d+):(\d+)†([^】]+)】/g
    const sourceRegex = /source\s*#(\d+)/gi  // Match both "source #1" and "source#1"
    
    let lastIndex = 0
    const matches: Array<{
      index: number,
      length: number,
      refIdx: number,
      label?: string,
      url?: string,
      type: 'ref_id' | 'foundry' | 'annotation'
    }> = []
    
    // Find all [ref_id:N] matches
    let match: RegExpExecArray | null
    while ((match = refIdRegex.exec(text)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        refIdx: parseInt(match[1], 10),
        type: 'ref_id'
      })
    }
    
    // Find all 【message_idx:search_idx†source_name】 matches
    while ((match = foundryRegex.exec(text)) !== null) {
      const messageIdx = parseInt(match[1], 10)
      const searchIdx = parseInt(match[2], 10)
      let sourceName = match[3]
      
      // If source name is generic "source", try to get KB name from annotations
      if (sourceName === 'source' && annotations.length > 0) {
        // Try to find the annotation that corresponds to this citation
        const annotation = annotations.find((ann: any) => 
          ann.type === 'url_citation' && 
          ann.start_index <= match.index && 
          ann.end_index >= (match.index + match[0].length)
        )
        
        if (annotation && annotation.url) {
          const kbName = extractKBName(annotation.url)
          if (kbName) {
            sourceName = kbName
          }
        }
      }
      
      matches.push({
        index: match.index,
        length: match[0].length,
        refIdx: searchIdx,
        label: sourceName,
        type: 'foundry'
      })
    }
    
    // Find all "source #N" matches and map to annotations
    while ((match = sourceRegex.exec(text)) !== null) {
      const annotationIdx = parseInt(match[1], 10) - 1 // Annotations are 1-indexed
      const annotation = annotations[annotationIdx]
      
      if (annotation && annotation.type === 'url_citation') {
        const kbName = annotation.url ? extractKBName(annotation.url) : null
        
        matches.push({
          index: match.index,
          length: match[0].length,
          refIdx: annotationIdx,
          label: kbName || annotation.title || `source #${match[1]}`,
          url: annotation.url,
          type: 'annotation'
        })
      }
    }
    
    // Sort matches by index
    matches.sort((a, b) => a.index - b.index)
    
    // Render text with citation chips
    matches.forEach((citationMatch) => {
      // Add text before citation
      if (citationMatch.index > lastIndex) {
        nodes.push(text.slice(lastIndex, citationMatch.index))
      }
      
      const { refIdx, label: providedLabel, url: annotationUrl, type } = citationMatch
      const ref = references[refIdx]
      const activityEntry = ref ? activity.find((a: any) => a.id === ref.activitySource) : undefined
      
      // Determine citation label
      let label: string
      if (type === 'annotation') {
        // For annotations, use the provided label (KB name or title)
        label = providedLabel || `source #${refIdx + 1}`
      } else {
        label = providedLabel || 
                (ref ? (activityEntry?.knowledgeSourceName || 
                        (ref.blobUrl ? decodeURIComponent(ref.blobUrl.split('/').pop() || ref.id) : (ref.docKey || ref.id)) || 
                        `Reference ${refIdx + 1}`) : 
                 `Reference ${refIdx + 1}`)
      }
      
      // Get citation URL
      const citationUrl = annotationUrl || ref?.blobUrl || (ref as any)?.webUrl || (ref as any)?.url || (ref as any)?.docUrl || ref?.docKey || null
      const isValidUrl = citationUrl && (citationUrl.startsWith('http://') || citationUrl.startsWith('https://'))
      const tooltipText = citationUrl ? `${label}\\n\\nURL: ${citationUrl}` : label
      
      // Render citation chip (link or button)
      const chipClassName = "align-baseline inline-flex items-center gap-1 ml-1 mb-0.5 px-1.5 py-0.5 rounded bg-accent-subtle hover:bg-accent/20 hover:underline underline-offset-2 text-accent text-[10px] font-medium transition focus:outline-none focus:ring-1 focus:ring-accent max-w-[170px]"
      const chipContent = (
        <>
          <span className="truncate max-w-[130px]">{label}</span>
          <span className="text-[8px] opacity-70">#{refIdx + 1}</span>
        </>
      )
      
      const handleClick = (e?: React.MouseEvent) => {
        e?.preventDefault()
        
        if (onActivate) {
          onActivate(refIdx, ref)
        }
        
        // For annotation-based citations, scroll to debug info
        if (type === 'annotation') {
          const debugSection = document.getElementById(`debug-${messageId}`)
          if (debugSection) {
            debugSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
            // Open the details element if collapsed
            const detailsElement = debugSection.querySelector('details')
            if (detailsElement && !detailsElement.open) {
              detailsElement.open = true
            }
            // Highlight briefly
            debugSection.classList.add('ring-2', 'ring-accent', 'ring-offset-1')
            setTimeout(() => debugSection.classList.remove('ring-2', 'ring-accent', 'ring-offset-1'), 1400)
          }
        } else {
          // For traditional citations, open URL in new tab if valid
          if (isValidUrl && citationUrl) {
            window.open(citationUrl, '_blank', 'noopener,noreferrer')
          }
          // Scroll to reference block
          const el = document.getElementById(`ref-${messageId}-${refIdx}`)
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            el.classList.add('ring-2', 'ring-accent', 'ring-offset-1')
            setTimeout(() => el.classList.remove('ring-2', 'ring-accent', 'ring-offset-1'), 1400)
          }
        }
      }
      
      if (type === 'annotation' || isValidUrl) {
        nodes.push(
          <a
            key={`cite-${citationMatch.index}`}
            href={type === 'annotation' ? `#debug-${messageId}` : citationUrl!}
            target={type === 'annotation' ? undefined : "_blank"}
            rel={type === 'annotation' ? undefined : "noopener noreferrer"}
            onClick={handleClick}
            aria-label={`View reference ${label}`}
            title={tooltipText}
            className={chipClassName}
          >
            {chipContent}
          </a>
        )
      } else {
        nodes.push(
          <button
            key={`cite-${citationMatch.index}`}
            type="button"
            onClick={() => handleClick()}
            aria-label={`View reference ${label}`}
            title={tooltipText}
            className={chipClassName}
          >
            {chipContent}
          </button>
        )
      }
      
      lastIndex = citationMatch.index + citationMatch.length
    })
    
    // Add remaining text
    if (lastIndex < text.length) {
      nodes.push(text.slice(lastIndex))
    }
    
    return nodes
  }, [text, references, activity, annotations, messageId, onActivate])

  return <span className={className}>{render}</span>
}
