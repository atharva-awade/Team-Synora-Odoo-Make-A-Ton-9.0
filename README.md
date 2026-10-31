# Brightloop OS

Standalone subscription operations and revenue intelligence demo built for the Team Synora Odoo Make-A-Ton challenge.

## Stack

- React 19 + TypeScript + Vite
- FastAPI + SQLAlchemy
- SQLite in WAL mode for local development

## Run locally (Windows)

1. Install Node.js 20.19+ and Python 3.11+.
2. In PowerShell, run `./start.ps1` from the repository root. The script creates a Python virtual environment, installs the backend requirements, starts the API, installs frontend dependencies if needed, and starts Vite.
3. Open `http://localhost:5173`.

The API docs are at `http://127.0.0.1:8000/docs`. The first startup creates and seeds the local database at `data/brightloop.db`.

### Demo accounts

Demo users are seeded on first startup. The login screen includes a demo persona selector so the UI can switch accounts through the backend session flow.

| Role | Email |
| --- | --- |
| Admin | `admin@brightloop.local` |
| Staff | `staff@brightloop.local` |
| Customer | `customer@brightloop.local` |

The local-only demo password for these accounts is `Brightloop!2026`. Change it before exposing the app beyond a trusted demo machine.

## Product and finance rules

- The supplied PDF challenge brief is the acceptance source; the supplied PRD defines the product scope.
- Monetary values are stored as integer cents and calculated server-side.
- Business dates use the persisted demo clock, defaulting to `Asia/Kolkata`.
- Billing is idempotent per subscription and billing-period start.
- Customer data access and staff/admin capabilities are enforced by the API.

## Implemented workflow

- Customer registration, password sign-in, reset links in the local outbox, and server-enforced admin/staff/customer access.
- Product variants, plans with lifecycle rules, tax rates, reusable quotation templates, scoped discounts, and a quote margin preview with a 15% guardrail.
- Quote acceptance, activation, pause/resume, early close, renewal, and customer-owned add-on changes. Mid-cycle price changes are prorated and carried into the next invoice.
- Idempotent recurring invoices, invoice confirmation/cancellation/printing, partial and final payments, collection aging, and a weighted bank CSV matching desk with manual payment confirmation.
- A persisted demo clock with day/week/month/custom-date jumps, renewal heads-ups, invoice dispatch, staged overdue reminders, and an audit timeline.
- Finance dashboard and reports with MRR/ARR normalization, margin, collections, and an admin stress seeder for 10,000 subscriptions, 35,000 invoices, and up to 25,000 payments.

Bank CSV imports accept a header row with `date` and `amount` (or `amount_cents`). Optional fields include `reference`, `payer` or `payer_email`, `memo`, and `invoice_number`. Suggestions explain reference, amount, payer, and date scores; a staff member confirms each payment before invoice balances change. The Payments page also provides a sample feed.

## Demo path

1. Sign in as the admin and create a quote from a template. Review its discount and margin preview.
2. Accept and activate the quote as the customer or staff persona.
3. Advance the demo clock to the next billing date and review the generated invoice and outbox message.
4. Import a bank CSV, inspect the weighted match suggestion, and explicitly confirm the payment.
5. Review the MRR, margin, overdue aging, and audit timeline. Use **Seed 10K demo** in Reports to load the scale dataset.

The customer demo account is `customer@brightloop.local`; the staff, finance, and admin personas are available from the login screen. The local-only demo password is `Brightloop!2026` for each seeded account. Change it before exposing the app beyond a trusted demo machine.
