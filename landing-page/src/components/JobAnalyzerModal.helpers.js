export function mapProfileForBackend(profile = {}) {
  const mapped = { ...profile };
  if (profile.resume?.links?.length) {
    mapped.resume = { ...(mapped.resume || {}), links: [...new Set(profile.resume.links.filter(Boolean))] };
  }
  if (profile.resume?.linkItems?.length) {
    mapped.resume = { ...(mapped.resume || {}), linkItems: profile.resume.linkItems.filter((item) => item?.url) };
  }
  if (profile.education?.length) mapped.education = profile.education.map((e) => ({ degree: [e.degree, e.branch].filter(Boolean).join(' in '), school: e.institution || e.school || '', dates: e.graduationYear || e.dates || '', detail: e.cgpa ? `CGPA: ${e.cgpa}` : (e.detail || '') }));
  if (profile.experience?.length) mapped.experience = profile.experience.map((e) => ({ title: e.title || '', company: e.company || '', dates: e.duration || e.dates || '', description: e.description || '', detail: e.description || e.detail || '' }));
  if (profile.projects?.length) mapped.projects = profile.projects.map((p) => ({ name: p.title || p.name || '', stack: p.technologies || p.stack || '', url: p.link || p.url || '', detail: p.description || p.detail || '', linkLabel: (p.link || p.url) ? 'GitHub' : '' }));
  if (profile.links) {
    if (!mapped.linkedin && profile.links.linkedin) mapped.linkedin = profile.links.linkedin;
    if (!mapped.github && profile.links.github) mapped.github = profile.links.github;
  }
  return mapped;
}

/**
 * Read the resume PDF saved in the profile: its text and every link the PDF
 * carries (certificate and GitHub URLs live in the annotations, not the text).
 */
export async function extractProfilePdf(profile = {}) {
  const dataUrl = profile?.resume?.dataUrl;
  if (!dataUrl || !/^data:[^;]+;base64,/i.test(dataUrl)) return { text: '', links: [], linkItems: [] };
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const body = new FormData();
  body.append('file', new Blob([bytes], { type: 'application/pdf' }), profile.resume.fileName || 'profile-resume.pdf');
  const response = await fetch('/api/resume/extract-text', { method: 'POST', body });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not read the resume saved in your profile.');
  return {
    text: String(result.text || '').trim(),
    links: Array.isArray(result.links) ? result.links : [],
    linkItems: Array.isArray(result.linkItems) ? result.linkItems : [],
  };
}

/** Pull URLs straight out of resume text when the PDF has no link annotations. */
export function resumeUrlsFromText(text) {
  const found = String(text || '').match(/https?:\/\/[^\s|,;)\]}]+|(?:www\.)?(?:github|linkedin|gitlab)\.com\/[^\s|,;)\]}]+/gi) || [];
  return [...new Set(found.map((url) => {
    const clean = url.replace(/[.,;:)\]}]+$/, '');
    return /^https?:/i.test(clean) ? clean : `https://${clean}`;
  }))];
}

export function extractResumeLocation(resumeText, fallback = '') {
  const lines = String(resumeText || '').replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
  const nameIndex = lines.findIndex(line => /^[A-Za-z][A-Za-z .'-]{2,45}$/.test(line));
  const candidates = lines.slice(Math.max(0, nameIndex + 1), Math.min(lines.length, (nameIndex >= 0 ? nameIndex + 5 : 5)));
  return candidates
    .map(line => line.replace(/[⋄|•]/g, ' ').replace(/\s+/g, ' ').trim())
    .find(line => /[A-Za-z]/.test(line) && /,/.test(line) && !/@|https?:\/\/|linkedin|github|\+?\d[\d\s().-]{7,}/i.test(line))
    || (String(fallback || '').length < 90 && !/engineer|developer|rest api|database|software|intern/i.test(fallback) ? fallback : '');
}

export function profileResumeText(profile = {}) {
  const mapped = mapProfileForBackend(profile);
  return [
    // Profile upload stores the PDF's extracted text here. Keep it ahead of
    // structured fields so tailoring uses the user's actual resume, not only
    // the short profile form values.
    profile.resume?.text || '',
    ...(profile.resume?.links || []),
    profile.skills?.length ? `Skills: ${profile.skills.join(', ')}` : '',
    ...(mapped.experience || []).map(i => [i.title, i.company, i.dates, i.description || i.detail].filter(Boolean).join(' ')),
    ...(mapped.education || []).map(i => [i.degree, i.school, i.dates, i.detail].filter(Boolean).join(' ')),
    ...(mapped.projects || []).map(i => [i.name, i.stack, i.detail].filter(Boolean).join(' ')),
  ].filter(Boolean).join('\n');
}

export function keywordAudit(ats = {}) {
  const before = ats.matchedKeywordsBefore ?? ats.matchedKeywords;
  const after = ats.matchedKeywordsAfter ?? ats.afterKeywords;
  return [
    ['Matched before', before],
    ['Matched after', after],
    ['Added', ats.addedKeywords],
    ['Removed', ats.removedKeywords],
    ['Partial match', ats.partialKeywordsAfter],
    ['Still missing', ats.missingKeywords],
  ].map(([label, values]) => ({ label, values: Array.isArray(values) ? values : [] }));
}

export function scoreValue(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
export function scoreLabel(before, after) {
  const b = scoreValue(before); const a = scoreValue(after);
  if (b === null || a === null) return 'ATS comparison unavailable';
  if (a > b) return 'Improved';
  if (a === b) return 'Unchanged';
  return 'Lower after tailoring';
}
