import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import multer from 'multer';
import { LinkedInBotEngine } from './lib/bot-engine.js';
import { LinkedInTrackerEngine, setLiveSearchSessionDir } from './lib/tracker-engine.js';
import { LinkedInSessionManager } from './lib/session-manager.js';
import { db } from './lib/db.js';
import { handleRagChat } from './lib/rag-assistant.js';
import { askFreeLLM, askNara, askNvidia } from './lib/ai-provider.js';
import { AutoApplyEngine } from './lib/auto-apply-engine.js';
import { getAllAnswers, saveVaultAnswer, findSimilarAnswer, normalizeQuestion } from './lib/vault-manager.js';

import nodemailer from 'nodemailer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDocumentProxy } from 'unpdf';
import XLSX from 'xlsx';
import { fillPageGaps, fitResumeToOnePage, mergeWithBaseline, renderResumePdf, resumePlainText } from './lib/resume-pdf.js';
import { extractJobPostingJsonLd, validateJobDescription, keywordsFromJob, calculateKeywordCoverage, validateTailoredResume } from './lib/job-analysis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

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

// Multi-tenant LinkedIn session manager (per-user isolated Chrome profiles)
const sessionManager = new LinkedInSessionManager();

wss.on('error', () => {
  // Handle WS server error silently during port retry
});

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Multer for logo uploads ───
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const uploadLogo = multer({ storage: logoStorage, limits: { fileSize: 5 * 1024 * 1024 } });

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

app.post('/api/jobs', (req, res) => {
  const { logo, role, company, filters, mustHaveSkills, goodToHaveSkills, applyLink, description } = req.body || {};
  if (!role || !company || !applyLink || !description) {
    return res.status(400).json({ error: 'role, company, applyLink, and description are required.' });
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
    postedAt: new Date().toISOString(),
  };

  const jobs = readJobs();
  jobs.push(job);
  writeJobs(jobs);

  res.json({ message: 'Job posted successfully!', job });
});

app.delete('/api/jobs/:id', (req, res) => {
  const jobs = readJobs();
  const idx = jobs.findIndex(j => j.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Job not found.' });

  // Delete logo file if exists
  const job = jobs[idx];
  if (job.logo && job.logo.startsWith('/uploads/')) {
    const logoFilePath = path.join(__dirname, job.logo);
    if (fs.existsSync(logoFilePath)) {
      try { fs.unlinkSync(logoFilePath); } catch {}
    }
  }

  jobs.splice(idx, 1);
  writeJobs(jobs);
  res.json({ message: 'Job deleted.' });
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
  const links = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const annotations = await page.getAnnotations();
    for (const annotation of annotations) {
      const url = String(annotation?.url || annotation?.unsafeUrl || '').trim();
      if (/^https?:\/\//i.test(url)) links.push(url);
    }
  }
  return [...new Set(links)];
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
    cb(ok ? null : new Error('Upload a PDF or Excel file.'), ok);
  },
});

app.get('/api/employees', (req, res) => {
  const company = req.query.company;
  const all = readEmployees();
  const list = company ? all.filter(e => companiesMatch(e.company, company)) : all;
  res.json(list);
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
    const links = await pdfToLinks(pdf);
    res.json({ text: String(text || '').slice(0, 20000), links });
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
  const files = [path.join(__dirname, '.env'), path.join(__dirname, 'MailMind AI', '.env')];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const match = fs.readFileSync(file, 'utf8').match(/^GEMINI_API_KEY=(.*)$/m);
    if (match && match[1].trim() && !match[1].includes('your_gemini')) return match[1].trim();
  }
  return '';
}

async function askGemini(prompt) {
  // Nara Router is the configured primary provider for this workspace. It is
  // OpenAI-compatible and avoids consuming Gemini quota for resume tailoring.
  if (process.env.BYNARA_API_KEY || process.env.NARA_API_KEY) {
    try {
      return await askNara([{ role: 'user', content: prompt }], { model: process.env.BYNARA_MODEL || 'agnes-2.5-flash', maxTokens: 2600, temperature: 0.1 });
    } catch (naraError) {
      console.warn('Nara primary provider failed:', String(naraError.message || naraError).slice(0, 240));
    }
  }

  // Gemini is the primary tailoring provider. Prefer generally-available
  // Flash text models: preview Pro/image/TTS models commonly consume a
  // different quota or are unavailable to new API projects.
  const apiKey = getGeminiKey();
  let geminiError = null;
  if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const requestedModel = String(process.env.GEMINI_MODEL || '').trim().replace(/^models\//, '');
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
          const preferPro = String(process.env.GEMINI_PREFER_PRO || 'true').toLowerCase() !== 'false';
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
        console.warn(`Gemini model ${modelName} failed:`, String(err.message || err).slice(0, 220));
        // 429 is project/key quota exhaustion, not a model-specific failure.
        // Retrying every catalog model only creates a long noisy startup and
        // cannot increase the remaining quota.
        if (/\b429\b|too many requests|quota/i.test(String(err.message || err))) break;
      }
    }
  } else {
    geminiError = new Error('Gemini API key is not configured.');
  }

  // NVIDIA is the first fallback for Gemini quota failures. It uses the same
  // OpenAI-compatible chat format and is suitable for the JSON resume prompt.
  try {
    return await askNvidia([{ role: 'user', content: prompt }], { maxTokens: 2200, temperature: 0.1 });
  } catch (nvidiaError) {
    // Continue to the local gateway when NVIDIA is not configured or fails.
    console.warn('NVIDIA fallback unavailable:', String(nvidiaError.message || nvidiaError).slice(0, 220));
  }

  // FreeLLMAPI is the final fallback. It is useful as an availability
  // fallback, but should not silently replace the configured Pro model.
  try {
    return await askFreeLLM([{ role: 'user', content: prompt }]);
  } catch (freeError) {
    const detail = String(geminiError?.message || freeError.message || freeError);
    if (detail.includes('429')) throw new Error('Gemini API rate limit reached (429), and FreeLLMAPI fallback was unavailable. Please wait or check the fallback service.');
    if (detail.includes('503')) throw new Error('Gemini servers are busy (503), and FreeLLMAPI fallback was unavailable. Please try again later.');
    throw new Error(`Gemini primary and FreeLLMAPI fallback both failed: ${detail.slice(0, 220)}`);
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

function categorizeMail(subject, snippet) {
  const text = `${subject} ${snippet}`.toLowerCase();
  if (/interview|recruiter|hiring|job|application|referral|career|opening/.test(text)) return 'Job/Recruitment';
  if (/newsletter|unsubscribe|digest|roundup/.test(text)) return 'Newsletters';
  if (/notification|alert|security|no-reply|noreply|verification/.test(text)) return 'Notifications';
  if (/meeting|project|invoice|update|follow/.test(text)) return 'Work/Professional';
  return 'Uncategorized';
}

async function gmailApi(pathAndQuery) {
  const token = await getValidAccessToken();
  if (!token) {
    const error = new Error('Connect Gmail on the Mail page first.');
    error.status = 401;
    throw error;
  }
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error?.message || 'Gmail request failed.');
    error.status = res.status;
    throw error;
  }
  return data;
}

async function listMailbox(mailbox, size = 20) {
  const query = mailbox === 'SENT' ? 'in:sent' : 'in:inbox';
  const list = await gmailApi(`messages?maxResults=${Math.min(size, 30)}&q=${encodeURIComponent(query)}`);
  const ids = list.messages || [];
  const emails = [];
  for (let i = 0; i < ids.length; i += 5) {
    const chunk = ids.slice(i, i + 5);
    const messages = await Promise.all(chunk.map((item) => gmailApi(`messages/${item.id}?format=full`)));
    messages.forEach((message) => {
      const payload = message.payload || {};
      const subject = gmailHeader(payload, 'Subject') || '(No Subject)';
      const from = parseMailboxAddress(gmailHeader(payload, 'From'));
      const to = parseMailboxAddress(gmailHeader(payload, 'To'));
      const person = mailbox === 'SENT' ? to : from;
      const bodyText = decodeGmailBody(payload).slice(0, 8000);
      const labels = message.labelIds || [];
      emails.push({
        id: message.id,
        threadId: message.threadId,
        subject,
        snippet: message.snippet || '',
        bodyText,
        isRead: !labels.includes('UNREAD'),
        isStarred: labels.includes('STARRED'),
        aiCategory: categorizeMail(subject, message.snippet || ''),
        receivedAt: new Date(Number(message.internalDate || Date.now())).toISOString(),
        sentAt: new Date(Number(message.internalDate || Date.now())).toISOString(),
        senders: [person],
        senderName: person.name,
        senderEmail: person.email,
      });
    });
  }
  return emails;
}

app.get('/api/emails', async (req, res) => {
  try {
    const mailbox = String(req.query.mailbox || 'INBOX').toUpperCase() === 'SENT' ? 'SENT' : 'INBOX';
    const size = parseInt(req.query.size, 10) || 20;
    const emails = await listMailbox(mailbox, size);
    res.json({ emails, total: emails.length, mailbox });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Could not load Gmail messages.' });
  }
});

app.post('/api/gmail/sync', async (req, res) => {
  try {
    const [inbox, sent] = await Promise.all([listMailbox('INBOX', 20), listMailbox('SENT', 20)]);
    res.json({ ok: true, received: inbox.length, sent: sent.length });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Could not sync Gmail.' });
  }
});

app.post('/api/ai/mail/summarize', async (req, res) => {
  try {
    const { subject, from, body } = req.body || {};
    const text = await askGemini(`Summarize this received email in 4 short bullet points. Mention who it is from, what they want, and any deadline or next step.\nFrom: ${from || 'Unknown'}\nSubject: ${subject || ''}\n\n${String(body || '').slice(0, 6000)}`);
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not summarize this email.' });
  }
});

app.post('/api/ai/mail/reply', async (req, res) => {
  try {
    const { subject, from, body } = req.body || {};
    const text = await askGemini(`Write a polite, concise email reply the user can send. Do not invent facts that are not in the email. Keep it under 140 words.\nFrom: ${from || 'Unknown'}\nSubject: ${subject || ''}\n\n${String(body || '').slice(0, 6000)}`);
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not generate a reply.' });
  }
});

app.post('/api/ai/mail/followup', async (req, res) => {
  try {
    const { subject, to, body } = req.body || {};
    const text = await askGemini(`Write a short, polite follow-up email to someone the user already emailed. Reference the earlier message without repeating it. Keep it under 120 words.\nTo: ${to || 'there'}\nEarlier subject: ${subject || ''}\n\nEarlier message:\n${String(body || '').slice(0, 6000)}`);
    res.json({ text, subject: subject?.toLowerCase().startsWith('follow') ? subject : `Following up: ${subject || 'my last email'}` });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not write a follow-up.' });
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
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: fromEmail,
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        refreshToken: tokens.refresh_token,
        accessToken,
      },
    });
    const info = await transporter.sendMail({
      from: `"${fromEmail.split('@')[0]}" <${fromEmail}>`,
      to,
      subject: subject || 'Following up',
      text: body,
    });
    res.json({ ok: true, id: info.messageId });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not send the follow-up.' });
  }
});

function publicJobUrl(raw) {
  if (!String(raw || '').trim()) return null;
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return null;
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
    } catch {}
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
      } catch {}
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
  if (!res.ok || isJobErrorPage(res.url || url, html)) {
    throw new Error('That link opened an error page instead of the job. Paste the job posting address from the browser address bar.');
  }
  const jsonLd = extractJobPostingJsonLd(html);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30000);
  const meta = extractJobMetadata(html, res.url || url, text);
  const posting = validateJobDescription({
    title: jsonLd?.title || meta.title,
    company: jsonLd?.company || meta.company,
    description: jsonLd?.description || text,
  });
  return { text: posting.description, posting, openUrl: res.url || url, applyUrl: extractApplyUrl(html, res.url || url), meta };
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
  const source = normalizeKeyword(sourceText);
  const output = normalizeKeyword(resumePlainText({}, resume));
  const missing = [...new Set((jobKeywords || [])
    .map((keyword) => String(keyword || '').trim())
    .filter((keyword) => keyword.length > 2)
    .filter((keyword) => source.includes(normalizeKeyword(keyword)))
    .filter((keyword) => !output.includes(normalizeKeyword(keyword)))
  )];
  if (!missing.length) return resume;

  const next = { ...resume, skills: [...(resume.skills || [])].map((item) => ({ ...item })) };
  const text = missing.join(', ');
  const existing = next.skills.find((item) => /ats|keyword|skill/i.test(item.label || ''));
  if (existing) {
    existing.value = `${existing.value || ''}${existing.value ? ', ' : ''}${text}`;
  } else if (next.skills.length < 8) {
    next.skills.push({ label: 'ATS Keywords', value: text });
  } else if (next.skills[0]) {
    next.skills[0].value = `${next.skills[0].value || ''}${next.skills[0].value ? ', ' : ''}${text}`;
  }
  return next;
}

// Put job requirements that the model did not surface into a clearly-labelled
// ATS section. These are not presented as proven experience: the label tells
// the candidate to verify them before applying. This prevents a valid resume
// from receiving the same score after tailoring simply because the model
// forgot to repeat an important requirement.
function addTargetedJobKeywords(resume, jobKeywords, sourceText) {
  const source = normalizeKeyword(sourceText);
  const output = normalizeKeyword(resumePlainText({}, resume));
  const missing = [...new Set((jobKeywords || [])
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean)
    .filter((keyword) => !output.includes(normalizeKeyword(keyword)))
  )];
  if (!missing.length) return { resume, added: [] };

  const next = { ...resume, skills: [...(resume.skills || [])].map((item) => ({ ...item })) };
  const label = 'Targeted keywords (verify)';
  const existing = next.skills.find((item) => item.label === label);
  if (existing) existing.value = `${existing.value || ''}${existing.value ? ', ' : ''}${missing.join(', ')}`;
  else next.skills.push({ label, value: missing.join(', ') });
  return { resume: next, added: missing, sourceHasSome: missing.some((keyword) => source.includes(normalizeKeyword(keyword))) };
}

function removeTargetedKeywordSection(value) {
  return String(value || '').replace(/targeted keywords\s*\(verify\)[\s\S]*?(?=\n[A-Z][^\n]{0,50}:|$)/i, '');
}

app.post('/api/external-job/tailor', async (req, res) => {
  try {
    const { url, profile, resumeText, profileResumeText, jobDescription, title, company } = req.body || {};
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
    const prompt = `Tailor this candidate's real resume to the job. Return only JSON.
Keep every real internship, project, school, and achievement. Rephrase the summary so it leads with the job title and the candidate's real stack. Put the skills that match the job first. Do not delete sections. Do not invent employers, schools, projects, dates, or links.
Include important keywords from the job description in the skills section when they are supported by the candidate's resume/profile. If a job keyword is not supported, do not claim it as experience; the server will place it separately in a clearly-labelled "Targeted keywords (verify)" section.
The summary must be 90 to 120 words. Do not use markdown, asterisks, or **bold**. Plain text only.
JSON keys: title, company, keywords, removedKeywords, addedKeywords, name, location, phone, email, linkedin, github, summary, skills, internships, projects, education, extras.
skills items: {label, value}. internships items: {title, linkLabel, url, dates, detail}. projects items: {name, stack, linkLabel, url, detail}. education items: {degree, school, dates, detail}. extras items: {label, value}.
Candidate profile: ${JSON.stringify(profile || {}).slice(0, 4000)}
Full resume: ${sourceResume}
    Job page text: ${jobText.slice(0, 16000)}`;
    let parsed = null;
    try {
      const raw = await askGemini(prompt);
      const jsonStr = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
      parsed = validateTailoredResume(JSON.parse(jsonStr), sourceResume);
    } catch (geminiErr) {
      throw new Error(`Tailoring failed: ${geminiErr.message}. No fallback resume was fabricated.`);
    }

    // The submitted resume is the only resume evidence. Profile is contact metadata,
    // never a hidden shared/master resume.
    const baseline = fitResumeToOnePage(profile || {}, profile || {});
    const tailored = fitResumeToOnePage(parsed, profile || {});
    // Preserve the candidate's real records when a model returns only a partial section.
    for (const key of ['internships', 'projects', 'education', 'extras']) {
      if ((tailored[key] || []).length < (baseline[key] || []).length) tailored[key] = [...(tailored[key] || []), ...(baseline[key] || []).slice((tailored[key] || []).length)];
    }
    const fitted = tailored;
    const safeProfile = profile || {};
    const sourceKeywords = jobKeywords;
    let atsSafeFitted = preserveExistingAtsKeywords(fitted, sourceKeywords, sourceResume);
    const targeted = addTargetedJobKeywords(atsSafeFitted, sourceKeywords, sourceResume);
    atsSafeFitted = targeted.resume;
    // Re-check after normalization and explicitly restore every keyword that
    // contributed to the original score if the one-page fit still dropped it.
    // This keeps a formatting/tailoring pass from reporting a false regression.
    const atsPreview = calculateKeywordCoverage(sourceKeywords, sourceResume, resumePlainText(safeProfile, atsSafeFitted));
    if (atsPreview.afterScore < atsPreview.beforeScore) {
      atsSafeFitted = preserveExistingAtsKeywords(atsSafeFitted, atsPreview.matchedKeywords, sourceResume);
    }
    const formats = [
      { id: 'recommended', name: 'Recommended one page', style: 'recommended' },
      { id: 'modern', name: 'Modern sections', style: 'modern' },
      { id: 'compact', name: 'Compact one page', style: 'compact' },
    ];
    for (const format of formats) {
      format.pdfBase64 = await renderResumePdf(safeProfile, atsSafeFitted, format.style);
      const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(format.pdfBase64, 'base64')));
      const pages = [];
      for (let page = 1; page <= pdf.numPages; page++) pages.push((await (await pdf.getPage(page)).getTextContent()).items.map((item) => item.str).join(' '));
      format.plainText = pages.join('\n');
      format.pageCount = pdf.numPages;
      format.ats = calculateKeywordCoverage(sourceKeywords, sourceResume, removeTargetedKeywordSection(format.plainText));
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
    const verifiedPlainText = removeTargetedKeywordSection(finalPlainText);
    const ats = calculateKeywordCoverage(sourceKeywords, sourceResume, verifiedPlainText);
    const removedKeywords = ats.removedKeywords;
    const addedKeywords = ats.addedKeywords;
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
      ats: {
        ...ats,
        matchedKeywordsBefore: ats.matchedKeywordsBefore || calculateKeywordCoverage(sourceKeywords, sourceResume, sourceResume).matchedKeywords,
        matchedKeywordsAfter: ats.matchedKeywords,
        removedKeywords,
        addedKeywords,
      },
      baselineSource,
      targetedKeywords: targeted.added,
      warnings: targeted.added.length
        ? ['Targeted job keywords were added in a separate “Targeted keywords (verify)” section. Review them before applying; they are not claimed as experience.']
        : [],
      plainText: finalPlainText,
      formats,
      recommendedId: 'recommended',
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

function normalizeAuthEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function createOtpUser(email) {
  const displayName = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
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

  const otp = String(crypto.randomInt(100000, 1000000));
  otpStore.set(email, { otp, expiresAt: Date.now() + OTP_TTL_MS });

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
        from: `"${gmailUser.split('@')[0]}" <${gmailUser}>`,
        to: email,
        subject: 'Your MailMind login code',
        text: `Your MailMind login code is ${otp}. It expires in 10 minutes.`,
      });
      return res.json({ success: true, message: 'OTP sent to your email.' });
    } catch (err) {
      otpStore.delete(email);
      console.error('Error sending login OTP:', err);
      return res.status(500).json({ error: 'Could not send the login code.' });
    }
  }

  if (process.env.NODE_ENV !== 'production') {
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
    return res.status(400).json({ error: 'OTP is invalid or has expired.' });
  }

  otpStore.delete(email);
  const user = createOtpUser(email);
  res.json({
    token: crypto.randomBytes(32).toString('hex'),
    user,
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
      const params = new URLSearchParams({
        login: 'true',
        email: userEmail,
        name: displayName,
        picture: avatarUrl
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
      connected: true,
      connectedAt: new Date().toISOString()
    };

    writeGmailTokens(updatedTokens);
    process.env.GMAIL_USER = userEmail;

    const frontendUrl = `${FRONTEND_URL}/auth/callback?connected=true&email=${encodeURIComponent(userEmail)}`;
    res.redirect(frontendUrl);
  } catch (err) {
    console.error('Google Callback Error:', err);
    res.status(500).send(`OAuth Error: ${err.message}`);
  }
});

app.post('/api/gmail/disconnect', (req, res) => {
  const tokens = readGmailTokens();
  writeGmailTokens({
    ...tokens,
    connected: false,
    access_token: '',
    refresh_token: '',
    expiry_date: 0
  });
  res.json({ ok: true, connected: false });
});

app.get('/api/config/gmail', (req, res) => {
  const tokens = readGmailTokens();
  const configured = tokens.connected === true && Boolean(tokens.refresh_token || (process.env.GMAIL_USER && process.env.GMAIL_APP_PASS));
  res.json({
    configured,
    method: tokens.refresh_token ? 'oauth' : 'app_password',
    email: configured ? (tokens.email || process.env.GMAIL_USER || '') : ''
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

app.post('/api/send-email', async (req, res) => {
  const { recipients, subject, bodyText, senderEmail, jobTitle, company, appPassword } = req.body || {};
  
  if (appPassword) {
    process.env.GMAIL_APP_PASS = appPassword.replace(/\s+/g, '');
  }

  const tokens = readGmailTokens();
  const gmailPass = process.env.GMAIL_APP_PASS;
  const connectedGmail = tokens.connected && tokens.refresh_token ? tokens.email : '';
  const targetEmail = connectedGmail || senderEmail || process.env.GMAIL_USER || '';

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'Recipients array is required.' });
  }

  try {
    let transporter;

    if (connectedGmail) {
      const accessToken = await getValidAccessToken();
      if (!accessToken) {
        return res.status(401).json({
          requireGmailAuth: true,
          error: 'Invalid Gmail Credentials',
          message: 'Gmail needs to be connected again. Open Mail and click Connect, then send this referral.'
        });
      }
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: connectedGmail,
          clientId: GOOGLE_CLIENT_ID,
          clientSecret: GOOGLE_CLIENT_SECRET,
          refreshToken: tokens.refresh_token,
          accessToken,
        }
      });
    } else if (gmailPass && targetEmail) {
      // 2. Send via Gmail App Password
      transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: targetEmail,
          pass: gmailPass,
        },
      });
    } else {
      return res.status(400).json({
        requireGmailAuth: true,
        error: 'Google Mail Connection required for ' + targetEmail,
        message: 'Please connect your Google account with full permissions via Mail Automation -> Connect.'
      });
    }

    const results = [];
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

      const mailOptions = {
        from: `"${targetEmail.split('@')[0]}" <${targetEmail}>`,
        to: recipientEmail,
        subject: personalizedSubject,
        text: personalizedBody,
        html: `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #111;">
          ${personalizedBody.replace(/\n/g, '<br/>')}
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #777;">
            📎 <em>Attached PDF Resume: ${targetEmail.split('@')[0]}-resume.pdf</em>
          </p>
        </div>`,
      };

      const info = await transporter.sendMail(mailOptions);

      const sentRecord = {
        id: info.messageId,
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
    }

    writeSentEmails(allSent);

    res.json({
      success: true,
      message: `Successfully sent real emails to ${recipients.length} company employees!`,
      details: results,
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

  const existingBrowser = (activeBotInstance && activeBotInstance.isRunning && activeBotInstance.browser) ? activeBotInstance.browser : null;

  const activeSessionDir = sessionManager.getActiveSessionDir();
  activeTrackerInstance = new LinkedInTrackerEngine({
    headless: true,
    existingBrowser,
    sessionDir: activeSessionDir || undefined,
  });

  activeTrackerInstance.on('log', (logObj) => {
    pushLog(logObj);
  });

  activeTrackerInstance.on('status_change', ({ status, error }) => {
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
  triggerStatusSync(true).catch(() => {});
}, AUTO_SYNC_INTERVAL_MS);

// Trigger initial background sync 15s after boot
setTimeout(() => {
  console.log('🚀 Triggering initial startup background status check...');
  triggerStatusSync(true).catch(() => {});
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

// ─── Vault / Answer Sync API (used by Hamzo Apply extension) ───

// Get all saved answers for extension sync
app.get('/api/vault/answers', (req, res) => {
  try {
    const answers = getAllAnswers();
    res.json({ answers });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not read vault answers.' });
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

// ─── Auto-Apply Engine (DEPRECATED — use Hamzo Apply extension instead) ───
let activeAutoApply = null;

app.post('/api/auto-apply', async (req, res) => {
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
      resumeName: resumeName || 'hamzo-resume.pdf',
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

// API 404 Fallback - Always Return JSON
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API endpoint ${req.originalUrl} not found` });
});

// Global Error Handler Middleware - Always Return JSON
app.use((err, req, res, next) => {
  console.error('Unhandled API Error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
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

startServer(currentPort);
