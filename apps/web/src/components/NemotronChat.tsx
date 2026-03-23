'use client'

import { useEffect, useRef, useState } from 'react'

type Role = 'user' | 'assistant'

type Message = {
  id: string
  role: Role
  content: string
  thinking?: string
  timestamp: Date
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Keep history within ~3000 tokens (rough: 4 chars ≈ 1 token).
// Always preserves the most recent turns.
function truncateHistory(
  history: { role: string; content: string }[],
  maxTokens = 3000
): { role: string; content: string }[] {
  let tokens = 0
  const result: { role: string; content: string }[] = []
  for (const msg of [...history].reverse()) {
    const size = msg.content.length / 4
    if (tokens + size > maxTokens) break
    result.unshift(msg)
    tokens += size
  }
  return result
}

let messageCounter = 0
function createId(): string {
  return `msg-${++messageCounter}-${Date.now()}`
}

export function NemotronChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: createId(),
      role: 'assistant',
      content:
        "Nemotron online. I can help you craft Runway prompts, review pipeline output, or answer questions about the Splicewerk workflow.",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    }
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return

    const userMessage: Message = {
      id: createId(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    }

    // Capture and truncate history before adding new messages
    const historySnapshot = truncateHistory(
      messages.map(m => ({ role: m.role, content: m.content }))
    )

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setError(null)
    setLoading(true)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    // Add streaming placeholder
    const assistantId = createId()
    setStreamingId(assistantId)
    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      thinking: undefined,
      timestamp: new Date(),
    }])

    const updateMsg = (updater: (m: Message) => Message) =>
      setMessages(prev => prev.map(m => m.id === assistantId ? updater(m) : m))

    try {
      const res = await fetch('/api/nemotron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: historySnapshot }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            const data = JSON.parse(line.slice(5).trim()) as string
            if (currentEvent === 'thinking') {
              updateMsg(m => ({ ...m, thinking: (m.thinking ?? '') + data }))
            } else if (currentEvent === 'token') {
              updateMsg(m => ({ ...m, content: m.content + data }))
            } else if (currentEvent === 'error') {
              setError(data)
            }
            currentEvent = ''
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
      // Remove empty placeholder on hard error
      setMessages(prev => prev.filter(m => m.id !== assistantId || m.content !== ''))
    } finally {
      setLoading(false)
      setStreamingId(null)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Show typing dots only before first token arrives
  const lastMsg = messages[messages.length - 1]
  const showTypingDots = loading && lastMsg?.id === streamingId && lastMsg?.content === '' && !lastMsg?.thinking

  return (
    <section className="bg-card border border-border rounded-lg flex flex-col h-full min-h-[600px] xl:min-h-0 xl:h-[calc(100vh-8rem)] sticky top-20">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
        <div className="w-2 h-2 rounded-full bg-brand-orange shadow-[0_0_8px_#F46E2C]" />
        <div>
          <p className="text-sm font-semibold text-text-primary leading-none">Nemotron</p>
          <p className="text-xs text-text-muted mt-0.5">NVIDIA NIM</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-brand-red/20 border border-brand-red/30 text-text-primary'
                  : 'bg-brand-orange/10 border border-brand-orange/20 text-text-primary'
              }`}
            >
              {/* Thinking section */}
              {msg.thinking && (
                <details className="mb-2">
                  <summary className="text-xs cursor-pointer text-brand-orange/50 hover:text-brand-orange/80 transition-colors select-none">
                    {loading && msg.id === streamingId && !msg.content ? 'Thinking...' : 'Thought process'}
                  </summary>
                  <p className="mt-1.5 pl-2 border-l border-brand-orange/20 text-xs text-text-subtle whitespace-pre-wrap break-words leading-relaxed">
                    {msg.thinking}
                  </p>
                </details>
              )}

              {/* Response content */}
              <p className="whitespace-pre-wrap break-words">
                {msg.content}
                {/* Streaming cursor */}
                {loading && msg.id === streamingId && msg.content && (
                  <span className="inline-block w-1.5 h-3.5 bg-brand-orange/70 animate-pulse ml-0.5 align-middle rounded-sm" />
                )}
              </p>

              <p
                className={`text-xs mt-1.5 ${
                  msg.role === 'user' ? 'text-brand-red/60 text-right' : 'text-brand-orange/60'
                }`}
              >
                {formatTime(msg.timestamp)}
              </p>
            </div>
          </div>
        ))}

        {/* Typing indicator — only before first token */}
        {showTypingDots && (
          <div className="flex justify-start">
            <div className="bg-brand-orange/10 border border-brand-orange/20 rounded-lg px-3.5 py-2.5">
              <div className="flex gap-1.5 items-center h-4">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-orange/60 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-brand-orange/60 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-brand-orange/60 animate-bounce" />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 px-3 py-2 rounded bg-brand-red/15 border border-brand-red/40">
          <p className="text-xs text-brand-red font-medium">{error}</p>
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t border-border px-4 py-3">
        <div className="flex items-end gap-2 bg-input border border-border-input rounded-lg px-3 py-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask Nemotron..."
            disabled={loading}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-subtle resize-none outline-none leading-relaxed disabled:opacity-50"
            style={{ minHeight: '20px', maxHeight: '120px' }}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded bg-brand-orange hover:bg-[#d85e22] text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Send message"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-text-subtle mt-1.5 px-1">
          Enter to send, Shift+Enter for newline
        </p>
      </div>
    </section>
  )
}
