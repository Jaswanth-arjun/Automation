/**
 * Multi-stage LinkedIn referral campaign.
 *
 * Stage order (highest priority first):
 *   1. Connected + previously replied      → personalised referral request
 *   2. Connected + message seen, no reply  → polite follow-up
 *   3. Connected + message not seen        → short follow-up
 *   4. Connected + never messaged          → initial referral request
 *   5. Pending connection request          → do nothing
 *   6. Not connected + never requested     → existing connection-request bot
 *
 * Everything is persisted in data/campaigns.json after every single action, so
 * the campaign survives page navigation, refreshes and server restarts.
 */

import { EventEmitter } from 'events';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer-core';

import { campaignStore, STAGE_ORDER, STAGE_LABELS } from './campaign-store.js';
import {
  setLiveSearchSessionDir,
  searchLiveConnections,
  getLiveMessageThreads,
  readLinkedInThread,
  sendLinkedInMessage,
} from './tracker-engine.js';
import { LinkedInBotEngine } from './bot-engine.js';
import { db, extractCompanyName } from './db.js';
import { askFreeLLM, askNara, askRadox, hasFreeLLMAPI } from './ai-provider.js';

const MESSAGE_DELAY = { min: 25000, max: 45000 };
const STAGE_DELAY = { min: 8000, max: 15000 };
const DEEP_READ_CAP = 15;

function getSystemChromePath() {
  const possiblePaths = [
    process.env.CHROME_PATH || '',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'D:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : '',
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe') : '',
    process.env['PROGRAMFILES(X86)'] ? join(process.env['PROGRAMFILES(X86)'], 'Google\\Chrome\\Application\\chrome.exe') : '',
  ];
  for (const p of possiblePaths) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

function norm(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokens(value) {
  return norm(value).split(' ').filter((word) => word.length > 1);
}

const COMPANY_ALIASES = {
  'google': ['google', 'alphabet', 'google llc', 'google india', 'google inc', 'google cloud', 'youtube'],
  'alphabet': ['google', 'alphabet', 'google llc', 'google india', 'google inc'],
  'meta': ['meta', 'facebook', 'instagram', 'whatsapp'],
  'facebook': ['meta', 'facebook', 'instagram', 'whatsapp'],
  'microsoft': ['microsoft', 'msft', 'microsoft corporation', 'microsoft india'],
  'msft': ['microsoft', 'msft', 'microsoft corporation', 'microsoft india'],
  'amazon': ['amazon', 'aws', 'amazon web services', 'amazon development center'],
  'aws': ['amazon', 'aws', 'amazon web services'],
  'apple': ['apple', 'apple inc'],
};

function normalizedCompany(value) {
  return norm(value).replace(/&/g, ' and ')
    .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|llc|plc|pvt|private|technologies|technology|india|global|services|solutions)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function companyMatches(candidate, target) {
  const left = normalizedCompany(candidate);
  const right = normalizedCompany(target);
  if (!left || !right) return false;
  if (left === right) return true;
  if (COMPANY_ALIASES[right]?.some((a) => normalizedCompany(a) === left)) return true;
  if (COMPANY_ALIASES[left]?.some((a) => normalizedCompany(a) === right)) return true;
  return Boolean(left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left)));
}

/** Strict full-name match (same rule the tracker uses to avoid false positives). */
function sameName(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  return ta.length >= 2 && tb.length >= 2 && ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1];
}

function firstNameOf(name) {
  return String(name || '').replace(/[,(].*$/, '').trim().split(/\s+/)[0] || 'there';
}

function cleanMessage(raw, personName) {
  let text = String(raw || '').trim();
  if (!text) return '';
  text = text.replace(/^```[\s\S]*?```$/gm, '');
  text = text.replace(/^(subject|message)\s*:\s*/i, '');
  text = text.replace(/^["'`]+|["'`]+$/g, '').trim();
  text = text.replace(/\[\s*name\s*\]|\{\s*name\s*\}/gi, firstNameOf(personName));
  text = text.replace(/\n{3,}/g, '\n\n');
  if (text.length > 700) {
    const cut = text.slice(0, 700);
    const stop = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
    text = stop > 120 ? cut.slice(0, stop + 1) : cut;
  }
  return text.trim();
}

function fallbackMessage(stage, person, ctx) {
  const first = firstNameOf(person.name);
  const role = ctx.jobRole || 'this role';
  const company = ctx.company || 'your company';
  const sender = ctx.senderName && ctx.senderName !== 'Student' ? ctx.senderName : 'a student';
  const study = [ctx.senderYear, ctx.senderField].filter(Boolean).join(' ');
  const college = ctx.senderCollege && ctx.senderCollege !== 'college' ? ctx.senderCollege : '';

  if (stage === 'replied') {
    return `Hi ${first}, thanks for the earlier conversation! I noticed ${company} is hiring for a ${role} position and I'd really value your referral. ${ctx.senderField ? `My background in ${ctx.senderField} lines up with the role — ` : ''}happy to share my resume if it helps. Thank you!`;
  }
  if (stage === 'seen') {
    return `Hi ${first}, just a quick follow-up on my previous note. I'm very interested in the ${role} opening at ${company} and would be grateful for a referral if you're comfortable with it. No pressure at all — thank you for your time!`;
  }
  if (stage === 'unseen') {
    return `Hi ${first}, I'm ${sender} — I'm keen on the ${role} role at ${company} and would be grateful for a referral if you're open to it. Thanks so much!`;
  }
  const intro = study || college
    ? `I'm ${sender}, ${study ? `a ${study}` : 'a'}${college ? ` student at ${college}` : ' student'}.`
    : `I'm ${sender}.`;
  return `Hi ${first}, ${intro} I saw the ${role} opening at ${company} and would love a referral if you think my profile fits. Happy to send my resume — thank you!`;
}

export class ReferralCampaignEngine extends EventEmitter {
  constructor(campaign) {
    super();
    this.campaignId = campaign.id;
    this.campaignConfig = campaign.config || {};
    this.config = {
      company: campaign.company || '',
      jobRole: campaign.role || '',
      roles: Array.isArray(campaign.config?.roles) ? campaign.config.roles : [],
      perRole: parseInt(campaign.config?.perRole, 10) || 10,
      sendInvites: campaign.config?.sendInvites !== false,
      useAINotes: campaign.config?.useAINotes !== false,
      connectionNote: campaign.config?.connectionNote || '',
      userProfile: campaign.config?.userProfile || {},
      userId: campaign.userId || null,
      sessionDir: campaign.config?.sessionDir || '',
    };
    this.people = Array.isArray(campaign.people) ? [...campaign.people] : [];
    this.isRunning = false;
    this.isPaused = false;
    this.shouldStop = false;
    this.browser = null;
    this.botEngine = null;
    this.deepReads = 0;
    this.messagedBefore = new Set();
    this.needsAttention = false;
    this.attentionReason = '';
    this.currentStage = '';
    this.inviteProgress = { totalTarget: 0, complete: false };
  }

  log(message, level = 'info') {
    const timestamp = new Date().toLocaleTimeString('en-IN', { hour12: true });
    this.emit('log', { timestamp, message, level });
    campaignStore.update(this.campaignId, { lastActivity: message });
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async pauseGap(min, max) {
    const total = this.randomBetween(min, max);
    const until = Date.now() + total;
    while (Date.now() < until) {
      if (this.shouldStop) return;
      await this.sleep(Math.min(1000, Math.max(0, until - Date.now())));
    }
  }

  async waitIfPaused() {
    if (!this.isPaused) return;
    while (this.isPaused && !this.shouldStop) {
      await this.sleep(1000);
    }
  }

  save(statsPatch = {}) {
    const stats = { ...this.statsPatch(), ...statsPatch };
    const campaign = campaignStore.savePeople(this.campaignId, this.people, stats);
    this.emit('update', campaign);
    return campaign;
  }

  statsPatch() {
    const invitePeople = this.people.filter((p) => p.stage === 'not_connected');
    const knownConnections = this.people.length - invitePeople.length;
    const inviteTarget = this.inviteProgress.complete
      ? invitePeople.length
      : Math.max(invitePeople.length, this.inviteProgress.totalTarget || 0);
    const totalEligible = knownConnections + inviteTarget;
    const processed = this.people.filter((p) => Boolean(p.result)).length;
    return {
      totalEligible,
      processed,
      messagesSent: this.people.filter((p) => p.action === 'message' && p.result === 'success').length,
      invitesSent: invitePeople.filter((p) => p.action === 'invite' && p.result === 'success').length,
      skipped: this.people.filter((p) => p.result === 'skipped').length,
      failed: this.people.filter((p) => p.result === 'failed').length,
      remaining: Math.max(0, totalEligible - processed),
    };
  }

  setStatus(status, extra = {}) {
    if (extra.stage) this.currentStage = extra.stage;
    const campaign = campaignStore.update(this.campaignId, { status, ...extra });
    this.emit('update', campaign);
    return campaign;
  }

  setPerson(person, patch) {
    Object.assign(person, patch, { updatedAt: new Date().toISOString() });
    this.save();
  }

  async pause() {
    if (!this.isRunning) return this.setStatus('paused');
    this.isPaused = true;
    return this.setStatus('paused', { lastActivity: 'Paused by user.' });
  }

  async resume() {
    if (this.isPaused) {
      this.isPaused = false;
      this.setStatus('running', { error: '', errorStage: '' });
      this.log('▶️ Campaign resumed.', 'info');
      return this.setStatus('running');
    }
    return this.setStatus('running');
  }

  async stop() {
    this.shouldStop = true;
    this.isPaused = false;
    if (this.botEngine) {
      try { await this.botEngine.stop(); } catch {}
      this.botEngine = null;
    }
    await this.closeBrowser();
    const campaign = this.setStatus('paused', {
      lastActivity: 'Stopped by user. Resume to continue from where it stopped.',
    });
    return campaign;
  }

  async closeBrowser() {
    if (!this.browser) return;
    try { await this.browser.close(); } catch {}
    this.browser = null;
  }

  // ─── browser ────────────────────────────────────────────────

  async launchBrowser() {
    const chromePath = getSystemChromePath();
    if (!chromePath) throw new Error('Chrome browser not found on this machine.');
    const userDataDir = this.config.sessionDir || join(process.cwd(), '.chrome-data');
    mkdirSync(userDataDir, { recursive: true });

    // Clean up stale lock files if any
    for (const lock of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      const lockPath = join(userDataDir, lock);
      if (existsSync(lockPath)) {
        try { unlinkSync(lockPath); } catch {}
      }
    }

    const launchOpts = {
      headless: true,
      executablePath: chromePath,
      userDataDir,
      defaultViewport: { width: 1365, height: 900 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-allow-origins=*',
      ],
    };

    try {
      this.browser = await puppeteer.launch(launchOpts);
    } catch (err) {
      if (process.platform === 'win32' && /failed to launch|already in use|undefined/i.test(String(err?.message))) {
        try {
          const { execSync } = await import('child_process');
          const escapedDir = userDataDir.replace(/\\/g, '\\\\');
          execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name = 'chrome.exe'\\" | Where-Object { \\$_.CommandLine -like '*${escapedDir}*' } | ForEach-Object { Stop-Process -Id \\$_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' });
        } catch {}
        try {
          this.browser = await puppeteer.launch(launchOpts);
        } catch (retryErr) {
          const detail = String(retryErr?.message || retryErr || 'Unknown Chrome startup error').trim();
          throw new Error(`Could not open the saved LinkedIn Chrome profile: ${detail.slice(0, 500)}`);
        }
      } else {
        const detail = String(err?.message || err || 'Unknown Chrome startup error').trim();
        if (/failed to launch|browser process|user data directory is already in use/i.test(detail)) {
          throw new Error(`Could not open the saved LinkedIn Chrome profile. Another LinkedIn sync may still be using it. Wait for that sync to finish, then resume. Chrome detail: ${detail.slice(0, 500)}`);
        }
        throw new Error(`Could not launch Chrome for the LinkedIn campaign: ${detail.slice(0, 500)}`);
      }
    }
    const pages = await this.browser.pages();
    this.startPage = pages[0] || (await this.browser.newPage());
  }

  async verifySession() {
    await this.startPage.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.sleep(3000);
    const url = this.startPage.url();
    const challengePresent = await this.startPage.evaluate(() =>
      /captcha|security check|verify your identity|unusual activity|verify it.?s you/i.test(document.body?.innerText || ''),
    ).catch(() => false);
    if (/\/login|\/authwall|\/checkpoint|\/uas\//.test(url) || challengePresent) {
      throw Object.assign(new Error('LinkedIn requires sign-in or a security check. Complete it in LinkedIn, then resume the campaign.'), { needsAttention: true });
    }
  }

  // ─── AI message writing ────────────────────────────────────

  candidateBrief() {
    const profile = this.config.userProfile || {};
    const resume = profile.resume && profile.resume.text ? String(profile.resume.text) : '';
    const skills = Array.isArray(profile.skills) ? profile.skills.join(', ') : (profile.skills || '');
    const experience = Array.isArray(profile.experience)
      ? profile.experience.map((item) => `${item.role || item.title || ''} at ${item.company || ''} (${item.duration || ''})`).join('; ')
      : (profile.experience || '');
    return [
      `Candidate name: ${profile.fullName || 'the sender'}`,
      `College: ${profile.college || profile.university || ''}`,
      `Graduation year: ${profile.year || ''}`,
      `Field: ${profile.field || profile.department || ''}`,
      `Skills: ${skills}`,
      `Experience: ${experience}`,
      resume ? `Resume excerpt: ${resume.slice(0, 1200)}` : '',
    ].filter(Boolean).join('\n');
  }

  stageInstruction(stage, person) {
    const role = this.config.jobRole || 'the open role';
    const company = this.config.company || 'their company';
    const first = firstNameOf(person.name);
    const preset = person.previous || stage;
    if (preset === 'replied') {
      return `You have already exchanged messages with ${first} before, and they replied. Write a personalised referral request: mention the ${role} opportunity at ${company}, explain briefly why your background fits it, and ask if they would refer you. Reference the earlier conversation naturally. 2-3 short sentences.`;
    }
    if (preset === 'seen') {
      return `You messaged ${first} before and they read it but did not reply. Write a short, polite follow-up asking for a referral for the ${role} role at ${company}. Do not repeat the earlier message, do not sound demanding or repetitive. 2 sentences.`;
    }
    if (preset === 'unseen') {
      return `You messaged ${first} before but they have not opened it. Write a very short polite note (1-2 sentences) that restates your interest in the ${role} role at ${company} and asks for a referral.`;
    }
    return `This is your first message to ${first}, an existing LinkedIn connection. Introduce yourself briefly using your real background and ask if they would be open to referring you for the ${role} role at ${company}. 2-3 short sentences.`;
  }

  async askAI(prompt) {
    const messages = [{ role: 'user', content: prompt }];
    const withTimeout = (promise) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000)),
    ]);
    try {
      const out = await withTimeout(askRadox(messages, { maxTokens: 600, temperature: 0.6 }));
      if (out && out.trim()) return out;
    } catch {}
    try {
      const out = await withTimeout(askNara(messages, { maxTokens: 600, temperature: 0.6 }));
      if (out && out.trim()) return out;
    } catch {}
    try {
      if (hasFreeLLMAPI()) {
        const out = await withTimeout(askFreeLLM(messages, { maxTokens: 600, temperature: 0.6 }));
        if (out && out.trim()) return out;
      }
    } catch {}
    return '';
  }

  async writeMessage(person) {
    const prompt = [
      'You write short LinkedIn messages from a job seeker to a professional contact.',
      'Rules: no placeholders in brackets, no emojis, no links, no markdown, no subject line.',
      'Never invent employers or experience that are not in the candidate details.',
      'Write only the message body, plain text, maximum 80 words.',
      '',
      this.candidateBrief(),
      '',
      `Recipient: ${person.name}${person.headline ? ` — ${person.headline}` : ''}`,
      '',
      this.stageInstruction(person.stage, person),
      '',
      'Message:',
    ].join('\n');

    const ai = await this.askAI(prompt);
    const cleaned = cleanMessage(ai, person.name);
    if (cleaned.length >= 40) return cleaned;
    return cleanMessage(fallbackMessage(person.stage, person, {
      jobRole: this.config.jobRole,
      company: this.config.company,
      senderName: this.config.userProfile?.fullName,
      senderCollege: this.config.userProfile?.college || this.config.userProfile?.university,
      senderYear: this.config.userProfile?.year,
      senderField: this.config.userProfile?.field || this.config.userProfile?.department,
    }), person.name);
  }

  // ─── discovery & classification ────────────────────────────

  loadPreviousCampaignMessages() {
    this.messagedBefore = new Set();
    for (const other of campaignStore.list()) {
      if (other.id === this.campaignId) continue;
      if (norm(other.company) !== norm(this.config.company)) continue;
      if (norm(other.role) !== norm(this.config.jobRole)) continue;
      for (const item of other.people || []) {
        if (item.action === 'message' && item.result === 'success') {
          this.messagedBefore.add(norm(item.profileUrl || item.name));
        }
      }
    }
    if (this.messagedBefore.size) {
      this.log(`🛡️ ${this.messagedBefore.size} people already received this campaign message before — they will be skipped.`, 'info');
    }
  }

  async discover() {
    this.setStatus('running', { stage: 'discovery' });
    this.log(`🔎 Discovering eligible ${this.config.company} connections…`, 'info');

    const found = await searchLiveConnections(extractCompanyName(this.config.company), this.browser);
    if (found.error) {
      if (/search page loaded but no readable result cards found/i.test(found.error)) {
        this.log(`⚠️ ${found.error}`, 'warning');
      } else {
        throw Object.assign(new Error(`Could not safely inspect LinkedIn connections: ${found.error}`), { needsAttention: true });
      }
    }
    const liveConnections = Array.isArray(found.results) ? found.results : [];
    this.log(`👥 ${liveConnections.length} first-degree connections found for ${this.config.company}.`, 'info');

    const threadsResult = await getLiveMessageThreads(this.browser);
    if (threadsResult.error) {
      throw Object.assign(new Error(`Could not safely inspect LinkedIn message history: ${threadsResult.error}`), { needsAttention: true });
    }
    const threads = Array.isArray(threadsResult.threads) ? threadsResult.threads : [];
    this.log(`💬 ${threads.length} existing LinkedIn conversations loaded.`, 'info');

    const companyKey = norm(extractCompanyName(this.config.company));
    const existing = db.getAllConnections().filter((record) => {
      const recordCompany = norm(extractCompanyName(record.company));
      return recordCompany && (recordCompany.includes(companyKey) || companyKey.includes(recordCompany));
    });

    const people = [];
    const seenKeys = new Set();

    const pushPerson = (base) => {
      const key = norm(base.profileUrl || base.name);
      if (!key || seenKeys.has(key)) return;
      seenKeys.add(key);
      people.push(base);
    };

    // Live first-degree connections → connected
    for (const item of liveConnections) {
      const rejectedByHeadline = item.employerRejected === true;
      const isVerified = Boolean(item.employerVerified);
      pushPerson({
        id: `p_${people.length + 1}_${Math.random().toString(36).slice(2, 7)}`,
        name: item.name || '',
        profileUrl: item.url || '',
        headline: item.headline || '',
        currentEmployer: item.currentEmployer || '',
        employerVerified: isVerified,
        employerEvidence: item.employerEvidence || (isVerified ? `Verified: ${item.headline || item.currentEmployer}` : 'Current employer not verified from search result'),
        company: isVerified ? (item.currentEmployer || this.config.company) : '',
        employerRejected: rejectedByHeadline,
        connection: 'connected',
        fromLive: true,
        previous: 'never_messaged',
        stage: 'never_messaged',
        action: rejectedByHeadline ? 'skip' : (!isVerified ? 'skip' : ''),
        message: '',
        result: rejectedByHeadline ? 'skipped' : (!isVerified ? 'skipped' : ''),
        error: rejectedByHeadline
          ? 'Not an active employee - Skipped. Headline indicates former employment, student status, GDSC, or job seeker.'
          : (!isVerified ? 'Not an active employee - Skipped. Current employer could not be verified from search result; held for manual review.' : ''),
        at: null,
      });
    }

    // Database records: pending invites / declined / previously tracked connections
    for (const record of existing) {
      const already = people.find((p) => sameName(p.name, record.name));
      const status = String(record.status || '').toLowerCase();
      if (already) {
        if (!already.profileUrl && record.profileUrl) already.profileUrl = record.profileUrl;
        if (!already.headline && record.headline) already.headline = record.headline;
        // Historical database records do not prove current employment.
        // A live first-degree card wins over a stale "pending" database row —
        // they accepted the invite since the last status sync.
        if (!already.fromLive && (status === 'pending' || status === 'seen')) {
          already.connection = 'pending';
          already.stage = 'pending_invite';
        }
        continue;
      }
      if (status === 'pending' || status === 'seen') {
        pushPerson({
          id: `p_${people.length + 1}_${Math.random().toString(36).slice(2, 7)}`,
          name: record.name || '',
          profileUrl: record.profileUrl || '',
          headline: record.headline || '',
          company: record.company || this.config.company,
          connection: 'pending',
          previous: 'none',
          stage: 'pending_invite',
          action: '',
          message: '',
          result: '',
          error: '',
          at: null,
        });
      } else if (status === 'declined') {
        pushPerson({
          id: `p_${people.length + 1}_${Math.random().toString(36).slice(2, 7)}`,
          name: record.name || '',
          profileUrl: record.profileUrl || '',
          headline: record.headline || '',
          company: record.company || this.config.company,
          connection: 'declined',
          previous: 'none',
          stage: 'pending_invite',
          action: 'skip',
          message: '',
          result: 'skipped',
          error: 'Previous invitation was declined — no new request sent.',
          at: new Date().toISOString(),
        });
      } else if (status === 'accepted' || status === 'replied') {
        pushPerson({
          id: `p_${people.length + 1}_${Math.random().toString(36).slice(2, 7)}`,
          name: record.name || '',
          profileUrl: record.profileUrl || '',
          headline: record.headline || '',
          company: record.company || this.config.company,
          employerVerified: false,
          employerEvidence: 'Stored connection record does not verify current employer',
          connection: 'connected',
          previous: status === 'replied' ? 'replied' : 'never_messaged',
          stage: status === 'replied' ? 'replied' : 'never_messaged',
          action: 'skip',
          message: '',
          result: 'skipped',
          error: 'Current employer could not be verified from the stored connection record; held for manual review.',
          at: null,
        });
      }
    }

    // Classify connected people by their conversation history. Read receipts
    // are unreliable in the list view, so open the thread once per person
    // (capped) and fall back to the tracker's stored "seen" status.
    const seenRecords = new Set(
      existing
        .filter((record) => ['seen', 'replied'].includes(String(record.status || '').toLowerCase()))
        .map((record) => norm(record.name)),
    );
    let classified = 0;
    for (const person of people) {
      if (person.connection !== 'connected') continue;
      if (person.stage === 'replied') continue;
      const thread = threads.find((t) => sameName(t.participants, person.name));
      if (!thread) {
        person.previous = 'never_messaged';
        person.stage = 'never_messaged';
        continue;
      }
      if (thread.lastMessageFromMe === false) {
        // They spoke last — no need to open the thread to know they replied.
        person.previous = 'replied';
        person.stage = 'replied';
      } else if (this.deepReads >= DEEP_READ_CAP) {
        // The inbox list proves there is a prior thread. If the deep-read budget
        // is exhausted, treat it as an existing conversation so we never send
        // an initial message to someone we may already have contacted.
        person.previous = 'seen';
        person.stage = 'seen';
        if (!this.deepReadLimitLogged) {
          this.deepReadLimitLogged = true;
          this.log(`📖 Deep-read limit reached; remaining existing threads will use a safe follow-up classification.`, 'warning');
        }
      } else {
        // Last message was ours. Open the thread to check for an earlier reply
        // and for the read receipt, which decides seen vs unseen.
        const read = await readLinkedInThread(person.name, this.browser);
        const repliedBefore = Array.isArray(read.messages) && read.messages.some((m) => m.direction === 'in');
        if (repliedBefore) {
          person.previous = 'replied';
          person.stage = 'replied';
        } else {
          const seenByThem = read.seenByThem === true || seenRecords.has(norm(person.name));
          person.previous = seenByThem ? 'seen' : 'unseen';
          person.stage = seenByThem ? 'seen' : 'unseen';
        }
        this.deepReads += 1;
      }
      classified += 1;
      if (classified % 5 === 0) this.log(`🗂️ Classified ${classified} conversations so far…`, 'info');
    }

    // Threads we did not open still need a stage: the last message was ours,
    // so treat them as seen (a follow-up) rather than a fresh introduction.
    for (const person of people) {
      if (person.connection !== 'connected' || person.result) continue;
      if (!['replied', 'seen', 'unseen', 'never_messaged'].includes(person.stage)) {
        const hasThread = threads.some((t) => sameName(t.participants, person.name));
        person.previous = hasThread ? 'seen' : 'never_messaged';
        person.stage = hasThread ? 'seen' : 'never_messaged';
      }
    }

    // Never message the same person twice for the same company + role
    this.loadPreviousCampaignMessages();

    const counts = STAGE_ORDER.map((stage) => `${STAGE_LABELS[stage]}: ${people.filter((p) => p.stage === stage).length}`);
    this.log(`🧭 Classification → ${counts.join(' · ')}`, 'info');

    if (people.length === 0) {
      this.log(`No existing ${this.config.company} connections were found; continuing to the configured connection-request stage.`, 'info');
    }

    this.people = people;
    this.save();
    return people;
  }

  // ─── messaging stages ──────────────────────────────────────

  async sendToExistingThread(person, text) {
    const result = await sendLinkedInMessage(person.name, text, this.browser);
    if (result?.ok) {
      return { ok: true, warning: result.warning || '' };
    }
    if (result?.uncertain) {
      return { ok: false, uncertain: true, error: result.error || 'LinkedIn did not confirm the message.' };
    }
    if (/not active|authwall|sign in|reconnect/i.test(result?.error || '')) {
      throw Object.assign(new Error(result.error), { needsAttention: true });
    }
    return { ok: false, error: result?.error || 'Message could not be sent.' };
  }

  async verifyCurrentEmployer(person) {
    if (person.employerVerified === true && (person.company || person.currentEmployer)) {
      if (companyMatches(person.currentEmployer || person.company || person.headline, this.config.company)) {
        return true;
      }
    }
    if (!person.profileUrl) return false;
    const url = person.profileUrl.startsWith('http') ? person.profileUrl : `https://www.linkedin.com${person.profileUrl}`;
    const page = await this.browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await this.sleep(2000);
      const result = await page.evaluate(() => {
        const sections = Array.from(document.querySelectorAll('section'));
        const experience = sections.find((section) => /^(experience|work experience)$/i.test(
          (section.querySelector('h2')?.innerText || section.querySelector('h3')?.innerText || '').trim(),
        ));
        if (!experience) return { employer: '', evidence: 'LinkedIn profile has no readable Experience section' };
        const items = Array.from(experience.querySelectorAll('li, [data-view-name]'));
        for (const item of items) {
          const text = (item.innerText || '').replace(/\s+/g, ' ').trim();
          if (!/\b(present|current)\b/i.test(text)) continue;
          const companyLink = item.querySelector('a[href*="/company/"]');
          let employer = (companyLink?.innerText || '').replace(/\s+/g, ' ').trim();
          if (!employer) {
            const lines = (item.innerText || '').split('\n').map((line) => line.trim()).filter(Boolean);
            employer = lines.find((line) => !/\b(present|current|\d{4}|month|year|·|full-time|part-time|contract|internship)\b/i.test(line)) || '';
          }
          if (employer) return { employer, evidence: `Current Experience entry: ${text.slice(0, 240)}` };
        }
        return { employer: '', evidence: 'No current Experience entry could be verified on the profile' };
      });
      person.currentEmployer = result.employer || '';
      person.employerVerified = companyMatches(result.employer, this.config.company);
      person.employerEvidence = result.evidence;
      person.employerVerifiedAt = new Date().toISOString();
      return person.employerVerified;
    } catch {
      return false;
    } finally {
      try { await page.close(); } catch {}
    }
  }

  async verifyPendingPeople() {
    for (const person of this.people) {
      if (this.shouldStop) return;
      if (person.result || person.stage === 'pending_invite' || person.stage === 'not_connected') continue;
      try {
        const verified = await this.verifyCurrentEmployer(person);
        if (!verified) {
          this.setPerson(person, {
            action: 'skip',
            result: 'skipped',
            error: `Not an active employee - Skipped. ${person.employerEvidence || 'Current employer could not be verified; held for manual review.'}`,
          });
        } else {
          this.setPerson(person, { company: person.currentEmployer, employerVerified: true });
        }
      } catch (err) {
        this.setPerson(person, {
          action: 'skip',
          result: 'skipped',
          error: `Not an active employee - Skipped. Profile verification failed; held for manual review (${err.message}).`,
        });
      }
    }
  }

  async sendNewThread(person, text) {
    if (!person.profileUrl) {
      return { ok: false, error: 'No profile URL to open a new conversation.' };
    }
    const url = person.profileUrl.startsWith('http') ? person.profileUrl : `https://www.linkedin.com${person.profileUrl}`;
    const page = await this.browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.sleep(3500);

      const challengePresent = await page.evaluate(() =>
        /captcha|security check|verify your identity|unusual activity|verify it.?s you/i.test(document.body?.innerText || ''),
      ).catch(() => false);
      if (/\/login|\/authwall|\/checkpoint/.test(page.url()) || challengePresent) {
        throw Object.assign(new Error('LinkedIn requires sign-in or a security check. Complete it in LinkedIn, then resume the campaign.'), { needsAttention: true });
      }

      const button = await page.evaluate(() => {
        const visible = (el) => {
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 5 && rect.height > 5;
        };
        const scope = document.querySelector('.pv-top-card, main') || document.body;
        const buttons = Array.from(scope.querySelectorAll('button, a[role="button"], div[role="button"]')).filter(visible);
        const target = buttons.find((el) => {
          const text = (el.textContent || '').trim().toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          return text === 'message' || aria === 'message' || aria.includes('send a message');
        });
        if (!target) return null;
        target.scrollIntoView({ block: 'center' });
        const rect = target.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });

      if (!button) return { ok: false, error: 'No Message button on this profile (messaging not available).' };

      await page.mouse.click(button.x, button.y);
      await this.sleep(2500);

      const box = await page.evaluate(() => {
        const visible = (el) => {
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 20 && rect.height > 10;
        };
        const candidates = Array.from(document.querySelectorAll(
          'div[contenteditable="true"][role="textbox"], .msg-form__contenteditable, [contenteditable="true"]',
        )).filter(visible);
        const target = candidates[candidates.length - 1];
        if (!target) return null;
        target.scrollIntoView({ block: 'center' });
        const rect = target.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });

      if (!box) return { ok: false, error: 'LinkedIn message box did not open for this profile.' };

      await page.mouse.click(box.x, box.y);
      await this.sleep(700);
      for (const [index, line] of text.split('\n').entries()) {
        if (index > 0) {
          await page.keyboard.down('Shift');
          await page.keyboard.press('Enter');
          await page.keyboard.up('Shift');
        }
        await page.keyboard.type(line, { delay: 12 });
      }
      await this.sleep(700);

      const clicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll(
          'button.msg-form__send-button, button[type="submit"], .msg-form__send-btn',
        ));
        const button2 = buttons.find((el) => {
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          return el.getBoundingClientRect().width > 5 && !el.disabled;
        });
        if (!button2) return false;
        button2.click();
        return true;
      });
      if (!clicked) await page.keyboard.press('Enter');
      await this.sleep(2500);

      const appeared = await page.evaluate((needle) => {
        const texts = Array.from(document.querySelectorAll('[class*="event-listitem__body"], [class*="msg-s-event-listitem__body"]'))
          .map((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim());
        const probe = needle.replace(/\s+/g, ' ').trim().slice(0, 60);
        return texts.some((text) => text.includes(probe));
      }, text).catch(() => false);

    return appeared
      ? { ok: true }
      : {
          ok: false,
          uncertain: true,
          error: 'LinkedIn did not confirm the message in the conversation. Check the thread before trying again.',
        };
    } finally {
      try { await page.close(); } catch {}
    }
  }

  async runMessagingStages() {
    const stages = ['replied', 'seen', 'unseen', 'never_messaged'];
    for (const stage of stages) {
      if (this.shouldStop) break;
      await this.waitIfPaused();
      if (this.shouldStop) break;

      const queue = this.people.filter((p) => p.stage === stage && !p.result);
      if (!queue.length) continue;

      this.setStatus('running', { stage });
      this.log(`▶️ Stage "${STAGE_LABELS[stage]}" — ${queue.length} ${queue.length === 1 ? 'person' : 'people'}.`, 'info');

      for (const person of queue) {
        await this.waitIfPaused();
        if (this.shouldStop) break;

        const key = norm(person.profileUrl || person.name);
        if (this.messagedBefore.has(key)) {
          this.setPerson(person, { action: 'skip', result: 'skipped', error: 'Already received this campaign message in an earlier campaign.' });
          this.log(`↩️ ${person.name} skipped — already messaged for this role.`, 'skip');
          continue;
        }

        try {
          this.setPerson(person, { action: 'message', at: new Date().toISOString() });
          const text = await this.writeMessage(person);
          if (!text) throw new Error('Could not generate a message for this person.');

          const send = person.previous === 'never_messaged' || !person.profileUrl
            ? (person.profileUrl ? await this.sendNewThread(person, text) : { ok: false, error: 'No profile URL for a new conversation.' })
            : await this.sendToExistingThread(person, text);

          if (send.uncertain) {
            this.setPerson(person, {
              result: 'failed',
              message: text,
              error: `${send.error} This contact was held to prevent a duplicate send.`,
              uncertain: true,
            });
            throw Object.assign(new Error(send.error), { needsAttention: true });
          }

          if (send.ok) {
            this.setPerson(person, { result: 'success', message: text, error: send.warning || '' });
            this.log(`✉️ Message sent to ${person.name} (${STAGE_LABELS[stage]}).`, 'success');
          } else {
            this.setPerson(person, { result: 'failed', message: text, error: send.error || 'Send failed.' });
            this.log(`⚠️ Could not message ${person.name}: ${send.error}`, 'warning');
          }
        } catch (err) {
          if (err.needsAttention) throw err;
          this.setPerson(person, { result: 'failed', error: err.message || 'Unexpected error.' });
          this.log(`⚠️ Message to ${person.name} failed: ${err.message}`, 'warning');
        }

        if (!this.shouldStop) await this.pauseGap(MESSAGE_DELAY.min, MESSAGE_DELAY.max);
      }

      if (!this.shouldStop) await this.pauseGap(STAGE_DELAY.min, STAGE_DELAY.max);
    }
  }

  // ─── pending invites (skip) ────────────────────────────────

  async markPendingSkipped() {
    const pending = this.people.filter((p) => p.stage === 'pending_invite' && !p.result);
    if (!pending.length) return;
    for (const person of pending) {
      this.setPerson(person, {
        action: 'skip',
        result: 'skipped',
        error: 'Connection request still pending — nothing sent.',
        at: new Date().toISOString(),
      });
    }
    this.log(`⏸️ ${pending.length} pending invitation ${pending.length === 1 ? 'is' : 'are'} left untouched.`, 'info');
  }

  // ─── stage 6 — existing connection-request automation ─────

  async runInviteStage() {
    if (!this.config.sendInvites) {
      this.log('⏭️ Connection-request stage disabled for this campaign.', 'info');
      return;
    }

    // Each invite role has an exact quota. Invites already sent in earlier runs
    // count against it, so resuming never over-sends for a role.
    const allRoles = Array.isArray(this.campaignConfig?.roles) && this.campaignConfig.roles.length
      ? this.campaignConfig.roles
      : (this.config.roles.length ? this.config.roles : [this.config.jobRole || 'Recruiter']);

    const sentByRole = new Map();
    for (const person of this.people) {
      if (person.action !== 'invite' || person.result !== 'success') continue;
      const key = person.inviteRole || this.config.jobRole || 'outreach';
      sentByRole.set(key, (sentByRole.get(key) || 0) + 1);
    }

    const pendingRoles = [];
    let totalRemaining = 0;
    for (const role of allRoles) {
      const done = sentByRole.get(role) || 0;
      const remaining = Math.max(0, this.config.perRole - done);
      if (remaining > 0) {
        pendingRoles.push({ role, remaining });
        totalRemaining += remaining;
      }
    }

    if (!pendingRoles.length) {
      this.log('✅ Invite quota already met for every role — nothing more to send.', 'info');
      return;
    }

    this.setStatus('running', { stage: 'not_connected' });
    this.log(`🤝 Handing over to the existing connection-request automation (${totalRemaining} invites across ${pendingRoles.length} roles)…`, 'info');
    this.inviteProgress = {
      totalTarget: this.people.filter((p) => p.action === 'invite' && p.result === 'success').length + totalRemaining,
      complete: false,
    };
    this.save();

    await this.closeBrowser();

    for (const { role, remaining } of pendingRoles) {
      if (this.shouldStop) break;
      await this.waitIfPaused();
      if (this.shouldStop) break;

      const excludeProfiles = this.people.flatMap((p) => [p.name, p.profileUrl].filter(Boolean));
      const engine = new LinkedInBotEngine({
        company: this.config.company,
        roles: [role],
        connectionsPerFilter: remaining,
        useAINotes: this.config.useAINotes,
        connectionNote: this.config.connectionNote,
        sessionDir: this.config.sessionDir,
        userProfile: this.config.userProfile,
        headless: true,
        // Anyone already handled by this campaign must never get a second invite.
        excludeProfiles,
      });
      this.botEngine = engine;
      let inviteStatus = '';
      let inviteError = '';

      const recordInviteOutcome = (record, result) => {
        const profileKey = norm(record.url || record.profileUrl || record.name);
        const existing = this.people.find((person) => person.stage === 'not_connected'
          && norm(person.profileUrl || person.name) === profileKey);
        if (existing) return;
        this.people.push({
          id: `p_${this.people.length + 1}_${Math.random().toString(36).slice(2, 7)}`,
          name: record.name || '',
          profileUrl: record.url || record.profileUrl || '',
          headline: record.headline || '',
          company: this.config.company,
          connection: result === 'success' ? 'pending' : (result === 'skipped' ? 'pending' : 'not_connected'),
          previous: 'none',
          stage: 'not_connected',
          inviteRole: role,
          action: 'invite',
          message: record.note || '',
          result,
          error: record.error || '',
          at: record.at || new Date().toISOString(),
        });
        this.save();
      };

      engine.on('log', (entry) => this.log(entry.message, entry.level));
      engine.on('sent', (record) => recordInviteOutcome(record, 'success'));
      engine.on('skipped', (record) => recordInviteOutcome(record, 'skipped'));
      engine.on('failed', (record) => recordInviteOutcome(record, 'failed'));
      engine.on('progress', ({ stats } = {}) => {
        if (stats) this.inviteProgress.totalTarget = Math.max(this.inviteProgress.totalTarget, Number(stats.totalTarget) || 0);
        this.save();
      });
      engine.on('status_change', ({ status, error }) => {
        inviteStatus = status || inviteStatus;
        inviteError = error || inviteError;
        if (status === 'requires_login') {
          this.needsAttention = true;
          this.attentionReason = error || 'LinkedIn asked for a sign-in during the connection-request stage.';
        }
      });

      const pauseWatcher = setInterval(() => {
        engine.isPaused = this.isPaused;
        engine.shouldStop = this.shouldStop;
      }, 500);

      try {
        await engine.start();
      } finally {
        clearInterval(pauseWatcher);
        this.botEngine = null;
      }

      if (inviteError && !this.needsAttention && !this.shouldStop) {
        throw new Error(`Connection-request stage failed: ${inviteError}`);
      }
      if (inviteStatus === 'stopped' && !this.shouldStop && !this.needsAttention) {
        throw new Error('The existing connection-request automation stopped before completing this role.');
      }

      if (this.shouldStop) break;

      if (this.needsAttention) {
        throw Object.assign(new Error(this.attentionReason), { needsAttention: true });
      }
    }

    if (this.shouldStop) {
      this.log('⏸️ Invite stage stopped. Resume to continue sending connection requests.', 'warning');
      return;
    }

    this.inviteProgress = { totalTarget: this.people.filter((p) => p.stage === 'not_connected').length, complete: true };
    this.save();

    const invited = this.people.filter((p) => p.action === 'invite' && p.result === 'success').length;
    this.log(`🤝 Connection-request stage finished — ${invited} invites sent in total.`, 'success');
  }

  // ─── main run ──────────────────────────────────────────────

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.shouldStop = false;

    try {
      const campaign = campaignStore.get(this.campaignId);
      this.setStatus('running', {
        startedAt: campaign?.startedAt || new Date().toISOString(),
        finishedAt: null,
        error: '',
        errorStage: '',
      });

      if (this.config.userId) {
        setLiveSearchSessionDir(this.config.sessionDir || null);
      }

      this.log(`🚀 Campaign "${campaign?.name || this.config.company}" starting for ${this.config.jobRole || 'the selected role'}.`, 'info');

      await this.launchBrowser();
      await this.verifySession();

      if (!this.people.length) {
        await this.discover();
      } else {
        // A person whose action was started but never recorded may already have
        // received the message. Never risk a duplicate — hold them for review.
        let held = 0;
        for (const person of this.people) {
          if (person.action === 'message' && !person.result) {
            person.result = 'failed';
            person.error = 'Interrupted before LinkedIn confirmed this send. Check the thread, then re-run if it never arrived.';
            held += 1;
          }
          if (person.action === 'invite' && !person.result) {
            person.result = 'failed';
            person.error = 'Interrupted before LinkedIn confirmed this invitation.';
            held += 1;
          }
        }
        if (held) {
          this.save();
          this.log(`⚠️ ${held} interrupted ${held === 1 ? 'action was' : 'actions were'} held back to avoid duplicate messages.`, 'warning');
        }
        const remaining = this.people.filter((p) => !p.result).length;
        this.log(`♻️ Resuming with ${remaining} remaining ${remaining === 1 ? 'person' : 'people'}.`, 'info');
      }

      // Re-validate saved records on resume as current employment can change.
      await this.verifyPendingPeople();

      // Duplicate guard must survive a resume, not only a fresh discovery.
      this.loadPreviousCampaignMessages();

      await this.runMessagingStages();
      await this.markPendingSkipped();

      if (!this.shouldStop) {
        await this.runInviteStage();
      }

      const stats = this.statsPatch();
      if (this.needsAttention) {
        this.setStatus('needs_attention', {
          stage: this.currentStage || '',
          error: this.attentionReason || 'LinkedIn needs your input before the campaign can continue.',
          finishedAt: null,
        });
        this.log(`🛑 Campaign paused: ${this.attentionReason}`, 'error');
      } else if (this.shouldStop) {
        this.setStatus('paused', { lastActivity: 'Stopped by user. Resume to continue from where it stopped.' });
      } else if (stats.failed > 0 && stats.messagesSent + stats.invitesSent > 0) {
        this.setStatus('partially_completed', {
          finishedAt: new Date().toISOString(),
          error: `${stats.failed} ${stats.failed === 1 ? 'action' : 'actions'} could not be completed. Everything else finished.`,
        });
        this.log(`⚠️ Campaign partially completed — ${stats.messagesSent} messages, ${stats.invitesSent} invites, ${stats.failed} failed.`, 'warning');
      } else if (stats.failed > 0) {
        this.setStatus('failed', {
          finishedAt: new Date().toISOString(),
          error: `All ${stats.failed} actions failed. Check your LinkedIn session and resume.`,
        });
      } else {
        this.setStatus('completed', {
          finishedAt: new Date().toISOString(),
          stage: 'done',
          lastActivity: `Campaign completed — ${stats.messagesSent} messages sent, ${stats.invitesSent} connection requests sent.`,
        });
        this.log(`🎉 Campaign completed — ${stats.messagesSent} messages, ${stats.invitesSent} invites, ${stats.skipped} skipped.`, 'success');
      }
    } catch (err) {
      if (err.needsAttention) {
        this.setStatus('needs_attention', {
          stage: this.currentStage || 'discovery',
          errorStage: this.currentStage || 'discovery',
          error: err.message,
        });
        this.log(`🛑 Needs attention: ${err.message}`, 'error');
      } else if (this.shouldStop) {
        this.setStatus('paused', { lastActivity: 'Stopped by user.' });
      } else {
        this.setStatus('failed', {
          stage: this.currentStage || '',
          errorStage: this.currentStage || 'discovery',
          error: err.message || 'Campaign failed.',
          finishedAt: new Date().toISOString(),
        });
        this.log(`❌ Campaign failed: ${err.message}`, 'error');
      }
    } finally {
      this.isRunning = false;
      await this.closeBrowser();
      this.emit('update', campaignStore.get(this.campaignId));
    }
  }
}
