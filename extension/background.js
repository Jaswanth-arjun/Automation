/**
 * Hamzo Apply — Background Service Worker
 * Opens job application pages in NEW TABS (not new windows),
 * injects filler.js, and relays progress/results back to the dashboard.
 */

const LOCAL_TABS = ['http://localhost:5173/*', 'http://127.0.0.1:5173/*'];
const APPLY_HOSTS = /greenhouse\.io$|lever\.co$|myworkdayjobs\.com$|ashbyhq\.com$|smartrecruiters\.com$|icims\.com$|workable\.com$|jobvite\.com$|taleo\.net$|successfactors\.com$|oraclecloud\.com$|linkedin\.com$|indeed\.com$/i;

// Track which tab is the Hamzo dashboard
let dashboardTabId = null;
// Track which tab is the current job application
let jobTabId = null;

async function connectOpenHamzoTabs() {
  const tabs = await chrome.tabs.query({ url: LOCAL_TABS });
  await Promise.all(tabs.map((tab) =>
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['bridge.js'],
      injectImmediately: true,
    }).catch(() => {})
  ));
  // Remember dashboard tab
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
  return APPLY_HOSTS.test(host) || APPLY_HOSTS.test(host.split('.').slice(-2).join('.')) || /\.greenhouse\.io$|\.lever\.co$|\.ashbyhq\.com$|\.myworkdayjobs\.com$/i.test(host);
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

// ─── Relay progress from filler.js to dashboard tab ───

function relayToDashboard(type, data) {
  if (!dashboardTabId) return;
  chrome.tabs.sendMessage(dashboardTabId, {
    source: 'hamzo-extension',
    type,
    ...data,
  }).catch(() => {
    // Dashboard tab may have closed — try to find it again
    chrome.tabs.query({ url: LOCAL_TABS }, (tabs) => {
      if (tabs && tabs.length > 0) {
        dashboardTabId = tabs[0].id;
        chrome.tabs.sendMessage(dashboardTabId, {
          source: 'hamzo-extension',
          type,
          ...data,
        }).catch(() => {});
      }
    });
  });
}

// ─── Lifecycle ───

chrome.runtime.onInstalled.addListener(connectOpenHamzoTabs);
chrome.runtime.onStartup.addListener(connectOpenHamzoTabs);

// Inject filler.js when a job tab finishes loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url || /localhost:5173|127\.0\.0\.1:5173/.test(tab.url)) return;

  // Track dashboard tab
  if (/localhost:5173|127\.0\.0\.1:5173/.test(tab.url)) {
    dashboardTabId = tabId;
    return;
  }

  chrome.storage.local.get('pendingApply', ({ pendingApply }) => {
    // Filler self-gates on the page (sameJobPage / adopted flow host), so inject
    // whenever an unfinished apply exists — covers Apply-click navigations to
    // new ATS hosts and SPA route changes.
    if (!pendingApply?.url || pendingApply.done) return;
    chrome.scripting.executeScript({ target: { tabId }, files: ['filler.js'] }).catch(() => {});
  });
});

// ─── Message Handler ───

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ─── Filler progress relay (from filler.js content script to dashboard) ───
  if (message?.type === 'HAMZO_FILLER_PROGRESS') {
    relayToDashboard('HAMZO_APPLY_PROGRESS', {
      step: message.step,
      message: message.message,
      timestamp: message.timestamp,
      status: message.status,
      filledCount: message.filledCount,
      emptyCount: message.emptyCount,
    });

    // If this is a completion event, also send the dedicated complete message
    if (message.step === 'complete') {
      relayToDashboard('HAMZO_APPLY_COMPLETE', {
        status: message.status || 'needs_attention',
        message: message.message,
        filledCount: message.filledCount || 0,
        emptyCount: message.emptyCount || 0,
      });
    }
    return;
  }

  // ─── Open job in a NEW TAB (from dashboard via bridge.js) ───
  if (message?.type !== 'HAMZO_OPEN_JOB') return undefined;

  // Remember which tab sent this (the dashboard)
  if (sender.tab?.id) dashboardTabId = sender.tab.id;

  resolveJobUrl(message.url).then((url) => {
    if (isErrorUrl(url)) {
      sendResponse({ ok: false, error: 'That job address is an error page. Paste the Apply URL from the address bar.' });
      return;
    }

    // Store pending apply data including job metadata
    chrome.storage.local.set({
      profile: message.profile || {},
      answers: message.answers || {},
      pendingApply: {
        url,
        resumeBase64: message.resumeBase64 || '',
        resumeName: message.resumeName || 'hamzo-resume.pdf',
        jobTitle: message.jobTitle || '',
        company: message.company || '',
        autoSubmit: message.autoSubmit || false,
        startedAt: Date.now(),
      },
    }, () => {
      // Open in a NEW TAB in the user's CURRENT browser window (not a new window!)
      chrome.tabs.create({ url, active: true }, (newTab) => {
        jobTabId = newTab?.id;

        // Also check if there's already a tab open on a related page — inject filler there too
        // (filler self-gates; unmatched pages exit immediately)
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (!tab.id || tab.id === newTab?.id || !tab.url || /localhost:5173|127\.0\.0\.1:5173/.test(tab.url)) return;
            chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['filler.js'] }).catch(() => {});
          });
        });

        sendResponse({ ok: true, url });
      });
    });
  }).catch((err) => {
    sendResponse({ ok: false, error: err.message || 'Could not open that job.' });
  });
  return true;
});
