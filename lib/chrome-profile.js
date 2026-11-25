/**
 * Chrome profile helper using Puppeteer.
 *
 * Every automation here drives the same saved LinkedIn Chrome profile. When an
 * earlier run is killed, its headless Chrome keeps the profile directory open
 * and Chrome refuses to start a second instance with it, which Puppeteer
 * reports as "Failed to launch the browser process". Freeing the profile before
 * a launch is what makes campaigns start again instead of failing every time.
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer-core';

const PROFILE_LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

const LAUNCH_FAILURE = /user data directory is already in use|failed to launch|browser process|undefined/i;

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
 * Launch Chrome on the saved profile, clearing an abandoned automation browser
 * (or the lock files it left) first when Chrome reports the profile is busy.
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

  const launch = () => puppeteer.launch({
    headless,
    executablePath: chromePath,
    userDataDir,
    defaultViewport,
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

const TRANSIENT_NAV_ERROR = /ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_CONNECTION_ABORTED|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_EMPTY_RESPONSE|TimeoutError|Navigation timeout/i;

/**
 * Navigate with automatic retry on transient Chrome network glitches
 * (e.g. ERR_NETWORK_CHANGED when Chrome first opens on Windows).
 */
export async function safeGoto(page, url, options = { waitUntil: 'domcontentloaded', timeout: 60000 }, retries = 3) {
  let lastErr = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await page.goto(url, options);
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err || '');
      if (!TRANSIENT_NAV_ERROR.test(msg) || attempt === retries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}
