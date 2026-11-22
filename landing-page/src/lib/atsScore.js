// Deterministic ATS score for a resume.
//
// Keyword overlap alone is not an ATS result: once tailoring inserts every
// keyword from the posting it always lands on the same number (the old card
// showed 97% for every job). This score weighs the things an ATS parser and a
// recruiter actually read, so two different resumes get different scores:
//
//   keywords        40  job-description keyword coverage (exact 1, partial 0.5)
//   structure       15  parsable Skills / Education / Experience|Projects headings
//   contact         10  email + phone in the contact block
//   links            5  LinkedIn or GitHub URL
//   impact          12  bullet lines that carry a real number
//   action verbs     8  lines that start with a strong verb
//   length           5  dense enough to be useful, short enough for one page
//   title alignment  5  words of the target job title in the resume
//
// Nothing is invented: every input is text the user already has.

const SCORE_CAP = 98;
const SCORE_VERSION = 'ats-score-v1';

const VERB = /^(built|develop(?:ed|s|ing)?|design(?:ed|s|ing)?|implement(?:ed|s|ing)?|automat(?:ed|es|ing)|optimi[sz](?:ed|es|ing)|led|lead|launch(?:ed|es|ing)?|improv(?:ed|es|ing)|migrat(?:ed|es|ing)|deploy(?:ed|s|ing)?|reduc(?:ed|es|ing)|creat(?:ed|es|ing)|engineer(?:ed|s|ing)?|architect(?:ed|s|ing)?|deliver(?:ed|s|ing)?|maintain(?:ed|s|ing)?|analy[sz](?:ed|es|ing)|integrat(?:ed|es|ing)|collaborat(?:ed|es|ing)|initiat(?:ed|es|ing)|streamlin(?:ed|es|ing)|accelerat(?:ed|es|ing)|resolv(?:ed|es|ing)|own(?:ed|s)?|dr[oO]ve|driven|scal(?:ed|es|ing)|test(?:ed|s|ing)?|refactor(?:ed|s|ing)?|document(?:ed|s|ing)?|mentor(?:ed|s|ing)?|manag(?:ed|es|ing)|coordinat(?:ed|es|ing)|support(?:ed|s|ing)?|conduct(?:ed|s|ing)?|achiev(?:ed|es|ing)|increas(?:ed|es|ing)|generat(?:ed|es|ing)|verif(?:ied|ies|ying)|validat(?:ed|es|ing)|troubleshot|debug(?:ged|s|ging)?|monitor(?:ed|s|ing)?)\b/i;

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function lineUnits(body) {
  return String(body || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•▪·*\-–—]+/, '').trim())
    .filter((line) => line && line.split(/\s+/).length >= 4);
}

function wordCountOf(body) {
  return String(body || '').trim().split(/\s+/).filter(Boolean).length;
}

function lengthPoints(words) {
  if (!words) return 0;
  if (words >= 300 && words <= 800) return 5;
  if (words >= 200 && words <= 1000) return 3;
  return 1;
}

function titlePoints(body, jobTitle) {
  const words = [...new Set(String(jobTitle || '').toLowerCase().match(/[a-z]{4,}/g) || [])];
  if (!words.length) return 0;
  const text = String(body || '').toLowerCase();
  const found = words.filter((word) => new RegExp(`\\b${word}`).test(text)).length;
  return clamp(Math.round((found / words.length) * 5), 0, 5);
}

/**
 * @param {object} input
 * @param {string} input.resumeText       the resume text that will be sent out
 * @param {string[]} [input.jobKeywords]  keywords extracted from the posting
 * @param {string[]} [input.matchedKeywords]
 * @param {string[]} [input.partialKeywords]
 * @param {string} [input.jobTitle]
 * @param {number|null} [input.pageCount]
 */
export function calculateAtsScore({
  resumeText = '',
  jobKeywords = [],
  matchedKeywords = [],
  partialKeywords = [],
  jobTitle = '',
  pageCount = null,
} = {}) {
  const body = String(resumeText || '');
  const words = wordCountOf(body);
  if (!body.trim()) {
    return { version: SCORE_VERSION, score: 0, cap: SCORE_CAP, breakdown: {}, wordCount: 0, summary: 'No resume text to score yet.' };
  }

  const units = lineUnits(body);

  // 1. Keyword coverage of the posting (the largest single factor).
  const keywords = [...new Set((jobKeywords || []).map(String).filter(Boolean))];
  const matched = new Set((matchedKeywords || []).map(String));
  const partial = new Set((partialKeywords || []).filter((key) => !matched.has(key)).map(String));
  const exactHits = keywords.filter((key) => matched.has(key)).length;
  const partialHits = keywords.filter((key) => partial.has(key)).length;
  const keywordRatio = keywords.length ? clamp((exactHits + partialHits * 0.5) / keywords.length, 0, 1) : 0;
  const keywordPoints = Math.round(keywordRatio * 40);

  // 2. Parsable sections.
  const hasSkills = /\bskills?\b/i.test(body);
  const hasEducation = /\beducation\b/i.test(body);
  const hasExperience = /\b(experience|internships?|employment|projects?)\b/i.test(body);
  const structurePoints = (hasSkills ? 5 : 0) + (hasEducation ? 5 : 0) + (hasExperience ? 5 : 0);

  // 3. A contact block an ATS can parse.
  const hasEmail = /[\w.+-]+@[\w-]+\.[\w.]+/.test(body);
  const hasPhone = /(\+?\d[\d\s().-]{8,}\d)/.test(body);
  const contactPoints = (hasEmail ? 5 : 0) + (hasPhone ? 5 : 0);

  // 4. A profile link recruiters can open.
  const hasLink = /linkedin\.com|github\.com|gitlab\.com|portfolio/i.test(body);
  const linkPoints = hasLink ? 5 : 0;

  // 5. Measurable impact. Years are stripped first so "2024" is not evidence.
  const metricUnits = units.filter((unit) => /\d/.test(unit.replace(/\b(19|20)\d{2}\b/g, '')));
  const impactPoints = Math.round(clamp(metricUnits.length / 4, 0, 1) * 12);

  // 6. Bullets that lead with a strong verb.
  const verbUnits = units.filter((unit) => VERB.test(unit));
  const verbPoints = Math.round(clamp(verbUnits.length / 5, 0, 1) * 8);

  // 7. Length: enough substance, still one page.
  const lengthFit = lengthPoints(words);
  const pageFits = pageCount ? pageCount <= 1 : words <= 800;
  const lengthFill = pageFits ? lengthFit : Math.min(lengthFit, 2);

  // 8. Alignment with the target job title.
  const titleFit = titlePoints(body, jobTitle);

  const total = keywordPoints + structurePoints + contactPoints + linkPoints + impactPoints + verbPoints + lengthFill + titleFit;
  const score = clamp(Math.round(total), 0, SCORE_CAP);

  const breakdown = {
    keywords: { points: keywordPoints, max: 40, detail: `${exactHits}/${keywords.length || 0} job keywords${partialHits ? ` (+${partialHits} partial)` : ''}` },
    structure: { points: structurePoints, max: 15, detail: [hasSkills && 'Skills', hasEducation && 'Education', hasExperience && 'Experience/Projects'].filter(Boolean).join(' · ') || 'No parsable headings' },
    contact: { points: contactPoints, max: 10, detail: [hasEmail && 'email', hasPhone && 'phone'].filter(Boolean).join(' · ') || 'No email or phone' },
    links: { points: linkPoints, max: 5, detail: hasLink ? 'Profile link found' : 'No LinkedIn/GitHub link' },
    impact: { points: impactPoints, max: 12, detail: `${metricUnits.length} line${metricUnits.length === 1 ? '' : 's'} with numbers` },
    verbs: { points: verbPoints, max: 8, detail: `${verbUnits.length} line${verbUnits.length === 1 ? '' : 's'} starting with an action verb` },
    length: { points: lengthFill, max: 5, detail: `${words} words${pageCount ? ` · ${pageCount} page${pageCount === 1 ? '' : 's'}` : ''}` },
    title: { points: titleFit, max: 5, detail: jobTitle ? `Target title: ${jobTitle}` : 'No job title to align with' },
  };

  const weakest = Object.entries(breakdown)
    .filter(([, item]) => item.points < item.max)
    .sort((a, b) => (b[1].max - b[1].points) - (a[1].max - a[1].points))
    .slice(0, 2)
    .map(([, item]) => item.detail);

  return {
    version: SCORE_VERSION,
    score,
    cap: SCORE_CAP,
    breakdown,
    wordCount: words,
    summary: weakest.length ? `Biggest gaps: ${weakest.join('; ')}.` : 'Strong across every ATS signal.',
  };
}

export const ATS_SCORE_CAP = SCORE_CAP;
