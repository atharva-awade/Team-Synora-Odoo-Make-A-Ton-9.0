# Brightloop OS Demo Video Script

**Target length:** 4 minutes 15 seconds  
**Format:** screen capture with voiceover  
**Audience:** Odoo Make-A-Ton judges  
**One-line promise:** follow one subscription from quote to collected revenue, with the rules and reasoning visible along the way.

## Recording setup

- Start the project with `start.ps1` and record at 1080p if available.
- Use the seeded workspace and begin with the Admin persona.
- Keep the landing page at the top before recording. Scroll slowly so the 3D revenue engine and each chapter have time to settle.
- Use the first quotation and sample bank statement from the seeded demo data.
- If Brightloop Guide is part of the recording, configure its Groq key before starting the API. Never show a key or terminal containing one on screen.
- Keep the pointer clear of text and pause briefly after every major screen change.

## Timed script

### 0:00 to 0:25 | The challenge

**On screen:** Brightloop landing page at the headline. Hold for a beat, then begin a slow scroll.

**Voiceover:**

> Recurring revenue is a chain of connected decisions. A quote becomes a subscription, a subscription creates invoices, and payments need to be reconciled back to the right customer. Brightloop brings that journey into one clear workspace.

### 0:25 to 0:55 | The revenue engine

**On screen:** Scroll through the landing story. Let the suspended 3D core and its orbiting feature nodes move through the Lifecycle, Billing, Reconciliation, Finance, Time, and Guide chapters. Pause on the glass feature cards as they change.

**Voiceover:**

> The story starts with a revenue engine that stays in view as we explore the product. Each chapter reveals a real workflow: plan-aware subscriptions, recurring billing, explainable payment matching, finance visibility, a persistent demo clock, and workspace-aware guidance.

### 0:55 to 1:35 | A quote with the rules in view

**On screen:** Select **Open workspace**, choose the Admin persona, then open the quotation workflow. Choose the seeded monthly template and Apex Logistics. Show the line items, tax, eligible discounts, and margin preview before creating the quote.

**Voiceover:**

> In the workspace, the Admin starts with reusable products, plans, tax rules, discounts, and quote templates. Here we can see what the customer is buying and how the quote is calculated before it is sent. The margin preview makes the 15 percent warning threshold visible while the quote is still being reviewed.

### 1:35 to 2:10 | Subscription and billing

**On screen:** Switch to the Customer persona, open the new quotation from the workspace, and accept it. Switch back to Operations Staff, show the subscription state and plan rules, then run the billing day. If the seeded billing date has not arrived, advance the demo clock by one day first. Show the generated invoice and its period.

**Voiceover:**

> Once a quote is accepted, the subscription moves through states that the selected plan allows. Billing creates an invoice for the subscription period, and the same period cannot be invoiced twice. That keeps the billing history understandable even when an operator retries the action.

### 2:10 to 2:55 | Reconcile a payment

**On screen:** Switch to the Operations Staff persona. Open Payments, load the sample feed, and inspect a suggested invoice match. Point out the reference, amount, payer, and date factors. Confirm the suggested payment only after reviewing it.

**Voiceover:**

> When a bank statement arrives, Brightloop explains why a row may match an invoice. The recommendation is not posted automatically. A staff member reviews the evidence and confirms the row, so the invoice balance changes only after a person approves the match.

### 2:55 to 3:35 | Finance and time

**On screen:** Open Revenue Intelligence and show MRR, ARR, collections, outstanding balances, and aging. Then open the time control and audit or outbox view.

**Voiceover:**

> Finance can move from recurring revenue to the collections behind it, including overdue aging and margin. The demo clock lets the team advance the business date and observe billing, reminders, and renewal events. The outbox and audit trail make those events easy to follow.

### 3:35 to 4:00 | Brightloop Guide

**On screen:** Open Brightloop Guide and ask: “How are bank statement matches confirmed?” Show the response and its source references. If the Guide is not configured for this recording, hold on the reconciliation screen and use the alternate narration below.

**Voiceover:**

> Brightloop Guide can explain a product workflow or look up records that the signed-in role is allowed to see. It is read-only, and it shows the sources behind its answer.

**Alternate voiceover if Guide is unavailable:**

> The experience stays grounded in the current workflow. Matching suggestions explain their signals, and the person reviewing the statement remains in control of the final payment.

### 4:00 to 4:15 | Close

**On screen:** Return to the landing page or hold on the finance overview. End on the Brightloop mark.

**Voiceover:**

> Brightloop connects the subscription journey from the first quote to the revenue signal. One clear flow for the people who sell, serve, and understand recurring revenue.

## Capture checklist

- Show the open 3D model before the workspace so the visual story is clear.
- Scroll smoothly and pause on each chapter long enough for the glass panel to finish its transition.
- Keep customer and invoice information within the seeded demo environment.
- Show the reconciliation review before confirmation.
- Do not record the browser address bar if it contains anything other than the local demo URL.
- Finish between 3:45 and 4:30. The script can be shortened by skipping the optional Guide segment.
