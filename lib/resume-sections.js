/**
 * Deterministic helpers that read sections straight out of resume text.
 *
 * The tailoring model sometimes renames or empties a section (for example it
 * returns `internships: []` while the uploaded resume clearly has an
 * INTERNSHIPS block). These helpers recover the original entries so a section
 * the candidate really has can never be dropped from the tailored PDF.
 *
 * Resume text arrives either as real lines or as one flattened blob, so the
 * parser works on both.
 */

const EXPERIENCE_HEADING = /(?:INTERNSHIPS?|PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EMPLOYMENT HISTORY|EXPERIENCE)\b/;
const NEXT_HEADING = /(?:PROFESSIONAL SUMMARY|TECHNICAL SKILLS|SKILLS|PROJECTS|EDUCATION|ACHIEVEMENTS|CERTIFICATIONS?|AWARDS|LEADERSHIP|PUBLICATIONS|INTERESTS|ADDITIONAL INFORMATION)\b/;
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const DATE_RANGE = new RegExp(`(?:${MONTH}\\s*)?\\d{4}\\s*(?:[–—-]|to)\\s*(?:${MONTH}\\s*)?\\d{4}`, 'i');

function squeeze(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/** Strip a trailing "— Certificate"/"| Certificate" label from a title. */
function cleanTitle(value) {
  return squeeze(value)
    .replace(/\s*(?:[—–|]|-)\s*(?:certificate|completion|certified)\s*$/i, '')
    .replace(/^[—–|,\-.\s]+/, '')
    .trim();
}

export function experienceFromResumeText(text) {
  const blob = squeeze(text);
  if (!blob) return [];

  const heading = blob.match(EXPERIENCE_HEADING);
  if (!heading) return [];

  const rest = blob.slice(heading.index + heading[0].length);
  const next = rest.match(NEXT_HEADING);
  const block = squeeze(next ? rest.slice(0, next.index) : rest).slice(0, 2400);
  if (!block) return [];

  const dated = [...block.matchAll(new RegExp(DATE_RANGE.source, 'gi'))];
  const entries = [];

  if (!dated.length) {
    // No dates: keep the block as one entry so the section still renders.
    return [{ title: cleanTitle(block.slice(0, 90)), dates: '', detail: squeeze(block.slice(90)).slice(0, 480) }]
      .filter((entry) => entry.title);
  }

  let cursor = 0;
  for (const match of dated) {
    const before = block.slice(cursor, match.index).trim();
    const sentenceEnd = before.lastIndexOf('. ');
    const previousDetail = sentenceEnd >= 0 ? before.slice(0, sentenceEnd + 1).trim() : '';
    const title = sentenceEnd >= 0 ? before.slice(sentenceEnd + 1).trim() : before;
    if (entries.length && previousDetail && !entries[entries.length - 1].detail) {
      entries[entries.length - 1].detail = previousDetail;
    }
    entries.push({ title: cleanTitle(title), dates: squeeze(match[0]), detail: '' });
    cursor = match.index + match[0].length;
  }

  const tail = block.slice(cursor).trim();
  if (entries.length && tail && !entries[entries.length - 1].detail) {
    entries[entries.length - 1].detail = tail;
  }

  return entries.filter((entry) => entry.title || entry.detail).slice(0, 4);
}

/**
 * URLs that survive in plain resume text (PDF annotation links are read
 * separately on the server). Used to keep certificate/GitHub links alive when
 * the uploaded PDF has no annotations.
 */
export function urlsInResumeText(text) {
  const found = String(text || '').match(/https?:\/\/[^\s|,;)\]}]+|(?:www\.)?(?:github|linkedin|gitlab)\.com\/[^\s|,;)\]}]+/gi) || [];
  return [...new Set(found.map((url) => {
    const trimmed = url.replace(/[.,;:)\]}]+$/, '');
    return /^https?:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }))];
}

const EXTRAS_HEADING = /(?:ACHIEVEMENTS?(?:\s*(?:&|AND)\s*ADDITIONAL\s+INFORMATION)?|ADDITIONAL\s+INFORMATION)\b/;
const EXTRA_LABELS = /(?:^|\s)(achievements?|awards?|honors?|leadership|problem\s+solving|languages?|certifications?|interests?|activities|volunteering|publications?)\s*:/gi;

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Read the ACHIEVEMENTS & ADDITIONAL INFORMATION block back out of the resume
 * text, so a tailoring pass that forgot it cannot drop the section.
 */
export function extrasFromResumeText(text) {
  const blob = squeeze(text);
  if (!blob) return [];
  const heading = blob.match(EXTRAS_HEADING);
  if (!heading) return [];
  const block = squeeze(blob.slice(heading.index + heading[0].length)).slice(0, 1200);
  if (!block) return [];

  const marks = [...block.matchAll(EXTRA_LABELS)];
  if (!marks.length) {
    return [{ label: 'Achievements', value: block.slice(0, 200) }];
  }

  return marks.slice(0, 4).map((mark, index) => {
    const start = mark.index + mark[0].length;
    const end = index + 1 < marks.length ? marks[index + 1].index : block.length;
    return {
      label: titleCase(mark[1]),
      value: block.slice(start, end).trim().slice(0, 200),
    };
  }).filter((item) => item.value);
}

export { DATE_RANGE };
