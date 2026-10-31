import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, BookOpen, Bot, LoaderCircle, MessageCircle, Send, Sparkles, X } from 'lucide-react'
import './AssistantWidget.css'

type Page = 'overview' | 'subscriptions' | 'billing' | 'payments' | 'catalog' | 'reports'
type ChatMessage = { role: 'user' | 'assistant'; content: string; sources?: string[]; id: number }
type AssistantReply = { reply: string; sources: string[] }

const prompts: Record<Page, string[]> = {
  overview: ['What needs attention today?', 'How is MRR calculated?'],
  subscriptions: ['How do renewals work?', 'Find my active subscriptions'],
  billing: ['Explain the invoice lifecycle', 'Show my overdue invoices'],
  payments: ['How are matches scored?', 'Find recent payments'],
  catalog: ['How do plan rules work?', 'Explain the margin guard'],
  reports: ['Summarize the finance view', 'What is in receivables aging?'],
}

export default function AssistantWidget({ page, focusNumber }: { page: Page; focusNumber: string }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const transcriptRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending, open])

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 160)
  }, [open])

  const send = async (text: string) => {
    const content = text.trim()
    if (!content || sending) return
    const userMessage: ChatMessage = { role: 'user', content, id: nextId.current++ }
    setMessages((current) => [...current, userMessage])
    setDraft('')
    setError('')
    setSending(true)
    try {
      const history = [...messages, userMessage].slice(-10).map(({ role, content: body }) => ({ role, content: body }))
      const response = await fetch('/api/assistant/chat', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, history: history.slice(0, -1), page, focus_number: focusNumber }),
      })
      const result = await response.json().catch(() => ({})) as AssistantReply & { detail?: string }
      if (!response.ok) throw new Error(result.detail || 'Brightloop Guide could not answer right now.')
      setMessages((current) => [...current, { role: 'assistant', content: result.reply, sources: result.sources ?? [], id: nextId.current++ }])
    } catch (reason) {
      setMessages((current) => current.filter((item) => item.id !== userMessage.id))
      setError(reason instanceof Error ? reason.message : 'Brightloop Guide could not answer right now.')
    } finally { setSending(false) }
  }

  return <>
    {open && <section className="guide-widget" role="dialog" aria-label="Brightloop Guide">
      <header className="guide-widget-head"><span className="guide-widget-mark"><Bot size={18} /></span><div><b>Brightloop Guide</b><small><i /> Workspace-aware assistance</small></div><button className="guide-close" onClick={() => setOpen(false)} aria-label="Close Brightloop Guide"><X size={17} /></button></header>
      <div className="guide-widget-context"><BookOpen size={13} /><span>Grounded in your product guide and visible workspace</span></div>
      <div className="guide-widget-transcript" ref={transcriptRef} aria-live="polite">
        {!messages.length && <div className="guide-welcome"><span className="guide-welcome-icon"><Sparkles size={19} /></span><b>What can I help you find?</b><p>Ask how a workflow works or look up information available to your role.</p><div className="guide-starters">{prompts[page].map((prompt) => <button key={prompt} onClick={() => void send(prompt)}>{prompt}<ArrowUpRight size={12} /></button>)}</div></div>}
        {messages.map((message) => <article className={`guide-bubble guide-bubble-${message.role}`} key={message.id}><div className="guide-bubble-copy">{message.content}</div>{Boolean(message.sources?.length) && <div className="guide-source-list"><span>Sources</span>{message.sources?.map((source) => <span className="guide-source-chip" key={source}>{source}</span>)}</div>}</article>)}
        {sending && <div className="guide-thinking"><span><i /><i /><i /></span><small>Checking the workspace…</small></div>}
        {error && <div className="guide-error" role="alert">{error}</div>}
      </div>
      <form className="guide-compose" onSubmit={(event) => { event.preventDefault(); void send(draft) }}><input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1800} placeholder="Ask about Brightloop…" aria-label="Ask Brightloop Guide" disabled={sending} /><button type="submit" disabled={!draft.trim() || sending} aria-label="Send message">{sending ? <LoaderCircle size={16} className="guide-spinner" /> : <Send size={15} />}</button></form>
      <footer className="guide-widget-foot">Read-only · respects your workspace access</footer>
    </section>}
    <button className={`guide-launcher ${open ? 'guide-launcher-open' : ''}`} onClick={() => setOpen((value) => !value)} aria-label={open ? 'Close Brightloop Guide' : 'Open Brightloop Guide'}><span className="guide-launcher-icon">{open ? <X size={20} /> : <Sparkles size={19} />}</span><span className="guide-launcher-copy"><b>Brightloop Guide</b><small>Ask your workspace</small></span><MessageCircle className="guide-launcher-chat" size={16} /></button>
  </>
}
