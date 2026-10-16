/**
 * Multi-Tenant LinkedIn Session Manager
 *
 * Prathi app user ki oka isolated Chrome profile directory:
 *   sessions/<userId>/.chrome-data  (LinkedIn cookies incl. li_at live here)
 *   sessions/<userId>/account.json  (LinkedIn identity metadata)
 *
 * Connect methods:
 *   1. Login Window  - "Connect" button nokite headful Chrome window vastundi,
 *                      user tana LinkedIn account tho login avvachu (2FA ok).
 *   2. li_at Cookie  - User tana li_at session cookie paste chesthe headless ga verify chesi connect.
 */

import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2500;

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

function sanitizeUserId(userId) {
  const s = String(userId || 'anonymous').trim().toLowerCase();
  const safe = s.replace(/[^a-z0-9._@-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'anonymous';
}

export class LinkedInSessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessionsRoot = join(process.cwd(), 'sessions');
    if (!existsSync(this.sessionsRoot)) {
      mkdirSync(this.sessionsRoot, { recursive: true });
    }
    // userId -> { browser, status, startedAt }
    this.loginFlows = new Map();
    // Currently active account used by bot/tracker engines
    this.activeUserId = null;
  }

  // ─── Paths ────────────────────────────────────────────────

  getSessionDir(userId) {
    const dir = join(this.sessionsRoot, sanitizeUserId(userId), '.chrome-data');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  getAccountFile(userId) {
    return join(this.sessionsRoot, sanitizeUserId(userId), 'account.json');
  }

  // ─── Account persistence ──────────────────────────────────

  getAccount(userId) {
    try {
      const raw = readFileSync(this.getAccountFile(userId), 'utf-8');
      const account = JSON.parse(raw || '{}');
      return { userId, connected: false, ...account };
    } catch {
      return { userId, connected: false };
    }
  }

  saveAccount(userId, account) {
    const file = this.getAccountFile(userId);
    mkdirSync(join(this.sessionsRoot, sanitizeUserId(userId)), { recursive: true });
    writeFileSync(file, JSON.stringify({ userId, ...account }, null, 2), 'utf-8');
    this.emit('account_change', { userId, account: this.getAccount(userId) });
  }

  listAccounts() {
    try {
      return readdirSync(this.sessionsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => this.getAccount(d.name));
    } catch {
      return [];
    }
  }

  // ─── Active account (used by bot / tracker engines) ───────

  setActiveUser(userId) {
    this.activeUserId = userId || null;
  }

  getActiveSessionDir() {
    if (!this.activeUserId) return null;
    const account = this.getAccount(this.activeUserId);
    if (!account.connected) return null;
    return this.getSessionDir(this.activeUserId);
  }

  // ─── Method 1: Login Window flow ──────────────────────────

  isLoginPending(userId) {
    const flow = this.loginFlows.get(String(userId));
    return Boolean(flow && flow.status === 'pending');
  }

  async startLoginFlow(userId, { headless = false } = {}) {
    const key = String(userId);
    const existing = this.loginFlows.get(key);

    if (existing && existing.status === 'pending') {
      return { status: 'pending', message: 'LinkedIn login window is already open. Please complete the login.' };
    }
    if (existing && existing.browser) {
      try { await existing.browser.close(); } catch {}
      this.loginFlows.delete(key);
    }

    const account = this.getAccount(userId);
    if (account.connected) {
      return { status: 'connected', account, message: `Already connected as ${account.memberName}` };
    }

    const chromePath = getSystemChromePath();
    if (!chromePath || !existsSync(chromePath)) {
      throw new Error('Chrome browser not found on this machine.');
    }

    const sessionDir = this.getSessionDir(userId);
    const flow = { browser: null, status: 'pending', startedAt: Date.now() };
    this.loginFlows.set(key, flow);
    this.saveAccount(userId, { connected: false, status: 'pending_login', method: 'login_window' });

    const finish = async (status, extra = {}) => {
      flow.status = status;
      if (flow.browser) {
        try { await flow.browser.close(); } catch {}
        flow.browser = null;
      }
      this.loginFlows.delete(key);
      if (status !== 'connected') {
        this.saveAccount(userId, { connected: false, status, ...extra });
      }
    };

    try {
      flow.browser = await puppeteer.launch({
        headless,
        executablePath: chromePath,
        userDataDir: sessionDir,
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
      await finish('failed', { error: err.message });
      throw new Error(`Could not open LinkedIn login window: ${err.message}`);
    }

    // If the user closes the login window manually → cancelled
    flow.browser.on('disconnected', () => {
      if (flow.status === 'pending') {
        finish('cancelled');
      }
    });

    // Run the login watcher in the background — API responds immediately
    this._watchLogin(userId, flow, finish).catch(() => {});

    return { status: 'pending', message: 'LinkedIn login window opened. Log in with your LinkedIn account.' };
  }

  async _watchLogin(userId, flow, finish) {
    try {
      const pages = await flow.browser.pages();
      const page = pages[0] || (await flow.browser.newPage());
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Poll until the user completes login (incl. 2FA / checkpoint) or timeout
      const deadline = Date.now() + LOGIN_TIMEOUT_MS;
      let loggedIn = false;
      while (Date.now() < deadline && flow.status === 'pending') {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (flow.browser.disconnected) return;

        const url = page.url();
        const pastLogin = !url.includes('/login') && !url.includes('/authwall') && !url.includes('/checkpoint');
        let hasLiAt = false;
        if (pastLogin) {
          try {
            const cookies = await page.cookies('https://www.linkedin.com');
            hasLiAt = cookies.some((c) => c.name === 'li_at');
          } catch {}
        }
        if (pastLogin && hasLiAt) { loggedIn = true; break; }
      }

      if (!loggedIn) {
        if (flow.status === 'pending') {
          await finish(flow.browser.disconnected ? 'cancelled' : 'timeout', {
            error: flow.browser.disconnected ? undefined : 'Login window timed out (5 minutes). Try again.',
          });
        }
        return;
      }

      // Logged in — capture the LinkedIn identity
      const identity = await this._extractIdentity(page);
      await finish('connected');
      this.saveAccount(userId, {
        connected: true,
        status: 'connected',
        memberName: identity.memberName,
        headline: identity.headline,
        profileUrl: identity.profileUrl,
        method: 'login_window',
        connectedAt: new Date().toISOString(),
        lastVerified: new Date().toISOString(),
      });
    } catch (err) {
      if (flow.status === 'pending') {
        await finish('failed', { error: err.message });
      }
    }
  }

  async _extractIdentity(page) {
    const fallback = { memberName: 'LinkedIn Member', headline: '', profileUrl: '' };
    try {
      await page.goto('https://www.linkedin.com/in/me/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise((r) => setTimeout(r, 3000));

      const name = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        return h1 ? h1.textContent.trim() : '';
      });
      const headline = await page.evaluate(() => {
        const el = document.querySelector('.text-body-medium.break-words');
        return el ? el.textContent.trim() : '';
      });

      if (!name) return fallback;
      return {
        memberName: name,
        headline: headline || '',
        profileUrl: page.url().split('?')[0].replace(/\/me\/?$/, '') || '',
      };
    } catch {
      return fallback;
    }
  }

  // ─── Method 2: li_at cookie connect (industry standard) ───

  async connectWithCookie(userId, liAt) {
    const cookie = String(liAt || '').trim();
    if (!cookie || cookie.length < 40) {
      throw new Error('Invalid li_at cookie. Copy the full li_at value from LinkedIn cookies.');
    }

    const chromePath = getSystemChromePath();
    if (!chromePath || !existsSync(chromePath)) {
      throw new Error('Chrome browser not found on this machine.');
    }

    const sessionDir = this.getSessionDir(userId);
    let browser = null;
    try {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: chromePath,
        userDataDir: sessionDir,
        defaultViewport: { width: 1280, height: 800 },
        args: [
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

      const page = await browser.newPage();
      await page.setCookie({
        name: 'li_at',
        value: cookie,
        domain: '.linkedin.com',
        path: '/',
        httpOnly: true,
        secure: true,
      });

      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await new Promise((r) => setTimeout(r, 4000));

      const url = page.url();
      if (url.includes('/login') || url.includes('/authwall') || url.includes('/checkpoint')) {
        throw new Error('li_at cookie rejected by LinkedIn (expired or invalid). Get a fresh cookie and try again.');
      }

      const identity = await this._extractIdentity(page);
      this.saveAccount(userId, {
        connected: true,
        status: 'connected',
        memberName: identity.memberName,
        headline: identity.headline,
        profileUrl: identity.profileUrl,
        method: 'li_at',
        connectedAt: new Date().toISOString(),
        lastVerified: new Date().toISOString(),
      });
      return { status: 'connected', account: this.getAccount(userId) };
    } finally {
      if (browser) {
        try { await browser.close(); } catch {}
      }
    }
  }

  // ─── Verify / Disconnect ──────────────────────────────────

  async verifySession(userId) {
    const account = this.getAccount(userId);
    if (!account.connected) return { connected: false };

    const chromePath = getSystemChromePath();
    if (!chromePath) return { connected: account.connected, verified: false };

    let browser = null;
    try {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: chromePath,
        userDataDir: this.getSessionDir(userId),
        defaultViewport: { width: 1280, height: 800 },
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--remote-allow-origins=*'],
        ignoreDefaultArgs: ['--enable-automation'],
      });
      const page = await browser.newPage();
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await new Promise((r) => setTimeout(r, 3000));
      const url = page.url();
      const stillValid = !url.includes('/login') && !url.includes('/authwall') && !url.includes('/checkpoint');
      this.saveAccount(userId, {
        ...account,
        connected: stillValid,
        status: stillValid ? 'connected' : 'expired',
        lastVerified: new Date().toISOString(),
      });
      return { connected: stillValid, verified: true };
    } catch {
      return { connected: account.connected, verified: false };
    } finally {
      if (browser) {
        try { await browser.close(); } catch {}
      }
    }
  }

  async disconnect(userId) {
    const key = String(userId);
    const flow = this.loginFlows.get(key);
    if (flow && flow.browser) {
      flow.status = 'cancelled';
      try { await flow.browser.close(); } catch {}
      this.loginFlows.delete(key);
    }

    const dir = join(this.sessionsRoot, sanitizeUserId(userId));
    if (existsSync(dir)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }

    if (this.activeUserId === userId) {
      this.activeUserId = null;
    }
    this.saveAccount(userId, { connected: false, status: 'disconnected', disconnectedAt: new Date().toISOString() });
    return { status: 'disconnected' };
  }

  async shutdown() {
    for (const [, flow] of this.loginFlows) {
      if (flow.browser) {
        try { await flow.browser.close(); } catch {}
      }
    }
    this.loginFlows.clear();
  }
}
