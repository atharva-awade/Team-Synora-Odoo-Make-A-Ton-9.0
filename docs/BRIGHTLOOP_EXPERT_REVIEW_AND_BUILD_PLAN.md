# Brightloop OS: Expert Review and Build Plan

## Source of truth

The supplied four-page `Subscription_Management_System.pdf` is the acceptance brief. The larger PRD is the product and technical proposal. Features in that proposal are retained when they improve the brief's end-to-end workflow; unsupported claims are labeled as assumptions or stretch ideas.

The beta GitHub repository initially contained a README only. This project is a standalone web app in that repository, using React/TypeScript, FastAPI, and SQLite.

## What the PRD gets right

- It models subscriptions as governed lifecycle transitions rather than arbitrary status edits.
- It carries plan flags through to staff and customer actions.
- It treats invoice generation as idempotent and discounts as recurring rules that can expire or exhaust.
- It makes the product cost field useful with quote-level margin visibility.
- It proposes a controllable demo clock, customer portal, notification outbox, and bank reconciliation to make the demo easy to judge.

## Corrections and implementation safeguards

- The PDF requires pages to respond in under two seconds. It does not state a sub-50ms target or an offline/local-first judging rubric. Local persistence and a notification outbox are useful demo choices, but those claims are not acceptance criteria.
- The PDF names the subscription, invoice, payment, access-control, and report behaviors. A separate Odoo addon is not required for the chosen standalone delivery.
- Use cents as integer minor units for USD demo amounts. Calculate with decimal arithmetic and round half-up before persistence; avoid floating point for financial totals.
- A partial payment is represented by `CONFIRMED` invoice status plus `amount_paid` and `amount_due`. The UI may show a derived `PARTIALLY PAID` badge without inventing a conflicting invoice state.
- A discount use is one redemption per generated invoice. Store the applied rule on the invoice, enforce the cap atomically, and release the redemption exactly once when an unpaid invoice is cancelled.
- A reconciliation matcher must produce explainable suggestions. A staff member confirms each suggested payment before it changes balances.
- Persona switching is a demo-only server login flow. It must never let the browser assign its own role.

## Priorities

### Required workflow

1. Customer signup/login, password reset, unique email, and the greater-than-eight-character password rule.
2. Admin-only staff creation; admin, staff, and customer access boundaries.
3. Products and variants, plans and lifecycle flags, taxes, discounts, and quotation templates.
4. Draft-to-quotation-to-confirmed-to-active subscription lifecycle, with pause/close/renew governed by plan settings.
5. Idempotent recurring billing, invoice confirmation/cancellation/printing, payment recording, overdue visibility, and finance reporting under two seconds on thousands of records.
6. Customer portal for own quotations, subscriptions, add-ons, and invoices.

### Differentiators

- Persisted demo clock and temporal execution log to make renewal and overdue behavior visible on demand.
- Quote margin preview using product and variant costs.
- Add-on proration preview and local notification outbox.
- CSV reconciliation suggestions with explainable weighted matches and staff confirmation are implemented.

## Build status

The required workflow and listed differentiators are implemented in the beta repository. The local app is intended for a judged demo, with seeded personas and data; external payment processing, multi-currency accounting, and production deployment remain outside this hackathon scope. Use the acceptance/demo path below for a live walkthrough.

## Architecture and operating assumptions

- React/TypeScript/Vite frontend, FastAPI JSON API, SQLAlchemy persistence, Alembic migrations, SQLite WAL for the local demo.
- USD is the seeded demo currency; multi-currency accounting and external payment processing are outside the hackathon build.
- Business dates are ISO dates using a persisted clock, default timezone `Asia/Kolkata`; real audit timestamps remain separate.
- Invoice billing periods are stable calendar intervals. Monthly recurrence clamps to the last valid day of shorter months.
- The API is the authority for role checks, pricing, discounts, tax, state transitions, and balances. The client renders server results.
- Passwords are scrypt-hashed; sessions use random opaque tokens stored by hash in SQLite and an HttpOnly, SameSite cookie.

## Acceptance/demo path

Register a customer, create a quotation from a template, accept it, activate the subscription, advance to its billing date, generate the invoice twice, record a partial then final payment, and review the finance dashboard and customer portal. Also demonstrate a rejected plan transition and a time-clock-triggered overdue reminder.

The review document is an implementation guide, not a replacement for the supplied PRD. Keep the original source unchanged.
