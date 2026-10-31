from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160))
    company_name: Mapped[str] = mapped_column(String(160), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="CUSTOMER", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class UserSession(Base):
    __tablename__ = "user_sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sku: Mapped[str] = mapped_column(String(48), unique=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    product_type: Mapped[str] = mapped_column(String(32), default="RECURRING_SOFTWARE")
    sales_price_cents: Mapped[int] = mapped_column(Integer)
    cost_price_cents: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    variants: Mapped[list[ProductVariant]] = relationship(back_populates="product", cascade="all, delete-orphan")


class ProductVariant(Base):
    __tablename__ = "product_variants"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    attribute_name: Mapped[str] = mapped_column(String(60))
    attribute_value: Mapped[str] = mapped_column(String(80))
    price_delta_cents: Mapped[int] = mapped_column(Integer, default=0)
    cost_delta_cents: Mapped[int] = mapped_column(Integer, default=0)
    product: Mapped[Product] = relationship(back_populates="variants")
    __table_args__ = (UniqueConstraint("product_id", "attribute_name", "attribute_value"),)


class TaxRule(Base):
    __tablename__ = "tax_rules"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    rate_basis_points: Mapped[int] = mapped_column(Integer, default=0)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Plan(Base):
    __tablename__ = "plans"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str] = mapped_column(Text, default="")
    billing_interval: Mapped[str] = mapped_column(String(16), default="MONTHLY")
    min_quantity: Mapped[int] = mapped_column(Integer, default=1)
    available_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    available_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    auto_close_on_end: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_early_close: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_pause: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_renew: Mapped[bool] = mapped_column(Boolean, default=True)
    default_duration_days: Mapped[int] = mapped_column(Integer, default=365)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class DiscountRule(Base):
    __tablename__ = "discount_rules"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(48), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    discount_type: Mapped[str] = mapped_column(String(16))
    value: Mapped[int] = mapped_column(Integer)
    scope: Mapped[str] = mapped_column(String(16), default="SUBSCRIPTION")
    min_purchase_cents: Mapped[int] = mapped_column(Integer, default=0)
    min_quantity: Mapped[int] = mapped_column(Integer, default=1)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_uses: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class DiscountProduct(Base):
    __tablename__ = "discount_rule_products"
    discount_id: Mapped[int] = mapped_column(ForeignKey("discount_rules.id", ondelete="CASCADE"), primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), primary_key=True)


class QuotationTemplate(Base):
    __tablename__ = "quotation_templates"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(140))
    description: Mapped[str] = mapped_column(Text, default="")
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"))
    validity_days: Mapped[int] = mapped_column(Integer, default=15)
    payment_terms: Mapped[str] = mapped_column(String(12), default="NET_15")
    lines: Mapped[list[QuotationTemplateLine]] = relationship(back_populates="template", cascade="all, delete-orphan")


class QuotationTemplateLine(Base):
    __tablename__ = "quotation_template_lines"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("quotation_templates.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    variant_id: Mapped[int | None] = mapped_column(ForeignKey("product_variants.id"), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    tax_rule_id: Mapped[int | None] = mapped_column(ForeignKey("tax_rules.id"), nullable=True)
    template: Mapped[QuotationTemplate] = relationship(back_populates="lines")


class Subscription(Base):
    __tablename__ = "subscriptions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"), index=True)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("quotation_templates.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="DRAFT", index=True)
    start_date: Mapped[date] = mapped_column(Date)
    expiry_date: Mapped[date] = mapped_column(Date)
    quote_valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    quote_expired: Mapped[bool] = mapped_column(Boolean, default=False)
    next_billing_date: Mapped[date] = mapped_column(Date, index=True)
    billing_anchor_day: Mapped[int] = mapped_column(Integer, default=1)
    last_prebilling_reminder_for: Mapped[date | None] = mapped_column(Date, nullable=True)
    payment_terms: Mapped[str] = mapped_column(String(12), default="NET_15")
    discount_id: Mapped[int | None] = mapped_column(ForeignKey("discount_rules.id"), nullable=True)
    paused_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    closed_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    close_reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    lines: Mapped[list[SubscriptionLine]] = relationship(back_populates="subscription", cascade="all, delete-orphan")
    __table_args__ = (Index("idx_sub_status_next_billing", "status", "next_billing_date"),)


class SubscriptionLine(Base):
    __tablename__ = "subscription_lines"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subscription_id: Mapped[int] = mapped_column(ForeignKey("subscriptions.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    variant_id: Mapped[int | None] = mapped_column(ForeignKey("product_variants.id"), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    unit_price_cents: Mapped[int] = mapped_column(Integer)
    unit_cost_cents: Mapped[int] = mapped_column(Integer, default=0)
    tax_rule_id: Mapped[int | None] = mapped_column(ForeignKey("tax_rules.id"), nullable=True)
    tax_rate_basis_points: Mapped[int] = mapped_column(Integer, default=0)
    is_addon: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    pending_proration_cents: Mapped[int] = mapped_column(Integer, default=0)
    subscription: Mapped[Subscription] = relationship(back_populates="lines")


class Invoice(Base):
    __tablename__ = "invoices"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    subscription_id: Mapped[int] = mapped_column(ForeignKey("subscriptions.id"), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    billing_period_start: Mapped[date] = mapped_column(Date)
    billing_period_end: Mapped[date] = mapped_column(Date)
    issue_date: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(16), default="DRAFT", index=True)
    subtotal_cents: Mapped[int] = mapped_column(Integer, default=0)
    discount_cents: Mapped[int] = mapped_column(Integer, default=0)
    tax_cents: Mapped[int] = mapped_column(Integer, default=0)
    total_cents: Mapped[int] = mapped_column(Integer, default=0)
    amount_paid_cents: Mapped[int] = mapped_column(Integer, default=0)
    amount_due_cents: Mapped[int] = mapped_column(Integer, default=0)
    discount_code: Mapped[str] = mapped_column(String(48), default="")
    discount_note: Mapped[str] = mapped_column(Text, default="")
    dunning_stage: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    lines: Mapped[list[InvoiceLine]] = relationship(back_populates="invoice", cascade="all, delete-orphan")
    __table_args__ = (UniqueConstraint("subscription_id", "billing_period_start", name="uq_invoice_subscription_period"), Index("idx_invoice_status_due", "status", "due_date"), Index("idx_invoice_customer_status", "customer_id", "status"))


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    description: Mapped[str] = mapped_column(String(180))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price_cents: Mapped[int] = mapped_column(Integer)
    discount_cents: Mapped[int] = mapped_column(Integer, default=0)
    tax_rate_basis_points: Mapped[int] = mapped_column(Integer, default=0)
    tax_cents: Mapped[int] = mapped_column(Integer, default=0)
    total_cents: Mapped[int] = mapped_column(Integer, default=0)
    invoice: Mapped[Invoice] = relationship(back_populates="lines")


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference: Mapped[str] = mapped_column(String(32), unique=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    method: Mapped[str] = mapped_column(String(24))
    amount_cents: Mapped[int] = mapped_column(Integer)
    payment_date: Mapped[date] = mapped_column(Date)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ReconciliationBatch(Base):
    __tablename__ = "reconciliation_batches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(180))
    imported_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    imported_virtual_date: Mapped[date] = mapped_column(Date)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    items: Mapped[list[ReconciliationItem]] = relationship(back_populates="batch", cascade="all, delete-orphan")


class ReconciliationItem(Base):
    __tablename__ = "reconciliation_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("reconciliation_batches.id", ondelete="CASCADE"), index=True)
    row_number: Mapped[int] = mapped_column(Integer)
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    bank_reference: Mapped[str] = mapped_column(String(180), default="")
    memo: Mapped[str] = mapped_column(Text, default="")
    payer: Mapped[str] = mapped_column(String(180), default="")
    amount_cents: Mapped[int] = mapped_column(Integer)
    transaction_date: Mapped[date] = mapped_column(Date)
    invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id"), nullable=True, index=True)
    match_score: Mapped[int] = mapped_column(Integer, default=0)
    match_reason: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="UNMATCHED", index=True)
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("payments.id"), nullable=True, unique=True)
    batch: Mapped[ReconciliationBatch] = relationship(back_populates="items")
    __table_args__ = (UniqueConstraint("batch_id", "row_number"),)


class OutboxMessage(Base):
    __tablename__ = "outbox_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    channel: Mapped[str] = mapped_column(String(16), default="EMAIL")
    recipient: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(220))
    body: Mapped[str] = mapped_column(Text)
    action_url: Mapped[str] = mapped_column(Text, default="")
    related_type: Mapped[str] = mapped_column(String(24), default="")
    related_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_virtual_date: Mapped[date] = mapped_column(Date)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    entity_type: Mapped[str] = mapped_column(String(32), index=True)
    entity_id: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(48))
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    virtual_date: Mapped[date] = mapped_column(Date)


class SystemSetting(Base):
    __tablename__ = "system_settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(120))
