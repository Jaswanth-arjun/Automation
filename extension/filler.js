(function () {
  if (window.__HAMZOOH_FILLER_LOADED__) {
    try { window.__HAMZOOH_BOOT__?.(); } catch {}
    return;
  }
  window.__HAMZOOH_FILLER_LOADED__ = true;

  const FIELD_HINTS = [
    { key: 'email', test: /e-?mail/i },
    { key: 'phone', test: /^(?!.*(extension|\bext\b)).*(phone|mobile|\btel\b|telephone|cell)/i },
    { key: 'phoneExtension', test: /extension|\bext\b/i },
    { key: 'firstName', test: /first.?name|given.?name|firstname/i },
    { key: 'lastName', test: /last.?name|surname|family.?name|lastname/i },
    { key: 'fullName', test: /^name$|full.?name|your.?name|legal.?name|candidate.?name|applicant.?name/i },
    { key: 'address', test: /\b(street|address|addr)\b/i },
    { key: 'city', test: /\b(city|town|municipality)\b/i },
    // Country comes before state: "Country/Region of citizenship" and
    // "Country / Region of residence" both contain the word "Region", and they
    // must get the country, never the state.
    { key: 'country', test: /\b(country|citizenship|nationality|nation)\b/i },
    { key: 'state', test: /\b(state|province)\b|state\s*\/\s*region/i },
    { key: 'zip', test: /\b(zip|postal.?code|pin.?code)\b/i },
    { key: 'location', test: /\b(location|current.?location|where.?do.?you.?(live|reside))\b/i },
    { key: 'linkedin', test: /linkedin/i },
    { key: 'github', test: /github/i },
    { key: 'portfolio', test: /portfolio|website|personal.?url|^url$|personal.?site/i },
    { key: 'projectLink', test: /project.?(link|url)|link.?(to|of).?(project|work|portfolio|github|demo)|share.*link|deployed/i },
    { key: 'university', test: /university|college|school|institute|alma.?mater|institution/i },
    { key: 'gpa', test: /cgpa|gpa|grade.?point/i },
    { key: 'internship', test: /\b(?:past|previous|prior)\s+internships?|\binternship\s+experience|\binternships?\s+(?:held|completed)\b|^internships?$|^internship\s*(?:history|details?)?$/i },
    { key: 'degree', test: /degree|qualification|major|course|field.?of.?study|branch/i },
    { key: 'graduation', test: /graduat|class.?of|year.?of|expected.?graduat/i },
    { key: 'codechef', test: /codechef|code.?chef/i },
    { key: 'codeforces', test: /codeforces|code.?forces/i },
    { key: 'leetcode', test: /leetcode|leet.?code/i },
    { key: 'hackerrank', test: /hackerrank|hacker.?rank/i },
    { key: 'salaryCurrency', test: /\bcurrency\b|salary.?currency|currency.?code/i },
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

  // The candidate pressed Skip on a question. Asking that same question again
  // on the next pass (or the next page step) is what made the overlay look
  // stuck, so a skip is remembered for the rest of THIS application. It is
  // scoped per application: skipping "notice period" on one job must never
  // silence that question on the next one.
  const SKIP_STORAGE_KEY = 'skippedQuestions';
  let SKIPPED_QUESTIONS = {};
  let SKIP_SCOPE = '';

  function skipKeyFor(question) {
    return normalizeQuestion(question) || String(question || '').toLowerCase().trim().slice(0, 200);
  }

  function isSkippedQuestion(question) {
    const key = skipKeyFor(question);
    return Boolean(key && SKIPPED_QUESTIONS[key]);
  }

  function skipScopeFor(pending) {
    const id = pending?.taskId || pending?.runId || pending?.sessionId || '';
    const url = String(pending?.url || location.href || '').split('?')[0].split('#')[0];
    return id ? `task:${id}` : `url:${url}`;
  }

  async function loadSkippedQuestions(pending = null) {
    SKIP_SCOPE = skipScopeFor(pending);
    try {
      const stored = await chrome.storage.local.get(SKIP_STORAGE_KEY);
      const all = stored?.[SKIP_STORAGE_KEY];
      const scoped = all && typeof all === 'object' ? all[SKIP_SCOPE] : null;
      SKIPPED_QUESTIONS = scoped && typeof scoped === 'object' ? scoped : {};
    } catch {
      SKIPPED_QUESTIONS = {};
    }
  }

  async function rememberSkippedQuestion(question) {
    const key = skipKeyFor(question);
    if (!key) return;
    SKIPPED_QUESTIONS[key] = { question: String(question || '').slice(0, 300), at: Date.now() };
    try {
      if (extensionAlive()) {
        const stored = await chrome.storage.local.get(SKIP_STORAGE_KEY);
        const all = stored?.[SKIP_STORAGE_KEY];
        const next = all && typeof all === 'object' && !Array.isArray(all) ? { ...all } : {};
        next[SKIP_SCOPE || 'global'] = SKIPPED_QUESTIONS;
        await chrome.storage.local.set({ [SKIP_STORAGE_KEY]: next });
      }
    } catch {}
    runEvent('question_skipped', { question: String(question || '').slice(0, 200) }, 'Skip pressed — this question will not be asked again.');
    // The dashboard keeps a pending card for the question until it is told
    // otherwise, so the skip has to reach the backend as well.
    if (taskMode()) {
      await taskCall('/api/applications/extension/question/skip', {
        question, reason: 'Skipped by the candidate — do not ask again.',
      }).catch(() => null);
    }
  }

  let filling = false;
  let CURRENT_RUN_ID = '';
  let CURRENT_DRY_RUN = false;
  let NEXT_CLICKS = 0;
  let RESUME_ATTACHED = false;
  let STEP_COUNT = 0;
  let NO_PROGRESS_STEPS = 0;
  let LAST_SIGNATURE = '';
  let TERMINAL_REPORTED = false;

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

  async function askOrSkip(question, index, total, options, reason) {
    // Harness/dry-run never blocks waiting for a human. The question is
    // recorded (so the log shows what was unknowable) and the run continues.
    if (CURRENT_DRY_RUN) {
      runEvent('dry_run_skipped_question', { question: String(question || '').slice(0, 200), reason, options }, 'Dry run: question left unanswered');
      return null;
    }
    // A question the candidate already skipped is not asked again. This is the
    // whole point of the Skip button: pressing it once must silence the
    // question for the rest of the run instead of re-prompting forever.
    if (isSkippedQuestion(question)) {
      runEvent('question_skipped_recall', { question: String(question || '').slice(0, 200) }, 'Question was skipped earlier — not asking again.');
      return { skipped: true };
    }
    // One question never decides the fate of the next one. An earlier timeout
    // must not turn every later question into a silent skip: that is how a run
    // "finishes" with fields nobody answered. Each question is asked on its
    // own, and in task mode the dashboard is an equal answering channel.
    if (!taskMode()) {
      const answer = await askHamzoohQuestion(question, index, total, options, reason);
      if (answer?.skipped) await rememberSkippedQuestion(question);
      return answer;
    }
    let overlaySettled = false;
    const overlay = askHamzoohQuestion(question, index, total, options, reason).then(async (value) => {
      overlaySettled = true;
      if (value?.skipped) await rememberSkippedQuestion(question);
      return value;
    });
    const dashboard = waitForDashboardAnswer(question, 180000).then((value) => {
      if (value?.submitted || value?.cancelled) {
        removeHamzoohOverlays();
        return null;
      }
      if (!value?.answer) return new Promise(() => {}); // keep waiting for the card
      if (!overlaySettled) removeHamzoohOverlays();
      return value;
    });
    const result = await Promise.race([overlay, dashboard]);
    overlaySettled = true;
    return result;
  }

  // Stamped into every console line: when a tab still runs an older content
  // script, the log shows it, instead of looking like a crash in current code.
  const EXT_VERSION = (() => {
    try { return chrome.runtime.getManifest?.().version || ''; } catch { return ''; }
  })();

  function hamzoohLog(level, message, extra) {
    const entry = { level, message, extra, t: Date.now(), href: location.href, version: EXT_VERSION };
    logs.push(entry);
    try { console[level === 'error' ? 'error' : 'log'](`[Hamzooh Apply ${EXT_VERSION || '?'}]`, message, extra || ''); } catch {}
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

  // Workday (and similar ATS pages) render progress navigation and hint text in
  // the same markup as real questions and options. These patterns are never a
  // real question or answer, so they must never reach the user as a prompt.
  const NOISE_PROMPT_RE = /\balert\s*:|verify that the field|item selected|autofill with resume|press delete to (clear|remove)|type to add|\(suggested\)|\b(completed|current)\s+step\s+\d+\s+of\s+\d+\b|\bstep\s+\d+\s+of\s+\d+\b|primaryquestionnaire|questionnaire\s*--|[a-f0-9]{16,}|--[a-f0-9]{6,}|\b(?:pill|chip|token)[-_][a-z0-9_-]+/i;

  // A control's own placeholder/value text ("Select One", "Required") is not a
  // question. Asking it produced cards like "Select One Required" that the
  // candidate could not make sense of.
  const PLACEHOLDER_PROMPT_RE = /^(select( one)?( required)?|choose( an option| a value| one)?( required)?|required|optional|search|type to search|-+|\*)$/i;

  // A dropdown that is still showing its own placeholder ("No Selection",
  // "None Selected", "-- Select --") is empty. Reading that text as a committed
  // value made the run skip the field entirely and click Next with every
  // required question unanswered.
  // "Select an option" is the most common placeholder of all (React-Select,
  // layout-B comboboxes) and used to read as a committed value, so the run
  // skipped the dropdown and the page rejected Next.
  const EMPTY_CHOICE_RE = /^(?:no selections?|none selected|nothing selected|not selected|no value|no answer|select one|select(?:\.\.\.|…)?|select an option|please select|choose(?: an option| a value| one)?|search|type to search|none|-+|—+|\*|required|optional)$/i;

  function isEmptyChoiceText(text) {
    const value = String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/^[-–—:•\s]+|[-–—:•\s]+$/g, '')
      .replace(/\s*\(required\)$/i, '')
      .trim();
    if (!value) return true;
    return EMPTY_CHOICE_RE.test(value);
  }

  // Workday/Angular render the selected pills as text inside the widget, so the
  // scraped "question" becomes "Data Analysis, press delete to clear value. …
  // pill-REMOTE_SKILL-1-31310". Strip that chrome and drop repeated fragments so
  // only the human part (if any) survives.
  function sanitizePromptText(text) {
    const cleaned = String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/\bpress delete to (clear|remove)( the)? value\b/gi, ' ')
      .replace(/\btype to add\b/gi, ' ')
      .replace(/\(suggested\)/gi, ' ')
      .replace(/\b\d+\s+items?\s+selected\b/gi, ' ')
      .replace(/\b(?:pill|chip|token)[-_][A-Za-z0-9_-]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const parts = cleaned.split(/\s*\.\s+/)
      .map((part) => part.replace(/^[,;.\s]+|[,;.\s]+$/g, '').trim())
      .filter(Boolean);
    const seen = new Set();
    const unique = [];
    for (const part of parts) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(part);
    }
    return unique.join(' ').replace(/\s+/g, ' ').trim();
  }

  function isNoisePrompt(text) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return true;
    const value = sanitizePromptText(raw);
    if (!value) return true;
    // Check the widget chrome on the raw text too: sanitising "Data Analysis,
    // press delete to clear value" leaves a value, not a question.
    if (NOISE_PROMPT_RE.test(raw)) return true;
    if (PLACEHOLDER_PROMPT_RE.test(value)) return true;
    // A dropdown's own empty-state label is not a question and not an option.
    if (isEmptyChoiceText(raw)) return true;
    // "No" is a real option on almost every Yes/No question. The old 3-letter
    // rule discarded it, so a dropdown that only offered Yes/No looked like it
    // had a single choice and could never answer "No".
    if (/^(yes|no|y|n|ok)$/i.test(value)) return false;
    if (!/[a-z]{3}/i.test(value)) return true;
    return false;
  }

  function cleanOptions(list) {
    const seen = new Set();
    const out = [];
    for (const raw of list || []) {
      const value = String(raw || '').replace(/\s+/g, ' ').trim();
      if (!value || value.length > 80 || isNoisePrompt(value)) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
      if (out.length >= 15) break;
    }
    return out;
  }

  // Some required dropdowns never textually match the profile value ("B.Tech"
  // vs an option list of "Bachelor's Degree" / "1 - Beginner"). Map the intent
  // onto the closest real option so the field is answered instead of blocking.
  function semanticOptionText(question, optionTexts, profile) {
    const q = String(question || '').toLowerCase();
    const texts = (optionTexts || []).map((t) => String(t).trim()).filter(Boolean);
    if (!texts.length) return '';
    const find = (re) => texts.find((t) => re.test(t));
    const degree = String(profile?.education?.[0]?.degree || profile?.degree || '').toLowerCase();

    if (/degree|qualification|education/.test(q)) {
      if (/ph\.?d|doctor/.test(degree)) return find(/doctor|ph\.?d/i) || find(/master|post.?grad/i) || '';
      if (/master|m\.?tech|mba|m\.?sc|post.?grad/.test(degree)) return find(/master|m\.?tech|mba|m\.?sc|post.?grad/i) || find(/bachelor|b\.?tech|under.?grad/i) || '';
      return find(/bachelor|b\.?tech|b\.?e\b|b\.?sc|under.?grad|graduation/i)
        || find(/high school|diploma|secondary|associate/i) || '';
    }
    // Language self-assessment (Comprehension / Reading / Speaking / Writing /
    // Overall / proficiency). Not a personal or legal fact.
    if (/proficiency|comprehension|reading|speaking|writing|\boverall\b/.test(q)
      || (/language/i.test(q) && texts.some((t) => /\d\s*-\s*(beginner|intermediate|advanced|fluent)/i.test(t)))) {
      return find(/fluent|native|bilingual|5\s*-\s*fluent/i)
        || find(/advanced|4\s*-/i) || find(/intermediate|3\s*-/i) || '';
    }
    // Language name picker: default to the candidate's language, else English.
    if (/language|mother tongue|native language|spoken language/.test(q)) {
      const known = Array.isArray(profile?.languages) ? profile.languages[0] : profile?.language;
      if (known) {
        const hit = find(new RegExp(String(known).replace(/[^a-z0-9]/gi, '.'), 'i'));
        if (hit) return hit;
      }
      return find(/^english/i) || find(/english/i) || '';
    }
    return '';
  }

  const LOGISTICS_QUESTION_RE = /how (did|do) you (hear|find|learn)|hear about (us|our|the company|this|the role|the position)|where did you (see|find|hear)|how did you (come across|find out)|how were you (referred|introduced)|application source|referral source/i;
  function isLogisticsQuestion(text) {
    return LOGISTICS_QUESTION_RE.test(String(text || ''));
  }

  // Preference order for source questions; the first match wins. "LinkedIn"
  // first because that is where most of this candidate's jobs come from.
  const LOGISTICS_OPTION_PRIORITY = [
    /linked.?in/i,
    /job sites?|job boards?|indeed|glassdoor|ziprecruiter|naukri|wellfound/i,
    /career (site|website)|company (site|website)|employer (site|website)|website/i,
    /job alert|job notification|job posting/i,
    /online|internet|web search|search engine|google/i,
    /campus|campus campaign|university|college/i,
    /referral/i,
  ];

  function sourcePatterns(source = '') {
    const s = String(source || '').toLowerCase();
    const priority = [...LOGISTICS_OPTION_PRIORITY];
    if (/referral|employee/.test(s)) priority.unshift(/employee referral|referral/i);
    if (/campus|university|college/.test(s)) priority.unshift(/campus campaign|campus/i);
    if (/linkedin/.test(s)) priority.unshift(/linked.?in/i);
    if (/job alert/.test(s)) priority.unshift(/job alert|job notification/i);
    if (/career|company|website|portal|workday|greenhouse|lever|ashby/.test(s)) priority.unshift(/career websites?|career sites?|company website|employer website/i);
    if (/indeed|naukri|glassdoor|job board|job site/.test(s)) priority.unshift(/job sites?|job boards?|indeed|naukri|glassdoor/i);
    return priority;
  }

  function pickBestOption(nodes, profile = null) {
    const items = (nodes || []).filter((node) => visible(node) && !isNoisePrompt(node.innerText || ''));
    if (!items.length) return null;
    const texts = items.map((node) => String(node.innerText || '').replace(/\s+/g, ' ').trim());
    const patterns = profile ? sourcePatterns(profile.jobSource || profile.source || profile.jobProvider) : LOGISTICS_OPTION_PRIORITY;
    for (const pattern of patterns) {
      const index = texts.findIndex((text) => pattern.test(text));
      if (index >= 0) return { node: items[index], text: texts[index] };
    }
    // Any answer is acceptable for these questions, so fall back to the first
    // real option instead of interrupting the candidate.
    return { node: items[0], text: texts[0] };
  }

  function widgetControl(widget) {
    return widget?.matches?.('input, textarea') ? widget : widget?.querySelector?.('input, textarea');
  }

  // Did the chosen option actually commit to the widget? Workday keeps the
  // value in an input, others render a chip/tag.
  function widgetHasValue(widget) {
    const input = widgetControl(widget);
    const value = String(input?.value || widget?.getAttribute?.('aria-valuetext') || '').trim();
    if (value && !isEmptyChoiceText(value)) return true;
    const chip = widget?.querySelector?.('[class*="pill"], [class*="chip"], [class*="tag"], [class*="selected"], [class*="value"]');
    const chipText = String(chip?.innerText || '').trim();
    return Boolean(chipText && !isEmptyChoiceText(chipText) && !/^select/i.test(chipText));
  }

  // Workday marks required fields with a red asterisk span
  // ([data-automation-id="requiredAsterisk"]) instead of the HTML `required`
  // attribute. Checking only `input.required` silently treats them as optional,
  // so the step gets submitted with empty required fields.
  const REQUIRED_MARKER_SELECTOR = '[data-automation-id="requiredAsterisk"], [data-automation-id*="requiredAsterisk" i], [data-automation-id*="Required" i], abbr[title*="required" i], [aria-required="true"]';

  function isRequiredField(el, question) {
    if (!el) return false;
    const q = question != null ? question : questionFor(el);
    if (el.required || el.getAttribute?.('aria-required') === 'true' || /[*\u2217]/.test(String(q || ''))) return true;
    let node = el;
    for (let depth = 0; node && node !== document.body && depth < 6; depth += 1, node = node.parentElement) {
      if (node.required || node.getAttribute?.('aria-required') === 'true') return true;
      if (node.querySelector?.(REQUIRED_MARKER_SELECTOR)) return true;
      const autoId = String(node.getAttribute?.('data-automation-id') || '').toLowerCase();
      if (autoId.includes('formfield') || autoId.includes('question')) break;
    }
    return false;
  }

  const DROPDOWN_WIDGET_SELECTOR = '[data-automation-id*="select"], [data-automation-id*="dropdown"], [role="combobox"], [aria-haspopup="listbox"], [class*="select__control"], [class*="select-shell"], [class*="select2-container"]';

  function cleanCountryName(str) {
    return String(str || '').replace(/\s*\(\+?\d+\)/g, '').trim();
  }

  function isCustomDropdownControl(el) {
    if (!el) return false;
    if (el.tagName === 'SELECT') return false;
    if (el.matches?.('[role="combobox"], [aria-haspopup="listbox"], [class*="select__control"], [class*="select__input"]')) return true;
    if (el.closest?.('[class*="select__control"], [class*="select-shell"], [data-automation-id*="select"], [data-automation-id*="dropdown"], [class*="select2-container"], [role="combobox"]')) return true;
    return false;
  }

  function getDropdownWidgetFor(el) {
    if (!el) return null;
    return el.closest?.('[class*="select-shell"], [class*="select__control"], [data-automation-id*="select"], [data-automation-id*="dropdown"], [class*="select2-container"], [role="combobox"]') || el;
  }

  function clickOptionNode(node) {
    if (!node) return;
    const mouseOpts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    try { node.dispatchEvent(new MouseEvent('mousedown', mouseOpts)); } catch {}
    try { node.dispatchEvent(new MouseEvent('mouseup', mouseOpts)); } catch {}
    try { node.click(); } catch {}
  }

  function openDropdownWidget(widget) {
    if (!widget) return;
    const control = widget.matches?.('[class*="select__control"], [class*="-control"]')
      ? widget
      : (widget.querySelector?.('[class*="select__control"], [class*="-control"]') || widget);
    const arrow = control.querySelector?.('[class*="select__dropdown-indicator"], [class*="select__indicators"], [class*="indicator"], [class*="arrow"], svg') || control;
    const searchInput = widget.matches?.('input, textarea') ? widget : widget.querySelector?.('input, textarea, [role="combobox"]');

    try { (control || widget).scrollIntoView?.({ block: 'center' }); } catch {}

    const mouseOpts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    try { arrow.dispatchEvent(new MouseEvent('mousedown', mouseOpts)); } catch {}
    try { arrow.dispatchEvent(new MouseEvent('mouseup', mouseOpts)); } catch {}
    try { arrow.click(); } catch {}
    if (control !== arrow) {
      try { control.dispatchEvent(new MouseEvent('mousedown', mouseOpts)); } catch {}
      try { control.dispatchEvent(new MouseEvent('mouseup', mouseOpts)); } catch {}
      try { control.click(); } catch {}
    }
    if (searchInput) {
      try { searchInput.focus(); } catch {}
      try {
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
      } catch {}
    }
  }

  function dropdownControl(widget) {
    if (!widget) return null;
    const arrow = widget.querySelector?.('[class*="select__dropdown-indicator"], [class*="select__indicators"], [class*="indicator"], [class*="arrow"]');
    if (arrow) return arrow;
    if (widget.matches?.('button, [role="combobox"], [role="button"], [aria-haspopup="listbox"], [class*="select__control"]')) return widget;
    return widget.querySelector?.('button, [role="combobox"], [role="button"], [aria-haspopup="listbox"], [class*="select__control"], input, textarea') || widget;
  }

  // Workday and React-Select keep the committed value in custom containers:
  // React-Select renders .select__single-value (and .select__placeholder when empty)
  // Workday renders text inside the button or pill.
  function dropdownHasValue(widget) {
    if (!widget) return false;
    const placeholder = widget.querySelector?.('[class*="select__placeholder"], [class*="-placeholder"]');
    if (placeholder && visible(placeholder)) {
      const pText = String(placeholder.innerText || placeholder.textContent || '').trim();
      if (isEmptyChoiceText(pText) || /select/i.test(pText)) return false;
    }
    const singleVal = widget.querySelector?.('[class*="select__single-value"], [class*="-singleValue"], [class*="select__multi-value"], [class*="value-container"] > [class*="value"]');
    if (singleVal && visible(singleVal)) {
      const text = String(singleVal.innerText || singleVal.textContent || '').trim();
      if (text && !isEmptyChoiceText(text)) return true;
    }
    const control = dropdownControl(widget);
    if (widgetHasValue(control)) return true;
    const text = String(control?.innerText || control?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    if (!control.matches?.('button, [role="combobox"], [role="button"], [aria-haspopup="listbox"], [class*="select__control"]')) return false;
    return !isEmptyChoiceText(text);
  }

  function dropdownWidgets() {
    const modal = findLinkedInModal() || queryAllDeep('.jobs-easy-apply-modal, [role="dialog"], .artdeco-modal').find((m) => visible(m));
    if (/linkedin\.com/i.test(location.hostname) && !modal) return [];
    const root = modal || document;
    const nodes = queryAllDeep(DROPDOWN_WIDGET_SELECTOR, root).filter((el) => {
      if (!visible(el) || el.tagName === 'SELECT' || el.disabled) return false;
      if (el.closest('header, nav, [role="navigation"], [class*="search-global"], [class*="msg-overlay"], [class*="msg-conversation"], [class*="msg-form"], [class*="global-nav"]')) return false;
      return true;
    }).slice(0, 60);
    // Workday nests a button inside the widget wrapper: only the outer element
    // is the field.
    return nodes.filter((el) => !nodes.some((other) => other !== el && other.contains(el)));
  }

  function emptyRequiredDropdowns() {
    return dropdownWidgets().filter((widget) => {
      const question = questionFor(widget);
      if (isNoisePrompt(question)) return false;
      // Voluntary demographic questions are never asked and never block a step.
      if (isEeoQuestion(question)) return false;
      if (dropdownHasValue(widget)) return false;
      return isRequiredField(widget, question);
    });
  }

  // Every required field on this step that still has no value: plain inputs,
  // unchecked required radio/checkbox groups, and custom listbox dropdowns.
  function requiredEmptyFields() {
    // A field the candidate explicitly skipped stays empty on purpose. Counting
    // it again would put the run back into "waiting for your answer" and re-ask
    // the very question they dismissed.
    const empty = collectInputs().filter((input) => {
      const type = (input.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'password', 'submit', 'button'].includes(type)) return false;
      if (!isRequiredField(input, questionFor(input))) return false;
      if (type === 'radio' || type === 'checkbox') return false;
      if (isSkippedQuestion(questionFor(input))) return false;
      return type === 'file' ? !input.files?.length : isPlaceholderValue(input);
    });
    requiredGroupsOf().forEach((group) => {
      if (group.items.some((input) => input.checked)) return;
      if (isSkippedQuestion(group.question || '')) return;
      // EEO/demographic groups are answered with "decline" when offered and
      // otherwise left for the candidate, never turned into a blocking prompt.
      if (isEeoQuestion(group.question || '')) return;
      if (isEeoQuestion(group.items.map((item) => optionTextFor(item)).join(' '))) return;
      empty.push(group.items[0]);
    });
    emptyRequiredDropdowns().forEach((widget) => empty.push(widget));
    return empty.filter((el) => !isSkippedQuestion(questionFor(el)));
  }

  // Apply an answer to whatever the required field is: text box, native select,
  // date group, or a custom Workday listbox.
  async function answerRequiredField(el, question, answer, profile) {
    const wanted = String(answer == null ? '' : answer).trim();
    if (!wanted) return false;
    // Choice answers are stored either way ("true" / "Yes", "false" / "No").
    const choice = /^true$/i.test(wanted) ? 'yes' : /^false$/i.test(wanted) ? 'no' : wanted;
    if (isJoiningDateQuestion(question)) return fillDateControl(el, joiningDateValue(profile));
    if (el.tagName === 'SELECT') return applyChoice(el, choice);
    if (isCustomDropdownControl(el)) return selectCustomOption(getDropdownWidgetFor(el), choice);
    if (dropdownWidgets().includes(el)) return selectCustomOption(el, choice);
    return applyValue(el, wanted);
  }

  function fieldValueText(el) {
    if (!el) return '';
    if (el.tagName === 'SELECT') {
      const chosen = el.options?.[el.selectedIndex];
      return chosen && chosen.value ? String(chosen.text || chosen.value).trim() : '';
    }
    if (isCustomDropdownControl(el)) {
      const widget = getDropdownWidgetFor(el);
      const singleVal = widget.querySelector?.('[class*="select__single-value"], [class*="-singleValue"], [class*="select__multi-value"], [class*="value-container"] > [class*="value"]');
      if (singleVal) {
        const text = String(singleVal.innerText || singleVal.textContent || '').trim();
        if (text && !isEmptyChoiceText(text)) return text;
      }
      const control = dropdownControl(widget);
      const text = String(control?.innerText || control?.textContent || '').replace(/\s+/g, ' ').trim();
      return isEmptyChoiceText(text) ? '' : text;
    }
    if (dropdownWidgets().includes(el)) {
      const control = dropdownControl(el);
      const text = String(control?.innerText || control?.textContent || '').replace(/\s+/g, ' ').trim();
      return isEmptyChoiceText(text) ? '' : text;
    }
    if (el.isContentEditable) return String(el.textContent || '').trim();
    return isPlaceholderValue(el) ? '' : String(el.value || '').trim();
  }

  // The candidate filled a reported field by hand instead of answering in the
  // dashboard. Record it so the pending card clears and the task leaves
  // waiting_for_user_input. It is never saved as a sensitive preference.
  async function recordManualAnswers(unanswered) {
    for (const item of unanswered) {
      const value = fieldValueText(item.el);
      if (!value) continue;
      await taskCall('/api/applications/extension/question/answer', {
        question: item.question,
        answer: value,
        remember: false,
        consent: false,
        options: [],
      }).catch(() => null);
    }
  }

  // Wait WITHOUT stopping the run. The candidate may answer in the Hamzooh
  // dashboard or simply fill the field in the job tab; either one ends the wait
  // and the automation carries on by itself.
  async function waitForRequiredFields(unanswered) {
    const labels = unanswered.map((item) => item.question);
    sendProgress('asking_user', `🔑 ${String(labels[0] || '').slice(0, 70)}`);
    const startedAt = Date.now();
    while (Date.now() - startedAt < TASK_INPUT_WAIT_MS) {
      await sleep(2500);
      const state = await taskState();
      if (state && (state.status === 'cancelled' || state.status === 'failed')) return 'cancel';
      if (state?.status === 'paused') return 'resume';
      const answeredNow = state && (state.answers || []).some((item) => item?.answer
        && labels.includes(item.question));
      if (answeredNow) return 'resume';
      const empty = requiredEmptyFields();
      if (!empty.length) { await recordManualAnswers(unanswered); return 'resume'; }
      const remaining = new Set(empty.map((el) => questionFor(el) || labelFor(el)));
      if (!labels.some((label) => remaining.has(label))) {
        await recordManualAnswers(unanswered);
        return 'resume';
      }
    }
    return 'timeout';
  }

  function sendProgress(step, message, details = {}) {
    if (!extensionAlive()) return;
    try {
      chrome.runtime.sendMessage({
        type: 'HAMZOOH_FILLER_PROGRESS',
        runId: CURRENT_RUN_ID,
        step,
        message,
        timestamp: Date.now(),
        frameUrl: location.href,
        skipped: uniqueSkipped(),
        ...details,
      });
    } catch {}
  }

  // Structured per-run event for the Phase-0 diagnostic log. Unlike
  // sendProgress this also carries counts/snapshots that are not user-facing.
  function runEvent(step, data = {}, message = '') {
    if (!extensionAlive() || !CURRENT_RUN_ID) return;
    try {
      chrome.runtime.sendMessage({
        type: 'HAMZOOH_RUN_EVENT',
        runId: CURRENT_RUN_ID,
        step,
        message,
        data,
        href: location.href,
        frameUrl: location.href,
        t: Date.now(),
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

  async function requestVisionDecision(profile, answers, pending) {
    if (window.__HAMZOOH_TRAIN_MODE__ || pending?.trainMode) return null;
    try {
      const snap = await runtimeSend({ type: 'HAMZOOH_CAPTURE_SCREENSHOT' });
      if (!snap?.ok || !snap.dataUrl) return null;
      const res = await proxyFetch('/api/extension/vision-action', {
        screenshot: snap.dataUrl,
        profile,
        answers,
        jobTitle: pending.jobTitle || '',
        company: pending.company || '',
        url: location.href,
        taskId: CURRENT_TASK_ID,
        taskToken: CURRENT_TASK_TOKEN,
      });
      return res?.data?.decision || null;
    } catch {
      return null;
    }
  }

  // ── Task bridge: the backend is the source of truth, the dashboard approves submission ──
  let CURRENT_TASK_ID = '';
  let CURRENT_TASK_TOKEN = '';
  let TASK_FINAL_REPORTED = false;
  let LAST_VERIFICATION = null;
  const TASK_APPROVAL_WAIT_MS = 20 * 60 * 1000;
  const TASK_PAUSE_WAIT_MS = 15 * 60 * 1000;
  const TASK_INPUT_WAIT_MS = 20 * 60 * 1000;

  function taskMode() {
    return Boolean(CURRENT_TASK_ID && CURRENT_TASK_TOKEN);
  }

  async function taskCall(path, body = {}) {
    if (!taskMode()) return null;
    const res = await proxyFetch(path, { taskId: CURRENT_TASK_ID, token: CURRENT_TASK_TOKEN, ...body });
    return res?.data || null;
  }

  async function taskState() {
    if (!taskMode()) return null;
    const data = await taskCall('/api/applications/extension/state');
    return data?.ok ? data : null;
  }

  // Answered questions on this task, normalized by question text, so the filler
  // can apply a dashboard answer instead of asking the same question again.
  let TASK_ANSWERS_MAP = {};
  let TASK_ANSWERS_REFRESH_AT = 0;
  async function refreshTaskAnswers() {
    if (Date.now() - TASK_ANSWERS_REFRESH_AT < 500) return TASK_ANSWERS_MAP;
    TASK_ANSWERS_REFRESH_AT = Date.now();
    try {
      const snapshot = await taskState();
      const map = {};
      (snapshot?.answers || []).forEach((item) => {
        const question = String(item?.question || '').trim();
        if (question && item?.answer) map[normalizeQuestion(question)] = item.answer;
      });
      TASK_ANSWERS_MAP = map;
    } catch {}
    return TASK_ANSWERS_MAP;
  }

  async function waitForDashboardAnswer(question, timeoutMs = 180000) {
    if (!taskMode()) return null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await sleep(2500);
      const state = await taskState();
      if (!state) continue;
      if (state.status === 'cancelled' || state.status === 'failed') return { cancelled: true };
      const answered = (state.answers || []).find((item) => item.question === question
        || questionSimilarity(normalizeQuestion(item.question || ''), normalizeQuestion(question)) >= 0.45);
      if (answered?.answer) {
        TASK_ANSWERS_MAP[normalizeQuestion(question)] = answered.answer;
        return { answer: answered.answer, via: 'dashboard' };
      }
      // Tell the caller to stop asking instead of leaving it waiting forever on
      // a card for an application that is already finished.
      if (state.status === 'submitted') return { submitted: true };
    }
    return null;
  }

  async function taskCheckpoint(step, message, details = {}) {
    if (!taskMode()) return;
    sendProgress(step, message, details);
    await taskCall('/api/applications/extension/checkpoint', {
      step,
      message,
      url: location.href,
      status: details.status || undefined,
      filledCount: details.filledCount,
      emptyCount: details.emptyCount,
      resumeAttached: details.resumeAttached,
      data: details.data,
    }).catch(() => null);
  }

  function showTaskOverlay({ title, subtitle, body, tone = '#009688', actionLabel = '', onAction = null }) {
    injectHamzoohStyles();
    const existing = document.getElementById('hamzooh-task-panel');
    if (existing) existing.remove();
    const container = createOverlayContainer();
    container.id = 'hamzooh-task-panel';
    container.style.width = '400px';
    container.innerHTML = `
      <div class="hamzooh-card">
        <div class="hamzooh-header" style="background:${tone}">
          <div class="hamzooh-logo">AI</div>
          <div><div class="hamzooh-title">${escapeHtml(title)}</div><div class="hamzooh-subtitle">${escapeHtml(subtitle || 'Hamzooh Apply')}</div></div>
        </div>
        <div class="hamzooh-body"><div class="hamzooh-question">${escapeHtml(body || '')}</div></div>
        ${actionLabel ? `<div class="hamzooh-footer"><button class="hamzooh-btn hamzooh-btn-primary" id="hamzooh-task-action">${escapeHtml(actionLabel)}</button></div>` : ''}
      </div>`;
    document.body.appendChild(container);
    if (actionLabel && onAction) {
      container.querySelector('#hamzooh-task-action').addEventListener('click', () => {
        container.remove();
        onAction();
      });
    }
    return container;
  }

  function hideTaskOverlay() {
    document.getElementById('hamzooh-task-panel')?.remove();
  }

  async function handleTaskQuestion(question) {
    if (!question?.question) return null;
    const answer = await withTimeout(
      askHamzoohQuestion(
        question.question,
        Number(question.index || 0),
        Number(question.total || 1),
        question.options || [],
        question.reason || 'Hamzooh needs this detail before it can continue.',
        question.sensitive === true,
      ),
      180000,
      null,
    );
    if (!answer?.answer) return null;
    const saved = await taskCall('/api/applications/extension/question/answer', {
      question: question.question,
      answer: answer.answer,
      remember: question.sensitive ? false : answer.remember !== false,
      consent: false,
      options: question.options || [],
    });
    removeHamzoohOverlays();
    return saved ? answer.answer : null;
  }

  async function taskGate() {
    if (!taskMode()) return 'run';
    const state = await taskState();
    if (!state) return 'run';
    if (state.status === 'cancelled' || state.status === 'failed') return 'cancel';
    if (state.status === 'paused') {
      showTaskOverlay({
        title: 'Application paused',
        subtitle: 'Your progress is saved',
        body: 'Paused from the Hamzooh dashboard. Resume it there and this tab will continue automatically.',
        tone: 'linear-gradient(135deg,#d97706,#f59e0b)',
      });
      const startedAt = Date.now();
      while (Date.now() - startedAt < TASK_PAUSE_WAIT_MS) {
        await sleep(3000);
        const next = await taskState();
        if (!next) continue;
        if (next.status === 'cancelled' || next.status === 'failed') { hideTaskOverlay(); return 'cancel'; }
        if (next.status !== 'paused') { hideTaskOverlay(); return 'run'; }
      }
      hideTaskOverlay();
      return 'paused_timeout';
    }
    if (state.status === 'waiting_for_user_input') {
      const pending = (state.questions || []).find((item) => item.status === 'pending');
      if (pending) await handleTaskQuestion(pending);
    }
    return 'run';
  }

  /**
   * Submit the prepared application for dashboard review and wait for an
   * explicit approval. This is the only path to submission for task runs.
   */
  async function waitForDashboardApproval(review) {
    // If the candidate already approved this application and the tab had to be
    // reopened, do not send a fresh review (that would reset approval). Go
    // straight to the approved submission path.
    const preflight = await taskState();
    if (preflight?.approval?.status === 'approved' && preflight.status !== 'submitted') {
      showTaskOverlay({
        title: 'Approved — submitting',
        subtitle: `${review.company || 'Application'} · ${review.title || 'Role'}`,
        body: 'This application was already approved in the Hamzooh dashboard. Submitting and verifying the site response now.',
        tone: 'linear-gradient(135deg,#2e7d32,#43a047)',
      });
      hideTaskOverlay();
      return { decision: 'approve' };
    }

    const submitted = await taskCall('/api/applications/extension/review', review);
    if (!submitted || submitted.ok !== true) {
      const pending = Array.isArray(submitted?.questions) ? submitted.questions : [];
      if (pending.length) {
        // The review exposed required fields that still need a human answer.
        // Ask the first one in-page (or wait for the dashboard answer), then
        // resume filling instead of ending the run.
        const answered = await handleTaskQuestion(pending[0]);
        if (answered) {
          return { decision: 'resume', message: 'Answer received. Continuing the application.' };
        }
      }
      return {
        decision: 'needs_user',
        message: submitted?.error || 'Could not send this application to Hamzooh for review. Check the browser connection.',
      };
    }

    showTaskOverlay({
      title: 'Ready for your approval',
      subtitle: `${review.company || 'Application'} · ${review.title || 'Role'}`,
      body: `${review.filledCount || 0} field(s) filled · resume: ${review.resumeName || review.resume || 'selected'}. Open the Hamzooh dashboard and click Approve & Submit. Hamzooh will never submit without that click.`,
      tone: 'linear-gradient(135deg,#2e7d32,#43a047)',
    });

    const startedAt = Date.now();
    let handledQuestionId = '';
    while (Date.now() - startedAt < TASK_APPROVAL_WAIT_MS) {
      await sleep(2500);
      const state = await taskState();
      if (!state) continue;
      if (state.status === 'cancelled' || state.approval?.status === 'cancelled') {
        hideTaskOverlay();
        return { decision: 'cancel', message: 'Cancelled from the Hamzooh dashboard.' };
      }
      if (state.status === 'submitted') {
        hideTaskOverlay();
        return { decision: 'already_submitted', result: state.result };
      }
      if (state.status === 'paused') {
        hideTaskOverlay();
        return { decision: 'needs_user', message: 'Paused from the Hamzooh dashboard. Resume when you are ready.' };
      }
      if (state.approval?.status === 'approved' || state.status === 'submitting') {
        hideTaskOverlay();
        return { decision: 'approve' };
      }
      if (state.status === 'filling_application') {
        hideTaskOverlay();
        return { decision: 'resume', message: 'Answer received. Continuing the application.' };
      }
      const pending = (state.questions || []).find((item) => item.status === 'pending');
      if (pending && pending.id !== handledQuestionId) {
        handledQuestionId = pending.id;
        hideTaskOverlay();
        const answer = await handleTaskQuestion(pending);
        if (answer) return { decision: 'resume', message: 'Answer received. Continuing the application.' };
        showTaskOverlay({
          title: 'Waiting for your answer',
          subtitle: 'Hamzooh dashboard',
          body: `This application still needs: ${pending.question}`,
          tone: 'linear-gradient(135deg,#d97706,#f59e0b)',
        });
      }
    }
    hideTaskOverlay();
    return {
      decision: 'timeout',
      message: 'Waiting for approval timed out. The application stays prepared in the job tab — approve or cancel it from the Hamzooh dashboard.',
    };
  }

  async function finishTaskRun(message, details = {}) {
    if (!taskMode() || TASK_FINAL_REPORTED) return;
    TASK_FINAL_REPORTED = true;
    const status = details.status || 'needs_attention';
    // A dashboard pause wins over an agent-side stop: keep the task paused so
    // the candidate can resume it deliberately.
    if (status === 'needs_attention') {
      const state = await taskState();
      if (state?.status === 'paused') return;
    }
    const verified = status === 'submitted' && Boolean(details.verified || LAST_VERIFICATION?.ok);
    await taskCall('/api/applications/extension/complete', {
      status,
      message,
      reasonCode: details.reasonCode || '',
      question: details.question || '',
      options: details.options || [],
      filledCount: details.filledCount || 0,
      emptyCount: details.emptyCount || 0,
      verified,
      confirmation: LAST_VERIFICATION?.reason || details.confirmation || '',
      confirmationUrl: LAST_VERIFICATION?.url || location.href,
      url: location.href,
    }).catch(() => null);
  }

  let trainingRecorderActive = false;
  const recordedSteps = [];
  const recordedAnswers = {};

  function initTrainModeRecorder(domain, pending) {
    if (trainingRecorderActive) return;
    trainingRecorderActive = true;
    sendProgress('train_active', `🎓 Training Mode Active for ${domain}. Fill the form manually — AI is recording!`);

    let banner = document.getElementById('hamzooh-train-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'hamzooh-train-banner';
      banner.style.cssText = `
        position: fixed;
        top: 14px;
        right: 18px;
        z-index: 2147483647;
        background: linear-gradient(135deg, #059669, #10b981);
        color: white;
        padding: 14px 20px;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 14px;
        border: 1px solid rgba(255,255,255,0.25);
      `;
      banner.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:2px;">
          <span style="font-size:14px; font-weight:700;">🎓 Training Mode: Recording Active</span>
          <span style="font-size:11.5px; opacity:0.9;">Apply manually. Every action & answer is being recorded for future automation!</span>
        </div>
        <button id="hamzooh-save-train-btn" style="background: white; color: #047857; border: none; border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">Save & Finish</button>
      `;
      document.body.appendChild(banner);
    }

    const saveAndFinish = async () => {
      try {
        banner.innerHTML = `<span>⏳ Saving learned blueprint for ${domain}...</span>`;
        const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
        await fetch('http://localhost:3000/api/blueprints/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain: cleanDomain,
            blueprint: {
              domain: cleanDomain,
              portalName: `${cleanDomain} Flow`,
              steps: recordedSteps,
              customAnswers: recordedAnswers,
              learnedAt: new Date().toISOString(),
            },
          }),
        });

        for (const [q, a] of Object.entries(recordedAnswers)) {
          await syncAnswerToServer(q, a, true);
        }

        banner.style.background = 'linear-gradient(135deg, #0284c7, #38bdf8)';
        banner.innerHTML = `<span>🎉 Blueprint Saved! Future applications on ${domain} will apply automatically with 100% accuracy.</span>`;
        sendProgress('train_complete', `🎉 Learned blueprint saved for ${domain}! Future jobs will auto-apply with 100% accuracy.`);
        setTimeout(() => { banner?.remove(); }, 6000);
      } catch (err) {
        banner.innerHTML = `<span>⚠️ Could not save blueprint: ${err.message}</span>`;
      }
    };

    document.getElementById('hamzooh-save-train-btn')?.addEventListener('click', saveAndFinish);

    const clickHandler = (e) => {
      const target = e.target.closest('button, a, input[type="submit"], [role="button"]');
      if (!target || target.closest('#hamzooh-train-banner')) return;
      const text = (target.innerText || target.getAttribute('aria-label') || target.value || '').trim();
      recordedSteps.push({
        action: 'click',
        tag: target.tagName.toLowerCase(),
        text: text.slice(0, 80),
        id: target.id || '',
        classes: target.className ? String(target.className).slice(0, 100) : '',
        timestamp: Date.now(),
      });
      sendProgress('train_record', `📍 Recorded click: "${text.slice(0, 40) || target.tagName}"`);

      if (/submit application|submit|done|finish/i.test(text)) {
        setTimeout(saveAndFinish, 1500);
      }
    };

    const inputHandler = (e) => {
      const el = e.target;
      if (!el || !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      const label = labelFor(el);
      const val = el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? (el.value || 'yes') : 'no') : el.value;
      if (label && val) {
        recordedAnswers[label] = val;
        sendProgress('train_record', `📝 Learned answer: "${label.slice(0, 35)}" → "${String(val).slice(0, 25)}"`);
      }
    };

    document.addEventListener('click', clickHandler, true);
    document.addEventListener('change', inputHandler, true);
    document.addEventListener('input', inputHandler, true);
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

  // Workday/Angular ATS put the question in a sibling <label> or a
  // [data-automation-id="formLabel"] block that is not tied to the control by
  // `for`/`aria-labelledby`. Without walking up to the field wrapper, the only
  // text available is the internal id ("primaryQuestionnaire--a2c6…"), so the
  // question is never looked up and the field is left empty.
  const LABEL_TEXT_SELECTOR = 'label, legend, [data-automation-id="formLabel"], [data-automation-id*="formLabel"], [data-automation-id*="questionLabel"], [class*="formLabel"], [class*="field-label"], [class*="question-label"], [class*="labelText"]';
  const NOT_A_LABEL_SELECTOR = '[data-automation-id*="error" i], [data-automation-id*="help" i], [role="alert"], .error, [class*="error"], [class*="hint"], [class*="help"]';

  function labelTextOf(node) {
    if (!node) return '';
    const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 300) return '';
    if (text.replace(/[*\s:]/g, '').length < 3) return '';
    return text;
  }

  function nearestLabelText(el) {
    let node = el;
    for (let depth = 0; node && node !== document.body && depth < 8; depth += 1, node = node.parentElement) {
      const explicit = el.id ? node.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
      if (explicit && !explicit.closest(NOT_A_LABEL_SELECTOR)) {
        const text = labelTextOf(explicit);
        if (text) return text;
      }
      for (const candidate of node.querySelectorAll(LABEL_TEXT_SELECTOR)) {
        if (candidate === el || candidate.contains(el)) continue;
        if (candidate.closest(NOT_A_LABEL_SELECTOR)) continue;
        if (candidate.querySelector('input, select, textarea')) continue;
        const text = labelTextOf(candidate);
        if (text) return text;
      }
      const autoId = String(node.getAttribute?.('data-automation-id') || '').toLowerCase();
      if (autoId.includes('formfield') || autoId.includes('question')) break;
    }
    return '';
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
      const nearest = nearestLabelText(input);
      if (nearest) {
        return [nearest, input.getAttribute('placeholder') || '', input.name || '']
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

  // Resolve the human question for a control. Internals sometimes expose an
  // internal id ("primaryQuestionnaire--a2c6...") or the widget's own selected
  // pills ("Data Analysis, press delete to clear value"); neither is a question,
  // so fall back to the field's own label/aria, then to a readable automation id,
  // and only then to '' rather than showing engine internals to the candidate.
  const AUTOMATION_LABELS = [
    { test: /remote.?skill|skills?/i, label: 'Which skills should be listed on this application?' },
    { test: /language/i, label: 'Which languages do you speak?' },
    { test: /source|hear.?about/i, label: 'How did you hear about us?' },
    { test: /country/i, label: 'Country' },
    { test: /degree|education|school|university/i, label: 'Education' },
    { test: /website|portfolio|linkedin|github/i, label: 'Link' },
    { test: /relocat|location/i, label: 'Location preference' },
  ];

  const GENERIC_ID_WORDS = new Set([
    'form', 'field', 'formfield', 'input', 'select', 'dropdown', 'listbox', 'combobox', 'multi',
    'multiselect', 'questionnaire', 'primary', 'required', 'options', 'option', 'value',
    'container', 'wrapper', 'control', 'button', 'text', 'date', 'number', 'search', 'prompt',
  ]);

  // "formField-degree" / "languageSelect" -> "Degree" / "Language" so the
  // candidate sees a labelled field instead of a raw automation id.
  function humanizeAutomationId(tokens) {
    return String(tokens || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^A-Za-z]+/)
      .filter((word) => word && word.length > 2 && !GENERIC_ID_WORDS.has(word.toLowerCase()))
      .slice(0, 4)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  function fieldLabelFromAutomationId(el) {
    const own = [
      el.getAttribute?.('data-automation-id'),
      el.getAttribute?.('name'),
      el.getAttribute?.('id'),
    ].filter(Boolean).join(' ');
    // Only the field's own wrapper counts: walking further up would label every
    // field inside a section with that section's name.
    const wrapper = el.closest?.('[data-automation-id*="formField"], [data-automation-id*="question"]');
    const wrapperId = wrapper?.getAttribute('data-automation-id') || '';
    const scoped = `${own} ${wrapperId}`.trim();
    if (!scoped) return '';
    const hit = AUTOMATION_LABELS.find((item) => item.test.test(scoped));
    if (hit) return hit.label;
    // Some widgets carry the meaningful id on an inner pill/tag, not the wrapper.
    for (const node of el.querySelectorAll?.('[data-automation-id]') || []) {
      const id = node.getAttribute('data-automation-id') || '';
      const mapped = AUTOMATION_LABELS.find((item) => item.test.test(id));
      if (mapped) return mapped.label;
    }
    const humanized = humanizeAutomationId(scoped);
    return humanized.length >= 3 ? humanized : '';
  }

  // aria-labelledby and the visual <label> often carry the same sentence, and
  // questionForRaw joins both. The candidate then saw "…job? …job?" on the
  // prompt card. Collapse an exact repeat while keeping a genuinely different
  // second clause.
  function dedupeRepeatedPrompt(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) return value;
    const half = Math.floor(value.length / 2);
    for (const cut of [half, Math.ceil(value.length / 2)]) {
      const left = value.slice(0, cut).trim();
      const right = value.slice(cut).trim();
      if (left && left === right) return left;
      if (left && right && left.toLowerCase() === right.toLowerCase()) return left;
    }
    return value;
  }

  function questionFor(el) {
    const originalRaw = questionForRaw(el);
    const raw = dedupeRepeatedPrompt(sanitizePromptText(originalRaw));
    if (raw && !isNoisePrompt(originalRaw)) return raw;
    const labelledBy = el.getAttribute?.('aria-labelledby')
      ? String(el.getAttribute('aria-labelledby')).split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || '').join(' ')
      : '';
    const placeholder = el.getAttribute?.('placeholder') || '';
    const candidates = [
      el.getAttribute?.('aria-label') || '',
      labelledBy,
      /^(search|select|type|enter|choose)/i.test(placeholder) ? '' : placeholder,
      promptBefore(el.closest('.field, .form-group, fieldset, li, div') || el),
      nearestLabelText(el),
      labelFor(el),
    ];
    for (const candidate of candidates) {
      const value = dedupeRepeatedPrompt(sanitizePromptText(candidate));
      if (value && !isNoisePrompt(candidate)) return value;
    }
    const derived = fieldLabelFromAutomationId(el);
    if (derived) return derived;
    // Last resort for a real dropdown with no label at all: still ask something
    // a person can act on, with the options shown in the dashboard card.
    const widgetTokens = `${el.getAttribute?.('data-automation-id') || ''} ${el.getAttribute?.('role') || ''} ${el.getAttribute?.('aria-haspopup') || ''}`;
    if (/select|dropdown|listbox|combobox/i.test(widgetTokens)) return 'Which option should be selected for this required field?';
    return '';
  }

  // The question a radio/checkbox option belongs to. The option's own label
  // ("Yes") is never the question: the prompt lives in a legend, a group
  // wrapper, or the text block directly above the options.
  function groupPromptForChoice(el, type = '') {
    const legend = cleanPrompt(el.closest('fieldset')?.querySelector('legend')?.innerText);
    if (legend) return legend;
    const widget = el.closest('mat-radio-group, mat-checkbox-group, [role="radiogroup"], [role="group"]');
    if (widget) {
      const aria = cleanPrompt(widget.getAttribute('aria-label') || '');
      if (aria) return aria;
      const by = (widget.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
        .map((id) => document.getElementById(id)?.innerText || '').join(' ');
      const byText = cleanPrompt(by);
      if (byText) return byText;
      const prompt = promptBefore(widget) || promptInside(widget);
      if (prompt) return prompt;
    }
    // Every option label in the enclosing group; a candidate prompt that equals
    // one of them is another option, not the question.
    let groupNode = el;
    while (groupNode && groupNode !== document.body
      && groupNode.querySelectorAll('input[type="radio"], input[type="checkbox"]').length < 2) {
      groupNode = groupNode.parentElement;
    }
    const optionTexts = groupNode && groupNode !== document.body
      ? [...groupNode.querySelectorAll('input[type="radio"], input[type="checkbox"]')]
        .map((input) => normalizeQuestion(optionTextFor(input))).filter(Boolean)
      : [];
    const notOption = (text) => {
      if (!text) return false;
      const norm = normalizeQuestion(text);
      return Boolean(norm) && !optionTexts.includes(norm);
    };
    const container = choiceGroupContainer(el, type === 'checkbox' ? 'checkbox' : 'radio');
    if (container) {
      for (const candidate of [promptBefore(container), promptInside(container)]) {
        if (notOption(candidate)) return candidate;
      }
    }
    let node = el.closest('label') || el;
    for (let depth = 0; depth < 6 && node && node !== document.body; depth += 1, node = node.parentElement) {
      const candidate = promptBefore(node);
      if (notOption(candidate) && !isNoisePrompt(candidate)) return candidate;
    }
    return '';
  }

  function questionForRaw(el) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').trim();
    const labelledBy = (el.getAttribute('aria-labelledby') || '');
    const labelledByText = labelledBy.split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)?.innerText || '').join(' ').replace(/\s+/g, ' ').trim();
    const legend = cleanPrompt(el.closest('fieldset')?.querySelector('legend')?.innerText);
    const labelText = cleanPrompt(labelFor(el));

    // AEM/Siemens labels every option with aria-label = option text, so the
    // aria label is not the question. Use the group's own prompt instead, or
    // the option sentence became the question the candidate had to answer.
    const isChoice = type === 'radio' || type === 'checkbox'
      || el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'checkbox';
    if (isChoice) {
      const groupPrompt = groupPromptForChoice(el, type);
      const optionText = cleanPrompt(optionTextFor(el));
      if (groupPrompt
        && normalizeQuestion(groupPrompt) !== normalizeQuestion(optionText)
        && !isNoisePrompt(groupPrompt)) {
        return groupPrompt;
      }
    }

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
      if (own && own.length > 12 && !isNoisePrompt(own)) return own;
      return isNoisePrompt(labelText) ? '' : labelText;
    }

    const merged = cleanPrompt([legend, labelText].filter(Boolean).join(' '));
    return isNoisePrompt(merged) ? '' : merged;
  }

  function extractLocationFromText(text) {
    if (!text) return '';
    const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    const nameIndex = lines.findIndex((l) => /^[A-Za-z][A-Za-z .'-]{2,45}$/.test(l));
    const candidates = lines.slice(Math.max(0, nameIndex + 1), Math.min(lines.length, (nameIndex >= 0 ? nameIndex + 5 : 5)));
    return candidates
      .map((l) => l.replace(/[⋄|•]/g, ' ').replace(/\s+/g, ' ').trim())
      .find((l) => /[A-Za-z]/.test(l) && /,/.test(l) && !/@|https?:\/\/|linkedin|github|\+?\d[\d\s().-]{7,}/i.test(l)) || '';
  }

  function parseLocationString(locStr) {
    const parts = String(locStr || '').split(',').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return { city: '', district: '', state: '', country: '', zip: '' };
    let country = '';
    let zip = '';
    let state = '';
    let city = '';
    let district = '';

    const cleanParts = [];
    for (const part of parts) {
      if (/^\d{5,6}(-\d{4})?$/.test(part)) {
        zip = part;
      } else {
        cleanParts.push(part);
      }
    }

    if (cleanParts.length === 1) {
      city = cleanParts[0];
    } else if (cleanParts.length === 2) {
      city = cleanParts[0];
      state = cleanParts[1];
    } else if (cleanParts.length === 3) {
      city = cleanParts[0];
      state = cleanParts[1];
      country = cleanParts[2];
    } else if (cleanParts.length >= 4) {
      city = cleanParts[0];
      district = cleanParts[1];
      state = cleanParts[cleanParts.length - 2];
      country = cleanParts[cleanParts.length - 1];
    }
    return { city, district, state, country, zip };
  }

  function profileValue(profile, key, jobTitle, company) {
    const name = profile.fullName || '';
    const [first, ...rest] = name.split(' ').filter(Boolean);
    const education = profile.education?.[0] || {};
    const experienceRaw = profile.experience || profile.internships || [];
    // Profiles can store experience as a list of roles or as a plain
    // "7 years" string; both must be safe here or the whole run crashes.
    const internships = Array.isArray(experienceRaw) ? experienceRaw : [];
    const experienceYears = profile.yearsOfExperience ?? profile.yearsExperience
      ?? (typeof experienceRaw === 'string' || typeof experienceRaw === 'number' ? experienceRaw : internships.length);
    const skills = Array.isArray(profile.skills)
      ? profile.skills
      : String(profile.skills || '').split(',').map((s) => s.trim()).filter(Boolean);
    const intern = internships.map((item) => [item?.title, item?.company, item?.dates].filter(Boolean).join(' - ')).filter(Boolean).join('; ');
    const projects = profile.projects || [];
    const projectUrl = projects.map((p) => p.link || p.url).find(Boolean)
      || profile.links?.github || profile.github || profile.links?.portfolio || '';
    const phoneDigits = String(profile.phone || '').replace(/\D/g, '');
    const rawLoc = profile.location || profile.currentLocation || extractLocationFromText(profile.resumeText || profile.resume?.text || '');
    const parsedLoc = parseLocationString(rawLoc);
    const firstPart = (value) => String(value || '').split(',')[0].trim();
    const map = {
      email: profile.email || '',
      phone: phoneDigits.length > 10 ? phoneDigits.slice(-10) : phoneDigits,
      phoneExtension: '',
      firstName: first || '',
      lastName: rest.join(' ') || '',
      fullName: name,
      address: profile.address || profile.street || '',
      city: firstPart(profile.city) || firstPart(profile.town) || parsedLoc.city || '',
      state: firstPart(profile.state) || firstPart(profile.province) || parsedLoc.state || '',
      zip: String(profile.zip || profile.postalCode || profile.pincode || parsedLoc.zip || '').trim(),
      country: String(profile.country || parsedLoc.country || '').trim() || 'India',
      location: rawLoc || '',
      linkedin: profile.links?.linkedin || profile.linkedin || '',
      github: profile.links?.github || profile.github || '',
      portfolio: profile.links?.portfolio || profile.portfolio || profile.links?.github || profile.github || '',
      projectLink: projectUrl,
      university: education.school || education.university || education.institution || education.college || '',
      gpa: education.gpa || education.cgpa || education.detail || education.score || '',
      internship: intern || '',
      degree: [education.degree, education.branch].filter(Boolean).join(' ') || '',
      graduation: education.dates || education.graduationYear || profile.batch || '',
      salary: salaryFromProfile(profile),
      salaryCurrency: currencyForProfile(profile),
      experience_years: String(experienceYears || '0'),
      codechef: profile.codechef || profile.codechefRating || '',
      codeforces: profile.codeforces || profile.codeforcesRating || '',
      leetcode: profile.leetcode || profile.leetcodeRating || '',
      hackerrank: profile.hackerrank || profile.hackerrankRating || '',
      cover_letter: `I am excited to apply for the ${jobTitle || 'position'} at ${company || 'your company'}. With my background in ${skills.slice(0, 4).join(', ') || 'software development'}, I am confident in my ability to contribute effectively.`,
    };
    return String(map[key] || '').trim();
  }

  // Person-name fields must be properly capitalized ("NELLURU JASWANTH" ->
  // "Nelluru Jaswanth"). Workday rejects/ warns about all-caps names.
  function isPersonNameField(label) {
    const text = String(label || '').toLowerCase();
    if (/company|employer|university|college|school|institute|organization|organisation|project|reference|manager|contact|emergency|account|user.?name|file|document|country|city/.test(text)) return false;
    return /first name|given name|last name|family name|surname|middle name|full name|legal name|preferred name|local first name|local primary|local last name|applicant name|candidate name|your name|^name$|^full ?name$/.test(text);
  }

  function titleCaseName(value) {
    const raw = String(value || '').trim();
    if (!raw) return raw;
    const letters = raw.replace(/[^A-Za-z]/g, '');
    const isAllCaps = letters.length > 0 && letters === letters.toUpperCase();
    const isAllLower = letters.length > 0 && letters === letters.toLowerCase();
    // Preserve names that are already correctly mixed (e.g. "McDonald").
    if (!isAllCaps && !isAllLower) return raw;
    return raw.split(/\s+/).map((word) => word
      .split(/([-'’])/).map((part) => (
        part && !/[-'’]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part
      )).join('')).join(' ');
  }

  function normalizePhoneValue(label, value) {
    if (!/phone|mobile|\btel\b|telephone|cell/i.test(label) || /extension|\bext\b/i.test(label)) return value;
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
    if (digits.length > 10) return digits.slice(-10);
    return digits || value;
  }

  function normalizeNoticePeriod(label, value) {
    if (!/notice\s*period/i.test(label)) return value;
    const text = String(value || '').trim().toLowerCase();
    if (/in\s+days|days/i.test(label)) {
      if (/immediate|immediately|none|fresh|na|n\/a|^0\b/.test(text)) return '0';
      const mMatch = text.match(/(\d+)\s*month/);
      if (mMatch) return String(Number(mMatch[1]) * 30);
      const dMatch = text.match(/(\d+)\s*day/);
      if (dMatch) return dMatch[1];
      const digits = text.replace(/\D/g, '');
      if (digits) return digits;
      return '0';
    }
    return value;
  }

  function normalizeExperience(label, value) {
    if (!/total\s*experience|years\s*of\s*experience/i.test(label)) return value;
    const text = String(value || '').trim().toLowerCase();
    if (/in\s*years|years/i.test(label)) {
      if (/fresher|student|none|fresh|immediate|^0\b/.test(text)) return '0';
      const digits = text.replace(/[^\d.]/g, '');
      if (digits) return digits;
      return '0';
    }
    return value;
  }

  function normalizeValueForInput(input, value) {
    if (!input || typeof value !== 'string' || input.tagName === 'SELECT') return value;
    const label = `${labelFor(input)} ${input.getAttribute?.('name') || ''} ${input.getAttribute?.('placeholder') || ''} ${input.getAttribute?.('aria-label') || ''}`;
    let normalized = isPersonNameField(label) ? titleCaseName(value) : value;
    normalized = normalizePhoneValue(label, normalized);
    normalized = normalizeNoticePeriod(label, normalized);
    normalized = normalizeExperience(label, normalized);
    normalized = normalizeNumericValue(input, label, normalized);
    return normalizeDateOrMonthInput(input, label, normalized);
  }

  const MONTH_NAMES = {
    january: '01', jan: '01',
    february: '02', feb: '02',
    march: '03', mar: '03',
    april: '04', apr: '04',
    may: '05',
    june: '06', jun: '06',
    july: '07', jul: '07',
    august: '08', aug: '08',
    september: '09', sep: '09', sept: '09',
    october: '10', oct: '10',
    november: '11', nov: '11',
    december: '12', dec: '12',
  };

  function normalizeDateOrMonthInput(input, label, value) {
    if (!input || value == null) return value;
    const text = String(value).trim();
    if (!text) return value;
    const lower = text.toLowerCase();
    const type = (input.getAttribute?.('type') || input.type || '').toLowerCase();
    const isMonth = type === 'month' || /month|\bmm\b/i.test(label) || (typeof datePartKind === 'function' && datePartKind(input) === 'month');
    const monthNum = MONTH_NAMES[lower];

    // 1. <input type="month"> strictly requires YYYY-MM in Blink/Chromium
    if (type === 'month') {
      if (monthNum) {
        const year = new Date().getFullYear();
        return `${year}-${monthNum}`;
      }
      const ym = text.match(/^(\d{4})[-/](\d{1,2})$/);
      if (ym) return `${ym[1]}-${ym[2].padStart(2, '0')}`;
      const my = text.match(/^(\d{1,2})[-/](\d{4})$/);
      if (my) return `${my[2]}-${my[1].padStart(2, '0')}`;
      const nameYear = text.match(/^([a-zA-Z]+)\s+(\d{4})$/);
      if (nameYear && MONTH_NAMES[nameYear[1].toLowerCase()]) {
        return `${nameYear[2]}-${MONTH_NAMES[nameYear[1].toLowerCase()]}`;
      }
      if (/^\d{4}-\d{2}$/.test(text)) return text;
      return `${new Date().getFullYear()}-01`;
    }

    // 2. <input type="date"> strictly requires YYYY-MM-DD
    if (type === 'date') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
        const [mm, dd, yyyy] = text.split('/');
        return `${yyyy}-${mm}-${dd}`;
      }
      if (monthNum) {
        const year = new Date().getFullYear();
        return `${year}-${monthNum}-01`;
      }
      const parsed = Date.parse(text);
      if (!isNaN(parsed)) {
        const d = new Date(parsed);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
      }
      return '';
    }

    // 3. <input type="number"> strictly requires numeric characters
    if (type === 'number') {
      if (monthNum) return String(Number(monthNum));
      const digits = text.replace(/[^\d.-]/g, '');
      return digits;
    }

    // 4. Text or custom inputs for month fields
    if (isMonth && monthNum) {
      const maxLen = input.getAttribute?.('maxlength');
      const placeholder = (input.getAttribute?.('placeholder') || '').toLowerCase();
      if (maxLen === '2' || placeholder === 'mm' || input.getAttribute?.('inputmode') === 'numeric') {
        return monthNum;
      }
      if (placeholder === 'm' || /^\s*m\s*$/.test(placeholder)) {
        return String(Number(monthNum));
      }
      return monthNum;
    }

    return value;
  }

  // A salary saved as "3LPA" / "₹30,000" must reach a numeric Workday input as
  // digits, or the site rejects it. Only money labels are converted.
  function normalizeNumericValue(input, label, value) {
    const text = String(value || '').trim();
    if (!text || !/\d/.test(text)) return value;
    if (!/salary|compensation|\bctc\b|stipend|annual pay|expected pay|amount|remuneration/i.test(label)) return value;
    const inLacs = /\b(?:in\s+lacs?|in\s+lakhs?|lacs?\s+per\s+annum|lakhs?\s+per\s+annum)\b/i.test(label);
    const lpa = text.replace(/[,\s]/g, '').match(/^(\d+(?:\.\d+)?)(lpa|lakh|lakhs|lac|lacs)$/i);
    if (lpa) {
      return inLacs ? lpa[1] : String(Math.round(Number(lpa[1]) * 100000));
    }
    const digits = text.replace(/^(?:inr|rs\.?|\u20b9)/i, '').replace(/[,\s\u20b9]/g, '');
    if (/^\d+(?:\.\d+)?$/.test(digits)) {
      if (inLacs && Number(digits) >= 10000) {
        return (Number(digits) / 100000).toFixed(1).replace(/\.0$/, '');
      }
      return digits;
    }
    return value;
  }

  function squashValue(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // True only when the field already holds the value we would fill. An empty or
  // WRONG value returns false so the caller corrects it ("Naidupeta, Tirupati
  // District, ..." in a City field must be replaced with "Naidupeta").
  function inputHasExpectedValue(input, expected) {
    const exp = squashValue(expected);
    if (!exp) return false;
    const label = labelFor(input);
    if (input.tagName === 'SELECT') {
      const chosen = input.options?.[input.selectedIndex];
      const text = squashValue(chosen?.text || '');
      if (!text || /^(select|choose|pleaseselect)/.test(text)) return false;
      return text === exp || text.includes(exp) || exp.includes(text);
    }
    if (isCustomDropdownControl(input)) {
      const widget = getDropdownWidgetFor(input);
      return dropdownHasValue(widget);
    }
    if (isPlaceholderValue(input)) return false;
    const current = squashValue(input.value);
    if (!current) return false;

    // Person name: if current value is ALL CAPS (e.g. Workday autofill put "NELLURU"), it must be corrected!
    if (isPersonNameField(label)) {
      const letters = String(input.value || '').replace(/[^A-Za-z]/g, '');
      const isAllCaps = letters.length > 2 && letters === letters.toUpperCase();
      if (isAllCaps) return false;
      return current === exp;
    }

    // Phone numbers: if current value starts with country code (e.g. "+91 9440552825") while expected is 10 digits, it needs normalization!
    if (/(phone|mobile|\btel\b)/i.test(label) && !/extension|\bext\b/i.test(label)) {
      const curDigits = String(input.value || '').replace(/\D/g, '');
      const expDigits = String(expected || '').replace(/\D/g, '');
      if (curDigits.length > expDigits.length && curDigits.endsWith(expDigits)) {
        return false;
      }
      return curDigits === expDigits;
    }

    // Phone Extension: if it holds a 7+ digit phone number, clear it!
    if (/extension|\bext\b/i.test(label)) {
      const digits = String(input.value || '').replace(/\D/g, '');
      if (digits.length >= 7) return false;
    }

    if (current === exp) return true;
    return false;
  }

  function setNativeValue(input, value) {
    if (!input) return false;
    value = normalizeValueForInput(input, value);
    // A native <input type="date"> needs YYYY-MM-DD, not MM/DD/YYYY.
    if (input.type === 'date') {
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(value))) {
        const [mm, dd, yyyy] = String(value).split('/');
        value = `${yyyy}-${mm}-${dd}`;
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        return false;
      }
    }
    // A native <input type="month"> strictly requires YYYY-MM.
    if (input.type === 'month' && !/^\d{4}-\d{2}$/.test(String(value))) {
      return false;
    }
    // A native <input type="number"> strictly requires numeric characters.
    if (input.type === 'number' && !/^-?\d+(?:\.\d+)?$/.test(String(value).trim())) {
      return false;
    }
    try {
      if (input.tagName === 'SELECT') {
        const wanted = String(value).trim().toLowerCase();
        const monthNum = MONTH_NAMES[wanted];
        const option = [...input.options].find((item) => {
          const text = item.text.trim().toLowerCase();
          const val = item.value.trim().toLowerCase();
          return val === wanted || text === wanted
            || (monthNum && (val === monthNum || val === String(Number(monthNum)) || text === monthNum || text === String(Number(monthNum))))
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
      try { input.focus(); } catch {}

      // Reset React's internal valueTracker so React synthetic event system detects state transition
      const tracker = input._valueTracker;
      if (tracker) {
        try { tracker.setValue(''); } catch {}
      }

      const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      try {
        if (setter) {
          setter.call(input, value);
        } else {
          input.value = value;
        }
      } catch (e) {
        hamzoohLog('warn', 'Failed setting input value directly', { value, err: e.message });
        return false;
      }

      input.dispatchEvent(new Event('focus', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('focusin', { bubbles: true, composed: true }));
      try {
        input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, data: String(value), inputType: 'insertText' }));
      } catch {}
      input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: String(value), inputType: 'insertText' }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('focusout', { bubbles: true, composed: true }));
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
      return !text || isEmptyChoiceText(text) || /choose/i.test(text);
    }
    if (isCustomDropdownControl(input)) {
      const widget = getDropdownWidgetFor(input);
      return !dropdownHasValue(widget);
    }
    if (type === 'radio' || type === 'checkbox') return !input.checked;
    return !String(input.value || '').trim();
  }

  function optionList(select) {
    return [...select.options].filter((item) => item.value !== '' && !isEmptyChoiceText(item.text) && !/choose/i.test(item.text.trim()));
  }

  function isCaptchaElement(el) {
    if (!el) return false;
    const name = String(el.name || el.id || '').toLowerCase();
    const placeholder = String(el.placeholder || '').toLowerCase();
    const aria = String(el.getAttribute?.('aria-label') || '').toLowerCase();
    const cls = String(el.className || '').toLowerCase();
    const label = String(labelFor(el) || '').toLowerCase();
    const text = `${name} ${placeholder} ${aria} ${cls} ${label}`;
    return /\b(captcha|recaptcha|hcaptcha|turnstile)\b/i.test(text);
  }

  function collectInputs() {
    // On LinkedIn, inputs ONLY exist if the Easy Apply modal is open!
    const isLinkedIn = /linkedin\.com/i.test(location.hostname);
    const modal = findLinkedInModal() || queryAllDeep('.jobs-easy-apply-modal, [role="dialog"], .artdeco-modal').find((m) => visible(m));
    if (isLinkedIn && !modal) {
      return [];
    }
    const root = modal || document;
    return queryAllDeep('input, textarea, select', root).filter((input) => {
      // Ignore header/nav/global search inputs and messaging inputs
      if (input.closest('header, nav, [role="navigation"], [class*="search-global"], [class*="msg-overlay"], [class*="msg-conversation"], [class*="msg-form"], [class*="global-nav"]')) return false;
      const type = (input.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) return false;
      if (input.disabled) return false;
      if (isCaptchaElement(input)) return false;
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
    return /captcha|recaptcha|hcaptcha|turnstile|authori[sz]ed to work|authori[sz]ation to work|work authorization|sponsorship|assistance to obtain|visa status|citizenship|ssn|social security|passport number|national id|aadhaar|convicted|felony|criminal|date of birth|\bdob\b|desired (annual )?(salary|compensation)|expected salary|compensation|notice period|currently employed/i.test(String(question || ''));
  }

  function isEeoQuestion(question) {
    return /gender|non-?binary|pronoun|hispanic|latino|race|racial|ethnic|native american|alaska native|asian|african american|pacific islander|two or more races|caucasian|veteran|disability|lgbt|sexual orientation|position_specific_questions/i.test(String(question || ''));
  }

  // Only uses facts the user actually stored. Returns '' when unknown so the
  // caller asks the user instead of inventing an answer.
  function startDateFromToken(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    let days = null;
    if (/^(tomorrow|next[_\s-]?day)$/.test(lower)) days = 1;
    else if (/^(immediate|immediately|today|asap)$/.test(lower)) days = 0;
    else if (/^\+?\s*(\d+)\s*d(ays?)?$/.test(lower)) days = Number(lower.match(/(\d+)/)[1]);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) { const [y, m, d] = raw.split('-'); return `${m}/${d}/${y}`; }
    else return raw;
    const date = new Date(Date.now() + days * 86400000);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${date.getFullYear()}`;
  }

  // Workday (and several ATS) split a date into three controls — month, day,
  // year. Typing "11/22/2026" into the month box is rejected, so the whole
  // required field stays empty; the parts are detected and filled one by one.
  function datePartText(input) {
    return [
      input.getAttribute?.('data-automation-id') || '',
      input.getAttribute?.('aria-label') || '',
      input.getAttribute?.('placeholder') || '',
      input.name || '',
      input.id || '',
    ].join(' ').toLowerCase();
  }

  function datePartKind(input) {
    const text = datePartText(input);
    if (/year|yyyy/.test(text)) return 'year';
    if (/month|\bmm\b/.test(text)) return 'month';
    if (/day|\bdd\b/.test(text)) return 'day';
    return '';
  }

  // The closest wrapper that holds at least two different date parts.
  function dateGroupOf(input) {
    let node = input;
    for (let depth = 0; node && node !== document.body && depth < 4; depth += 1, node = node.parentElement) {
      const controls = queryAllDeep('input, select', node).filter((el) => {
        const type = (el.getAttribute('type') || '').toLowerCase();
        return !['hidden', 'file', 'button', 'submit', 'reset', 'radio', 'checkbox', 'password'].includes(type);
      });
      const parts = controls.map((el) => ({ el, kind: datePartKind(el) })).filter((part) => part.kind);
      if (new Set(parts.map((part) => part.kind)).size >= 2) return { container: node, parts };
      const autoId = String(node.getAttribute?.('data-automation-id') || '').toLowerCase();
      if (autoId.includes('formfield') || autoId.includes('question')) break;
    }
    return null;
  }

  function datePartsFromValue(value) {
    const text = String(value || '').trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return { year: iso[1], month: iso[2], day: iso[3] };
    const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (us) {
      return {
        month: us[1].padStart(2, '0'),
        day: us[2].padStart(2, '0'),
        year: us[3].length === 2 ? `20${us[3]}` : us[3],
      };
    }
    const my = text.match(/^(\d{1,2})[-/](\d{4})$/);
    if (my) {
      return {
        month: my[1].padStart(2, '0'),
        day: '01',
        year: my[2],
      };
    }
    const ym = text.match(/^(\d{4})[-/](\d{1,2})$/);
    if (ym) {
      return {
        month: ym[2].padStart(2, '0'),
        day: '01',
        year: ym[1],
      };
    }
    const nameYear = text.match(/^([a-zA-Z]+)\s+(\d{4})$/);
    if (nameYear && MONTH_NAMES[nameYear[1].toLowerCase()]) {
      return {
        month: MONTH_NAMES[nameYear[1].toLowerCase()],
        day: '01',
        year: nameYear[2],
      };
    }
    const monthOnly = MONTH_NAMES[text.toLowerCase()];
    if (monthOnly) {
      return {
        month: monthOnly,
        day: '01',
        year: String(new Date().getFullYear()),
      };
    }
    return null;
  }

  function datePartValue(kind, values, el) {
    if (kind !== 'year') return values[kind];
    return String(el.getAttribute?.('maxlength') || '') === '2' ? values.year.slice(2) : values.year;
  }

  // Fills a date question whether the page wants one control or a
  // month/day/year group. True only when every part holds its value.
  async function fillDateControl(input, value) {
    const values = datePartsFromValue(value);
    if (!values) return setVerified(input, value);
    const group = dateGroupOf(input);
    if (!group) {
      if (await setVerified(input, value)) return true;
      // Workday's single date box inserts the separators itself, so it can
      // reject a pasted "MM/DD/YYYY" but accept the same digits typed in.
      const digits = String(value).replace(/\D/g, '');
      if (!digits) return false;
      const readDigits = () => String(input.value || '').replace(/\D/g, '');
      setNativeValue(input, digits);
      await sleep(80);
      if (readDigits() !== digits) await typeWithCdp(input, digits);
      if (readDigits() === digits) {
        runEvent('date_typed', { question: labelFor(input).slice(0, 80), value }, 'Filled a date box with digits (site inserts separators)');
        return true;
      }
      return false;
    }
    let filled = 0;
    for (const part of group.parts) {
      const expected = datePartValue(part.kind, values, part.el);
      if (String(part.el.value || '').trim() === String(expected)) { filled += 1; continue; }
      if (await setVerified(part.el, expected)) filled += 1;
    }
    return filled === group.parts.length;
  }

  // "Earliest available joining date" / "What date are you available to start?"
  // are answered relative to the day the application runs: tomorrow by default
  // (or the configured offset), never a stored stale date. A notice-period
  // question is a different question.
  function isJoiningDateQuestion(question) {
    const q = String(question || '');
    if (/notice period|period of notice|how much notice/i.test(q)) return false;
    return /earliest (available )?(joining|start)|available to (start|join)|date (are|will|can) you (available|be able|start|join)|(start|joining|available|availability) date|when can you (start|join)|available (from|for joining)/i.test(q);
  }

  function joiningDateValue(profile) {
    const raw = String(profile?.availableStart || profile?.startDate || '').trim().toLowerCase();
    if (/^\+?\s*\d+\s*d/.test(raw) || /^(tomorrow|immediate|immediately|today|asap|next[_\s-]?day)$/.test(raw)) {
      const resolved = startDateFromToken(raw);
      if (resolved) return resolved;
    }
    return startDateFromToken('tomorrow');
  }

  // "3LPA" / "30k" / "₹3,00,000" reach a salary input as digits, never as text
  // the site rejects.
  function salaryDigits(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    const lpa = text.replace(/[,\s]/g, '').match(/^(\d+(?:\.\d+)?)(lpa|lakh|lakhs|lac|lacs)$/i);
    if (lpa) return String(Math.round(Number(lpa[1]) * 100000));
    const k = text.replace(/[,\s]/g, '').match(/^(\d+(?:\.\d+)?)k$/i);
    if (k) return String(Math.round(Number(k[1]) * 1000));
    const digits = text.replace(/^(?:inr|rs\.?|₹)/i, '').replace(/[,\s₹]/g, '');
    return /^\d+(?:\.\d+)?$/.test(digits) ? digits : text;
  }

  // The desired salary comes from the candidate's own profile: an explicit
  // expected salary, or the range saved in Job Profile. INR profiles store that
  // range as a monthly figure, so it is annualised instead of typing the
  // monthly floor into an annual field.
  function salaryFromProfile(profile) {
    const p = profile || {};
    const explicit = p.expectedSalary ?? p.salary ?? p.salaryExpectation;
    const explicitDigits = salaryDigits(explicit);
    if (/^\d+(?:\.\d+)?$/.test(explicitDigits)) return explicitDigits;
    if (String(explicit || '').trim()) return String(explicit).trim();
    const prefs = p.jobPreferences || p.preferences || {};
    const min = Number(salaryDigits(prefs.salaryMin));
    const max = Number(salaryDigits(prefs.salaryMax));
    const monthly = min || max;
    if (!Number.isFinite(monthly) || monthly <= 0) return '';
    return String(Math.round(monthly < 100000 ? monthly * 12 : monthly));
  }

  // "Expected Salary Currency" needs a currency code; the salary hint used to
  // answer it with 360000. Derived from the candidate's own country/profile,
  // never invented.
  function currencyForProfile(profile) {
    const p = profile || {};
    const explicit = p.currency || p.salaryCurrency
      || p.jobPreferences?.currency || p.preferences?.currency;
    if (explicit) return String(explicit).trim().toUpperCase();
    const where = `${p.country || ''} ${p.location || ''}`.toLowerCase();
    if (/india|\binr\b|rupee/.test(where)) return 'INR';
    if (/united states|\busa\b|\busd\b|dollar/.test(where)) return 'USD';
    if (/united kingdom|\bgbp\b|pound/.test(where)) return 'GBP';
    if (/\beur\b|euro|germany|netherlands|ireland|france|spain/.test(where)) return 'EUR';
    if (/singapore|\bsgd\b/.test(where)) return 'SGD';
    if (/canada|\bcad\b/.test(where)) return 'CAD';
    if (/australia|\baud\b/.test(where)) return 'AUD';
    if (/uae|dubai|\baed\b|dirham/.test(where)) return 'AED';
    return '';
  }

  function sensitiveProfileAnswer(question, profile) {
    const q = String(question || '').toLowerCase();
    const p = profile || {};
    // A currency picker is not a salary question even though it says "salary".
    if (/\bcurrency\b|salary.?currency|currency.?code/.test(q)) {
      return currencyForProfile(p);
    }
    // "Work Authorization Country" / "Citizenship" contain the work-auth wording
    // but expect a country, not Yes/No. A yes/no sentence that merely mentions
    // the country ("Are you legally authorized to work in the country/region of
    // the job?") must still be answered Yes/No, so the phrasing decides.
    const yesNoPhrasing = /^(are|do|does|did|will|would|have|has|is|was|were|can|could|should|may)\b/i.test(q.trim())
      || q.includes('?');
    const asksForPlace = !yesNoPhrasing && /country|nation|citizenship|territory|nationality/.test(q);
    if (!asksForPlace && /authori[sz]ed to work|authori[sz]ation to work|work authorization|legally (eligible|authori[sz]ed)|right to work|eligible to work/.test(q)) {
      const flag = p.workAuthorized ?? p.authorizedToWork ?? p.workAuth
        ?? p.jobPreferences?.workAuthorized ?? p.preferences?.workAuthorized;
      if (flag === true || /^(yes|true|y|1)$/i.test(String(flag || ''))) return 'Yes';
      if (flag === false || /^(no|false|n|0)$/i.test(String(flag || ''))) return 'No';
      // No explicit flag, but the question names a country the candidate
      // already lives in ("authorized to work in India?"). That is a fact the
      // profile answers; a different country must still be left blank.
      const home = String(p.country || '').trim() || String(p.location || '').split(',').pop().trim();
      if (home && new RegExp(`\\b${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(q)) return 'Yes';
    }
    if (/(require|need) (company )?(assistance|sponsorship)|require sponsorship|need sponsorship|visa sponsorship|immigration (support|assistance)|assistance to obtain (work )?authori[sz]ation/.test(q)) {
      const flag = p.requireSponsorship ?? p.sponsorshipRequired
        ?? p.jobPreferences?.requireSponsorship ?? p.preferences?.requireSponsorship;
      if (flag === true || /^(yes|true|y|1)$/i.test(String(flag || ''))) return 'Yes';
      if (flag === false || /^(no|false|n|0)$/i.test(String(flag || ''))) return 'No';
    }
    if (/notice period|joining time/.test(q)) {
      if (p.noticePeriod) return String(p.noticePeriod);
    }
    if (asksForPlace) {
      // Country / citizenship dropdowns expect a country name. Use the
      // candidate's own country; never invent one.
      const country = String(p.country || '').trim()
        || (String(p.location || '').split(',').pop() || '').trim();
      if (country) return country;
    }
    if (isJoiningDateQuestion(q)) {
      // Always relative to today (or the candidate's configured offset).
      return joiningDateValue(p);
    }
    if (/currently (enrolled|studying|pursuing)|still (in|at) (college|university|school)|are you a student|pursuing a (bachelor|master|degree)|enrolled in a degree/.test(q)) {
      const explicit = p.currentlyEnrolled ?? p.isStudent;
      if (explicit === true) return 'Yes';
      if (explicit === false) return 'No';
      // A graduation year still in the future means the candidate is studying
      // right now. Asking this every time wasted a prompt on a fact the
      // profile already answers.
      const years = (Array.isArray(p.education) ? p.education : [])
        .map((item) => String(item?.graduationYear || item?.endYear || item?.dates || '').match(/(19|20)\d{2}/)?.[0])
        .filter(Boolean)
        .map(Number);
      const latest = years.length ? Math.max(...years) : 0;
      if (latest) return latest > new Date().getFullYear() ? 'Yes' : 'No';
    }
    if (/desired (annual )?(salary|compensation)|expected (salary|ctc|compensation)|salary expectation|salary requirement|target salary|current (salary|ctc)/.test(q)) {
      const salary = salaryFromProfile(p);
      if (salary) return salary;
    }
    return '';
  }

  function chooseFromProfile(question, profile, company) {
    const q = String(question || '').toLowerCase();
    const known = sensitiveProfileAnswer(question, profile);
    if (known) return known;
    if (/privacy|acknowledge|agree|consent|terms|i understand|i certify|text\/sms|sms updates?|text updates?|personal data/.test(q) && !isSensitiveQuestion(q)) return 'yes';
    if (isEeoQuestion(q)) return 'decline';
    if (/(?:end|graduation|completion|passing)\s*(?:date\s*)?month/i.test(q)) return '05';
    if (/(?:end|graduation|completion|passing)\s*(?:date\s*)?year/i.test(q)) {
      const years = (Array.isArray(profile.education) ? profile.education : [])
        .map((item) => String(item?.graduationYear || item?.endYear || item?.dates || '').match(/(19|20)\d{2}/)?.[0])
        .filter(Boolean);
      return years[0] || '2027';
    }
    if (/(?:start|admission|joining)\s*(?:date\s*)?month/i.test(q) && !isJoiningDateQuestion(q)) return '08';
    if (/(?:start|admission|joining)\s*(?:date\s*)?year/i.test(q) && !isJoiningDateQuestion(q)) {
      const years = (Array.isArray(profile.education) ? profile.education : [])
        .map((item) => String(item?.dates || '').match(/\b(19|20)\d{2}\b/)?.[0])
        .filter(Boolean);
      return years[0] || '2023';
    }
    if (/willing to be based|come to the office|work from office|hybrid|on-?site|in-office/i.test(q)) return 'yes';
    if (/full-?time internship|internship for \d+|available for \d+ (?:months?|weeks?)|duration of \d+/i.test(q)) return 'yes';
    if (/no objection certificate|\bnoc\b/i.test(q)) return 'yes';
    if (/engineering blog|read our (?:engineering )?blog|company blog/i.test(q)) return 'yes';
    if (/willing to relocate|relocate yourself|open to relocation/i.test(q)) return 'yes';
    // Safe, non-personal field defaults common across ATS forms. These are
    // preferences, not personal/legal facts, so the agent answers them itself.
    if (/phone (device )?type|device type|phone type|telephone type/i.test(q)) return 'Mobile';
    if (/preferred (first )?name|nickname|known as|goes by/i.test(q)) return 'No';
    const experienceList = Array.isArray(profile.experience) ? profile.experience : [];
    const internshipsList = Array.isArray(profile.internships) ? profile.internships : [];
    const workedHere = [...experienceList, ...internshipsList].some((item) => {
      const c = String(item?.company || '').toLowerCase();
      return c && company && (c.includes(String(company).toLowerCase()) || String(company).toLowerCase().includes(c));
    });
    if (/government (or government )?agency|employed (with|by) (a |the )?government|government employ|public sector employ|federal employ/.test(q)) {
      // "Are you currently employed with a government agency…?" is a yes/no
      // fact the profile can hold, so it never needs to interrupt the run.
      const flag = profile.governmentEmployee ?? profile.govEmployee
        ?? profile.jobPreferences?.governmentEmployee;
      if (flag === true || /^(yes|true|y|1)$/i.test(String(flag || ''))) return 'yes';
      if (flag === false || /^(no|false|n|0)$/i.test(String(flag || ''))) return 'no';
    }
    if (/employed by|worked (for|at)|work(?:ing)? (?:for|at)|previously employed|ever been employed|current employer/.test(q)) {
      if (workedHere) return 'yes';
      // "Do you currently work for PwC?" names an employer the job is not at;
      // the candidate's own history decides it, so it never needs a prompt.
      const named = String((q.match(/(?:work(?:ing|ed)?|employ(?:ed)?)\s+(?:for|at|by)\s+([^?.,;:()]{2,60})/) || [])[1] || '').trim();
      const target = named || String(company || '').trim().toLowerCase();
      if (target) {
        const workedThere = [...experienceList, ...internshipsList].some((item) => {
          const c = String(item?.company || '').toLowerCase();
          return c && (c.includes(target) || target.includes(c));
        });
        return workedThere ? 'yes' : 'no';
      }
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
      const source = String(profile?.jobSource || profile?.source || profile?.jobProvider || '').toLowerCase();
      const patterns = [];
      if (/referral|employee/.test(source)) patterns.push(/employee referral|referral/i);
      if (/campus|university|college/.test(source)) patterns.push(/campus campaign|campus/i);
      if (/linkedin/.test(source)) patterns.push(/linked.?in/i, /job sites?|career websites?/i);
      if (/indeed|naukri|glassdoor|job board|job site/.test(source)) patterns.push(/job sites?|job boards?|naukri|indeed|glassdoor/i);
      if (/company|career|website|portal|workday|greenhouse|lever|ashby/i.test(source)) patterns.push(/career websites?|career sites?|company website|employer website/i);
      if (/alert/.test(source)) patterns.push(/job alert|job notification/i);
      // These are logistics, not personal facts: any real option is a valid
      // answer, so finish with a permissive fallback instead of stalling.
      patterns.push(/job sites?|career websites?|linked.?in|job alert|employee referral/i, /./);
      for (const re of patterns) {
        const hit = find(re);
        if (hit) return hit;
      }
      return '';
    }
    if (/phone (device )?type|device type|phone type|telephone type/i.test(q)) {
      return find(/mobile|cell|smart ?phone/i) || 'Mobile';
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
    if (/willing to relocate|relocate yourself|open to relocation/i.test(q)) {
      return find(/willing to (?:self-?fund )?my relocation|willing to relocate/i)
        || find(/based in|do(?: not|n't) need relocation/i)
        || find(/^(yes|y)\b/i)
        || '';
    }
    if (/no objection certificate|\bnoc\b/i.test(q)) {
      return find(/^(yes|y)\b/i) || find(/able to provide|will provide/i) || 'yes';
    }
    if (/full-?time internship|internship for \d+|available for \d+/i.test(q)) {
      return find(/^(yes|y)\b/i) || find(/able to do|available/i) || 'yes';
    }
    if (/willing to be based|come to the office|at least \d+ days/i.test(q)) {
      return find(/^(yes|y)\b/i) || 'yes';
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

  function closeOpenDropdown(widget) {
    try {
      const modal = findLinkedInModal() || widget?.closest?.('.artdeco-modal, [role="dialog"]');
      if (modal) {
        if (widget) {
          widget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
          widget.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        }
        const header = modal.querySelector('.jobs-easy-apply-modal__header, .artdeco-modal__header, h2, h3');
        if (header) {
          header.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      } else {
        document.body.click();
      }
    } catch {}
  }

  async function fillCustomDropdowns(wantedByQuestion, answers, profile, company, pending = null) {
    // If an apply modal is open, search ONLY inside the modal!
    const modal = findLinkedInModal() || queryAllDeep('.jobs-easy-apply-modal, [role="dialog"], .artdeco-modal').find((m) => visible(m));
    if (/linkedin\.com/i.test(location.hostname) && !modal) {
      return; // Never scan dropdowns on LinkedIn outside the Easy Apply modal!
    }
    const root = modal || document;
    const rawWidgets = queryAllDeep(DROPDOWN_WIDGET_SELECTOR, root)
      .filter((el) => {
        if (!visible(el) || el.tagName === 'SELECT') return false;
        if (el.closest('header, nav, [role="navigation"], [class*="search-global"], [class*="msg-overlay"], [class*="msg-conversation"], [class*="msg-form"], [class*="global-nav"]')) return false;
        return true;
      });
    const widgets = rawWidgets.filter((el) => !rawWidgets.some((other) => other !== el && other.contains(el))).slice(0, 50);
    for (const widget of widgets) {
      const question = questionFor(widget);
      // Already answered correctly in an earlier pass: never touch it again.
      if (dropdownHasValue(widget)) continue;
      // Skipped by the candidate: never re-ask this dropdown.
      if (isSkippedQuestion(question)) continue;
      // A sensitive question is decided by its own category, never by a generic
      // field hint: "...authorization to work in the job location?" would
      // otherwise be answered with the candidate's city.
      const hint = isSensitiveQuestion(question) ? null : FIELD_HINTS.find((item) => item.test.test(question));
      let wanted = (taskMode() ? null : findBestAnswer(question, answers))
        || chooseFromProfile(question, profile, company)
        || (hint ? profileValue(profile, hint.key, pending?.jobTitle || '', company) : '')
        || wantedByQuestion.get(question);
      try {
        openDropdownWidget(widget);
        await sleep(350);
        // Only look inside a real opened popup. Scanning the whole document on
        // Workday picks up the step navigation ("step 2 of 7") as fake options.
        const popup = queryAllDeep('[role="listbox"], [role="menu"], [data-automation-id="menu"], [class*="select__menu"], [class*="select__list"], [class*="dropdown-menu"], [class*="menu-list"]')
          .find((node) => visible(node));
        const optionRoot = popup || root;
        const readOptions = () => {
          // Scan every visible dropdown/menu container so nested submenus
          // (Workday "Job Sites" -> "LinkedIn") are included, while page
          // navigation and step lists are excluded.
          const containers = queryAllDeep('[role="listbox"], [role="menu"], [class*="select__menu"], [class*="select__list"], [class*="dropdown"], [class*="menu"]').filter((node) => visible(node));
          const scopes = containers.length ? containers : [optionRoot];
          const seen = new Set();
          const out = [];
          for (const scope of scopes) {
            queryAllDeep('[data-automation-id="menu-item"], [data-automation-id="promptOption"], [role="option"], [role="menuitem"], [class*="select__option"], [class*="option"], li', scope)
              .forEach((node) => {
                if (seen.has(node) || !visible(node) || isNoisePrompt(node.innerText || '')) return;
                if (node.closest('nav, [role="navigation"], header')) return;
                seen.add(node);
                out.push(node);
              });
          }
          return out;
        };

        let options = readOptions();
        let optTexts = cleanOptions(options.map((o) => (o.innerText || '').trim()));

        // Searchable combobox (Workday "How did you hear about us?" etc.): the
        // list stays empty until text is typed. Decide the answer ourselves and
        // pick it from the filtered list instead of asking the candidate.
        if ((!options.length || !optTexts.length) && !isNoisePrompt(question)
          && !(taskMode() && isSensitiveQuestion(question))) {
          const searchInput = widget.matches?.('input, textarea') ? widget : widget.querySelector?.('input, textarea');
          if (searchInput && visible(searchInput)) {
            let guess = wanted || '';
            if (!guess) {
              const ai = await inferAnswerWithAI(question, [], profile, pending?.jobTitle, pending?.company, pending?.resumeText, pending);
              guess = ai?.answer || '';
            }
            if (guess) {
              try { setNativeValue(searchInput, guess); } catch {
                try {
                  searchInput.value = guess;
                  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                } catch {}
              }
              await sleep(900);
              options = readOptions();
              optTexts = cleanOptions(options.map((o) => (o.innerText || '').trim()));
              const wantedLower = String(guess).toLowerCase();
              const hit = options.find((o) => {
                const text = String(o.innerText || '').trim().toLowerCase();
                return text === wantedLower || text.includes(wantedLower) || wantedLower.includes(text)
                  || (wantedLower.length > 3 && text.includes(wantedLower.slice(0, 4)))
                  || (wantedLower === 'mobile' && /mobile|cell/.test(text));
              });
              if (hit) {
                clickOptionNode(hit);
                hamzoohLog('log', 'searchable dropdown filled', question.slice(0, 80));
                await sleep(150);
                continue;
              }
              if (!isSensitiveQuestion(question)) {
                // No exact match: clear the search and pick a real option from
                // the unfiltered list so required logistics fields are never
                // left empty.
                try { setNativeValue(searchInput, ''); } catch {}
                await sleep(350);
                const fresh = readOptions();
                const fallback = pickBestOption(fresh)?.node || fresh[0];
                if (fallback) {
                  clickOptionNode(fallback);
                  hamzoohLog('log', 'searchable dropdown fallback', question.slice(0, 80));
                  await sleep(150);
                  continue;
                }
              }
            }
          }
        }

        if (!options.length || !optTexts.length || isNoisePrompt(question)) {
          closeOpenDropdown(widget);
          await sleep(100);
          if (isNoisePrompt(question)) skipped.push({ field: 'custom dropdown', reason: 'The page did not expose a real question for this control.' });
          continue;
        }

        // Source questions ("How did you hear about us?") accept any option, so
        // the agent clicks the most plausible one (LinkedIn / Job sites / ...)
        // and follows one submenu level if the option opens a nested list.
        if (!isSensitiveQuestion(question) && isLogisticsQuestion(question)) {
          const before = options.slice();
          const picked = pickBestOption(options, profile);
          if (picked) {
            clickOptionNode(picked.node);
            await sleep(600);
            const more = readOptions().filter((node) => !before.includes(node));
            const leaf = more.length ? pickBestOption(more, profile) : null;
            if (leaf) { clickOptionNode(leaf.node); await sleep(300); }
          }
          // Workday search comboboxes only commit when the chosen leaf is in
          // the filtered list — use the decision we just made, never a
          // hardcoded answer that may not exist among the options.
          const searchInput = widgetControl(widget);
          const preferred = String(picked?.text || wanted || '').trim();
          if (searchInput && !dropdownHasValue(widget) && preferred) {
            try { setNativeValue(searchInput, preferred); } catch {}
            await sleep(700);
            const listed = readOptions();
            const hit = listed.find((node) => {
              const t = String(node.innerText || '').trim().toLowerCase();
              const p = preferred.toLowerCase();
              return t === p || t.includes(p) || p.includes(t);
            }) || pickBestOption(listed, profile)?.node;
            if (hit) { clickOptionNode(hit); await sleep(250); }
          }
          if (!dropdownHasValue(widget) && picked) {
            clickOptionNode(picked.node);
            await sleep(200);
          }
          hamzoohLog('log', 'logistics question answered', `${question.slice(0, 50)} -> ${preferred || 'first option'}`);
          await sleep(150);
          continue;
        }
        if (!wanted && !(taskMode() && isSensitiveQuestion(question))) {
          wanted = heuristicChoice(question, optTexts, profile);
        }
        if (!wanted && !(taskMode() && isSensitiveQuestion(question))) {
          wanted = semanticOptionText(question, optTexts, profile);
        }
        // A known value that matches no visible option must be mapped onto one.
        if (wanted) {
          const w = String(wanted).toLowerCase();
          const hasMatch = optTexts.some((t) => {
            const tt = t.toLowerCase();
            return tt === w || tt.includes(w) || w.includes(tt);
          });
          if (!hasMatch) {
            const alt = semanticOptionText(question, optTexts, profile);
            if (alt) wanted = alt;
          }
        }
        if (!wanted) {
          if (taskMode()) {
            const memory = await taskCall('/api/applications/extension/answer-lookup', { question, options: optTexts });
            wanted = memory?.match?.answer || '';
          }
          if (!wanted && !(taskMode() && isSensitiveQuestion(question))) {
            const ai = await inferAnswerWithAI(question, optTexts, profile, '', company, '', pending);
            if (ai?.answer) wanted = ai.answer;
          }
          if (!wanted && taskMode()) {
            const reported = await taskCall('/api/applications/extension/question', {
              question, options: optTexts, required: true,
              reason: 'This dropdown value is not in your profile or saved answers.',
            });
            wanted = reported?.answer || '';
          }
          if (!wanted) {
            const promptResult = await askOrSkip(question, 0, 1, optTexts, 'Choose the option for this question (saved to Vault)', true);
            if (promptResult?.answer) {
              wanted = promptResult.answer;
              if (promptResult.remember) await rememberAnswer(answers, question, wanted, optTexts);
            }
          }
        }
        if (!wanted) {
          closeOpenDropdown(widget);
          await sleep(100);
          skipped.push({ field: (question || 'Custom dropdown').slice(0, 80), reason: 'No matching profile value or saved answer for this dropdown.' });
          continue;
        }
        const hit = matchDropdownOption(options, wanted);
        if (hit) {
          // Click the option, and if it opens a submenu ("Job Sites >") follow
          // it down until the value actually commits.
          const beforeClick = options.slice();
          clickOptionNode(hit);
          await sleep(500);
          for (let depth = 0; depth < 3 && !dropdownHasValue(widget); depth += 1) {
            const nested = readOptions().filter((node) => !beforeClick.includes(node));
            if (!nested.length) break;
            const nestedHit = matchDropdownOption(nested, wanted) || nested[0];
            clickOptionNode(nestedHit);
            await sleep(450);
          }
          if (dropdownHasValue(widget)) {
            hamzoohLog('log', 'custom dropdown filled', question.slice(0, 80));
          } else {
            // The click landed but the widget never committed a value. Reporting
            // it as filled hid a required field that the page then rejected.
            closeOpenDropdown(widget);
            await sleep(100);
            skipped.push({ field: (question || 'Custom dropdown').slice(0, 80), reason: `Picked "${wanted}" but this dropdown did not keep the value.` });
          }
        } else {
          // A profile value that is not one of this dropdown's options ("India"
          // in a country list written differently, "Yes" in a country list) must
          // not be dropped silently — that leaves a required field empty and the
          // page rejects Next. Ask the candidate to pick from the real options.
          closeOpenDropdown(widget);
          await sleep(100);
          let chosen = '';
          if (taskMode()) {
            const reported = await taskCall('/api/applications/extension/question', {
              question, options: optTexts, required: true,
              reason: `Your profile value "${wanted}" is not one of this dropdown's options.`,
            });
            chosen = reported?.answer || '';
          }
          if (!chosen) {
            const promptResult = await askOrSkip(question, 0, 1, optTexts, `Your saved value "${wanted}" is not an option here — pick one.`, true);
            chosen = promptResult?.answer || '';
            if (chosen && promptResult?.remember) await rememberAnswer(answers, question, chosen, optTexts);
          }
          if (chosen) {
            openDropdownWidget(widget);
            await sleep(350);
            const fresh = readOptions();
            const retry = matchDropdownOption(fresh, chosen);
            if (retry) {
              clickOptionNode(retry);
              await sleep(400);
              if (dropdownHasValue(widget)) {
                hamzoohLog('log', 'custom dropdown filled after asking', question.slice(0, 80));
                await sleep(150);
                continue;
              }
            }
          }
          skipped.push({ field: (question || 'Custom dropdown').slice(0, 80), reason: `The value "${wanted}" is not an option in this dropdown.` });
        }
        await sleep(150);
      } catch {}
    }
  }

  // Radios that omit a `name` attribute would all collapse onto the same key,
  // so later groups were silently skipped. Group by name when present, else by
  // the question the options belong to.
  // Visible option nodes of an opened custom dropdown (Workday listbox, search
  // combobox, ...). Only visible containers are scanned so step navigation and
  // the page menu never show up as choices.
  function dropdownOptions(widget = null) {
    const containers = queryAllDeep('[role="listbox"], [role="menu"], [data-automation-id="menu"], [class*="select__menu"], [class*="select__list"], [class*="menu-list"], [class*="dropdown-menu"], [class*="dropdown"], [class*="menu"]')
      .filter((node) => visible(node));
    const scopes = containers.length ? containers : [document];
    const seen = new Set();
    const out = [];
    for (const scope of scopes) {
      queryAllDeep('[data-automation-id="menu-item"], [data-automation-id="promptOption"], [role="option"], [role="menuitem"], [class*="select__option"], [class*="option"], li', scope)
        .forEach((node) => {
          if (seen.has(node) || !visible(node) || isNoisePrompt(node.innerText || '')) return;
          if (node.closest('nav, [role="navigation"], header')) return;
          seen.add(node);
          out.push(node);
        });
    }
    return out;
  }

  function matchDropdownOption(nodes, wanted) {
    const w = String(wanted || '').trim().toLowerCase();
    if (!w) return null;
    const cleanWanted = cleanCountryName(w);
    const monthNum = MONTH_NAMES[w];
    return nodes.find((node) => {
      const t = String(node.innerText || '').trim().toLowerCase();
      if (!t) return false;
      if (t === w || t === cleanWanted) return true;
      if (monthNum && (t === monthNum || t === String(Number(monthNum)))) return true;
      if (MONTH_NAMES[t] && (MONTH_NAMES[t] === w || String(Number(MONTH_NAMES[t])) === w)) return true;
      if (w === 'yes' && /^(yes|y|agree)\b/i.test(t)) return true;
      if (w === 'no' && /^(no|n|disagree)\b/i.test(t)) return true;
      if (w === 'decline' && /decline|prefer not|do not wish/i.test(t)) return true;
      if (cleanWanted === 'india' && /\bindia\b|\b\+91\b/i.test(t)) return true;
      if (w.length > 3 && (t.includes(w) || w.includes(t) || t.includes(cleanWanted))) return true;
      return false;
    }) || null;
  }

  // Peek the options of a closed custom dropdown by briefly opening it.
  async function peekDropdownOptions(widget) {
    if (!widget) return [];
    openDropdownWidget(widget);
    await sleep(250);
    const opts = dropdownOptions(widget);
    const texts = opts.map((o) => (o.innerText || o.textContent || '').trim()).filter((t) => t && !isNoisePrompt(t));
    return [...new Set(texts)];
  }

  // Commit a value into a custom (non-<select>) dropdown. An answer given in the
  // dashboard must actually set the field, otherwise the same required question
  // is reported again on the next pass and the step never moves on.
  async function selectCustomOption(widget, wanted) {
    const target = String(wanted || '').trim();
    if (!widget || !target) return false;
    openDropdownWidget(widget);
    await sleep(350);
    let hit = matchDropdownOption(dropdownOptions(widget), target);
    if (!hit) {
      const searchInput = widget.matches?.('input, textarea') ? widget : widget.querySelector?.('input, textarea');
      if (searchInput && visible(searchInput)) {
        try { searchInput.focus(); } catch {}
        try { setNativeValue(searchInput, target); } catch {}
        await sleep(500);
        hit = matchDropdownOption(dropdownOptions(widget), target);
      }
    }
    if (!hit) {
      closeOpenDropdown(widget);
      return false;
    }
    clickOptionNode(hit);
    await sleep(350);
    for (let depth = 0; depth < 3 && !dropdownHasValue(widget); depth += 1) {
      const nested = dropdownOptions(widget).filter((node) => node !== hit);
      if (!nested.length) break;
      const leaf = matchDropdownOption(nested, target) || nested[0];
      clickOptionNode(leaf);
      await sleep(300);
    }
    if (!dropdownHasValue(widget)) {
      closeOpenDropdown(widget);
      return false;
    }
    return true;
  }

  function radioGroupKey(input, question, type = 'radio') {
    // Every option of a "select all that apply" checkbox list answers ONE
    // question. Keying by the input name split such a list into one group per
    // option, so each checkbox was asked (and left unchecked) separately.
    if (type === 'checkbox') return `checkbox:${question || input.name || input.id || ''}`;
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
    const modal = findLinkedInModal() || queryAllDeep('.jobs-easy-apply-modal, [role="dialog"], .artdeco-modal').find((m) => visible(m));
    if (/linkedin\.com/i.test(location.hostname) && !modal) return 0;
    const root = modal || document;
    const controls = queryAllDeep('select, input[type="radio"], input[type="checkbox"]', root)
      .filter((el) => {
        if (el.closest('header, nav, [role="navigation"], [class*="search-global"], [class*="msg-overlay"], [class*="msg-conversation"], [class*="msg-form"], [class*="global-nav"]')) return false;
        return el.tagName === 'SELECT' ? visible(el) : choiceVisible(el);
      });
    const seenGroups = new Set();
    let filledCount = 0;
    controls.forEach((input) => {
      const type = (input.getAttribute('type') || '').toLowerCase();
      const question = questionFor(input);
      const key = question.toLowerCase().slice(0, 180);
      const savedAnswer = findBestAnswer(question, answers);
      const hint = FIELD_HINTS.find((item) => item.test.test(question));
      let wanted = savedAnswer || (hint ? profileValue(profile, hint.key, '', company) : '') || chooseFromProfile(question, profile, company);
      if (!wanted && type !== 'radio' && type !== 'checkbox'
        && !(taskMode() && isSensitiveQuestion(question))) {
        wanted = heuristicChoice(question, optionList(input).map((o) => o.text.trim()), profile);
      }
      if (!wanted && type !== 'radio' && type !== 'checkbox'
        && !(taskMode() && isSensitiveQuestion(question))) {
        wanted = semanticOptionText(question, optionList(input).map((o) => o.text.trim()), profile);
      }
      // A known value that matches no option ("B.Tech Computer Science" vs
      // "Bachelor's Degree") must be mapped onto a real option, not dropped.
      if (input.tagName === 'SELECT' && wanted) {
        const optionTexts = optionList(input).map((o) => o.text.trim());
        const matches = optionTexts.some((t) => {
          const tt = t.toLowerCase();
          const w = String(wanted).toLowerCase();
          return tt === w || tt.includes(w) || w.includes(tt);
        });
        if (!matches) {
          wanted = semanticOptionText(question, optionTexts, profile)
            || heuristicChoice(question, optionTexts, profile) || wanted;
        }
      }
      // A select that already holds the right answer is left alone; a wrong or
      // empty one falls through and is corrected below.
      if (input.tagName === 'SELECT' && wanted && inputHasExpectedValue(input, wanted)) return;
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
      // Native select source question: any listed option is acceptable, so pick
      // the most plausible one instead of asking the candidate.
      if (!wanted && input.tagName === 'SELECT' && !isSensitiveQuestion(question) && isLogisticsQuestion(question)) {
        const opts = optionList(input);
        const pick = opts.find((option) => LOGISTICS_OPTION_PRIORITY.some((pattern) => pattern.test(option.text))) || opts[0];
        if (pick) wanted = pick.value || pick.text;
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
      const tracker = input._valueTracker;
      if (tracker) {
        try { tracker.setValue(''); } catch {}
      }
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;

      // Trigger React synthetic event handlers directly if present
      const reactKey = Object.keys(input).find((k) => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
      if (reactKey && typeof input[reactKey]?.onChange === 'function') {
        try {
          input[reactKey].onChange({ target: input, currentTarget: input, bubbles: true });
        } catch (e) {
          hamzoohLog('warn', 'React onChange invocation failed', e.message);
        }
      }
    } catch { return false; }
    ['input', 'change'].forEach((type) => {
      try { input.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, composed: true })); } catch {}
    });
    return Boolean(input.files && input.files.length);
  }

  // Phase 1f: collect visible validation messages so a rejected Next click can
  // be repaired instead of blindly retried.
  function detectValidationErrors() {
    const nodes = queryAllDeep('[role="alert"], [aria-invalid="true"], .error, [class*="error"], [data-testid*="error"], [data-automation-id*="error"]');
    const out = [];
    for (const el of nodes) {
      if (!visible(el)) continue;
      const text = String(el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      // If container holds multiple errors (like Workday "Errors Found (8 items)"), extract each line
      if (text.length >= 300 && /error|alert|required/i.test(text)) {
        const lines = text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 5 && l.length < 250);
        for (const line of lines) {
          if (/error|alert|required|is correctly capitalized/i.test(line) && !out.includes(line)) {
            out.push(line);
          }
        }
        continue;
      }
      // Workday renders capitalization warnings as [role="alert"] ("Alert: Verify that the field ... is correctly capitalized").
      // Keep capitalization alerts so refillErrorFields can auto-correct them!
      if (!text || text.length >= 300 || (/^alert\s*:/i.test(text) && !/capital/i.test(text)) || isNoisePrompt(text)) continue;
      if (!out.includes(text)) out.push(text);
    }
    const body = String(document.body?.innerText || '').slice(0, 4000);
    const match = body.match(/(?:please|must) (?:fill|complete|enter|select|answer)[^\n.]{0,120}/gi);
    if (match) match.slice(0, 5).forEach((text) => { if (!out.includes(text)) out.push(text); });
    return out.slice(0, 20);
  }

  function allFileInputs() {
    return queryAllDeep('input[type="file"]').sort((a, b) => {
      const aText = `${a.id} ${a.name} ${labelFor(a)}`.toLowerCase();
      const bText = `${b.id} ${b.name} ${labelFor(b)}`.toLowerCase();
      return (/resume|cv/i.test(aText) ? -1 : 0) - (/resume|cv/i.test(bText) ? -1 : 0);
    });
  }

  async function ensureResumeFile(pending) {
    if (!pending?.resumeBase64) {
      const fromBg = await runtimeSend({ type: 'HAMZOOH_GET_RESUME' });
      if (fromBg?.resumeBase64) {
        pending.resumeBase64 = fromBg.resumeBase64;
        pending.resumeName = fromBg.resumeName || pending.resumeName;
      }
    }
    return resumeFile(pending);
  }

  async function attachGeneratedResume(pending) {
    const file = await ensureResumeFile(pending);
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
    // Never fall back to whatever resume LinkedIn happens to have selected.
    // The tailored resume must be the one attached to this application.
    if (attached) {
      // Phase 1i: confirm the browser actually holds the file and, where the
      // page shows it, that its name is visible before moving to Next.
      let verified = allFileInputs().some((input) => input.files && input.files.length > 0);
      const startedAt = Date.now();
      while (!verified && Date.now() - startedAt < 2500) {
        await sleep(250);
        verified = allFileInputs().some((input) => input.files && input.files.length > 0);
      }
      const nameShown = String(document.body?.innerText || '').includes(file.name);
      runEvent('resume_verified', { verified, nameShown, name: file.name }, `Resume verification: files=${verified}, filename shown=${nameShown}`);
      sendProgress('resume_attached', `📎 Attached ${file.name}`);
      await sleep(800);
    } else {
      skipped.push({ field: 'resume', reason: 'Could not find a file input or dropzone for the resume.' });
      sendProgress('resume_failed', '⚠️ Could not attach the tailored resume — no file input found.');
    }
    return attached;
  }

  // LinkedIn Easy Apply often shows previously uploaded resumes instead of a
  // file input. The tailored resume must still win: upload it (or select the
  // row that already holds it), and never silently reuse another resume.
  function linkedInResumeOptionRows(modal = findLinkedInModal() || document) {
    const rows = queryAllDeep(
      '.jobs-document-upload__title, [data-test-document-upload-resume], .jobs-resume-picker__resume-item, .jobs-document-upload__container li, li',
      modal,
    ).filter((el) => visible(el)
      && /\.(pdf|docx?|doc)\b/i.test(el.innerText || '')
      && (el.innerText || '').replace(/\s+/g, ' ').length < 220);
    // Keep the innermost row: wrappers list every file and would confuse clicks.
    return rows.filter((el) => !rows.some((other) => other !== el && el.contains(other)));
  }

  async function chooseLinkedInResumeOption(row) {
    if (!row) return false;
    const scope = row.closest('li, label, .jobs-document-upload__container, [data-test-document-upload-resume]') || row;
    const radio = queryAllDeep('input[type="radio"]', scope).find(visible)
      || scope.querySelector?.('input[type="radio"]');
    if (radio?.checked) return true;
    // Click the title text, never the whole row: each row also holds a
    // download icon, and clicking the centre used to download the resume.
    const title = queryAllDeep('.jobs-document-upload__title', scope).find(visible) || row;
    await realClick(title);
    await sleep(450);
    if (radio && !radio.checked) {
      try { radio.click(); } catch {}
      await sleep(250);
    }
    if (radio) return radio.checked;
    return scope.getAttribute('aria-expanded') === 'true'
      || scope.getAttribute('aria-checked') === 'true'
      || /selected|active/i.test(String(scope.className || ''));
  }

  function linkedInResumePickerPresent() {
    if (!/linkedin\.com/i.test(location.hostname)) return false;
    const modal = findLinkedInModal();
    if (!modal) return false;
    const text = String(modal.innerText || '');
    if (/select or upload a resume|upload resume|tailor resume with ai/i.test(text)) return true;
    return queryAllDeep('input[type="file"]', modal).some(visible);
  }

  async function selectLinkedInResume(pending) {
    if (!/linkedin\.com/i.test(location.hostname)) return false;
    const modal = findLinkedInModal() || document;
    const file = await ensureResumeFile(pending);
    const stem = String(pending?.resumeName || file?.name || '').replace(/\.[^.]+$/, '').toLowerCase();
    const companyClean = String(pending?.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const matchesTailored = (row) => {
      const text = String(row.innerText || '').toLowerCase();
      if (!text) return false;
      if (file?.name && text.includes(String(file.name).toLowerCase())) return true;
      if (stem.length >= 5 && text.includes(stem)) return true;
      // Match by company keyword if company has at least 4 letters (e.g. "rapidclaims")
      if (companyClean.length >= 4 && text.replace(/[^a-z0-9]/g, '').includes(companyClean)) return true;
      // Match prefix (LinkedIn cuts off with ellipsis "..." at ~25-30 chars, e.g. "NELLURU-RapidClaims-Bengalu-...")
      const prefix = stem.slice(0, 20);
      if (prefix.length >= 8 && text.includes(prefix)) return true;
      // Match significant word parts (e.g. candidate name + company name)
      const parts = stem.split(/[-_\s.]+/).filter((p) => p.length >= 4);
      if (parts.length >= 2 && parts.slice(0, 2).every((p) => text.includes(p))) return true;
      return false;
    };

    // 1. The tailored resume is already in the list (uploaded on a prior run):
    //    select exactly that row.
    let row = linkedInResumeOptionRows(modal).find(matchesTailored);
    if (row) {
      const chosen = await chooseLinkedInResumeOption(row);
      runEvent('resume_selected', {
        label: String(row.innerText || '').replace(/\s+/g, ' ').slice(0, 140), tailored: true,
      }, 'Selected the tailored resume in the LinkedIn Easy Apply modal');
      return chosen;
    }

    // 2. Upload the tailored PDF — the normal path.
    if (file) {
      let input = queryAllDeep('input[type="file"]', modal).find((el) => !el.disabled)
        || allFileInputs().find((el) => !el.disabled) || null;
      if (!input) {
        const uploadBtn = queryAllDeep('button, a, label', modal).find((el) => visible(el)
          && /^(upload resume|upload (a )?(cv|resume)|choose file)$/i.test((el.innerText || '').trim()));
        if (uploadBtn) {
          await realClick(uploadBtn);
          const startedAt = Date.now();
          while (Date.now() - startedAt < 3000 && !allFileInputs().length) await sleep(150);
          input = queryAllDeep('input[type="file"]', modal).find((el) => !el.disabled)
            || allFileInputs().find((el) => !el.disabled) || null;
        }
      }
      if (input) {
        const attached = attachResume(input, file);
        if (attached) {
          runEvent('resume_upload', { name: file.name }, `Uploading tailored resume ${file.name}`);
          sendProgress('resume_uploading', `📎 Uploading ${file.name}…`);
          const startedAt = Date.now();
          let uploadedRow = null;
          while (Date.now() - startedAt < 15000) {
            await sleep(500);
            uploadedRow = linkedInResumeOptionRows(modal).find(matchesTailored);
            if (uploadedRow) break;
            if (String(document.body?.innerText || '').toLowerCase().includes(String(file.name).toLowerCase())) {
              uploadedRow = linkedInResumeOptionRows(modal).find(matchesTailored);
              if (uploadedRow) break;
            }
          }
          if (!uploadedRow) uploadedRow = linkedInResumeOptionRows(modal).find(matchesTailored);
          if (uploadedRow) {
            await chooseLinkedInResumeOption(uploadedRow);
            sendProgress('resume_attached', `📎 Uploaded ${file.name}`);
            runEvent('resume_selected', {
              label: String(uploadedRow.innerText || '').replace(/\s+/g, ' ').slice(0, 140), tailored: true,
            }, 'Uploaded and selected the tailored resume');
            return true;
          }
          if (allFileInputs().some((el) => el.files && el.files.length > 0)) {
            sendProgress('resume_attached', `📎 Uploaded ${file.name}`);
            return true;
          }
        }
      }
    }

    // 3. Last resort only: say plainly that an existing resume was used.
    // Prefer a generic candidate resume over a resume tailored for a different company!
    const nonOtherCompanyRow = linkedInResumeOptionRows(modal).find((r) => {
      const t = String(r.innerText || '').toLowerCase();
      return !/-tailored-|-tai-\.\.\./i.test(t);
    }) || linkedInResumeOptionRows(modal)[0];
    if (nonOtherCompanyRow) {
      await chooseLinkedInResumeOption(nonOtherCompanyRow);
      runEvent('resume_fallback_existing', {
        label: String(nonOtherCompanyRow.innerText || '').replace(/\s+/g, ' ').slice(0, 140),
      }, 'Tailored resume could not be uploaded — selected an existing resume');
      sendProgress('resume_fallback', '⚠️ Tailored resume could not be uploaded — selected an existing resume for this step.');
      return true;
    }
    return false;
  }

  function handleSaveApplicationPrompt() {
    const dialogs = queryAllDeep('.artdeco-modal, [role="dialog"]');
    const saveDialog = dialogs.find((el) => {
      const text = String(el.innerText || '').toLowerCase();
      return text.includes('save this application') || text.includes('save to return to this application later');
    });
    if (saveDialog && visible(saveDialog)) {
      // Find the dismiss 'X' button on this confirmation dialog to stay in the application:
      const closeBtn = saveDialog.querySelector('.artdeco-modal__dismiss, [data-test-modal-close-btn], button[aria-label="Dismiss"]');
      if (closeBtn) {
        try {
          closeBtn.click();
          runEvent('save_dialog_dismissed', {}, 'Dismissed "Save this application?" confirmation to stay on application');
          return true;
        } catch {}
      }
      try {
        saveDialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        return true;
      } catch {}
    }
    return false;
  }

  // Premium/upsell cards inside the Easy Apply modal can cover the Next button.
  // Dismiss ONLY small banner/toast/tooltip promotions, and NEVER the application modal's
  // own close button or any dialog close button (which triggers "Save this application?").
  async function dismissBlockingUpsells() {
    handleSaveApplicationPrompt();

    const modal = findLinkedInModal();
    // Only search inside explicit promotional banners, toasts, and tooltips:
    const promoContainers = queryAllDeep(
      '.artdeco-toast, .artdeco-inline-feedback, .artdeco-hoverable-content, [class*="toast"], [class*="banner"], [class*="tooltip"], [class*="upsell"], [class*="promo"], .jobs-easy-apply-modal__ad',
      document
    );
    for (const container of promoContainers) {
      if (!visible(container)) continue;
      // Never touch the main modal header or close controls!
      if (modal && (container === modal || container.contains(modal) || container.closest('.jobs-easy-apply-modal__header, [data-test-modal-header]'))) continue;
      const dismissBtn = queryAllDeep('button, [role="button"]', container).find((el) => {
        if (!visible(el)) return false;
        if (el.matches('.artdeco-modal__dismiss, [data-test-modal-close-btn], .jobs-easy-apply-modal__dismiss-button')) return false;
        const text = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        return /^(dismiss|no thanks|not now|maybe later|got it|skip|✕|×)$/i.test(text);
      });
      if (dismissBtn) {
        try {
          await realClick(dismissBtn);
          await sleep(250);
          runEvent('upsell_dismissed', { label: buttonText(dismissBtn) }, 'Dismissed a blocking promo/upsell');
        } catch {}
      }
    }
  }


  function detectCaptchaOrMFA() {
    const captchaIframes = queryAllDeep('iframe').filter((iframe) => /recaptcha|hcaptcha|captcha|turnstile|challenge/i.test(
      `${iframe.getAttribute('src') || ''} ${iframe.src || ''} ${iframe.title || ''} ${iframe.name || ''}`,
    ));
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

  function askHamzoohQuestion(question, fieldIndex, totalFields, options = [], reason = '', sensitive = false) {
    const safeQuestion = String(question || '').replace(/\s+/g, ' ').trim();
    const safeOptions = cleanOptions(options);
    // Never surface ATS chrome (progress steps, hint text, stray values) as a
    // question. Asking the user about it would be confusing and unanswerable.
    if (isNoisePrompt(safeQuestion) && safeOptions.length === 0) {
      runEvent('question_suppressed', { question: safeQuestion.slice(0, 200), reason }, 'Suppressed a non-question prompt (page chrome, not a real field).');
      return Promise.resolve(null);
    }
    question = safeQuestion;
    options = safeOptions;
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
            <div class="hamzooh-subtitle">${escapeHtml(sensitive ? 'Used for this application only — not saved automatically' : (reason || 'Saved to Vault — reused next time'))}</div>
          </div></div>
          <div class="hamzooh-body">
            <div class="hamzooh-question">"${escapeHtml(question.length > 140 ? question.slice(0, 137) + '…' : question)}"</div>
            ${optHtml}
            <input class="hamzooh-input" id="hamzooh-answer-input" type="text" placeholder="Your answer…" />
            <label style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;color:#475569;">
              <input type="checkbox" id="hamzooh-remember-check" ${sensitive ? 'disabled' : 'checked'} /> ${sensitive ? 'Sensitive answer — saving requires consent in the dashboard' : 'Save to Vault (never ask again)'}
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
      const finish = (answer, remember) => {
        container.remove();
        if (answer == null) resolve({ skipped: true });
        else resolve({ answer, remember });
      };
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
    // The vault is per-user now, so the request carries either the dashboard
    // session or the task token. `approved` is only true when the candidate
    // typed or confirmed the answer themselves.
    await proxyFetch('/api/vault/answers', {
      question,
      answer,
      approved: approved === true,
      taskId: CURRENT_TASK_ID,
      taskToken: CURRENT_TASK_TOKEN,
    });
  }

  async function queryServerVaultMatch(question) {
    const res = await proxyFetch('/api/vault/answers/match', { question });
    return res?.data?.match?.answer || null;
  }

  // Cache AI answers per question so the 10 req/min free tier is never spammed
  // by the same field being questioned again on a later step.
  const inferCache = new Map();
  const INFER_CACHE_MS = 10 * 60 * 1000;

  async function inferAnswerWithAI(question, options, profile, jobTitle, company, resumeText, pending = null) {
    if (!question || isNoisePrompt(question)) return { answer: null, reason: 'unanswerable-question' };
    const cacheKey = `${String(question).toLowerCase()}|${(options || []).join('|').toLowerCase()}`;
    const cached = inferCache.get(cacheKey);
    if (cached && (Date.now() - cached.at) < INFER_CACHE_MS) return cached.value;

    const finish = (value) => {
      inferCache.set(cacheKey, { value, at: Date.now() });
      return value;
    };

    const res = await proxyFetch('/api/vault/infer-answer', {
      question,
      options,
      profile,
      jobTitle,
      company,
      resumeText,
      jobSource: pending?.jobSource || profile?.jobSource || profile?.source || '',
      url: pending?.url || location.href,
      taskId: pending?.taskId || '',
      taskToken: pending?.taskToken || '',
    });
    const data = res?.data;
    if (data?.canInfer !== false && data?.answer) return finish({ answer: data.answer, source: data.source || 'ai-inference' });
    return finish({ answer: null, reason: data?.reason || data?.message || 'unanswered' });
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

  function findLinkedInModal() {
    const candidates = queryAllDeep('.jobs-easy-apply-modal, [data-test-modal-id="easy-apply-modal"], .artdeco-modal[role="dialog"], [role="dialog"], .artdeco-modal, div[class*="modal"]');
    const found = candidates.find((el) => {
      const r = el.getBoundingClientRect?.() || { width: 0, height: 0 };
      if (r.width < 100 || r.height < 100) return false;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const text = (el.innerText || '').toLowerCase();
      return text.includes('apply to') || text.includes('easy apply') || el.classList.contains('jobs-easy-apply-modal') || el.getAttribute('data-test-modal-id') === 'easy-apply-modal';
    });
    if (found) return found;
    // LinkedIn sometimes renders the modal without a dialog role. Walk up
    // from the visible Next button until we find the "Apply to … / N of M
    // pages" container.
    const next = queryAllDeep('button').find((b) => /^next$/i.test((b.innerText || '').trim()) && visible(b));
    if (!next) return null;
    let node = next.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const text = (node.innerText || '').toLowerCase();
      if (/\d+\s*\/\s*\d+\s*pages|select or upload a resume|upload resume/.test(text)) return node;
    }
    return null;
  }

  async function waitForLinkedInModalReady() {
    const start = Date.now();
    while (Date.now() - start < 25000) {
      const modal = findLinkedInModal();
      if (modal) {
        // Check if there is an active loading spinner inside the modal
        const spinner = modal.querySelector('.artdeco-loader, .artdeco-spinner, [data-automation-id="loading-spinner"], svg.artdeco-loader__bars, .loader');
        const inputs = queryAllDeep('input, select, textarea', modal).filter((el) => {
          const type = (el.getAttribute('type') || '').toLowerCase();
          return !['hidden', 'submit', 'button'].includes(type) && visible(el);
        });
        const hasButtons = Boolean(queryAllDeep(ACTION_SELECTOR, modal).find((b) => isAdvanceButton(b) || isSubmitButton(b)));

        if (!spinner && (inputs.length > 0 || hasButtons)) {
          return modal;
        }
      }
      await sleep(500);
    }
    return findLinkedInModal();
  }

  function findLinkedInEasyApplyButton() {
    // If the modal is already open, NEVER return the apply button!
    if (findLinkedInModal()) return null;

    // 1. Direct LinkedIn apply button classes and data attributes
    const directCandidates = queryAllDeep('.jobs-apply-button, button.jobs-apply-button, [data-control-name*="apply"], [data-job-id], button[class*="jobs-apply"]').filter((el) => {
      if (el.disabled) return false;
      const r = el.getBoundingClientRect?.() || { width: 0, height: 0 };
      if (r.width === 0 || r.height === 0) return false;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const text = (el.innerText || el.getAttribute('aria-label') || '').toLowerCase();
      return text.includes('easy apply') || text.includes('apply');
    });
    if (directCandidates.length > 0) return directCandidates[0];

    // 2. Any button or role=button with text matching "Easy Apply"
    const allButtons = queryAllDeep(ACTION_SELECTOR).filter((el) => {
      if (el.disabled) return false;
      const r = el.getBoundingClientRect?.() || { width: 0, height: 0 };
      if (r.width === 0 || r.height === 0) return false;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase();
      return /easy\s*apply/i.test(text);
    });
    if (allButtons.length > 0) return allButtons[0];

    return null;
  }

  // Scored discovery of the initial Apply control. On job description pages it
  // can be a link, button, div[role=button], a shadow-root control, or an
  // <a href="/apply"> whose visible text is only "I'm interested".
  function scoreApplyCandidate(el) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const href = norm(el.getAttribute('href'));
    const visibleText = norm([el.innerText, el.value].filter(Boolean).join(' '));
    const attrsText = norm([el.getAttribute('aria-label'), el.title,
      el.getAttribute('data-testid'), el.getAttribute('data-automation-id')].filter(Boolean).join(' '));
    const text = `${visibleText} ${attrsText}`;
    if (!text) return -1;
    // Only VISIBLE text decides whether this is an Apply control. Aria-labels
    // on nav links ("Home", "Search for jobs to apply", "privacy notice")
    // produced false positives that broke Workday/Workable in the harness.
    if (!/apply|interested|start application|begin application|complete (your )?application|continue (your )?application|resume (your )?application|finish (your )?application/i.test(visibleText) && !/\/apply|apply=/i.test(href)) return -1;
    if (/search for jobs|view all jobs|browse jobs|privacy|cookie|accept all|decline all|settings|language|english|manage settings|^home$/i.test(visibleText)) return -1;
    if (/apply (filter|to all|changes)|save (job|this)|share|sign in|log in|contact sales|attach file|create alert|job alert/i.test(text)) return -1;
    let score = 0;
    if (/^(apply|apply now|apply for this job|apply for job|apply to this job|start application|begin application|continue to apply|easy apply|complete (your )?application|continue (your )?application|resume (your )?application|finish (your )?application)$/i.test(visibleText)) score += 60;
    else if (/\b(i'?m interested|i am interested)\b/i.test(visibleText)) score += 25;
    else if (/\b(apply now|easy apply|apply for this job|start application|begin application|complete (your )?application|continue (your )?application|resume (your )?application|finish (your )?application)\b/i.test(visibleText)) score += 35;
    else if (/\bapply\b/i.test(visibleText)) score += 20;
    if (/apply/i.test(attrsText)) score += 15;
    if (/\/apply|apply=/i.test(href)) score += 30;
    if (/apply/i.test(norm(el.getAttribute('data-testid') || el.getAttribute('data-automation-id') || el.getAttribute('data-qa') || ''))) score += 20;
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') score += 10;
    else if (el.tagName === 'A') score += 8;
    if (el.getAttribute('target') === '_blank' || /_blank/.test(norm(el.getAttribute('rel')))) score -= 5;
    const form = el.closest?.('form');
    if (form && form.querySelectorAll('input, textarea, select').length >= 3) return -1;
    return score;
  }

  function findDescriptionApplyButtons() {
    // Check for LinkedIn Easy Apply first
    const easyApply = findLinkedInEasyApplyButton();
    if (easyApply) return [easyApply];

    const out = [];
    for (const el of queryAllDeep(ACTION_SELECTOR)) {
      try {
        if (el.disabled || !visible(el)) continue;
        const score = scoreApplyCandidate(el);
        if (score < 10) continue;
        const r = el.getBoundingClientRect?.() || { top: 0 };
        out.push({ el, top: r.top, score });
      } catch {}
    }
    out.sort((a, b) => b.score - a.score || a.top - b.top);
    return out.map((o) => o.el);
  }

  // After the first Apply click a portal may open its own menu (Wipro's green
  // "Apply now ▾" → "Apply Now" item). A retry must click that item, not the
  // toggle that just opened it, or the run toggles the menu forever.
  function pickApplyCandidate(buttons, retry = false) {
    if (!retry || buttons.length < 2) return buttons[0];
    const inOpenMenu = (el) => Boolean(el.closest(
      '[role="menu"], [role="listbox"], .dropdown-menu, [class*="dropdown"][class*="open"], [class*="menu"][class*="open"], [class*="Menu"]',
    ));
    const isToggle = (el) => el.hasAttribute?.('aria-haspopup') || el.hasAttribute?.('aria-expanded')
      || /[▾⌄▼]$/.test(String(el.innerText || '').trim())
      || /dropdown[-_]?toggle/i.test(el.className || '');
    const ranked = buttons.map((el, index) => {
      let score = 100 - index;
      if (inOpenMenu(el)) score += 60;
      if (!isToggle(el)) score += 25;
      const href = el.getAttribute?.('href') || '';
      if (href && !/^#|^javascript:/i.test(href)) score += 15;
      return { el, score };
    });
    ranked.sort((a, b) => b.score - a.score);
    return ranked[0]?.el || buttons[0];
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
    try { target.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch {
      try { target.scrollIntoView({ block: 'center' }); } catch {}
    }
    await sleep(200);
    let rect = target.getBoundingClientRect();
    // Smooth scroll / sticky headers can leave the target outside the viewport.
    for (let attempt = 0; attempt < 12
      && (rect.bottom < 0 || rect.top > window.innerHeight || rect.width <= 1); attempt += 1) {
      await sleep(150);
      rect = target.getBoundingClientRect();
    }
    try {
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const inViewport = rect.width > 1 && rect.height > 1
        && x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight;
      if (CDP_AVAILABLE && window.top === window && inViewport) {
        const ok = await cdpInput({ action: 'click', x, y });
        if (ok) {
          runEvent('cdp_click', { x, y, label: buttonText(target) }, `Trusted CDP click: ${buttonText(target)}`);
          return;
        }
        CDP_AVAILABLE = false;
      }
      const base = {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, button: 0,
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
    if (/linkedin\.com/i.test(location.hostname)) {
      // On LinkedIn, a form ONLY exists when the Easy Apply modal is OPEN and loaded!
      const modal = findLinkedInModal();
      if (!modal) return false;
      const inputs = queryAllDeep('input, select, textarea', modal).filter((el) => {
        const type = (el.getAttribute('type') || '').toLowerCase();
        return !['hidden', 'submit', 'button'].includes(type) && visible(el);
      });
      return inputs.length > 0 || Boolean(findAdvanceButton()) || Boolean(findSubmitButton());
    }
    if (hasResumeDropzone()) return true;
    return collectInputs().filter((i) => (i.getAttribute('type') || '') !== 'password').length >= 1;
  }

  // A registration/profile step of an application (Siemens: Login/Registration
  // → Profile information with Title, First name, Last name, Email and a
  // password further down) is the application itself, not a sign-in wall.
  // Naming a candidate is what a login screen never does.
  function looksLikeApplicationForm() {
    try {
      const fields = collectInputs().filter((el) => {
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (type === 'password') return false;
        return visible(el);
      });
      if (fields.length < 2) return false;
      const text = String(document.body?.innerText || '').slice(0, 6000).toLowerCase();
      if (/first name|last name|full name|surname|given name|phone|mobile|address|resume|curriculum|cover letter/.test(text)) return true;
      return fields.length >= 3 && !queryAllDeep('input[type="password"]').some(visible);
    } catch { return false; }
  }

  // Portals that gate the application behind their own account (Wipro, Workday
  // tenants, Taleo) say "Please sign into your application" / "Sign in or Sign
  // up" before showing a single field. That is the candidate's step, not a
  // failure: the run parks, tells them, and continues once they are signed in.
  const SIGNIN_GATE_RE = new RegExp([
    'please sign ?in to (your )?application',
    'please sign ?into (your )?application',
    'sign ?in to (your )?application',
    'sign ?into (your )?application',
    'sign ?in or sign ?up',
    'sign ?in or create an account',
    '(sign|log) ?in to (continue|complete|start) (your )?application',
    'please (sign|log) ?in to (continue|apply)',
    'sign ?in to apply',
    'log ?in to apply',
    'please (log ?in|login) to continue',
    'create an account to apply',
  ].join('|'), 'i');

  function detectLoginWall() {
    try {
      // An application/profile step is filled, never treated as a wall — even
      // if a password box from its own registration form is on the page.
      if (looksLikeApplicationForm()) return false;
      if (queryAllDeep('input[type="password"]').some(visible)) return true;
      const body = (document.body?.innerText || '').slice(0, 3500);
      return SIGNIN_GATE_RE.test(body);
    } catch { return false; }
  }

  // Site blocks and bot challenges are NEEDS_USER, never something to bypass.
  function detectSiteBlock() {
    try {
      const body = String(document.body?.innerText || '').slice(0, 5000);
      if (/access denied|unusual traffic|verify you are (a )?human|are you a robot|request blocked|too many requests|service unavailable|403 forbidden/i.test(body)) return 'SITE_BLOCKED';
      if (/this job (is no longer available|has been closed|has expired)|position (is no longer available|has been filled)/i.test(body)) return 'JOB_CLOSED';
      return '';
    } catch { return ''; }
  }

  // Identity providers reached by redirecting an Apply link. Filling these is
  // both wrong and a credential risk, so the automation must stop and wait.
  const AUTH_HOST_RE = /(^|\.)(accounts\.google\.com|accounts\.youtube\.com|login\.microsoftonline\.com|login\.live\.com|login\.microsoft\.com|appleid\.apple\.com|auth0\.com|okta\.com|onfido\.com|login\.workday\.com|.*\.workday\.com\/login|.*\.myworkdayjobs\.com\/.*login|sso\.|.*\.sso\.|idp\.|.*\.okta\.com)$/i;
  const AUTH_PATH_RE = /\/(signin|sign-in|login|log-in|oauth|authorize|sso|auth|session\/new|Account\/Login|users\/sign_in)\b/i;

  function detectAuthGate() {
    try {
      const host = location.hostname;
      // Identity providers always win.
      if (host && AUTH_HOST_RE.test(host)) return true;
      // A fillable application/profile step is the application itself, even when
      // a nav link or a checkpoint says "Login / Registration".
      if (looksLikeApplicationForm()) return false;
      const gateText = String(document.body?.innerText || '').slice(0, 2500);
      if (SIGNIN_GATE_RE.test(gateText)) return true;
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

    // For autonomous task runs, never type saved passwords, create accounts, or
    // touch OTP/MFA. Sign-in belongs to the candidate in their own tab.
    // Task runs never type saved passwords or create accounts; the caller parks
    // the run on the sign-in screen instead.
    if (taskMode()) return false;

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

  // Signing in on a portal is the candidate's own step. The run must not end
  // here: this tab keeps watching, so the application is filled and reviewed
  // the moment they finish signing in — no Resume click in the dashboard.
  let SIGNIN_WAIT_HOST = '';
  async function waitForCandidateSignIn(company) {
    const label = company || location.hostname;
    showTaskOverlay({
      title: 'Sign in to continue',
      subtitle: label,
      body: 'Please sign into your application in this tab ("Sign in or Sign up"). Hamzooh continues automatically the moment the application form appears — nothing to click here.',
      tone: 'linear-gradient(135deg,#4f46e5,#6366f1)',
    });
    if (SIGNIN_WAIT_HOST !== location.hostname) {
      SIGNIN_WAIT_HOST = location.hostname;
      sendProgress('login_required', `🔐 Please sign into your application for ${label}. Hamzooh will continue automatically after you sign in.`);
      await taskCheckpoint('login_required', 'Please sign into your application — automation continues automatically afterwards.', {});
    }
    await updatePending({ awaitingManualApply: true, loginHost: location.hostname, done: false });
  }

  // Registering on a portal ends with "Set your password". That is a step for
  // the candidate (the agent must never invent or store a password), but it is
  // NOT a reason to stop: it is announced on the page and the run continues by
  // itself the moment the candidate presses Continue.
  const SET_PASSWORD_RE = /set (your|a) (new )?password|create (your|a) (new )?password|choose (your|a) (new )?password|password confirmation|re-?enter (your )?password|your password must/i;

  function needsAccountPassword() {
    try {
      const boxes = queryAllDeep('input[type="password"]').filter(visible);
      if (!boxes.length) return false;
      const body = String(document.body?.innerText || '').slice(0, 5000);
      if (!SET_PASSWORD_RE.test(body) && boxes.length < 2) return false;
      return boxes.some((el) => !String(el.value || '').trim());
    } catch { return false; }
  }

  async function waitForCandidatePassword(pending) {
    const label = pending?.company || location.hostname;
    showTaskOverlay({
      title: 'Set your password',
      subtitle: label,
      body: 'This step creates your candidate account. Type a password in both boxes here in this tab and press Continue — Hamzooh carries on filling the application by itself. Nothing to click in the dashboard.',
      tone: 'linear-gradient(135deg,#4f46e5,#6366f1)',
    });
    sendProgress('password_needed', '🔑 Set your password in the job tab, then press Continue — automation continues automatically.');
    if (taskMode()) {
      await taskCheckpoint('waiting_for_user_input', 'Set your password in the job tab and press Continue. Hamzooh resumes the application automatically.', {
        status: 'waiting_for_user_input',
        data: { type: 'password' },
      });
    }
    await updatePending({ awaitingManualApply: true, loginHost: location.hostname, done: false });

    const signature = () => `${location.href}|${collectInputs()
      .map((el) => `${el.name}:${el.id}:${el.getAttribute('type') || ''}`)
      .join(',')}`;
    const before = signature();
    const startedAt = Date.now();
    let pressed = false;
    while (Date.now() - startedAt < 20 * 60 * 1000) {
      await sleep(1200);
      const boxes = queryAllDeep('input[type="password"]').filter(visible);
      const filled = boxes.length > 0 && boxes.every((el) => String(el.value || '').length >= 4);
      if (filled && !pressed) {
        const advance = findAdvanceButton();
        if (advance) {
          pressed = true;
          sendProgress('password_set', '🔓 Password entered — pressing Continue for you…');
          try { await realClick(advance); } catch {}
        }
      }
      if (!boxes.length || signature() !== before) {
        hideTaskOverlay();
        sendProgress('password_done', '✅ Password step complete — continuing the application.');
        return true;
      }
    }
    return false;
  }

  function buttonText(el) {
    return (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  }

  function isAdvanceButton(el) {
    if (!el || !visible(el) || el.disabled) return false;
    const autoId = el.getAttribute('data-automation-id') || '';
    if (/bottom-navigation-next-button|page-navigation-next-button|continue-button/i.test(autoId)) return true;
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (/continue to next step|review your application/i.test(aria)) return true;
    const text = buttonText(el);
    if (/sign in with|attach file|paste|google|github/i.test(text)) return false;
    if (/sign in with linkedin/i.test(text)) return false;
    return /^(next|continue|save and continue|save & continue|proceed|next step|review)$/i.test(text)
      || /save.?and.?continue|continue application|next page|continue to next step|review your application/i.test(text)
      || (/review/i.test(text) && Boolean(el.closest?.('.jobs-easy-apply-modal, [role="dialog"], .artdeco-modal')));
  }

  function findAdvanceButton() {
    const modal = queryAllDeep('.jobs-easy-apply-modal, [role="dialog"], .artdeco-modal').find(visible);
    if (modal) {
      const modalBtns = queryAllDeep(ACTION_SELECTOR, modal);
      const inModal = modalBtns.find((el) => isAdvanceButton(el));
      if (inModal) return inModal;
    }
    const nodes = queryAllDeep(ACTION_SELECTOR);
    return nodes.find((el) => isAdvanceButton(el)) || null;
  }

  function isSubmitButton(el) {
    if (!el || !visible(el) || el.disabled) return false;
    const autoId = el.getAttribute('data-automation-id') || '';
    if (/bottom-navigation-submit-button/i.test(autoId)) return true;
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (/submit application|submit my application/i.test(aria)) return true;
    const text = buttonText(el);
    if (!text || /sign in|log in|contact sales|attach file|paste|next|continue/i.test(text)) return false;
    // "Apply now" on a job description is the ENTRY control, not Submit.
    // Clicking it as a submit control crashed the Wipro run after the approval.
    if (/apply/i.test(text) && !/submit/i.test(text)) {
      const inApplication = Boolean(el.closest?.('form, fieldset, [data-automation-id*="formField"], [data-automation-id*="question"]'))
        || hasResumeDropzone();
      if (!inApplication) return false;
    }
    return /submit application|^submit$|^apply$|apply now|send application|submit my application|finish application/i.test(text);
  }

  function findSubmitButton() {
    const modal = queryAllDeep('.jobs-easy-apply-modal, [role="dialog"], .artdeco-modal').find(visible);
    if (modal) {
      const modalBtns = queryAllDeep(ACTION_SELECTOR, modal);
      const inModal = modalBtns.find((el) => isSubmitButton(el));
      if (inModal) return inModal;
    }
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

  function handleLinkedInDoneModal() {
    try {
      const modal = queryAllDeep('.artdeco-modal, [role="dialog"]').find((m) => {
        if (!visible(m)) return false;
        const text = (m.innerText || '').toLowerCase();
        return text.includes('application was sent') || text.includes('application submitted') || text.includes('your application has been sent');
      });
      if (modal) {
        const doneBtn = queryAllDeep('button, [role="button"]', modal).find((b) => {
          const txt = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
          return txt === 'done' || txt.includes('dismiss');
        });
        if (doneBtn) {
          try { doneBtn.click(); } catch {}
        }
        return true;
      }
    } catch {}
    return false;
  }

  // Submission is only reported once multiple success signals agree. If they
  // disagree, a cheap LLM call classifies the post-submit page.
  async function submitAndVerify(submitBtn) {
    SUBMIT_IN_PROGRESS = true;
    setTimeout(() => { SUBMIT_IN_PROGRESS = false; }, 30000);
    const beforeUrl = location.href;
    const beforeText = pageBodyText();
    const beforeSnapshot = collectInputs().map((i) => `${i.name}:${i.id}:${i.type}`).join('|');
    await realClick(submitBtn);

    const startedAt = Date.now();
    let signals = {};
    // Declared outside the loop: they are read after it to classify an
    // ambiguous post-submit page. Block-scoped consts inside the loop caused a
    // "formGone is not defined" crash right after the approved Submit.
    let formGone = false;
    let emailSent = false;
    while (Date.now() - startedAt < 25000) {
      await sleep(800);

      const text = pageBodyText();
      const successPattern = SUCCESS_PATTERNS.find((re) => re.test(text));
      const successUrl = location.href !== beforeUrl
        && /\/(thank|thanks|confirmation|success|submitted|complete|applied)|\/apply\/(status|confirm)/i.test(location.href);
      const currentSnapshot = collectInputs().map((i) => `${i.name}:${i.id}:${i.type}`).join('|');
      formGone = currentSnapshot !== beforeSnapshot && collectInputs().length === 0 && !findSubmitButton();
      emailSent = /confirmation email|we('| a)?ve emailed you|check your (inbox|email)/i.test(text);
      const negative = /something went wrong|submission failed|there was an error|please try again/i.test(text)
        || VALIDATION_PATTERNS.some((re) => re.test(text) && !beforeText.match(re));

      signals = {
        successPattern: Boolean(successPattern), successUrl, formGone, emailSent, negative,
        url: location.href,
        text: text.slice(0, 2500),
      };
      if (negative && !successPattern && !successUrl) {
        runEvent('submit_signals', signals, 'Submission showed a negative signal');
        LAST_VERIFICATION = { ok: false, reason: 'the form reported an error after Submit', url: location.href };
        return { ok: false, reason: 'the form reported an error after Submit' };
      }
      if (successPattern || successUrl) {
        runEvent('submit_signals', signals, `Submission verified: ${successPattern || 'confirmation URL'}`);
        LAST_VERIFICATION = {
          ok: true,
          reason: successPattern ? 'confirmation message shown' : `redirected to ${location.href.replace(/^https?:\/\//, '').slice(0, 80)}`,
          url: location.href,
        };
        return { ok: true, reason: LAST_VERIFICATION.reason };
      }
      if (formGone || emailSent) break;
    }

    // Ambiguous: the form disappeared but there is no explicit success text.
    if (formGone || emailSent) {
      let verdict = 'unclear';
      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'HAMZOOH_PROXY_FETCH',
            path: '/api/agent/classify-submission',
            method: 'POST',
            body: { text: signals.text || '', url: signals.url || location.href, errors: detectValidationErrors() },
          }, (result) => resolve(result || null));
        });
        verdict = response?.data?.verdict || 'unclear';
      } catch { verdict = 'unclear'; }
      runEvent('submit_signals', { ...signals, verdict, classified: true }, `Submission classified as ${verdict}`);
      LAST_VERIFICATION = {
        ok: verdict === 'submitted',
        reason: verdict === 'submitted' ? 'LLM classified the post-submit page as success'
          : `submission could not be verified (${verdict})`,
        url: location.href,
      };
      return { ok: LAST_VERIFICATION.ok, reason: LAST_VERIFICATION.reason };
    }

    runEvent('submit_signals', signals, 'No confirmation within 25s');
    LAST_VERIFICATION = { ok: false, reason: 'no confirmation appeared within 25s', url: location.href };
    return { ok: false, reason: LAST_VERIFICATION.reason };
  }

  // The candidate may finish the application by hand in the job tab (after the
  // automation stopped, or because the site only allows a manual submit). A real
  // confirmation is the candidate's own explicit action, so it is recorded as a
  // verified manual submission — the automation itself never clicks Submit.
  let SUBMIT_IN_PROGRESS = false;
  let MANUAL_SUBMISSION_REPORTED = false;
  const MANUAL_CONFIRM_URL_RE = /\/(thank|thanks|confirmation|success|submitted|applied|candidateHome)\b|\/apply\/(status|confirm|submitted)/i;

  // Stronger than the submit-time signals: "thank you for your interest" in a
  // job description is not a confirmation, and a visible form means the
  // application is not done yet.
  const CONFIRMATION_PATTERNS = [
    /application (has been |was )?(submitted|received|complete|sent)/i,
    /thank you for (applying|your application|your interest)/i,
    /we('| a)?ve received your application/i,
    /your application (is|has been) (in|under) review/i,
    /successfully (applied|submitted)/i,
    /application confirmation/i,
    /congratulations.*application/i,
    /view my applications|my applications/i,
    /candidate home/i,
  ];

  function submissionConfirmationNow() {
    if (window.top !== window) return null;
    const text = pageBodyText();
    const pattern = CONFIRMATION_PATTERNS.find((re) => re.test(text));
    const urlHit = MANUAL_CONFIRM_URL_RE.test(location.href);
    const atsConfirmElement = Boolean(
      document.querySelector('[data-automation-id="viewMyApplications"], [data-automation-id="thankYouMessage"], [data-automation-id*="confirmation"], [data-automation-id="doneButton"]')
    );
    if (!pattern && !urlHit && !atsConfirmElement) return null;
    const modalHit = queryAllDeep('.artdeco-modal, [role="dialog"]')
      .some((modal) => visible(modal) && CONFIRMATION_PATTERNS.some((re) => re.test(modal.innerText || '')));
    // A page that still shows the application form is not a confirmation.
    // Header search boxes do not count — only real form fields.
    const formInputs = collectInputs().filter((input) => input.closest(
      'form, fieldset, [data-automation-id*="formField"], [data-automation-id*="question"]',
    ));
    if (!modalHit && (formInputs.length > 0 || findSubmitButton())) return null;
    return {
      confirmation: pattern
        ? 'confirmation message shown in the job tab'
        : atsConfirmElement
          ? 'Workday confirmation screen detected'
          : `confirmation page ${location.href.replace(/^https?:\/\//, '').slice(0, 80)}`,
      url: location.href,
    };
  }

  // ── Global submission detection (no auto-apply task required) ─────────────
  // The candidate may apply from a job page that Hamzooh only knows from the
  // Job Tracker, so there is no task token to report against. A real site
  // confirmation is still solid evidence: remember it, and let the dashboard
  // match it to a tracked role and move that application to "Applied".
  let DETECTED_PAGE_REPORTED = false;
  let LAST_CONFIRMATION_WATCH_AT = 0;

  function jobLikePage() {
    const haystack = `${document.title || ''} ${location.hostname} ${location.pathname}`;
    return /job|career|apply|application|position|role|recruit|talent|hiring/i.test(haystack);
  }

  function pageCompanyGuess() {
    try {
      const meta = document.querySelector('meta[property="og:site_name"], meta[name="application-name"]');
      const fromMeta = (meta?.getAttribute('content') || '').trim();
      if (fromMeta) return fromMeta.slice(0, 120);
    } catch {}
    const host = location.hostname.replace(/^www\./i, '');
    const base = host.split('.')[0] || host;
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : '';
  }

  async function recordDetectedSubmission(hit) {
    try {
      const stored = await chrome.storage.local.get('detectedSubmissions');
      const list = Array.isArray(stored?.detectedSubmissions) ? stored.detectedSubmissions : [];
      const key = `${location.hostname.replace(/^www\./i, '').toLowerCase()}${location.pathname.replace(/\/+$/, '').toLowerCase()}`;
      const at = Date.now();
      if (list.some((item) => item?.key === key && at - Number(item.atMs || 0) < 1000 * 60 * 30)) return;
      const entry = {
        id: `det_${at.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        key,
        url: location.href.slice(0, 2000),
        host: location.hostname,
        title: String(document.title || '').slice(0, 200),
        company: pageCompanyGuess(),
        confirmation: hit.confirmation,
        atMs: at,
        at: new Date(at).toISOString(),
        source: 'content',
      };
      await chrome.storage.local.set({ detectedSubmissions: [entry, ...list].slice(0, 30) });
      runEvent('submission_page_detected', { url: entry.url, title: entry.title }, 'Detected an application confirmation page');
    } catch {}
  }

  async function watchSubmissionConfirmation() {
    if (DETECTED_PAGE_REPORTED || !extensionAlive() || window.top !== window) return;
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    if (!jobLikePage()) return;
    const now = Date.now();
    if (now - LAST_CONFIRMATION_WATCH_AT < 4000) return;
    LAST_CONFIRMATION_WATCH_AT = now;
    const stored = await chrome.storage.local.get(['pendingApply', 'detectedSubmissions']).catch(() => ({}));
    const pendingApply = stored?.pendingApply || {};
    const taskId = CURRENT_TASK_ID || pendingApply.taskId || '';
    const taskToken = CURRENT_TASK_TOKEN || pendingApply.taskToken || '';
    if (taskId && taskToken) {
      // An active or recent run owns this submission; report it against the task.
      await reportManualSubmission(taskId, taskToken, pendingApply);
      return;
    }
    let hit = null;
    try { hit = submissionConfirmationNow(); } catch { return; }
    if (!hit) return;
    DETECTED_PAGE_REPORTED = true;
    await recordDetectedSubmission(hit);
  }

  async function reportManualSubmission(taskId, taskToken, pendingApply) {
    if (MANUAL_SUBMISSION_REPORTED || SUBMIT_IN_PROGRESS || !extensionAlive()) return;
    if (!taskId || !taskToken) return;
    try {
      if (pendingApply?.url && new URL(pendingApply.url).hostname !== location.hostname) return;
    } catch { return; }
    const hit = submissionConfirmationNow();
    if (!hit) return;
    MANUAL_SUBMISSION_REPORTED = true;
    runEvent('manual_submission', hit, 'Application submitted in the job tab — recording it');
    await proxyFetch('/api/applications/extension/complete', {
      taskId,
      token: taskToken,
      status: 'submitted',
      message: `✅ Your application was submitted in the browser tab (${hit.confirmation}).`,
      verified: true,
      manual: true,
      confirmation: hit.confirmation,
      confirmationUrl: hit.url,
      url: hit.url,
    }).catch(() => null);
    sendProgress('submitted', '✅ Application submitted — recorded in Hamzooh.');
    return markPendingDone();
  }

  // Phase 1c: wait until the DOM has stopped mutating before deciding a step
  // is complete. Caps at 6s so a busy spinner can never hang the run.
  function waitForDomStable(quietMs = 800, timeoutMs = 6000) {
    return new Promise((resolve) => {
      let timer = null;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(hardStop);
        observer.disconnect();
        resolve();
      };
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(finish, quietMs);
      });
      const hardStop = setTimeout(finish, timeoutMs);
      try {
        observer.observe(document.documentElement || document, {
          subtree: true, childList: true, attributes: true, characterData: true,
        });
      } catch { finish(); return; }
      timer = setTimeout(finish, quietMs);
    });
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

  async function cdpInput(payload) {
    if (!extensionAlive()) return false;
    try {
      const result = await runtimeSend({ type: 'HAMZOOH_CDP_INPUT', ...payload });
      return Boolean(result?.ok);
    } catch { return false; }
  }

  let CDP_AVAILABLE = true;

  async function typeWithCdp(input, value) {
    if (!CDP_AVAILABLE) return false;
    try {
      input.focus();
      if (typeof input.select === 'function') input.select();
      setNativeValue(input, '');
    } catch {}
    const ok = await cdpInput({ action: 'type', text: String(value) });
    if (!ok) { CDP_AVAILABLE = false; return false; }
    try {
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true, data: String(value) }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
    } catch {}
    return String(input.value) === String(value);
  }

  // Phase 1g: always read the value back. If a framework rejected the
  // synthetic input event, fall back to trusted CDP text insertion.
  // A native <select> must be filled by OPTION TEXT, not by assigning
  // input.value: ATS forms use opaque option values ("IN"), so the old code
  // left "Select an option" in place and the step was rejected.
  function selectOptionByText(select, wanted) {
    const want = squashValue(wanted);
    if (!select || !select.options || !want) return null;
    const options = [...select.options].filter((option) => option.value !== '' && !isEmptyChoiceText(option.text));
    if (!options.length) return null;
    const text = (option) => squashValue(option.text);
    return options.find((option) => text(option) === want)
      || options.find((option) => text(option).startsWith(want) || want.startsWith(text(option)))
      || options.find((option) => text(option).includes(want) || want.includes(text(option)))
      || options.find((option) => squashValue(option.value) === want)
      || null;
  }

  function setNativeSelect(select, option) {
    if (!select || !option) return false;
    try {
      if (select.value !== option.value) select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return Boolean(select.value) && select.value === option.value;
    } catch { return false; }
  }

  async function setVerified(input, value) {
    if (input.tagName === 'SELECT') {
      const wanted = String(value == null ? '' : value).trim();
      const option = selectOptionByText(input, wanted);
      if (!option) {
        runEvent('select_no_match', {
          name: input.name || input.id || '',
          value: wanted.slice(0, 60),
          options: [...input.options].slice(0, 10).map((item) => item.text.trim()),
        }, `No option matches "${wanted.slice(0, 40)}"`);
        return false;
      }
      if (!setNativeSelect(input, option)) return false;
      await sleep(80);
      runEvent('select_option', {
        name: input.name || input.id || '',
        value: option.text.trim().slice(0, 60),
      }, `Selected "${option.text.trim().slice(0, 40)}"`);
      return true;
    }
    if (isCustomDropdownControl(input)) {
      const widget = getDropdownWidgetFor(input);
      const chosen = await selectCustomOption(widget, value);
      if (chosen) {
        runEvent('select_custom_option', {
          name: input.name || input.id || '',
          value: String(value).slice(0, 60),
        }, `Selected custom option "${String(value).slice(0, 40)}"`);
        return true;
      }
    }
    const target = normalizeValueForInput(input, value);
    if (!setNativeValue(input, target)) return false;
    await sleep(80);
    // On complex ATS like Workday, textareas and fields in error state need trusted CDP typing
    // so Workday's React state and client-side validators register genuine user keystrokes!
    if (CDP_AVAILABLE && (input.tagName === 'TEXTAREA' || input.getAttribute('aria-invalid') === 'true')) {
      const recovered = await typeWithCdp(input, target);
      if (recovered) {
        runEvent('cdp_type', { tag: input.tagName, name: input.name || '', value: String(target).slice(0, 80) }, 'Typed with CDP into textarea/invalid field');
        return true;
      }
    }
    if (String(input.value) === String(target)) return true;
    const recovered = await typeWithCdp(input, target);
    if (recovered) {
      runEvent('cdp_type', { tag: input.tagName, name: input.name || '', value: String(target).slice(0, 80) }, 'Recovered a rejected fill with CDP typing');
    } else {
      runEvent('fill_rejected', { tag: input.tagName, name: input.name || '', value: String(target).slice(0, 80) }, 'Field did not keep the typed value');
    }
    return recovered;
  }

  // Applies a value and reports whether the page actually kept it. A
  // contentEditable has no .value to read back, so it keeps the direct set.
  async function applyValue(input, value) {
    if (!input) return false;
    if (input.isContentEditable) return setNativeValue(input, value);
    return setVerified(input, value);
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

  async function rememberAnswer(answers, question, answer, options = []) {
    answers[question.toLowerCase()] = answer;
    const normKey = normalizeQuestion(question);
    if (normKey) answers[normKey] = answer;
    try { if (extensionAlive()) await chrome.storage.local.set({ answers }); } catch {}
    if (taskMode()) {
      await taskCall('/api/applications/extension/question/answer', {
        question,
        answer,
        remember: !isSensitiveQuestion(question) && !isEeoQuestion(question),
        consent: false,
        options,
      }).catch(() => null);
      return;
    }
    await syncAnswerToServer(question, answer, true);
  }

  async function fillUnknownField(input, question, options, answers, profile, pending, index, total) {
    // The candidate skipped this one: never spend an AI call or a prompt on it.
    if (isSkippedQuestion(question)) {
      skipped.push({ field: String(question || '').slice(0, 80), reason: 'Skipped by you — not asked again.' });
      return false;
    }
    // Joining-date questions are always relative to today, never a saved date.
    if (isJoiningDateQuestion(question)) {
      const nextDay = joiningDateValue(profile);
      if (await fillDateControl(input, nextDay)) {
        sendProgress('auto_filled_ai', `📅 ${question.slice(0, 40)} → ${nextDay}`);
        return true;
      }
    }
    let savedAnswer = findBestAnswer(question, answers);
    if (!savedAnswer) savedAnswer = findBestAnswer(question, await refreshTaskAnswers());
    if (!savedAnswer && !taskMode()) savedAnswer = await queryServerVaultMatch(question);
    if (!savedAnswer && taskMode()) {
      const memory = await taskCall('/api/applications/extension/answer-lookup', { question, options });
      savedAnswer = memory?.match?.answer || null;
    }
    if (savedAnswer && await applyValue(input, savedAnswer)) {
      sendProgress('auto_filled_saved', `✅ Saved answer: "${question.slice(0, 45)}"`);
      return true;
    }

    let aiResult = null;
    // The backend is the guard: it only answers sensitive questions from the
    // candidate's own stored answer or configured policy, never from the model.
    sendProgress('ai_inferring', `🧠 Analyzing: "${question.slice(0, 50)}"`);
    aiResult = await inferAnswerWithAI(question, options, profile, pending.jobTitle, pending.company, pending.resumeText, pending);
    if (aiResult?.answer && await applyValue(input, aiResult.answer)) {
      sendProgress('auto_filled_ai', `✨ ${question.slice(0, 40)} → ${String(aiResult.answer).slice(0, 30)}`);
      return true;
    }

    const reason = isSensitiveQuestion(question)
      ? 'This is personal / legal information and is not in your profile.'
      : (aiResult?.reason || 'Could not infer this from your profile or resume.');

    // Tell the backend/dashboard so the candidate can answer from Hamzooh.
    if (taskMode() && !isNoisePrompt(question)) {
      const reported = await taskCall('/api/applications/extension/question', {
        question, options, required: true, reason, index, total,
      });
      if (reported?.answer && await applyValue(input, reported.answer)) {
        sendProgress('auto_filled_saved', `✅ Saved answer: "${question.slice(0, 45)}"`);
        return true;
      }
    }

    sendProgress('asking_user', `🔑 ${question.slice(0, 60)}`);
    try { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
    await sleep(250);
    const origBorder = input.style.border;
    input.style.border = '2px solid #009688';
    let overlaySettled = false;
    const overlayPromise = askOrSkip(question, index, total, options, reason, false).then((value) => {
      overlaySettled = true;
      return value;
    });
    const dashboardPromise = taskMode()
      ? waitForDashboardAnswer(question, 180000).then((value) => {
        if (!overlaySettled) removeHamzoohOverlays();
        return value;
      })
      : Promise.resolve(null);
    const result = await Promise.race([overlayPromise, dashboardPromise]);
    overlaySettled = true;
    input.style.border = origBorder;
    if (result?.answer && await applyValue(input, result.answer)) {
      if (taskMode()) {
        await taskCall('/api/applications/extension/question/answer', {
          question,
          answer: result.answer,
          remember: isSensitiveQuestion(question) ? false : result.remember !== false,
          consent: false,
          options,
        }).catch(() => null);
          TASK_ANSWERS_MAP[normalizeQuestion(question)] = result.answer;
          answers[question.toLowerCase()] = result.answer;
      } else if (result.remember) {
        await rememberAnswer(answers, question, result.answer);
      }
      sendProgress('user_answered', `✅ You answered: "${question.slice(0, 45)}"`);
      return true;
    }
    skipped.push({ field: question.slice(0, 80), reason });
    return false;
  }

  // The page tells us exactly what it rejected ("The field Degree is required
  // and must have a value."). Use those messages to target and fix the fields
  // the agent missed, then let the caller click Next again.
  async function refillErrorFields(errorTexts, profile, answers, pending) {
    const allInputs = collectInputs();
    // Gather all inputs explicitly flagged as invalid by the framework / DOM
    const invalidInputs = allInputs.filter((el) => {
      return el.getAttribute('aria-invalid') === 'true'
        || el.classList.contains('error')
        || Boolean(el.closest?.('[aria-invalid="true"], [data-automation-id*="error"]'))
        || Boolean(el.parentElement?.querySelector?.('[role="alert"], [class*="error"], [data-automation-id*="error"]'));
    });

    const names = [];
    for (const text of errorTexts || []) {
      const match = String(text).match(/the field\s+(.+?)\s+is required/i)
        || String(text).match(/field\s+([A-Za-z\s()]+?)\s+is correctly capitalized/i)
        || String(text).match(/alert\s*[-–:]\s*([A-Za-z\s()]+)/i)
        || String(text).match(/(?:\d+\.\s*)?error\s*[-–:]\s*(.+)$/i);
      if (match && match[1]) names.push(match[1].replace(/\s+/g, ' ').trim());
      if (/phone number|phone|country phone code/i.test(String(text))) names.push('phone');
      if (/capitalized|capital letter/i.test(String(text))) {
        names.push('given name');
        names.push('family name');
        names.push('first name');
        names.push('last name');
      }
    }

    // Combine targets: elements identified by error text + elements marked invalid
    const targetElements = new Set(invalidInputs);
    for (const name of names) {
      const cleanName = name.replace(/[?*]+$/g, '').trim().toLowerCase();
      const matched = allInputs.filter((el) => {
        const label = (labelFor(el) || '').toLowerCase();
        return label && (label.includes(cleanName) || cleanName.includes(label.slice(0, 40)));
      });
      matched.forEach((el) => targetElements.add(el));
    }

    let fixed = 0;
    let aiCalls = 0;
    for (const input of targetElements) {
      const type = (input.getAttribute('type') || '').toLowerCase();
      if (['file', 'password', 'checkbox', 'radio', 'hidden'].includes(type)) continue;
      const question = labelFor(input);
      const options = input.tagName === 'SELECT' ? optionList(input).map((o) => o.text.trim()).filter(Boolean) : [];

      // Direct auto-fixes for Workday specific validation alerts
      if (isPersonNameField(question)) {
        const titleCased = titleCaseName(input.value || profileValue(profile, 'fullName'));
        if (titleCased && await setVerified(input, titleCased)) {
          fixed += 1;
          runEvent('error_field_fixed', { question, value: titleCased }, `Auto-corrected capitalization on ${question}`);
          continue;
        }
      }
      if (/phone|mobile/i.test(question) && !/extension/i.test(question)) {
        const rawDigits = String(input.value || profileValue(profile, 'phone')).replace(/\D/g, '');
        const clean10 = rawDigits.length > 10 ? rawDigits.slice(-10) : rawDigits;
        if (clean10 && await setVerified(input, clean10)) {
          fixed += 1;
          runEvent('error_field_fixed', { question, value: clean10 }, `Auto-corrected phone format on ${question}`);
          const ext = collectInputs().find((el) => /extension|\bext\b/i.test(labelFor(el)));
          if (ext && ext.value) await setVerified(ext, '');
          continue;
        }
      }
      if (/extension|\bext\b/i.test(question)) {
        if (input.value) await setVerified(input, '');
        continue;
      }

      if (isJoiningDateQuestion(question)) {
        const nextDay = joiningDateValue(profile);
        if (await fillDateControl(input, nextDay)) {
          fixed += 1;
          runEvent('joining_date_set', { question: question.slice(0, 80), value: nextDay }, `Set start date to ${nextDay} (next day after applying)`);
          continue;
        }
      }

      // If the field already has a value entered (e.g. Workday showed error despite text),
      // re-normalize it (e.g. notice period "Immediately" -> "0", CTC "360000" -> "3.6")
      let value = input.value ? normalizeValueForInput(input, input.value) : '';
      if (!value) {
        const hint = FIELD_HINTS.find((item) => item.test.test(question));
        if (hint) value = profileValue(profile, hint.key, pending.jobTitle || '', pending.company || '');
        if (!value) value = chooseFromProfile(question, profile, pending.company || '');
        if (!value) value = heuristicChoice(question, options, profile);
        if (!value) value = semanticOptionText(question, options, profile);
        if (!value && input.value) value = input.value;
        if (!value && aiCalls < 4 && !(taskMode() && isSensitiveQuestion(question))) {
          aiCalls += 1;
          const ai = await inferAnswerWithAI(question, options, profile, pending.jobTitle, pending.company, pending.resumeText, pending);
          value = ai?.answer || '';
        }
      }

      if (value) {
        if (CDP_AVAILABLE) {
          await typeWithCdp(input, value);
        } else {
          await setVerified(input, value);
        }
        fixed += 1;
        runEvent('error_field_fixed', { question: question.slice(0, 80), value: String(value).slice(0, 60) }, `Fixed rejected field "${question.slice(0, 60)}"`);
      }
    }
    return fixed;
  }

  async function fillFormPhase(profile, answers, pending) {
    const jobTitle = pending.jobTitle || '';
    const company = pending.company || '';
    sendProgress('finding_form', '🔍 Looking for the application form…');
    const inputs = await waitForForm();
    const fieldsDetected = inputs.length;

    const captchaType = detectCaptchaOrMFA();
    if (captchaType === 'mfa') {
      sendProgress('captcha_detected', '⚠️ Verification detected — waiting for you.');
      if (taskMode()) {
        await taskCheckpoint('verification_required', 'Verification code detected. Complete it in the job tab; Hamzooh will never solve or bypass it.', {
          status: 'waiting_for_user_input',
          data: { type: captchaType },
        });
      }
      if (!CURRENT_DRY_RUN) await showCaptchaPauseOverlay(captchaType);
    }

    sendProgress('filling', '📝 Filling known profile fields…');
    let filledCount = 0;
    for (const input of inputs) {
      const type = (input.getAttribute('type') || '').toLowerCase();
      if (type === 'file' || type === 'password' || type === 'checkbox' || type === 'radio') continue;
      const label = labelFor(input);
      const hint = FIELD_HINTS.find((item) => item.test.test(label));
      if (!hint) continue;
      const value = profileValue(profile, hint.key, jobTitle, company);
      if (!value) continue;
      // Leave an already-correct value untouched; fix an empty OR wrong one.
      if (inputHasExpectedValue(input, value)) continue;
      if (await setVerified(input, value)) filledCount += 1;
    }

    // Workday resume autofill post-processing cleanup:
    // 1. Correct ALL-CAPS names ("NELLURU" -> "Nelluru", "JASWANTH" -> "Jaswanth")
    // 2. Normalize phone numbers with duplicate country code ("+91 9440552825" -> "9440552825")
    // 3. Clear phone extension if mistakenly populated with a phone number
    for (const input of collectInputs()) {
      const type = (input.getAttribute('type') || '').toLowerCase();
      if (['file', 'password', 'checkbox', 'radio', 'hidden'].includes(type)) continue;
      const label = labelFor(input);
      const val = String(input.value || '').trim();
      if (!val) continue;

      if (isPersonNameField(label)) {
        const letters = val.replace(/[^A-Za-z]/g, '');
        if (letters.length > 2 && letters === letters.toUpperCase()) {
          const fixed = titleCaseName(val);
          if (fixed !== val) await setVerified(input, fixed);
        }
      } else if (/extension|\bext\b/i.test(label)) {
        const digits = val.replace(/\D/g, '');
        if (digits.length >= 7) {
          await setVerified(input, '');
        }
      } else if (/phone|mobile|\btel\b/i.test(label)) {
        const normalized = normalizePhoneValue(label, val);
        if (normalized !== val) await setVerified(input, normalized);
      }
    }

    // Start-date / availability fields are always relative to the day AFTER the
    // application runs, so they are computed here at fill time. A date split
    // into month/day/year controls is handled as one field, not three.
    const nextStartDate = joiningDateValue(profile);
    const handledDateGroups = new Set();
    for (const input of collectInputs()) {
      const type = (input.getAttribute('type') || '').toLowerCase();
      if (['file', 'password', 'checkbox', 'radio', 'hidden'].includes(type)) continue;
      const group = dateGroupOf(input);
      let label = labelFor(input);
      if (group) {
        if (handledDateGroups.has(group.container)) continue;
        handledDateGroups.add(group.container);
        // The question usually labels the group, not each mm/dd/yyyy box.
        if (!isJoiningDateQuestion(label)) label = nearestLabelText(group.container) || label;
      }
      if (!isJoiningDateQuestion(label)) continue;
      if (!group && inputHasExpectedValue(input, nextStartDate)) continue;
      if (await fillDateControl(input, nextStartDate)) {
        filledCount += 1;
        runEvent('joining_date_set', { question: label.slice(0, 80), value: nextStartDate }, `Set start date to ${nextStartDate} (next day after applying)`);
      }
    }

    let resumeOk = await selectLinkedInResume(pending);
    if (!resumeOk) resumeOk = await attachGeneratedResume(pending);
    if (resumeOk) {
      RESUME_ATTACHED = true;
      filledCount += 1;
    }

    filledCount += fillChoices(profile, answers, company);
    await fillCustomDropdowns(new Map(), answers, profile, company, pending);

    const unknown = [];
    for (const input of collectInputs()) {
      const type = (input.getAttribute('type') || '').toLowerCase();
      if (['file', 'password', 'checkbox', 'radio', 'hidden'].includes(type)) continue;
      if (!isPlaceholderValue(input)) continue;
      const label = labelFor(input);
      const hint = FIELD_HINTS.find((item) => item.test.test(label));
      if (hint) {
        const value = profileValue(profile, hint.key, jobTitle, company);
        if (value && await setVerified(input, value)) {
          filledCount += 1;
          continue;
        }
      }
      const isRequired = isRequiredField(input, label);
      if (!isRequired) {
        // Optional fields never block the flow: record why instead of asking.
        if (label) skipped.push({ field: label.slice(0, 80), reason: 'Optional field — no value in your profile or saved answers.' });
        continue;
      }
      if (label) unknown.push(input);
    }

    if (unknown.length) sendProgress('unknown_fields', `🔎 Resolving ${unknown.length} remaining fields…`);
    for (let i = 0; i < unknown.length && i < 20; i += 1) {
      const input = unknown[i];
      const question = labelFor(input);
      if (!question) continue;
      let options = input.tagName === 'SELECT' ? optionList(input).map((o) => o.text.trim()).filter(Boolean) : [];
      if (!options.length && isCustomDropdownControl(input)) {
        const widget = getDropdownWidgetFor(input);
        options = await peekDropdownOptions(widget);
      }
      if (await fillUnknownField(input, question, options, answers, profile, pending, i, unknown.length)) filledCount += 1;
    }

    filledCount += await resolveRequiredGroups(answers, pending, profile);

    const stillEmpty = requiredEmptyFields();

    runEvent('form_filled', {
      url: location.href,
      fieldsDetected,
      filledCount,
      emptyCount: stillEmpty.length,
      resumeAttached: RESUME_ATTACHED,
      nextClicks: NEXT_CLICKS,
      missing: stillEmpty.map((input) => labelFor(input).slice(0, 90)).filter(Boolean),
    }, `Form filled: ${filledCount}/${fieldsDetected} fields, ${stillEmpty.length} required still empty`);

    if (taskMode()) {
      await taskCheckpoint('form_filled', `Filled ${filledCount} field(s) on this step${stillEmpty.length ? `; ${stillEmpty.length} required field(s) still need you` : ''}.`, {
        status: 'filling_application',
        filledCount,
        emptyCount: stillEmpty.length,
        resumeAttached: RESUME_ATTACHED,
        data: { url: location.href, fieldsDetected, missing: stillEmpty.map((input) => labelFor(input).slice(0, 90)).filter(Boolean) },
      });
    }

    const captchaDetected = detectCaptchaOrMFA();
    if (captchaDetected === 'captcha' && !CURRENT_DRY_RUN) {
      sendProgress('captcha_detected', '⚠️ Form filled! Complete the CAPTCHA before submission.');
      try {
        const captchaEl = queryAllDeep('input, [class*="captcha"], [id*="captcha"]').find((el) => isCaptchaElement(el) || /captcha/i.test(el.id || el.className));
        captchaEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {}
      if (taskMode()) {
        await taskCheckpoint('verification_required', 'All form fields are prepared. Complete the CAPTCHA in the job tab to proceed with submission.', {
          status: 'waiting_for_user_input',
          data: { type: 'captcha' },
        });
      }
      await showCaptchaPauseOverlay('captcha');
    }

    return { filledCount, stillEmpty, fieldsDetected };
  }

  // Required can be declared on the group wrapper (aria-required on
  // mat-radio-group / role=radiogroup) rather than on each option.
  function groupIsRequired(input, question) {
    if (isRequiredField(input, question)) return true;
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

  // Apply a decided answer to a radio/checkbox group. A group whose options are
  // sentences ("None of the conditions above apply to me") is answered with the
  // option TEXT, which the yes/no-only checkbox branch used to ignore — the
  // field stayed empty and the run asked for an answer it had already decided.
  function applyGroupChoice(group, wanted) {
    const value = String(wanted || '').trim();
    if (!value) return null;
    const direct = group.items.find((item) => {
      try { return applyChoice(item, value) && item.checked; } catch { return false; }
    });
    if (direct) return direct;
    const squash = (text) => normalizeQuestion(text).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const target = squash(value);
    if (!target) return null;
    const ranked = group.items
      .map((item) => ({ item, text: squash(optionTextFor(item)) }))
      .filter((entry) => entry.text)
      .map((entry) => ({
        ...entry,
        score: entry.text === target ? 3
          : entry.text.includes(target) || target.includes(entry.text) ? 2
            : questionSimilarity(entry.text, target) >= 0.6 ? 1 : 0,
      }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || best.score < 2) return null;
    if (!best.item.checked) clickChoice(best.item);
    return best.item.checked ? best.item : null;
  }

  // "Which specific conditions apply to you?" groups end with an explicit
  // "None of the conditions above apply to me". When none of the other options
  // names an employer that appears in the candidate's own history, that option
  // is the correct answer and the run must not stop to ask.
  function noneOfTheAboveChoice(group, profile) {
    if (group.type !== 'checkbox' || group.items.length < 2) return null;
    const none = group.items.find((item) => /^\s*none\b|none of the (above|these|following)|not applicable|none apply/i.test(optionTextFor(item) || ''));
    if (!none) return null;
    const history = JSON.stringify([
      ...(Array.isArray(profile?.experience) ? profile.experience : []),
      ...(Array.isArray(profile?.internships) ? profile.internships : []),
    ]).toLowerCase();
    const named = group.items
      .filter((item) => item !== none)
      .map((item) => String(optionTextFor(item) || ''))
      .flatMap((text) => (text.match(/\b(?:at|for|of)\s+([A-Z][A-Za-z&.'-]{1,24}(?:\s+[A-Z][A-Za-z&.'-]{1,24}){0,2})/g) || []))
      .map((phrase) => phrase.replace(/^(?:at|for|of)\s+/i, '').trim().toLowerCase())
      .flatMap((name) => [name, name.split(' ')[0]])
      .filter((name) => name.length > 2);
    if (!named.length) return null;
    if (named.some((name) => history.includes(name))) return null;
    return none;
  }

  async function resolveRequiredGroups(answers, pending, profile) {
    let resolved = 0;
    const groups = [...requiredGroupsOf().values()];
    for (let g = 0; g < groups.length; g += 1) {
      const group = groups[g];
      if (group.items.some((input) => input.checked)) continue;
      const question = group.question || '';
      // The candidate already pressed Skip on this group: leave it alone.
      if (isSkippedQuestion(question)) continue;
      const optionTexts = group.items.map((item) => (optionTextFor(item) || item.value || '').slice(0, 60));
      if (group.type === 'checkbox' && /privacy|acknowledge|agree|terms|consent/i.test(question)) {
        if (applyChoice(group.items[0], 'yes')) resolved += 1;
        continue;
      }
      // Voluntary demographic / EEO questions are never asked. Pick a
      // "decline to answer" option when offered, otherwise leave them blank.
      if (isEeoQuestion(question) || isEeoQuestion(optionTexts.join(' '))) {
        const decline = group.items.find((input) => /decline|prefer not|do not wish|not to (say|answer|disclose)|i don'?t wish/i.test(optionTextFor(input) || ''));
        if (decline && (clickChoice(decline) || applyChoice(decline, 'decline'))) resolved += 1;
        else skipped.push({ field: (question || 'Voluntary disclosure').slice(0, 80), reason: 'Voluntary/EEO question — left for you to answer if you wish.' });
        continue;
      }
      let wanted = findBestAnswer(question, answers) || findBestAnswer(question, await refreshTaskAnswers())
        || chooseFromProfile(question, profile, pending.company || '');
      if (!wanted && !(taskMode() && isSensitiveQuestion(question))) {
        wanted = heuristicChoice(question, optionTexts, profile);
      }
      if (!wanted && taskMode()) wanted = findBestAnswer(question, TASK_ANSWERS_MAP);
      if (!wanted && !taskMode()) wanted = await queryServerVaultMatch(question);
      if (!wanted) {
        // Backend safely answers sensitive questions from the stored answer or
        // configured policy; it never guesses.
        const ai = await inferAnswerWithAI(question, optionTexts.filter(Boolean), profile, pending.jobTitle, pending.company, pending.resumeText, pending);
        wanted = ai?.answer || '';
      }
      if (!wanted && taskMode() && !isNoisePrompt(question)) {
        const reported = await taskCall('/api/applications/extension/question', {
          question, options: optionTexts.filter(Boolean), required: true,
          reason: 'This required choice is not in your profile or saved answers.',
        });
        wanted = reported?.answer || '';
        if (wanted) TASK_ANSWERS_MAP[normalizeQuestion(question)] = wanted;
      }
      if (!wanted) {
        const none = noneOfTheAboveChoice(group, profile);
        if (none) {
          wanted = optionTextFor(none);
          runEvent('group_none_of_above', { question: question.slice(0, 120), option: wanted.slice(0, 120) },
            `Selected "${wanted.slice(0, 60)}" — no listed condition matches the profile.`);
        }
      }
      if (!wanted) {
        sendProgress('asking_user', `🔑 ${question.slice(0, 60)}`);
        const result = await askOrSkip(question, g, groups.length,
          optionTexts.filter(Boolean),
          isSensitiveQuestion(question)
            ? 'This is personal / legal information and is not in your profile.'
            : 'This required choice is not in your profile.');
        if (result?.answer) {
          wanted = result.answer;
          TASK_ANSWERS_MAP[normalizeQuestion(question)] = wanted;
          if (result.remember) await rememberAnswer(answers, question, wanted, optionTexts.filter(Boolean));
        }
      }
      if (!wanted) {
        skipped.push({ field: question.slice(0, 80), reason: 'Required choice was left unanswered.' });
        continue;
      }
      const hit = applyGroupChoice(group, wanted);
      if (hit) {
        answers[question.toLowerCase().slice(0, 180)] = wanted;
        resolved += 1;
      } else {
        skipped.push({ field: question.slice(0, 80), reason: `"${wanted}" is not one of the available choices.` });
      }
    }
    return resolved;
  }

  /**
   * Single approval gate for every task run, whether the form was finished by
   * the deterministic filler or by the AI agent. The browser never submits
   * until the dashboard explicitly approves, then verifies the site response.
   */
  async function taskReviewAndSubmit({
    profile, answers, pending, depth = 0,
    submitBtn = null, filledCount = 0, stillEmpty = [], advanceBlocked = false,
  }) {
    if (!taskMode()) return;
    if (!submitBtn) {
      await finish('⚠️ Stopped before approval — no submit control was found on this step.', {
        status: 'needs_attention', reasonCode: 'NO_SUBMIT_BUTTON', filledCount, emptyCount: stillEmpty.length,
      });
      return;
    }
    const reviewAnswers = Object.entries(answers || {})
      .filter(([key]) => key.length < 200 && String(key).includes(' '))
      .slice(-20)
      .map(([question, answer]) => ({ question: String(question).slice(0, 160), answer: String(answer).slice(0, 240), source: 'saved-answer' }));
    const reviewPayload = {
      company: pending.company || '',
      title: pending.jobTitle || '',
      url: location.href,
      resumeName: pending.resumeName || '',
      resumeAttached: RESUME_ATTACHED,
      filledCount,
      emptyCount: stillEmpty.length,
      missing: stillEmpty.map((el) => (questionFor(el) || labelFor(el)).slice(0, 120)).filter(Boolean),
      warnings: advanceBlocked ? ['The Next button did not advance on the previous step.'] : [],
      answers: reviewAnswers,
    };
    await taskCheckpoint('review_ready', 'Application prepared. Waiting for your approval in the Hamzooh dashboard.', {
      status: 'waiting_for_approval',
      filledCount,
      emptyCount: stillEmpty.length,
      resumeAttached: RESUME_ATTACHED,
      data: { company: pending.company || '', title: pending.jobTitle || '' },
    });
    const approval = await waitForDashboardApproval(reviewPayload);
    if (approval.decision === 'resume') {
      await sleep(700);
      await fillPage(profile, answers, { ...pending, url: location.href }, depth + 1);
      return;
    }
    if (approval.decision === 'cancel') {
      await finish(approval.message || '✗ Application cancelled from the Hamzooh dashboard.', { status: 'cancelled', reasonCode: 'USER_CANCELLED' });
      return;
    }
    if (approval.decision === 'already_submitted') {
      await finish('✅ This application was already submitted and verified by Hamzooh.', {
        status: 'submitted', verified: true, filledCount, emptyCount: 0,
      });
      return;
    }
    if (approval.decision === 'approve') {
      // Server-side approval gate immediately before the click. If this call
      // is rejected, no browser click happens.
      const attempt = await taskCall('/api/applications/extension/submission-attempt', { url: location.href });
      if (!attempt?.ok) {
        await finish(attempt?.error || 'Submission was not approved by Hamzooh. Open the dashboard and approve it before submitting.', {
          status: 'needs_attention', reasonCode: 'APPROVAL_REQUIRED', filledCount, emptyCount: stillEmpty.length,
        });
        return;
      }
      if (detectCaptchaOrMFA() === 'captcha') {
        const captchaInput = queryAllDeep('input').find((el) => isCaptchaElement(el) || /captcha/i.test(el.name || el.id || el.placeholder));
        const val = String(captchaInput?.value || '').trim();
        if (!val) {
          sendProgress('captcha_detected', '⚠️ Please solve the CAPTCHA before submitting.');
          try { captchaInput?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
          await showCaptchaPauseOverlay('captcha');
        }
      }
      await taskCheckpoint('submitting', 'Approved. Submitting the application and verifying the site response.', {
        status: 'submitting', filledCount, emptyCount: stillEmpty.length,
      });
      const verified = await submitAndVerify(submitBtn);
      if (verified.ok) {
        handleLinkedInDoneModal();
        await finish(`✅ Application submitted — ${verified.reason}. ${filledCount} fields filled.`, {
          status: 'submitted', verified: true, confirmation: verified.reason, filledCount, emptyCount: 0,
        });
      } else {
        await finish(`⚠️ Submit was clicked but the site did not confirm success (${verified.reason}). Check the job tab — Hamzooh did not mark this as submitted.`, {
          status: 'needs_attention', reasonCode: 'SUBMISSION_UNVERIFIED', verified: false, filledCount, emptyCount: 0,
        });
      }
      return;
    }
    await finish(approval.message || 'Waiting for approval timed out. The application remains prepared in this tab.', {
      status: 'needs_attention', reasonCode: 'APPROVAL_TIMEOUT', filledCount, emptyCount: stillEmpty.length,
    });
  }

  // Phase 2: hand the current page to the AI agent when deterministic logic
  // stalls. The agent only receives facts from the profile/vault and executes
  // through the same verified input helpers as the deterministic path.
  async function runAgentFallback(profile, answers, pending, reason) {
    const api = window.__HAMZOOH_AGENT_API__;
    if (!api) {
      runEvent('agent_unavailable', { reason }, 'AI agent module not loaded');
      return false;
    }
    sendProgress('agent_start', '🤖 Deterministic fill stalled — asking the AI agent for the next action…');
    runEvent('agent_start', { reason, url: location.href }, `Agent fallback: ${reason}`);
    try {
      return await api.run({ profile, answers, pending, reason }, {
        click: async (el) => {
          await realClick(el);
          // After an Apply / Autofill choice the form arrives asynchronously.
          // Wait for it here so the next OBSERVE sees the real fields instead
          // of prematurely declaring "done" on the loading page.
          const text = buttonText(el);
          if (/apply|autofill|continue|next|start application|begin/i.test(text)) {
            await waitForDomStable();
            await waitForForm();
          }
          return true;
        },
        fill: async (el, value) => setVerified(el, value),
        select: async (el, option) => {
          if (!el) return false;
          if (el.tagName === 'SELECT') {
            const wanted = String(option || '').trim().toLowerCase();
            const options = [...(el.options || [])];
            const match = options.find((o) => o.value === option || o.text.trim().toLowerCase() === wanted)
              || options.find((o) => o.text.trim().toLowerCase().includes(wanted) || wanted.includes(o.text.trim().toLowerCase()));
            if (!match) return false;
            el.value = match.value;
            ['input', 'change', 'blur'].forEach((t) => {
              try { el.dispatchEvent(new Event(t, { bubbles: true })); } catch {}
            });
            return true;
          }
          return selectCustomOption(el, String(option || ''));
        },
        check: async (el, value) => {
          if (Boolean(el.checked) !== Boolean(value)) await realClick(el);
          return Boolean(el.checked) === Boolean(value);
        },
        uploadResume: async () => attachGeneratedResume(pending),
        pressKey: async (key) => {
          try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
          } catch {}
        },
        scroll: async (direction) => {
          try { window.scrollBy({ top: direction === 'up' ? -700 : 700, behavior: 'smooth' }); } catch {}
        },
        wait: (ms) => sleep(ms),
        finish: async (message, details) => finish(message, details),
        requestReview: async (details = {}) => {
          runEvent('agent_review', { reason: details.reason || '', url: location.href }, 'Agent prepared the form — routing to the approval gate');
          const inputs = collectInputs();
          const filledCount = inputs.filter((el) => String(el.value || '').trim()).length;
          const stillEmpty = inputs.filter((el) => el.required && !String(el.value || '').trim());
          const submit = findSubmitButton();
          // Do not present an approval gate while required fields are still
          // empty. Let the deterministic filler / agent keep working.
          if (stillEmpty.length > 0) {
            runEvent('agent_review_deferred', { stillEmpty: stillEmpty.length }, `Agent said done but ${stillEmpty.length} required field(s) are empty — continuing.`);
            return;
          }
          // Multi-step forms have a Next/Continue button before Submit.
          const advance = findAdvanceButton();
          if (!submit && advance) {
            runEvent('agent_review_advance', {}, 'No submit button yet — advancing to the next form step.');
            await realClick(advance);
            await sleep(1500);
            return;
          }
          if (taskMode() && submit) {
            await taskReviewAndSubmit({
              profile, answers, pending, depth: 0,
              submitBtn: submit, filledCount, stillEmpty, advanceBlocked: false,
            });
          } else {
            await finish('✅ The AI agent prepared this application. Review and approve submission in Hamzooh.', {
              status: 'needs_attention',
              reasonCode: submit ? 'REVIEW_READY' : 'NO_SUBMIT_BUTTON',
              reviewReady: Boolean(submit), filledCount, emptyCount: stillEmpty.length,
            });
          }
        },
        log: (step, data, message) => runEvent(step, data, message),
      });
    } catch (err) {
      runEvent('agent_error', { error: err.message, stack: String(err.stack || '').slice(0, 1500) }, `Agent crashed: ${err.message}`);
      return false;
    }
  }

  async function fillPage(profile, answers, pending, depth = 0) {
    if (pending.done) return;
    if (/\/error(\/|$)|\/500(\/|$)/i.test(location.pathname)) return;

    // A company-profile / social page is never an application form. If one is
    // opened by mistake, park the run with an explanation instead of clicking
    // around a feed that has its own "Apply" buttons.
    const profilePage = /^(www\.)?(linkedin\.com\/(company|in|school|showcase)|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com)/i
      .test(`${location.hostname}${location.pathname}`) && !/linkedin\.com\/jobs/i.test(location.href);
    if (profilePage) {
      await finish('This tab opened a company profile page, not the job posting. Open the job page link (…/JobDetail/… or the employer’s apply page) and start Auto Apply again.', {
        status: 'needs_attention', reasonCode: 'JOB_PAGE_NOT_FOUND', filledCount: 0, emptyCount: 0,
      });
      return;
    }

    // 🎓 Train Mode: purely passive recording without ANY automation interfering!
    if (window.__HAMZOOH_TRAIN_MODE__ || pending?.trainMode) {
      window.__HAMZOOH_TRAIN_MODE__ = true;
      if (window.top === window) initTrainModeRecorder(location.hostname, pending || {});
      return;
    }

    if (taskMode()) {
      const gate = await taskGate();
      if (gate === 'cancel') {
        await finish('✗ Application cancelled in the Hamzooh dashboard.', { status: 'cancelled', reasonCode: 'USER_CANCELLED' });
        return;
      }
      if (gate === 'paused_timeout') {
        await finish('⏸ Still paused in the Hamzooh dashboard. Your place is saved — resume from the dashboard to continue.', {
          status: 'needs_attention', reasonCode: 'PAUSED_TIMEOUT', filledCount: 0, emptyCount: 0,
        });
        return;
      }
      await taskCheckpoint('page_ready', `Autopilot is working on ${location.hostname}${location.pathname}`.slice(0, 240), {
        status: 'filling_application', data: { title: document.title }, url: location.href,
      });
    }

    // Progress-based loop (Phase 1d): keep going only while the page state
    // actually changes. Hard cap 40 steps; stop after 3 no-progress steps.
    STEP_COUNT += 1;
    // LinkedIn Easy Apply advances through modal screens that may expose no
    // text inputs (resume picker, review). Include the step heading so moving
    // to the next screen always counts as progress.
    const linkedInStep = (() => {
      if (!/linkedin\.com/i.test(location.hostname)) return '';
      const modal = findLinkedInModal();
      if (!modal) return '';
      const heading = modal.querySelector('h2, h3, .jobs-easy-apply-modal__header, [data-test-modal-header]');
      const progress = modal.querySelector('progress, .artdeco-completeness-meter-linear__progress-element');
      return `${(heading?.innerText || '').replace(/\s+/g, ' ').slice(0, 80)}:${progress?.value ?? progress?.getAttribute?.('aria-valuenow') ?? ''}`;
    })();
    const signature = [
      location.href,
      collectInputs().map((i) => `${i.name}:${i.id}:${i.type}:${i.value}`).join('|'),
      findSubmitButton() ? 'submit' : '',
      findAdvanceButton() ? 'next' : '',
      linkedInStep,
    ].join('::');
    if (signature === LAST_SIGNATURE) NO_PROGRESS_STEPS += 1;
    else { NO_PROGRESS_STEPS = 0; LAST_SIGNATURE = signature; }
    runEvent('step', {
      step: STEP_COUNT, depth, noProgress: NO_PROGRESS_STEPS,
      url: location.href, inputs: collectInputs().length,
      submit: Boolean(findSubmitButton()), next: Boolean(findAdvanceButton()),
    }, `Step ${STEP_COUNT}: inputs=${collectInputs().length}, noProgress=${NO_PROGRESS_STEPS}`);
    if (STEP_COUNT > 40 || NO_PROGRESS_STEPS >= 3) {
      if (NO_PROGRESS_STEPS === 2) {
        const agentResult = await runAgentFallback(profile, answers, pending, 'The deterministic filler made no progress.');
        if (agentResult === 'terminal' || agentResult === 'review') return;
        if (agentResult === true) return fillPage(profile, answers, { ...pending }, depth + 1);
      }
      await finish(NO_PROGRESS_STEPS >= 3
        ? '⚠️ Stopped: the form did not change after 3 attempts (no progress).'
        : '⚠️ Stopped: reached the 40-step safety cap.', {
        status: 'needs_attention',
        reasonCode: NO_PROGRESS_STEPS >= 3 ? 'NO_PROGRESS' : 'STEP_LIMIT',
        filledCount: 0, emptyCount: 0,
      });
      return;
    }

    if (depth > 20) {
      await finish('⚠️ Too many application steps — continue manually.', { status: 'needs_attention', reasonCode: 'STEP_LIMIT', filledCount: 0, emptyCount: 0 });
      return;
    }

    const earlyApplyButtons = findDescriptionApplyButtons();
    runEvent('frame_report', {
      url: location.href,
      title: document.title,
      top: window.top === window,
      depth,
      inputs: collectInputs().length,
      fileInputs: allFileInputs().length,
      hasForm: pageHasForm(),
      applyButtons: earlyApplyButtons.slice(0, 6).map((el) => buttonText(el)),
      applyButtonCount: earlyApplyButtons.length,
      captcha: detectCaptchaOrMFA(),
      loginWall: detectLoginWall(),
    }, `Frame report: ${collectInputs().length} inputs, ${earlyApplyButtons.length} apply buttons`);

    // "Set your password" is the candidate's step, announced on the page; the
    // run waits for it and then continues by itself.
    if (needsAccountPassword()) {
      if (CURRENT_DRY_RUN) {
        await finish('🔑 This step asks you to set a password — dry run stops here.', { status: 'needs_attention', reasonCode: 'PASSWORD_REQUIRED' });
        return;
      }
      // The registration page often carries profile fields ABOVE the password
      // boxes, so fill everything the agent can before handing over the password.
      await fillFormPhase(profile, answers, pending).catch(() => null);
      const done = await waitForCandidatePassword(pending);
      if (done) return fillPage(profile, answers, { ...pending, url: location.href }, depth + 1);
      await finish('🔑 Set your password in the job tab, then click Continue — the application resumes automatically.', {
        status: 'needs_attention', reasonCode: 'PASSWORD_REQUIRED',
      });
      return;
    }

    // Check if portal needs sign in or account creation.
    // Auto-fill if credentials exist in Vault, or display a helper banner to save them.
    if (detectAuthGate() || detectLoginWall()) {
      if (CURRENT_DRY_RUN) {
        await finish('🔐 Login wall detected — dry run stops here.', { status: 'needs_attention', reasonCode: 'LOGIN_REQUIRED' });
        return;
      }
      const loggedIn = await handlePortalAuthGate(pending.company);
      if (loggedIn) {
        return fillPage(profile, answers, pending, depth + 1);
      }
      if (taskMode()) {
        // The candidate signs in; the watcher resumes by itself afterwards.
        await waitForCandidateSignIn(pending.company);
        return;
      }
      if (pending.awaitingManualApply && pending.loginHost === location.hostname) {
        await finish('🔐 Waiting for you to sign in. Use Resume after signing in.', {
          status: 'needs_attention', reasonCode: 'LOGIN_REQUIRED',
        });
        return;
      }
      sendProgress(
        'login_required',
        `🔐 Sign in or create an account for ${pending.company || location.hostname}. Hamzooh will save credentials and resume automatically.`,
      );
      await updatePending({ awaitingManualApply: true, loginHost: location.hostname });
      await finish('🔐 Sign-in is required before the application form is available.', {
        status: 'needs_attention', reasonCode: 'LOGIN_REQUIRED',
      });
      return;
    }

    // The form is here, so a leftover "sign in to continue" card must go.
    const staleGate = document.getElementById('hamzooh-task-panel');
    if (staleGate && /sign in|sign-in|log in/i.test(staleGate.textContent || '')) staleGate.remove();

    const siteBlock = detectSiteBlock();
    if (siteBlock) {
      await finish(siteBlock === 'JOB_CLOSED'
        ? '🚫 This job posting is closed or no longer available.'
        : '🚫 The site blocked automated access. Open the job tab and continue manually.', {
        status: 'needs_attention', reasonCode: siteBlock,
      });
      return;
    }

    await waitForDomStable();
    await waitForContent();
    await dismissBlockingUpsells();

    // Check if Workday or ATS is displaying an "Autofill with Resume" choice dialog
    if (await checkAndHandleApplyChoices()) {
      await updatePending({ url: location.href, applyClicked: true });
      return fillPage(profile, answers, { ...pending, applyClicked: true }, depth + 1);
    }

    const isLinkedIn = /linkedin\.com/i.test(location.hostname);
    let linkedInModal = isLinkedIn ? findLinkedInModal() : null;

    // ─── GPT-6 Luna Vision Inspection — fallback only ───
    // DOM/accessibility is the primary interface. Screenshots are reserved for
    // pages where the DOM exposes neither a form nor an apply control.
    const visionFallback = !pageHasForm() && collectInputs().length === 0 && earlyApplyButtons.length === 0;
    if (visionFallback && !pending.done && depth < 12) {
      sendProgress('vision_inspect', '👁️ GPT-6 Luna inspecting screen in this tab…');
      const visionDecision = await requestVisionDecision(profile, answers, pending);
      if (visionDecision) {
        hamzoohLog('info', 'GPT-6 Luna Vision decision', visionDecision);
        runEvent('vision_decision', visionDecision, `Luna Vision: ${visionDecision.action} (${visionDecision.screenState})`);

        if (visionDecision.action === 'wait' || visionDecision.screenState === 'modal_loading') {
          sendProgress('waiting', `⏳ GPT-6 Luna: ${visionDecision.reasoning || 'Page loading spinner detected, waiting…'}`);
          await sleep(2500);
          return fillPage(profile, answers, pending, depth + 1);
        }

        if (visionDecision.action === 'click_easy_apply' && !pending.applyClicked) {
          sendProgress('easy_apply', '💼 Easy Apply button detected by GPT-6 Luna — clicking…');
          const applyBtn = findLinkedInEasyApplyButton() || earlyApplyButtons[0];
          if (applyBtn) {
            try { applyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
            await realClick(applyBtn);
            await updatePending({ url: location.href, applyClicked: true });
            await waitForLinkedInModalReady(15000);
            return fillPage(profile, answers, { ...pending, url: location.href, applyClicked: true }, depth + 1);
          }
        }

        if (visionDecision.action === 'done' || visionDecision.screenState === 'application_submitted') {
          if (taskMode()) {
            // Never let a visual model convert a task run into a submission.
            // If the page really is a confirmation, the candidate confirms it.
            if (visionDecision.screenState === 'application_submitted') {
              await finish('⚠️ The page looks like a confirmation. Confirm it in the Hamzooh dashboard before it is recorded as submitted.', {
                status: 'needs_attention', reasonCode: 'ALREADY_SUBMITTED',
              });
              return;
            }
          } else {
            handleLinkedInDoneModal();
            sendProgress('submitted', '🎉 Application submitted successfully via GPT-6 Luna Vision!');
            return finish('✅ Application submitted successfully!', { status: 'submitted', filledCount: 1, emptyCount: 0 });
          }
        }
      }
    }

    // Check if we need to click the initial Apply / Easy Apply button.
    // RULE: If pending.applyClicked is true, NEVER click Easy Apply again!
    // Also, if the modal is already open, NEVER click Easy Apply!
    const earlyInputs = collectInputs().filter((input) => !['file', 'password'].includes(input.getAttribute('type') || ''));
    // Many portals need two clicks to reach the application: "Apply now" opens
    // a menu, then "Apply Now" inside it navigates. Retry while the real
    // application step is not on screen, capped at three clicks so one toggle
    // can never loop. Counting inputs is unreliable (job pages have search
    // boxes), so the real test is a resume dropzone or an application Submit.
    const applyClicks = Number(pending.applyClicks || 0);
    const inApplicationStep = hasResumeDropzone() || Boolean(findSubmitButton());
    const applyAllowed = !linkedInModal && !inApplicationStep
      && earlyApplyButtons.length > 0 && applyClicks < 3;
    let applyBtns = applyAllowed ? earlyApplyButtons : [];

    // Polling wait for SPA buttons (e.g. LinkedIn Ember top card)
    if (isLinkedIn && !pending.applyClicked && !linkedInModal && applyBtns.length === 0) {
      sendProgress('looking_apply', '🔍 Waiting for LinkedIn Easy Apply button to appear…');
      const startWait = Date.now();
      while (Date.now() - startWait < 8000) {
        await sleep(400);
        const waitedBtn = findLinkedInEasyApplyButton();
        if (waitedBtn && !findLinkedInModal()) {
          applyBtns = [waitedBtn];
          break;
        }
        if (findLinkedInModal()) break;
      }
    }

    if (applyBtns.length) {
      const chosenApply = pickApplyCandidate(applyBtns, Boolean(pending.applyClicked));
      sendProgress('apply_opening', isLinkedIn ? '💼 LinkedIn Easy Apply detected — clicking Easy Apply…' : '📄 Job page detected — clicking Apply…');
      const beforeUrl = location.href;
      runEvent('apply_click', { label: buttonText(chosenApply), href: location.href, attempt: applyClicks + 1 }, `Clicking apply: ${buttonText(chosenApply)}`.slice(0, 160));
      await realClick(chosenApply);
      await updatePending({ url: location.href, applyClicked: true, applyClicks: applyClicks + 1 });

      if (isLinkedIn) {
        sendProgress('modal_loading', '⏳ Waiting for LinkedIn Easy Apply form to load…');
        const modal = await waitForLinkedInModalReady();
        if (modal) {
          sendProgress('form_found', '📄 LinkedIn application form loaded — filling now…');
          await sleep(800);
          return fillPage(profile, answers, { ...pending, url: location.href, applyClicked: true }, depth + 1);
        }
      }

      const start = Date.now();
      let changed = false;
      while (Date.now() - start < 15000) {
        await sleep(500);
        if (await checkAndHandleApplyChoices()) { changed = true; break; }
        if (location.href !== beforeUrl || pageHasForm()) { changed = true; break; }
      }
      if (!changed) {
        const nextApplyClicks = applyClicks + 1;
        const retryButtons = findDescriptionApplyButtons();
        if (nextApplyClicks < 3 && retryButtons.length && !detectCaptchaOrMFA() && !detectLoginWall()) {
          sendProgress('apply_opening', '📄 Another Apply step appeared — clicking it…');
          await sleep(900);
          return fillPage(profile, answers, {
            ...pending, url: location.href, applyClicked: true, applyClicks: nextApplyClicks,
          }, depth + 1);
        }
        const captchaNow = detectCaptchaOrMFA();
        const blockedReason = captchaNow ? 'CAPTCHA'
          : detectLoginWall() ? 'LOGIN_REQUIRED' : 'APPLY_BUTTON_NOT_FOUND';
        sendProgress('login_required', blockedReason === 'CAPTCHA'
          ? '⚠️ LinkedIn showed a verification challenge. Solve it in the job tab, then click Resume.'
          : blockedReason === 'LOGIN_REQUIRED'
            ? '🔐 Log in on the job site, then click Apply — Hamzooh will continue automatically.'
            : '⚠️ Click Apply yourself — Hamzooh will fill the form when it appears.');
        await updatePending({ awaitingManualApply: true });
        await finish(blockedReason === 'CAPTCHA'
          ? '⚠️ A CAPTCHA/verification challenge blocked the application. Solve it in the job tab, then resume.'
          : blockedReason === 'LOGIN_REQUIRED'
            ? '🔐 Login is required before the application form opens.'
            : '⚠️ The Apply control did not open a form. Open the job tab and click Apply — Hamzooh will resume.', {
          status: 'needs_attention', reasonCode: blockedReason,
        });
        return;
      }
      await runtimeSend({ type: 'HAMZOOH_ADOPT_TAB' });
      await sleep(1500);
      return fillPage(profile, answers, { ...pending, url: location.href, applyClicked: true }, depth + 1);
    }

    // If on LinkedIn and modal is open, wait for the form/spinner to be ready before filling!
    if (isLinkedIn && linkedInModal) {
      const spinner = linkedInModal.querySelector('.artdeco-loader, .artdeco-spinner, [data-automation-id="loading-spinner"], svg.artdeco-loader__bars, .loader');
      if (spinner) {
        sendProgress('modal_loading', '⏳ Waiting for LinkedIn form questions to load…');
        await waitForLinkedInModalReady();
        await sleep(600);
      }
    }

    if (!pageHasForm() && detectLoginWall()) {
      if (taskMode()) {
        await waitForCandidateSignIn(pending.company);
        return;
      }
      await updatePending({ awaitingManualApply: true });
      sendProgress('login_required', '🔐 Please sign in. Hamzooh will resume when the form appears.');
      await finish('🔐 Sign-in is required before the application form is available.', {
        status: 'needs_attention', reasonCode: 'LOGIN_REQUIRED',
      });
      return;
    }

    const snapshot = collectInputs().map((i) => `${i.name}:${i.id}:${i.type}`).join('|');
    let { filledCount, stillEmpty, fieldsDetected } = await fillFormPhase(profile, answers, pending);

    // No fillable HTML fields but an actionable control is visible: this is a
    // widget/modal-only step (LinkedIn resume picker, custom ATS step, etc.).
    // The resume picker is handled deterministically above — never hand it to
    // the agent, which used to click a download icon there.
    if (fieldsDetected === 0 && !CURRENT_DRY_RUN && !linkedInResumePickerPresent()) {
      const advance = findAdvanceButton();
      // On resume upload step (e.g. Workday autofillWithResume): if resume was attached
      // or dropzone is present and Continue button is visible, advance directly to the form!
      if (advance && (RESUME_ATTACHED || hasResumeDropzone())) {
        sendProgress('page_advancing', '➡️ Resume attached — continuing to the application form…');
        await realClick(advance);
        await waitForDomStable(1500);
        await waitForForm();
        return fillPage(profile, answers, { ...pending, url: location.href }, depth + 1);
      }
      const hasControl = advance || findSubmitButton()
        || queryAllDeep('button, [role="button"]').some((el) => visible(el) && /\.(pdf|docx?|doc)\b/i.test(el.innerText || ''));
      if (hasControl) {
        sendProgress('agent_start', '🤖 No fillable fields found — asking the AI agent to drive this step…');
        const agentResult = await runAgentFallback(profile, answers, pending, 'No fillable HTML fields; the page is driven by widgets or a resume picker.');
        if (agentResult === 'terminal' || agentResult === 'review') return;
        if (agentResult === true) {
          await sleep(600);
          return fillPage(profile, answers, { ...pending, url: location.href }, depth + 1);
        }
      }
    }

    // A required field that is still empty means the site WILL reject this step
    // ("The field … is required and must have a value"). Report it and wait for
    // the candidate instead of clicking Continue into a validation error.
    if (taskMode() && stillEmpty.length > 0) {
      const unanswered = [];
      for (const el of stillEmpty.slice(0, 8)) {
        const question = questionFor(el) || labelFor(el);
        if (!question || isNoisePrompt(question)) continue;
        const options = el.tagName === 'SELECT' ? optionList(el).map((option) => option.text.trim()).filter(Boolean) : [];
        const reply = await taskCall('/api/applications/extension/question', {
          question, options, required: true,
          reason: 'This required field is empty and no saved answer applies.',
        });
        const answer = reply?.answer || '';
        if (!answer) { unanswered.push({ el, question }); continue; }
        // Apply the answer to whatever the field is — including Workday's custom
        // listbox, which used to be skipped and re-asked forever.
        if (!(await answerRequiredField(el, question, answer, profile))) unanswered.push({ el, question });
      }
      if (!unanswered.length) {
        // Every answer was applied: re-read the step before advancing.
        return fillPage(profile, answers, { ...pending, url: location.href }, depth + 1);
      }
      // Never stop the automation for a missing answer: ask, then keep the tab
      // alive. When the candidate answers in Hamzooh or fills the field by hand,
      // the step continues on its own.
      const outcome = await waitForRequiredFields(unanswered);
      if (outcome === 'cancel') {
        await finish('✗ Application cancelled in the Hamzooh dashboard.', { status: 'cancelled', reasonCode: 'USER_CANCELLED' });
        return;
      }
      if (outcome === 'timeout') {
        await finish(`⏸ ${unanswered.length} required field(s) still need your answer. Answer in Hamzooh or fill them in the job tab, then click Resume.`, {
          status: 'needs_attention',
          reasonCode: 'WAITING_FOR_USER_INPUT',
          filledCount,
          emptyCount: unanswered.length,
          question: unanswered[0].question,
        });
        return;
      }
      return fillPage(profile, answers, { ...pending, url: location.href }, depth + 1);
    }

    const advance = findAdvanceButton();
    const submitBtn = findSubmitButton();
    let advanceBlocked = false;

    // A visible submit button means we are on the final step, so show the
    // review. Otherwise step forward to the next section.
    if (advance && !submitBtn) {
      sendProgress('page_advancing', '➡️ Continuing to the next section…');
      const beforeUrl = location.href;
      let progressed = false;
      for (let attempt = 0; attempt < 4 && !progressed; attempt += 1) {
        const errors = detectValidationErrors();
        if (errors.length) {
          runEvent('validation_errors', { attempt, errors }, `Validation errors: ${errors.slice(0, 3).join(' | ')}`);
          await fillFormPhase(profile, answers, pending);
          // Re-target the exact fields the page rejected.
          const fixed = await refillErrorFields(errors, profile, answers, pending);
          if (fixed) runEvent('validation_refill', { attempt, fixed }, `Auto-fixed ${fixed} rejected field(s) before retrying`);
          await sleep(300);
        }
        NEXT_CLICKS += 1;
        runEvent('next_click', { count: NEXT_CLICKS, attempt, label: buttonText(advance), url: location.href, errors }, `Next click #${NEXT_CLICKS}: ${buttonText(advance)}`);
        await realClick(advance);
        const startedAt = Date.now();
        while (Date.now() - startedAt < 20000) {
          await sleep(400);
          const modal = findLinkedInModal();
          const spinner = modal?.querySelector('.artdeco-loader, .artdeco-spinner, [data-automation-id="loading-spinner"], svg.artdeco-loader__bars, .loader');
          if (spinner) continue;
          const newSnapshot = collectInputs().map((i) => `${i.name}:${i.id}:${i.type}`).join('|');
          if (location.href !== beforeUrl || newSnapshot !== snapshot || findSubmitButton()) {
            progressed = true;
            break;
          }
          if (advance.disabled || /loading|saving|please wait|processing/i.test(buttonText(advance))
            || document.querySelector('[data-automation-id="loading-spinner"], [aria-busy="true"]')) continue;
        }
      }
      if (progressed) {
        await sleep(600);
        await updatePending({ url: location.href, applyClicked: true });
        return fillPage(profile, answers, { ...pending, url: location.href }, depth + 1);
      }
      advanceBlocked = true;
      const errors = detectValidationErrors();
      skipped.push({ field: 'Continue', reason: errors.length ? `Validation: ${errors.slice(0, 2).join(' | ')}` : 'The application did not advance after 3 attempts.' });
      sendProgress('advance_blocked', '⚠️ Could not confirm that the application advanced. Review the current step.');
    }

    if (stillEmpty.length > 0) {
      stillEmpty.forEach((el) => skipped.push({ field: labelFor(el).slice(0, 80), reason: 'Required field still empty after automation.' }));
    }

    // Unrecognised page: nothing fillable, no next/submit control. Give the
    // AI agent one chance to find a control before declaring failure.
    if (!collectInputs().length && !submitBtn && !advance && !pageHasForm() && !detectLoginWall()) {
      const agentResult = await runAgentFallback(profile, answers, pending, 'No recognisable form or apply control on this page.');
      if (agentResult === 'terminal' || agentResult === 'review') return;
      if (agentResult === true) return fillPage(profile, answers, { ...pending }, depth + 1);
    }

    sendProgress('confirming', '✅ Form prepared. Waiting for your review…');
    // One more self-correction pass against whatever the page still rejects
    // before we present the review or ask anything.
    try {
      const preErrors = detectValidationErrors();
      if (preErrors.length) {
        const fixed = await refillErrorFields(preErrors, profile, answers, pending);
        if (fixed) runEvent('validation_refill', { phase: 'review', fixed }, `Auto-fixed ${fixed} rejected field(s) before review`);
        stillEmpty = requiredEmptyFields();
      }
    } catch {}

    const missingLabels = stillEmpty.map((el) => (questionFor(el) || labelFor(el)).slice(0, 120)).filter(Boolean);

    runEvent('review_check', {
      url: location.href,
      submitButton: Boolean(submitBtn),
      nextClicks: NEXT_CLICKS,
      resumeAttached: RESUME_ATTACHED,
      advanceBlocked,
      filledCount,
      emptyCount: stillEmpty.length,
      missing: missingLabels,
      dryRun: CURRENT_DRY_RUN,
    }, `Review check: submit=${Boolean(submitBtn)}, missing=${stillEmpty.length}`);

    // Dry run (test harness): never submit, never block on a dialog. End with a
    // deterministic REVIEW_READY / failure code so runs can be compared.
    if (CURRENT_DRY_RUN) {
      if (submitBtn) {
        await finish(`🧪 Dry run: form filled, review step reached (${filledCount} filled, ${stillEmpty.length} required empty).`, {
          status: 'needs_attention', reasonCode: 'REVIEW_READY', reviewReady: true,
          filledCount, emptyCount: stillEmpty.length,
        });
      } else {
        await finish(advanceBlocked
          ? '🧪 Dry run: the Next button did not advance — the page rejected a required answer.'
          : '🧪 Dry run: form filled but no submit button was found on this step.', {
          status: 'needs_attention',
          reasonCode: advanceBlocked ? 'VALIDATION_BLOCKED' : 'NO_SUBMIT_BUTTON',
          reviewReady: false,
          filledCount, emptyCount: stillEmpty.length,
        });
      }
      return;
    }

    // Task runs ALWAYS go through the dashboard approval gate. The browser
    // never submits because a checkbox on the page says so.
    if (taskMode()) {
      if (!submitBtn) {
        await finish(advanceBlocked
          ? '⚠️ Stopped before approval — the Next button did not advance, so the final review step was not reached.'
          : '⚠️ Stopped before approval — no submit control was found on this step.', {
          status: 'needs_attention',
          reasonCode: advanceBlocked ? 'VALIDATION_BLOCKED' : 'NO_SUBMIT_BUTTON',
          filledCount, emptyCount: stillEmpty.length,
        });
        return;
      }

      await taskReviewAndSubmit({
        profile, answers, pending, depth,
        submitBtn, filledCount, stillEmpty, advanceBlocked,
      });
      return;
    }

    // There is no unattended submit path. Every run shows the review card and
    // submits only after an explicit click; task runs use the dashboard gate.
    const skippedList = Object.values(SKIPPED_QUESTIONS).map((entry) => ({
      field: String(entry?.question || '').slice(0, 80),
      reason: 'You skipped this — it stays unanswered.',
    }));
    const decision = await showSubmitConfirmation(filledCount, skipped.concat(
      skippedList,
      stillEmpty.map((el) => ({ field: labelFor(el).slice(0, 80), reason: 'Still empty / required.' })),
    ));
    if (decision === 'submit' && submitBtn && stillEmpty.length === 0) {
      const verified = await submitAndVerify(submitBtn);
      if (verified.ok) {
        handleLinkedInDoneModal();
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

  // Mirrors the background's reason derivation so the run event already
  // carries a stable code even if the worker missed intermediate steps.
  function deriveFinishReason(status, message, details) {
    if (details.reasonCode) return details.reasonCode;
    if (status === 'submitted') return 'SUBMITTED';
    const text = String(message || '').toLowerCase();
    if (/captcha|verification|turnstile|hcaptcha/.test(text)) return 'CAPTCHA';
    if (/sign in|log in|login|sign-in/.test(text)) return 'LOGIN_REQUIRED';
    if (/create an account|account creation/.test(text)) return 'ACCOUNT_CREATION';
    if (/no submit button/.test(text)) return 'NO_SUBMIT_BUTTON';
    if (/did not advance|validation|rejected|required field/.test(text)) return 'VALIDATION_BLOCKED';
    if (/resume|cv/.test(text)) return 'RESUME_ATTACH_FAILED';
    if (/apply/.test(text) && /(not|could not|did not)/.test(text)) return 'APPLY_BUTTON_NOT_FOUND';
    if (/no form|not recognized|could not find/.test(text)) return 'NO_FORM';
    if (status === 'failed') return 'CRASH';
    if (status === 'cancelled') return 'USER_CANCELLED';
    return 'NEEDS_USER_GENERIC';
  }

  function finish(message, details = {}) {
    if (TERMINAL_REPORTED) return markPendingDone();
    TERMINAL_REPORTED = true;
    const status = details.status || 'needs_attention';
    const payload = {
      status,
      filledCount: 0,
      emptyCount: 0,
      ...details,
      reasonCode: deriveFinishReason(status, message, details),
      nextClicks: NEXT_CLICKS,
      resumeAttached: RESUME_ATTACHED,
      reviewReady: Boolean(details.reviewReady),
      dryRun: CURRENT_DRY_RUN,
      url: location.href,
    };
    runEvent('complete', payload, message);
    sendProgress('complete', message, { ...payload, skipped: uniqueSkipped() });
    if (taskMode()) {
      finishTaskRun(message, payload).catch(() => null);
    }
    try { if (extensionAlive()) chrome.runtime.sendMessage({ type: 'HAMZOOH_CDP_INPUT', action: 'detach' }); } catch {}
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

  // Workday (and similar ATS) land on an "Autofill with Resume / Apply Manually"
  // chooser right after sign-in. It has buttons but no <form>, so it must count
  // as an actionable step or the run parks there forever.
  function hasApplyChoiceControl() {
    try {
      return queryAllDeep('button, [role="button"], a[href]').some((el) => {
        if (!visible(el) || el.disabled) return false;
        const autoId = el.getAttribute('data-automation-id') || '';
        const text = buttonText(el);
        return /autofillWithResume/i.test(autoId)
          || /autofill with resume|apply with resume|apply manually|use my last application|start application|continue application|resume application|complete (your )?application|finish (your )?application/i.test(text);
      });
    } catch { return false; }
  }

  function frameLooksActionable() {
    return pageHasForm()
      || findDescriptionApplyButtons().length > 0
      || allFileInputs().length > 0
      || hasApplyChoiceControl();
  }

  async function runPending(stored) {
    let pending = stored?.pendingApply;
    CURRENT_TASK_ID = pending?.taskId || '';
    CURRENT_TASK_TOKEN = pending?.taskToken || '';
    TASK_FINAL_REPORTED = false;
    LAST_VERIFICATION = null;
    if (taskMode()) {
      // Approval by the candidate is mandatory for task runs.
      pending = { ...pending, requireApproval: true };
      await taskCall('/api/applications/extension/heartbeat', {
        status: 'filling_application', url: location.href, extensionVersion: chrome.runtime.getManifest?.().version || '',
      }).catch(() => null);
    }
    const { hamzoohTrainMode } = await chrome.storage.local.get('hamzoohTrainMode').catch(() => ({}));
    const isTrain = Boolean(
      pending?.trainMode === true ||
      stored?.hamzoohTrainMode === true ||
      hamzoohTrainMode === true ||
      window.__HAMZOOH_TRAIN_MODE__ === true ||
      location.hash.includes('hamzooh_train')
    );
    if (isTrain) {
      window.__HAMZOOH_TRAIN_MODE__ = true;
      if (window.top === window) {
        initTrainModeRecorder(location.hostname, pending || {});
      }
      return;
    }

    if (filling || window.__HAMZOOH_FILLER_BUSY__) return;
    if (!(await shouldRun(pending))) return;
    await loadSkippedQuestions(pending);
    CURRENT_RUN_ID = pending.runId || pending.sessionId || '';
    CURRENT_DRY_RUN = pending.dryRun === true;
    NEXT_CLICKS = 0;
    RESUME_ATTACHED = false;
    STEP_COUNT = 0;
    NO_PROGRESS_STEPS = 0;
    LAST_SIGNATURE = '';
    TERMINAL_REPORTED = false;
    const isTop = window.top === window;
    const runAnswers = taskMode() ? {} : (stored.answers || {});
    let actionable = frameLooksActionable();
    let loginWall = detectLoginWall() || detectAuthGate();
    // Tracking/preload iframes contain navigation links (and sometimes
    // "apply"-ish aria-labels) but no form. They must never enter the fill
    // pipeline: that is what stalled the Carousell LinkedIn run.
    if (!isTop && collectInputs().length === 0 && allFileInputs().length === 0) actionable = false;
    if (!frameLooksActionable() && loginWall === false) {
      hamzoohLog('log', 'frame not actionable yet', location.href);
    }
    runEvent('frame_started', {
      url: location.href,
      title: document.title,
      top: window.top === window,
      actionable,
      dryRun: CURRENT_DRY_RUN,
      hasForm: pageHasForm(),
      loginWall,
    }, `Frame started: ${location.hostname}${location.pathname}`.slice(0, 160));

    // Phase-0 guard: every injected frame used to enter the fill pipeline, so
    // an empty tracking iframe could report completion for the whole run.
    // A frame with no form, no apply control and no file input has nothing to
    // do; record it and leave the run to the frame that owns the form.
    if (!actionable && !loginWall) {
      // A job posting can hydrate its entry control (Siemens: "Complete
      // application") a moment after the script starts. Wait for it in the top
      // frame instead of parking the whole run on an apparently empty page.
      if (isTop && !CURRENT_DRY_RUN) {
        window.__HAMZOOH_FILLER_BUSY__ = true;
        const startedAt = Date.now();
        while (Date.now() - startedAt < 20000) {
          await sleep(700);
          if (frameLooksActionable() || detectLoginWall() || detectAuthGate()) break;
        }
        actionable = frameLooksActionable();
        loginWall = loginWall || detectLoginWall() || detectAuthGate();
        if (!actionable) window.__HAMZOOH_FILLER_BUSY__ = false;
      }
      if (!actionable && !loginWall) {
        if (isTop && taskMode()) {
          // Never go quiet: an idle run with no log line looks like a freeze.
          await taskCheckpoint('page_not_actionable',
            '🔍 Waiting for an application form or Apply button on this page — open the job tab if you want to help it along.',
            { status: 'filling_application' }).catch(() => null);
        }
        runEvent('frame_skipped', {
          url: location.href,
          inputs: collectInputs().length,
          fileInputs: allFileInputs().length,
          top: window.top === window,
        }, 'Frame skipped: no form or apply control');
        return;
      }
    }

    filling = true;
    window.__HAMZOOH_FILLER_BUSY__ = true;
    try {
      await fillPage(stored.profile || {}, runAnswers, pending);
    } catch (err) {
      hamzoohLog('error', 'fill pipeline crashed', err.message);
      runEvent('error', { error: err.message, stack: String(err.stack || '').slice(0, 2000) }, 'Fill pipeline crashed');
      await finish(`❌ Automation error: ${err.message}`, { status: 'failed', reasonCode: 'CRASH' });
    } finally {
      filling = false;
      window.__HAMZOOH_FILLER_BUSY__ = false;
    }
  }

  function bootApply() {
    if (!extensionAlive() || window.__HAMZOOH_TRAIN_MODE__) return;
    chrome.storage.local.get(['pendingApply', 'profile', 'answers', 'hamzoohTrainMode'], runPending);
  }
  window.__HAMZOOH_BOOT__ = bootApply;

  // Watchdog: guarantees a terminal state instead of a silent hang.
  window.__HAMZOOH_FORCE_TERMINAL__ = (reason) => {
    if (window.__HAMZOOH_TRAIN_MODE__ || TERMINAL_REPORTED || !CURRENT_RUN_ID) return;
    runEvent('watchdog_force_terminal', { reason: reason || '', url: location.href, top: window.top === window }, 'Watchdog forced a terminal state');
    finish('⏱️ Stopped: this page never showed an application form or Apply button. The job tab is still open — click Auto Apply with AI again to retry.', {
      status: 'failed', reasonCode: 'TIMEOUT_NO_TERMINAL', filledCount: 0, emptyCount: 0,
    });
  };

  bootApply();
  if (extensionAlive()) {
    // Keep watching after the filler stops: a manual submit in this tab must
    // still be detected and recorded against the task.
    setInterval(() => { reportManualSubmission(); watchSubmissionConfirmation(); }, 6000);
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'HAMZOOH_INIT_TRAIN') {
        window.__HAMZOOH_TRAIN_MODE__ = true;
        if (window.top === window) initTrainModeRecorder(location.hostname, {});
        return;
      }
      if (message?.type === 'HAMZOOH_BEGIN_FILL') {
        if (window.__HAMZOOH_TRAIN_MODE__) return;
        bootApply();
      }
      if (message?.type === 'HAMZOOH_FORCE_TERMINAL') {
        try { window.__HAMZOOH_FORCE_TERMINAL__(message.reason || ''); } catch {}
      }
      if (message?.type === 'HAMZOOH_TASK_CONTROL') {
        const action = String(message.action || '');
        if (action === 'cancel') {
          removeHamzoohOverlays();
          finish('✗ Application cancelled from the Hamzooh dashboard.', { status: 'cancelled', reasonCode: 'USER_CANCELLED' });
          return;
        }
        if (action === 'pause') {
          removeHamzoohOverlays();
          showTaskOverlay({
            title: 'Paused',
            subtitle: 'Hamzooh Apply',
            body: 'Paused from the Hamzooh dashboard. Resume there and this tab will continue automatically.',
            tone: 'linear-gradient(135deg,#d97706,#f59e0b)',
          });
          return;
        }
        if (action === 'resume') {
          hideTaskOverlay();
          bootApply();
        }
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (window.__HAMZOOH_TRAIN_MODE__ || area !== 'local' || !changes.pendingApply?.newValue) return;
      chrome.storage.local.get(['pendingApply', 'profile', 'answers', 'hamzoohTrainMode'], runPending);
    });
    let lastHref = location.href;
    setInterval(() => {
      if (window.__HAMZOOH_TRAIN_MODE__) return;
      if (location.href !== lastHref) {
        const prevPath = lastHref.split('?')[0];
        const newPath = location.href.split('?')[0];
        lastHref = location.href;
        // Don't restart bootApply if only tracking query params changed on the same job URL
        if (prevPath !== newPath) {
          bootApply();
        }
      }
    }, 1500);
    setInterval(() => {
      if (window.__HAMZOOH_TRAIN_MODE__ || filling || !extensionAlive()) return;
      chrome.storage.local.get(['pendingApply'], (stored) => {
        const p = stored?.pendingApply;
        if (!p?.url || !p?.taskId || !p?.taskToken || p.done || p.trainMode) return;
        // Stay parked while a sign-in screen is showing; resume as soon as the
        // real application step is back. Workday's step right after sign-in is
        // usually the "Autofill with Resume" chooser (buttons, no <form>), so
        // accept any actionable step, not only a form.
        if (detectAuthGate() || detectLoginWall()) return;
        if (!(pageHasForm() || frameLooksActionable())) return;
        // Throttle so a mis-detected page cannot loop the filler (and its AI).
        const now = Date.now();
        if (now - Number(window.__HAMZOOH_AUTO_RESUME_AT__ || 0) < 10000) return;
        window.__HAMZOOH_AUTO_RESUME_AT__ = now;
        {
          hideTaskOverlay();
          SIGNIN_WAIT_HOST = '';
          sendProgress('form_found', '📄 Signed in — continuing the application automatically…');
          updatePending({ awaitingManualApply: false, loginHost: '' }).then(() => bootApply());
        }
      });
    }, 2500);
  }

  window.__HAMZOOH_TEST_RUN__ = async (profile, answers, pending) => {
    const run = pending || { url: location.href };
    // runEvent() is silent without a run id; a harness run still needs the
    // structured events to assert on.
    CURRENT_RUN_ID = run.runId || run.sessionId || `test-${Date.now()}`;
    await loadSkippedQuestions(run);
    return fillPage(profile, answers || {}, run);
  };
  window.__HAMZOOH_DEBUG__ = {
    questionFor, labelFor, sanitizePromptText, isNoisePrompt, fieldLabelFromAutomationId, submissionConfirmationNow, chooseFromProfile, heuristicChoice, applyChoice,
    profileValue, collectInputs, SUCCESS_PATTERNS, VALIDATION_PATTERNS,
    detectValidationErrors, findDescriptionApplyButtons, scoreApplyCandidate,
  };
})();
