/**
 * Job Match Engine — personalised, evidence-based match scoring.
 *
 * Everything here is computed from the *actual* four inputs for one user:
 *   1. the job description (JD) + structured job requirements
 *   2. the user's active resume text
 *   3. the user's profile (skills / education / experience / projects)
 *   4. the user's eligibility details (graduation year, experience, degree)
 *
 * Rules this engine enforces:
 *   • No score is produced when the evidence needed to judge the job is missing
 *     — the caller gets `status: 'incomplete'` plus the exact missing items.
 *   • Mandatory eligibility is evaluated separately from skill relevance, so a
 *     strong skills match can never mark an ineligible candidate as eligible.
 *   • Every point of the score maps to a named dimension with a weight, and
 *     every dimension is backed by matched text or structured data.
 *   • Results are deterministic and cached by (user, profileVersion,
 *     resumeVersion, jobVersion) so repeated renders never recompute or drift.
 */

/* ------------------------------------------------------------------ */
/* Versioning + cache                                                   */
/* ------------------------------------------------------------------ */

const CACHE_KEY = 'hamzo_match_cache_v1';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // stale after 14 days
const CACHE_MAX_ENTRIES = 400;

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    const entries = Object.entries(cache)
      .filter(([, value]) => value && Date.now() - (value.at || 0) < CACHE_TTL_MS)
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
      .slice(0, CACHE_MAX_ENTRIES);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage full / disabled — scoring still works, just uncached */
  }
}

export function clearMatchCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** Small, stable non-cryptographic hash for building cache keys. */
function hashString(input) {
  const text = String(input || '');
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function getActiveResume() {
  try {
    const raw = localStorage.getItem('wayin_resumes');
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list) || !list.length) return null;
    return list.find((item) => item.isActive) || list[0] || null;
  } catch {
    return null;
  }
}

export function resumeVersion(resume) {
  if (!resume) return 'none';
  return hashString(
    [resume.id, resume.uploadedAt, resume.text, resume.name].filter(Boolean).join('|'),
  );
}

export function profileVersion(profile) {
  if (!profile) return 'none';
  if (profile.updatedAt) return hashString(profile.updatedAt);
  return hashString(JSON.stringify(profile));
}

/* ------------------------------------------------------------------ */
/* Text utilities                                                       */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set(`
a an the and or of to in on for with without at by from as is are was were be been being
this that these those it its we you your our their they he she them i me my us
will can should would could may might must shall do does did doing done have has had
not no nor but if then than so such about into over under between across during while
job role position candidate candidates applicant applicants work working works experience
experienced years year months month etc plus per new best strong good great ability able
responsibilities responsibility requirements required requirement preferred skills skill
knowledge understanding familiarity familiar basics basic advanced excellent proven hands
team teams company companies please apply application applications opportunity opportunities
india remote hybrid onsite full time part internship intern interns freshers fresher
looking seeking join us who what which when where how why all any more most other some
`.split(/\s+/).filter(Boolean));

const SYNONYMS = {
  js: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  reactjs: 'react',
  'react.js': 'react',
  react: 'react',
  nextjs: 'next',
  'next.js': 'next',
  nodejs: 'node',
  'node.js': 'node',
  node: 'node',
  expressjs: 'express',
  'express.js': 'express',
  express: 'express',
  k8s: 'kubernetes',
  kubernetes: 'kubernetes',
  'ci/cd': 'cicd',
  cicd: 'cicd',
  ml: 'machinelearning',
  'machine learning': 'machinelearning',
  'deep learning': 'deeplearning',
  dl: 'deeplearning',
  nlp: 'nlp',
  ai: 'ai',
  'artificial intelligence': 'ai',
  dsa: 'datastructures',
  'data structures': 'datastructures',
  'data structure': 'datastructures',
  ds: 'datastructures',
  algorithms: 'algorithms',
  algorithm: 'algorithms',
  oop: 'oop',
  'object oriented': 'oop',
  dbms: 'dbms',
  'database management': 'dbms',
  sql: 'sql',
  mysql: 'mysql',
  postgres: 'postgresql',
  postgresql: 'postgresql',
  mongo: 'mongodb',
  mongodb: 'mongodb',
  rest: 'restapi',
  'rest api': 'restapi',
  'rest apis': 'restapi',
  restful: 'restapi',
  api: 'restapi',
  apis: 'restapi',
  gcp: 'gcp',
  'google cloud': 'gcp',
  aws: 'aws',
  'amazon web services': 'aws',
  azure: 'azure',
  cpp: 'c++',
  'c++': 'c++',
  csharp: 'c#',
  'c#': 'c#',
  c: 'c',
  html5: 'html',
  css3: 'css',
  tailwind: 'tailwind',
  'tailwind css': 'tailwind',
  bootstrap: 'bootstrap',
  'spring boot': 'springboot',
  springboot: 'springboot',
  spring: 'spring',
  hibernate: 'hibernate',
  pytorch: 'pytorch',
  tensorflow: 'tensorflow',
  numpy: 'numpy',
  pandas: 'pandas',
  scikit: 'scikitlearn',
  'scikit-learn': 'scikitlearn',
  sklearn: 'scikitlearn',
  powerbi: 'powerbi',
  'power bi': 'powerbi',
  tableau: 'tableau',
  excel: 'excel',
  uiux: 'uiux',
  'ui/ux': 'uiux',
  figma: 'figma',
  git: 'git',
  github: 'github',
  gitlab: 'gitlab',
  jira: 'jira',
  agile: 'agile',
  scrum: 'scrum',
  microservices: 'microservices',
  microservice: 'microservices',
  kafka: 'kafka',
  redis: 'redis',
  graphql: 'graphql',
  postman: 'postman',
  firebase: 'firebase',
  linux: 'linux',
  docker: 'docker',
  testing: 'testing',
  selenium: 'selenium',
  jest: 'jest',
  cypress: 'cypress',
  playwright: 'playwright',
  flutter: 'flutter',
  'react native': 'reactnative',
  android: 'android',
  kotlin: 'kotlin',
  swift: 'swift',
  unity: 'unity',
  photoshop: 'photoshop',
  canva: 'canva',
  seo: 'seo',
  'digital marketing': 'digitalmarketing',
  salesforce: 'salesforce',
  sap: 'sap',
  communication: 'communication',
  teamwork: 'teamwork',
  'problem solving': 'problemsolving',
  leadership: 'leadership',
  presentation: 'presentation',
};

/** Canonical form of a skill / token so "Node.js", "nodejs" and "Node" agree. */
export function canonicalSkill(raw) {
  const clean = String(raw || '')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  if (SYNONYMS[clean]) return SYNONYMS[clean];
  const squeezed = clean.replace(/\s+/g, '');
  if (SYNONYMS[squeezed]) return SYNONYMS[squeezed];
  const withoutDots = clean.replace(/\.js\b/g, 'js').replace(/[./]/g, ' ').replace(/\s+/g, ' ').trim();
  if (SYNONYMS[withoutDots]) return SYNONYMS[withoutDots];
  const squeezedDots = withoutDots.replace(/\s+/g, '');
  if (SYNONYMS[squeezedDots]) return SYNONYMS[squeezedDots];
  return squeezedDots;
}

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ''))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map((token) => canonicalSkill(token))
    .filter(Boolean);
}

function cosine(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const freqA = new Map();
  const freqB = new Map();
  tokensA.forEach((token) => freqA.set(token, (freqA.get(token) || 0) + 1));
  tokensB.forEach((token) => freqB.set(token, (freqB.get(token) || 0) + 1));

  // IDF over the two documents keeps generic words from inflating similarity.
  const vocabulary = new Set([...freqA.keys(), ...freqB.keys()]);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  vocabulary.forEach((term) => {
    const df = (freqA.has(term) ? 1 : 0) + (freqB.has(term) ? 1 : 0);
    const idf = Math.log((2 + 1) / (df + 0.5));
    const a = (freqA.get(term) || 0) * idf;
    const b = (freqB.get(term) || 0) * idf;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  });
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function findEvidence(text, skillLabel) {
  const source = String(text || '');
  if (!source) return '';
  const needle = String(skillLabel || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!needle) return '';
  const pattern = new RegExp(`(^|[^a-z0-9+#])${needle}([^a-z0-9+#]|$)`, 'i');
  const match = pattern.exec(source);
  if (!match) return '';
  const start = Math.max(0, match.index - 70);
  const end = Math.min(source.length, match.index + needle.length + 70);
  return source
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Job analysis                                                         */
/* ------------------------------------------------------------------ */

const DEGREE_WORDS = /\b(b\.?\s?tech|b\.?\s?e\b|be\b|bachelor|b\.?\s?sc|bca|mca|m\.?\s?tech|master|mba|phd|b\.?\s?com|bcom|diploma)\b/gi;

function parseGraduationYears(text) {
  const source = String(text || '');
  const years = new Set();
  // Only years that sit next to graduation wording count as a batch requirement.
  // Bare ranges ("2021 – 2027") are ambiguous and would wrongly make people
  // ineligible, so they are deliberately ignored.
  const patterns = [
    /\b(20\d{2})\s*(?:graduat|passout|pass\s?out|batch|passing)/gi,
    /(?:graduat\w*|batch|passout|passing\s*out|class\s*of)\D{0,25}(20\d{2})/gi,
  ];
  patterns.forEach((pattern) => {
    let match = pattern.exec(source);
    while (match) {
      if (match[1]) years.add(Number(match[1]));
      if (match[2]) years.add(Number(match[2]));
      match = pattern.exec(source);
    }
  });
  return [...years].filter((year) => year >= 2015 && year <= 2035);
}

function parseMinExperience(text) {
  const source = String(text || '').toLowerCase();
  let min = 0;
  const patterns = [
    /(\d+(?:\.\d+)?)\s*\+?\s*(?:to|-|–)\s*(\d+(?:\.\d+)?)\s*years?/,
    /(\d+(?:\.\d+)?)\s*\+\s*years?/,
    /(?:minimum|at least|min\.?)\s*(\d+(?:\.\d+)?)\s*years?/,
    /(\d+(?:\.\d+)?)\s*years?\s*(?:of\s*)?(?:experience|exp)\b/,
  ];
  patterns.forEach((pattern) => {
    const match = pattern.exec(source);
    if (match) min = Math.max(min, Number(match[1]) || 0);
  });
  return min;
}

function looksFresherFriendly(text, structuredExperience) {
  const haystack = `${text || ''} ${structuredExperience || ''}`.toLowerCase();
  return /fresher|entry[- ]level|graduate|intern|trainee|0\s*(?:-|–|to)\s*\d\s*year/.test(haystack);
}

const SKILL_LABELS = Object.fromEntries(
  Object.entries(SYNONYMS).map(([alias, canon]) => [canon, alias]),
);

function prettySkill(canon) {
  const label = SKILL_LABELS[canon] || canon;
  return label
    .split(' ')
    .map((word) => (word.length <= 3 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

function escapePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Detect known skills mentioned anywhere in a block of text. */
function detectSkills(text) {
  const haystack = String(text || '');
  if (!haystack) return [];
  const found = [];
  Object.keys(SYNONYMS).forEach((alias) => {
    if (alias.length < 2) return;
    const pattern = new RegExp(`(^|[^a-z0-9+#])${escapePattern(alias)}([^a-z0-9+#]|$)`, 'i');
    if (!pattern.test(haystack)) return;
    const canon = canonicalSkill(alias);
    if (canon && !found.includes(canon)) found.push(canon);
  });
  return found;
}

const SECTION_REQUIRED = /^(required|requirements?|must[ -]?have|mandatory|qualifications?|eligibility|what you.?ll need)\b/i;
const SECTION_PREFERRED = /^(preferred|good[ -]?to[ -]?have|nice[ -]?to[ -]?have|bonus|plus|additional)\b/i;
const SECTION_OTHER = /^(about|responsibilit|what you.?ll do|benefits|perks|why|team|company|location|stipend|duration|deadline|how to apply)\b/i;

/**
 * Split a free-form JD into "required" and "preferred" blocks and pull skills
 * out of them. Many admin postings arrive without structured skill arrays, so
 * this is what keeps matching honest for those jobs.
 */
function extractSkillsFromDescription(description) {
  const lines = String(description || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s#*•\-]+/, '').trim())
    .filter(Boolean);

  let section = 'none';
  const required = [];
  const preferred = [];

  const push = (target, canon) => {
    if (!canon) return;
    if (!target.includes(canon)) target.push(canon);
  };

  lines.forEach((line) => {
    if (SECTION_REQUIRED.test(line)) { section = 'required'; return; }
    if (SECTION_PREFERRED.test(line)) { section = 'preferred'; return; }
    if (SECTION_OTHER.test(line)) { section = 'other'; return; }

    const detected = detectSkills(line);
    if (!detected.length) return;
    if (section === 'required') detected.forEach((skill) => push(required, skill));
    else if (section === 'preferred') detected.forEach((skill) => push(preferred, skill));
  });

  return { required, preferred };
}

/** Normalise both the backend job shape and the demo job shape. */
export function normalizeJob(job) {
  const source = job || {};
  const filters = source.filters || {};
  let required = source.requiredSkills || source.mustHaveSkills || source.skills || [];
  let preferred = source.preferredSkills || source.goodToHaveSkills || [];
  const description = source.description || '';
  const structuredText = [
    source.title || source.role,
    source.company,
    source.location,
    source.type,
    filters.workMode,
    filters.type,
    filters.experience,
    source.experienceLabel,
    ...(source.qualifications || []),
    ...(source.responsibilities || []),
  ]
    .filter(Boolean)
    .join(' ');
  const fullText = `${structuredText} ${description}`;

  let skillsSource = 'structured';
  if (!required.length && !preferred.length) {
    const extracted = extractSkillsFromDescription(description);
    if (extracted.required.length || extracted.preferred.length) {
      required = extracted.required.map(prettySkill);
      preferred = extracted.preferred.map(prettySkill);
      skillsSource = 'sections';
    } else {
      // Last resort for postings without heading structure: the technical terms
      // that actually appear in the description, capped so noise cannot flood
      // the score. Reported as inferred requirements in the UI.
      const inferred = detectSkills(description).slice(0, 10).map(prettySkill);
      if (inferred.length) {
        required = inferred;
        skillsSource = 'description';
      }
    }
  }

  const gradYears = parseGraduationYears(fullText);
  const minYears = Math.max(
    Number(source.experienceMin) || 0,
    parseMinExperience(fullText),
  );
  const degreeMentions = fullText.match(DEGREE_WORDS) || [];

  return {
    id: String(source.id || `${source.company}-${source.title || source.role}`),
    title: source.title || source.role || 'Role',
    company: source.company || 'Company',
    location: source.location || filters.workMode || '',
    workMode: filters.workMode || '',
    type: source.type || filters.type || '',
    experienceBand: filters.experience || source.experienceLabel || '',
    description,
    fullText,
    requiredSkills: [...new Set(required.filter(Boolean))],
    preferredSkills: [...new Set(preferred.filter(Boolean))],
    skillsSource,
    gradYears,
    minYears,
    fresherFriendly: looksFresherFriendly(description, filters.experience || source.experienceLabel),
    degreeMentions: [...new Set(degreeMentions.map((item) => item.trim()))],
    tokens: tokenize(fullText),
  };
}

export function jobVersion(job) {
  const normalized = normalizeJob(job);
  return hashString(
    [
      normalized.id,
      normalized.title,
      normalized.company,
      normalized.fullText,
      normalized.requiredSkills.join(','),
      normalized.preferredSkills.join(','),
      normalized.gradYears.join(','),
      normalized.minYears,
    ].join('|'),
  );
}

/* ------------------------------------------------------------------ */
/* User evidence                                                        */
/* ------------------------------------------------------------------ */

const DEGREE_LEVEL = {
  phd: 5,
  doctorate: 5,
  mtech: 4,
  mba: 4,
  master: 4,
  mca: 4,
  btech: 3,
  be: 3,
  bsc: 3,
  bachelor: 3,
  bca: 3,
  bcom: 3,
  diploma: 2,
};

function degreeLevel(value) {
  const text = String(value || '').toLowerCase().replace(/[.\s]/g, '');
  const key = Object.keys(DEGREE_LEVEL).find((item) => text.includes(item));
  return key ? DEGREE_LEVEL[key] : 0;
}

function parseYears(duration) {
  const text = String(duration || '').toLowerCase();
  if (!text) return 0;
  const numbers = (text.match(/\d+(\.\d+)?/g) || []).map(Number);
  if (numbers.length >= 2 && numbers[1] > 1900) {
    return Math.max(0, numbers[1] - numbers[0]);
  }
  if (/year/.test(text) && numbers.length) return numbers[0];
  if (/month/.test(text) && numbers.length) return numbers[0] / 12;
  return 0;
}

/** Build the evidence document for one user from profile + resume text. */
export function buildUserEvidence(profile, resume) {
  const safeProfile = profile || {};
  const resumeText = String(resume?.text || safeProfile.resumeText || '');

  const skills = (safeProfile.skills || [])
    .map((skill) => (typeof skill === 'string' ? skill : skill?.name))
    .filter(Boolean);

  const education = (safeProfile.education || []).map((item) => ({
    institution: item.institution || '',
    degree: item.degree || '',
    branch: item.branch || '',
    graduationYear: Number(String(item.graduationYear || '').match(/\d{4}/)?.[0]) || null,
    cgpa: item.cgpa || '',
  }));

  const experience = (safeProfile.experience || []).map((item) => ({
    title: item.title || '',
    company: item.company || '',
    duration: item.duration || '',
    description: item.description || '',
    text: [item.title, item.company, item.duration, item.description].filter(Boolean).join(' '),
    years: parseYears(item.duration),
  }));

  const projects = (safeProfile.projects || []).map((item) => ({
    title: item.title || '',
    technologies: item.technologies || '',
    description: item.description || '',
    text: [item.title, item.technologies, item.description].filter(Boolean).join(' '),
  }));

  const profileText = [
    safeProfile.fullName,
    safeProfile.location,
    safeProfile.summary,
    ...skills,
    ...education.map((item) => `${item.degree} ${item.branch} ${item.institution} ${item.graduationYear || ''}`),
    ...experience.map((item) => item.text),
    ...projects.map((item) => item.text),
  ]
    .filter(Boolean)
    .join('\n');

  const evidenceText = `${profileText}\n${resumeText}`;
  const graduationYears = education.map((item) => item.graduationYear).filter(Boolean);
  const declaredYears = Number(safeProfile.yearsOfExperience) || 0;
  const computedYears = experience.reduce((sum, item) => sum + (item.years || 0), 0);

  return {
    skills,
    skillCanon: skills.map(canonicalSkill).filter(Boolean),
    education,
    experience,
    projects,
    resumeText,
    evidenceText,
    tokens: tokenize(evidenceText),
    graduationYear: graduationYears.length ? Math.max(...graduationYears) : null,
    graduationYears,
    yearsOfExperience: Math.max(declaredYears, Math.round(computedYears * 10) / 10),
    location: safeProfile.location || '',
  };
}

/* ------------------------------------------------------------------ */
/* Readiness                                                            */
/* ------------------------------------------------------------------ */

export const PROFILE_TODO = {
  profile: 'Add your profile details',
  skills: 'Add your technical skills',
  education: 'Add your degree and branch',
  graduationYear: 'Add your graduation year',
  evidence: 'Add at least one project or work experience',
  resume: 'Upload your resume',
};

/**
 * Which pieces of evidence are required before any score can be honest.
 * Nothing is assumed: a missing dimension blocks scoring instead of guessing.
 */
export function getProfileReadiness(profile, resume) {
  const evidence = buildUserEvidence(profile, resume);
  const missing = [];

  if (!profile) missing.push('profile');
  if (evidence.skills.length === 0) missing.push('skills');
  if (!evidence.education.some((item) => item.degree || item.branch)) missing.push('education');
  if (!evidence.education.some((item) => item.graduationYear)) missing.push('graduationYear');
  const hasEvidence =
    evidence.projects.some((item) => item.description || item.technologies) ||
    evidence.experience.some((item) => item.description || item.title);
  if (!hasEvidence) missing.push('evidence');
  if (!evidence.resumeText.trim() && !(profile && profile.resume)) missing.push('resume');

  return {
    ready: missing.length === 0,
    missing,
    missingLabels: missing.map((key) => PROFILE_TODO[key] || key),
    evidence,
  };
}

/* ------------------------------------------------------------------ */
/* Scoring                                                              */
/* ------------------------------------------------------------------ */

const DEFAULT_WEIGHTS = {
  required: 0.38,
  preferred: 0.14,
  experience: 0.14,
  projects: 0.14,
  education: 0.1,
  domain: 0.1,
};

const WEIGHT_LABELS = {
  required: 'Required skills',
  preferred: 'Preferred skills',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  domain: 'Domain alignment',
};

function matchSkillEntry(jobSkill, evidence) {
  const canon = canonicalSkill(jobSkill);
  const declared = evidence.skillCanon.includes(canon);
  const resumeSnippet = findEvidence(evidence.resumeText, jobSkill);
  const profileSnippet = findEvidence(
    evidence.evidenceText.replace(evidence.resumeText, ''),
    jobSkill,
  );
  const snippet = resumeSnippet || profileSnippet;

  // Fuzzy containment ("REST APIs" vs "REST API", "Node" vs "Node.js") is
  // handled through canonicalisation; substring containment covers labels
  // like "Data Structures & Algorithms".
  let contained = false;
  if (!declared && canon) {
    contained = evidence.skillCanon.some(
      (userSkill) => userSkill && (userSkill.includes(canon) || canon.includes(userSkill)),
    );
  }

  const matched = declared || Boolean(snippet) || contained;
  let strength = 0;
  if (declared) strength = 1;
  else if (resumeSnippet) strength = 0.8;
  else if (profileSnippet) strength = 0.7;

  return {
    skill: jobSkill,
    matched,
    strength,
    via: declared ? 'skills' : resumeSnippet ? 'resume' : profileSnippet ? 'profile' : contained ? 'related' : null,
    evidence: snippet || '',
  };
}

function relevanceOfItem(itemText, jobTokens, jobSkillCanon, evidence) {
  const tokens = tokenize(itemText);
  if (!tokens.length) return { relevance: 0, matchedSkills: [] };
  const matchedSkills = jobSkillCanon.filter((skill) =>
    evidence.skillCanon.includes(skill) &&
    (tokens.includes(skill) || tokens.some((token) => token.includes(skill) || skill.includes(token))),
  );
  const coverage = jobSkillCanon.length ? matchedSkills.length / jobSkillCanon.length : 0;
  const similarity = cosine(tokens, jobTokens);
  return { relevance: Math.min(1, coverage * 0.6 + Math.min(1, similarity) * 0.4), matchedSkills };
}

export function scoreJobMatch(profile, job, options = {}) {
  const resume = options.resume !== undefined ? options.resume : getActiveResume();
  const readiness = getProfileReadiness(profile, resume);
  const normalized = normalizeJob(job);
  const now = new Date().toISOString();

  if (!readiness.ready) {
    return {
      status: 'incomplete',
      score: null,
      explanation: 'Complete Your Profile to Calculate Match Score',
      missingProfile: readiness.missing,
      missingProfileLabels: readiness.missingLabels,
      matched: [],
      missing: [],
      job: { id: normalized.id, title: normalized.title, company: normalized.company },
      computedAt: now,
    };
  }

  const evidence = readiness.evidence;
  const jobSkillCanon = [...normalized.requiredSkills, ...normalized.preferredSkills]
    .map(canonicalSkill)
    .filter(Boolean);

  /* 1. Skills ------------------------------------------------------- */
  const requiredMatches = normalized.requiredSkills.map((skill) => matchSkillEntry(skill, evidence));
  const preferredMatches = normalized.preferredSkills.map((skill) => matchSkillEntry(skill, evidence));

  const requiredScore = requiredMatches.length
    ? requiredMatches.reduce((sum, item) => sum + item.strength, 0) / requiredMatches.length
    : null;
  const preferredScore = preferredMatches.length
    ? preferredMatches.reduce((sum, item) => sum + item.strength, 0) / preferredMatches.length
    : null;

  /* 2. Experience --------------------------------------------------- */
  let experienceScore = null;
  if (normalized.minYears > 0) {
    experienceScore = Math.min(1, evidence.yearsOfExperience / normalized.minYears);
  } else if (normalized.fresherFriendly) {
    experienceScore = evidence.yearsOfExperience > 0 ? 1 : 0.9;
  } else if (evidence.experience.length) {
    const best = Math.max(
      ...evidence.experience.map(
        (item) => relevanceOfItem(item.text, normalized.tokens, jobSkillCanon, evidence).relevance,
      ),
    );
    experienceScore = Math.min(1, best);
  }

  /* 3. Projects ----------------------------------------------------- */
  const projectScored = evidence.projects
    .map((project) => ({
      title: project.title || 'Project',
      technologies: project.technologies,
      ...relevanceOfItem(project.text, normalized.tokens, jobSkillCanon, evidence),
    }))
    .sort((a, b) => b.relevance - a.relevance);
  const projectsScore = projectScored.length
    ? projectScored
        .slice(0, 2)
        .reduce((sum, item) => sum + item.relevance, 0) / Math.min(2, projectScored.length)
    : null;

  const experienceScored = evidence.experience
    .map((item) => ({
      title: item.title || 'Experience',
      company: item.company,
      ...relevanceOfItem(item.text, normalized.tokens, jobSkillCanon, evidence),
    }))
    .sort((a, b) => b.relevance - a.relevance);

  /* 4. Education ---------------------------------------------------- */
  let educationScore = null;
  let educationReason = '';
  if (evidence.education.length) {
    const jobDegreeLevel = Math.max(
      0,
      ...normalized.degreeMentions.map((mention) => degreeLevel(mention)),
    );
    const candidateLevel = Math.max(
      0,
      ...evidence.education.map((item) => degreeLevel(`${item.degree} ${item.branch}`)),
    );
    const branchTokens = tokenize(evidence.education.map((item) => `${item.degree} ${item.branch}`).join(' '));
    const branchSimilarity = cosine(branchTokens, normalized.tokens);
    const levelFit = jobDegreeLevel === 0 ? 0.85 : candidateLevel >= jobDegreeLevel ? 1 : candidateLevel === jobDegreeLevel - 1 ? 0.6 : 0.3;
    educationScore = Math.min(1, levelFit * 0.7 + Math.min(1, branchSimilarity * 2) * 0.3);
    educationReason =
      jobDegreeLevel === 0
        ? 'Job description does not mandate a specific degree level.'
        : levelFit === 1
          ? 'Your degree level meets the requirement.'
          : 'Your degree level is below what the description asks for.';
  }

  /* 5. Domain alignment --------------------------------------------- */
  const domainScore = Math.min(1, cosine(evidence.tokens, normalized.tokens) * 1.6);

  /* 6. Weighted total ----------------------------------------------- */
  const jobWeights = (job && job.matchWeights) || {};
  const candidates = {
    required: { score: requiredScore, weight: jobWeights.required ?? DEFAULT_WEIGHTS.required },
    preferred: { score: preferredScore, weight: jobWeights.preferred ?? DEFAULT_WEIGHTS.preferred },
    experience: { score: experienceScore, weight: jobWeights.experience ?? DEFAULT_WEIGHTS.experience },
    projects: { score: projectsScore, weight: jobWeights.projects ?? DEFAULT_WEIGHTS.projects },
    education: { score: educationScore, weight: jobWeights.education ?? DEFAULT_WEIGHTS.education },
    domain: { score: domainScore, weight: jobWeights.domain ?? DEFAULT_WEIGHTS.domain },
  };

  const activeDims = Object.entries(candidates).filter(
    ([, value]) => value.score !== null && value.score !== undefined && value.weight > 0,
  );
  const totalWeight = activeDims.reduce((sum, [, value]) => sum + value.weight, 0) || 1;
  const rawScore = activeDims.reduce((sum, [, value]) => sum + value.score * value.weight, 0) / totalWeight;

  /* 7. Mandatory eligibility (kept separate from the skills score) --- */
  const checks = [];
  let eligible = true;

  if (normalized.gradYears.length) {
    const year = evidence.graduationYear;
    const pass = year !== null && normalized.gradYears.includes(year);
    if (!pass) eligible = false;
    checks.push({
      label: 'Graduation year',
      status: pass ? 'pass' : 'fail',
      detail: year
        ? `Job targets ${normalized.gradYears.join(' / ')} graduates — you graduate in ${year}.`
        : `Job targets ${normalized.gradYears.join(' / ')} graduates — your graduation year is missing.`,
      mandatory: true,
    });
  } else {
    checks.push({ label: 'Graduation year', status: 'unknown', detail: 'No graduation batch specified in the job description.', mandatory: false });
  }

  if (normalized.minYears > 0) {
    const pass = evidence.yearsOfExperience + 0.01 >= normalized.minYears;
    if (!pass) eligible = false;
    checks.push({
      label: 'Experience',
      status: pass ? 'pass' : 'fail',
      detail: pass
        ? `Requires ${normalized.minYears}+ year(s); you have ${evidence.yearsOfExperience} year(s).`
        : `Requires ${normalized.minYears}+ year(s); your profile shows ${evidence.yearsOfExperience} year(s).`,
      mandatory: true,
    });
  } else {
    checks.push({
      label: 'Experience',
      status: 'pass',
      detail: normalized.fresherFriendly
        ? 'Open to freshers — no minimum experience required.'
        : 'No minimum experience stated.',
      mandatory: false,
    });
  }

  const degreeRequiredText = /must have|required|mandatory/i.test(normalized.description) &&
    normalized.degreeMentions.length > 0;
  if (normalized.degreeMentions.length) {
    const jobDegreeLevel = Math.max(0, ...normalized.degreeMentions.map(degreeLevel));
    const candidateLevel = Math.max(0, ...evidence.education.map((item) => degreeLevel(`${item.degree} ${item.branch}`)));
    const pass = jobDegreeLevel === 0 || candidateLevel >= jobDegreeLevel;
    if (!pass && degreeRequiredText) eligible = false;
    checks.push({
      label: 'Degree',
      status: pass ? 'pass' : degreeRequiredText ? 'fail' : 'warn',
      detail: pass
        ? `${evidence.education[0]?.degree || 'Your degree'} meets the stated qualification.`
        : `Job asks for ${normalized.degreeMentions.slice(0, 2).join(' / ')}; your profile lists ${evidence.education[0]?.degree || 'a different degree'}.`,
      mandatory: degreeRequiredText,
    });
  }

  /* 8. Explainability ----------------------------------------------- */
  const matchedSkills = requiredMatches.filter((item) => item.matched);
  const missingSkills = requiredMatches.filter((item) => !item.matched);
  const matchedPreferred = preferredMatches.filter((item) => item.matched);
  const missingPreferred = preferredMatches.filter((item) => !item.matched);

  const score = Math.round(Math.max(0, Math.min(100, rawScore * 100)));

  const reasons = [];
  if (!normalized.requiredSkills.length) {
    reasons.push('This job description lists no explicit required skills, so the score reflects domain alignment, education and experience only.');
  } else if (normalized.skillsSource === 'description') {
    reasons.push('The posting had no structured skills section, so requirements were inferred from the technical terms in the description.');
  } else if (normalized.skillsSource === 'sections') {
    reasons.push('Requirements were read from the required/preferred sections of the description.');
  }
  if (requiredMatches.length) {
    reasons.push(
      `Matched ${matchedSkills.length}/${requiredMatches.length} required skills` +
        (matchedSkills.length ? `: ${matchedSkills.slice(0, 5).map((item) => item.skill).join(', ')}` : '.'),
    );
  }
  if (missingSkills.length) {
    reasons.push(`Missing required skills: ${missingSkills.slice(0, 5).map((item) => item.skill).join(', ')}.`);
  }
  if (normalized.preferredSkills.length) {
    reasons.push(`Matched ${matchedPreferred.length}/${normalized.preferredSkills.length} preferred skills.`);
  }
  if (projectsScore !== null && projectScored[0]) {
    reasons.push(
      projectScored[0].relevance > 0.05
        ? `Most relevant project: ${projectScored[0].title} (${Math.round(projectScored[0].relevance * 100)}% overlap with the JD).`
        : 'None of your projects overlap with this job description yet.',
    );
  }
  if (educationReason) reasons.push(educationReason);
  if (!eligible) reasons.push('Mandatory eligibility requirements are not met.');

  const suggestions = [];
  missingSkills.slice(0, 3).forEach((item) => {
    suggestions.push(`Add hands-on evidence of ${item.skill} (project, internship or certification) to your resume.`);
  });
  if (missingPreferred.length) {
    suggestions.push(`Nice-to-have skills to build next: ${missingPreferred.slice(0, 3).map((item) => item.skill).join(', ')}.`);
  }
  if (!eligible) {
    const blocker = checks.find((check) => check.status === 'fail');
    if (blocker) suggestions.push(`Eligibility: ${blocker.detail}`);
  }
  if (projectsScore !== null && projectsScore < 0.25) {
    suggestions.push('Tailor a project description to this role’s stack so the overlap is visible to reviewers.');
  }
  if (normalized.location && evidence.location) {
    const jobPlace = normalized.location.toLowerCase();
    const userPlace = evidence.location.toLowerCase();
    if (jobPlace && userPlace && !jobPlace.includes(userPlace.split(',')[0]) && !userPlace.includes(jobPlace.split(',')[0]) && normalized.workMode.toLowerCase() !== 'remote') {
      suggestions.push(`Role location (${normalized.location}) differs from your profile location (${evidence.location}).`);
    }
  }
  if (!suggestions.length) suggestions.push('Your profile already covers this role well — focus on the application and referral outreach.');

  const breakdown = activeDims.map(([key, value]) => ({
    key,
    label: WEIGHT_LABELS[key],
    score: Math.round(value.score * 100),
    weight: Math.round((value.weight / totalWeight) * 100),
  }));

  return {
    status: eligible ? 'scored' : 'ineligible',
    score,
    explanation:
      reasons[0] ||
      `Scored from ${matchedSkills.length} matched skills and your profile evidence.`,
    matched: matchedSkills.map((item) => item.skill),
    missing: missingSkills.map((item) => item.skill),
    breakdown,
    weights: Object.fromEntries(activeDims.map(([key, value]) => [key, value.weight / totalWeight])),
    matchedSkills,
    missingSkills,
    matchedPreferred,
    missingPreferred,
    relevantProjects: projectScored
      .filter((item) => item.relevance > 0)
      .slice(0, 3)
      .map((item) => ({ ...item, matchedSkills: (item.matchedSkills || []).map(prettySkill) })),
    relevantExperience: experienceScored
      .filter((item) => item.relevance > 0)
      .slice(0, 3)
      .map((item) => ({ ...item, matchedSkills: (item.matchedSkills || []).map(prettySkill) })),
    education: {
      score: educationScore === null ? null : Math.round(educationScore * 100),
      degree: evidence.education[0] ? `${evidence.education[0].degree} ${evidence.education[0].branch}`.trim() : '',
      graduationYear: evidence.graduationYear,
      reason: educationReason,
    },
    eligibility: { eligible, checks },
    reasons,
    suggestions,
    evidenceStats: {
      skills: evidence.skills.length,
      projects: evidence.projects.length,
      experience: evidence.experience.length,
      yearsOfExperience: evidence.yearsOfExperience,
      resumeChars: evidence.resumeText.length,
    },
    job: {
      id: normalized.id,
      title: normalized.title,
      company: normalized.company,
      skillsSource: normalized.skillsSource,
      requiredSkills: normalized.requiredSkills,
      gradYears: normalized.gradYears,
    },
    computedAt: now,
  };
}

/* ------------------------------------------------------------------ */
/* Cached entry points                                                  */
/* ------------------------------------------------------------------ */

export function cacheKeyFor(userId, job, profile, resume) {
  return [
    userId || 'anon',
    jobVersion(job),
    profileVersion(profile),
    resumeVersion(resume),
  ].join('::');
}

/**
 * Cached personalised score. The cache key includes the job version, profile
 * version and resume version, so any edit to any of the three produces a new
 * key and a fresh calculation.
 */
export function getJobMatchScore(profile, job, options = {}) {
  const resume = options.resume !== undefined ? options.resume : getActiveResume();
  const userId = options.userId || 'anon';
  const key = cacheKeyFor(userId, job, profile, resume);
  const cache = readCache();
  const hit = cache[key];
  if (hit && hit.result && hit.result.status) {
    return { ...hit.result, cached: true };
  }
  const result = scoreJobMatch(profile, job, { resume });
  cache[key] = { at: Date.now(), result };
  writeCache(cache);
  return { ...result, cached: false };
}

export function scoreJobs(profile, jobs, options = {}) {
  const resume = options.resume !== undefined ? options.resume : getActiveResume();
  return (jobs || []).map((job) => ({
    ...job,
    matchResult: getJobMatchScore(profile, job, { resume, userId: options.userId }),
  }));
}
