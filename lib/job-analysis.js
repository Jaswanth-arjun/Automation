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
  if (/^(home|sign in|log in|careers|job search|cookie|access denied|untitled)$/i.test(text(title)) || /access denied|enable javascript|subscribe to continue|buy now|free trial/i.test(body.slice(0, 500))) {
    throw new Error('That page is not a usable job posting. Paste the job description and role title.');
  }
  return { title: text(title) || 'Target role', company: text(company) || 'Target company', description: body };
}

export function keywordsFromJob(description) {
  const body = String(description || '');
  return CATALOG.filter(([, aliases]) => aliases.some((alias) => new RegExp(`(^|[^a-z0-9+#])${alias.replace(/[.+]/g, '\\$&')}(?=$|[^a-z0-9+#])`, 'i').test(body))).map(([name]) => name);
}
function hasAlias(body, canonical) {
  const aliases = CATALOG.find(([name]) => name === canonical)?.[1] || [canonical];
  return aliases.some((alias) => new RegExp(`(^|[^a-z0-9+#])${alias.replace(/[.+]/g, '\\$&')}(?=$|[^a-z0-9+#])`, 'i').test(body));
}
function hasPartial(body, canonical) {
  const aliases = CATALOG.find(([name]) => name === canonical)?.[1] || [canonical];
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
  const missing = keywords.filter((key) => !matchedAfter.includes(key));
  const evidence = Object.fromEntries(keywords.map((key) => {
    const snippet = (body, present) => { if (!present) return ''; const index = body.toLowerCase().indexOf((CATALOG.find(([name]) => name === key)?.[1][0] || key).toLowerCase()); return index < 0 ? '' : body.slice(Math.max(0, index - 40), index + 80); };
    return [key, { before: snippet(before, matchedBefore.includes(key)), after: snippet(after, matchedAfter.includes(key)) }];
  }));
  return { scoringVersion: 'keyword-coverage-v1', requirementsCount: keywords.length, jobKeywords: keywords, evidence,
    matchedKeywordsBefore: matchedBefore, matchedKeywordsAfter: matchedAfter, matchedKeywords: matchedAfter,
    partialKeywordsBefore: partialBefore, partialKeywordsAfter: partialAfter,
    addedKeywords: matchedAfter.filter((key) => !matchedBefore.includes(key)),
    removedKeywords: matchedBefore.filter((key) => !matchedAfter.includes(key)), missingKeywords: missing,
    beforeScore: keywords.length ? Math.round((matchedBefore.length + partialBefore.length * 0.5) / keywords.length * 100) : 0,
    afterScore: keywords.length ? Math.round((matchedAfter.length + partialAfter.length * 0.5) / keywords.length * 100) : 0,
    hasRequirements: keywords.length > 0 };
}

export function validateTailoredResume(value, evidence = '') {
  if (!value || typeof value !== 'object' || typeof value.summary !== 'string' || !Array.isArray(value.skills)) throw new Error('The tailoring model returned an invalid resume. Please retry.');
  for (const key of ['internships', 'projects', 'education', 'extras']) if (value[key] !== undefined && !Array.isArray(value[key])) throw new Error(`The tailoring model returned invalid ${key} data.`);
  if (evidence) {
    const source = String(evidence).toLowerCase();
    for (const skill of value.skills) {
      const candidate = String(typeof skill === 'string' ? skill : skill?.value || '').toLowerCase();
      const words = candidate.match(/[a-z][a-z0-9+#.-]{2,}/g) || [];
      if (words.length && !words.some((word) => source.includes(word))) throw new Error('The tailoring model added an unsupported skill. Please retry.');
    }
  }
  return value;
}
