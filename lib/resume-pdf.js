import PDFDocument from 'pdfkit';
import { getDocumentProxy } from 'unpdf';

function stripMarkdown(value) {
  return String(value || '').replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

function clean(value, max) {
  const text = stripMarkdown(value);
  if (!max || text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).trim()}…`;
}

function rows(list, max, map) {
  return (Array.isArray(list) ? list : []).map(map).filter((item) => item && Object.values(item).some(Boolean)).slice(0, max);
}

export function fitResumeToOnePage(data = {}, profile = {}) {
  const links = profile.links || {};
  return {
    name: clean(data.name || profile.fullName, 48),
    location: clean(data.location || profile.location, 90),
    phone: clean(data.phone || profile.phone, 24),
    email: clean(data.email || profile.email, 60),
    linkedin: clean(data.linkedin || links.linkedin, 180),
    github: clean(data.github || links.github, 180),
    summary: clean(data.summary || data.headline, 780),
    skills: rows(data.skills, 8, (item) => {
      if (typeof item === 'string') return { label: '', value: clean(item, 140) };
      return { label: clean(item.label, 32), value: clean(item.value, 170) };
    }).filter((item) => item.value),
    internships: rows(data.internships || data.experience, 2, (item) => ({
      title: clean(item.title, 70),
      linkLabel: clean(item.linkLabel || (item.url || item.link ? 'Certificate' : ''), 18),
      url: clean(item.url || item.link, 240),
      dates: clean(item.dates, 32),
      detail: clean(item.detail || (item.bullets || []).join(' '), 520),
    })).filter((item) => item.title || item.detail),
    projects: rows(data.projects, 3, (item) => ({
      name: clean(item.name, 64),
      stack: clean(item.stack || item.tech, 40),
      linkLabel: clean(item.linkLabel || (item.url || item.link ? 'GitHub' : ''), 16),
      url: clean(item.url || item.link, 240),
      detail: clean(item.detail, 420),
    })).filter((item) => item.name || item.detail),
    education: rows(data.education, 2, (item) => ({
      degree: clean(item.degree, 70),
      school: clean(item.school, 80),
      dates: clean(item.dates, 24),
      detail: clean(item.detail || item.score, 48),
    })).filter((item) => item.degree || item.school),
    extras: rows(data.extras, 4, (item) => ({
      label: clean(item.label, 28),
      value: clean(item.value, 180),
    })).filter((item) => item.value),
  };
}

function renderResumePdf(profile, resume, format = 'recommended') {
  const compact = format === 'compact';
  const fitted = resume.summary !== undefined || resume.skills?.[0]?.label !== undefined
    ? resume
    : fitResumeToOnePage(resume, profile);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = { left: 28.8, right: 28.8, top: 8.6, bottom: 8 };
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [pageWidth, pageHeight], margin: 0, autoFirstPage: true, bufferPages: false });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    const left = margin.left;
    const right = pageWidth - margin.right;
    const width = right - left;
    const bottom = pageHeight - margin.bottom;
    const bodySize = compact ? 9 : 10;
    const titleSize = compact ? 10 : 10.5;
    const nameSize = compact ? 15 : 16.5;
    let y = margin.top;

    const labelWidth = (() => {
      doc.font('Times-Bold').fontSize(bodySize);
      const widest = Math.max(108, ...fitted.skills.map((skill) => doc.widthOfString(skill.label || 'Skills') + 14), 0);
      return Math.min(width * 0.38, widest);
    })();
    const sectionGap = compact ? 2.4 : 3.2;
    const afterRule = 2;
    const lineGap = compact ? 0.2 : 0.45;
    const rowGap = compact ? 0.6 : 1;

    const room = () => bottom - y;
    const gap = (n) => { y += n; };
    const setCursor = () => { doc.x = left; doc.y = y; };

    const drawCentered = (text, size, font) => {
      doc.font(font).fontSize(size).fillColor('#111111');
      const height = doc.heightOfString(text, { width, align: 'center' });
      if (height > room()) return false;
      doc.text(text, left, y, { width, align: 'center' });
      y = doc.y;
      return true;
    };

    const drawSegments = (segments, size) => {
      doc.fontSize(size);
      const diamondWidth = 14;
      const widths = segments.map((part) => {
        if (part.diamond) return diamondWidth;
        doc.font(part.font || 'Times-Roman');
        return doc.widthOfString(part.text);
      });
      const total = widths.reduce((sum, item) => sum + item, 0);
      if (size + 2 > room()) return false;
      let x = left + Math.max(0, (width - total) / 2);
      segments.forEach((part, index) => {
        if (part.diamond) {
          const cx = x + diamondWidth / 2;
          const cy = y + size * 0.36;
          const arm = 2.15;
          doc.save();
          doc.moveTo(cx, cy - arm).lineTo(cx + arm, cy).lineTo(cx, cy + arm).lineTo(cx - arm, cy).fill('#333333');
          doc.restore();
        } else {
          doc.font(part.font || 'Times-Roman').fontSize(size).fillColor(part.color || '#111111');
          const options = { lineBreak: false };
          if (part.link) options.link = part.link;
          doc.text(part.text, x, y, options);
        }
        x += widths[index];
      });
      y += size + 2;
      doc.fillColor('#111111');
      setCursor();
      return true;
    };

    const section = (title) => {
      if (room() < 22) return false;
      gap(sectionGap);
      doc.font('Times-Bold').fontSize(titleSize).fillColor('#111111');
      doc.text(title, left, y, { width, lineBreak: false });
      y += titleSize + 1.5;
      doc.save();
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.6).strokeColor('#222222').stroke();
      doc.restore();
      y += afterRule;
      setCursor();
      return true;
    };

    const paragraph = (text) => {
      if (!text) return true;
      doc.font('Times-Roman').fontSize(bodySize).fillColor('#111111');
      const height = doc.heightOfString(text, { width, lineGap });
      if (height > room()) return false;
      doc.text(text, left, y, { width, lineGap });
      y = doc.y + 1;
      setCursor();
      return true;
    };

    const titleLine = (parts, rightPart) => {
      doc.fontSize(titleSize);
      const rightText = rightPart?.text || '';
      const rightFont = rightPart?.italic ? 'Times-Italic' : 'Times-Roman';
      const dateWidth = rightText ? doc.font(rightFont).widthOfString(rightText) : 0;
      const usable = width - (dateWidth ? dateWidth + 10 : 0);
      let used = 0;
      const drawn = [];
      for (const part of parts) {
        if (!part.text) continue;
        doc.font(part.bold ? 'Times-Bold' : 'Times-Roman');
        const partWidth = doc.widthOfString(part.text);
        if (used + partWidth > usable) break;
        drawn.push({ ...part, width: partWidth });
        used += partWidth;
      }
      if (!drawn.length || titleSize + 2 > room()) return false;
      let x = left;
      drawn.forEach((part) => {
        doc.font(part.bold ? 'Times-Bold' : 'Times-Roman').fontSize(titleSize).fillColor(part.color || '#111111');
        const options = { lineBreak: false };
        if (part.link) options.link = part.link;
        doc.text(part.text, x, y, options);
        x += part.width;
      });
      if (rightText) {
        doc.font(rightFont).fontSize(titleSize).fillColor(rightPart.color || '#111111');
        const options = { lineBreak: false };
        if (rightPart.link) options.link = rightPart.link;
        doc.text(rightText, right - dateWidth, y, options);
      }
      y += titleSize + 2;
      doc.fillColor('#111111');
      setCursor();
      return true;
    };

    const name = (fitted.name || 'Candidate').toUpperCase();
    drawCentered(name, nameSize, 'Times-Bold');
    gap(1);
    if (fitted.location) drawCentered(fitted.location, bodySize, 'Times-Roman');
    const contact = [];
    if (fitted.phone) contact.push({ text: fitted.phone });
    if (fitted.email) contact.push({ text: fitted.email });
    if (fitted.linkedin) contact.push({ text: 'LinkedIn', color: '#1a4fd8', link: fitted.linkedin.startsWith('http') ? fitted.linkedin : undefined });
    if (fitted.github) contact.push({ text: 'GitHub', color: '#1a4fd8', link: fitted.github.startsWith('http') ? fitted.github : undefined });
    if (contact.length) {
      const segments = [];
      contact.forEach((part, index) => {
        if (index) segments.push({ diamond: true });
        segments.push(part);
      });
      drawSegments(segments, bodySize);
    }

    if (fitted.summary && section('PROFESSIONAL SUMMARY')) paragraph(fitted.summary);

    if (fitted.skills.length && section('TECHNICAL SKILLS')) {
      fitted.skills.forEach((skill) => {
        doc.font('Times-Bold').fontSize(bodySize);
        const label = skill.label || 'Skills';
        doc.font('Times-Roman').fontSize(bodySize);
        const valueHeight = doc.heightOfString(skill.value, { width: width - labelWidth - 8, lineGap: 0 });
        if (valueHeight + 1 > room()) return;
        const rowY = y;
        doc.font('Times-Bold').fontSize(bodySize).fillColor('#111111');
        doc.text(label, left, rowY, { width: labelWidth, lineBreak: false });
        doc.font('Times-Roman').fontSize(bodySize);
        doc.text(skill.value, left + labelWidth, rowY, { width: width - labelWidth, lineGap: 0 });
        y = Math.max(rowY + bodySize + rowGap, doc.y + 0.4);
        setCursor();
      });
    }

    if (fitted.internships.length && section('INTERNSHIPS')) {
      fitted.internships.forEach((job) => {
        const parts = [{ text: job.title, bold: true }];
        if (job.linkLabel) {
          parts.push({ text: ' \u2014 ' });
          parts.push({ text: job.linkLabel, color: '#1a4fd8', link: job.url?.startsWith('http') ? job.url : undefined });
        }
        if (!titleLine(parts, job.dates ? { text: job.dates, italic: true } : null)) return;
        paragraph(job.detail);
        gap(2);
      });
    }

    if (fitted.projects.length && section('PROJECTS')) {
      fitted.projects.forEach((project) => {
        const parts = [{ text: project.name, bold: true }];
        if (project.stack) parts.push({ text: ` \u2014 ${project.stack}` });
        const projectLink = project.linkLabel
          ? { text: project.linkLabel, color: '#1a4fd8', link: project.url?.startsWith('http') ? project.url : undefined }
          : null;
        if (!titleLine(parts, projectLink)) return;
        paragraph(project.detail);
        gap(1);
      });
    }

    if (fitted.education.length && section('EDUCATION')) {
      fitted.education.forEach((item) => {
        if (!titleLine([{ text: item.degree, bold: true }], item.dates ? { text: item.dates, italic: true } : null)) return;
        const schoolParts = [{ text: item.school }];
        if (item.detail) {
          doc.font('Times-Roman').fontSize(bodySize);
          const detailWidth = doc.widthOfString(item.detail);
          doc.text(item.school, left, y, { width: width - detailWidth - 8, lineBreak: false });
          doc.text(item.detail, right - detailWidth, y, { lineBreak: false });
          y += bodySize + 3;
          setCursor();
        } else {
          paragraph(item.school);
        }
      });
    }

    if (fitted.extras.length && section('ACHIEVEMENTS & ADDITIONAL INFORMATION')) {
      fitted.extras.forEach((item) => {
        doc.font('Times-Bold').fontSize(bodySize);
        const label = item.label.endsWith(':') ? item.label : `${item.label}:`;
        const labelWidth = doc.widthOfString(`${label} `);
        doc.font('Times-Roman').fontSize(bodySize);
        const valueHeight = doc.heightOfString(item.value, { width: width - labelWidth, lineGap: 0 });
        if (valueHeight > room()) return;
        const rowY = y;
        doc.font('Times-Bold').fillColor('#111111').text(label, left, rowY, { lineBreak: false });
        doc.font('Times-Roman').text(item.value, left + labelWidth, rowY, { width: width - labelWidth, lineGap: 0 });
        y = Math.max(rowY + bodySize + 2, doc.y + 1);
        setCursor();
      });
    }

    doc.end();
  });
}

const FILL_LINES = [
  { re: /generat|agent|\bai\b|automation/i, line: 'Applied generative AI and AI agents to automate repeatable steps, then checked the output before it moved on.' },
  { re: /rest|\bapi\b|spring/i, line: 'Traced REST API flows, handled the edge cases, and confirmed each change with functional tests.' },
  { re: /test|debug|quality/i, line: 'Logged defects, retested the fixes, and kept the module stable across review cycles.' },
  { re: /python|java|javascript/i, line: 'Stayed on the same language and stack already used for that work, and kept the changes reviewable in Git.' },
  { re: /business|stakeholder|requirement/i, line: 'Tied the build to the stated business requirement and adjusted it after review feedback.' },
  { re: /sql|mysql|data/i, line: 'Checked the underlying records with SQL so the workflow stayed consistent.' },
  { re: /react|frontend|ui/i, line: 'Wired the UI to the backend contract and verified the main user path end to end.' },
  { re: /git|review|agile/i, line: 'Worked in Git-based reviews and Agile iterations, and folded the feedback into the next change.' },
  { re: /spring|java/i, line: 'Kept Spring Boot services small, documented the request flow, and retested the path after each fix.' },
  { re: /python|automation/i, line: 'Used Python to script the repeatable parts of the workflow and validated the result before handoff.' },
  { re: /flutter|mobile|dashboard/i, line: 'Checked the dashboard path against the backend response and fixed the gaps found in testing.' },
  { re: /sql|queue|php/i, line: 'Verified the queue and database updates together so a failed step did not leave inconsistent data.' },
];

function resumeBlob(resume) {
  return [
    resume.summary,
    ...(resume.skills || []).map((item) => `${item.label} ${item.value}`),
    ...(resume.internships || []).map((item) => `${item.title} ${item.detail}`),
    ...(resume.projects || []).map((item) => `${item.name} ${item.stack} ${item.detail}`),
  ].join(' ');
}

function matchingLines(resume, keywords) {
  const haystack = `${resumeBlob(resume)} ${(keywords || []).join(' ')}`;
  const owned = resumeBlob(resume);
  return FILL_LINES.filter((item) => item.re.test(haystack) && item.re.test(owned));
}

function tightSlack(resume) {
  const doc = new PDFDocument({ size: [595.28, 841.89], margin: 0 });
  const width = 595.28 - 57.6;
  const bodySize = 10;
  const titleSize = 10.5;
  const height = (text, size, font, box, gap = 0.45) => {
    doc.font(font).fontSize(size);
    return doc.heightOfString(text || ' ', { width: box, lineGap: gap });
  };
  doc.font('Times-Bold').fontSize(bodySize);
  const labelWidth = Math.min(width * 0.38, Math.max(108, ...(resume.skills || []).map((skill) => doc.widthOfString(skill.label || 'Skills') + 14), 0));
  const blocks = [resume.summary, resume.skills?.length, resume.internships?.length, resume.projects?.length, resume.education?.length, resume.extras?.length].filter(Boolean).length;
  const used = 16.5 + 2
    + (resume.location ? 12 : 0)
    + 13
    + blocks * (titleSize + 7.2)
    + (resume.summary ? height(resume.summary, bodySize, 'Times-Roman', width) : 0)
    + (resume.skills || []).reduce((sum, skill) => sum + Math.max(bodySize + 1, height(skill.value, bodySize, 'Times-Roman', width - labelWidth, 0)) + 1, 0)
    + (resume.internships || []).reduce((sum, item) => sum + titleSize + 2 + height(item.detail, bodySize, 'Times-Roman', width) + 1, 0)
    + (resume.projects || []).reduce((sum, item) => sum + titleSize + 2 + height(item.detail, bodySize, 'Times-Roman', width) + 1, 0)
    + (resume.education || []).length * (titleSize + bodySize + 3)
    + (resume.extras || []).reduce((sum, item) => sum + height(item.value, bodySize, 'Times-Roman', width * 0.72) + 1, 0);
  doc.end();
  return 841.89 - 16.6 - used + 230;
}

async function pageBottom(resume) {
  const encoded = await renderResumePdf({}, resume, 'recommended');
  const doc = await getDocumentProxy(new Uint8Array(Buffer.from(encoded, 'base64')));
  if (doc.numPages > 1) return -1;
  const items = (await (await doc.getPage(1)).getTextContent()).items;
  return items.reduce((min, item) => Math.min(min, item.transform[5]), 9999);
}

export async function fillPageGaps(resume, keywords = []) {
  const next = {
    ...resume,
    skills: (resume.skills || []).map((item) => ({ ...item })),
    internships: (resume.internships || []).map((item) => ({ ...item })),
    projects: (resume.projects || []).map((item) => ({ ...item })),
  };
  const lines = matchingLines(next, keywords);
  const append = (text, line) => (text.includes(line.slice(0, 24)) ? text : `${text} ${line}`.trim());
  const targets = [
    ...next.internships.map((item) => ({ kind: 'detail', item })),
    ...next.projects.map((item) => ({ kind: 'detail', item })),
    { kind: 'summary' },
  ];
  let bottom = await pageBottom(next);
  let cursor = 0;
  while (bottom > 28 && lines.length && cursor < 48) {
    const line = lines[cursor % lines.length];
    const target = targets[cursor % targets.length];
    cursor += 1;
    if (target.kind === 'summary') {
      if (next.summary.includes(line.line.slice(0, 24)) || next.summary.length > 760) continue;
      const before = next.summary;
      next.summary = append(next.summary, line.line);
      const after = await pageBottom(next);
      if (after < 8) next.summary = before;
      else bottom = after;
    } else if ((target.item.detail || '').length < 560) {
      const before = target.item.detail;
      target.item.detail = append(target.item.detail || '', line.line);
      const after = await pageBottom(next);
      if (after < 8) target.item.detail = before;
      else bottom = after;
    }
  }
  const owned = resumeBlob(next).toLowerCase();
  for (const keyword of keywords || []) {
    const word = String(keyword || '').trim();
    if (word.length < 3 || !owned.includes(word.toLowerCase())) continue;
    const present = next.skills.some((skill) => `${skill.label} ${skill.value}`.toLowerCase().includes(word.toLowerCase()));
    if (present) continue;
    const row = next.skills.find((skill) => /ai|automation|language|backend|tool/i.test(skill.label)) || next.skills[0];
    if (!row || row.value.length > 155) continue;
    const before = row.value;
    row.value = `${row.value}, ${word}`;
    const after = await pageBottom(next);
    if (after < 8) row.value = before;
  }
  return next;
}

function weakSummary(text) {
  const value = String(text || '');
  if (value.length < 220) return true;
  const hits = [/java/i, /python/i, /spring/i, /intern/i, /b\.?tech/i, /algorithm/i].filter((pattern) => pattern.test(value));
  return hits.length < 2;
}

function sameEntry(item, base) {
  const left = String(item.title || item.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const right = String(base.title || base.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!left || !right) return false;
  return left.includes(right.slice(0, 14)) || right.includes(left.slice(0, 14));
}

function withSavedLinks(items, baselineItems, fallbackLabel) {
  return (items || []).map((item, index) => {
    const match = (baselineItems || []).find((base) => sameEntry(item, base)) || baselineItems?.[index];
    const url = String(item.url || '').startsWith('http') ? item.url : (match?.url || '');
    return {
      ...item,
      url,
      linkLabel: item.linkLabel || match?.linkLabel || (url ? fallbackLabel : ''),
    };
  });
}

export function mergeWithBaseline(tailored, baseline, job = {}) {
  const next = { ...tailored };
  const fill = (key) => {
    if (!next[key]?.length && baseline[key]?.length) next[key] = baseline[key];
  };
  fill('skills');
  fill('internships');
  fill('projects');
  fill('education');
  fill('extras');
  next.internships = withSavedLinks(next.internships, baseline.internships, 'Certificate');
  next.projects = withSavedLinks(next.projects, baseline.projects, 'GitHub');
  ['name', 'location', 'phone', 'email', 'linkedin', 'github'].forEach((key) => {
    if (!next[key]) next[key] = baseline[key] || '';
  });
  if (!next.name || /@|\d{4,}/.test(next.name)) next.name = baseline.name || next.name;
  if (weakSummary(next.summary)) {
    const role = [job.title, job.company].filter(Boolean).join(' at ');
    const lead = role
      ? `Targeting the ${role} role. `
      : '';
    next.summary = `${lead}${baseline.summary || next.summary || ''}`.trim();
  }
  return next;
}

function resumePlainText(profile, resume) {
  const fitted = resume.summary !== undefined ? resume : fitResumeToOnePage(resume, profile);
  return [
    fitted.name,
    fitted.location,
    [fitted.phone, fitted.email].filter(Boolean).join(' | '),
    fitted.summary,
    ...fitted.skills.map((item) => `${item.label}: ${item.value}`),
    ...fitted.internships.flatMap((item) => [`${item.title} ${item.dates}`, item.detail]),
    ...fitted.projects.flatMap((item) => [`${item.name} ${item.stack}`, item.detail]),
    ...fitted.education.map((item) => `${item.degree} ${item.school} ${item.dates} ${item.detail}`),
    ...fitted.extras.map((item) => `${item.label}: ${item.value}`),
  ].filter(Boolean).join('\n');
}

export { renderResumePdf, resumePlainText };
