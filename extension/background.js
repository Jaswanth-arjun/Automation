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

async function injectFiller(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['filler.js'],
    });
  } catch (err) {
    log('inject filler failed', tabId, err?.message);
  }
}

async function beginFill(tabId) {
  if (!tabId || !isJobTab(tabId)) return;
  await injectFiller(tabId);
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
    beginFill(tabId);
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
    if (message.step === 'complete') {
      relayToDashboard('HAMZOOH_APPLY_COMPLETE', {
        status: message.status || 'needs_attention',
        message: message.message,
        filledCount: message.filledCount || 0,
        emptyCount: message.emptyCount || 0,
        skipped: message.skipped || [],
      });
    }
    return;
  }

  if (message?.type !== 'HAMZOOH_OPEN_JOB') return undefined;

  if (sender.tab?.id) dashboardTabId = sender.tab.id;

  resolveJobUrl(message.url).then(async (url) => {
    if (isErrorUrl(url)) {
      sendResponse({ ok: false, error: 'That job address is an error page. Paste the Apply URL from the address bar.' });
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
      sessionId,
      requestId: message.requestId || '',
      url,
      resumeName: message.resumeName || 'hamzooh-resume.pdf',
      // Keep the bytes inline as a fallback: if IndexedDB or the resume
      // request fails, the content script can still attach the tailored PDF.
      resumeBase64: String(message.resumeBase64 || ''),
      resumeText: String(message.resumeText || '').slice(0, 20000),
      jobTitle: message.jobTitle || '',
      company: message.company || '',
      autoSubmit: message.autoSubmit === true,
      startedAt: Date.now(),
      hasResume: Boolean(message.resumeBase64),
    };

    try {
      await storageSet({
        profile: message.profile || {},
        answers: message.answers || {},
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
        sendResponse({ ok: false, error: err2.message || 'Could not store apply session.' });
        return;
      }
    }

    chrome.tabs.create({ url, active: true }, (newTab) => {
      jobTabId = newTab?.id;
      extraJobTabIds.add(jobTabId);
      pendingApply.tabId = jobTabId;
      storageSet({ pendingApply }).catch(() => {});
      log('opened job tab', jobTabId, url);
      sendResponse({ ok: true, url, tabId: jobTabId });
    });
  }).catch((err) => {
    sendResponse({ ok: false, error: err.message || 'Could not open that job.' });
  });
  return true;
});
