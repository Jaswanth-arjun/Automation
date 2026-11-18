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

function removeInlineLinkLabel(value, linkLabel) {
  const text = clean(value, 100);
  const label = clean(linkLabel, 30);
  if (!text || !label) return text;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`\\s*(?:—|-|\\|)\\s*${escaped}\\s*$`, 'i'), '')
    .replace(new RegExp(`(?:,|;)\\s*${escaped}\\s*$`, 'i'), '')
    .trim();
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
    // An empty `internships` array must not hide real `experience` entries.
    internships: rows(
      Array.isArray(data.internships) && data.internships.length ? data.internships : data.experience,
      2,
      (item) => {
        const url = clean(item.url || item.link, 240);
        // The candidate's resume links the word "Certificate"; keep that exact word.
        const linkLabel = url ? 'Certificate' : '';
        return {
          title: removeInlineLinkLabel(item.title, linkLabel || item.linkLabel || ''),
          company: clean(item.company, 44),
          location: clean(item.location, 30),
          linkLabel,
          url,
          dates: clean(item.dates, 32),
          detail: clean(item.detail || item.description || (item.bullets || []).join(' '), 520),
        };
      },
    ).filter((item) => item.title || item.detail),
    projects: rows(data.projects, 3, (item) => {
      const url = clean(item.url || item.link, 240);
      const linkLabel = url ? 'GitHub' : '';
      return {
        name: clean(item.name, 64),
        stack: removeInlineLinkLabel(item.stack || item.tech, linkLabel || item.linkLabel || ''),
        linkLabel,
        url,
        dates: clean(item.dates, 24),
        detail: clean(item.detail, 420),
      };
    }).filter((item) => item.name || item.detail),
    education: rows(data.education, 2, (item) => ({
      degree: clean(item.degree, 70),
      school: clean(item.school, 80),
      dates: clean(item.dates, 24),
      detail: clean(item.detail || item.score, 48),
      url: clean(item.url, 220),
    })).filter((item) => item.degree || item.school),
    extras: rows(data.extras, 4, (item) => ({
      label: clean(item.label, 28),
      value: clean(item.value, 180),
      dates: clean(item.dates, 24),
    })).filter((item) => item.value),
  };
}

export function renderResumePdf(profile, resume, format = 'recommended') {
  if (format === 'modern') return renderModernResumePdf(profile, resume);
  const compact = format === 'compact';
  const fitted = resume.summary !== undefined || resume.skills?.[0]?.label !== undefined
    ? resume
    : fitResumeToOnePage(resume, profile);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = { left: 54, right: 54, top: 36, bottom: 36 };
  // Palette matching the candidate's reference LaTeX resume: black section
  // headings with black rules and blue hyperlinks. 'modern' swaps the
  // headings/rules to the accent blue; layout stays identical.
  const modern = format === 'modern';
  const sectionColor = modern ? '#1d4ed8' : '#111111';
  const linkColor = '#1649d8';         // blue for links and contact info
  const textColor = '#111111';         // body text
  const ruleColor = modern ? '#1d4ed8' : '#111111';

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
    const nameSize = compact ? 16 : 18;
    let y = margin.top;

    const labelWidth = (() => {
      doc.font('Times-Bold').fontSize(bodySize);
      const widest = Math.max(120, ...fitted.skills.map((skill) => doc.widthOfString(skill.label || 'Skills') + 16), 0);
      return Math.min(width * 0.35, widest);
    })();
    const sectionGap = compact ? 4 : 6;
    const afterRule = compact ? 2.5 : 3;
    const lineGap = compact ? 0.2 : 0.45;
    const rowGap = compact ? 0.6 : 1.2;

    const room = () => bottom - y;
    const gap = (n) => { y += n; };
    const setCursor = () => { doc.x = left; doc.y = y; };

    const drawCentered = (text, size, font, color = textColor) => {
      doc.font(font).fontSize(size).fillColor(color);
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
          // Open diamond (◇) matching the reference format
          const cx = x + diamondWidth / 2;
          const cy = y + size * 0.36;
          const arm = 2.15;
          doc.save();
          doc.moveTo(cx, cy - arm).lineTo(cx + arm, cy).lineTo(cx, cy + arm).lineTo(cx - arm, cy).closePath()
            .lineWidth(0.6).strokeColor('#555555').stroke();
          doc.restore();
        } else {
          doc.font(part.font || 'Times-Roman').fontSize(size).fillColor(part.color || textColor);
          const options = { lineBreak: false };
          if (part.link) options.link = part.link;
          doc.text(part.text, x, y, options);
        }
        x += widths[index];
      });
      y += size + 2;
      doc.fillColor(textColor);
      setCursor();
      return true;
    };

    const section = (title) => {
      if (room() < 22) return false;
      gap(sectionGap);
      doc.font('Times-Bold').fontSize(titleSize).fillColor(sectionColor);
      doc.text(title, left, y, { width, lineBreak: false });
      y += titleSize + 2;
      doc.save();
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor(ruleColor).stroke();
      doc.restore();
      y += afterRule;
      doc.fillColor(textColor);
      setCursor();
      return true;
    };

    const paragraph = (text) => {
      if (!text) return true;
      doc.font('Times-Roman').fontSize(bodySize).fillColor(textColor);
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
        doc.font(part.bold ? 'Times-Bold' : 'Times-Roman').fontSize(titleSize)
          .fillColor(part.color || textColor);
        const options = { lineBreak: false };
        if (part.link) options.link = part.link;
        doc.text(part.text, x, y, options);
        x += part.width;
      });
      if (rightText) {
        doc.font(rightFont).fontSize(titleSize).fillColor(rightPart.color || textColor);
        const options = { lineBreak: false };
        if (rightPart.link) options.link = rightPart.link;
        doc.text(rightText, right - dateWidth, y, options);
      }
      y += titleSize + 2;
      doc.fillColor(textColor);
      setCursor();
      return true;
    };

    // ─── Header: Name centered ───
    const name = (fitted.name || 'Candidate').toUpperCase();
    drawCentered(name, nameSize, 'Times-Bold', textColor);
    gap(2);

    // ─── Location line centered ───
    if (fitted.location) drawCentered(fitted.location, bodySize, 'Times-Roman', textColor);

    // ─── Contact line: phone ◇ email ◇ LinkedIn ◇ GitHub ───
    const contact = [];
    if (fitted.phone) contact.push({ text: fitted.phone, color: linkColor });
    if (fitted.email) contact.push({ text: fitted.email, color: linkColor });
    if (fitted.linkedin) contact.push({ text: 'LinkedIn', color: linkColor, link: fitted.linkedin.startsWith('http') ? fitted.linkedin : undefined });
    if (fitted.github) contact.push({ text: 'GitHub', color: linkColor, link: fitted.github.startsWith('http') ? fitted.github : undefined });
    if (contact.length) {
      const segments = [];
      contact.forEach((part, index) => {
        if (index) segments.push({ diamond: true });
        segments.push(part);
      });
      drawSegments(segments, bodySize);
    }

    // ─── Sections ───
    if (fitted.summary && section('PROFESSIONAL SUMMARY')) paragraph(fitted.summary);

    if (fitted.skills.length && section('TECHNICAL SKILLS')) {
      fitted.skills.forEach((skill) => {
        doc.font('Times-Bold').fontSize(bodySize);
        const label = skill.label || 'Skills';
        doc.font('Times-Roman').fontSize(bodySize);
        const valueHeight = doc.heightOfString(skill.value, { width: width - labelWidth - 8, lineGap: 0 });
        if (valueHeight + 1 > room()) return;
        const rowY = y;
        doc.font('Times-Bold').fontSize(bodySize).fillColor(textColor);
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
          parts.push({ text: job.linkLabel, color: linkColor, link: job.url?.startsWith('http') ? job.url : undefined });
        }
        if (!titleLine(parts, job.dates ? { text: job.dates, italic: true } : null)) return;
        paragraph(job.detail);
        gap(3);
      });
    }

    if (fitted.projects.length && section('PROJECTS')) {
      fitted.projects.forEach((project) => {
        const parts = [{ text: project.name, bold: true }];
        if (project.stack) parts.push({ text: ` \u2014 ${project.stack}` });
        // Show GitHub link right-aligned like the reference format
        const rightLink = project.linkLabel
          ? { text: project.linkLabel, color: linkColor, link: project.url?.startsWith('http') ? project.url : undefined }
          : null;
        if (!titleLine(parts, rightLink)) return;
        paragraph(project.detail);
        gap(2);
      });
    }

    // Keep the resume's established order: skills and experience first,
    // education after projects, matching the user's reference layout.
    if (fitted.education.length && section('EDUCATION')) {
      fitted.education.forEach((item) => {
        if (!titleLine([{ text: item.degree, bold: true }], item.dates ? { text: item.dates, italic: true } : null)) return;
        if (item.detail) {
          doc.font('Times-Roman').fontSize(bodySize).fillColor(textColor);
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
        doc.font('Times-Bold').fillColor(textColor).text(label, left, rowY, { lineBreak: false });
        doc.font('Times-Roman').text(item.value, left + labelWidth, rowY, { width: width - labelWidth, lineGap: 0 });
        y = Math.max(rowY + bodySize + 2, doc.y + 1);
        setCursor();
      });
    }

    doc.end();
  });
}

// ─── Modern template ──────────────────────────────────────────────────
// Reference layout, measured from the reference page (A4, 595.28pt wide):
//   centred navy name, contact row with icons, full-width navy rule,
//   navy ALL-CAPS section headings with a rule under each, justified body
//   copy, indented bullets, right-aligned dates, and a three-column
//   bulleted skills grid. Every metric below is a measured value.
const MODERN = {
  width: 595.28,
  height: 841.89,
  left: 22,
  right: 574.4,
  ruleLeft: 19.8,
  ruleRight: 576.2,
  headerRuleLeft: 13,
  headerRuleRight: 582.3,
  navy: '#122C5D',
  ink: '#000000',
  bodySize: 12.3,
  headSize: 15.4,
  nameSize: 37.8,
  bulletIndent: 24.8,
  bulletRadius: 1.55,
  bulletDotOffset: 5.3,
  skillIndent: 20.3,
  linePitch: 16.14,
  projectPitch: 15.3,
  skillsGap: 7.3,
  afterSkillsGap: 14.1,
  titleGap: 2.4,
  headingRuleGap: 14.68,
  ruleToText: 11.85,
  skillRuleToText: 8.1,
  certRuleToText: 9.6,
  blockGap: 10.7,
  eduPitch: 16.93,
  skillPitch: 15.1,
  skillCols: [24.3, 226.2, 406.7],
  ruleWidth: 1.13,
  bottom: 826,
};

function modernSkillItems(skills) {
  const items = [];
  const seen = new Set();
  (skills || []).forEach((skill) => {
    String(skill.value || '').split(/[,;]/).forEach((part) => {
      const text = part.trim();
      const key = text.toLowerCase();
      if (!text || text.length > 36 || seen.has(key)) return;
      seen.add(key);
      items.push(text);
    });
  });
  return items;
}

function modernBullets(detail, max = 6) {
  const text = String(detail || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  // Split on sentence ends only. A bare [.;] split corrupts decimals and
  // figures ("$3.5B" became "3; 5B"), so punctuation must be followed by
  // whitespace and the next sentence must start like a sentence.
  const parts = text
    .split(/(?<=[.!?;])\s+(?=[A-Z0-9$€£(])/)
    .map((part) => part.trim().replace(/[.;,:]+$/, ''))
    .filter((part) => part.length > 2);
  // Very short fragments read like broken bullets; merge them forward.
  const merged = [];
  parts.forEach((part) => {
    if (merged.length && part.length < 26) merged[merged.length - 1] = `${merged[merged.length - 1]}; ${part}`;
    else merged.push(part);
  });
  // A length cap upstream ends text with "…"; never print that half sentence
  // as a bullet unless it is the only one.
  const whole = merged.length > 1 ? merged.filter((part) => !/…$/.test(part)) : merged;
  return whole.slice(0, max)
    .map((part) => part.replace(/\s*…$/, ''))
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`));
}

function modernExtras(extras) {
  const list = extras || [];
  return {
    certs: list.filter((item) => /certif/i.test(item.label || '')),
    others: list.filter((item) => !/certif/i.test(item.label || '')),
  };
}

function modernHeaderLayout(profile, resume, doc = new PDFDocument({ autoFirstPage: false })) {
  const width = MODERN.right - MODERN.left;
  const name = clean(resume.name, 48) || clean(profile.fullName, 48) || 'Candidate';
  const nameWidth = doc.font('Times-Bold').fontSize(MODERN.nameSize).widthOfString(name);
  const nameSize = Math.min(MODERN.nameSize, MODERN.nameSize * width / nameWidth);
  const iconWidths = { mail: 13.4, phone: 11.5, linkedin: 11.5, github: 11.5 };
  const iconGap = 6.4;
  const between = 15.9;
  const pitch = 15;
  const contacts = [
    { icon: 'mail', text: resume.email },
    { icon: 'phone', text: resume.phone },
    ...['linkedin', 'github'].map((icon) => ({
      icon,
      text: String(resume[icon] || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, ''),
      link: resume[icon],
    })),
  ].filter((part) => part.text);
  let size = MODERN.bodySize;
  const measure = (part) => iconWidths[part.icon] + iconGap
    + doc.font('Times-Roman').fontSize(size).widthOfString(part.text);
  const total = () => contacts.reduce((sum, part) => sum + measure(part), 0) + between * Math.max(0, contacts.length - 1);
  while (total() > width && size > 10) size = Math.max(10, size - 0.3);

  const rows = [];
  for (const contact of contacts) {
    const itemWidth = Math.min(width, measure(contact));
    const textWidth = itemWidth - iconWidths[contact.icon] - iconGap;
    const single = doc.heightOfString('Hxg', { width, lineGap: 0 });
    const lines = Math.max(1, Math.round(doc.heightOfString(contact.text, { width: textWidth + 0.01, lineGap: 0 }) / single));
    const item = { ...contact, width: itemWidth, textWidth, iconWidth: iconWidths[contact.icon] };
    let row = rows[rows.length - 1];
    if (!row || row.width + between + itemWidth > width) {
      row = { items: [], width: 0, height: pitch };
      rows.push(row);
    }
    row.width += (row.items.length ? between : 0) + itemWidth;
    row.height = Math.max(row.height, lines * pitch);
    row.items.push(item);
  }
  return { name, nameSize, size, rows, between, iconGap, pitch, shift: Math.max(0, rows.reduce((sum, row) => sum + row.height, 0) - pitch) };
}

function renderModernResumePdf(profile, resume) {
  const fitted = resume.summary !== undefined || resume.skills?.[0]?.label !== undefined
    ? resume
    : fitResumeToOnePage(resume, profile);
  const M = MODERN;
  const width = M.right - M.left;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [M.width, M.height], margin: 0, autoFirstPage: true, bufferPages: false });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    let y = 0;

    const setFont = (font, size) => doc.font(font).fontSize(size);
    const lineWidth = (text, font = 'Times-Roman', size = M.bodySize) => {
      setFont(font, size);
      return doc.widthOfString(String(text));
    };
    /** PDFKit's natural single-line height for a font size. */
    const naturalHeight = (font, size) => {
      setFont(font, size);
      return doc.heightOfString('Hxg', { width: 1000, lineGap: 0 });
    };
    const gapFor = (pitch, font, size) => Math.max(0, pitch - naturalHeight(font, size));

    /**
     * Draw a wrapped block at an explicit y and return its height. PDFKit's
     * own `align: 'justify'` is used so the extracted text layer keeps its
     * word spaces — a hand-stretched line loses them and breaks ATS parsing.
     * The cursor advances by an exact multiple of the line pitch so section
     * spacing never drifts, whatever PDFKit's natural leading is.
     */
    const block = (text, options = {}) => {
      const size = options.size || M.bodySize;
      const font = options.font || 'Times-Roman';
      const x = options.x ?? M.left;
      const boxWidth = options.width ?? width;
      const pitch = options.pitch || M.linePitch;
      const single = naturalHeight(font, size);
      const count = Math.max(1, Math.round(doc.heightOfString(String(text), {
        width: boxWidth,
        align: options.align || 'left',
        lineGap: 0,
      }) / single));
      doc.fillColor(options.color || M.ink);
      doc.text(String(text), x, y, {
        width: boxWidth,
        align: options.align || 'left',
        lineGap: gapFor(pitch, font, size),
        link: options.link || null,
      });
      y += count * pitch;
      return count;
    };

    /** One line at an explicit x; does not move y. */
    const line = (text, options = {}) => {
      const size = options.size || M.bodySize;
      setFont(options.font || 'Times-Roman', size);
      doc.fillColor(options.color || M.ink);
      doc.text(String(text), options.x ?? M.left, y, {
        lineBreak: false,
        link: options.link || null,
      });
    };

    const heading = (title, ruleToText = M.ruleToText) => {
      if (y + M.headingRuleGap + ruleToText > M.bottom) return false;
      const capTop = y;
      line(title, { font: 'Times-Bold', size: M.headSize, color: M.navy });
      const ruleY = capTop + M.headingRuleGap;
      doc.save();
      doc.moveTo(M.ruleLeft, ruleY).lineTo(M.ruleRight, ruleY)
        .lineWidth(M.ruleWidth).strokeColor(M.navy).stroke();
      doc.restore();
      y = ruleY + ruleToText;
      return true;
    };

    const bullet = (text, pitch = M.linePitch) => {
      const boxWidth = width - M.bulletIndent;
      const dotY = y + M.bodySize * 0.3;
      doc.save();
      doc.circle(M.left + M.bulletDotOffset, dotY, M.bulletRadius).fillColor(M.navy).fill();
      doc.restore();
      block(text, {
        x: M.left + M.bulletIndent,
        width: boxWidth,
        align: 'justify',
        pitch,
      });
    };

    /** Bold left text with right-aligned parts (dates, links) on the same line. */
    const titleRow = (leftParts, rightParts = []) => {
      const size = M.bodySize;
      const rights = rightParts.filter((part) => part && part.text);
      const separator = '  |  ';
      const sepWidth = lineWidth(separator, 'Times-Roman', size);
      const rightWidth = rights.reduce((sum, part, index) => sum
        + lineWidth(part.text, 'Times-Roman', size) + (index ? sepWidth : 0), 0);
      const usable = width - (rightWidth ? rightWidth + 14 : 0);
      const rowY = y;
      // PDFKit measurements inside a continued text run can print the measurement text.
      const lineGap = gapFor(M.linePitch, 'Times-Roman', size);
      const parts = leftParts.filter((part) => part.text);
      parts.forEach((part, index) => {
        const font = part.bold ? 'Times-Bold' : 'Times-Roman';
        setFont(font, size);
        doc.fillColor(part.color || M.ink);
        const options = {
          width: usable,
          lineGap,
          continued: index < parts.length - 1,
          link: part.link || null,
        };
        if (index === 0) doc.text(part.text, M.left, rowY, options);
        else doc.text(part.text, options);
      });
      const leftHeight = Math.max(M.linePitch, doc.y - rowY);
      let rx = M.right - rightWidth;
      rights.forEach((part, index) => {
        if (index) {
          line(separator, { x: rx, size });
          rx += sepWidth;
        }
        line(part.text, { x: rx, size, color: part.color || M.ink, link: part.link });
        rx += lineWidth(part.text, 'Times-Roman', size);
      });
      y = rowY + leftHeight + M.titleGap;
    };

    const header = modernHeaderLayout(profile, fitted, doc);
    const nameWidth = lineWidth(header.name, 'Times-Bold', header.nameSize);
    y = 16.4;
    line(header.name, {
      x: M.left + (width - nameWidth) / 2,
      font: 'Times-Bold',
      size: header.nameSize,
      color: M.navy,
    });

    if (header.rows.length) {
      y = 66.6;
      header.rows.forEach((row) => {
        const midY = y + M.bodySize * 0.34;
        let x = M.left + (width - row.width) / 2;
        row.items.forEach((part, index) => {
        if (index) x += header.between;
        if (part.icon === 'mail') {
          const w = 11.4;
          const h = 8.8;
          const top = midY - h / 2;
          doc.save();
          doc.roundedRect(x, top, w, h, 0.9).fillColor(M.navy).fill();
          doc.moveTo(x + 1, top + 1).lineTo(x + w / 2, top + h * 0.62)
            .lineTo(x + w - 1, top + 1)
            .lineWidth(0.9).strokeColor('#FFFFFF').stroke();
          doc.restore();
        } else if (part.icon === 'phone') {
          const w = 9.6;
          doc.save();
          doc.translate(x + w / 2, midY);
          doc.rotate(35);
          doc.roundedRect(-4.3, -2.9, 2.8, 5.8, 1.3).fillColor(M.navy).fill();
          doc.roundedRect(1.5, -2.9, 2.8, 5.8, 1.3).fillColor(M.navy).fill();
          doc.restore();
        } else if (part.icon === 'linkedin') {
          // Drawn as shapes, not text, so the ATS text layer stays clean.
          const box = 10.8;
          const top = midY - box / 2;
          doc.save();
          doc.roundedRect(x, top, box, box, 1.5).fillColor(M.navy).fill();
          doc.fillColor('#FFFFFF');
          doc.circle(x + 2.9, top + 2.7, 0.95).fill();
          doc.rect(x + 2.1, top + 4.3, 1.6, 4.6).fill();
          doc.rect(x + 4.7, top + 4.3, 1.5, 4.6).fill();
          doc.path(`M ${x + 6.2} ${top + 5.6} C ${x + 6.6} ${top + 4.4} ${x + 8.9} ${top + 3.9} ${x + 8.9} ${top + 6.2} L ${x + 8.9} ${top + 8.9} L ${x + 7.4} ${top + 8.9} L ${x + 7.4} ${top + 6.5} C ${x + 7.4} ${top + 5.5} ${x + 6.3} ${top + 5.6} ${x + 6.2} ${top + 6.4} Z`).fill();
          doc.restore();
        } else {
          const r = 5.4;
          doc.save();
          doc.circle(x + r, midY, r).fillColor(M.navy).fill();
          doc.circle(x + r, midY - 0.4, 2.6).fillColor('#FFFFFF').fill();
          doc.rect(x + r - 1.1, midY + 1.6, 2.2, 3.2).fillColor('#FFFFFF').fill();
          doc.restore();
        }
        const textX = x + part.iconWidth + header.iconGap;
        setFont('Times-Roman', header.size);
        doc.fillColor(M.navy).text(part.text, textX, y, {
          width: part.textWidth + 0.01,
          lineGap: gapFor(header.pitch, 'Times-Roman', header.size),
          link: part.link || null,
        });
        x += part.width;
        });
        y += row.height;
      });

      doc.save();
      doc.moveTo(M.headerRuleLeft, 90.3 + header.shift).lineTo(M.headerRuleRight, 90.3 + header.shift)
        .lineWidth(M.ruleWidth).strokeColor(M.navy).stroke();
      doc.restore();
    }

    y = 104.4 + header.shift;
    if (fitted.summary && heading('PROFESSIONAL SUMMARY')) block(fitted.summary, { align: 'justify' });

    if (fitted.education.length) {
      y += M.blockGap;
      if (heading('EDUCATION')) {
        fitted.education.forEach((item, index) => {
          if (index) y += M.blockGap * 0.4;
          const school = clean(item.school, 90);
          const degree = clean(item.degree, 90);
          titleRow([{ text: school || degree, bold: true }], [{ text: item.dates, link: item.url }]);
          if (school && degree) {
            block(item.detail ? `${degree} — ${item.detail}` : degree, { pitch: M.eduPitch });
          } else if (item.detail) {
            block(item.detail, { pitch: M.eduPitch });
          }
        });
      }
    }

    if (fitted.internships.length) {
      y += M.blockGap;
      if (heading('EXPERIENCE')) {
        fitted.internships.forEach((job, index) => {
          if (index) y += M.blockGap * 0.4;
          const role = clean(job.title, 84);
          const company = clean(job.company, 56);
          const location = clean(job.location, 34);
          const head = company
            ? `${role}, ${company}${location ? ` | ${location}` : ''}`
            : role;
          const parts = [{ text: head, bold: true }];
          if (job.linkLabel && job.url) {
            parts.push({ text: ' - ' });
            parts.push({ text: job.linkLabel, color: M.navy, link: job.url });
          }
          titleRow(parts, [{ text: job.dates }]);
          modernBullets(job.detail).forEach((text) => bullet(text));
        });
      }
    }

    if (fitted.projects.length) {
      y += M.blockGap;
      if (heading('PROJECTS')) {
        fitted.projects.forEach((project, index) => {
          if (index) y += M.blockGap * 0.4;
          const parts = [{ text: clean(project.name, 82), bold: true }];
          if (project.stack) parts.push({ text: `: ${clean(project.stack, 54)}` });
          const rightParts = [{ text: project.dates }];
          if (project.linkLabel && project.url) {
            rightParts.push({ text: project.linkLabel, color: M.navy, link: project.url });
          }
          titleRow(parts, rightParts);
          modernBullets(project.detail, 5).forEach((text) => bullet(text, M.projectPitch));
        });
      }
    }

    const skillItems = modernSkillItems(fitted.skills);
    if (skillItems.length) {
      y += M.skillsGap;
      if (heading('SKILLS', M.skillRuleToText)) {
        const rowsAvailable = Math.max(1, Math.floor((M.bottom - y) / M.skillPitch));
        const visible = skillItems.slice(0, rowsAvailable * M.skillCols.length);
        const cols = M.skillCols.length;
        const rows = Math.ceil(visible.length / cols);
        const startY = y;
        visible.forEach((text, index) => {
          const col = index % cols;
          const row = Math.floor(index / cols);
          const x = M.skillCols[col];
          const rowY = startY + row * M.skillPitch;
          const room = (M.skillCols[col + 1] ?? M.right) - x - M.skillIndent - 4;
          let size = M.bodySize;
          while (size > 9.5 && lineWidth(text, 'Times-Roman', size) > room) size -= 0.3;
          doc.save();
          doc.circle(x + M.bulletDotOffset, rowY + M.bodySize * 0.3, M.bulletRadius)
            .fillColor(M.navy).fill();
          doc.restore();
          setFont('Times-Roman', size);
          doc.fillColor(M.ink);
          doc.text(text, x + M.skillIndent, rowY + (M.bodySize - size) * 0.7, { lineBreak: false });
        });
        y = startY + Math.max(1, rows) * M.skillPitch;
      }
    }

    const grouped = modernExtras(fitted.extras);
    if (grouped.certs.length) {
      y += skillItems.length ? M.afterSkillsGap : M.blockGap;
      if (heading('CERTIFICATIONS', M.certRuleToText)) {
        grouped.certs.forEach((item) => {
          titleRow([{ text: clean(item.value || item.label, 96) }], [{ text: item.dates }]);
        });
      }
    }

    if (grouped.others.length) {
      y += M.blockGap;
      if (heading('ACHIEVEMENTS & ADDITIONAL INFORMATION')) {
        grouped.others.forEach((item) => {
          bullet(`${clean(item.label, 24)}: ${clean(item.value, 190)}`);
        });
      }
    }

    doc.end();
  });
}

const escHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const safeHref = (url) => (/^https?:\/\//i.test(String(url || '')) ? escHtml(url) : '');

// Sizes are written in --u units: 1px in the in-app editor/print view (a
// 595px page) and 1pt in the Chrome PDF render (a 595pt A4 page).
const MODERN_CSS = (() => {
  const u = (n) => `calc(${n} * var(--u, 1px))`;
  const M = MODERN;
  return [
    `.resume-page.modern{font-family:"Times New Roman",Times,serif;color:#000;font-size:${u(M.bodySize)};line-height:1.312;padding:${u(6)} ${u(21)} ${u(6)}}`,
    `.resume-page.modern header{text-align:center;border-bottom:${u(M.ruleWidth)} solid ${M.navy};margin:0 ${u(-8)};padding:0 0 ${u(8)}}`,
    `.resume-page.modern h1{font-size:${u(M.nameSize)};line-height:1.15;color:${M.navy};margin:0;text-transform:none;font-weight:bold}`,
    `.resume-page.modern .contact{color:${M.navy};margin:${u(10)} ${u(8)} 0;line-height:${u(15)}}`,
    `.resume-page.modern .contact-row{display:flex;justify-content:center;gap:${u(15.9)}}`,
    `.resume-page.modern .contact-item{display:flex;align-items:flex-start;gap:${u(6.4)};min-width:0;max-width:100%}`,
    `.resume-page.modern .contact-text{min-width:0;overflow-wrap:anywhere;text-align:left}`,
    `.resume-page.modern .contact svg{flex-shrink:0;width:${u(11)};height:${u(11)};margin-top:${u(2)};fill:${M.navy}}`,
    `.resume-page.modern .contact a{color:${M.navy};text-decoration:none;overflow-wrap:anywhere}`,
    `.resume-page.modern h2{font-size:${u(M.headSize)};line-height:1.2;color:${M.navy};border-bottom:${u(M.ruleWidth)} solid ${M.navy};margin:${u(10)} 0 ${u(6)};padding:0 0 ${u(1)};font-weight:bold}`,
    `.resume-page.modern p{font-size:inherit;line-height:1.312;margin:0;text-align:justify}`,
    `.resume-page.modern article{margin:0 0 ${u(4)}}`,
    `.resume-page.modern .entry-title{display:flex;justify-content:space-between;gap:${u(14)};line-height:1.312;margin-bottom:${u(2)}}`,
    `.resume-page.modern .entry-left{min-width:0;overflow-wrap:anywhere}`,
    `.resume-page.modern .entry-right{flex-shrink:0;white-space:nowrap;margin-left:auto;text-align:right}`,
    `.resume-page.modern a{color:${M.navy};text-decoration:none}`,
    `.resume-page.modern ul{margin:0;padding:0 0 0 ${u(M.bulletIndent)}}`,
    `.resume-page.modern li{text-align:justify;line-height:1.312}`,
    `.resume-page.modern li::marker{color:${M.navy}}`,
    `.resume-page.modern ul.skills{display:grid;grid-template-columns:${u(M.skillCols[1] - M.skillCols[0])} ${u(M.skillCols[2] - M.skillCols[1])} 1fr;padding-left:${u(M.skillCols[0] - M.left + M.skillIndent)};line-height:1.22}`,
  ].join('');
})();

const MODERN_ICONS = {
  mail: '<svg viewBox="0 0 24 18"><path d="M1 0h22a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1V1a1 1 0 0 1 1-1zm1 2v.5l10 7 10-7V2L12 9z"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24"><path d="M3 1h18a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm2.5 8v10h3V9zM7 4.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zM10.5 9v10h3v-5.2c0-1.4.6-2.3 1.8-2.3s1.7.9 1.7 2.3V19h3v-6c0-2.9-1.6-4.2-3.7-4.2a3.3 3.3 0 0 0-2.8 1.5V9z"/></svg>',
  github: '<svg viewBox="0 0 24 24"><path d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.900-1.5-3.900-1.5-.5-1.300-1.300-1.700-1.300-1.700-1-.7.1-.7.1-.7 1.200.1 1.800 1.200 1.800 1.200 1 1.800 2.800 1.300 3.500 1 .1-.8.4-1.300.7-1.600-2.600-.3-5.300-1.300-5.300-5.700 0-1.300.5-2.300 1.200-3.100-.1-.3-.5-1.500.1-3.100 0 0 1-.3 3.200 1.200a11 11 0 0 1 5.800 0c2.200-1.500 3.200-1.200 3.200-1.200.6 1.600.2 2.800.1 3.100.7.8 1.200 1.800 1.200 3.100 0 4.400-2.700 5.400-5.300 5.700.4.4.8 1.100.8 2.200v3.300c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z"/></svg>',
};

/** Editable HTML that mirrors the modern PDF layout section for section. */
export function modernResumeHtml(profile, resume) {
  const data = resume.summary !== undefined || resume.skills?.[0]?.label !== undefined
    ? resume
    : fitResumeToOnePage(resume, profile);
  const anchor = (label, url) => `<a href="${safeHref(url)}" target="_blank" rel="noopener noreferrer">${escHtml(label)}</a>`;
  const link = (label, url) => (safeHref(url) && label ? anchor(label, url) : '');
  const section = (title, body) => (body ? `<h2>${title}</h2>${body}` : '');
  const titleRow = (left, right) => `<div class="entry-title"><span class="entry-left">${left}</span>${right ? `<span class="entry-right">${right}</span>` : ''}</div>`;
  const bullets = (detail, max) => {
    const list = modernBullets(detail, max);
    return list.length ? `<ul>${list.map((text) => `<li>${escHtml(text)}</li>`).join('')}</ul>` : '';
  };

  const header = modernHeaderLayout(profile, data);
  const contacts = header.rows.map((row) => `<div class="contact-row">${row.items.map((part) => {
    const text = safeHref(part.link) ? anchor(part.text, part.link) : escHtml(part.text);
    return `<span class="contact-item" style="width:calc(${part.width} * var(--u, 1px))">${MODERN_ICONS[part.icon]}<span class="contact-text">${text}</span></span>`;
  }).join('')}</div>`).join('');

  const education = (data.education || []).map((item) => {
    const school = clean(item.school, 90);
    const degree = clean(item.degree, 90);
    const second = school && degree ? (item.detail ? `${degree} — ${item.detail}` : degree) : item.detail;
    return `<article>${titleRow(`<b>${escHtml(school || degree)}</b>`, escHtml(item.dates))}${second ? `<p>${escHtml(second)}</p>` : ''}</article>`;
  }).join('');

  const experience = (data.internships || []).map((job) => {
    const role = clean(job.title, 84);
    const company = clean(job.company, 56);
    const location = clean(job.location, 34);
    const head = company ? `${role}, ${company}${location ? ` | ${location}` : ''}` : role;
    const certificate = link(job.linkLabel, job.url);
    return `<article>${titleRow(`<b>${escHtml(head)}</b>${certificate ? ` - ${certificate}` : ''}`, escHtml(job.dates))}${bullets(job.detail)}</article>`;
  }).join('');

  const projects = (data.projects || []).map((project) => {
    const stack = project.stack ? `: ${escHtml(clean(project.stack, 54))}` : '';
    const right = [escHtml(project.dates), link(project.linkLabel, project.url)].filter(Boolean).join(' | ');
    return `<article>${titleRow(`<b>${escHtml(clean(project.name, 82))}</b>${stack}`, right)}${bullets(project.detail, 5)}</article>`;
  }).join('');

  const skillItems = modernSkillItems(data.skills);
  const skills = skillItems.length ? `<ul class="skills">${skillItems.map((text) => `<li>${escHtml(text)}</li>`).join('')}</ul>` : '';

  const grouped = modernExtras(data.extras);
  const certs = grouped.certs.map((item) => titleRow(escHtml(clean(item.value || item.label, 96)), escHtml(item.dates))).join('');
  const others = grouped.others.length
    ? `<ul>${grouped.others.map((item) => `<li>${escHtml(`${clean(item.label, 24)}: ${clean(item.value, 190)}`)}</li>`).join('')}</ul>`
    : '';

  return `<div class="resume-page modern"><style>${MODERN_CSS}</style>`
    + `<header><h1 style="font-size:calc(${header.nameSize} * var(--u, 1px))">${escHtml(header.name)}</h1>${contacts ? `<div class="contact" style="font-size:calc(${header.size} * var(--u, 1px))">${contacts}</div>` : ''}</header>`
    + section('PROFESSIONAL SUMMARY', data.summary ? `<p>${escHtml(data.summary)}</p>` : '')
    + section('EDUCATION', education)
    + section('EXPERIENCE', experience)
    + section('PROJECTS', projects)
    + section('SKILLS', skills)
    + section('CERTIFICATIONS', certs)
    + section('ACHIEVEMENTS &amp; ADDITIONAL INFORMATION', others)
    + '</div>';
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

// Sections that must survive the one-page fit. A section the renderer cannot
// fit is skipped, which used to drop ACHIEVEMENTS silently.
const PAGE_SECTIONS = [
  ['PROFESSIONAL SUMMARY', (resume) => resume.summary],
  ['TECHNICAL SKILLS', (resume) => resume.skills?.length],
  ['INTERNSHIPS', (resume) => resume.internships?.length],
  ['PROJECTS', (resume) => resume.projects?.length],
  ['EDUCATION', (resume) => resume.education?.length],
  ['ACHIEVEMENTS', (resume) => resume.extras?.length],
];

// The modern template uses its own headings and splits extras into
// CERTIFICATIONS and ACHIEVEMENTS, so the checks have to follow it.
const MODERN_SECTIONS = [
  ['PROFESSIONAL SUMMARY', (resume) => resume.summary],
  ['SKILLS', (resume) => modernSkillItems(resume.skills).length],
  ['EXPERIENCE', (resume) => resume.internships?.length],
  ['PROJECTS', (resume) => resume.projects?.length],
  ['EDUCATION', (resume) => resume.education?.length],
  ['CERTIFICATIONS', (resume) => modernExtras(resume.extras).certs.length],
  ['ACHIEVEMENTS', (resume) => modernExtras(resume.extras).others.length],
];

function sectionsFor(format) {
  return format === 'modern' ? MODERN_SECTIONS : PAGE_SECTIONS;
}

/** Cut text at a sentence/word boundary, never mid-word. */
function trimText(value, ratio) {
  const text = String(value || '');
  if (!text) return text;
  const target = Math.max(60, Math.floor(text.length * ratio));
  if (target >= text.length) return text;
  const slice = text.slice(0, target);
  const sentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('; '));
  if (sentence > target * 0.55) return slice.slice(0, sentence + 1).trim();
  const space = slice.lastIndexOf(' ');
  return (space > 40 ? slice.slice(0, space) : slice).trim();
}

/** Shorten a comma-separated list by dropping whole trailing items. */
function trimList(value, ratio) {
  const items = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (items.length < 2) return String(value || '');
  const keep = Math.max(1, Math.min(items.length - 1, Math.floor(items.length * ratio)));
  return items.slice(0, keep).join(', ');
}

/**
 * Shrink the least important prose first (summary → bullets → skills) so every
 * real section keeps its place on one page instead of a whole section being
 * dropped from the bottom.
 */
function shrinkResume(resume, step) {
  const next = {
    ...resume,
    skills: (resume.skills || []).map((item) => ({ ...item })),
    internships: (resume.internships || []).map((item) => ({ ...item })),
    projects: (resume.projects || []).map((item) => ({ ...item })),
    education: (resume.education || []).map((item) => ({ ...item })),
    extras: (resume.extras || []).map((item) => ({ ...item })),
  };
  const shortenAll = (list, key, ratio) => list.forEach((item) => { item[key] = trimText(item[key], ratio); });
  switch (step) {
    case 0: next.summary = trimText(next.summary, 0.86); break;
    case 1: shortenAll(next.internships, 'detail', 0.82); break;
    case 2: shortenAll(next.projects, 'detail', 0.82); break;
    case 3: next.summary = trimText(next.summary, 0.8); shortenAll(next.extras, 'value', 0.85); break;
    case 4: next.skills.forEach((item) => { item.value = trimList(item.value, 0.85); }); break;
    case 5: shortenAll(next.internships, 'detail', 0.75); shortenAll(next.projects, 'detail', 0.75); break;
    default:
      next.summary = trimText(next.summary, 0.7);
      shortenAll(next.internships, 'detail', 0.65);
      shortenAll(next.projects, 'detail', 0.65);
      shortenAll(next.extras, 'value', 0.7);
      next.skills.forEach((item) => { item.value = trimList(item.value, 0.7); });
      break;
  }
  return next;
}

/**
 * The modern layout is spacious, so it removes one small piece per step and
 * stops at the first fit. Trailing bullets go first (gap-fill lines sit at
 * the end), then skills, then the summary, so every section stays on the
 * page. Skills lose whole items and bullets go whole, so nothing is cut.
 */
function shrinkModernResume(resume) {
  const next = {
    ...resume,
    skills: (resume.skills || []).map((item) => ({ ...item })),
    internships: (resume.internships || []).map((item) => ({ ...item })),
    projects: (resume.projects || []).map((item) => ({ ...item })),
    extras: (resume.extras || []).map((item) => ({ ...item })),
  };
  const entries = [
    ...next.internships.map((item) => ({ item, floor: 3, low: 2 })),
    ...next.projects.map((item) => ({ item, floor: 2, low: 1 })),
  ].map((entry) => ({ ...entry, count: modernBullets(entry.item.detail, 99).length }));
  const dropBullet = (key) => {
    const candidates = entries.filter((entry) => entry.count > entry[key]);
    if (!candidates.length) return false;
    const pick = candidates.reduce((best, entry) => (
      entry.count - entry[key] > best.count - best[key] ? entry : best));
    pick.item.detail = modernBullets(pick.item.detail, 99).slice(0, -1).join(' ');
    return true;
  };
  const skillCount = () => modernSkillItems(next.skills).length;
  const dropSkills = (minimum) => {
    const groups = next.skills.map((item) => String(item.value || '').split(',').map((part) => part.trim()).filter(Boolean));
    const total = groups.reduce((sum, list) => sum + list.length, 0);
    if (total <= minimum) return false;
    let remaining = Math.min(3, total - minimum);
    while (remaining > 0) {
      const largest = groups.reduce((best, list, index) => (list.length > groups[best].length ? index : best), 0);
      if (groups[largest].length < 2) break;
      groups[largest].pop();
      remaining -= 1;
    }
    next.skills.forEach((item, index) => { item.value = groups[index].join(', '); });
    return remaining < Math.min(3, total - minimum);
  };
  const dropSentence = (minimum) => {
    const sentences = String(next.summary || '').split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
    if (sentences.length <= minimum) return false;
    next.summary = sentences.slice(0, -1).join(' ');
    return true;
  };

  if (dropBullet('floor')) return next;
  if (skillCount() > 24 && dropSkills(24)) return next;
  if (dropSentence(2)) return next;
  if (dropBullet('low')) return next;
  if (skillCount() > 12 && dropSkills(12)) return next;
  if (dropSentence(1)) return next;
  next.extras.forEach((item) => {
    if (!/certif/i.test(item.label || '')) item.value = trimText(item.value, 0.85).replace(/[\s,;:—–-]+$/, '');
  });
  next.summary = trimText(next.summary, 0.86);
  return next;
}

/**
 * Render, look at what actually landed on the page, and tighten the copy until
 * every non-empty section is there on a single page.
 */
/** Section headings and their entries that must all be visible on the page. */
function missingContent(resume, text, format = 'recommended') {
  const missing = sectionsFor(format)
    .filter(([heading, present]) => present(resume) && !text.includes(heading))
    .map(([heading]) => heading);
  const started = (value) => Boolean(value) && !text.includes(String(value).slice(0, 18));
  (resume.internships || []).forEach((item) => { if (started(item.title)) missing.push(item.title); });
  (resume.projects || []).forEach((item) => { if (started(item.name)) missing.push(item.name); });
  (resume.education || []).forEach((item) => { if (started(item.school || item.degree)) missing.push(item.degree); });
  (resume.extras || []).forEach((item) => {
    // The modern template prints the certification text on its own and never
    // echoes the "Certifications" label, so check the value there.
    const marker = format === 'modern' && /certif/i.test(item.label || '')
      ? item.value
      : String(item.label || '').replace(/:$/, '');
    if (started(marker)) missing.push(marker);
  });
  return missing;
}

export async function renderFittedResumePdf(profile, resume, format = 'recommended') {
  let data = resume;
  let last = null;
  const modern = format === 'modern';
  for (let step = 0; step < (modern ? 40 : 8); step += 1) {
    const base64 = await renderResumePdf(profile, data, format);
    const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(base64, 'base64')));
    const pages = [];
    for (let page = 1; page <= pdf.numPages; page += 1) {
      pages.push((await (await pdf.getPage(page)).getTextContent()).items.map((item) => item.str).join(' '));
    }
    const text = pages.join('\n');
    last = { base64, text, pageCount: pdf.numPages, resume: data };
    if (!missingContent(data, text, format).length && pdf.numPages === 1) return last;
    data = modern ? shrinkModernResume(data) : shrinkResume(data, step);
  }
  return last;
}

async function pageBottom(resume) {
  const encoded = await renderResumePdf({}, resume, 'recommended');
  const doc = await getDocumentProxy(new Uint8Array(Buffer.from(encoded, 'base64')));
  if (doc.numPages > 1) return -1;
  const items = (await (await doc.getPage(1)).getTextContent()).items;
  const text = items.map((item) => item.str).join(' ');
  // Every non-empty section must survive the one-page fit. The renderer skips
  // a heading (and its content) when there is no room left, so a section that
  // silently vanished means the page is over-filled and more lines must not
  // be appended.
  const required = PAGE_SECTIONS.map(([heading, present]) => [heading, present(resume)]);
  if (required.some(([heading, present]) => present && !text.includes(heading))) return -1;
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

export { resumePlainText };
