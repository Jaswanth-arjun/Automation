/**
 * Vision-based auto-apply agent powered by GPT-6 Luna.
 *
 * Drives a real visible Chrome window with the user's logged-in LinkedIn profile:
 * takes a screenshot, asks GPT-6 Luna what to do next, then performs trusted
 * mouse/keyboard actions via Puppeteer.
 */
import fs from 'fs';
import path from 'path';
import { launchProfileBrowser, clearProfileLocks, freeChromeProfile } from './chrome-profile.js';

function envValue(keys, fallback = '') {
  for (const key of keys) {
    if (process.env[key]) return process.env[key].trim();
  }
  const files = [path.join(process.cwd(), '.env'), path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.env')];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const key of keys) {
      const match = fs.readFileSync(file, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
      if (match && match[1].trim()) return match[1].trim();
    }
  }
  return fallback;
}

function lunaConfig() {
  return {
    key: envValue(['BYNARA_API_KEY', 'RADOX_API_KEY', 'RADOXAI_API_KEY']),
    base: envValue(['BYNARA_BASE_URL', 'RADOX_BASE_URL', 'RADOXAI_BASE_URL'], 'https://coarena.ai/api/v1').replace(/\/+$/, ''),
    model: envValue(['BYNARA_MODEL', 'RADOX_MODEL'], 'gpt-6-luna'),
  };
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'D:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

function findChromePath() {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function getActiveProfileDir() {
  const activeUserFile = path.join(process.cwd(), 'sessions', '.active-user');
  if (fs.existsSync(activeUserFile)) {
    try {
      const uid = fs.readFileSync(activeUserFile, 'utf8').trim();
      const p = path.join(process.cwd(), 'sessions', uid, '.chrome-data');
      if (fs.existsSync(p)) return p;
    } catch {}
  }

  // Fallback to active sessions
  const sessions = ['usr_0747de3d0fb30f2d', 'google-nlr.jaswanth2004@gmail.com', 'user-0747de3d0fb30f2d'];
  for (const s of sessions) {
    const p = path.join(process.cwd(), 'sessions', s, '.chrome-data');
    if (fs.existsSync(p)) return p;
  }

  const fallback = path.join(process.cwd(), '.chrome-data-autoapply');
  if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

const SYSTEM_PROMPT = `You are a careful human-like browser operator filling a job application.
You see ONLY a screenshot of the current browser window. Decide the single next action.

Rules:
- Use ONLY facts from the CANDIDATE PROFILE below. Never invent names, emails, phone numbers, dates, salaries, visa or legal answers.
- If you see a blue "Easy Apply" button on the job page, click it.
- If the application modal/dialog is loading (showing a spinner/loader), emit wait.
- Before pressing Next/Submit, make sure all visible required fields are filled and a resume is selected/attached.
- For a dropdown/select field, do NOT click it repeatedly. Emit a "select" action with the exact option text to choose (use only profile/vault facts). If the answer is not known, emit need_user.
- If all questions are filled, click Next or Review.
- If on the final Review step and ready to submit, click Submit application.
- If an "Application sent" or confirmation dialog appears, emit {"action":"done","status":"submitted"}.
- If an interactive CAPTCHA, OTP, or MFA appears, emit need_user.

Return ONLY one JSON object using this schema:
{"action":"click","x":500,"y":500,"label":"Easy Apply"}
{"action":"type","x":500,"y":500,"text":"value","clear":true}
  (set clear:true when the field already contains text that must be replaced)
{"action":"select","x":500,"y":500,"value":"No"}
  (value = visible option text to choose from a dropdown)
{"action":"scroll","direction":"down|up"}
{"action":"press","key":"Tab|Enter"}
{"action":"wait","ms":1500}
{"action":"need_user","reason":"what is missing"}
{"action":"done","status":"submitted|needs_user|failed"}

Coordinates are on a 0-1000 grid: x=left (0 to 1000), y=top (0 to 1000) of the screenshot.`;

function parseAction(text) {
  let raw = String(text || '').trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const action = JSON.parse(raw.slice(start, end + 1));
    const allowed = new Set(['click', 'type', 'select', 'scroll', 'press', 'wait', 'need_user', 'done']);
    if (!allowed.has(action.action)) return null;
    if (['click', 'type', 'select'].includes(action.action)) {
      if (!Number.isFinite(Number(action.x)) || !Number.isFinite(Number(action.y))) return null;
    }
    if (action.action === 'type' && typeof action.text !== 'string') return null;
    if (action.action === 'select' && typeof action.value !== 'string') return null;
    return action;
  } catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class VisionAgent {
  constructor({ puppeteer, profile = {}, answers = {}, onEvent = () => {}, maxSteps = 25, headless = false } = {}) {
    this.puppeteer = puppeteer;
    this.profile = profile;
    this.answers = answers;
    this.onEvent = onEvent;
    this.maxSteps = maxSteps;
    this.headless = headless;
    this.history = [];
    this.browser = null;
    this.page = null;
    this.provider = lunaConfig();
  }

  event(step, message, data = {}) {
    try { this.onEvent({ step, message, data, t: Date.now() }); } catch {}
  }

  async init() {
    const chrome = findChromePath();
    if (!chrome) throw new Error('Chrome browser executable not found on this system.');

    const userDataDir = getActiveProfileDir();
    const useProfile = String(process.env.VISION_USE_PROFILE || 'false') === 'true';
    this.event('browser_launching', useProfile
      ? `Launching Chrome with your active profile: ${path.basename(userDataDir)}`
      : 'Launching a clean Chrome browser.');

    if (useProfile) {
      try {
        // Clean locks
        await freeChromeProfile(userDataDir, { attempts: 3, waitMs: 600 });
        clearProfileLocks(userDataDir);

        this.browser = await launchProfileBrowser({
          chromePath: chrome,
          userDataDir,
          headless: this.headless,
          defaultViewport: null,
          args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1440,900',
          ],
        });
        this.event('browser_ready', 'Chrome is ready with your logged-in profile.');
      } catch (err) {
        this.event('profile_launch_failed', `Profile launch failed (${err.message}); using a clean browser.`);
        this.browser = null;
      }
    }
    if (!this.browser) {
      this.browser = await this.puppeteer.launch({
        executablePath: chrome,
        headless: this.headless,
        args: ['--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--window-size=1440,900'],
        defaultViewport: { width: 1200, height: 800 },
        protocolTimeout: 120_000,
      });
      this.event('browser_ready', 'Clean Chrome browser is ready.');
    }

    const pages = await this.browser.pages();
    this.page = pages[0] || (await this.browser.newPage());

    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
  }

  async goto(url) {
    this.event('navigating', `Opening application page: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 50_000 });
    await sleep(2500);
  }

  async screenshot() {
    const buffer = await this.page.screenshot({ type: 'jpeg', quality: 75 });
    return buffer.toString('base64');
  }

  async decideWithLuna(imageBase64) {
    const cfg = this.provider;
    const p = this.profile || {};
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || p.fullName || 'Candidate';
    const bits = [
      `Name: ${name}`,
      p.email ? `Email: ${p.email}` : '',
      p.phone ? `Phone: ${p.phone}` : '',
      p.experienceYears ? `Experience: ${p.experienceYears} yrs` : '',
      p.jobTitle ? `Target role: ${p.jobTitle}` : '',
      p.company ? `Company: ${p.company}` : '',
    ].filter(Boolean);
    const auth = this.answers?.workAuthorization || this.answers?.visa || p.workAuthorization;
    if (auth) bits.push(`Work authorization / visa answer: ${auth}`);
    const profileSummary = bits.join('; ');
    const answersSummary = Object.keys(this.answers || {}).length
      ? `\nKNOWN ANSWERS: ${JSON.stringify(this.answers).slice(0, 1500)}`
      : '';

    const response = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `CANDIDATE: ${profileSummary}${answersSummary}\nLAST ACTIONS: ${JSON.stringify(this.history.slice(-4))}\nInspect screenshot and return single JSON action.`,
              },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ],
          },
        ],
        max_tokens: 400,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      if (response.status === 429) {
        const wait = Math.max(21_000, Number((err.match(/try again in (\d+)s/i) || [])[1] || 21) * 1000 + 1000);
        this.event('rate_limited', `GPT-6 Luna rate limit — waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        return this.decideWithLuna(imageBase64);
      }
      throw new Error(`GPT-6 Luna Vision error (${response.status}): ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async decide(imageBase64) {
    const text = await this.decideWithLuna(imageBase64);
    this.event('decision_raw', 'GPT-6 Luna visual decision received', { raw: String(text).slice(0, 300) });
    return parseAction(text);
  }

  // Native <select> popups are not visible in headless screenshots, so a plain
  // click never changes the visual state. Resolve the select at the given point
  // and choose an option with Puppeteer's trusted select() primitive instead.
  async selectAt(x, y, value) {
    const target = String(value || '').trim().toLowerCase();
    for (const frame of this.page.frames()) {
      let handle;
      try {
        handle = await frame.evaluateHandle(({ px, py }) => {
          const el = document.elementFromPoint(px, py);
          if (!el) return null;
          const sel = el.tagName === 'SELECT' ? el : el.closest('select');
          return sel || null;
        }, { px: x, py: y });
      } catch { continue; }

      const el = handle.asElement();
      if (!el) continue;
      try {
        const options = await el.evaluate((sel) =>
          [...sel.options].map((o) => ({ text: (o.text || '').trim(), value: o.value })));
        let match = options.find((o) => o.text.toLowerCase() === target || o.value.toLowerCase() === target);
        if (!match) match = options.find((o) => o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase()));
        if (!match) continue;
        await el.select(match.value);
        this.event('action_select', `Selected "${match.text}" in dropdown at (${x}, ${y})`);
        return true;
      } catch { /* try next frame */ }
    }
    this.event('action_select_failed', `No matching option "${value}" for dropdown at (${x}, ${y}).`);
    return false;
  }

  async act(action) {
    // If coordinates are provided (0-1000 scale), convert to actual viewport or client dimensions
    const dims = await this.page.evaluate(() => ({
      width: window.innerWidth || 1280,
      height: window.innerHeight || 800,
    }));

    const x = Math.max(10, Math.min(dims.width - 10, Math.round((Number(action.x) / 1000) * dims.width)));
    const y = Math.max(10, Math.min(dims.height - 10, Math.round((Number(action.y) / 1000) * dims.height)));

    switch (action.action) {
      case 'click':
        this.event('action_click', `Clicking ${action.label || 'button'} at (${x}, ${y})`);
        if (typeof action.value === 'string') {
          await this.selectAt(x, y, action.value);
        } else {
          await this.page.mouse.click(x, y);
        }
        break;
      case 'select':
        await this.selectAt(x, y, action.value);
        break;
      case 'type':
        this.event('action_type', `Typing into field at (${x}, ${y})`);
        await this.page.mouse.click(x, y);
        await sleep(150);
        if (action.clear === true) {
          await this.page.keyboard.down('Control');
          await this.page.keyboard.press('KeyA');
          await this.page.keyboard.up('Control');
          await sleep(80);
        }
        await this.page.keyboard.type(String(action.text || ''), { delay: 15 });
        break;
      case 'scroll':
        await this.page.mouse.wheel({ deltaY: action.direction === 'up' ? -500 : 500 });
        break;
      case 'press':
        await this.page.keyboard.press(String(action.key || 'Enter'));
        break;
      case 'wait':
        await sleep(Math.min(5000, Math.max(800, Number(action.ms) || 1500)));
        break;
      default:
        break;
    }
  }

  async stateSignature() {
    try {
      const parts = [];
      for (const frame of this.page.frames()) {
        try {
          parts.push(await frame.evaluate(() => {
            const values = [...document.querySelectorAll('input, textarea, select')]
              .map((el) => `${el.name || el.id}:${el.value || ''}`).join('|');
            return `${location.href}::${values}::${document.body?.innerText?.slice(0, 800) || ''}`;
          }));
        } catch { /* frame detached */ }
      }
      return parts.join('##');
    } catch { return `${this.page.url()}::error`; }
  }

  async run(url) {
    if (!this.browser) await this.init();
    if (url) await this.goto(url);

    let consecutiveWaits = 0;
    let noProgress = 0;
    let lastState = await this.stateSignature();

    for (let step = 1; step <= this.maxSteps; step += 1) {
      this.event('analyzing', `👁️ Step ${step}: GPT-6 Luna inspecting screen...`);
      const image = await this.screenshot();

      let action;
      try {
        action = await this.decide(image);
      } catch (err) {
        this.event('error', `GPT-6 Luna vision failed: ${err.message}`);
        return { status: 'failed', reasonCode: 'AI_ERROR', message: err.message, steps: step };
      }

      if (!action) {
        this.event('invalid', 'Model action could not be parsed, retrying in 2s...');
        await sleep(2000);
        continue;
      }

      if (action.action === 'wait') {
        consecutiveWaits++;
        this.event('waiting', `⏳ Page loading spinner detected, waiting... (${consecutiveWaits})`);
        await sleep(2000);
        if (consecutiveWaits > 6) {
          // Fallback if modal spinner is stuck: check if form already has inputs
          consecutiveWaits = 0;
        }
        continue;
      }

      consecutiveWaits = 0;

      if (action.action === 'done') {
        this.event('submitted', '🎉 Application submitted successfully!');
        return { status: 'submitted', reasonCode: 'DONE', message: 'Application submitted successfully!', steps: step };
      }

      if (action.action === 'need_user') {
        this.event('needs_user', `⚠️ Input needed: ${action.reason}`);
        return { status: 'needs_user', reasonCode: 'MISSING_ANSWER', message: action.reason || 'User interaction required.', steps: step };
      }

      await this.act(action);
      this.history.push({ step, action, result: 'pending' });
      await sleep(2500); // stay under GPT-6-Luna's 10 requests/minute limit

      const currentState = await this.stateSignature();
      const changed = currentState !== lastState;
      this.history[this.history.length - 1].result = changed ? 'ok' : 'no_change';
      if (changed) noProgress = 0;
      else noProgress += 1;
      lastState = currentState;
      if (noProgress >= 6) {
        return { status: 'failed', reasonCode: 'AI_NO_PROGRESS', message: `The page did not change after ${noProgress} consecutive actions.`, steps: step };
      }
    }

    return { status: 'needs_user', reasonCode: 'STEP_LIMIT', message: 'Reached step limit. Please review the open Chrome window.', steps: this.maxSteps };
  }

  async close() {
    try {
      if (this.browser) {
        // Keep browser open for a few seconds if submitted so user sees it
        await sleep(2000);
      }
    } catch {}
  }
}

export default VisionAgent;
