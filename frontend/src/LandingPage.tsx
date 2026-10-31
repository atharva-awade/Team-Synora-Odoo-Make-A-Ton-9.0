import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown, ArrowRight, ArrowUpRight, Bot, Check, ChevronRight,
  Clock3, Compass, CreditCard, Layers3, LockKeyhole, RefreshCw, ShieldCheck,
  Sparkles, Workflow,
} from 'lucide-react'
import revenueEngine from './assets/brightloop-revenue-engine.png'
import RevenueEngineScene from './RevenueEngineScene'
import './LandingPage.css'

type Chapter = { id: string; number: string; eyebrow: string; title: string; copy: string; points: string[]; visual: 'lifecycle' | 'billing' | 'reconcile' | 'finance' | 'time' | 'guide' }

const chapters: Chapter[] = [
  { id: 'lifecycle', number: '01', eyebrow: 'ONE CONNECTED LIFECYCLE', title: 'From first quote to the next renewal.', copy: 'Move each customer relationship through a clear, plan-aware journey. Your team sees the whole story in one workspace.', points: ['Reusable quotation templates', 'Guided subscription states', 'Plan-controlled pause, renewal, and close'], visual: 'lifecycle' },
  { id: 'billing', number: '02', eyebrow: 'BILLING WITH A MEMORY', title: 'Recurring billing you can trust.', copy: 'Brightloop keeps each billing period distinct, carries add-on proration forward, and keeps invoice balances in step with every payment.', points: ['Idempotent invoice generation', 'Taxes, discounts, and partial payments', 'A clear invoice and payment trail'], visual: 'billing' },
  { id: 'reconcile', number: '03', eyebrow: 'EXPLAINABLE MATCHING', title: 'Make every payment easier to place.', copy: 'Bring in a bank statement and review the signals behind a suggested invoice match. A person confirms before any balance changes.', points: ['Reference, amount, payer, and date signals', 'Confidence with a plain-language reason', 'Human confirmation before posting'], visual: 'reconcile' },
  { id: 'finance', number: '04', eyebrow: 'FINANCE, IN CONTEXT', title: 'See the signal behind the number.', copy: 'Read recurring revenue, margin, collections, and overdue exposure together, then move from a portfolio view into the work that needs attention.', points: ['MRR and ARR with collection totals', 'Receivables aging and overdue exposure', 'Role-aware customer and finance views'], visual: 'finance' },
  { id: 'time', number: '05', eyebrow: 'A WORKSPACE THAT MOVES WITH TIME', title: 'Explore the full billing rhythm.', copy: 'Advance the persisted demo clock to see billing, quote expiry, renewals, and staged reminders unfold against one coherent business date.', points: ['Day, week, month, or custom advance', 'Renewal heads-ups and overdue reminders', 'A local outbox and auditable event trail'], visual: 'time' },
  { id: 'guide', number: '06', eyebrow: 'A GUIDE THAT KNOWS ITS BOUNDARIES', title: 'Answers grounded in your workspace.', copy: 'Brightloop Guide can explain the product and look up the records visible to the person signed in. It stays read-only and shows where answers came from.', points: ['Role-scoped workspace lookups', 'Product guide and source references', 'Read-only by design'], visual: 'guide' },
]

export default function LandingPage({ onSignIn }: { onSignIn: () => void }) {
  const [active, setActive] = useState(chapters[0].id)
  const storyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const reveal = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add('is-visible') })
    }, { threshold: 0.14 })
    document.querySelectorAll('.landing-reveal').forEach((element) => reveal.observe(element))

    const sections = document.querySelectorAll<HTMLElement>('[data-chapter]')
    const story = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (visible) setActive((visible.target as HTMLElement).dataset.chapter ?? chapters[0].id)
    }, { rootMargin: '-24% 0px -42% 0px', threshold: [0.12, 0.3, 0.52] })
    sections.forEach((section) => story.observe(section))
    return () => { reveal.disconnect(); story.disconnect() }
  }, [])

  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return <div className="landing-page" id="top">
    <header className="landing-nav">
      <a className="landing-brand" href="#top" aria-label="Brightloop home" onClick={(event) => { event.preventDefault(); goTo('top') }}>
        <span className="landing-brand-mark"><i /><i /><i /></span><span><b>brightloop</b><small>REVENUE OS</small></span>
      </a>
      <nav className="landing-nav-links" aria-label="Main navigation">
        <button onClick={() => goTo('journey')}>Platform</button><button onClick={() => goTo('guide')}>Brightloop Guide</button>
      </nav>
      <button className="landing-nav-cta" onClick={onSignIn}>Open workspace <ArrowUpRight size={15} /></button>
    </header>

    <main>
      <div className="landing-story-layout" ref={storyRef}>
        <div className="revenue-stage" role="region" aria-label="Brightloop revenue engine, linked to the product chapters">
          <RevenueEngineScene activeIndex={Math.max(0, chapters.findIndex((chapter) => chapter.id === active))} scrollSource={storyRef} />
          <div className="revenue-stage-caption"><span><i /> LIVE REVENUE ENGINE</span><span>Scroll to explore</span></div>
        </div>

        <aside className="story-rail" aria-label="Product features">
          <span className="story-rail-label">THE PLATFORM</span>
          <div className="story-rail-items">{chapters.map((chapter) => <button key={chapter.id} className={active === chapter.id ? 'active' : ''} aria-current={active === chapter.id ? 'step' : undefined} onClick={() => goTo(chapter.id)}><span>{chapter.number}</span><b>{chapter.eyebrow.replace('ONE CONNECTED ', '').replace(' A ', ' ')}</b></button>)}</div>
          <div className="story-rail-foot"><LockKeyhole size={14} /> Your role sets the view.</div>
        </aside>

        <div className="story-narrative">
          <section className="landing-hero" data-chapter="lifecycle">
            <div className="landing-hero-copy">
          <div className="landing-kicker"><span className="landing-live-dot" /> SUBSCRIPTION OPERATIONS, IN SYNC</div>
          <h1>Recurring revenue,<br /><em>in a state of flow.</em></h1>
          <p>One composed workspace for the lifecycle behind every subscription, from the first quote to the next renewal.</p>
          <div className="landing-hero-actions"><button className="landing-button landing-button-primary" onClick={() => goTo('journey')}>Explore Brightloop <ArrowDown size={16} /></button><button className="landing-text-button" onClick={onSignIn}>Go to your workspace <ArrowRight size={15} /></button></div>
          <div className="landing-proof"><span><ShieldCheck size={15} /> Role-aware by design</span><span><Workflow size={15} /> One connected lifecycle</span></div>
            </div>
            <button className="landing-scroll-cue" onClick={() => goTo('journey')} aria-label="Scroll to explore the product"><span>THE BRIGHTLOOP JOURNEY</span><ArrowDown size={15} /></button>
          </section>

          <section className="landing-intro landing-reveal" id="journey">
            <div className="intro-overline"><span>THE WHOLE REVENUE STORY</span><i /></div>
            <h2>More than a billing screen.<br /><em>A calmer way to run subscriptions.</em></h2>
            <p>Follow one connected operating rhythm, built for the people who sell, serve, and understand recurring revenue.</p>
          </section>

          <div className="story-chapters">{chapters.map((chapter) => <ChapterSection key={chapter.id} chapter={chapter} />)}</div>
        </div>
      </div>

      <section className="landing-final landing-reveal">
        <div className="final-orbit final-orbit-a" /><div className="final-orbit final-orbit-b" />
        <div className="final-content"><span className="landing-kicker"><Sparkles size={13} /> THE NEXT CYCLE STARTS HERE</span><h2>Bring every recurring<br /><em>moment into focus.</em></h2><p>Open Brightloop OS and see how your team can move through the full subscription lifecycle.</p><button className="landing-button landing-button-light" onClick={onSignIn}>Enter Brightloop <ArrowUpRight size={16} /></button><div className="final-caption"><ShieldCheck size={14} /> Secure session · role-aware workspace</div></div>
        <div className="final-orb" aria-hidden="true"><img src={revenueEngine} alt="" /></div>
      </section>
      <footer className="landing-footer"><a className="landing-brand" href="#top" onClick={(event) => { event.preventDefault(); goTo('top') }}><span className="landing-brand-mark"><i /><i /><i /></span><span><b>brightloop</b><small>REVENUE OS</small></span></a><span>One clear view of the recurring revenue journey.</span><button onClick={onSignIn}>Open workspace <ArrowRight size={14} /></button></footer>
    </main>
  </div>
}

function ChapterSection({ chapter }: { chapter: Chapter }) {
  return <section className={`story-chapter story-${chapter.visual}`} id={chapter.id} data-chapter={chapter.id}>
    <div className="chapter-copy landing-reveal"><span className="chapter-number">{chapter.number} <i /></span><span className="landing-kicker">{chapter.eyebrow}</span><h3>{chapter.title}</h3><p>{chapter.copy}</p><ul>{chapter.points.map((point) => <li key={point}><Check size={15} />{point}</li>)}</ul></div>
    <div className="chapter-visual landing-reveal"><ChapterVisual kind={chapter.visual} /></div>
  </section>
}

function ChapterVisual({ kind }: { kind: Chapter['visual'] }) {
  if (kind === 'lifecycle') return <div className="visual-window lifecycle-window"><div className="visual-window-top"><span><i /> LIVE SUBSCRIPTION PATH</span><MoreDots /></div><div className="lifecycle-path"><div className="lifecycle-node done"><span><Check size={15} /></span><small>01</small><b>Quote</b></div><i className="path-line done" /><div className="lifecycle-node done"><span><Layers3 size={15} /></span><small>02</small><b>Activate</b></div><i className="path-line active" /><div className="lifecycle-node current"><span><RefreshCw size={15} /></span><small>03</small><b>Renew</b></div></div><div className="lifecycle-bottom"><span><span className="mini-status" /> Plan rules applied</span><ChevronRight size={15} /></div><div className="lifecycle-float"><span className="glass-card-icon mint"><Workflow size={15} /></span><span><small>PLAN-AWARE</small><b>Every state has a rule</b></span></div></div>
  if (kind === 'billing') return <div className="visual-window billing-window"><div className="billing-aura" /><div className="billing-heading"><span className="glass-card-icon lilac"><CreditCard size={17} /></span><span><small>RECURRING BILLING</small><b>Invoice lifecycle</b></span><span className="visual-tag">IDEMPOTENT</span></div><div className="billing-invoice"><div><span className="invoice-mark"><Layers3 size={16} /></span><span><small>SUBSCRIPTION INVOICE</small><b>One period. One invoice.</b></span></div><i><Check size={14} /></i></div><div className="billing-flow"><span>Generate</span><i /><span>Confirm</span><i /><span>Settle</span></div><div className="billing-proration"><span><RefreshCw size={14} /> Add-on adjustment carried forward</span><ArrowRight size={14} /></div></div>
  if (kind === 'reconcile') return <div className="visual-window reconcile-window"><div className="visual-window-top"><span><i /> MATCH REVIEW</span><span className="visual-tag">HUMAN CONFIRMATION</span></div><div className="match-record bank-record"><span className="record-icon bank"><CreditCard size={15} /></span><span><small>BANK TRANSACTION</small><b>Payment received</b></span><span className="record-amount">Amount</span></div><div className="match-connector"><i /><span>MATCH SIGNALS</span><i /></div><div className="match-signal-grid"><span><Check size={12} /> Reference</span><span><Check size={12} /> Amount</span><span><Check size={12} /> Payer</span><span><Check size={12} /> Date</span></div><div className="match-record invoice-record"><span className="record-icon invoice"><Layers3 size={15} /></span><span><small>SUGGESTED INVOICE</small><b>Best-fit invoice</b></span><span className="review-pill">REVIEW</span></div><div className="match-confirm"><ShieldCheck size={15} /> Review the reason, then confirm the match</div></div>
  if (kind === 'finance') return <div className="visual-window finance-window"><div className="finance-window-head"><span><small>FINANCE OVERVIEW</small><b>Every signal, together.</b></span><span className="finance-avatar">BL</span></div><div className="finance-kpis"><div><small>RECURRING</small><b>MRR <i /></b><span>Active subscriptions</span></div><div><small>COLLECTIONS</small><b>In view <i /></b><span>Paid and outstanding</span></div></div><div className="finance-chart"><div className="chart-title"><span>Receivables aging</span><span>View detail <ArrowUpRight size={12} /></span></div><div className="chart-bars">{[36, 54, 42, 69, 58, 80, 64, 91, 73, 98, 77, 88].map((height, index) => <i key={index} style={{ height: `${height}%`, animationDelay: `${index * 45}ms` }} />)}</div><div className="chart-x"><span>01</span><span>05</span><span>10</span><span>15</span></div></div><div className="finance-foot"><span><i className="finance-dot" /> Role-aware summary</span><span>Live workspace</span></div></div>
  if (kind === 'time') return <div className="visual-window time-window"><div className="time-glow" /><div className="time-head"><span className="glass-card-icon mint"><Clock3 size={16} /></span><span><small>TIME ENGINE</small><b>Move through the cycle</b></span><span className="visual-tag">PERSISTED</span></div><div className="time-wheel"><div className="time-wheel-ring ring-a" /><div className="time-wheel-ring ring-b" /><div className="time-wheel-core"><Clock3 size={25} /><b>DAY</b></div><span className="time-tick tick-a">+1</span><span className="time-tick tick-b">+7</span><span className="time-tick tick-c">+1M</span></div><div className="time-events"><span><i className="event-dot purple" /> Billing due</span><span><i className="event-dot green" /> Renewal heads-up</span><span><i className="event-dot amber" /> Reminder staged</span></div></div>
  return <div className="visual-window guide-window"><div className="guide-top"><span className="guide-avatar"><Bot size={18} /></span><span><small>BRIGHTLOOP GUIDE</small><b>Workspace-aware help</b></span><span className="guide-presence" /></div><div className="guide-chat"><div className="guide-message guide-user">How are bank matches confirmed?</div><div className="guide-message guide-answer">Brightloop suggests a match using invoice reference, amount, payer, and date. A staff member reviews the reason and confirms it before the payment is recorded.</div><div className="guide-sources"><span><Compass size={11} /> Product guide</span><span><Layers3 size={11} /> Reconciliation workflow</span></div></div><div className="guide-input"><span>Ask about your workspace…</span><span><ArrowUpRight size={14} /></span></div><div className="guide-readonly"><LockKeyhole size={12} /> Read-only answers · visible records only</div></div>
}

function MoreDots() { return <span className="visual-more"><i /><i /><i /></span> }
