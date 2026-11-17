// Pure helpers for external-job tailoring. Keep these independent of the web route
// so extraction and scoring remain deterministic and testable.
const CATALOG = [
  ['AI', ['ai', 'artificial intelligence']], ['C', ['c']], ['C#', ['c#', 'c sharp']],
  ['C++', ['c++', 'cpp'] ], ['.NET', ['.net', 'dotnet']], ['R', ['r']], ['Go', ['go', 'golang']],
  ['Java', ['java']], ['JavaScript', ['javascript', 'js']], ['TypeScript', ['typescript', 'ts']],
  ['Python', ['python']], ['SQL', ['sql']], ['React', ['react', 'reactjs']], ['Node.js', ['node.js', 'nodejs']],
  ['AWS', ['aws']], ['Azure', ['azure']], ['GCP', ['gcp', 'google cloud']], ['Docker', ['docker']],
  ['Kubernetes', ['kubernetes', 'k8s']], ['Git', ['git']], ['HTML', ['html']], ['CSS', ['css']],
  ['REST', ['rest', 'restful']], ['GraphQL', ['graphql']], ['MongoDB', ['mongodb']], ['PostgreSQL', ['postgresql', 'postgres']],
  ['Machine Learning', ['machine learning', 'ml']], ['Data Analysis', ['data analysis', 'analytics']],
  ['Agile', ['agile']], ['CI/CD', ['ci/cd', 'continuous integration']], ['Microservices', ['microservices']],
  ['Object-Oriented Programming (OOP)', ['object-oriented programming', 'object oriented programming', 'oop']],
  ['Object-Oriented Design', ['object-oriented design', 'object oriented design']],
  ['Data Structures and Algorithms (DSA)', ['data structures and algorithms', 'data structures', 'algorithms']],
  ['Operating Systems', ['operating systems', 'operating system']], ['TCP/IP', ['tcp/ip', 'tcp ip']], ['UDP/IP', ['udp/ip', 'udp ip']],
  ['Software Development', ['software development']], ['Application Development', ['application development']], ['API Integration', ['api integration']],
  ['Debugging', ['debugging']], ['Troubleshooting', ['troubleshooting']], ['Performance Optimization', ['performance optimization']],
  ['Testing', ['testing', 'software testing']], ['Version Control', ['version control']], ['Problem-Solving', ['problem-solving', 'problem solving']],
  ['Communication / Teamwork', ['communication', 'teamwork', 'collaboration']], ['IoT', ['iot', 'internet of things']],
  ['Embedded Software', ['embedded software']], ['Embedded Systems', ['embedded systems']], ['Wireless Technologies', ['wireless technologies', 'wireless communication']],
  ['Real-Time Software', ['real-time software', 'real time software']], ['Systems Programming', ['systems programming']], ['Network Protocols', ['network protocols']],
  ['Software Architecture', ['software architecture']], ['Analytical Skills', ['analytical skills']], ['Linux/UNIX', ['linux/unix', 'linux', 'unix']],
  ['Real-Time Embedded Software', ['real-time embedded software', 'real time embedded software']], ['Device Drivers', ['device drivers', 'device driver']],
  ['Linux Drivers', ['linux drivers']], ['Linux Kernel Development', ['linux kernel development', 'linux kernel']], ['Board Support Packages (BSP)', ['board support packages', 'bsp']],
  ['Firmware Development', ['firmware development', 'firmware']], ['Embedded Platforms', ['embedded platforms']], ['Android Platform Development', ['android platform development', 'android']],
  ['Operating System Internals', ['operating system internals']], ['4G / LTE', ['4g', 'lte']], ['CDMA / GSM / UMTS', ['cdma', 'gsm', 'umts']],
  ['Wi-Fi', ['wi-fi', 'wifi']], ['Bluetooth', ['bluetooth']], ['Wireless Modem Development', ['wireless modem development']], ['Communication Protocol Stack', ['communication protocol stack']],
  ['SIP', ['sip']], ['RTP', ['rtp']], ['Self-Organizing Networks', ['self-organizing networks', 'self organizing networks']],
  ['Audio Codecs', ['audio codecs', 'audio codec']], ['Video Codecs', ['video codecs', 'video codec']], ['Image Processing', ['image processing']],
  ['Multimedia Software Stack', ['multimedia software stack']], ['Camera Firmware', ['camera firmware']], ['Connected Cameras', ['connected cameras']],
  ['Virtual Reality (VR)', ['virtual reality', 'vr']], ['Augmented Reality (AR)', ['augmented reality', 'ar']], ['Smart Assistant Platforms', ['smart assistant platforms']],
  ['Drone Software', ['drone software']], ['Memory Management', ['memory management']], ['Multithreading / Concurrency', ['multithreading', 'multi-threading', 'concurrency']],
  ['Synchronization', ['synchronization']], ['Inter-Process Communication (IPC)', ['inter-process communication', 'ipc']], ['CPU / Hardware Architecture', ['cpu architecture', 'hardware architecture']],
  ['Software Architecture for Embedded Devices', ['software architecture for embedded devices']], ['Written and Verbal Communication', ['written communication', 'verbal communication']],
  ['Collaborative Engineering', ['collaborative engineering']]
  ,['HR Support', ['hr support', 'human resources support']], ['Recruiting Coordination', ['recruiting coordination', 'recruitment coordination']],
  ['Employee Documentation', ['employee documentation']], ['HRIS Administration', ['hris administration', 'hris']],
  ['Benefits Administration', ['benefits administration']], ['Process Improvement', ['process improvement']], ['Audit Readiness', ['audit readiness']],
  ['GDPR Awareness', ['gdpr awareness', 'gdpr']], ['Payroll', ['payroll']], ['Verbal and Written Communication', ['verbal and written communication', 'written and verbal communication']],
  ['Interpersonal Skills', ['interpersonal skills']], ['Stakeholder Coordination', ['stakeholder coordination']], ['Cross-functional Teamwork', ['cross-functional teamwork', 'cross functional teamwork']],
  ['Remote Collaboration', ['remote collaboration']], ['Process Optimization', ['process optimization']], ['Time Management', ['time management']],
  ['Workload Prioritization', ['workload prioritization']], ['Results-Oriented Execution', ['results-oriented execution', 'results oriented execution']],
  ['Agile Methodology', ['agile methodology']], ['Project Coordination', ['project coordination']], ['Continuous Improvement', ['continuous improvement']],
  ['Data Accuracy', ['data accuracy']], ['Data Validation', ['data validation']], ['Document Management', ['document management']],
  ['Software Applications', ['software applications']], ['API Testing', ['api testing']], ['Database Management', ['database management']],
  ['CI/CD Workflows', ['ci/cd workflows', 'ci cd workflows']], ['Confidentiality', ['confidentiality']], ['Integrity', ['integrity']],
  ['Adaptability', ['adaptability']], ['Self-Motivation', ['self-motivation', 'self motivation']], ['Attention to Detail', ['attention to detail']],
  ['Compliance Awareness', ['compliance awareness']], ['High Work Ethic', ['high work ethic']], ['Team Collaboration', ['team collaboration']]
];

function text(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function decodeJsonLd(raw) {
  try { return JSON.parse(String(raw).replace(/&quot;/g, '"').replace(/&#39;/g, "'")); } catch { return null; }
}
function jsonLdObjects(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(jsonLdObjects);
  if (typeof value !== 'object') return [];
  return [value, ...(Array.isArray(value['@graph']) ? value['@graph'].flatMap(jsonLdObjects) : [])];
}
function stripHtml(value) { return text(String(value || '').replace(/<[^>]*>/g, ' ')); }
function isJobPosting(item) { return String(item?.['@type'] || '').toLowerCase().split(/\s+/).includes('jobposting'); }

export function extractJobPostingJsonLd(html) {
  const candidates = [];
  for (const match of String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const item of jsonLdObjects(decodeJsonLd(match[1]))) if (isJobPosting(item)) candidates.push(item);
  }
  const item = candidates[0];
  if (!item) return null;
  const company = typeof item.hiringOrganization === 'object' ? item.hiringOrganization.name : item.hiringOrganization;
  const description = stripHtml(item.description);
  const title = text(item.title || item.name);
  if (!title || !company || description.length < 80) return null;
  return { title, company: text(company), description };
}

export function validateJobDescription({ title, company, description } = {}) {
  const body = text(description);
  if (body.length < 80) throw new Error('The job description is missing or too short. Paste the complete responsibilities and requirements.');
  if (/^(home|sign in|log in|careers|job search|cookie|access denied|untitled)$/i.test(text(title)) || /access denied|enable javascript|subscribe to continue|buy now|free trial|awswaf|challenge-container|not a robot|captcha/i.test(body.slice(0, 1000))) {
    throw new Error('That page is not a usable job posting. Paste the job description and role title.');
  }
  return { title: text(title) || 'Target role', company: text(company) || 'Target company', description: body };
}

export function keywordsFromJob(description) {
  const body = String(description || '');
  return CATALOG.filter(([, aliases]) => aliases.some((alias) => new RegExp(`(^|[^a-z0-9+#])${alias.replace(/[.+]/g, '\\$&')}(?=$|[^a-z0-9+#])`, 'i').test(body))).map(([name]) => name);
}
function aliasesFor(canonical) {
  return CATALOG.find(([name]) => name === canonical)?.[1] || [canonical];
}
function aliasPattern(alias) {
  return new RegExp(`(^|[^a-z0-9+#])${String(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9+#])`, 'i');
}
export function keywordMatches(body, canonical) {
  const value = String(body || '');
  return aliasesFor(canonical).some((alias) => aliasPattern(alias).test(value));
}
function matchingAlias(body, canonical) {
  const value = String(body || '');
  return aliasesFor(canonical).find((alias) => aliasPattern(alias).test(value)) || '';
}
function hasAlias(body, canonical) {
  return keywordMatches(body, canonical);
}
function hasPartial(body, canonical) {
  const aliases = aliasesFor(canonical);
  return aliases.some((alias) => {
    const words = alias.split(/\s+/).filter((word) => word.length > 3);
    return words.length > 1 && words.filter((word) => body.toLowerCase().includes(word.toLowerCase())).length >= Math.ceil(words.length / 2);
  });
}
export function calculateKeywordCoverage(jobKeywords, beforeText, afterText) {
  const keywords = [...new Set((jobKeywords || []).map(String).filter((key) => CATALOG.some(([name]) => name === key)))];
  const before = String(beforeText || ''), after = String(afterText || '');
  const matchedBefore = keywords.filter((key) => hasAlias(before, key));
  const matchedAfter = keywords.filter((key) => hasAlias(after, key));
  const partialBefore = keywords.filter((key) => !matchedBefore.includes(key) && hasPartial(before, key));
  const partialAfter = keywords.filter((key) => !matchedAfter.includes(key) && hasPartial(after, key));
   // A partial match is its own state. Do not also label it Missing or Removed
   // in the aggregate arrays; the UI uses these arrays for the status pills.
   const missing = keywords.filter((key) => !matchedAfter.includes(key) && !partialAfter.includes(key));
  const evidence = Object.fromEntries(keywords.map((key) => {
    const snippet = (body, present) => {
      if (!present) return '';
      const alias = matchingAlias(body, key);
      const index = alias ? body.toLowerCase().indexOf(alias.toLowerCase()) : -1;
      return index < 0 ? '' : body.slice(Math.max(0, index - 40), index + alias.length + 80);
    };
    return [key, { before: snippet(before, matchedBefore.includes(key)), after: snippet(after, matchedAfter.includes(key)) }];
  }));
  const score = (exact, partial) => {
    if (!keywords.length) return 0;
    // A keyword-only comparison is an estimate, never an employer ATS result.
    // Keep a visible uncertainty margin so a perfect keyword overlap cannot be
    // misrepresented as a guaranteed 100% match.
    return Math.min(97, Math.round((exact + partial * 0.5) / keywords.length * 100));
  };
  return { scoringVersion: 'keyword-coverage-v2', scoreCap: 97, requirementsCount: keywords.length, jobKeywords: keywords, evidence,
    matchedKeywordsBefore: matchedBefore, matchedKeywordsAfter: matchedAfter, matchedKeywords: matchedAfter,
    partialKeywordsBefore: partialBefore, partialKeywordsAfter: partialAfter,
    addedKeywords: matchedAfter.filter((key) => !matchedBefore.includes(key)),
     removedKeywords: matchedBefore.filter((key) => !matchedAfter.includes(key) && !partialAfter.includes(key)), missingKeywords: missing,
    beforeScore: score(matchedBefore.length, partialBefore.length),
    afterScore: score(matchedAfter.length, partialAfter.length),
    hasRequirements: keywords.length > 0 };
}

/**
 * Close a JSON document that a model cut short: drop the incomplete trailing
 * element, then append the brackets that are still open.
 */
function closeOpenJson(text) {
  const source = String(text || '');
  const stack = [];
  let inString = false;
  let escaped = false;
  let lastSafe = -1;
  let lastSafeStack = '';

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{' || char === '[') { stack.push(char); continue; }
    if (char === '}' || char === ']') { stack.pop(); continue; }
    if (char === ',' && stack.length) {
      // Everything before this comma is complete; remember where to cut back to.
      lastSafe = index;
      lastSafeStack = stack.join('');
    }
  }

  const closers = (open) => [...open].reverse().map((char) => (char === '{' ? '}' : ']')).join('');
  const trimmed = source.replace(/[\s,]*$/, '');
  if (!inString && !stack.length) return trimmed;
  if (lastSafe > 0) return `${source.slice(0, lastSafe)}${closers(lastSafeStack)}`;
  return trimmed ? `${trimmed}${closers(stack.join(''))}` : '';
}

/**
 * Parse a model reply that should be JSON. Handles stray control characters,
 * trailing commas and replies that were truncated before the closing braces.
 */
export function parseModelJson(raw) {
  const text = String(raw || '');
  const start = text.indexOf('{');
  if (start < 0) throw new Error('The model did not return JSON.');
  const body = text.slice(start);
  const candidates = [body, body.slice(0, body.lastIndexOf('}') + 1)];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* try a cleaned copy */ }
    const cleaned = candidate
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
      .replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(cleaned); } catch { /* try to close it */ }
  }

  const salvaged = closeOpenJson(body);
  if (salvaged) {
    try { return JSON.parse(salvaged); } catch { /* fall through */ }
  }
  throw new Error('The model returned malformed JSON.');
}

export function validateTailoredResume(value, evidence = '') {
  if (!value || typeof value !== 'object' || typeof value.summary !== 'string' || !Array.isArray(value.skills)) throw new Error('The tailoring model returned an invalid resume. Please retry.');
  for (const key of ['internships', 'projects', 'education', 'extras']) if (value[key] !== undefined && !Array.isArray(value[key])) throw new Error(`The tailoring model returned invalid ${key} data.`);
  // Some models answer with `experience` instead of `internships`, or send an
  // empty `internships` plus a filled `experience`. Accept both so the section
  // is never dropped from the rendered resume.
  const experience = Array.isArray(value.experience) ? value.experience : [];
  if (!Array.isArray(value.internships) || !value.internships.length) {
    if (experience.length) value.internships = experience;
  }
  if (value.experience !== undefined) delete value.experience;
  // Skill verification removed — aggressive JD-aligned tailoring adds all
  // required keywords even if not explicitly present in the original resume.
  return value;
}
