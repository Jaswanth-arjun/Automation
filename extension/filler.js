(function () {
  if (window.__HAMZO_FILLER_LOADED__) return;
  window.__HAMZO_FILLER_LOADED__ = true;

  /**
   * Hamzo Apply — Extension Content Script (filler.js)
   * Runs on external job application pages to auto-fill forms,
   * detect missing info, ask user via branded overlay, remember answers,
   * and confirm before submission.
   */

  // ─── Field Detection Hints ───
  const FIELD_HINTS = [
  { key: 'email', test: /e-?mail/i },
  { key: 'phone', test: /phone|mobile|tel/i },
  { key: 'firstName', test: /first.?name|given.?name|firstname/i },
  { key: 'lastName', test: /last.?name|surname|family.?name|lastname/i },
  { key: 'fullName', test: /^name$|full.?name|your.?name|legal.?name|candidate.?name/i },
  { key: 'location', test: /city|location|address|country|state|current.?location/i },
  { key: 'linkedin', test: /linkedin/i },
  { key: 'github', test: /github/i },
  { key: 'portfolio', test: /portfolio|website|personal.?url|^url$/i },
  { key: 'projectLink', test: /project.?(link|url)|link.?(to|of).?(project|work|portfolio|github|demo)|share.*link|deployed/i },
  { key: 'university', test: /university|college|school|institute|alma.?mater|institution/i },
  { key: 'gpa', test: /cgpa|gpa|grade.?point/i },
  { key: 'internship', test: /internship|past.?intern|previous.?intern|intern.?experience/i },
  { key: 'degree', test: /degree|qualification|major|course|field.?of.?study|branch/i },
  { key: 'graduation', test: /graduat|class.?of|year.?of|expected/i },
  { key: 'salary', test: /salary|compensation|pay|ctc|expected.?salary/i },
  { key: 'experience_years', test: /years?.?of.?experience|total.?experience/i },
  { key: 'codechef', test: /codechef|code.?chef/i },
  { key: 'codeforces', test: /codeforces|code.?forces/i },
  { key: 'leetcode', test: /leetcode|leet.?code/i },
  { key: 'hackerrank', test: /hackerrank|hacker.?rank/i },
  { key: 'cover_letter', test: /cover.?letter|additional.?info|why.?do.?you.?want|tell.?us.?about/i },
];

// ─── Utility Helpers ───

function extensionAlive() {
  try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; }
}

function labelFor(input) {
  const id = input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
  const wrapping = input.closest('label');
  const aria = input.getAttribute('aria-label') || '';
  const nearby = input.getAttribute('placeholder') || input.name || input.id || '';
  const heading = input.closest('div, li, fieldset')?.querySelector('label, p, span, legend, div')?.innerText || '';
  return [id?.innerText, wrapping?.innerText, aria, nearby, heading].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function questionFor(el) {
  const block = el.closest('fieldset, li, .form-group, [class*="question"], [class*="field"]') || el.parentElement;
  const wider = block?.parentElement;
  const text = [block?.innerText, wider?.innerText, el.getAttribute('aria-label'), labelFor(el)].filter(Boolean).join(' ');
  return text.replace(/\s+/g, ' ').trim().slice(0, 700);
}

function profileValue(profile, key, jobTitle, company) {
  const name = profile.fullName || '';
  const [first, ...rest] = name.split(' ').filter(Boolean);
  const education = profile.education?.[0] || {};
  const internships = profile.experience || profile.internships || [];
  const intern = internships.map((item) => [item.title, item.company, item.dates].filter(Boolean).join(' — ')).filter(Boolean).join('; ');
  const projects = profile.projects || [];
  const projectUrl = projects.map((p) => p.link || p.url).find(Boolean)
    || profile.links?.github || profile.github || profile.links?.portfolio || '';
  // Phone boxes are often split ("+91" prefix + number-only box): digits only,
  // last 10 for the number box so a stored "+919440552825" never overflows it.
  const phoneDigits = String(profile.phone || '').replace(/\D/g, '');
  const map = {
    email: profile.email || '',
    phone: phoneDigits.length > 10 ? phoneDigits.slice(-10) : phoneDigits,
    firstName: first || '',
    lastName: rest.join(' ') || '',
    fullName: name,
    location: profile.location || '',
    linkedin: profile.links?.linkedin || profile.linkedin || '',
    github: profile.links?.github || profile.github || '',
    portfolio: profile.links?.portfolio || '',
    projectLink: projectUrl,
    university: education.school || education.university || '',
    gpa: education.gpa || education.detail || education.score || '',
    internship: intern || '',
    degree: education.degree || '',
    graduation: education.dates || '',
    salary: '',
    experience_years: String(internships.length || '0'),
    codechef: profile.codechef || profile.codechefRating || '',
    codeforces: profile.codeforces || profile.codeforcesRating || '',
    leetcode: profile.leetcode || profile.leetcodeRating || '',
    hackerrank: profile.hackerrank || profile.hackerrankRating || '',
    cover_letter: `I am excited to apply for the ${jobTitle || 'position'} at ${company || 'your company'}. With my background in ${(profile.skills || []).slice(0, 4).join(', ') || 'software development'}, I am confident in my ability to contribute effectively.`,
  };
  return String(map[key] || '').trim();
}

function setNativeValue(input, value) {
  if (input.tagName === 'SELECT') {
    const option = [...input.options].find((item) => item.value === value || item.text.toLowerCase().includes(String(value).toLowerCase()));
    if (option) input.value = option.value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function isPlaceholderValue(input) {
  const type = (input.getAttribute('type') || '').toLowerCase();
  if (input.tagName === 'SELECT') {
    const selected = input.options[input.selectedIndex];
    const text = (selected?.text || input.value || '').trim();
    return !text || /please select|^select$|^-+$|choose/i.test(text);
  }
  if (type === 'radio' || type === 'checkbox') return !input.checked;
  return !String(input.value || '').trim();
}

function optionList(select) {
  return [...select.options].filter((item) => item.value !== '' && !/please select|^select$|^-+$|choose/i.test(item.text.trim()));
}

function matchOption(select, wanted) {
  const wantedText = String(wanted || '').trim().toLowerCase();
  return optionList(select).find((item) => {
    const text = item.text.trim().toLowerCase();
    const value = String(item.value).toLowerCase();
    return text === wantedText || value === wantedText || text.startsWith(wantedText) || wantedText.startsWith(text);
  });
}

function resumeFile(pending, profile) {
  const base64 = pending?.resumeBase64 || profile?.pdfBase64 || profile?.resumeBase64 || '';
  if (!base64) return null;
  let raw = String(base64).trim();
  if (raw.includes(',')) {
    raw = raw.split(',')[1];
  }
  raw = raw.replace(/\s+/g, '');
  if (!raw) return null;
  try {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], pending?.resumeName || 'hamzo-tailored-resume.pdf', { type: 'application/pdf' });
  } catch (err) {
    console.error('Hamzo Apply: Failed to decode resumeBase64:', err);
    return null;
  }
}

function attachResume(input, pending, profile) {
  const file = resumeFile(pending, profile);
  if (!file || !input) return false;
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
  } catch {
    return false;
  }

  // Dispatch events to input and all parent forms/wrappers
  const events = ['focus', 'click', 'input', 'change', 'blur'];
  events.forEach((type) => {
    try {
      input.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    } catch {}
  });

  // Also trigger change event on parent form and wrapper for frameworks (React, Greenhouse, Lever)
  try {
    const parent = input.closest('#resume_wrapper, .field, [class*="resume"], [class*="file"], form') || input.parentElement;
    if (parent) {
      events.forEach((type) => {
        try {
          parent.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
        } catch {}
      });

      // Show attached confirmation badge on the attach button container if available
      const attachBtn = parent.querySelector('button[data-source="attach"], button[data-source="paste"], button, [role="button"]');
      if (attachBtn) {
        const btnContainer = attachBtn.parentElement;
        if (btnContainer && !btnContainer.querySelector('.hamzo-attached-badge')) {
          const badge = document.createElement('div');
          badge.className = 'hamzo-attached-badge';
          badge.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; border-radius: 8px; font-weight: 700; font-size: 13px; margin-top: 6px; font-family: sans-serif;';
          badge.innerHTML = `✓ ${file.name} (Attached by Hamzo AI)`;
          btnContainer.appendChild(badge);
        }
      }
    }
  } catch {}

  return Boolean(input.files && input.files.length);
}

function allFileInputs() {
  const inputs = [...document.querySelectorAll('input[type="file"]')];

  // Also search accessible iframes
  try {
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((frame) => {
      try {
        const frameDoc = frame.contentDocument || frame.contentWindow?.document;
        if (frameDoc) {
          inputs.push(...frameDoc.querySelectorAll('input[type="file"]'));
        }
      } catch {}
    });
  } catch {}

  // Sort inputs so resume inputs come first
  return inputs.sort((a, b) => {
    const aText = `${a.id} ${a.name} ${a.getAttribute('aria-label') || ''} ${labelFor(a)}`.toLowerCase();
    const bText = `${b.id} ${b.name} ${b.getAttribute('aria-label') || ''} ${labelFor(b)}`.toLowerCase();
    const aIsResume = /resume|cv/i.test(aText);
    const bIsResume = /resume|cv/i.test(bText);
    if (aIsResume && !bIsResume) return -1;
    if (!aIsResume && bIsResume) return 1;
    return 0;
  });
}

async function attachGeneratedResume(pending, profile) {
  const file = resumeFile(pending, profile);
  if (!file) return false;

  const clickAttach = () => {
    const nodes = [...document.querySelectorAll('button, a, label, span, [role="button"]')].filter((el) => {
      const text = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      return /^(attach file|upload( file)?|choose file|browse|attach)$/i.test(text) || /attach file/i.test(text);
    });
    nodes.forEach((node) => {
      try { node.click(); } catch {}
    });
  };

  const waitForInputs = async (ms) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const found = allFileInputs();
      if (found.length) return found;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return allFileInputs();
  };

  // Step 1: Try direct attachment to existing file inputs
  let attached = allFileInputs().some((input) => attachResume(input, pending, profile));

  // Step 2: If not attached, click "Attach file" button to unveil hidden inputs, then retry
  if (!attached) {
    clickAttach();
    const discovered = await waitForInputs(1200);
    attached = discovered.some((input) => attachResume(input, pending, profile));
  }

  // Step 3: Drag & drop fallback for dropzone areas
  if (!attached) {
    const zone = [...document.querySelectorAll('div, section, label, form')].find((el) => {
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      return /resume\/?cv|attach file|drop file/i.test(text) && text.length < 150;
    });
    if (zone) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      ['dragenter', 'dragover', 'drop'].forEach((type) => {
        zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
      });
      attached = allFileInputs().some((input) => attachResume(input, pending, profile));
    }
  }

  return attached;
}

// ─── Semantic Question Matching (client-side) ───

const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
  'both', 'either', 'neither', 'each', 'every', 'all', 'any', 'few',
  'more', 'most', 'other', 'some', 'such', 'than', 'too', 'very',
  'just', 'also', 'about', 'if', 'then', 'that', 'this', 'these', 'those',
  'it', 'its', 'my', 'your', 'our', 'their', 'his', 'her', 'what', 'which',
  'who', 'whom', 'how', 'when', 'where', 'why', 'there', 'here', 'up',
  'out', 'down', 'please', 'provide', 'enter', 'specify', 'select',
  'choose', 'answer', 'following', 'question', 'below', 'us', 'we', 'me',
  'i', 'you', 'he', 'she', 'they', 'them',
]);

function normalizeQuestion(raw) {
  const words = String(raw || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(w => w.length > 1 && !FILLER_WORDS.has(w));
  return [...new Set(words)].sort().join(' ');
}

function questionSimilarity(normA, normB) {
  if (!normA || !normB) return 0;
  const setA = new Set(normA.split(' '));
  const setB = new Set(normB.split(' '));
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const word of setA) { if (setB.has(word)) overlap++; }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? overlap / union : 0;
}

function findBestAnswer(question, answers) {
  if (!question || !answers) return null;
  const normalized = normalizeQuestion(question);
  const directKey = question.toLowerCase().trim();

  // Direct match first
  if (answers[directKey]) {
    const val = answers[directKey];
    return typeof val === 'string' ? val : val?.answer || String(val);
  }

  // Semantic match
  let bestAnswer = null;
  let bestScore = 0;
  for (const [key, entry] of Object.entries(answers)) {
    const normKey = normalizeQuestion(key);
    const score = questionSimilarity(normalized, normKey);
    if (score > bestScore && score >= 0.45) {
      bestScore = score;
      bestAnswer = typeof entry === 'string' ? entry : entry?.answer || String(entry);
    }
  }
  return bestAnswer;
}

// ─── Yes/No Question Logic ───

function chooseYesNo(question, profile) {
  const q = String(question || '').toLowerCase();
  const company = String(profile.company || location.hostname.replace(/^www\./, '').split('.')[0] || '').toLowerCase();
  if (/employed by|worked (for|at)|contractor|previously employed|ever been employed/.test(q) && (company && q.includes(company) || /this company|the company/.test(q))) return 'no';
  if (/currently employed|current employer/.test(q) && !/name of/.test(q)) return 'no';
  if (/convicted|felony|criminal/.test(q)) return 'no';
  if (/export control|denied|debarred/.test(q)) return 'no';
  if (/relative work|family member/.test(q)) return 'no';
  if (/require sponsorship|need sponsorship|visa sponsorship/.test(q)) return 'yes';
  if (/authorized to work/.test(q) && /without sponsorship|no sponsorship/.test(q)) return 'no';
  if (/available|onsite|on-site|start|internship|willing to relocate|able to relocate|open to relocation|relocate for this position|move to another location|18 years|over 18|legally eligible|acknowledge|privacy|agree|consent|terms|i understand/.test(q)) return 'yes';
  if (/gender|hispanic|race|ethnicity|veteran|disability|lgbt/.test(q)) return 'decline';
  return '';
}

function applyChoice(input, wanted) {
  if (!wanted) return false;
  if (input.tagName === 'SELECT') {
    const yesNo = wanted === 'yes' || wanted === 'no';
    let option = matchOption(input, wanted === 'yes' ? 'Yes' : wanted === 'no' ? 'No' : wanted === 'decline' ? 'Decline' : wanted);
    if (!option && wanted === 'decline') option = optionList(input).find((item) => /decline|prefer not|do not wish|don't wish/i.test(item.text));
    if (!option && yesNo) {
      option = optionList(input).find((item) => (wanted === 'yes' ? /^(yes|y)\b/i : /^(no|n)\b/i).test(item.text.trim()));
    }
    if (!option) return false;
    input.value = option.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  const type = (input.getAttribute('type') || '').toLowerCase();
  if (type === 'radio') {
    const label = `${labelFor(input)} ${input.value}`.toLowerCase();
    const yes = wanted === 'yes' && /^(yes|y)\b|true|agree/.test(label);
    const no = wanted === 'no' && /^(no|n)\b|false|disagree/.test(label);
    if (yes || no || label.includes(String(wanted).toLowerCase())) {
      input.checked = true;
      input.click();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  if (type === 'checkbox' && (wanted === 'yes' || wanted === 'agree')) {
    if (!input.checked) input.click();
    return true;
  }
  return false;
}

function fillChoices(profile, answers) {
  const controls = [...document.querySelectorAll('select, input[type="radio"], input[type="checkbox"]')];
  const radioNames = new Set();
  controls.forEach((input) => {
    const type = (input.getAttribute('type') || '').toLowerCase();
    const question = questionFor(input);
    const key = question.toLowerCase().slice(0, 180);

    // Check saved answers first (semantic matching)
    const savedAnswer = findBestAnswer(question, answers);
    if (type === 'radio') {
      if (radioNames.has(input.name)) return;
      radioNames.add(input.name);
    }
    if (type === 'checkbox' && /privacy|acknowledge|agree|terms|consent/.test(question.toLowerCase())) {
      applyChoice(input, savedAnswer || 'yes');
      answers[key] = 'yes';
      return;
    }
    const wanted = savedAnswer || chooseYesNo(question, profile);
    if (!wanted) return;
    if (type === 'radio') {
      const group = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(input.name)}"]`)];
      const hit = group.find((item) => applyChoice(item, wanted));
      if (hit) answers[key] = wanted;
      return;
    }
    if (applyChoice(input, wanted)) answers[key] = wanted;
  });
}

// ─── Form Field Collection ───

function collectInputs() {
  return [...document.querySelectorAll('input, textarea, select')].filter((input) => {
    const type = (input.getAttribute('type') || '').toLowerCase();
    if (['hidden', 'password', 'submit', 'button', 'checkbox', 'radio'].includes(type)) return false;
    if (input.disabled || input.getAttribute('aria-hidden') === 'true') return false;
    return true;
  });
}

async function waitForForm() {
  for (let i = 0; i < 25; i += 1) {
    const heading = [...document.querySelectorAll('h1,h2,h3,legend')].find((node) => /apply for this job|application|submit application/i.test(node.innerText || ''));
    if (heading) heading.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: document.body.scrollHeight * 0.55, behavior: 'instant' });
    const inputs = collectInputs().filter((input) => (input.getAttribute('type') || '') !== 'file');
    if (inputs.length >= 3) return inputs;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return collectInputs();
}

// ─── CAPTCHA / MFA Detection ───

function detectCaptchaOrMFA() {
  // Check for CAPTCHA iframes
  const captchaIframes = [...document.querySelectorAll('iframe')].filter((iframe) => {
    const src = (iframe.src || '').toLowerCase();
    return /recaptcha|hcaptcha|captcha|turnstile|challenge/i.test(src);
  });
  if (captchaIframes.length > 0) return 'captcha';

  // Check for CAPTCHA divs
  const captchaDivs = [...document.querySelectorAll('[class*="captcha"], [id*="captcha"], [class*="recaptcha"], [id*="recaptcha"], .g-recaptcha, .h-captcha')];
  if (captchaDivs.length > 0) return 'captcha';

  // Check for MFA/OTP fields
  const mfaInputs = [...document.querySelectorAll('input')].filter((input) => {
    const label = labelFor(input).toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    return /otp|verification code|two.?factor|2fa|mfa|authenticator|security code/i.test(label + ' ' + placeholder);
  });
  if (mfaInputs.length > 0) return 'mfa';

  return null;
}

// ─── Hamzo Pop-up Overlay System ───

function removeHamzoOverlays() {
  document.querySelectorAll('.hamzo-overlay-container').forEach((el) => el.remove());
}

function createOverlayContainer() {
  const container = document.createElement('div');
  container.className = 'hamzo-overlay-container';
  container.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;width:360px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;animation:hamzoSlideIn .3s ease-out';
  return container;
}

function injectHamzoStyles() {
  if (document.getElementById('hamzo-overlay-styles')) return;
  const style = document.createElement('style');
  style.id = 'hamzo-overlay-styles';
  style.textContent = `
    @keyframes hamzoSlideIn { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    @keyframes hamzoPulse { 0%, 100% { box-shadow: 0 8px 32px rgba(0,150,136,0.25); } 50% { box-shadow: 0 8px 40px rgba(0,150,136,0.4); } }
    .hamzo-card { background:#fff; border-radius:16px; box-shadow:0 12px 40px rgba(0,0,0,.18); overflow:hidden; border:1px solid #e0e0e0; }
    .hamzo-header { background:linear-gradient(135deg,#00796b,#009688); padding:16px 18px; display:flex; align-items:center; gap:10px; color:#fff; }
    .hamzo-logo { width:32px; height:32px; border-radius:8px; background:rgba(255,255,255,.2); display:flex; align-items:center; justify-content:center; font-size:18px; }
    .hamzo-title { font-weight:800; font-size:14px; }
    .hamzo-subtitle { font-size:11px; opacity:.85; }
    .hamzo-body { padding:16px 18px; }
    .hamzo-question { font-size:13px; color:#333; font-weight:600; line-height:1.5; margin-bottom:12px; }
    .hamzo-input { width:100%; padding:10px 14px; border:1.5px solid #d9d9d2; border-radius:10px; font-size:14px; outline:none; box-sizing:border-box; transition:border-color .2s; }
    .hamzo-input:focus { border-color:#009688; }
    .hamzo-remember { display:flex; align-items:center; gap:8px; margin-top:10px; font-size:12px; color:#555; cursor:pointer; }
    .hamzo-remember input { width:16px; height:16px; accent-color:#009688; cursor:pointer; }
    .hamzo-footer { padding:12px 18px; border-top:1px solid #f0f0f0; display:flex; gap:8px; }
    .hamzo-btn { flex:1; padding:10px; border-radius:10px; font-weight:700; font-size:13px; cursor:pointer; border:none; transition:all .2s; }
    .hamzo-btn-primary { background:#009688; color:#fff; }
    .hamzo-btn-primary:hover { background:#00796b; }
    .hamzo-btn-skip { background:#f5f5f5; color:#666; }
    .hamzo-btn-skip:hover { background:#eee; }
    .hamzo-confirm-btn { padding:12px 20px; border-radius:10px; font-weight:700; font-size:13px; cursor:pointer; border:none; transition:all .2s; }
    .hamzo-submit-btn { background:#009688; color:#fff; }
    .hamzo-submit-btn:hover { background:#00796b; }
    .hamzo-review-btn { background:#fff; color:#009688; border:1.5px solid #009688; }
    .hamzo-review-btn:hover { background:#e0f2f1; }
    .hamzo-cancel-btn { background:#f5f5f5; color:#666; }
    .hamzo-cancel-btn:hover { background:#eee; }
    .hamzo-progress { font-size:11px; color:#009688; font-weight:600; padding:8px 18px; background:#e0f2f1; }
    .hamzo-captcha-msg { font-size:13px; color:#f57c00; font-weight:600; line-height:1.5; margin-bottom:12px; }
  `;
  document.head.appendChild(style);
}

/**
 * Ask the user for missing information via a branded Hamzo overlay.
 * Returns { answer, remember } or null if skipped.
 */
function askHamzoQuestion(question, fieldIndex, totalFields) {
  return new Promise((resolve) => {
    injectHamzoStyles();
    removeHamzoOverlays();

    const container = createOverlayContainer();
    container.innerHTML = `
      <div class="hamzo-card" style="animation:hamzoPulse 2s ease-in-out infinite">
        <div class="hamzo-progress">${fieldIndex + 1} of ${totalFields} missing fields</div>
        <div class="hamzo-header">
          <div class="hamzo-logo">🤖</div>
          <div>
            <div class="hamzo-title">Hamzo needs one detail</div>
            <div class="hamzo-subtitle">This info is required by the application</div>
          </div>
        </div>
        <div class="hamzo-body">
          <div class="hamzo-question">"${question.length > 120 ? question.slice(0, 117) + '...' : question}"</div>
          <input class="hamzo-input" id="hamzo-answer-input" type="text" placeholder="Your answer…" autofocus />
          <label class="hamzo-remember">
            <input type="checkbox" id="hamzo-remember-check" checked />
            <span>💾 Remember this answer for future applications</span>
          </label>
        </div>
        <div class="hamzo-footer">
          <button class="hamzo-btn hamzo-btn-skip" id="hamzo-skip-btn">Skip</button>
          <button class="hamzo-btn hamzo-btn-primary" id="hamzo-save-btn">Save & Continue</button>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    const input = container.querySelector('#hamzo-answer-input');
    const saveBtn = container.querySelector('#hamzo-save-btn');
    const skipBtn = container.querySelector('#hamzo-skip-btn');
    const rememberCheck = container.querySelector('#hamzo-remember-check');

    // Focus the input after a small delay
    setTimeout(() => input?.focus(), 100);

    saveBtn.addEventListener('click', () => {
      const answer = input.value.trim();
      if (!answer) { input.focus(); return; }
      const remember = rememberCheck.checked;
      container.remove();
      resolve({ answer, remember });
    });

    skipBtn.addEventListener('click', () => {
      container.remove();
      resolve(null);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveBtn.click();
      }
    });
  });
}

/**
 * Show CAPTCHA/MFA pause overlay.
 * Returns a promise that resolves when user clicks Continue.
 */
function showCaptchaPauseOverlay(type) {
  return new Promise((resolve) => {
    injectHamzoStyles();
    removeHamzoOverlays();

    const container = createOverlayContainer();
    const message = type === 'captcha'
      ? 'A CAPTCHA was detected on this page. Please complete it, then click Continue.'
      : 'A verification/MFA step was detected. Please complete it, then click Continue.';

    container.innerHTML = `
      <div class="hamzo-card">
        <div class="hamzo-header" style="background:linear-gradient(135deg,#f57c00,#ff9800)">
          <div class="hamzo-logo">⚠️</div>
          <div>
            <div class="hamzo-title">Action Required</div>
            <div class="hamzo-subtitle">Hamzo is paused</div>
          </div>
        </div>
        <div class="hamzo-body">
          <div class="hamzo-captcha-msg">${message}</div>
        </div>
        <div class="hamzo-footer">
          <button class="hamzo-btn hamzo-btn-primary" id="hamzo-captcha-continue" style="background:#f57c00">Continue Automation</button>
        </div>
      </div>
    `;

    document.body.appendChild(container);
    container.querySelector('#hamzo-captcha-continue').addEventListener('click', () => {
      container.remove();
      resolve();
    });
  });
}

/**
 * Show pre-submission confirmation overlay.
 * Returns 'submit' | 'review' | 'cancel'.
 */
function showSubmitConfirmation(filledCount) {
  return new Promise((resolve) => {
    injectHamzoStyles();
    removeHamzoOverlays();

    const container = createOverlayContainer();
    container.style.width = '400px';
    container.innerHTML = `
      <div class="hamzo-card">
        <div class="hamzo-header" style="background:linear-gradient(135deg,#2e7d32,#43a047)">
          <div class="hamzo-logo">✅</div>
          <div>
            <div class="hamzo-title">Application Ready!</div>
            <div class="hamzo-subtitle">${filledCount} fields filled successfully</div>
          </div>
        </div>
        <div class="hamzo-body">
          <div class="hamzo-question" style="margin-bottom:4px">The application has been completed. Do you want me to submit it?</div>
          <p style="font-size:11px;color:#888;margin:6px 0 0">You can review the filled form before submitting.</p>
        </div>
        <div class="hamzo-footer" style="flex-wrap:wrap">
          <button class="hamzo-confirm-btn hamzo-submit-btn" id="hamzo-do-submit">✓ Submit Application</button>
          <button class="hamzo-confirm-btn hamzo-review-btn" id="hamzo-do-review">👁 Review</button>
          <button class="hamzo-confirm-btn hamzo-cancel-btn" id="hamzo-do-cancel">✗ Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(container);
    container.querySelector('#hamzo-do-submit').addEventListener('click', () => { container.remove(); resolve('submit'); });
    container.querySelector('#hamzo-do-review').addEventListener('click', () => { container.remove(); resolve('review'); });
    container.querySelector('#hamzo-do-cancel').addEventListener('click', () => { container.remove(); resolve('cancel'); });
  });
}

// ─── Progress Reporting ───

function sendProgress(step, message, details = {}) {
  if (!extensionAlive()) return;
  try {
    chrome.runtime.sendMessage({
      type: 'HAMZO_FILLER_PROGRESS',
      step,
      message,
      timestamp: Date.now(),
      ...details,
    });
  } catch {}
}

// ─── Sync answers to server vault ───

async function syncAnswerToServer(question, answer, approved) {
  try {
    await fetch('http://localhost:3000/api/vault/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, answer, approved }),
    });
  } catch {}
}

// ─── Main Form Fill Pipeline ───

// Self-deciding orchestrator:
// Phase 1 — job DESCRIPTION page (no form, has Apply CTA): click Apply, adopt the
//   resulting page/form URL, continue automatically.
// Phase 2 — APPLICATION form page: fill → resume → questions → confirm → submit.
// Handles full reloads (content script re-runs, pendingApply adopted URL matches)
// and SPA route changes (URL watcher below re-triggers the pipeline).
async function fillPage(profile, answers, pending, depth = 0) {
  if (/\/error(\/|$)|\/500(\/|$)/i.test(location.pathname)) return;
  if (depth > 4) {
    sendProgress('complete', '⚠️ Too many application steps — please continue manually from here.', {
      status: 'needs_attention', filledCount: 0, emptyCount: 0,
    });
    await markPendingDone();
    return;
  }

  await waitForContent();
  if (/\/error(\/|$)|\/500(\/|$)/i.test(location.pathname)) return;

  const earlyInputs = collectInputs().filter((input) => (input.getAttribute('type') || '') !== 'file');
  const applyBtns = earlyInputs.length < 3 ? findDescriptionApplyButtons() : [];

  if (applyBtns.length) {
    sendProgress('apply_opening', '📄 Job description page detected. Clicking Apply to open the application form...');
    const clicked = await clickApplyUntilEffect(applyBtns);
    if (!clicked) {
      // Clicks had no effect — most sites gate Apply behind candidate login.
      // Do NOT mark done: the user may click Apply manually, and the DOM watcher
      // below will auto-start the form fill when the form appears.
      const wall = detectLoginWall();
      if (wall) {
        sendProgress('login_required', '🔐 This job site needs you to log in before applying.');
        sendProgress('complete', '🔐 Please log in on the job site (candidate login), click Apply yourself — Hamzo will fill the form automatically when it appears.', {
          status: 'needs_attention', filledCount: 0, emptyCount: 0,
        });
      } else {
        sendProgress('complete', '⚠️ The Apply button is not responding — click Apply yourself, Hamzo will fill the form automatically when it appears.', {
          status: 'needs_attention', filledCount: 0, emptyCount: 0,
        });
      }
      await updatePending({ awaitingManualApply: true });
      return;
    }
    sendProgress('form_wait', '⏳ Application form opening — watching for the next step...');
    await waitForNextStep(clicked.beforeUrl, 22000);
    await updatePending({ url: location.href, applyClicked: true });
    await new Promise((r) => setTimeout(r, 2500));
    return fillPage(profile, answers, { ...pending, url: location.href, applyClicked: true }, depth + 1);
  }

  return fillFormPhase(profile, answers, pending);
}

function waitForContent() {
  return (async () => {
    for (let i = 0; i < 30; i += 1) {
      const len = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().length;
      if (len > 300) return;
      await new Promise((r) => setTimeout(r, 400));
    }
  })();
}

// All "Apply" CTAs on a DESCRIPTION page (not submits inside a form),
// ranked: in-viewport + truly visible first (kills hidden-duplicate mis-clicks).
function findDescriptionApplyButtons() {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const out = [];
  const nodes = [...document.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"]')];
  for (const el of nodes) {
    try {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const r = el.getBoundingClientRect?.();
      if (!r || !r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity || '1') < 0.2) continue;
      if (el.offsetParent === null && cs.position !== 'fixed' && el.tagName !== 'BODY') continue;
      const text = norm(el.innerText || el.value || el.getAttribute('aria-label') || '');
      if (!/^(apply|apply now|apply for this job|apply for job|apply to this job|start application|begin application|continue to apply|proceed to apply|easy apply)$/.test(text)) continue;
      if (/sign in|log in|contact sales|attach file|paste/i.test(text)) continue;
      // A submit button living inside a real form belongs to Phase 2, not here.
      const form = el.closest('form');
      if (form && form.querySelectorAll('input, textarea, select').length >= 3) continue;
      const inView = r.top >= 0 && r.top <= innerHeight && r.left >= 0 && r.left <= innerWidth;
      out.push({ el, inView, top: r.top });
    } catch {}
  }
  out.sort((a, b) => (b.inView - a.inView) || (a.top - b.top));
  return out.map((o) => o.el);
}

function pageChangedSince(beforeUrl) {
  if (location.href !== beforeUrl) return true;
  if (/\/error(\/|$)|\/500(\/|$)/i.test(location.pathname)) return true;
  if (collectInputs().filter((input) => (input.getAttribute('type') || '') !== 'file').length >= 3) return true;
  return [...document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="drawer"]')]
    .some((m) => m.querySelector('input, textarea, select, button'));
}

function realClick(el) {
  try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
  return (async () => {
    await new Promise((r) => setTimeout(r, 600));
    const r = el.getBoundingClientRect?.();
    const x = r ? r.left + r.width / 2 : 0;
    const y = r ? r.top + r.height / 2 : 0;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
    try { el.dispatchEvent(new MouseEvent('mouseover', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch {}
    try { el.focus?.(); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('click', opts)); } catch {}
    try { el.click(); } catch {}
  })();
}

// Click candidates one by one and VERIFY each had an effect (URL/form/modal change).
// Returns { beforeUrl } on success, null when nothing responded.
async function clickApplyUntilEffect(candidates) {
  const tried = new Set();
  for (const el of candidates.slice(0, 3)) {
    try {
      const key = `${el.tagName}:${(el.innerText || el.value || '').slice(0, 30)}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const beforeUrl = location.href;
      await realClick(el);
      for (let i = 0; i < 12; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        if (pageChangedSince(beforeUrl)) return { beforeUrl };
        // Button itself gone / turned into something else counts as an effect too.
        if (!document.contains(el)) return { beforeUrl };
      }
      sendProgress('apply_retry', '↻ That Apply button did not respond — trying the next one...');
    } catch {}
  }
  return null;
}

// Candidate-login gate: password field or login/register modal on the page.
function detectLoginWall() {
  try {
    const pwVisible = [...document.querySelectorAll('input[type="password"]')].some((el) => {
      const r = el.getBoundingClientRect?.();
      return r && r.width && r.height && el.offsetParent !== null;
    });
    if (pwVisible) return true;
    const scopes = [...document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="login"], [class*="signin"], [class*="auth"]')];
    if (scopes.some((m) => /sign in|log in|register|create (an )?account|candidate login/i.test(m.innerText || ''))) return true;
    const body = (document.body?.innerText || '').slice(0, 3000);
    if (/sign in to apply|log in to apply|please login to continue|create an account to apply/i.test(body)) return true;
  } catch {}
  return false;
}

function waitForNextStep(beforeUrl, ms) {
  const start = Date.now();
  return (async () => {
    while (Date.now() - start < ms) {
      if (location.href !== beforeUrl) return true;
      if (/\/error(\/|$)|\/500(\/|$)/i.test(location.pathname)) return true;
      const formInputs = collectInputs().filter((input) => (input.getAttribute('type') || '') !== 'file');
      if (formInputs.length >= 3) return true;
      const modalForm = [...document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="drawer"]')]
        .some((m) => m.querySelector('input, textarea, select'));
      if (modalForm) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  })();
}

function updatePending(patch) {
  return new Promise((resolve) => {
    try {
      if (!extensionAlive()) return resolve();
      chrome.storage.local.get(['pendingApply'], (stored) => {
        if (!stored?.pendingApply) return resolve();
        chrome.storage.local.set({ pendingApply: { ...stored.pendingApply, ...patch } }, () => resolve());
      });
    } catch { resolve(); }
  });
}

function markPendingDone() {
  return updatePending({ done: true });
}

async function fillFormPhase(profile, answers, pending) {

  const jobTitle = pending.jobTitle || '';
  const company = pending.company || '';

  sendProgress('finding_form', '🔍 Looking for the application form...');
  const inputs = await waitForForm();

  // Step 1: Check for CAPTCHA/MFA before filling
  const captchaType = detectCaptchaOrMFA();
  if (captchaType) {
    sendProgress('captcha_detected', `⚠️ ${captchaType === 'captcha' ? 'CAPTCHA' : 'Verification step'} detected. Waiting for you to complete it...`);
    await showCaptchaPauseOverlay(captchaType);
    sendProgress('captcha_completed', '✅ Verification completed. Resuming automation...');
    await new Promise(r => setTimeout(r, 1500));
  }

  // Step 2: Fill known fields from profile
  sendProgress('filling', '📝 Filling known profile information...');
  let filledCount = 0;

  inputs.forEach((input) => {
    const type = (input.getAttribute('type') || '').toLowerCase();
    if (type === 'file') return;
    if (input.tagName !== 'SELECT' && !isPlaceholderValue(input) && input.value) return;
    const label = labelFor(input);
    const hint = FIELD_HINTS.find((item) => item.test.test(label));
    if (!hint) return;
    const value = profileValue(profile, hint.key, jobTitle, company);
    if (value) {
      setNativeValue(input, value);
      filledCount++;
    }
  });

  // Step 3: Attach resume
  const resumeAttached = await attachGeneratedResume(pending, profile);
  if (resumeAttached) {
    filledCount++;
    sendProgress('resume_attached', '📎 Resume attached successfully.');
  }

  // Step 4: Fill choice fields (dropdowns, radios, checkboxes)
  fillChoices(profile, answers);

  // Step 5: Detect unknown required fields
  const unknown = collectInputs().filter((input) => {
    const type = (input.getAttribute('type') || '').toLowerCase();
    if (type === 'file') return false;
    if (input.tagName === 'SELECT') return false;
    if (!isPlaceholderValue(input)) return false;
    const label = labelFor(input);

    // Try to fill from profile one more time
    const hint = FIELD_HINTS.find((item) => item.test.test(label));
    if (hint) {
      const value = profileValue(profile, hint.key, jobTitle, company);
      if (value) {
        setNativeValue(input, value);
        filledCount++;
        return false;
      }
    }

    // Check if field is required
    if (!input.required && input.getAttribute('aria-required') !== 'true' && !/\*/.test(label)) return false;
    return Boolean(label);
  });

  // Step 6: For each unknown field, try saved answers or ask user
  if (unknown.length > 0) {
    sendProgress('unknown_fields', `🔎 Found ${unknown.length} required fields that need your input.`);
  }

  for (let i = 0; i < unknown.length && i < 10; i++) {
    const input = unknown[i];
    const question = labelFor(input);

    // Try semantic match from saved answers
    const savedAnswer = findBestAnswer(question, answers);
    if (savedAnswer) {
      setNativeValue(input, savedAnswer);
      filledCount++;
      sendProgress('auto_filled_saved', `✅ Auto-filled "${question.slice(0, 50)}" from saved answers.`);
      continue;
    }

    // Ask user via Hamzo overlay
    sendProgress('asking_user', `🔑 Asking for: "${question.slice(0, 60)}"...`);

    // Scroll the field into view
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(r => setTimeout(r, 400));

    // Highlight the field
    const origBorder = input.style.border;
    const origBoxShadow = input.style.boxShadow;
    input.style.border = '2px solid #009688';
    input.style.boxShadow = '0 0 12px rgba(0,150,136,0.3)';

    const result = await askHamzoQuestion(question, i, unknown.length);

    // Restore field styling
    input.style.border = origBorder;
    input.style.boxShadow = origBoxShadow;

    if (result) {
      setNativeValue(input, result.answer);
      filledCount++;

      // Save answer if user approved
      if (result.remember) {
        answers[question.toLowerCase()] = result.answer;
        // Also save normalized version for semantic matching
        const normKey = normalizeQuestion(question);
        if (normKey) answers[normKey] = result.answer;

        // Sync to extension storage
        try {
          if (extensionAlive()) await chrome.storage.local.set({ answers });
        } catch {}

        // Sync to server vault
        await syncAnswerToServer(question, result.answer, true);

        sendProgress('answer_saved', `💾 Answer saved: "${question.slice(0, 40)}" → will auto-fill next time.`);
      }
    }
  }

  // Step 7: Check for any remaining CAPTCHA
  const captchaCheck2 = detectCaptchaOrMFA();
  if (captchaCheck2) {
    sendProgress('captcha_detected', `⚠️ ${captchaCheck2 === 'captcha' ? 'CAPTCHA' : 'Verification step'} detected. Please complete it...`);
    await showCaptchaPauseOverlay(captchaCheck2);
    sendProgress('captcha_completed', '✅ Verification completed.');
    await new Promise(r => setTimeout(r, 1000));
  }

  // Step 8: Check if there are still empty required fields
  const stillEmpty = [...document.querySelectorAll('input, textarea, select')].filter((input) => {
    const type = (input.getAttribute('type') || '').toLowerCase();
    if (['hidden', 'password', 'submit', 'button', 'file'].includes(type)) return false;
    if (!(input.required || input.getAttribute('aria-required') === 'true' || /\*/.test(questionFor(input)))) return false;
    if (type === 'checkbox' || type === 'radio') return false;
    return isPlaceholderValue(input);
  });

  // Step 9: Find submit button
  const formRoot = [...document.querySelectorAll('form, section, div')].find((node) => /apply for this job/i.test(node.innerText || '') && node.querySelector('input'));
  const submitBtn = [...(formRoot || document).querySelectorAll('button, input[type="submit"]')].find((node) => {
    const text = (node.innerText || node.value || '').trim();
    if (!text) return false;
    if (/sign in|log in|contact sales|attach file|paste/i.test(text)) return false;
    return /submit application|^submit$|^apply$|apply now|send application|submit my application/i.test(text);
  });

  // Step 10: Show confirmation before submission
  const autoSubmitEnabled = pending.autoSubmit === true;

  if (stillEmpty.length > 0) {
    sendProgress('needs_attention', `⚠️ ${stillEmpty.length} required fields still need attention. Please fill them manually.`);
    await finish('📋 Form partially filled. Please review and complete remaining fields.', {
      status: 'needs_attention',
      filledCount,
      emptyCount: stillEmpty.length,
    });
    return;
  }

  if (!submitBtn) {
    sendProgress('no_submit', '📋 Form filled but no submit button found. Please submit manually.');
    await finish('Form filled successfully. Please submit manually.', {
      status: 'needs_attention',
      filledCount,
      emptyCount: 0,
    });
    return;
  }

  // If auto-submit is enabled, submit directly
  if (autoSubmitEnabled) {
    sendProgress('submitting', '🚀 Auto-submitting application...');
    submitBtn.click();
    await new Promise(r => setTimeout(r, 3000));
    await finish(`✅ Application submitted! ${filledCount} fields filled.`, {
      status: 'submitted',
      filledCount,
      emptyCount: 0,
    });
    return;
  }

  // Show confirmation overlay
  sendProgress('confirming', '✅ All fields filled. Awaiting your confirmation...');
  const decision = await showSubmitConfirmation(filledCount);

  if (decision === 'submit') {
    sendProgress('submitting', '🚀 Submitting application...');
    submitBtn.click();
    await new Promise(r => setTimeout(r, 3000));

    // Verify submission — check for validation errors
    const errorsAfterSubmit = [...document.querySelectorAll('[class*="error"], [class*="invalid"], [aria-invalid="true"]')].filter((el) => {
      const text = (el.innerText || '').trim();
      return text.length > 0 && text.length < 200 && /required|invalid|please|error|must/i.test(text);
    });

    if (errorsAfterSubmit.length > 0) {
      await finish(`⚠️ Submission may have failed — ${errorsAfterSubmit.length} validation errors detected. Please review.`, {
        status: 'needs_attention',
        filledCount,
        emptyCount: errorsAfterSubmit.length,
      });
    } else {
      await finish(`✅ Application submitted successfully! ${filledCount} fields filled.`, {
        status: 'submitted',
        filledCount,
        emptyCount: 0,
      });
    }
  } else if (decision === 'review') {
    await finish('👁 Review mode — please review the form and submit manually when ready.', {
      status: 'needs_attention',
      filledCount,
      emptyCount: 0,
    });
  } else {
    await finish('✗ Submission cancelled by user.', {
      status: 'cancelled',
      filledCount,
      emptyCount: 0,
    });
  }
}

function finish(message, details = {}) {
  sendProgress('complete', message, { status: 'needs_attention', filledCount: 0, emptyCount: 0, ...details });
  return markPendingDone();
}

// ─── Page Matching ───

function sameJobPage(pendingUrl, pending) {
  let expected;
  try { expected = new URL(pendingUrl); } catch { return false; }
  if (/\/error(\/|$)|\/500(\/|$)/i.test(location.pathname)) return false;
  if (location.hostname === expected.hostname) {
    const expectedPath = expected.pathname.replace(/\/+$/, '');
    const currentPath = location.pathname.replace(/\/+$/, '');
    if (currentPath === expectedPath) return true;
    if (currentPath.startsWith(`${expectedPath}/`)) return true;
    const expectedJob = expectedPath.match(/job[./][\w.-]+/i)?.[0];
    const currentJob = currentPath.match(/job[./][\w.-]+/i)?.[0];
    if (expectedJob && expectedJob === currentJob) return true;
  }
  // Adopted host: Apply click navigated to an ATS/form host — keep automating
  // on pages that look like application flows (not every random tab).
  if (pending?.applyClicked) {
    try {
      const expHost = new URL(pendingUrl).hostname;
      if (location.hostname === expHost) return true;
      if (/\/(apply|application|jobs?|careers)/i.test(location.pathname)) return true;
    } catch {}
    return false;
  }
  return false;
}

// ─── Boot ───

let filling = false;

function runPending(stored) {
  const pending = stored.pendingApply;
  if (!pending?.url || pending.done || filling) return;
  if (!sameJobPage(pending.url, pending)) return;
  filling = true;
  // Terminal states mark pending done themselves; no blind auto-remove here so
  // multi-step flows (Apply click → form on new URL/modal) keep working.
  fillPage(stored.profile || {}, stored.answers || {}, pending).finally(() => {
    filling = false;
  });
}

function bootApply() {
  if (!extensionAlive()) return;
  chrome.storage.local.get(['pendingApply', 'profile', 'answers'], runPending);
}

bootApply();
if (extensionAlive()) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.pendingApply?.newValue) return;
    chrome.storage.local.get(['pendingApply', 'profile', 'answers'], runPending);
  });
  // SPA route changes (mynexthire, Workday…) don't reload the page, so the content
  // script never re-runs — watch the URL and re-evaluate the pipeline instead.
  let lastHref = location.href;
  setInterval(() => {
    try {
      if (location.href !== lastHref) {
        lastHref = location.href;
        bootApply();
      }
    } catch {}
  }, 1500);
  // Manual-Apply watcher: user clicked Apply themselves after the auto-click gave up.
  // When a real form appears, start filling automatically (no second button press).
  setInterval(() => {
    try {
      if (filling || !extensionAlive()) return;
      chrome.storage.local.get(['pendingApply'], (stored) => {
        try {
          const p = stored?.pendingApply;
          if (!p?.url || p.done || !p.awaitingManualApply) return;
          if (!sameJobPage(p.url, p)) return;
          const n = collectInputs().filter((i) => (i.getAttribute('type') || '') !== 'file').length;
          if (n >= 3) {
            sendProgress('form_found', '📄 Application form detected — auto-filling now...');
            updatePending({ awaitingManualApply: false }).then(() => bootApply());
          }
        } catch {}
      });
    } catch {}
  }, 3500);
}
})();
