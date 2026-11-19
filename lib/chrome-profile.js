/**
 * Chrome profile helper using Playwright.
 *
 * Every automation here drives the saved LinkedIn Chrome profile. When an
 * earlier run is killed, its headless Chrome keeps the profile directory open
 * and Chrome refuses to start a second instance with it, which reports as
 * "user data directory is already in use". Freeing the profile before
 * a launch is what makes campaigns start again instead of failing every time.
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright-core';

const PROFILE_LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

const LAUNCH_FAILURE = /user data directory is already in use|failed to launch|browser process|undefined|Target page, context or browser has been closed/i;

/** Chrome processes whose command line points at this profile directory. */
export function chromePidsUsingProfile(userDataDir) {
  if (process.platform !== 'win32' || !userDataDir) return [];
  // Passed as a separate argument (no shell), so no nested quoting can break
  // the query — the previous inline one-liner silently matched nothing.
  const script = [
    `$dir = '${String(userDataDir).replace(/'/g, "''")}'`,
    'Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\'" |',
    '  Where-Object { $_.CommandLine -like "*$dir*" } |',
    '  ForEach-Object { $_.ProcessId }',
  ].join('\n');
  try {
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf8', timeout: 25000 },
    );
    return String(result.stdout || '')
      .split(/\s+/)
      .filter((value) => /^\d+$/.test(value))
      .map(Number);
  } catch {
    return [];
  }
}

/** Remove the singleton files an unclean Chrome shutdown leaves behind. */
export function clearProfileLocks(userDataDir) {
  for (const name of PROFILE_LOCK_FILES) {
    const file = join(userDataDir, name);
    if (!existsSync(file)) continue;
    try { unlinkSync(file); } catch {}
  }
}

/**
 * Terminate every Chrome still holding this profile and wait until the
 * directory is free. Returns true when nothing is left using it.
 */
export async function freeChromeProfile(userDataDir, { attempts = 6, waitMs = 700 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const pids = chromePidsUsingProfile(userDataDir);
    if (!pids.length) return true;
    for (const pid of pids) {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 20000 });
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return chromePidsUsingProfile(userDataDir).length === 0;
}

/** Port an already running automation Chrome on this profile listens on. */
export function profileDevToolsPort(userDataDir) {
  try {
    const [port] = String(readFileSync(join(userDataDir, 'DevToolsActivePort'), 'utf8')).split('\n');
    const value = parseInt(port, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Launch Chrome on the saved profile via Playwright persistent context,
 * clearing an abandoned automation browser (or the lock files it left)
 * first when Chrome reports the profile is busy.
 */
export async function launchProfileBrowser({
  chromePath,
  userDataDir,
  headless = true,
  defaultViewport = null,
  args = [],
}) {
  if (!userDataDir) throw new Error('No Chrome profile directory is configured for this account.');
  if (!chromePath) throw new Error('Chrome browser not found on this machine.');
  mkdirSync(userDataDir, { recursive: true });

  const launch = async () => {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless,
      executablePath: chromePath,
      viewport: defaultViewport,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-allow-origins=*',
        ...args,
      ],
    });

    // Provide backward-compatible process and disconnection handlers
    context.process = () => {
      const pids = chromePidsUsingProfile(userDataDir);
      return { pid: pids[0] || null, kill: () => freeChromeProfile(userDataDir) };
    };

    let isDisconnected = false;
    context.on('close', () => { isDisconnected = true; });
    Object.defineProperty(context, 'disconnected', {
      get() { return isDisconnected; },
      configurable: true,
    });

    const origOn = context.on.bind(context);
    context.on = (evt, listener) => {
      if (evt === 'disconnected') {
        return origOn('close', listener);
      }
      return origOn(evt, listener);
    };

    const enhancePage = (page) => {
      if (!page) return page;
      if (!page.setCookie) {
        page.setCookie = (cookie) => context.addCookies(Array.isArray(cookie) ? cookie : [cookie]);
      }
      if (!page.evaluateOnNewDocument) {
        page.evaluateOnNewDocument = (script, ...args) => context.addInitScript(script, ...args);
      }
      return page;
    };

    const origNewPage = context.newPage.bind(context);
    context.newPage = async (...newPageArgs) => {
      const page = await origNewPage(...newPageArgs);
      return enhancePage(page);
    };

    const origPages = context.pages.bind(context);
    context.pages = () => {
      const pages = origPages();
      pages.forEach(enhancePage);
      return pages;
    };

    return context;
  };

  // Kill anything left over from a previous run before the first attempt: a
  // live orphan on this profile guarantees the launch would fail.
  const freed = await freeChromeProfile(userDataDir);
  clearProfileLocks(userDataDir);

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await launch();
    } catch (err) {
      lastError = err;
      const detail = String(err?.message || err || '');
      if (!LAUNCH_FAILURE.test(detail)) throw err;
      if (attempt === 0) {
        await freeChromeProfile(userDataDir);
        clearProfileLocks(userDataDir);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }

  const detail = String(lastError?.message || lastError || 'Unknown Chrome startup error').trim();
  const stillLocked = !freed && chromePidsUsingProfile(userDataDir).length > 0;
  const hint = stillLocked
    ? 'A Chrome window is still using this saved profile and could not be closed automatically — close it, then resume.'
    : 'The saved profile could not be opened.';
  throw new Error(`${hint} ${detail.slice(0, 400)}`.trim());
}
