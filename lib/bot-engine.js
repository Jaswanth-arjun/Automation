/**
 * Modular Puppeteer Automation Engine for LinkedIn Connections
 * Emits real-time log, progress, and status events to the Web Application backend.
 */

import puppeteer from 'puppeteer-core';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { askFreeLLM, hasFreeLLMAPI } from './ai-provider.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';
import { db, extractCompanyName } from './db.js';
function getSystemChromePath() {
  const possiblePaths = [
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

function parseFollowerCount(text) {
  if (!text) return 0;
  const m = String(text).trim().match(/^([\d.,]+)\s*([KMB])?$/i);
  if (!m) return 0;
  const num = parseFloat(m[1].replace(/,/g, '')) || 0;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
  return Math.round(num * mult);
}

export class LinkedInBotEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = this.normalizeConfig(config);
    this.isRunning = false;
    this.isPaused = false;
    this.shouldStop = false;
    this.browser = null;
    this.page = null;
    this.stats = {
      sent: 0,
      skipped: 0,
      failed: 0,
      totalTarget: 0,
    };
    this.sentList = [];

    // 💾 Gemini quota saver: gender inference results disk cache
    // (re-runs / retries lo same person ki malli API call avvadu)
    this.genderCacheFile = join(process.cwd(), 'data', 'gender-cache.json');
    this.genderCache = new Map();
    try {
      if (existsSync(this.genderCacheFile)) {
        const saved = JSON.parse(readFileSync(this.genderCacheFile, 'utf8'));
        for (const [k, v] of Object.entries(saved || {})) this.genderCache.set(k, v);
      }
    } catch {
      /* corrupt cache — fresh start */
    }

    // ⏱️ Gemini rate-limit guard: calls madhya min gap (burst 429s avoid)
    this._lastGeminiCallAt = 0;

    // Ensure Chrome user profile dir (per-user session dir when provided, else legacy shared dir)
    this.chromeDataDir = this.config.sessionDir || join(process.cwd(), '.chrome-data');
    if (!existsSync(this.chromeDataDir)) {
      mkdirSync(this.chromeDataDir, { recursive: true });
    }

    // LinkedIn company-slug cache: "Angel One" -> "angelone" (verified once, reused after).
    // Guessing `angel-one` opens a wrong/dead page with 0 cards, so we resolve + verify.
    this.companySlugCacheFile = join(process.cwd(), 'data', 'linkedin-company-slugs.json');
    this.companySlugCache = {};
    try {
      if (existsSync(this.companySlugCacheFile)) {
        this.companySlugCache = JSON.parse(readFileSync(this.companySlugCacheFile, 'utf8')) || {};
      }
    } catch {
      this.companySlugCache = {};
    }
  }

  saveCompanySlugCache() {
    try {
      writeFileSync(this.companySlugCacheFile, JSON.stringify(this.companySlugCache, null, 2), 'utf8');
    } catch {}
  }

  companySlugCandidates(companyName) {
    const base = String(companyName || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!base) return [];
    const tokens = base.split(' ').filter(Boolean);
    const hyphen = tokens.join('-');
    const concat = tokens.join('');
    const cands = [hyphen];
    if (concat && concat !== hyphen) cands.push(concat);
    if (tokens.length > 1 && tokens[0].length >= 3) cands.push(tokens[0]);
    return [...new Set(cands)].filter(Boolean);
  }

  async isValidCompanyPage(page, companyName) {
    try {
      const info = await page.evaluate(() => {
        const bodyText = document.body ? document.body.innerText.slice(0, 6000) : '';
        if (/this page doesn.t exist|page not found|couldn.t be found/i.test(bodyText)) {
          return { ok: false, reason: '404 text on page' };
        }
        if (!window.location.href.includes('/company/')) {
          return { ok: false, reason: 'redirected away from /company/' };
        }
        // Auto-generated / unclaimed pages LOOK valid (name matches!) but have
        // zero members — e.g. /company/angel-one/ vs the real /company/angelone/.
        if (/unclaimed page|automatically created by LinkedIn|0 associated members/i.test(bodyText)) {
          return { ok: false, reason: 'unclaimed/auto-generated page (0 members)', unclaimed: true };
        }
        const nameEl = document.querySelector(
          '.org-top-card-summary__title, .org-top-card__title, h1.top-card-layout__title'
        );
        const shownName = nameEl ? (nameEl.textContent || '').trim() : '';
        const hasOrg = Boolean(
          document.querySelector('.org-top-card, .org-top-card-summary, [data-test-id="org-top-card"]') ||
          /followers|employees/i.test(bodyText)
        );
        const folMatch = bodyText.match(/([\d.,]+[KMB]?)\s*followers/i);
        return { ok: hasOrg, shownName, followersText: folMatch ? folMatch[1] : '', reason: hasOrg ? '' : 'no org card markers' };
      });
      if (!info || !info.ok) {
        return { ok: false, reason: info?.reason || 'unknown', unclaimed: Boolean(info?.unclaimed) };
      }
      // Name sanity: shown org name must share a significant token with expected company.
      const want = String(companyName || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
      const shown = String(info.shownName || '').toLowerCase();
      if (want.length && shown && !want.some((t) => shown.includes(t))) {
        return { ok: false, reason: `name mismatch (page shows "${info.shownName}")` };
      }
      return { ok: true, shownName: info.shownName, followers: parseFollowerCount(info.followersText) };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  // Resolve the REAL linkedin.com/company/<slug> for a display name like "Angel One"
  // (real slug is "angelone", NOT the naive "angel-one" — which is an unclaimed
  // auto-generated page with 0 members). Probes every candidate, picks the claimed
  // page with the most followers, caches the winner on disk.
  async resolveCompanyPeopleUrl(page) {
    if (this.config.companyUrlProvided) {
      this.log(`🔗 Using provided LinkedIn company URL: ${this.config.basePeopleUrl}`, 'info');
      return true;
    }
    const name = this.config.companyName;
    const cacheKey = String(name || '').toLowerCase().trim();

    const useSlug = (slug, how) => {
      this.config.basePeopleUrl = `https://www.linkedin.com/company/${slug}/people/`;
      this.companySlugCache[cacheKey] = slug;
      this.saveCompanySlugCache();
      this.log(`🔗 Resolved LinkedIn company "${name}" → linkedin.com/company/${slug}/ (${how})`, 'success');
    };

    // Cached slug is re-validated (an old cache may hold a bad unclaimed slug).
    const cached = this.companySlugCache[cacheKey];
    if (cached) {
      try {
        await page.goto(`https://www.linkedin.com/company/${cached}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await this.sleep(5000);
        const check = await this.isValidCompanyPage(page, name);
        if (check.ok) {
          useSlug(cached, `cached, ${(check.followers || 0).toLocaleString('en-IN')} followers`);
          return true;
        }
        this.log(`⚠️ Cached slug "${cached}" no longer valid (${check.reason}) — re-resolving...`, 'warning');
        delete this.companySlugCache[cacheKey];
      } catch (err) {
        this.log(`⚠️ Cached slug check failed: ${err.message} — re-resolving...`, 'warning');
      }
    }

    const candidates = this.companySlugCandidates(name);
    this.log(`🔗 Resolving LinkedIn page for "${name}" — trying: ${candidates.join(', ')} ...`, 'info');
    let best = null; // { slug, followers, shownName }
    for (const cand of candidates) {
      if (this.shouldStop) return false;
      try {
        await page.goto(`https://www.linkedin.com/company/${cand}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await this.sleep(6000);
        const check = await this.isValidCompanyPage(page, name);
        if (check.ok) {
          const followers = check.followers || 0;
          this.log(`   • linkedin.com/company/${cand}/ → "${check.shownName || name}" (${followers.toLocaleString('en-IN')} followers)`, 'info');
          if (!best || followers > best.followers) {
            best = { slug: cand, followers, shownName: check.shownName };
          }
        } else {
          this.log(`   • linkedin.com/company/${cand}/ rejected (${check.reason})`, 'info');
        }
      } catch (err) {
        this.log(`   • probe failed for "${cand}": ${err.message}`, 'warning');
      }
    }
    if (best && !this.shouldStop) {
      useSlug(best.slug, `"${best.shownName || name}", ${best.followers.toLocaleString('en-IN')} followers`);
      return true;
    }

    // Fallback: LinkedIn company search, take the top result's slug and verify it.
    try {
      if (!this.shouldStop) {
        this.log(`🔎 Slug probes failed — searching LinkedIn companies for "${name}"...`, 'info');
        await page.goto(
          `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(name)}`,
          { waitUntil: 'domcontentloaded', timeout: 45000 }
        );
        await this.sleep(6000);
        const slug = await page.evaluate(() => {
          const links = [...document.querySelectorAll("a[href*='/company/']")];
          for (const a of links) {
            const href = a.getAttribute('href') || '';
            const m = href.match(/\/company\/([^\/?#]+)/);
            if (m && m[1] && !['feed', 'jobs', 'people', 'about', 'posts'].includes(m[1])) return m[1];
          }
          return '';
        });
        if (slug) {
          await page.goto(`https://www.linkedin.com/company/${slug}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await this.sleep(6000);
          const check = await this.isValidCompanyPage(page, name);
          if (check.ok) {
            useSlug(slug, 'via company search');
            return true;
          }
        }
      }
    } catch (err) {
      this.log(`⚠️ Company search fallback failed: ${err.message}`, 'warning');
    }

    this.log(
      `❌ Could not find the LinkedIn page for "${name}". Paste the exact page URL (e.g. https://www.linkedin.com/company/angelone/) in TARGET COMPANY and retry — no invites were sent.`,
      'error'
    );
    return false;
  }

  normalizeConfig(rawConfig) {
    const defaultRoles = ['Recruiter', 'Talent Acquisition', 'HR', 'Hiring Manager', 'Engineering Manager'];
    const roles = Array.isArray(rawConfig.roles) && rawConfig.roles.length > 0
      ? rawConfig.roles.map(r => r.trim()).filter(Boolean)
      : defaultRoles;

    const compInput = (rawConfig.company || '').trim();
    if (!compInput) {
      throw new Error('Target Company is required. Please specify a target company name or LinkedIn URL.');
    }
    const cleanCompany = extractCompanyName(compInput);
    let basePeopleUrl = '';
    let companyUrlProvided = false;

    if (compInput.includes('linkedin.com/company/')) {
      companyUrlProvided = true;
      const match = compInput.match(/https?:\/\/(www\.)?linkedin\.com\/company\/([^/\?]+)/i);
      if (match && match[2]) {
        basePeopleUrl = `https://www.linkedin.com/company/${match[2]}/people/`;
      } else {
        basePeopleUrl = compInput.endsWith('/') ? compInput : compInput + '/';
        if (!basePeopleUrl.includes('/people/')) {
          basePeopleUrl = basePeopleUrl.replace(/\/$/, '') + '/people/';
        }
      }
    } else {
      const slug = cleanCompany.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const companySlug = slug || 'company';
      basePeopleUrl = `https://www.linkedin.com/company/${companySlug}/people/`;
    }

    const connPerFilter = parseInt(rawConfig.connectionsPerFilter, 10) || 10;

    return {
      companyName: cleanCompany,
      basePeopleUrl,
      companyUrlProvided,
      roles,
      connectionsPerFilter: connPerFilter,
      delayBetweenConnections: rawConfig.delayBetweenConnections || { min: 20000, max: 35000 },
      delayBetweenRoles: rawConfig.delayBetweenRoles || { min: 8000, max: 15000 },
      typingDelay: 25,
      connectionNote: rawConfig.connectionNote || '',
      useAINotes: rawConfig.useAINotes !== false,
      geminiApiKey: rawConfig.geminiApiKey || process.env.GEMINI_API_KEY || '',
      geminiModel: rawConfig.geminiModel || 'gemini-3.6-flash',
      chromePath: rawConfig.chromePath || 'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: rawConfig.headless === true,
      sessionDir: rawConfig.sessionDir || '',
      senderName: (rawConfig.userProfile && rawConfig.userProfile.fullName) || rawConfig.senderName || 'Student',
      senderCollege: (rawConfig.userProfile && (rawConfig.userProfile.college || rawConfig.userProfile.university)) || rawConfig.senderCollege || 'B.Tech CSE',
      senderYear: (rawConfig.userProfile && rawConfig.userProfile.year) || rawConfig.senderYear || '2027',
      senderField: (rawConfig.userProfile && (rawConfig.userProfile.field || rawConfig.userProfile.department)) || rawConfig.senderField || 'Computer Science',
      senderDomain: (rawConfig.userProfile && (rawConfig.userProfile.targetRole || rawConfig.userProfile.domain)) || rawConfig.senderDomain || 'Software Engineering',
    };
  }

  log(message, level = 'info') {
    const timestamp = new Date().toLocaleTimeString('en-IN', { hour12: true });
    const payload = { timestamp, message, level };
    this.emit('log', payload);
  }

  updateProgress(currentRole, currentRoleSent = 0) {
    const totalRoles = this.config.roles.length;
    const totalTarget = totalRoles * this.config.connectionsPerFilter;
    this.stats.totalTarget = totalTarget;
    this.emit('progress', {
      stats: this.stats,
      currentRole,
      currentRoleSent,
      targetPerRole: this.config.connectionsPerFilter,
      totalRoles,
    });
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async waitRandom(min, max, label = '') {
    const ms = this.randomDelay(min, max);
    if (label) {
      this.log(`⏳ ${label} — ${(ms / 1000).toFixed(0)}s wait...`, 'wait');
    }
    await this.sleep(ms);
  }

  getRecipientCategory(role = '', headline = '') {
    const text = `${role} ${headline}`.toLowerCase();
    if (/\b(recruiter|talent acquisition|hr|human resources|hiring manager|sourcing|talent partner|staffing)\b/i.test(text)) {
      return 'recruiter';
    }
    if (/\b(intern|graduate|jr|junior|associate|trainee|fresher|campus|student)\b/i.test(text)) {
      return 'recentGrad';
    }
    return 'professional';
  }

  async generateAINote(personName, headline = '', role = '', genderHint = '') {
    if (!this.config.useAINotes || (!this.config.geminiApiKey && !hasFreeLLMAPI())) return null;

    const category = this.getRecipientCategory(role, headline);
    const firstName = this.getFirstName(personName);
    const company = this.config.companyName;

    const senderName = this.config.senderName;
    const senderYear = this.config.senderYear;
    const senderField = this.config.senderField;
    const senderCollege = this.config.senderCollege;
    const senderDomain = this.config.senderDomain;

    let categoryPrompt = '';
    if (category === 'recruiter') {
      categoryPrompt = `
RECIPIENT CATEGORY: Recruiter at Target Company
GUIDE TEMPLATE STRUCTURE TO FOLLOW:
"Hi [Name], I'm exploring internship opportunities at [Company] in [domain]. As someone who recruits for this space, your perspective would be invaluable. Happy to connect!"

REQUIREMENTS FOR THIS RECRUITER NOTE:
- Address recipient: "${firstName}" (or honorific if specified)
- Fill [Company]: "${company}"
- Fill [domain]: "${senderDomain}"
- Keep it under 200 characters. Explain why reaching out specifically to THEM (as someone who recruits for this space).`;
    } else if (category === 'recentGrad') {
      const currentRole = headline ? headline.split('|')[0].split('-')[0].trim() : role || 'Team Member';
      categoryPrompt = `
RECIPIENT CATEGORY: Senior Student / Recent Grad
GUIDE TEMPLATE STRUCTURE TO FOLLOW:
"Hi [Name], I came across your profile while researching [Company]. Your transition to [Company] as [Role] is exactly the kind of journey I'm working toward. Would love to connect and hear your story when you have a moment!"

REQUIREMENTS FOR THIS RECENT GRAD NOTE:
- Address recipient: "${firstName}" (or honorific if specified)
- Fill [Company]: "${company}"
- Fill [Role]: "${currentRole}"
- Keep it under 250 characters. Admire their transition from student to ${company}.`;
    } else {
      const workDetail = headline ? headline.split('|')[0].split('-')[0].trim() : 'engineering work';
      categoryPrompt = `
RECIPIENT CATEGORY: Student to Industry Professional
GUIDE TEMPLATE STRUCTURE TO FOLLOW:
"Hi [Name], I'm [Your Name], a [Year] [Field] student at [College]. I admire your work at [Company] — especially [specific project/role detail]. Would love to connect and learn from your journey!"

REQUIREMENTS FOR THIS PROFESSIONAL NOTE:
- Address recipient: "${firstName}" (or honorific if specified)
- Fill [Your Name]: "${senderName}"
- Fill [Year]: "${senderYear}"
- Fill [Field]: "${senderField}"
- Fill [College]: "${senderCollege}"
- Fill [Company]: "${company}"
- Fill [specific project/role detail]: "${workDetail}"
- Maximum 2 short sentences, under 300 characters. DO NOT lead with "I need help finding a job".`;
    }

    const modelsToTry = [
      this.config.geminiModel,
      'gemini-3.6-flash',
      'gemini-3.6-pro',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
      'gemini-1.5-flash-latest',
    ].filter((m, i, self) => m && self.indexOf(m) === i);

    for (const modelName of modelsToTry) {
      try {
        let honorificRule;
        if (genderHint === 'female') {
          honorificRule = `- Respectfully address the recipient as "Hi ${firstName} mam". You MUST use "mam" — NEVER "sir" or "madam".`;
        } else if (genderHint === 'male') {
          honorificRule = `- Respectfully address the recipient as "Hi ${firstName} sir". You MUST use "sir" — NEVER "mam", "madam" or "ma'am".`;
        } else {
          honorificRule = `- Address the recipient by FIRST NAME ONLY (e.g., "Hi ${firstName}"). STRICTLY FORBIDDEN: "sir", "madam", "mam", "ma'am" — no gendered honorifics (gender unknown).`;
        }

        const prompt = `Write a personalized LinkedIn connection request note based on the guide below.

Recipient: ${personName} (${headline || role})
Company: ${company}

${categoryPrompt}

General Rules:
${honorificRule}
- CRITICAL: REPLACE ALL BRACKETS [ ] WITH ACTUAL DYNAMIC VALUES. DO NOT OUTPUT ANY BRACKETS OR PLACEHOLDERS LIKE [Name], [Company], OR [Your Name].
- Keep tone natural, polite, respectful, and genuine.
- NO emojis, NO hashtags, NO subject lines, NO raw quotes.

        Return ONLY the completed note text, nothing else.`;

        await this.geminiThrottle();
        let text = '';
        try {
          text = await askFreeLLM([{ role: 'user', content: prompt }], { maxTokens: 220 });
        } catch (freeError) {
          if (!this.config.geminiApiKey) throw freeError;
          const genAI = new GoogleGenerativeAI(this.config.geminiApiKey);
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent(prompt);
          text = result?.response?.text?.().trim() || '';
        }
        if (text) {
          const note = this.stripGenderedHonorifics(
            text
              .replace(/^["'`\s]+|["'`\s]+$/g, '')
              .split('\n')
              .join(' ')
              .substring(0, 290)
          );
          return note;
        }
      } catch (err) {
        if (err.message.includes('Quota exceeded') || err.message.includes('429')) {
          this.log(`ℹ️ Gemini API Limit hit. Using guide template for ${personName}...`, 'info');
          return null;
        }
      }
    }

    return null;
  }

  getFirstName(personName) {
    const cleaned = (personName || '')
      .replace(/^(Dr\.|Mr\.|Ms\.|Mrs\.|Prof\.)\s+/i, '')
      .replace(/\(.*?\)/g, '')
      .trim();
    const raw = cleaned.split(/\s+/)[0] || 'there';
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }

  // Safety net: AI note lo gendered honorifics ekada padite remove chey
  // ("Sanghamitra sir" → "Sanghamitra", "Hi sir/madam" → "Hi")
  stripGenderedHonorifics(note) {
    return (note || '')
      // "Name sir," → "Name,"  /  "Name madam." → "Name."
      .replace(/\s+\b(sir|madam|mam|ma'?am)\b\s*([,!.])/gi, '$2')
      // "Name sir" (note end, punctuation ledu) → "Name"
      .replace(/\s+\b(sir|madam|mam|ma'?am)\b(?=\s*$)/gi, '')
      // "Hi sir" / "Dear madam" → "Hi" / "Dear"
      .replace(
        /\b(hi|hello|dear|hey|greetings|respected)\s+\b(sir|madam|mam|ma'?am)\b\s*([,!.])?/gi,
        '$1$3'
      )
      // "Sir," / "Madam." (note start) → remove
      .replace(/^\s*(sir|madam|mam|ma'?am)\b\s*([,!.])?\s*/i, '')
      // "Mr./Ms. Name" → "Name"
      .replace(/\b(mr|ms|mrs|dr|prof)\.?\s+/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  detectHonorific(name, headline = '') {
    if (!name) return 'sir';
    const cleaned = name.replace(/^(Dr\.|Mr\.|Ms\.|Mrs\.|Prof\.)\s+/i, '').trim();
    const firstName = cleaned.split(' ')[0].toLowerCase();
    const fullText = (cleaned + ' ' + headline).toLowerCase();

    // 1. Explicit title / pronoun check
    if (/\b(ms|mrs|miss|lady|she|her|female|woman)\b/i.test(fullText)) return 'mam';
    if (/\b(mr|sir|he|his|male|man)\b/i.test(fullText)) return 'sir';

    // 2. Comprehensive Female Names database (Indian & Western)
    const femaleNames = new Set([
      'priya', 'pooja', 'sneha', 'anitha', 'anita', 'sunita', 'sangeetha', 'swathi', 'swati', 'divya', 
      'kavya', 'bhavana', 'deepika', 'harini', 'haritha', 'ramya', 'soumya', 'sowmya', 'shruthi', 'shruti', 
      'reshma', 'aishwarya', 'lakshmi', 'radha', 'sravani', 'madhavi', 'padma', 'anusha', 'supriya', 'meena', 
      'neha', 'shilpa', 'vandana', 'geeta', 'geetha', 'monica', 'monika', 'rekha', 'sarita', 'savitha', 
      'archana', 'lavanya', 'bhavani', 'mounika', 'sravanthi', 'tejaswi', 'siri', 'sirisha', 'keerthi', 
      'keerthana', 'sruthi', 'pavani', 'pavitra', 'pavithra', 'amrutha', 'spandana', 'charitha', 'nandini', 
      'sailaja', 'rohini', 'yamini', 'usha', 'uma', 'laxmi', 'durga', 'parvathi', 'saraswathi', 'gowri', 
      'sandhya', 'revathi', 'roopa', 'rupa', 'vasudha', 'anupama', 'kusuma', 'shobha', 'hema', 'lata', 
      'veena', 'meenakshi', 'gayatri', 'preeti', 'jyoti', 'jyothi', 'nirmala', 'sujatha', 'vijaya', 'pushpa', 
      'bindu', 'chitra', 'madhuri', 'kalyani', 'soundarya', 'sushma', 'neelima', 'manjula', 'renuka', 
      'kamala', 'sarada', 'sharmila', 'sonia', 'tanya', 'riya', 'tanvi', 'iswarya', 'trisha', 'ananya', 
      'akshaya', 'shreya', 'shreeya', 'namrata', 'kriti', 'krithi', 'simran', 'poornima', 'pratyusha',
      'sushmitha', 'sushmita', 'poorvi', 'mahitha', 'nazia', 'suchitha', 'nikitha', 'nikita', 'preethi',
      'pranathi', 'deepthi', 'keerti', 'harika', 'alekhya', 'amulya', 'shravya', 'pranita', 'praneetha',
      'namratha', 'snehal', 'snigdha', 'varsha', 'diksha', 'deeksha', 'swetha', 'shwetha', 'meghana',
      'rachel', 'emily', 'jessica', 'hannah', 'laura', 'amanda', 'jennifer', 'ashley', 'stephanie',
      'nicole', 'elizabeth', 'megan', 'samantha', 'katherine', 'victoria', 'christina', 'michelle', 'lauren',
      'karen', 'susan', 'sarah', 'lisa', 'sandra', 'kimberly', 'donna', 'carol', 'ruth', 'sharon', 'deborah',
      'grace', 'alice', 'helen', 'janet', 'catherine', 'ann', 'anna', 'anne', 'maria', 'mary', 'patricia',
      'linda', 'barbara', 'margaret', 'dorothy', 'nancy', 'betty', 'shirley', 'cynthia', 'angela', 'melissa',
      'brenda', 'amy', 'rebecca', 'virginia', 'kathleen', 'pamela', 'martha', 'debra', 'carolyn', 'christine',
      'marie', 'frances', 'joyce', 'diane', 'julie', 'heather', 'teresa', 'doris', 'gloria', 'evelyn', 'jean',
      'cheryl', 'mildred', 'joan', 'judith', 'rose', 'janice', 'kelly', 'judy', 'kathy', 'theresa', 'beverly',
      'denise', 'tammy', 'irene', 'jane', 'lori', 'marry', 'karla', 'florence', 'julia'
    ]);

    if (femaleNames.has(firstName)) return 'mam';

    // 3. Comprehensive Male Names database (Indian & Western)
    const maleNames = new Set([
      'ravi', 'hari', 'giri', 'vamsi', 'sai', 'mani', 'gopi', 'aditya', 'surya', 'teja', 'satya', 'chandra',
      'krishna', 'rama', 'shiva', 'kiran', 'naveen', 'pavan', 'karthik', 'pradeep', 'sandeep', 'deepak',
      'anand', 'arun', 'varun', 'tarun', 'rahul', 'rohit', 'mohit', 'amit', 'sumit', 'vijay', 'ajay',
      'sanjay', 'rajesh', 'suresh', 'ramesh', 'mahesh', 'naresh', 'dinesh', 'lokesh', 'nilesh', 'hitesh',
      'jignesh', 'bhavesh', 'yash', 'harsh', 'dev', 'gautam', 'subba', 'venkat', 'balaji', 'naga',
      'prashant', 'srikant', 'pravin', 'nitin', 'pankaj', 'manish', 'ashok', 'alok', 'sunil', 'anil',
      'tushar', 'umesh', 'vikram', 'jitendra', 'dharma', 'rudra', 'koushik', 'saikiran', 'saiteja', 'raghu',
      'vasu', 'srinivas', 'srinivasa', 'venkatesh', 'satyanarayana', 'murali', 'prasad', 'baskar', 'bhaskar',
      'sekhar', 'shekhar', 'chaitanya', 'gowtham', 'gautham', 'akash', 'aakash', 'abhishek', 'adithya',
      'akhil', 'aman', 'ankit', 'anurag', 'aravind', 'arjun', 'aryan', 'ashwin', 'avinash', 'bharath',
      'dhanush', 'divyesh', 'ganesh', 'girish', 'harish', 'harsha', 'hemant', 'ishan', 'jaidev', 'jay',
      'karan', 'kaushik', 'kushal', 'madhav', 'manoj', 'mayank', 'mohan', 'mukesh', 'nagesh', 'narendra',
      'nikhil', 'nishant', 'omkar', 'parth', 'pranav', 'prateek', 'pratik', 'praveen', 'prem', 'raghav',
      'rajat', 'rajiv', 'rakesh', 'ranjeet', 'rishabh', 'rohan', 'sachin', 'sahil', 'samir', 'sameer',
      'sampath', 'sanath', 'shashank', 'shirish', 'shivaraj', 'shravan', 'shreyas', 'shyam', 'siddharth',
      'sidharth', 'somesh', 'sohan', 'subhash', 'sudarshan', 'sudhir', 'suhas', 'sujan', 'sumanth',
      'sundar', 'suraj', 'swapnil', 'swaroop', 'tanmay', 'tejas', 'uday', 'vaibhav', 'vedant', 'vignesh',
      'vikas', 'vimal', 'vinay', 'vineet', 'vinit', 'vinod', 'vipul', 'vishal', 'vishnu', 'vishwas',
      'vivek', 'yashwanth', 'yashwant', 'yatin', 'yogesh', 'james', 'john', 'robert', 'michael', 'william',
      'david', 'richard', 'joseph', 'thomas', 'charles', 'christopher', 'daniel', 'matthew', 'anthony',
      'donald', 'mark', 'paul', 'steven', 'andrew', 'kenneth', 'joshua', 'george', 'kevin', 'brian',
      'edward', 'ronald', 'timothy', 'jason', 'jeffrey', 'ryan', 'jacob', 'gary', 'nicholas', 'eric',
      'stephen', 'jonathan', 'larray', 'justin', 'scott', 'brandon', 'benjamin', 'samuel', 'gregory',
      'alexander', 'patrick', 'frank', 'raymond', 'jack', 'dennis', 'jerry', 'tyler', 'aaron', 'jose'
    ]);

    if (maleNames.has(firstName)) return 'sir';

    // 4. Specific female suffix check
    if (
      firstName.endsWith('shree') || firstName.endsWith('vathi') || firstName.endsWith('kumari') ||
      firstName.endsWith('devi') || firstName.endsWith('itha') || firstName.endsWith('itha') ||
      firstName.endsWith('anthi') || firstName.endsWith('aswi')
    ) {
      return 'mam';
    }

    return 'sir';
  }

  // Honorific sanitizer — mistake-proof:
  // - genderHint 'female' → wrong "sir/madam" ni "mam" ki auto-correct
  // - genderHint 'male' → wrong "madam/mam" ni "sir" ki auto-correct
  // - hint lekunte → honorifics strip (safe fallback — gender guess cheyakudadu)
  // 🩹 Placeholder fix: AI/template lo "[Name]"/"{name}"/"<First Name>"/"[honorific]"
  // lanti placeholders literal ga poyakunda actual first name / honorific tho replace.
  fixNotePlaceholders(note, personName, genderHint = '') {
    const firstName = this.getFirstName(personName);
    const honorific = genderHint === 'female' ? 'mam' : genderHint === 'male' ? 'sir' : '';
    return (note || '')
      .replace(/\[\s*(first\s*name|firstname|name)\s*\]/gi, firstName)
      .replace(/\{\s*(first\s*name|firstname|name)\s*\}/gi, firstName)
      .replace(/<\s*(first\s*name|firstname|name)\s*>/gi, firstName)
      .replace(/[\[\{<]\s*(honorific|sir\s*\/\s*madam|sir\s+or\s+madam)\s*[\]\}>]/gi, honorific)
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  sanitizeHonorific(note, genderHint = '') {
    let n = note || '';
    if (genderHint === 'female') {
      n = n.replace(/\b(sir|madam|ma'?am)\b/gi, 'mam');
    } else if (genderHint === 'male') {
      n = n.replace(/\b(madam|mam|ma'?am)\b/gi, 'sir');
    } else {
      n = this.stripGenderedHonorifics(n);
    }
    return n.replace(/\s{2,}/g, ' ').replace(/\s+([,!.])/g, '$1').trim();
  }

  personalizeNote(name, headline = '', role = '', genderHint = '') {
    if (this.config.connectionNote && this.config.connectionNote.trim()) {
      const firstName = this.getFirstName(name);
      const honorific = genderHint === 'female' ? 'mam' : genderHint === 'male' ? 'sir' : '';
      const nameWithHonorific = honorific ? `${firstName} ${honorific}` : firstName;
      let note = this.config.connectionNote;
      note = note.replace(/\{\s*(first\s*name|firstname|name)\s*\}/gi, nameWithHonorific);
      note = note.replace(/\[\s*(first\s*name|firstname|name)\s*\]/gi, nameWithHonorific);
      note = note.replace(/<\s*(first\s*name|firstname|name)\s*>/gi, nameWithHonorific);
      if (note.includes('{honorific}') || note.includes('[honorific]')) {
        note = note.replace(/[\{\[]\s*honorific\s*[\}\]]/gi, honorific);
      }
      if (!honorific) {
        note = this.stripGenderedHonorifics(note);
      }
      return note;
    }

    return this.personalizeGuideNote(name, headline, role, genderHint);
  }

  personalizeGuideNote(personName, headline = '', role = '', genderHint = '') {
    const firstName = this.getFirstName(personName);
    const honorific = genderHint === 'female' ? 'mam' : genderHint === 'male' ? 'sir' : '';
    const nameWithHonorific = honorific ? `${firstName} ${honorific}` : firstName;
    const company = this.config.companyName || 'the company';

    const senderName = this.config.senderName || 'Student';
    const senderYear = this.config.senderYear || '2027';
    const senderField = this.config.senderField || 'CSE';
    const senderCollege = this.config.senderCollege || 'college';
    const senderDomain = this.config.senderDomain || 'Software Engineering';

    const category = this.getRecipientCategory(role, headline);

    let note = '';
    if (category === 'recruiter') {
      note = `Hi ${nameWithHonorific}, I'm exploring internship opportunities at ${company} in ${senderDomain}. As someone who recruits for this space, your perspective would be invaluable. Happy to connect!`;
    } else if (category === 'recentGrad') {
      const recipientRoleStr = headline ? headline.split('|')[0].split('-')[0].trim() : role || 'Team Member';
      note = `Hi ${nameWithHonorific}, I came across your profile while researching ${company}. Your transition to ${company} as ${recipientRoleStr} is exactly the kind of journey I'm working toward. Would love to connect and hear your story when you have a moment!`;
    } else {
      const detailStr = headline ? `your ${headline.split('|')[0].split('-')[0].trim()}` : `your work at ${company}`;
      note = `Hi ${nameWithHonorific}, I'm ${senderName}, a ${senderYear} ${senderField} student at ${senderCollege}. I admire your work at ${company} — especially ${detailStr}. Would love to connect and learn from your journey!`;
    }

    if (!honorific) {
      note = this.stripGenderedHonorifics(note);
    }
    return note;
  }

  // --- Gender inference: pronouns → name (Gemini) → photo (Gemini vision, fallback) ---

  // Gemini calls madhya min gap — free tier RPM (~10/min) lopala untatam kosam
  async geminiThrottle() {
    const MIN_GAP = 6500; // ms — ~9 calls/min
    const now = Date.now();
    const wait = this._lastGeminiCallAt + MIN_GAP - now;
    if (wait > 0) await this.sleep(wait);
    this._lastGeminiCallAt = Date.now();
  }

  saveGenderCache() {
    try {
      const dir = join(process.cwd(), 'data');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const obj = {};
      for (const [k, v] of this.genderCache.entries()) obj[k] = v;
      writeFileSync(this.genderCacheFile, JSON.stringify(obj, null, 2));
    } catch {
      /* best-effort */
    }
  }

  async inferGenderFromName(personName) {
    if ((!this.config.geminiApiKey && !hasFreeLLMAPI()) || !personName) return '';
    const cacheKey = `name:${(personName || '').toLowerCase().trim()}`;
    if (this.genderCache.has(cacheKey)) return this.genderCache.get(cacheKey) || '';
    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-latest'];
    for (const modelName of models) {
      try {
        await this.geminiThrottle();
        const prompt = `Given this full name of a LinkedIn professional (likely Indian or Western), what is the most likely gender? Most first names have a commonly associated gender — answer "male" or "female" with your best judgment. Use "unknown" ONLY if the name is truly unisex or you have no idea. Answer with exactly ONE word, do not explain. Name: "${personName}"`;
        let text = '';
        try {
          text = (await askFreeLLM([{ role: 'user', content: prompt }], { maxTokens: 10 })).toLowerCase();
        } catch (freeError) {
          if (!this.config.geminiApiKey) throw freeError;
          const genAI = new GoogleGenerativeAI(this.config.geminiApiKey);
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent(prompt);
          text = (result?.response?.text?.().trim().toLowerCase() || '');
        }
        // NOTE: 'female' lo 'male' undi — female ni mundu check chey!
        let g = '';
        if (text.includes('female')) g = 'female';
        else if (/\bmale\b/.test(text)) g = 'male';
        this.genderCache.set(cacheKey, g);
        this.saveGenderCache();
        return g;
      } catch (err) {
        if (err.message.includes('429') || err.message.toLowerCase().includes('quota')) {
          this.log('ℹ️ Gemini rate limit — gender inference skip chesi next step ki veltunna...', 'info');
          return '';
        }
        /* next model try */
      }
    }
    return '';
  }

  async inferGenderFromImage(imageUrl) {
    if ((!this.config.geminiApiKey && !hasFreeLLMAPI()) || !imageUrl) return '';
    const cacheKey = `img:${imageUrl.split('?')[0]}`;
    if (this.genderCache.has(cacheKey)) return this.genderCache.get(cacheKey) || '';
    try {
      // LinkedIn CDN image ni bigger variant ki marchi fetch chey
      const bigUrl = imageUrl.replace(/shrink_\d+_\d+/, 'shrink_400_400');
      const res = await fetch(bigUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      if (!res.ok) return '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) return ''; // placeholder / blocked
      const base64 = buf.toString('base64');

      const visionPrompt = 'This is a LinkedIn profile photo. What is the apparent gender of the person? Answer with exactly ONE word: "male", "female", or "unknown". If the image is a generic silhouette, logo, blank avatar, or unclear, answer "unknown". Do not explain.';
      let text = '';
      try {
        text = (await askFreeLLM([{
          role: 'user',
          content: [
            { type: 'text', text: visionPrompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
          ],
        }], { maxTokens: 10 })).toLowerCase();
      } catch (freeError) {
        if (!this.config.geminiApiKey) throw freeError;
        await this.geminiThrottle();
        const genAI = new GoogleGenerativeAI(this.config.geminiApiKey);
        const model = genAI.getGenerativeModel({ model: this.config.geminiModel || 'gemini-2.5-flash' });
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [
            { inlineData: { mimeType: 'image/jpeg', data: base64 } },
            { text: visionPrompt },
          ] }],
        });
        text = (result?.response?.text?.().trim().toLowerCase() || '');
      }
      let g = '';
      if (text.includes('female')) g = 'female';
      else if (/\bmale\b/.test(text)) g = 'male';
      this.genderCache.set(cacheKey, g);
      this.saveGenderCache();
      return g;
    } catch (err) {
      if (err.message.includes('429') || err.message.toLowerCase().includes('quota')) {
        this.log('ℹ️ Gemini rate limit — photo gender check skip chesanu...', 'info');
      }
      return '';
    }
  }

  // Photo + name rendu agree aithe matrame confident; disagree aite unknown (mistake-proof)
  combineGender(photoGender, nameGender) {
    if (photoGender && nameGender) return photoGender === nameGender ? photoGender : '';
    return photoGender || nameGender || '';
  }

  async handleConnectionModal(page, personName, headline = '', role = '', genderHint = '') {
    // NOTE: Modal-scoped & visibility-checked searches matrame vadali.
    // Whole-document searches hidden duplicates ni pattukunnayi — messaging popup 'textarea',
    // hidden 'Add a note' markup — valla clicks/typing wrong place ki poyayi!

    this.log(`⏳ Waiting for connection modal to appear...`, 'info');
    await this.sleep(1500);

    // REAL visible invite modal detection — 45s varaku poll.
    // Modal lo "Add a note" / "Send without a note" buttons kanipinchali.
    const realModalOpen = async () =>
      await page
        .evaluate(() => {
          const vis = (el) => {
            if (!el || !el.getClientRects || !el.getClientRects().length) return false;
            const s = getComputedStyle(el);
            if (s.visibility === 'hidden' || s.display === 'none') return false;
            const r = el.getBoundingClientRect();
            return r.width > 1 && r.height > 1;
          };
          const modal = Array.from(
            document.querySelectorAll('.artdeco-modal, [role="dialog"], [aria-modal="true"]')
          ).find(vis);
          if (!modal) return false;
          const btns = Array.from(modal.querySelectorAll('button, div[role="button"]'));
          const hasSendWithout = btns.some((b) => /send without a note/i.test(b.textContent || ''));
          const hasAddNote = btns.some((b) => /^(\+\s*)?add a note$/i.test((b.textContent || '').trim()));
          const modalText = modal.innerText || '';
          return !!(hasSendWithout || (hasAddNote && /add a note to your invitation/i.test(modalText)));
        })
        .catch(() => false);

    let modalFound = false;
    for (let i = 0; i < 45; i++) {
      modalFound = await realModalOpen();
      if (modalFound) break;
      await this.sleep(1000);
    }

    if (!modalFound) {
      this.log(`⚠️ Connection modal did not open for ${personName}`, 'warning');
      return false;
    }

    this.log(`✨ Connection modal detected for ${personName}! Processing note...`, 'info');
    await this.sleep(1000);

    // Verify correct person in the VISIBLE invite modal only (soft check)
    const nameMatch = await page
      .evaluate(() => {
        const vis = (el) => {
          if (!el || !el.getClientRects || !el.getClientRects().length) return false;
          const s = getComputedStyle(el);
          if (s.visibility === 'hidden' || s.display === 'none') return false;
          const r = el.getBoundingClientRect();
          return r.width > 1 && r.height > 1;
        };
        const modal = Array.from(
          document.querySelectorAll('.artdeco-modal, [role="dialog"], [aria-modal="true"]')
        ).find(vis);
        if (!modal) return { modalText: '' };
        return { modalText: (modal.innerText || modal.textContent || '').toLowerCase() };
      })
      .catch(() => null);

    const expectedClean = (personName || '')
      .replace(/^(Dr\.|Mr\.|Ms\.|Mrs\.|Prof\.)\s+/i, '')
      .replace(/\(.*?\)/g, '')
      .trim()
      .toLowerCase();
    const nameWords = expectedClean.split(/\s+/).filter((w) => w.length > 2);
    const nameOk =
      !nameMatch || !nameMatch.modalText
        ? true
        : nameWords.length === 0 || nameWords.some((w) => nameMatch.modalText.includes(w));

    if (!nameOk) {
      this.log(
        `🚫 Modal opened wrong person! Expected "${personName}" — dismissing invite modal...`,
        'warning'
      );
      // Close ONLY the invite modal (click its Dismiss button), never blanket Escape presses
      await page.evaluate(() => {
        const vis = (el) => el && el.getClientRects && el.getClientRects().length;
        const modal = Array.from(
          document.querySelectorAll('.artdeco-modal, [role="dialog"], [aria-modal="true"]')
        ).find(vis);
        if (modal) {
          const dismiss = modal.querySelector(
            'button[aria-label="Dismiss"], button[data-test-modal-close-btn], .artdeco-modal__dismiss'
          );
          if (dismiss) dismiss.click();
        }
      }).catch(() => {});
      await this.sleep(800);
      await page.keyboard.press('Escape');
      await this.sleep(500);
      return false;
    }

    // Click "Add a note" button — MODAL-scoped, visibility-checked, real mouse click.
    // Click chesaka textarea appeared-a ani verify; lekapothey malli click (up to 8 attempts).
    const clickAddNote = async () => {
      const rect = await page.evaluate(() => {
        const vis = (el) => {
          if (!el || !el.getClientRects || !el.getClientRects().length) return false;
          const s = getComputedStyle(el);
          if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') return false;
          const r = el.getBoundingClientRect();
          return r.width > 1 && r.height > 1;
        };
        const modal = Array.from(
          document.querySelectorAll('.artdeco-modal, [role="dialog"], [aria-modal="true"]')
        ).find(vis);
        if (!modal) return null;
        const candidates = Array.from(
          modal.querySelectorAll('button, div[role="button"], a[role="button"], span')
        );
        for (const cand of candidates) {
          const text = (cand.textContent || '').trim().toLowerCase();
          if (text === 'add a note' || text === '+ add a note' || text.includes('add a note')) {
            const target =
              cand.closest('button, div[role="button"], a[role="button"]') || cand;
            if (!vis(target)) continue;
            const r = target.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
        return null;
      }).catch(() => null);

      if (!rect) return false;
      await page.mouse.move(rect.x, rect.y);
      await page.mouse.click(rect.x, rect.y);
      return true;
    };

    const noteTextareaVisible = async () =>
      await page.evaluate(() => {
        const vis = (el) => {
          if (!el || !el.getClientRects || !el.getClientRects().length) return false;
          const s = getComputedStyle(el);
          if (s.visibility === 'hidden' || s.display === 'none') return false;
          const r = el.getBoundingClientRect();
          return r.width > 10 && r.height > 5;
        };
        const modal = Array.from(
          document.querySelectorAll('.artdeco-modal, [role="dialog"], [aria-modal="true"]')
        ).find(vis);
        if (!modal) return false;
        const ta = Array.from(
          modal.querySelectorAll(
            'textarea, #custom-message, [name="message"], div[contenteditable="true"], .send-invite__custom-message'
          )
        ).find(vis);
        return !!ta;
      }).catch(() => false);

    let addNoteClicked = false;
    for (let clickAttempt = 1; clickAttempt <= 8; clickAttempt++) {
      const clicked = await clickAddNote();
      if (!clicked) {
        this.log(`⚠️ "Add a note" button not found in modal (attempt ${clickAttempt})`, 'warning');
      } else {
        addNoteClicked = true;
        this.log(`🖱️ Real-mouse click on "Add a note" — attempt ${clickAttempt}`, 'info');
      }
      await this.sleep(1500);
      // Click success aithe textarea open avutundi — verify chesi break
      if (await noteTextareaVisible()) break;
    }

    if (addNoteClicked) {
      this.log(`📝 "Add a note" clicked for ${personName}`, 'info');
    }

    // Poll up to 16 seconds for the note textarea INSIDE the modal.
    // Modal lo lekapothey "Add a note" ni malli real-mouse re-click.
    let noteAreaFound = false;
    for (let attempt = 0; attempt < 16; attempt++) {
      noteAreaFound = await noteTextareaVisible();
      if (noteAreaFound) break;

      const retryClicked = await clickAddNote();
      if (retryClicked) {
        this.log(`🖱️ Re-click on "Add a note" (textarea inka raledu) — attempt ${attempt + 1}`, 'info');
      }
      await this.sleep(800);
    }

    if (!noteAreaFound) {
      this.log(`⚠️ Note textarea modal lo kanapinchaledu for ${personName}`, 'warning');
    }

    if (noteAreaFound) {
      await this.sleep(500);

      let noteText = await this.generateAINote(personName, headline, role, genderHint);
      if (noteText) {
        this.log(`🤖 AI generated note for ${personName}: "${noteText.substring(0, 50)}..."`, 'info');
      } else {
        noteText = this.personalizeNote(personName, headline, role, genderHint);
      }

      // 🔒 HONORIFIC SANITIZER (mistake-proof):
      // - genderHint known → tappa honorific ni correct daniki auto-correct ("sir"→"mam")
      // - genderHint unknown → honorifics strip (wrong gender calling risk tattukundi)
      noteText = this.sanitizeHonorific(noteText, genderHint);

      // 🩹 PLACEHOLDER FIX: AI "[Name]"/"{name}" literal ga poyakunda first name tho replace
      noteText = this.fixNotePlaceholders(noteText, personName, genderHint);
      if (/\[\s*name\s*\]|\{\s*name\s*\}/i.test(noteText)) {
        this.log(`⚠️ Note lo inka placeholder migilindi: "${noteText.substring(0, 60)}"`, 'warning');
      }

      // Focus and click the MODAL's visible textarea with real mouse click
      const textareaRect = await page.evaluate(() => {
        const vis = (el) => {
          if (!el || !el.getClientRects || !el.getClientRects().length) return false;
          const s = getComputedStyle(el);
          if (s.visibility === 'hidden' || s.display === 'none') return false;
          const r = el.getBoundingClientRect();
          return r.width > 10 && r.height > 5;
        };
        const modal = Array.from(
          document.querySelectorAll('.artdeco-modal, [role="dialog"], [aria-modal="true"]')
        ).find(vis);
        if (!modal) return null;
        const ta = Array.from(
          modal.querySelectorAll(
            'textarea, #custom-message, [name="message"], div[contenteditable="true"], .send-invite__custom-message'
          )
        ).find(vis);
        if (!ta) return null;
        const r = ta.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }).catch(() => null);

      if (textareaRect) {
        await page.mouse.click(textareaRect.x, textareaRect.y);
      } else {
        this.log(`⚠️ Modal textarea click skip — not found, typing to focused element`, 'warning');
      }

      await page.keyboard.type(noteText, { delay: this.config.typingDelay || 25 });
      await this.sleep(600);

      // Dispatch reactivity events on the MODAL's textarea
      await page.evaluate(() => {
        const vis = (el) => {
          if (!el || !el.getClientRects || !el.getClientRects().length) return false;
          const s = getComputedStyle(el);
          if (s.visibility === 'hidden' || s.display === 'none') return false;
          const r = el.getBoundingClientRect();
          return r.width > 10 && r.height > 5;
        };
        const modal = Array.from(
          document.querySelectorAll('.artdeco-modal, [role="dialog"], [aria-modal="true"]')
        ).find(vis);
        if (!modal) return;
        const ta = Array.from(
          modal.querySelectorAll(
            'textarea, #custom-message, [name="message"], div[contenteditable="true"], .send-invite__custom-message'
          )
        ).find(vis);
        if (ta) {
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          ta.dispatchEvent(new Event('keyup', { bubbles: true }));
        }
      }).catch(() => {});

      await this.sleep(800);

      // Click Send button — MODAL-scoped, real mouse click (up to 8 attempts)
      let sendClicked = false;
      for (let sendAttempt = 0; sendAttempt < 8; sendAttempt++) {
        const sendRect = await page.evaluate(() => {
          const vis = (el) => {
            if (!el || !el.getClientRects || !el.getClientRects().length) return false;
            const s = getComputedStyle(el);
            if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') return false;
            const r = el.getBoundingClientRect();
            return r.width > 1 && r.height > 1;
          };
          const modal = Array.from(
            document.querySelectorAll('.artdeco-modal, [role="dialog"], [aria-modal="true"]')
          ).find(vis);
          if (!modal) return null;
          const buttons = Array.from(modal.querySelectorAll('button, div[role="button"], a[role="button"]'));

          let targetBtn = null;
          for (const btn of buttons) {
            const text = (btn.textContent || '').trim().toLowerCase();
            const aria = (btn.getAttribute('aria-label') || '').toLowerCase();

            // CRITICAL: Skip any button that contains "without a note"
            if (text.includes('without a note') || aria.includes('without a note')) continue;

            if (
              text === 'send' ||
              text === 'send invitation' ||
              text === 'send now' ||
              text === 'send note' ||
              aria.includes('send invitation') ||
              aria.includes('send now') ||
              aria.includes('send note')
            ) {
              if (!btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && vis(btn)) {
                targetBtn = btn;
                break;
              }
            }
          }

          if (!targetBtn) {
            targetBtn = buttons.find(
              (b) =>
                b.classList.contains('artdeco-button--primary') &&
                !b.disabled &&
                b.getAttribute('aria-disabled') !== 'true' &&
                !(b.textContent || '').toLowerCase().includes('without a note') &&
                vis(b)
            );
          }

          if (targetBtn) {
            const r = targetBtn.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }

          return null;
        }).catch(() => null);

        if (sendRect) {
          await page.mouse.move(sendRect.x, sendRect.y);
          await page.mouse.click(sendRect.x, sendRect.y);
          sendClicked = true;

          // Success verify: modal close ayyinda?
          await this.sleep(1500);
          const modalGone = await page
            .evaluate(() => {
              const vis = (el) => el && el.getClientRects && el.getClientRects().length;
              return !Array.from(
                document.querySelectorAll('.artdeco-modal, [role="dialog"], [aria-modal="true"]')
              ).find(vis);
            })
            .catch(() => false);
          if (modalGone) break;
          sendClicked = false;
        }

        // Awaken form state if send button is temporarily disabled
        await page.keyboard.press('Space');
        await page.keyboard.press('Backspace');
        await this.sleep(800);
      }

      if (sendClicked) {
        await this.sleep(2500);
        return { success: true, note: noteText };
      } else {
        this.log(`⚠️ Note typed for ${personName} but Send button could not be clicked`, 'error');
        return false;
      }
    } else {
      if (!addNoteClicked) {
        const directSendRect = await page.evaluate(() => {
          const vis = (el) => {
            if (!el || !el.getClientRects || !el.getClientRects().length) return false;
            const s = getComputedStyle(el);
            if (s.visibility === 'hidden' || s.display === 'none') return false;
            const r = el.getBoundingClientRect();
            return r.width > 1 && r.height > 1;
          };
          const modal = Array.from(
            document.querySelectorAll('.artdeco-modal, [role="dialog"], [aria-modal="true"]')
          ).find(vis);
          if (!modal) return null;
          const buttons = Array.from(modal.querySelectorAll('button, div[role="button"]'));
          const btn = buttons.find((b) => {
            const text = (b.textContent || '').trim().toLowerCase();
            return (
              (text === 'send without a note' || text === 'send now') &&
              !b.disabled &&
              b.getAttribute('aria-disabled') !== 'true' &&
              vis(b)
            );
          });
          if (!btn) return null;
          const r = btn.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }).catch(() => null);

        if (directSendRect) {
          await page.mouse.click(directSendRect.x, directSendRect.y);
          await this.sleep(2000);
          return { success: true, note: '(Sent without note)' };
        }
      }
    }

    this.log(`❌ Connection modal action failed for ${personName}`, 'error');
    return false;
  }

  async connectViaProfilePage(browser, profileUrl, personName, headline = '', role = '') {
    const profilePage = await browser.newPage();
    // Card DOM links can be relative ("/in/vanity") — normalize BEFORE goto (relative URLs
    // silently landed on chrome-error pages, killing the profile-page fallback flow)
    const fullProfileUrl = (profileUrl || "").startsWith("http")
      ? profileUrl
      : `https://www.linkedin.com${profileUrl}`;
    try {
      await profilePage.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      this.log(`🔀 Navigating directly to profile page: ${personName}`, 'info');
      await profilePage.goto(fullProfileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.sleep(4000);

      if (profilePage.url().includes('/login') || profilePage.url().includes('/authwall')) {
        this.log(`⚠️ Profile page redirected to login for ${personName}`, 'warning');
        await profilePage.close();
        return false;
      }

      // Check if already Pending on Profile Page
      const isPending = await profilePage.evaluate(() => {
        const mainSection =
          document.querySelector('main section, .scaffold-layout__main section, .pv-top-card') ||
          document.querySelector('main');
        if (!mainSection) return false;

        const buttons = Array.from(mainSection.querySelectorAll('button, div[role="button"], span, a'));
        for (const btn of buttons) {
          const text = (btn.textContent || '').trim().toLowerCase();
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
          if (text === 'pending' || text === 'invitation sent' || aria.includes('pending') || aria.includes('withdraw')) {
            return true;
          }
        }
        return false;
      });

      if (isPending) {
        this.log(`⏸️ ${personName} profile button is "Pending" (already requested). Skipping!`, 'skip');
        await profilePage.close();
        return { pending: true };
      }

      // 👤 Gender hint: pronouns ("She/Her"/"He/Him") → photo (vision) → name (Gemini)
      let genderHint = await profilePage
        .evaluate(() => {
          const scope = document.querySelector('.pv-top-card, main') || document.body;
          const t = scope.innerText || '';
          if (/\bshe\s*\/\s*her\b/i.test(t)) return 'female';
          if (/\bhe\s*\/\s*him\b/i.test(t)) return 'male';
          return '';
        })
        .catch(() => '');

      if (!genderHint) {
        const imgUrl = await profilePage
          .evaluate(() => {
            const img =
              document.querySelector('.pv-top-card img') ||
              document.querySelector('main img[alt*="profile" i]') ||
              document.querySelector('main img');
            return img ? img.getAttribute('src') || img.getAttribute('data-delayed-url') || '' : '';
          })
          .catch(() => '');

        const nameGender = await this.inferGenderFromName(personName);
        // Quota saver: name nunchi gender dorikite photo check skip (photo = fallback matrame)
        const photoGender = nameGender ? '' : await this.inferGenderFromImage(imgUrl);
        genderHint = this.combineGender(photoGender, nameGender);
        this.log(
          `👤 Gender inference for ${personName}: photo=${photoGender || '?'}, name=${nameGender || '?'} → ${genderHint || 'unknown (first-name only)'}`,
          'info'
        );
      } else {
        this.log(`👤 Pronouns detected on profile: ${genderHint === 'female' ? 'She/Her' : 'He/Him'}`, 'info');
      }

      // ⚡ FAST PATH: Direct custom-invite URL — invitation modal deterministic ga open avutundi.
      // (3-dots dropdown dance unreliable: modal slow ga load avutundi, "More" re-clicks overlay
      //  meeda padipoyi modal ni dismiss chestunnayi.)
      const vanityMatch = fullProfileUrl.match(/\/in\/([^\/?#]+)/);
      if (vanityMatch) {
        const inviteUrl = `https://www.linkedin.com/preload/custom-invite/?vanityName=${vanityMatch[1]}`;
        this.log(`⚡ Opening custom-invite URL directly for ${personName}...`, 'info');
        await profilePage.goto(inviteUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await this.sleep(3500);

        if (!profilePage.url().includes('/login') && !profilePage.url().includes('/authwall')) {
          const fastResult = await this.handleConnectionModal(profilePage, personName, headline, role, genderHint);
          if (fastResult) {
            await this.sleep(1000);
            await profilePage.close();
            return fastResult;
          }
          this.log(`⚠️ Custom-invite path failed for ${personName} — falling back to 3-dots dropdown flow...`, 'warning');
          await profilePage.goto(fullProfileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await this.sleep(4000);
        }
      }

      // Locate Connect / 3-dots button (real mouse click happens in Node via CDP)
      const actionResult = await profilePage.evaluate(() => {
        const mainSection =
          document.querySelector('main section, .scaffold-layout__main section, .pv-top-card') ||
          document.querySelector('main');
        if (!mainSection) return { status: 'not_found' };

        const buttons = Array.from(mainSection.querySelectorAll('button, div[role="button"]'));

        // 1. Direct Connect button on profile top card
        const directConnect = buttons.find((b) => {
          const text = (b.textContent || '').trim();
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          return text === 'Connect' || (aria.includes('connect') && !aria.includes('disconnect') && !aria.includes('more'));
        });

        // 2. Find 3-dots / "More" button on profile card
        let dotsBtn = buttons.find((b) => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const text = (b.textContent || '').trim().toLowerCase();
          return (
            aria.includes('more actions') ||
            aria.includes('more options') ||
            aria === 'more' ||
            text === 'more' ||
            text === '...'
          );
        });

        if (!dotsBtn) {
          const actionBtn = buttons.find((b) => {
            const t = (b.textContent || '').trim().toLowerCase();
            return t === 'message' || t.includes('follow');
          });

          if (actionBtn) {
            let container = actionBtn.parentElement;
            while (container && container !== mainSection) {
              const btns = container.querySelectorAll('button, div[role="button"]');
              if (btns.length >= 2) break;
              container = container.parentElement;
            }
            if (container) {
              const containerButtons = Array.from(container.querySelectorAll('button, div[role="button"]'));
              dotsBtn = containerButtons.find((b) => {
                const txt = (b.textContent || '').trim().toLowerCase();
                return txt !== 'message' && !txt.includes('follow');
              });
            }
          }
        }

        const toRect = (el) => {
          if (!el) return null;
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        };

        if (directConnect) {
          return { status: 'clicked_direct', rect: toRect(directConnect) };
        }
        if (dotsBtn) {
          return { status: 'clicked_more', rect: toRect(dotsBtn) };
        }
        return { status: 'not_found' };
      });

      if (actionResult.status === 'not_found') {
        this.log(`⚠️ Connect / 3-dots button not found on ${personName}'s profile`, 'warning');
        await profilePage.close();
        return false;
      }

      // Real mouse click on Connect / 3-dots button
      if (actionResult.rect) {
        await profilePage.mouse.move(actionResult.rect.x, actionResult.rect.y);
        await profilePage.mouse.click(actionResult.rect.x, actionResult.rect.y);
      }
      this.log(`⚡ Clicked ${actionResult.status === 'clicked_direct' ? 'Connect button' : '3-dots (More)'} on ${personName}'s profile`, 'info');

      if (actionResult.status === 'clicked_more') {
        // LinkedIn often ignores synthetic JS clicks — use REAL mouse clicks (CDP input) with retries
        let dropdownClicked = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          // 1. Look for a visible "Connect" item inside an OPEN dropdown/menu
          const connectRect = await profilePage.evaluate(() => {
            const isVisible = (el) => {
              if (!el.getClientRects().length) return false;
              const s = getComputedStyle(el);
              return s.visibility !== 'hidden' && s.display !== 'none';
            };
            const scopes = Array.from(
              document.querySelectorAll('.artdeco-dropdown__content--is-open, [role="menu"]')
            );
            for (const scope of scopes) {
              const items = Array.from(
                scope.querySelectorAll('div[role="button"], button, li, a, .artdeco-dropdown__item, span')
              );
              for (const item of items) {
                const text = (item.textContent || '').trim().toLowerCase();
                if (
                  (text === 'connect' || text === '+ connect') &&
                  !text.includes('disconnect') &&
                  isVisible(item)
                ) {
                  const target =
                    item.closest('div[role="button"], button, li, a, .artdeco-dropdown__item') || item;
                  target.scrollIntoView({ behavior: 'instant', block: 'center' });
                  const r = target.getBoundingClientRect();
                  return {
                    x: r.left + r.width / 2,
                    y: r.top + r.height / 2,
                    text: (target.textContent || '').trim(),
                  };
                }
              }
            }
            return null;
          }).catch(() => null);

          if (connectRect) {
            this.log(`🖱️ Real-mouse click on dropdown "Connect" (${connectRect.text}) — attempt ${attempt}`, 'info');
            await profilePage.mouse.move(connectRect.x, connectRect.y);
            await profilePage.mouse.click(connectRect.x, connectRect.y);
            dropdownClicked = true;

            // Modal open avvadaniki up to 12s wait (LinkedIn modal ni slow ga load chestundi —
            // early ga "More" click cheyadam modal ni dismiss cheseyachu!)
            let opened = false;
            for (let w = 0; w < 12; w++) {
              await this.sleep(1000);
              opened = await profilePage.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button'));
                return (
                  btns.some((b) => /send without a note/i.test(b.textContent || '')) ||
                  /add a note to your invitation/i.test(document.body.innerText || '')
                );
              }).catch(() => false);
              if (opened) break;
            }

            if (opened) break;

            // Modal didn't open — dropdown may have closed; retry by re-opening the menu
            this.log(`⚠️ Modal did not open after dropdown click (attempt ${attempt}) — retrying...`, 'warning');
          }

          // 2. Menu not open (or retry) — click the "More" (3-dots) button with a REAL mouse click
          // ⚠️ Modal already open ayyinda? Aithe More click cheyaku — click overlay meeda padipoyi
          // modal ni dismiss chesestundi!
          const modalAlreadyOpen = await profilePage.evaluate(() => {
            const vis = (el) => el && el.getClientRects && el.getClientRects().length;
            const m = Array.from(
              document.querySelectorAll('.artdeco-modal, [role="dialog"], [aria-modal="true"]')
            ).find(vis);
            if (!m) return false;
            const btns = Array.from(m.querySelectorAll('button'));
            return (
              btns.some((b) => /send without a note|add a note/i.test(b.textContent || '')) ||
              /add a note to your invitation/i.test(m.innerText || '')
            );
          }).catch(() => false);
          if (modalAlreadyOpen) {
            this.log(`✨ Invitation modal already open — proceeding to note...`, 'info');
            break;
          }

          const dotsRect = await profilePage.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('main button, main div[role="button"]'));
            const dots = buttons.find((b) => {
              const aria = (b.getAttribute('aria-label') || '').toLowerCase();
              const t = (b.textContent || '').trim().toLowerCase();
              return (
                (aria.includes('more actions') || aria.includes('more options') || aria === 'more' ||
                  t === 'more' || t === '...') &&
                !aria.includes('messaging')
              );
            });
            if (!dots) return null;
            dots.scrollIntoView({ behavior: 'instant', block: 'center' });
            const r = dots.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }).catch(() => null);

          if (dotsRect) {
            this.log(`🖱️ Real-mouse click on "More" (3-dots) button — attempt ${attempt}`, 'info');
            await profilePage.mouse.move(dotsRect.x, dotsRect.y);
            await profilePage.mouse.click(dotsRect.x, dotsRect.y);
          } else {
            this.log(`⚠️ "More" (3-dots) button not found (attempt ${attempt})`, 'warning');
          }
          await this.sleep(1800);
        }

        if (!dropdownClicked) {
          this.log(`⚠️ "Connect" option not found / clickable in 3-dots dropdown for ${personName}`, 'warning');
          await profilePage.close();
          return false;
        }

        await this.sleep(1500);
      }

      const modalResult = await this.handleConnectionModal(profilePage, personName, headline, role, genderHint);
      await this.sleep(1000);
      await profilePage.close();
      return modalResult;
    } catch (err) {
      this.log(`⚠️ Profile flow failed for ${personName}: ${err.message}`, 'warning');
      try {
        await profilePage.close();
      } catch {}
      return false;
    }
  }

  async navigateToRoleFilterPage(page, roleKeyword) {
    const filterUrl = `${this.config.basePeopleUrl}?keywords=${encodeURIComponent(roleKeyword)}`;
    this.log(`🔎 Navigating to "${roleKeyword}" filter URL: ${filterUrl}`, 'info');

    await page.goto(filterUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.sleep(4000);

    if (page.url().includes('/login') || page.url().includes('/authwall')) {
      this.log('⚠️ Session redirected to login page. Please log in to LinkedIn in the browser...', 'warning');
      this.emit('status_change', { status: 'requires_login' });
      await page.waitForFunction(
        () => !window.location.href.includes('/login') && !window.location.href.includes('/authwall'),
        { timeout: 300000 }
      );
      this.emit('status_change', { status: 'running' });
      await page.goto(filterUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.sleep(4000);
    }

    // Dead company page (wrong slug) renders no cards — fail fast with a clear
    // message instead of scrolling 6 times for nothing.
    const pageCheck = await this.isValidCompanyPage(page, this.config.companyName);
    if (this.shouldStop) return false;
    if (!pageCheck.ok) {
      this.log(
        `❌ "${this.config.companyName}" page looks invalid here (${pageCheck.reason}). ` +
        `Paste the exact URL (e.g. https://www.linkedin.com/company/angelone/) in TARGET COMPANY and retry.`,
        'error'
      );
      return false;
    }

    // Wait for member cards to actually render before scrolling (page markup can lag DOM-ready by seconds)
    this.log('📜 Waiting for member cards to render...', 'info');
    await page
      .waitForFunction(() => document.querySelector("a[href*='/in/']"), { timeout: 20000 })
      .catch(() => {});

    this.log('📜 Scrolling down to display member cards...', 'info');
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) {
        window.scrollBy(0, 800);
        await new Promise((r) => setTimeout(r, 800));
      }
    });
    await this.sleep(3000);
    return true;
  }

  async process10ConnectionsForFilter(page, roleKeyword, sentProfiles, failedProfiles) {
    let filterSentCount = 0;
    const targetForThisFilter = this.config.connectionsPerFilter;

    // DOM helper injected into the page for card extraction.
    // NOTE: LinkedIn's org people cards are rendered under /company/*/people/ with HYBRID
    // selectors (class names change often), so we match by structure instead.
    // Strict person check: URL must be a pure /in/<vanity> profile AND the name must
    // look like a human name. This rejects junk like "IBM Developer (IT Services...)"
    // (a role/company label misread as a person) which previously burned a full
    // profile-visit + 3-dots cycle and ended the filter at 0/10.
    const extractEmployeesFn = () => {
      const VANITY_RE = /linkedin\.com\/in\/([a-z0-9-]{3,100})\/?(?:[?#]|$)/i;
      const JUNK_NAME_RE = /\b(developer|engineer|engineering|recruiter|recruiting|recruitment|manager|management|consultant|consulting|services|solutions|technology|technologies|enterprise|enterprises|hiring|talent|human resources|analyst|designer|specialist|executive|director|lead|intern|founder|partner|associate|private limited|pvt|ltd|inc|llc|llp|corp|company|careers|staffing)\b/i;
      const canonUrl = (rawHref) => {
        if (!rawHref) return '';
        const abs = rawHref.startsWith('http') ? rawHref : `https://www.linkedin.com${rawHref}`;
        const m = abs.match(VANITY_RE);
        if (!m || /^ACoAA/i.test(m[1])) return '';
        return `https://www.linkedin.com/in/${m[1]}`.toLowerCase();
      };
      const cleanName = (card, link) => {
        const nameEl =
          card.querySelector(".org-people-profile-card__profile-title") ||
          card.querySelector(".artdeco-entity-lockup__title") ||
          card.querySelector(".t-16.t-black.t-bold") ||
          link;
        const raw = nameEl ? (nameEl.textContent || "").trim().split("\n")[0].trim() : "";
        if (!raw || raw.length < 2 || raw.length > 50) return '';
        if (/^linkedin member/i.test(raw)) return '';
        if (/[0-9@|·•()[\]{}]/.test(raw)) return '';
        if (raw.split(/\s+/).length > 5) return '';
        if (JUNK_NAME_RE.test(raw)) return '';
        return raw;
      };
      const extractFromCard = (card) => {
        const link = card.querySelector("a[href*='/in/']");
        if (!link) return null;
        const url = canonUrl(link.getAttribute("href"));
        if (!url) return null;
        const rawName = cleanName(card, link);
        if (!rawName) return null;

        const subEl =
          card.querySelector(".org-people-profile-card__profile-description") ||
          card.querySelector(".artdeco-entity-lockup__subtitle") ||
          card.querySelector(".org-people-profile-card__profile-role");
        const headline = subEl ? (subEl.textContent || "").trim().split("\n")[0].trim().substring(0, 120) : "";

        // Pronouns from card ("She/Her", "He/Him") — gender hint kosam
        const cardText = card.textContent || "";
        let pronouns = "";
        if (/\bshe\s*\/\s*her\b/i.test(cardText)) pronouns = "female";
        else if (/\bhe\s*\/\s*him\b/i.test(cardText)) pronouns = "male";

        // Profile photo URL — Gemini vision gender inference kosam
        const imgEl = card.querySelector("img");
        const imgUrl = imgEl ? imgEl.getAttribute("src") || imgEl.getAttribute("data-delayed-url") || "" : "";

        return { name: rawName, url, headline, pronouns, imgUrl };
      };

      const list = [];
      const seen = new Set();
      const pushUnique = (emp) => {
        if (emp && emp.url && emp.name && !seen.has(emp.url)) {
          seen.add(emp.url);
          list.push(emp);
        }
      };

      // Strategy 0 (always): every strict /in/ anchor → climb to its card container.
      // Catches current + future LinkedIn markup; dedupe + validation keep it clean.
      document.querySelectorAll("a[href*='/in/']").forEach((link) => {
        const url = canonUrl(link.getAttribute("href"));
        if (!url || seen.has(url)) return;
        const card = link.closest("li, div[role='listitem'], .org-people-profile-card, .reusable-search__result-container, div.scaffold-finite-scroll__content > div");
        if (card) pushUnique(extractFromCard(card));
      });

      // Strategy 1: modern entity-lockup list items (current LinkedIn markup)
      document
        .querySelectorAll("li.artdeco-list__item, li.reusable-search__result-container, li.org-people-profiles-module__profile-item")
        .forEach((li) => pushUnique(extractFromCard(li)));

      // Strategy 2: legacy org-people cards
      document.querySelectorAll(".org-people-profile-card").forEach((el) => pushUnique(extractFromCard(el)));

      // Strategy 3: generic structural fallback — innermost nodes holding a profile link
      // + an action button. Catches ANY card layout (even future redesigns).
      if (list.length === 0) {
        document.querySelectorAll("a[href*='/in/']").forEach((link) => {
          let parent = link.parentElement;
          let card = null;
          while (parent && parent !== document.body) {
            if (parent.querySelector("button, div[role='button']")) {
              card = parent;
            } else {
              break;
            }
            parent = parent.parentElement;
          }
          if (card) pushUnique(extractFromCard(card));
        });
      }

      return list;
    };

    this.log(`📋 Role Filter: "${roleKeyword}" — Goal: ${targetForThisFilter} Connection Requests`, "info");
    this.updateProgress(roleKeyword, filterSentCount);

    const getEmployeesFromDOM = () => page.evaluate(extractEmployeesFn);

    let processedInThisFilter = new Set();
    let hasMoreCards = true;
    let scrollPosition = 0;

    while (filterSentCount < targetForThisFilter && hasMoreCards && !this.shouldStop) {
      let employees = await getEmployeesFromDOM();

      // Safe-log a extraction count when zero (previously silently ended with 0/10)
      if (employees.length === 0) {
        this.log(
          `🔍 Found 0 member cards in DOM so far for "${roleKeyword}" — scrolling to load more...`,
          "info"
        );
      }

      let unvisited = employees.filter(
        (emp) =>
          !sentProfiles.has(emp.name) &&
          !failedProfiles.has(emp.name) &&
          !sentProfiles.has(emp.url) &&
          !failedProfiles.has(emp.url) &&
          !processedInThisFilter.has(emp.url)
      );

      // Pagination check: progressive scrolling & "Show more results" button
      if (unvisited.length === 0) {
        this.log(`👇 Goal not reached yet (${filterSentCount}/${targetForThisFilter}). Scrolling & searching for more member cards...`, "info");

        let loadedNewCards = false;

        for (let attempt = 1; attempt <= 6; attempt++) {
          if (this.shouldStop) break;

          const scrollResult = await page.evaluate(async (currentPos) => {
            const nextPos = currentPos + 1200;
            window.scrollTo(0, nextPos);
            await new Promise((r) => setTimeout(r, 1000));
            window.scrollBy(0, 1200);
            await new Promise((r) => setTimeout(r, 1000));

            const buttons = Array.from(document.querySelectorAll("button, div[role='button'], a[role='button'], span"));
            for (const btn of buttons) {
              const text = (btn.textContent || "").trim().toLowerCase();
              if (text.includes("show more results") || text === "show more" || text.includes("see more")) {
                btn.scrollIntoView({ behavior: "smooth", block: "center" });
                btn.click();
                return { clicked: true, pos: nextPos + 1200 };
              }
            }
            return { clicked: false, pos: nextPos + 1200 };
          }, scrollPosition);

          scrollPosition = scrollResult.pos;
          if (scrollResult.clicked) {
            this.log(`🔄 Clicked "Show more results" button! (Attempt ${attempt})`, "info");
          } else {
            this.log(`📜 Scrolled down page to trigger infinite card loading... (Attempt ${attempt})`, "info");
          }

          await this.sleep(3500);

          let freshEmployees = await getEmployeesFromDOM();
          let freshUnvisited = freshEmployees.filter(
            (emp) =>
              !sentProfiles.has(emp.name) &&
              !failedProfiles.has(emp.name) &&
              !sentProfiles.has(emp.url) &&
              !failedProfiles.has(emp.url) &&
              !processedInThisFilter.has(emp.url)
          );

          if (freshUnvisited.length > 0) {
            this.log(`👥 Loaded ${freshUnvisited.length} new member cards! Resuming connection requests...`, "info");
            unvisited = freshUnvisited;
            loadedNewCards = true;
            break;
          }
        }

        if (!loadedNewCards) {
          this.log(`ℹ️ End of available profiles for filter "${roleKeyword}". (${filterSentCount}/${targetForThisFilter} sent)`, "warning");
          hasMoreCards = false;
          break;
        }
      }

      for (const emp of unvisited) {
        if (filterSentCount >= targetForThisFilter || this.shouldStop) break;

        processedInThisFilter.add(emp.url);
        processedInThisFilter.add(emp.name);

        const name = emp.name;
        const targetUrl = (emp.url || "").toLowerCase();
        if (!targetUrl) continue;

        // Guard: only real person profiles go through invite flows. Junk that
        // slipped past extraction is dropped here in ~1s (no profile visit,
        // no 3-dots attempts, no 26s delay).
        if (!/^https:\/\/www\.linkedin\.com\/in\/[a-z0-9-]{3,100}\/?$/.test(targetUrl)) {
          this.log(`⏭️ Skipped "${name || 'unknown card'}" (not a person profile link)`, 'warning');
          if (name) failedProfiles.add(name);
          if (targetUrl) failedProfiles.add(targetUrl);
          continue;
        }

        // Dedup check AFTER skip-sets to give accurate logging
        if (sentProfiles.has(name) || failedProfiles.has(name) || sentProfiles.has(targetUrl) || failedProfiles.has(targetUrl)) {
          continue;
        }

        this.log(`👤 Target (${filterSentCount + 1}/${targetForThisFilter}): ${name} (${emp.headline || "Member"})`, "info");

        // 👤 Gender hint: card pronouns levante photo (vision) + name (Gemini) inference
        let cardGenderHint = emp.pronouns || "";
        if (!cardGenderHint) {
          const nameGender = await this.inferGenderFromName(name);
          // Quota saver: name nunchi gender dorikite photo check skip (photo = fallback matrame)
          const photoGender = nameGender ? "" : await this.inferGenderFromImage(emp.imgUrl);
          cardGenderHint = this.combineGender(photoGender, nameGender);
          this.log(
            `👤 Gender inference for ${name}: photo=${photoGender || "?"}, name=${nameGender || "?"} → ${cardGenderHint || "unknown (first-name only)"}`,
            "info"
          );
        }

        let connectedResult = false;
        let clickResult = { status: "no_card" };

        try {
          clickResult = await page.evaluate((targetUrlArg) => {
            const vis = (el) => {
              if (!el || !el.getClientRects || !el.getClientRects().length) return false;
              const s = getComputedStyle(el);
              return s.visibility !== "hidden" && s.display !== "none";
            };
            const targetNorm = targetUrlArg.toLowerCase();
            // Match on BOTH absolute and relative hrefs (previously relative links never matched)
            const links = Array.from(document.querySelectorAll("a[href*='/in/']")).filter((l) => {
              const h = (l.getAttribute("href") || "").toLowerCase();
              return h.includes(targetNorm) || l.href.toLowerCase().includes(targetNorm);
            });
            let targetCard = null;

            for (const l of links) {
              let parent = l.parentElement;
              while (parent && parent !== document.body) {
                if (parent.querySelector("button, div[role='button']")) {
                  targetCard = parent;
                  break;
                }
                parent = parent.parentElement;
              }
              if (targetCard) break;
            }

            if (!targetCard) return { status: "no_card" };

            targetCard.scrollIntoView({ behavior: "smooth", block: "center" });
            const buttons = Array.from(targetCard.querySelectorAll("button, div[role='button']")).filter(vis);

            for (const btn of buttons) {
              const text = (btn.textContent || "").trim().toLowerCase();
              const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
              if (text === "pending" || text === "invitation sent" || aria.includes("pending") || aria.includes("withdraw")) {
                return { status: "pending" };
              }
            }

            for (const btn of buttons) {
              const text = (btn.textContent || "").trim();
              const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
              if (text === "Connect" || (aria.includes("invite") && aria.includes("connect"))) {
                btn.click();
                return { status: "clicked_connect" };
              }
            }

            for (const btn of buttons) {
              const text = (btn.textContent || "").trim().toLowerCase();
              const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
              if (text === "more" || aria.includes("more actions") || aria.includes("overflow")) {
                btn.click();
                return { status: "clicked_more" };
              }
            }

            return { status: "no_button" };
          }, targetUrl);

          if (clickResult.status === "clicked_connect") {
            this.log(`⚡ Clicked Connect directly on card for ${name}`, "info");
            connectedResult = await this.handleConnectionModal(page, name, emp.headline, roleKeyword, cardGenderHint);
          } else if (clickResult.status === "clicked_more") {
            await this.sleep(1800);
            // Open dropdown → find VISIBLE Connect item → REAL mouse click (JS clicks on the
            // dropdown item are ignored by LinkedIn's overlay handler)
            const dropdownRect = await page.evaluate(() => {
              const vis = (el) => {
                if (!el || !el.getClientRects || !el.getClientRects().length) return false;
                const s = getComputedStyle(el);
                return s.visibility !== "hidden" && s.display !== "none";
              };
              const scopes = Array.from(
                document.querySelectorAll(".artdeco-dropdown__content--is-open, [role='menu']")
              ).filter(vis);
              for (const scope of scopes) {
                const items = Array.from(scope.querySelectorAll("div[role='button'], button, li, a, span"));
                for (const item of items) {
                  const text = (item.textContent || "").trim().toLowerCase();
                  if ((text === "connect" || text === "+ connect") && !text.includes("disconnect") && vis(item)) {
                    const target = item.closest("div[role='button'], button, li, a, .artdeco-dropdown__item") || item;
                    target.scrollIntoView({ behavior: "instant", block: "center" });
                    const r = target.getBoundingClientRect();
                    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                  }
                }
              }
              return null;
            }).catch(() => null);

            if (dropdownRect) {
              await page.mouse.move(dropdownRect.x, dropdownRect.y);
              await page.mouse.click(dropdownRect.x, dropdownRect.y);
              connectedResult = await this.handleConnectionModal(page, name, emp.headline, roleKeyword, cardGenderHint);
            } else {
              await page.keyboard.press("Escape");
            }
          }
        } catch (err) {
          connectedResult = false;
        }

        if (!connectedResult && clickResult.status !== "pending") {
          connectedResult = await this.connectViaProfilePage(page.browser(), emp.url, name, emp.headline, roleKeyword);
        }

        let inviteSentThisTarget = false;
        if (connectedResult && connectedResult.success) {
          filterSentCount++;
          inviteSentThisTarget = true;
          this.stats.sent++;
          sentProfiles.add(name);
          sentProfiles.add(targetUrl);
          const sentRecord = {
            name,
            company: this.config.companyName,
            url: emp.url,
            headline: emp.headline,
            role: roleKeyword,
            note: connectedResult.note || "",
            status: "pending",
            timestamp: new Date().toLocaleTimeString("en-IN", { hour12: true }),
            sentDate: new Date().toISOString(),
          };

          db.saveConnection(sentRecord);
          this.sentList.push(sentRecord);
          this.emit("sent", sentRecord);
          this.log(`✅ [${roleKeyword}] (${filterSentCount}/${targetForThisFilter}) Note sent to ${name}!`, "success");
          this.updateProgress(roleKeyword, filterSentCount);
        } else if (clickResult.status === "pending" || (connectedResult && connectedResult.pending)) {
          this.stats.skipped++;
          this.log(`⏸️ ${name} — "Pending" invitation already active. Skipped.`, "skip");
          failedProfiles.add(name);
          failedProfiles.add(targetUrl);
          this.updateProgress(roleKeyword, filterSentCount);
          continue;
        } else {
          this.stats.failed++;
          // Accurate reason in the log (was a misleading "already connected" message)
          const reason =
            clickResult.status === "no_card"
              ? "card not found in DOM"
              : clickResult.status === "no_button"
                ? "no Connect/More button on card"
                : "no button found on card or profile page";
          this.log(`⏭️ Skipped ${name} (${reason})`, "warning");
          failedProfiles.add(name);
          failedProfiles.add(targetUrl);
          this.updateProgress(roleKeyword, filterSentCount);
          inviteSentThisTarget = false;
        }

        if (filterSentCount < targetForThisFilter && !this.shouldStop) {
          if (inviteSentThisTarget) {
            await this.waitRandom(
              this.config.delayBetweenConnections.min,
              this.config.delayBetweenConnections.max,
              `Next connection delay for ${roleKeyword}`
            );
          } else {
            // Skip/fail path: short breather only — the 20-35s gap is for real sends.
            await this.sleep(3000);
          }
        }
      }
    }

    this.log(`🎉 Filter "${roleKeyword}" finished: ${filterSentCount}/${targetForThisFilter} connection notes sent!`, "success");
    return filterSentCount;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.shouldStop = false;
    this.emit('status_change', { status: 'running' });
    this.log(`🚀 Launching Chrome Browser for ${this.config.companyName}...`, 'info');

    const targetChromePath = existsSync(this.config.chromePath) ? this.config.chromePath : getSystemChromePath();

    try {
      this.browser = await puppeteer.launch({
        headless: this.config.headless === true,
        executablePath: targetChromePath,
        userDataDir: this.chromeDataDir,
        defaultViewport: null,
        args: [
          '--start-maximized',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
          '--remote-allow-origins=*',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
      });
    } catch (err) {
      this.log(`❌ Chrome launch failed: ${err.message}`, 'error');
      this.isRunning = false;
      this.emit('status_change', { status: 'stopped', error: err.message });
      return;
    }

    const pages = await this.browser.pages();
    this.page = pages[0] || (await this.browser.newPage());

    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    this.log('🔐 Checking LinkedIn login status...', 'info');
    await this.page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.sleep(3000);

    const currentUrl = this.page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/authwall') || currentUrl.includes('/checkpoint')) {
      this.log('👆 Please log in to LinkedIn in the browser window! Automation will automatically resume once logged in.', 'warning');
      this.emit('status_change', { status: 'requires_login' });

      await this.page.waitForFunction(
        () =>
          !window.location.href.includes('/login') &&
          !window.location.href.includes('/authwall') &&
          !window.location.href.includes('/checkpoint'),
        { timeout: 300000 }
      );
      this.emit('status_change', { status: 'running' });
    }

    this.log('✅ LinkedIn Login verified!', 'success');
    await this.waitRandom(3000, 5000, 'Feed settle');

    // Resolve the REAL company page first (e.g. "Angel One" -> /company/angelone/,
    // not the guessed /company/angel-one/ which renders 0 cards).
    const resolved = await this.resolveCompanyPeopleUrl(this.page);
    if (!resolved || this.shouldStop) {
      if (!this.shouldStop) {
        this.emit('status_change', { status: 'stopped', error: 'LinkedIn company page not found' });
      }
      this.isRunning = false;
      try { await this.browser?.close(); } catch {}
      return;
    }

    const sentProfiles = new Set();
    const failedProfiles = new Set();

    // Pre-populate sentProfiles from database to prevent duplicate connection requests.
    // Normalize BOTH full URLs and vanity slugs so card links (sometimes relative,
    // sometimes absolute) can never leak past the dedupe check.
    const pastRecords = db.getAllConnections();
    pastRecords.forEach((r) => {
      if (r.name) sentProfiles.add(r.name.trim());
      const rawUrl = r.profileUrl || r.url || '';
      if (rawUrl) {
        const fullUrl = rawUrl.startsWith('http') ? rawUrl : `https://www.linkedin.com${rawUrl}`;
        const cleanUrl = fullUrl.split('?')[0].replace(/\/$/, '').toLowerCase();
        sentProfiles.add(cleanUrl);
        const vanityMatch = fullUrl.match(/\/in\/([^\/?#]+)/);
        if (vanityMatch && vanityMatch[1]) {
          sentProfiles.add(`https://www.linkedin.com/in/${vanityMatch[1].toLowerCase()}`);
        }
      }
    });

    if (pastRecords.length > 0) {
      this.log(`📚 Pre-loaded ${pastRecords.length} past connection records from database. Already messaged profiles will be automatically skipped!`, 'info');
    }

    try {
      for (let roleIndex = 0; roleIndex < this.config.roles.length; roleIndex++) {
        if (this.shouldStop) break;

        const role = this.config.roles[roleIndex];
        this.log(`\n📌 FILTER [${roleIndex + 1}/${this.config.roles.length}]: "${role}"`, 'info');

        const pageOk = await this.navigateToRoleFilterPage(this.page, role);
        if (this.shouldStop) break;
        if (!pageOk) {
          this.log(`⏭️ Skipping filter "${role}" — company page invalid, 0 invites sent.`, 'warning');
          continue;
        }
        await this.process10ConnectionsForFilter(this.page, role, sentProfiles, failedProfiles);

        if (roleIndex < this.config.roles.length - 1 && !this.shouldStop) {
          await this.waitRandom(
            this.config.delayBetweenRoles.min,
            this.config.delayBetweenRoles.max,
            `Moving to next filter role`
          );
        }
      }

      if (this.shouldStop) {
        this.log('🛑 Automation stopped by user.', 'warning');
        this.emit('status_change', { status: 'stopped' });
      } else {
        this.log(`🎉 AUTOMATION COMPLETED! Total Connection Notes Sent: ${this.stats.sent}`, 'success');
        this.emit('status_change', { status: 'completed' });
      }
    } catch (err) {
      // A user-initiated stop closes the browser mid-operation, which surfaces as a scary
      // puppeteer "Protocol error ... Target closed". Report a clean stop instead.
      if (this.shouldStop) {
        this.log('🛑 Automation stopped by user.', 'warning');
        this.emit('status_change', { status: 'stopped' });
      } else {
        this.log(`❌ Automation error: ${err.message}`, 'error');
        this.emit('status_change', { status: 'stopped', error: err.message });
      }
    } finally {
      this.isRunning = false;
    }
  }

  async stop() {
    this.log('🛑 Stop command received. Closing automation browser...', 'warning');
    this.shouldStop = true;
    this.isRunning = false;
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
      this.browser = null;
    }
    this.emit('status_change', { status: 'stopped' });
  }
}
