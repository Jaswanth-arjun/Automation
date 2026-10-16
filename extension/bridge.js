(function () {
  if (window.__HAMZO_BRIDGE_LOADED__) {
    try { reply('HAMZO_PONG'); } catch {}
    return;
  }
  window.__HAMZO_BRIDGE_LOADED__ = true;

  try {
    if (document.documentElement) {
      document.documentElement.dataset.hamzoExtension = '1';
    }
  } catch {}

  /**
   * Hamzo Apply — Bridge Content Script
   * Runs on the Hamzo dashboard (localhost:5173) to relay messages
   * between the web app (window.postMessage) and the extension (chrome.runtime).
   */

  function extensionAlive() {
    try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; }
  }

  function reply(type, extra) {
    window.postMessage({ source: 'hamzo-extension', type, ...extra }, '*');
  }

  // Broadcast immediate PONG on load
  reply('HAMZO_PONG');

  // ─── Listen for messages FROM the extension background/content scripts ───
  if (extensionAlive()) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.source !== 'hamzo-extension') return;

      // Relay progress events from filler.js (via background) to dashboard web app
      if (message.type === 'HAMZO_APPLY_PROGRESS') {
        window.postMessage({
          source: 'hamzo-extension',
          type: 'HAMZO_APPLY_PROGRESS',
          step: message.step,
          message: message.message,
          timestamp: message.timestamp,
          status: message.status,
          filledCount: message.filledCount,
          emptyCount: message.emptyCount,
        }, '*');
      }

      // Relay completion events
      if (message.type === 'HAMZO_APPLY_COMPLETE') {
        window.postMessage({
          source: 'hamzo-extension',
          type: 'HAMZO_APPLY_COMPLETE',
          status: message.status,
          message: message.message,
          filledCount: message.filledCount,
          emptyCount: message.emptyCount,
        }, '*');
      }
    });
  }

  // ─── Listen for messages FROM the web app (postMessage) ───
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'hamzo-app') return;
    const data = event.data;

    if (data.type === 'HAMZO_PING') {
      reply('HAMZO_PONG');
      return;
    }

    if (!extensionAlive()) {
      if (data.type === 'HAMZO_START_APPLY') reply('HAMZO_APPLY_READY', { ok: false, error: 'Reload Hamzo Apply, then refresh this Resume page.' });
      return;
    }

    if (data.type === 'HAMZO_SAVE_PROFILE') {
      chrome.storage.local.set({
        profile: data.profile || {},
        answers: data.answers || {},
      }, () => reply('HAMZO_SAVED'));
      return;
    }

    if (data.type === 'HAMZO_GET_ANSWERS') {
      chrome.storage.local.get(['answers'], (stored) => {
        reply('HAMZO_ANSWERS', { answers: stored.answers || {} });
      });
      return;
    }

    // Sync answers from server vault into extension storage
    if (data.type === 'HAMZO_SYNC_ANSWERS') {
      const serverAnswers = data.answers || {};
      chrome.storage.local.get(['answers'], (stored) => {
        const merged = { ...(stored.answers || {}), ...serverAnswers };
        chrome.storage.local.set({ answers: merged }, () => {
          reply('HAMZO_ANSWERS_SYNCED', { count: Object.keys(merged).length });
        });
      });
      return;
    }

    // Set auto-submit preference
    if (data.type === 'HAMZO_SET_AUTO_SUBMIT') {
      chrome.storage.local.set({ autoSubmit: data.enabled || false }, () => {
        reply('HAMZO_AUTO_SUBMIT_SET', { enabled: data.enabled });
      });
      return;
    }

    if (data.type === 'HAMZO_START_APPLY') {
      chrome.runtime.sendMessage({
        type: 'HAMZO_OPEN_JOB',
        url: data.url,
        profile: data.profile || {},
        answers: data.answers || {},
        resumeBase64: data.resumeBase64 || '',
        resumeName: data.resumeName || 'hamzo-resume.pdf',
        jobTitle: data.jobTitle || '',
        company: data.company || '',
        autoSubmit: data.autoSubmit || false,
      }, (result) => {
        const error = chrome.runtime.lastError?.message || result?.error || '';
        reply('HAMZO_APPLY_READY', { ok: Boolean(result?.ok) && !error, error, url: result?.url || '' });
      });
    }
  });
})();
