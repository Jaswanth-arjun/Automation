# HAMZO — Free vs Pro vs Recruiter (grounded in shipped code)

> Status: **proposal**. No plan field, quota counter or billing code exists in the repo today
> (`lib/auth.jsx` has no `role`/`plan`; `server.js` enforces no per-user limits). Everything below
> that is marked **gate** needs new code. Everything unmarked is already working.

---

## 1. What the product actually does today

| Capability | Code | Cost driver |
|---|---|---|
| Match score on every job | `landing-page/src/lib/jobMatch.js`, `matchScore.js` — computed **in the browser** | ₹0 (no server/LLM call) |
| Resume tailoring from a JD | `/api/external-job/tailor`, `lib/job-analysis.js`, Gemini primary | LLM tokens |
| ATS keyword-coverage report | `calculateKeywordCoverage`, `keywordMatches` | ₹0 (local diff) |
| One-page PDF fit | `lib/resume-pdf.js` → `fitResumeToOnePage`, `renderFittedResumePdf` | Puppeteer render |
| Auto-apply (form fill, answer vault) | `lib/auto-apply-engine.js`, `lib/vault-manager.js`, `apply-intelligence.js` | Headless Chrome, **single-flight** |
| Gmail inbox: summarize / reply / follow-up / send | `/api/ai/mail/*`, `gmailApi` | Gemini + Gmail API quota |
| Referral campaigns (discover → draft → invite stage) | `lib/referral-campaign-engine.js`, `/api/campaigns/*` | Chrome + LLM |
| LinkedIn connect / message / status tracker | `lib/bot-engine.js` (20–35 s between invites), `tracker-engine.js` | Chrome, LinkedIn ToS risk |
| Applications tracker + status detected from email | `pages/Applications.jsx`, ATS email parsing in `server.js` | Gmail reads |
| Job import from a URL / JSON-LD | `/api/jobs/import`, `lib/job-import.js` | ₹0 |
| Recruiter email discovery + verification + Excel list | `lib/email-discovery.js`, `/api/.../import` | Network calls |
| **Admin console** `/admin`: candidate DB by batch, SMTP batch broadcast, delivery log | `pages/admin/*`, `/api/candidates`, `/api/admin/broadcast-batch-mail` | SMTP (own server) |

Anything a chat model invents that is **not** in this list (multiple mailboxes, resume template
marketplace, team seats, "advanced models" per tier) would be new product work — don't sell it yet.

---

## 2. Corrected plan matrix

Legend: ✅ included · — not included · **gate** = included but needs a counter/middleware built.

### Student — discovery & preparation

| Feature | Free ₹0 | Pro ₹699/mo | Recruiter |
|---|---|---|---|
| Job board + saved jobs | ✅ | ✅ | ✅ |
| AI match score on every job | ✅ unlimited (client-side) | ✅ unlimited | ✅ |
| Profile + resume upload, PDF text extraction | ✅ | ✅ | ✅ |
| Application tracker (4 stages) | ✅ | ✅ | ✅ |
| Email-detected status updates | ✅ | ✅ | ✅ |
| Resume tailoring from a JD (LLM) | **3 / month** gate | **60 / month** gate | — |
| ATS keyword-coverage report | ✅ with each tailor | ✅ with each tailor | — |
| Edited resume → one-page PDF | ✅ | ✅ | — |
| Job import from a pasted URL | ✅ | ✅ | ✅ |

### Student — outreach & automation

| Feature | Free ₹0 | Pro ₹699/mo | Recruiter |
|---|---|---|---|
| Gmail connect (single account) | ✅ | ✅ | ✅ |
| Inbox read / send | ✅ | ✅ | ✅ |
| AI summarize · draft reply · follow-up | **10 actions / day** gate | **150 / day** gate | — |
| Referral campaigns (LinkedIn discovery → AI message → invite) | 1 active campaign, 25 contacts/mo gate | Unlimited campaigns, 300 contacts/mo gate | — |
| LinkedIn automated invites | **10 / day** gate | **25 / day** gate (hard cap, ToS safety) | — |
| LinkedIn AI personalized notes | — | ✅ | — |
| LinkedIn invite-status tracker | ✅ | ✅ | — |
| Auto-apply (form fill + answer vault) | **5 / day** gate | **25 / day** gate (queued) | — |
| Answer vault (reusable form answers) | 20 answers gate | Unlimited | — |

### Recruiter / Admin (separate buyer — do **not** bundle into student Pro)

| Feature | Free | Pro | Recruiter ₹1,999/mo |
|---|---|---|---|
| Post / edit / close jobs (admin jobs board) | — | — | ✅ |
| Candidate database grouped by graduation batch | — | — | ✅ |
| **Batch email broadcast** (SMTP, per-recipient, merge tags) | — | — | ✅ |
| Broadcast history + delivery/failure log | — | — | ✅ |
| Recruiter email discovery (company → people) | — | — | 200 lookups/mo gate |
| Email verification | — | — | 500 checks/mo gate |
| Bulk list import (PDF / Excel) | — | — | ✅ |
| Merge-tag templates (`{{name}}`, `{{batch}}` …) | — | — | ✅ |
| Broadcast volume | — | — | 500 recipients/day gate |

**Free forever** must keep: match score, tracker, one tailoring trial, single Gmail, 10 invites/day.
That is enough to feel the product, and it costs ~₹0 in LLM tokens.

---

## 3. Price & rationale

| Plan | Monthly | Yearly | Effective monthly | Buyer |
|---|---|---|---|---|
| Free | ₹0 | — | — | Students testing |
| Pro | ₹699 | ₹4,999 (40% off) | ₹417 | Final-year students, 0–3 yr |
| Recruiter | ₹1,999 | ₹19,999 | ₹1,667 | Placement cells, small agencies |

Why this holds up:

- **Pro at ₹699** – the only recurring cost per Pro user is LLM tokens (tailoring + mail AI).
  60 tailors + ~750 auto-apply answer calls/month is well under ₹100 of Gemini usage at current
  Flash pricing. Everything else is CPU on your own box. Margin is fine **as long as concurrency
  stays low** (see risk below).
- **Yearly at ₹4,999** mirrors the "one placement season" purchase — students buy in July–Sept and
  leave. Yearly should be priced as a season pass, not as a discount gimmick.
- **Recruiter is a separate plan, not Pro+** because the buyer, the workflow and the liability are
  different: the admin console holds the whole student database and can send mail from your
  verified domain. Charging students for it invites abuse of your SMTP reputation.
- **₹0 tier is not a cost centre** for match scoring — that runs in the browser. Keep it unlimited;
  it is your acquisition hook.

### ChatGPT draft rows that were wrong for this codebase

| Draft row | Reality | Corrected to |
|---|---|---|
| "Basic / Advanced dashboard" | One dashboard, no gated widgets | Drop. Sell concrete features. |
| "Multiple email accounts" | `MailAutomation.jsx` "Switch account" **replaces** the token; one Gmail per user | Single Gmail on every tier |
| "Advanced models" | `lib/ai-provider.js` uses one global Gemini → NVIDIA fallback chain for all users | Sell **AI action quota**, not model names |
| "Priority processing" | Auto-apply is single-flight (`another auto-apply is already in progress`) | Sell **daily queue slots**; priority would need a real job queue |
| "Basic / Advanced resume templates" | One template (`modernResumeHtml`) | Sell tailoring volume + one-page fit |
| "Email support / Priority support" | No ticketing exists yet | Keep as a promise only if you actually answer mail |

---

## 4. Enforcement to build before charging

1. `user.plan` (`free` \| `pro` \| `recruiter`) + `planExpiresAt` on the user record.
2. Middleware `requirePlan('pro')` for `/admin/*` and `/api/admin/*` — the route is **session-only today**.
3. Daily/monthly counters: `data/usage.json` keyed by `userId + feature + period`; increment inside
   `POST /api/external-job/tailor`, `/api/ai/mail/*`, `POST /api/auto-apply`, `POST /api/campaigns`,
   and the LinkedIn engine start route. Return HTTP 402 with the upgrade message.
4. Server-side caps that must exist regardless of plan: LinkedIn 25/day, broadcast 500/day,
   auto-apply 1 concurrent process.

## 5. Known scaling risk (price before you promise)

`AutoApplyEngine` keeps one `.chrome-data-autoapply` profile and refuses a second run. "25 auto-applies
per day per Pro user" is fine for tens of users, not thousands. Before raising the cap or selling
annual Recruiter seats, move auto-apply to a real queue with per-user Chrome profiles — otherwise
the plan sells capacity the server cannot deliver.

## 6. Quota sources

- LinkedIn invites: the engine already spaces 20–35 s per invite (`bot-engine.js`), which is the
  manual-browsing pattern LinkedIn expects. 25/day (~110/week) is the safe ceiling; do not exceed.
- Gmail: sending limits come from Google (~500 recipients/day on a consumer account, ~2,000 on
  Workspace) and the API's per-minute quota — which is why `MailAutomation.jsx` loads bodies lazily.
- Broadcast: SMTP is your own server, so the real limit is deliverability, not throughput — warm up
  to 500/day and keep the 3-worker / 120 ms spacing already implemented.
