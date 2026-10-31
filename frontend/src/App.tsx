import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, ArrowLeft, ArrowRight, ArrowUpRight, CalendarClock, Check, ChevronDown,
  ChevronRight, CircleHelp, Clock3, CreditCard, Download, FileText, Filter, LayoutDashboard,
  LogOut, Mail, Menu, MoreHorizontal, Plus, Search, Settings2, ShieldCheck,
  Sparkles, Users, WalletCards, X, Zap, Boxes, Repeat2, BarChart3, ExternalLink, Upload,
} from 'lucide-react'
import LandingPage from './LandingPage'
import AssistantWidget from './AssistantWidget'
import './App.css'

type Role = 'ADMIN' | 'STAFF' | 'CUSTOMER'
type Page = 'overview' | 'subscriptions' | 'billing' | 'payments' | 'catalog' | 'reports'
type User = { id: number; email: string; full_name: string; company_name: string; role: Role }
type Line = { id?: number; product_id: number; product_name: string; variant_id?: number | null; variant_name?: string; quantity: number; unit_price_cents: number; unit_cost_cents?: number; pending_proration_cents?: number; tax_rate_basis_points: number; is_addon: boolean; is_active?: boolean }
type Subscription = { id: number; number: string; customer_id: number; customer_name: string; customer_email: string; plan_id: number; plan_name: string; billing_interval: string; status: string; start_date: string; expiry_date: string; quote_valid_until?: string | null; quote_expired: boolean; next_billing_date: string; payment_terms: string; discount_id?: number | null; discount_code: string; subtotal_cents: number; cost_cents?: number; margin_cents?: number; margin_percent?: number; plan_flags: { allow_pause: boolean; allow_early_close: boolean; allow_renew: boolean; auto_close_on_end: boolean }; lines: Line[] }
type Invoice = { id: number; number: string; subscription_id: number; subscription_number: string; customer_id: number; customer_name: string; customer_email: string; billing_period_start: string; billing_period_end: string; issue_date: string; due_date: string; status: string; payment_state: string; subtotal_cents: number; discount_cents: number; tax_cents: number; total_cents: number; amount_paid_cents: number; amount_due_cents: number; discount_code: string; discount_note: string; dunning_stage: number; lines: { description: string; quantity: number; unit_price_cents: number; total_cents: number }[] }
type Summary = { as_of: string; active_subscriptions: number; paused_subscriptions: number; closed_subscriptions: number; quotations_pending: number; revenue_collected_cents: number; outstanding_cents: number; overdue_count: number; overdue_cents: number; mrr_cents: number; arr_cents: number; gross_margin_percent: number | null; aging_cents: Record<string, number>; recent_invoices: Invoice[] }
type Catalog = { products: Product[]; plans: Plan[]; taxes: Tax[]; discounts: Discount[]; templates: Template[] }
type Product = { id: number; sku: string; name: string; product_type: string; sales_price_cents: number; cost_price_cents?: number; notes: string; variants: Variant[] }
type Variant = { id: number; attribute_name: string; attribute_value: string; price_delta_cents: number; cost_delta_cents: number }
type Plan = { id: number; code: string; name: string; description: string; billing_interval: string; min_quantity: number; available_from: string | null; available_to: string | null; auto_close_on_end: boolean; allow_early_close: boolean; allow_pause: boolean; allow_renew: boolean; default_duration_days: number }
type Tax = { id: number; name: string; rate_basis_points: number; is_default: boolean }
type Discount = { id: number; code: string; name: string; discount_type: string; value: number; scope: string; min_purchase_cents: number; min_quantity: number; start_date: string; end_date: string; max_uses: number | null; current_uses: number; product_ids: number[] }
type Template = { id: number; name: string; description: string; plan_id: number; validity_days: number; payment_terms: string; lines: { product_id: number; variant_id?: number | null; quantity: number; tax_rule_id: number | null }[] }
type OutboxItem = { id: number; recipient: string; subject: string; body: string; action_url: string; related_type: string; created_virtual_date: string; is_read: boolean }
type Customer = { id: number; name: string; email: string }
type ReconciliationItem = { id: number; batch_id: number; row_number: number; bank_reference: string; memo: string; payer: string; amount_cents: number; transaction_date: string; invoice_id: number | null; invoice_number: string; customer_name: string; balance_due_cents: number | null; match_score: number; match_reason: string; status: 'SUGGESTED' | 'UNMATCHED' | 'CONFIRMED' | 'SKIPPED'; payment_id: number | null }
type Toast = { kind: 'success' | 'error'; message: string }

const API = ''
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format((cents || 0) / 100)
const dateLabel = (value?: string | null) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not available'
const initials = (value: string) => value.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API}${path}`, { ...init, headers, credentials: 'include' })
  const latency = response.headers.get('X-Execution-Time-Ms')
  if (latency && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('brightloop:latency', { detail: Number(latency) }))
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.')
  return data as T
}

const navItems: { id: Page; label: string; icon: typeof LayoutDashboard; group: string }[] = [
  { id: 'overview', label: 'Command center', icon: LayoutDashboard, group: 'Workspace' },
  { id: 'subscriptions', label: 'Subscriptions', icon: Repeat2, group: 'Workspace' },
  { id: 'billing', label: 'Billing & invoices', icon: FileText, group: 'Workspace' },
  { id: 'payments', label: 'Payments', icon: CreditCard, group: 'Workspace' },
  { id: 'catalog', label: 'Catalog & plans', icon: Boxes, group: 'Manage' },
  { id: 'reports', label: 'Revenue reports', icon: BarChart3, group: 'Manage' },
]

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [showLogin, setShowLogin] = useState(() => Boolean(new URLSearchParams(window.location.search).get('token')) || new URLSearchParams(window.location.search).get('signin') === '1')
  const [page, setPage] = useState<Page>('overview')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [outbox, setOutbox] = useState<OutboxItem[]>([])
  const [audit, setAudit] = useState<{ id: number; action: string; detail: string; virtual_date: string; entity_type: string }[]>([])
  const [reconciliationRows, setReconciliationRows] = useState<ReconciliationItem[]>([])
  const [virtualDate, setVirtualDate] = useState('2026-10-31')
  const [customTimeDate, setCustomTimeDate] = useState('2026-10-31')
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [outboxOpen, setOutboxOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [modal, setModal] = useState<'quote' | 'payment' | 'product' | 'plan' | 'tax' | 'discount' | 'staff' | 'variant' | null>(null)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [printInvoice, setPrintInvoice] = useState<Invoice | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedSubscription, setSelectedSubscription] = useState<Subscription | null>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const hasResetToken = Boolean(new URLSearchParams(window.location.search).get('token'))

  const openLogin = () => {
    setShowLogin(true)
    window.history.replaceState({}, '', `${window.location.pathname}?signin=1`)
  }
  const closeLogin = () => {
    setShowLogin(false)
    window.history.replaceState({}, '', window.location.pathname)
  }

  const notify = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    setToast({ message, kind })
    window.setTimeout(() => setToast(null), 3600)
  }, [])

  const refresh = useCallback(async (signedInUser?: User) => {
    const current = signedInUser ?? user
    if (!current) return
    const [summaryResult, subscriptionResult, invoiceResult, catalogResult, timeResult, outboxResult, reconciliationResult] = await Promise.all([
      api<Summary>('/api/finance/summary'),
      api<{ items: Subscription[] }>('/api/subscriptions?limit=300'),
      api<{ items: Invoice[] }>('/api/invoices?limit=300'),
      api<Catalog>('/api/catalog'),
      api<{ virtual_date: string }>('/api/time'),
      api<{ items: OutboxItem[] }>('/api/outbox'),
      api<{ items: ReconciliationItem[] }>('/api/payments/reconcile').catch(() => ({ items: [] })),
    ])
    setSummary(summaryResult)
    setSubscriptions(subscriptionResult.items)
    setInvoices(invoiceResult.items)
    setCatalog(catalogResult)
    setVirtualDate(timeResult.virtual_date)
    setOutbox(outboxResult.items)
    setReconciliationRows(reconciliationResult.items)
    setSelectedSubscription((current) => current ? subscriptionResult.items.find((item) => item.id === current.id) ?? null : null)
    if (current.role !== 'CUSTOMER') {
      const [customerResult, auditResult] = await Promise.all([
        api<{ items: Customer[] }>('/api/users/customers').catch(() => ({ items: [] })),
        api<{ items: typeof audit }>('/api/audit').catch(() => ({ items: [] })),
      ])
      setCustomers(customerResult.items)
      setAudit(auditResult.items)
    } else {
      setCustomers([])
      setAudit([])
    }
  }, [user])

  useEffect(() => {
    api<{ user: User }>('/api/auth/me')
      .then(({ user: current }) => { setUser(current); return refresh(current) })
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true))
  }, []) // initial session restore

  useEffect(() => {
    const update = (event: Event) => setLatencyMs((event as CustomEvent<number>).detail)
    window.addEventListener('brightloop:latency', update)
    return () => window.removeEventListener('brightloop:latency', update)
  }, [])

  useEffect(() => {
    if (!printInvoice) return
    const timer = window.setTimeout(() => window.print(), 120)
    const close = () => setPrintInvoice(null)
    window.addEventListener('afterprint', close)
    return () => { window.clearTimeout(timer); window.removeEventListener('afterprint', close) }
  }, [printInvoice])

  const run = useCallback(async (action: () => Promise<unknown>, successMessage?: string) => {
    setBusy(true)
    try {
      await action()
      if (user) await refresh(user)
      if (successMessage) notify(successMessage)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The action could not be completed.', 'error')
    } finally {
      setBusy(false)
    }
  }, [notify, refresh, user])

  const signIn = async (persona: 'ADMIN' | 'STAFF' | 'FINANCE' | 'CUSTOMER') => {
    setBusy(true)
    try {
      const result = await api<{ user: User }>('/api/auth/demo-login', { method: 'POST', body: JSON.stringify({ persona }) })
      setUser(result.user)
      setPage('overview')
      await refresh(result.user)
      notify(`Signed in as ${persona === 'FINANCE' ? 'Finance Lead' : persona.toLowerCase()}.`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not sign in.', 'error')
    } finally { setBusy(false) }
  }

  const signInWithEmail = async (email: string, password: string) => {
    setBusy(true)
    try {
      const result = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      setUser(result.user)
      setPage('overview')
      await refresh(result.user)
      notify(`Welcome back, ${result.user.full_name.split(' ')[0]}.`)
    } catch (error) { throw error }
    finally { setBusy(false) }
  }

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    setUser(null)
    setSummary(null)
    setSubscriptions([])
    setInvoices([])
  }

  const advanceTime = (days?: number, months?: number, targetDate?: string) => run(async () => {
    const body = targetDate ? { target_date: targetDate } : { days, months }
    const result = await api<{ virtual_date: string; summary: { billing: { generated: number }; dunning_messages: number; prebilling_messages: number } }>('/api/time/advance', { method: 'POST', body: JSON.stringify(body) })
    setVirtualDate(result.virtual_date)
    setCustomTimeDate(result.virtual_date)
    notify(`${dateLabel(result.virtual_date)} · ${result.summary.billing.generated} invoices · ${result.summary.prebilling_messages} renewal heads-ups · ${result.summary.dunning_messages} dunning messages`)
  })

  const runBilling = () => run(async () => {
    const result = await api<{ generated: number; skipped: number }>('/api/billing/run', { method: 'POST', body: '{}' })
    notify(result.generated ? `${result.generated} invoice${result.generated === 1 ? '' : 's'} generated.` : 'Everything due for this billing period has already been billed.')
  })

  const seedStressData = () => run(async () => {
    const result = await api<{ subscriptions_seeded: number; invoices_seeded: number; payments_seeded: number }>('/api/system/seed-stress-test', { method: 'POST', body: '{}' })
    notify(`Scale dataset added · ${result.subscriptions_seeded.toLocaleString()} subscriptions · ${result.invoices_seeded.toLocaleString()} invoices · ${result.payments_seeded.toLocaleString()} payments`)
  })

  const transition = (sub: Subscription, target_status: string) => run(async () => {
    await api(`/api/subscriptions/${sub.id}/status`, { method: 'PATCH', body: JSON.stringify({ target_status }) })
    if (selectedSubscription?.id === sub.id) setSelectedSubscription(null)
  }, `Subscription ${sub.number} moved to ${target_status.toLowerCase()}.`)

  const invoiceAction = (invoice: Invoice, action: string) => run(async () => {
    await api(`/api/invoices/${invoice.id}/action`, { method: 'POST', body: JSON.stringify({ action }) })
    if (action === 'PRINT') setPrintInvoice(invoice)
  }, action === 'SEND' ? `Invoice ${invoice.number} added to the local outbox.` : action === 'CONFIRM' ? `Invoice ${invoice.number} confirmed.` : undefined)

  const recordPayment = async (invoice: Invoice, amount: number, method: string, note: string) => {
    await api(`/api/invoices/${invoice.id}/payments`, { method: 'POST', body: JSON.stringify({ amount_cents: amount, method, note }) })
    setModal(null)
    setSelectedInvoice(null)
    await refresh()
    notify('Payment recorded and invoice balance updated.')
  }

  const importBankStatement = (file: File) => run(async () => {
    const fileFormat = file.name.toLowerCase().endsWith('.ofx') ? 'OFX' : 'CSV'
    const result = await api<{ imported_count: number; errors: { row_number: number; error: string }[] }>('/api/payments/reconcile/import', { method: 'POST', body: JSON.stringify({ filename: file.name, file_format: fileFormat, csv_content: await file.text() }) })
    notify(`Imported ${result.imported_count} bank transaction${result.imported_count === 1 ? '' : 's'}${result.errors.length ? ` · ${result.errors.length} row${result.errors.length === 1 ? '' : 's'} skipped` : ''}. Review every suggestion before confirming.`)
  })

  const importSampleStatement = () => run(async () => {
    const sample = await api<{ filename: string; csv_content: string }>('/api/payments/reconcile/sample')
    const result = await api<{ imported_count: number }>('/api/payments/reconcile/import', { method: 'POST', body: JSON.stringify(sample) })
    notify(`Sample bank feed imported · ${result.imported_count} suggested match ready for review.`)
  })

  const confirmReconciliation = (item: ReconciliationItem) => run(async () => {
    await api(`/api/payments/reconcile/items/${item.id}/confirm`, { method: 'POST', body: '{}' })
    notify(`Payment matched to ${item.invoice_number} and invoice balance updated.`)
  })

  const confirmHighConfidence = (items: ReconciliationItem[]) => run(async () => {
    const result = await api<{ confirmed_count: number; skipped_count: number }>('/api/payments/reconcile/batch-confirm', { method: 'POST', body: JSON.stringify({ item_ids: items.map((item) => item.id) }) })
    notify(`${result.confirmed_count} high-confidence payment${result.confirmed_count === 1 ? '' : 's'} confirmed${result.skipped_count ? ` · ${result.skipped_count} kept for review` : ''}.`)
  })

  const createQuote = async (templateId: number, customerId: number | undefined, startDate: string, discountId?: number) => {
    await api('/api/quotes/from-template', { method: 'POST', body: JSON.stringify({ template_id: templateId, customer_id: customerId, start_date: startDate, discount_id: discountId }) })
    setModal(null)
    await refresh()
    setPage('subscriptions')
    notify('Quotation created and added to the customer outbox.')
  }

  const createCatalogRecord = async (kind: 'product' | 'plan' | 'tax' | 'discount' | 'staff' | 'variant', values: Record<string, unknown>) => {
    let route = ''
    if (kind === 'staff') route = '/api/admin/staff'
    else if (kind === 'variant' && selectedProduct) route = `/api/products/${selectedProduct.id}/variants`
    else if (kind === 'product' || kind === 'plan' || kind === 'tax' || kind === 'discount') route = { product: '/api/products', plan: '/api/plans', tax: '/api/taxes', discount: '/api/discounts' }[kind]
    if (!route) throw new Error('Choose a product before adding a variant.')
    await api(route, { method: 'POST', body: JSON.stringify(values) })
    setModal(null)
    setSelectedProduct(null)
    await refresh()
    notify(`${kind[0].toUpperCase()}${kind.slice(1)} saved.`)
  }

  const markRead = async (item: OutboxItem) => {
    await api(`/api/outbox/${item.id}/read`, { method: 'PATCH' })
    await refresh()
  }

  const filteredSubs = useMemo(() => subscriptions.filter((item) => {
    const text = `${item.number} ${item.customer_name} ${item.plan_name}`.toLowerCase()
    return (statusFilter === 'ALL' || item.status === statusFilter) && (!search || text.includes(search.toLowerCase()))
  }), [subscriptions, statusFilter, search])
  const filteredInvoices = useMemo(() => invoices.filter((item) => {
    const text = `${item.number} ${item.customer_name} ${item.subscription_number}`.toLowerCase()
    const stateMatch = statusFilter === 'ALL' || item.status === statusFilter || item.payment_state === statusFilter
    return stateMatch && (!search || text.includes(search.toLowerCase()))
  }), [invoices, statusFilter, search])

  if (!authChecked) return <div className="auth-loading"><div className="brand-mark"><span></span><span></span><span></span></div><b>brightloop</b><i /></div>
  if (!user) return showLogin
    ? <LoginScreen onEnter={signIn} onEmailLogin={signInWithEmail} busy={busy} onBack={hasResetToken ? undefined : closeLogin} />
    : <LandingPage onSignIn={openLogin} />

  const customerMode = user.role === 'CUSTOMER'
  const nav = customerMode ? navItems.filter((item) => ['overview', 'subscriptions', 'billing'].includes(item.id)) : navItems
  const title = navItems.find((item) => item.id === page)?.label ?? 'Command center'
  const unread = outbox.filter((item) => !item.is_read).length

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><span></span><span></span><span></span></div>
          <div><strong>brightloop</strong><small>REVENUE OS</small></div>
          <button className="icon-button mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={17} /></button>
        </div>
        <button className="workspace-select"><div className="workspace-avatar">B</div><span><b>Brightloop Software</b><small>Workspace</small></span><ChevronDown size={15} /></button>
        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav">
          {nav.filter((item) => item.group === 'Workspace').map((item) => {
            const Icon = item.icon
            return <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => { setPage(item.id); setMobileNav(false) }}><Icon size={17} strokeWidth={1.8} /><span>{customerMode && item.id === 'overview' ? 'My account' : customerMode && item.id === 'billing' ? 'My invoices' : item.label}</span>{page === item.id && <ChevronRight className="nav-chevron" size={15} />}</button>
          })}
        </nav>
        {!customerMode && <>
          <div className="nav-label manage-label">MANAGE</div>
          <nav className="main-nav">
            {nav.filter((item) => item.group === 'Manage').map((item) => {
              const Icon = item.icon
              return <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => { setPage(item.id); setMobileNav(false) }}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{page === item.id && <ChevronRight className="nav-chevron" size={15} />}</button>
            })}
          </nav>
        </>}
        <div className="sidebar-spacer" />
        <div className="sidebar-promo"><div className="promo-icon"><Sparkles size={16} /></div><b>Revenue, in rhythm.</b><p>Every renewal, payment, and insight in one clear view.</p><button onClick={() => setPage('reports')}>Explore reports <ArrowUpRight size={13} /></button></div>
        <div className="sidebar-footer"><div className="avatar avatar-purple">{initials(user.full_name)}</div><div className="sidebar-user"><strong>{user.full_name}</strong><small>{roleLabel(user.role)}</small></div><button className="icon-button footer-more" onClick={logout} aria-label="Sign out"><LogOut size={16} /></button></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={18} /></button><div className="breadcrumb"><span>Brightloop OS</span><ChevronRight size={14} /><b>{title}</b></div></div>
          <div className="topbar-center">
            {!customerMode && <div className="clock-control"><CalendarClock size={15} /><span className="clock-label">Demo date</span><b>{dateLabel(virtualDate)}</b><div className="clock-actions"><button onClick={() => advanceTime(1)} disabled={busy} title="Advance one day">+1d</button><button onClick={() => advanceTime(7)} disabled={busy} title="Advance one week">+1w</button><button onClick={() => advanceTime(undefined, 1)} disabled={busy} title="Advance one calendar month">+1m</button><input aria-label="Choose a future demo date" type="date" min={virtualDate} value={customTimeDate} onChange={(event) => setCustomTimeDate(event.target.value)} /><button className="clock-custom-go" onClick={() => advanceTime(undefined, undefined, customTimeDate)} disabled={busy || customTimeDate <= virtualDate} title="Run the temporal engine through this date">Go</button></div></div>}
          </div>
          <div className="topbar-right">
            <div className="latency-pill"><span className={latencyMs !== null && latencyMs < 2000 ? 'latency-ok' : 'latency-idle'} /><b>{latencyMs === null ? 'API ready' : `${latencyMs.toFixed(1)} ms`}</b><small>&lt;2s SLA</small></div>
            {!customerMode && <div className="persona-wrap"><select value={user.role === 'STAFF' && user.email.startsWith('finance') ? 'FINANCE' : user.role} onChange={(event) => signIn(event.target.value as 'ADMIN' | 'STAFF' | 'FINANCE' | 'CUSTOMER')} aria-label="Demo persona"><option value="ADMIN">Admin persona</option><option value="STAFF">Operations staff</option><option value="FINANCE">Finance lead</option><option value="CUSTOMER">Customer portal</option></select><ChevronDown size={13} /></div>}
            <button className={`outbox-trigger ${outboxOpen ? 'active' : ''}`} onClick={() => setOutboxOpen((value) => !value)} aria-label="Open communications outbox"><Mail size={17} />{unread > 0 && <span>{unread}</span>}</button>
            <button className="help-button" aria-label="Help"><CircleHelp size={17} /></button>
            <div className="topbar-avatar" title={user.full_name}>{initials(user.full_name)}</div>
          </div>
        </header>

        <div className="content-wrap">
          {toast && <div className={`toast toast-${toast.kind}`}><span>{toast.kind === 'success' ? <Check size={15} /> : <CircleHelp size={15} />}</span>{toast.message}<button onClick={() => setToast(null)}><X size={14} /></button></div>}
          <div className="view-transition" key={page}>
          {page === 'overview' && summary && <Overview user={user} summary={summary} subscriptions={subscriptions} invoices={invoices} audit={audit} onPage={setPage} onNewQuote={() => setModal('quote')} onRunBilling={runBilling} onPayment={(invoice) => { setSelectedInvoice(invoice); setModal('payment') }} />}
          {page === 'subscriptions' && <SubscriptionsPage user={user} items={filteredSubs} allItems={subscriptions} catalog={catalog} search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onNewQuote={() => setModal('quote')} onTransition={transition} onSelect={setSelectedSubscription} selected={selectedSubscription} onRefresh={refresh} notify={notify} busy={busy} />}
          {page === 'billing' && <BillingPage items={filteredInvoices} search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onRun={runBilling} onAction={invoiceAction} onPayment={(invoice) => { setSelectedInvoice(invoice); setModal('payment') }} busy={busy} customerMode={customerMode} asOf={virtualDate} />}
          {page === 'payments' && summary && <PaymentsPage invoices={invoices} summary={summary} reconciliationRows={reconciliationRows} onPayment={(invoice) => { setSelectedInvoice(invoice); setModal('payment') }} onImport={importBankStatement} onSample={importSampleStatement} onConfirm={confirmReconciliation} onConfirmHigh={confirmHighConfidence} busy={busy} />}
          {page === 'catalog' && catalog && <CatalogPage catalog={catalog} user={user} onCreate={(kind) => setModal(kind)} onVariant={(product) => { setSelectedProduct(product); setModal('variant') }} />}
          {page === 'reports' && summary && <ReportsPage summary={summary} invoices={invoices} subscriptions={subscriptions} canSeed={user.role === 'ADMIN'} onSeedStress={seedStressData} />}
          </div>
        </div>
      </main>

      <AssistantWidget key={user.id} page={page} focusNumber={selectedSubscription?.number ?? selectedInvoice?.number ?? ''} />

      {outboxOpen && <><div className="drawer-backdrop" onClick={() => setOutboxOpen(false)} /><aside className="outbox-drawer"><div className="drawer-head"><div><span className="eyebrow">COMMUNICATIONS</span><h2>Local outbox</h2></div><button className="icon-button" onClick={() => setOutboxOpen(false)} aria-label="Close outbox"><X size={18} /></button></div><p className="drawer-description">Reset links, quotations, invoices and reminders generated by Brightloop appear here.</p><div className="outbox-list">{outbox.length ? outbox.map((item) => <article className={`outbox-card ${item.is_read ? 'read' : ''}`} key={item.id}><div className="outbox-icon"><Mail size={15} /></div><div className="outbox-copy"><div className="outbox-meta"><span>{item.related_type || 'SYSTEM'}</span><time>{dateLabel(item.created_virtual_date)}</time></div><h3>{item.subject}</h3><p>{item.body}</p>{item.action_url && <a href={item.action_url} onClick={(event) => { event.preventDefault(); window.open(item.action_url, '_blank', 'noopener,noreferrer') }}>Open secure link <ExternalLink size={12} /></a>}{!item.is_read && <button className="mark-read" onClick={() => markRead(item)}>Mark as read</button>}</div></article>) : <div className="empty-state small-empty"><Mail size={22} /><b>Nothing in the outbox yet</b><span>New messages will appear here.</span></div>}</div></aside></>}

      {modal === 'quote' && <QuoteModal catalog={catalog} customers={customers} user={user} virtualDate={virtualDate} onClose={() => setModal(null)} onSubmit={createQuote} />}
      {modal === 'payment' && selectedInvoice && <PaymentModal invoice={selectedInvoice} onClose={() => { setModal(null); setSelectedInvoice(null) }} onSubmit={recordPayment} />}
      {(modal === 'product' || modal === 'plan' || modal === 'tax' || modal === 'discount' || modal === 'staff' || modal === 'variant') && catalog && <CatalogModal kind={modal} catalog={catalog} product={selectedProduct} onClose={() => { setModal(null); setSelectedProduct(null) }} onSubmit={(values) => createCatalogRecord(modal, values)} />}
      {printInvoice && <InvoicePrint invoice={printInvoice} />}
      {busy && <div className="busy-bar"><span /></div>}
    </div>
  )
}

function roleLabel(role: Role) { return role === 'ADMIN' ? 'Administrator' : role === 'CUSTOMER' ? 'Customer account' : 'Operations team' }

function LoginScreen({ onEnter, onEmailLogin, busy, onBack }: { onEnter: (role: 'ADMIN' | 'STAFF' | 'FINANCE' | 'CUSTOMER') => void; onEmailLogin: (email: string, password: string) => Promise<void>; busy: boolean; onBack?: () => void }) {
  return <div className="login-shell"><div className="login-brand"><div className="brand-mark"><span></span><span></span><span></span></div><strong>brightloop</strong><small>SUBSCRIPTION OPERATIONS</small>{onBack && <button className="login-back" onClick={onBack}><ArrowLeft size={14} /> Back to product</button>}</div><div className="login-grid"><div className="login-story"><div className="hero-chip"><span></span> REVENUE OPERATIONS, REIMAGINED</div><h1>Make every<br /><em>cycle count.</em></h1><p>Subscriptions, billing, and the story behind every dollar in one connected workspace.</p><div className="login-proof"><span><ShieldCheck size={16} /> Plan-aware lifecycle</span><span><Zap size={16} /> Idempotent billing</span><span><Activity size={16} /> Live revenue signals</span></div><div className="login-decoration"><div className="decor-orb orb-one"/><div className="decor-orb orb-two"/><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="decor-core"><div className="brand-mark large"><span></span><span></span><span></span></div><small>BRIGHTLOOP<br />REVENUE ENGINE</small></div><div className="float-card float-card-top"><span className="float-icon green"><ArrowUpRight size={15} /></span><div><b>+18.6%</b><small>MRR growth</small></div></div><div className="float-card float-card-bottom"><span className="float-icon violet"><Repeat2 size={15} /></span><div><b>2,480</b><small>Active cycles</small></div></div></div></div><div className="login-panel"><div className="panel-topline"><div><span className="eyebrow">WELCOME BACK</span><h2>Open your workspace</h2><p>Choose a demo persona to explore Brightloop OS.</p></div><div className="panel-sparkle"><Sparkles size={19} /></div></div><div className="persona-list">{([
      ['ADMIN', 'Sarah Jenkins', 'Administrator', 'SJ', 'admin'],
      ['STAFF', 'Marcus Vance', 'Sales & operations', 'MV', 'blue'],
      ['FINANCE', 'Elena Rostova', 'Finance lead', 'ER', 'green'],
      ['CUSTOMER', 'Apex Logistics', 'Customer portal', 'AL', 'gold'],
    ] as const).map(([role, name, description, initialsText, color]) => <button className="persona-card" key={role} disabled={busy} onClick={() => onEnter(role)}><span className={`persona-avatar ${color}`}>{initialsText}</span><span className="persona-copy"><b>{name}</b><small>{description}</small></span><span className="persona-enter"><ChevronRight size={16} /></span></button>)}</div><div className="login-footnote"><ShieldCheck size={14} /> Demo personas sign in through the local API. Role access is enforced server-side.</div><div className="login-divider"><span />or sign in with email<span /></div><EmailLogin onLogin={onEmailLogin} busy={busy} /><div className="login-version">BRIGHTLOOP OS <span>·</span> LOCAL DEMO ENVIRONMENT</div></div></div></div>
}

function EmailLogin({ onLogin, busy }: { onLogin: (email: string, password: string) => Promise<void>; busy: boolean }) {
  type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset' | 'sent'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const resetToken = new URLSearchParams(window.location.search).get('token') ?? ''
  const [mode, setMode] = useState<AuthMode>(resetToken ? 'reset' : 'signin')
  const [error, setError] = useState('')
  const activePassword = mode === 'reset' ? newPassword : password
  const passwordChecks = [
    { label: '9+ characters', ok: activePassword.length >= 9 },
    { label: 'Uppercase', ok: /[A-Z]/.test(activePassword) },
    { label: 'Lowercase', ok: /[a-z]/.test(activePassword) },
    { label: 'Special character', ok: /[^A-Za-z0-9\s]/.test(activePassword) },
  ]
  const passwordStrength = passwordChecks.filter((check) => check.ok).length
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      if (mode === 'signin') await onLogin(email, password)
      if (mode === 'signup') {
        await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, full_name: fullName, company_name: companyName, password }) })
        await onLogin(email, password)
      }
      if (mode === 'forgot') {
        await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) })
        setMode('sent')
      }
      if (mode === 'reset') {
        await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: resetToken, new_password: newPassword }) })
        window.history.replaceState({}, '', window.location.pathname)
        setMode('signin')
        setPassword('')
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not complete this request.') }
  }
  if (mode === 'sent') return <div className="auth-notice"><Mail size={15} /> If that account exists, a password reset link is in the local outbox. <button onClick={() => setMode('signin')}>Back to sign in</button></div>
  return <form className={`email-login auth-${mode}`} onSubmit={submit}>
    {mode === 'signup' && <><input type="text" autoComplete="name" placeholder="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} required /><input type="text" autoComplete="organization" placeholder="Company (optional)" value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></>}
    {mode !== 'reset' && <input type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required />}
    {mode === 'signin' && <input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} required />}
    {mode === 'signup' && <input type="password" autoComplete="new-password" minLength={9} placeholder="Password (9+ characters)" value={password} onChange={(event) => setPassword(event.target.value)} required />}
    {mode === 'reset' && <input type="password" autoComplete="new-password" minLength={9} placeholder="New password (9+ characters)" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />}
    {(mode === 'signup' || mode === 'reset') && <div className={`password-strength strength-${passwordStrength}`}><div className="password-strength-top"><span>Password strength</span><b>{passwordStrength === 4 ? 'Strong' : passwordStrength >= 2 ? 'Getting there' : 'Add a few details'}</b></div><div className="strength-track">{passwordChecks.map((check) => <i key={check.label} className={check.ok ? 'met' : ''} />)}</div><div className="password-checks">{passwordChecks.map((check) => <span className={check.ok ? 'met' : ''} key={check.label}>{check.ok ? <Check size={10} /> : <span className="check-empty" />}{check.label}</span>)}</div></div>}
    <button type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Update password'}</button>
    {error && <small className="form-error">{error}</small>}
    <div className="auth-mode-links">{mode === 'signin' && <><button type="button" onClick={() => { setMode('signup'); setError('') }}>Create customer account</button><button type="button" onClick={() => { setMode('forgot'); setError('') }}>Forgot password?</button></>}{mode !== 'signin' && <button type="button" onClick={() => { setMode('signin'); setError('') }}>Back to sign in</button>}</div>
  </form>
}

function Overview({ user, summary, subscriptions, invoices, audit, onPage, onNewQuote, onRunBilling, onPayment }: { user: User; summary: Summary; subscriptions: Subscription[]; invoices: Invoice[]; audit: { id: number; action: string; detail: string; virtual_date: string; entity_type: string }[]; onPage: (page: Page) => void; onNewQuote: () => void; onRunBilling: () => void; onPayment: (invoice: Invoice) => void }) {
  const customerMode = user.role === 'CUSTOMER'
  const overdue = invoices.filter((invoice) => invoice.status === 'CONFIRMED' && invoice.amount_due_cents > 0 && invoice.due_date < summary.as_of)
  const active = subscriptions.filter((item) => item.status === 'ACTIVE')
  return <>
    <div className="page-heading"><div><div className="eyebrow eyebrow-row"><span className="live-dot" /> {customerMode ? 'CUSTOMER PORTAL' : `GOOD MORNING, ${user.full_name.split(' ')[0].toUpperCase()}`}</div><h1>{customerMode ? 'Your Brightloop account' : 'Revenue, in rhythm.'}</h1><p>{customerMode ? 'A clear view of your plans, invoices, and what’s next.' : 'A live view of what is active, what is owed, and what moves next.'}</p></div><div className="heading-actions">{!customerMode && <button className="button button-soft" onClick={onNewQuote}><Plus size={16} /> New quotation</button>}<button className="button button-primary" onClick={customerMode ? () => onPage('subscriptions') : onRunBilling}>{customerMode ? <Repeat2 size={16} /> : <Zap size={15} />}{customerMode ? 'Manage subscriptions' : 'Run billing'}<ChevronRight size={15} /></button></div></div>
    <div className="metric-grid">
      <MetricCard label={customerMode ? 'Active plans' : 'Active subscriptions'} value={summary.active_subscriptions.toLocaleString()} delta={customerMode ? 'Your current services' : '+8.4% vs last month'} icon={<Repeat2 size={18} />} tone="indigo" foot={customerMode ? `${subscriptions.filter((s) => s.status === 'PAUSED').length} paused` : `${summary.quotations_pending} quotations pending`} />
      <MetricCard label={customerMode ? 'Monthly spend' : 'Monthly recurring revenue'} value={money(summary.mrr_cents)} delta={customerMode ? 'Normalized to monthly' : '↑ 12.8% this quarter'} icon={<WalletCards size={18} />} tone="green" foot={`ARR ${money(summary.arr_cents)}`} />
      <MetricCard label={customerMode ? 'Open balance' : 'Outstanding balance'} value={money(summary.outstanding_cents)} delta={customerMode ? `${invoices.filter((i) => i.amount_due_cents > 0).length} invoices open` : `${summary.overdue_count} overdue invoices`} icon={<CreditCard size={18} />} tone="amber" foot={customerMode ? 'Across all open invoices' : `${money(summary.overdue_cents)} past due`} />
      {customerMode ? <MetricCard label="Next renewal" value={dateLabel(active.map((item) => item.next_billing_date).sort()[0])} delta="Upcoming service cycle" icon={<CalendarClock size={18} />} tone="violet" foot="From your active subscriptions" /> : <MetricCard label="Gross margin" value={`${(summary.gross_margin_percent ?? 0).toFixed(1)}%`} delta="Across active recurring lines" icon={<Activity size={18} />} tone="violet" foot="Using product and variant costs" />}
    </div>

    <div className="dashboard-grid">
      <section className="panel revenue-panel"><div className="panel-heading"><div><span className="eyebrow">REVENUE PULSE</span><h2>{customerMode ? 'Your account activity' : 'Recurring revenue snapshot'}</h2></div><button className="text-action" onClick={() => onPage('reports')}>Full report <ArrowUpRight size={14} /></button></div><div className="revenue-hero"><div><small>MONTHLY RUN RATE</small><b>{money(summary.mrr_cents)}</b><span><ArrowUpRight size={13} /> Annualized {money(summary.arr_cents)}</span></div><div className="revenue-ring"><div className="ring"><span><b>{summary.active_subscriptions}</b><small>active</small></span></div><div className="ring-legend"><span><i className="dot dot-green" /> Active <b>{summary.active_subscriptions}</b></span><span><i className="dot dot-amber" /> Paused <b>{summary.paused_subscriptions}</b></span><span><i className="dot dot-slate" /> Closed <b>{summary.closed_subscriptions}</b></span></div></div></div><div className="revenue-bars"><div className="bars-heading"><span>Receivables aging</span><span>Outstanding {money(summary.outstanding_cents)}</span></div><AgingBars values={summary.aging_cents} /></div></section>
      <section className="panel focus-panel"><div className="panel-heading"><div><span className="eyebrow">NEEDS ATTENTION</span><h2>{overdue.length ? 'Collections to follow up' : 'Portfolio health'}</h2></div><span className={`status-pill ${overdue.length ? 'pill-amber' : 'pill-green'}`}><i />{overdue.length ? `${overdue.length} due` : 'On track'}</span></div>{overdue.length ? <div className="attention-list">{overdue.slice(0, 3).map((item) => <div className="attention-row" key={item.id}><div className="attention-icon"><Clock3 size={15} /></div><div className="attention-copy"><b>{item.customer_name}</b><small>{item.number} · due {dateLabel(item.due_date)}</small></div><strong>{money(item.amount_due_cents)}</strong><button className="mini-arrow" onClick={() => onPayment(item)} aria-label="Record payment"><ChevronRight size={15} /></button></div>)}</div> : <div className="health-empty"><div className="health-check"><Check size={18} /></div><b>Nothing is overdue</b><span>Your outstanding invoices are within their payment terms.</span></div>}<div className="focus-footer"><div><span className="eyebrow">QUOTE PIPELINE</span><b>{summary.quotations_pending} <small>awaiting response</small></b></div><button className="text-action" onClick={() => onPage('subscriptions')}>View pipeline <ArrowUpRight size={14} /></button></div></section>
    </div>

    <div className="bottom-grid"><section className="panel table-panel"><div className="panel-heading"><div><span className="eyebrow">LATEST ACTIVITY</span><h2>{customerMode ? 'Recent invoices' : 'Recent invoices'}</h2></div><button className="text-action" onClick={() => onPage('billing')}>All invoices <ArrowUpRight size={14} /></button></div><InvoiceTable invoices={summary.recent_invoices.slice(0, 5)} onPayment={onPayment} compact /></section><section className="panel activity-panel"><div className="panel-heading"><div><span className="eyebrow">SYSTEM TIMELINE</span><h2>Recent events</h2></div><Activity size={16} className="muted-icon" /></div><div className="timeline-list">{audit.slice(0, 5).map((event, index) => <div className="timeline-row" key={event.id}><span className={`timeline-marker marker-${index % 4}`}><Activity size={12} /></span><div><b>{event.action.toLowerCase().replaceAll('_', ' ')}</b><p>{event.detail || `${event.entity_type} updated`}</p><time>{dateLabel(event.virtual_date)}</time></div></div>)}{audit.length === 0 && <div className="empty-state small-empty"><Activity size={20} /><span>Activity will appear as you work.</span></div>}</div></section></div>
  </>
}

function MetricCard({ label, value, delta, icon, tone, foot }: { label: string; value: string; delta: string; icon: React.ReactNode; tone: string; foot: string }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><div className={`metric-icon ${tone}`}>{icon}</div></div><strong className="metric-value">{value}</strong><div className="metric-delta"><span className={tone === 'amber' ? 'delta-amber' : 'delta-up'}>{delta.includes('↑') ? <ArrowUpRight size={13} /> : null}{delta}</span></div><div className="metric-foot"><span>{foot}</span><MoreHorizontal size={15} /></div></article>
}

function AgingBars({ values }: { values: Record<string, number> }) {
  const items = [['1 to 15 days', values['1_15'] || 0, 'bar-blue'], ['16 to 30 days', values['16_30'] || 0, 'bar-violet'], ['31 to 60 days', values['31_60'] || 0, 'bar-amber'], ['60+ days', values['60_plus'] || 0, 'bar-red']] as const
  const max = Math.max(...items.map(([, value]) => value), 1)
  return <div className="aging-list">{items.map(([label, value, tone]) => <div className="aging-row" key={label}><span>{label}</span><div className="aging-track"><i className={tone} style={{ width: `${Math.max(value ? value / max * 100 : 0, value ? 6 : 0)}%` }} /></div><b>{money(value)}</b></div>)}</div>
}

function InvoiceTable({ invoices, onPayment, compact = false }: { invoices: Invoice[]; onPayment: (invoice: Invoice) => void; compact?: boolean }) {
  if (!invoices.length) return <div className="empty-state"><FileText size={24} /><b>No invoices yet</b><span>Invoices will appear when billing runs.</span></div>
  return <div className={`table-wrap ${compact ? 'compact-table' : ''}`}><table><thead><tr><th>Invoice</th><th>Customer</th><th>Due date</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td><span className="table-primary">{invoice.number}</span><small>{invoice.subscription_number}</small></td><td><span className="table-primary">{invoice.customer_name}</span><small>{dateLabel(invoice.issue_date)}</small></td><td>{dateLabel(invoice.due_date)}</td><td><b>{money(invoice.total_cents)}</b>{invoice.amount_paid_cents > 0 && invoice.amount_due_cents > 0 && <small>{money(invoice.amount_due_cents)} due</small>}</td><td><StatusBadge status={invoice.status === 'CONFIRMED' && invoice.amount_paid_cents > 0 && invoice.amount_due_cents > 0 ? 'PARTIALLY_PAID' : invoice.status} /></td><td>{invoice.status === 'CONFIRMED' && invoice.amount_due_cents > 0 && <button className="table-action" onClick={() => onPayment(invoice)}>Record payment</button>}</td></tr>)}</tbody></table></div>
}

function InvoicePrint({ invoice }: { invoice: Invoice }) {
  return <article className="print-sheet"><header><div className="print-brand"><span className="brand-mark"><span></span><span></span><span></span></span><b>brightloop</b></div><span className="print-label">INVOICE</span></header><div className="print-meta"><div><small>INVOICE NUMBER</small><b>{invoice.number}</b></div><div><small>ISSUED</small><b>{dateLabel(invoice.issue_date)}</b></div><div><small>DUE DATE</small><b>{dateLabel(invoice.due_date)}</b></div><div><small>STATUS</small><b>{invoice.payment_state}</b></div></div><div className="print-customer"><small>BILL TO</small><b>{invoice.customer_name}</b><span>{invoice.customer_email}</span></div><table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>{invoice.lines.map((line, index) => <tr key={index}><td>{line.description}</td><td>{line.quantity}</td><td>{money(line.unit_price_cents)}</td><td>{money(line.total_cents)}</td></tr>)}</tbody></table><div className="print-totals"><div><span>Subtotal</span><b>{money(invoice.subtotal_cents)}</b></div><div><span>Discount</span><b>−{money(invoice.discount_cents)}</b></div><div><span>Tax</span><b>{money(invoice.tax_cents)}</b></div><div className="print-grand"><span>Total</span><b>{money(invoice.total_cents)}</b></div><div><span>Paid</span><b>{money(invoice.amount_paid_cents)}</b></div><div className="print-due"><span>Balance due</span><b>{money(invoice.amount_due_cents)}</b></div></div><footer>Thank you for building with Brightloop. · Generated locally from Brightloop OS.</footer></article>
}

function StatusBadge({ status }: { status: string }) {
  const label = status === 'PARTIALLY_PAID' ? 'Partial' : status.charAt(0) + status.slice(1).toLowerCase()
  return <span className={`status-pill status-${status.toLowerCase()}`}><i />{label}</span>
}

function SubscriptionsPage({ user, items, allItems, catalog, search, setSearch, statusFilter, setStatusFilter, onNewQuote, onTransition, onSelect, selected, onRefresh, notify, busy }: { user: User; items: Subscription[]; allItems: Subscription[]; catalog: Catalog | null; search: string; setSearch: (value: string) => void; statusFilter: string; setStatusFilter: (value: string) => void; onNewQuote: () => void; onTransition: (sub: Subscription, target: string) => void; onSelect: (sub: Subscription | null) => void; selected: Subscription | null; onRefresh: () => Promise<void>; notify: (message: string, kind?: Toast['kind']) => void; busy: boolean }) {
  const customerMode = user.role === 'CUSTOMER'
  const counts = { ALL: allItems.length, ACTIVE: allItems.filter((s) => s.status === 'ACTIVE').length, QUOTATION: allItems.filter((s) => s.status === 'QUOTATION').length, PAUSED: allItems.filter((s) => s.status === 'PAUSED').length }
  const addOnProducts = catalog?.products.filter((product) => product.product_type === 'ADDON') ?? []
  const [addonBusy, setAddonBusy] = useState(false)
  const [addonPreview, setAddonPreview] = useState<{ sub: Subscription; product: Product; quantity: number; proration_cents: number; current_quantity: number; remaining_days: number; cycle_days: number; next_billing_date: string; effective_date: string } | null>(null)
  const addAddon = async (sub: Subscription, product: Product, quantity: number) => {
    setAddonBusy(true)
    try {
      const preview = await api<Omit<NonNullable<typeof addonPreview>, 'sub' | 'product'>>(`/api/subscriptions/${sub.id}/addons/preview`, { method: 'POST', body: JSON.stringify({ product_id: product.id, quantity }) })
      setAddonPreview({ ...preview, sub, product, quantity })
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not preview the add-on change.', 'error') }
    finally { setAddonBusy(false) }
  }
  const confirmAddon = async () => {
    if (!addonPreview) return
    setAddonBusy(true)
    try {
      const { sub, product, quantity, proration_cents, current_quantity, next_billing_date, remaining_days, cycle_days } = addonPreview
      await api(`/api/subscriptions/${sub.id}/addons/confirm`, { method: 'POST', body: JSON.stringify({ product_id: product.id, quantity, expected_proration_cents: proration_cents, expected_current_quantity: current_quantity, expected_next_billing_date: next_billing_date }) })
      setAddonPreview(null)
      await onRefresh()
      notify(`${product.name} updated · ${money(proration_cents)} will be applied on ${dateLabel(next_billing_date)} (${remaining_days}/${cycle_days} days).`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update the add-on.', 'error') }
    finally { setAddonBusy(false) }
  }
  return <>{addonPreview && <Modal title="Review add-on change" subtitle={`${addonPreview.sub.number} · ${addonPreview.product.name}`} onClose={() => { if (!addonBusy) setAddonPreview(null) }}><div className="addon-review"><div><span>Quantity</span><b>{addonPreview.current_quantity} <ArrowRight size={13} /> {addonPreview.quantity}</b></div><div><span>Prorated adjustment</span><b className={addonPreview.proration_cents < 0 ? 'addon-credit' : ''}>{money(addonPreview.proration_cents)}</b></div><div><span>Effective date</span><b>{dateLabel(addonPreview.effective_date)}</b></div><div><span>Next invoice</span><b>{dateLabel(addonPreview.next_billing_date)}</b></div><p>The change will update this subscription and carry the prorated adjustment into its next invoice.</p></div><div className="modal-actions"><button className="button button-outline" disabled={addonBusy} onClick={() => setAddonPreview(null)}>Keep current setup</button><button className="button button-primary" disabled={addonBusy} onClick={() => void confirmAddon()}>{addonBusy ? 'Saving…' : 'Confirm change'}<Check size={14} /></button></div></Modal>}<div className="page-heading"><div><div className="eyebrow eyebrow-row"><span className="live-dot" /> SUBSCRIPTION LIFECYCLE</div><h1>{customerMode ? 'My subscriptions' : 'Subscriptions & quotes'}</h1><p>{customerMode ? 'Manage your plans and see what is included.' : 'A complete view of every customer relationship and its next move.'}</p></div><div className="heading-actions">{!customerMode && <button className="button button-primary" onClick={onNewQuote}><Plus size={16} /> Create quotation</button>}</div></div>
    <div className="sub-stat-row">{([['All records', counts.ALL], ['Active', counts.ACTIVE], ['Quotations', counts.QUOTATION], ['Paused', counts.PAUSED]] as const).map(([label, count]) => <button className={`sub-stat ${statusFilter === (label === 'All records' ? 'ALL' : label.toUpperCase()) ? 'selected' : ''}`} key={label} onClick={() => setStatusFilter(label === 'All records' ? 'ALL' : label.toUpperCase())}><span>{label}</span><b>{count}</b></button>)}</div>
    <section className="panel data-panel"><div className="data-toolbar"><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by customer, plan, or ID" /></div><div className="toolbar-right"><label className="filter-select"><Filter size={14} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All statuses</option><option value="DRAFT">Draft</option><option value="QUOTATION">Quotation</option><option value="CONFIRMED">Confirmed</option><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option><option value="CLOSED">Closed</option></select></label><button className="button button-outline" onClick={() => onRefresh()}><Activity size={15} /> Refresh</button></div></div>
      {items.length ? <div className="table-wrap"><table className="subscription-table"><thead><tr><th>Subscription</th>{!customerMode && <th>Customer</th>}<th>Plan</th><th>Recurring</th><th>Next billing</th><th>Status</th><th /></tr></thead><tbody>{items.map((sub) => <tr key={sub.id} className={selected?.id === sub.id ? 'row-selected' : ''} onClick={() => onSelect(selected?.id === sub.id ? null : sub)}><td><span className="table-primary">{sub.number}</span><small>Started {dateLabel(sub.start_date)}</small></td>{!customerMode && <td><span className="customer-cell"><span className="tiny-avatar">{initials(sub.customer_name)}</span>{sub.customer_name}</span></td>}<td><span className="table-primary">{sub.plan_name}</span><small>{sub.billing_interval.toLowerCase()} plan</small></td><td><b>{money(sub.subtotal_cents)}</b><small>{sub.lines.filter((line) => line.is_active).length} items</small></td><td>{sub.status === 'ACTIVE' ? dateLabel(sub.next_billing_date) : 'Not scheduled'}</td><td><StatusBadge status={sub.quote_expired ? 'EXPIRED' : sub.status} /></td><td><div className="row-actions">{subscriptionAction(sub, user).map((action) => <button key={action.target} className="tiny-action" disabled={busy} onClick={(event) => { event.stopPropagation(); onTransition(sub, action.target) }}>{action.label}</button>)}<button className="icon-button" aria-label="View subscription details" onClick={(event) => { event.stopPropagation(); onSelect(sub) }}><ChevronRight size={15} /></button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><Repeat2 size={25} /><b>No subscriptions match</b><span>Change the filter or create a new quotation.</span></div>}
    </section>
    {selected && <section className="panel detail-panel"><div className="panel-heading"><div><span className="eyebrow">{selected.number}</span><h2>{selected.customer_name} · {selected.plan_name}</h2></div><button className="icon-button" onClick={() => onSelect(null)} aria-label="Close details"><X size={17} /></button></div><div className="detail-grid"><div><span>Start date</span><b>{dateLabel(selected.start_date)}</b></div><div><span>Expiry</span><b>{dateLabel(selected.expiry_date)}</b></div><div><span>Next billing</span><b>{dateLabel(selected.next_billing_date)}</b></div>{user.role !== 'CUSTOMER' && <div><span>Margin</span><b className={(selected.margin_percent ?? 0) < 15 ? 'text-red' : ''}>{(selected.margin_percent ?? 0).toFixed(1)}%</b></div>}</div><div className="detail-lines">{selected.lines.map((line) => <div className="detail-line" key={line.id ?? `${line.product_id}-${line.is_addon}`}><div><b>{line.product_name}</b><small>{line.variant_name || (line.is_addon ? 'Add-on' : 'Subscription line')}</small></div><span>× {line.quantity}</span><b>{money(line.unit_price_cents * line.quantity)}</b></div>)}</div>{selected.status === 'ACTIVE' && <div className="addon-switchboard"><div><span className="eyebrow">ADD-ON SWITCHBOARD</span><h3>Adjust products mid-cycle</h3><p>Review the prorated amount before saving the change.</p></div>{addOnProducts.map((product) => { const line = selected.lines.find((item) => item.product_id === product.id && item.is_active); return <div className="addon-row" key={product.id}><div><b>{product.name}</b><small>{money(product.sales_price_cents)} / cycle</small></div><div className="quantity-stepper"><button disabled={!line || busy || addonBusy} onClick={() => void addAddon(selected, product, Math.max(0, (line?.quantity ?? 0) - 1))}>−</button><span>{line?.quantity ?? 0}</span><button disabled={busy || addonBusy} onClick={() => void addAddon(selected, product, (line?.quantity ?? 0) + 1)}>+</button></div></div>})}</div>}</section>}
  </>
}

function subscriptionAction(sub: Subscription, user: User): { label: string; target: string }[] {
  const customer = user.role === 'CUSTOMER'
  if (sub.status === 'DRAFT') return customer ? [] : [{ label: 'Send quote', target: 'QUOTATION' }]
  if (sub.status === 'QUOTATION') return [{ label: customer ? 'Accept quote' : 'Confirm', target: 'CONFIRMED' }]
  if (sub.status === 'CONFIRMED') return [{ label: 'Activate', target: 'ACTIVE' }]
  if (sub.status === 'ACTIVE') return [...(sub.plan_flags.allow_pause ? [{ label: 'Pause', target: 'PAUSED' }] : []), ...(sub.plan_flags.allow_early_close ? [{ label: 'Close', target: 'CLOSED' }] : [])]
  if (sub.status === 'PAUSED') return [{ label: 'Resume', target: 'ACTIVE' }]
  if (sub.status === 'CLOSED' && sub.plan_flags.allow_renew) return [{ label: 'Renew', target: 'ACTIVE' }]
  return []
}

function BillingPage({ items, search, setSearch, statusFilter, setStatusFilter, onRun, onAction, onPayment, busy, customerMode, asOf }: { items: Invoice[]; search: string; setSearch: (value: string) => void; statusFilter: string; setStatusFilter: (value: string) => void; onRun: () => void; onAction: (invoice: Invoice, action: string) => void; onPayment: (invoice: Invoice) => void; busy: boolean; customerMode: boolean; asOf: string }) {
  const openAmount = items.filter((item) => item.status === 'CONFIRMED').reduce((sum, item) => sum + item.amount_due_cents, 0)
  const overdueCount = items.filter((item) => item.status === 'CONFIRMED' && item.amount_due_cents > 0 && item.due_date < asOf).length
  return <><div className="page-heading"><div><div className="eyebrow eyebrow-row"><span className="live-dot" /> BILLING OPERATIONS</div><h1>{customerMode ? 'My invoices' : 'Billing & invoices'}</h1><p>{customerMode ? 'Review invoices and settle your open balance.' : 'Generate, confirm, send, and reconcile every billing cycle.'}</p></div><div className="heading-actions">{!customerMode && <button className="button button-primary" disabled={busy} onClick={onRun}><Zap size={15} /> Run billing day <ChevronRight size={15} /></button>}</div></div><div className="mini-metric-row"><div className="mini-metric"><span>Open balance</span><b>{money(openAmount)}</b><small>Across current records</small></div><div className="mini-metric"><span>Invoices shown</span><b>{items.length}</b><small>Filtered invoice ledger</small></div><div className="mini-metric"><span>Past due</span><b>{overdueCount}</b><small>Requires follow-up</small></div><div className="billing-cycle-card"><div className="billing-cycle-icon"><CalendarClock size={18} /></div><div><span>NEXT BILLING CYCLE</span><b>Idempotent by subscription period</b></div><i><Check size={13} /></i></div></div><section className="panel data-panel"><div className="data-toolbar"><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoices or customers" /></div><div className="toolbar-right"><label className="filter-select"><Filter size={14} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All statuses</option><option value="DRAFT">Draft</option><option value="CONFIRMED">Confirmed</option><option value="PAID">Paid</option><option value="CANCELLED">Cancelled</option><option value="PARTIALLY PAID">Partially paid</option></select></label><button className="button button-outline" onClick={() => window.print()}><Download size={14} /> Export / print</button></div></div>{items.length ? <div className="table-wrap"><table className="invoice-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Period</th><th>Due date</th><th>Amount</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>{items.map((invoice) => <tr key={invoice.id}><td><span className="table-primary">{invoice.number}</span><small>{invoice.subscription_number}</small></td><td><span className="table-primary">{invoice.customer_name}</span><small>{invoice.customer_email}</small></td><td>{dateLabel(invoice.billing_period_start)} to {dateLabel(invoice.billing_period_end)}</td><td>{dateLabel(invoice.due_date)}</td><td><b>{money(invoice.total_cents)}</b></td><td><b>{money(invoice.amount_due_cents)}</b></td><td><StatusBadge status={invoice.status === 'CONFIRMED' && invoice.amount_paid_cents > 0 && invoice.amount_due_cents > 0 ? 'PARTIALLY_PAID' : invoice.status} /></td><td><div className="row-actions">{!customerMode && invoice.status === 'DRAFT' && <button className="tiny-action" onClick={() => onAction(invoice, 'CONFIRM')}>Confirm</button>}{invoice.status === 'CONFIRMED' && invoice.amount_due_cents > 0 && <button className="tiny-action" onClick={() => onPayment(invoice)}>Pay</button>}{!customerMode && <button className="icon-button" onClick={() => onAction(invoice, 'SEND')} title="Send to local outbox"><Mail size={14} /></button>}<button className="icon-button" onClick={() => onAction(invoice, 'PRINT')} title="Print invoice"><Download size={14} /></button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><FileText size={25} /><b>No invoices found</b><span>Run the billing engine when subscriptions are due.</span></div>}</section></>
}

function PaymentsPage({ invoices, summary, reconciliationRows, onPayment, onImport, onSample, onConfirm, onConfirmHigh, busy }: { invoices: Invoice[]; summary: Summary; reconciliationRows: ReconciliationItem[]; onPayment: (invoice: Invoice) => void; onImport: (file: File) => void; onSample: () => void; onConfirm: (item: ReconciliationItem) => void; onConfirmHigh: (items: ReconciliationItem[]) => void; busy: boolean }) {
  const outstanding = invoices.filter((invoice) => invoice.status === 'CONFIRMED' && invoice.amount_due_cents > 0)
  const highConfidence = reconciliationRows.filter((item) => item.status === 'SUGGESTED' && item.invoice_id && item.match_score >= 85)
  return <><div className="page-heading"><div><div className="eyebrow eyebrow-row"><span className="live-dot" /> PAYMENT DESK</div><h1>Payments & reconciliation</h1><p>Record money against the right invoice and keep balances in sync.</p></div></div><div className="mini-metric-row"><div className="mini-metric"><span>Collected to date</span><b>{money(summary.revenue_collected_cents)}</b><small>Recorded payment ledger</small></div><div className="mini-metric"><span>Open invoices</span><b>{outstanding.length}</b><small>Ready to settle</small></div><div className="mini-metric"><span>Outstanding</span><b>{money(summary.outstanding_cents)}</b><small>Remaining balance due</small></div><div className="reconcile-card"><div className="reconcile-icon"><Sparkles size={16} /></div><div><b>Smart reconcile</b><span>Weighted invoice suggestions, always confirmed by a person.</span></div><span className="coming-soon">LOCAL</span></div></div><section className="panel reconcile-panel"><div className="panel-heading"><div><span className="eyebrow">BANK STATEMENT MATCHING</span><h2>Import and review suggestions</h2><p>Match by invoice reference, amount, payer, and date. Balances change only after you confirm a row.</p></div><div className="reconcile-actions">{highConfidence.length > 0 && <button className="button button-soft small-button" disabled={busy} onClick={() => onConfirmHigh(highConfidence)}><Check size={14} /> Confirm {highConfidence.length} high-confidence</button>}<label className="button button-primary csv-upload-control"><Upload size={15} /> Choose CSV or OFX<input type="file" accept=".csv,.ofx,text/csv,application/x-ofx" disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onImport(file); event.currentTarget.value = '' }} /></label><button className="button button-outline" disabled={busy} onClick={onSample}>Load sample feed</button></div></div>{reconciliationRows.length ? <div className="table-wrap"><table className="reconcile-table"><thead><tr><th>Statement row</th><th>Amount</th><th>Suggested invoice</th><th>Confidence</th><th>Match factors</th><th>Review</th></tr></thead><tbody>{reconciliationRows.map((item) => <tr key={item.id}><td><span className="table-primary">{item.payer || 'Unknown payer'}</span><small>{item.bank_reference || item.memo || `Row ${item.row_number}`} · {dateLabel(item.transaction_date)}</small></td><td><b>{money(item.amount_cents)}</b></td><td>{item.invoice_number ? <><span className="table-primary">{item.invoice_number}</span><small>{item.customer_name} · {money(item.balance_due_cents ?? 0)} due</small></> : <span className="muted-note">No safe match</span>}</td><td>{item.invoice_id ? <span className={`match-score ${item.match_score >= 85 ? 'match-high' : 'match-review'}`}>{item.match_score}%</span> : <span className="match-score match-none">No match</span>}</td><td><small>{item.match_reason}</small></td><td>{item.status === 'SUGGESTED' ? <button className="button button-soft small-button" disabled={busy} onClick={() => onConfirm(item)}><Check size={14} /> Confirm payment</button> : <StatusBadge status={item.status} />}</td></tr>)}</tbody></table></div> : <div className="empty-state"><FileText size={24} /><b>No statement rows to review</b><span>Import a CSV or load the sample feed to see explainable match suggestions.</span></div>}</section><section className="panel data-panel"><div className="panel-heading"><div><span className="eyebrow">OPEN RECEIVABLES</span><h2>Invoices ready for payment</h2></div><span className="muted-note">Partial payments are supported</span></div>{outstanding.length ? <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Due</th><th>Paid</th><th>Balance</th><th /></tr></thead><tbody>{outstanding.map((invoice) => <tr key={invoice.id}><td><span className="table-primary">{invoice.number}</span><small>{invoice.subscription_number}</small></td><td>{invoice.customer_name}</td><td>{dateLabel(invoice.due_date)}</td><td>{money(invoice.amount_paid_cents)}</td><td><b>{money(invoice.amount_due_cents)}</b></td><td><button className="button button-soft small-button" onClick={() => onPayment(invoice)}><Plus size={14} /> Record payment</button></td></tr>)}</tbody></table></div> : <div className="empty-state"><CreditCard size={24} /><b>All caught up</b><span>There are no confirmed invoices with an open balance.</span></div>}</section></>
}

function CatalogPage({ catalog, user, onCreate, onVariant }: { catalog: Catalog; user: User; onCreate: (kind: 'product' | 'plan' | 'tax' | 'discount' | 'staff') => void; onVariant: (product: Product) => void }) {
  const isAdmin = user.role === 'ADMIN'
  return <>
    <div className="page-heading"><div><div className="eyebrow eyebrow-row"><span className="live-dot" /> COMMERCIAL GOVERNANCE</div><h1>Catalog & plans</h1><p>Products, pricing, and lifecycle rules that power every subscription.</p></div>{isAdmin && <div className="heading-actions"><button className="button button-outline" onClick={() => onCreate('staff')}><Users size={15} /> Add staff</button><button className="button button-soft" onClick={() => onCreate('plan')}><Plus size={15} /> New plan</button><button className="button button-primary" onClick={() => onCreate('product')}><Plus size={15} /> New product</button></div>}</div>
    <div className="catalog-tabs"><span className="selected">Products <b>{catalog.products.length}</b></span><span>Plans <b>{catalog.plans.length}</b></span><span>Discounts <b>{catalog.discounts.length}</b></span><span>Taxes <b>{catalog.taxes.length}</b></span></div>
    <div className="catalog-section-title"><div><span className="eyebrow">PRODUCT CATALOG</span><h2>Built for recurring growth</h2></div>{isAdmin && <button className="text-action" onClick={() => onCreate('tax')}>Manage tax rules <Settings2 size={14} /></button>}</div>
    <div className="product-grid">{catalog.products.map((product, index) => <article className="product-card" key={product.id}><div className={`product-art art-${index % 4}`}><div className="art-orbit"/><div className="product-glyph">{index === 0 ? <Boxes size={27} /> : index === 1 ? <Activity size={26} /> : index === 2 ? <Users size={26} /> : <Zap size={26} />}</div><span className="product-type">{product.product_type.replaceAll('_', ' ')}</span></div><div className="product-details"><div className="product-code">{product.sku}</div><h3>{product.name}</h3><p>{product.notes}</p><div className="product-price-row"><div><small>SALES PRICE</small><b>{money(product.sales_price_cents)}<i> / cycle</i></b></div>{user.role !== 'CUSTOMER' && <div><small>UNIT COST</small><b>{money(product.cost_price_cents ?? 0)}</b></div>}</div>{product.variants.length > 0 && <div className="variant-row"><span>VARIANTS</span>{product.variants.map((variant) => <b key={variant.id}>{variant.attribute_value} <i>+{money(variant.price_delta_cents)}</i></b>)}</div>}{isAdmin && <button className="variant-add" onClick={() => onVariant(product)}><Plus size={12} /> Add variant</button>}</div></article>)}</div>
    <div className="catalog-section-title plan-title"><div><span className="eyebrow">SUBSCRIPTION PLANS</span><h2>Lifecycle, by design</h2></div>{isAdmin && <button className="text-action" onClick={() => onCreate('plan')}>Add plan <Plus size={14} /></button>}</div>
    <div className="plan-grid">{catalog.plans.map((plan) => <article className="plan-card" key={plan.id}><div className="plan-card-top"><span className="plan-frequency">{plan.billing_interval}</span><span className="plan-code">{plan.code}</span></div><h3>{plan.name}</h3><p>{plan.description}</p><div className="plan-attributes"><div><small>MIN. QUANTITY</small><b>{plan.min_quantity} {plan.min_quantity === 1 ? 'seat' : 'seats'}</b></div><div><small>TERM</small><b>{plan.default_duration_days} days</b></div></div><div className="plan-flags"><Flag label="Pause" enabled={plan.allow_pause} /><Flag label="Early close" enabled={plan.allow_early_close} /><Flag label="Renew" enabled={plan.allow_renew} /><Flag label="Auto-close" enabled={plan.auto_close_on_end} /></div></article>)}</div>
    <div className="rule-grid"><section className="panel rules-panel"><div className="panel-heading"><div><span className="eyebrow">DISCOUNT RULES</span><h2>Active incentives</h2></div>{isAdmin && <button className="icon-button" onClick={() => onCreate('discount')} aria-label="Add discount"><Plus size={17} /></button>}</div>{catalog.discounts.map((discount) => <div className="rule-row" key={discount.id}><span className="discount-icon"><Zap size={15} /></span><div><b>{discount.code}</b><small>{discount.name} · {discount.current_uses}/{discount.max_uses ?? '∞'} uses</small></div><strong>{discount.discount_type === 'PERCENTAGE' ? `${(discount.value / 100).toFixed(0)}%` : money(discount.value)}</strong></div>)}</section><section className="panel rules-panel"><div className="panel-heading"><div><span className="eyebrow">TAX RULES</span><h2>Applied at invoice</h2></div>{isAdmin && <button className="icon-button" onClick={() => onCreate('tax')} aria-label="Add tax"><Plus size={17} /></button>}</div>{catalog.taxes.map((tax) => <div className="rule-row" key={tax.id}><span className="tax-icon"><Settings2 size={15} /></span><div><b>{tax.name}</b><small>{tax.is_default ? 'Default rule' : 'Available rule'}</small></div><strong>{(tax.rate_basis_points / 100).toFixed(2)}%</strong></div>)}</section></div>
  </>
}

function Flag({ label, enabled }: { label: string; enabled: boolean }) { return <span className={`flag ${enabled ? 'flag-on' : 'flag-off'}`}><i />{label}</span> }

function ReportsPage({ summary, invoices, subscriptions, canSeed, onSeedStress }: { summary: Summary; invoices: Invoice[]; subscriptions: Subscription[]; canSeed: boolean; onSeedStress: () => void }) {
  const planTotals = subscriptions.filter((sub) => sub.status === 'ACTIVE').reduce<Record<string, number>>((acc, sub) => { acc[sub.plan_name] = (acc[sub.plan_name] || 0) + sub.subtotal_cents; return acc }, {})
  const rows = Object.entries(planTotals).sort((a, b) => b[1] - a[1])
  return <><div className="page-heading"><div><div className="eyebrow eyebrow-row"><span className="live-dot" /> FINANCE LEAD VIEW</div><h1>Revenue intelligence</h1><p>Recurring revenue, margin, collections, and the exposure that needs attention.</p></div><div className="heading-actions">{canSeed && <button className="button button-soft" onClick={onSeedStress}><Zap size={14} /> Seed 10K demo</button>}<button className="button button-outline" onClick={() => window.print()}><Download size={15} /> Export report</button></div></div><div className="metric-grid report-metrics"><MetricCard label="MRR" value={money(summary.mrr_cents)} delta="Normalized by billing interval" icon={<WalletCards size={18} />} tone="indigo" foot={`ARR ${money(summary.arr_cents)}`} /><MetricCard label="Collected revenue" value={money(summary.revenue_collected_cents)} delta="All recorded payments" icon={<ArrowUpRight size={18} />} tone="green" foot="Across current accounts" /><MetricCard label="Outstanding" value={money(summary.outstanding_cents)} delta={`${summary.overdue_count} overdue invoices`} icon={<CreditCard size={18} />} tone="amber" foot={`${money(summary.overdue_cents)} past due`} /><MetricCard label="Gross margin" value={`${(summary.gross_margin_percent ?? 0).toFixed(1)}%`} delta="Active recurring lines" icon={<Activity size={18} />} tone="violet" foot="Cost-aware portfolio view" /></div><div className="report-layout"><section className="panel report-panel"><div className="panel-heading"><div><span className="eyebrow">RECURRING REVENUE MIX</span><h2>By subscription plan</h2></div><span className="report-stamp">AS OF {dateLabel(summary.as_of).toUpperCase()}</span></div>{rows.length ? rows.map(([name, amount], index) => <div className="mix-row" key={name}><div><span className={`mix-dot mix-${index % 4}`} /><b>{name}</b><small>{subscriptions.filter((sub) => sub.status === 'ACTIVE' && sub.plan_name === name).length} active</small></div><strong>{money(amount)}</strong><div className="mix-track"><i style={{ width: `${Math.max(4, amount / Math.max(...rows.map(([, value]) => value)) * 100)}%` }} /></div></div>) : <div className="empty-state"><BarChart3 size={24} /><b>No active recurring revenue</b></div>}</section><section className="panel report-panel"><div className="panel-heading"><div><span className="eyebrow">COLLECTIONS</span><h2>Aging exposure</h2></div></div><AgingBars values={summary.aging_cents} /><div className="collection-total"><span>Total overdue</span><b>{money(summary.overdue_cents)}</b></div><div className="collection-note"><Clock3 size={14} /> Aging updates when the demo clock advances.</div></section></div><section className="panel table-panel"><div className="panel-heading"><div><span className="eyebrow">RECENT LEDGER</span><h2>Latest invoice activity</h2></div><span className="muted-note">{invoices.length} records loaded</span></div><InvoiceTable invoices={invoices.slice(0, 8)} onPayment={() => {}} compact /></section></>
}

function QuoteModal({ catalog, customers, user, virtualDate, onClose, onSubmit }: { catalog: Catalog | null; customers: Customer[]; user: User; virtualDate: string; onClose: () => void; onSubmit: (templateId: number, customerId: number | undefined, startDate: string, discountId?: number) => Promise<void> }) {
  const [templateId, setTemplateId] = useState(catalog?.templates[0]?.id ?? 0)
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? 0)
  const [startDate, setStartDate] = useState(virtualDate)
  const [discountId, setDiscountId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const template = catalog?.templates.find((item) => item.id === Number(templateId))
  const previewLines = template?.lines.map((line) => {
    const product = catalog?.products.find((item) => item.id === line.product_id)
    const variant = product?.variants.find((item) => item.id === line.variant_id)
    const unitPrice = (product?.sales_price_cents ?? 0) + (variant?.price_delta_cents ?? 0)
    const unitCost = (product?.cost_price_cents ?? 0) + (variant?.cost_delta_cents ?? 0)
    return { ...line, productName: product?.name ?? 'Product', variantName: variant?.attribute_value ?? '', sales: unitPrice * line.quantity, cost: unitCost * line.quantity }
  }) ?? []
  const preview = previewLines.reduce((totals, line) => ({ sales: totals.sales + line.sales, cost: totals.cost + line.cost, quantity: totals.quantity + line.quantity }), { sales: 0, cost: 0, quantity: 0 })
  const selectedDiscount = catalog?.discounts.find((item) => item.id === discountId)
  const eligibleLines = selectedDiscount?.scope === 'PRODUCT' ? previewLines.filter((line) => selectedDiscount.product_ids.includes(line.product_id)) : previewLines
  const eligibleGross = eligibleLines.reduce((sum, line) => sum + line.sales, 0)
  const eligibleQuantity = eligibleLines.reduce((sum, line) => sum + line.quantity, 0)
  const discountEligible = Boolean(selectedDiscount && selectedDiscount.start_date <= virtualDate && selectedDiscount.end_date >= virtualDate && (selectedDiscount.max_uses === null || selectedDiscount.current_uses < selectedDiscount.max_uses) && eligibleQuantity >= selectedDiscount.min_quantity && eligibleGross >= selectedDiscount.min_purchase_cents && eligibleLines.length > 0)
  const discountCents = selectedDiscount && discountEligible
    ? selectedDiscount.discount_type === 'FIXED'
      ? selectedDiscount.scope === 'PRODUCT'
        ? eligibleLines.reduce((sum, line) => sum + Math.min(line.sales, selectedDiscount.value), 0)
        : Math.min(eligibleGross, selectedDiscount.value)
      : selectedDiscount.scope === 'PRODUCT'
        ? eligibleLines.reduce((sum, line) => sum + Math.floor((line.sales * selectedDiscount.value + 5000) / 10000), 0)
        : Math.floor((eligibleGross * selectedDiscount.value + 5000) / 10000)
    : 0
  const netSales = Math.max(preview.sales - discountCents, 0)
  const marginPercent = netSales > 0 ? (netSales - preview.cost) / netSales * 100 : 0
  const discountHint = selectedDiscount && !discountEligible
    ? virtualDate < selectedDiscount.start_date || virtualDate > selectedDiscount.end_date ? 'Outside the active date window.'
      : selectedDiscount.max_uses !== null && selectedDiscount.current_uses >= selectedDiscount.max_uses ? 'Usage limit reached.'
        : eligibleQuantity < selectedDiscount.min_quantity ? `Needs at least ${selectedDiscount.min_quantity} eligible units.`
          : eligibleGross < selectedDiscount.min_purchase_cents ? `Needs ${money(selectedDiscount.min_purchase_cents)} in eligible products.`
            : 'This package contains no eligible products.'
    : ''
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setLoading(true); setError(''); try { await onSubmit(Number(templateId), user.role === 'CUSTOMER' ? undefined : Number(customerId), startDate, discountId ?? undefined) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create quotation.') } finally { setLoading(false) } }
  return <Modal title="Create a quotation" subtitle="Start from a reusable package, apply eligible incentives, then send it to the customer." onClose={onClose}><form className="modal-form" onSubmit={submit}><label>Quotation template<select value={templateId} onChange={(event) => setTemplateId(Number(event.target.value))}>{catalog?.templates.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.validity_days} days</option>)}</select></label>{user.role !== 'CUSTOMER' && <label>Customer<select value={customerId} onChange={(event) => setCustomerId(Number(event.target.value))}>{customers.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.email}</option>)}</select></label>}<label>Subscription start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label><label>Discount (optional)<select value={discountId ?? ''} onChange={(event) => setDiscountId(event.target.value ? Number(event.target.value) : null)}><option value="">No discount</option>{catalog?.discounts.map((item) => <option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}</select></label>{template && <div className="quote-preview"><div><span className="eyebrow">PACKAGE PREVIEW</span><b>{template.name}</b></div><div className="quote-line-preview">{previewLines.map((line, index) => <span key={`${line.product_id}-${index}`}>{line.productName}{line.variantName ? ` · ${line.variantName}` : ''} × {line.quantity} <b>{money(line.sales)}</b></span>)}</div><div className="quote-total-preview"><span>Recurring subtotal</span><b>{money(preview.sales)}</b>{selectedDiscount && <><span>{selectedDiscount.code} {discountEligible ? 'discount' : 'not applied yet'}</span><b>{discountCents ? `−${money(discountCents)}` : 'Not applied'}</b><span>After discount</span><b>{money(netSales)}</b>{discountHint && <small className="discount-hint">{discountHint}</small>}</>}{user.role !== 'CUSTOMER' && <><span className={`margin-preview ${marginPercent < 15 ? 'margin-low' : marginPercent < 40 ? 'margin-mid' : ''}`}>Estimated margin after discount {marginPercent.toFixed(1)}%</span>{marginPercent < 15 && <small className="discount-hint margin-alert">Margin alert: this quote is below the 15% guardrail.</small>}</>}</div><div className="quote-plan"><span>{catalog?.plans.find((item) => item.id === template.plan_id)?.name}</span><span>Valid {template.validity_days} days</span></div></div>}{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading || !templateId}>{loading ? 'Creating…' : 'Create quotation'}<ChevronRight size={15} /></button></div></form></Modal>
}

function PaymentModal({ invoice, onClose, onSubmit }: { invoice: Invoice; onClose: () => void; onSubmit: (invoice: Invoice, amount: number, method: string, note: string) => Promise<void> }) {
  const [amount, setAmount] = useState((invoice.amount_due_cents / 100).toFixed(2))
  const [method, setMethod] = useState('BANK_TRANSFER')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setLoading(true); setError(''); try { await onSubmit(invoice, Math.round(Number(amount) * 100), method, note) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not record payment.') } finally { setLoading(false) } }
  return <Modal title="Record a payment" subtitle={`${invoice.number} · ${invoice.customer_name}`} onClose={onClose}><form className="modal-form" onSubmit={submit}><div className="payment-balance"><span>Balance due</span><b>{money(invoice.amount_due_cents)}</b><small>{invoice.amount_paid_cents ? `${money(invoice.amount_paid_cents)} already paid` : 'No payments recorded yet'}</small></div><label>Payment amount (USD)<input type="number" min="0.01" max={invoice.amount_due_cents / 100} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label><div className="amount-chips"><button type="button" onClick={() => setAmount((Math.max(1, Math.floor(invoice.amount_due_cents / 2)) / 100).toFixed(2))}>Half balance</button><button type="button" onClick={() => setAmount((invoice.amount_due_cents / 100).toFixed(2))}>Fill remaining balance</button></div><label>Payment method<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="BANK_TRANSFER">Bank transfer</option><option value="CREDIT_CARD">Credit card (demo)</option><option value="UPI">UPI</option><option value="ACH">ACH</option><option value="CASH">Cash</option><option value="CHECK">Check</option><option value="PORTAL">Customer portal (demo)</option></select></label><label>Note<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional payment reference or note" /></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}>{loading ? 'Saving…' : 'Record payment'}<Check size={15} /></button></div></form></Modal>
}

function CatalogModal({ kind, catalog, product, onClose, onSubmit }: { kind: 'product' | 'plan' | 'tax' | 'discount' | 'staff' | 'variant'; catalog: Catalog; product: Product | null; onClose: () => void; onSubmit: (values: Record<string, unknown>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string | number | boolean>>((): Record<string, string | number | boolean> => {
    if (kind === 'product') return { sku: '', name: '', product_type: 'RECURRING_SOFTWARE', sales_price_cents: 0, cost_price_cents: 0, notes: '' }
    if (kind === 'plan') return { code: '', name: '', description: '', billing_interval: 'MONTHLY', min_quantity: 1, available_from: '2026-01-01', available_to: '', auto_close_on_end: false, allow_early_close: true, allow_pause: true, allow_renew: true, default_duration_days: 365 }
    if (kind === 'tax') return { name: '', rate_basis_points: 0, is_default: false }
    if (kind === 'staff') return { email: '', full_name: '', password: '' }
    if (kind === 'variant') return { attribute_name: 'Brand', attribute_value: '', price_delta_cents: 0, cost_delta_cents: 0 }
    return { code: '', name: '', discount_type: 'PERCENTAGE', value: 1500, scope: 'SUBSCRIPTION', min_purchase_cents: 0, min_quantity: 1, start_date: '2026-01-01', end_date: '2027-12-31', max_uses: '' }
  })
  const [eligibleProductIds, setEligibleProductIds] = useState<number[]>(catalog.products.slice(0, 1).map((item) => item.id))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const set = (key: string, value: string | number | boolean) => setValues((current) => ({ ...current, [key]: value }))
  const eligibleProducts = kind === 'discount' ? catalog.products.filter((item) => values.scope === 'PRODUCT' ? eligibleProductIds.includes(item.id) : true) : []
  const eligiblePrice = eligibleProducts.reduce((sum, item) => sum + item.sales_price_cents, 0)
  const marginRiskProducts = kind === 'discount' ? eligibleProducts.filter((item) => item.variants.some((variant) => {
    const price = item.sales_price_cents + variant.price_delta_cents
    const cost = (item.cost_price_cents ?? 0) + variant.cost_delta_cents
    const discountShare = values.discount_type === 'PERCENTAGE'
      ? Math.floor((price * Number(values.value) + 5000) / 10000)
      : values.scope === 'PRODUCT' ? Math.min(price, Number(values.value)) : eligiblePrice ? Math.floor((Number(values.value) * price + eligiblePrice / 2) / eligiblePrice) : 0
    const net = values.discount_type === 'PERCENTAGE' ? price - discountShare : Math.max(0, price - discountShare)
    return net < cost
  }) || (item.cost_price_cents ?? 0) > (values.discount_type === 'PERCENTAGE' ? item.sales_price_cents - Math.floor((item.sales_price_cents * Number(values.value) + 5000) / 10000) : Math.max(0, item.sales_price_cents - (values.scope === 'PRODUCT' ? Math.min(item.sales_price_cents, Number(values.value)) : eligiblePrice ? Math.floor((Number(values.value) * item.sales_price_cents + eligiblePrice / 2) / eligiblePrice) : 0)))) : []
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setError(''); setLoading(true); try { const output: Record<string, unknown> = { ...values }; if (kind === 'plan' && !values.available_to) output.available_to = null; if (kind === 'discount') { output.max_uses = values.max_uses ? Number(values.max_uses) : null; output.product_ids = values.scope === 'PRODUCT' ? eligibleProductIds : [] } await onSubmit(output) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this record.') } finally { setLoading(false) } }
  const title = { product: 'Add a product', plan: 'Create a plan', tax: 'Add a tax rule', discount: 'Create a discount', staff: 'Add a staff member', variant: 'Add a product variant' }[kind]
  const subtitle = kind === 'variant' && product ? `Add a pricing option to ${product.name}.` : kind === 'staff' ? 'Only administrators can provision internal team accounts.' : 'Commercial settings are validated and stored by the API.'
  return <Modal title={title} subtitle={subtitle} onClose={onClose}><form className="modal-form" onSubmit={submit}>
    {kind === 'staff' && <><label>Full name<input value={String(values.full_name)} onChange={(event) => set('full_name', event.target.value)} required /></label><label>Work email<input type="email" value={String(values.email)} onChange={(event) => set('email', event.target.value)} required /></label><label>Temporary password<input type="password" minLength={9} value={String(values.password)} onChange={(event) => set('password', event.target.value)} required /><small>9+ characters, including uppercase, lowercase, and a special character</small></label></>}
    {kind === 'variant' && <><label>Attribute<input value={String(values.attribute_name)} onChange={(event) => set('attribute_name', event.target.value)} required /></label><label>Variant value<input value={String(values.attribute_value)} onChange={(event) => set('attribute_value', event.target.value)} required /></label><div className="form-two"><label>Price delta (cents)<input type="number" value={Number(values.price_delta_cents)} onChange={(event) => set('price_delta_cents', Number(event.target.value))} /></label><label>Cost delta (cents)<input type="number" value={Number(values.cost_delta_cents)} onChange={(event) => set('cost_delta_cents', Number(event.target.value))} /></label></div></>}
    {kind === 'product' && <><label>Product name<input value={String(values.name)} onChange={(event) => set('name', event.target.value)} required /></label><label>SKU<input value={String(values.sku)} onChange={(event) => set('sku', event.target.value.toUpperCase())} required /></label><label>Product type<select value={String(values.product_type)} onChange={(event) => set('product_type', event.target.value)}><option value="RECURRING_SOFTWARE">Recurring software</option><option value="ADDON">Add-on</option><option value="SERVICE">Service</option></select></label><div className="form-two"><label>Sales price (cents)<input type="number" min="0" value={Number(values.sales_price_cents)} onChange={(event) => set('sales_price_cents', Number(event.target.value))} /></label><label>Cost price (cents)<input type="number" min="0" value={Number(values.cost_price_cents)} onChange={(event) => set('cost_price_cents', Number(event.target.value))} /></label></div><label>Notes<input value={String(values.notes)} onChange={(event) => set('notes', event.target.value)} /></label></>}
    {kind === 'plan' && <><label>Plan name<input value={String(values.name)} onChange={(event) => set('name', event.target.value)} required /></label><label>Plan code<input value={String(values.code)} onChange={(event) => set('code', event.target.value.toUpperCase())} required /></label><label>Billing interval<select value={String(values.billing_interval)} onChange={(event) => set('billing_interval', event.target.value)}><option>MONTHLY</option><option>YEARLY</option><option>WEEKLY</option><option>DAILY</option></select></label><div className="form-two"><label>Minimum quantity<input type="number" min="1" value={Number(values.min_quantity)} onChange={(event) => set('min_quantity', Number(event.target.value))} /></label><label>Duration (days)<input type="number" min="1" value={Number(values.default_duration_days)} onChange={(event) => set('default_duration_days', Number(event.target.value))} /></label></div><label>Description<input value={String(values.description)} onChange={(event) => set('description', event.target.value)} /></label><div className="toggle-grid">{(['allow_pause', 'allow_early_close', 'allow_renew', 'auto_close_on_end'] as const).map((key) => <label className="toggle-option" key={key}><input type="checkbox" checked={Boolean(values[key])} onChange={(event) => set(key, event.target.checked)} />{key.replaceAll('_', ' ')}</label>)}</div></>}
    {kind === 'tax' && <><label>Tax name<input value={String(values.name)} onChange={(event) => set('name', event.target.value)} required /></label><label>Rate (basis points)<input type="number" min="0" max="10000" value={Number(values.rate_basis_points)} onChange={(event) => set('rate_basis_points', Number(event.target.value))} /><small>18% = 1800 basis points</small></label><label className="toggle-option"><input type="checkbox" checked={Boolean(values.is_default)} onChange={(event) => set('is_default', event.target.checked)} />Set as default tax</label></>}
    {kind === 'discount' && <><label>Discount code<input value={String(values.code)} onChange={(event) => set('code', event.target.value.toUpperCase())} required /></label><label>Display name<input value={String(values.name)} onChange={(event) => set('name', event.target.value)} required /></label><div className="form-two"><label>Type<select value={String(values.discount_type)} onChange={(event) => set('discount_type', event.target.value)}><option value="PERCENTAGE">Percentage</option><option value="FIXED">Fixed amount</option></select></label><label>{values.discount_type === 'PERCENTAGE' ? 'Rate (basis points)' : 'Amount (cents)'}<input type="number" min="1" max={values.discount_type === 'PERCENTAGE' ? 10000 : undefined} value={Number(values.value)} onChange={(event) => set('value', Number(event.target.value))} /><small>{values.discount_type === 'PERCENTAGE' ? '1,500 = 15%' : '50,000 = $500.00'}</small></label></div><label>Scope<select value={String(values.scope)} onChange={(event) => set('scope', event.target.value)}><option value="SUBSCRIPTION">Whole subscription</option><option value="PRODUCT">Selected products</option></select></label>{values.scope === 'PRODUCT' && <div className="product-pick-list"><span className="eyebrow">ELIGIBLE PRODUCTS</span>{catalog.products.map((item) => <label key={item.id}><input type="checkbox" checked={eligibleProductIds.includes(item.id)} onChange={(event) => setEligibleProductIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{item.name}</label>)}</div>}{marginRiskProducts.length > 0 && <div className="margin-guard-warning"><ShieldCheck size={15} /><span>Margin guard: this discount can bring {marginRiskProducts.length} product{marginRiskProducts.length === 1 ? '' : 's'} below cost: {marginRiskProducts.map((item) => item.name).join(', ')}.</span></div>}<div className="form-two"><label>Min. quantity<input type="number" min="1" value={Number(values.min_quantity)} onChange={(event) => set('min_quantity', Number(event.target.value))} /></label><label>Max. uses<input type="number" min="1" value={String(values.max_uses)} onChange={(event) => set('max_uses', event.target.value)} placeholder="Unlimited" /></label></div><div className="form-two"><label>Starts<input type="date" value={String(values.start_date)} onChange={(event) => set('start_date', event.target.value)} /></label><label>Ends<input type="date" value={String(values.end_date)} onChange={(event) => set('end_date', event.target.value)} /></label></div></>}
    {error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}>{loading ? 'Saving…' : 'Save changes'}<Check size={15} /></button></div></form></Modal>
}

function Modal({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-card"><div className="modal-head"><div><span className="eyebrow">BRIGHTLOOP WORKSPACE</span><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div>{children}</section></div>
}

export default App
