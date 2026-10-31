from __future__ import annotations

import calendar
import secrets
from datetime import date, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session, joinedload

from .models import (
    AuditEvent, DiscountProduct, DiscountRule, Invoice, InvoiceLine, OutboxMessage,
    Payment, Plan, Product, ProductVariant, QuotationTemplate, QuotationTemplateLine,
    Subscription, SubscriptionLine, SystemSetting, TaxRule, User,
)
from .security import hash_password


DEFAULT_CLOCK = date(2026, 10, 31)


def clock_date(db: Session) -> date:
    setting = db.get(SystemSetting, "virtual_system_date")
    if not setting:
        setting = SystemSetting(key="virtual_system_date", value=DEFAULT_CLOCK.isoformat())
        db.add(setting)
        db.flush()
    return date.fromisoformat(setting.value)


def set_clock(db: Session, value: date) -> None:
    setting = db.get(SystemSetting, "virtual_system_date")
    if not setting:
        setting = SystemSetting(key="virtual_system_date", value=value.isoformat())
        db.add(setting)
    else:
        setting.value = value.isoformat()


def add_interval(start: date, interval: str, anchor_day: int | None = None) -> date:
    anchor = min(max(anchor_day or start.day, 1), 31)
    if interval == "DAILY":
        return start + timedelta(days=1)
    if interval == "WEEKLY":
        return start + timedelta(days=7)
    if interval == "YEARLY":
        year = start.year + 1
        return start.replace(year=year, day=min(anchor, calendar.monthrange(year, start.month)[1]))
    month = start.month + 1
    year = start.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    return start.replace(year=year, month=month, day=min(anchor, calendar.monthrange(year, month)[1]))


def add_duration_days(start: date, days: int) -> date:
    return start + timedelta(days=days)


def money(cents: int) -> str:
    return f"{cents / 100:,.2f}"


def round_ratio_half_up(amount: int, basis_points: int) -> int:
    return (amount * basis_points + 5000) // 10000


def payment_terms_days(terms: str) -> int:
    return {"IMMEDIATE": 0, "NET_7": 7, "NET_15": 15, "NET_30": 30}.get(terms, 15)


def record_event(db: Session, actor_id: int | None, entity_type: str, entity_id: int, action: str, detail: str = "") -> None:
    db.add(AuditEvent(actor_id=actor_id, entity_type=entity_type, entity_id=entity_id, action=action, detail=detail, virtual_date=clock_date(db)))


def enqueue(db: Session, recipient: str, subject: str, body: str, related_type: str, related_id: int | None = None, action_url: str = "") -> None:
    db.add(OutboxMessage(channel="EMAIL", recipient=recipient, subject=subject, body=body, action_url=action_url, related_type=related_type, related_id=related_id, created_virtual_date=clock_date(db)))


def _distribute(total: int, bases: list[int]) -> list[int]:
    denominator = sum(bases)
    if not denominator or not total:
        return [0 for _ in bases]
    floors = [(total * base) // denominator for base in bases]
    remainders = [(total * base) % denominator for base in bases]
    left = total - sum(floors)
    for idx in sorted(range(len(bases)), key=lambda i: remainders[i], reverse=True)[:left]:
        floors[idx] += 1
    return floors


def _discount_for_invoice(db: Session, rule: DiscountRule | None, lines: list[SubscriptionLine], at: date) -> tuple[list[int], str, bool]:
    gross = [line.unit_price_cents * line.quantity for line in lines]
    discounts = [0 for _ in lines]
    if not rule:
        return discounts, "", False
    eligible_indices = list(range(len(lines)))
    if rule.scope == "PRODUCT":
        eligible_ids = set(db.scalars(select(DiscountProduct.product_id).where(DiscountProduct.discount_id == rule.id)).all())
        eligible_indices = [idx for idx, line in enumerate(lines) if line.product_id in eligible_ids]
    eligible_quantity = sum(lines[idx].quantity for idx in eligible_indices)
    eligible_purchase = sum(gross[idx] for idx in eligible_indices)
    reason = ""
    if not rule.is_active:
        reason = "inactive"
    elif at < rule.start_date or at > rule.end_date:
        reason = "outside its active date window"
    elif rule.max_uses is not None and rule.current_uses >= rule.max_uses:
        reason = "usage limit reached"
    elif eligible_quantity < rule.min_quantity:
        reason = "minimum quantity not met"
    elif eligible_purchase < rule.min_purchase_cents:
        reason = "minimum purchase not met"
    if reason:
        return discounts, f"{rule.code} not applied: {reason}.", False

    if rule.scope == "PRODUCT":
        if not eligible_indices:
            return discounts, f"{rule.code} not applied: no eligible product lines.", False
        for idx in eligible_indices:
            discounts[idx] = min(gross[idx], rule.value) if rule.discount_type == "FIXED" else round_ratio_half_up(gross[idx], rule.value)
    else:
        base = sum(gross)
        total_discount = min(base, rule.value) if rule.discount_type == "FIXED" else round_ratio_half_up(base, rule.value)
        discounts = _distribute(total_discount, gross)

    conditions = [DiscountRule.id == rule.id, DiscountRule.is_active.is_(True)]
    if rule.max_uses is not None:
        conditions.append(DiscountRule.current_uses < rule.max_uses)
    result = db.execute(update(DiscountRule).where(*conditions).values(current_uses=DiscountRule.current_uses + 1))
    if result.rowcount != 1:
        return [0 for _ in lines], f"{rule.code} not applied: usage limit reached.", False
    return discounts, f"{rule.code} applied (redemption {rule.current_uses + 1}).", True


def generate_invoice(db: Session, subscription: Subscription, plan: Plan, issue_date: date) -> Invoice | None:
    period_start = subscription.next_billing_date
    period_end = min(add_interval(period_start, plan.billing_interval, subscription.billing_anchor_day), subscription.expiry_date)
    exists = db.scalar(select(Invoice.id).where(Invoice.subscription_id == subscription.id, Invoice.billing_period_start == period_start))
    if exists:
        subscription.next_billing_date = period_end
        return None
    lines = [line for line in subscription.lines if line.is_active]
    adjustment_lines = [line for line in subscription.lines if line.pending_proration_cents]
    if not lines:
        return None
    rule = db.get(DiscountRule, subscription.discount_id) if subscription.discount_id else None
    discounts, note, used = _discount_for_invoice(db, rule, lines, issue_date)
    invoice = Invoice(
        number=f"INV-{issue_date.year}-{secrets.token_hex(4).upper()}",
        subscription_id=subscription.id,
        customer_id=subscription.customer_id,
        billing_period_start=period_start,
        billing_period_end=period_end,
        issue_date=issue_date,
        due_date=issue_date + timedelta(days=payment_terms_days(subscription.payment_terms)),
        status="DRAFT",
        discount_cents=sum(discounts),
        discount_code=rule.code if used and rule else "",
        discount_note=note,
    )
    subtotal = tax_total = total = 0
    customer_lines: list[InvoiceLine] = []
    for idx, line in enumerate(lines):
        product = db.get(Product, line.product_id)
        gross = line.unit_price_cents * line.quantity
        net = max(0, gross - discounts[idx])
        tax = round_ratio_half_up(net, line.tax_rate_basis_points)
        line_total = net + tax
        subtotal += gross
        tax_total += tax
        total += line_total
        customer_lines.append(InvoiceLine(product_id=line.product_id, description=product.name if product else "Subscription line", quantity=line.quantity, unit_price_cents=line.unit_price_cents, discount_cents=discounts[idx], tax_rate_basis_points=line.tax_rate_basis_points, tax_cents=tax, total_cents=line_total))
    credit_total_left = max(total, 0)
    for line in adjustment_lines:
        product = db.get(Product, line.product_id)
        adjustment = line.pending_proration_cents
        if adjustment < 0:
            denominator = 10000 + line.tax_rate_basis_points
            max_credit = credit_total_left * 10000 // denominator if denominator else credit_total_left
            applied = min(-adjustment, max_credit)
            line.pending_proration_cents += applied
            adjustment = -applied
        else:
            line.pending_proration_cents = 0
        if adjustment:
            tax = round_ratio_half_up(abs(adjustment), line.tax_rate_basis_points)
            if adjustment < 0:
                tax = -tax
            total += adjustment + tax
            subtotal += adjustment
            tax_total += tax
            credit_total_left = max(credit_total_left + adjustment + tax, 0)
            customer_lines.append(InvoiceLine(product_id=line.product_id, description=f"Mid-cycle proration · {product.name if product else 'Add-on'}", quantity=1, unit_price_cents=adjustment, discount_cents=0, tax_rate_basis_points=line.tax_rate_basis_points, tax_cents=tax, total_cents=adjustment + tax))
    invoice.subtotal_cents = subtotal
    invoice.tax_cents = tax_total
    invoice.total_cents = total
    invoice.amount_due_cents = total
    invoice.lines = customer_lines
    db.add(invoice)
    db.flush()
    subscription.next_billing_date = period_end
    record_event(db, None, "INVOICE", invoice.id, "GENERATED", f"{subscription.number} / {period_start.isoformat()} to {period_end.isoformat()}")
    return invoice


def seed_database(db: Session) -> None:
    if db.scalar(select(User.id).limit(1)):
        return
    users = [
        User(email="admin@brightloop.local", full_name="Sarah Jenkins", company_name="Brightloop Software", password_hash=hash_password("Brightloop!2026"), role="ADMIN"),
        User(email="staff@brightloop.local", full_name="Marcus Vance", company_name="Brightloop Software", password_hash=hash_password("Brightloop!2026"), role="STAFF"),
        User(email="customer@brightloop.local", full_name="Apex Logistics", company_name="Apex Logistics", password_hash=hash_password("Brightloop!2026"), role="CUSTOMER"),
        User(email="finance@brightloop.local", full_name="Elena Rostova", company_name="Brightloop Software", password_hash=hash_password("Brightloop!2026"), role="STAFF"),
        User(email="ops@northstar.local", full_name="Northstar Labs", company_name="Northstar Labs", password_hash=hash_password("Brightloop!2026"), role="CUSTOMER"),
    ]
    db.add_all(users)
    db.flush()
    admin = users[0]

    standard_tax = TaxRule(name="Standard SaaS Tax (18%)", rate_basis_points=1800, is_default=True)
    export_tax = TaxRule(name="Export Zero-Rated (0%)", rate_basis_points=0)
    db.add_all([standard_tax, export_tax])
    db.flush()
    core = Product(sku="BL-CORE", name="Brightloop Core ERP", product_type="RECURRING_SOFTWARE", sales_price_cents=120000, cost_price_cents=40000, notes="Core business operations suite.")
    analytics = Product(sku="BL-AI", name="Brightloop AI Analytics", product_type="ADDON", sales_price_cents=30000, cost_price_cents=6000, notes="Predictive revenue and usage insights.")
    payroll = Product(sku="BL-PAY", name="Brightloop Payroll", product_type="ADDON", sales_price_cents=45000, cost_price_cents=11000, notes="Payroll automation module.")
    node = Product(sku="BL-NODE", name="Dedicated Cloud Node", product_type="SERVICE", sales_price_cents=80000, cost_price_cents=35000, notes="Dedicated compute capacity.")
    db.add_all([core, analytics, payroll, node])
    db.flush()
    variant = ProductVariant(product_id=core.id, attribute_name="Brand", attribute_value="Odoo", price_delta_cents=56000, cost_delta_cents=0)
    db.add(variant)
    db.flush()

    flex = Plan(code="MONTHLY-FLEX", name="Monthly Flex Plan", description="A flexible monthly plan for growing teams.", billing_interval="MONTHLY", min_quantity=1, available_from=date(2026, 1, 1), allow_pause=True, allow_early_close=True, allow_renew=True, default_duration_days=365)
    annual = Plan(code="ANNUAL-LOCK", name="Enterprise Annual Lock-In", description="Annual commitment for enterprise deployments.", billing_interval="YEARLY", min_quantity=10, available_from=date(2026, 1, 1), auto_close_on_end=False, allow_early_close=False, allow_pause=False, allow_renew=True, default_duration_days=365)
    pilot = Plan(code="90-DAY-PILOT", name="90-Day Pilot Plan", description="A guided pilot with automatic closure.", billing_interval="MONTHLY", min_quantity=5, available_from=date(2026, 1, 1), auto_close_on_end=True, allow_early_close=True, allow_pause=False, allow_renew=False, default_duration_days=90)
    db.add_all([flex, annual, pilot])
    db.flush()

    seat_discount = DiscountRule(code="SEAT-EXPANSION-15", name="Seat Expansion 15%", discount_type="PERCENTAGE", value=1500, scope="SUBSCRIPTION", min_purchase_cents=0, min_quantity=10, start_date=date(2026, 1, 1), end_date=date(2027, 12, 31), max_uses=3)
    launch_discount = DiscountRule(code="ODOO-LAUNCH-500", name="Odoo Launch ₹500", discount_type="FIXED", value=50000, scope="PRODUCT", min_purchase_cents=200000, min_quantity=1, start_date=date(2026, 1, 1), end_date=date(2027, 12, 31), max_uses=2)
    db.add_all([seat_discount, launch_discount])
    db.flush()
    db.add(DiscountProduct(discount_id=launch_discount.id, product_id=core.id))

    enterprise_template = QuotationTemplate(name="Enterprise 15-Seat Odoo Bundle", description="15-seat enterprise starter bundle.", plan_id=annual.id, validity_days=15, payment_terms="NET_30")
    enterprise_template.lines = [QuotationTemplateLine(product_id=core.id, variant_id=variant.id, quantity=15, tax_rule_id=standard_tax.id), QuotationTemplateLine(product_id=analytics.id, quantity=1, tax_rule_id=standard_tax.id)]
    smb_template = QuotationTemplate(name="SMB Monthly Starter Pack", description="A monthly starter quote for a small business.", plan_id=flex.id, validity_days=7, payment_terms="NET_15")
    smb_template.lines = [QuotationTemplateLine(product_id=core.id, quantity=1, tax_rule_id=standard_tax.id)]
    db.add_all([enterprise_template, smb_template])
    db.flush()

    today = DEFAULT_CLOCK
    apex, northstar = users[2], users[4]
    sub1 = Subscription(number="SUB-2026-00001", customer_id=apex.id, plan_id=flex.id, status="ACTIVE", start_date=date(2026, 8, 1), expiry_date=date(2027, 8, 1), next_billing_date=date(2026, 10, 1), payment_terms="NET_15", discount_id=seat_discount.id)
    sub1.lines = [
        SubscriptionLine(product_id=core.id, variant_id=variant.id, quantity=15, unit_price_cents=176000, unit_cost_cents=40000, tax_rule_id=standard_tax.id, tax_rate_basis_points=1800),
        SubscriptionLine(product_id=analytics.id, quantity=1, unit_price_cents=30000, unit_cost_cents=6000, tax_rule_id=standard_tax.id, tax_rate_basis_points=1800, is_addon=True),
    ]
    sub2 = Subscription(number="SUB-2026-00002", customer_id=northstar.id, plan_id=pilot.id, status="ACTIVE", start_date=date(2026, 9, 15), expiry_date=date(2026, 12, 15), next_billing_date=date(2026, 11, 15), payment_terms="NET_15")
    sub2.lines = [SubscriptionLine(product_id=core.id, quantity=5, unit_price_cents=120000, unit_cost_cents=40000, tax_rule_id=standard_tax.id, tax_rate_basis_points=1800)]
    sub3 = Subscription(number="SUB-2026-00003", customer_id=apex.id, plan_id=annual.id, status="PAUSED", start_date=date(2026, 6, 1), expiry_date=date(2027, 6, 1), next_billing_date=date(2026, 12, 1), payment_terms="NET_30", paused_at=date(2026, 10, 2))
    sub3.lines = [SubscriptionLine(product_id=core.id, quantity=10, unit_price_cents=120000, unit_cost_cents=40000, tax_rule_id=standard_tax.id, tax_rate_basis_points=1800)]
    quote = Subscription(number="SUB-2026-00004", customer_id=apex.id, plan_id=flex.id, template_id=smb_template.id, status="QUOTATION", start_date=today, expiry_date=date(2027, 10, 31), quote_valid_until=today + timedelta(days=7), next_billing_date=today, payment_terms="NET_15")
    quote.lines = [SubscriptionLine(product_id=core.id, quantity=1, unit_price_cents=120000, unit_cost_cents=40000, tax_rule_id=standard_tax.id, tax_rate_basis_points=1800)]
    db.add_all([sub1, sub2, sub3, quote])
    db.flush()

    overdue = Invoice(number="INV-2026-00001", subscription_id=sub1.id, customer_id=apex.id, billing_period_start=date(2026, 9, 1), billing_period_end=date(2026, 10, 1), issue_date=date(2026, 9, 1), due_date=date(2026, 9, 16), status="CONFIRMED", subtotal_cents=100000, discount_cents=0, tax_cents=18000, total_cents=118000, amount_paid_cents=50000, amount_due_cents=68000, dunning_stage=1)
    overdue.lines = [InvoiceLine(product_id=core.id, description="Brightloop Core ERP", quantity=1, unit_price_cents=100000, tax_rate_basis_points=1800, tax_cents=18000, total_cents=118000)]
    db.add(overdue)
    db.flush()
    db.add(Payment(reference="PAY-2026-00001", invoice_id=overdue.id, customer_id=apex.id, method="BANK_TRANSFER", amount_cents=50000, payment_date=date(2026, 9, 10), note="Part payment received from Apex Logistics"))
    db.add(SystemSetting(key="virtual_system_date", value=today.isoformat()))
    # Audit helpers read the virtual clock before committing; persist the pending
    # setting first so clock_date() does not enqueue a duplicate primary key.
    db.flush()
    db.add(OutboxMessage(channel="EMAIL", recipient="customer@brightloop.local", subject="Your Brightloop quotation is ready", body="Your SMB Monthly Starter Pack quotation is ready to review.", related_type="QUOTATION", related_id=quote.id, created_virtual_date=today))
    record_event(db, admin.id, "SYSTEM", 1, "DEMO_SEEDED", "Seed data created for the Brightloop hackathon demo.")
    db.commit()
