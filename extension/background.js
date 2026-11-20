/**
 * Hamzooh Apply — Background Service Worker
 * Opens the job application in a NEW TAB in the current window, stores the
 * tailored resume in IndexedDB (avoids chrome.storage quota failures), proxies
 * vault/AI calls (content-script fetch is CORS-bound to the job site), and
 * tells the job tab when to start filling.
 */

const LOCAL_TABS = [
  'http://localhost:5173/*',
  'http://127.0.0.1:5173/*',
  'http://localhost:5174/*',
  'http://127.0.0.1:5174/*',
  'http://localhost:3000/*',
  'http://127.0.0.1:3000/*',
];
const APPLY_HOSTS = /greenhouse\.io$|lever\.co$|myworkdayjobs\.com$|ashbyhq\.com$|smartrecruiters\.com$|icims\.com$|workable\.com$|jobvite\.com$|taleo\.net$|successfactors\.com$|oraclecloud\.com$|linkedin\.com$|indeed\.com$|google\.com$|amazon\.jobs$/i;
const API_BASE = 'http://localhost:3000';

let dashboardTabId = null;
let jobTabId = null;
const extraJobTabIds = new Set();

function log(...args) {
  try { console.log('[Hamzooh Apply]', ...args); } catch {}
}

async function connectOpenHamzoohTabs() {
  const tabs = await chrome.tabs.query({ url: LOCAL_TABS });
  await Promise.all(tabs.map((tab) =>
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['bridge.js'],
      injectImmediately: true,
    }).catch(() => {})
  ));
  if (tabs.length > 0) dashboardTabId = tabs[0].id;
}

function hostname(raw) {
  try { return new URL(raw).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function isErrorUrl(raw) {
  try {
    const url = new URL(raw);
    return /\/error(\/|$)|\/500(\/|$)/i.test(url.pathname) || /\/error\/500/i.test(url.href);
  } catch {
    return true;
  }
}

function isApplyHost(raw) {
  const host = hostname(raw);
  return APPLY_HOSTS.test(host) || APPLY_HOSTS.test(host.split('.').slice(-2).join('.'))
    || /\.greenhouse\.io$|\.lever\.co$|\.ashbyhq\.com$|\.myworkdayjobs\.com$/i.test(host);
}

function looksLikeJobUrl(raw) {
  try {
    const url = new URL(raw);
    if (isErrorUrl(raw)) return false;
    if (isApplyHost(raw)) return true;
    const path = url.pathname.toLowerCase();
    if (/\/(jobs?|careers?|apply)\b/i.test(path) && /job[./]|\/jobs\/|\/apply|reqid=|gh_jid=/i.test(`${path}${url.search}`)) return true;
    return /\/jobs\/|\/job\/|\/apply\/|\/careers\/.*job/i.test(path) && path.split('/').filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

function applyLinkFromHtml(html, baseUrl) {
  const matches = [...String(html || '').matchAll(/href=["']([^"']+)["']/gi)].map((item) => item[1]);
  for (const href of matches) {
    try {
      const next = new URL(href, baseUrl).toString();
      if (isErrorUrl(next)) continue;
      if (isApplyHost(next)) return next;
    } catch {}
  }
  return '';
}

async function resolveJobUrl(raw) {
  const start = String(raw || '').trim();
  if (!start || isErrorUrl(start)) throw new Error('That address is an error page, not the job posting.');
  if (isApplyHost(start) || looksLikeJobUrl(start)) return start;
  try {
    const response = await fetch(start, { redirect: 'follow' });
    const finalUrl = response.url || start;
    if (isErrorUrl(finalUrl)) throw new Error('That job site sent an error page instead of the posting.');
    if (isApplyHost(finalUrl) || looksLikeJobUrl(finalUrl)) return finalUrl;
    const html = await response.text();
    const applyUrl = applyLinkFromHtml(html, finalUrl);
    if (applyUrl) return applyUrl;
  } catch (err) {
    if (looksLikeJobUrl(start)) return start;
    throw err;
  }
  return start;
}

function isDashboardUrl(url) {
  return /localhost:5173|127\.0\.0\.1:5173|localhost:5174|127\.0\.0\.1:5174|localhost:3000|127\.0\.0\.1:3000/.test(String(url || ''));
}

function isJobTab(tabId) {
  return Boolean(tabId) && (tabId === jobTabId || extraJobTabIds.has(tabId));
}

function relayToDashboard(type, data) {
  const payload = { source: 'hamzooh-extension', type, ...data };
  const send = (id) => chrome.tabs.sendMessage(id, payload).catch(() => false);
  if (dashboardTabId) {
    send(dashboardTabId).then((ok) => {
      if (ok !== false) return;
      chrome.tabs.query({ url: LOCAL_TABS }, (tabs) => {
        if (tabs && tabs.length > 0) {
          dashboardTabId = tabs[0].id;
          send(dashboardTabId);
        }
      });
    });
    return;
  }
  chrome.tabs.query({ url: LOCAL_TABS }, (tabs) => {
    if (tabs && tabs.length > 0) {
      dashboardTabId = tabs[0].id;
      send(dashboardTabId);
    }
  });
}

// ─── Per-run structured log (Phase 0 diagnostics) ───────────────────────────
// Every run gets a stable runId, a state, every step/transition, metrics and
// failure evidence (screenshot + interactive-element dump). Runs live in
// chrome.storage.local so the MV3 worker can die without losing the trail.

const RUNS_KEY = 'hamzoohRuns';
const MAX_RUNS = 24;
const MAX_STEPS = 400;
let runsQueue = Promise.resolve();

function queueRuns(fn) {
  const next = runsQueue.then(fn, fn);
  runsQueue = next.catch(() => {});
  return next;
}

async function readRuns() {
  try {
    const stored = await chrome.storage.local.get(RUNS_KEY);
    return stored?.[RUNS_KEY] || {};
  } catch {
    return {};
  }
}

async function writeRuns(runs) {
  const ids = Object.keys(runs).sort((a, b) => (runs[b]?.startedAt || 0) - (runs[a]?.startedAt || 0));
  const out = {};
  ids.slice(0, MAX_RUNS).forEach((id, index) => {
    const run = runs[id];
    // Screenshots are large: keep evidence only on the ten newest runs.
    if (index >= 10) delete run.evidence;
    out[id] = run;
  });
  try {
    await chrome.storage.local.set({ [RUNS_KEY]: out });
  } catch (err) {
    log('run log save failed', err?.message);
  }
}

function mutateRun(runId, fn) {
  return queueRuns(async () => {
    const runs = await readRuns();
    const run = runs[runId] || {
      runId,
      startedAt: Date.now(),
      steps: [],
      state: 'queued',
      status: 'RUNNING',
    };
    fn(run);
    run.updatedAt = Date.now();
    runs[runId] = run;
    await writeRuns(runs);
    return run;
  });
}

function createRun(meta) {
  return mutateRun(meta.runId, (run) => {
    Object.assign(run, meta, { status: 'RUNNING', state: 'queued' });
    run.steps = run.steps || [];
  });
}

function terminalStatus(status) {
  if (status === 'submitted') return 'SUBMITTED';
  if (status === 'failed') return 'FAILED';
  if (status === 'cancelled') return 'NEEDS_USER';
  return 'NEEDS_USER';
}

function deriveReasonCode(run, status) {
  if (status === 'submitted') return 'SUBMITTED';
  const steps = (run.steps || []).map((s) => s.step);
  const last = (run.steps || [])[(run.steps || []).length - 1] || {};
  const reasonText = `${last.message || ''} ${(run.skipped || []).map((s) => s.reason || '').join(' ')}`.toLowerCase();

  if (steps.includes('captcha_detected') || /captcha|recaptcha|turnstile|hcaptcha|verification/.test(reasonText)) return 'CAPTCHA';
  if (steps.includes('login_required') || steps.includes('auto_login_submitted')) return 'LOGIN_REQUIRED';
  if (steps.includes('account_creation')) return 'ACCOUNT_CREATION';
  if (steps.includes('apply_blocked')) return 'APPLY_BUTTON_NOT_FOUND';
  if (steps.includes('advance_blocked') || /did not advance|validation|not valid|please fill/.test(reasonText)) return 'VALIDATION_BLOCKED';
  if (steps.includes('resume_failed') || steps.includes('resume_missing')) return 'RESUME_ATTACH_FAILED';
  if (/required|still missing|required choice|unanswered/.test(reasonText)) return 'MISSING_ANSWER';
  if (status === 'failed' || steps.includes('error')) return 'CRASH';
  if (/no submit button/.test(reasonText)) return 'NO_SUBMIT_BUTTON';
  if (/no form|not recognized|could not find|no application/.test(reasonText)) return 'NO_FORM';
  if (run.dryRun) return 'REVIEW_READY';
  return 'NEEDS_USER_GENERIC';
}

function appendRunEvent(runId, event) {
  if (!runId) return Promise.resolve(null);
  return mutateRun(runId, (run) => {
    run.steps = run.steps || [];
    run.steps.push(event);
    if (run.steps.length > MAX_STEPS) run.steps = run.steps.slice(-MAX_STEPS);
    if (event.state) run.state = event.state;
    if (event.step === 'filler_injected' || event.step === 'tab_loaded') run.state = 'filling';
    if (event.step === 'form_filled' && event.data) {
      run.metrics = { ...(run.metrics || {}), ...event.data };
    }
    if (event.step === 'complete') {
      run.status = terminalStatus(event.data?.status);
      run.state = run.status;
      run.reasonCode = event.data?.reasonCode || run.reasonCode || deriveReasonCode(run, event.data?.status);
      run.reason = event.message || '';
      run.endedAt = Date.now();
      if (event.data?.filledCount != null || event.data?.emptyCount != null) {
        run.metrics = {
          ...(run.metrics || {}),
          filledCount: Number(event.data.filledCount || 0),
          emptyCount: Number(event.data.emptyCount || 0),
        };
      }
      if (Array.isArray(event.data?.skipped)) run.skipped = event.data.skipped;
    }
  });
}

// Runs inside the job tab; must be self-contained (serialised by executeScript).
// ─── CDP input layer (Phase 1a) ────────────────────────────────────────────
const debuggerTargets = new Set();

async function cdpAttach(tabId) {
  if (!tabId) return false;
  if (debuggerTargets.has(tabId)) return true;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerTargets.add(tabId);
    return true;
  } catch (err) {
    log('debugger attach failed', tabId, err?.message);
    return false;
  }
}

async function cdpDetach(tabId) {
  if (!debuggerTargets.has(tabId)) return;
  try { await chrome.debugger.detach({ tabId }); } catch {}
  debuggerTargets.delete(tabId);
}

async function cdpCommand(tabId, method, params) {
  if (!await cdpAttach(tabId)) return false;
  try {
    await chrome.debugger.sendCommand({ tabId }, method, params || {});
    return true;
  } catch (err) {
    log('cdp command failed', method, err?.message);
    return false;
  }
}

function collectPageEvidence() {
  const isVisible = (el) => {
    try {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 1 && rect.height > 1 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05;
    } catch { return false; }
  };
  const labelFor = (el) => {
    try {
      const id = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const text = id?.innerText
        || el.closest('label')?.innerText
        || el.getAttribute('aria-label')
        || el.getAttribute('placeholder')
        || el.name
        || '';
      return String(text).replace(/\s+/g, ' ').trim().slice(0, 120);
    } catch { return ''; }
  };
  const interactive = [...document.querySelectorAll('input, select, textarea, button, a[href], [role="button"], [contenteditable="true"]')]
    .filter(isVisible)
    .slice(0, 180)
    .map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        type: el.getAttribute('type') || '',
        id: el.id || '',
        name: el.getAttribute('name') || '',
        text: String(el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 90),
        label: labelFor(el),
        value: String(el.value ?? '').slice(0, 120),
        required: el.required === true || el.getAttribute('aria-required') === 'true',
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        checked: el.checked === true,
        options: el.tagName === 'SELECT' ? [...el.options].slice(0, 12).map((o) => o.text.trim()) : undefined,
        rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        inViewport: rect.top < window.innerHeight && rect.bottom > 0,
      };
    });
  const alerts = [...document.querySelectorAll('[role="alert"], [aria-live], .error, [class*="error"], [data-testid*="error"]')]
    .filter(isVisible)
    .slice(0, 20)
    .map((el) => String(el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200))
    .filter(Boolean);
  return {
    url: location.href,
    title: document.title,
    interactive,
    alerts,
    text: String(document.body?.innerText || '').slice(0, 6000),
  };
}

async function captureEvidence(runId, tabId) {
  if (!runId || !tabId) return null;
  const evidence = { capturedAt: Date.now(), screenshot: '', frames: [] };
  try {
    const tab = await chrome.tabs.get(tabId);
    evidence.tabUrl = tab?.url || '';
    evidence.tabTitle = tab?.title || '';
    try {
      await chrome.tabs.update(tabId, { active: true });
      await new Promise((r) => setTimeout(r, 350));
      try {
        evidence.screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 55 });
      } catch (first) {
        // Some Chrome builds reject captureVisibleTab for an inactive/other
        // window. Retry with the current window and PNG before giving up.
        try {
          const current = await chrome.windows.getCurrent();
          evidence.screenshot = await chrome.tabs.captureVisibleTab(current.id, { format: 'png' });
        } catch (second) {
          evidence.screenshotError = `${first.message || first} | ${second.message || second}`;
          log('screenshot failed', tabId, evidence.screenshotError);
        }
      }
    } catch (err) {
      evidence.screenshotError = err?.message || String(err);
      log('screenshot activation failed', tabId, evidence.screenshotError);
    }
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: collectPageEvidence,
      });
      evidence.frames = (results || []).slice(0, 8).map((item) => ({ frameId: item.frameId, ...(item.result || {}) }));
      const captchaFrame = evidence.frames.find((frame) => /recaptcha|hcaptcha|captcha|turnstile|challenge/i.test(frame.url || ''));
      if (captchaFrame) {
        evidence.captchaDetected = true;
        evidence.captchaFrameUrl = captchaFrame.url.slice(0, 200);
      }
    } catch (err) {
      log('element dump failed', tabId, err?.message);
    }
  } catch (err) {
    log('evidence capture failed', err?.message);
    return null;
  }
  if (evidence.screenshot && evidence.screenshot.length > 500000) {
    evidence.screenshot = evidence.screenshot.slice(0, 500000);
    evidence.screenshotTruncated = true;
  }
  await mutateRun(runId, (run) => {
    run.evidence = evidence;
    if (evidence.captchaDetected && run.status === 'NEEDS_USER' && run.reasonCode !== 'CAPTCHA') {
      run.reasonCode = 'CAPTCHA';
      run.reason = 'A verification challenge (CAPTCHA) blocked the application. Solve it in the job tab, then resume.';
    }
  });
  return evidence;
}

function fingerprint(jobUrl, company, title) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 80);
  return `${norm(new URL(jobUrl || 'http://x').pathname)}|${norm(company)}|${norm(title)}`;
}

async function recordRunOutcome(runId, status, tabUrl) {
  try {
    const { pendingApply } = await chrome.storage.local.get('pendingApply');
    if (!pendingApply) return;
    const fp = fingerprint(pendingApply.url, pendingApply.company, pendingApply.jobTitle);
    const applied = await chrome.storage.local.get('hamzoohApplied').then((s) => s.hamzoohApplied || {});
    const memory = await chrome.storage.local.get('hamzoohDomainMemory').then((s) => s.hamzoohDomainMemory || {});
    const host = hostname(tabUrl || pendingApply.url);
    if (status === 'submitted') applied[fp] = { at: Date.now(), runId, company: pendingApply.company, title: pendingApply.jobTitle };
    if (host) {
      memory[host] = {
        lastStatus: status,
        lastRunId: runId,
        at: Date.now(),
        dryRun: Boolean(pendingApply.dryRun),
      };
    }
    await chrome.storage.local.set({ hamzoohApplied: applied, hamzoohDomainMemory: memory });
  } catch (err) {
    log('outcome record failed', err?.message);
  }
}

const evidenceInFlight = new Set();

function captureEvidenceOnce(runId, tabId) {
  if (!runId || evidenceInFlight.has(runId)) return Promise.resolve(null);
  evidenceInFlight.add(runId);
  return captureEvidence(runId, tabId).finally(() => evidenceInFlight.delete(runId));
}

// ─── IndexedDB resume storage (survives SW restarts, no 10MB quota surprise) ───

function idbReq(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('hamzooh-apply', 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('files', mode);
      const store = tx.objectStore('files');
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

function saveResumeBlob(base64, name) {
  if (!base64) return Promise.resolve();
  return idbReq('readwrite', (store) => store.put({ base64, name: name || 'hamzooh-resume.pdf', savedAt: Date.now() }, 'resume'));
}

function loadResumeBlob() {
  return idbReq('readonly', (store) => store.get('resume')).catch(() => null);
}

function storageSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

// ─── SPA / frame re-injection + MV3 worker keepalive (Phase 1b/1c) ─────────
const lastReinject = new Map();
function reinjectForNavigation(details) {
  if (!details || details.frameId !== 0 || !isJobTab(details.tabId)) return;
  const last = lastReinject.get(details.tabId) || 0;
  if (Date.now() - last < 5000) return;
  lastReinject.set(details.tabId, Date.now());
  chrome.storage.local.get('pendingApply', ({ pendingApply }) => {
    if (!pendingApply || pendingApply.done) return;
    appendRunEvent(pendingApply.runId, {
      step: 'navigation_reinject',
      message: `Re-checked after navigation: ${hostname(details.url) || details.url}`,
      data: { tabId: details.tabId, url: details.url, reason: details.transitionType || 'navigation' },
      t: Date.now(),
    }).catch(() => {});
    chrome.tabs.sendMessage(details.tabId, { type: 'HAMZOOH_BEGIN_FILL' }).catch(() => {});
  });
}
try {
  chrome.webNavigation.onCommitted.addListener(reinjectForNavigation);
  chrome.webNavigation.onCompleted.addListener(reinjectForNavigation);
  chrome.webNavigation.onHistoryStateUpdated.addListener(reinjectForNavigation);
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'hamzooh-apply-keepalive') return;
    chrome.storage.local.get('pendingApply', ({ pendingApply }) => {
      if (!pendingApply || pendingApply.done) {
        chrome.alarms.clear('hamzooh-apply-keepalive').catch(() => {});
        return;
      }
      const tabIds = [jobTabId, ...extraJobTabIds].filter(Boolean);
      if (pendingApply.startedAt && Date.now() - pendingApply.startedAt > 4.5 * 60 * 1000) {
        appendRunEvent(pendingApply.runId, {
          step: 'watchdog', message: '4.5-minute watchdog fired — forcing a terminal state.',
          data: { tabIds }, t: Date.now(),
        }).catch(() => {});
        tabIds.forEach((tabId) => {
          chrome.tabs.sendMessage(tabId, { type: 'HAMZOOH_FORCE_TERMINAL', reason: 'watchdog' }).catch(() => {});
        });
        return;
      }
      tabIds.forEach((tabId) => {
        chrome.tabs.get(tabId).then((tab) => {
          // No need to re-inject the scripts on every wake-up: the content
          // scripts stay loaded. Just nudge the existing one to re-check.
          chrome.tabs.sendMessage(tabId, { type: 'HAMZOOH_BEGIN_FILL' }).catch(() => {});
          appendRunEvent(pendingApply.runId, {
            step: 'worker_keepalive',
            message: 'Service worker stayed alive and re-checked the job tab.',
            data: { tabId, url: tab?.url || '' },
            t: Date.now(),
          }).catch(() => {});
        }).catch(() => {});
      });
    });
  });
} catch (err) {
  log('navigation/keepalive setup failed', err?.message);
}

async function injectFiller(tabId) {
  if (!tabId) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['filler.js'],
    });
    return true;
  } catch (err) {
    log('inject filler failed', tabId, err?.message);
    return false;
  }
}

async function beginFill(tabId) {
  if (!tabId || !isJobTab(tabId)) return;
  const injected = await injectFiller(tabId);
  try {
    const { pendingApply } = await chrome.storage.local.get('pendingApply');
    if (pendingApply?.runId) {
      appendRunEvent(pendingApply.runId, {
        step: injected ? 'filler_injected' : 'filler_injection_failed',
        message: injected ? 'Filler injected into all frames' : 'Filler injection failed',
        data: { tabId },
        t: Date.now(),
      });
    }
  } catch {}
  chrome.tabs.sendMessage(tabId, { type: 'HAMZOOH_BEGIN_FILL' }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(connectOpenHamzoohTabs);
chrome.runtime.onStartup.addListener(connectOpenHamzoohTabs);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (isDashboardUrl(tab?.url)) {
    dashboardTabId = tabId;
    return;
  }
  if (changeInfo.status !== 'complete' || !tab.url || isDashboardUrl(tab.url)) return;
  chrome.storage.local.get('pendingApply', ({ pendingApply }) => {
    if (!pendingApply?.url || pendingApply.done) return;
    if (!isJobTab(tabId) && pendingApply.tabId !== tabId) return;
    jobTabId = tabId;
    if (pendingApply.runId) {
      appendRunEvent(pendingApply.runId, {
        step: 'tab_loaded',
        message: `Job tab loaded: ${hostname(tab.url) || tab.url}`,
        data: { tabId, url: tab.url, title: tab.title || '' },
        t: Date.now(),
      });
    }
    beginFill(tabId);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!isJobTab(tabId)) return;
  chrome.storage.local.get('pendingApply', ({ pendingApply }) => {
    if (!pendingApply?.runId || pendingApply.done) return;
    appendRunEvent(pendingApply.runId, {
      step: 'tab_closed',
      message: 'The job tab was closed before a terminal state was reported.',
      data: { tabId },
      t: Date.now(),
    });
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab?.id) return;
  if (tab.openerTabId && isJobTab(tab.openerTabId)) {
    extraJobTabIds.add(tab.id);
    log('following apply tab opened from job tab', tab.id);
    chrome.storage.local.get('pendingApply', ({ pendingApply }) => {
      if (!pendingApply || pendingApply.done) return;
      storageSet({ pendingApply: { ...pendingApply, tabId: tab.id, applyClicked: true } }).catch(() => {});
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'HAMZOOH_AUTO_TRIGGER') {
    log('Auto-trigger received from tab', sender.tab?.id);
    if (sender.tab?.id && isJobTab(sender.tab.id)) {
      beginFill(sender.tab.id);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, reason: 'not a job tab' });
    }
    return;
  }

  if (message?.type === 'HAMZOOH_IS_JOB_TAB') {
    sendResponse({ ok: isJobTab(sender.tab?.id) });
    return;
  }

  if (message?.type === 'HAMZOOH_GET_RESUME') {
    loadResumeBlob().then((blob) => {
      sendResponse({ ok: Boolean(blob?.base64), resumeBase64: blob?.base64 || '', resumeName: blob?.name || 'hamzooh-resume.pdf' });
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === 'HAMZOOH_PROXY_FETCH') {
    const { path, method, body } = message;
    fetch(`${API_BASE}${path}`, {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      sendResponse({ ok: res.ok, status: res.status, data });
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message || 'proxy fetch failed' });
    });
    return true;
  }

  if (message?.type === 'HAMZOOH_ADOPT_TAB') {
    if (sender.tab?.id) {
      extraJobTabIds.add(sender.tab.id);
      jobTabId = sender.tab.id;
      chrome.storage.local.get('pendingApply', ({ pendingApply }) => {
        if (!pendingApply) return;
        storageSet({
          pendingApply: { ...pendingApply, tabId: sender.tab.id, url: sender.tab.url || pendingApply.url, applyClicked: true },
        }).catch(() => {});
      });
    }
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === 'HAMZOOH_FILLER_PROGRESS') {
    relayToDashboard('HAMZOOH_APPLY_PROGRESS', {
      step: message.step,
      message: message.message,
      timestamp: message.timestamp,
      status: message.status,
      filledCount: message.filledCount,
      emptyCount: message.emptyCount,
      skipped: message.skipped,
      log: message.log,
    });

    const runEvent = {
      step: message.step || 'progress',
      message: message.message || '',
      data: {
        status: message.status,
        filledCount: message.filledCount,
        emptyCount: message.emptyCount,
        skipped: message.skipped,
        ...(message.data || {}),
      },
      href: sender.tab?.url || '',
      frameUrl: message.frameUrl || '',
      frameId: sender.frameId,
      t: message.timestamp || Date.now(),
    };
    // The same completion is emitted once as HAMZOOH_RUN_EVENT (with metrics)
    // and once as HAMZOOH_FILLER_PROGRESS (user-facing). Persist only the
    // former so the explicit reasonCode is not overwritten by a derived one.
    const isDuplicateTerminal = message.type === 'HAMZOOH_FILLER_PROGRESS' && message.step === 'complete';
    const persist = message.runId && !isDuplicateTerminal
      ? appendRunEvent(message.runId, runEvent)
      : Promise.resolve(null);

    if (message.step === 'complete') {
      relayToDashboard('HAMZOOH_APPLY_COMPLETE', {
        status: message.status || 'needs_attention',
        message: message.message,
        filledCount: message.filledCount || 0,
        emptyCount: message.emptyCount || 0,
        skipped: message.skipped || [],
        reasonCode: message.reasonCode || '',
        question: message.question || '',
        runId: message.runId || '',
      });
      if (message.status !== 'submitted') {
        relayToDashboard('HAMZOOH_NEEDS_USER', {
          reasonCode: message.reasonCode || 'NEEDS_USER_GENERIC',
          message: message.message || 'The application needs your attention.',
          question: message.question || '',
          runId: message.runId || '',
        });
      }
      persist.then((run) => {
        if (chrome.alarms) chrome.alarms.clear('hamzooh-apply-keepalive').catch(() => {});
        const runId = message.runId || run?.runId;
        const tabId = sender.tab?.id || run?.tabId;
        recordRunOutcome(runId, message.status || 'needs_attention', sender.tab?.url).catch(() => {});
        if (runId && message.status !== 'submitted') captureEvidenceOnce(runId, tabId);
      }).catch(() => {});
    }
    return;
  }

  if (message?.type === 'HAMZOOH_RUN_EVENT') {
    appendRunEvent(message.runId, {
      step: message.step || 'event',
      message: message.message || '',
      data: message.data || {},
      href: message.href || sender.tab?.url || '',
      frameUrl: message.frameUrl || '',
      frameId: sender.frameId,
      t: message.t || Date.now(),
    }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'HAMZOOH_GET_RUN') {
    readRuns().then((runs) => {
      const run = message.runId ? runs[message.runId] : Object.values(runs).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
      sendResponse({ ok: true, run: run || null });
    }).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'HAMZOOH_LIST_RUNS') {
    readRuns().then((runs) => {
      const list = Object.values(runs)
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
        .map((run) => ({
          runId: run.runId,
          jobUrl: run.jobUrl,
          company: run.company,
          title: run.title,
          dryRun: Boolean(run.dryRun),
          status: run.status,
          reasonCode: run.reasonCode || '',
          reason: run.reason || '',
          startedAt: run.startedAt,
          endedAt: run.endedAt || null,
          steps: (run.steps || []).length,
          metrics: run.metrics || {},
          hasEvidence: Boolean(run.evidence),
        }));
      sendResponse({ ok: true, runs: list });
    }).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'HAMZOOH_CLEAR_RUNS') {
    chrome.storage.local.set({ [RUNS_KEY]: {} })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'HAMZOOH_RESUME_RUN') {
    chrome.storage.local.get(['pendingApply'], async ({ pendingApply }) => {
      if (!pendingApply) {
        sendResponse({ ok: false, error: 'No paused run was found. Start Auto Apply again.' });
        return;
      }
      const tabId = pendingApply.tabId || jobTabId;
      const resumed = { ...pendingApply, done: false, paused: false, awaitingManualApply: false, loginHost: '' };
      try {
        await storageSet({ pendingApply: resumed });
        await appendRunEvent(pendingApply.runId, {
          step: 'resumed', message: 'User resumed a paused run from the dashboard.',
          data: { tabId, url: resumed.url || '' }, t: Date.now(),
        });
        if (tabId) {
          await chrome.tabs.update(tabId, { active: true }).catch(() => {});
          beginFill(tabId);
        }
        sendResponse({ ok: true, tabId, runId: pendingApply.runId });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    });
    return true;
  }

  if (message?.type === 'HAMZOOH_CDP_INPUT') {
    const tabId = message.tabId || sender.tab?.id;
    const action = String(message.action || '');
    (async () => {
      let ok = false;
      if (action === 'click') {
        const { x, y } = message;
        ok = await cdpCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
          && await cdpCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
          && await cdpCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      } else if (action === 'type') {
        ok = await cdpCommand(tabId, 'Input.insertText', { text: String(message.text || '') });
      } else if (action === 'key') {
        ok = await cdpCommand(tabId, 'Input.dispatchKeyEvent', {
          type: 'keyDown', key: message.key || 'Enter', code: message.code || '',
          windowsVirtualKeyCode: message.keyCode || 13, nativeVirtualKeyCode: message.keyCode || 13,
        }) && await cdpCommand(tabId, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: message.key || 'Enter', code: message.code || '',
          windowsVirtualKeyCode: message.keyCode || 13, nativeVirtualKeyCode: message.keyCode || 13,
        });
      } else if (action === 'upload') {
        const frameId = message.frameId || 0;
        const session = { tabId };
        try {
          const { root } = await chrome.debugger.sendCommand(session, 'DOM.getDocument', { depth: -1, pierce: true });
          const { nodeId } = await chrome.debugger.sendCommand(session, 'DOM.querySelector', {
            nodeId: root.nodeId, selector: message.selector || 'input[type="file"]',
          });
          if (nodeId) {
            await chrome.debugger.sendCommand(session, 'DOM.setFileInputFiles', {
              nodeId, files: message.files || [],
            });
            ok = true;
          }
        } catch (err) {
          log('cdp upload failed', err?.message);
        }
      } else if (action === 'detach') {
        await cdpDetach(tabId);
        ok = true;
      }
      sendResponse({ ok });
    })();
    return true;
  }

  if (message?.type === 'HAMZOOH_CAPTURE_EVIDENCE') {
    captureEvidence(message.runId, message.tabId || sender.tab?.id)
      .then((evidence) => sendResponse({ ok: Boolean(evidence), evidence }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'HAMZOOH_CAPTURE_SCREENSHOT') {
    const tabId = message.tabId || sender.tab?.id;
    (async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        await chrome.tabs.update(tabId, { active: true });
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 75 });
        sendResponse({ ok: true, dataUrl });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Screenshot capture failed' });
      }
    })();
    return true;
  }



  if (message?.type !== 'HAMZOOH_OPEN_JOB') return undefined;

  if (sender.tab?.id) dashboardTabId = sender.tab.id;

  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  createRun({
    runId,
    requestId: message.requestId || '',
    jobUrl: message.url || '',
    company: message.company || '',
    title: message.jobTitle || '',
    dryRun: message.dryRun === true,
    autoSubmit: message.autoSubmit === true,
    startedAt,
  }).then(() => appendRunEvent(runId, {
    step: 'open_requested',
    message: 'Auto-apply requested',
    data: { url: message.url || '', dryRun: message.dryRun === true, autoSubmit: message.autoSubmit === true },
    t: startedAt,
  })).then(() => {
    if (chrome.alarms) chrome.alarms.create('hamzooh-apply-keepalive', { periodInMinutes: 0.3 }).catch(() => {});
  }).catch(() => {});

  resolveJobUrl(message.url).then(async (url) => {
    appendRunEvent(runId, {
      step: 'url_resolved',
      message: `Resolved job URL: ${hostname(url) || url}`,
      data: { url },
      t: Date.now(),
    }).catch(() => {});

    if (isErrorUrl(url)) {
      appendRunEvent(runId, {
        step: 'complete',
        message: 'That job address is an error page, not the job posting.',
        data: { status: 'failed', reasonCode: 'URL_RESOLVE_FAILED', filledCount: 0, emptyCount: 0 },
        t: Date.now(),
      }).catch(() => {});
      sendResponse({ ok: false, error: 'That job address is an error page. Paste the Apply URL from the address bar.', runId });
      return;
    }

    const fp = fingerprint(url, message.company, message.jobTitle);
    const applied = await chrome.storage.local.get('hamzoohApplied').then((s) => s.hamzoohApplied || {}).catch(() => ({}));
    if (applied[fp] && message.force !== true && message.dryRun !== true) {
      appendRunEvent(runId, {
        step: 'complete',
        message: 'Duplicate application already recorded for this job, company and title.',
        data: { status: 'failed', reasonCode: 'DUPLICATE_APPLICATION' },
        t: Date.now(),
      }).catch(() => {});
      sendResponse({ ok: false, error: 'You already applied to this role. Use "Apply again" to override.', runId, reasonCode: 'DUPLICATE_APPLICATION' });
      return;
    }

    extraJobTabIds.clear();
    const sessionId = `apply_${Date.now()}`;
    try {
      await saveResumeBlob(message.resumeBase64 || '', message.resumeName || 'hamzooh-resume.pdf');
    } catch (err) {
      log('resume IDB save failed', err?.message);
    }

    const pendingApply = {
      runId,
      sessionId,
      requestId: message.requestId || '',
      url,
      dryRun: message.dryRun === true,
      resumeName: message.resumeName || 'hamzooh-resume.pdf',
      // Keep the bytes inline as a fallback: if IndexedDB or the resume
      // request fails, the content script can still attach the tailored PDF.
      resumeBase64: String(message.resumeBase64 || ''),
      resumeText: String(message.resumeText || '').slice(0, 20000),
      jobTitle: message.jobTitle || '',
      company: message.company || '',
      trainMode: message.trainMode === true,
      autoSubmit: message.trainMode ? false : message.autoSubmit === true,
      startedAt: Date.now(),
      hasResume: Boolean(message.resumeBase64),
    };

    try {
      await storageSet({
        profile: message.profile || {},
        answers: message.answers || {},
        hamzoohTrainMode: message.trainMode === true,
        pendingApply,
      });
    } catch (err) {
      log('storage set failed, retrying without resume text', err.message);
      try {
        await storageSet({
          profile: message.profile || {},
          answers: message.answers || {},
          // Drop the inline copy first (IndexedDB still holds the blob).
          pendingApply: { ...pendingApply, resumeBase64: '', resumeText: '' },
        });
      } catch (err2) {
        appendRunEvent(runId, {
          step: 'complete',
          message: `Could not store the apply session: ${err2.message}`,
          data: { status: 'failed', reasonCode: 'STORAGE_FAILED' },
          t: Date.now(),
        }).catch(() => {});
        sendResponse({ ok: false, error: err2.message || 'Could not store apply session.', runId });
        return;
      }
    }

    chrome.tabs.create({ url, active: true }, (newTab) => {
      jobTabId = newTab?.id;
      extraJobTabIds.add(jobTabId);
      pendingApply.tabId = jobTabId;
      storageSet({ pendingApply }).catch(() => {});
      appendRunEvent(runId, {
        step: 'tab_created',
        message: `Opened job tab: ${hostname(url) || url}`,
        data: { tabId: jobTabId, url },
        t: Date.now(),
      }).catch(() => {});
      log('opened job tab', jobTabId, url);
      sendResponse({ ok: true, url, tabId: jobTabId, runId });
    });
  }).catch((err) => {
    appendRunEvent(runId, {
      step: 'complete',
      message: err.message || 'Could not open that job.',
      data: { status: 'failed', reasonCode: 'URL_RESOLVE_FAILED' },
      t: Date.now(),
    }).catch(() => {});
    sendResponse({ ok: false, error: err.message || 'Could not open that job.', runId });
  });
  return true;
});
