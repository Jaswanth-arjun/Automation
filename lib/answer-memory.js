/**
 * Persistent, per-user application answer memory.
 *
 * A saved answer is only reused when the question is genuinely compatible:
 *  - the normalised question matches, or
 *  - the semantic category matches AND token overlap is high enough,
 *  - sensitive categories (work authorization, sponsorship, salary, criminal,
 *    disability, age/DOB, EEO, government IDs) never cross categories,
 *  - a different country in the question invalidates a country-specific answer.
 *
 * Fail-closed: when compatibility is uncertain, `lookupAnswer` returns no
 * answer so the agent asks the user instead of inventing a fact.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AnswerMemoryModel, isMongoActive } from './mongodb.js';
import { normalizeQuestion, sensitiveCategory } from './apply-intelligence.js';

const MEMORY_FILE = path.join(process.cwd(), 'data', 'answer_memory.json');
const ENCRYPTION_KEY = crypto.createHash('sha256')
  .update(String(process.env.ANSWER_MEMORY_KEY || process.env.GMAIL_APP_PASS || process.env.MONGODB_URI || 'hamzooh-local-answer-key'))
  .digest();

function encryptAnswer(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function encryptSensitiveValue(value) {
  return encryptAnswer(value);
}

export function decryptSensitiveValue(payload) {
  return decryptAnswer(payload);
}

function decryptAnswer(payload) {
  try {
    const [version, iv, tag, data] = String(payload || '').split(':');
    if (version !== 'v1' || !iv || !tag || !data) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function withPlaintext(entry) {
  if (!entry) return entry;
  if (entry.answer) return entry;
  if (!entry.encryptedAnswer) return entry;
  return { ...entry, answer: decryptAnswer(entry.encryptedAnswer) };
}

function ensureFile() {
  const dir = path.dirname(MEMORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE, '[]', 'utf8');
}

function readFileRows() {
  ensureFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFileRows(rows) {
  ensureFile();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(rows, null, 2), 'utf8');
}

const CATEGORY_RULES = [
  { category: 'visa_sponsorship', test: /sponsor|h-?1b|visa transfer|require a visa|need a visa|assistance to obtain (?:work )?authori[sz]ation|require (?:company |employer )?assistance|company assistance/i },
  { category: 'work_authorization', test: /authori[sz]ed to work|authori[sz]ation to work|right to work|legally (eligible|authori[sz]ed)|work permit|citizenship|immigration status|eligible to work/i },
  { category: 'government_id', test: /social security|\bssn\b|aadhaar|passport number|national id|government id/i },
  { category: 'criminal_history', test: /convicted|felony|criminal record|misdemeanor|background check history/i },
  { category: 'disability_medical', test: /disabilit|medical condition|chronic illness|accommodation/i },
  { category: 'age_dob', test: /date of birth|\bd\.?o\.?b\b|at least 18|over 18|your age/i },
  { category: 'eeo', test: /gender|race\b|ethnicity|veteran|sexual orientation|pronouns|hispanic|latino/i },
  { category: 'salary', test: /salary|compensation|expected pay|pay expectation|\bctc\b|desired pay|hourly rate/i },
  { category: 'notice_period', test: /notice period|how soon can you (start|join)|available to start|start date|joining date/i },
  { category: 'relocation', test: /willing to relocate|relocat|willing to travel|onsite|hybrid|remote work|work from office/i },
  { category: 'availability', test: /available for (an )?internship|full.?time|part.?time|hours per week|availability|commitment/i },
  { category: 'experience_years', test: /years?.?(of )?experience|total experience|how long have you (worked|been)/i },
  { category: 'current_employment', test: /currently employed|current employer|current company|current role/i },
  { category: 'education_degree', test: /degree|qualification|major|field of study|undergraduate program|what are you (studying|pursuing)|current program/i },
  { category: 'education_institution', test: /university|college|school|institute|alma mater|institution name/i },
  { category: 'education_dates', test: /graduat|graduation year|class of|expected completion|passing year/i },
  { category: 'gpa', test: /gpa|cgpa|grade point|percentage in (b\.?tech|degree)/i },
  { category: 'skills', test: /programming languages|technical skills|\bskills?\b|frameworks|technologies|tools you|proficien/i },
  { category: 'projects', test: /projects?\b|portfolio|github project|describe a project/i },
  { category: 'links', test: /linkedin|github|portfolio|personal website|profile url/i },
  { category: 'contact_name', test: /full name|your name|first name|last name|legal name|preferred name/i },
  { category: 'contact_email', test: /e-?mail/i },
  { category: 'contact_phone', test: /phone|mobile|\btel\b|contact number/i },
  { category: 'contact_address', test: /address|street|city|state|province|zip|postal|country|location/i },
  { category: 'cover_letter', test: /cover letter|why do you want|why this role|tell us about yourself|additional information|anything else/i },
  { category: 'consent', test: /consent|privacy|acknowledge|agree|terms|certify|i understand/i },
];

const SENSITIVE_CATEGORIES = new Set([
  'work_authorization', 'visa_sponsorship', 'government_id', 'criminal_history',
  'disability_medical', 'age_dob', 'eeo', 'salary',
]);

const LOCKED_ALIASES = {
  degree: ['degree', 'qualification', 'program', 'major', 'undergraduate', 'graduate', 'btech', 'bachelor', 'master', 'pursuing', 'studying', 'enrolled', 'enrollment'],
  university: ['university', 'college', 'institute', 'institution', 'school', 'campus'],
  work: ['work', 'job', 'employment', 'employer', 'company'],
  start: ['start', 'join', 'available', 'availability', 'notice', 'date'],
  authorized: ['authorized', 'authorised', 'authorization', 'authorisation', 'eligible', 'legally', 'permitted', 'right'],
  sponsor: ['sponsor', 'sponsorship', 'visa', 'h1b', 'assistance'],
  relocate: ['relocate', 'relocation', 'move', 'travel', 'commute'],
  salary: ['salary', 'compensation', 'pay', 'ctc', 'rate', 'package', 'stipend', 'remuneration'],
  graduate: ['graduation', 'graduate', 'graduating', 'completion', 'passing', 'class'],
};

const COUNTRY_NAMES = [
  'united states', 'usa', 'us', 'india', 'united kingdom', 'uk', 'canada', 'australia',
  'germany', 'france', 'singapore', 'united arab emirates', 'uae', 'netherlands',
  'ireland', 'new zealand', 'japan', 'south korea', 'switzerland', 'sweden', 'spain',
  'italy', 'brazil', 'mexico', 'south africa', 'nigeria', 'kenya', 'pakistan', 'bangladesh',
];

export function questionCategory(question) {
  const text = String(question || '');
  const hit = CATEGORY_RULES.find((rule) => rule.test.test(text));
  if (hit) return hit.category;
  const sensitive = sensitiveCategory(text);
  if (sensitive) {
    if (sensitive === 'salary') return 'salary';
    if (sensitive === 'sponsorship') return 'visa_sponsorship';
    return sensitive;
  }
  return 'general';
}

export function isSensitiveCategory(category) {
  return SENSITIVE_CATEGORIES.has(category);
}

// Two questions in one sensitive category can be worded very differently while
// asking the same thing ("Expected salary" vs "What is your desired annual
// salary?"). Intent ids let an already-approved answer be reused for the same
// intent without ever crossing categories (current pay vs expected pay).
const SENSITIVE_INTENTS = [
  { id: 'salary:current', test: /current (salary|ctc|compensation|pay)|present (salary|ctc)|last drawn/i },
  { id: 'salary:expected', test: /salary|compensation|\bctc\b|\bpay\b|hourly rate|stipend|remuneration/i },
  { id: 'sponsorship', test: /sponsor|visa|assistance to obtain|require .*assistance|immigration (support|assistance)/i },
  { id: 'work_auth_country', test: /work authori[sz]ation country|country of (work )?authori[sz]ation|country .*authori[sz]ed|citizenship|nationality/i },
  { id: 'work_auth', test: /authori[sz]ed to work|authori[sz]ation to work|right to work|legally (eligible|authori[sz]ed)|eligible to work|work permit/i },
  { id: 'government_id', test: /social security|\bssn\b|aadhaar|passport number|national id|government id/i },
  { id: 'criminal_history', test: /convicted|felony|criminal|misdemeanor/i },
  { id: 'disability_medical', test: /disabilit|medical condition|chronic illness|accommodation/i },
  { id: 'age_dob', test: /date of birth|\bd\.?o\.?b\b|at least 18|over 18|your age/i },
  { id: 'eeo', test: /gender|race\b|ethnicity|veteran|sexual orientation|pronoun|hispanic|latino/i },
];

export function sensitiveIntent(question) {
  const text = String(question || '');
  const hit = SENSITIVE_INTENTS.find((rule) => rule.test.test(text));
  return hit?.id || '';
}

function countryIn(text) {
  const lower = ` ${String(text || '').toLowerCase()} `;
  return COUNTRY_NAMES.find((country) => new RegExp(`\\b${country.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) || '';
}

function canonicalCountry(country) {
  const value = String(country || '').toLowerCase();
  if (['usa', 'us', 'united states'].includes(value)) return 'united states';
  if (['uk', 'united kingdom'].includes(value)) return 'united kingdom';
  if (['uae', 'united arab emirates'].includes(value)) return 'united arab emirates';
  return value;
}

function expandTokens(normalized) {
  const lookup = new Map();
  for (const [canonical, aliases] of Object.entries(LOCKED_ALIASES)) {
    for (const alias of aliases) lookup.set(alias, canonical);
  }
  const tokens = new Set();
  for (const token of String(normalized || '').split(' ').filter(Boolean)) {
    tokens.add(lookup.get(token) || token);
  }
  return tokens;
}

function tokenScore(a, b) {
  const left = expandTokens(a);
  const right = expandTokens(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / Math.max(left.size, right.size);
}

/**
 * Decide whether a saved answer may answer a new question.
 * Returns { ok, score, reason }.
 */
export function answerCompatibility(entry, question, options = []) {
  if (!entry?.answer) return { ok: false, score: 0, reason: 'empty-entry' };
  const questionNorm = normalizeQuestion(question);
  const entryNorm = entry.normalizedQuestion || normalizeQuestion(entry.question);
  const questionCat = entry.semanticCategory || entry.category || questionCategory(entry.question);
  const askedCat = questionCategory(question);
  const score = questionNorm === entryNorm ? 1 : tokenScore(questionNorm, entryNorm);

  if (isSensitiveCategory(askedCat) || isSensitiveCategory(questionCat)) {
    if (askedCat !== questionCat) {
      return { ok: false, score, reason: `different-sensitive-category:${askedCat}!=${questionCat}` };
    }
    const askedCountry = canonicalCountry(countryIn(question));
    const entryCountry = canonicalCountry(entry.country || countryIn(entry.question));
    if (askedCountry && entryCountry && askedCountry !== entryCountry) {
      return { ok: false, score, reason: `different-country:${askedCountry}!=${entryCountry}` };
    }
    // Different intents inside one sensitive category are different questions:
    // "current CTC" must never be answered with "expected salary" even when the
    // wording overlaps. Same intent is the same question in other words, so an
    // approved answer still applies below the usual threshold.
    const askedIntent = sensitiveIntent(question);
    const entryIntent = sensitiveIntent(entry.question);
    if (askedIntent && entryIntent && askedIntent !== entryIntent) {
      return { ok: false, score, reason: `different-sensitive-intent:${askedIntent}!=${entryIntent}` };
    }
    if (score < 0.5 && (!askedIntent || askedIntent !== entryIntent)) {
      return { ok: false, score, reason: 'sensitive-question-not-similar-enough' };
    }
  } else {
    // A specific matching category (education, availability, links, …) lowers
    // the wording threshold; different categories are still rejected above.
    const askedCountry = canonicalCountry(countryIn(question));
    const entryCountry = canonicalCountry(entry.country || countryIn(entry.question));
    if (askedCountry && entryCountry && askedCountry !== entryCountry) {
      return { ok: false, score, reason: `different-country:${askedCountry}!=${entryCountry}` };
    }
    const threshold = askedCat === 'general' ? 0.55 : 0.3;
    if (score < threshold) {
      // A cheap ATS label ("Skills") and a descriptive question ("Which skills
      // should be listed on this application?") mean the same thing. When the
      // shorter wording is fully contained in the longer one AND both are the
      // same concrete category, the saved answer still applies.
      const left = new Set(questionNorm.split(' ').filter(Boolean));
      const right = new Set(entryNorm.split(' ').filter(Boolean));
      const contained = left.size && right.size && (left.size <= right.size
        ? [...left].every((token) => right.has(token))
        : [...right].every((token) => left.has(token)));
      if (!(contained && askedCat !== 'general' && askedCat === questionCat)) {
        return { ok: false, score, reason: 'not-similar-enough' };
      }
    }
  }

  if (entry.reviewAfter && new Date(entry.reviewAfter).getTime() < Date.now()) {
    return { ok: false, score, reason: 'answer-needs-review' };
  }

  if (Array.isArray(options) && options.length) {
    const exact = options.find((option) => String(option).trim().toLowerCase() === String(entry.answer).trim().toLowerCase());
    if (!exact) return { ok: false, score, reason: 'saved-answer-not-an-option' };
  }

  return { ok: true, score, reason: 'compatible' };
}

function publicEntry(entry) {
  return {
    id: entry.id,
    userId: entry.userId,
    question: entry.question,
    normalizedQuestion: entry.normalizedQuestion,
    category: entry.category,
    answer: entry.answer || decryptAnswer(entry.encryptedAnswer),
    source: entry.source,
    confirmed: Boolean(entry.confirmed),
    sensitive: Boolean(entry.sensitive),
    options: entry.options || [],
    answerType: entry.answerType || 'text',
    context: entry.context || '',
    reviewAfter: entry.reviewAfter || '',
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    history: entry.history || [],
  };
}

async function rowsForUser(userId) {
  if (isMongoActive()) {
    try {
      const docs = await AnswerMemoryModel.find({ userId }).sort({ updatedAt: -1 }).lean();
      if (docs) return docs.map(withPlaintext);
    } catch (err) {
      console.warn('[answer-memory] mongo read failed, using file:', err.message);
    }
  }
  return readFileRows().filter((row) => row.userId === userId).map(withPlaintext);
}

async function persist(entry) {
  const rows = readFileRows();
  const index = rows.findIndex((row) => row.id === entry.id);
  if (index >= 0) rows[index] = entry;
  else rows.push(entry);
  writeFileRows(rows);
  if (isMongoActive()) {
    try {
      await AnswerMemoryModel.findOneAndUpdate({ id: entry.id }, { $set: entry }, { upsert: true });
    } catch (err) {
      console.warn('[answer-memory] mongo write failed:', err.message);
    }
  }
  return publicEntry(entry);
}

function findExisting(rows, userId, normalizedQuestion, category) {
  return rows.find((row) => row.userId === userId
    && row.normalizedQuestion === normalizedQuestion
    && (row.category || 'general') === category);
}

const ANSWER_TYPES = new Set(['text', 'textarea', 'yesno', 'select', 'radio', 'date', 'number', 'email', 'phone', 'url']);

function normalizeAnswerType(value) {
  const type = String(value || 'text').toLowerCase();
  return ANSWER_TYPES.has(type) ? type : 'text';
}

/** Best-guess the input kind so the stored answer can be filled correctly. */
function inferAnswerType(question, options) {
  const q = String(question || '').toLowerCase();
  const opts = (options || []).map((o) => String(o).trim()).filter(Boolean);
  if (opts.length) {
    return opts.length <= 4 && opts.every((o) => /^(yes|no|y|n|true|false|prefer not|decline)/i.test(o)) ? 'yesno' : 'select';
  }
  if (/date|when (can|will|are) you|available to start|start date|joining date|graduation date/i.test(q)) return 'date';
  if (/how many|years? of experience|number of|salary|ctc|amount|gpa|cgpa|percentage/i.test(q)) return 'number';
  if (/e-?mail/i.test(q)) return 'email';
  if (/phone|mobile|\btel\b/i.test(q)) return 'phone';
  if (/linkedin|github|portfolio|website|url|link/i.test(q)) return 'url';
  if (/describe|explain|why|tell us|additional information|cover letter|summary/i.test(q)) return 'textarea';
  return 'text';
}

export async function listAnswers(userId) {
  if (!userId) return [];
  const rows = await rowsForUser(userId);
  return rows.map(publicEntry).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

export async function saveAnswer(userId, payload = {}) {
  if (!userId) throw new Error('A signed-in user is required to save an answer.');
  const question = String(payload.question || '').trim();
  const answer = String(payload.answer ?? '').trim();
  if (!question) throw new Error('A question is required.');
  if (!answer) throw new Error('An answer is required.');

  const category = payload.category || questionCategory(question);
  const sensitive = isSensitiveCategory(category) || Boolean(payload.sensitive);
  if (sensitive && payload.consent !== true) {
    throw new Error('This answer contains sensitive personal information. Explicit consent is required to save it.');
  }

  const normalizedQuestion = normalizeQuestion(question);
  const rows = await rowsForUser(userId);
  const existing = findExisting(rows, userId, normalizedQuestion, category);
  const now = new Date().toISOString();
  const entry = {
    id: existing?.id || `ans_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`,
    userId,
    question,
    normalizedQuestion,
    category,
    semanticCategory: category,
    answer: sensitive ? '' : answer,
    ...(sensitive ? { encryptedAnswer: encryptAnswer(answer) } : { encryptedAnswer: '' }),
    source: String(payload.source || 'user').slice(0, 40),
    confirmed: payload.confirmed !== false,
    sensitive,
    consentAt: sensitive ? now : (existing?.consentAt || ''),
    options: Array.isArray(payload.options) ? payload.options.slice(0, 30).map(String) : (existing?.options || []),
    answerType: normalizeAnswerType(payload.answerType || inferAnswerType(question, payload.options)),
    context: String(payload.context || '').slice(0, 500),
    country: String(payload.country || countryIn(question)).slice(0, 80),
    reviewAfter: String(payload.reviewAfter || '').slice(0, 40),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    history: [
      ...(existing?.history || []),
      ...(existing && existing.answer !== answer && !sensitive
        ? [{ at: now, previousAnswer: existing.answer, source: existing.source || 'user' }]
        : []),
    ].slice(-20),
  };
  return persist(entry);
}

export async function updateAnswer(userId, id, patch = {}) {
  const rows = await rowsForUser(userId);
  const existing = rows.find((row) => row.id === id);
  if (!existing) return null;
  const question = String(patch.question || existing.question);
  const answer = patch.answer !== undefined ? String(patch.answer).trim() : existing.answer;
  if (!answer) throw new Error('An answer is required.');
  const category = patch.category || questionCategory(question);
  const sensitive = isSensitiveCategory(category) || Boolean(existing.sensitive);
  if (sensitive && patch.consent !== true && existing.sensitive !== true) {
    throw new Error('Explicit consent is required for this sensitive answer.');
  }
  const now = new Date().toISOString();
  const updated = {
    ...existing,
    question,
    normalizedQuestion: normalizeQuestion(question),
    category,
    semanticCategory: category,
    answer: sensitive ? '' : answer,
    ...(sensitive ? { encryptedAnswer: encryptAnswer(answer) } : { encryptedAnswer: '' }),
    sensitive,
    confirmed: patch.confirmed !== undefined ? Boolean(patch.confirmed) : existing.confirmed,
    reviewAfter: patch.reviewAfter !== undefined ? String(patch.reviewAfter) : existing.reviewAfter,
    options: Array.isArray(patch.options) ? patch.options.slice(0, 30).map(String) : existing.options,
    answerType: patch.answerType !== undefined ? normalizeAnswerType(patch.answerType) : (existing.answerType || 'text'),
    updatedAt: now,
    history: answer !== existing.answer && !sensitive
      ? [...(existing.history || []), { at: now, previousAnswer: existing.answer, source: existing.source || 'user' }].slice(-20)
      : (existing.history || []),
  };
  return persist(updated);
}

export async function deleteAnswer(userId, id) {
  const rows = await rowsForUser(userId);
  const existing = rows.find((row) => row.id === id);
  if (!existing) return false;
  const remaining = readFileRows().filter((row) => row.id !== id);
  writeFileRows(remaining);
  if (isMongoActive()) {
    try { await AnswerMemoryModel.deleteOne({ id, userId }); } catch (err) {
      console.warn('[answer-memory] mongo delete failed:', err.message);
    }
  }
  return true;
}

/**
 * Find the best compatible saved answer. Never returns an incompatible answer.
 */
export async function lookupAnswer(userId, question, options = []) {
  if (!userId || !question) return { answer: null, reason: 'missing-user-or-question' };
  const rows = await rowsForUser(userId);
  if (!rows.length) return { answer: null, reason: 'no-saved-answers' };

  let best = null;
  let needsReview = false;
  for (const row of rows) {
    const check = answerCompatibility(row, question, options);
    if (check.reason === 'answer-needs-review') needsReview = true;
    if (!check.ok) continue;
    if (!best || check.score > best.score) best = { entry: row, score: check.score };
  }
  if (!best) return { answer: null, reason: needsReview ? 'answer-needs-review' : 'no-compatible-answer' };

  return {
    answer: best.entry.answer,
    entry: publicEntry(best.entry),
    score: Math.round(best.score * 100) / 100,
    source: best.entry.source || 'memory',
    category: best.entry.category,
  };
}

/** Import legacy single-owner vault answers into one user's memory (opt-in). */
export async function importVaultAnswers(userId, answers = {}, source = 'vault-import') {
  if (!userId) return [];
  const saved = [];
  for (const [question, value] of Object.entries(answers || {})) {
    if (!question || value == null || String(value).trim() === '') continue;
    const category = questionCategory(question);
    try {
      const entry = await saveAnswer(userId, {
        question,
        answer: String(value),
        category,
        source,
        consent: isSensitiveCategory(category) ? false : undefined,
        confirmed: true,
      });
      saved.push(entry);
    } catch {
      // Sensitive legacy answers require fresh consent; skip them.
    }
  }
  return saved;
}
