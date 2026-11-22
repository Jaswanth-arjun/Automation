// Pure helpers that turn a fetched job posting into a structured listing for the
// admin panel. Nothing here talks to the network, so the shaping of an imported
// job stays deterministic and testable.

import { keywordsFromJob, keywordMatches } from './job-analysis.js';

const HEADING_HINTS = /^(about(?:\s+the)?(?:\s+(?:role|job|company|us|team|internship|program|opportunity))?|role(?:\s+overview)?|job\s+(?:description|summary|overview|details)|position\s+overview|overview|description|responsibilities|key\s+responsibilities|areas?\s+of\s+(?:responsibility|responsibilities)|main\s+(?:responsibilities|duties)|key\s+duties|duties|what\s+you(?:'|’)?ll\s+do|what\s+you\s+will\s+do|your\s+role|day\s+to\s+day|the\s+role|requirements?|required(?:\s+(?:skills|qualifications|experience|technical\s+skills))?|must[\s-]?have(?:\s+skills)?|minimum\s+qualifications|basic\s+qualifications|preferred(?:\s+(?:skills|qualifications|experience))?|good[\s-]?to[\s-]?have|nice[\s-]?to[\s-]?have|qualifications?|skills?(?:\s+required)?|technical\s+skills|tech\s+stack|eligibility|who\s+can\s+apply|who\s+you\s+are|about\s+you|benefits?|perks|what\s+we\s+offer|compensation|stipend|salary|ctc|location|work\s+(?:mode|location)|how\s+to\s+apply|selection\s+process|interview\s+process|hiring\s+process|education|batch|graduation|equal\s+opportunity|diversity|what\s+you(?:'|’)?ll\s+learn|learning\s+opportunities)\b/i;

const NOISE_LINE = /^(?:apply(?:\s+now)?|back\s+to\s+(?:jobs|search)|share(?:\s+(?:this|job))?|save(?:\s+job)?|sign\s+in|log\s+in|login|register|report\s+(?:this\s+)?job|easy\s+apply|similar\s+jobs|show\s+more|read\s+more|see\s+more|view\s+all|cookie(?:s)?(?:\s+policy)?|privacy\s+policy|terms(?:\s+of\s+use)?|follow\s+us|subscribe|newsletter|skip\s+to\s+(?:content|main)|menu|search|home|jobs|careers|post\s+a\s+job|create\s+job\s+alert|job\s+alert)$/i;

// A language switcher lists every locale the career site ships with
// ("Deutsch (Deutschland)", "日本語 (日本)", "العَرَبِيَّة (السعودية)"). None of
// these lines are part of the posting.
const LOCALE_LINE = /^(?:English|Deutsch|Español|Français|Italiano|Português|Polski|Nederlands|Türkçe|Русский|Limba Română|Română|Čeština|Dansk|Magyar|Norsk|Svenska|Suomi|Ελληνικά|עברית|日本語|한국어|简体中文|中文|ไทย|Tiếng Việt|Bahasa|हिन्दी|[^\x00-\x7F]{2,})\s*\([^)]{2,40}\)$/i;
const LANGUAGE_MENU_LINE = /^(?:language|select (?:a )?language|choose (?:a )?language|language settings)$/i;

// Label/value pairs printed above the posting body ("Job Title:", "City:",
// "Posting Start Date:" …). They are lifted into structured job details instead
// of sitting at the top of the description as loose text.
const DETAIL_LABELS = [
  [/^job\s*(?:title|role)$/i, 'Job title'],
  [/^(?:job\s*(?:id|identification|number|no\.?)|requisition\s*(?:id|number|no\.?)|req(?:uisition)?\s*(?:id|number|no\.?)|posting\s*id|reference\s*(?:id|number|no\.?))$/i, 'Job ID'],
  [/^city$/i, 'City'],
  [/^(?:state(?:\s*\/\s*province)?|province|region)$/i, 'State'],
  [/^country$/i, 'Country'],
  [/^(?:posting\s*start\s*date|posting\s*date|posted\s*(?:on|date)?|date\s*posted)$/i, 'Posted on'],
  [/^(?:posting\s*end\s*date|apply\s*before|application\s*deadline|closes?(?:\s*on)?)$/i, 'Apply before'],
  [/^(?:employment\s*type|job\s*type|position\s*type)$/i, 'Employment type'],
  [/^(?:work\s*mode|work\s*arrangement|remote\s*status)$/i, 'Work mode'],
  [/^work\s*location$/i, 'Work location'],
  [/^(?:shift|schedule|travel(?:\s*required)?)$/i, 'Shift'],
  [/^(?:department|job\s*category|function|business\s*unit|division)$/i, 'Department'],
  [/^(?:salary(?:\s*range)?|compensation|ctc|pay\s*range)$/i, 'Salary'],
  [/^(?:experience(?:\s*required|\s*level)?|years?\s*of\s*experience)$/i, 'Experience'],
  [/^location$/i, 'Location'],
];

// Site chrome scraped from career pages: navigation, footers, social links,
// legal/EEO boilerplate, cookie banners and page-metadata blocks. These lines
// are dropped whole; only the actual posting content is kept.
const CHROME_LINE_EXACT = new Set([
  'skip to main content', 'skip to content', 'view more jobs', 'copy job link',
  'join our talent network', 'join our talent community', 'tips for a successful interview',
  'frequently asked questions', 'faq', 'request accommodations', 'request accommodation',
  'privacy notice', 'privacy statement', 'privacy policy', 'privacy and data impressum',
  'impressum', 'cookie notice', 'cookie policy', 'cookies, ads and emails', 'accessibility',
  'equal employment opportunity policy', 'equal opportunity employer', 'recruitment fraud alert',
  'manage', 'decline all', 'accept all', 'decline all accept all',
  'accept all cookies', 'decline all cookies', 'confirm my choices', 'cookie consent manager',
  'required cookies', 'functional cookies', 'show more details', 'provider', 'enabled',
  'opens in a new tab', 'information at a glance', 'get job alerts', 'register >',
  'search jobs >', 'join us', 'fraud awareness', 'start applying with linkedin', 'please wait...',
  'connect with us', 'join us on', 'download our app', 'find careers', 'military careers',
  'hourly', 'culture', 'amazon newsletter', 'application status', 'legal disclosures and notices',
  'instagram', 'linkedin', 'glassdoor', 'indeed', 'x (twitter)', 'twitter', 'youtube',
  'facebook', 'tiktok',
  'our company', 'who we are', 'team member stories', 'dell technologies capital', 'investors',
  'newsroom', 'recycling', 'corporate impact', 'customer stories', 'resources', 'dell rewards',
  'specialty product collections', 'security & trust center', 'trial software downloads',
  'our offerings', 'artificial intelligence', 'products', 'solutions', 'services', 'deals',
  'our partners', 'find a partner', 'find a reseller', 'oem solutions', 'partner program',
  'dell technologies', 'dell premier for business', 'dell financial services',
  'home', 'teams', 'locations', 'job categories', 'job category', 'job identification',
  'posting date', 'job schedule', 'job shift', 'my career', 'my applications', 'my profile',
  'account security', 'settings', 'sign out', 'accommodations', 'benefits',
  'inclusive experiences', 'how we hire', 'leadership principles', 'working at amazon',
  'trending', 'global benefits', 'job info', 'job details',
]);

const CHROME_LINE_PATTERNS = [
  /^skip to\b/,
  /uses cookies|cookies? and other tracking|cookie (?:notice|banner|preferences|policy)|cookies, ads and emails/,
  /equal (?:employment )?opportunity (?:employer|policy|statement)|equal employment opportunity\b/,
  /workplace accommodation|request(?:ing|s)? (?:an? )?accommodation|accommodation or adjustment|reasonable accommodation|equal opportunities? to all/,
  /contact your recruit(?:ing|er) partner|contact your recruiter/,
  /recruitment fraud|fraud alert|report fraud/,
  /anti-slavery|human trafficking|child labor|modern slavery/,
  /privacy (?:notice|policy|statement|impressum)|data impressum/,
  /^page\b.{0,120}\bloaded$/,
  /pass\s*out\s*only/,
  /join our talent (?:network|community)/,
  /^search\b.{0,60}\b(?:opportunities|jobs)$/,
  /veterans?, military spouses/,
  /all rights reserved|©\s*\d{4}|\bcopyright\b/,
  /terms (?:of|and) (?:use|service|conditions)/,
  /back to (?:top|jobs|search)/,
  /^start(?: applying with linkedin)?$/,
  /^please wait\b/,
  /^[×x]?\s*cookie consent manager$/,
  /consent to (?:all|cookies from provider)/,
  /this translation is generated by ai/,
  /opt(?:ing)? out of .{0,40}cookies/,
  /do not email your resume|not monitored for resumes|ombuds(?:man)?\b/,
  /^(?:receive notifications|explore (?:open roles|all jobs)|sign up for job alerts|join our talent)/,
  /^•?\s*[a-z0-9-]+\.(?:com|in|net|org|io|co)(?:\/[^\s]*)?$/,
  /^(?:[a-z][\w&.'-]*\s+){0,2}(?:locations|offices)$/,
];

// Labels that start a junk block (job metadata, site footer): everything after
// them is dropped until the next real section heading.
const CHROME_SECTION_STARTERS = [
  /^job info$/, /^job details$/, /^job identification$/, /^global benefits$/,
  /^your success\b/, /^connect with us$/, /^join us on$/, /^download our app$/,
  /^find careers$/,
];

const CHROME_SECTION_HEADINGS = /^(?:trending|job info|job details|job identification|join us on|download our app|find careers|help|resources|faq|frequently asked questions|our company|connect with us|locations|equal (?:employment )?opportunity(?:\s+(?:employer|policy|statement))?|join our talent (?:network|community)|global benefits)$|^working at\s|^your success\b/i;

const BULLET_PREFIX = /^\s*(?:[•·▪◦●‣∙*+\-–—]|\d{1,2}[.)])\s+/;

// A careers page footer is a menu: a long run of short, capitalised, unpunctuated
// labels ("About / Leadership / Industries / Buildings …"). Real posting content
// is prose or bullets, so a run like this is site navigation, not a job section.
const NAV_LABEL_HINT = /\b(leadership|inclusion|diversity|industries|buildings|chemicals?|data centers?|healthcare|hospitality|lng|life sciences|low carbon|manufacturing|oil & gas|utilities|career journey|community|integrity|compliance|meet our|insights|privacy|cookies?|terms|manage preferences|accelerator|life at)\b/i;

function isNavigationEntry(line) {
  if (!line || line.length > 48) return false;
  if (/^(?:#{1,6}\s|[•·▪◦●‣∙])/.test(line)) return false;
  if (/[.,;:!?)]$/.test(line)) return false;
  if (!/^[A-Z0-9]/.test(line)) return false;
  const words = line.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 4;
}

function dropNavigationRuns(lines) {
  const kept = [];
  let index = 0;
  while (index < lines.length) {
    if (!isNavigationEntry(lines[index])) {
      kept.push(lines[index]);
      index += 1;
      continue;
    }
    let end = index;
    while (end < lines.length && (isNavigationEntry(lines[end]) || !lines[end])) end += 1;
    const run = lines.slice(index, end).filter(Boolean);
    const hints = run.filter((line) => NAV_LABEL_HINT.test(line)).length;
    if (run.length >= 5 && (hints >= 2 || run.length >= 10)) {
      index = end;
      continue;
    }
    kept.push(...lines.slice(index, end));
    index = end;
  }
  return kept;
}

/** Drop a heading that has no body (a leftover section label). */
function stripEmptySections(markdown) {
  const blocks = String(markdown || '').split(/\n{2,}/);
  const kept = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index].trim();
    if (!block) continue;
    if (/^#{1,6}\s+/.test(block)) {
      const next = (blocks[index + 1] || '').trim();
      if (!next || /^#{1,6}\s+/.test(next)) continue;
    }
    kept.push(block);
  }
  return kept.join('\n\n').trim();
}

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

const DETAIL_LINE = /^([A-Za-z][A-Za-z /&.'’-]{2,40}?)\s*[:：]\s*(.*)$/;

function detailLabelFor(label) {
  const hit = DETAIL_LABELS.find(([pattern]) => pattern.test(String(label || '').trim()));
  return hit ? hit[1] : '';
}

/**
 * Read a posting's metadata block. Returns the pairs plus the line indexes that
 * hold them, so the same lines can be taken out of the description body.
 */
function readDetailPairs(lines) {
  const details = [];
  const consumed = new Set();
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    if (consumed.has(index)) continue;
    const match = lines[index].match(DETAIL_LINE);
    if (!match) continue;
    const label = detailLabelFor(match[1]);
    if (!label || seen.has(label)) continue;

    let valueLine = index;
    let value = tidy(match[2]).replace(/^[-–—•]+\s*/, '').trim();
    if (!value) {
      for (let next = index + 1; next < lines.length && next <= index + 3; next += 1) {
        const candidate = tidy(lines[next]);
        if (!candidate) continue;
        if (DETAIL_LINE.test(candidate)) break;
        valueLine = next;
        value = candidate.replace(/^#{1,6}\s+/, '').replace(/^[-–—•]\s*/, '').trim();
        break;
      }
    }
    // A sentence is posting text, not a field value: leave it in the body.
    if (!value || value.length > 100 || /[.!?…]$/.test(value)) continue;

    details.push({ label, value });
    seen.add(label);
    consumed.add(index);
    if (valueLine !== index) consumed.add(valueLine);
    if (details.length >= 8) break;
  }
  return { details, consumed };
}

/** Posting details ("City", "Posted on", "Job ID" …) read from a scraped page. */
export function extractJobDetails(raw) {
  const lines = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(tidy);
  return readDetailPairs(lines).details;
}

/**
 * A careers page opens with its own menu ("• Life at X / • Early Careers /
 * • India / • Poland …"). Drop that leading label block; real postings start
 * with a section heading or prose.
 */
function dropLeadingMenu(lines) {
  let end = 0;
  while (end < lines.length && end < 40) {
    const line = lines[end];
    if (!line) { end += 1; continue; }
    if (/^#{1,6}\s+/.test(line)) break;
    const bare = line.replace(/^[•·▪◦●‣∙\-–—]\s*/, '');
    if (bare.length > 48 || /[.!?]$/.test(bare)) break;
    end += 1;
  }
  const block = lines.slice(0, end).filter(Boolean);
  // A posting that opens with a section heading ("Requirements" + a bullet
  // list) is content, never the careers menu.
  const startsWithHeading = block.some((line) =>
    HEADING_HINTS.test(line.replace(/^[•·▪◦●‣∙\-–—]\s*/, '').replace(/[:：]\s*$/, '')));
  if (startsWithHeading) return lines;
  const bullets = block.filter((line) => /^[•·▪◦●‣∙]/.test(line)).length;
  const hints = block.filter((line) => NAV_LABEL_HINT.test(line)).length;
  if (block.length >= 4 && (bullets >= 2 || hints >= 2)) return lines.slice(end);
  return lines;
}

/**
 * Rebuild a scraped description as `## Heading` + `• bullet` sections so the
 * app can render it cleanly instead of dumping a wall of text.
 */
export function structureJobDescription(raw) {
  const scraped = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u2022|\u25cf|\u25aa|\u25e6|\u00b7/g, '•')
    .split('\n')
    .map(tidy);

  // A consent-manager panel is an overlay drawn at the end of the page; nothing
  // after it belongs to the posting.
  let pageLines = scraped;
  for (let index = scraped.length - 1; index > scraped.length / 2; index -= 1) {
    if (/^[×x]?\s*cookie consent manager$/i.test(scraped[index])) {
      pageLines = scraped.slice(0, index);
      break;
    }
  }

  // The "Job Title: / City: / Posting Start Date:" block is the posting's
  // metadata, returned separately as job details.
  const { consumed } = readDetailPairs(pageLines);

  // Drop scraped site chrome before formatting: navigation/footer/social/legal
  // lines one by one, and whole blocks that follow junk section labels.
  let lines = [];
  let inChromeSection = false;
  for (let lineIndex = 0; lineIndex < pageLines.length; lineIndex += 1) {
    const line = pageLines[lineIndex];
    if (consumed.has(lineIndex)) { lines.push(''); continue; }
    if (!line) { lines.push(''); continue; }
    // Some career sites separate blocks with a lone zero-width character.
    if (!line.replace(/[\u200b-\u200f\u034f\ufeff\s]+/g, '')) { lines.push(''); continue; }
    if (LANGUAGE_MENU_LINE.test(line) || LOCALE_LINE.test(line)) continue;
    const markdownHeading = /^#{1,6}\s+/.test(line);
    const headingText = line.replace(/^#{1,6}\s+/, '').replace(/[:：]\s*$/, '');
    if (markdownHeading || looksLikeHeading(line)) {
      if (CHROME_SECTION_HEADINGS.test(headingText)) {
        inChromeSection = true;
        continue;
      }
      // A cookie banner or menu label is not a section heading ("## Accept All").
      const bareHeading = headingText.replace(/[.:!?…\s]+$/, '').trim().toLowerCase();
      if (CHROME_LINE_EXACT.has(bareHeading) || NOISE_LINE.test(bareHeading)) {
        inChromeSection = false;
        continue;
      }
      inChromeSection = false;
      lines.push(line);
      continue;
    }
    if (inChromeSection) continue;
    const bare = line
      .replace(BULLET_PREFIX, '')
      .replace(/[:.!?…：]+\s*$/, '')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (CHROME_SECTION_STARTERS.some((re) => re.test(bare))) {
      inChromeSection = true;
      continue;
    }
    if (CHROME_LINE_EXACT.has(bare)) continue;
    if (CHROME_LINE_PATTERNS.some((re) => re.test(bare))) continue;
    lines.push(line);
  }

  lines = dropNavigationRuns(lines);
  lines = dropLeadingMenu(lines);

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
    if (/^[\u2022\u00b7\-\u2013\u2014.×;:\s]+$/.test(line)) continue;
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

    // "Mandatory Skills: Advisory and consulting" is a label with its value on
    // the same line: keep it as a small section instead of a run-on paragraph.
    const labelled = line.match(/^([A-Z][A-Za-z /&'-]{2,40}):\s+(.{3,160})$/);
    const labelCore = labelled
      ? labelled[1].trim().replace(/^(?:mandatory|required|preferred|must[\s-]?have|key|main|core|essential)\s+/i, '')
      : '';
    if (labelled && labelCore && HEADING_HINTS.test(labelCore) && !/[.!?]$/.test(labelled[2].trim())) {
      const heading = titleCaseHeading(labelled[1]);
      if (heading && heading.toLowerCase() !== section.toLowerCase()) {
        pushBlank();
        out.push(`## ${heading}`);
        out.push('');
        out.push(`• ${labelled[2].trim()}`);
        section = heading;
        continue;
      }
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
    } else if (LIST_SECTION.test(section) && line.length <= 200) {
      // Career sites render one responsibility per line without a bullet marker.
      out.push(`• ${line}`);
      continue;
    } else if (LIST_SECTION.test(section) && line.length > 200 && line.length <= 320) {
      // Long prose inside a list-ish section reads far better as bullets.
      splitSentences(line).forEach((sentence) => out.push(`• ${sentence}`));
      continue;
    }


    const key = line.toLowerCase();
    if (line.startsWith('• ') && seen.has(key)) continue;
    if (line.startsWith('• ')) seen.add(key);

    out.push(line);
  }

  return stripEmptySections(out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim())
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
export function dropHeaderLines(description, title, company, location = '') {
  const lines = String(description || '').split('\n');
  const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const titleKey = norm(title);
  const companyKey = norm(company);
  const locationKey = norm(location);
  const locationCity = (String(location || '').match(/[a-zA-Z]{3,}/)?.[0] || '').toLowerCase();
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
        (locationKey && key === locationKey) ||
        (locationCity && key.includes(locationCity))
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
  const jobDetails = extractJobDetails(posting.description || '');
  const description = dropHeaderLines(
    structureJobDescription(posting.description || ''),
    title,
    company,
    meta.location || '',
  );
  const skills = inferSkills(description || posting.description || '');
  const inferredLocation = inferLocation(`${title} ${posting.description || ''} ${meta.location || ''}`, meta.location || 'India');
  // A "City:/State:" block is authoritative when the body never names the city.
  const detailPlace = ['City', 'State']
    .map((label) => jobDetails.find((item) => item.label === label)?.value || '')
    .filter(Boolean)
    .join(', ');
  const location = inferredLocation === (meta.location || 'India') && detailPlace
    ? (/india/i.test(detailPlace) ? detailPlace : `${detailPlace}, India`)
    : inferredLocation;
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
    jobDetails,
    description,
  };
}
