from __future__ import annotations

from datetime import date
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class SignupIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    company_name: str = Field(default="", max_length=160)
    password: str = Field(min_length=9, max_length=128)

    @field_validator("password")
    @classmethod
    def strict_password(cls, value: str) -> str:
        if len(value) < 9 or not re.search(r"[A-Z]", value) or not re.search(r"[a-z]", value) or not re.search(r"[^A-Za-z0-9\s]", value):
            raise ValueError("Use at least 9 characters, including uppercase, lowercase, and a special character.")
        return value


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class DemoLoginIn(BaseModel):
    persona: Literal["ADMIN", "STAFF", "FINANCE", "CUSTOMER"]


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str
    new_password: str = Field(min_length=9, max_length=128)


class StaffCreateIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=9, max_length=128)


class ProductCreateIn(BaseModel):
    sku: str = Field(min_length=2, max_length=48)
    name: str = Field(min_length=2, max_length=180)
    product_type: Literal["RECURRING_SOFTWARE", "ADDON", "SERVICE"] = "RECURRING_SOFTWARE"
    sales_price_cents: int = Field(ge=0)
    cost_price_cents: int = Field(ge=0)
    notes: str = ""


class VariantIn(BaseModel):
    attribute_name: str = Field(min_length=1, max_length=60)
    attribute_value: str = Field(min_length=1, max_length=80)
    price_delta_cents: int = 0
    cost_delta_cents: int = 0


class PlanCreateIn(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=150)
    description: str = ""
    billing_interval: Literal["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] = "MONTHLY"
    min_quantity: int = Field(default=1, ge=1)
    available_from: date | None = None
    available_to: date | None = None
    auto_close_on_end: bool = False
    allow_early_close: bool = True
    allow_pause: bool = True
    allow_renew: bool = True
    default_duration_days: int = Field(default=365, ge=1)


class TaxCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    rate_basis_points: int = Field(ge=0, le=10000)
    is_default: bool = False


class DiscountCreateIn(BaseModel):
    code: str = Field(min_length=2, max_length=48)
    name: str = Field(min_length=2, max_length=120)
    discount_type: Literal["FIXED", "PERCENTAGE"]
    value: int = Field(gt=0, description="Cents for FIXED; basis points for PERCENTAGE")
    scope: Literal["PRODUCT", "SUBSCRIPTION"] = "SUBSCRIPTION"
    min_purchase_cents: int = Field(default=0, ge=0)
    min_quantity: int = Field(default=1, ge=1)
    start_date: date
    end_date: date
    max_uses: int | None = Field(default=None, ge=1)
    product_ids: list[int] = []


class TemplateLineIn(BaseModel):
    product_id: int
    variant_id: int | None = None
    quantity: int = Field(default=1, ge=1)
    tax_rule_id: int | None = None


class TemplateCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    description: str = ""
    plan_id: int
    validity_days: int = Field(default=15, ge=1)
    payment_terms: Literal["IMMEDIATE", "NET_7", "NET_15", "NET_30"] = "NET_15"
    lines: list[TemplateLineIn] = Field(min_length=1)


class SubscriptionLineIn(BaseModel):
    product_id: int
    variant_id: int | None = None
    quantity: int = Field(default=1, ge=1)
    tax_rule_id: int | None = None
    is_addon: bool = False


class SubscriptionCreateIn(BaseModel):
    customer_id: int | None = None
    plan_id: int
    template_id: int | None = None
    start_date: date
    expiry_date: date | None = None
    payment_terms: Literal["IMMEDIATE", "NET_7", "NET_15", "NET_30"] = "NET_15"
    discount_id: int | None = None
    lines: list[SubscriptionLineIn] = Field(min_length=1)
    create_as_quote: bool = True


class FromTemplateIn(BaseModel):
    template_id: int
    customer_id: int | None = None
    start_date: date
    quantities: dict[int, int] = {}
    discount_id: int | None = None


class TransitionIn(BaseModel):
    target_status: Literal["QUOTATION", "CONFIRMED", "ACTIVE", "PAUSED", "CLOSED"]
    reason: str = ""


class PaymentCreateIn(BaseModel):
    amount_cents: int = Field(gt=0)
    method: Literal["BANK_TRANSFER", "CREDIT_CARD", "UPI", "ACH", "CASH", "CHECK", "PORTAL"]
    payment_date: date | None = None
    note: str = ""


class ReconciliationImportIn(BaseModel):
    filename: str = Field(min_length=1, max_length=180)
    csv_content: str = Field(min_length=1, max_length=1_000_000)
    file_format: Literal["CSV", "OFX"] = "CSV"


class ReconciliationBatchConfirmIn(BaseModel):
    item_ids: list[int] = Field(min_length=1, max_length=500)


class AddonToggleIn(BaseModel):
    product_id: int
    quantity: int = Field(ge=0)


class AddonConfirmIn(AddonToggleIn):
    expected_proration_cents: int
    expected_current_quantity: int = Field(ge=0)
    expected_next_billing_date: date


class TimeAdvanceIn(BaseModel):
    days: int | None = Field(default=None, ge=0, le=3650)
    months: int | None = Field(default=None, ge=0, le=120)
    target_date: date | None = None

    @model_validator(mode="after")
    def one_time_delta(self):
        if sum(value is not None for value in (self.days, self.months, self.target_date)) != 1:
            raise ValueError("Provide exactly one of days, months, or target_date.")
        return self
