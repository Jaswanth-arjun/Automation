# Phase 0 — Diagnosis implementation

Goal: make every auto-apply run observable before changing the automation logic.
Nothing in this phase changes *how* forms are filled, except two crash guards and
one frame guard that were required to get any data at all (documented below).

## What was added

### 1. Structured per-run log (`extension/background.js`)
- New store key `hamzoohRuns` in `chrome.storage.local` (24 runs, 400 steps per run,
  screenshots kept for the 10 newest runs).
- Each `HAMZOOH_OPEN_JOB` creates a `runId` and records:
  `open_requested`, `url_resolved`, `tab_created`, `tab_loaded`,
  `filler_injected`, every filler `HAMZOOH_RUN_EVENT` / `HAMZOOH_FILLER_PROGRESS`
  step, and `complete`.
- Each step carries `t`, `step`, `message`, `data`, `href`, `frameUrl`, `frameId`.
- On completion the background derives a stable `reasonCode`, stores metrics
  (`filledCount`, `emptyCount`, `nextClicks`, `resumeAttached`) and captures
  evidence: a JPEG screenshot plus an interactive-element dump (tag, type, label,
  value, required/disabled/checked, options, rect, in-viewport) from every frame.
- New message handlers: `HAMZOOH_RUN_EVENT`, `HAMZOOH_GET_RUN`,
  `HAMZOOH_LIST_RUNS`, `HAMZOOH_CLEAR_RUNS`, `HAMZOOH_CAPTURE_EVIDENCE`.

### 2. Dashboard "Download run log" (`landing-page/src/pages/Apply.jsx`)
- Tracks the `runId` returned in `HAMZOOH_APPLY_READY`.
- New footer button requests `HAMZOOH_GET_RUN` through `bridge.js` and downloads
  the full run JSON (steps + evidence) as `hamzooh-run-<company>-<runId>.json`.

### 3. Harness page (`extension/test-runner.html`, `test-runner.js`)
- 30 real job URLs (Greenhouse, Lever, Ashby, Workday, Workable, company career
  pages, LinkedIn, Indeed, Naukri).
- Runs each in dry-run mode (`dryRun: true`, `autoSubmit: false`) with a fixture
  profile/vault and a generated PDF resume.
- Per-URL table: reached form, fields detected/filled, resume attached, Next
  clicks, reached review, failure reason; JSON/CSV/log downloads; results saved
  to `hamzoohHarnessResults`; `?autorun=1` starts immediately.

### 4. Node replica driver (`scratch/harness-runner.mjs`)
Chrome 157+ ignores `--load-extension` (verified: startup hangs even with a
dummy MV3 extension, both the system Chrome and Chrome for Testing 158). The
driver therefore injects the *same* `extension/filler.js` into every frame with
a minimal `chrome.*` shim and collects the same event stream that background.js
would persist. Injection happens after document load, matching the extension's
`tabs.onUpdated("complete")` behaviour. Hard cap: 3 minutes per URL.

### Phase-0-only safety fixes (needed to collect data)
- `filler.js` `profileValue()` / `chooseFromProfile()` / cover letter no longer
  crash when `profile.experience` or `profile.skills` is a string instead of an
  array (this crashed every Greenhouse run before any form was filled).
- Non-actionable frames (no form, no apply control, no file input) now emit
  `frame_skipped` and exit instead of entering the fill pipeline; previously an
  empty iframe could mark the whole run complete before the real form was seen.

## Running it

```powershell
node scratch\harness-runner.mjs                      # all 30 URLs
node scratch\harness-runner.mjs --only=greenhouse    # one ATS
node scratch\harness-runner.mjs --limit=5            # quick smoke test
node scratch\harness-runner.mjs --only=linkedin      # auth-walled sample
```

Outputs: `scratch/phase0-results.json`, `phase0-results.csv`,
`phase0-failures.md`, screenshots in `scratch/phase0-evidence/`.

For the real extension, load `extension/` unpacked and open
`chrome-extension://<id>/test-runner.html`.
