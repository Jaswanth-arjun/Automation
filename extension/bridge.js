(function () {
  function extensionAlive() {
    try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; }
  }

  function reply(type, extra) {
    window.postMessage({ source: 'hamzooh-extension', type, ...extra }, '*');
  }

  if (window.__HAMZOOH_BRIDGE_LOADED__ && window.__HAMZOOH_BRIDGE_ALIVE__ && window.__HAMZOOH_BRIDGE_ALIVE__()) {
    try { reply('HAMZOOH_PONG'); } catch {}
    return;
  }
  window.__HAMZOOH_BRIDGE_LOADED__ = true;
  window.__HAMZOOH_BRIDGE_ALIVE__ = extensionAlive;

  try {
    if (document.documentElement) {
      document.documentElement.dataset.hamzoohExtension = '1';
    }
  } catch {}

  /**
   * Hamzooh Apply — Bridge Content Script
   * Runs on the Hamzooh dashboard (localhost:5173 / 5174) to relay messages
   * between the web app (window.postMessage) and the extension (chrome.runtime).
   */

  // Broadcast immediate PONG on load
  reply('HAMZOOH_PONG');

  // ─── Listen for messages FROM the extension background/content scripts ───
  if (extensionAlive()) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.source !== 'hamzooh-extension') return;

      // Relay progress events from filler.js (via background) to dashboard web app
      if (message.type === 'HAMZOOH_APPLY_PROGRESS') {
        window.postMessage({
          source: 'hamzooh-extension',
          type: 'HAMZOOH_APPLY_PROGRESS',
          step: message.step,
          message: message.message,
          timestamp: message.timestamp,
          status: message.status,
          filledCount: message.filledCount,
          emptyCount: message.emptyCount,
          skipped: message.skipped || [],
        }, '*');
      }

      // Relay completion events
      if (message.type === 'HAMZOOH_APPLY_COMPLETE') {
        window.postMessage({
          source: 'hamzooh-extension',
          type: 'HAMZOOH_APPLY_COMPLETE',
          status: message.status,
          message: message.message,
          filledCount: message.filledCount,
          emptyCount: message.emptyCount,
          skipped: message.skipped || [],
          runId: message.runId,
        }, '*');
      }

      // Relay pause events from the background into the dashboard.
      if (message.type === 'HAMZOOH_NEEDS_USER') {
        window.postMessage({
          source: 'hamzooh-extension',
          type: 'HAMZOOH_NEEDS_USER',
          reasonCode: message.reasonCode,
          message: message.message,
          question: message.question || '',
          runId: message.runId || '',
        }, '*');
      }

      // Relay a full run log requested by the dashboard.
      if (message.type === 'HAMZOOH_RUN_LOG') {
        window.postMessage({
          source: 'hamzooh-extension',
          type: 'HAMZOOH_RUN_LOG',
          run: message.run || null,
        }, '*');
      }
    });
  }

  // ─── Listen for messages FROM the web app (postMessage) ───
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'hamzooh-app') return;
    const data = event.data;

    if (data.type === 'HAMZOOH_PING') {
      reply('HAMZOOH_PONG');
      return;
    }

    if (!extensionAlive()) {
      if (data.type === 'HAMZOOH_START_APPLY') reply('HAMZOOH_APPLY_READY', { requestId: data.requestId || '', ok: false, error: 'Extension was reloaded. Please refresh (F5) this page and click Auto Apply with AI again.' });
      return;
    }

    if (data.type === 'HAMZOOH_SAVE_PROFILE') {
      chrome.storage.local.set({
        profile: data.profile || {},
        answers: data.answers || {},
      }, () => reply('HAMZOOH_SAVED'));
      return;
    }

    if (data.type === 'HAMZOOH_GET_ANSWERS') {
      chrome.storage.local.get(['answers'], (stored) => {
        reply('HAMZOOH_ANSWERS', { answers: stored.answers || {} });
      });
      return;
    }

    // Sync answers from server vault into extension storage
    if (data.type === 'HAMZOOH_SYNC_ANSWERS') {
      const serverAnswers = data.answers || {};
      chrome.storage.local.get(['answers'], (stored) => {
        const merged = { ...(stored.answers || {}), ...serverAnswers };
        chrome.storage.local.set({ answers: merged }, () => {
          reply('HAMZOOH_ANSWERS_SYNCED', { count: Object.keys(merged).length });
        });
      });
      return;
    }

    if (data.type === 'HAMZOOH_RESUME_RUN') {
      chrome.runtime.sendMessage({ type: 'HAMZOOH_RESUME_RUN' }, (result) => {
        reply('HAMZOOH_RESUME_RESULT', {
          ok: Boolean(result?.ok),
          error: chrome.runtime.lastError?.message || result?.error || '',
          tabId: result?.tabId || null,
          runId: result?.runId || '',
        });
      });
      return;
    }

    if (data.type === 'HAMZOOH_GET_RUN') {
      chrome.runtime.sendMessage({ type: 'HAMZOOH_GET_RUN', runId: data.runId || '' }, (result) => {
        reply('HAMZOOH_RUN_LOG', { run: result?.run || null });
      });
      return;
    }

    if (data.type === 'HAMZOOH_LIST_RUNS') {
      chrome.runtime.sendMessage({ type: 'HAMZOOH_LIST_RUNS' }, (result) => {
        reply('HAMZOOH_RUN_LIST', { runs: result?.runs || [] });
      });
      return;
    }

    if (data.type === 'HAMZOOH_START_APPLY') {
      try { chrome.storage.local.set({ hamzoohTrainMode: data.trainMode === true }); } catch {}
      chrome.runtime.sendMessage({
        type: 'HAMZOOH_OPEN_JOB',
        requestId: data.requestId || '',
        url: data.url,
        dryRun: data.dryRun === true,
        force: data.force === true,
        trainMode: data.trainMode === true,
        profile: data.profile || {},
        answers: data.answers || {},
        resumeBase64: data.resumeBase64 || '',
        resumeName: data.resumeName || 'hamzooh-resume.pdf',
        resumeText: data.resumeText || '',
        jobTitle: data.jobTitle || '',
        company: data.company || '',
        autoSubmit: data.trainMode ? false : data.autoSubmit === true,
      }, (result) => {
        const error = chrome.runtime.lastError?.message || result?.error || '';
        reply('HAMZOOH_APPLY_READY', {
          requestId: data.requestId || '',
          ok: Boolean(result?.ok) && !error,
          error,
          url: result?.url || '',
          runId: result?.runId || '',
        });
      });
    }
  });
})();
