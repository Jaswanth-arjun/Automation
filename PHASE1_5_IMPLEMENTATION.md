# Phases 1–5 — implementation summary

All changes are additive to the Phase 0 logging layer. Each fix is linked to a
root cause observed in the Phase 0 baseline.

## Phase 1 — root-cause fixes

| # | Fix | Where |
| --- | --- | --- |
| a | CDP input layer: `Input.dispatchMouseEvent`, `Input.insertText`, `Input.dispatchKeyEvent`, `DOM.setFileInputFiles` via `chrome.debugger`, attached per tab and detached on finish; DOM events remain fallback | `background.js` `HAMZOOH_CDP_INPUT`, `filler.js` `cdpInput`/`realClick`/`typeWithCdp` |
| b | MV3 worker persistence + keepalive: run state already in `chrome.storage.local`; 18s alarm re-injects into active job tabs and forces a terminal state after 4.5 min | `background.js` keepalive alarm, `manifest.json` `alarms` |
| c | DOM-stable wait (MutationObserver quiet 800ms, 6s cap) + re-injection on `webNavigation.onCommitted/onCompleted/onHistoryStateUpdated` with `allFrames` | `filler.js` `waitForDomStable`, `background.js` `reinjectForNavigation` |
| d | Progress-based loop: 40-step hard cap, 3 no-progress steps stop; `step` events record signature/no-progress | `filler.js` `fillPage` |
| e | Scored Apply-button finder: text/aria-label/href/data-* scoring, shadow DOM traversal, excludes "apply filters"/"save"/"share" | `filler.js` `scoreApplyCandidate`, `findDescriptionApplyButtons` |
| f | Validation retry: detect `[role=alert]`, `.error`, `aria-invalid`, required text after Next; re-fill only failing fields, max 3 attempts | `filler.js` `detectValidationErrors`, advance loop |
| g | Fill verification: read back every value; rejected values retried with CDP typing | `filler.js` `setVerified` |
| h | Custom widgets: combobox/select option matching in agent handler, EEO/sensitive answers from vault only | `agent.js`, `filler.js` handlers |
| i | Resume verification: confirm `input.files` plus filename shown on page before Next | `filler.js` `resume_verified` event |

## Phase 2 — AI fallback agent

- `extension/agent.js`: OBSERVE (stable `data-hz-id`, label/value/options/required/disabled/rect/in-viewport, headings, errors, frame URL), DECIDE (one action through `/api/agent/next-action`), ACT (validated against the snapshot), VERIFY (snapshot diff, retry hint after 2 failures). Sensitive steps become `ask_user`/`need_user`; no CAPTCHA/OTP/MFA bypass.
- `server.js`: `/api/agent/next-action` returns a strictly validated single action with an explicit "never invent / use vault only / don't bypass verification" prompt; `/api/agent/classify-submission` returns submitted / not_submitted / unclear.
- Deterministic filler remains the fast path; the agent runs only on no-progress or an unrecognised page.

## Phase 3 — submission + verification

- Multi-signal success detection: confirmation text, confirmation URL, form disappearance, emailed-confirmation text; negative signals (validation/"something went wrong") veto success; ambiguous cases go to the LLM classifier.
- `submit_signals` run event records every signal. Review summary is carried in the `complete` event payload (`filledCount`, `skipped`, `reasonCode`).

## Phase 4 — NEEDS_USER pause/resume

- Background relays `HAMZOOH_NEEDS_USER` with reason code/question; dashboard shows a pause banner with the exact reason and a **Resume after fixing** button.
- `HAMZOOH_RESUME_RUN` clears `done`, focuses the job tab and re-injects the filler; the resumed step is logged.

## Phase 5 — reliability extras

- Retry policy for Next clicks (up to 3 attempts with re-observe), snapshot diff verification, detached-frame tolerance via `allFrames` re-injection.
- Duplicate protection by normalized URL path + company + title (`hamzoohApplied`, `DUPLICATE_APPLICATION`); per-domain strategy memory (`hamzoohDomainMemory`).
- Watchdog: 4.5-minute background alarm + harness watchdog at 120s force `TIMEOUT_NO_TERMINAL` instead of hanging.
- 18 unit tests (`scratch/unit-tests.mjs`) covering label extraction, profile mapping, apply-button scoring, validation detection, success patterns and agent snapshots.

## Verification

- `node scratch\unit-tests.mjs` → 18/18 pass.
- `npm run build --prefix landing-page` → green.
- `node --check` passes on all extension files and `server.js`.
- Harness before/after: `scratch/phase0-failures.md` (baseline) vs `scratch/phase1-failures.md` (after Phase 1–5).
