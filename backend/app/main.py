from __future__ import annotations

import hashlib
import csv
import io
import os
import re
import secrets
import time
from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from difflib import SequenceMatcher

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from .database import Base, SessionLocal, engine, get_db
from . import models
from .models import (
    DiscountProduct, DiscountRule, Invoice, InvoiceLine, OutboxMessage, PasswordResetToken,
    Payment, Plan, Product, ProductVariant, QuotationTemplate, QuotationTemplateLine,
    ReconciliationBatch, ReconciliationItem,
    Subscription, SubscriptionLine, SystemSetting, TaxRule, User, UserSession,
)
from .schemas import (
    AddonToggleIn, DemoLoginIn, DiscountCreateIn, ForgotPasswordIn, FromTemplateIn,
    LoginIn, PaymentCreateIn, ReconciliationImportIn, PlanCreateIn, ProductCreateIn, ResetPasswordIn,
    SignupIn, StaffCreateIn, SubscriptionCreateIn, TaxCreateIn, TemplateCreateIn,
    TimeAdvanceIn, TransitionIn,
)
from .security import get_current_user, hash_password, issue_session, require_roles, revoke_session, verify_password
from .services import (
    add_interval, clock_date, enqueue, generate_invoice, payment_terms_days,
    record_event, round_ratio_half_up, seed_database, set_clock,
)


app = FastAPI(title="Brightloop OS API", version="0.1.0", description="Subscription lifecycle and recurring billing demo API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def execution_time_header(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Execution-Time-Ms"] = f"{elapsed_ms:.1f}"
    return response


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_database(db)


def user_data(user: User) -> dict:
    return {"id": user.id, "email": user.email, "full_name": user.full_name, "company_name": user.company_name, "role": user.role}


def _user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(func.lower(User.email) == email.lower()))


def _validate_password(password: str) -> None:
    import re
    if len(password) < 9 or not re.search(r"[A-Z]", password) or not re.search(r"[a-z]", password) or not re.search(r"[^A-Za-z0-9\s]", password):
        raise HTTPException(422, "Use at least 9 characters, including uppercase, lowercase, and a special character.")


def _product_data(db: Session, product: Product, include_cost: bool = True) -> dict:
    data = {
        "id": product.id, "sku": product.sku, "name": product.name, "product_type": product.product_type,
        "sales_price_cents": product.sales_price_cents,
        "notes": product.notes, "is_active": product.is_active,
        "variants": [{"id": v.id, "attribute_name": v.attribute_name, "attribute_value": v.attribute_value, "price_delta_cents": v.price_delta_cents, **({"cost_delta_cents": v.cost_delta_cents} if include_cost else {})} for v in product.variants],
    }
    if include_cost:
        data["cost_price_cents"] = product.cost_price_cents
    return data


def _plan_data(plan: Plan) -> dict:
    return {"id": plan.id, "code": plan.code, "name": plan.name, "description": plan.description, "billing_interval": plan.billing_interval, "min_quantity": plan.min_quantity, "available_from": plan.available_from.isoformat() if plan.available_from else None, "available_to": plan.available_to.isoformat() if plan.available_to else None, "auto_close_on_end": plan.auto_close_on_end, "allow_early_close": plan.allow_early_close, "allow_pause": plan.allow_pause, "allow_renew": plan.allow_renew, "default_duration_days": plan.default_duration_days, "is_active": plan.is_active}


def _discount_data(rule: DiscountRule, db: Session) -> dict:
    product_ids = db.scalars(select(DiscountProduct.product_id).where(DiscountProduct.discount_id == rule.id)).all()
    return {"id": rule.id, "code": rule.code, "name": rule.name, "discount_type": rule.discount_type, "value": rule.value, "scope": rule.scope, "min_purchase_cents": rule.min_purchase_cents, "min_quantity": rule.min_quantity, "start_date": rule.start_date.isoformat(), "end_date": rule.end_date.isoformat(), "max_uses": rule.max_uses, "current_uses": rule.current_uses, "is_active": rule.is_active, "product_ids": product_ids}


def _subscription_data(db: Session, sub: Subscription, current_user: User) -> dict:
    plan = db.get(Plan, sub.plan_id)
    customer = db.get(User, sub.customer_id)
    lines = []
    subtotal = cost = 0
    for line in sub.lines:
        product = db.get(Product, line.product_id)
        variant = db.get(ProductVariant, line.variant_id) if line.variant_id else None
        amount = line.unit_price_cents * line.quantity if line.is_active else 0
        subtotal += amount
        cost += line.unit_cost_cents * line.quantity if line.is_active else 0
        line_data = {"id": line.id, "product_id": line.product_id, "product_name": product.name if product else "Product", "variant_id": line.variant_id, "variant_name": f"{variant.attribute_name}: {variant.attribute_value}" if variant else "", "quantity": line.quantity, "unit_price_cents": line.unit_price_cents, "pending_proration_cents": line.pending_proration_cents, "tax_rate_basis_points": line.tax_rate_basis_points, "is_addon": line.is_addon, "is_active": line.is_active}
        if current_user.role != "CUSTOMER":
            line_data["unit_cost_cents"] = line.unit_cost_cents
        lines.append(line_data)
    discount = db.get(DiscountRule, sub.discount_id) if sub.discount_id else None
    data = {"id": sub.id, "number": sub.number, "customer_id": sub.customer_id, "customer_name": customer.company_name or customer.full_name if customer else "Customer", "customer_email": customer.email if customer else "", "plan_id": sub.plan_id, "plan_name": plan.name if plan else "Plan", "billing_interval": plan.billing_interval if plan else "MONTHLY", "plan_flags": {"allow_pause": plan.allow_pause, "allow_early_close": plan.allow_early_close, "allow_renew": plan.allow_renew, "auto_close_on_end": plan.auto_close_on_end} if plan else {}, "template_id": sub.template_id, "status": sub.status, "start_date": sub.start_date.isoformat(), "expiry_date": sub.expiry_date.isoformat(), "quote_valid_until": sub.quote_valid_until.isoformat() if sub.quote_valid_until else None, "quote_expired": sub.quote_expired, "next_billing_date": sub.next_billing_date.isoformat(), "payment_terms": sub.payment_terms, "discount_id": sub.discount_id, "discount_code": discount.code if discount else "", "subtotal_cents": subtotal, "lines": lines, "can_manage": current_user.role != "CUSTOMER" or current_user.id == sub.customer_id}
    if current_user.role != "CUSTOMER":
        data.update({"cost_cents": cost, "margin_cents": subtotal - cost, "margin_percent": round((subtotal - cost) / subtotal * 100, 1) if subtotal else 0})
    return data


def _invoice_data(db: Session, invoice: Invoice, current_user: User) -> dict:
    customer = db.get(User, invoice.customer_id)
    subscription = db.get(Subscription, invoice.subscription_id)
    return {"id": invoice.id, "number": invoice.number, "subscription_id": invoice.subscription_id, "subscription_number": subscription.number if subscription else "", "customer_id": invoice.customer_id, "customer_name": customer.company_name or customer.full_name if customer else "Customer", "customer_email": customer.email if customer else "", "billing_period_start": invoice.billing_period_start.isoformat(), "billing_period_end": invoice.billing_period_end.isoformat(), "issue_date": invoice.issue_date.isoformat(), "due_date": invoice.due_date.isoformat(), "status": invoice.status, "payment_state": "PAID" if invoice.amount_due_cents == 0 else "PARTIALLY PAID" if invoice.amount_paid_cents > 0 else "UNPAID", "subtotal_cents": invoice.subtotal_cents, "discount_cents": invoice.discount_cents, "tax_cents": invoice.tax_cents, "total_cents": invoice.total_cents, "amount_paid_cents": invoice.amount_paid_cents, "amount_due_cents": invoice.amount_due_cents, "discount_code": invoice.discount_code, "discount_note": invoice.discount_note, "dunning_stage": invoice.dunning_stage, "lines": [{"id": line.id, "description": line.description, "quantity": line.quantity, "unit_price_cents": line.unit_price_cents, "discount_cents": line.discount_cents, "tax_cents": line.tax_cents, "tax_rate_basis_points": line.tax_rate_basis_points, "total_cents": line.total_cents} for line in invoice.lines]}


def _create_subscription(db: Session, actor: User, payload: SubscriptionCreateIn) -> Subscription:
    customer_id = payload.customer_id or actor.id
    if actor.role == "CUSTOMER" and customer_id != actor.id:
        raise HTTPException(403, "Customers can only create subscriptions for themselves.")
    customer = db.get(User, customer_id)
    plan = db.get(Plan, payload.plan_id)
    if not customer or customer.role != "CUSTOMER":
        raise HTTPException(404, "Customer not found.")
    if not plan or not plan.is_active:
        raise HTTPException(404, "Plan not found or inactive.")
    if plan.available_from and payload.start_date < plan.available_from or plan.available_to and payload.start_date > plan.available_to:
        raise HTTPException(422, "The selected start date is outside this plan's availability window.")
    core_quantity = sum(line.quantity for line in payload.lines if not line.is_addon)
    if core_quantity < plan.min_quantity:
        raise HTTPException(422, f"This plan requires at least {plan.min_quantity} seats.")
    discount = db.get(DiscountRule, payload.discount_id) if payload.discount_id else None
    if payload.discount_id and not discount:
        raise HTTPException(404, "Discount rule not found.")
    today = clock_date(db)
    start = payload.start_date
    expiry = payload.expiry_date or (start + timedelta(days=plan.default_duration_days))
    template = db.get(QuotationTemplate, payload.template_id) if payload.template_id else None
    sub = Subscription(number=f"SUB-{today.year}-{secrets.token_hex(3).upper()}", customer_id=customer_id, plan_id=plan.id, template_id=template.id if template else None, status="QUOTATION" if payload.create_as_quote else "DRAFT", start_date=start, expiry_date=expiry, quote_valid_until=today + timedelta(days=template.validity_days if template else 15) if payload.create_as_quote else None, next_billing_date=start, billing_anchor_day=start.day, payment_terms=payload.payment_terms, discount_id=discount.id if discount else None)
    for item in payload.lines:
        product = db.get(Product, item.product_id)
        if not product or not product.is_active:
            raise HTTPException(422, "One or more selected products are unavailable.")
        variant = db.get(ProductVariant, item.variant_id) if item.variant_id else None
        if item.variant_id and (not variant or variant.product_id != product.id):
            raise HTTPException(422, "A selected variant does not belong to its product.")
        tax = db.get(TaxRule, item.tax_rule_id) if item.tax_rule_id else db.scalar(select(TaxRule).where(TaxRule.is_default.is_(True), TaxRule.is_active.is_(True)))
        price = product.sales_price_cents + (variant.price_delta_cents if variant else 0)
        cost = product.cost_price_cents + (variant.cost_delta_cents if variant else 0)
        if price < 0 or cost < 0:
            raise HTTPException(422, "Variant pricing cannot make the effective price or cost negative.")
        sub.lines.append(SubscriptionLine(product_id=product.id, variant_id=variant.id if variant else None, quantity=item.quantity, unit_price_cents=price, unit_cost_cents=cost, tax_rule_id=tax.id if tax else None, tax_rate_basis_points=tax.rate_basis_points if tax else 0, is_addon=item.is_addon or product.product_type == "ADDON"))
    db.add(sub)
    db.flush()
    record_event(db, actor.id, "SUBSCRIPTION", sub.id, "CREATED", sub.status)
    if sub.status == "QUOTATION":
        enqueue(db, customer.email, f"Quotation {sub.number} is ready", f"Your quotation is valid through {sub.quote_valid_until.isoformat()}.", "QUOTATION", sub.id)
    return sub


def _run_billing(db: Session, actor_id: int | None, today: date) -> dict:
    due = db.scalars(select(Subscription).options(selectinload(Subscription.lines)).where(Subscription.status == "ACTIVE", Subscription.next_billing_date <= today).order_by(Subscription.next_billing_date).limit(10000)).all()
    generated: list[Invoice] = []
    skipped = 0
    for sub in due:
        plan = db.get(Plan, sub.plan_id)
        if not plan:
            skipped += 1
            continue
        if not any(line.is_active for line in sub.lines):
            skipped += 1
            continue
        periods = 0
        while sub.next_billing_date <= today and periods < 1200:
            if sub.next_billing_date >= sub.expiry_date:
                if plan.auto_close_on_end and sub.expiry_date <= today:
                    sub.status, sub.closed_at, sub.close_reason = "CLOSED", today, "Plan reached its end date."
                    record_event(db, actor_id, "SUBSCRIPTION", sub.id, "AUTO_CLOSED", sub.close_reason)
                break
            # The database unique key is the final guard if two billing requests race.
            try:
                with db.begin_nested():
                    invoice = generate_invoice(db, sub, plan, today)
                    if invoice:
                        generated.append(invoice)
                    else:
                        skipped += 1
            except IntegrityError:
                skipped += 1
                db.refresh(sub)
            periods += 1
    db.flush()
    return {"evaluated": len(due), "generated": len(generated), "skipped": skipped, "invoice_ids": [item.id for item in generated]}


def _process_dunning(db: Session, today: date) -> int:
    invoices = db.scalars(select(Invoice).where(Invoice.status == "CONFIRMED", Invoice.amount_due_cents > 0, Invoice.due_date < today)).all()
    messages = 0
    for invoice in invoices:
        overdue_days = (today - invoice.due_date).days
        next_stage = 3 if overdue_days >= 14 else 2 if overdue_days >= 7 else 1 if overdue_days >= 3 else 0
        if next_stage > invoice.dunning_stage:
            customer = db.get(User, invoice.customer_id)
            for stage in range(invoice.dunning_stage + 1, next_stage + 1):
                if stage == 1:
                    subject = f"A friendly reminder: {invoice.number}"
                    body = f"Invoice {invoice.number} is 3 days past due. The open balance is ${invoice.amount_due_cents / 100:,.2f}. Please review it in your customer portal."
                elif stage == 2:
                    subject = f"Finance follow-up: {invoice.number}"
                    body = f"Invoice {invoice.number} is 7 days past due. ${invoice.amount_due_cents / 100:,.2f} remains outstanding. Please arrange payment or contact the finance team."
                else:
                    subject = f"Service review notice: {invoice.number}"
                    body = f"Invoice {invoice.number} is 14 or more days past due, with ${invoice.amount_due_cents / 100:,.2f} outstanding. Contact the finance team to avoid a service restriction review."
                enqueue(db, customer.email if customer else "", subject, body, "DUNNING", invoice.id, "http://localhost:5173")
                record_event(db, None, "INVOICE", invoice.id, "DUNNING_STAGE", str(stage))
                messages += 1
            invoice.dunning_stage = next_stage
    return messages


def _process_clock(db: Session, today: date, previous_date: date | None = None) -> dict:
    prebilling_messages = 0
    if previous_date:
        upcoming = db.scalars(select(Subscription).where(Subscription.status == "ACTIVE", Subscription.next_billing_date > previous_date, Subscription.next_billing_date <= today + timedelta(days=3))).all()
        for sub in upcoming:
            plan = db.get(Plan, sub.plan_id)
            lead_days = 0 if plan and plan.billing_interval == "DAILY" else 3
            reminder_date = sub.next_billing_date - timedelta(days=lead_days)
            if previous_date <= reminder_date <= today and sub.last_prebilling_reminder_for != sub.next_billing_date:
                customer = db.get(User, sub.customer_id)
                enqueue(db, customer.email if customer else "", f"Renewal coming up: {sub.number}", f"Your {plan.name if plan else 'subscription'} renews on {sub.next_billing_date.isoformat()}. Review your subscription and active add-ons in the customer portal.", "RENEWAL_REMINDER", sub.id, "http://localhost:5173")
                sub.last_prebilling_reminder_for = sub.next_billing_date
                record_event(db, None, "SUBSCRIPTION", sub.id, "PREBILL_REMINDER", sub.next_billing_date.isoformat())
                prebilling_messages += 1
    expired = 0
    subscriptions = db.scalars(select(Subscription).where(Subscription.status == "QUOTATION", Subscription.quote_expired.is_(False), Subscription.quote_valid_until < today)).all()
    for sub in subscriptions:
        sub.quote_expired = True
        expired += 1
        record_event(db, None, "SUBSCRIPTION", sub.id, "QUOTE_EXPIRED")
    auto_closed = 0
    active = db.scalars(select(Subscription).where(Subscription.status == "ACTIVE", Subscription.expiry_date <= today)).all()
    for sub in active:
        plan = db.get(Plan, sub.plan_id)
        if plan and plan.auto_close_on_end:
            sub.status, sub.closed_at, sub.close_reason = "CLOSED", today, "Plan reached its end date."
            record_event(db, None, "SUBSCRIPTION", sub.id, "AUTO_CLOSED", sub.close_reason)
            auto_closed += 1
    billing = _run_billing(db, None, today)
    dunning = _process_dunning(db, today)
    return {"quotes_expired": expired, "auto_closed": auto_closed, "billing": billing, "dunning_messages": dunning, "prebilling_messages": prebilling_messages}


def _previous_interval(end: date, interval: str, anchor_day: int) -> date:
    if interval == "DAILY":
        return end - timedelta(days=1)
    if interval == "WEEKLY":
        return end - timedelta(days=7)
    if interval == "YEARLY":
        year = end.year - 1
        return end.replace(year=year, day=min(anchor_day, monthrange(year, end.month)[1]))
    month = end.month - 1
    year = end.year - (1 if month == 0 else 0)
    month = 12 if month == 0 else month
    return end.replace(year=year, month=month, day=min(anchor_day, monthrange(year, month)[1]))


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "brightloop-os"}


@app.post("/api/auth/signup")
def signup(payload: SignupIn, response: Response, db: Session = Depends(get_db)):
    if _user_by_email(db, payload.email):
        raise HTTPException(409, "An account with this email already exists.")
    user = User(email=payload.email.lower(), full_name=payload.full_name, company_name=payload.company_name, password_hash=hash_password(payload.password), role="CUSTOMER")
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists.")
    issue_session(response, db, user)
    return {"user": user_data(user)}


@app.post("/api/auth/login")
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = _user_by_email(db, payload.email)
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Email or password is incorrect.")
    issue_session(response, db, user)
    return {"user": user_data(user)}


@app.post("/api/auth/demo-login")
def demo_login(payload: DemoLoginIn, response: Response, db: Session = Depends(get_db)):
    if os.getenv("BRIGHTLOOP_DEMO_MODE", "false").lower() != "true":
        raise HTTPException(404, "Demo persona login is disabled.")
    emails = {"ADMIN": "admin@brightloop.local", "STAFF": "staff@brightloop.local", "FINANCE": "finance@brightloop.local", "CUSTOMER": "customer@brightloop.local"}
    user = _user_by_email(db, emails[payload.persona])
    if not user:
        raise HTTPException(404, "Demo account is unavailable.")
    issue_session(response, db, user)
    return {"user": user_data(user)}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    revoke_session(request, response, db)
    return {"ok": True}


@app.get("/api/auth/me")
def whoami(user: User = Depends(get_current_user)):
    return {"user": user_data(user)}


@app.post("/api/auth/forgot-password")
def forgot_password(payload: ForgotPasswordIn, db: Session = Depends(get_db)):
    user = _user_by_email(db, payload.email)
    if user:
        token = secrets.token_urlsafe(36)
        db.add(PasswordResetToken(user_id=user.id, token_hash=hashlib.sha256(token.encode()).hexdigest(), expires_at=datetime.utcnow() + timedelta(hours=1)))
        enqueue(db, user.email, "Reset your Brightloop password", "Use the secure one-time reset link. It expires in one hour.", "AUTH_RESET", user.id, f"http://localhost:5173/reset?token={token}")
        db.commit()
    return {"message": "If the account exists, a reset link has been placed in the local outbox."}


@app.post("/api/auth/reset-password")
def reset_password(payload: ResetPasswordIn, db: Session = Depends(get_db)):
    _validate_password(payload.new_password)
    digest = hashlib.sha256(payload.token.encode()).hexdigest()
    token = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == digest, PasswordResetToken.used_at.is_(None), PasswordResetToken.expires_at > datetime.utcnow()))
    if not token:
        raise HTTPException(400, "This reset link is invalid or expired.")
    user = db.get(User, token.user_id)
    user.password_hash = hash_password(payload.new_password)
    token.used_at = datetime.utcnow()
    db.query(UserSession).filter(UserSession.user_id == user.id).delete()
    db.commit()
    return {"message": "Password updated. Sign in with your new password."}


@app.post("/api/admin/staff")
def create_staff(payload: StaffCreateIn, actor: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    _validate_password(payload.password)
    if _user_by_email(db, payload.email):
        raise HTTPException(409, "An account with this email already exists.")
    user = User(email=payload.email.lower(), full_name=payload.full_name, password_hash=hash_password(payload.password), role="STAFF")
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists.")
    record_event(db, actor.id, "USER", user.id, "STAFF_CREATED")
    db.commit()
    return {"user": user_data(user)}


@app.get("/api/users/customers")
def list_customers(actor: User = Depends(require_roles("ADMIN", "STAFF")), db: Session = Depends(get_db)):
    users = db.scalars(select(User).where(User.role == "CUSTOMER", User.is_active.is_(True)).order_by(User.company_name, User.full_name)).all()
    return {"items": [{"id": u.id, "name": u.company_name or u.full_name, "email": u.email} for u in users]}


@app.get("/api/users/staff")
def list_staff(actor: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    users = db.scalars(select(User).where(User.role == "STAFF", User.is_active.is_(True)).order_by(User.full_name)).all()
    return {"items": [user_data(user) for user in users]}


@app.get("/api/catalog")
def catalog(actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    products = db.scalars(select(Product).options(selectinload(Product.variants)).where(Product.is_active.is_(True)).order_by(Product.name)).all()
    plans = db.scalars(select(Plan).where(Plan.is_active.is_(True)).order_by(Plan.name)).all()
    taxes = db.scalars(select(TaxRule).where(TaxRule.is_active.is_(True)).order_by(TaxRule.name)).all()
    discounts = db.scalars(select(DiscountRule).where(DiscountRule.is_active.is_(True)).order_by(DiscountRule.code)).all()
    templates = db.scalars(select(QuotationTemplate).options(selectinload(QuotationTemplate.lines)).order_by(QuotationTemplate.name)).all()
    return {"products": [_product_data(db, p, include_cost=actor.role != "CUSTOMER") for p in products], "plans": [_plan_data(p) for p in plans], "taxes": [{"id": t.id, "name": t.name, "rate_basis_points": t.rate_basis_points, "is_default": t.is_default} for t in taxes], "discounts": [_discount_data(d, db) for d in discounts], "templates": [{"id": t.id, "name": t.name, "description": t.description, "plan_id": t.plan_id, "validity_days": t.validity_days, "payment_terms": t.payment_terms, "lines": [{"product_id": l.product_id, "variant_id": l.variant_id, "quantity": l.quantity, "tax_rule_id": l.tax_rule_id} for l in t.lines]} for t in templates]}


@app.post("/api/products")
def create_product(payload: ProductCreateIn, actor: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    product = Product(**payload.model_dump())
    db.add(product)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That product SKU is already in use.")
    record_event(db, actor.id, "PRODUCT", product.id, "CREATED")
    db.commit()
    return _product_data(db, product)


@app.post("/api/products/{product_id}/variants")
def create_variant(product_id: int, payload: dict, actor: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(404, "Product not found.")
    try:
        variant = ProductVariant(product_id=product_id, attribute_name=str(payload["attribute_name"]), attribute_value=str(payload["attribute_value"]), price_delta_cents=int(payload.get("price_delta_cents", 0)), cost_delta_cents=int(payload.get("cost_delta_cents", 0)))
    except (KeyError, ValueError, TypeError):
        raise HTTPException(422, "Provide a variant name, value, and valid cent amounts.")
    db.add(variant)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That variant already exists.")
    return {"id": variant.id, "attribute_name": variant.attribute_name, "attribute_value": variant.attribute_value, "price_delta_cents": variant.price_delta_cents, "cost_delta_cents": variant.cost_delta_cents}


@app.post("/api/plans")
def create_plan(payload: PlanCreateIn, actor: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    if payload.available_from and payload.available_to and payload.available_to < payload.available_from:
        raise HTTPException(422, "The plan end date must be on or after its start date.")
    plan = Plan(**payload.model_dump())
    db.add(plan)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That plan code is already in use.")
    return _plan_data(plan)


@app.post("/api/taxes")
def create_tax(payload: TaxCreateIn, actor: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    if payload.is_default:
        db.query(TaxRule).update({TaxRule.is_default: False})
    tax = TaxRule(**payload.model_dump())
    db.add(tax)
    db.commit()
    return {"id": tax.id, "name": tax.name, "rate_basis_points": tax.rate_basis_points, "is_default": tax.is_default}


@app.post("/api/discounts")
def create_discount(payload: DiscountCreateIn, actor: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    if payload.end_date < payload.start_date:
        raise HTTPException(422, "The discount end date must be on or after its start date.")
    if payload.discount_type == "PERCENTAGE" and payload.value > 10000:
        raise HTTPException(422, "A percentage discount cannot exceed 100%.")
    if payload.scope == "PRODUCT" and not payload.product_ids:
        raise HTTPException(422, "Select at least one eligible product for a product-scoped discount.")
    rule = DiscountRule(code=payload.code.upper(), name=payload.name, discount_type=payload.discount_type, value=payload.value, scope=payload.scope, min_purchase_cents=payload.min_purchase_cents, min_quantity=payload.min_quantity, start_date=payload.start_date, end_date=payload.end_date, max_uses=payload.max_uses)
    db.add(rule)
    db.flush()
    for product_id in payload.product_ids:
        if not db.get(Product, product_id):
            raise HTTPException(422, f"Product {product_id} does not exist.")
        db.add(DiscountProduct(discount_id=rule.id, product_id=product_id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That discount code is already in use.")
    return _discount_data(rule, db)


@app.post("/api/quotation-templates")
def create_template(payload: TemplateCreateIn, actor: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    if not db.get(Plan, payload.plan_id):
        raise HTTPException(404, "Plan not found.")
    template = QuotationTemplate(name=payload.name, description=payload.description, plan_id=payload.plan_id, validity_days=payload.validity_days, payment_terms=payload.payment_terms)
    template.lines = [QuotationTemplateLine(product_id=line.product_id, variant_id=line.variant_id, quantity=line.quantity, tax_rule_id=line.tax_rule_id) for line in payload.lines]
    db.add(template)
    db.commit()
    return {"id": template.id, "name": template.name}


@app.get("/api/subscriptions")
def list_subscriptions(status_filter: str | None = None, search: str | None = None, limit: int = 200, offset: int = 0, actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(Subscription).options(selectinload(Subscription.lines)).order_by(Subscription.created_at.desc()).limit(min(max(limit, 1), 500)).offset(max(offset, 0))
    if actor.role == "CUSTOMER":
        stmt = stmt.where(Subscription.customer_id == actor.id)
    if status_filter:
        stmt = stmt.where(Subscription.status == status_filter.upper())
    if search:
        stmt = stmt.where(Subscription.number.ilike(f"%{search}%"))
    subs = db.scalars(stmt).all()
    return {"items": [_subscription_data(db, sub, actor) for sub in subs], "limit": min(max(limit, 1), 500), "offset": max(offset, 0)}


@app.post("/api/subscriptions")
def create_subscription(payload: SubscriptionCreateIn, actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sub = _create_subscription(db, actor, payload)
    db.commit()
    db.refresh(sub)
    return _subscription_data(db, sub, actor)


@app.post("/api/quotes/from-template")
def create_quote_from_template(payload: FromTemplateIn, actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    customer_id = payload.customer_id or actor.id
    if actor.role == "CUSTOMER" and customer_id != actor.id:
        raise HTTPException(403, "Customers can only create quotations for themselves.")
    template = db.scalar(select(QuotationTemplate).options(selectinload(QuotationTemplate.lines)).where(QuotationTemplate.id == payload.template_id))
    if not template:
        raise HTTPException(404, "Quotation template not found.")
    items = [{"product_id": line.product_id, "variant_id": line.variant_id, "quantity": payload.quantities.get(line.product_id, line.quantity), "tax_rule_id": line.tax_rule_id, "is_addon": False} for line in template.lines]
    create_payload = SubscriptionCreateIn(customer_id=customer_id, plan_id=template.plan_id, template_id=template.id, start_date=payload.start_date, payment_terms=template.payment_terms, discount_id=payload.discount_id, lines=items, create_as_quote=True)
    sub = _create_subscription(db, actor, create_payload)
    db.commit()
    db.refresh(sub)
    return _subscription_data(db, sub, actor)


@app.patch("/api/subscriptions/{subscription_id}/status")
def transition_subscription(subscription_id: int, payload: TransitionIn, actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sub = db.scalar(select(Subscription).options(selectinload(Subscription.lines)).where(Subscription.id == subscription_id))
    if not sub:
        raise HTTPException(404, "Subscription not found.")
    if actor.role == "CUSTOMER" and sub.customer_id != actor.id:
        raise HTTPException(404, "Subscription not found.")
    target, today = payload.target_status, clock_date(db)
    plan = db.get(Plan, sub.plan_id)
    current = sub.status
    allowed = False
    if current == "DRAFT" and target == "QUOTATION" and actor.role in ("ADMIN", "STAFF"):
        allowed = True
        if not sub.lines:
            raise HTTPException(422, "Add at least one subscription line before sending a quotation.")
        template = db.get(QuotationTemplate, sub.template_id) if sub.template_id else None
        sub.quote_valid_until = today + timedelta(days=template.validity_days if template else 15)
        customer = db.get(User, sub.customer_id)
        enqueue(db, customer.email, f"Quotation {sub.number} is ready", f"Review your quotation before {sub.quote_valid_until.isoformat()}.", "QUOTATION", sub.id)
    elif current == "QUOTATION" and target == "CONFIRMED":
        allowed = True
        if sub.quote_expired or sub.quote_valid_until and today > sub.quote_valid_until:
            raise HTTPException(409, "This quotation has expired.")
        if plan.available_from and sub.start_date < plan.available_from or plan.available_to and sub.start_date > plan.available_to:
            raise HTTPException(422, "The subscription start date is outside the plan availability window.")
    elif current == "CONFIRMED" and target == "ACTIVE":
        allowed = True
        if sub.start_date > today:
            sub.next_billing_date = sub.start_date
    elif current == "ACTIVE" and target == "PAUSED":
        allowed = bool(plan.allow_pause)
        if allowed:
            sub.paused_at = today
    elif current == "PAUSED" and target == "ACTIVE":
        allowed = True
        if sub.paused_at:
            paused_days = max((today - sub.paused_at).days, 0)
            sub.expiry_date += timedelta(days=paused_days)
            sub.next_billing_date += timedelta(days=paused_days)
        sub.paused_at = None
    elif current == "ACTIVE" and target == "CLOSED":
        early = today < sub.expiry_date
        allowed = not early or bool(plan.allow_early_close) or actor.role == "ADMIN" and bool(payload.reason)
        if allowed:
            sub.closed_at, sub.close_reason = today, payload.reason or ("Closed early by admin override." if early else "Closed at end of term.")
    elif current == "CLOSED" and target == "ACTIVE" and plan.allow_renew:
        allowed = True
        sub.expiry_date = max(sub.expiry_date, today) + timedelta(days=plan.default_duration_days)
        sub.next_billing_date = max(sub.next_billing_date, today)
        sub.closed_at, sub.close_reason = None, ""
    if not allowed:
        raise HTTPException(409, f"The {current.lower()} → {target.lower()} transition is not allowed by this plan.")
    sub.status = target
    record_event(db, actor.id, "SUBSCRIPTION", sub.id, "STATUS_CHANGED", f"{current} → {target}" + (f": {payload.reason}" if payload.reason else ""))
    db.commit()
    db.refresh(sub)
    return _subscription_data(db, sub, actor)


@app.post("/api/subscriptions/{subscription_id}/addons/toggle")
def toggle_addon(subscription_id: int, payload: AddonToggleIn, actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sub = db.scalar(select(Subscription).options(selectinload(Subscription.lines)).where(Subscription.id == subscription_id))
    if not sub or actor.role == "CUSTOMER" and sub.customer_id != actor.id:
        raise HTTPException(404, "Subscription not found.")
    if sub.status != "ACTIVE":
        raise HTTPException(409, "Add-ons can only be changed on an active subscription.")
    today = clock_date(db)
    if today < sub.start_date:
        raise HTTPException(409, "This subscription has not started yet.")
    product = db.get(Product, payload.product_id)
    if not product or product.product_type != "ADDON":
        raise HTTPException(422, "Choose an active add-on product.")
    plan = db.get(Plan, sub.plan_id)
    cycle_end = sub.next_billing_date
    if cycle_end > today:
        cycle_start = _previous_interval(cycle_end, plan.billing_interval, sub.billing_anchor_day)
    else:
        cycle_start = cycle_end
        cycle_end = add_interval(cycle_start, plan.billing_interval, sub.billing_anchor_day)
        while cycle_end <= today:
            cycle_start = cycle_end
            cycle_end = add_interval(cycle_start, plan.billing_interval, sub.billing_anchor_day)
    total_days = max((cycle_end - cycle_start).days, 1)
    remaining_days = min(max((cycle_end - today).days, 0), total_days)
    line = next((item for item in sub.lines if item.product_id == product.id and item.is_addon), None)
    current_quantity = line.quantity if line and line.is_active else 0
    quantity_delta = payload.quantity - current_quantity
    amount_delta = round_ratio_half_up(product.sales_price_cents * abs(quantity_delta) * remaining_days, total_days * 10000)
    prorated = amount_delta if quantity_delta > 0 else -amount_delta if quantity_delta < 0 else 0
    if payload.quantity == 0:
        if line:
            line.is_active = False
            line.quantity = 0
            line.pending_proration_cents += prorated
    elif line:
        line.quantity = payload.quantity
        line.is_active = True
        line.pending_proration_cents += prorated
    else:
        tax = db.scalar(select(TaxRule).where(TaxRule.is_default.is_(True), TaxRule.is_active.is_(True)))
        sub.lines.append(SubscriptionLine(product_id=product.id, quantity=payload.quantity, unit_price_cents=product.sales_price_cents, unit_cost_cents=product.cost_price_cents, tax_rule_id=tax.id if tax else None, tax_rate_basis_points=tax.rate_basis_points if tax else 0, is_addon=True, pending_proration_cents=prorated))
    record_event(db, actor.id, "SUBSCRIPTION", sub.id, "ADDON_UPDATED", f"{product.name}: {payload.quantity}")
    db.commit()
    return {"subscription": _subscription_data(db, sub, actor), "proration_cents": prorated, "pending_proration_cents": sum(item.pending_proration_cents for item in sub.lines), "remaining_days": remaining_days, "cycle_days": total_days, "next_billing_date": sub.next_billing_date.isoformat(), "effective_date": today.isoformat()}


@app.get("/api/invoices")
def list_invoices(status_filter: str | None = None, search: str | None = None, limit: int = 200, offset: int = 0, actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(Invoice).options(selectinload(Invoice.lines)).order_by(Invoice.issue_date.desc(), Invoice.id.desc()).limit(min(max(limit, 1), 500)).offset(max(offset, 0))
    if actor.role == "CUSTOMER":
        stmt = stmt.where(Invoice.customer_id == actor.id)
    if status_filter:
        stmt = stmt.where(Invoice.status == status_filter.upper())
    if search:
        stmt = stmt.where(Invoice.number.ilike(f"%{search}%"))
    invoices = db.scalars(stmt).all()
    return {"items": [_invoice_data(db, inv, actor) for inv in invoices], "limit": min(max(limit, 1), 500), "offset": max(offset, 0)}


@app.post("/api/billing/run")
def run_billing(actor: User = Depends(require_roles("ADMIN", "STAFF")), db: Session = Depends(get_db)):
    result = _run_billing(db, actor.id, clock_date(db))
    db.commit()
    return result


@app.post("/api/invoices/{invoice_id}/action")
def invoice_action(invoice_id: int, payload: dict, actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    invoice = db.scalar(select(Invoice).options(selectinload(Invoice.lines)).where(Invoice.id == invoice_id))
    if not invoice or actor.role == "CUSTOMER" and invoice.customer_id != actor.id:
        raise HTTPException(404, "Invoice not found.")
    action = str(payload.get("action", "")).upper()
    if action == "CONFIRM":
        if actor.role not in ("ADMIN", "STAFF"):
            raise HTTPException(403, "Only staff can confirm invoices.")
        if invoice.status != "DRAFT":
            raise HTTPException(409, "Only draft invoices can be confirmed.")
        invoice.status = "CONFIRMED"
        customer = db.get(User, invoice.customer_id)
        enqueue(db, customer.email if customer else "", f"Invoice {invoice.number} is ready", f"Your invoice is confirmed with ${invoice.amount_due_cents / 100:,.2f} due. Review it in your Brightloop portal.", "INVOICE", invoice.id, "http://localhost:5173")
    elif action == "CANCEL":
        if actor.role not in ("ADMIN", "STAFF") or invoice.status not in ("DRAFT", "CONFIRMED") or invoice.amount_paid_cents:
            raise HTTPException(409, "Only unpaid draft or confirmed invoices can be cancelled by staff.")
        invoice.status = "CANCELLED"
        if invoice.discount_code:
            rule = db.scalar(select(DiscountRule).where(DiscountRule.code == invoice.discount_code))
            if rule:
                rule.current_uses = max(rule.current_uses - 1, 0)
    elif action == "SEND":
        if actor.role not in ("ADMIN", "STAFF"):
            raise HTTPException(403, "Only staff can send invoices to customers.")
        customer = db.get(User, invoice.customer_id)
        enqueue(db, customer.email if customer else "", f"Invoice {invoice.number}", f"Your invoice balance is ${invoice.amount_due_cents / 100:,.2f}.", "INVOICE", invoice.id)
    elif action != "PRINT":
        raise HTTPException(422, "Supported actions are CONFIRM, CANCEL, SEND, and PRINT.")
    record_event(db, actor.id, "INVOICE", invoice.id, action)
    db.commit()
    db.refresh(invoice)
    return _invoice_data(db, invoice, actor)


@app.post("/api/invoices/{invoice_id}/payments")
def record_payment(invoice_id: int, payload: PaymentCreateIn, actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice or actor.role == "CUSTOMER" and invoice.customer_id != actor.id:
        raise HTTPException(404, "Invoice not found.")
    if invoice.status != "CONFIRMED":
        raise HTTPException(409, "Payments can only be recorded against confirmed invoices.")
    if payload.amount_cents > invoice.amount_due_cents:
        raise HTTPException(422, "Payment amount cannot exceed the invoice balance due.")
    today = clock_date(db)
    payment = Payment(reference=f"PAY-{today.year}-{secrets.token_hex(3).upper()}", invoice_id=invoice.id, customer_id=invoice.customer_id, method=payload.method, amount_cents=payload.amount_cents, payment_date=payload.payment_date or today, note=payload.note, created_at=datetime.utcnow())
    db.add(payment)
    invoice.amount_paid_cents += payload.amount_cents
    invoice.amount_due_cents -= payload.amount_cents
    if invoice.amount_due_cents == 0:
        invoice.status = "PAID"
    record_event(db, actor.id, "INVOICE", invoice.id, "PAYMENT_RECORDED", f"{payment.reference} {payload.amount_cents} cents")
    db.commit()
    db.refresh(invoice)
    return {"payment": {"id": payment.id, "reference": payment.reference, "amount_cents": payment.amount_cents, "method": payment.method, "payment_date": payment.payment_date.isoformat()}, "invoice": _invoice_data(db, invoice, actor)}


def _normalize_match_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _parse_bank_date(value: str) -> date:
    cleaned = value.strip()
    if len(cleaned) >= 10 and cleaned[4:5] == "-" and cleaned[7:8] == "-":
        try:
            return date.fromisoformat(cleaned[:10])
        except ValueError:
            pass
    for format_string in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%m-%d-%Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(cleaned, format_string).date()
        except ValueError:
            continue
    raise ValueError("Use a recognizable date such as YYYY-MM-DD or MM/DD/YYYY.")


def _parse_bank_amount(row: dict[str, str], amount_header: str) -> int:
    raw = (row.get(amount_header) or "").strip()
    if not raw:
        raise ValueError("Amount is required.")
    if amount_header.lower().replace("_", "") == "amountcents":
        try:
            cents = int(raw)
        except ValueError as error:
            raise ValueError("Amount cents must be a whole number.") from error
    else:
        normalized = raw.replace("$", "").replace("₹", "").replace(",", "").strip()
        if normalized.startswith("(") and normalized.endswith(")"):
            normalized = f"-{normalized[1:-1]}"
        try:
            cents = int((Decimal(normalized) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        except (InvalidOperation, ValueError) as error:
            raise ValueError("Amount must be a decimal currency value.") from error
    if cents <= 0:
        raise ValueError("Only positive incoming payment amounts can be reconciled.")
    return cents


def _reconciliation_item_data(db: Session, item: ReconciliationItem) -> dict:
    invoice = db.get(Invoice, item.invoice_id) if item.invoice_id else None
    customer = db.get(User, invoice.customer_id) if invoice else None
    return {"id": item.id, "batch_id": item.batch_id, "row_number": item.row_number, "bank_reference": item.bank_reference, "memo": item.memo, "payer": item.payer, "amount_cents": item.amount_cents, "transaction_date": item.transaction_date.isoformat(), "invoice_id": invoice.id if invoice else None, "invoice_number": invoice.number if invoice else "", "customer_name": (customer.company_name or customer.full_name) if customer else "", "balance_due_cents": invoice.amount_due_cents if invoice else None, "match_score": item.match_score, "match_reason": item.match_reason, "status": item.status, "payment_id": item.payment_id}


@app.get("/api/payments/reconcile")
def list_reconciliation_items(limit: int = 100, actor: User = Depends(require_roles("ADMIN", "STAFF")), db: Session = Depends(get_db)):
    items = db.scalars(select(ReconciliationItem).order_by(ReconciliationItem.id.desc()).limit(min(max(limit, 1), 300))).all()
    return {"items": [_reconciliation_item_data(db, item) for item in items]}


@app.get("/api/payments/reconcile/sample")
def sample_bank_statement(actor: User = Depends(require_roles("ADMIN", "STAFF")), db: Session = Depends(get_db)):
    invoice = db.scalar(select(Invoice).where(Invoice.status == "CONFIRMED", Invoice.amount_due_cents > 0).order_by(Invoice.due_date, Invoice.id).limit(1))
    if not invoice:
        raise HTTPException(409, "Create or confirm an open invoice before loading the sample bank statement.")
    customer = db.get(User, invoice.customer_id)
    amount = max(1, min(invoice.amount_due_cents, invoice.amount_due_cents // 2 or invoice.amount_due_cents))
    csv_content = "date,amount,reference,payer,memo\n" + f"{clock_date(db).isoformat()},{Decimal(amount) / 100:.2f},DEMO-{invoice.number},{customer.company_name or customer.full_name},Partial remittance for {invoice.number}\n"
    return {"filename": "brightloop-sample-bank-feed.csv", "csv_content": csv_content}


@app.post("/api/payments/reconcile/import")
def import_bank_statement(payload: ReconciliationImportIn, actor: User = Depends(require_roles("ADMIN", "STAFF")), db: Session = Depends(get_db)):
    try:
        reader = csv.DictReader(io.StringIO(payload.csv_content.lstrip("\ufeff")))
    except csv.Error as error:
        raise HTTPException(422, f"Could not read the CSV file: {error}") from error
    if not reader.fieldnames:
        raise HTTPException(422, "The CSV file needs a header row.")
    aliases = {re.sub(r"[^a-z0-9]", "", header.lower()): header for header in reader.fieldnames if header}
    def find_header(*names: str) -> str | None:
        return next((aliases[name] for name in names if name in aliases), None)
    date_header = find_header("date", "transactiondate", "valuedate", "paymentdate")
    amount_header = find_header("amount", "amountcents", "credit", "deposit")
    if not date_header or not amount_header:
        raise HTTPException(422, "CSV headers must include date and amount (or amount_cents). Optional headers: reference, payer, memo, invoice_number.")
    reference_header = find_header("reference", "transactionid", "transactionreference", "id", "txn")
    payer_header = find_header("payer", "payeremail", "customer", "customeremail", "customername", "counterparty", "counterpartyname", "name", "email")
    memo_header = find_header("memo", "description", "details", "narration", "remittance")
    invoice_header = find_header("invoicenumber", "invoice", "invoiceid")
    parsed_rows: list[dict] = []
    errors: list[dict] = []
    seen: set[str] = set()
    for row_number, source_row in enumerate(reader, start=2):
        if len(parsed_rows) + len(errors) >= 500:
            raise HTTPException(413, "A statement import is limited to 500 rows.")
        try:
            transaction_date = _parse_bank_date(source_row.get(date_header) or "")
            amount_cents = _parse_bank_amount(source_row, amount_header)
        except ValueError as error:
            errors.append({"row_number": row_number, "error": str(error)})
            continue
        reference = (source_row.get(reference_header) or "").strip() if reference_header else ""
        payer = (source_row.get(payer_header) or "").strip() if payer_header else ""
        memo = (source_row.get(memo_header) or "").strip() if memo_header else ""
        invoice_number = (source_row.get(invoice_header) or "").strip() if invoice_header else ""
        match_text = " ".join(value for value in (reference, invoice_number, memo) if value)
        fingerprint_source = "|".join((transaction_date.isoformat(), str(amount_cents), reference.lower(), payer.lower(), memo.lower(), invoice_number.lower()))
        fingerprint = hashlib.sha256(fingerprint_source.encode()).hexdigest()
        if fingerprint in seen or db.scalar(select(ReconciliationItem.id).where(ReconciliationItem.fingerprint == fingerprint)):
            errors.append({"row_number": row_number, "error": "This bank transaction was already imported."})
            continue
        seen.add(fingerprint)
        parsed_rows.append({"row_number": row_number, "fingerprint": fingerprint, "reference": reference, "payer": payer, "memo": memo, "amount_cents": amount_cents, "transaction_date": transaction_date, "match_text": match_text})
    if not parsed_rows:
        raise HTTPException(422, "No valid incoming transactions were found in the CSV.")

    candidates = db.execute(select(Invoice, User).join(User, User.id == Invoice.customer_id).where(Invoice.status == "CONFIRMED", Invoice.amount_due_cents > 0).order_by(Invoice.due_date, Invoice.id).limit(50000)).all()
    batch = ReconciliationBatch(filename=os.path.basename(payload.filename), imported_by=actor.id, imported_virtual_date=clock_date(db), row_count=len(parsed_rows))
    db.add(batch)
    db.flush()
    items: list[ReconciliationItem] = []
    for row in parsed_rows:
        ranked: list[tuple[float, Invoice, str]] = []
        bank_text = _normalize_match_text(row["match_text"])
        bank_payer = _normalize_match_text(row["payer"])
        for invoice, customer in candidates:
            if invoice.amount_due_cents < row["amount_cents"]:
                continue
            invoice_key = _normalize_match_text(invoice.number)
            reference_score = 1.0 if invoice_key and invoice_key in bank_text else 0.0
            amount_score = 1.0 if row["amount_cents"] == invoice.amount_due_cents else 0.8
            customer_name = customer.company_name or customer.full_name
            customer_key = _normalize_match_text(customer_name)
            if bank_payer and (bank_payer == _normalize_match_text(customer.email) or bank_payer in customer_key or customer_key in bank_payer):
                customer_score = 1.0
            elif bank_payer:
                customer_score = SequenceMatcher(None, bank_payer, customer_key).ratio()
            else:
                customer_score = 0.0
            day_distance = abs((row["transaction_date"] - invoice.issue_date).days)
            date_score = 1.0 if day_distance <= 7 else 0.75 if day_distance <= 30 else 0.5 if day_distance <= 90 else 0.25 if day_distance <= 180 else 0.0
            score = 0.50 * reference_score + 0.25 * amount_score + 0.15 * customer_score + 0.10 * date_score
            reason = f"Reference {reference_score:.0%} · amount {amount_score:.0%} · payer {customer_score:.0%} · date {date_score:.0%}"
            ranked.append((score, invoice, reason))
        ranked.sort(key=lambda value: value[0], reverse=True)
        score, invoice, reason = ranked[0] if ranked else (0.0, None, "No open confirmed invoice can accept this amount.")
        ambiguous = len(ranked) > 1 and score >= 0.5 and score - ranked[1][0] < 0.03
        matched = invoice if invoice and score >= 0.5 and not ambiguous else None
        if ambiguous:
            reason = f"Several invoices scored within 3 points. {reason}"
        item = ReconciliationItem(batch_id=batch.id, row_number=row["row_number"], fingerprint=row["fingerprint"], bank_reference=row["reference"], memo=row["memo"], payer=row["payer"], amount_cents=row["amount_cents"], transaction_date=row["transaction_date"], invoice_id=matched.id if matched else None, match_score=round(score * 100) if matched else 0, match_reason=reason if matched else reason, status="SUGGESTED" if matched else "UNMATCHED")
        items.append(item)
    db.add_all(items)
    record_event(db, actor.id, "RECONCILIATION", batch.id, "STATEMENT_IMPORTED", f"{len(items)} valid rows from {batch.filename}; {len(errors)} rows skipped.")
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "A bank transaction in this file was imported concurrently. Reload and import the remaining rows.") from error
    return {"batch_id": batch.id, "filename": batch.filename, "imported_count": len(items), "errors": errors, "items": [_reconciliation_item_data(db, item) for item in items]}


@app.post("/api/payments/reconcile/items/{item_id}/confirm")
def confirm_reconciliation(item_id: int, actor: User = Depends(require_roles("ADMIN", "STAFF")), db: Session = Depends(get_db)):
    item = db.get(ReconciliationItem, item_id)
    if not item or item.status != "SUGGESTED" or not item.invoice_id:
        raise HTTPException(404, "An open suggested match was not found.")
    invoice = db.get(Invoice, item.invoice_id)
    if not invoice or invoice.status != "CONFIRMED" or invoice.amount_due_cents <= 0:
        raise HTTPException(409, "The suggested invoice is no longer open for payment.")
    if item.amount_cents > invoice.amount_due_cents:
        raise HTTPException(409, f"The bank amount exceeds the invoice's current balance of {invoice.amount_due_cents} cents. Review the match before proceeding.")
    payment = Payment(reference=f"RECON-{item.id:08d}", invoice_id=invoice.id, customer_id=invoice.customer_id, method="BANK_TRANSFER", amount_cents=item.amount_cents, payment_date=item.transaction_date, note=f"Statement {item.bank_reference or 'row'} · {item.memo}".strip(" ·"), created_at=datetime.utcnow())
    db.add(payment)
    invoice.amount_paid_cents += item.amount_cents
    invoice.amount_due_cents -= item.amount_cents
    if invoice.amount_due_cents == 0:
        invoice.status = "PAID"
    db.flush()
    item.payment_id = payment.id
    item.status = "CONFIRMED"
    record_event(db, actor.id, "RECONCILIATION", item.id, "PAYMENT_CONFIRMED", f"{payment.reference} matched to {invoice.number} for {item.amount_cents} cents.")
    db.commit()
    db.refresh(item)
    return _reconciliation_item_data(db, item)


@app.get("/api/finance/summary")
def finance_summary(actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    today = clock_date(db)
    sub_filter = Subscription.customer_id == actor.id if actor.role == "CUSTOMER" else True
    invoice_filter = Invoice.customer_id == actor.id if actor.role == "CUSTOMER" else True
    subscription_counts = dict(db.query(Subscription.status, func.count(Subscription.id)).filter(sub_filter).group_by(Subscription.status).all())
    collected = db.scalar(select(func.coalesce(func.sum(Payment.amount_cents), 0)).where(Payment.customer_id == actor.id if actor.role == "CUSTOMER" else True)) or 0
    outstanding = db.scalar(select(func.coalesce(func.sum(Invoice.amount_due_cents), 0)).where(invoice_filter, Invoice.status.in_(["DRAFT", "CONFIRMED"]), Invoice.amount_due_cents > 0)) or 0
    overdue_stmt = select(func.count(Invoice.id), func.coalesce(func.sum(Invoice.amount_due_cents), 0)).where(invoice_filter, Invoice.status == "CONFIRMED", Invoice.due_date < today, Invoice.amount_due_cents > 0)
    overdue_count, overdue_amount = db.execute(overdue_stmt).one()
    revenue_query = select(Subscription.id, Plan.billing_interval, Subscription.discount_id, SubscriptionLine.product_id, SubscriptionLine.quantity, SubscriptionLine.unit_price_cents, SubscriptionLine.unit_cost_cents).join(SubscriptionLine, SubscriptionLine.subscription_id == Subscription.id).join(Plan, Plan.id == Subscription.plan_id).where(Subscription.status == "ACTIVE", SubscriptionLine.is_active.is_(True))
    if actor.role == "CUSTOMER":
        revenue_query = revenue_query.where(Subscription.customer_id == actor.id)
    revenue_rows = db.execute(revenue_query).all()
    by_subscription: dict[int, dict] = {}
    for sub_id, interval, discount_id, product_id, quantity, unit_price, unit_cost in revenue_rows:
        bucket = by_subscription.setdefault(sub_id, {"interval": interval, "discount_id": discount_id, "lines": []})
        bucket["lines"].append({"product_id": product_id, "quantity": quantity, "gross": unit_price * quantity, "cost": unit_cost * quantity})
    discount_ids = {row["discount_id"] for row in by_subscription.values() if row["discount_id"]}
    rules = {rule.id: rule for rule in db.scalars(select(DiscountRule).where(DiscountRule.id.in_(discount_ids))).all()} if discount_ids else {}
    product_scope: dict[int, set[int]] = {}
    if discount_ids:
        for discount_id, product_id in db.execute(select(DiscountProduct.discount_id, DiscountProduct.product_id).where(DiscountProduct.discount_id.in_(discount_ids))).all():
            product_scope.setdefault(discount_id, set()).add(product_id)
    mrr = recurring = cost = 0
    for bucket in by_subscription.values():
        lines = bucket["lines"]
        gross_total = sum(line["gross"] for line in lines)
        rule = rules.get(bucket["discount_id"])
        discount_total = 0
        eligible_products = product_scope.get(rule.id, set()) if rule and rule.scope == "PRODUCT" else None
        eligible_lines = [line for line in lines if eligible_products is None or line["product_id"] in eligible_products]
        eligible_gross = sum(line["gross"] for line in eligible_lines)
        eligible_quantity = sum(line["quantity"] for line in eligible_lines)
        if rule and rule.is_active and rule.start_date <= today <= rule.end_date and (rule.max_uses is None or rule.current_uses < rule.max_uses) and eligible_quantity >= rule.min_quantity and eligible_gross >= rule.min_purchase_cents:
            if rule.scope == "PRODUCT":
                for line in eligible_lines:
                    discount_total += min(line["gross"], rule.value) if rule.discount_type == "FIXED" else round_ratio_half_up(line["gross"], rule.value)
            elif rule.discount_type == "FIXED":
                discount_total = min(gross_total, rule.value)
            else:
                discount_total = round_ratio_half_up(gross_total, rule.value)
        net_revenue = max(gross_total - discount_total, 0)
        recurring += net_revenue
        if actor.role != "CUSTOMER":
            cost += sum(line["cost"] for line in lines)
        interval = bucket["interval"]
        if interval == "DAILY":
            mrr += net_revenue * 304375 // 10000
        elif interval == "WEEKLY":
            mrr += net_revenue * 43452 // 10000
        elif interval == "YEARLY":
            mrr += net_revenue // 12
        else:
            mrr += net_revenue
    invoices = db.scalars(select(Invoice).options(selectinload(Invoice.lines)).where(invoice_filter).order_by(Invoice.issue_date.desc(), Invoice.id.desc()).limit(6)).all()
    aging = {
        "1_15": int(db.scalar(select(func.coalesce(func.sum(Invoice.amount_due_cents), 0)).where(invoice_filter, Invoice.status == "CONFIRMED", Invoice.due_date < today, Invoice.due_date >= today - timedelta(days=15), Invoice.amount_due_cents > 0)) or 0),
        "16_30": int(db.scalar(select(func.coalesce(func.sum(Invoice.amount_due_cents), 0)).where(invoice_filter, Invoice.status == "CONFIRMED", Invoice.due_date < today - timedelta(days=15), Invoice.due_date >= today - timedelta(days=30), Invoice.amount_due_cents > 0)) or 0),
        "31_60": int(db.scalar(select(func.coalesce(func.sum(Invoice.amount_due_cents), 0)).where(invoice_filter, Invoice.status == "CONFIRMED", Invoice.due_date < today - timedelta(days=30), Invoice.due_date >= today - timedelta(days=60), Invoice.amount_due_cents > 0)) or 0),
        "60_plus": int(db.scalar(select(func.coalesce(func.sum(Invoice.amount_due_cents), 0)).where(invoice_filter, Invoice.status == "CONFIRMED", Invoice.due_date < today - timedelta(days=60), Invoice.amount_due_cents > 0)) or 0),
    }
    return {"as_of": today.isoformat(), "active_subscriptions": subscription_counts.get("ACTIVE", 0), "paused_subscriptions": subscription_counts.get("PAUSED", 0), "closed_subscriptions": subscription_counts.get("CLOSED", 0), "quotations_pending": subscription_counts.get("QUOTATION", 0), "revenue_collected_cents": int(collected), "outstanding_cents": int(outstanding), "overdue_count": int(overdue_count), "overdue_cents": int(overdue_amount), "mrr_cents": int(mrr), "arr_cents": int(mrr * 12), "gross_margin_percent": round((int(recurring) - int(cost)) / int(recurring) * 100, 1) if recurring and actor.role != "CUSTOMER" else None, "aging_cents": aging, "recent_invoices": [_invoice_data(db, inv, actor) for inv in invoices]}


@app.get("/api/time")
def get_time(actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"virtual_date": clock_date(db).isoformat(), "timezone": os.getenv("BUSINESS_TIMEZONE", "Asia/Kolkata")}


@app.post("/api/time/advance")
def advance_time(payload: TimeAdvanceIn, actor: User = Depends(require_roles("ADMIN", "STAFF")), db: Session = Depends(get_db)):
    old_date = clock_date(db)
    if payload.target_date:
        target = payload.target_date
        if target <= old_date:
            raise HTTPException(422, "Choose a date after the current demo date.")
    elif payload.months:
        target = add_interval(old_date, "MONTHLY", old_date.day)
        for _ in range(payload.months - 1):
            target = add_interval(target, "MONTHLY", old_date.day)
    else:
        target = old_date + timedelta(days=payload.days or 0)
    set_clock(db, target)
    summary = _process_clock(db, target, old_date)
    record_event(db, actor.id, "SYSTEM", 1, "CLOCK_ADVANCED", f"{old_date.isoformat()} → {target.isoformat()}")
    db.commit()
    return {"virtual_date": target.isoformat(), "previous_date": old_date.isoformat(), "summary": summary}


@app.get("/api/outbox")
def list_outbox(actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(OutboxMessage).order_by(OutboxMessage.created_at.desc()).limit(100)
    if actor.role == "CUSTOMER":
        stmt = stmt.where(OutboxMessage.recipient == actor.email)
    items = db.scalars(stmt).all()
    return {"items": [{"id": m.id, "channel": m.channel, "recipient": m.recipient, "subject": m.subject, "body": m.body, "action_url": m.action_url, "related_type": m.related_type, "related_id": m.related_id, "created_virtual_date": m.created_virtual_date.isoformat(), "is_read": m.is_read} for m in items]}


@app.patch("/api/outbox/{message_id}/read")
def mark_outbox_read(message_id: int, actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    message = db.get(OutboxMessage, message_id)
    if not message or actor.role == "CUSTOMER" and message.recipient != actor.email:
        raise HTTPException(404, "Message not found.")
    message.is_read = True
    db.commit()
    return {"ok": True}


@app.get("/api/audit")
def get_audit(limit: int = 30, actor: User = Depends(require_roles("ADMIN", "STAFF")), db: Session = Depends(get_db)):
    events = db.scalars(select(models.AuditEvent).order_by(models.AuditEvent.created_at.desc()).limit(min(max(limit, 1), 100))).all()
    return {"items": [{"id": e.id, "entity_type": e.entity_type, "entity_id": e.entity_id, "action": e.action, "detail": e.detail, "virtual_date": e.virtual_date.isoformat(), "created_at": e.created_at.isoformat()} for e in events]}


@app.post("/api/system/seed-stress-test")
def seed_stress_test(actor: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    existing = db.scalar(select(func.count(Subscription.id))) or 0
    if existing >= 10000:
        raise HTTPException(409, "The stress dataset is already present.")
    plan = db.scalar(select(Plan).where(Plan.code == "MONTHLY-FLEX"))
    product = db.scalar(select(Product).where(Product.sku == "BL-CORE"))
    customer_ids = db.scalars(select(User.id).where(User.role == "CUSTOMER")).all()
    if not plan or not product or not customer_ids:
        raise HTTPException(409, "Seed the demo catalog before creating the stress dataset.")
    target_subscriptions = 10000 - existing
    today = clock_date(db)
    existing_invoices = db.scalar(select(func.count(Invoice.id))) or 0
    target_invoices = max(35000 - existing_invoices, 0)
    maximum_history = (target_invoices + target_subscriptions - 1) // target_subscriptions
    if target_invoices and maximum_history > 12 * (today.year - 1):
        raise HTTPException(409, "The existing dataset leaves too few new subscriptions for a 35,000-invoice demonstration. Reset the local demo database first.")
    batch_size = 500
    created = 0
    subscription_ids: list[int] = []
    while created < target_subscriptions:
        batch_count = min(batch_size, target_subscriptions - created)
        start_number = existing + created + 1
        subs = [Subscription(number=f"LOAD-{today.year}-{start_number + i:06d}", customer_id=customer_ids[(start_number + i) % len(customer_ids)], plan_id=plan.id, status="ACTIVE", start_date=today, expiry_date=today + timedelta(days=365), next_billing_date=add_interval(today, "MONTHLY", today.day), billing_anchor_day=today.day, payment_terms="NET_15") for i in range(batch_count)]
        db.add_all(subs)
        db.flush()
        subscription_ids.extend(sub.id for sub in subs)
        db.add_all([SubscriptionLine(subscription_id=sub.id, product_id=product.id, quantity=1 + (sub.id % 15), unit_price_cents=product.sales_price_cents, unit_cost_cents=product.cost_price_cents, tax_rate_basis_points=1800) for sub in subs])
        created += batch_count

    def prior_months(value: date, months: int) -> date:
        absolute_month = value.year * 12 + value.month - 1 - months
        year, month_index = divmod(absolute_month, 12)
        month = month_index + 1
        return date(year, month, min(value.day, monthrange(year, month)[1]))

    next_invoice_id = (db.scalar(select(func.max(Invoice.id))) or 0) + 1
    invoice_rows: list[dict] = []
    invoice_line_rows: list[dict] = []
    sequence = 0
    stress_rows = db.execute(select(Subscription.id, Subscription.customer_id, SubscriptionLine.quantity).join(SubscriptionLine, SubscriptionLine.subscription_id == Subscription.id).where(Subscription.id.in_(subscription_ids))).all()
    invoice_base, invoice_extra = divmod(target_invoices, max(len(stress_rows), 1))
    for index, (subscription_id, customer_id, quantity) in enumerate(stress_rows):
        period_count = invoice_base + int(index < invoice_extra)
        subtotal = product.sales_price_cents * quantity
        tax = round_ratio_half_up(subtotal, 1800)
        grand_total = subtotal + tax
        for period_back in range(period_count - 1, -1, -1):
            period_start = prior_months(today, period_back)
            period_end = add_interval(period_start, "MONTHLY", today.day)
            invoice_id = next_invoice_id + sequence
            invoice_number = f"STRESS-INV-{today.year}-{sequence + 1:06d}"
            invoice_rows.append({"id": invoice_id, "number": invoice_number, "subscription_id": subscription_id, "customer_id": customer_id, "billing_period_start": period_start, "billing_period_end": period_end, "issue_date": period_start, "due_date": period_start + timedelta(days=15), "status": "CONFIRMED", "subtotal_cents": subtotal, "discount_cents": 0, "tax_cents": tax, "total_cents": grand_total, "amount_paid_cents": 0, "amount_due_cents": grand_total, "discount_code": "", "discount_note": "", "dunning_stage": 0, "created_at": datetime.utcnow()})
            invoice_line_rows.append({"invoice_id": invoice_id, "product_id": product.id, "description": product.name, "quantity": quantity, "unit_price_cents": product.sales_price_cents, "discount_cents": 0, "tax_rate_basis_points": 1800, "tax_cents": tax, "total_cents": grand_total})
            sequence += 1
    payment_rows: list[dict] = []
    for index, invoice in enumerate(invoice_rows[:min(25000, len(invoice_rows))]):
        paid = invoice["total_cents"] if index % 3 == 0 else max(1, invoice["total_cents"] // 2)
        invoice["amount_paid_cents"] = paid
        invoice["amount_due_cents"] = invoice["total_cents"] - paid
        invoice["status"] = "PAID" if invoice["amount_due_cents"] == 0 else "CONFIRMED"
        payment_rows.append({"reference": f"STRESS-PAY-{today.year}-{index + 1:06d}", "invoice_id": invoice["id"], "customer_id": invoice["customer_id"], "method": "BANK_TRANSFER", "amount_cents": paid, "payment_date": invoice["issue_date"] + timedelta(days=5), "note": "Generated stress-test ledger row", "created_at": datetime.utcnow()})
    for offset in range(0, len(invoice_rows), 1000):
        db.execute(insert(Invoice), invoice_rows[offset:offset + 1000])
        db.execute(insert(InvoiceLine), invoice_line_rows[offset:offset + 1000])
    for offset in range(0, len(payment_rows), 1000):
        db.execute(insert(Payment), payment_rows[offset:offset + 1000])
    record_event(db, actor.id, "SYSTEM", 1, "STRESS_DATA_SEEDED", f"{created} subscriptions, {sequence} invoices, and {len(payment_rows)} payments.")
    db.commit()
    return {"subscriptions_seeded": created, "total_subscriptions": existing + created, "invoices_seeded": sequence, "payments_seeded": len(payment_rows)}
