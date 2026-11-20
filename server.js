import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import net from 'net';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import multer from 'multer';
import { LinkedInBotEngine } from './lib/bot-engine.js';
import { LinkedInTrackerEngine, setLiveSearchSessionDir, readLinkedInThread, sendLinkedInMessage } from './lib/tracker-engine.js';
import { LinkedInSessionManager } from './lib/session-manager.js';
import { db } from './lib/db.js';
import { handleRagChat } from './lib/rag-assistant.js';
import { askFreeLLM, askNara, askNvidia, askRadox } from './lib/ai-provider.js';
import { AutoApplyEngine } from './lib/auto-apply-engine.js';
import { VisionAgent } from './lib/vision-agent.js';
import { BlueprintEngine } from './lib/blueprint-engine.js';
import { getAllAnswers, saveVaultAnswer, findSimilarAnswer, saveVaultCredential, findVaultCredential } from './lib/vault-manager.js';
import { inferFromProfile } from './lib/apply-intelligence.js';

import nodemailer from 'nodemailer';
import puppeteer from 'puppeteer-core';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDocumentProxy } from 'unpdf';
import XLSX from 'xlsx';
import { fillPageGaps, fitResumeToOnePage, modernResumeHtml, renderFittedResumePdf, resumePlainText } from './lib/resume-pdf.js';
import { renderCoverLetterPdf } from './lib/cover-letter-pdf.js';
import { extractJobPostingJsonLd, extractJobPostingDescriptionHtml, validateJobDescription, keywordsFromJob, calculateKeywordCoverage, keywordMatches, parseModelJson, validateTailoredResume } from './lib/job-analysis.js';
import { buildJobDraft } from './lib/job-import.js';
import { experienceFromResumeText, extrasFromResumeText, urlsInResumeText } from './lib/resume-sections.js';
import { discoverCompanyEmployees, verifyEmailAddress } from './lib/email-discovery.js';
import { AsyncLocalStorage } from 'async_hooks';
import { registerBillingRoutes } from './lib/billing/routes.js';
import { accessForUser, accessFromRequest, applyContactAccess, consumeFeature, guardFeature, resolveUser, upgradePayload } from './lib/billing/entitlements.js';
import { FEATURE_KEYS } from './lib/billing/plans.js';
import { createSession, upsertUser } from './lib/billing/store.js';
import { campaignStore } from './lib/campaign-store.js';
import { ReferralCampaignEngine } from './lib/referral-campaign-engine.js';
import { connectMongo, isMongoActive, CandidateModel } from './lib/mongodb.js';

connectMongo().catch((err) => console.error('MongoDB startup error:', err.message));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function getSystemChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : '',
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe') : '',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

// ─── Sent Emails Data Helper ───
const sentEmailsFilePath = path.join(__dirname, 'data', 'sent_emails.json');
if (!fs.existsSync(path.dirname(sentEmailsFilePath))) fs.mkdirSync(path.dirname(sentEmailsFilePath), { recursive: true });
if (!fs.existsSync(sentEmailsFilePath)) fs.writeFileSync(sentEmailsFilePath, '[]', 'utf8');

function readSentEmails() {
  try { return JSON.parse(fs.readFileSync(sentEmailsFilePath, 'utf8')); } catch { return []; }
}
function writeSentEmails(records) {
  fs.writeFileSync(sentEmailsFilePath, JSON.stringify(records, null, 2), 'utf8');
}

// ─── Candidates + batch broadcast data helpers ───
// Every verified profile becomes a candidate row so the admin panel can filter
// by graduation batch and mail a whole cohort without exposing recipients.
const candidatesFilePath = path.join(__dirname, 'data', 'candidates.json');
const broadcastsFilePath = path.join(__dirname, 'data', 'sent_broadcasts.json');

for (const filePath of [candidatesFilePath, broadcastsFilePath]) {
  if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]', 'utf8');
}

function readJsonArray(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArray(filePath, records) {
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf8');
}

function readCandidates() {
  return readJsonArray(candidatesFilePath).filter((item) => item && item.email);
}

function writeCandidates(records) {
  writeJsonArray(candidatesFilePath, records);
  if (isMongoActive() && Array.isArray(records)) {
    for (const c of records) {
      if (!c.email) continue;
      CandidateModel.findOneAndUpdate(
        { email: c.email.toLowerCase().trim() },
        { $set: c },
        { upsert: true, returnDocument: 'after' }
      ).catch(() => { });
    }
  }
}

function cleanString(value, max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Batches are stored as a year string ("2026") whenever one is present so the
// same student cannot end up split across "2026 batch" and "2026".
function normalizeBatch(value) {
  const raw = cleanString(value, 40);
  if (!raw) return '';
  const year = raw.match(/20\d{2}/);
  if (year) return year[0];
  if (/^other$/i.test(raw)) return 'Other';
  return raw;
}

function normalizeSkills(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  const seen = new Set();
  const skills = [];
  for (const item of list) {
    const skill = cleanString(item, 60);
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    skills.push(skill);
    if (skills.length >= 30) break;
  }
  return skills;
}

function upsertCandidate(payload) {
  const email = cleanString(payload?.email, 200).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'A valid email address is required.' };

  const fullName = cleanString(payload?.fullName, 120);
  const phone = cleanString(payload?.phone, 40);
  const batch = normalizeBatch(payload?.batch);
  const institution = cleanString(payload?.institution, 160);
  const skills = normalizeSkills(payload?.skills);
  const now = new Date().toISOString();

  const list = readCandidates();
  const index = list.findIndex((item) => String(item.email).toLowerCase() === email);

  if (index >= 0) {
    const existing = list[index];
    const updated = {
      ...existing,
      email,
      fullName: fullName || existing.fullName || '',
      phone: phone || existing.phone || '',
      batch: batch || existing.batch || '',
      institution: institution || existing.institution || '',
      skills: skills.length ? skills : (Array.isArray(existing.skills) ? existing.skills : []),
      registeredAt: existing.registeredAt || now,
      lastActiveAt: now,
    };
    list[index] = updated;
    writeCandidates(list);
    return { candidate: updated, created: false };
  }

  const candidate = {
    id: crypto.randomUUID(),
    email,
    fullName,
    phone,
    batch,
    institution,
    skills,
    registeredAt: now,
    lastActiveAt: now,
  };
  list.push(candidate);
  writeCandidates(list);
  return { candidate, created: true };
}

function summarizeCandidates(list) {
  const batchCounts = {};
  for (const candidate of list) {
    const batch = normalizeBatch(candidate.batch) || 'Unassigned';
    batchCounts[batch] = (batchCounts[batch] || 0) + 1;
  }
  return { totalCandidates: list.length, batchCounts };
}

// ─── Batch broadcast helpers ───
const BROADCAST_FROM_NAME = process.env.COMPANY_MAIL_FROM_NAME || 'Hamzooh Careers';
const BROADCAST_FROM_EMAIL = process.env.COMPANY_MAIL_USER || 'job-updates@hamzooh.com';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mergeTagsFor(candidate) {
  return {
    name: candidate.fullName || 'there',
    firstname: (candidate.fullName || 'there').split(/\s+/)[0] || 'there',
    email: candidate.email || '',
    batch: candidate.batch || 'your batch',
    phone: candidate.phone || '',
    institution: candidate.institution || '',
  };
}

// Applies {{name}}, {{firstname}}, {{batch}}, {{phone}}, {{institution}} and
// {{email}} merge tags. Unknown placeholders are left untouched.
function applyMergeTags(template, candidate) {
  const values = mergeTagsFor(candidate);
  return String(template || '').replace(/\{\{\s*(name|firstname|email|batch|phone|institution)\s*\}\}/gi, (match, key) => {
    const value = values[String(key).toLowerCase()];
    return value === undefined || value === null ? match : String(value);
  });
}

function plainTextToHtml(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px;">${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

// Branded, email-client-safe wrapper. The admin's message is the inner body so
// preview and delivery always match.
function buildBroadcastEmailHtml({ htmlBody, plainText, candidate }) {
  const inner = htmlBody && String(htmlBody).trim()
    ? applyMergeTags(htmlBody, candidate)
    : plainTextToHtml(applyMergeTags(plainText, candidate));

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f5f9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e8e8e2;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <tr>
              <td style="background:#171817;padding:20px 28px;">
                <span style="display:inline-block;background:#445cf5;color:#ffffff;font-size:12px;font-weight:800;letter-spacing:.14em;padding:7px 11px;border-radius:8px;">HAMZOOH</span>
                <span style="color:#a5a8b8;font-size:12px;font-weight:600;margin-left:10px;">Career updates</span>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px 8px;color:#1f2937;font-size:15px;line-height:1.65;">
                ${inner}
              </td>
            </tr>
            <tr>
              <td style="padding:10px 28px 30px;">
                <a href="https://hamzooh.com" style="display:inline-block;background:#445cf5;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:11px 20px;border-radius:10px;">Open HAMZOOH</a>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #ecece6;padding:18px 28px;color:#94a3b8;font-size:11.5px;line-height:1.6;">
                You are receiving this because you registered on HAMZOOH.<br />
                Sent by Hamzooh Careers &lt;${escapeHtml(BROADCAST_FROM_EMAIL)}&gt;
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function candidateForClient(candidate) {
  return {
    id: candidate.id,
    email: candidate.email,
    fullName: candidate.fullName || '',
    phone: candidate.phone || '',
    batch: normalizeBatch(candidate.batch) || '',
    institution: candidate.institution || '',
    skills: Array.isArray(candidate.skills) ? candidate.skills : [],
    registeredAt: candidate.registeredAt || '',
    lastActiveAt: candidate.lastActiveAt || '',
  };
}

// Multi-tenant LinkedIn session manager (per-user isolated Chrome profiles)
const sessionManager = new LinkedInSessionManager();

wss.on('error', () => {
  // Handle WS server error silently during port retry
});

const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
// Keep the raw body so Razorpay webhooks can be signature-verified byte-for-byte.
app.use(express.json({
  limit: '15mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
// Baseline hardening: never sniff content types, never leak the app URL to
// third parties, and never let another origin frame the dashboard.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/**
 * The plan a request runs under, available to the AI engine without threading
 * a parameter through every call site. Free → gemini-2.5-flash, Pro → 2.5-pro.
 */
const aiTierStorage = new AsyncLocalStorage();

app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  let tier = 'legacy';
  try {
    tier = accessForUser(resolveUser(req)).planId;
  } catch (err) {
    console.warn('[billing] plan resolution failed:', err.message);
  }
  return aiTierStorage.run(tier, next);
});

// Subscriptions, Razorpay checkout/webhooks and the admin billing console.
registerBillingRoutes(app);

// Turn the edited HTML resume into a real PDF. This is separate from the
// original structured PDF renderer because the editor may contain newly-added
// anchor tags (LinkedIn/GitHub/certificate links) that must remain clickable.
app.post('/api/resume/render-edited-pdf', async (req, res) => {
  let browser;
  try {
    const html = String(req.body?.html || '')
      .replace(/<(?:script|iframe|object|embed|applet)[\s\S]*?<\/(?:script|iframe|object|embed|applet)>/gi, '')
      .replace(/<(?:script|iframe|object|embed|applet|meta)[^>]*\/?>/gi, '');
    if (!html.trim()) return res.status(400).json({ error: 'Edited resume content is empty.' });
    const executablePath = getSystemChromePath();
    if (!executablePath) return res.status(503).json({ error: 'Chrome browser is required to create the edited PDF.' });

    browser = await puppeteer.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; color: #111; }
      /* Chromium lays out an A4 page in CSS pixels (~794px wide). The editor
         HTML used PDF points (595px), which made edited downloads render at
         roughly 75% size with oversized margins. Use the whole printable A4
         width and point-sized typography, matching the PDFKit renderer. */
      body { font-family: "Times New Roman", Times, serif; font-size: 10pt; line-height: 1.18; }
      .resume-page { width: 100%; min-height: 100%; padding: 8.6pt 28.8pt 8pt; margin: 0; }
      .resume-page.modern { --u: 1pt; }
      .resume-page header { text-align: center; border: 0; padding: 0; margin: 0; }
      .resume-page h1 { font-size: 16.5pt; line-height: 1; margin: 0 0 3pt; text-transform: uppercase; }
      .resume-page h2 { font-size: 10.5pt; line-height: 1; border-bottom: 1px solid #222; padding: 0 0 2pt; margin: 3.2pt 0 2pt; }
      .resume-page p { font-size: 10pt; line-height: 1.18; margin: 0 0 1pt; }
      .resume-page article { margin: 0 0 2px; }
      .resume-page .entry-title { display: flex; justify-content: space-between; gap: 10px; line-height: 1.1; }
      .resume-page .skill-row { display: grid; grid-template-columns: 140pt 1fr; gap: 0; margin: 0; line-height: 1.12; }
      .resume-page a { color: #1649d8; text-decoration: none; }
      .resume-page i { font-weight: normal; }
    </style></head><body>${html}</body></html>`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts?.ready);
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    res.json({ pdfBase64: Buffer.from(pdf).toString('base64') });
  } catch (error) {
    console.error('Edited PDF render failed:', error);
    res.status(500).json({ error: error.message || 'Could not create the edited PDF.' });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// ─── Multer for logo uploads ───
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const LOGO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = LOGO_EXT[String(file.mimetype || '').toLowerCase()] || '.png';
    cb(null, `logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  // Anything else could be served back from /uploads as an executable type
  // (an .html or .svg upload would be stored XSS on this origin).
  fileFilter: (req, file, cb) => {
    const ok = Boolean(LOGO_EXT[String(file.mimetype || '').toLowerCase()]);
    cb(ok ? null : Object.assign(new Error('Upload a PNG, JPG, WebP or GIF image.'), { status: 400 }), ok);
  },
});

// ─── Jobs JSON Data Helper ───
const jobsFilePath = path.join(__dirname, 'data', 'jobs.json');
if (!fs.existsSync(path.dirname(jobsFilePath))) fs.mkdirSync(path.dirname(jobsFilePath), { recursive: true });
if (!fs.existsSync(jobsFilePath)) fs.writeFileSync(jobsFilePath, '[]', 'utf8');

function readJobs() {
  try { return JSON.parse(fs.readFileSync(jobsFilePath, 'utf8')); } catch { return []; }
}
function writeJobs(jobs) {
  fs.writeFileSync(jobsFilePath, JSON.stringify(jobs, null, 2), 'utf8');
}

// Canonical form of a job link so tracking params/protocol/case do not hide duplicates.
function normalizeJobLinkKey(value) {
  try {
    const url = new URL(String(value));
    url.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'gclid', 'fbclid', 'ref', 'source']
      .forEach((p) => url.searchParams.delete(p));
    let s = url.toString();
    while (s.endsWith('/')) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    const raw = String(value || '').trim().toLowerCase();
    return raw || null;
  }
}

// ─── Admin Dashboard Route ───
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─── Job Posting API ───
app.get('/api/jobs', (req, res) => {
  res.json(readJobs());
});

app.post('/api/jobs/upload-logo', uploadLogo.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No logo file uploaded.' });
  res.json({ path: `/uploads/${req.file.filename}` });
});

// Read a public job link and return a ready-to-review listing for the admin panel.
app.post('/api/jobs/import', async (req, res) => {
  const jobUrl = publicJobUrl(req.body?.url);
  if (!jobUrl) {
    return res.status(400).json({ error: 'Enter the complete public job link, starting with https://' });
  }
  try {
    const fetched = await fetchJobText(jobUrl.toString());
    const draft = buildJobDraft({
      // Use the line-preserving page text so the description can be formatted.
      posting: { ...fetched.posting, description: fetched.rawText || fetched.posting?.description || '' },
      meta: fetched.meta,
      openUrl: fetched.openUrl,
      applyUrl: fetched.applyUrl,
    });
    if (!draft.description) {
      return res.status(422).json({ error: 'The description on that page could not be read. Paste it manually instead.' });
    }
    const titleText = draft.title.trim();
    const genericTitle = /^(?:careers?|jobs?|job\s*(?:search|board|openings?)|home|open\s+positions?|search\s+results?)$/i.test(titleText)
      || /\b(?:careers?|jobs?|job\s*board|open\s+positions?|job\s*search)$/i.test(titleText)
      || /\bcareers?\b/i.test(titleText);
    const sectionSignals = (draft.description.match(/responsibilit|requirement|qualification|what\s+you(?:'|’)?ll\s+do|about\s+the\s+(?:role|job)|job\s+description|skills/i) || []).length;
    if (genericTitle || sectionSignals === 0) {
      return res.status(422).json({
        error: 'That link opened a careers listing rather than a single job. Open the job and copy its own address (the one with the job title).',
      });
    }
    res.json({ job: draft, sourceUrl: jobUrl.toString(), fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(422).json({ error: err.message || 'That job link could not be read.' });
  }
});

function cleanOwner(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  const email = String(value.email || '').trim();
  const name = String(value.name || value.displayName || '').trim();
  if (!id && !email) return null;
  return { id, email, name };
}

app.put('/api/jobs/:id', (req, res) => {
  const jobs = readJobs();
  const id = decodeURIComponent(req.params.id || '').trim();
  const idx = jobs.findIndex((job) => String(job.id) === id);
  if (idx === -1) return res.status(404).json({ error: 'Job not found.' });

  const { logo, role, company, filters, mustHaveSkills, goodToHaveSkills, applyLink, description, sourceUrl, postedBy } = req.body || {};
  const job = jobs[idx];
  jobs[idx] = {
    ...job,
    ...(logo !== undefined ? { logo: logo || '' } : {}),
    ...(role ? { role } : {}),
    ...(company ? { company } : {}),
    ...(filters ? { filters } : {}),
    ...(Array.isArray(mustHaveSkills) ? { mustHaveSkills } : {}),
    ...(Array.isArray(goodToHaveSkills) ? { goodToHaveSkills } : {}),
    ...(applyLink ? { applyLink } : {}),
    ...(description ? { description } : {}),
    ...(sourceUrl !== undefined ? { sourceUrl: String(sourceUrl || '') } : {}),
    ...(cleanOwner(postedBy) ? { postedBy: cleanOwner(postedBy) } : {}),
    updatedAt: new Date().toISOString(),
  };
  writeJobs(jobs);
  res.json({ message: 'Job updated successfully!', job: jobs[idx] });
});

app.post('/api/jobs', (req, res) => {
  const { logo, role, company, filters, mustHaveSkills, goodToHaveSkills, applyLink, description, sourceUrl, postedBy } = req.body || {};
  if (!role || !company || !applyLink || !description) {
    return res.status(400).json({ error: 'role, company, applyLink, and description are required.' });
  }

  // Duplicate guard: the same link, or the same role+company pair, must never
  // create a second posting. The existing job is returned so the caller can
  // reuse its id instead of posting again.
  const jobs = readJobs();
  const incomingLinks = [normalizeJobLinkKey(applyLink), normalizeJobLinkKey(sourceUrl)].filter(Boolean);
  const roleKey = String(role).toLowerCase().trim();
  const companyKey = String(company).toLowerCase().trim();
  const existing = jobs.find((job) => {
    const jobLinks = [job.applyLink, job.sourceUrl].filter(Boolean).map(normalizeJobLinkKey);
    if (incomingLinks.length && jobLinks.some((link) => incomingLinks.includes(link))) return true;
    return String(job.role || job.title || '').toLowerCase().trim() === roleKey
      && String(job.company || '').toLowerCase().trim() === companyKey;
  });
  if (existing) {
    return res.json({ message: 'This job is already posted — reusing the existing listing.', existing: true, job: existing });
  }

  const job = {
    id: crypto.randomUUID(),
    logo: logo || '',
    role,
    company,
    filters: filters || {},
    mustHaveSkills: Array.isArray(mustHaveSkills) ? mustHaveSkills : [],
    goodToHaveSkills: Array.isArray(goodToHaveSkills) ? goodToHaveSkills : [],
    applyLink,
    description,
    ...(sourceUrl ? { sourceUrl: String(sourceUrl) } : {}),
    ...(cleanOwner(postedBy) ? { postedBy: cleanOwner(postedBy) } : {}),
    postedAt: new Date().toISOString(),
  };

  jobs.push(job);
  writeJobs(jobs);

  res.json({ message: 'Job posted successfully!', job });
});

app.delete('/api/jobs/:id', (req, res) => {
  const jobs = readJobs();
  const rawTarget = decodeURIComponent(req.params.id || '').trim();

  let idx = jobs.findIndex(j => String(j.id).trim() === rawTarget);

  if (idx === -1) {
    idx = jobs.findIndex(j => String(j.id).toLowerCase() === rawTarget.toLowerCase());
  }

  if (idx === -1) {
    idx = jobs.findIndex(j => {
      const key = `${(j.role || j.title || '').toLowerCase().trim()}-${(j.company || '').toLowerCase().trim()}`;
      return key === rawTarget.toLowerCase() || (j.role || j.title || '').toLowerCase().trim() === rawTarget.toLowerCase();
    });
  }

  if (idx === -1) return res.status(404).json({ error: 'Job not found.' });

  // Delete logo file if exists
  const job = jobs[idx];
  if (job.logo && job.logo.startsWith('/uploads/')) {
    const logoFilePath = path.join(__dirname, job.logo);
    if (fs.existsSync(logoFilePath)) {
      try { fs.unlinkSync(logoFilePath); } catch { }
    }
  }

  jobs.splice(idx, 1);
  writeJobs(jobs);
  res.json({ success: true, message: 'Job deleted.', deletedId: job.id });
});

// ─── Company employees (admin form + PDF extract) ───
const employeesFilePath = path.join(__dirname, 'data', 'employees.json');
if (!fs.existsSync(employeesFilePath)) fs.writeFileSync(employeesFilePath, '[]', 'utf8');

const employeesBackupPath = path.join(__dirname, 'data', 'employees.backup.json');

function readEmployeeFile(filePath) {
  try {
    const list = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function readEmployees() {
  const main = readEmployeeFile(employeesFilePath);
  if (main.length) return main;
  const backup = readEmployeeFile(employeesBackupPath);
  if (backup.length) {
    fs.writeFileSync(employeesFilePath, JSON.stringify(backup, null, 2), 'utf8');
    return backup;
  }
  return main;
}
function writeEmployees(list) {
  const json = JSON.stringify(list, null, 2);
  fs.writeFileSync(employeesFilePath, json, 'utf8');
  fs.writeFileSync(employeesBackupPath, json, 'utf8');
}
function normalizeCompany(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function companiesMatch(a, b) {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
function findEmails(text) {
  return String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
}
const ROLE_HINT = /\b(recruiter|engineer|manager|lead|intern|director|developer|analyst|designer|founder|head|hr|talent|hiring|sde|software|consultant|architect|officer|executive|specialist)\b/i;

function cleanField(value) {
  return String(value || '').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '').replace(/[|,;]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseEmployeesFromText(text, fallbackCompany = '') {
  const rows = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const found = [];
  const seen = new Set();
  let block = [];

  const push = (partial) => {
    const email = String(partial.email || '').toLowerCase();
    if (!email || seen.has(email)) return;
    seen.add(email);
    found.push({
      name: partial.name || email.split('@')[0].replace(/[._]/g, ' '),
      role: partial.role || '',
      email,
      company: partial.company || fallbackCompany || '',
      details: partial.details || '',
    });
  };

  const consume = (row, emails) => {
    const cells = row.split(/\s+\|\s+|[|,\t;]+/).map(cleanField).filter(Boolean);
    const candidates = [...block.map(cleanField).filter(Boolean), ...cells];
    emails.forEach((rawEmail) => {
      const email = rawEmail.toLowerCase();
      const own = candidates.filter((c) => !c.toLowerCase().includes(email));
      const role = [...own].reverse().find((c) => ROLE_HINT.test(c)) || '';
      let company = [...own].reverse().find((c) => c !== role && companiesMatch(c, fallbackCompany)) || '';
      if (!company) {
        company = [...own].reverse().find((c) => c !== role && !ROLE_HINT.test(c) && c.split(' ').length <= 4 && /(?:inc|ltd|pvt|llc|technologies|labs)\b/i.test(c)) || fallbackCompany || '';
      }
      const name = [...own].reverse().find((c) => c !== role && !companiesMatch(c, company) && !ROLE_HINT.test(c)) || '';
      push({
        name,
        role,
        email,
        company: company || fallbackCompany,
        details: [...block, row].filter(Boolean).join(' | '),
      });
    });
    block = [];
  };

  rows.forEach((row) => {
    const emails = findEmails(row);
    if (!emails.length) {
      block.push(row);
      if (block.length > 8) block.shift();
      return;
    }
    consume(row, emails);
  });

  return found;
}

async function pdfToRows(pdf) {
  const rows = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const grouped = new Map();
    for (const item of content.items) {
      const str = String(item.str || '').trim();
      if (!str) continue;
      const y = Math.round((item.transform?.[5] || 0) / 2) * 2;
      const x = item.transform?.[4] || 0;
      const key = `${pageNumber}:${y}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ x, str });
    }
    const keys = [...grouped.keys()].sort((a, b) => {
      const [pageA, yA] = a.split(':').map(Number);
      const [pageB, yB] = b.split(':').map(Number);
      if (pageA !== pageB) return pageA - pageB;
      return yB - yA;
    });
    keys.forEach((key) => {
      const line = grouped.get(key).sort((a, b) => a.x - b.x).map((part) => part.str).join(' | ');
      if (line.trim()) rows.push(line.trim());
    });
  }
  return rows.join('\n');
}

async function pdfToLinks(pdf) {
  // Each annotation rect sits on the visible word it belongs to ("Certificate",
  // "GitHub", the email address), so keep the words on that line with the URL.
  // The tailored resume uses them to put the Drive certificate under the right
  // internship and each repo under its own project.
  const links = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const annotations = await page.getAnnotations();
    if (!annotations.length) continue;
    const content = await page.getTextContent();
    const items = content.items
      .map((item) => ({
        str: String(item.str || '').trim(),
        x: item.transform?.[4] || 0,
        y: item.transform?.[5] || 0,
        width: item.width || 0,
      }))
      .filter((item) => item.str);
    const rows = new Map();
    items.forEach((item) => {
      const key = Math.round(item.y / 4);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(item);
    });
    rows.forEach((row) => row.sort((a, b) => a.x - b.x));
    for (const annotation of annotations) {
      const url = String(annotation?.url || annotation?.unsafeUrl || '').trim();
      if (!/^https?:\/\//i.test(url)) continue;
      const rect = Array.isArray(annotation.rect) ? annotation.rect : null;
      let context = '';
      let label = '';
      if (rect) {
        const [, bottom, , top] = rect;
        const centerY = (bottom + top) / 2;
        const rowKey = [...rows.keys()].reduce((best, key) => {
          const rowY = key * 4;
          if (!best) return key;
          return Math.abs(rowY - centerY) < Math.abs(best * 4 - centerY) ? key : best;
        }, 0);
        const row = rows.get(rowKey) || [];
        context = row.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim();
        // The linked word is the one whose glyph box overlaps the annotation.
        label = row
          .filter((item) => item.x + item.width >= rect[0] - 2 && item.x <= rect[2] + 2)
          .map((item) => item.str)
          .join(' ')
          .trim();
      }
      links.push({ url, label, context });
    }
  }
  const seen = new Set();
  return links.filter((link) => {
    if (!link.url || seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function saveEmployeeRecords(records, source) {
  const all = readEmployees();
  const saved = [];
  for (const rec of records) {
    if (!rec.email || !rec.name) continue;
    const duplicate = all.find(e => e.email === rec.email && companiesMatch(e.company, rec.company));
    if (duplicate) continue;
    const row = {
      id: crypto.randomUUID(),
      name: rec.name,
      company: rec.company || '',
      role: rec.role || '',
      email: rec.email,
      details: rec.details || '',
      source,
      createdAt: new Date().toISOString(),
    };
    all.unshift(row);
    saved.push(row);
  }
  writeEmployees(all);
  return saved;
}

const LIST_FILE = /\.(pdf|xlsx|xls|csv)$/i;

function columnValue(row, keys) {
  for (const [key, value] of Object.entries(row)) {
    const norm = String(key || '').toLowerCase().replace(/[^a-z]/g, '');
    const text = String(value ?? '').trim();
    if (!text) continue;
    if (keys.some((hint) => norm === hint || norm.includes(hint))) return text;
  }
  return '';
}

function parseEmployeesFromSheetRows(rows, fallbackCompany = '') {
  const found = [];
  for (const row of rows) {
    const email = columnValue(row, ['email', 'emailid', 'mail', 'emailaddress']).toLowerCase();
    if (!email.includes('@')) continue;
    const name = columnValue(row, ['name', 'fullname', 'employeename', 'contact']);
    const role = columnValue(row, ['role', 'title', 'designation', 'position', 'jobtitle']);
    const company = columnValue(row, ['company', 'companyname', 'organization', 'organisation']) || fallbackCompany;
    const used = new Set(['email', 'emailid', 'mail', 'emailaddress', 'name', 'fullname', 'employeename', 'contact', 'role', 'title', 'designation', 'position', 'jobtitle', 'company', 'companyname', 'organization', 'organisation']);
    const details = Object.entries(row)
      .filter(([key, value]) => {
        const norm = String(key).toLowerCase().replace(/[^a-z]/g, '');
        return value != null && String(value).trim() && ![...used].some((hint) => norm === hint || norm.includes(hint));
      })
      .map(([key, value]) => `${key}: ${String(value).trim()}`)
      .join(' | ');
    found.push({
      name: name || email.split('@')[0].replace(/[._]/g, ' '),
      role,
      email,
      company,
      details,
    });
  }
  return found;
}

function parseEmployeesFromWorkbook(buffer, fallbackCompany) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const found = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    const fromColumns = parseEmployeesFromSheetRows(rows, fallbackCompany);
    if (fromColumns.length) {
      found.push(...fromColumns);
      continue;
    }
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    const text = matrix.map((line) => (Array.isArray(line) ? line.join(' | ') : String(line))).join('\n');
    found.push(...parseEmployeesFromText(text, fallbackCompany));
  }
  return found;
}

const uploadList = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = LIST_FILE.test(file.originalname || '');
    cb(ok ? null : Object.assign(new Error('Upload a PDF or Excel file.'), { status: 400 }), ok);
  },
});

app.get('/api/employees', async (req, res) => {
  const company = String(req.query.company || '').trim();
  const autoDiscover = String(req.query.autoDiscover || 'true').toLowerCase() !== 'false';
  const all = readEmployees();
  let list = company ? all.filter(e => companiesMatch(e.company, company)) : all;

  // If a company is specified and no employees exist yet, automatically discover them
  if (company && list.length === 0 && autoDiscover) {
    try {
      console.log(`[Employee Discovery] No contacts found for "${company}". Auto-discovering from multi-source engine...`);
      const result = await discoverCompanyEmployees({
        company,
        jobTitle: String(req.query.jobTitle || '').trim(),
        existingEmployees: all,
      });
      if (result.contacts && result.contacts.length > 0) {
        saveEmployeeRecords(result.contacts.map((c) => ({
          name: c.name,
          company: c.company || company,
          role: c.role,
          email: c.email,
          details: c.source || 'Auto-Discovered',
        })), 'auto-discovery');
        list = readEmployees().filter(e => companiesMatch(e.company, company));
        console.log(`[Employee Discovery] Discovered and saved ${list.length} contacts for "${company}".`);
      }
    } catch (err) {
      console.warn(`[Employee Discovery] Auto-discovery failed for "${company}":`, err.message);
    }
  }

  // Free users unlock the first 5 contacts for this company; the rest are
  // returned blurred. Locked emails never leave the server.
  const access = accessForUser(resolveUser(req));
  const gated = applyContactAccess(list, access);
  res.json(gated.contacts);
});

app.post('/api/employees/discover', async (req, res) => {
  const { company, jobUrl, jobHtml, jobTitle } = req.body || {};
  if (!company && !jobUrl) {
    return res.status(400).json({ error: 'Company name or job URL is required for discovery.' });
  }
  try {
    const all = readEmployees();
    const result = await discoverCompanyEmployees({
      company: String(company || '').trim(),
      jobUrl: String(jobUrl || '').trim(),
      jobHtml: String(jobHtml || '').trim(),
      jobTitle: String(jobTitle || '').trim(),
      existingEmployees: all,
    });
    if (result.contacts && result.contacts.length > 0) {
      saveEmployeeRecords(result.contacts.map((c) => ({
        name: c.name,
        company: c.company || company,
        role: c.role,
        email: c.email,
        details: c.source || 'Auto-Discovered',
      })), 'auto-discovery');
    }
    const updated = readEmployees().filter(e => companiesMatch(e.company, company || result.company));
    const access = accessForUser(resolveUser(req));
    const gated = applyContactAccess(updated, access);
    res.json({
      success: true,
      company: company || result.company,
      domain: result.domain,
      mailServerVerified: result.mailServerVerified,
      mailProvider: result.mailProvider,
      contacts: gated.contacts,
      contactAccess: gated.access,
    });
  } catch (err) {
    console.error('[Employee Discovery] Error:', err);
    res.status(500).json({ error: err.message || 'Discovery failed' });
  }
});

app.post('/api/employees/verify-email', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address is required.' });
  }
  try {
    const verdict = await verifyEmailAddress(email, 5000);
    res.json(verdict);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Email verification failed' });
  }
});

app.post('/api/employees/bulk', (req, res) => {
  const incoming = Array.isArray(req.body?.employees) ? req.body.employees : [];
  const records = incoming.map((row) => ({
    name: String(row.name || '').trim(),
    company: String(row.company || '').trim(),
    role: String(row.role || '').trim(),
    email: String(row.email || '').trim().toLowerCase(),
    details: String(row.details || '').trim(),
  })).filter((row) => row.email && row.name);
  saveEmployeeRecords(records, 'saved');
  res.json({ employees: readEmployees() });
});

app.post('/api/employees', (req, res) => {
  const { name, company, role, email, details } = req.body || {};
  if (!name || !company || !role || !email) {
    return res.status(400).json({ error: 'name, company, role, and email are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  const saved = saveEmployeeRecords([{
    name: String(name).trim(),
    company: String(company).trim(),
    role: String(role).trim(),
    email: String(email).trim().toLowerCase(),
    details: String(details || '').trim(),
  }], 'manual');
  if (!saved.length) return res.status(409).json({ error: 'This employee email is already saved for that company.' });
  res.json({ employee: saved[0] });
});

app.post('/api/resume/extract-text', uploadList.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a resume PDF.' });
  try {
    if (!/\.pdf$/i.test(req.file.originalname || '')) return res.json({ text: '' });
    const pdf = await getDocumentProxy(new Uint8Array(req.file.buffer));
    const text = await pdfToRows(pdf);
    const linkItems = await pdfToLinks(pdf);
    const links = [...new Set(linkItems.map((item) => item.url))];
    res.json({ text: String(text || '').slice(0, 20000), links, linkItems });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not read that resume.' });
  }
});

app.post('/api/employees/upload-pdf', uploadList.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF or Excel employee list.' });
  try {
    const fallbackCompany = String(req.body?.company || '').trim();
    const filename = req.file.originalname || '';
    let extracted = [];
    let source = 'pdf';
    if (/\.(xlsx|xls|csv)$/i.test(filename)) {
      source = 'excel';
      extracted = parseEmployeesFromWorkbook(req.file.buffer, fallbackCompany);
    } else {
      const pdf = await getDocumentProxy(new Uint8Array(req.file.buffer));
      const text = await pdfToRows(pdf);
      extracted = parseEmployeesFromText(text, fallbackCompany);
    }
    if (!extracted.length) {
      return res.status(400).json({ error: 'No employee email addresses were found in that file.' });
    }
    const saved = saveEmployeeRecords(extracted, source);
    res.json({
      extracted: extracted.length,
      saved: saved.length,
      employees: saved,
      skipped: extracted.length - saved.length,
    });
  } catch (err) {
    console.error('Employee list extract failed:', err);
    res.status(500).json({ error: 'Could not read that file. Use a PDF or Excel list with name, role, company, and email columns.' });
  }
});

app.delete('/api/employees/:id', (req, res) => {
  const all = readEmployees();
  const next = all.filter(e => e.id !== req.params.id);
  if (next.length === all.length) return res.status(404).json({ error: 'Employee not found.' });
  writeEmployees(next);
  res.json({ ok: true });
});

// ─── Google OAuth 2.0 Configuration & Storage ───
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/gmail/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const GOOGLE_LOGIN_SCOPES = 'openid email profile';
const GOOGLE_GMAIL_SCOPES = 'https://mail.google.com/ https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

const gmailTokensFilePath = path.join(__dirname, 'data', 'gmail_tokens.json');
if (!fs.existsSync(path.dirname(gmailTokensFilePath))) fs.mkdirSync(path.dirname(gmailTokensFilePath), { recursive: true });
if (!fs.existsSync(gmailTokensFilePath)) fs.writeFileSync(gmailTokensFilePath, '{}', 'utf8');

function readGmailTokens() {
  try { return JSON.parse(fs.readFileSync(gmailTokensFilePath, 'utf8')); } catch { return {}; }
}
function writeGmailTokens(tokens) {
  fs.writeFileSync(gmailTokensFilePath, JSON.stringify(tokens, null, 2), 'utf8');
}

async function getValidAccessToken() {
  const tokens = readGmailTokens();
  if (!tokens.connected || !tokens.refresh_token) return null;

  if (tokens.access_token && tokens.expiry_date && (tokens.expiry_date - 60000 > Date.now())) {
    return tokens.access_token;
  }

  try {
    const refreshParams = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token'
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshParams.toString()
    });

    const data = await res.json();
    if (data.access_token) {
      tokens.access_token = data.access_token;
      tokens.expiry_date = Date.now() + (data.expires_in * 1000);
      writeGmailTokens(tokens);
      return data.access_token;
    }
  } catch (err) {
    console.error('Error refreshing Google access token:', err);
  }
  return tokens.access_token || null;
}

function buildGoogleAuthUrl(scopes, state, prompt) {
  const redirectUri = encodeURIComponent(GOOGLE_REDIRECT_URI);
  const scope = encodeURIComponent(scopes);
  return `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${redirectUri}&scope=${scope}&access_type=offline&include_granted_scopes=false&prompt=${prompt}&state=${encodeURIComponent(state)}`;
}

async function fetchGoogleUserInfo(accessToken) {
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return userRes.json();
}

function getGeminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const files = [path.join(__dirname, '.env'), path.join(__dirname, 'Hamzooh', '.env'), path.join(__dirname, 'MailMind AI', '.env')];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const match = fs.readFileSync(file, 'utf8').match(/^GEMINI_API_KEY=(.*)$/m);
    if (match && match[1].trim() && !match[1].includes('your_gemini')) return match[1].trim();
  }
  return '';
}

async function askGemini(prompt) {
  const providerErrors = [];
  const recordProviderError = (provider, error) => {
    const message = String(error?.message || error || 'Unknown provider error')
      .replace(/(?:sk-[a-z0-9_-]+|cc_op_[a-z0-9_-]+|AQ\.[a-z0-9_-]+)/gi, '[redacted]')
      .slice(0, 220);
    providerErrors.push(`${provider}: ${message}`);
    console.warn(`${provider} unavailable:`, message);
  };
  const isTransient = (error) => /\b(408|425|429|500|502|503|504)\b|timeout|timed out|abort|temporarily unavailable|service unavailable/i.test(String(error?.message || error));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Plan-aware engine: Free runs the fast model, Pro runs the premium one.
  const tier = aiTierStorage.getStore();
  const planModel = tier === 'pro' ? 'gemini-2.5-pro' : tier === 'free' ? 'gemini-2.5-flash' : '';
  const flashFirst = tier === 'free';

  // RadoxAI / Coarena is the primary high-speed OpenAI-compatible provider.
  const radoxEnabled = String(process.env.ENABLE_RADOX_FALLBACK || 'true').toLowerCase() !== 'false';
  if (radoxEnabled && (process.env.RADOX_API_KEY || process.env.RADOXAI_API_KEY)) {
    const rawModel = String(process.env.RADOX_MODEL || 'gpt-6-luna').replace(/\./g, '-');
    const radoxModels = [...new Set([rawModel, 'gpt-6-luna', 'deepseek-v4.1-flash-1017', 'gemini-3.8-flash'])];
    for (const rModel of radoxModels) {
      try {
        return await askRadox([{ role: 'user', content: prompt }], { model: rModel, maxTokens: 3000, temperature: 0.1 });
      } catch (radoxError) {
        recordProviderError(`RadoxAI (${rModel})`, radoxError);
      }
    }
  } else if (!radoxEnabled) {
    providerErrors.push('RadoxAI: disabled by ENABLE_RADOX_FALLBACK=false');
  }

  // Nara Router fallback.
  if (process.env.BYNARA_API_KEY || process.env.NARA_API_KEY) {
    const rawNara = String(process.env.BYNARA_MODEL || 'gpt-6-luna').replace(/\./g, '-');
    const naraModels = [...new Set([rawNara, 'gpt-6-luna'])];
    for (const naraModel of naraModels) {
      try {
        return await askNara([{ role: 'user', content: prompt }], { model: naraModel, maxTokens: 3000, temperature: 0.1 });
      } catch (naraError) {
        recordProviderError(`Nara (${naraModel})`, naraError);
        // Do not block on non-transient auth/not found errors
        if (!isTransient(naraError)) break;
      }
    }
  }

  // Gemini is the primary tailoring provider. Prefer generally-available
  // Flash text models: preview Pro/image/TTS models commonly consume a
  // different quota or are unavailable to new API projects.
  const apiKey = getGeminiKey();
  let geminiError = null;
  if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const requestedModel = String(process.env.GEMINI_MODEL || '').trim().replace(/^models\//, '') || planModel;
    let modelNames = requestedModel ? [requestedModel] : [];
    try {
      // Do not guess model IDs: model availability is account/project specific
      // and retired IDs return 404 even when the API key itself is valid.
      const catalogResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
      if (catalogResponse.ok) {
        const catalog = await catalogResponse.json();
        const available = (catalog.models || [])
          .filter((item) => (item.supportedGenerationMethods || []).includes('generateContent'))
          .map((item) => String(item.name || '').replace(/^models\//, ''))
          .filter((name) => /^gemini-/i.test(name) && !/embedding|aqa|robotics|image|tts|audio|computer/i.test(name));
        if (!requestedModel) {
          const preferPro = flashFirst ? false : String(process.env.GEMINI_PREFER_PRO || 'true').toLowerCase() !== 'false';
          const rank = (name) => {
            const flash = /flash/i.test(name) ? (preferPro ? 10 : 40) : 0;
            const preview = /preview/i.test(name) ? -20 : 0;
            const pro = /pro/i.test(name) ? (preferPro ? 50 : -10) : 0;
            const number = Number((name.match(/gemini-(\d+(?:\.\d+)?)/i) || [])[1] || 0);
            return flash + number + preview + pro;
          };
          modelNames = [...new Set(available)].sort((a, b) => rank(b) - rank(a));
        } else if (!available.includes(requestedModel)) {
          console.warn(`Configured Gemini model ${requestedModel} is not available to this API key; using an available catalog model.`);
          modelNames = [...new Set(available)];
        }
      }
    } catch (catalogError) {
      console.warn('Could not read Gemini model catalog; using configured/default candidates:', String(catalogError.message || catalogError).slice(0, 180));
    }
    if (!modelNames.length) modelNames = ['gemini-2.5-flash', 'gemini-2.0-flash'];

    for (const modelName of modelNames) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        if (text?.trim()) return text.trim();
        geminiError = new Error(`Gemini ${modelName} returned an empty response.`);
      } catch (err) {
        geminiError = err;
        recordProviderError(`Gemini ${modelName}`, err);
        // 429 is project/key quota exhaustion, not a model-specific failure.
        // Retrying every catalog model only creates a long noisy startup and
        // cannot increase the remaining quota.
        if (/\b429\b|too many requests|quota/i.test(String(err.message || err))) break;
      }
    }
  } else {
    geminiError = new Error('Gemini API key is not configured.');
    providerErrors.push('Gemini: API key is not configured');
  }

  // NVIDIA is the first fallback for Gemini quota failures. It uses the same
  // OpenAI-compatible chat format and is suitable for the JSON resume prompt.
  try {
    return await askNvidia([{ role: 'user', content: prompt }], { maxTokens: 2200, temperature: 0.1 });
  } catch (nvidiaError) {
    recordProviderError('NVIDIA', nvidiaError);
  }

  // FreeLLMAPI is the final fallback. It is useful as an availability
  // fallback, but should not silently replace the configured Pro model.
  try {
    return await askFreeLLM([{ role: 'user', content: prompt }]);
  } catch (freeError) {
    recordProviderError('FreeLLMAPI', freeError);
    const detail = providerErrors.join(' | ');
    throw new Error(`All configured AI providers failed. ${detail}`);
  }
}

function decodeGmailBody(payload) {
  if (!payload) return '';
  const decode = (data) => Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  if (payload.body?.data) {
    const text = decode(payload.body.data);
    return payload.mimeType === 'text/html' ? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : text;
  }
  for (const part of payload.parts || []) {
    const text = decodeGmailBody(part);
    if (text) return text;
  }
  return '';
}

function gmailHeader(payload, name) {
  return (payload?.headers || []).find((header) => header.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function parseMailboxAddress(raw) {
  const value = String(raw || '').trim();
  const match = value.match(/^(.*)<([^>]+)>\s*$/);
  if (!match) return { name: value || 'Unknown', email: value };
  return { name: match[1].replace(/"/g, '').trim() || match[2].trim(), email: match[2].trim() };
}

const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com',
  'mail.com', 'zoho.com', 'rediffmail.com', 'yandex.com', 'gmx.com', 'fastmail.com',
]);

// Applicant tracking systems send on behalf of many companies, so their domain
// must not be used as the company name.
const ATS_EMAIL_DOMAINS = new Set([
  'greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'workday.com', 'myworkdayjobs.com',
  'smartrecruiters.com', 'icims.com', 'taleo.net', 'successfactors.com', 'ashbyhq.com',
  'hackerrank.com', 'codility.com', 'hirevue.com', 'naukri.com', 'unstop.com',
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'wellfound.com', 'internshala.com',
  'superset.com', 'mynexthire.com', 'jobvite.com', 'bamboohr.com', 'recruitee.com',
  'freshteam.com', 'zohorecruit.com', 'keka.com', 'darwinbox.com', 'rippling.com',
]);

// Consumer/tech platforms that appear in every inbox but are not employers.
const SUPPRESS_COMPANY_DOMAINS = new Set([
  'google.com', 'microsoft.com', 'apple.com', 'github.com', 'openai.com', 'chatgpt.com',
  'anthropic.com', 'notion.so', 'slack.com', 'zoom.us', 'dropbox.com', 'amazon.com',
  'cloudflare.com', 'adobe.com', 'atlassian.com', 'meta.com', 'facebook.com',
  'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'vercel.com', 'netlify.com',
]);

function domainMatches(domain, domains) {
  if (!domain) return false;
  for (const known of domains) {
    if (domain === known || domain.endsWith(`.${known}`)) return true;
  }
  return false;
}

const SUBJECT_COMPANY_STOPWORDS = new Set([
  'connected', 'account', 'accounts', 'application', 'applications', 'interview',
  'interviews', 'referral', 'referrals', 'your', 'our', 'my', 'the', 'this',
  'that', 'thanks', 'thank', 'you', 'team', 'role', 'position', 'job', 'opportunity',
  'hiring', 'careers', 'career', 'company', 'recruiter', 'senior', 'junior',
  'internship', 'intern', 'remote', 'us', 'me', 'all', 'a', 'an',
]);

const MAIL_SIGNAL_META = {
  OFFER: { label: 'Offer', priority: 100, needsReply: true, job: true },
  INTERVIEW: { label: 'Interview', priority: 92, needsReply: true, job: true },
  ASSESSMENT: { label: 'Assessment', priority: 84, needsReply: true, job: true },
  SHORTLISTED: { label: 'Shortlisted', priority: 74, needsReply: true, job: true },
  RECRUITER: { label: 'Recruiter', priority: 62, needsReply: true, job: true },
  REJECTED: { label: 'Update', priority: 45, needsReply: false, job: true },
  APPLIED: { label: 'Applied', priority: 55, needsReply: false, job: true },
  NEWSLETTER: { label: 'Newsletter', priority: 6, needsReply: false, job: false },
  OTHER: { label: 'General', priority: 20, needsReply: false, job: false },
};

function categorizeMail(subject, snippet) {
  const text = `${subject || ''} ${snippet || ''}`.toLowerCase();
  if (/unsubscribe|newsletter|digest|roundup|weekly update/.test(text)) return 'Newsletters';
  if (/interview|recruiter|hiring|job|application|referral|career|opening|position|role/.test(text)) return 'Job/Recruitment';
  if (/notification|alert|security|no-reply|noreply|verification|receipt|invoice/.test(text)) return 'Notifications';
  if (/meeting|project|update|follow/.test(text)) return 'Work/Professional';
  return 'Uncategorized';
}

// Deterministic, explainable signal. Never calls an LLM, so it runs for every
// message and gives the UI an honest label instead of a black-box guess.
function detectMailSignal(subject, snippet, bodyText = '') {
  const text = `${subject || ''} ${snippet || ''} ${String(bodyText || '').slice(0, 2500)}`.toLowerCase();

  if (/offer letter|offer of employment|pleased to offer|delighted to offer|we are offering you/.test(text)) return 'OFFER';
  if (/\bregret\b|unfortunately|not (?:be )?(?:moving forward|selected|progressing)|unsuccessful|we have decided not|cannot offer|position has been filled/.test(text)) return 'REJECTED';
  if (/interview|technical round|hr round|schedule (?:a|your) call|hiring manager (?:would like|wants) to (?:speak|talk)|panel discussion/.test(text)) return 'INTERVIEW';
  if (/assessment|online test|coding (?:test|challenge|assignment)|hackerrank|codility|take[- ]home|aptitude test|\boa\b/.test(text)) return 'ASSESSMENT';
  if (/shortlist|selected for (?:the )?next|next round|move(?:d)? forward/.test(text)) return 'SHORTLISTED';
  if (/application (?:received|submitted)|thanks? for applying|we received your application|successfully applied/.test(text)) return 'APPLIED';
  if (/recruiter|talent acquisition|hiring manager|referral|opportunit|open role|job opening|position at/.test(text)) return 'RECRUITER';
  return 'OTHER';
}

function extractCompanyFromEmail(fromEmail, subject = '') {
  const email = String(fromEmail || '').trim().toLowerCase();
  const domain = email.includes('@') ? email.split('@').pop() : '';

  if (!domain || domainMatches(domain, PUBLIC_EMAIL_DOMAINS) || domainMatches(domain, SUPPRESS_COMPANY_DOMAINS)) {
    const match = String(subject || '').match(/\b(?:at|with|from|to)\s+([A-Z][A-Za-z0-9&.\-]{2,32})/);
    if (!match) return '';
    const candidate = match[1].replace(/[.,].*$/, '').trim();
    // Filter out common English words that follow "from/at" in ordinary prose
    // ("from Connected Account", "at Your Earliest").
    if (SUBJECT_COMPANY_STOPWORDS.has(candidate.toLowerCase())) return '';
    return candidate;
  }
  if (domainMatches(domain, ATS_EMAIL_DOMAINS)) return '';

  const skip = new Set([
    'mail', 'email', 'careers', 'career', 'jobs', 'job', 'recruiting', 'recruitment',
    'talent', 'hr', 'no-reply', 'noreply', 'notifications', 'notify', 'hello', 'team',
    'info', 'support', 'accounts', 'account', 'security', 'noreply-mail',
  ]);
  const labels = domain.split('.');
  let pick = labels[0];
  if (skip.has(pick) && labels.length > 2) pick = labels[1];
  if (!pick) return '';
  return pick
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function analyzeMailSignal({ subject, snippet, bodyText, fromEmail, mailbox = 'INBOX', receivedAt }) {
  const signal = detectMailSignal(subject, snippet, bodyText);
  const meta = MAIL_SIGNAL_META[signal] || MAIL_SIGNAL_META.OTHER;
  const company = extractCompanyFromEmail(fromEmail, subject);
  const ageHours = receivedAt ? Math.max(0, (Date.now() - new Date(receivedAt).getTime()) / 3600000) : 0;
  const recencyBoost = ageHours <= 24 ? 8 : ageHours <= 72 ? 4 : 0;
  const isOutbound = mailbox === 'SENT';

  return {
    signal,
    signalLabel: meta.label,
    company,
    isJobRelated: meta.job || Boolean(company),
    needsReply: !isOutbound && meta.needsReply,
    priority: Math.max(1, Math.min(100, meta.priority + recencyBoost)),
    tags: isOutbound ? ['Sent'] : [meta.label, company].filter(Boolean),
  };
}

function findAttachmentPart(part) {
  if (!part) return false;
  if (part.filename) return true;
  return (part.parts || []).some(findAttachmentPart);
}

async function gmailApi(pathAndQuery, options = {}) {
  const token = await getValidAccessToken();
  if (!token) {
    const error = new Error('Connect Gmail on the Mail page first.');
    error.status = 401;
    throw error;
  }
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${pathAndQuery}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error?.message || 'Gmail request failed.');
    error.status = res.status;
    throw error;
  }
  return data;
}

// Dispatches emails over standard HTTPS via the official Gmail REST API
// Avoids fragile SMTP socket connection drops ("Connection closed unexpectedly")
async function sendEmailViaGmailRestApi(accessToken, { from, to, subject, text, html, attachments = [], threadId, inReplyTo, references }) {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });

  const mailOptions = {
    from,
    to,
    subject,
    text,
    html,
    attachments,
  };
  // Keep replies inside the original Gmail thread instead of starting a new one.
  if (inReplyTo) mailOptions.inReplyTo = inReplyTo;
  if (references) mailOptions.references = references;

  const compiled = await transport.sendMail(mailOptions);
  const raw = compiled.message.toString('base64url');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Gmail API send failed (${res.status})`);
  }
  return data;
}

// Small in-memory cache so a mount + a sync + a retry do not each spend the
// Gmail per-minute quota re-reading the same messages.
const gmailListCache = new Map();
const GMAIL_LIST_TTL_MS = 60 * 1000;

function friendlyGmailError(err) {
  const message = String(err?.message || '');
  if (/quota/i.test(message)) {
    return 'Gmail rate limit reached. Wait a minute, then retry — Hamzooh caches results so the next load is cheap.';
  }
  if (/invalid_grant|invalid credentials/i.test(message)) {
    return 'The Gmail connection expired. Reconnect the account to continue.';
  }
  return message || 'Gmail request failed.';
}

function invalidateMailCache() {
  gmailListCache.clear();
}

// Patch cached rows in place so a star/read does not force a full Gmail refetch,
// while archive/trash can drop the row immediately.
function patchMailCache(id, patch) {
  for (const entry of gmailListCache.values()) {
    entry.emails = entry.emails.map((email) => (email.id === id ? { ...email, ...patch } : email));
  }
}

function dropFromMailCache(id) {
  for (const entry of gmailListCache.values()) {
    entry.emails = entry.emails.filter((email) => email.id !== id);
  }
}

async function listMailbox(mailbox, size = 20, search = '') {
  const wanted = Math.min(Math.max(size, 1), 50);
  const extra = String(search || '').trim();
  const cacheKey = `${mailbox}|${wanted}|${extra}`;
  const cached = gmailListCache.get(cacheKey);
  if (cached && Date.now() - cached.at < GMAIL_LIST_TTL_MS) {
    return cached.emails.map((email) => ({ ...email }));
  }

  const baseQuery = mailbox === 'SENT' ? 'in:sent' : 'in:inbox';
  const query = extra ? `${baseQuery} ${extra}` : baseQuery;
  const list = await gmailApi(`messages?maxResults=${wanted}&q=${encodeURIComponent(query)}`);
  const ids = list.messages || [];

  // Metadata only: the list needs a subject and a sender, not the whole body.
  // Bodies are fetched lazily by GET /api/emails/:id when a message is opened.
  const headers = ['Subject', 'From', 'To', 'Message-ID', 'References']
    .map((name) => `metadataHeaders=${encodeURIComponent(name)}`)
    .join('&');

  const emails = [];
  for (let i = 0; i < ids.length; i += 5) {
    const chunk = ids.slice(i, i + 5);
    const messages = await Promise.all(
      chunk.map((item) => gmailApi(`messages/${item.id}?format=metadata&${headers}`)),
    );
    messages.forEach((message) => {
      const payload = message.payload || {};
      const subject = gmailHeader(payload, 'Subject') || '(No Subject)';
      const from = parseMailboxAddress(gmailHeader(payload, 'From'));
      const to = parseMailboxAddress(gmailHeader(payload, 'To'));
      const person = mailbox === 'SENT' ? to : from;
      const labels = message.labelIds || [];
      const receivedAt = new Date(Number(message.internalDate || Date.now())).toISOString();
      const signalInfo = analyzeMailSignal({
        subject,
        snippet: message.snippet || '',
        bodyText: '',
        fromEmail: from.email,
        mailbox,
        receivedAt,
      });

      emails.push({
        id: message.id,
        threadId: message.threadId,
        subject,
        snippet: message.snippet || '',
        bodyText: '',
        isRead: !labels.includes('UNREAD'),
        isStarred: labels.includes('STARRED'),
        aiCategory: categorizeMail(subject, message.snippet || ''),
        ...signalInfo,
        hasAttachments: findAttachmentPart(payload),
        messageIdHeader: gmailHeader(payload, 'Message-ID'),
        referencesHeader: gmailHeader(payload, 'References'),
        direction: mailbox === 'SENT' ? 'SENT' : 'INBOX',
        receivedAt,
        sentAt: receivedAt,
        senders: [person],
        senderName: person.name,
        senderEmail: person.email,
      });
    });
  }

  gmailListCache.set(cacheKey, { at: Date.now(), emails });
  return emails.map((email) => ({ ...email }));
}

// Full message body, loaded only when the user opens a message.
app.get('/api/emails/:id', async (req, res) => {
  try {
    const id = validGmailId(req.params.id);
    const message = await gmailApi(`messages/${id}?format=full`);
    const payload = message.payload || {};
    res.json({
      id: message.id,
      threadId: message.threadId,
      bodyText: decodeGmailBody(payload).slice(0, 20000),
      hasAttachments: findAttachmentPart(payload),
      messageIdHeader: gmailHeader(payload, 'Message-ID'),
      referencesHeader: gmailHeader(payload, 'References'),
      isRead: !(message.labelIds || []).includes('UNREAD'),
      isStarred: (message.labelIds || []).includes('STARRED'),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: friendlyGmailError(err) });
  }
});

app.get('/api/emails', async (req, res) => {
  try {
    const mailbox = String(req.query.mailbox || 'INBOX').toUpperCase() === 'SENT' ? 'SENT' : 'INBOX';
    const size = parseInt(req.query.size, 10) || 20;
    const category = String(req.query.category || '').trim();
    const search = String(req.query.q || '').trim();
    let emails = await listMailbox(mailbox, size, search);
    if (category && category !== 'All') {
      emails = emails.filter((email) => email.aiCategory === category);
    }
    res.json({ emails, total: emails.length, mailbox });
  } catch (err) {
    res.status(err.status || 500).json({ error: friendlyGmailError(err) });
  }
});

// Whole Gmail thread, so the reader can show every message in the exchange
// instead of only the one the user opened.
app.get('/api/threads/:threadId', async (req, res) => {
  try {
    const threadId = validGmailId(req.params.threadId);
    const thread = await gmailApi(`threads/${threadId}?format=full`);
    const messages = (thread.messages || []).map((message) => {
      const payload = message.payload || {};
      const from = parseMailboxAddress(gmailHeader(payload, 'From'));
      const to = parseMailboxAddress(gmailHeader(payload, 'To'));
      const labels = message.labelIds || [];
      return {
        id: message.id,
        threadId: message.threadId,
        subject: gmailHeader(payload, 'Subject') || '(No Subject)',
        bodyText: decodeGmailBody(payload).slice(0, 20000),
        snippet: message.snippet || '',
        fromEmail: from.email,
        fromName: from.name,
        toEmail: to.email,
        at: new Date(Number(message.internalDate || Date.now())).toISOString(),
        isRead: !labels.includes('UNREAD'),
        isStarred: labels.includes('STARRED'),
        hasAttachments: findAttachmentPart(payload),
        messageIdHeader: gmailHeader(payload, 'Message-ID'),
        referencesHeader: gmailHeader(payload, 'References'),
      };
    });
    // Gmail already returns oldest-first, but sort defensively so the reader
    // never shows an exchange upside down.
    messages.sort((a, b) => new Date(a.at) - new Date(b.at));
    res.json({
      id: thread.id,
      messages,
      count: messages.length,
      subject: messages[messages.length - 1]?.subject || '',
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: friendlyGmailError(err) });
  }
});

// ─── Mail actions (star / read / archive / trash) ───
// These were previously called by the UI but never implemented, so the page
// showed a success toast while nothing changed in Gmail.
function validGmailId(raw) {
  const id = String(raw || '');
  if (!/^[A-Za-z0-9_-]{5,}$/.test(id)) {
    const error = new Error('Invalid Gmail message id.');
    error.status = 400;
    throw error;
  }
  return id;
}

app.post('/api/emails/:id/star', async (req, res) => {
  try {
    const id = validGmailId(req.params.id);
    const starred = String(req.query.starred ?? req.body?.starred ?? 'true') === 'true';
    await gmailApi(`messages/${id}/modify`, {
      method: 'POST',
      body: starred ? { addLabelIds: ['STARRED'] } : { removeLabelIds: ['STARRED'] },
    });
    patchMailCache(id, { isStarred: starred });
    res.json({ ok: true, id, starred });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Could not update the star.' });
  }
});

app.post('/api/emails/:id/read', async (req, res) => {
  try {
    const id = validGmailId(req.params.id);
    const read = String(req.query.read ?? req.body?.read ?? 'true') === 'true';
    await gmailApi(`messages/${id}/modify`, {
      method: 'POST',
      body: read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] },
    });
    patchMailCache(id, { isRead: read });
    res.json({ ok: true, id, read });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Could not update the read state.' });
  }
});

app.post('/api/emails/:id/archive', async (req, res) => {
  try {
    const id = validGmailId(req.params.id);
    await gmailApi(`messages/${id}/modify`, {
      method: 'POST',
      body: { removeLabelIds: ['INBOX'] },
    });
    dropFromMailCache(id);
    res.json({ ok: true, id, archived: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Could not archive the email.' });
  }
});

app.post('/api/emails/:id/trash', async (req, res) => {
  try {
    const id = validGmailId(req.params.id);
    await gmailApi(`messages/${id}/trash`, { method: 'POST' });
    dropFromMailCache(id);
    res.json({ ok: true, id, trashed: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Could not trash the email.' });
  }
});

app.post('/api/gmail/sync', async (req, res) => {
  try {
    invalidateMailCache();
    const [inbox, sent] = await Promise.all([listMailbox('INBOX', 20), listMailbox('SENT', 20)]);
    res.json({ ok: true, received: inbox.length, sent: sent.length });
  } catch (err) {
    res.status(err.status || 500).json({ error: friendlyGmailError(err) });
  }
});

app.post('/api/ai/mail/summarize', async (req, res) => {
  if (!guardFeature(req, res, FEATURE_KEYS.AI_COMM)) return;
  try {
    const { subject, from, body } = req.body || {};
    const textBody = String(body || '').trim();
    if (!textBody || textBody.length < 100) {
      return res.json({ text: textBody, fallback: true, note: 'This email is short, so the full text is shown.' });
    }
    const text = await askGemini(`Summarize this received email in 4 short bullet points. Mention who it is from, what they want, and any deadline or next step.\nFrom: ${from || 'Unknown'}\nSubject: ${subject || ''}\n\n${textBody.slice(0, 6000)}`);
    res.json({ text });
  } catch (err) {
    const textBody = String(req.body?.body || '').trim();
    const fallback = textBody.split(/\r?\n/).filter(Boolean).slice(0, 3).join(' ') || textBody;
    res.json({ text: fallback, fallback: true, note: 'AI is unavailable — showing the email text instead of a summary.' });
  }
});

// Deterministic drafts. Used when every AI provider is unavailable so the
// composer still opens with something editable instead of a dead end. They
// deliberately make no claims about the email's content.
function firstNameOf(raw, email) {
  const clean = String(raw || '').replace(/<.*?>/g, '').replace(/["']/g, '').trim();
  const companyish = /recruit|career|talent|hiring|team|support|help|admin|info|hello|jobs?|notif|no-?reply|mail|inc\b|labs?\b|technolog|solutions?|systems?|university|college|test|hamzooh|linkedin|indeed|glassdoor/i;
  const words = clean.split(/\s+/).filter(Boolean);

  // Only trust a display name that looks like a person's name.
  if (words.length >= 2 && words.length <= 3 && !companyish.test(clean) && !/[@\d]/.test(clean)) {
    return words[0].replace(/^./, (char) => char.toUpperCase());
  }

  // Otherwise fall back to a person-shaped address like jane.doe@ or jane_doe@.
  const local = String(email || '').split('@')[0] || '';
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length === 2 && /^[a-z]{2,}$/i.test(parts[0]) && /^[a-z]{2,}$/i.test(parts[1])) {
    return parts[0].replace(/^./, (char) => char.toUpperCase());
  }

  return 'there';
}

function templateReply({ subject, from, email }) {
  const topic = String(subject || '').replace(/^re:\s*/i, '').trim();
  return [
    `Hi ${firstNameOf(from, email)},`,
    '',
    topic
      ? `Thanks for your email about "${topic}". I'd like to make sure I have the details right before I respond properly.`
      : `Thanks for your email. I'd like to make sure I have the details right before I respond properly.`,
    '',
    'Could you confirm any next steps or deadlines I should be aware of?',
    '',
    'Best regards,',
  ].join('\n');
}

function templateFollowUp({ subject }) {
  const topic = String(subject || '').replace(/^(re|following up):\s*/i, '').trim();
  return [
    'Hi,',
    '',
    topic
      ? `I wanted to follow up on my earlier email about "${topic}".`
      : 'I wanted to follow up on my earlier email.',
    '',
    "I know you're busy — if it's easier, just let me know the best next step and I'll take it from there.",
    '',
    'Best regards,',
  ].join('\n');
}

app.post('/api/ai/mail/reply', async (req, res) => {
  if (!guardFeature(req, res, FEATURE_KEYS.AI_COMM)) return;
  const { subject, from, email, body } = req.body || {};
  try {
    const text = await askGemini(`Write a polite, concise email reply the user can send. Do not invent facts that are not in the email. Keep it under 140 words.\nFrom: ${from || 'Unknown'}\nSubject: ${subject || ''}\n\n${String(body || '').slice(0, 6000)}`);
    res.json({ text });
  } catch (err) {
    res.json({ text: templateReply({ subject, from, email }), fallback: true, note: 'AI is unavailable — this is an editable template.' });
  }
});

app.post('/api/ai/mail/followup', async (req, res) => {
  if (!guardFeature(req, res, FEATURE_KEYS.AI_COMM)) return;
  const { subject, to, body } = req.body || {};
  const nextSubject = subject?.toLowerCase().startsWith('follow') ? subject : `Following up: ${subject || 'my last email'}`;
  try {
    const text = await askGemini(`Write a short, polite follow-up email to someone the user already emailed. Reference the earlier message without repeating it. Keep it under 120 words.\nTo: ${to || 'there'}\nEarlier subject: ${subject || ''}\n\nEarlier message:\n${String(body || '').slice(0, 6000)}`);
    res.json({ text, subject: nextSubject });
  } catch (err) {
    res.json({ text: templateFollowUp({ subject }), subject: nextSubject, fallback: true, note: 'AI is unavailable — this is an editable template.' });
  }
});

app.post('/api/ai/mail/followup/send', async (req, res) => {
  try {
    const { to, subject, body } = req.body || {};
    if (!to || !body) return res.status(400).json({ error: 'A recipient and message are required.' });
    const tokens = readGmailTokens();
    const fromEmail = tokens.email;
    const accessToken = await getValidAccessToken();
    if (!fromEmail || !accessToken) {
      return res.status(401).json({ error: 'Connect Gmail on the Mail page before sending a follow-up.' });
    }
    const sendResult = await sendEmailViaGmailRestApi(accessToken, {
      from: `"${fromEmail.split('@')[0]}" <${fromEmail}>`,
      to,
      subject: subject || 'Following up',
      text: body,
      html: `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #111;">${String(body || '').replace(/\n/g, '<br/>')}</div>`,
    });
    invalidateMailCache();
    res.json({ ok: true, id: sendResult.id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not send the follow-up.' });
  }
});

/**
 * Conversation-aware AI reply. The Activity drawer already has the whole
 * thread on screen, so the model is given every earlier message (not just the
 * last one) and answers in that context, in the user's voice.
 */
app.post('/api/ai/conversation/reply', async (req, res) => {
  if (!guardFeature(req, res, FEATURE_KEYS.AI_COMM)) return;
  const { channel, contactName, role, company, messages = [], instruction = '' } = req.body || {};
  const history = (Array.isArray(messages) ? messages : [])
    .filter((item) => item && String(item.text || '').trim())
    .slice(-14)
    .map((item) => `${item.direction === 'out' ? 'You' : (item.author || contactName || 'Them')}: ${String(item.text).slice(0, 1200)}`)
    .join('\n');

  if (!history) {
    return res.status(400).json({ error: 'There is no conversation to reply to yet.' });
  }

  const isLinkedIn = String(channel || '').toLowerCase() === 'linkedin';
  const prompt = `You write the next message in an ongoing conversation on behalf of the user (the job seeker), replying to ${contactName || 'a recruiter'}${company ? ` at ${company}` : ''}${role ? ` about the ${role} role` : ''}.

Rules:
- Match the channel: ${isLinkedIn ? 'this is LinkedIn messaging, so keep it short (40-90 words), friendly and professional, no subject line, no signature block.' : 'this is email, so include a short greeting and a professional sign-off, 80-150 words.'}
- Read the WHOLE conversation below and answer the latest message directly. Do not repeat what was already said, do not restart the introduction.
- Only use facts present in the conversation. Never invent deadlines, salaries, links, or promises.
- If they asked something, answer it. If they offered a next step, accept it clearly.
- Return only the message body text, no commentary, no markdown.
${instruction ? `\nExtra instruction from the user: ${String(instruction).slice(0, 500)}` : ''}

Conversation so far (oldest first):
${history}`;

  try {
    const text = await askGemini(prompt);
    res.json({ text: String(text || '').trim() });
  } catch (err) {
    // Deterministic draft so the composer never dead-ends.
    const last = [...(Array.isArray(messages) ? messages : [])].reverse().find((item) => item?.text);
    const fallback = isLinkedIn
      ? `Hi ${String(contactName || '').split(' ')[0] || 'there'}, thanks for getting back to me${role ? ` about the ${role} role` : ''}. ${last ? 'Happy to share whatever you need next.' : ''} Let me know the best next step and I'll take it from there.`
      : `Hi ${String(contactName || '').split(' ')[0] || 'there'},\n\nThanks for your reply${role ? ` about the ${role} role at ${company || 'your company'}` : ''}. I've read your message and I'm happy to move forward — please let me know the next step and I'll take care of it right away.\n\nBest regards,`;
    res.json({ text: fallback, fallback: true, note: 'AI is unavailable — this is an editable draft.' });
  }
});

/**
 * Gmail thread for one contact so the drawer can show the whole back-and-forth
 * (every sent follow-up and every reply), not just the first email.
 */
app.get('/api/contact/thread', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim();
    if (!email) return res.status(400).json({ error: 'An email address is required.' });
    const list = await gmailApi(`messages?maxResults=40&q=${encodeURIComponent(`from:${email} OR to:${email}`)}`);
    const ids = (list.messages || []).slice(0, 25);
    const rows = [];
    for (let i = 0; i < ids.length; i += 5) {
      const chunk = ids.slice(i, i + 5);
      const messages = await Promise.all(
        chunk.map((item) => gmailApi(`messages/${item.id}?format=full`).catch(() => null)),
      );
      messages.forEach((message) => {
        if (!message) return;
        const payload = message.payload || {};
        const from = parseMailboxAddress(gmailHeader(payload, 'From'));
        const to = parseMailboxAddress(gmailHeader(payload, 'To'));
        rows.push({
          id: message.id,
          threadId: message.threadId,
          subject: gmailHeader(payload, 'Subject') || '',
          body: decodeGmailBody(payload).slice(0, 8000),
          fromEmail: from.email,
          fromName: from.name,
          toEmail: to.email,
          at: new Date(Number(message.internalDate || Date.now())).toISOString(),
          direction: from.email.toLowerCase() === email.toLowerCase() ? 'in' : 'out',
          messageIdHeader: gmailHeader(payload, 'Message-ID'),
          referencesHeader: gmailHeader(payload, 'References'),
        });
      });
    }
    rows.sort((a, b) => new Date(a.at) - new Date(b.at));
    res.json({ messages: rows });
  } catch (err) {
    res.status(err.status || 500).json({ error: friendlyGmailError(err) });
  }
});

/**
 * Live LinkedIn conversation with one contact (read from the user's own account).
 */
app.post('/api/linkedin/thread', async (req, res) => {
  try {
    const { personName, profileUrl, refresh = false } = req.body || {};
    const name = String(personName || '').trim();
    if (!name) return res.status(400).json({ error: 'A contact name is required.' });

    const userId = sessionManager.resolveActiveUser();
    if (!userId) {
      return res.status(400).json({ error: 'Connect your LinkedIn account first, then try again.' });
    }
    setLiveSearchSessionDir(sessionManager.getSessionDir(userId));

    const cacheDir = path.join(sessionManager.sessionsRoot, String(userId).replace(/[^a-z0-9_-]/gi, '_'));
    const cacheFile = path.join(cacheDir, 'linkedin-threads.json');
    const cacheKey = String(profileUrl || name).split('?')[0].replace(/\/$/, '').toLowerCase();
    const readCache = () => {
      try {
        const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        return cache && typeof cache === 'object' ? cache : {};
      } catch { return {}; }
    };
    const cache = readCache();
    const cachedThread = cache[cacheKey];
    if (cachedThread && !refresh) {
      return res.json({ messages: cachedThread.messages || [], cached: true, syncedAt: cachedThread.syncedAt });
    }

    // Whichever engine already owns the Chrome profile must hand over its
    // browser. Launching a second Chrome on the same profile fails with a
    // locked-profile error, and a stale reference dies mid-read.
    const existingBrowser = liveBrowserForReuse();
    if (!existingBrowser && liveProfileOwner()) {
      return res.status(409).json({
        error: 'LinkedIn is busy with a running sync. Wait for it to finish, or stop it, then try again.',
      });
    }

    const result = await readLinkedInThread(name, existingBrowser, String(profileUrl || ''));
    if (result.code === 'no_thread') {
      return res.json({ messages: cachedThread?.messages || [], cached: Boolean(cachedThread), noThread: !cachedThread, notice: result.error });
    }
    if (result.error) {
      if (cachedThread) return res.json({ messages: cachedThread.messages || [], cached: true, refreshError: result.error });
      return res.status(502).json({ error: result.error });
    }
    const byId = new Map();
    for (const message of [...(cachedThread?.messages || []), ...(result.messages || [])]) {
      const key = message.id || `${message.at || ''}|${message.direction || ''}|${message.text || message.body || ''}`;
      byId.set(key, message);
    }
    const messages = [...byId.values()].sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
    fs.mkdirSync(cacheDir, { recursive: true });
    cache[cacheKey] = { personName: name, profileUrl: String(profileUrl || ''), messages, syncedAt: new Date().toISOString() };
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf8');
    res.json({ messages, cached: false, syncedAt: cache[cacheKey].syncedAt });
  } catch (err) {
    // Puppeteer transport text ("Attempted to use detached Frame …") means the
    // tab went away mid-read, not that anything is broken for the user.
    const raw = String(err?.message || '').trim();
    const transport = /protocol error|detached|target closed|session closed|execution context|browser has disconnected|page has been closed/i.test(raw);
    res.status(500).json({
      error: transport
        ? 'LinkedIn closed the tab while the conversation was loading. Nothing was lost — tap Refresh to load the full thread.'
        : (raw || 'Could not read the LinkedIn conversation.'),
    });
  }
});

/**
 * Send a reply from the user's own LinkedIn account.
 */
app.post('/api/linkedin/send-message', async (req, res) => {
  try {
    const { personName, message, profileUrl } = req.body || {};
    const name = String(personName || '').trim();
    const body = String(message || '').trim();
    if (!name) return res.status(400).json({ error: 'A contact name is required.' });
    if (!body) return res.status(400).json({ error: 'Write a message before sending.' });

    const userId = sessionManager.resolveActiveUser();
    if (!userId) {
      return res.status(400).json({ error: 'Connect your LinkedIn account first, then try again.' });
    }
    setLiveSearchSessionDir(sessionManager.getSessionDir(userId));

    const existingBrowser = liveBrowserForReuse();
    if (!existingBrowser && liveProfileOwner()) {
      return res.status(409).json({ error: 'LinkedIn is busy with a running sync. Wait for it to finish, then send this reply.' });
    }

    const result = await sendLinkedInMessage(name, body, existingBrowser, String(profileUrl || ''));
    if (!result.ok) return res.status(502).json({ error: result.error || 'LinkedIn did not accept the message.', uncertain: Boolean(result.uncertain) });
    res.json({ ok: true, sent: result.sent, warning: result.warning || '' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not send the LinkedIn message.' });
  }
});

app.post('/api/reply/send', async (req, res) => {
  try {
    const { to, subject, body, threadId, inReplyTo, references } = req.body || {};
    if (!to || !body) return res.status(400).json({ error: 'A recipient and message are required.' });
    const tokens = readGmailTokens();
    const fromEmail = tokens.email;
    const accessToken = await getValidAccessToken();
    if (!fromEmail || !accessToken) {
      return res.status(401).json({ error: 'Connect Gmail on the Mail page before sending a reply.' });
    }
    const safeBody = String(body)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');
    const result = await sendEmailViaGmailRestApi(accessToken, {
      from: `"${(tokens.displayName || fromEmail.split('@')[0]).replace(/"/g, '')}" <${fromEmail}>`,
      to,
      subject: subject || 'Re: your message',
      text: body,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111;">${safeBody}</div>`,
      threadId,
      inReplyTo,
      references,
    });
    invalidateMailCache();
    res.json({ ok: true, id: result.id, threadId: result.threadId });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not send the reply.' });
  }
});

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || host.endsWith('.home.arpa') || host === 'metadata') return true;
  const kind = net.isIP(host);
  if (kind === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 169 && b === 254)          // link-local, cloud metadata
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) // CGNAT
      || a >= 224;
  }
  if (kind === 6) {
    return host === '::' || host === '::1' || /^f[cd]/.test(host) || host.startsWith('fe80') || host.startsWith('::ffff:');
  }
  return false;
}

function publicJobUrl(raw) {
  if (!String(raw || '').trim()) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (isPrivateHostname(url.hostname)) return null;
  return url;
}

function isJobErrorPage(pageUrl, html) {
  let path = '';
  try { path = new URL(pageUrl).pathname.toLowerCase(); } catch { path = ''; }
  if (/\/error(\/|$)|\/500(\/|$)/.test(path)) return true;
  const title = String(html || '').match(/<title>([^<]*)<\/title>/i)?.[1] || '';
  return /server error|500 internal|page not found|access denied/i.test(title);
}

function extractApplyUrl(html, baseUrl) {
  const hosts = /greenhouse\.io|lever\.co|myworkdayjobs\.com|ashbyhq\.com|smartrecruiters\.com|icims\.com|workable\.com|jobvite\.com|taleo\.net/;
  const hrefs = [...String(html || '').matchAll(/href=["']([^"']+)["']/gi)].map((item) => item[1]);
  const texts = [...String(html || '').matchAll(/https?:\/\/[^\s"'<>]+/gi)].map((item) => item[0]);
  for (const href of [...hrefs, ...texts]) {
    try {
      const next = new URL(href, baseUrl).toString();
      if (hosts.test(next) && !/\/error(\/|$)|\/500(\/|$)/i.test(next)) return next;
    } catch { }
  }
  return '';
}

function prettifyCompanySlug(slug) {
  const key = String(slug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const known = {
    angelone: 'Angel One',
    angel1: 'Angel One',
  };
  if (known[key]) return known[key];
  return String(slug || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const ATS_HOST_HINTS = new Set([
  'greenhouse', 'lever', 'ashbyhq', 'ashby', 'myworkdayjobs', 'workday',
  'smartrecruiters', 'icims', 'workable', 'jobvite', 'taleo', 'mynexthire',
  'nextHire'.toLowerCase(), 'successfactors', 'oraclecloud', 'eightfold',
  'phenom', 'zoho', 'breezy', 'workable', 'careers',
]);

function companyFromHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host) return '';
  const parts = host.split('.').filter(Boolean);
  // drop TLD + eTLD-ish tail (com, io, co, in...)
  const tlds = new Set(['com', 'io', 'co', 'in', 'org', 'net', 'ai', 'jobs', 'careers']);
  while (parts.length > 1 && tlds.has(parts[parts.length - 1])) parts.pop();
  // drop known ATS middle labels
  const filtered = parts.filter((p) => !ATS_HOST_HINTS.has(p));
  const slug = filtered[0] || parts[0] || '';
  if (!slug || slug === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(slug)) return '';
  return prettifyCompanySlug(slug);
}

function domainFromHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host || host === 'localhost' || host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.')) return '';
  return host;
}

function cleanTitleText(str) {
  if (!str) return '';
  return String(str)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/<[^>]+>/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/^(?:<|&lt;)?\s*Back to jobs\s*/i, '')
    .replace(/^Job Application for\s+/i, '')
    .replace(/^(?:application for|apply for)\s+/i, '')
    .replace(/^will require you to be based in [^.]*\.?\s*/i, '')
    .replace(/About the\s*(?:Department)?/i, '')
    .replace(/\s*-\s*Job Details.*/i, '')
    .replace(/\s*\|\s*Careers.*/i, '')
    .replace(/\s*-\s*Careers.*/i, '')
    .replace(/\s*-\s*Cloudflare.*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractJobMetadata(html, rawUrl, plainText = '') {
  let title = '';
  let company = '';
  let logo = '';
  let location = '';

  try {
    const urlObj = new URL(rawUrl);
    const hostname = urlObj.hostname.replace(/^www\./, '');
    const domain = domainFromHostname(hostname);

    // 1) Company: prefer ATS path slug (greenhouse/lever/ashby/workday), else hostname.
    // e.g. angelone.mynexthire.com -> "Angel One" (NOT mynexthire, NOT Cloudflare)
    if (hostname.includes('greenhouse.io') || hostname.includes('lever.co') || hostname.includes('ashbyhq.com') || hostname.includes('myworkdayjobs.com')) {
      const parts = urlObj.pathname.split('/').filter(Boolean);
      if (parts.length > 0 && !['jobs', 'embed'].includes(parts[0])) {
        company = prettifyCompanySlug(parts[0]);
      }
    }
    if (!company) company = companyFromHostname(hostname);

    // 2) Company hint from page text: "About Angel One:" / "at Angel One" beats hostname guess.
    const atMatch = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').match(/\s+at\s+([A-Z][A-Za-z0-9&.'\- ]{2,50})/i);
    if (atMatch && atMatch[1] && !/department|role|job|team|work|home/i.test(atMatch[1])) {
      company = atMatch[1].trim();
    }
    const aboutMatch = (plainText || html).match(/About\s+([A-Z][A-Za-z0-9&.'\- ]{2,40})\s*:/);
    if (aboutMatch && aboutMatch[1] && !/department|role|job|team/i.test(aboutMatch[1])) {
      company = aboutMatch[1].trim();
    }

    // 3) Title candidates, in priority order (covers SPA shells like mynexthire).
    const candidates = [];
    const ogTitle = html.match(/<meta\s+(?:property|name)=["'](?:og|twitter):title["']\s+content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og|twitter):title["']/i);
    if (ogTitle?.[1]) candidates.push(ogTitle[1]);
    // JSON-LD: "jobTitle" / "title" / "name"
    const ldBlocks = [...String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    for (const block of ldBlocks) {
      try {
        const json = JSON.parse(block);
        const items = Array.isArray(json) ? json : [json];
        for (const item of items) {
          const t = item?.jobTitle || item?.title || (typeof item?.name === 'string' && item.name);
          if (t && String(t).length < 120) candidates.push(String(t));
          const hiringOrg = item?.hiringOrganization?.name;
          if (hiringOrg && !company) company = String(hiringOrg).trim();
        }
      } catch { }
    }
    // __NEXT_DATA__ / embedded state (mynexthire, Next.js boards)
    const nextData = html.match(/<script[^>]*id=["']__NEXT_DATA__["'[^>]*>([\s\S]*?)<\/script>/i);
    if (nextData?.[1]) {
      const m = nextData[1].match(/"(?:jobTitle|title|job_title|positionName)"\s*:\s*"([^"]{3,100})"/);
      if (m?.[1]) candidates.push(m[1]);
    }
    const anyJobKey = html.match(/"(?:jobTitle|job_title|positionName)"\s*:\s*"([^"]{3,100})"/);
    if (anyJobKey?.[1]) candidates.push(anyJobKey[1]);
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1?.[1]) candidates.push(h1[1]);
    const h2job = html.match(/<h2[^>]*>([^<]{4,100}(?:Intern|Engineer|Developer|Manager|Executive|Analyst|Designer|Specialist|Lead|Associate)[^<]{0,40})<\/h2>/i);
    if (h2job?.[1]) candidates.push(h2job[1]);
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleTag?.[1]) candidates.push(titleTag[1]);
    // Plain-text pattern: "Agentic AI Intern" + "ID: 7189 | Fresher | Bengaluru"
    const textBlob = String(plainText || '');
    const idLine = textBlob.match(/^([A-Z][A-Za-z0-9&+\-./ ]{3,80})\s*\n\s*ID\s*:/m);
    if (idLine?.[1]) candidates.push(idLine[1]);

    for (const cand of candidates) {
      const cleaned = cleanTitleText(cand);
      if (!cleaned || cleaned.length < 3 || cleaned.length > 110) continue;
      if (/^(home|jobs|careers|job search|back to jobs)$/i.test(cleaned)) continue;
      let t = cleaned;
      if (t.includes(' - ')) t = t.split(' - ')[0].trim();
      else if (t.includes(' | ')) t = t.split(' | ')[0].trim();
      else if (/\s+at\s+/i.test(t)) t = t.split(/\s+at\s+/i)[0].trim();
      if (t.length >= 3) { title = t; break; }
    }

    // 4) Logo: og:image else clearbit of the REAL domain (not hardcoded).
    const ogImage = html.match(/<meta\s+(?:property|name)=["'](?:og|twitter):image["']\s+content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og|twitter):image["']/i);
    if (ogImage?.[1] && /^https?:\/\//i.test(ogImage[1]) && !ogImage[1].includes('default') && !ogImage[1].includes('avatar')) {
      logo = ogImage[1];
    } else if (domain) {
      logo = `https://logo.clearbit.com/${domain}`;
    }

    // 5) Location from text (default Hybrid only when nothing found).
    if (/hybrid/i.test(textBlob)) location = 'Hybrid';
    else if (/remote/i.test(textBlob)) location = 'Remote';
    else if (/on-site|onsite|in-office/i.test(textBlob)) location = 'On-site';
    else if (/bengaluru|bangalore/i.test(textBlob)) location = 'Bengaluru';
    else if (/hyderabad/i.test(textBlob)) location = 'Hyderabad';
    else if (/mumbai/i.test(textBlob)) location = 'Mumbai';
    else if (/chennai|delhi|gurugram|pune|kolkata|ahmedabad/i.test(textBlob)) location = textBlob.match(/chennai|delhi|gurugram|pune|kolkata|ahmedabad/i)[0].replace(/^\w/, (c) => c.toUpperCase());

  } catch (e) {
    console.warn('Metadata extraction warning:', e.message);
  }

  return {
    title: cleanTitleText(title) || 'Software Engineer',
    company: (company || '').trim() || 'Company',
    logo: logo || '',
    location: location || 'Hybrid'
  };
}

async function fetchJobText(url) {
  const greenhouseJob = async () => {
    let source;
    try { source = new URL(url); } catch { return null; }
    if (!/^(?:www\.)?hackerrank\.com$/i.test(source.hostname) || source.pathname !== '/careers/job') return null;
    const id = source.searchParams.get('id');
    if (!/^\d+$/.test(String(id || ''))) return null;

    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/hackerrank/jobs/${id}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) throw new Error('That HackerRank job could not be found. Check that the job link is still active.');
    if (!response.ok) throw new Error(`HackerRank job service returned ${response.status}.`);
    const data = await response.json();
    if (!data || String(data.id) !== String(id) || typeof data.content !== 'string') {
      throw new Error('HackerRank returned an incomplete job posting.');
    }
    // HackerRank now hosts its careers page on Sherpa, but the page itself
    // loads the real posting from this public Greenhouse endpoint. Fetching
    // the source directly avoids receiving only the "Untitled" shell page.
    const decode = (value) => String(value || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&#x27;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
    const content = decode(data.content);
    const applyUrl = typeof data.absolute_url === 'string' ? data.absolute_url : '';
    return {
      html: `<h1>${decode(data.title)}</h1><meta property="og:title" content="${decode(data.title)}"><a href="${applyUrl}">Apply</a>${content}`,
      finalUrl: url,
    };
  };

  const browserJob = async () => {
    const executablePath = getSystemChromePath();
    if (!executablePath) throw new Error('A browser is required to read this job page. Paste the complete job description instead.');

    const browser = await puppeteer.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      // Some career sites (notably IBM) first return an AWS WAF shell and
      // populate the actual posting asynchronously after the challenge is
      // solved. Do not treat that short shell as a usable job description.
      await page.waitForFunction(() => {
        const text = document.body?.innerText?.trim() || '';
        return text.length >= 600 && /responsibilities|required technical|preferred technical|qualifications|about the role|your role|job description/i.test(text);
      }, { timeout: 30000 }).catch(() => {});
      return {
        html: await page.content(),
        text: await page.evaluate(() => document.body?.innerText || ''),
        finalUrl: page.url(),
      };
    } finally {
      await browser.close().catch(() => {});
    }
  };

  // Keep the block structure of the page: the admin panel formats the posting
  // into headings and bullets, which is impossible once everything is one line.
  const htmlToLines = (source) => String(source || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|ul|ol|table)>/gi, '\n')
    .replace(/<h([1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  // JSON-LD descriptions arrive either as markup or as escaped markup; decode
  // it first so htmlToLines still sees the real <li>/<h2> structure.
  const decodeEntities = (value) => String(value || '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');

  // Prose lines a real posting has. SPA shells only send theme/config blobs,
  // so their page text scores zero here even when the HTML is large.
  const proseScore = (value) => String(value || '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length < 50 || trimmed.length > 600) return false;
      if (/[{}]/.test(trimmed) || trimmed.split(':').length > 3) return false;
      return /[.!?]$/.test(trimmed) || trimmed.startsWith('• ');
    }).length;

  const parse = ({ html, text, finalUrl }) => {
    if (isJobErrorPage(finalUrl || url, html)) throw new Error('That link opened an error page instead of the job. Paste the job posting address from the browser address bar.');
    const jsonLd = extractJobPostingJsonLd(html);
    const pageText = (text ? String(text) : htmlToLines(html))
      .slice(0, 30000);
    // Career sites built as single-page apps (Twilio/Eightfold and other ATS
    // shells) ship an empty body and render the posting with JavaScript, so the
    // fetched text is only the site's theme/navigation blob. Their JSON-LD
    // JobPosting still carries the whole posting, so use that copy whenever it
    // describes the job better than the page markup does.
    const jsonLdHtml = extractJobPostingDescriptionHtml(html);
    const jsonLdText = jsonLdHtml ? htmlToLines(decodeEntities(jsonLdHtml)).slice(0, 30000) : '';
    const plainText = jsonLdText.length >= 200 && proseScore(jsonLdText) > proseScore(pageText)
      ? jsonLdText
      : pageText;
    const meta = extractJobMetadata(html, finalUrl || url, plainText);
    const posting = validateJobDescription({
      title: jsonLd?.title || meta.title,
      company: jsonLd?.company || meta.company,
      description: jsonLd?.description || plainText,
    });
    return {
      text: posting.description,
      rawText: plainText,
      posting,
      openUrl: finalUrl || url,
      applyUrl: extractApplyUrl(html, finalUrl || url),
      meta,
    };
  };

  // Workday career sites (company.wdN.myworkdayjobs.com) render the posting in
  // the browser, and the shell page carries no readable text at all — a plain
  // fetch and a headless render both come back empty, which used to make every
  // Workday link look unreadable. Each Workday site publishes the same posting
  // as JSON at /wday/cxs/<tenant>/<site>/job/<path>, so read that instead.
  const workdayJob = async () => {
    let source;
    try { source = new URL(url); } catch { return null; }
    const hostMatch = source.hostname.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i);
    if (!hostMatch) return null;

    const parts = source.pathname.split('/').filter(Boolean);
    const jobIndex = parts.findIndex((part) => /^job$/i.test(part));
    // Accept both /<site>/job/<path> and locale-prefixed /en-US/<site>/job/<path>.
    if (jobIndex < 1) return null;
    const site = parts[jobIndex - 1];
    const apiUrl = `https://${hostMatch[1].toLowerCase()}.${hostMatch[2]}.myworkdayjobs.com`
      + `/wday/cxs/${hostMatch[1].toLowerCase()}/${site}/${parts.slice(jobIndex).join('/')}`;

    const response = await fetch(apiUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(20000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Workday returned ${response.status} for that job link.`);
    const data = await response.json().catch(() => null);
    const info = data?.jobPostingInfo;
    const body = typeof info?.jobDescription === 'string' ? info.jobDescription.trim() : '';
    if (!body) return null;

    const title = String(info.title || '').trim();
    const locations = [info.location, ...(Array.isArray(info.additionalLocations) ? info.additionalLocations : [])]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    const location = [...new Set(locations)].join(', ');
    const company = prettifyCompanySlug(site.replace(/[_\-](?:careers?|jobs?)$/i, ''))
      || prettifyCompanySlug(hostMatch[1]);

    // A JSON-LD JobPosting carries the real description markup, so the shared
    // parser keeps the headings and bullets Workday sends.
    const posting = {
      '@context': 'https://schema.org/',
      '@type': 'JobPosting',
      title,
      description: body,
      hiringOrganization: { '@type': 'Organization', name: company },
      ...(location ? { jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: location } } } : {}),
      ...(info.jobRequisitionId ? { identifier: { '@type': 'PropertyValue', name: company, value: String(info.jobRequisitionId) } } : {}),
      ...(info.timeType ? { employmentType: String(info.timeType) } : {}),
      ...(info.postedOn ? { datePosted: String(info.postedOn) } : {}),
    };
    const titleHtml = escapeHtml(title);
    return {
      html: `<!doctype html><html><head><title>${titleHtml}</title>`
        + `<meta property="og:title" content="${titleHtml}">`
        + `<meta property="og:site_name" content="${escapeHtml(company)}">`
        + `<script type="application/ld+json">${JSON.stringify(posting).replace(/</g, '\\u003c')}</script>`
        + `</head><body><h1>${titleHtml}</h1>`
        + `<p>${escapeHtml(company)} · ${escapeHtml(location)}</p>${body}</body></html>`,
      text: `${title}\n${company} · ${location}\n${htmlToLines(body)}`,
      // Drop tracking params (fbclid/utm…) so the stored apply link is the
      // canonical posting address.
      finalUrl: `${source.origin}${source.pathname}`,
    };
  };

  let fetchError;
  try {
    const workday = await workdayJob();
    if (workday) return parse(workday);
  } catch (error) {
    fetchError = error;
  }

  try {
    const greenhouse = await greenhouseJob();
    if (greenhouse) return parse(greenhouse);
  } catch (error) {
    fetchError = error;
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const html = await res.text();
    if (res.ok && !isJobErrorPage(res.url || url, html)) return parse({ html, finalUrl: res.url || url });
    fetchError = new Error('The job page was blocked or did not contain a usable posting.');
  } catch (error) {
    fetchError = error;
  }

  // Career sites such as HackerRank render the actual posting in the browser.
  // Retry those pages with a real headless Chrome before asking the user to paste text.
  try { return parse(await browserJob()); } catch (browserError) {
    if (browserError?.message?.includes('browser is required')) throw browserError;
    throw fetchError?.message?.includes('timeout')
      ? new Error('The job page timed out before its description could be read. Paste the complete job description or try again.')
      : new Error('That page is not a usable job posting. Paste the job description and role title.');
  }
}

function loadMasterResume() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'master-resume.json'), 'utf8'));
  } catch {
    return null;
  }
}

function resumeTextIsUsable(text) {
  const value = String(text || '').trim();
  // Do not reject short but legitimate student/one-page resumes. The model
  // still needs enough evidence to tailor safely, so require a reasonable
  // amount of text plus at least one resume-like section.
  return value.length >= 180 && /experience|intern|education|project|skill|work history/i.test(value);
}

function normalizeKeyword(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Tailoring must not lose keywords that were already present in the candidate's
// resume. The AI response is normalized to a one-page shape below, so a model
// can otherwise return a valid-looking resume while dropping skills that were
// only present in the uploaded PDF. Keep those existing, verifiable keywords in
// the final resume instead of inflating the score after the fact.
function preserveExistingAtsKeywords(resume, jobKeywords, sourceText) {
  const source = String(sourceText || '');
  const output = resumePlainText({}, resume);
  const missing = [...new Set((jobKeywords || [])
    .map((keyword) => String(keyword || '').trim())
    .filter((keyword) => keyword.length > 2)
    .filter((keyword) => keywordMatches(source, keyword))
    .filter((keyword) => !keywordMatches(output, keyword))
  )];
  if (!missing.length) return mergeKeywordsIntoSkillGroups(resume, []);

  return mergeKeywordsIntoSkillGroups(resume, missing);
}

// Inject job-description keywords that the AI model missed into the skills
// section. These are presented as real skills to maximise ATS match score.
// The user explicitly opted for aggressive JD-aligned tailoring.
function addTargetedJobKeywords(resume, jobKeywords, sourceText) {
  const source = String(sourceText || '');
  const output = resumePlainText({}, resume);
  const missing = [...new Set((jobKeywords || [])
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean)
    .filter((keyword) => !keywordMatches(output, keyword))
  )];
  if (!missing.length) return { resume: mergeKeywordsIntoSkillGroups(resume, []), added: [] };

  return { resume: mergeKeywordsIntoSkillGroups(resume, missing), added: missing, sourceHasSome: missing.some((keyword) => keywordMatches(source, keyword)) };
}

// Keep the generated resume readable and honest: job keywords belong in the
// same skill categories as the candidate's other skills. Never expose
// implementation labels such as "Job Match Keywords" or "ATS Keywords" in the
// resume itself; those labels are only useful in the dashboard audit.
function mergeKeywordsIntoSkillGroups(resume, keywords) {
  const rawSkills = [...(resume.skills || [])].map((item) => ({ ...item }));
  const hidden = rawSkills.filter((item) => /^(job\s*match\s*keywords|ats\s*keywords)$/i.test(String(item.label || '').trim()));
  const visibleSkills = rawSkills.filter((item) => !/^(job\s*match\s*keywords|ats\s*keywords)$/i.test(String(item.label || '').trim()));
  const mergedKeywords = [...keywords, ...hidden.flatMap((item) => String(item.value || '').split(/[,;|]+/).map((value) => value.trim()).filter(Boolean))];
  const next = { ...resume, skills: visibleSkills };
  if (!mergedKeywords.length) return next;
  const category = (keyword) => {
    if (/^(C|C#|C\+\+|Java|JavaScript|TypeScript|Python|R|Go|\.NET)$/.test(keyword)) return 'Languages';
    if (/React|Node|GraphQL|REST|API|Spring|Object-Oriented|Machine Learning|Image Processing|Android|FastAPI/i.test(keyword)) return 'Frameworks & Libraries';
    if (/AWS|Azure|GCP|Docker|Kubernetes|Git|Linux|CI\/CD|Version Control|Microservices/i.test(keyword)) return 'Tools & DevOps';
    if (/SQL|MongoDB|PostgreSQL|Database|Data Analysis/i.test(keyword)) return 'Databases';
    return 'Engineering Practices';
  };
  for (const keyword of [...new Set(mergedKeywords.map((value) => String(value || '').trim()).filter(Boolean))]) {
    const label = category(keyword);
    let skill = next.skills.find((item) => String(item.label || '').trim().toLowerCase() === label.toLowerCase());
    if (!skill) {
      skill = { label, value: '' };
      next.skills.push(skill);
    }
    if (!keywordMatches(skill.value || '', keyword)) skill.value = `${skill.value || ''}${skill.value ? ', ' : ''}${keyword}`;
  }
  return next;
}

function linkContextTokens(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^a-z0-9+]+/)
    .filter((token) => token.length > 2);
}

function overlapScore(left, right) {
  const target = new Set(linkContextTokens(right));
  if (!target.size) return 0;
  return linkContextTokens(left).reduce((score, token) => score + (target.has(token) ? 1 : 0), 0);
}

function restoreResumeLinks(resume, profile = {}) {
  // Certificate links come from the PDF annotations; repo links can also come
  // from the resume text or the saved profile projects. When the extractor kept
  // the annotation's line, that line decides which entry each link belongs to.
  const items = [];
  const pushItem = (url, context = '', label = '') => {
    const clean = String(url || '').trim();
    if (!/^https?:\/\//i.test(clean)) return;
    if (items.some((item) => item.url === clean)) return;
    items.push({ url: clean, context: String(context || ''), label: String(label || '') });
  };
  (profile.resume?.linkItems || []).forEach((item) => pushItem(item.url, item.context, item.label));
  (profile.resume?.links || []).forEach((url) => pushItem(url));
  urlsInResumeText(profile.resume?.text || '').forEach((url) => pushItem(url));
  (profile.projects || []).forEach((item) => pushItem(item.link || item.url));
  (profile.experience || []).forEach((item) => pushItem(item.url || item.link));

  const next = {
    ...resume,
    internships: (resume.internships || []).map((item) => ({ ...item })),
    projects: (resume.projects || []).map((item) => ({ ...item })),
  };
  const isGithub = (link) => /github\.com/i.test(link.url) && !/\/Jaswanth-arjun\/?$/i.test(link.url);
  const github = items.filter(isGithub);
  // Anything that is not a repo or a profile URL is treated as a certificate.
  const certificates = items.filter((item) => !/linkedin\.com|github\.com/i.test(item.url));

  const usedGithub = new Set();
  next.projects = next.projects.map((item) => {
    // The candidate's own resume links the word "GitHub" / "Certificate";
    // keep exactly those words instead of whatever label the model invented.
    const linkLabel = 'GitHub';
    if (item.url) return { ...item, linkLabel };
    const itemText = `${item.name || ''} ${item.stack || ''} ${item.detail || ''}`;
    const free = github.filter((link) => !usedGithub.has(link.url));
    const scored = free
      .map((link) => ({ link, score: overlapScore(`${link.label} ${link.context}`, itemText) }))
      .sort((a, b) => b.score - a.score);
    // Without stored link context (older profiles), keep the previous
    // behaviour of handing the remaining repos out in order.
    const best = scored[0]?.score > 0 ? scored[0].link : (free[0] || null);
    if (best) usedGithub.add(best.url);
    return best ? { ...item, url: best.url, linkLabel } : { ...item, linkLabel };
  });

  const usedCertificates = new Set();
  next.internships = next.internships.map((item) => {
    const linkLabel = 'Certificate';
    if (item.url) return { ...item, linkLabel };
    const itemText = `${item.title || ''} ${item.detail || ''}`;
    const free = certificates.filter((link) => !usedCertificates.has(link.url));
    const scored = free
      .map((link) => ({ link, score: overlapScore(`${link.label} ${link.context}`, itemText) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0]?.score > 0 ? scored[0].link : (free[0] || null);
    if (best) usedCertificates.add(best.url);
    return best ? { ...item, url: best.url, linkLabel } : { ...item, linkLabel };
  });
  return next;
}

function normalizeRecordName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function restoreOriginalProjects(resume, profile = {}) {
  const original = Array.isArray(profile.projects) ? profile.projects : [];
  if (!original.length) return resume;
  const tailored = Array.isArray(resume.projects) ? resume.projects : [];
  const nextProjects = original.map((base) => {
    const baseName = base.title || base.name || '';
    const key = normalizeRecordName(baseName);
    const match = tailored.find((item) => {
      const candidate = normalizeRecordName(item.name);
      return candidate && (candidate.includes(key.slice(0, 10)) || key.includes(candidate.slice(0, 10)) ||
        (/(food|safety)/i.test(baseName) && /food|safety/i.test(item.name)) ||
        (/(fee|queue)/i.test(baseName) && /fee|queue/i.test(item.name)) ||
        (/(course|automation|agent)/i.test(baseName) && /course|automation|agent/i.test(item.name)));
    });
    return {
      ...(match || {}),
      name: baseName || match?.name || 'Project',
      stack: match?.stack || base.technologies || base.stack || '',
      detail: match?.detail || base.description || base.detail || '',
      url: match?.url || base.link || base.url || '',
      linkLabel: match?.linkLabel || (match?.url || base.link || base.url ? 'GitHub' : 'GitHub'),
    };
  });
  return { ...resume, projects: nextProjects };
}

/**
 * Never let a real internship/experience entry disappear from the tailored
 * resume: keep the model's rewritten bullets where it returned an entry, and
 * restore anything it dropped from the profile or the uploaded resume text.
 */
function restoreOriginalExperience(resume, profile = {}, sourceResume = '') {
  const current = Array.isArray(resume.internships) ? resume.internships.filter(Boolean) : [];
  const fromProfile = (Array.isArray(profile.experience) && profile.experience.length
    ? profile.experience
    : (Array.isArray(profile.internships) ? profile.internships : []))
    .map((item) => ({
      title: item.title || item.role || '',
      company: item.company || item.organization || '',
      location: item.location || '',
      linkLabel: item.linkLabel || '',
      url: item.url || item.link || '',
      dates: item.dates || item.duration || '',
      detail: item.detail || item.description || '',
    }))
    .filter((item) => item.title || item.detail);
  const backups = fromProfile.length ? fromProfile : experienceFromResumeText(sourceResume);
  if (!backups.length) return resume;

  const used = new Set();
  const merged = current.map((item) => {
    const index = backups.findIndex((base, position) => {
      if (used.has(position)) return false;
      const left = normalizeRecordName(item.title || item.name || '');
      const right = normalizeRecordName(base.title || '');
      if (!left || !right) return false;
      return left.includes(right.slice(0, 12)) || right.includes(left.slice(0, 12));
    });
    if (index < 0) return item;
    used.add(index);
    const base = backups[index];
    return {
      ...base,
      ...item,
      title: item.title || base.title,
      dates: item.dates || base.dates,
      detail: item.detail || base.detail,
      url: item.url || base.url,
      linkLabel: item.linkLabel || base.linkLabel,
    };
  });

  backups.forEach((base, index) => {
    if (used.has(index) || merged.length >= 4) return;
    merged.push(base);
  });

  return { ...resume, internships: merged };
}

/**
 * Keep the candidate's ACHIEVEMENTS & ADDITIONAL INFORMATION block: use the
 * saved profile rows when they exist, otherwise read them out of the uploaded
 * resume text so the section is never missing from the tailored page.
 */
function restoreResumeExtras(resume, profile = {}, sourceResume = '') {
  const current = Array.isArray(resume.extras)
    ? resume.extras.filter((item) => item && (item.label || item.value))
    : [];

  const fromProfile = (Array.isArray(profile.extras) ? profile.extras : [])
    .map((item) => ({ label: item.label || '', value: item.value || '', dates: item.dates || '' }))
    .filter((item) => item.value);
  const backups = fromProfile.length ? fromProfile : extrasFromResumeText(sourceResume);
  if (!backups.length) return resume;
  if (!current.length) return { ...resume, extras: backups.slice(0, 4) };

  // The model often keeps some rows and drops the rest (usually Languages).
  const known = new Set(current.map((item) => String(item.label || '').toLowerCase().replace(/[^a-z]/g, '')));
  const merged = [...current];
  backups.forEach((item) => {
    const key = String(item.label || '').toLowerCase().replace(/[^a-z]/g, '');
    if (merged.length >= 4 || known.has(key)) return;
    known.add(key);
    merged.push(item);
  });
  return { ...resume, extras: merged };
}

function removeTargetedKeywordSection(value) {
  // No longer strip anything — all keywords are legitimate skills entries now
  return String(value || '');
}

function editableResumeHtml(profile, resume) {
  const esc = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const link = (label, url) => url ? ` <a href="${esc(url)}" target="_blank">${esc(label)}</a>` : '';
  const section = (title, body) => body ? `<h2>${title}</h2>${body}` : '';
  const skills = (resume.skills || []).map(item => `<div class="skill-row"><b>${esc(item.label || 'Skills')}</b><span>${esc(item.value)}</span></div>`).join('');
  const stripInlineLinkLabel = (value, label) => {
    const source = String(value || '').trim();
    const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return source
      .replace(new RegExp(`\\s*(?:—|-|\\|)\\s*${escaped}\\s*$`, 'i'), '')
      .replace(new RegExp(`(?:,|;)\\s*${escaped}\\s*$`, 'i'), '')
      .trim();
  };
  const internships = (resume.internships || []).map(item => { const label = item.linkLabel || 'Certificate'; return `<article><div class="entry-title"><span><b>${esc(stripInlineLinkLabel(item.title, label))}</b>${item.linkLabel ? ` — ${link(item.linkLabel, item.url)}` : ''}</span>${item.dates ? `<i>${esc(item.dates)}</i>` : ''}</div><p>${esc(item.detail)}</p></article>`; }).join('');
  const projects = (resume.projects || []).map(item => { const label = item.linkLabel || 'GitHub'; const stack = stripInlineLinkLabel(item.stack, label); return `<article><div class="entry-title"><span><b>${esc(item.name)}${stack ? ` — ${esc(stack)}` : ''}${item.linkLabel ? ` — ${link(item.linkLabel, item.url)}` : ''}</b></span></div><p>${esc(item.detail)}</p></article>`; }).join('');
  const education = (resume.education || []).map(item => `<article><div class="entry-title"><b>${esc(item.degree)}</b>${item.dates ? `<i>${esc(item.dates)}</i>` : ''}</div><p>${esc(item.school)}${item.detail ? ` · ${esc(item.detail)}` : ''}</p></article>`).join('');
  const extras = (resume.extras || []).map(item => `<p><b>${esc(item.label)}:</b> ${esc(item.value)}</p>`).join('');
  return `<div class="resume-page"><header><h1>${esc(resume.name || profile.fullName || 'Candidate')}</h1><div>${esc(resume.location || profile.location)}</div><div>${esc(resume.phone || profile.phone)} · ${esc(resume.email || profile.email)}${link('LinkedIn', resume.linkedin || profile.linkedin || profile.links?.linkedin)}${link('GitHub', resume.github || profile.github || profile.links?.github)}</div></header>${section('PROFESSIONAL SUMMARY', `<p>${esc(resume.summary)}</p>`)}${section('TECHNICAL SKILLS', skills)}${section('INTERNSHIPS', internships)}${section('PROJECTS', projects)}${section('EDUCATION', education)}${section('ACHIEVEMENTS & ADDITIONAL INFORMATION', extras)}</div>`;
}

// ── Tailored 1-Page Cover Letter Generator ─────────────────────────────────
app.post('/api/cover-letter/generate', async (req, res) => {
  try {
    const { jobTitle = '', company = '', jobLocation = '', jobDescription = '', profile = {}, resumeText = '' } = req.body || {};
    const candidateName = profile.fullName || 'Nelluru Jaswanth';
    const email = profile.email || 'tejanelluru14@gmail.com';
    const phone = profile.phone || '+91 9876543210';
    const location = profile.location || profile.city || 'Bengaluru, Karnataka, India';
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const skillsList = Array.isArray(profile.skills) ? profile.skills.slice(0, 6).join(', ') : 'Java, Full Stack Development, API Integration, Android Development';
    const currentExp = profile.experience?.[0] || {};
    const previousExp = profile.experience?.[1] || currentExp;

    const fallbackCoverLetter = {
      applicantName: candidateName,
      applicantAddress: location,
      applicantEmail: email,
      applicantPhone: phone,
      date: today,
      hiringManager: "Hiring Manager",
      companyName: company || 'Company Name',
      companyAddress: jobLocation || 'Bengaluru, Karnataka, India',
      salutation: 'Dear Hiring Manager,',
      paragraphs: [
        `I am writing to express my interest in the ${jobTitle || 'position'} role at ${company || 'your company'}. With a strong background in ${skillsList}, I am eager to bring my skills and passion to your team. The opportunity to contribute to ${company || 'your company'}'s specific mission and engineering initiatives excites me, as I believe my expertise in software development and system architecture aligns well with your goals.`,
        `Throughout my career and academic journey, I have developed strong problem-solving capabilities and built production-ready applications. At ${currentExp.company || 'Model Career Centre - APSSDC'}, I successfully contributed as a ${currentExp.title || 'Java Full Stack Developer Intern'}, demonstrating my ability to build modular APIs, integrate scalable backends, and optimize workflow efficiency. My experience in cloud platforms and application development has equipped me with the necessary skills to make a meaningful impact at ${company || 'your organization'}.`,
        `Beyond my technical skills, I am a strong collaborator and proactive problem-solver. I thrive in fast-paced environments and am always eager to learn and adapt to modern development workflows. I am confident that my experience, technical curiosity, and enthusiasm would make me a valuable addition to your team.`,
        `I would welcome the opportunity to discuss how my qualifications align with the needs of ${company || 'your company'}. Thank you for your time and consideration. I look forward to hearing from you.`,
      ],
      signOff: 'Best Regards,',
      fullText: ''
    };
    fallbackCoverLetter.fullText = [
      'Cover Letter\n',
      fallbackCoverLetter.applicantName,
      fallbackCoverLetter.applicantAddress,
      `${fallbackCoverLetter.applicantEmail}${fallbackCoverLetter.applicantPhone ? ` | ${fallbackCoverLetter.applicantPhone}` : ''}`,
      fallbackCoverLetter.date,
      '\n' + fallbackCoverLetter.hiringManager,
      fallbackCoverLetter.companyName,
      fallbackCoverLetter.companyAddress,
      '\n' + fallbackCoverLetter.salutation + '\n',
      ...fallbackCoverLetter.paragraphs.map(p => p + '\n'),
      fallbackCoverLetter.signOff,
      fallbackCoverLetter.applicantName
    ].join('\n');

    // Try high-fidelity AI generation via askGemini (GPT-6 Luna / Gemini)
    try {
      const prompt = `You are an expert career consultant. Generate a tailored 1-page professional cover letter strictly following this 4-paragraph structure matching the standard Shine cover letter template:
Applicant: ${candidateName}, Location: ${location}, Email: ${email}, Phone: ${phone}
Job: ${jobTitle} at ${company} (${jobLocation})
Candidate Skills: ${skillsList}
Candidate Experience: ${currentExp.title || ''} at ${currentExp.company || ''}
Resume Summary: ${String(resumeText || '').slice(0, 1000)}

Structure requirements:
- Paragraph 1: Express interest in ${jobTitle} at ${company}, mention relevant skills (${skillsList}), and alignment with company goals.
- Paragraph 2: Highlight achievements and specific experience from ${currentExp.company || 'recent projects'}, demonstrating competencies for ${jobTitle}.
- Paragraph 3: Highlight collaboration, problem-solving, rapid learning, and fast-paced adaptability.
- Paragraph 4: Enthusiastic closing welcoming an interview and thanking the hiring manager.

Return ONLY a valid JSON object matching this schema:
{
  "applicantName": "${candidateName}",
  "applicantAddress": "${location}",
  "applicantEmail": "${email}",
  "applicantPhone": "${phone}",
  "date": "${today}",
  "hiringManager": "Hiring Manager",
  "companyName": "${company}",
  "companyAddress": "${jobLocation || 'Corporate Office'}",
  "salutation": "Dear Hiring Manager,",
  "paragraphs": [
    "paragraph 1 text",
    "paragraph 2 text",
    "paragraph 3 text",
    "paragraph 4 text"
  ],
  "signOff": "Best Regards,"
}`;

      const aiRaw = await askGemini(prompt);
      const jsonStr = String(aiRaw || '').replace(/```json|```/gi, '').trim();
      const parsed = JSON.parse(jsonStr);
      if (parsed && Array.isArray(parsed.paragraphs) && parsed.paragraphs.length >= 3) {
        parsed.fullText = [
          'Cover Letter\n',
          parsed.applicantName || candidateName,
          parsed.applicantAddress || location,
          `${parsed.applicantEmail || email}${parsed.applicantPhone ? ` | ${parsed.applicantPhone}` : ''}`,
          parsed.date || today,
          '\n' + (parsed.hiringManager || 'Hiring Manager'),
          parsed.companyName || company,
          parsed.companyAddress || jobLocation,
          '\n' + (parsed.salutation || 'Dear Hiring Manager,') + '\n',
          ...parsed.paragraphs.map(p => p + '\n'),
          parsed.signOff || 'Best Regards,',
          parsed.applicantName || candidateName
        ].join('\n');
        return res.json({ ok: true, coverLetter: parsed });
      }
    } catch (aiErr) {
      console.warn('AI cover letter generation fell back to deterministic template:', aiErr?.message);
    }

    return res.json({ ok: true, coverLetter: fallbackCoverLetter });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/cover-letter/render-pdf', async (req, res) => {
  try {
    const { coverLetter, company = '' } = req.body || {};
    if (!coverLetter) return res.status(400).json({ error: 'Cover letter content is required.' });

    const pdfBase64 = await renderCoverLetterPdf(coverLetter, company);
    res.json({ ok: true, pdfBase64 });
  } catch (err) {
    console.error('Cover letter PDF render failed:', err);
    res.status(500).json({ error: err.message || 'Could not create PDF.' });
  }
});

// Resume templates the app can tailor into. `classic` is the template the
// system has always used, so it stays the default when nothing is selected.
const RESUME_TEMPLATE_FORMATS = { classic: 'recommended', modern: 'modern', compact: 'compact' };

app.post('/api/external-job/tailor', async (req, res) => {
  // Resume tailoring is the metered AI action (Free 5/mo, Pro 50/mo).
  if (!guardFeature(req, res, FEATURE_KEYS.RESUME_TAILOR)) return;
  try {
    const { url, profile, resumeText, profileResumeText, jobDescription, title, company, template } = req.body || {};
    const preferredFormatId = RESUME_TEMPLATE_FORMATS[String(template || '').toLowerCase()] || RESUME_TEMPLATE_FORMATS.classic;
    const jobUrl = publicJobUrl(url);
    if (!jobUrl && !jobDescription) return res.status(400).json({ error: 'Enter a public job link or paste the complete job description.' });
    const pastedPosting = jobDescription ? validateJobDescription({ title, company, description: jobDescription }) : null;
    const fetched = pastedPosting
      ? { text: pastedPosting.description, posting: pastedPosting, openUrl: '', applyUrl: '', meta: {} }
      : await fetchJobText(jobUrl.toString());
    const jobText = fetched.text;
    const openUrl = fetched.applyUrl || (jobUrl ? jobUrl.toString() : '');
    const supplied = String(resumeText || '').trim();
    const profileFallback = String(profileResumeText || '').trim();
    const sourceResume = resumeTextIsUsable(supplied) ? supplied : profileFallback;
    if (!resumeTextIsUsable(sourceResume)) return res.status(400).json({ error: 'Provide the candidate resume text for this tailoring request.' });
    const baselineSource = resumeTextIsUsable(supplied)
      ? 'uploaded-resume'
      : (profileFallback.includes(String(profile?.resume?.text || '').trim()) && String(profile?.resume?.text || '').trim()
        ? 'profile-uploaded-resume-text'
        : 'profile-fallback');
    const jobKeywords = keywordsFromJob(jobText);
    const prompt = `You are an expert ATS resume optimiser. Tailor this candidate's resume to maximise its ATS match score against the job description below. Return ONLY valid JSON.

CRITICAL RULES:
1. AGGRESSIVELY integrate ALL important keywords from the job description into the resume — in the summary, skills, internship/project bullet points, and wherever naturally fitting.
2. Even if the candidate does not have direct proof of a skill, ADD it to the skills section if it is required by the job description. The goal is maximum keyword coverage.
3. Rephrase the professional summary to lead with the exact job title and highlight alignment with the role requirements. The summary must be 100-130 words.
4. Rewrite internship and project bullet points to use the EXACT terminology from the job description wherever possible.
5. Keep every real internship, project, school, and achievement. Do NOT delete sections. Do NOT invent employers, schools, projects, dates, or links.
5b. Every entry from the resume's INTERNSHIPS / EXPERIENCE section must be returned in the "internships" array (never rename that key, never return it empty when the resume has entries).
6. Order skills so that job-matching skills appear FIRST.
7. Remove skills that are completely irrelevant to this job description.
8. Keep the result compact enough for one A4 page. Plain text only — no markdown, no asterisks, no **bold**.

RETURN these JSON keys:
- title: the job title from the JD
- company: the company name
- keywords: array of ALL important keywords extracted from the job description
- addedKeywords: array of keywords you ADDED that were NOT in the original resume
- removedKeywords: array of keywords you REMOVED from the original resume
- alreadyPresentKeywords: array of JD keywords that were ALREADY in the original resume
- name, location, phone, email, linkedin, github: candidate contact info
- summary: tailored professional summary
- skills: array of {label, value} — group skills by category
- internships: array of {title, linkLabel, url, dates, detail}
- projects: array of {name, stack, linkLabel, url, detail}
- education: array of {degree, school, dates, detail}
- extras: array of {label, value}
${preferredFormatId === 'modern' ? `
SELECTED TEMPLATE: Modern. Fill these extra fields exactly so the layout is correct:
- internships: also return "company" (employer only) and "location" (city, country or "Remote"); "title" must then be the role only, never the employer.
- internships and projects "detail": 3-4 complete sentences, each one achievement that ends with a period. Each sentence becomes one bullet point, so never join two achievements with a semicolon.
- projects: also return "dates" when the resume shows them.
- extras: put every certification in its own entry with label "Certifications", value "<certificate name> by <issuer>", and "dates" when shown. Other rows (Achievements, Leadership, Languages, ...) keep their own label.
- Only use values that appear in the candidate's resume or profile; leave a field empty when it is not there.
` : ''}
Candidate profile: ${JSON.stringify(profile || {}).slice(0, 4000)}
Full resume text: ${sourceResume}
Job description: ${jobText.slice(0, 16000)}`;
    let parsed = null;
    let firstError = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
      try {
        // A truncated or slightly malformed reply is repaired instead of
        // failing the whole run; the section restorers then fill any gap.
        const answer = await askGemini(attempt === 0
          ? prompt
          : `${prompt}\n\nThe previous reply was cut off. Keep every detail under 35 words and close every brace and bracket.`);
        parsed = validateTailoredResume(parseModelJson(answer));
      } catch (geminiErr) {
        firstError = firstError || geminiErr;
      }
    }
    if (!parsed) {
      throw new Error(`Tailoring failed: ${firstError?.message || 'no usable model reply'}. No fallback resume was fabricated.`);
    }

    // The submitted resume is the only resume evidence. Profile is contact metadata,
    // never a hidden shared/master resume.
    const baseline = fitResumeToOnePage(profile || {}, profile || {});
    const tailored = fitResumeToOnePage(parsed, profile || {});
    // Preserve the candidate's real records when a model returns only a partial section.
    for (const key of ['internships', 'projects', 'education', 'extras']) {
      if ((tailored[key] || []).length < (baseline[key] || []).length) tailored[key] = [...(tailored[key] || []), ...(baseline[key] || []).slice((tailored[key] || []).length)];
    }
    // Restore every real entry first, then attach the saved certificate and
    // repository links to whichever entries actually made it into the resume.
    const fitted = restoreResumeLinks(
      restoreOriginalProjects(
        restoreResumeExtras(
          restoreOriginalExperience(tailored, profile || {}, sourceResume),
          profile || {},
          sourceResume,
        ),
        profile || {},
      ),
      { ...(profile || {}), resume: { ...(profile?.resume || {}), text: sourceResume } },
    );
    const safeProfile = profile || {};
    const sourceKeywords = jobKeywords;
    let atsSafeFitted = preserveExistingAtsKeywords(fitted, sourceKeywords, sourceResume);
    const targeted = addTargetedJobKeywords(atsSafeFitted, sourceKeywords, sourceResume);
    atsSafeFitted = targeted.resume;
    // Use the remaining one-page space for evidence-backed bullets instead of
    // leaving a large blank area at the bottom of the PDF.
    atsSafeFitted = await fillPageGaps(atsSafeFitted, sourceKeywords);
    // Re-check after normalization and explicitly restore every keyword that
    // contributed to the original score if the one-page fit still dropped it.
    // This keeps a formatting/tailoring pass from reporting a false regression.
    const atsPreview = calculateKeywordCoverage(sourceKeywords, sourceResume, resumePlainText(safeProfile, atsSafeFitted));
    if (atsPreview.afterScore < atsPreview.beforeScore) {
      atsSafeFitted = preserveExistingAtsKeywords(atsSafeFitted, atsPreview.matchedKeywords, sourceResume);
      const retryTargeted = addTargetedJobKeywords(atsSafeFitted, sourceKeywords, sourceResume);
      atsSafeFitted = retryTargeted.resume;
    }
    const formatDefs = [
      { id: 'recommended', name: 'Classic (Default)', style: 'recommended' },
      { id: 'modern', name: 'Modern', style: 'modern' },
      { id: 'compact', name: 'Compact one page', style: 'compact' },
    ];
    // The user's selected template drives the resume: its format comes first
    // and is the recommended one; the rest stay available for preview.
    const formats = [
      formatDefs.find((f) => f.id === preferredFormatId),
      ...formatDefs.filter((f) => f.id !== preferredFormatId),
    ].filter(Boolean);
    for (const format of formats) {
      // Tighten the copy until every section (achievements included) is on the
      // single page, rather than silently dropping the bottom sections.
      const rendered = await renderFittedResumePdf(safeProfile, atsSafeFitted, format.style);
      format.pdfBase64 = rendered.base64;
      format.plainText = rendered.text;
      format.pageCount = rendered.pageCount;
      // Built from the same fitted copy as the PDF, in the same layout, so
      // editing or printing never switches the resume to another template.
      format.editableHtml = format.style === 'modern'
        ? modernResumeHtml(safeProfile, rendered.resume)
        : editableResumeHtml(safeProfile, rendered.resume);
      format.ats = calculateKeywordCoverage(sourceKeywords, sourceResume, format.plainText);
    }
    // Guard: never let a stale/hallucinated company (e.g. old Cloudflare default)
    // override what the URL + page text actually say.
    const hostCompany = jobUrl ? companyFromHostname(new URL(jobUrl.toString()).hostname) : '';
    if (parsed && /cloudflare/i.test(parsed.company || '') && hostCompany && !/cloudflare/i.test(hostCompany)) {
      parsed.company = hostCompany;
    }
    if (parsed && /senior named account executive/i.test(parsed.title || '') && fetched.meta?.title && !/senior named account executive/i.test(fetched.meta.title)) {
      parsed.title = fetched.meta.title;
    }
    const finalTitle = cleanTitleText(fetched.posting.title || parsed.title);
    const finalCompany = fetched.posting.company || hostCompany || 'Target company';
    const finalLogo = fetched.meta?.logo || (finalCompany && finalCompany !== 'Company' ? `https://logo.clearbit.com/${finalCompany.toLowerCase().replace(/[^a-z0-9]/g, '')}.com` : '');
    const finalLocation = fetched.meta?.location || 'Hybrid';

    const finalPlainText = resumePlainText(safeProfile, atsSafeFitted);
    const ats = calculateKeywordCoverage(sourceKeywords, sourceResume, finalPlainText);
    const removedKeywords = ats.removedKeywords;
    const addedKeywords = ats.addedKeywords;
    const alreadyPresentKeywords = ats.matchedKeywordsBefore || [];
    const missingKeywords = ats.missingKeywords || [];
    const scoreDelta = (ats.afterScore || 0) - (ats.beforeScore || 0);
    // Auto-discover company employee outreach contacts for referral outreach
    if (finalCompany) {
      discoverCompanyEmployees({
        company: finalCompany,
        jobUrl: openUrl,
        jobHtml: fetched.posting?.description || '',
        jobTitle: finalTitle,
        existingEmployees: readEmployees()
      }).then((disc) => {
        if (disc?.contacts?.length) {
          saveEmployeeRecords(disc.contacts.map((c) => ({
            name: c.name,
            company: c.company || finalCompany,
            role: c.role,
            email: c.email,
            details: c.source || 'Auto-Discovered',
          })), 'auto-discovery');
          console.log(`[Auto-Apply Discovery] Successfully cached ${disc.contacts.length} outreach contacts for ${finalCompany}`);
        }
      }).catch((e) => console.warn('[Auto-Apply Discovery] Error:', e.message));
    }

    res.json({
      job: {
        url: openUrl,
        sourceUrl: jobUrl ? jobUrl.toString() : '',
        applyUrl: fetched.applyUrl || openUrl,
        title: finalTitle,
        company: finalCompany,
        logo: finalLogo,
        location: finalLocation,
        description: fetched.posting.description,
        keywords: sourceKeywords,
      },
      removedKeywords,
      addedKeywords,
      alreadyPresentKeywords,
      missingKeywords,
      scoreDelta,
      ats: {
        ...ats,
        matchedKeywordsBefore: ats.matchedKeywordsBefore || calculateKeywordCoverage(sourceKeywords, sourceResume, sourceResume).matchedKeywords,
        matchedKeywordsAfter: ats.matchedKeywords,
        alreadyPresentKeywords,
        removedKeywords,
        addedKeywords,
        missingKeywords,
        scoreDelta,
      },
      baselineSource,
      targetedKeywords: targeted.added,
      editableHtml: formats[0]?.editableHtml || editableResumeHtml(safeProfile, atsSafeFitted),
      warnings: [],
      plainText: finalPlainText,
      formats,
      recommendedId: preferredFormatId,
    });
  } catch (err) {
    console.error('External resume tailor failed:', err);
    res.status(500).json({ error: err.message || 'Could not tailor a resume for that job link.' });
  }
});

// ─── Google Sign-In (identity only — does NOT connect Gmail) ───
const otpStore = new Map();
const OTP_TTL_MS = 10 * 60 * 1000;
const AUTH_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isLoopbackRequest(req) {
  const address = String(req?.socket?.remoteAddress || req?.ip || '');
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function normalizeAuthEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function createOtpUser(email) {
  let handle = email.split('@')[0].replace(/\d+$/g, '').trim();
  let displayName = handle.replace(/[._-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  const lower = displayName.toLowerCase();
  if (lower.startsWith('nlr ') || lower === 'nlr') {
    displayName = 'Nelluru' + (displayName.length > 3 ? displayName.slice(3) : ' Jaswanth');
  } else if (lower.startsWith('nlrjaswanth')) {
    displayName = 'Nelluru Jaswanth';
  }
  return {
    id: `user-${crypto.createHash('sha256').update(email).digest('hex').slice(0, 16)}`,
    email,
    displayName,
    avatarUrl: '',
    gmailConnected: false,
    gmailEmail: '',
  };
}

app.post('/api/auth/request-otp', async (req, res) => {
  const email = normalizeAuthEmail(req.body?.email);
  if (!AUTH_EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  const issuedAt = Date.now();
  for (const [pendingEmail, pending] of otpStore) {
    if (!pending || pending.expiresAt <= issuedAt) otpStore.delete(pendingEmail);
  }
  const otp = String(crypto.randomInt(100000, 1000000));
  otpStore.set(email, { otp, expiresAt: issuedAt + OTP_TTL_MS, attempts: 0 });

  const gmailUser = String(process.env.GMAIL_USER || '').trim();
  const gmailAppPass = String(process.env.GMAIL_APP_PASS || '').trim();
  if (gmailUser && gmailAppPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: gmailUser, pass: gmailAppPass },
      });
      await transporter.sendMail({
        from: `"Hamzooh" <${gmailUser}>`,
        to: email,
        subject: 'Your Hamzooh login code',
        text: `Your Hamzooh login code is ${otp}. It expires in 10 minutes.`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0;">
            <h2 style="margin: 0 0 16px; color: #0f172a; font-size: 22px; font-weight: 700;">Welcome to Hamzooh</h2>
            <p style="margin: 0 0 24px; color: #475569; font-size: 15px; line-height: 1.5;">Here is your secure one-time verification code to sign in to Hamzooh:</p>
            <div style="background: #f1f5f9; padding: 18px 24px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
              <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #0f172a; font-family: monospace;">${otp}</span>
            </div>
            <p style="margin: 0; color: #94a3b8; font-size: 13px;">This code expires in 10 minutes. If you did not request this, you can safely ignore this email.</p>
          </div>
        `,
      });
      return res.json({ success: true, message: 'OTP sent to your email.' });
    } catch (err) {
      otpStore.delete(email);
      console.error('Error sending login OTP:', err);
      return res.status(500).json({ error: 'Could not send the login code.' });
    }
  }

  // The development shortcut only hands the code back to the machine that asked
  // for it; a remote caller still needs working mail delivery.
  if (process.env.NODE_ENV !== 'production' && isLoopbackRequest(req)) {
    return res.json({ success: true, message: 'OTP generated for development.', devOtp: otp });
  }

  otpStore.delete(email);
  return res.status(503).json({ error: 'Email delivery is not configured.' });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const email = normalizeAuthEmail(req.body?.email);
  const otp = String(req.body?.otp || '').trim();
  if (!AUTH_EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if (!/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: 'OTP must be a 6-digit code.' });
  }

  const stored = otpStore.get(email);
  if (!stored || stored.expiresAt <= Date.now()) {
    otpStore.delete(email);
    return res.status(400).json({ error: 'OTP is invalid or has expired.' });
  }
  if (stored.otp !== otp) {
    // Five wrong guesses retire the code, so the 6-digit space cannot be swept.
    const attempts = Number(stored.attempts || 0) + 1;
    if (attempts >= 5) otpStore.delete(email);
    else stored.attempts = attempts;
    return res.status(400).json({ error: 'OTP is invalid or has expired.' });
  }

  otpStore.delete(email);
  const user = createOtpUser(email);
  const billingUser = upsertUser({
    email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    provider: 'email',
  });
  const access = billingUser ? accessForUser(billingUser) : null;
  res.json({
    token: billingUser ? createSession(billingUser.id) : crypto.randomBytes(32).toString('hex'),
    user: {
      ...user,
      plan: access?.planId || 'free',
      isPro: Boolean(access?.isPro),
    },
  });
});

app.get('/api/auth/google-url', (req, res) => {
  res.json({
    authUrl: buildGoogleAuthUrl(GOOGLE_LOGIN_SCOPES, 'login', 'select_account')
  });
});

// ─── Gmail Connect (mail scopes — used from Mail page only) ───
app.get('/api/gmail/auth-url', (req, res) => {
  const tokens = readGmailTokens();
  const promptParam = tokens.connected && tokens.refresh_token ? 'select_account' : 'consent';
  res.json({
    authUrl: buildGoogleAuthUrl(GOOGLE_GMAIL_SCOPES, 'gmail_connect', promptParam)
  });
});

app.get('/api/gmail/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) {
    return res.status(400).send('Authorization code missing from Google redirect.');
  }

  const oauthState = String(state || 'gmail_connect');

  try {
    const tokenParams = new URLSearchParams({
      code: String(code),
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString()
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || tokenData.error) {
      console.error('OAuth Token Exchange Error:', tokenData);
      return res.status(400).send(`Google Token Exchange Failed: ${tokenData.error_description || tokenData.error}`);
    }

    let userEmail = '';
    let displayName = '';
    let avatarUrl = '';
    try {
      const userData = await fetchGoogleUserInfo(tokenData.access_token);
      if (userData.email) userEmail = userData.email;
      displayName = userData.name || '';
      avatarUrl = userData.picture || '';
    } catch (e) {
      console.warn('Could not fetch Google user info:', e.message);
    }

    if (oauthState === 'login') {
      const billingUser = userEmail
        ? upsertUser({ email: userEmail, displayName, avatarUrl, provider: 'google' })
        : null;
      const params = new URLSearchParams({
        login: 'true',
        email: userEmail,
        name: displayName,
        picture: avatarUrl,
        ...(billingUser ? { token: createSession(billingUser.id) } : {}),
      });
      return res.redirect(`${FRONTEND_URL}/auth/callback?${params.toString()}`);
    }

    const currentTokens = readGmailTokens();
    const updatedTokens = {
      ...currentTokens,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || currentTokens.refresh_token,
      expiry_date: Date.now() + (tokenData.expires_in * 1000),
      email: userEmail,
      displayName: displayName || currentTokens.displayName || '',
      picture: avatarUrl || currentTokens.picture || '',
      connected: true,
      disconnected: false,
      connectedAt: new Date().toISOString()
    };

    writeGmailTokens(updatedTokens);
    process.env.GMAIL_USER = userEmail;

    const connectedParams = new URLSearchParams({
      connected: 'true',
      email: userEmail,
      name: displayName,
      picture: avatarUrl
    });
    const frontendUrl = `${FRONTEND_URL}/auth/callback?${connectedParams.toString()}`;
    res.redirect(frontendUrl);
  } catch (err) {
    console.error('Google Callback Error:', err);
    res.status(500).send(`OAuth Error: ${err.message}`);
  }
});

app.post('/api/gmail/disconnect', (req, res) => {
  // Wipe the session and remember the intent, so a stale .env app password
  // can never make the account look connected again until the user reconnects.
  const tokens = readGmailTokens();
  writeGmailTokens({
    ...tokens,
    connected: false,
    disconnected: true,
    disconnectedAt: new Date().toISOString(),
    access_token: '',
    refresh_token: '',
    expiry_date: 0
  });
  delete process.env.GMAIL_USER;
  res.json({ ok: true, connected: false });
});

app.get('/api/dashboard', async (req, res) => {
  const sessionUser = resolveUser(req);
  const tokens = readGmailTokens();
  let displayName = sessionUser?.displayName || tokens.displayName || '';
  let avatarUrl = sessionUser?.avatarUrl || tokens.picture || '';
  let email = sessionUser?.email || tokens.email || '';

  if (tokens.connected && (!displayName || !email)) {
    try {
      const token = await getValidAccessToken();
      if (token) {
        const info = await fetchGoogleUserInfo(token);
        if (info.name) displayName = info.name;
        if (info.email) email = info.email;
        if (info.picture) avatarUrl = info.picture;
        tokens.displayName = displayName;
        tokens.picture = avatarUrl;
        tokens.email = email;
        writeGmailTokens(tokens);
      }
    } catch (e) {
      console.warn('Could not auto-fetch Google user info for dashboard:', e.message);
    }
  }

  res.json({
    user: {
      id: sessionUser?.id || (email ? `google-${email}` : 'default-user'),
      email: email,
      displayName: displayName || (email ? email.split('@')[0] : 'User'),
      avatarUrl: avatarUrl,
      plan: sessionUser ? accessForUser(sessionUser).planId : 'free',
      isPro: sessionUser ? accessForUser(sessionUser).isPro : false,
      gmailConnection: {
        connected: Boolean(tokens.connected && tokens.email),
        gmailEmail: tokens.email || '',
      }
    }
  });
});

app.get('/api/config/gmail', (req, res) => {
  const tokens = readGmailTokens();
  const hasOAuth = Boolean(GOOGLE_CLIENT_ID && tokens.connected && tokens.refresh_token);

  // Priority 1: User's connected Google Account (via OAuth 2.0 in Mail dashboard)
  if (hasOAuth) {
    return res.json({
      configured: true,
      connected: true,
      method: 'oauth',
      email: tokens.email || '',
      displayName: tokens.displayName || '',
      picture: tokens.picture || '',
    });
  }

  // Priority 2: App password if manually set — but never after an explicit
  // disconnect, otherwise .env credentials make the account look reconnected.
  if (!tokens.disconnected && process.env.GMAIL_USER && process.env.GMAIL_APP_PASS) {
    return res.json({
      configured: true,
      connected: true,
      method: 'app_password',
      email: process.env.GMAIL_USER,
    });
  }

  res.json({
    configured: false,
    connected: false,
    method: 'none',
    email: '',
  });
});

app.post('/api/config/gmail', (req, res) => {
  const { email, appPassword } = req.body || {};
  if (!email || !appPassword) {
    return res.status(400).json({ error: 'Email and 16-character App Password are required.' });
  }

  const cleanPass = appPassword.replace(/\s+/g, '');
  process.env.GMAIL_USER = email.trim();
  process.env.GMAIL_APP_PASS = cleanPass;
  writeGmailTokens({ ...readGmailTokens(), disconnected: false });

  try {
    const envPath = path.join(__dirname, '.env');
    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf8');
      content = content.replace(/^GMAIL_USER=.*$/m, '').replace(/^GMAIL_APP_PASS=.*$/m, '').trim();
    }
    content += `\nGMAIL_USER=${email.trim()}\nGMAIL_APP_PASS=${cleanPass}\n`;
    fs.writeFileSync(envPath, content.trim(), 'utf8');
  } catch (e) {
    console.error('Error writing .env file:', e);
  }

  res.json({ success: true, message: 'Gmail SMTP configured successfully!', email: email.trim() });
});

app.get('/api/sent-emails', (req, res) => {
  res.json(readSentEmails());
});

// ─── Candidate database (profile sync) ───
app.post('/api/candidates/sync', (req, res) => {
  const { email, fullName, phone, batch, institution, skills } = req.body || {};
  const result = upsertCandidate({ email, fullName, phone, batch, institution, skills });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({
    ok: true,
    created: result.created,
    candidate: candidateForClient(result.candidate),
    ...summarizeCandidates(readCandidates()),
  });
});

app.get('/api/candidates', (req, res) => {
  const all = readCandidates().map(candidateForClient);
  const batch = normalizeBatch(req.query.batch);
  const search = cleanString(req.query.search, 120).toLowerCase();

  let candidates = all;
  if (batch && batch !== 'ALL') {
    candidates = candidates.filter((candidate) => (candidate.batch || 'Unassigned') === batch);
  }
  if (search) {
    candidates = candidates.filter((candidate) =>
      [candidate.fullName, candidate.email, candidate.phone, candidate.institution, ...(candidate.skills || [])]
        .join(' ')
        .toLowerCase()
        .includes(search),
    );
  }
  candidates.sort((a, b) => new Date(b.registeredAt || 0) - new Date(a.registeredAt || 0));

  const summary = summarizeCandidates(readCandidates());
  res.json({
    candidates,
    ...summary,
    filters: { batch: batch || 'ALL', search },
  });
});

// ─── Admin: broadcast a batch email (individual sends, never a shared To list) ───
app.get('/api/admin/sent-broadcasts', (req, res) => {
  res.json(readJsonArray(broadcastsFilePath).slice(0, 50));
});

app.post('/api/admin/broadcast-batch-mail', async (req, res) => {
  const { targetBatch, subject, htmlBody, plainText, previewMode } = req.body || {};
  const batch = normalizeBatch(targetBatch) || 'ALL';
  const cleanSubject = cleanString(subject, 200);
  const bodyHtml = typeof htmlBody === 'string' ? htmlBody : '';
  const bodyText = typeof plainText === 'string' ? plainText : '';

  if (!cleanSubject) return res.status(400).json({ error: 'An email subject is required.' });
  if (!bodyHtml.trim() && !bodyText.trim()) return res.status(400).json({ error: 'Write an email body before broadcasting.' });

  const recipients = readCandidates().filter((candidate) => {
    if (batch === 'ALL') return true;
    const value = normalizeBatch(candidate.batch) || 'Unassigned';
    return value === batch;
  });
  if (!recipients.length) {
    return res.status(400).json({ error: batch === 'ALL' ? 'No candidates found.' : `No candidates in the ${batch} batch.` });
  }

  if (previewMode) {
    const sampleCandidate = recipients[0];
    return res.json({
      preview: true,
      targetBatch: batch,
      recipientCount: recipients.length,
      recipients: recipients.slice(0, 50).map((candidate) => ({
        email: candidate.email,
        fullName: candidate.fullName || '',
        batch: normalizeBatch(candidate.batch) || '',
      })),
      sample: {
        to: sampleCandidate.email,
        subject: applyMergeTags(cleanSubject, sampleCandidate),
        html: buildBroadcastEmailHtml({ htmlBody: bodyHtml, plainText: bodyText, candidate: sampleCandidate }),
      },
    });
  }

  if (!process.env.COMPANY_MAIL_PASS) {
    return res.status(503).json({ error: 'Company SMTP is not configured. Add COMPANY_MAIL_PASS to .env to send broadcasts.' });
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mailserver.businessidentity.llc',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: true,
    auth: {
      user: process.env.COMPANY_MAIL_USER || 'job-updates@hamzooh.com',
      pass: process.env.COMPANY_MAIL_PASS,
    },
  });

  try {
    await transporter.verify();
  } catch (error) {
    return res.status(502).json({ error: `Could not reach the company mail server: ${error.message}` });
  }

  const broadcastId = crypto.randomUUID();
  const record = {
    broadcastId,
    targetBatch: batch,
    subject: cleanSubject,
    recipientCount: recipients.length,
    sentCount: 0,
    failedCount: 0,
    status: 'sending',
    timestamp: new Date().toISOString(),
    completedAt: '',
    failures: [],
  };
  const broadcasts = readJsonArray(broadcastsFilePath);
  broadcasts.unshift(record);
  writeJsonArray(broadcastsFilePath, broadcasts);

  // Three small workers keep the SMTP connection healthy without flooding it.
  // Every candidate receives their own message, so no recipient ever sees
  // another candidate's email address.
  const queue = recipients.slice();
  const failures = [];
  let sentCount = 0;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const worker = async () => {
    while (queue.length) {
      const candidate = queue.shift();
      if (!candidate) continue;
      try {
        await transporter.sendMail({
          from: `"${BROADCAST_FROM_NAME}" <${BROADCAST_FROM_EMAIL}>`,
          to: candidate.email,
          subject: applyMergeTags(cleanSubject, candidate),
          text: applyMergeTags(bodyText, candidate) || undefined,
          html: buildBroadcastEmailHtml({ htmlBody: bodyHtml, plainText: bodyText, candidate }),
        });
        sentCount += 1;
      } catch (error) {
        failures.push({ email: candidate.email, error: error.message || 'send failed' });
      }
      await sleep(120);
    }
  };

  try {
    await Promise.all([worker(), worker(), worker()]);
  } catch (error) {
    console.warn('Broadcast worker error:', error.message);
  }

  const status = failures.length === 0 ? 'sent' : sentCount > 0 ? 'partial' : 'failed';
  const stored = readJsonArray(broadcastsFilePath);
  const index = stored.findIndex((item) => item.broadcastId === broadcastId);
  if (index >= 0) {
    stored[index] = {
      ...stored[index],
      sentCount,
      failedCount: failures.length,
      status,
      completedAt: new Date().toISOString(),
      failures: failures.slice(0, 50),
    };
    writeJsonArray(broadcastsFilePath, stored);
  }

  res.json({
    ok: sentCount > 0,
    broadcastId,
    targetBatch: batch,
    recipientCount: recipients.length,
    sentCount,
    failedCount: failures.length,
    status,
    failures: failures.slice(0, 10),
  });
});

app.post('/api/send-email', async (req, res) => {
  const { recipients, subject, bodyText, senderEmail, jobTitle, company, appPassword, resumeBase64, resumeFileName } = req.body || {};

  if (appPassword) {
    process.env.GMAIL_APP_PASS = appPassword.replace(/\s+/g, '');
  }

  const tokens = readGmailTokens();
  const hasOAuth = Boolean(GOOGLE_CLIENT_ID && tokens.connected && tokens.refresh_token);
  const gmailPass = process.env.GMAIL_APP_PASS;
  const gmailUser = String(process.env.GMAIL_USER || senderEmail || '').trim();

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'Recipients array is required.' });
  }

  // Email referral campaign cap: Free can reach 5 contacts per campaign.
  {
    const access = accessForUser(resolveUser(req));
    if (access.planId !== 'legacy' && access.unlockedContacts !== Infinity) {
      const unique = new Set(
        recipients
          .map((r) => String(typeof r === 'string' ? r : r?.email || '').trim().toLowerCase())
          .filter(Boolean),
      );
      if (unique.size > access.unlockedContacts) {
        return res.status(402).json({
          error: `The Free plan can email up to ${access.unlockedContacts} referral contacts per campaign. Upgrade to Pro to reach every discovered contact.`,
          code: 'UPGRADE_REQUIRED',
          feature: 'email_referral_send',
          limit: access.unlockedContacts,
          used: unique.size,
          plan: access.planId,
        });
      }
    }
  }

  try {
    let targetEmail = '';
    let useOAuthRest = false;
    let validAccessToken = null;
    let passTransporter = null;

    // Priority 1: User's connected Google account via OAuth2 (nlr.jaswanth2004@gmail.com)
    // Uses official Google Gmail REST API (over HTTPS port 443) to avoid SMTP socket drops / ISP blocks
    if (hasOAuth) {
      validAccessToken = await getValidAccessToken();
      if (validAccessToken && tokens.email) {
        targetEmail = tokens.email;
        useOAuthRest = true;
        console.log(`[Send Email] Authenticated via User Connected Google Account (Gmail REST API): ${targetEmail}`);
      }
    }

    // Priority 2: Fallback to system App Password if user hasn't connected Google OAuth
    if (!useOAuthRest && gmailPass && gmailUser) {
      targetEmail = gmailUser;
      passTransporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: gmailUser,
          pass: gmailPass,
        },
      });
      try {
        await passTransporter.verify();
      } catch (verifyErr) {
        console.warn('[Send Email] App Password SMTP verification failed:', verifyErr.message);
      }
    }

    if (!useOAuthRest && !passTransporter) {
      return res.status(401).json({
        requireGmailAuth: true,
        error: 'Google Mail Connection required',
        message: 'Please connect your Google account in Mail Automation first.'
      });
    }

    // Prepare attachments (e.g. tailored PDF resume)
    const attachments = [];
    if (resumeBase64) {
      const cleanBase64 = String(resumeBase64).replace(/^data:application\/pdf;base64,/, '');
      attachments.push({
        filename: resumeFileName || `${(targetEmail || 'Candidate').split('@')[0]}_Resume.pdf`,
        content: Buffer.from(cleanBase64, 'base64'),
        contentType: 'application/pdf',
      });
    }

    const results = [];
    const failures = [];
    const allSent = readSentEmails();

    for (const recipient of recipients) {
      const recipientName = recipient.name || 'Hiring Manager';
      const recipientEmail = recipient.email;

      const firstName = recipientName.split(' ')[0];
      const roleLabel = recipient.role || '';
      const fill = (value) => String(value || '')
        .replace(/\{\{outreachEmployeeName\}\}/g, firstName)
        .replace(/\{\{outreachEmployeeRole\}\}/g, roleLabel)
        .replace(/\{\{outreachEmployeeEmail\}\}/g, recipientEmail || '')
        .replace(/\{\{companyName\}\}/g, company || '')
        .replace(/\{\{jobTitle\}\}/g, jobTitle || '');

      const personalizedBody = fill(bodyText);
      const personalizedSubject = fill(subject) || `Application Referral Request for ${jobTitle || 'Role'} at ${company || 'Company'}`;

      let messageId = '';
      try {
        if (useOAuthRest) {
          const sendResult = await sendEmailViaGmailRestApi(validAccessToken, {
            from: `"${targetEmail.split('@')[0]}" <${targetEmail}>`,
            to: recipientEmail,
            subject: personalizedSubject,
            text: personalizedBody,
            html: `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #111;">
              ${personalizedBody.replace(/\n/g, '<br/>')}
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
              <p style="font-size: 12px; color: #777;">
                📎 <em>${attachments.length ? `Attached Resume: ${attachments[0].filename}` : `Attached PDF Resume: ${targetEmail.split('@')[0]}-resume.pdf`}</em>
              </p>
            </div>`,
            attachments,
          });
          messageId = sendResult.id;
        } else {
          const mailOptions = {
            from: `"${targetEmail.split('@')[0]}" <${targetEmail}>`,
            to: recipientEmail,
            subject: personalizedSubject,
            text: personalizedBody,
            html: `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #111;">
              ${personalizedBody.replace(/\n/g, '<br/>')}
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
              <p style="font-size: 12px; color: #777;">
                📎 <em>${attachments.length ? `Attached Resume: ${attachments[0].filename}` : `Attached PDF Resume: ${targetEmail.split('@')[0]}-resume.pdf`}</em>
              </p>
            </div>`,
            attachments,
          };
          const info = await passTransporter.sendMail(mailOptions);
          messageId = info.messageId;
        }

        const sentRecord = {
          id: messageId,
          recipient: recipientEmail,
          recipientName,
          sender: targetEmail,
          subject: personalizedSubject,
          bodyText: personalizedBody,
          jobTitle: jobTitle || '',
          company: company || '',
          sentAt: new Date().toISOString(),
          status: 'Sent',
        };

        results.push(sentRecord);
        allSent.unshift(sentRecord);
      } catch (sendErr) {
        failures.push({ name: recipientName, email: recipientEmail, error: sendErr.message || 'Send failed' });
      }
    }

    writeSentEmails(allSent);

    if (!results.length && failures.length) {
      return res.status(502).json({
        error: `None of the ${failures.length} emails could be sent. ${failures[0].error}`,
        failures,
      });
    }

    res.json({
      success: true,
      message: failures.length
        ? `Sent to ${results.length} of ${recipients.length} employees. ${failures.length} failed.`
        : `Successfully sent real emails to ${recipients.length} company employees!`,
      details: results,
      failures,
      allSent: results.length === recipients.length,
    });
  } catch (err) {
    console.error('Error sending real Gmail email:', err);
    if (err.message && (err.message.includes('Invalid login') || err.message.includes('Username and Password not accepted') || err.code === 'EAUTH')) {
      return res.status(401).json({
        requireGmailAuth: true,
        error: 'Invalid Gmail Credentials',
        message: 'Your Google authentication session expired or password was rejected. Please click Connect to re-authenticate with Google.'
      });
    }
    res.status(500).json({ error: err.message || 'Failed to dispatch referral emails via Gmail.' });
  }
});

// Application State
let activeBotInstance = null;
let activeTrackerInstance = null;

// The Chrome profile can only be owned by one process at a time. Every
// automation engine (campaign, status sync, legacy bot) may hold it, so live
// reads and replies must borrow whichever browser is already open instead of
// launching a second Chrome.
function liveBrowserForReuse() {
  for (const engine of [activeCampaignEngine, activeTrackerInstance, activeBotInstance]) {
    if (engine && engine.isRunning && engine.browser && !engine.browser.disconnected) {
      return engine.browser;
    }
  }
  return null;
}

function liveProfileOwner() {
  return [activeCampaignEngine, activeTrackerInstance, activeBotInstance]
    .find((engine) => engine && engine.isRunning) || null;
}
let currentStatus = 'idle'; // 'idle', 'running', 'syncing', 'requires_login', 'completed', 'stopped'
const logBuffer = [];
let currentProgress = {
  stats: { sent: 0, skipped: 0, failed: 0, totalTarget: 0 },
  currentRole: '',
  currentRoleSent: 0,
  targetPerRole: 10,
  totalRoles: 0,
};

function broadcast(type, data) {
  const payload = JSON.stringify({ type, data });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function pushLog(logObj) {
  logBuffer.push(logObj);
  if (logBuffer.length > 500) logBuffer.shift();
  broadcast('log', logObj);
}

// Live LinkedIn account connect/disconnect events → dashboard
sessionManager.on('account_change', ({ userId, account }) => {
  broadcast('linkedin_account', { userId, account });
  if (account.connected) {
    pushLog({
      timestamp: new Date().toLocaleTimeString('en-IN', { hour12: true }),
      message: `✅ LinkedIn account connected: ${account.memberName || 'LinkedIn Member'} (${account.method === 'li_at' ? 'li_at cookie sync' : 'login window'})`,
      level: 'success',
    });
  }
});

// WebSocket Connection handler
wss.on('connection', (ws) => {
  const allConns = db.getAllConnections();
  const analytics = db.getAnalytics();

  ws.send(
    JSON.stringify({
      type: 'init',
      data: {
        status: currentStatus,
        progress: currentProgress,
        logs: logBuffer.slice(-100),
        connections: allConns,
        analytics,
        accounts: sessionManager.listAccounts(),
        campaign: campaignStore.findActive(),
      },
    })
  );
});

// REST API Endpoints
app.get('/api/status', (req, res) => {
  res.json({
    status: currentStatus,
    progress: currentProgress,
    stats: activeBotInstance ? activeBotInstance.stats : { sent: 0, skipped: 0, failed: 0, totalTarget: 0 },
    analytics: db.getAnalytics(),
  });
});

app.get('/api/connections', (req, res) => {
  const filter = {
    company: req.query.company || 'all',
    status: req.query.status || 'all',
    search: req.query.search || '',
  };
  res.json(db.getAllConnections(filter));
});

app.get('/api/analytics', (req, res) => {
  const company = req.query.company || 'all';
  res.json(db.getAnalytics(company));
});

app.post('/api/chat', async (req, res) => {
  const { message, geminiApiKey } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message query is required' });
  }

  try {
    const existingBrowser = (activeTrackerInstance && activeTrackerInstance.browser) ? activeTrackerInstance.browser :
      (activeBotInstance && activeBotInstance.browser) ? activeBotInstance.browser : null;
    const reply = await handleRagChat(message, geminiApiKey, existingBrowser);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to process RAG chat request' });
  }
});

// ─── Per-User LinkedIn Account Connect API ──────────────────
// User clicks "Connect" in the dashboard → LinkedIn login window opens →
// they log in with THEIR OWN LinkedIn account (2FA supported) → session saved
// under sessions/<userId>/.chrome-data and used by all future campaigns.

app.get('/api/linkedin-account', (req, res) => {
  const userId = req.query.userId || 'default';
  res.json(sessionManager.getAccount(userId));
});

// Method 1: one-click LinkedIn login window
app.post('/api/linkedin/connect', async (req, res) => {
  const userId = (req.body || {}).userId;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  if (activeBotInstance && activeBotInstance.isRunning) {
    return res.status(400).json({ error: 'Stop the running campaign before connecting a new LinkedIn account.' });
  }

  try {
    const result = await sessionManager.startLoginFlow(userId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Method 2: li_at cookie sync (industry-standard method used by Waalaxy/Expandi)
app.post('/api/linkedin/connect-cookie', async (req, res) => {
  const { userId, liAt } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!liAt) return res.status(400).json({ error: 'li_at cookie value is required' });

  if (activeBotInstance && activeBotInstance.isRunning) {
    return res.status(400).json({ error: 'Stop the running campaign before connecting a new LinkedIn account.' });
  }

  try {
    const result = await sessionManager.connectWithCookie(userId, liAt);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/linkedin/disconnect', async (req, res) => {
  const userId = (req.body || {}).userId;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  if (activeBotInstance && activeBotInstance.isRunning) {
    return res.status(400).json({ error: 'Stop the running campaign before disconnecting LinkedIn.' });
  }

  try {
    const result = await sessionManager.disconnect(userId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/linkedin/verify', async (req, res) => {
  const userId = (req.body || {}).userId;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  if (activeBotInstance && activeBotInstance.isRunning) {
    return res.status(400).json({ error: 'Campaign is running — session lock active. Verify after it finishes.' });
  }

  try {
    const result = await sessionManager.verifySession(userId);
    res.json({ ...sessionManager.getAccount(userId), verification: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

async function triggerStatusSync(isAuto = false) {
  if (activeTrackerInstance && activeTrackerInstance.isRunning) {
    if (!isAuto) throw new Error('Background status tracker is already running!');
    return false;
  }

  // A live referral campaign owns the Chrome profile. Reusing its browser keeps
  // the profile lock free; launching a second Chrome would fail the launch.
  const campaignBrowser = (activeCampaignEngine && activeCampaignEngine.isRunning && activeCampaignEngine.browser)
    ? activeCampaignEngine.browser
    : null;
  if (isAuto && activeCampaignEngine && activeCampaignEngine.isRunning && !campaignBrowser) {
    return false;
  }

  const existingBrowser = campaignBrowser
    || ((activeBotInstance && activeBotInstance.isRunning && activeBotInstance.browser) ? activeBotInstance.browser : null);

  // Resolve the connected account first: without it the tracker would create a
  // fresh legacy profile with no LinkedIn cookies and hit a login wall even
  // though the user's saved session is perfectly valid.
  const activeUserId = sessionManager.resolveActiveUser();
  if (activeUserId) {
    setLiveSearchSessionDir(sessionManager.getSessionDir(activeUserId));
  }
  const activeSessionDir = activeUserId ? sessionManager.getSessionDir(activeUserId) : null;
  activeTrackerInstance = new LinkedInTrackerEngine({
    headless: true,
    existingBrowser,
    sessionDir: activeSessionDir || undefined,
  });

  activeTrackerInstance.on('log', (logObj) => {
    pushLog(logObj);
  });

  // A successful background check is a real verification: keep the
  // "Verified" timestamp honest instead of letting it go stale forever.
  activeTrackerInstance.on('session_ok', ({ at }) => {
    if (!activeUserId) return;
    const account = sessionManager.getAccount(activeUserId);
    if (!account.connected) return;
    sessionManager.saveAccount(activeUserId, { ...account, lastVerified: at });
  });

  activeTrackerInstance.on('status_change', ({ status, error }) => {
    // A background (automatic) sync must never turn a healthy connected account
    // into "Login required" in the UI. The saved profile is left untouched; the
    // user is only nudged if they run a sync manually or verify the session.
    const accountStillConnected = activeUserId ? sessionManager.getAccount(activeUserId).connected : false;
    if (isAuto && status === 'requires_login' && accountStillConnected) {
      pushLog({
        timestamp: new Date().toLocaleTimeString('en-IN', { hour12: true }),
        message: '⚠️ Background sync paused: LinkedIn asked for a sign-in while checking invites. Your saved session was not changed — use "Verify session" if this repeats.',
        level: 'warning',
      });
      // Never leave the page stuck on "Syncing" after an abandoned auto-sync.
      if (!activeBotInstance || !activeBotInstance.isRunning) {
        currentStatus = 'idle';
        broadcast('status_change', { status: 'idle' });
      }
      broadcast('connections_updated', { connections: db.getAllConnections(), analytics: db.getAnalytics() });
      return;
    }

    // Only update main status pill to syncing if campaign is not active
    if (!activeBotInstance || !activeBotInstance.isRunning) {
      currentStatus = status;
      broadcast('status_change', { status, error });
    }
    broadcast('connections_updated', { connections: db.getAllConnections(), analytics: db.getAnalytics() });
  });

  pushLog({
    timestamp: new Date().toLocaleTimeString('en-IN', { hour12: true }),
    message: isAuto ? '⏰ Periodic 24/7 Background Status Sync Triggered (2-Hour Interval)...' : '🔍 Background Status Sync Initiated...',
    level: 'info',
  });

  activeTrackerInstance.startSync().catch((err) => {
    pushLog({ timestamp: new Date().toLocaleTimeString('en-IN', { hour12: true }), message: `Tracker Sync Error: ${err.message}`, level: 'error' });
    if (!activeBotInstance || !activeBotInstance.isRunning) {
      currentStatus = 'idle';
      broadcast('status_change', { status: 'idle', error: err.message });
    }
  });

  return true;
}

app.post('/api/sync-status', async (req, res) => {
  try {
    const userId = (req.body || {}).userId || null;
    if (userId) {
      const account = sessionManager.getAccount(userId);
      if (account.connected) {
        sessionManager.setActiveUser(userId);
        setLiveSearchSessionDir(sessionManager.getSessionDir(userId));
      }
    }
    await triggerStatusSync(false);
    res.json({ message: 'Background Connection Status Sync started...' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Auto 24/7 Background Status Tracker (Runs every 15 Minutes automatically)
const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;
setInterval(() => {
  console.log('⏰ Triggering 24/7 periodic background status check...');
  triggerStatusSync(true).catch(() => { });
}, AUTO_SYNC_INTERVAL_MS);
// Trigger initial background sync 15s after boot
setTimeout(() => {
  console.log('🚀 Triggering initial startup background status check...');
  triggerStatusSync(true).catch(() => { });
}, 15000);

app.get('/api/logs', (req, res) => {
  res.json(logBuffer);
});

app.post('/api/start', async (req, res) => {
  if (activeBotInstance && activeBotInstance.isRunning) {
    return res.status(400).json({ error: 'Automation is already running!' });
  }

  const rawConfig = req.body || {};
  const userId = rawConfig.userId || null;

  // Per-user session resolution
  if (userId) {
    const account = sessionManager.getAccount(userId);
    if (!account.connected) {
      return res.status(400).json({ error: 'Connect your LinkedIn account first (Connected Accounts → Connect).' });
    }
    if (sessionManager.isLoginPending(userId)) {
      return res.status(400).json({ error: 'Complete or cancel the pending LinkedIn login window first.' });
    }
    sessionManager.setActiveUser(userId);
    setLiveSearchSessionDir(sessionManager.getSessionDir(userId));
    rawConfig.sessionDir = sessionManager.getSessionDir(userId);
    rawConfig.accountName = account.memberName;
  }

  // Reset buffers
  logBuffer.length = 0;
  currentProgress = {
    stats: { sent: 0, skipped: 0, failed: 0, totalTarget: 0 },
    currentRole: '',
    currentRoleSent: 0,
    targetPerRole: parseInt(rawConfig.connectionsPerFilter, 10) || 10,
    totalRoles: Array.isArray(rawConfig.roles) ? rawConfig.roles.length : 5,
  };

  activeBotInstance = new LinkedInBotEngine(rawConfig);

  if (rawConfig.accountName) {
    pushLog({
      timestamp: new Date().toLocaleTimeString('en-IN', { hour12: true }),
      message: `👤 Using connected LinkedIn account: ${rawConfig.accountName}`,
      level: 'info',
    });
  }

  activeBotInstance.on('log', (logObj) => {
    pushLog(logObj);
  });

  activeBotInstance.on('progress', (progressData) => {
    currentProgress = progressData;
    broadcast('progress', progressData);
  });

  activeBotInstance.on('sent', (sentRecord) => {
    broadcast('sent', sentRecord);
    broadcast('connections_updated', { connections: db.getAllConnections(), analytics: db.getAnalytics() });
  });

  activeBotInstance.on('status_change', ({ status, error }) => {
    currentStatus = status;
    broadcast('status_change', { status, error });
  });

  res.json({ message: 'Automation starting...', config: activeBotInstance.config });

  activeBotInstance.start().catch((err) => {
    pushLog({ timestamp: new Date().toLocaleTimeString(), message: `Fatal: ${err.message}`, level: 'error' });
    currentStatus = 'stopped';
    broadcast('status_change', { status: 'stopped', error: err.message });
  });
});

app.post('/api/stop', async (req, res) => {
  if (activeBotInstance && activeBotInstance.isRunning) {
    await activeBotInstance.stop();
  }
  if (activeTrackerInstance && activeTrackerInstance.isRunning) {
    await activeTrackerInstance.stop();
  }

  currentStatus = 'stopped';
  broadcast('status_change', { status: 'stopped' });
  res.json({ message: 'Stop signal sent successfully.' });
});

// ─── Persistent multi-stage referral campaign ──────────────────
// One campaign record lives in data/campaigns.json and drives BOTH the
// LinkedIn Automation card and the Job Tracker banner. Execution runs in the
// backend engine, so navigation never stops a campaign.

let activeCampaignEngine = null;

function broadcastCampaign(campaign) {
  if (!campaign) return;
  broadcast('campaign_update', campaign);
}

// Company/role matching has to survive encoding noise (– vs —, curly quotes,
// stray punctuation), otherwise the same job starts a second campaign and
// messages the same people twice.
function campaignKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201c\u201d]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sameCampaignTarget(a, b) {
  const left = campaignKey(a);
  const right = campaignKey(b);
  return Boolean(left && right && left === right);
}

function attachCampaignEngine(engine) {
  engine.on('log', (entry) => pushLog(entry));
  engine.on('update', (campaign) => broadcastCampaign(campaign));
  engine.on('status_change', ({ status }) => {
    if (status === 'requires_login' && engine.campaignId) {
      campaignStore.update(engine.campaignId, {
        status: 'needs_attention',
        error: 'LinkedIn asked for a sign-in during the campaign. Reconnect and resume.',
      });
    }
  });
  return engine;
}

async function releaseLinkedInProfileForCampaign() {
  if (!activeTrackerInstance || (!activeTrackerInstance.isRunning && !activeTrackerInstance.browser)) return;
  pushLog({
    timestamp: new Date().toLocaleTimeString('en-IN', { hour12: true }),
    message: 'Pausing the background LinkedIn status sync so the referral campaign can use the saved Chrome profile.',
    level: 'info',
  });
  const tracker = activeTrackerInstance;
  await tracker.stop();
  if (activeTrackerInstance === tracker) activeTrackerInstance = null;
}

app.get('/api/campaigns', (req, res) => {
  res.json({ campaigns: campaignStore.list(), active: campaignStore.findActive() });
});

app.get('/api/campaigns/active', (req, res) => {
  const active = campaignStore.findActive();
  res.json({ active, running: Boolean(activeCampaignEngine && activeCampaignEngine.isRunning) });
});

app.get('/api/campaigns/:id', (req, res) => {
  const campaign = campaignStore.get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
  res.json({ campaign, running: Boolean(activeCampaignEngine && activeCampaignEngine.isRunning && activeCampaignEngine.campaignId === campaign.id) });
});

app.post('/api/campaigns', async (req, res) => {
  try {
    const { userId, company, role, roles, perRole, referralTarget, sendInvites, useAINotes, connectionNote, userProfile } = req.body || {};
    if (!company || !String(company).trim()) {
      return res.status(400).json({ error: 'A target company is required.' });
    }
    if (!role || !String(role).trim()) {
      return res.status(400).json({ error: 'A target job role is required.' });
    }
    if (activeCampaignEngine && activeCampaignEngine.isRunning) {
      // Pressing Start again with the same company + role is not a new campaign:
      // hand back the running one so both pages attach to the same record.
      const existing = campaignStore.get(activeCampaignEngine.campaignId);
      const same = existing
        && sameCampaignTarget(existing.company, company)
        && sameCampaignTarget(existing.role, role);
      if (same) {
        return res.json({
          message: 'This campaign is already running — attached to it.',
          campaign: existing,
          reused: true,
        });
      }
      return res.status(400).json({ error: 'A referral campaign is already running. Pause or stop it first.' });
    }
    if (activeBotInstance && activeBotInstance.isRunning) {
      return res.status(400).json({ error: 'The connection-request campaign is running. Stop it before starting a referral campaign.' });
    }

    // LinkedIn referral campaign entitlements: campaign count per month,
    // requests per campaign, and the monthly request budget.
    {
      const { user, access } = accessFromRequest(req);
      if (access.planId !== 'legacy') {
        const roleCount = Array.isArray(roles) && roles.length ? roles.length : 1;
        const perRoleCount = Math.max(1, Number(perRole) || 10);
        const requested = roleCount * perRoleCount;
        const perCampaignCap = access.campaignRequests;

        if (perCampaignCap !== Infinity && requested > perCampaignCap) {
          return res.status(402).json({
            error: `The Free plan allows ${perCampaignCap} referral requests per campaign. Reduce the roles/requests, or upgrade to Pro for up to 100 a week.`,
            code: 'UPGRADE_REQUIRED',
            feature: 'linkedin_request',
            limit: perCampaignCap,
            used: requested,
            plan: access.planId,
          });
        }

        const campaignGuard = consumeFeature(user, FEATURE_KEYS.LINKEDIN_CAMPAIGN, 1, access);
        if (!campaignGuard.ok) {
          return res.status(402).json(upgradePayload(campaignGuard, access));
        }
        const requestGuard = consumeFeature(user, FEATURE_KEYS.LINKEDIN_REQUEST, requested, access);
        if (!requestGuard.ok) {
          return res.status(402).json(upgradePayload(requestGuard, access));
        }
      }
    }

    await releaseLinkedInProfileForCampaign();

    // A paused or recovery-paused campaign for the exact same company + role is
    // the same job: resume it instead of starting a duplicate that would message
    // the same people twice.
    const resumable = campaignStore.list().find((item) => (
      ['paused', 'needs_attention'].includes(item.status)
      && sameCampaignTarget(item.company, company)
      && sameCampaignTarget(item.role, role)
    ));
    if (resumable && resumable.people?.length) {
      const resumed = campaignStore.update(resumable.id, {
        status: 'queued',
        error: '',
        errorStage: '',
        lastActivity: 'Resuming the existing campaign for this job…',
      });
      activeCampaignEngine = attachCampaignEngine(new ReferralCampaignEngine(resumed));
      broadcastCampaign(resumed);
      activeCampaignEngine.start().catch((err) => {
        pushLog({ timestamp: new Date().toLocaleTimeString('en-IN', { hour12: true }), message: `Campaign error: ${err.message}`, level: 'error' });
      });
      return res.json({
        message: 'Resumed the existing campaign for this job instead of starting a duplicate.',
        campaign: resumed,
        reused: true,
      });
    }

    let sessionDir = '';
    if (userId) {
      const account = sessionManager.getAccount(userId);
      if (!account.connected) {
        return res.status(400).json({ error: 'Connect your LinkedIn account first (Connected Accounts → Connect).' });
      }
      if (sessionManager.isLoginPending(userId)) {
        return res.status(400).json({ error: 'Complete or cancel the pending LinkedIn login window first.' });
      }
      sessionManager.setActiveUser(userId);
      sessionDir = sessionManager.getSessionDir(userId);
      setLiveSearchSessionDir(sessionDir);
    }

    const campaign = campaignStore.create({
      name: `${company} · ${role} referral campaign`,
      company: String(company).trim(),
      role: String(role).trim(),
      userId: userId || null,
      config: {
        roles: Array.isArray(roles) ? roles.filter(Boolean) : [],
        // Stage 2 quota: one independent count per job role.
        perRole: parseInt(perRole, 10) || 10,
        // Stage 1 quota: one company-wide referral-message count. Kept separate
        // from perRole — neither stage reads or adjusts the other's target.
        referralTarget: Math.max(1, parseInt(referralTarget, 10) || 5),
        sendInvites: sendInvites !== false,
        useAINotes: useAINotes !== false,
        connectionNote: connectionNote || '',
        userProfile: userProfile || {},
        sessionDir,
      },
    });

    activeCampaignEngine = attachCampaignEngine(new ReferralCampaignEngine(campaign));
    broadcastCampaign(campaign);
    activeCampaignEngine.start().catch((err) => {
      pushLog({ timestamp: new Date().toLocaleTimeString('en-IN', { hour12: true }), message: `Campaign error: ${err.message}`, level: 'error' });
    });

    res.json({ message: 'Referral campaign started.', campaign });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not start the campaign.' });
  }
});

app.post('/api/campaigns/:id/pause', async (req, res) => {
  const campaign = campaignStore.get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
  if (activeCampaignEngine && activeCampaignEngine.campaignId === campaign.id) {
    await activeCampaignEngine.pause();
  } else {
    campaignStore.update(campaign.id, { status: 'paused', lastActivity: 'Paused by user.' });
  }
  const updated = campaignStore.get(campaign.id);
  broadcastCampaign(updated);
  res.json({ campaign: updated });
});

app.post('/api/campaigns/:id/resume', async (req, res) => {
  const campaign = campaignStore.get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
  if (['completed'].includes(campaign.status)) {
    return res.status(400).json({ error: 'This campaign already completed. Start a new one instead.' });
  }
  if (activeCampaignEngine && activeCampaignEngine.isRunning && activeCampaignEngine.campaignId === campaign.id) {
    await activeCampaignEngine.resume();
  } else {
    if (activeBotInstance && activeBotInstance.isRunning) {
      return res.status(400).json({ error: 'The connection-request campaign is running. Stop it before resuming.' });
    }
    await releaseLinkedInProfileForCampaign();
    const resumed = campaignStore.update(campaign.id, {
      status: 'queued',
      error: '',
      errorStage: '',
      lastActivity: 'Resuming from saved progress…',
    });
    activeCampaignEngine = attachCampaignEngine(new ReferralCampaignEngine(resumed));
    broadcastCampaign(resumed);
    activeCampaignEngine.start().catch((err) => {
      pushLog({ timestamp: new Date().toLocaleTimeString('en-IN', { hour12: true }), message: `Campaign error: ${err.message}`, level: 'error' });
    });
  }
  res.json({ campaign: campaignStore.get(campaign.id) });
});

app.post('/api/campaigns/:id/stop', async (req, res) => {
  const campaign = campaignStore.get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
  if (activeCampaignEngine && activeCampaignEngine.campaignId === campaign.id) {
    await activeCampaignEngine.stop();
    activeCampaignEngine = null;
  } else {
    campaignStore.update(campaign.id, { status: 'paused', lastActivity: 'Stopped by user.' });
  }
  const updated = campaignStore.get(campaign.id);
  broadcastCampaign(updated);
  res.json({ campaign: updated });
});

// A server restart kills any in-flight campaign; mark it paused so the UI can
// offer an honest "resume from saved progress" instead of showing "Running".
campaignStore.reconcileAfterRestart();

// ─── Vault / Answer Sync API (used by Hamzooh Apply extension) ───

// Get all saved answers for extension sync
app.get('/api/vault/answers', (req, res) => {
  try {
    const answers = getAllAnswers();
    res.json({ answers });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not read vault answers.' });
  }
});

// Match credentials for a job portal / domain
app.post('/api/vault/credentials/match', (req, res) => {
  try {
    const { domain } = req.body || {};
    const credential = findVaultCredential(domain);
    res.json({ credential: credential || null });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not find vault credential.' });
  }
});

// Save credentials for a job portal / domain
app.post('/api/vault/credentials', (req, res) => {
  try {
    const { domain, email, password } = req.body || {};
    if (!domain || (!email && !password)) {
      return res.status(400).json({ error: 'domain and email or password are required.' });
    }
    const saved = saveVaultCredential(domain, { email, password, updatedAt: new Date().toISOString() });
    res.json({ success: true, credential: saved });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not save vault credential.' });
  }
});

// Save an answer (with consent flag)
app.post('/api/vault/answers', (req, res) => {
  try {
    const { question, answer, approved } = req.body || {};
    if (!question || answer === undefined) {
      return res.status(400).json({ error: 'question and answer are required.' });
    }
    const result = saveVaultAnswer(question, answer, approved !== false);
    res.json({ ok: true, saved: Boolean(result) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not save vault answer.' });
  }
});

// Find a matching saved answer for a question (semantic matching)
app.post('/api/vault/answers/match', (req, res) => {
  try {
    const { question } = req.body || {};
    if (!question) {
      return res.status(400).json({ error: 'question is required.' });
    }
    const match = findSimilarAnswer(question);
    res.json({ match: match || null });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not search vault answers.' });
  }
});

// AI-powered intelligent question inference from candidate profile, resume, and options
// Enhanced AI inference endpoint using advanced AI engine
app.post('/api/vault/infer-answer-v2', async (req, res) => {
  try {
    const { question, options, profile, resumeText, jobTitle, company, previousAnswers } = req.body || {};

    // Use advanced AI engine
    const { aiEngine } = await import('./lib/advanced-ai-engine.js');

    const decision = await aiEngine.makeDecision({
      question,
      options: options || [],
      profile: profile || {},
      resumeText: resumeText || '',
      jobTitle: jobTitle || '',
      company: company || '',
      previousAnswers: previousAnswers || getAllAnswers(),
    });

    res.json({
      canInfer: decision.confidence >= 0.5,
      answer: decision.answer,
      confidence: decision.confidence,
      source: decision.source,
      reasoning: decision.reasoning,
      alternatives: decision.alternatives || []
    });
  } catch (err) {
    console.error('Enhanced AI inference error:', err);
    res.status(500).json({
      canInfer: false,
      error: err.message || 'AI inference failed',
      reason: 'AI processing error'
    });
  }
});

// Original endpoint (keep for backward compatibility)
app.post('/api/vault/infer-answer', async (req, res) => {
  try {
    const { question, options, profile, resumeText, jobTitle, company } = req.body || {};
    if (!question) {
      return res.status(400).json({ error: 'question is required.' });
    }

    // 1. Check existing vault answers first
    const vaultMatch = findSimilarAnswer(question, 0.45);
    if (vaultMatch && vaultMatch.answer) {
      return res.json({ answer: vaultMatch.answer, source: 'vault', confidence: 0.95, canInfer: true });
    }

    // 2. Profile / deterministic inference — never invent personal facts
    const local = inferFromProfile({ question, options, profile, jobTitle, company });
    if (local.canInfer && local.answer) {
      return res.json({
        answer: local.answer,
        source: local.source,
        confidence: local.confidence || 0.9,
        canInfer: true,
      });
    }
    if (local.reason && String(local.reason).startsWith('missing-')) {
      return res.json({
        answer: null,
        canInfer: false,
        reason: local.reason,
        message: local.message || 'Ask the candidate for this information.',
      });
    }

    // 3. AI reasoning only for non-sensitive unknown questions grounded in the profile/resume
    const prompt = `You are filling a job application for a real candidate. Use ONLY facts in the profile and resume. Never invent work authorization, visa/sponsorship, citizenship, salary, criminal history, disability, age, or other personal legal facts.

Question: "${question}"
${Array.isArray(options) && options.length > 0 ? `Available options: ${JSON.stringify(options)}` : ''}
Target Job: ${jobTitle || 'Role'} at ${company || 'Company'}

Candidate Profile:
- Full Name: ${profile?.fullName || ''}
- Headline: ${profile?.headline || ''}
- Location: ${profile?.location || ''}
- Experience: ${JSON.stringify(profile?.experience || []).slice(0, 800)}
- Education: ${JSON.stringify(profile?.education || []).slice(0, 400)}
- Skills: ${(profile?.skills || []).join(', ')}
- Projects: ${JSON.stringify(profile?.projects || []).slice(0, 400)}

Resume text excerpt:
${String(resumeText || '').slice(0, 1500)}

Rules:
1. If options are provided, select the EXACT text of the most appropriate option from the list.
2. If the answer is not clearly supported by the profile/resume, return {"answer": null, "canInfer": false}.
3. Do not guess Yes/No for legal or eligibility questions.
4. Keep text answers concise and relevant to this job.

Return ONLY JSON:
{
  "answer": "...",
  "canInfer": true,
  "confidence": 0.9
}`;

    let raw = '';
    try {
      raw = await askRadox([{ role: 'user', content: prompt }], { maxTokens: 250, temperature: 0.1 });
    } catch {
      try {
        raw = await askNara([{ role: 'user', content: prompt }], { maxTokens: 250, temperature: 0.1 });
      } catch {
        if (process.env.GEMINI_API_KEY) {
          raw = await askGemini(prompt).catch(() => '');
        }
      }
    }

    if (raw) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        if (parsed?.canInfer && parsed?.answer) {
          let finalAns = String(parsed.answer).trim();
          if (Array.isArray(options) && options.length > 0) {
            const exact = options.find((option) => String(option).toLowerCase() === finalAns.toLowerCase());
            if (!exact) return res.json({ answer: null, canInfer: false, reason: 'no-matching-option' });
            finalAns = exact;
          }
          return res.json({ answer: finalAns, source: 'ai-reasoning', confidence: parsed.confidence || 0.85 });
        }
      }
    }

    return res.json({ answer: null, canInfer: false });
  } catch (err) {
    res.json({ answer: null, canInfer: false, error: err.message });
  }
});

// ─── Auto-Apply Engine (DEPRECATED — use Hamzooh Apply extension instead) ───
let activeAutoApply = null;

app.post('/api/auto-apply', async (req, res) => {
  // Free: 5 auto-applies/month. Pro: unlimited (still single-flight below).
  if (!guardFeature(req, res, FEATURE_KEYS.AUTO_APPLY)) return;
  const { applyUrl, profile, resumeBase64, resumeName, jobTitle, company } = req.body || {};

  if (!applyUrl) {
    return res.status(400).json({ error: 'applyUrl is required.' });
  }

  if (activeAutoApply && activeAutoApply.isRunning) {
    return res.status(409).json({ error: 'Another auto-apply is already in progress. Please wait.' });
  }

  try {
    activeAutoApply = new AutoApplyEngine();

    // Broadcast progress via WebSocket
    activeAutoApply.on('progress', (event) => {
      broadcast('auto_apply_progress', event);
    });

    // Broadcast interactive input requirement to frontend modal
    activeAutoApply.on('input_required', (inputReq) => {
      broadcast('auto_apply_input_required', inputReq);
    });

    activeAutoApply.on('complete', (result) => {
      broadcast('auto_apply_complete', result);
    });

    // Respond immediately, then run in background
    res.json({ message: 'Auto-apply started. Watch for progress updates via WebSocket.', status: 'started' });

    // Run auto-apply (this takes time — progress is sent via WebSocket)
    const result = await activeAutoApply.apply({
      applyUrl,
      profile: profile || {},
      resumeBase64: resumeBase64 || '',
      resumeName: resumeName || 'hamzooh-resume.pdf',
      jobTitle: jobTitle || '',
      company: company || '',
      askAI: askGemini,
    });

    // Result is already broadcast via WebSocket 'complete' event
    console.log(`Auto-apply result for ${company}: ${result.status}`);
  } catch (err) {
    console.error('Auto-apply error:', err);
    broadcast('auto_apply_complete', {
      status: 'failed',
      message: err.message || 'Auto-apply failed.',
      filledFields: [],
      applyUrl,
      jobTitle,
      company,
    });
  }
});

// Close auto-apply browser (manual cleanup)
app.post('/api/auto-apply/close', async (req, res) => {
  if (activeAutoApply) {
    await activeAutoApply.close();
    activeAutoApply = null;
  }
  res.json({ ok: true });
});

// Provide interactive user input (e.g. password, OTP, custom answer)
app.post('/api/auto-apply/provide-input', (req, res) => {
  const { inputId, value, saveToVault, domain, fieldKey } = req.body || {};
  if (!inputId || value === undefined) {
    return res.status(400).json({ error: 'inputId and value are required.' });
  }

  if (activeAutoApply) {
    const success = activeAutoApply.provideUserInput(inputId, value, saveToVault !== false, domain, fieldKey);
    return res.json({ success, message: success ? 'Input received and applied.' : 'Input request expired or not found.' });
  }

  res.status(404).json({ error: 'No active auto-apply process.' });
});

// ── Phase 2/3: AI fallback agent + submission classifier ──────────────────
const AGENT_ACTIONS = new Set([
  'click', 'fill', 'select', 'check', 'upload_resume', 'press_key',
  'scroll', 'wait', 'ask_user', 'need_user', 'done',
]);

function parseAgentAction(raw, snapshot) {
  let text = String(raw || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let action;
  try { action = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!action || typeof action !== 'object' || !AGENT_ACTIONS.has(action.action)) return null;
  const ids = new Set((snapshot?.elements || []).map((el) => Number(el.id)).filter(Number.isFinite));
  if (action.id != null && ids.size > 0 && !ids.has(Number(action.id))) {
    return { action: 'need_user', reason: `Model picked an element id (${action.id}) that is not in the current snapshot.` };
  }
  if (['click', 'fill', 'select', 'check', 'upload_resume'].includes(action.action) && action.id == null) {
    return { action: 'need_user', reason: `Model returned ${action.action} without an element id.` };
  }
  if (action.action === 'fill' && (action.value == null || String(action.value).length > 2000)) {
    return { action: 'need_user', reason: 'Model returned an empty or oversized fill value.' };
  }
  return action;
}

app.post('/api/agent/next-action', async (req, res) => {
  const { snapshot = {}, profile = {}, answers = {}, job = {}, history = [], reason = '' } = req.body || {};
  const compact = {
    url: snapshot.url,
    title: snapshot.title,
    headings: (snapshot.headings || []).slice(0, 12),
    errors: (snapshot.errors || []).slice(0, 10),
    elements: (snapshot.elements || []).slice(0, 90),
  };
  const prompt = `You are the Hamzooh auto-apply agent inside the user's Chrome browser.
Pick EXACTLY ONE next action to advance the job application. Never invent facts.
Use only facts from PROFILE and VAULT ANSWERS. For legal, visa, salary, disability,
gender, criminal or EEO questions: use a stored answer if present, otherwise emit
{"action":"ask_user","question":"...","field_id":N} (EEO "decline to answer" is
acceptable when the vault says so). Never bypass CAPTCHA, OTP, MFA or login walls;
emit {"action":"need_user","reason":"..."} for those. Click Next/Continue/Review or
Submit only when all required fields are filled. On an Easy Apply "Resume"
step, click an existing resume row (a file name ending in PDF/DOC/DOCX) BEFORE
clicking Next. If the next control is off-screen, emit scroll. Do not delete,
withdraw, sign out, or change site settings.

Return ONLY a JSON object, no prose, using one of these shapes:
{"action":"click","id":N}
{"action":"fill","id":N,"value":"..."}
{"action":"select","id":N,"option":"..."}
{"action":"check","id":N,"value":true}
{"action":"upload_resume","id":N}
{"action":"press_key","key":"Enter"}
{"action":"scroll","direction":"down"}
{"action":"wait","ms":800}
{"action":"ask_user","question":"...","field_id":N}
{"action":"need_user","reason":"..."}
{"action":"done","status":"needs_user|failed|submitted"}

LAST ACTIONS: ${JSON.stringify(history.slice(-5)).slice(0, 3000)}
CONTEXT: ${String(reason || '').slice(0, 500)}
JOB: ${JSON.stringify(job).slice(0, 800)}
PROFILE: ${JSON.stringify(profile).slice(0, 4000)}
VAULT ANSWERS: ${JSON.stringify(answers).slice(0, 4000)}
PAGE SNAPSHOT: ${JSON.stringify(compact).slice(0, 24000)}`;
  try {
    const raw = await askGemini(prompt);
    const action = parseAgentAction(raw, compact);
    if (!action) return res.status(502).json({ ok: false, error: 'Model did not return a valid action.', raw: String(raw || '').slice(0, 600) });
    res.json({ ok: true, action });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || 'Agent decision failed.' });
  }
});

app.post('/api/agent/classify-submission', async (req, res) => {
  const { text = '', url = '', errors = [] } = req.body || {};
  const prompt = `Classify whether a job application was submitted.
Reply with exactly one word: submitted, not_submitted, or unclear.
URL: ${String(url).slice(0, 500)}
VISIBLE TEXT: ${String(text).slice(0, 6000)}
ERRORS: ${JSON.stringify(errors).slice(0, 1500)}`;
  try {
    const raw = await askGemini(prompt);
    const normalized = String(raw || '').toLowerCase();
    const verdict = /submitted/.test(normalized) && !/not_submitted|not submitted/.test(normalized)
      ? 'submitted'
      : /not_submitted|not submitted/.test(normalized) ? 'not_submitted' : 'unclear';
    res.json({ ok: true, verdict, raw: String(raw || '').slice(0, 200) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || 'Classification failed.' });
  }
});

// ── Vision-based auto apply (GPT-6-Luna / Gemini) ─────────────────────────
const visionRuns = new Map();

app.post('/api/auto-apply-vision', async (req, res) => {
  const { url, profile = {}, answers = {}, runId = `vision_${Date.now()}` } = req.body || {};
  if (!/^https?:\/\//i.test(String(url || ''))) {
    return res.status(400).json({ ok: false, error: 'A valid job URL is required.' });
  }
  if (visionRuns.has(runId)) {
    return res.status(409).json({ ok: false, error: 'That runId is already in use.' });
  }
  const run = { runId, url, status: 'RUNNING', steps: [], startedAt: Date.now(), result: null };
  visionRuns.set(runId, run);
  res.json({ ok: true, runId });

  const agent = new VisionAgent({
    puppeteer,
    profile,
    answers,
    maxSteps: 40,
    headless: String(process.env.VISION_HEADLESS || 'false') === 'true',
    onEvent: ({ step, message, data, t }) => {
      run.steps.push({ step, message, data, t });
      if (run.steps.length > 400) run.steps.shift();
    },
  });
  try {
    run.result = await agent.run(url);
    run.status = run.result.status === 'submitted' ? 'SUBMITTED'
      : run.result.status === 'needs_user' ? 'NEEDS_USER' : 'FAILED';
  } catch (err) {
    run.result = { status: 'failed', reasonCode: 'CRASH', message: err.message };
    run.status = 'FAILED';
  } finally {
    await agent.close();
    run.endedAt = Date.now();
  }
});

app.get('/api/auto-apply-vision/:runId', (req, res) => {
  const run = visionRuns.get(req.params.runId);
  if (!run) return res.status(404).json({ ok: false, error: 'Unknown vision run.' });
  res.json({ ok: true, run });
});

// ── Extension Vision Action with GPT-6 Luna ───────────────────────────
app.post('/api/extension/vision-action', async (req, res) => {
  const { screenshot, profile = {}, answers = {}, jobTitle = '', company = '', url = '' } = req.body || {};
  if (!screenshot) {
    return res.status(400).json({ ok: false, error: 'Screenshot is required.' });
  }

  const apiKey = process.env.BYNARA_API_KEY || process.env.RADOX_API_KEY || 'coa_3059813e52571581bcbf9f179c163db1';
  const baseURL = (process.env.BYNARA_BASE_URL || process.env.RADOX_BASE_URL || 'https://coarena.ai/api/v1').replace(/\/+$/, '');
  const model = process.env.BYNARA_MODEL || process.env.RADOX_MODEL || 'gpt-6-luna';

  const cleanBase64 = screenshot.includes(',') ? screenshot.split(',')[1] : screenshot;

  const prompt = `You are an expert autonomous browser automation agent applying to a job.
Job: ${jobTitle || 'Role'} at ${company || 'Company'}
Applicant Profile:
- Name: ${profile?.fullName || profile?.name || 'Applicant'}
- Email: ${profile?.email || ''}
- Phone: ${profile?.phone || ''}
- Location: ${profile?.location || ''}
- Experience: ${profile?.experienceYears || '3'} years in software/tech
- Work Authorization: Authorized to work in the country, does NOT require visa sponsorship
- Resume Summary: ${(profile?.resume?.text || profile?.summary || '').slice(0, 300)}

Look carefully at this screenshot of the browser window.
Analyze what is currently on the screen:
1. Is there an "Easy Apply" / "Apply" button visible on the page? -> action: "click_easy_apply"
2. Is an application modal/dialog currently open?
   - Is it loading (spinner active)? -> action: "wait"
   - Are there input fields, radio options, dropdowns, or checkboxes to fill? -> action: "fill_fields"
   - Is there a "Next", "Review", or "Submit application" button? -> action: "click_next" / "click_review" / "click_submit"
3. Is an "Application sent" / "Done" confirmation dialog visible? -> action: "done"

Respond ONLY with valid JSON in this exact structure:
{
  "screenState": "job_page_with_easy_apply" | "modal_loading" | "modal_form_step" | "modal_review_step" | "application_submitted" | "unknown",
  "action": "click_easy_apply" | "wait" | "fill_fields" | "click_next" | "click_review" | "click_submit" | "close_done" | "needs_user",
  "reasoning": "Brief explanation of your decision",
  "fieldsToFill": [
    { "fieldType": "text" | "phone" | "radio" | "dropdown", "fieldLabel": "label or question", "recommendedValue": "answer" }
  ]
}`;

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an autonomous AI browser vision agent. You must inspect the screenshot and return JSON only.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${cleanBase64}` } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 600,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ ok: false, error: `GPT-6 Luna error: ${err.slice(0, 200)}` });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(502).json({ ok: false, error: 'Could not parse JSON action from GPT-6 Luna.' });
    }

    const decision = JSON.parse(match[0]);
    res.json({ ok: true, decision });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Application Flow Blueprints (Train & Replay) ───────────────────────
const blueprintsFilePath = path.join(__dirname, 'data', 'application_blueprints.json');

function loadBlueprints() {
  try {
    if (fs.existsSync(blueprintsFilePath)) {
      return JSON.parse(fs.readFileSync(blueprintsFilePath, 'utf8'));
    }
  } catch {}
  return {};
}

function saveBlueprints(data) {
  try {
    fs.writeFileSync(blueprintsFilePath, JSON.stringify(data, null, 2), 'utf8');
  } catch {}
}

app.get('/api/blueprints', (req, res) => {
  const blueprints = loadBlueprints();
  const domain = req.query.domain ? String(req.query.domain).toLowerCase().replace(/^www\./, '') : '';
  if (domain) {
    const match = blueprints[domain] || Object.values(blueprints).find((b) => domain.includes(b.domain) || b.domain.includes(domain));
    return res.json({ ok: true, blueprint: match || null });
  }
  res.json({ ok: true, blueprints });
});

app.post('/api/blueprints/save', (req, res) => {
  const { domain, blueprint } = req.body || {};
  if (!domain || !blueprint) {
    return res.status(400).json({ ok: false, error: 'domain and blueprint are required.' });
  }
  const cleanDomain = String(domain).toLowerCase().replace(/^www\./, '');
  const blueprints = loadBlueprints();
  blueprints[cleanDomain] = {
    ...blueprint,
    domain: cleanDomain,
    updatedAt: new Date().toISOString(),
  };
  saveBlueprints(blueprints);
  console.log(`[Blueprints] Successfully saved application blueprint for ${cleanDomain}`);
  res.json({ ok: true, domain: cleanDomain, blueprint: blueprints[cleanDomain] });
});

// ── Blueprint Train & Replay (learn a flow once, replay it reliably) ──────
const trainRuns = new Map();
const blueprintRuns = new Map();

function writeResumeFile(resumeBase64, resumeName) {
  if (!resumeBase64) return '';
  let data = String(resumeBase64);
  const comma = data.indexOf(',');
  if (data.startsWith('data:') && comma > -1) data = data.slice(comma + 1);
  const dir = path.join(__dirname, 'data', 'resumes');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(resumeName || 'resume.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    const file = path.join(dir, `${Date.now()}_${safe}`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  } catch { return ''; }
}

// Train: walk the application once and save a semantic playbook.
app.post('/api/train-link', async (req, res) => {
  const { url, profile = {}, answers = {}, resumeBase64 = '', resumeName = '' } = req.body || {};
  if (!/^https?:\/\//i.test(String(url || ''))) {
    return res.status(400).json({ ok: false, error: 'A valid job URL is required.' });
  }
  const trainId = `train_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const run = { trainId, url, status: 'RUNNING', steps: [], startedAt: Date.now(), result: null };
  trainRuns.set(trainId, run);
  res.json({ ok: true, trainId });

  const engine = new BlueprintEngine({
    puppeteer,
    profile,
    answers,
    resumePath: writeResumeFile(resumeBase64, resumeName),
    headless: String(process.env.BLUEPRINT_HEADLESS || 'true') !== 'false',
    onEvent: ({ step, message, data, t }) => {
      run.steps.push({ step, message, data, t });
      if (run.steps.length > 300) run.steps.shift();
    },
  });
  try {
    const result = await engine.train(url);
    if (result.blueprint) {
      const all = loadBlueprints();
      all[result.domain] = { ...result.blueprint, updatedAt: new Date().toISOString() };
      saveBlueprints(all);
    }
    run.result = { status: result.status, message: result.message || `Learned ${result.blueprint?.fieldCount || 0} fields across ${result.blueprint?.steps?.length || 0} steps.`, domain: result.domain, blueprint: result.blueprint };
    run.status = 'TRAINED';
  } catch (err) {
    run.result = { status: 'failed', message: err.message };
    run.status = 'FAILED';
  } finally {
    await engine.close();
    run.endedAt = Date.now();
  }
});

app.get('/api/train-link/:trainId', (req, res) => {
  const run = trainRuns.get(req.params.trainId);
  if (!run) return res.status(404).json({ ok: false, error: 'Unknown training run.' });
  res.json({ ok: true, run });
});

// Replay: fill any similar job link using a learned playbook + current user data.
app.post('/api/auto-apply-blueprint', async (req, res) => {
  const { url, profile = {}, answers = {}, resumeBase64 = '', resumeName = '', domain = '', autoSubmit = false } = req.body || {};
  if (!/^https?:\/\//i.test(String(url || ''))) {
    return res.status(400).json({ ok: false, error: 'A valid job URL is required.' });
  }
  const host = (() => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } })();
  const lookup = String(domain || host).toLowerCase().replace(/^www\./, '');
  const blueprints = loadBlueprints();
  let blueprint = blueprints[lookup]
    || Object.values(blueprints).find((b) => b.domain && (lookup.includes(b.domain) || b.domain.includes(lookup)));
  const learnedNow = !blueprint;

  const runId = `bp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const run = { runId, url, domain: blueprint?.domain || lookup, status: 'RUNNING', steps: [], startedAt: Date.now(), result: null };
  blueprintRuns.set(runId, run);
  res.json({ ok: true, runId, domain: run.domain, learnedNow });

  const engine = new BlueprintEngine({
    puppeteer,
    profile,
    answers,
    resumePath: writeResumeFile(resumeBase64, resumeName),
    headless: String(process.env.BLUEPRINT_HEADLESS || 'true') !== 'false',
    onEvent: ({ step, message, data, t }) => {
      run.steps.push({ step, message, data, t });
      if (run.steps.length > 300) run.steps.shift();
    },
  });
  try {
    if (!blueprint) {
      run.steps.push({ step: 'auto_train', message: '🧠 No playbook for this portal yet — learning the flow on the fly…', t: Date.now() });
      const trained = await engine.train(url);
      blueprint = trained.blueprint;
      const all = loadBlueprints();
      all[trained.domain] = { ...blueprint, updatedAt: new Date().toISOString() };
      saveBlueprints(all);
      run.domain = trained.domain;
      run.steps.push({ step: 'auto_trained', message: `✅ Learned ${blueprint.fieldCount} field(s) across ${blueprint.steps.length} step(s). Replaying with your details now.`, t: Date.now() });
    }
    const result = await engine.replay(url, blueprint, { autoSubmit: autoSubmit === true || autoSubmit === 'true' });
    run.result = result;
    run.status = result.status === 'submitted' ? 'SUBMITTED'
      : result.status === 'needs_user' ? 'NEEDS_USER' : 'FAILED';
  } catch (err) {
    run.result = { status: 'failed', reasonCode: 'CRASH', message: err.message };
    run.status = 'FAILED';
  } finally {
    await engine.close();
    run.endedAt = Date.now();
  }
});

app.get('/api/auto-apply-blueprint/:runId', (req, res) => {
  const run = blueprintRuns.get(req.params.runId);
  if (!run) return res.status(404).json({ ok: false, error: 'Unknown blueprint run.' });
  res.json({ ok: true, run });
});

// API 404 Fallback - Always Return JSON
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API endpoint ${req.originalUrl} not found` });
});

// Global Error Handler Middleware - Always Return JSON
app.use((err, req, res, next) => {
  const status = Number(err?.status || err?.statusCode) || 500;
  if (status >= 500) console.error('Unhandled API Error:', err);
  else console.warn('Request rejected:', err?.message || err);
  res.status(status).json({ error: err?.message || 'Internal Server Error' });
});

let currentPort = Number(PORT);

// Close any open LinkedIn login windows when the server shuts down
process.on('SIGINT', async () => {
  await sessionManager.shutdown();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await sessionManager.shutdown();
  process.exit(0);
});

function startServer(portToListen) {
  server.listen(portToListen);
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`⚠️  Port ${currentPort} is already in use. Retrying on port ${currentPort + 1}...`);
    currentPort++;
    setTimeout(() => {
      startServer(currentPort);
    }, 500);
  } else {
    console.error('❌ Server Listen Error:', err.message);
  }
});

server.on('listening', () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log(`║  🌐 LinkedIn Cloud Automation Web Dashboard Server Running!   ║`);
  console.log(`║  URL: http://localhost:${currentPort}                                 ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [Process] Unhandled Promise Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('❌ [Process] Uncaught Exception:', err);
});

startServer(currentPort);
