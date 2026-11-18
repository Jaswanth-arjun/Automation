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
      if (!text || text.length > 46 || seen.has(key)) return;
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
    .map((part) => part.trim().replace(/[.;]$/, ''))
    .filter((part) => part.length > 2);
  // Very short fragments read like broken bullets; merge them forward.
  const merged = [];
  parts.forEach((part) => {
    if (merged.length && part.length < 26) merged[merged.length - 1] = `${merged[merged.length - 1]}; ${part}`;
    else merged.push(part);
  });
  return merged.slice(0, max);
}

function modernExtras(extras) {
  const list = extras || [];
  return {
    certs: list.filter((item) => /certif/i.test(item.label || '')),
    others: list.filter((item) => !/certif/i.test(item.label || '')),
  };
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

    /** Bold left text with an optional right-aligned date on the same line. */
    const titleRow = (leftParts, rightText, rightLink) => {
      const size = M.bodySize;
      const dateWidth = rightText ? lineWidth(rightText, 'Times-Roman', size) : 0;
      const usable = width - (dateWidth ? dateWidth + 14 : 0);
      let x = M.left;
      leftParts.forEach((part) => {
        if (!part.text) return;
        const partWidth = lineWidth(part.text, part.bold ? 'Times-Bold' : 'Times-Roman', size);
        if (x - M.left + partWidth > usable) return;
        line(part.text, {
          x,
          font: part.bold ? 'Times-Bold' : 'Times-Roman',
          size,
          color: part.color || M.ink,
          link: part.link,
        });
        x += partWidth;
      });
      if (rightText) line(rightText, { x: M.right - dateWidth, size, link: rightLink });
      y += M.linePitch + M.titleGap;
    };

    // ─── Header ───
    const name = clean(fitted.name, 48) || clean(profile.fullName, 48) || 'Candidate';
    const nameWidth = lineWidth(name, 'Times-Bold', M.nameSize);
    y = 16.4;
    line(name, {
      x: M.left + (width - nameWidth) / 2,
      font: 'Times-Bold',
      size: M.nameSize,
      color: M.navy,
    });

    const contacts = [];
    if (fitted.email) contacts.push({ icon: 'mail', text: fitted.email });
    if (fitted.phone) contacts.push({ icon: 'phone', text: fitted.phone });
    if (fitted.linkedin) {
      contacts.push({
        icon: 'linkedin',
        text: clean(fitted.linkedin.replace(/^https?:\/\//, '').replace(/\/$/, ''), 90),
        link: fitted.linkedin,
      });
    }
    if (fitted.github) {
      contacts.push({
        icon: 'github',
        text: clean(fitted.github.replace(/^https?:\/\//, '').replace(/\/$/, ''), 90),
        link: fitted.github,
      });
    }

    if (contacts.length) {
      const iconBox = { mail: 13.4, phone: 11.5, linkedin: 11.5, github: 11.5 };
      const iconGap = 6.4;
      const between = 15.9;
      y = 66.6;
      const midY = y + M.bodySize * 0.34;
      const sizes = contacts.map((part) => lineWidth(part.text));
      const total = contacts.reduce((sum, part, index) => sum
        + iconBox[part.icon] + iconGap + sizes[index], 0) + between * (contacts.length - 1);
      let x = M.left + Math.max(0, (width - total) / 2);
      contacts.forEach((part, index) => {
        if (index) x += between;
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
          x += iconBox.mail;
        } else if (part.icon === 'phone') {
          const w = 9.6;
          doc.save();
          doc.translate(x + w / 2, midY);
          doc.rotate(35);
          doc.roundedRect(-4.3, -2.9, 2.8, 5.8, 1.3).fillColor(M.navy).fill();
          doc.roundedRect(1.5, -2.9, 2.8, 5.8, 1.3).fillColor(M.navy).fill();
          doc.restore();
          x += iconBox.phone;
        } else {
          const boxSize = 10.8;
          doc.save();
          doc.roundedRect(x, midY - boxSize / 2, boxSize, boxSize, 1.5).fillColor(M.navy).fill();
          doc.restore();
          const glyph = part.icon === 'linkedin' ? 'in' : 'gh';
          const glyphWidth = lineWidth(glyph, 'Times-Bold', 7.8);
          doc.font('Times-Bold').fontSize(7.8).fillColor('#FFFFFF')
            .text(glyph, x + (boxSize - glyphWidth) / 2, midY - 3.4, { lineBreak: false });
          x += iconBox[part.icon];
        }
        x += iconGap;
        line(part.text, { x, color: M.navy, link: part.link });
        x += sizes[index];
      });

      doc.save();
      doc.moveTo(M.headerRuleLeft, 90.3).lineTo(M.headerRuleRight, 90.3)
        .lineWidth(M.ruleWidth).strokeColor(M.navy).stroke();
      doc.restore();
    }

    // ─── Sections ───
    y = 104.4;
    if (fitted.summary && heading('PROFESSIONAL SUMMARY')) block(fitted.summary, { align: 'justify' });

    if (fitted.education.length) {
      y += M.blockGap;
      if (heading('EDUCATION')) {
        fitted.education.forEach((item, index) => {
          if (index) y += M.blockGap * 0.4;
          const school = clean(item.school, 90);
          const degree = clean(item.degree, 90);
          titleRow([{ text: school || degree, bold: true }], item.dates, item.url);
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
            parts.push({ text: '  ' });
            parts.push({ text: job.linkLabel, color: M.navy, link: job.url });
          }
          titleRow(parts, job.dates);
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
          if (project.linkLabel && project.url) {
            parts.push({ text: '  ' });
            parts.push({ text: project.linkLabel, color: M.navy, link: project.url });
          }
          titleRow(parts, project.dates);
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
          doc.save();
          doc.circle(x + M.bulletDotOffset, rowY + M.bodySize * 0.3, M.bulletRadius)
            .fillColor(M.navy).fill();
          doc.restore();
          setFont('Times-Roman', M.bodySize);
          doc.fillColor(M.ink);
          doc.text(text, x + M.skillIndent, rowY, { lineBreak: false });
        });
        y = startY + Math.max(1, rows) * M.skillPitch;
      }
    }

    const grouped = modernExtras(fitted.extras);
    if (grouped.certs.length) {
      y += skillItems.length ? M.afterSkillsGap : M.blockGap;
      if (heading('CERTIFICATIONS', M.certRuleToText)) {
        grouped.certs.forEach((item) => {
          titleRow([{ text: clean(item.value || item.label, 96) }], item.dates);
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
    case 4: shortenAll(next.skills, 'value', 0.85); break;
    case 5: shortenAll(next.internships, 'detail', 0.75); shortenAll(next.projects, 'detail', 0.75); break;
    default:
      next.summary = trimText(next.summary, 0.7);
      shortenAll(next.internships, 'detail', 0.65);
      shortenAll(next.projects, 'detail', 0.65);
      shortenAll(next.extras, 'value', 0.7);
      shortenAll(next.skills, 'value', 0.7);
      break;
  }
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
  for (let step = 0; step < 8; step += 1) {
    const base64 = await renderResumePdf(profile, data, format);
    const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(base64, 'base64')));
    const pages = [];
    for (let page = 1; page <= pdf.numPages; page += 1) {
      pages.push((await (await pdf.getPage(page)).getTextContent()).items.map((item) => item.str).join(' '));
    }
    const text = pages.join('\n');
    last = { base64, text, pageCount: pdf.numPages };
    if (!missingContent(data, text, format).length && pdf.numPages === 1) return last;
    data = shrinkResume(data, step);
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
