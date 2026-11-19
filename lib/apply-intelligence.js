/**
 * Shared Auto Apply intelligence — used by the server infer-answer API and tests.
 * Never invents personal facts. Sensitive questions must come from profile/vault
 * or be returned as unanswerable so the extension can ask the user.
 */

export const FIELD_HINTS = [
  { key: 'email', test: /e-?mail/i },
  { key: 'phone', test: /phone|mobile|tel|cell/i },
  { key: 'firstName', test: /first.?name|given.?name|firstname/i },
  { key: 'lastName', test: /last.?name|surname|family.?name|lastname/i },
  { key: 'fullName', test: /^name$|full.?name|your.?name|legal.?name|candidate.?name|applicant.?name/i },
  { key: 'address', test: /street.?address|^address$|address.?line.?1|mailing.?address/i },
  { key: 'address2', test: /address.?line.?2|apt|suite|unit/i },
  { key: 'city', test: /^city$|town|municipality/i },
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
  { key: 'graduation', test: /graduat|class.?of|year.?of|expected/i },
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
  { id: 'work_auth', test: /authorized to work|legally.?eligible|work authorization|right to work|citizenship|visa status|immigration status/i },
  { id: 'sponsorship', test: /sponsorship|sponsor you|require a visa|need a visa|h-?1b|opt|cpt/i },
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
  return /gender|hispanic|race|ethnicity|veteran|disability|lgbt|sexual orientation|decline to self/i.test(String(question || ''));
}

export function isConsentQuestion(question) {
  return /privacy|acknowledge|agree|consent|terms|i understand|i certify/i.test(String(question || ''));
}

function splitLocation(location) {
  const parts = String(location || '').split(',').map((p) => p.trim()).filter(Boolean);
  return {
    city: parts[0] || '',
    state: parts[1] || '',
    country: parts[2] || parts[1] || '',
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
    salary: profile?.expectedSalary || profile?.salary || '',
    experience_years: years != null && years !== '' ? String(years) : String(internships.length || '0'),
    codechef: profile?.codechef || profile?.codechefRating || '',
    codeforces: profile?.codeforces || profile?.codeforcesRating || '',
    leetcode: profile?.leetcode || profile?.leetcodeRating || '',
    hackerrank: profile?.hackerrank || profile?.hackerrankRating || '',
    cover_letter: `I am excited to apply for the ${jobTitle || 'position'} at ${company || 'your company'}. With my background in ${(profile?.skills || []).slice(0, 4).join(', ') || 'software development'}, I am confident in my ability to contribute effectively.`,
  };
  return String(map[key] || '').trim();
}

export function matchHint(label) {
  return FIELD_HINTS.find((item) => item.test.test(String(label || '')));
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

  const hint = matchHint(q);
  if (hint) {
    const value = profileValueForHint(profile, hint.key, jobTitle, company);
    if (value) {
      if (options.length) {
        const exact = options.find((o) => String(o).toLowerCase() === value.toLowerCase());
        if (exact) return { canInfer: true, answer: exact, source: 'profile', confidence: 0.9 };
        return { canInfer: false, reason: 'no-matching-option' };
      }
      return { canInfer: true, answer: value, source: 'profile', confidence: 0.9 };
    }
  }

  const experience = profile.experience || [];
  const workedHere = experience.some((item) => {
    const c = String(item.company || '').toLowerCase();
    return c && (c.includes(String(company || '').toLowerCase()) || String(company || '').toLowerCase().includes(c));
  });
  if (/employed by|worked (for|at)|previously employed|ever been employed|former employee/i.test(q)
    && (workedHere || /this company|the company/.test(q.toLowerCase()) || (company && q.toLowerCase().includes(String(company).toLowerCase())))) {
    const answer = workedHere ? 'Yes' : 'No';
    const picked = pickOption(options, [workedHere ? /^(yes|y)\b/i : /^(no|n)\b/i]);
    if (options.length && !picked) return { canInfer: false, reason: 'no-matching-option' };
    return { canInfer: true, answer: picked || answer, source: 'profile-employment', confidence: 0.92 };
  }

  if (/how did you hear|referral source|source of application/i.test(q)) {
    const found = pickOption(options, [/linkedin/i, /job board/i, /company website|careers site|online/i]);
    if (found) return { canInfer: true, answer: found, source: 'source-heuristic', confidence: 0.9 };
  }

  const sensitive = sensitiveCategory(q);
  if (sensitive) {
    if (sensitive === 'sponsorship' && (profile.requireSponsorship === true || profile.requireSponsorship === false)) {
      const yes = profile.requireSponsorship === true;
      const picked = pickOption(options, [yes ? /^(yes|y)\b/i : /^(no|n)\b/i]);
      if (options.length && !picked) return { canInfer: false, reason: 'no-matching-option' };
      return { canInfer: true, answer: picked || (yes ? 'Yes' : 'No'), source: 'profile', confidence: 0.95 };
    }
    if (sensitive === 'work_auth' && (profile.workAuthorized === true || profile.workAuthorized === false || profile.authorizedToWork)) {
      const yes = profile.workAuthorized === true || String(profile.authorizedToWork).toLowerCase() === 'yes';
      const picked = pickOption(options, [yes ? /^(yes|y)\b/i : /^(no|n)\b/i]);
      if (options.length && !picked) return { canInfer: false, reason: 'no-matching-option' };
      return { canInfer: true, answer: picked || (yes ? 'Yes' : 'No'), source: 'profile', confidence: 0.95 };
    }
    if (sensitive === 'salary' && (profile.expectedSalary || profile.salary)) {
      return { canInfer: true, answer: String(profile.expectedSalary || profile.salary), source: 'profile', confidence: 0.9 };
    }
    return {
      canInfer: false,
      reason: `missing-${sensitive}`,
      message: `This is a ${sensitive.replace(/_/g, ' ')} question and is not stored in the profile.`,
    };
  }

  if (/available|willing to relocate|able to relocate|open to relocation|onsite|on-site|hybrid|remote/i.test(q)) {
    const prefs = profile.preferences || {};
    const locations = [...(prefs.locations || []), profile.location].filter(Boolean).map((s) => String(s).toLowerCase());
    const jobLoc = String(profile.jobLocation || '').toLowerCase();
    const canRelocate = /relocate/i.test(q) && locations.some((l) => /any|relocat|remote/.test(l));
    const matchesJobLocation = jobLoc && locations.some((l) => jobLoc.includes(l) || l.includes(jobLoc));
    if (canRelocate || matchesJobLocation) {
      const yes = pickOption(options, [/^(yes|y)\b/i]);
      if (options.length && !yes) return { canInfer: false, reason: 'no-matching-option' };
      return { canInfer: true, answer: yes || 'Yes', source: 'profile-prefs', confidence: 0.85 };
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

export function isSubmitButtonText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/sign in|log in|contact sales|attach file|paste|next|continue/i.test(t)) return false;
  return /submit application|^submit$|^apply$|apply now|send application|submit my application|finish application/i.test(t);
}
