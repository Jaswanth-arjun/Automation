import fs from 'fs';

// Blueprint-based application engine.
//
// "Train" walks a job application once and records a semantic playbook:
//   - the ordered steps (Apply -> Next -> Review -> Submit)
//   - the form fields on each step, each mapped to a DATA KEY (firstName,
//     email, workAuthorization, ...) rather than a site-specific CSS selector.
//
// "Replay" opens any similar job link and follows that playbook, filling the
// current user's profile / vault values into the matching fields. Because it
// matches fields by their visible label (not brittle class names), it works on
// other postings on the same ATS without any manual help.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'D:\\temp\\opencode\\cfd\\chrome\\win64-158.0.8127.36\\chrome-win64\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

function findChromePath() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  return undefined;
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, '');
}

export function guessAts(url) {
  const h = String(url || '').toLowerCase();
  if (h.includes('greenhouse')) return 'greenhouse';
  if (h.includes('lever.co')) return 'lever';
  if (h.includes('ashbyhq')) return 'ashby';
  if (h.includes('myworkdayjobs') || h.includes('workday')) return 'workday';
  if (h.includes('workable')) return 'workable';
  if (h.includes('icims')) return 'icims';
  if (h.includes('taleo')) return 'taleo';
  if (h.includes('eightfold')) return 'eightfold';
  if (h.includes('linkedin.com')) return 'linkedin';
  return 'generic';
}

// Map a visible field label to a canonical data key. This is heuristically
// general across ATS platforms; unknown labels fall back to vault-by-question.
export function inferDataKey(label) {
  const l = norm(label);
  if (!l) return '';
  // Sensitive EEO / personal questions are never auto-answered.
  if (/\bgender\b|hispanic|latino|veteran|disabilit|ethnic|\brace\b|religion|marital|sexual orientation|date of birth|dob\b|age\b|accommodation|adjustment/i.test(l)) return '__skip__';

  const rules = [
    ['workAuthorization', /sponsor|visa|work authorization|authorized to work|right to work|legally authorized|employment restrictions|non compete/],
    ['firstName', /first name|given name|fname|first$/],
    ['lastName', /last name|surname|family name|lname|last$/],
    ['fullName', /full name|your name|applicant name|candidate name|^name$|prefer us to use|preferred name/],
    ['currentLocation', /current location|where are you (currently )?(located|based)|current city/],
    ['currentCompany', /current company|current employer|where do you (currently )?work/],
    ['email', /e mail|email address|^email$/],
    ['phone', /phone|mobile|contact number|telephone|cell/],
    ['linkedin', /linkedin/],
    ['github', /github|portfolio|personal website|website url/],
    ['country', /country of (residence|citizenship)|which you are located|current country|^country/],
    ['city', /\bcity\b|current city|located in|city of residence/],
    ['state', /^state|province|region/],
    ['zip', /zip|postal code|postcode/],
    ['experienceYears', /years of experience|total experience|experience in years/],
    ['salary', /salary|compensation|expected pay|desired pay/],
    ['startDate', /start date|available date|earliest start|notice period/],
    ['referral', /referral|referred by|how did you hear/],
  ];
  for (const [key, re] of rules) if (re.test(l)) return key;
  return '';
}

function valueFor(dataKey, ctx) {
  if (!dataKey) return '';
  const p = ctx.profile || {};
  const a = ctx.answers || {};
  const direct = {
    firstName: p.firstName || (p.fullName || '').split(/\s+/)[0],
    lastName: p.lastName || (p.fullName || '').split(/\s+/).slice(-1)[0],
    fullName: p.fullName,
    currentLocation: p.location || p.city || '',
    currentCompany: p.company || p.currentCompany || (Array.isArray(p.experience) ? p.experience[0]?.company : '') || '',
    email: p.email,
    phone: p.phone,
    linkedin: p.linkedin || p.links?.linkedin,
    github: p.github || p.links?.github || p.website,
    city: p.city || (p.location || '').split(',')[0],
    state: p.state,
    country: p.country || (p.location ? (p.location.split(',').pop() || '').trim() : ''),
    zip: p.zip,
    experienceYears: p.experienceYears || p.yearsOfExperience,
    workAuthorization: a.workAuthorization || a.visa || p.workAuthorization,
    salary: a.salary || p.salary,
    startDate: a.startDate || p.startDate,
    referral: a.referral,
  };
  if (dataKey in direct && direct[dataKey] !== undefined) return String(direct[dataKey] ?? '');
  // Vault answer keyed by the exact normalized question.
  if (a[dataKey] !== undefined) return String(a[dataKey]);
  return '';
}

function matchVaultAnswer(label, answers) {
  const l = norm(label);
  if (!l || !answers) return '';
  const keys = Object.keys(answers);
  if (keys.includes(label)) return String(answers[label]);
  const direct = keys.find((k) => norm(k) === l);
  if (direct) return String(answers[direct]);
  const lWords = l.split(' ').filter((w) => w.length > 2);
  let best = '';
  let bestScore = 0;
  for (const k of keys) {
    const kNorm = norm(k);
    if (kNorm.length > 6 && (l.includes(kNorm) || kNorm.includes(l))) return String(answers[k]);
    const kWords = kNorm.split(' ').filter((w) => w.length > 2);
    const overlap = lWords.filter((w) => kWords.includes(w)).length;
    const score = overlap / Math.max(1, Math.min(lWords.length, kWords.length));
    if (overlap > 0 && score > bestScore) { bestScore = score; best = String(answers[k]); }
  }
  return best;
}

export class BlueprintEngine {
  constructor({ puppeteer, profile = {}, answers = {}, resumePath = '', onEvent = () => {}, headless = true, maxSteps = 14 } = {}) {
    this.puppeteer = puppeteer;
    this.profile = profile;
    this.answers = answers;
    this.resumePath = resumePath;
    this.onEvent = onEvent;
    this.headless = headless;
    this.maxSteps = maxSteps;
    this.browser = null;
    this.page = null;
  }

  event(step, message, data = {}) {
    try { this.onEvent({ step, message, data, t: Date.now() }); } catch {}
  }

  async init() {
    const chrome = findChromePath();
    if (!chrome) throw new Error('Chrome executable not found.');
    this.browser = await this.puppeteer.launch({
      executablePath: chrome,
      headless: this.headless,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--window-size=1440,900'],
      defaultViewport: { width: 1280, height: 900 },
      protocolTimeout: 120_000,
    });
    const pages = await this.browser.pages();
    this.page = pages[0] || (await this.browser.newPage());
    this.event('browser_ready', 'Browser ready.');
  }

  async close() {
    try { if (this.browser) await this.browser.close(); } catch {}
  }

  async goto(url) {
    this.event('navigating', `Opening ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sleep(2500);
  }

  async eachFrame(fn) {
    const out = [];
    for (const frame of this.page.frames()) {
      try { out.push(await frame.evaluate(fn)); } catch { /* detached */ }
    }
    return out;
  }

  // Enumerate every input/select/textarea in every frame with rich metadata.
  // `idx` is the index within that frame's full field list (stable within a step).
  async enumerateFields() {
    const fields = [];
    const frames = this.page.frames();
    for (let fi = 0; fi < frames.length; fi += 1) {
      const frame = frames[fi];
      let list;
      try {
        list = await frame.evaluate(() => {
          const labelFor = (el) => {
            const id = el.id;
            let lab = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
            if (!lab) lab = el.closest('label');
            if (!lab) {
              const p = el.parentElement;
              if (p && /label|field|form[- ]?group|question/i.test(p.className || '')) lab = p;
            }
            let text = (lab?.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '').trim();
            if (!text) {
              const fs = el.closest('fieldset');
              text = (fs?.querySelector('legend')?.innerText || '').trim();
            }
            const elType = (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase();
            if (!text && (elType === 'radio' || elType === 'checkbox')) {
              // Option text is a poor label; walk up to the enclosing question.
              let node = el.parentElement;
              for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
                const t = (node.innerText || '').replace(/\s+/g, ' ').trim();
                if (t.includes('?') && t.length < 320) { text = t.slice(0, t.indexOf('?') + 1); break; }
              }
            }
            if (!text && el.parentElement) {
              const pt = (el.parentElement.innerText || '').trim();
              if (pt.length > 2 && pt.length < 140) text = pt;
            }
            return text;
          };
          const els = [...document.querySelectorAll('input, select, textarea')];
          return els.map((el, idx) => {
            const rect = el.getBoundingClientRect();
            const type = (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase();
            const options = el.tagName === 'SELECT'
              ? [...el.options].map((o) => ({ text: (o.text || '').trim(), value: o.value }))
              : [];
            return {
              idx,
              tag: el.tagName.toLowerCase(),
              type,
              name: el.getAttribute('name') || '',
              id: el.id || '',
              label: labelFor(el),
              placeholder: el.getAttribute('placeholder') || '',
              required: !!el.required || el.getAttribute('aria-required') === 'true',
              visible: !!(rect.width || rect.height) && type !== 'hidden',
              value: type === 'checkbox' || type === 'radio' ? (el.checked ? 'yes' : 'no') : (el.value || ''),
              options,
            };
          });
        });
      } catch { continue; }
      for (const f of list || []) fields.push({ ...f, frameIdx: fi });
    }
    return fields;
  }

  async fieldHandle(field) {
    const frame = this.page.frames()[field.frameIdx];
    if (!frame) return null;
    try {
      const handles = await frame.$$('input, select, textarea');
      return handles[field.idx] || null;
    } catch { return null; }
  }

  async clickByText(texts, { exact = false } = {}) {
    const wanted = (Array.isArray(texts) ? texts : [texts]).map(norm);
    for (const frame of this.page.frames()) {
      let handles;
      try {
        handles = await frame.$$('button, a, [role="button"], input[type="submit"], input[type="button"]');
      } catch { continue; }
      for (const h of handles) {
        try {
          const info = await h.evaluate((el) => ({
            text: norm(el.innerText || el.value || el.getAttribute('aria-label') || ''),
            visible: !!(el.getBoundingClientRect().width || el.getBoundingClientRect().height),
          }));
          if (!info.visible) continue;
          const hit = exact ? wanted.includes(info.text) : wanted.some((w) => info.text.includes(w));
          if (hit) {
            await h.click();
            return info.text;
          }
        } catch { /* stale */ }
      }
    }
    return null;
  }

  async clickApply() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const hit = await this.clickByText(['apply now', 'easy apply', 'apply', 'apply for this job', 'apply to this job']);
      if (hit) return hit;
      await sleep(1200);
    }
    return null;
  }

  async fillField(field, value, dataKey) {
    const handle = await this.fieldHandle(field);
    if (!handle) return false;
    try {
      if (field.type === 'file') {
        if (this.resumePath && fs.existsSync(this.resumePath)) {
          await handle.uploadFile(this.resumePath);
          return true;
        }
        return false;
      }
      if (field.tag === 'select') {
        const v = String(value || '').trim().toLowerCase();
        if (!v) return false;
        let opt = field.options.find((o) => norm(o.text) === norm(v) || norm(o.value) === norm(v));
        if (!opt) opt = field.options.find((o) => norm(o.text).includes(v) || v.includes(norm(o.text)));
        if (!opt) return false;
        await handle.select(opt.value);
        return true;
      }
      if (field.type === 'radio' || field.type === 'checkbox') {
        const yes = /yes|true|1|agree|authorized/i.test(String(value || ''));
        const checked = await handle.evaluate((el) => !!el.checked);
        if (yes !== checked) await handle.click();
        return true;
      }
      if (!value) return false;
      await handle.click({ clickCount: 3 });
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('KeyA');
      await this.page.keyboard.up('Control');
      await this.page.keyboard.type(String(value), { delay: 5 });
      return true;
    } catch { return false; }
  }

  // ---- TRAIN -------------------------------------------------------------
  async train(url) {
    if (!this.browser) await this.init();
    await this.goto(url);
    const steps = [];
    const applied = await this.clickApply();
    this.event('train_step', applied ? `Clicked ${applied}` : 'No Apply button found; inspecting page.');
    await sleep(1800);

    for (let step = 1; step <= this.maxSteps; step += 1) {
      const fields = (await this.enumerateFields()).filter((f) => f.visible && !/submit|button|file/i.test(f.type));
      const learned = fields.map((f) => {
        const key = inferDataKey(f.label);
        return {
          label: f.label || f.placeholder || f.name || `${f.tag}-${f.idx}`,
          type: f.type,
          tag: f.tag,
          dataKey: key === '__skip__' ? '' : key,
          skip: key === '__skip__',
          required: f.required,
          options: f.options.length ? f.options.map((o) => o.text).slice(0, 20) : [],
        };
      });

      // Greenhouse-style forms render a question followed by a generic
      // "Select..." control. Carry the question label down to that control so
      // replay knows which answer belongs to it.
      for (let i = 1; i < learned.length; i += 1) {
        const cur = learned[i];
        const prev = learned[i - 1];
        if (!/^(select|choose|input[- ]?\d*|none)$/i.test(norm(cur.label))) continue;
        if (!prev || !prev.label || prev.label.length < 8) continue;
        if (/^(select|choose|input[- ]?\d*)/i.test(norm(prev.label))) continue;
        cur.altLabel = cur.label;
        cur.label = prev.label;
        cur.dataKey = prev.dataKey;
        cur.skip = prev.skip;
        cur.inherited = true;
      }

      const buttonTexts = await this.eachFrame(() =>
        [...document.querySelectorAll('button, input[type="submit"], [role="button"]')]
          .filter((el) => (el.getBoundingClientRect().width || el.getBoundingClientRect().height))
          .map((el) => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim())
          .filter(Boolean));
      const flat = [...new Set(buttonTexts.flat())].slice(0, 40);
      const normalized = flat.map(norm);
      const isFinal = normalized.some((t) => /submit application|submit your application|review application|review your application|finish|done/.test(t));

      steps.push({ index: step, fields: learned, buttons: flat, isFinal });

      this.event('train_step', `Step ${step}: learned ${learned.length} field(s), ${flat.length} button(s)${isFinal ? ' — final step' : ''}`);

      if (isFinal) break;
      const next = await this.clickByText(['next', 'continue', 'review', 'save and continue']);
      if (!next) {
        this.event('train_step', `No advance button found at step ${step}; stopping.`);
        break;
      }
      await sleep(2000);
    }

    const domain = (() => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } })();
    const blueprint = {
      domain,
      ats: guessAts(url),
      portalName: `${domain || guessAts(url)} Flow`,
      learnUrl: url,
      steps,
      fieldCount: steps.reduce((n, s) => n + s.fields.length, 0),
      learnedAt: new Date().toISOString(),
    };
    this.event('train_complete', `Blueprint learned: ${blueprint.fieldCount} field(s) across ${steps.length} step(s).`);
    return { status: 'trained', blueprint, domain };
  }

  // ---- REPLAY ------------------------------------------------------------
  async replay(url, blueprint, { autoSubmit = false } = {}) {
    if (!this.browser) await this.init();
    await this.goto(url);
    const applied = await this.clickApply();
    this.event('replay_step', applied ? `Clicked ${applied}` : 'Assuming form is already open.');
    await sleep(1500);

    const filledFields = [];
    const unfilled = [];
    let lastStep = 0;

    for (const step of blueprint.steps || []) {
      lastStep = step.index;
      const available = (await this.enumerateFields()).filter((f) => f.visible && !/submit|button/i.test(f.type));
      for (const learned of step.fields || []) {
        if (learned.skip) continue; // sensitive EEO / personal question — never auto-answer
        const labels = [learned.label, learned.altLabel].filter(Boolean).map(norm).filter((l) => l.length > 2);
        let idx = -1;
        for (const l of labels) {
          idx = available.findIndex((f) => norm(f.label) === l || norm(f.name) === l || norm(f.id) === l);
          if (idx >= 0) break;
        }
        if (idx < 0) {
          for (const l of labels) {
            idx = available.findIndex((f) => norm(f.label).includes(l) || l.includes(norm(f.label)));
            if (idx >= 0) break;
          }
        }
        if (idx < 0) continue;
        const match = available.splice(idx, 1)[0]; // consume so one field is never filled twice
        let value = valueFor(learned.dataKey, { profile: this.profile, answers: this.answers });
        if (!value) value = matchVaultAnswer(learned.label, this.answers);
        if (!value) {
          if (learned.required) unfilled.push(learned.label);
          continue;
        }
        const ok = await this.fillField(match, value, learned.dataKey);
        if (ok) filledFields.push({ label: learned.label, dataKey: learned.dataKey, value: String(value).slice(0, 40) });
        else if (learned.required) unfilled.push(learned.label);
      }
      this.event('replay_step', `Step ${step.index}: filled ${filledFields.length} field(s) so far.`);

      // Upload resume if this step has a file input.
      const fileFields = (await this.enumerateFields()).filter((f) => f.type === 'file' && f.visible);
      for (const ff of fileFields) await this.fillField(ff, '', 'resume');

      if (step.isFinal) break;
      const textToClick = (step.buttons || []).find((t) => /next|continue|review|save and continue/i.test(t))
        || (step.buttons || [])[0];
      const clicked = textToClick ? await this.clickByText([textToClick]) : null;
      if (!clicked) {
        this.event('replay_step', `Could not find advance button at step ${step.index}; stopping at review.`);
        break;
      }
      await sleep(1800);
    }

    // Final review / submit handling.
    let submitted = false;
    if (autoSubmit) {
      const submittedText = await this.clickByText(['submit application', 'submit your application', 'submit', 'finish', 'done']);
      submitted = !!submittedText;
      if (submitted) {
        await sleep(2500);
        this.event('submitted', 'Application submitted.');
        return { status: 'submitted', reasonCode: 'SUBMITTED', message: 'Application submitted successfully.', steps: lastStep, filledFields };
      }
    }

    const confirmation = await this.eachFrame(() => document.body?.innerText?.slice(0, 4000) || '');
    const looksSent = confirmation.some((t) => /application (sent|submitted|received)|thank you for (applying|your application)|we (have|received) your application/i.test(t));
    if (looksSent) {
      this.event('submitted', 'Confirmation detected.');
      return { status: 'submitted', reasonCode: 'SUBMITTED', message: 'Application submitted (confirmation detected).', steps: lastStep, filledFields };
    }

    const extra = unfilled.length ? ` ${unfilled.length} field(s) still need an answer: ${unfilled.slice(0, 5).join(', ')}.` : '';
    this.event('needs_user', `Form filled and paused at review.${extra}`);
    return {
      status: 'needs_user',
      reasonCode: 'REVIEW_READY',
      message: `Application filled automatically — no manual filling was needed.${extra}`,
      steps: lastStep,
      filledFields,
      unfilled,
    };
  }
}

export default BlueprintEngine;
