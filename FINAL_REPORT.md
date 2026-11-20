# Hamzooh Auto Apply — implementation & verification report

## 1. Phase 0 baseline (before fixes)

`scratch/phase0-results.json` — 29 live URLs:

| Root cause | Count | ATS |
| --- | ---: | --- |
| `REVIEW_READY` | 18 | greenhouse, lever, ashby, workable, naukri |
| `NO_TERMINAL_STATE` (hang) | 7 | ashby, workday, company, indeed |
| `NO_SUBMIT_BUTTON` | 3 | workday, workable |
| `LOGIN_REQUIRED` | 1 | linkedin |

Review-ready rate: **18/29 = 62%**. Requirement was ≥90%.

## 2. What was built (Phases 0–5)

- **Phase 0**: run log in `chrome.storage.local` (`hamzoohRuns`), `runId`, every step with frame/time/data, reason codes, evidence (screenshot + interactive dump), `Download run log` in dashboard modal, `extension/test-runner.html`, Node replica harness.
- **Phase 1**: CDP input layer (`Input.dispatchMouseEvent`, `Input.insertText`, `Input.dispatchKeyEvent`, `DOM.setFileInputFiles`), MV3 keepalive + persisted state, DOM-stable waits, SPA re-injection, scored Apply finder, validation retry (max 3), read-back verification, resume verification.
- **Phase 2**: `extension/agent.js` OBSERVE→DECIDE→ACT→VERIFY loop; `/api/agent/next-action` (single validated action, vault-only facts, no CAPTCHA bypass); `/api/agent/classify-submission`.
- **Phase 3**: multi-signal success verification + LLM classifier, review summary in completion event.
- **Phase 4**: NEEDS_USER pause banner, reason codes, Resume-after-fixing button; persisted state.
- **Phase 5**: retries, dedupe, domain memory, watchdog (no hangs), 18 unit tests.

Validation: `node --check` on all modified JS; Vite production build green; `scratch/unit-tests.mjs` 18/18.

## 3. Phase 1–5 harness result (30 URLs)

`scratch/phase1c-failures.md`:

| Root cause | Count | ATS |
| --- | ---: | --- |
| `REVIEW_READY` | 15 | greenhouse, lever, ashby |
| `APPLY_BUTTON_NOT_FOUND` | 7 | workday, workable, company |
| `NO_SUBMIT_BUTTON` | 4 | workday, workable, naukri |
| `TIMEOUT_NO_TERMINAL` | 2 | ashby, indeed |
| `NO_TERMINAL_STATE` | 1 | workday |
| `LOGIN_REQUIRED` | 1 | linkedin |

Review-ready rate: **15/30 = 50%** — a regression versus baseline. The regression was traced to the scored Apply finder accepting nav/cookie links via `aria-label` ("Home", "Search for jobs", "privacy notice"). Fixed afterwards by gating on *visible* text only and explicitly excluding nav/cookie labels. A targeted rerun on Workday+Workable is in progress (`scratch/phase2check*`).

All runs now end in a terminal state within the cap; no silent hangs except one `NO_TERMINAL_STATE` (workday NVIDIA) which the watchdog now converts to `TIMEOUT_NO_TERMINAL`.

## 4. Real extension logs (user-supplied, LinkedIn / Carousell)

Four iterations produced concrete fixes:
1. CDP click at (0,0) → rect validity check; later instant scroll + wait.
2. Duplicate completion overwrote reason code → persist only one complete event.
3. Easy Apply modal with resume picker seen as "no form" → improved modal detection + resume selection (`resume_selected`).
4. invisible reCAPTCHA iframe not detected → CAPTCHA detection from captured frames; `activeTab` permission added so screenshots are captured.

The last two fixes were applied **after** the latest log's run started; the extension must be reloaded once more to pick them up.

## 5. Honest status

- The three terminal states and "never silently fail/hang" are implemented.
- **100% auto-apply is NOT achieved.** Harness review-ready rate is 50–62%, not ≥90%.
- **5 verified real submissions are NOT done** — requires explicit user authorization and real job URLs.
- CAPTCHA/login-walled sites correctly end in NEEDS_USER (by design, never bypassed).

## 6. Next actions

1. Reload the extension (`chrome://extensions` → Reload) and rerun the LinkedIn Carousell URL; expect `resume_selected` then progression past page 2/8, or `CAPTCHA` as the terminal state.
2. Read `scratch/phase2check-failures.md` when the targeted rerun completes to see whether the Apply-finder fix restored Workday/Workable review-ready rates.
3. Decide whether to proceed with another full 30-URL rerun and the 5 authorized real submissions.
