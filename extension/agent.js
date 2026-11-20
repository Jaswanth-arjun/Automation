/**
 * Hamzooh Phase 2 — AI fallback agent loop.
 *
 * Loaded before filler.js. The deterministic filler calls this module when it
 * stops making progress or lands on an unrecognised page. The agent OBSERVES a
 * compact snapshot, DECIDES one action through /api/agent/next-action, ACTs via
 * the handlers supplied by filler.js, and VERIFYs the resulting snapshot diff.
 *
 * The model never receives credentials and cannot bypass CAPTCHA/OTP/MFA/login.
 */
(function () {
  'use strict';
  if (window.__HAMZOOH_AGENT__) return;
  window.__HAMZOOH_AGENT__ = true;

  const MAX_AGENT_STEPS = Number(window.__HAMZOOH_AGENT_MAX_STEPS__ || 12);
  const SENSITIVE_RE = /captcha|turnstile|hcaptcha|verification code|one.?time|otp|mfa|two.?factor|sign in|log in|login|password|create an account/i;

  function isVisible(el) {
    try {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 1 && rect.height > 1 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05;
    } catch { return false; }
  }

  function deepQuery(selector) {
    const out = [];
    const visit = (root) => {
      if (!root?.querySelectorAll) return;
      try { out.push(...root.querySelectorAll(selector)); } catch { return; }
      try {
        root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) visit(el.shadowRoot); });
      } catch {}
    };
    visit(document);
    return out;
  }

  function labelFor(el) {
    try {
      const labelled = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      return String(labelled?.innerText || el.closest('label')?.innerText
        || el.getAttribute('aria-label') || el.getAttribute('placeholder')
        || el.getAttribute('title') || el.name || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    } catch { return ''; }
  }

  const elements = new Map();

  function observe() {
    elements.clear();
    const nodes = deepQuery('input, select, textarea, button, a[href], [role="button"], [contenteditable="true"], [role="combobox"], [role="checkbox"], [role="radio"], [role="option"], [role="listitem"], li, [class*="resume"], [class*="document"]');
    const list = [];
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const type = String(el.getAttribute('type') || '').toLowerCase();
      if (['hidden'].includes(type)) continue;
      const id = list.length + 1;
      elements.set(id, el);
      try { el.setAttribute('data-hz-id', String(id)); } catch {}
      const rect = el.getBoundingClientRect();
      list.push({
        id,
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        type: type || el.tagName.toLowerCase(),
        text: String(el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 140),
        label: labelFor(el),
        placeholder: String(el.getAttribute('placeholder') || '').slice(0, 140),
        value: String(el.value ?? '').slice(0, 200),
        options: el.tagName === 'SELECT'
          ? [...el.options].slice(0, 30).map((o) => ({ text: o.text.trim(), value: o.value }))
          : [],
        required: el.required === true || el.getAttribute('aria-required') === 'true',
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        checked: el.checked === true || el.getAttribute('aria-checked') === 'true',
        rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        inViewport: rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0,
      });
    }
    const errors = deepQuery('[role="alert"], [aria-invalid="true"], .error, [class*="error"]')
      .filter(isVisible)
      .map((el) => String(el.innerText || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean).slice(0, 12);
    const headings = deepQuery('h1, h2, h3, [role="heading"]')
      .filter(isVisible)
      .map((el) => String(el.innerText || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean).slice(0, 14);
    return {
      url: location.href,
      title: document.title,
      frameUrl: location.href,
      headings,
      errors,
      elements: list,
      text: String(document.body?.innerText || '').slice(0, 4000),
    };
  }

  function snapshotSignature(snapshot) {
    return JSON.stringify(snapshot.elements.map((el) => [el.id, el.type, el.value, el.checked, el.required, el.disabled]));
  }

  async function proxy(path, body) {
    try {
      return await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'HAMZOOH_PROXY_FETCH', path, method: 'POST', body }, (response) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(response || null);
        });
      });
    } catch { return null; }
  }

  async function decide(snapshot, ctx) {
    const response = await proxy('/api/agent/next-action', {
      snapshot: {
        url: snapshot.url,
        title: snapshot.title,
        headings: snapshot.headings,
        errors: snapshot.errors,
        elements: snapshot.elements,
      },
      profile: ctx.profile || {},
      answers: ctx.answers || {},
      job: { title: ctx.pending?.jobTitle || '', company: ctx.pending?.company || '', url: ctx.pending?.url || '' },
      history: ctx.history || [],
      reason: ctx.reason || '',
    });
    if (!response?.ok || !response.data?.ok || !response.data?.action) return null;
    return response.data.action;
  }

  function validate(action, snapshot) {
    if (!action || typeof action !== 'object') return 'Malformed action.';
    if (action.id != null && !elements.has(Number(action.id))) return `Element ${action.id} is no longer on the page.`;
    if (SENSITIVE_RE.test(`${action.reason || ''} ${action.question || ''}`)) return 'Sensitive step — needs the user.';
    return '';
  }

  async function act(action, handlers) {
    const id = Number(action.id);
    const el = elements.get(id);
    switch (action.action) {
      case 'click':
        if (!el) return false;
        await handlers.click(el);
        return true;
      case 'fill':
        if (!el) return false;
        return await handlers.fill(el, String(action.value ?? ''));
      case 'select':
        if (!el) return false;
        return await handlers.select(el, String(action.option ?? ''));
      case 'check':
        if (!el) return false;
        return await handlers.check(el, action.value !== false);
      case 'upload_resume':
        return await handlers.uploadResume(el || null);
      case 'press_key':
        await handlers.pressKey(String(action.key || 'Enter'));
        return true;
      case 'scroll':
        await handlers.scroll(String(action.direction || 'down'));
        return true;
      case 'wait':
        await handlers.wait(Math.min(5000, Math.max(200, Number(action.ms) || 800)));
        return true;
      case 'ask_user':
        await handlers.finish(`🤔 The AI agent needs your input: ${action.question || 'an unknown screening answer'}`, {
          status: 'needs_attention', reasonCode: 'MISSING_ANSWER', question: action.question || '', fieldId: id || null,
        });
        return 'terminal';
      case 'need_user':
        await handlers.finish(`⏸ The AI agent paused: ${action.reason || 'user action required'}`, {
          status: 'needs_attention', reasonCode: action.reasonCode || 'NEEDS_USER_GENERIC', reason: action.reason || '',
        });
        return 'terminal';
      case 'done':
        await handlers.finish('✅ The AI agent marked this application complete.', {
          status: action.status === 'submitted' ? 'submitted' : 'needs_attention',
          reasonCode: action.status === 'submitted' ? 'SUBMITTED' : 'REVIEW_READY',
        });
        return 'terminal';
      default:
        return false;
    }
  }

  async function run(ctx, handlers) {
    const history = [];
    const failures = new Map();
    for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
      const before = observe();
      handlers.log('agent_observe', { step, url: before.url, elements: before.elements.length, errors: before.errors }, `Agent observe #${step + 1}: ${before.elements.length} elements`);
      const action = await decide(before, { ...ctx, history, reason: ctx.reason || '' });
      if (!action) {
        handlers.log('agent_unavailable', { step }, 'Agent endpoint unavailable');
        return false;
      }
      const invalid = validate(action, before);
      if (invalid) {
        handlers.log('agent_invalid', { step, action, invalid }, `Agent action rejected: ${invalid}`);
        history.push({ step, action, result: invalid });
        continue;
      }
      const signature = `${action.action}:${action.id ?? ''}:${action.value ?? ''}`;
      const priorFailures = failures.get(signature) || 0;
      if (priorFailures >= 2) {
        await handlers.finish('⚠️ The AI agent repeated the same failing action twice. Manual review is required.', {
          status: 'needs_attention', reasonCode: 'AGENT_NO_PROGRESS',
        });
        return 'terminal';
      }
      const result = await act(action, handlers);
      if (result === 'terminal') return true;
      await handlers.wait(900);
      const after = observe();
      const changed = snapshotSignature(before) !== snapshotSignature(after) || before.url !== after.url;
      if (result === false || !changed) {
        failures.set(signature, priorFailures + 1);
        history.push({ step, action, result: 'failed', retryHint: `Failed ${priorFailures + 1} time(s). Try a different action.` });
      } else {
        failures.delete(signature);
        history.push({ step, action, result: 'ok' });
      }
      handlers.log('agent_action', { step, action, changed, result }, `Agent action ${action.action}: changed=${changed}`);
      if (after.url !== before.url) return true; // page moved; deterministic filler resumes
    }
    return false;
  }

  window.__HAMZOOH_AGENT_API__ = { observe, decide, act, run };
})();
