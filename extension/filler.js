(function () {
  if (window.__HAMZOOH_FILLER_LOADED__) {
    try { window.__HAMZOOH_BOOT__?.(); } catch {}
    return;
  }
  window.__HAMZOOH_FILLER_LOADED__ = true;

  const FIELD_HINTS = [
    { key: 'email', test: /e-?mail/i },
    { key: 'phone', test: /phone|mobile|\btel\b|telephone|cell/i },
    { key: 'firstName', test: /first.?name|given.?name|firstname/i },
    { key: 'lastName', test: /last.?name|surname|family.?name|lastname/i },
    { key: 'fullName', test: /^name$|full.?name|your.?name|legal.?name|candidate.?name|applicant.?name/i },
    { key: 'address', test: /street.?address|^address$|address.?line.?1|mailing.?address/i },
    { key: 'city', test: /^city$|town/i },
    { key: 'state', test: /state|province|region/i },
    { key: 'zip', test: /zip|postal.?code|pin.?code/i },
    { key: 'country', test: /country|nation/i },
    { key: 'location', test: /city|location|current.?location|where.?do.?you.?live/i },
    { key: 'linkedin', test: /linkedin/i },
    { key: 'github', test: /github/i },
    { key: 'portfolio', test: /portfolio|website|personal.?url|^url$|personal.?site/i },
    { key: 'projectLink', test: /project.?(link|url)|link.?(to|of).?(project|work|portfolio|github|demo)|share.*link|deployed/i },
    { key: 'university', test: /university|college|school|institute|alma.?mater|institution/i },
    { key: 'gpa', test: /cgpa|gpa|grade.?point/i },
    { key: 'internship', test: /internship|past.?intern|previous.?intern|intern.?experience/i },
    { key: 'degree', test: /degree|qualification|major|course|field.?of.?study|branch/i },
    { key: 'graduation', test: /graduat|class.?of|year.?of|expected.?graduat/i },
    { key: 'codechef', test: /codechef|code.?chef/i },
    { key: 'codeforces', test: /codeforces|code.?forces/i },
    { key: 'leetcode', test: /leetcode|leet.?code/i },
    { key: 'hackerrank', test: /hackerrank|hacker.?rank/i },
    { key: 'salary', test: /salary|compensation|pay|ctc|expected.?salary/i },
    { key: 'experience_years', test: /years?.?of.?experience|total.?experience/i },
    { key: 'cover_letter', test: /cover.?letter|additional.?info|why.?do.?you.?want|tell.?us.?about|why.?this.?role|why.?our.?company/i },
  ];

  const FILLER_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
    'please', 'provide', 'enter', 'specify', 'select', 'choose', 'answer',
    'question', 'below', 'us', 'we', 'me', 'i', 'you', 'this', 'that',
  ]);

  const skipped = [];
  const logs = [];
  let filling = false;

  function extensionAlive() {
    try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Auto-apply must never sit on a prompt forever: a user who walked away would
  // see the run silently stop. Every blocking prompt in auto mode is raced
  // against this fallback instead.
  function withTimeout(promise, ms, fallback) {
    return Promise.race([promise, sleep(ms).then(() => fallback)]);
  }

  // In auto mode, prompting once is enough: if the user is not around to answer
  // the first question, they will not answer the next five either. Prompt
  // dismissal also has to remove the leftover card from the page.
  let autoPromptMissed = false;

  async function askOrSkip(question, index, total, options, reason, autoSubmit) {
    if (!autoSubmit) return askHamzoohQuestion(question, index, total, options, reason);
    // Allow up to 90 seconds for user to answer questions via the Hamzooh overlay
    const result = await withTimeout(askHamzoohQuestion(question, index, total, options, reason), 90000, null);
    if (!result) {
      removeHamzoohOverlays();
    }
    return result;
  }

  function hamzoohLog(level, message, extra) {
    const entry = { level, message, extra, t: Date.now(), href: location.href };
    logs.push(entry);
    try { console[level === 'error' ? 'error' : 'log']('[Hamzooh Apply]', message, extra || ''); } catch {}
  }

  function uniqueSkipped() {
    const seen = new Set();
    return skipped.filter((item) => {
      const key = `${item?.field || ''}|${item?.reason || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function sendProgress(step, message, details = {}) {
    if (!extensionAlive()) return;
    try {
      chrome.runtime.sendMessage({
        type: 'HAMZOOH_FILLER_PROGRESS',
        step,
        message,
        timestamp: Date.now(),
        skipped: uniqueSkipped(),
        ...details,
      });
    } catch {}
  }

  function runtimeSend(payload) {
    return new Promise((resolve) => {
      if (!extensionAlive()) return resolve(null);
      try {
        chrome.runtime.sendMessage(payload, (res) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res || null);
        });
      } catch { resolve(null); }
    });
  }

  function proxyFetch(path, body, method = 'POST') {
    return runtimeSend({ type: 'HAMZOOH_PROXY_FETCH', path, method, body });
  }

  function queryAllDeep(selector, root = document) {
    const out = [];
    const visit = (node) => {
      if (!node?.querySelectorAll) return;
      try { out.push(...node.querySelectorAll(selector)); } catch {}
      let children = [];
      try { children = node.querySelectorAll('*'); } catch { return; }
      for (const el of children) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(root);
    return out;
  }

  function visible(el) {
    if (!el) return false;
    try {
      if (el.closest('[hidden], [aria-hidden="true"]')) return false;
      const r = el.getBoundingClientRect?.();
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity || '1') < 0.1) return false;
      if (r && (r.width === 0 || r.height === 0)) return false;
      return true;
    } catch { return false; }
  }

  function isRendered(el) {
    if (!el) return false;
    try {
      if (el.closest('[hidden]')) return false;
      const r = el.getBoundingClientRect?.();
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      if (r && (r.width === 0 || r.height === 0)) return false;
      return true;
    } catch { return false; }
  }

  // Material Design (and many design systems) render the real <input> at zero
  // size with opacity 0 for styling, so a plain visibility test would skip
  // every radio/checkbox on the page. Judge those by their visible label.
  function choiceVisible(el) {
    if (visible(el)) return true;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type !== 'radio' && type !== 'checkbox') return false;
    try {
      if (el.disabled) return false;
      const holders = [
        el.closest('label'),
        el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null,
        el.closest('[role="radio"], [role="checkbox"], [role="radiogroup"]'),
        el.closest('mat-radio-button, mat-checkbox, mat-radio-group, .mat-mdc-radio-button, .mat-mdc-checkbox, .mat-radio-button, .md-radio-button, .mdc-radio, .mdc-checkbox'),
        el.parentElement,
      ].filter(Boolean);
      return holders.some((holder) => isRendered(holder) && (holder.innerText || '').trim().length > 0);
    } catch { return false; }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function labelFor(input) {
    try {
      const id = input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      const wrapping = input.closest('label');
      const aria = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby') || '';
      const labelled = aria && document.getElementById(String(aria).split(' ')[0]);
      const nearby = input.getAttribute('placeholder') || input.name || input.id || '';
      const ownLabel = (id?.innerText || wrapping?.innerText || labelled?.innerText || '').replace(/\s+/g, ' ').trim();
      if (ownLabel) {
        return [ownLabel, input.getAttribute('placeholder') || '', input.name || '']
          .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 400);
      }
      const heading = input.closest('div, li, fieldset, section, td')?.querySelector('label, p, span, legend, h1, h2, h3, div')?.innerText || '';
      return [aria, nearby, heading].filter(Boolean).join(' ')
        .replace(/\s+/g, ' ').trim().slice(0, 400);
    } catch {
      return (input.name || input.id || '').toString();
    }
  }

  // The visible text of a single radio/checkbox option ("Yes", "Bachelor's degree").
  function optionTextFor(input) {
    try {
      const wrapping = input.closest('label');
      const wrappingText = (wrapping?.innerText || '').replace(/\s+/g, ' ').trim();
      if (wrappingText) return wrappingText;
      if (input.id) {
        const own = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        const ownText = (own?.innerText || '').replace(/\s+/g, ' ').trim();
        if (ownText) return ownText;
      }
      return String(input.value || '').replace(/\s+/g, ' ').trim();
    } catch {
      return String(input.value || '').trim();
    }
  }

  function cleanPrompt(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 260) return '';
    if (/[{;]\s*[a-z-]+\s*:/.test(t)) return ''; // CSS / JS blob
    if (/^(body|html|head|script|style)\b/i.test(t)) return '';
    return t;
  }

  // Finds the element that wraps exactly one radio/checkbox group.
  function choiceGroupContainer(el, type) {
    const name = el.getAttribute('name') || '';
    let node = el.parentElement;
    for (let depth = 0; depth < 6 && node && node !== document.body; depth += 1) {
      const selector = name
        ? `input[type="${type}"][name="${CSS.escape(name)}"]`
        : `input[type="${type}"]`;
      const groupCount = node.querySelectorAll(selector).length;
      const totalCount = node.querySelectorAll('input, select, textarea').length;
      if (groupCount >= 2 && groupCount === totalCount) return node;
      if (totalCount > groupCount) return null;
      node = node.parentElement;
    }
    return null;
  }

  function promptBefore(container) {
    if (!container) return '';
    for (const sibling of [container.previousElementSibling]) {
      if (!sibling) continue;
      if (sibling.matches('input, select, textarea') || sibling.querySelector('input, select, textarea')) continue;
      const text = cleanPrompt(sibling.innerText || sibling.textContent);
      if (text) return text;
    }
    return '';
  }

  // Many design systems put the question text inside the same wrapper as the
  // options (a <legend>, a .q-label span, an aria-labelledby target) rather
  // than in a preceding sibling.
  function promptInside(container) {
    if (!container) return '';
    const candidates = container.querySelectorAll(
      'legend, .q-label, [class*="question"], [class*="prompt"], [class*="label"], [data-testid*="label"]',
    );
    for (const el of candidates) {
      if (el.closest('label') && el.closest('label').querySelector('input')) continue;
      if (el.querySelector('input, select, textarea')) continue;
      const text = cleanPrompt(el.innerText || el.textContent);
      if (text) return text;
    }
    for (const child of container.children) {
      if (child.querySelector('input, select, textarea') || child.matches('input, select, textarea')) continue;
      const text = cleanPrompt(child.innerText || child.textContent);
      if (text) return text;
    }
    return '';
  }

  function questionFor(el) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').trim();
    const labelledBy = (el.getAttribute('aria-labelledby') || '');
    const labelledByText = labelledBy.split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)?.innerText || '').join(' ').replace(/\s+/g, ' ').trim();
    const legend = cleanPrompt(el.closest('fieldset')?.querySelector('legend')?.innerText);
    const labelText = cleanPrompt(labelFor(el));

    if (aria || labelledByText) return cleanPrompt([legend, aria, labelledByText, labelText].filter(Boolean).join(' '));

    if (type === 'radio' || type === 'checkbox' || el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'checkbox') {
      if (legend) return legend;
      // Angular Material labels the wrapper, not the inputs.
      const groupWidget = el.closest('mat-radio-group, mat-checkbox-group, [role="radiogroup"], [role="group"]');
      if (groupWidget) {
        const groupAria = groupWidget.getAttribute('aria-label') || '';
        const groupBy = (groupWidget.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
          .map((id) => document.getElementById(id)?.innerText || '').join(' ');
        const widgetText = cleanPrompt([groupAria, groupBy].filter(Boolean).join(' '));
        if (widgetText) return widgetText;
        const widgetPrompt = promptBefore(groupWidget) || promptInside(groupWidget);
        if (widgetPrompt) return widgetPrompt;
      }
      const group = choiceGroupContainer(el, type === 'radio' ? 'radio' : 'checkbox');
      if (group) {
        const prompt = promptBefore(group) || promptInside(group);
        if (prompt) return prompt;
        const closest = group.closest('.field, .form-group, fieldset, li');
        const earlier = closest && closest !== group ? promptBefore(closest) || promptInside(closest) : '';
        if (earlier) return earlier;
      }
      const own = cleanPrompt(labelFor(el).replace(new RegExp(`\\b${el.name}\\b`, 'g'), ''));
      if (own && own.length > 12) return own;
      return labelText;
    }

    return cleanPrompt([legend, labelText].filter(Boolean).join(' '));
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
    const phoneDigits = String(profile.phone || '').replace(/\D/g, '');
    const locParts = String(profile.location || '').split(',').map((p) => p.trim());
    const map = {
      email: profile.email || '',
      phone: phoneDigits.length > 10 ? phoneDigits.slice(-10) : phoneDigits,
      firstName: first || '',
      lastName: rest.join(' ') || '',
      fullName: name,
      address: profile.address || profile.street || '',
      city: profile.city || locParts[0] || '',
      state: profile.state || locParts[1] || '',
      zip: profile.zip || profile.postalCode || '',
      country: profile.country || locParts[2] || locParts[1] || '',
      location: profile.location || '',
      linkedin: profile.links?.linkedin || profile.linkedin || '',
      github: profile.links?.github || profile.github || '',
      portfolio: profile.links?.portfolio || profile.portfolio || profile.links?.github || profile.github || '',
      projectLink: projectUrl,
      university: education.school || education.university || education.institution || education.college || '',
      gpa: education.gpa || education.cgpa || education.detail || education.score || '',
      internship: intern || '',
      degree: [education.degree, education.branch].filter(Boolean).join(' ') || '',
      graduation: education.dates || education.graduationYear || profile.batch || '',
      salary: profile.expectedSalary || profile.salary || '',
      experience_years: profile.yearsOfExperience != null && profile.yearsOfExperience !== ''
        ? String(profile.yearsOfExperience) : String(internships.length || '0'),
      codechef: profile.codechef || profile.codechefRating || '',
      codeforces: profile.codeforces || profile.codeforcesRating || '',
      leetcode: profile.leetcode || profile.leetcodeRating || '',
      hackerrank: profile.hackerrank || profile.hackerrankRating || '',
      cover_letter: `I am excited to apply for the ${jobTitle || 'position'} at ${company || 'your company'}. With my background in ${(profile.skills || []).slice(0, 4).join(', ') || 'software development'}, I am confident in my ability to contribute effectively.`,
    };
    return String(map[key] || '').trim();
  }

  function setNativeValue(input, value) {
    if (!input) return false;
    try {
      if (input.tagName === 'SELECT') {
        const wanted = String(value).trim().toLowerCase();
        const option = [...input.options].find((item) => {
          const text = item.text.trim().toLowerCase();
          return item.value.trim().toLowerCase() === wanted || text === wanted
            || (wanted === 'yes' && /^(yes|y)\b/.test(text))
            || (wanted === 'no' && /^(no|n)\b/.test(text))
            || (wanted === 'decline' && /decline|prefer not|do not wish/.test(text));
        });
        if (!option) return false;
        input.value = option.value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      if (input.isContentEditable) {
        input.focus();
        input.textContent = value;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
        return true;
      }
      const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value), inputType: 'insertText' }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    } catch (err) {
      hamzoohLog('error', 'setNativeValue failed', err.message);
      return false;
    }
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

  function collectInputs() {
    return queryAllDeep('input, textarea, select').filter((input) => {
      const type = (input.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) return false;
      if (input.disabled) return false;
      if (type === 'radio' || type === 'checkbox') return choiceVisible(input);
      return visible(input);
    });
  }

  function normalizeQuestion(raw) {
    const words = String(raw || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/).filter((w) => w.length > 1 && !FILLER_WORDS.has(w));
    return [...new Set(words)].sort().join(' ');
  }

  function questionSimilarity(normA, normB) {
    if (!normA || !normB) return 0;
    const setA = new Set(normA.split(' '));
    const setB = new Set(normB.split(' '));
    if (!setA.size || !setB.size) return 0;
    let overlap = 0;
    for (const word of setA) if (setB.has(word)) overlap++;
    return overlap / new Set([...setA, ...setB]).size;
  }

  function findBestAnswer(question, answers) {
    if (!question || !answers) return null;
    const normalized = normalizeQuestion(question);
    const directKey = question.toLowerCase().trim();
    if (answers[directKey]) {
      const val = answers[directKey];
      return typeof val === 'string' ? val : val?.answer || String(val);
    }
    let bestAnswer = null;
    let bestScore = 0;
    for (const [key, entry] of Object.entries(answers)) {
      const score = questionSimilarity(normalized, normalizeQuestion(key));
      if (score > bestScore && score >= 0.45) {
        bestScore = score;
        bestAnswer = typeof entry === 'string' ? entry : entry?.answer || String(entry);
      }
    }
    return bestAnswer;
  }

  function isSensitiveQuestion(question) {
    return /authorized to work|work authorization|sponsorship|visa status|citizenship|ssn|social security|passport number|national id|aadhaar|convicted|felony|criminal|date of birth|\bdob\b|expected salary|compensation|notice period|currently employed/i.test(String(question || ''));
  }

  function isEeoQuestion(question) {
    return /gender|hispanic|race|ethnicity|veteran|disability|lgbt|sexual orientation/i.test(String(question || ''));
  }

  // Only uses facts the user actually stored. Returns '' when unknown so the
  // caller asks the user instead of inventing an answer.
  function sensitiveProfileAnswer(question, profile) {
    const q = String(question || '').toLowerCase();
    const p = profile || {};
    if (/authorized to work|work authorization|legally (eligible|authorized)|right to work|eligible to work/.test(q)) {
      const flag = p.workAuthorized ?? p.authorizedToWork ?? p.workAuth;
      if (flag === true || /^(yes|true)$/i.test(String(flag || ''))) return 'Yes';
      if (flag === false || /^(no|false)$/i.test(String(flag || ''))) return 'No';
      // Applying to a role in the user's own country/region is not a
      // sponsorship question — "authorized to work in India" for someone based
      // in India is a fact we can state without guessing.
      const country = String(p.country || String(p.location || '').split(',').pop() || '').trim().toLowerCase();
      const asked = (q.match(/authorized to work in ([a-z ]+)/) || [])[1];
      if (country && asked && (country.includes(asked.trim()) || asked.trim().includes(country))) return 'Yes';
    }
    if (/require .*sponsorship|need .*sponsorship|sponsorship/.test(q)) {
      const flag = p.requireSponsorship ?? p.sponsorshipRequired;
      if (flag === true) return 'Yes';
      if (flag === false) return 'No';
    }
    // Derive enrolment from the user's real education dates rather than
    // guessing: a graduation year still in the future means still studying.
    if (/currently (enrolled|studying|pursuing)|still (in|at) (college|university|school)|are you a student|pursuing a (bachelor|master|degree)/.test(q)) {
      const explicit = p.currentlyEnrolled ?? p.isStudent;
      if (explicit === true) return 'Yes';
      if (explicit === false) return 'No';
      const years = (p.education || [])
        .map((item) => parseInt(item?.graduationYear || item?.endYear || item?.year || '', 10))
        .filter((n) => Number.isFinite(n));
      if (years.length) {
        const latest = Math.max(...years);
        const thisYear = new Date().getFullYear();
        if (latest >= thisYear) return 'Yes';
        return 'No';
      }
    }
    if (/expected (salary|ctc|compensation)|salary expectation/.test(q)) {
      const salary = p.expectedSalary || p.salary;
      if (salary) return String(salary);
    }
    return '';
  }

  function chooseFromProfile(question, profile, company) {
    const q = String(question || '').toLowerCase();
    const known = sensitiveProfileAnswer(question, profile);
    if (known) return known;
    if (/privacy|acknowledge|agree|consent|terms|i understand|i certify/.test(q) && !isSensitiveQuestion(q)) return 'yes';
    if (isEeoQuestion(q)) return 'decline';
    const workedHere = (profile.experience || []).some((item) => {
      const c = String(item.company || '').toLowerCase();
      return c && company && (c.includes(String(company).toLowerCase()) || String(company).toLowerCase().includes(c));
    });
    if (/employed by|worked (for|at)|previously employed|ever been employed/.test(q)) {
      if (workedHere) return 'yes';
      if (company && (q.includes(String(company).toLowerCase()) || /this company|the company/.test(q))) return 'no';
    }
    return '';
  }

  // Only picks an option when the question itself makes the right choice
  // unambiguous. Never guesses among unrelated options.
  function heuristicChoice(question, optionTexts, profile) {
    const q = String(question || '').toLowerCase();
    const texts = (optionTexts || []).map((t) => String(t).trim()).filter(Boolean);
    if (!texts.length) return '';
    const find = (re) => texts.find((t) => re.test(t));
    if (/how did you hear|referral source|source of application|where did you (find|hear)/.test(q)) {
      const source = String(profile?.jobSource || '').toLowerCase();
      const fromSource = source && (find(new RegExp(source.replace(/[^a-z0-9]/g, '.'), 'i')) || '');
      return fromSource || find(/linkedin/i) || find(/company website|careers/i) || find(/job board|naukri|indeed/i) || '';
    }
    if (/gender|hispanic|race|ethnicity|veteran|disability|sexual orientation/.test(q)) {
      return find(/decline|prefer not|do not wish/i) || '';
    }
    if (/highest (level of )?education|education level|highest qualification|degree (completed|earned)/.test(q)) {
      const degree = String(profile?.education?.[0]?.degree || '').toLowerCase();
      const ranked = [
        [/ph\.?d|doctorate/, /ph\.?d|doctorate/i],
        [/(m\.?tech|m\.?s|master|mba|m\.?sc|post.?grad)/, /master|m\.?tech|m\.?s\b|mba|post.?grad/i],
        [/(b\.?tech|b\.?e\b|bachelor|b\.?s|b\.?sc|under.?grad)/, /bachelor|b\.?tech|b\.?e\b|b\.?s\b|under.?grad/i],
        [/(diploma|associate)/, /diploma|associate/i],
      ];
      for (const [profileRe, optionRe] of ranked) {
        if (profileRe.test(degree)) {
          const hit = find(optionRe);
          if (hit) return hit;
        }
      }
      return find(/bachelor|b\.?tech|under.?grad/i) || '';
    }
    if (/employment type|job type/.test(q)) {
      return find(/full.?time/i) || '';
    }
    return '';
  }

  // Styled radios/checkboxes (Material, Ant, Chakra…) keep the native input
  // hidden, so clicking the input alone doesn't always register. Click the
  // visible label instead and fall back to the input.
  function clickChoice(input) {
    if (input.checked) return true;
    const targets = [
      input.closest('label'),
      input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null,
      // Angular Material / MDC put the click handler on the button wrapper.
      input.closest('mat-radio-button, mat-checkbox, .mat-mdc-radio-button, .mat-mdc-checkbox, .mdc-form-field, .mat-radio-button, .md-radio-button'),
    ].filter(Boolean);

    for (const target of targets) {
      if (!isRendered(target)) continue;
      try {
        target.click();
        if (input.checked) return true;
      } catch {}
    }

    if (!input.checked) {
      try { input.click(); } catch {}
    }
    if (!input.checked) {
      // Last resort for controlled components that only react to real events.
      try { input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch {}
    }
    return input.checked;
  }

  function applyChoice(input, wanted) {
    if (!wanted) return false;
    if (input.tagName === 'SELECT') {
      const wantedText = wanted === 'yes' ? 'Yes' : wanted === 'no' ? 'No' : wanted === 'decline' ? 'Decline' : wanted;
      let option = optionList(input).find((item) => item.text.trim().toLowerCase() === String(wantedText).toLowerCase());
      if (!option && wanted === 'decline') option = optionList(input).find((item) => /decline|prefer not|do not wish/i.test(item.text));
      if (!option && (wanted === 'yes' || wanted === 'no')) {
        option = optionList(input).find((item) => (wanted === 'yes' ? /^(yes|y)\b/i : /^(no|n)\b/i).test(item.text.trim()));
      }
      if (!option) return false;
      return setNativeValue(input, option.value || option.text);
    }
    const type = (input.getAttribute('type') || '').toLowerCase();
    if (type === 'radio') {
      const optionText = optionTextFor(input).toLowerCase();
      const value = String(wanted).toLowerCase();
      const yes = /^(yes|y|true|agree)$/.test(value) && /^(yes|y)\b|true|agree/.test(optionText);
      const no = /^(no|n|false|disagree)$/.test(value) && /^(no|n)\b|false|disagree/.test(optionText);
      const decline = /decline|prefer not|do not wish/.test(value) && /decline|prefer not|do not wish/.test(optionText);
      const exact = optionText.trim() === value || String(input.value).trim().toLowerCase() === value;
      if (yes || no || decline || exact) {
        clickChoice(input);
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return input.checked;
      }
    }
    if (type === 'checkbox') {
      const value = String(wanted).toLowerCase();
      const shouldCheck = /^(yes|y|true|agree|accepted)$/.test(value) && !/decline|prefer not/.test(value);
      const shouldUncheck = /^(no|n|false|decline|prefer not)$/.test(value);
      if (shouldCheck && !input.checked) clickChoice(input);
      if (shouldUncheck && input.checked) clickChoice(input);
      return (shouldCheck || shouldUncheck) && input.checked === shouldCheck;
    }
    return false;
  }

  async function fillCustomDropdowns(wantedByQuestion, answers, profile, company) {
    const widgets = queryAllDeep('[data-automation-id*="select"], [data-automation-id*="dropdown"], [data-automation-id="sourceDropdown"], [role="combobox"], [aria-haspopup="listbox"], [class*="select__control"], [class*="dropdown"]')
      .filter((el) => visible(el) && el.tagName !== 'SELECT');
    for (const widget of widgets.slice(0, 20)) {
      const question = questionFor(widget);
      let wanted = findBestAnswer(question, answers) || chooseFromProfile(question, profile, company) || wantedByQuestion.get(question);
      try {
        widget.click();
        await sleep(250);
        const options = queryAllDeep('[data-automation-id="menu-item"], [data-automation-id="promptOption"], [role="option"], [class*="option"], li').filter((o) => visible(o) && (o.innerText || '').trim());
        if (!options.length) continue;
        if (!wanted) wanted = heuristicChoice(question, options.map((o) => o.innerText.trim()), profile);
        if (!wanted) {
          const optTexts = options.map((o) => o.innerText.trim()).filter(Boolean);
          const ai = await inferAnswerWithAI(question, optTexts, profile, '', company, '');
          if (ai?.answer) {
            wanted = ai.answer;
          } else {
            const promptResult = await askOrSkip(question, 0, 1, optTexts, 'Choose the option for this question (saved to Vault)', true);
            if (promptResult?.answer) {
              wanted = promptResult.answer;
              if (promptResult.remember) await rememberAnswer(answers, question, wanted);
            }
          }
        }
        if (!wanted) {
          document.body.click();
          await sleep(100);
          skipped.push({ field: (question || 'Custom dropdown').slice(0, 80), reason: 'No matching profile value or saved answer for this dropdown.' });
          continue;
        }
        const hit = options.find((o) => {
          const t = o.innerText.trim().toLowerCase();
          const w = String(wanted).toLowerCase();
          return t === w || t.includes(w) || w.includes(t) || (w === 'yes' && /^(yes|y)\b/.test(t)) || (w === 'no' && /^(no|n)\b/.test(t)) || (w === 'decline' && /decline|prefer not/.test(t));
        });
        if (hit) {
          hit.click();
          hamzoohLog('log', 'custom dropdown filled', question.slice(0, 80));
        } else {
          document.body.click();
          skipped.push({ field: (question || 'Custom dropdown').slice(0, 80), reason: `The value "${wanted}" is not an option in this dropdown.` });
        }
        await sleep(150);
      } catch {}
    }
  }

  // Radios that omit a `name` attribute would all collapse onto the same key,
  // so later groups were silently skipped. Group by name when present, else by
  // the question the options belong to.
  function radioGroupKey(input, question, type = 'radio') {
    return `${type}:${input.name || question || input.id || ''}`;
  }

  function radiosInGroup(input, question) {
    if (input.name) {
      return queryAllDeep(`input[type="radio"][name="${CSS.escape(input.name)}"]`).filter(choiceVisible);
    }
    const container = choiceGroupContainer(input, 'radio');
    const nodes = container ? container.querySelectorAll('input[type="radio"]') : null;
    return (nodes ? [...nodes] : queryAllDeep('input[type="radio"]').filter((el) => questionFor(el) === question))
      .filter(choiceVisible);
  }

  function fillChoices(profile, answers, company) {
    const controls = queryAllDeep('select, input[type="radio"], input[type="checkbox"]')
      .filter((el) => (el.tagName === 'SELECT' ? visible(el) : choiceVisible(el)));
    const seenGroups = new Set();
    let filledCount = 0;
    controls.forEach((input) => {
      const type = (input.getAttribute('type') || '').toLowerCase();
      const question = questionFor(input);
      const key = question.toLowerCase().slice(0, 180);
      const savedAnswer = findBestAnswer(question, answers);
      let wanted = savedAnswer || chooseFromProfile(question, profile, company);
      if (!wanted && type !== 'radio' && type !== 'checkbox') {
        wanted = heuristicChoice(question, optionList(input).map((o) => o.text.trim()), profile);
      }
      if (type === 'radio') {
        const groupKey = radioGroupKey(input, question);
        if (seenGroups.has(groupKey)) return;
        seenGroups.add(groupKey);
        if (!wanted) return;
        const group = radiosInGroup(input, question);
        if (group.some((item) => item.checked)) return;
        const hit = group.find((item) => applyChoice(item, wanted));
        if (hit) {
          answers[key] = wanted;
          filledCount += 1;
        }
        return;
      }
      if (type === 'checkbox') {
        const isConsent = /privacy|acknowledge|agree|terms|consent/.test(question.toLowerCase());
        const choice = savedAnswer || (isConsent ? 'yes' : chooseFromProfile(question, profile, company));
        if (choice && applyChoice(input, choice)) {
          answers[key] = choice;
          filledCount += 1;
        }
        return;
      }
      if (wanted && applyChoice(input, wanted)) {
        answers[key] = wanted;
        filledCount += 1;
      }
    });
    return filledCount;
  }

  function resumeFile(pending) {
    const base64 = pending?.resumeBase64 || '';
    if (!base64) return null;
    let raw = String(base64).trim();
    if (raw.includes(',')) raw = raw.split(',')[1];
    raw = raw.replace(/\s+/g, '');
    if (!raw) return null;
    try {
      const binary = atob(raw);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new File([bytes], pending?.resumeName || 'hamzooh-tailored-resume.pdf', { type: 'application/pdf' });
    } catch (err) {
      hamzoohLog('error', 'Failed to decode resume', err.message);
      return null;
    }
  }

  function attachResume(input, file) {
    if (!file || !input) return false;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    } catch { return false; }
    ['focus', 'click', 'input', 'change', 'blur'].forEach((type) => {
      try { input.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })); } catch {}
    });
    return Boolean(input.files && input.files.length);
  }

  function allFileInputs() {
    return queryAllDeep('input[type="file"]').sort((a, b) => {
      const aText = `${a.id} ${a.name} ${labelFor(a)}`.toLowerCase();
      const bText = `${b.id} ${b.name} ${labelFor(b)}`.toLowerCase();
      return (/resume|cv/i.test(aText) ? -1 : 0) - (/resume|cv/i.test(bText) ? -1 : 0);
    });
  }

  async function attachGeneratedResume(pending) {
    const fromBg = await runtimeSend({ type: 'HAMZOOH_GET_RESUME' });
    if (fromBg?.resumeBase64) {
      pending.resumeBase64 = fromBg.resumeBase64;
      pending.resumeName = fromBg.resumeName || pending.resumeName;
    }
    const file = resumeFile(pending);
    if (!file) {
      skipped.push({ field: 'resume', reason: 'No tailored resume bytes were available to attach.' });
      sendProgress('resume_missing', '⚠️ Tailored resume was not available to attach.');
      return false;
    }

    const clickAttach = () => {
      queryAllDeep('button, a, label, span, [role="button"]').forEach((el) => {
        const text = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (/^(attach file|upload( file)?|choose file|browse|attach|select file)$/i.test(text) || /attach (a )?file|upload resume|upload cv|select file/i.test(text)) {
          try { el.click(); } catch {}
        }
      });
    };

    let attached = allFileInputs().some((input) => attachResume(input, file));
    if (!attached) {
      clickAttach();
      const start = Date.now();
      while (Date.now() - start < 1500 && !allFileInputs().length) await sleep(150);
      attached = allFileInputs().some((input) => attachResume(input, file));
    }
    if (!attached) {
      const zone = queryAllDeep('[data-automation-id="file-upload-drop-zone"], [data-automation-id*="drop"], div, section, label, form').find((el) => {
        const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
        return /resume\/?cv|attach file|drop file|select file/i.test(text) && text.length < 250;
      });
      if (zone) {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        ['dragenter', 'dragover', 'drop'].forEach((type) => {
          try { zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer })); } catch {}
        });
        await sleep(500);
        attached = allFileInputs().some((input) => attachResume(input, file))
          || Boolean(document.querySelector('[data-automation-id="file-upload-item"], [data-automation-id*="file"]'));
      }
    }
    if (attached) {
      sendProgress('resume_attached', `📎 Attached ${file.name}`);
      await sleep(1500);
    } else {
      skipped.push({ field: 'resume', reason: 'Could not find a file input or dropzone for the resume.' });
      sendProgress('resume_failed', '⚠️ Could not attach the tailored resume — no file input found.');
    }
    return attached;
  }

  function detectCaptchaOrMFA() {
    const captchaIframes = [...document.querySelectorAll('iframe')].filter((iframe) => /recaptcha|hcaptcha|captcha|turnstile|challenge/i.test(iframe.src || ''));
    if (captchaIframes.length) return 'captcha';
    if (queryAllDeep('[class*="captcha"], [id*="captcha"], .g-recaptcha, .h-captcha').length) return 'captcha';
    const mfa = queryAllDeep('input').filter((input) => /otp|verification code|two.?factor|2fa|mfa|authenticator|security code/i.test(labelFor(input) + ' ' + (input.placeholder || '')));
    return mfa.length ? 'mfa' : null;
  }

  function removeHamzoohOverlays() {
    document.querySelectorAll('.hamzooh-overlay-container').forEach((el) => el.remove());
  }

  function injectHamzoohStyles() {
    if (document.getElementById('hamzooh-overlay-styles')) return;
    const style = document.createElement('style');
    style.id = 'hamzooh-overlay-styles';
    style.textContent = `
      @keyframes hamzoohSlideIn { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .hamzooh-card { background:#fff; border-radius:16px; box-shadow:0 12px 40px rgba(0,0,0,.18); overflow:hidden; border:1px solid #e0e0e0; }
      .hamzooh-header { background:linear-gradient(135deg,#00796b,#009688); padding:16px 18px; display:flex; align-items:center; gap:10px; color:#fff; }
      .hamzooh-logo { width:32px; height:32px; border-radius:8px; background:rgba(255,255,255,.2); display:flex; align-items:center; justify-content:center; font-size:18px; }
      .hamzooh-title { font-weight:800; font-size:14px; }
      .hamzooh-subtitle { font-size:11px; opacity:.85; }
      .hamzooh-body { padding:16px 18px; }
      .hamzooh-question { font-size:13px; color:#333; font-weight:600; line-height:1.5; margin-bottom:12px; }
      .hamzooh-input { width:100%; padding:10px 14px; border:1.5px solid #d9d9d2; border-radius:10px; font-size:14px; outline:none; box-sizing:border-box; }
      .hamzooh-footer { padding:12px 18px; border-top:1px solid #f0f0f0; display:flex; gap:8px; flex-wrap:wrap; }
      .hamzooh-btn { flex:1; padding:10px; border-radius:10px; font-weight:700; font-size:13px; cursor:pointer; border:none; }
      .hamzooh-btn-primary { background:#009688; color:#fff; }
      .hamzooh-btn-skip { background:#f5f5f5; color:#666; }
      .hamzooh-progress { font-size:11px; color:#009688; font-weight:600; padding:8px 18px; background:#e0f2f1; }
      .hamzooh-confirm-btn { padding:10px 16px; border-radius:10px; font-weight:700; font-size:13px; cursor:pointer; border:none; }
    `;
    document.head.appendChild(style);
  }

  function createOverlayContainer() {
    const container = document.createElement('div');
    container.className = 'hamzooh-overlay-container';
    container.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;width:380px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;animation:hamzoohSlideIn .3s ease-out';
    return container;
  }

  function askHamzoohQuestion(question, fieldIndex, totalFields, options = [], reason = '') {
    return new Promise((resolve) => {
      injectHamzoohStyles();
      removeHamzoohOverlays();
      const container = createOverlayContainer();
      const hasOptions = Array.isArray(options) && options.length > 0;
      const optHtml = hasOptions
        ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;">${options.slice(0, 8).map((opt) =>
          `<button type="button" class="hamzooh-chip-btn" data-val="${escapeHtml(opt)}" style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;padding:7px 12px;font-size:13px;cursor:pointer;">${escapeHtml(opt)}</button>`
        ).join('')}</div>`
        : '';
      container.innerHTML = `
        <div class="hamzooh-card">
          <div class="hamzooh-progress">${fieldIndex + 1} of ${totalFields} missing fields</div>
          <div class="hamzooh-header"><div class="hamzooh-logo">AI</div><div>
            <div class="hamzooh-title">Hamzooh needs one detail</div>
            <div class="hamzooh-subtitle">${escapeHtml(reason || 'Saved to Vault — reused next time')}</div>
          </div></div>
          <div class="hamzooh-body">
            <div class="hamzooh-question">"${escapeHtml(question.length > 140 ? question.slice(0, 137) + '…' : question)}"</div>
            ${optHtml}
            <input class="hamzooh-input" id="hamzooh-answer-input" type="text" placeholder="Your answer…" />
            <label style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;color:#475569;">
              <input type="checkbox" id="hamzooh-remember-check" checked /> Save to Vault (never ask again)
            </label>
          </div>
          <div class="hamzooh-footer">
            <button class="hamzooh-btn hamzooh-btn-skip" id="hamzooh-skip-btn">Skip</button>
            <button class="hamzooh-btn hamzooh-btn-primary" id="hamzooh-save-btn">Save & Continue</button>
          </div>
        </div>`;
      document.body.appendChild(container);
      const input = container.querySelector('#hamzooh-answer-input');
      const rememberCheck = container.querySelector('#hamzooh-remember-check');
      const finish = (answer, remember) => { container.remove(); resolve(answer == null ? null : { answer, remember }); };
      container.querySelectorAll('.hamzooh-chip-btn').forEach((btn) => {
        btn.addEventListener('click', () => finish(btn.getAttribute('data-val'), rememberCheck.checked));
      });
      container.querySelector('#hamzooh-save-btn').addEventListener('click', () => {
        const answer = (input.value || '').trim();
        if (!answer) { input.focus(); return; }
        finish(answer, rememberCheck.checked);
      });
      container.querySelector('#hamzooh-skip-btn').addEventListener('click', () => finish(null, false));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') container.querySelector('#hamzooh-save-btn').click(); });
      setTimeout(() => input.focus(), 80);
    });
  }

  function showCaptchaPauseOverlay(type) {
    return new Promise((resolve) => {
      injectHamzoohStyles();
      removeHamzoohOverlays();
      const container = createOverlayContainer();
      container.innerHTML = `
        <div class="hamzooh-card">
          <div class="hamzooh-header" style="background:linear-gradient(135deg,#f57c00,#ff9800)">
            <div class="hamzooh-logo">!</div>
            <div><div class="hamzooh-title">Action required</div><div class="hamzooh-subtitle">Hamzooh is paused</div></div>
          </div>
          <div class="hamzooh-body"><div class="hamzooh-question">${escapeHtml(type === 'captcha' ? 'Complete the CAPTCHA, then continue.' : 'Complete verification, then continue.')}</div></div>
          <div class="hamzooh-footer"><button class="hamzooh-btn hamzooh-btn-primary" id="hamzooh-captcha-continue">Continue automation</button></div>
        </div>`;
      document.body.appendChild(container);
      container.querySelector('#hamzooh-captcha-continue').addEventListener('click', () => { container.remove(); resolve(); });
    });
  }

  function showSubmitConfirmation(filledCount, emptyItems) {
    return new Promise((resolve) => {
      injectHamzoohStyles();
      removeHamzoohOverlays();
      const container = createOverlayContainer();
      container.style.width = '420px';
      const skipHtml = emptyItems.length
        ? `<ul style="font-size:12px;color:#9a3412;margin:8px 0 0;padding-left:18px;max-height:120px;overflow:auto;">${emptyItems.slice(0, 8).map((s) => `<li>${escapeHtml(s.field)}: ${escapeHtml(s.reason)}</li>`).join('')}</ul>`
        : '<p style="font-size:12px;color:#166534;margin:8px 0 0;">Required fields look complete. Resume attachment was verified where the site exposes it.</p>';
      container.innerHTML = `
        <div class="hamzooh-card">
          <div class="hamzooh-header" style="background:linear-gradient(135deg,#2e7d32,#43a047)">
            <div class="hamzooh-logo">✅</div>
            <div><div class="hamzooh-title">Ready for your review</div><div class="hamzooh-subtitle">${filledCount} fields filled</div></div>
          </div>
          <div class="hamzooh-body">
            <div class="hamzooh-question">Review the application in the job tab. Hamzooh submits only if you explicitly confirm below.</div>
            ${skipHtml}
          </div>
          <div class="hamzooh-footer">
            <button class="hamzooh-confirm-btn" id="hamzooh-do-submit" style="background:#009688;color:#fff;">Submit application</button>
            <button class="hamzooh-confirm-btn" id="hamzooh-do-review" style="background:#fff;color:#009688;border:1.5px solid #009688;">Review without submitting</button>
            <button class="hamzooh-confirm-btn" id="hamzooh-do-cancel" style="background:#f5f5f5;color:#666;">Cancel</button>
          </div>
        </div>`;
      document.body.appendChild(container);
      container.querySelector('#hamzooh-do-submit').addEventListener('click', () => { container.remove(); resolve('submit'); });
      container.querySelector('#hamzooh-do-review').addEventListener('click', () => { container.remove(); resolve('review'); });
      container.querySelector('#hamzooh-do-cancel').addEventListener('click', () => { container.remove(); resolve('cancel'); });
    });
  }

  async function syncAnswerToServer(question, answer, approved) {
    await proxyFetch('/api/vault/answers', { question, answer, approved });
  }

  async function queryServerVaultMatch(question) {
    const res = await proxyFetch('/api/vault/answers/match', { question });
    return res?.data?.match?.answer || null;
  }

  async function inferAnswerWithAI(question, options, profile, jobTitle, company, resumeText) {
    const res = await proxyFetch('/api/vault/infer-answer', { question, options, profile, jobTitle, company, resumeText });
    const data = res?.data;
    if (data?.canInfer !== false && data?.answer) return { answer: data.answer, source: data.source || 'ai-inference' };
    return { answer: null, reason: data?.reason || data?.message || 'unanswered' };
  }

  // Google Careers renders its actions as MDC buttons: a <div class="VfPpkd-LgbsSe">
  // rather than a <button>/<a>. Selecting only native tags silently misses every
  // Next/Submit control there, so include the design-system wrappers too.
  const ACTION_SELECTOR = [
    'button',
    'a',
    'input[type="submit"]',
    'input[type="button"]',
    '[role="button"]',
    '.VfPpkd-LgbsSe',
    '.mat-mdc-button-base',
    '.mat-button-base',
    '.mdc-button',
  ].join(', ');

  function findDescriptionApplyButtons() {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const out = [];
    for (const el of queryAllDeep(ACTION_SELECTOR)) {
      try {
        if (el.disabled || !visible(el)) continue;
        const text = norm(el.innerText || el.value || el.getAttribute('aria-label') || '');
        if (!/^(apply|apply now|apply for this job|apply for job|apply to this job|start application|begin application|continue to apply|easy apply)$/.test(text)) continue;
        if (/sign in|log in|contact sales|attach file/i.test(text)) continue;
        const form = el.closest('form');
        if (form && form.querySelectorAll('input, textarea, select').length >= 3) continue;
        const r = el.getBoundingClientRect?.() || { top: 0 };
        out.push({ el, top: r.top });
      } catch {}
    }
    out.sort((a, b) => a.top - b.top);
    return out.map((o) => o.el);
  }

  // MDC renders a button as a <div> whose real navigation lives in a stretched
  // <a href> overlay inside it. Dispatching on the div never reaches that
  // anchor, so resolve to the anchor when one exists.
  function clickTarget(el) {
    if (!el) return el;
    if (el.tagName === 'A' || el.tagName === 'BUTTON') return el;
    const inner = el.querySelector?.('a[href]');
    return inner && isRendered(inner) ? inner : el;
  }

  // MDC/Angular buttons bind through jsaction rather than a native <button>,
  // and they react to the full pointer sequence instead of a synthetic click.
  async function realClick(el) {
    const target = clickTarget(el);
    try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
    await sleep(400);
    try {
      const rect = target.getBoundingClientRect();
      const base = {
        bubbles: true, cancelable: true, view: window,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0,
      };
      for (const type of ['pointerover', 'pointerenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
        try {
          const Ctor = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
          target.dispatchEvent(new Ctor(type, base));
        } catch {}
      }
    } catch {}
    try { target.click(); } catch {}
  }

  function hasResumeDropzone() {
    try {
      if (allFileInputs().length > 0) return true;
      const zone = queryAllDeep('[data-automation-id="file-upload-drop-zone"], [data-automation-id*="drop"], [data-automation-id*="file"], div, section, label, form').find((el) => {
        if (!visible(el)) return false;
        const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
        return /resume\/?cv|attach file|drop file|select file|autofill with resume/i.test(text) && text.length < 250;
      });
      return Boolean(zone);
    } catch { return false; }
  }

  function pageHasForm() {
    if (hasResumeDropzone()) return true;
    return collectInputs().filter((i) => (i.getAttribute('type') || '') !== 'password').length >= 1;
  }

  function detectLoginWall() {
    try {
      if (queryAllDeep('input[type="password"]').some(visible)) return true;
      const body = (document.body?.innerText || '').slice(0, 3500);
      return /sign in to apply|log in to apply|please login to continue|create an account to apply/i.test(body);
    } catch { return false; }
  }

  // Identity providers reached by redirecting an Apply link. Filling these is
  // both wrong and a credential risk, so the automation must stop and wait.
  const AUTH_HOST_RE = /(^|\.)(accounts\.google\.com|accounts\.youtube\.com|login\.microsoftonline\.com|login\.live\.com|login\.microsoft\.com|appleid\.apple\.com|auth0\.com|okta\.com|onfido\.com|login\.workday\.com|.*\.workday\.com\/login|.*\.myworkdayjobs\.com\/.*login|sso\.|.*\.sso\.|idp\.|.*\.okta\.com)$/i;
  const AUTH_PATH_RE = /\/(signin|sign-in|login|log-in|oauth|authorize|sso|auth|session\/new|Account\/Login|users\/sign_in)\b/i;

  function detectAuthGate() {
    try {
      const host = location.hostname;
      if (host && AUTH_HOST_RE.test(host)) return true;
      if (AUTH_PATH_RE.test(location.pathname)) {
        // A path-only hit counts when the page really looks like a sign-in
        // screen, not when a job board merely lives under /login.
        const hasPw = queryAllDeep('input[type="password"]').some(visible);
        const body = (document.body?.innerText || '').slice(0, 2500).toLowerCase();
        const signInish = /sign in|log in|login to|continue with (google|microsoft|apple|linkedin)|single sign-on/.test(body);
        if (hasPw || signInish) return true;
      }
      // Host-independent check: a sign-in screen is a tiny page whose title
      // and body both announce signing in, with no application fields.
      const title = (document.title || '').toLowerCase();
      const body = (document.body?.innerText || '').slice(0, 1500).toLowerCase();
      const titleSignIn = /\b(sign in|sign-in|log in|login)\b/.test(title);
      const bodySignIn = /\b(sign in|use your \w+ account|forgot (email|password)|create an account)\b/.test(body);
      const fields = collectInputs();
      const looksLikeForm = fields.some((el) => {
        const t = (el.getAttribute('type') || '').toLowerCase();
        return !['email', 'text', 'password'].includes(t);
      });
      if (titleSignIn && bodySignIn && !looksLikeForm) return true;
      return false;
    } catch { return false; }
  }

  /** Workday / ATS modal choice: automatically select "Autofill with Resume" */
  async function checkAndHandleApplyChoices() {
    const candidates = queryAllDeep(ACTION_SELECTOR);
    const autofillBtn = candidates.find((el) => {
      if (!visible(el) || el.disabled) return false;
      const autoId = el.getAttribute('data-automation-id') || '';
      const text = buttonText(el);
      return /autofillWithResume/i.test(autoId) || /autofill with resume|apply with resume/i.test(text);
    });
    if (autofillBtn) {
      sendProgress('choice_selected', '⚡ Selected "Autofill with Resume"…');
      await realClick(autofillBtn);
      await sleep(1800);
      return true;
    }
    return false;
  }

  function showLoginHelperBanner(company, emailInput, pwInput) {
    if (document.getElementById('hamzooh-login-helper')) return;
    const banner = document.createElement('div');
    banner.id = 'hamzooh-login-helper';
    banner.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#ffffff;border:1.5px solid #6366f1;box-shadow:0 10px 25px rgba(0,0,0,0.15);border-radius:12px;padding:14px 18px;max-width:380px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1e293b;';
    banner.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <div style="font-size:20px;">🔐</div>
        <div>
          <div style="font-weight:700;font-size:13.5px;color:#1e1b4b;margin-bottom:3px;">Sign In or Create Account</div>
          <div style="font-size:12px;color:#64748b;line-height:1.4;">
            Sign in or create an account for <b>${escapeHtml(company || 'this portal')}</b>. Hamzooh will securely save your login details so you never have to sign in manually again!
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    const saveCreds = async () => {
      const email = emailInput?.value?.trim() || '';
      const password = pwInput?.value || '';
      if (password && (email || password.length >= 6)) {
        await proxyFetch('/api/vault/credentials', {
          domain: location.hostname.toLowerCase(),
          email,
          password,
        });
        sendProgress('credentials_saved', '💾 Saved credentials to Vault for future auto-logins!');
        try { banner.remove(); } catch {}
      }
    };

    const forms = document.querySelectorAll('form');
    forms.forEach((f) => f.addEventListener('submit', saveCreds, { once: true }));
    const submitBtns = queryAllDeep(ACTION_SELECTOR).filter((el) => {
      return /sign in|create account|log in|register/i.test(buttonText(el));
    });
    submitBtns.forEach((btn) => btn.addEventListener('click', saveCreds, { once: true }));
  }

  async function handlePortalAuthGate(company) {
    const pwInput = queryAllDeep('input[type="password"]').find(visible);
    if (!pwInput) return false;

    const emailInput = queryAllDeep('input[type="email"], [data-automation-id="email"], input[name*="email"], input[id*="email"], input[type="text"]').find((el) => {
      if (!visible(el)) return false;
      const idOrName = `${el.id} ${el.name} ${el.placeholder} ${labelFor(el)}`.toLowerCase();
      return /email|user(name)?/i.test(idOrName);
    });

    const portalDomain = location.hostname.toLowerCase();

    // 1. Check if we already have saved credentials in Vault
    try {
      const res = await proxyFetch('/api/vault/credentials/match', { domain: portalDomain });
      const cred = res?.data?.credential;
      if (cred?.password && pwInput) {
        if (cred.email && emailInput && !emailInput.value) {
          setNativeValue(emailInput, cred.email);
        }
        setNativeValue(pwInput, cred.password);
        sendProgress('auto_login', `🔑 Auto-filled credentials for ${company || portalDomain}`);

        const submitBtn = queryAllDeep(ACTION_SELECTOR).find((el) => {
          if (!visible(el) || el.disabled) return false;
          const autoId = el.getAttribute('data-automation-id') || '';
          const text = buttonText(el);
          return /signInSubmitButton/i.test(autoId) || /^(sign in|log in|submit)$/i.test(text);
        });
        if (submitBtn) {
          await sleep(600);
          await realClick(submitBtn);
          sendProgress('auto_login_submitted', '🚀 Auto-signed in, waiting for application to load…');
          await sleep(2500);
          return true;
        }
      }
    } catch {}

    // 2. If no saved credentials yet, listen to user submission and save to Vault
    showLoginHelperBanner(company, emailInput, pwInput);
    return false;
  }

  function buttonText(el) {
    return (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  }

  function isAdvanceButton(el) {
    if (!el || !visible(el) || el.disabled) return false;
    const autoId = el.getAttribute('data-automation-id') || '';
    if (/bottom-navigation-next-button|page-navigation-next-button|continue-button/i.test(autoId)) return true;
    const text = buttonText(el);
    if (/sign in with|attach file|paste|google|linkedin|github/i.test(text)) return false;
    return /^(next|continue|save and continue|save & continue|proceed|next step)$/i.test(text)
      || /save.?and.?continue|continue application|next page/i.test(text);
  }

  function findAdvanceButton() {
    const nodes = queryAllDeep(ACTION_SELECTOR);
    return nodes.find((el) => isAdvanceButton(el)) || null;
  }

  function isSubmitButton(el) {
    if (!el || !visible(el) || el.disabled) return false;
    const autoId = el.getAttribute('data-automation-id') || '';
    if (/bottom-navigation-submit-button/i.test(autoId)) return true;
    const text = buttonText(el);
    if (!text || /sign in|log in|contact sales|attach file|paste|next|continue/i.test(text)) return false;
    return /submit application|^submit$|^apply$|apply now|send application|submit my application|finish application/i.test(text);
  }

  function findSubmitButton() {
    const nodes = queryAllDeep(ACTION_SELECTOR);
    return nodes.find((el) => isSubmitButton(el)) || null;
  }

  const SUCCESS_PATTERNS = [
    /application (has been |was )?(submitted|received|complete|sent)/i,
    /thank you for (applying|your application|your interest)/i,
    /we('| a)?ve received your application/i,
    /your application (is|has been) (in|under) review/i,
    /successfully (applied|submitted)/i,
    /application confirmation/i,
  ];

  const VALIDATION_PATTERNS = [
    /this (field|question) is required/i,
    /field is required/i,
    /please (fill|complete|enter|select)/i,
    /invalid (e-?mail|phone|value|input|format)/i,
    /is not a valid/i,
  ];

  function pageBodyText() {
    try { return (document.body?.innerText || '').slice(0, 200000); } catch { return ''; }
  }

  // Submission is only reported once a success state is actually observed.
  async function submitAndVerify(submitBtn) {
    const beforeUrl = location.href;
    const beforeText = pageBodyText();
    const beforeSnapshot = collectInputs().map((i) => `${i.name}:${i.id}:${i.type}`).join('|');
    try {
      submitBtn.click();
    } catch {
      try { submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch {}
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < 25000) {
      await sleep(800);

      const text = pageBodyText();
      if (text !== beforeText) {
        const success = SUCCESS_PATTERNS.find((re) => re.test(text));
        if (success) return { ok: true, reason: 'confirmation message shown' };
      }

      if (location.href !== beforeUrl && /\/(thank|thanks|confirmation|success|submitted|complete|applied)|\/apply\/(status|confirm)/i.test(location.href)) {
        return { ok: true, reason: `redirected to ${location.href.replace(/^https?:\/\//, '').slice(0, 80)}` };
      }

      const errors = VALIDATION_PATTERNS.filter((re) => {
        const match = text.match(re);
        return match && !beforeText.match(re);
      });
      if (errors.length) {
        return { ok: false, reason: 'the form reported a validation error (form is still on screen)' };
      }

      const currentSnapshot = collectInputs().map((i) => `${i.name}:${i.id}:${i.type}`).join('|');
      const formGone = currentSnapshot !== beforeSnapshot && collectInputs().length === 0;
      if (formGone && !findSubmitButton()) {
        return { ok: true, reason: 'the application form was replaced after submission' };
      }
    }

    return { ok: false, reason: 'no confirmation appeared within 25s' };
  }

  async function waitForForm() {
    for (let i = 0; i < 45; i += 1) {
      if (hasResumeDropzone()) return collectInputs();
      const inputs = collectInputs().filter((input) => !['password'].includes((input.getAttribute('type') || '')));
      if (inputs.length >= 1) return inputs;
      // A step can open with nothing but a choice group or a single Next
      // button; treat a clickable action as proof the app has rendered.
      if (findAdvanceButton() || findSubmitButton()) return collectInputs();
      await sleep(400);
    }
    return collectInputs();
  }

  async function waitForContent() {
    for (let i = 0; i < 30; i += 1) {
      if ((document.body?.innerText || '').replace(/\s+/g, ' ').trim().length > 200) return;
      await sleep(400);
    }
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

  async function rememberAnswer(answers, question, answer) {
    answers[question.toLowerCase()] = answer;
    const normKey = normalizeQuestion(question);
    if (normKey) answers[normKey] = answer;
    try { if (extensionAlive()) await chrome.storage.local.set({ answers }); } catch {}
    await syncAnswerToServer(question, answer, true);
  }

  async function fillUnknownField(input, question, options, answers, profile, pending, index, total) {
    let savedAnswer = findBestAnswer(question, answers);
    if (!savedAnswer) savedAnswer = await queryServerVaultMatch(question);
    if (savedAnswer) {
      setNativeValue(input, savedAnswer);
      sendProgress('auto_filled_saved', `✅ Vault: "${question.slice(0, 45)}"`);
      return true;
    }

    sendProgress('ai_inferring', `🧠 Analyzing: "${question.slice(0, 50)}"`);
    const aiResult = await inferAnswerWithAI(question, options, profile, pending.jobTitle, pending.company, pending.resumeText);
    if (aiResult?.answer) {
      setNativeValue(input, aiResult.answer);
      sendProgress('auto_filled_ai', `✨ ${question.slice(0, 40)} → ${String(aiResult.answer).slice(0, 30)}`);
      return true;
    }

    const reason = isSensitiveQuestion(question)
      ? 'This is personal / legal information and is not in your profile.'
      : (aiResult?.reason || 'Could not infer this from your profile or resume.');
    sendProgress('asking_user', `🔑 ${question.slice(0, 60)}`);
    try { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
    await sleep(250);
    const origBorder = input.style.border;
    input.style.border = '2px solid #009688';
    const result = await askOrSkip(question, index, total, options, reason, pending.autoSubmit === true);
    input.style.border = origBorder;
    if (result?.answer) {
      setNativeValue(input, result.answer);
      if (result.remember) await rememberAnswer(answers, question, result.answer);
      return true;
    }
    skipped.push({ field: question.slice(0, 80), reason });
    return false;
  }

  async function fillFormPhase(profile, answers, pending) {
    const jobTitle = pending.jobTitle || '';
    const company = pending.company || '';
    sendProgress('finding_form', '🔍 Looking for the application form…');
    const inputs = await waitForForm();

    const captchaType = detectCaptchaOrMFA();
    if (captchaType) {
      sendProgress('captcha_detected', '⚠️ Verification detected — waiting for you.');
      await showCaptchaPauseOverlay(captchaType);
    }

    sendProgress('filling', '📝 Filling known profile fields…');
    let filledCount = 0;
    inputs.forEach((input) => {
      const type = (input.getAttribute('type') || '').toLowerCase();
      if (type === 'file' || type === 'password' || type === 'checkbox' || type === 'radio') return;
      if (input.tagName !== 'SELECT' && !isPlaceholderValue(input) && input.value) return;
      const label = labelFor(input);
      const hint = FIELD_HINTS.find((item) => item.test.test(label));
      if (!hint) return;
      const value = profileValue(profile, hint.key, jobTitle, company);
      if (value && setNativeValue(input, value)) filledCount += 1;
    });

    if (await attachGeneratedResume(pending)) filledCount += 1;

    filledCount += fillChoices(profile, answers, company);
    await fillCustomDropdowns(new Map(), answers, profile, company);

    const unknown = collectInputs().filter((input) => {
      const type = (input.getAttribute('type') || '').toLowerCase();
      if (['file', 'password', 'checkbox', 'radio', 'hidden'].includes(type)) return false;
      if (!isPlaceholderValue(input)) return false;
      const label = labelFor(input);
      const hint = FIELD_HINTS.find((item) => item.test.test(label));
      if (hint) {
        const value = profileValue(profile, hint.key, jobTitle, company);
        if (value && setNativeValue(input, value)) {
          filledCount += 1;
          return false;
        }
      }
      const isRequired = input.required || input.getAttribute('aria-required') === 'true' || /\*/.test(label);
      if (!isRequired) {
        // Optional fields never block the flow: record why instead of asking.
        if (label) skipped.push({ field: label.slice(0, 80), reason: 'Optional field — no value in your profile or saved answers.' });
        return false;
      }
      return Boolean(label);
    });

    if (unknown.length) sendProgress('unknown_fields', `🔎 Resolving ${unknown.length} remaining fields…`);
    for (let i = 0; i < unknown.length && i < 20; i += 1) {
      const input = unknown[i];
      const question = labelFor(input);
      if (!question) continue;
      const options = input.tagName === 'SELECT' ? optionList(input).map((o) => o.text.trim()).filter(Boolean) : [];
      if (await fillUnknownField(input, question, options, answers, profile, pending, i, unknown.length)) filledCount += 1;
    }

    filledCount += await resolveRequiredGroups(answers, pending, profile);

    const stillEmpty = collectInputs().filter((input) => {
      const type = (input.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'password', 'submit', 'button'].includes(type)) return false;
      if (!(input.required || input.getAttribute('aria-required') === 'true' || /\*/.test(questionFor(input)))) return false;
      if (type === 'radio' || type === 'checkbox') return false;
      return type === 'file' ? !input.files?.length : isPlaceholderValue(input);
    });
    requiredGroupsOf().forEach((group) => {
      if (!group.items.some((input) => input.checked)) stillEmpty.push(group.items[0]);
    });

    return { filledCount, stillEmpty };
  }

  // Required can be declared on the group wrapper (aria-required on
  // mat-radio-group / role=radiogroup) rather than on each option.
  function groupIsRequired(input, question) {
    if (input.required || input.getAttribute('aria-required') === 'true' || /\*/.test(question)) return true;
    const wrapper = input.closest(
      'mat-radio-group, mat-checkbox-group, [role="radiogroup"], [role="group"], [data-automation-id*="formField"], [data-automation-id*="question"], fieldset, .field, .form-group',
    );
    if (!wrapper) return false;
    return wrapper.getAttribute('aria-required') === 'true'
      || Boolean(wrapper.querySelector('[required], [aria-required="true"], [data-automation-id*="required"], abbr[title*="required"]'))
      || /\*/.test(cleanPrompt(wrapper.querySelector('legend, .q-label, [class*="label"], [data-automation-id*="label"]')?.innerText || ''));
  }

  function requiredGroupsOf() {
    const groups = new Map();
    collectInputs().forEach((input) => {
      const type = (input.getAttribute('type') || '').toLowerCase();
      if (!['radio', 'checkbox'].includes(type)) return;
      const question = questionFor(input);
      if (!groupIsRequired(input, question)) return;
      const key = radioGroupKey(input, question, type);
      if (!groups.has(key)) groups.set(key, { type, items: [], question });
      groups.get(key).items.push(input);
    });
    return groups;
  }

  async function resolveRequiredGroups(answers, pending, profile) {
    let resolved = 0;
    const groups = [...requiredGroupsOf().values()];
    for (let g = 0; g < groups.length; g += 1) {
      const group = groups[g];
      if (group.items.some((input) => input.checked)) continue;
      const question = group.question || '';
      if (group.type === 'checkbox' && /privacy|acknowledge|agree|terms|consent/i.test(question)) {
        if (applyChoice(group.items[0], 'yes')) resolved += 1;
        continue;
      }
      let wanted = findBestAnswer(question, answers) || chooseFromProfile(question, profile, pending.company || '');
      const optionTexts = group.items.map((item) => (optionTextFor(item) || item.value || '').slice(0, 60));
      if (!wanted) wanted = heuristicChoice(question, optionTexts, profile);
      if (!wanted) wanted = await queryServerVaultMatch(question);
      if (!wanted) {
        const ai = await inferAnswerWithAI(question, optionTexts.filter(Boolean), profile, pending.jobTitle, pending.company, pending.resumeText);
        wanted = ai?.answer || '';
      }
      if (!wanted) {
        sendProgress('asking_user', `🔑 ${question.slice(0, 60)}`);
        const result = await askOrSkip(question, g, groups.length,
          optionTexts.filter(Boolean),
          isSensitiveQuestion(question)
            ? 'This is personal / legal information and is not in your profile.'
            : 'This required choice is not in your profile.',
          pending.autoSubmit === true);
        if (result?.answer) {
          wanted = result.answer;
          if (result.remember) await rememberAnswer(answers, question, wanted);
        }
      }
      if (!wanted) {
        skipped.push({ field: question.slice(0, 80), reason: 'Required choice was left unanswered.' });
        continue;
      }
      const hit = group.items.find((item) => applyChoice(item, wanted));
      if (hit) {
        answers[question.toLowerCase().slice(0, 180)] = wanted;
        resolved += 1;
      } else {
        skipped.push({ field: question.slice(0, 80), reason: `"${wanted}" is not one of the available choices.` });
      }
    }
    return resolved;
  }

  async function fillPage(profile, answers, pending, depth = 0) {
    if (/\/error(\/|$)|\/500(\/|$)/i.test(location.pathname)) return;
    if (depth > 12) {
      await finish('⚠️ Too many application steps — continue manually.', { status: 'needs_attention', filledCount: 0, emptyCount: 0 });
      return;
    }

    // Check if portal needs sign in or account creation.
    // Auto-fill if credentials exist in Vault, or display a helper banner to save them.
    if (detectAuthGate() || detectLoginWall()) {
      const loggedIn = await handlePortalAuthGate(pending.company);
      if (loggedIn) {
        return fillPage(profile, answers, pending, depth + 1);
      }
      if (pending.awaitingManualApply && pending.loginHost === location.hostname) return;
      sendProgress(
        'login_required',
        `🔐 Sign in or create an account for ${pending.company || location.hostname}. Hamzooh will save credentials and resume automatically.`,
      );
      await updatePending({ awaitingManualApply: true, loginHost: location.hostname });
      return;
    }

    await waitForContent();

    // Check if Workday or ATS is displaying an "Autofill with Resume" choice dialog
    if (await checkAndHandleApplyChoices()) {
      await updatePending({ url: location.href, applyClicked: true });
      return fillPage(profile, answers, { ...pending, applyClicked: true }, depth + 1);
    }

    const earlyInputs = collectInputs().filter((input) => !['file', 'password'].includes(input.getAttribute('type') || ''));
    const applyBtns = !pending.applyClicked && earlyInputs.length < 2 ? findDescriptionApplyButtons() : [];
    if (applyBtns.length) {
      sendProgress('apply_opening', '📄 Job page detected — clicking Apply…');
      const beforeUrl = location.href;
      await realClick(applyBtns[0]);
      const start = Date.now();
      let changed = false;
      while (Date.now() - start < 15000) {
        await sleep(500);
        if (await checkAndHandleApplyChoices()) { changed = true; break; }
        if (location.href !== beforeUrl || pageHasForm()) { changed = true; break; }
      }
      if (!changed) {
        if (detectLoginWall()) {
          sendProgress('login_required', '🔐 Log in on the job site, then click Apply — Hamzooh will continue automatically.');
          await updatePending({ awaitingManualApply: true });
          return;
        }
        await updatePending({ awaitingManualApply: true });
        sendProgress('apply_blocked', '⚠️ Click Apply yourself — Hamzooh will fill the form when it appears.');
        return;
      }
      await runtimeSend({ type: 'HAMZOOH_ADOPT_TAB' });
      await updatePending({ url: location.href, applyClicked: true });
      await sleep(1500);
      return fillPage(profile, answers, { ...pending, url: location.href, applyClicked: true }, depth + 1);
    }

    if (!pageHasForm() && detectLoginWall()) {
      sendProgress('login_required', '🔐 Please sign in. Hamzooh will resume when the form appears.');
      await updatePending({ awaitingManualApply: true });
      return;
    }

    const snapshot = collectInputs().map((i) => `${i.name}:${i.id}:${i.type}`).join('|');
    const { filledCount, stillEmpty } = await fillFormPhase(profile, answers, pending);

    const advance = findAdvanceButton();
    const submitBtn = findSubmitButton();
    let advanceBlocked = false;

    // A visible submit button means we are on the final step, so show the
    // review. Otherwise step forward to the next section.
    if (advance && !submitBtn) {
      sendProgress('page_advancing', '➡️ Continuing to the next section…');
      const beforeUrl = location.href;
      await realClick(advance);
      const startedAt = Date.now();
      let progressed = false;
      while (Date.now() - startedAt < 25000) {
        await sleep(400);
        const newSnapshot = collectInputs().map((i) => `${i.name}:${i.id}:${i.type}`).join('|');
        if (location.href !== beforeUrl || newSnapshot !== snapshot) {
          progressed = true;
          break;
        }
        if (advance.disabled || /loading|saving|please wait|processing/i.test(buttonText(advance))
          || document.querySelector('[data-automation-id="loading-spinner"], [aria-busy="true"]')) continue;
      }
      }
      if (progressed) {
        await updatePending({ url: location.href, applyClicked: true });
        return fillPage(profile, answers, { ...pending, url: location.href }, depth + 1);
      }
      advanceBlocked = true;
      skipped.push({ field: 'Continue', reason: 'The application did not advance after activation. Check validation messages in the job tab.' });
      sendProgress('advance_blocked', '⚠️ Could not confirm that the application advanced. Review the current step.');
    }

    if (stillEmpty.length > 0) {
      stillEmpty.forEach((el) => skipped.push({ field: labelFor(el).slice(0, 80), reason: 'Required field still empty after automation.' }));
    }

    sendProgress('confirming', '✅ Form prepared. Waiting for your review…');
    const canSubmitCleanly = Boolean(submitBtn) && stillEmpty.length === 0;
    const autoSubmit = pending.autoSubmit === true;

    // Auto-apply never blocks on the review overlay: an unattended run must end
    // with a clear report instead of stalling behind a dialog nobody clicks.
    if (autoSubmit && !canSubmitCleanly) {
      const missing = stillEmpty.map((el) => labelFor(el).slice(0, 60)).filter(Boolean);
      const details = advanceBlocked
        ? 'the Next button did not advance the form — the page likely rejected a required answer'
        : `required field(s) could not be answered automatically${missing.length ? `: ${missing.join(', ')}` : ''}`;
      await finish(`⚠️ Stopped before submitting — ${details}.`, {
        status: 'needs_attention', filledCount, emptyCount: stillEmpty.length,
      });
      return;
    }

    const decision = autoSubmit && canSubmitCleanly ? 'submit' : await showSubmitConfirmation(filledCount, skipped.concat(
      stillEmpty.map((el) => ({ field: labelFor(el).slice(0, 80), reason: 'Still empty / required.' }))
    ));
    if (decision === 'submit' && submitBtn && stillEmpty.length === 0) {
      const verified = await submitAndVerify(submitBtn);
      if (verified.ok) {
        await finish(`✅ Application submitted — ${verified.reason}. ${filledCount} fields filled.`, { status: 'submitted', filledCount, emptyCount: 0 });
      } else {
        await finish(`⚠️ Submission was clicked but not confirmed (${verified.reason}). Check the job tab before assuming it went through.`, { status: 'needs_attention', filledCount, emptyCount: 0 });
      }
    } else if (decision === 'submit' && stillEmpty.length > 0) {
      await finish('⚠️ Required fields are still missing. Review the highlighted fields and submit manually when ready.', { status: 'needs_attention', filledCount, emptyCount: stillEmpty.length });
    } else if (decision === 'submit' && !submitBtn) {
      await finish('📋 No submit button on this page. Review and submit in the tab.', { status: 'needs_attention', filledCount, emptyCount: stillEmpty.length });
    } else if (decision === 'review') {
      await finish('👁 Review the form in this tab, then submit when you are ready.', { status: 'needs_attention', filledCount, emptyCount: stillEmpty.length });
    } else {
      await finish('✗ Submission cancelled.', { status: 'cancelled', filledCount, emptyCount: stillEmpty.length });
    }
  }

  function finish(message, details = {}) {
    sendProgress('complete', message, { status: 'needs_attention', filledCount: 0, emptyCount: 0, ...details, skipped: uniqueSkipped() });
    return markPendingDone();
  }
  function sameJobPage(pendingUrl, pending) {
    try {
      const expected = new URL(pendingUrl);
      if (location.hostname === expected.hostname) return true;
    } catch {}
    if (pending?.applyClicked && /\/(apply|application|jobs?|careers)/i.test(location.pathname)) return true;
    return false;
  }

  async function shouldRun(pending) {
    if (!pending?.url || pending.done) return false;
    const me = await runtimeSend({ type: 'HAMZOOH_IS_JOB_TAB' });
    if (me?.ok) return true;
    if (sameJobPage(pending.url, pending)) {
      await runtimeSend({ type: 'HAMZOOH_ADOPT_TAB' });
      return true;
    }
    return false;
  }

  function frameLooksActionable() {
    return pageHasForm() || findDescriptionApplyButtons().length > 0 || allFileInputs().length > 0;
  }

  async function runPending(stored) {
    const pending = stored.pendingApply;
    if (!pending || filling) return;
    if (!(await shouldRun(pending))) return;
    if (!frameLooksActionable() && detectLoginWall() === false) {
      hamzoohLog('log', 'frame not actionable yet', location.href);
    }
    filling = true;
    autoPromptMissed = false;
    try {
      await fillPage(stored.profile || {}, stored.answers || {}, pending);
    } catch (err) {
      hamzoohLog('error', 'fill pipeline crashed', err.message);
      await finish(`❌ Automation error: ${err.message}`, { status: 'failed' });
    } finally {
      filling = false;
    }
  }

  function bootApply() {
    if (!extensionAlive()) return;
    chrome.storage.local.get(['pendingApply', 'profile', 'answers'], runPending);
  }
  window.__HAMZOOH_BOOT__ = bootApply;

  bootApply();
  if (extensionAlive()) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'HAMZOOH_BEGIN_FILL') bootApply();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.pendingApply?.newValue) return;
      chrome.storage.local.get(['pendingApply', 'profile', 'answers'], runPending);
    });
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        bootApply();
      }
    }, 1500);
    setInterval(() => {
      if (filling || !extensionAlive()) return;
      chrome.storage.local.get(['pendingApply'], (stored) => {
        const p = stored?.pendingApply;
        if (!p?.url || p.done || !p.awaitingManualApply) return;
        // Stay parked while a sign-in screen is showing; resume after it closes.
        if (detectAuthGate()) return;
        if (pageHasForm()) {
          sendProgress('form_found', '📄 Form detected — filling now…');
          updatePending({ awaitingManualApply: false, loginHost: '' }).then(() => bootApply());
        }
      });
    }, 2500);
  }

  window.__HAMZOOH_TEST_RUN__ = (profile, answers, pending) => fillPage(profile, answers || {}, pending || { url: location.href });
  window.__HAMZOOH_DEBUG__ = { questionFor, labelFor, chooseFromProfile, heuristicChoice, applyChoice, profileValue, collectInputs };
})();
