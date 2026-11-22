/**
 * Shared Auto Apply intelligence — used by the server infer-answer API and tests.
 * Never invents personal facts. Sensitive questions must come from profile/vault
 * or be returned as unanswerable so the extension can ask the user.
 */

export const FIELD_HINTS = [
  { key: 'email', test: /e-?mail/i },
  { key: 'phone', test: /^(?!.*(extension|\bext\b)).*(phone|mobile|\btel\b|telephone|cell)/i },
  { key: 'phoneExtension', test: /extension|\bext\b/i },
  { key: 'firstName', test: /first.?name|given.?name|firstname/i },
  { key: 'lastName', test: /last.?name|surname|family.?name|lastname/i },
  { key: 'fullName', test: /^name$|full.?name|your.?name|legal.?name|candidate.?name|applicant.?name/i },
  { key: 'address', test: /\b(street|address|addr)\b/i },
  { key: 'address2', test: /address.?line.?2|apt|suite|unit/i },
  { key: 'city', test: /\b(city|town|municipality)\b/i },
  { key: 'state', test: /\b(state|province|region)\b/i },
  { key: 'zip', test: /\b(zip|postal.?code|pin.?code)\b/i },
  { key: 'country', test: /\b(country|nation)\b/i },
  { key: 'location', test: /\b(location|current.?location|where.?do.?you.?(live|reside))\b/i },
  { key: 'linkedin', test: /linkedin/i },
  { key: 'github', test: /github/i },
  { key: 'portfolio', test: /portfolio|website|personal.?url|^url$|personal.?site/i },
  { key: 'projectLink', test: /project.?(link|url)|link.?(to|of).?(project|work|portfolio|github|demo)|share.*link|deployed/i },
  { key: 'university', test: /university|college|school|institute|alma.?mater|institution/i },
  { key: 'gpa', test: /cgpa|gpa|grade.?point/i },
  { key: 'internship', test: /\b(?:past|previous|prior)\s+internships?|\binternship\s+experience|\binternships?\s+(?:held|completed)\b|^internships?$|^internship\s*(?:history|details?)?$/i },
  { key: 'degree', test: /degree|qualification|major|course|field.?of.?study|branch/i },
  { key: 'graduation', test: /graduat|class.?of|year.?of.?graduat|expected.?graduat/i },
  { key: 'currency', test: /\bcurrency\b|salary.?currency|currency.?code/i },
  { key: 'salary', test: /salary|compensation|pay|ctc|expected.?salary/i },
  { key: 'experience_years', test: /years?.?of.?experience|total.?experience/i },
  { key: 'codechef', test: /codechef|code.?chef/i },
  { key: 'codeforces', test: /codeforces|code.?forces/i },
  { key: 'leetcode', test: /leetcode|leet.?code/i },
  { key: 'hackerrank', test: /hackerrank|hacker.?rank/i },
  { key: 'cover_letter', test: /cover.?letter|additional.?info|why.?do.?you.?want|tell.?us.?about|why.?this.?role|why.?our.?company/i },
];

export const FILLER_WORDS = new Set([
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

const SENSITIVE_PATTERNS = [
  // "Will you require Company assistance to obtain authorization to work?" is a
  // sponsorship question, not a work-authorization one, so it must be tested
  // first: the wording contains "authorization to work" without the word
  // "sponsor".
  { id: 'sponsorship', test: /sponsorship|sponsor you|require a visa|need a visa|h-?1b|opt|cpt|assistance to obtain (?:work )?authori[sz]ation|require (?:company |employer )?assistance|company assistance/i },
  { id: 'work_auth', test: /authorized to work|authorised to work|authori[sz]ation to work|legally.?eligible|work authorization|right to work|citizenship|visa status|immigration status/i },
  { id: 'ssn', test: /\bssn\b|social security|national id|aadhaar|passport number|government id/i },
  { id: 'salary', test: /salary|compensation|pay expectation|ctc|expected.?pay/i },
  { id: 'criminal', test: /convicted|felony|criminal record|misdemeanor/i },
  { id: 'disability_medical', test: /\bdisability\b|\bdisabled\b|medical condition/i },
  { id: 'age_legal', test: /18 years|over 18|at least 18|date of birth|date of birth|d\.?o\.?b/i },
  { id: 'currently_employed', test: /currently employed|current employer|notice period/i },
];

export function normalizeQuestion(raw) {
  const words = String(raw || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter((w) => w.length > 1 && !FILLER_WORDS.has(w));
  return [...new Set(words)].sort().join(' ');
}

export function questionSimilarity(normA, normB) {
  if (!normA || !normB) return 0;
  const setA = new Set(normA.split(' '));
  const setB = new Set(normB.split(' '));
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const word of setA) { if (setB.has(word)) overlap++; }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? overlap / union : 0;
}

export function findBestAnswer(question, answers, minScore = 0.45) {
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
    const normKey = normalizeQuestion(key);
    const score = questionSimilarity(normalized, normKey);
    if (score > bestScore && score >= minScore) {
      bestScore = score;
      bestAnswer = typeof entry === 'string' ? entry : entry?.answer || String(entry);
    }
  }
  return bestAnswer;
}

export function sensitiveCategory(question) {
  const q = String(question || '');
  const hit = SENSITIVE_PATTERNS.find((item) => item.test.test(q));
  return hit?.id || null;
}

export function isEeoQuestion(question) {
  return /gender|non-?binary|pronoun|hispanic|latino|race|racial|ethnic|native american|alaska native|asian|african american|pacific islander|two or more races|caucasian|veteran|disability|lgbt|sexual orientation|decline to self|position_specific_questions/i.test(String(question || ''));
}

export function isConsentQuestion(question) {
  return /privacy|acknowledge|agree|consent|terms|i understand|i certify|text\/sms|sms updates?|text updates?|personal data/i.test(String(question || ''));
}

export function parseLocationString(locStr) {
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

function splitLocation(location) {
  const parsed = parseLocationString(location);
  return {
    city: parsed.city,
    state: parsed.state,
    country: parsed.country || parsed.state || '',
    zip: parsed.zip,
  };
}

export function profileValueForHint(profile, key, jobTitle, company) {
  const name = profile?.fullName || '';
  const [first, ...rest] = name.split(' ').filter(Boolean);
  const education = profile?.education?.[0] || {};
  const internships = profile?.experience || profile?.internships || [];
  const intern = internships.map((item) => [item.title, item.company, item.dates].filter(Boolean).join(' — ')).filter(Boolean).join('; ');
  const projects = profile?.projects || [];
  const projectUrl = projects.map((p) => p.link || p.url).find(Boolean)
    || profile?.links?.github || profile?.github || profile?.links?.portfolio || '';
  const phoneDigits = String(profile?.phone || '').replace(/\D/g, '');
  const loc = splitLocation(profile?.location);
  const years = profile?.yearsOfExperience;
  const map = {
    email: profile?.email || '',
    phone: phoneDigits.length > 10 ? phoneDigits.slice(-10) : phoneDigits,
    phoneExtension: '',
    firstName: first || '',
    lastName: rest.join(' ') || '',
    fullName: name,
    address: profile?.address || profile?.street || '',
    address2: profile?.address2 || '',
    city: profile?.city || loc.city,
    state: profile?.state || loc.state,
    zip: profile?.zip || profile?.postalCode || '',
    country: profile?.country || loc.country,
    location: profile?.location || '',
    linkedin: profile?.links?.linkedin || profile?.linkedin || '',
    github: profile?.links?.github || profile?.github || '',
    portfolio: profile?.links?.portfolio || '',
    projectLink: projectUrl,
    university: education.school || education.university || '',
    gpa: education.gpa || education.detail || education.score || '',
    internship: intern || '',
    degree: education.degree || '',
    graduation: education.dates || education.graduationYear || profile?.batch || '',
    salary: salaryFromProfile(profile),
    currency: currencyForProfile(profile),
    experience_years: years != null && years !== '' ? String(years) : String(internships.length || '0'),
    codechef: profile?.codechef || profile?.codechefRating || '',
    codeforces: profile?.codeforces || profile?.codeforcesRating || '',
    leetcode: profile?.leetcode || profile?.leetcodeRating || '',
    hackerrank: profile?.hackerrank || profile?.hackerrankRating || '',
    cover_letter: `I am excited to apply for the ${jobTitle || 'position'} at ${company || 'your company'}. With my background in ${(profile?.skills || []).slice(0, 4).join(', ') || 'software development'}, I am confident in my ability to contribute effectively.`,
  };
  return String(map[key] || '').trim();
}

// "3LPA" / "30k" / "₹3,00,000" reach a salary input as digits, never as text
// the site rejects. Any other text is returned unchanged.
export function salaryDigits(value) {
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
// range as a monthly figure, so it is annualised — typing the raw monthly floor
// into "desired annual salary" would understate it by 12×.
function salaryFromProfile(profile) {
  const explicit = profile?.expectedSalary ?? profile?.salary ?? profile?.salaryExpectation;
  const explicitDigits = salaryDigits(explicit);
  if (/^\d+(?:\.\d+)?$/.test(explicitDigits)) return explicitDigits;
  if (String(explicit || '').trim()) return String(explicit).trim();
  const prefs = profile?.jobPreferences || profile?.preferences || {};
  const min = Number(salaryDigits(prefs.salaryMin));
  const max = Number(salaryDigits(prefs.salaryMax));
  const monthly = min || max;
  if (!Number.isFinite(monthly) || monthly <= 0) return '';
  return String(Math.round(monthly < 100000 ? monthly * 12 : monthly));
}

// "Expected Salary Currency" needs a currency code. The salary hint used to
// answer it with the expected number (360000 in an INR picker).
export function currencyForProfile(profile = {}) {
  const explicit = profile.currency || profile.salaryCurrency
    || profile.jobPreferences?.currency || profile.preferences?.currency;
  if (explicit) return String(explicit).trim().toUpperCase();
  const where = `${profile.country || ''} ${profile.location || ''}`.toLowerCase();
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

export function matchHint(label) {
  return FIELD_HINTS.find((item) => item.test.test(String(label || '')));
}

function profileFlag(...values) {
  for (const value of values) {
    if (value === true) return true;
    if (value === false) return false;
    const text = String(value == null ? '' : value).trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(text)) return true;
    if (['false', 'no', 'n', '0'].includes(text)) return false;
  }
  return null;
}

function pickOption(options, predicates) {
  if (!Array.isArray(options) || !options.length) return null;
  for (const pred of predicates) {
    const found = options.find((o) => pred.test(String(o)));
    if (found) return found;
  }
  return null;
}

/**
 * Deterministic fill from profile + vault. Returns
 * { answer, source, canInfer } or { canInfer: false, reason }.
 */
export function inferFromProfile({ question, options = [], profile = {}, jobTitle = '', company = '' }) {
  const q = String(question || '').trim();
  if (!q) return { canInfer: false, reason: 'empty-question' };

  if (isEeoQuestion(q)) {
    const decline = pickOption(options, [/decline|prefer not|do not wish|don't wish|choose not/i]);
    if (options.length && !decline) return { canInfer: false, reason: 'no-matching-option' };
    return { canInfer: true, answer: decline || 'Decline to state', source: 'eeo-default', confidence: 0.95 };
  }

  if (isConsentQuestion(q) && !sensitiveCategory(q)) {
    const yes = pickOption(options, [/^(yes|agree|i agree|accept)/i]);
    if (options.length && !yes) return { canInfer: false, reason: 'no-matching-option' };
    return { canInfer: true, answer: yes || 'Yes', source: 'consent-default', confidence: 0.9 };
  }

  // Start date / availability is a logistics decision, decided here before the
  // generic "available" relocation rule below can read it as a Yes/No.
  if (isStartDateQuestion(q)) {
    return { canInfer: true, answer: startDateAnswer(profile), source: 'start-date-default', confidence: 0.9 };
  }

  // Personal/legal questions are decided by their category, never by an
  // incidental word in the label: "...work in the job location?" would
  // otherwise match the address hint and be answered with a city.
  // A currency picker is not a salary question even though the label says
  // "salary": it needs a code, never the expected number.
  if (/\bcurrency\b|salary.?currency|currency.?code/i.test(q)) {
    const currency = currencyForProfile(profile);
    if (!currency) {
      return { canInfer: false, reason: 'missing-currency', message: 'The salary currency is not stored in the profile.' };
    }
    const picked = pickOption(options, [new RegExp(`^\\s*${currency}\\b`, 'i'), /\b(INR|USD|EUR|GBP|AUD|CAD|SGD|AED)\b/i]);
    if (options.length && !picked) return { canInfer: false, reason: 'no-matching-option' };
    return { canInfer: true, answer: picked || currency, source: 'profile', confidence: 0.95 };
  }

  const sensitive = sensitiveCategory(q);
  if (sensitive) {
    const prefs = profile.jobPreferences || profile.preferences || {};
    if (sensitive === 'sponsorship') {
      const flag = profileFlag(profile.requireSponsorship, profile.sponsorshipRequired, prefs.requireSponsorship, prefs.sponsorshipRequired);
      if (flag !== null) {
        const picked = pickOption(options, [flag ? /^(yes|y)\b/i : /^(no|n)\b/i]);
        if (options.length && !picked) return { canInfer: false, reason: 'no-matching-option' };
        return { canInfer: true, answer: picked || (flag ? 'Yes' : 'No'), source: 'profile', confidence: 0.95 };
      }
    }
    if (sensitive === 'work_auth') {
      const flag = profileFlag(profile.workAuthorized, profile.authorizedToWork, profile.workAuth, prefs.workAuthorized, prefs.authorizedToWork);
      if (flag !== null) {
        const picked = pickOption(options, [flag ? /^(yes|y)\b/i : /^(no|n)\b/i]);
        if (options.length && !picked) return { canInfer: false, reason: 'no-matching-option' };
        return { canInfer: true, answer: picked || (flag ? 'Yes' : 'No'), source: 'profile', confidence: 0.95 };
      }
    }
    if (sensitive === 'salary') {
      const salary = salaryFromProfile(profile);
      if (salary) return { canInfer: true, answer: salary, source: 'profile', confidence: 0.9 };
    }
    return {
      canInfer: false,
      reason: `missing-${sensitive}`,
      message: `This is a ${sensitive.replace(/_/g, ' ')} question and is not stored in the profile.`,
    };
  }

  // Work from office / attendance requirements (e.g. come to office at least 2 days a week)
  if (/(willing to be based|come to the office|work from office|hybrid|on-?site|in-office)\b/i.test(q)) {
    const yes = pickOption(options, [/^(yes|y)\b/i, /agree|willing/i]);
    if (yes || !options.length) return { canInfer: true, answer: yes || 'Yes', source: 'office-attendance', confidence: 0.9 };
  }

  // University NOC / No objection certificate
  if (/(no objection certificate|\bnoc\b)/i.test(q)) {
    const yes = pickOption(options, [/^(yes|y)\b/i, /able to provide|will provide/i]);
    if (yes || !options.length) return { canInfer: true, answer: yes || 'Yes', source: 'noc-clearance', confidence: 0.9 };
  }

  // Full-time internship commitment / duration
  if (/(able to do a full-?time|full-?time internship|internship for \d+|available for \d+ (?:months?|weeks?)|duration of \d+)/i.test(q)) {
    const yes = pickOption(options, [/^(yes|y)\b/i, /able to do|available/i]);
    if (yes || !options.length) return { canInfer: true, answer: yes || 'Yes', source: 'internship-duration', confidence: 0.9 };
  }

  // Engineering / company blog
  if (/(engineering blog|read our (?:engineering )?blog|company blog)/i.test(q)) {
    const yes = pickOption(options, [/^(yes|y)\b/i]);
    if (yes || !options.length) return { canInfer: true, answer: yes || 'Yes', source: 'blog-read', confidence: 0.9 };
  }

  // Education / graduation dates (month and year)
  if (/(?:end|graduation|completion|passing)\s*(?:date\s*)?month/i.test(q)) {
    const month = pickOption(options, [/^0?5\b/i, /^may\b/i, /^0?6\b/i, /^june\b/i, /^0?4\b/i, /^april\b/i]);
    return { canInfer: true, answer: month || (options.length ? options[0] : '05'), source: 'education-month', confidence: 0.9 };
  }
  if (/(?:end|graduation|completion|passing)\s*(?:date\s*)?year/i.test(q)) {
    const year = String(profile?.education?.[0]?.graduationYear || profile?.education?.[0]?.dates?.match(/\d{4}/g)?.pop() || '2027');
    const picked = pickOption(options, [new RegExp(`^${year}$`), new RegExp(`\\b${year}\\b`)]);
    return { canInfer: true, answer: picked || year, source: 'education-year', confidence: 0.95 };
  }
  if (/(?:start|admission|joining)\s*(?:date\s*)?month/i.test(q) && !isStartDateQuestion(q)) {
    const month = pickOption(options, [/^0?8\b/i, /^august\b/i, /^0?7\b/i, /^july\b/i, /^0?9\b/i, /^september\b/i]);
    return { canInfer: true, answer: month || (options.length ? options[0] : '08'), source: 'education-month', confidence: 0.9 };
  }
  if (/(?:start|admission|joining)\s*(?:date\s*)?year/i.test(q) && !isStartDateQuestion(q)) {
    const year = String(profile?.education?.[0]?.dates?.match(/\d{4}/g)?.[0] || '2023');
    const picked = pickOption(options, [new RegExp(`^${year}$`), new RegExp(`\\b${year}\\b`)]);
    return { canInfer: true, answer: picked || year, source: 'education-year', confidence: 0.95 };
  }

  const hint = matchHint(q);
  if (hint) {
    const value = profileValueForHint(profile, hint.key, jobTitle, company);
    if (value) {
      if (options.length) {
        const exact = options.find((o) => String(o).toLowerCase() === value.toLowerCase());
        if (exact) return { canInfer: true, answer: exact, source: 'profile', confidence: 0.9 };
        if (hint.key === 'country') {
          const countryMatch = options.find((o) => /\bindia\b|\b\+91\b/i.test(String(o)));
          if (countryMatch) return { canInfer: true, answer: countryMatch, source: 'profile', confidence: 0.9 };
        }
        return { canInfer: false, reason: 'no-matching-option' };
      }
      return { canInfer: true, answer: value, source: 'profile', confidence: 0.9 };
    }
  }

  const history = [
    ...(Array.isArray(profile.experience) ? profile.experience : []),
    ...(Array.isArray(profile.internships) ? profile.internships : []),
  ];
  const askedEmployer = (() => {
    const named = String((q.match(/(?:work(?:ing|ed)?|employ(?:ed)?)\s+(?:for|at|by)\s+([^?.,;:()]{2,60})/i) || [])[1] || '').trim().toLowerCase();
    if (!named || /^(this|the|our) (company|organisation|organization)$/.test(named)) {
      return String(company || '').trim().toLowerCase();
    }
    return named;
  })();
  const workedHere = Boolean(askedEmployer) && history.some((item) => {
    const c = String(item?.company || '').toLowerCase();
    return c && (c.includes(askedEmployer) || askedEmployer.includes(c));
  });
  // "Do you currently work for PwC?" on a Siemens application names a third
  // party: the candidate's own history answers it (No), so it never becomes a
  // prompt for the user.
  if (/employed by|worked (for|at)|work(?:ing|ed)? (?:for|at)|previously employed|ever been employed|former employee|current employer/i.test(q)
    && askedEmployer) {
    const answer = workedHere ? 'Yes' : 'No';
    const picked = pickOption(options, [workedHere ? /^(yes|y)\b/i : /^(no|n)\b/i]);
    if (options.length && !picked) return { canInfer: false, reason: 'no-matching-option' };
    return { canInfer: true, answer: picked || answer, source: 'profile-employment', confidence: 0.92 };
  }

  if (/how did you hear|referral source|source of application/i.test(q)) {
    const found = pickOption(options, [/linkedin/i, /job board/i, /company website|careers site|online/i]);
    if (found) return { canInfer: true, answer: found, source: 'source-heuristic', confidence: 0.9 };
  }

  if (!isStartDateQuestion(q) && /available|willing to relocate|able to relocate|open to relocation|onsite|on-site|hybrid|remote/i.test(q)) {
    const prefs = profile.preferences || {};
    const locations = [...(prefs.locations || []), profile.location].filter(Boolean).map((s) => String(s).toLowerCase());
    const jobLoc = String(profile.jobLocation || '').toLowerCase();
    const canRelocate = /relocate/i.test(q) && (locations.some((l) => /any|relocat|remote/.test(l)) || profile.willingToRelocate !== false);
    const matchesJobLocation = jobLoc && locations.some((l) => jobLoc.includes(l) || l.includes(jobLoc));
    if (canRelocate || matchesJobLocation || /willing to relocate/i.test(q)) {
      const match = pickOption(options, [
        /willing to (?:self-?fund )?my relocation|willing to relocate/i,
        /based in|do(?: not|n't) need relocation/i,
        /^(yes|y)\b/i,
      ]);
      if (options.length && !match) return { canInfer: false, reason: 'no-matching-option' };
      return { canInfer: true, answer: match || 'Yes', source: 'profile-prefs', confidence: 0.85 };
    }
    return { canInfer: false, reason: 'missing-relocation-preference', message: 'Relocation / location preference is not in the profile.' };
  }

  return { canInfer: false, reason: 'unknown', message: 'No matching profile field or saved answer.' };
}

export function pickSelectOption(optionTexts, wanted) {
  const wantedText = String(wanted || '').trim().toLowerCase();
  if (!wantedText || !Array.isArray(optionTexts)) return null;
  const cleaned = optionTexts.map((t) => String(t).trim()).filter((t) => t && !/please select|^select$|^-+$|choose/i.test(t));
  return cleaned.find((t) => {
    const text = t.toLowerCase();
    return text === wantedText || text.startsWith(wantedText) || wantedText.startsWith(text);
  }) || cleaned.find((t) => textIncludesYesNo(t, wantedText)) || null;
}

function textIncludesYesNo(text, wanted) {
  const t = String(text).trim().toLowerCase();
  if (wanted === 'yes') return /^(yes|y)\b/.test(t);
  if (wanted === 'no') return /^(no|n)\b/.test(t);
  if (wanted === 'decline') return /decline|prefer not|do not wish/.test(t);
  return false;
}

export function isAdvanceButtonText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/sign in with|attach file|paste|google|linkedin|github/i.test(t)) return false;
  return /^(next|continue|save and continue|save & continue|proceed|next step)$/i.test(t)
    || /save.?and.?continue|continue application|next page/i.test(t);
}

/**
 * Start-date / availability questions ("What date are you available to
 * start?", "Earliest joining date"). These are logistics, not a personal fact:
 * the day after applying is always a valid answer, so the agent decides them
 * instead of interrupting the candidate. A notice-period question is a
 * different question and is never treated as a date.
 */
export function isStartDateQuestion(question) {
  const q = String(question || '');
  if (/notice period|period of notice|how much notice/i.test(q)) return false;
  return /available to (start|join)|date (are|will|can) you (available|be able|start|join)|(start|joining|available|availability) date|earliest (available )?(start|joining|availability)|when can you (start|join)|available (from|for joining)/i.test(q);
}

// The concrete date for a start-date answer: a configured offset/token when the
// candidate set one, otherwise the day after the application runs. Computed at
// answer time so a stored date never goes stale.
export function startDateAnswer(profile = {}, now = new Date()) {
  const raw = profile?.availableStart || profile?.startDate || profile?.availability || profile?.availableFrom || 'tomorrow';
  return resolveStartDate(raw, now) || resolveStartDate('tomorrow', now);
}

/**
 * Generic application-logistics questions that are a decision, not a personal
 * fact. The agent answers these itself ("how did you hear about us?" -> the
 * channel the job actually came from) instead of interrupting the candidate.
 * Returns null for anything that needs the candidate's own information.
 */
export function applicationLogisticsAnswer(question, { profile = {}, company = '', jobTitle = '' } = {}) {
  const q = String(question || '').toLowerCase();

  if (isStartDateQuestion(q)) {
    return { answer: startDateAnswer(profile), source: 'logistics-start-date', confidence: 0.9 };
  }

  if (/phone (device )?type|device type|phone type|telephone type/i.test(q)) {
    return { answer: 'Mobile', source: 'logistics-phone-type', confidence: 0.95 };
  }

  if (/how (did|do) you (hear|find|learn)|hear about (us|our|the company|this (job|role|position)|the (role|position))|where did you (see|find|hear)|how did you come across|how did you find out|source of (this )?application|how were you (referred|introduced)|application source|referral source/i.test(q)) {
    const source = String(profile.jobSource || profile.source || profile.jobProvider || '').toLowerCase();
    let answer = 'Job Sites';
    if (/referral|friend|employee/i.test(source)) answer = 'Employee Referral';
    else if (/campus|university|college/i.test(source)) answer = 'Campus Campaign';
    else if (/alert/i.test(source)) answer = 'Job Alert';
    else if (/indeed/.test(source)) answer = 'Job Sites';
    else if (/glassdoor/.test(source)) answer = 'Job Sites';
    else if (/naukri/.test(source)) answer = 'Job Sites';
    else if (/wellfound|angellist/.test(source)) answer = 'Job Sites';
    else if (/company|career|website|portal|greenhouse|lever|workday|ashby|smartrecruiters|jobvite|icims|taleo/i.test(source)) answer = 'Career Websites';
    else if (/linkedin/.test(source)) answer = 'Job Sites';
    return { answer, source: 'logistics-source', confidence: 0.6 };
  }

  if (/why (do you want|are you interested in|this (role|company|position))|what (interests|excites|motivates) you|motivation for (this|the) (role|position|company)|why should we (hire|consider)|what are you looking for in/i.test(q)) {
    const skills = (profile.skills || []).map((skill) => String(skill)).filter(Boolean).slice(0, 3);
    const role = jobTitle || 'this role';
    const org = company || 'your team';
    const skillLine = skills.length ? ` My work with ${skills.join(', ')} maps closely to what this role needs.` : '';
    return {
      answer: `I'm excited about the ${role} position at ${org}.${skillLine} I'm looking to contribute to a team where I can keep growing and deliver real results.`,
      source: 'logistics-generated',
      confidence: 0.5,
    };
  }

  return null;
}

export function isSubmitButtonText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/sign in|log in|contact sales|attach file|paste|next|continue/i.test(t)) return false;
  return /submit application|^submit$|^apply$|apply now|send application|submit my application|finish application/i.test(t);
}

function yesNoValue(value) {
  const v = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(v)) return 'Yes';
  if (['false', 'no', 'n', '0'].includes(v)) return 'No';
  return String(value);
}

/**
 * Start-date fields are time-relative, so a fixed date would be wrong for the
 * next application. Accept tokens and compute the real date at fill time:
 *   tomorrow / next_day        -> today + 1
 *   immediate / immediately/today -> today
 *   +3 days / +7d              -> today + N
 *   an explicit date or year   -> used as given
 */
export function resolveStartDate(value, now = new Date()) {
  const v = String(value || '').trim();
  if (!v) return '';
  const lower = v.toLowerCase();
  let days = null;
  if (/^(tomorrow|next[_\s-]?day|next\s+day)$/.test(lower)) days = 1;
  else if (/^(immediate|immediately|today|asap|as\s+soon\s+as\s+possible)$/.test(lower)) days = 0;
  else if (/^\+?\s*(\d+)\s*d(ays?)?$/.test(lower)) days = Number(lower.match(/(\d+)/)[1]);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${m}/${d}/${y}`;
  } else {
    // An explicit value the candidate typed (e.g. "06/15/2026") is used as-is.
    return v;
  }
  const date = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${date.getFullYear()}`;
}

/**
 * Answers the candidate configures ONCE in the server .env. These are the
 * candidate's own stated values (salary, sponsorship, notice, start date), so
 * the agent answers them every time instead of stopping, and never invents a
 * personal or legal fact.
 */
export function policyAnswer(question, policy = {}) {
  const q = String(question || '').toLowerCase();
  const has = (value) => value !== undefined && value !== null && String(value).trim() !== '';
  if (/desired (annual )?(salary|compensation)|expected (salary|ctc|compensation)|salary expectation|salary requirement|target salary/.test(q)) {
    if (has(policy.salary)) return { answer: String(policy.salary), source: 'policy-salary', confidence: 0.85 };
  }
  if (/(require|need) (company )?(assistance|sponsorship)|require sponsorship|visa sponsorship|immigration (support|assistance)/.test(q)) {
    if (has(policy.requireSponsorship)) return { answer: yesNoValue(policy.requireSponsorship), source: 'policy-sponsorship', confidence: 0.85 };
  }
  if (/authorized to work|work authorization|legally (eligible|authorized)|right to work|eligible to work/.test(q)) {
    if (has(policy.workAuthorized)) return { answer: yesNoValue(policy.workAuthorized), source: 'policy-work-auth', confidence: 0.85 };
  }
  if (/notice period|how much notice|joining time|period of notice/.test(q)) {
    if (has(policy.noticePeriod)) return { answer: String(policy.noticePeriod), source: 'policy-notice', confidence: 0.8 };
  }
  if (/available to start|date are you available|earliest (start|availability)|start date|available from|when can you (start|join)/.test(q)) {
    if (has(policy.startDate)) {
      const date = resolveStartDate(policy.startDate);
      if (date) return { answer: date, source: 'policy-start', confidence: 0.8 };
    }
  }
  return null;
}
