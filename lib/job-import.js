// Pure helpers that turn a fetched job posting into a structured listing for the
// admin panel. Nothing here talks to the network, so the shaping of an imported
// job stays deterministic and testable.

import { keywordsFromJob, keywordMatches } from './job-analysis.js';

const HEADING_HINTS = /^(about(?:\s+the)?(?:\s+(?:role|job|company|us|team|internship|program|opportunity))?|role(?:\s+overview)?|job\s+(?:description|summary|overview|details)|position\s+overview|overview|description|responsibilities|key\s+responsibilities|what\s+you(?:'|’)?ll\s+do|what\s+you\s+will\s+do|your\s+role|day\s+to\s+day|the\s+role|requirements?|required(?:\s+(?:skills|qualifications|experience|technical\s+skills))?|must[\s-]?have(?:\s+skills)?|minimum\s+qualifications|basic\s+qualifications|preferred(?:\s+(?:skills|qualifications|experience))?|good[\s-]?to[\s-]?have|nice[\s-]?to[\s-]?have|qualifications?|skills?(?:\s+required)?|technical\s+skills|tech\s+stack|eligibility|who\s+can\s+apply|who\s+you\s+are|about\s+you|benefits?|perks|what\s+we\s+offer|compensation|stipend|salary|ctc|location|work\s+(?:mode|location)|how\s+to\s+apply|selection\s+process|interview\s+process|hiring\s+process|education|batch|graduation|equal\s+opportunity|diversity|what\s+you(?:'|’)?ll\s+learn|learning\s+opportunities)\b/i;

const NOISE_LINE = /^(?:apply(?:\s+now)?|back\s+to\s+(?:jobs|search)|share(?:\s+(?:this|job))?|save(?:\s+job)?|sign\s+in|log\s+in|login|register|report\s+(?:this\s+)?job|easy\s+apply|similar\s+jobs|show\s+more|read\s+more|see\s+more|view\s+all|cookie(?:s)?(?:\s+policy)?|privacy\s+policy|terms(?:\s+of\s+use)?|follow\s+us|subscribe|newsletter|skip\s+to\s+(?:content|main)|menu|search|home|jobs|careers|post\s+a\s+job|create\s+job\s+alert|job\s+alert)$/i;

const BULLET_PREFIX = /^\s*(?:[•·▪◦●‣∙*+\-–—]|\d{1,2}[.)])\s+/;

function tidy(line) {
  return String(line)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function titleCaseHeading(value) {
  const text = tidy(value).replace(/[:：]\s*$/, '');
  if (!text) return '';
  if (text === text.toUpperCase() && text.length > 3) {
    return text
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return text.replace(/^\w/, (c) => c.toUpperCase());
}

function looksLikeHeading(line) {
  if (!line || line.length > 80) return false;
  if (BULLET_PREFIX.test(line)) return false;
  if (/[.;,]$/.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length > 8) return false;
  if (HEADING_HINTS.test(line)) return true;
  // ALL CAPS section labels ("REQUIRED SKILLS", "ABOUT THE TEAM")
  if (line.length >= 4 && line.length <= 45 && line === line.toUpperCase() && /[A-Z]{3}/.test(line)) return true;
  return false;
}

function splitSentences(paragraph) {
  return paragraph
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2);
}

const LIST_SECTION = /responsibilit|requirement|qualification|skill|what you|your role|day to day|eligibility|who can apply|who you are|must have|preferred|good to have|nice to have|benefit|perks|offer|learn/i;

/**
 * Rebuild a scraped description as `## Heading` + `• bullet` sections so the
 * app can render it cleanly instead of dumping a wall of text.
 */
export function structureJobDescription(raw) {
  const lines = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u2022|\u25cf|\u25aa|\u25e6|\u00b7/g, '•')
    .split('\n')
    .map(tidy);

  const out = [];
  const seen = new Set();
  let section = '';

  const pushBlank = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    if (!line) {
      pushBlank();
      continue;
    }
    if (NOISE_LINE.test(line)) continue;
    if (/^[\u2022\u00b7\-\u2013\u2014\s]+$/.test(line)) continue;
    if (/^https?:\/\/\S+$/i.test(line)) continue;
    if (/^©|^copyright\b/i.test(line)) continue;

    // Join hard-wrapped lines that belong to the same sentence.
    while (
      index + 1 < lines.length &&
      lines[index + 1] &&
      /^[a-z(,;]/.test(lines[index + 1]) &&
      !BULLET_PREFIX.test(lines[index + 1]) &&
      line.length + lines[index + 1].length < 400
    ) {
      index += 1;
      line = `${line} ${lines[index]}`.trim();
    }

    if (looksLikeHeading(line)) {
      const heading = titleCaseHeading(line);
      if (heading && heading.toLowerCase() !== section.toLowerCase()) {
        pushBlank();
        out.push(`## ${heading}`);
        out.push('');
        section = heading;
      }
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      const heading = titleCaseHeading(line.replace(/^#{1,6}\s+/, ''));
      if (heading) {
        pushBlank();
        out.push(`## ${heading}`);
        out.push('');
        section = heading;
      }
      continue;
    }

    const looksLikeCommaList =
      line.length <= 200 &&
      (line.match(/,/g) || []).length >= 2 &&
      !/[.!?]$/.test(line) &&
      (LIST_SECTION.test(section) || /skill|technolog|stack/i.test(section));

    if (BULLET_PREFIX.test(line)) {
      line = `• ${line.replace(BULLET_PREFIX, '').trim()}`;
    } else if (looksLikeCommaList) {
      line.split(/[,;|]/).map((part) => part.trim()).filter(Boolean).forEach((part) => {
        if (!seen.has(part.toLowerCase())) {
          seen.add(part.toLowerCase());
          out.push(`• ${part}`);
        }
      });
      continue;
    } else if (LIST_SECTION.test(section) && line.length > 160) {
      // Long prose inside a list-ish section reads far better as bullets.
      splitSentences(line).forEach((sentence) => out.push(`• ${sentence}`));
      continue;
    }

    const key = line.toLowerCase();
    if (line.startsWith('• ') && seen.has(key)) continue;
    if (line.startsWith('• ')) seen.add(key);

    out.push(line);
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 9000);
}

const PREFERRED_SECTION = /preferred|good[\s-]?to[\s-]?have|nice[\s-]?to[\s-]?have|desirable|bonus|added advantage|nice to have|plus/i;
const REQUIRED_SECTION = /required|must[\s-]?have|mandatory|qualifications|skills|requirements|eligibility/i;

/** Split the technical vocabulary found in a posting into required/preferred. */
export function inferSkills(description) {
  const body = String(description || '');
  // Single letters ("R", "AI") are almost always noise in a posting.
  const all = keywordsFromJob(body).filter((key) => key.length > 1 || key === 'C');
  if (!all.length) return { required: [], preferred: [] };

  const preferred = new Set();
  let sectionIsPreferred = false;

  body.split(/\n+/).forEach((line) => {
    const trimmed = tidy(line);
    if (!trimmed) return;
    const isHeadingLike = trimmed.length <= 90;
    if (isHeadingLike && PREFERRED_SECTION.test(trimmed)) {
      sectionIsPreferred = true;
      return;
    }
    if (isHeadingLike && REQUIRED_SECTION.test(trimmed) && !PREFERRED_SECTION.test(trimmed)) {
      sectionIsPreferred = false;
      return;
    }
    if (sectionIsPreferred) {
      all.filter((key) => keywordMatches(trimmed, key)).forEach((key) => preferred.add(key));
    }
  });

  const required = all.filter((key) => !preferred.has(key));
  // A posting rarely marks sections explicitly: keep the most prominent skills
  // as required and the tail as nice-to-have instead of calling everything equal.
  if (preferred.size === 0 && required.length > 6) {
    const tail = required.splice(6);
    tail.forEach((key) => preferred.add(key));
  }

  return { required: required.slice(0, 10), preferred: [...preferred].slice(0, 8) };
}

/** Work mode + city, in the shape the job cards and match engine expect. */
export function inferLocation(description, fallback = 'India') {
  const body = String(description || '');
  const city = body.match(/bengaluru|bangalore|hyderabad|mumbai|pune|chennai|gurugram|gurgaon|noida|delhi|kolkata|ahmedabad|jaipur|indore|kochi|coimbatore|visakhapatnam|tirupati/i)?.[0] || '';
  const pretty = city ? city.replace(/^bangalore$/i, 'Bengaluru').replace(/^gurgaon$/i, 'Gurugram').replace(/^\w/, (c) => c.toUpperCase()) : '';
  if (/work\s*from\s*home|fully\s*remote|100%\s*remote|remote\s+(?:role|position|job)/i.test(body)) return 'Remote';
  if (/hybrid/i.test(body)) return pretty ? `${pretty} (Hybrid)` : 'Hybrid';
  if (pretty) return `${pretty}, India`;
  if (/remote/i.test(body)) return 'Remote';
  return fallback;
}

export function inferJobType(title, description) {
  const head = `${title || ''} ${String(description || '').slice(0, 1200)}`;
  if (/intern(ship)?\b/i.test(title || '') || /internship/i.test(String(description || '').slice(0, 1500))) return 'Internship';
  if (/part[\s-]?time/i.test(head)) return 'Part Time';
  if (/contract(?:or)?\b/i.test(head)) return 'Contract';
  return 'Full Time';
}

export function inferExperience(title, description) {
  const body = `${title || ''} ${String(description || '').slice(0, 3000)}`;
  if (/fresher|entry[\s-]?level|0\s*(?:-|–|to)\s*[12]\s*years?|graduate\s+(?:program|hire|trainee)|no\s+(?:prior\s+)?experience/i.test(body)) {
    return { experienceLabel: '0–1 years', experienceMin: 0, experienceMax: 1 };
  }
  const range = body.match(/\b([1-6])\s*(?:-|–|to)\s*(\d)\s*\+?\s*years?/i);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    const label = `${min}–${max} years`;
    return { experienceLabel: label, experienceMin: min, experienceMax: max };
  }
  const single = body.match(/\b([1-6])\+?\s*years?\b/i);
  if (single) {
    const min = Number(single[1]);
    return { experienceLabel: `${min}+ years`, experienceMin: min, experienceMax: min + 3 };
  }
  return { experienceLabel: '0–1 years', experienceMin: 0, experienceMax: 1 };
}

function secureUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^http:\/\//i.test(url) && !/localhost|127\.0\.0\.1/i.test(url)) return url.replace(/^http:/i, 'https:');
  return url;
}

/** Drop the page header (title/company/location repeat) from the description. */
function dropHeaderLines(description, title, company, location = '') {
  const lines = String(description || '').split('\n');
  const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const titleKey = norm(title);
  const companyKey = norm(company);
  const locationKey = norm(location);
  const isHeading = (line) => line.startsWith('## ');
  let removed = 0;
  while (lines.length && removed < 5) {
    const line = lines[0].trim();
    if (!line) { lines.shift(); continue; }
    if (isHeading(line)) break;
    const key = norm(line);
    const isHeader =
      key.length <= 120 && (
        (titleKey && (key === titleKey || key.startsWith(titleKey))) ||
        (companyKey && key.includes(companyKey)) ||
        (locationKey && key === locationKey)
      );
    if (!isHeader) break;
    lines.shift();
    removed += 1;
  }
  return lines.join('\n').trim();
}

/**
 * Build the job object the admin form / store expects.
 * `posting` comes from validateJobDescription, `meta` from the page metadata.
 */
export function buildJobDraft({ posting = {}, meta = {}, openUrl = '', applyUrl = '' } = {}) {
  const title = tidy(posting.title || meta.title || 'Job opening').slice(0, 120);
  const company = tidy(posting.company || meta.company || 'Company').slice(0, 80);
  const description = dropHeaderLines(
    structureJobDescription(posting.description || ''),
    title,
    company,
    meta.location || '',
  );
  const skills = inferSkills(description || posting.description || '');
  const location = inferLocation(`${title} ${posting.description || ''} ${meta.location || ''}`, meta.location || 'India');
  const type = inferJobType(title, posting.description || '');
  const experience = inferExperience(title, posting.description || '');
  const fresherFriendly = /\bintern(ship)?\b|fresher|entry[\s-]?level|new\s+grad|graduate\s+(?:program|scheme|trainee)|final\s+year|0\s*(?:-|–|to)\s*[12]\s*years?/i
    .test(`${title} ${String(posting.description || '').slice(0, 4000)}`);
  const category = /remote/i.test(location)
    ? 'Remote'
    : (type === 'Internship' || fresherFriendly ? 'Freshers' : 'Confidential');

  return {
    title,
    company,
    companyLogoUrl: meta.logo || '',
    location,
    category,
    type,
    ...experience,
    applyLink: secureUrl(applyUrl || openUrl),
    sourceUrl: secureUrl(openUrl || applyUrl),
    requiredSkills: skills.required,
    preferredSkills: skills.preferred,
    skills: [...skills.required, ...skills.preferred],
    description,
  };
}
