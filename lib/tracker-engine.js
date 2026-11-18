import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';
import { db } from './db.js';

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

export class LinkedInTrackerEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.isRunning = false;
    this.browser = options.existingBrowser || null;
    this.isReusedBrowser = Boolean(options.existingBrowser);
    this.page = null;

    // Per-user LinkedIn session dir when provided, else legacy shared .chrome-data
    this.chromeDataDir = options.sessionDir || join(process.cwd(), '.chrome-data');
    if (!existsSync(this.chromeDataDir)) {
      mkdirSync(this.chromeDataDir, { recursive: true });
    }
  }

  log(message, level = 'info') {
    const timestamp = new Date().toLocaleTimeString('en-IN', { hour12: true });
    this.emit('log', { timestamp, message, level });
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async startSync() {
    if (this.isRunning) {
      this.log('⚠️ Status sync is already running in background!', 'warning');
      return;
    }

    this.isRunning = true;
    this.emit('status_change', { status: 'syncing' });
    this.log('🔍 Starting Connection Status Tracker...', 'info');

    // If no existing browser passed, launch a background Chrome instance with main session dir
    if (!this.browser) {
      const chromePath = this.options.chromePath || getSystemChromePath();

      if (!chromePath || !existsSync(chromePath)) {
        this.log(`❌ Could not locate Chrome browser at path: ${chromePath || 'Not found'}`, 'error');
        this.isRunning = false;
        this.emit('status_change', { status: 'idle', error: 'Chrome browser binary not found' });
        return;
      }

      try {
        this.browser = await puppeteer.launch({
          headless: true,
          executablePath: chromePath,
          userDataDir: this.chromeDataDir,
          defaultViewport: { width: 1280, height: 800 },
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-default-browser-check',
            '--remote-allow-origins=*',
          ],
        });
      } catch (err) {
        this.log(`❌ Tracker Browser Launch Failed: ${err.message}`, 'error');
        this.isRunning = false;
        this.emit('status_change', { status: 'idle', error: err.message });
        return;
      }
    }

    try {
      // Create a background page/tab for tracking
      this.page = await this.browser.newPage();

      // Verify Login Session. Always probe an authenticated page: LinkedIn
      // serves /login even when the saved session is perfectly valid, so
      // checking that URL logged people out every single sync.
      this.log('🔐 Checking active LinkedIn login session for tracking...', 'info');
      await this.page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.sleep(3000);

      const url = this.page.url();
      if (url.includes('/login') || url.includes('/authwall') || url.includes('/checkpoint') || url.includes('/uas/login')) {
        this.log('⚠️ LinkedIn Session expired. Please run campaign launcher once or log in to refresh background cookies.', 'warning');
        this.emit('status_change', { status: 'requires_login' });
        if (this.page) {
          try { await this.page.close(); } catch {}
        }
        if (!this.isReusedBrowser && this.browser) {
          try { await this.browser.close(); } catch {}
        }
        this.browser = null;
        this.isRunning = false;
        return;
      }

      this.log('✅ Session active! Syncing connection statuses in background...', 'success');
      this.emit('session_ok', { at: new Date().toISOString() });

      const allRecords = db.getAllConnections();
      if (allRecords.length === 0) {
        this.log('ℹ️ No tracked connections in database yet.', 'info');
        if (this.page) {
          try { await this.page.close(); } catch {}
        }
        if (!this.isReusedBrowser && this.browser) {
          try { await this.browser.close(); } catch {}
        }
        this.browser = null;
        this.isRunning = false;
        this.emit('status_change', { status: 'idle' });
        return;
      }

      // Step 1: Check Sent Invitations Page (Pending list)
      this.log('📥 Step 1/3: Checking Pending Invitations list...', 'info');
      await this.page.goto('https://www.linkedin.com/mynetwork/invites-sent/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.sleep(4000);

      // Deep-scroll to load ALL sent invitation cards (lazy-loaded list)
      const pendingCards = await this.page.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const seen = new Map();
        const grab = () => {
          const cards = Array.from(document.querySelectorAll(
            '.invitation-card, .mn-invitation-card, li.invitation-card, div.artdeco-card'
          ));
          cards.forEach((card) => {
            const link = card.querySelector('a[href*="/in/"]');
            const nameEl = card.querySelector('.invitation-card__title, .artdeco-entity-lockup__title, .mn-invitation-card__title');
            if (!link && !nameEl) return;
            const name = nameEl ? nameEl.textContent.trim().toLowerCase() : '';
            const url = link ? link.href.split('?')[0].replace(/\/$/, '').toLowerCase() : '';
            const key = url || name;
            if (!key || seen.has(key)) return;
            seen.set(key, { url, name });
          });
          // Fallback: classname-agnostic walk over /in/ anchors
          if (seen.size === 0) {
            document.querySelectorAll('main a[href*="/in/"], a[href*="/in/"]').forEach((a) => {
              const href = a.href ? a.href.split('?')[0].replace(/\/$/, '').toLowerCase() : '';
              if (!href || seen.has(href)) return;
              const card = a.closest('li') || a.closest('div.invitation-card') || a.closest('div[data-view-name]') || (a.parentElement && a.parentElement.parentElement);
              if (!card) return;
              const titleEl = card.querySelector('.artdeco-entity-lockup__title, [class*="lockup__title"]');
              const img = card.querySelector('img[alt]');
              let name = titleEl ? titleEl.textContent.trim().toLowerCase() : (img ? img.alt.trim().toLowerCase() : '');
              if (!name) name = (card.innerText || '').split('\n')[0].trim().toLowerCase();
              if (!name || name.length > 80) return;
              seen.set(href, { url: href, name });
            });
          }
        };
        grab();
        let stagnant = 0;
        let rounds = 0;
        while (stagnant < 4 && rounds < 40) {
          window.scrollBy(0, 1200);
          await sleep(800);
          rounds++;
          const before = seen.size;
          grab();
          if (seen.size === before) stagnant++;
          else stagnant = 0;
        }
        return Array.from(seen.values());
      });

      this.log(`📋 Found ${pendingCards.length} active pending invitation cards on LinkedIn.`, 'info');

      // Step 2: Check Connections Page (Accepted 1st-degree list)
      this.log('🤝 Step 2/3: Checking 1st-Degree Accepted Connections list...', 'info');
      await this.page.goto('https://www.linkedin.com/mynetwork/invite-connect/connections/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.sleep(4000);

      // Deep-scroll to load ALL 1st-degree connections (the list lazy-loads —
      // without this only the first ~10 are visible and matching fails)
      const acceptedList = await this.page.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const seen = new Map();
        const grab = () => {
          // Classic selectors first
          const items = Array.from(document.querySelectorAll('.mn-connection-card, li.mn-connection-card, a.mn-connection-card__link'));
          items.forEach((item) => {
            const link = item.querySelector('a[href*="/in/"]') || (item.tagName === 'A' ? item : null);
            const nameEl = item.querySelector('.mn-connection-card__name, .mn-connection-card__details span');
            if (!link && !nameEl) return;
            const url = link ? link.href.split('?')[0].replace(/\/$/, '').toLowerCase() : '';
            const name = nameEl ? nameEl.textContent.trim().toLowerCase() : '';
            const key = url || name;
            if (!key || seen.has(key)) return;
            seen.set(key, { url, name });
          });
          // Fallback: classname-agnostic walk (avatar alt text carries the name)
          if (seen.size === 0) {
            document.querySelectorAll('main a[href*="/in/"], a[href*="/in/"]').forEach((a) => {
              const href = a.href ? a.href.split('?')[0].replace(/\/$/, '').toLowerCase() : '';
              if (!href || seen.has(href)) return;
              const card = a.closest('li') || a.closest('[class*="connection-card"]') || (a.parentElement && a.parentElement.parentElement);
              if (!card) return;
              const nameEl = card.querySelector('.mn-connection-card__name, [class*="connection-card__name"], [class*="lockup__title"]');
              const img = card.querySelector('img[alt]');
              let name = nameEl ? nameEl.textContent.trim().toLowerCase() : (img ? img.alt.trim().toLowerCase() : '');
              if (!name) name = (a.getAttribute('aria-label') || '').trim().toLowerCase();
              if (!name) name = (card.innerText || '').split('\n')[0].trim().toLowerCase();
              if (!name || name.length > 80) return;
              seen.set(href, { url: href, name });
            });
          }
        };
        grab();
        let stagnant = 0;
        let rounds = 0;
        while (stagnant < 5 && rounds < 80) {
          window.scrollBy(0, 1200);
          await sleep(800);
          rounds++;
          const before = seen.size;
          grab();
          if (seen.size === before) stagnant++;
          else stagnant = 0;
        }
        return Array.from(seen.values());
      });

      this.log(`✅ Loaded ${acceptedList.length} 1st-degree connections from LinkedIn.`, 'info');

      // Step 3: Check LinkedIn Messaging for Read Receipts (Seen) and Replies
      this.log('💬 Step 3/3: Checking LinkedIn Inbox for Read Receipts (Seen) & Replies...', 'info');
      await this.page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.sleep(4000);

      // Deep-scroll the messaging thread list (its own scroll container —
      // window scrolling doesn't reach older threads)
      const chatThreads = await this.page.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const seen = new Map();

        let scrollEl = null;
        let node = document.querySelector('[class*="conversations-list"]');
        while (node) {
          const st = getComputedStyle(node);
          if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 50) {
            scrollEl = node;
            break;
          }
          node = node.parentElement;
        }

        const grab = () => {
          document.querySelectorAll(
            'li.msg-conversation-listitem, .msg-conversation-card, [class*="msg-conversations-container__convo-item"]'
          ).forEach((item, index) => {
            const nameEl = item.querySelector('[class*="participant-names"], [class*="participant"]');
            if (!nameEl) return;
            let name = nameEl.textContent.replace(/\s+/g, ' ').trim();
            name = name.replace(/\s+and\s+you.*$/i, '').trim().toLowerCase();
            if (!name || name.length > 100 || seen.has(name)) return;
            const snippetEl = item.querySelector('[class*="snippet"]');
            const snippet = snippetEl ? snippetEl.textContent.replace(/\s+/g, ' ').trim() : '';
            seen.set(name, {
              index,
              name,
              snippet,
              isUnread: /unread/i.test(item.className || ''),
            });
          });
          // Fallback: walk thread links (older layouts)
          if (seen.size === 0) {
            document.querySelectorAll('a[href*="/messaging/thread/"]').forEach((a, index) => {
              const li = a.closest('li') || a.closest('[class*="msg-conversation"]') || a;
              const text = (li.innerText || '').replace(/\s+/g, ' ').trim();
              const nameEl = li.querySelector('[class*="participant"]');
              const img = li.querySelector('img[alt]');
              let name = '';
              if (nameEl && nameEl.textContent.trim()) {
                name = nameEl.textContent.replace(/\s+/g, ' ').trim();
              } else if (img && img.alt && img.alt.trim()) {
                name = img.alt.replace(/\s+/g, ' ').trim();
              } else {
                name = text.split(' · ')[0].split('  ')[0].trim();
              }
              name = name.replace(/\s+and\s+you.*$/i, '').trim().toLowerCase();
              if (!name || name.length > 100 || seen.has(name)) return;
              const snippetEl = li.querySelector('[class*="snippet"]');
              const snippet = snippetEl ? snippetEl.textContent.replace(/\s+/g, ' ').trim() : text.slice(0, 200);
              seen.set(name, {
                index,
                name,
                snippet,
                isUnread: /\bunread\b/i.test(li.className || ''),
              });
            });
          }
        };

        grab();
        let stagnant = 0;
        let rounds = 0;
        while (stagnant < 5 && rounds < 60) {
          if (scrollEl) scrollEl.scrollTop += scrollEl.clientHeight * 0.9;
          else window.scrollBy(0, 800);
          await sleep(700);
          rounds++;
          const before = seen.size;
          grab();
          if (seen.size === before) stagnant++;
          else stagnant = 0;
        }
        return Array.from(seen.values());
      });

      this.log(`💬 Loaded ${chatThreads.length} message threads from inbox.`, 'info');

      // Strict & Accurate Status Evaluation per Database Record
      let updatedCount = 0;
      let threadOpens = 0;
      for (const record of allRecords) {
        const recordUrl = (record.profileUrl || record.url || '').split('?')[0].replace(/\/$/, '').toLowerCase();
        const recordName = (record.name || '').toLowerCase().trim();

        const isAccepted = acceptedList.some((a) => {
          if (recordUrl && a.url && a.url.includes(recordUrl)) return true;
          if (recordName && a.name && (a.name.includes(recordName) || recordName.includes(a.name))) return true;
          return false;
        });

        const isPending = pendingCards.some((p) => {
          if (recordUrl && p.url && p.url.includes(recordUrl)) return true;
          if (recordName && p.name && (p.name.includes(recordName) || recordName.includes(p.name))) return true;
          return false;
        });

        const chatThread = chatThreads.find((t) => {
          if (!recordName || !t.name) return false;
          return t.name.includes(recordName) || recordName.includes(t.name);
        });

        let newStatus = 'pending';
        let replySnippet = record.replyText || '';

        if (chatThread) {
          // Deep thread inspection: open the thread with a REAL mouse click
          // (synthetic .click() does not navigate the SPA) and scan the
          // message history for messages authored by the contact
          let threadReply = null;
          if (threadOpens < 12) {
            try {
              threadOpens++;
              const marked = await this.page.evaluate(async (threadName) => {
                const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
                const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
                const cn = norm(threadName);
                document.querySelectorAll('[data-tracker-target]').forEach((el) => el.removeAttribute('data-tracker-target'));

                let scrollEl = null;
                let node = document.querySelector('[class*="conversations-list"]');
                while (node) {
                  const st = getComputedStyle(node);
                  if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 50) {
                    scrollEl = node;
                    break;
                  }
                  node = node.parentElement;
                }

                const findEl = () => {
                  const items = Array.from(document.querySelectorAll('[class*="participant-names"]'));
                  return items.find((n) => {
                    const t = norm(n.textContent);
                    return t && (t.includes(cn) || cn.includes(t));
                  });
                };

                let el = findEl();
                if (!el && scrollEl) {
                  let stagnant = 0;
                  let rounds = 0;
                  while (!el && stagnant < 3 && rounds < 40) {
                    scrollEl.scrollTop += scrollEl.clientHeight * 0.9;
                    await sleep(600);
                    rounds++;
                    const before = document.querySelectorAll('[class*="participant-names"]').length;
                    el = findEl();
                    if (!el && document.querySelectorAll('[class*="participant-names"]').length === before) stagnant++;
                    else if (!el) stagnant = 0;
                  }
                }
                if (!el) return false;
                el.setAttribute('data-tracker-target', '1');
                return true;
              }, record.name);

              if (marked) {
                const beforeSig = await this.page.evaluate(() => {
                  const bodies = document.querySelectorAll('[class*="event-listitem__body"]');
                  return bodies.length + ':' + (bodies.length ? bodies[bodies.length - 1].textContent.trim().slice(0, 50) : '');
                });
                const handle = await this.page.$('[data-tracker-target="1"]');
                if (handle) {
                  await handle.click();
                  for (let i = 0; i < 6; i++) {
                    await this.sleep(1000);
                    const sig = await this.page.evaluate(() => {
                      const bodies = document.querySelectorAll('[class*="event-listitem__body"]');
                      return bodies.length + ':' + (bodies.length ? bodies[bodies.length - 1].textContent.trim().slice(0, 50) : '');
                    }).catch(() => 'err');
                    if (sig !== beforeSig) break;
                  }
                  await this.sleep(1000);

                  threadReply = await this.page.evaluate((contactName) => {
                    const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
                    const cn = norm(contactName);
                    const cnTokens = cn.split(' ').filter((w) => w.length > 1);
                    const lastToken = cnTokens[cnTokens.length - 1];
                    let theirLast = null;
                    let lastAuthor = '';
                    document.querySelectorAll('[class*="event-listitem__body"]').forEach((b) => {
                      const eventLi = b.closest('li[class*="message-list__event"]') || b.closest('li') || b.parentElement;
                      const liText = norm(eventLi ? eventLi.innerText : '');
                      if (liText.includes('sent the following messages')) {
                        const markerName = liText.split('sent the following')[0].trim();
                        if (markerName && markerName.length > 2 && markerName.length < 60) lastAuthor = markerName;
                      }
                      const nameEl = eventLi ? eventLi.querySelector('[class*="group__name"]') : null;
                      if (nameEl && nameEl.textContent.trim()) lastAuthor = norm(nameEl.textContent);
                      const authorIsContact = lastAuthor && (
                        lastAuthor === cn || lastAuthor.includes(cn) || cn.includes(lastAuthor) ||
                        (cnTokens.length >= 2 && lastAuthor.split(' ').filter((w) => w.length > 1).length >= 2 &&
                         lastAuthor.split(' ')[0] === cnTokens[0] && lastAuthor.split(' ').slice(-1)[0] === lastToken)
                      );
                      if (authorIsContact) {
                        const txt = b.textContent.trim();
                        if (txt && txt.length > 1 && !/^you\b/i.test(norm(txt))) theirLast = txt.slice(0, 300);
                      }
                    });
                    return theirLast;
                  }, record.name);
                }
              }
            } catch (e) {
              // Ignore scan errors — snippet-based status still applies
            }
          }

          if (threadReply) {
            newStatus = 'replied';
            replySnippet = threadReply;
          } else {
            const snippetLower = (chatThread.snippet || '').toLowerCase();
            const isSentNoteSnippet = snippetLower.includes("i'm a 2027") || snippetLower.includes('love to connect');
            if (chatThread.snippet && !isSentNoteSnippet && !snippetLower.startsWith('you:')) {
              newStatus = 'replied';
              replySnippet = chatThread.snippet;
            } else {
              // If already marked replied (e.g. from manual/history update), keep replied status
              newStatus = record.status === 'replied' ? 'replied' : 'seen';
            }
          }
        } else if (isAccepted) {
          newStatus = record.status === 'replied' ? 'replied' : 'accepted';
        } else if (isPending) {
          newStatus = record.status === 'replied' ? 'replied' : 'pending';
        } else {
          newStatus = record.status === 'replied' ? 'replied' : 'pending';
        }

        if (record.status !== newStatus || (replySnippet && record.replyText !== replySnippet)) {
          db.updateConnectionStatus(record.id, newStatus, replySnippet ? { replyText: replySnippet } : {});
          if (newStatus === 'accepted') {
            this.log(`🎉 Confirmed Accepted Connection: ${record.name} (${record.company})`, 'success');
          } else if (newStatus === 'seen') {
            this.log(`👁️ Read Receipt (Seen): ${record.name} opened message thread`, 'info');
          } else if (newStatus === 'replied') {
            this.log(`💬 Reply Received from ${record.name}: "${replySnippet.substring(0, 45)}..."`, 'success');
          } else {
            this.log(`⏳ Invitation Status: ${record.name} is Pending`, 'info');
          }
          updatedCount++;
        }
      }

      this.log(`🎉 Background Sync Completed! Updated ${updatedCount} records based on actual LinkedIn data.`, 'success');

      // Signal completion before any browser cleanup: a slow or stuck close must
      // never leave the dashboard showing "Syncing" forever.
      this.isRunning = false;
      this.emit('status_change', { status: this.isReusedBrowser ? 'running' : 'completed_sync' });

      // Clean up tracking page
      if (this.page) {
        try { await this.page.close(); } catch {}
        this.page = null;
      }

      // Close browser ONLY if it was created by tracker (not reused from active campaign)
      if (!this.isReusedBrowser && this.browser) {
        try { await this.browser.close(); } catch {}
        this.browser = null;
      }
    } catch (err) {
      this.log(`⚠️ Status Sync Error: ${err.message}`, 'warning');
      this.isRunning = false;
      this.emit('status_change', { status: this.isReusedBrowser ? 'running' : 'idle', error: err.message });
      if (this.page) {
        try { await this.page.close(); } catch {}
        this.page = null;
      }
      if (!this.isReusedBrowser && this.browser) {
        try { await this.browser.close(); } catch {}
        this.browser = null;
      }
    }
  }

  async stop() {
    this.isRunning = false;
    if (this.page) {
      try { await this.page.close(); } catch {}
      this.page = null;
    }
    if (!this.isReusedBrowser && this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
    }
    this.emit('status_change', { status: 'idle' });
  }
}

// â”€â”€â”€ Shared page-side scraping script (robust across LinkedIn redesigns) â”€â”€â”€
// Strategy 1: JSON-LD embedded by LinkedIn search pages (stable structure).
// Strategy 2: classname-agnostic DOM walk over /in/ profile anchors.
const PEOPLE_SCRAPE_SCRIPT = `(() => {  const out = new Map();
  // Canonical public profile URL (query + trailing slash stripped).
  // NOTE: do NOT strip the numeric-ID suffix (e.g. devam-ghose-952482131 â†’
  // devam-ghose) â€” LinkedIn does NOT redirect every base slug; unowned
  // short slugs 404. The UI hides the URL anyway (name is the link text).
  const shortUrl = (u) => String(u).split('?')[0].replace(/\\/$/, '');

  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    let ld;
    try { ld = JSON.parse(s.textContent); } catch { return; }
    const roots = [ld, ...((ld && ld['@graph']) || [])];
    for (const g of roots) {
      if (!g) continue;
      const raw = g.itemListElement !== undefined ? g.itemListElement : (g.item ? [g] : []);
      const arr = Array.isArray(raw) ? raw : [raw];
      for (const it of arr) {
        const p = (it && it.item) || it;
        if (!p || !p.name || !p.url) continue;
        const types = Array.isArray(p['@type']) ? p['@type'] : [p['@type']];
        if (p['@type'] && !types.includes('Person')) continue;
        const url = shortUrl(p.url);
        if (url.includes('/in/') && !out.has(url)) {
          out.set(url, {
            name: String(p.name).replace(/\\s+/g, ' ').trim(),
            url,
            headline: p.jobTitle ? String(p.jobTitle).replace(/\\s+/g, ' ').trim() : '',
            currentEmployer: '',
            employeeEvidence: '',
            location: p.address ? (p.address.addressLocality || p.address.addressRegion || '') : ''
          });
        }
      }
    }
  });

  if (out.size === 0) {
    const anchors = document.querySelectorAll('main a[href*="/in/"], a[href*="/in/"]');
    anchors.forEach((a) => {
      const href = shortUrl(a.href || '');
      if (!href || !href.includes('/in/') || out.has(href)) return;
      const card = a.closest('li') || a.closest('div.entity-result') || a.closest('div[data-view-name]') || (a.parentElement && a.parentElement.parentElement);
      if (!card) return;
      let name = (a.getAttribute('aria-label') || '').trim();
      if (!name) {
        const span = a.querySelector('span[aria-hidden="true"]');
        name = span ? span.textContent.trim() : '';
      }
      if (!name) {
        const img = card.querySelector('img[alt]');
        name = img ? img.alt.trim() : '';
      }
      if (!name) name = (card.innerText || '').split('\\n')[0].trim();
      name = name.replace(/\\s+/g, ' ').trim();
      if (!name || name.length > 80 || /linkedin member/i.test(name)) return;
      // Skip "mutual connections" avatar rows â€” they are not search results
      if (/mutual connections?\\b|are mutual/i.test(name)) return;
      name = name.replace(/\\s+is open to work\\s*$/i, '').trim();

      const lines = (card.innerText || '').split('\\n').map((l) => l.replace(/\\s+/g, ' ').trim()).filter(Boolean);
      let headline = '';
      let currentEmployer = '';
      let employeeEvidence = '';
      let location = '';
      for (const l of lines) {
        const currentMatch = l.match(/^current:\s*(.+)$/i);
        if (currentMatch) {
          currentEmployer = currentMatch[1].trim();
          employeeEvidence = l;
          continue;
        }
        if (l === name || l.length <= 3 || l.length >= 160) continue;
        if (/^(message|view|connect|follow|past:|education)/i.test(l) || /mutual connection/i.test(l)) continue;
        if (!headline && (l.includes(' at ') || l.includes('|') || /engineer|manager|developer|designer|analyst|scientist|consultant|intern|associate|director|lead|recruiter|architect|founder|specialist|administrator|executive/i.test(l))) {
          headline = l;
          if (/\b(?:at|@)\s+|\bcurrent\s*:/i.test(l)) employeeEvidence = l;
          continue;
        }
        if (headline && !location && /,|india|bengaluru|hyderabad|mumbai|delhi|pune|chennai/i.test(l) && !/ at /.test(l)) {
          location = l;
          break;
        }
      }
      out.set(href, { name, url: href, headline, currentEmployer, employeeEvidence, location });    });
  }

  return Array.from(out.values());
})()`;

const KNOWN_COMPANY_IDS = {
  'google': '1441',
  'alphabet': '1441',
  'microsoft': '1035',
  'msft': '1035',
  'amazon': '1586',
  'aws': '1586',
  'apple': '16247',
  'meta': '10667',
  'facebook': '10667',
  'netflix': '165158',
  'uber': '1815218',
  'stripe': '2097782',
  'linkedin': '1337',
  'salesforce': '3185',
  'adobe': '1480',
  'oracle': '1028',
  'ibm': '1009',
  'intel': '1053',
  'cisco': '1063',
  'nvidia': '3608',
  'goldman sachs': '1382',
  'jpmorgan': '1068',
  'jpmorgan chase': '1068',
};

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

function normalizeCompanyName(value) {
  return String(value || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|llc|plc|pvt|private|technologies|technology|india|global|services|solutions)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function companyNameMatches(candidate, target) {
  const left = normalizeCompanyName(candidate);
  const right = normalizeCompanyName(target);
  if (!left || !right) return false;
  if (left === right) return true;
  if (COMPANY_ALIASES[right]?.some((a) => normalizeCompanyName(a) === left)) return true;
  if (COMPANY_ALIASES[left]?.some((a) => normalizeCompanyName(a) === right)) return true;
  return (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left)));
}

async function resolveLinkedInCompanyId(page, companyName) {
  const normKey = normalizeCompanyName(companyName);
  if (KNOWN_COMPANY_IDS[normKey]) return KNOWN_COMPANY_IDS[normKey];
  for (const [key, id] of Object.entries(KNOWN_COMPANY_IDS)) {
    if (companyNameMatches(normKey, key)) return id;
  }
  const direct = String(companyName || '').match(/linkedin\.com\/company\/(\d+)(?:[/?#]|$)/i);
  if (direct) return direct[1];
  const slug = String(companyName || '').match(/linkedin\.com\/company\/([a-z0-9-]+)(?:[/?#]|$)/i);
  const readId = async () => page.evaluate((expectedName) => {
    const norm = (value) => String(value || '').toLowerCase().replace(/&/g, ' and ')
      .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|llc|plc|pvt|private|technologies|technology)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    const expected = norm(expectedName);
    const nodes = Array.from(document.querySelectorAll('[data-entity-urn], [data-chameleon-result-urn], [data-company-id], a[href*="/company/"]'));
    for (const node of nodes) {
      const href = node.getAttribute('href') || '';
      const urn = [node.getAttribute('data-entity-urn'), node.getAttribute('data-chameleon-result-urn'), node.getAttribute('data-company-id'), href].filter(Boolean).join(' ');
      const id = urn.match(/(?:fsd_company|company|companyId)[/:=\s"]+(\d{2,})/i)?.[1];
      if (!id) continue;
      const scope = node.closest('li, [data-view-name], .reusable-search__result-container') || node;
      const shown = norm(scope.innerText || node.innerText || node.getAttribute('aria-label'));
      if (shown && expected && (shown.includes(expected) || expected.includes(shown))) return id;
    }
    const meta = Array.from(document.querySelectorAll('[data-entity-urn], [data-company-id]'))
      .map((node) => [node.getAttribute('data-entity-urn'), node.getAttribute('data-company-id')].join(' '))
      .join(' ');
    const id = meta.match(/(?:fsd_company|companyId)[/:=\s"]+(\d{2,})/i)?.[1];
    const heading = norm(document.querySelector('h1')?.innerText || document.title);
    return id && expected && (heading.includes(expected) || expected.includes(heading)) ? id : '';
  }, companyName).catch(() => '');

  try {
    const candidateUrl = slug
      ? `https://www.linkedin.com/company/${slug[1]}/about/`
      : `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(companyName)}`;
    await page.goto(candidateUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await new Promise((resolve) => setTimeout(resolve, 1800));
    let id = await readId();
    if (id) return id;
    if (slug) return '';

    const slugs = await page.evaluate((expectedName) => {
      const norm = (value) => String(value || '').toLowerCase().replace(/&/g, ' and ')
        .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|llc|plc|pvt|private|technologies|technology)\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
      const expected = norm(expectedName);
      const output = [];
      for (const link of document.querySelectorAll('a[href*="/company/"]')) {
        const scope = link.closest('li, [data-view-name], .reusable-search__result-container') || link;
        const shown = norm(scope.innerText || link.innerText || link.getAttribute('aria-label'));
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/company\/([a-z0-9-]+)/i);
        if (match && shown && (shown.includes(expected) || expected.includes(shown))) output.push(match[1]);
      }
      return [...new Set(output)].slice(0, 3);
    }, companyName);
    for (const foundSlug of slugs) {
      await page.goto(`https://www.linkedin.com/company/${foundSlug}/about/`, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      id = await readId();
      if (id) return id;
    }
  } catch {
    // LinkedIn may hide company identifiers on this account/session. Caller
    // falls back to keyword search with mandatory profile-level verification.
  }
  return '';
}

// Wait until search/connection results actually render (anchors or JSON-LD).
async function waitForResults(page, minAnchors = 2, timeoutMs = 12000) {
  return page.evaluate(async (min, timeout) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const anchors = document.querySelectorAll('main a[href*="/in/"], a[href*="/in/"]').length;
      const ld = document.querySelector('script[type="application/ld+json"]');
      if (anchors >= min || ld) return true;
      await sleep(500);
    }
    return false;
  }, minAnchors, timeoutMs);
}

async function isAuthwallPage(page) {
  const url = page.url();
  if (/\/login|\/authwall|\/checkpoint|\/challenge|captcha|\/uas\//i.test(url)) return true;
  return page.evaluate(() => {
    const body = document.body ? document.body.innerText.slice(0, 2000) : '';
    return /sign in to continue|authwall|session has expired|log in to continue|captcha|security check|verify your identity|unusual activity|verify it.?s you/i.test(body);
  }).catch(() => false);
}

// Persistent dedicated browser for live RAG searches (launched per query,
// closed right after — see the try/finally in each public function)
let liveSearchBrowser = null;

// Per-user session dir override (set by server.js when a user's campaign is active)
let liveSearchSessionDir = null;

export function setLiveSearchSessionDir(dir) {
  liveSearchSessionDir = dir || null;
}

// Safety net: if the node process exits mid-query, kill the headless Chrome
// child so it never orphans and keeps the .chrome-data profile locked
process.on('exit', () => {
  try {
    const p = liveSearchBrowser && liveSearchBrowser.process();
    if (p) p.kill();
  } catch {}
});

async function launchLiveSearchBrowser(chromeDataDir, chromePath) {
  return puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    userDataDir: chromeDataDir,
    defaultViewport: { width: 1280, height: 800 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
    ],
  });
}

function isProfileLockError(err) {
  return /user data directory is already in use|Failed to launch|browser process/i.test(err.message || '');
}

// Puppeteer surfaces transport failures ("Protocol error: Connection closed")
// whenever the shared campaign browser closes a tab underneath us. Those are
// retryable, never something to show a user verbatim.
function isTransportError(err) {
  return /protocol error|connection closed|page has been closed|target closed|session closed|browser has disconnected|detached from target|socket hang up|ECONNRESET|ECONNREFUSED|Navigation failed because browser/i
    .test(String(err && err.message ? err.message : err || ''));
}

function friendlyLiveError(err) {
  const raw = String(err && err.message ? err.message : err || '').trim();
  if (isTransportError(err)) {
    return 'LinkedIn closed the browser tab before this finished. Nothing was lost — tap Refresh to try again.';
  }
  if (isProfileLockError(err)) {
    return 'The LinkedIn Chrome profile is locked by another running automation. Stop the active campaign and try again.';
  }
  if (/timeout|timed out/i.test(raw)) {
    return 'LinkedIn took too long to respond. Tap Refresh to try again.';
  }
  if (/net::ERR_/i.test(raw)) {
    return 'Could not reach LinkedIn from this machine. Check the connection and tap Refresh.';
  }
  return raw || 'LinkedIn page failed.';
}

export async function searchLiveConnections(keyword, existingBrowser = null) {
  const chromePath = getSystemChromePath();
  const chromeDataDir = liveSearchSessionDir || join(process.cwd(), '.chrome-data');
  if (!chromePath || !existsSync(chromePath)) {
    return { results: [], error: 'Chrome browser not found on this machine.' };
  }

  const attempts = [];

  // Attempt 1: reuse the running campaign/tracker browser (avoids profile lock)
  if (existingBrowser) {
    try {
      const results = await runLiveSearchInBrowser(existingBrowser, keyword);
      if (results.error && /closed|disconnected/i.test(results.error)) {
        attempts.push(`Reused campaign browser failed: ${results.error}`);
      } else {
        return results;
      }
    } catch (e) {
      attempts.push(`Reused campaign browser failed: ${e.message}`);
    }
  }

  // Attempt 2: dedicated live-search browser
  // IMPORTANT: close it after the query — keeping it open would lock the
  // .chrome-data profile and break campaign/tracker launches
  try {
    if (!liveSearchBrowser || liveSearchBrowser.disconnected) {
      liveSearchBrowser = await launchLiveSearchBrowser(chromeDataDir, chromePath);
    }
    try {
      const results = await runLiveSearchInBrowser(liveSearchBrowser, keyword);
      if (results.error && /closed|disconnected|in use/i.test(results.error)) {
        attempts.push(`Dedicated browser failed: ${results.error}`);
      } else {
        return results;
      }
    } finally {
      try { await liveSearchBrowser.close(); } catch {}
      liveSearchBrowser = null;
    }
  } catch (e) {
    attempts.push(`Dedicated browser launch failed: ${e.message}`);
    liveSearchBrowser = null;
    if (isProfileLockError(e)) {
      attempts.push('The LinkedIn Chrome profile (.chrome-data) is locked by another running automation. Stop the active campaign/tracker and try again.');
    }
  }

  return { results: [], error: attempts.join(' | ') || 'Unknown live search failure' };
}

async function runLiveSearchInBrowser(browser, keyword) {
  let page = null;
  try {
    page = await browser.newPage();
    const companyId = await resolveLinkedInCompanyId(page, keyword);
    const currentCompanyFacet = companyId ? `&currentCompany=${encodeURIComponent(JSON.stringify([companyId]))}` : '';
    if (companyId) console.log(`[RAG Live Search] Resolved currentCompany facet ID ${companyId} for "${keyword}"`);
    else console.warn(`[RAG Live Search] LinkedIn did not expose a verifiable company ID for "${keyword}"; profile-level current-employer verification remains mandatory.`);
    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keyword)}&origin=FACETED_SEARCH&network=%5B%22F%22%5D${currentCompanyFacet}`;
    console.log(`[RAG Live Search] Navigating to: ${searchUrl}`);

    // Page through first-degree search results (up to 10 pages for safety and speed)
    let allResults = [];
    let reachedEnd = false;
    for (let pageNo = 1; pageNo <= 10; pageNo += 1) {
      const pageUrl = pageNo === 1 ? searchUrl : `${searchUrl}&page=${pageNo}`;
      console.log(`[RAG Live Search] Scraping page ${pageNo}...`);
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await new Promise((r) => setTimeout(r, 2500));

      if (await isAuthwallPage(page)) {
        console.warn('[RAG Live Search] LinkedIn session not active (authwall/login page)');
        return { results: [], error: 'LinkedIn session not active - run the Campaign Launcher once to refresh the login session.' };
      }

      await waitForResults(page);
      await page.evaluate(async () => {
        for (let i = 0; i < 6; i++) {
          window.scrollBy(0, 800);
          await new Promise((r) => setTimeout(r, 400));
        }
      });
      await new Promise((r) => setTimeout(r, 800));

      const pageResults = await page.evaluate(PEOPLE_SCRAPE_SCRIPT);
      const known = new Set(allResults.map((r) => r.url));
      const fresh = pageResults.filter((r) => !known.has(r.url));
      console.log(`[RAG Live Search] Page ${pageNo}: ${pageResults.length} cards, ${fresh.length} new`);
      allResults = allResults.concat(fresh);
      if (fresh.length === 0) {
        reachedEnd = true;
        break;
      }
    }

    const results = allResults;
    const NON_EMPLOYEE_REGEX = /\b(former|ex[- ]|previously|past|student|gdsc|google developer student|campus ambassador|ambassador|learner|aspirant|looking for opportunities|seeking opportunities|seeking|enthusiast|volunteer|fellow|follower|alumnus|alumni)\b/i;

    for (const person of results) {
      const explicitCurrent = person.currentEmployer && companyNameMatches(person.currentEmployer, keyword);
      const headline = String(person.headline || '');

      let headlineEmployer = '';
      const atMatch = /(?:^|[|·,;•\n\(\)])\s*[^|·,;•\n\(\)]{2,80}?\s+(?:at|@)\s+([^|·,;•\n\(\)]{2,80})(?:$|[|·,;•\n\(\)])/i.exec(headline);
      if (atMatch) {
        headlineEmployer = atMatch[1].trim();
      } else {
        const pipeMatch = /(?:\||-|•|–|—)\s*([^|·,;•\n\(\)]{2,80})(?:$|[|·,;•\n\(\)])/i.exec(headline);
        if (pipeMatch) headlineEmployer = pipeMatch[1].trim();
      }

      const headlineMatches = Boolean(headlineEmployer && companyNameMatches(headlineEmployer, keyword));
      person.employerVerified = Boolean(explicitCurrent || headlineMatches);
      person.employerEvidence = explicitCurrent
        ? `Current employer: ${person.currentEmployer}`
        : (headlineMatches ? `Headline matches target company: ${headline}` : 'Current employer not verified from LinkedIn search result');
      person.currentEmployer = explicitCurrent ? person.currentEmployer : (headlineMatches ? headlineEmployer : '');

      // Reject non-employees, students, GDSC, former employees, or job seekers
      if (NON_EMPLOYEE_REGEX.test(headline)) {
        person.employerVerified = false;
        person.employerRejected = true;
        person.currentEmployer = '';
        person.employerEvidence = 'Headline indicates former employment, student status, GDSC, or job seeker';
      }
    }

    console.log(`[RAG Live Search] Found ${results.length} live 1st-degree connections for "${keyword}"`);
    return {
      results,
      complete: true,
      error: results.length === 0 ? 'Search page loaded but no readable result cards found (LinkedIn may be rate-limiting concurrent automation).' : null,
    };
  } catch (err) {
    console.error(`[RAG Live Search] Error during live search: ${err.stack || err.message}`);
    return { results: [], error: err.message };
  } finally {
    if (page) {
      try { await page.close(); } catch {}
    }
  }
}

/**
 * Scrape the user's LinkedIn messaging thread list (live).
 * Returns { threads: [{ participants, lastMessageSnippet, lastMessageFromMe, threadUrl }], error }
 * lastMessageFromMe === false means the OTHER person sent the last message → they replied.
 */
export async function getLiveMessageThreads(existingBrowser = null) {
  const chromePath = getSystemChromePath();
  const chromeDataDir = liveSearchSessionDir || join(process.cwd(), '.chrome-data');
  if (!chromePath || !existsSync(chromePath)) {
    return { threads: [], error: 'Chrome browser not found on this machine.' };
  }

  const attempts = [];

  if (existingBrowser) {
    try {
      const res = await scrapeMessageThreadsInBrowser(existingBrowser);
      if (res.error && /closed|disconnected/i.test(res.error)) {
        attempts.push(`Reused campaign browser failed: ${res.error}`);
      } else {
        return res;
      }
    } catch (e) {
      attempts.push(`Reused campaign browser failed: ${e.message}`);
    }
  }

  try {
    if (!liveSearchBrowser || liveSearchBrowser.disconnected) {
      liveSearchBrowser = await launchLiveSearchBrowser(chromeDataDir, chromePath);
    }
    try {
      const res = await scrapeMessageThreadsInBrowser(liveSearchBrowser);
      if (res.error && /closed|disconnected|in use/i.test(res.error)) {
        attempts.push(`Dedicated browser failed: ${res.error}`);
      } else {
        return res;
      }
    } finally {
      try { await liveSearchBrowser.close(); } catch {}
      liveSearchBrowser = null;
    }
  } catch (e) {
    attempts.push(`Dedicated browser launch failed: ${e.message}`);
    liveSearchBrowser = null;
    if (isProfileLockError(e)) {
      attempts.push('The LinkedIn Chrome profile (.chrome-data) is locked by another running automation. Stop the active campaign/tracker and try again.');
    }
  }

  return { threads: [], error: attempts.join(' | ') || 'Unknown messaging scrape failure' };
}

async function scrapeMessageThreadsInBrowser(browser) {
  let page = null;
  try {
    page = await browser.newPage();

    console.log('[RAG Live Threads] Navigating to LinkedIn messaging...');
    await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await new Promise((r) => setTimeout(r, 3000));

    if (await isAuthwallPage(page)) {
      console.warn('[RAG Live Threads] ⚠️ LinkedIn session not active (authwall/login page)');
      return { threads: [], error: 'LinkedIn session not active — run the Campaign Launcher once to refresh the login session.' };
    }

    const threadScan = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const readyAt = Date.now();
      while (Date.now() - readyAt < 10000) {
        if (document.querySelectorAll('[class*="msg-conversation"]').length > 0 ||
            document.querySelectorAll('a[href*="/messaging/thread/"]').length > 0) break;
        await sleep(500);
      }
      const seen = new Map();
      const grab = (li, viaLink) => {
        const text = (li.innerText || '').replace(/\\s+/g, ' ').trim();
        const nameEl = li.querySelector('[class*="participant-names"], [class*="participant"]');
        const img = li.querySelector('img[alt]');
        let names = '';
        if (nameEl && nameEl.textContent.trim()) {
          names = nameEl.textContent.replace(/\\s+/g, ' ').trim();
        } else if (img && img.alt && img.alt.trim()) {
          names = img.alt.replace(/\\s+/g, ' ').trim();
        } else {
          names = text.split(' Â· ')[0].split('  ')[0].trim();
        }
        names = names.replace(/\\s+and\\s+you.*$/i, '').trim();
        if (!names || names.length > 100) return;
        const key = names.toLowerCase();
        if (seen.has(key)) return;
        const snippetEl = li.querySelector('[class*="snippet"]');
        const snippet = snippetEl ? snippetEl.textContent.replace(/\\s+/g, ' ').trim() : text.slice(0, 250);
        const fromMe = /^you\\s*:/i.test(snippet);
        const link = viaLink || li.querySelector('a[href*="/messaging/thread/"]');
        const threadUrl = link && link.href ? link.href.split('?')[0] : '';
        seen.set(key, {
          participants: names,
          lastMessageSnippet: snippet,
          lastMessageFromMe: fromMe,
          isUnread: /\\bunread\\b/i.test(li.className || ''),
          threadUrl,
        });
      };

      const grabVisible = () => {
        document.querySelectorAll(
          'li.msg-conversation-listitem, .msg-conversation-card, [class*="msg-conversations-container__convo-item"]'
        ).forEach((li) => grab(li, null));
        if (seen.size === 0) {
          document.querySelectorAll('a[href*="/messaging/thread/"]').forEach((a) => {
            const li = a.closest('li') || a.closest('[class*="msg-conversation"]') || a;
            grab(li, a);
          });
        }
      };

      let scrollEl = null;
      let node = document.querySelector('[class*="conversations-list"]');
      while (node) {
        const style = getComputedStyle(node);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 50) {
          scrollEl = node;
          break;
        }
        node = node.parentElement;
      }

      grabVisible();
      let stagnant = 0;
      for (let round = 0; round < 60 && stagnant < 5; round += 1) {
        if (scrollEl) scrollEl.scrollTop += Math.max(500, scrollEl.clientHeight * 0.9);
        else window.scrollBy(0, 900);
        await sleep(700);
        const before = seen.size;
        grabVisible();
        stagnant = seen.size === before ? stagnant + 1 : 0;
      }

      const hasExplicitEmptyState = /no messages yet|no conversations|you don't have any messages|start a conversation/i.test(
        String(document.body?.innerText || ''),
      );
      return { threads: Array.from(seen.values()), hasExplicitEmptyState };
    }).catch((error) => ({ threads: [], hasExplicitEmptyState: false, scanError: error.message }));

    const threads = threadScan.threads;
    const hasExplicitEmptyState = threadScan.hasExplicitEmptyState;
    if (threadScan.scanError) throw new Error(threadScan.scanError);

    console.log(`[RAG Live Threads] Found ${threads.length} message threads`);
    return {
      threads,
      empty: threads.length === 0 && hasExplicitEmptyState,
      error: threads.length === 0 && !hasExplicitEmptyState
        ? 'LinkedIn did not show any readable message threads or a confirmed empty inbox. The conversation list may not have loaded.'
        : null,
    };
  } catch (err) {
    console.error(`[RAG Live Threads] Error: ${err.stack || err.message}`);
    return { threads: [], error: err.message };
  } finally {
    if (page) {
      try { await page.close(); } catch {}
    }
  }
}

/**
 * Find which of the given connections have replied in LinkedIn messaging.
 * 1. Deep-scroll the messaging thread list to load history
 * 2. Match thread participants against the connection names
 * 3. Open each matched thread and scan the message history:
 *    - message groups authored by the contact, OR
 *    - collapsed history markers ("<Contact> sent the following messages")
 * Returns { replies: [{ connectionName, threadName, lastMessageFromMe, snippet, replied, theirMessage }], threadsTotal, error }
 */
export async function findCompanyMessageReplies(connectionNames, existingBrowser = null) {
  const chromePath = getSystemChromePath();
  const chromeDataDir = liveSearchSessionDir || join(process.cwd(), '.chrome-data');
  if (!chromePath || !existsSync(chromePath)) {
    return { replies: [], threadsTotal: 0, error: 'Chrome browser not found on this machine.' };
  }
  if (!Array.isArray(connectionNames) || connectionNames.length === 0) {
    return { replies: [], threadsTotal: 0, error: null };
  }

  const attempts = [];

  if (existingBrowser) {
    try {
      const res = await runReplyScanInBrowser(existingBrowser, connectionNames);
      if (res.error && /closed|disconnected/i.test(res.error)) {
        attempts.push(`Reused campaign browser failed: ${res.error}`);
      } else {
        return res;
      }
    } catch (e) {
      attempts.push(`Reused campaign browser failed: ${e.message}`);
    }
  }

  try {
    if (!liveSearchBrowser || liveSearchBrowser.disconnected) {
      liveSearchBrowser = await launchLiveSearchBrowser(chromeDataDir, chromePath);
    }
    try {
      let res = await runReplyScanInBrowser(liveSearchBrowser, connectionNames);
      // Long scans can lose their execution context (SPA navigation mid-scan,
      // tab crash) — retry once with a fresh page before giving up
      if (res.error && /detached|closed|destroyed|crash/i.test(res.error)) {
        console.warn('[RAG Reply Scan] Execution context lost — retrying once...');
        res = await runReplyScanInBrowser(liveSearchBrowser, connectionNames);
      }
      if (res.error && /closed|disconnected|in use/i.test(res.error)) {
        attempts.push(`Dedicated browser failed: ${res.error}`);
      } else {
        return res;
      }
    } finally {
      // Always release the profile lock — otherwise campaign/tracker
      // Chrome launches fail with "Failed to launch the browser process"
      try { await liveSearchBrowser.close(); } catch {}
      liveSearchBrowser = null;
    }
  } catch (e) {
    attempts.push(`Dedicated browser launch failed: ${e.message}`);
    liveSearchBrowser = null;
    if (isProfileLockError(e)) {
      attempts.push('The LinkedIn Chrome profile (.chrome-data) is locked by another running automation. Stop the active campaign/tracker and try again.');
    }
  }

  return { replies: [], threadsTotal: 0, error: attempts.join(' | ') || 'Unknown messaging scan failure' };
}

async function runReplyScanInBrowser(browser, connectionNames) {
  let page = null;
  try {
    page = await browser.newPage();

    console.log('[RAG Reply Scan] Navigating to LinkedIn messaging...');
    await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 4000));

    if (await isAuthwallPage(page)) {
      return { replies: [], threadsTotal: 0, error: 'LinkedIn session not active — run the Campaign Launcher once to refresh the login session.' };
    }

    // Step 1: click the "Connections" filter chip (threads with connections

    // Step 1a: click the "Connections" filter chip (threads with connections
    // only — much smaller list)
    await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('button, [role="button"], li'));
      const chip = chips.find((el) => el.textContent.trim().toLowerCase() === 'connections');
      if (chip) chip.click();
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3500));

    // Step 1b: deep-scroll in CHUNKS — if the execution context is lost
    // mid-scan (SPA navigation/tab crash), we keep whatever was collected
    const threadMap = new Map();
    const maxRounds = 60;
    let stagnant = 0;
    for (let chunk = 0; chunk < maxRounds && stagnant < 5; chunk += 10) {
      let chunkThreads = [];
      try {
        chunkThreads = await page.evaluate(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

          let scrollEl = null;
          let node = document.querySelector('[class*="conversations-list"]');
          while (node) {
            const st = getComputedStyle(node);
            if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 50) {
              scrollEl = node;
              break;
            }
            node = node.parentElement;
          }

          const seen = new Map();
          const grab = () => {
            document.querySelectorAll(
              'li.msg-conversation-listitem, .msg-conversation-card, [class*="msg-conversations-container__convo-item"]'
            ).forEach((li) => {
              const nameEl = li.querySelector('[class*="participant-names"], [class*="participant"]');
              if (!nameEl) return;
              let names = nameEl.textContent.replace(/\s+/g, ' ').trim();
              names = names.replace(/\s+and\s+you.*$/i, '').trim();
              if (!names || names.length > 100) return;
              const key = names.toLowerCase();
              if (seen.has(key)) return;
              const snippetEl = li.querySelector('[class*="snippet"]');
              const snippet = snippetEl ? snippetEl.textContent.replace(/\s+/g, ' ').trim() : '';
              seen.set(key, {
                participants: names,
                lastMessageSnippet: snippet,
                lastMessageFromMe: /^you\s*:/i.test(snippet),
                isUnread: /\bunread\b/i.test(li.className || ''),
              });
            });
          };

          grab();
          for (let i = 0; i < 10; i++) {
            if (scrollEl) scrollEl.scrollTop += scrollEl.clientHeight * 0.9;
            else window.scrollBy(0, 800);
            await sleep(800);
            grab();
          }
          return Array.from(seen.values());
        });
      } catch (e) {
        console.warn(`[RAG Reply Scan] Chunk ${chunk} failed (${e.message}) — continuing with collected threads`);
        break;
      }
      const before = threadMap.size;
      for (const t of chunkThreads) {
        if (!threadMap.has(t.participants.toLowerCase())) threadMap.set(t.participants.toLowerCase(), t);
      }
      stagnant = threadMap.size === before ? stagnant + 1 : 0;
    }
    const threads = Array.from(threadMap.values());

    console.log(`[RAG Reply Scan] Loaded ${threads.length} message threads from history`);

    // Step 2: match thread participants against the connection names
    // (strict: full-name containment, or first AND last token both equal —
    // first-name-only matching causes false positives like Mohit Kishore <-> Mohit Paddhariya)
    const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const tokens = (s) => norm(s).split(' ').filter((w) => w.length > 1);
    const matches = [];
    for (const cname of connectionNames.slice(0, 20)) {
      const cn = norm(cname);
      if (!cn) continue;
      const th = threads.find((t) => {
        const tn = norm(t.participants);
        if (tn === cn) return true;
        if (tn.includes(cn) || cn.includes(tn)) return true;
        const ct = tokens(cname);
        const tt = tokens(t.participants);
        if (ct.length >= 2 && tt.length >= 2) {
          return ct[0] === tt[0] && ct[ct.length - 1] === tt[tt.length - 1];
        }
        return false;
      });
      if (th) matches.push({ connection: cname, thread: th });
    }
    console.log(`[RAG Reply Scan] ${matches.length} of the given connections have message threads`);

    // Helper: locate a participant element in the sidebar (scrolling if needed)
    // and mark it so Node can perform a REAL mouse click on it.
    // Synthetic el.click() does NOT navigate LinkedIn's SPA.
    const locateAndMark = async (contactName) => {
      const found = await page.evaluate(async (name) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const cn = norm(name);
        const cnTokens = cn.split(' ').filter((w) => w.length > 1);

        document.querySelectorAll('[data-rag-target]').forEach((el) => el.removeAttribute('data-rag-target'));

        const isTarget = (t) => {
          if (!t) return false;
          if (t.includes(cn) || cn.includes(t)) return true;
          const tt = t.split(' ').filter((w) => w.length > 1);
          return cnTokens.length >= 2 && tt.length >= 2 && cnTokens[0] === tt[0] && cnTokens[cnTokens.length - 1] === tt[tt.length - 1];
        };

        let scrollEl = null;
        let node = document.querySelector('[class*="conversations-list"]');
        while (node) {
          const st = getComputedStyle(node);
          if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 50) {
            scrollEl = node;
            break;
          }
          node = node.parentElement;
        }

        const findEl = () => {
          const items = Array.from(document.querySelectorAll('[class*="participant-names"]'));
          return items.find((n) => isTarget(norm(n.textContent)));
        };

        let el = findEl();
        if (!el && scrollEl) {
          let stagnant = 0;
          let rounds = 0;
          while (!el && stagnant < 4 && rounds < 55) {
            scrollEl.scrollTop += scrollEl.clientHeight * 0.9;
            await sleep(600);
            rounds++;
            const before = document.querySelectorAll('[class*="participant-names"]').length;
            el = findEl();
            if (!el && document.querySelectorAll('[class*="participant-names"]').length === before) stagnant++;
            else if (!el) stagnant = 0;
          }
        }
        if (!el) return false;
        el.setAttribute('data-rag-target', '1');
        return true;
      }, contactName);

      if (!found) return null;
      return page.$('[data-rag-target="1"]');
    };

    // Helper: capture the message-pane signature (detects when the pane
    // actually switches to the clicked thread — avoids stale reads)
    const paneSignature = async () => page.evaluate(() => {
      const bodies = document.querySelectorAll('[class*="event-listitem__body"]');
      return bodies.length + ':' + (bodies.length ? bodies[bodies.length - 1].textContent.trim().slice(0, 60) : '');
    }).catch(() => 'err');

    // Step 3: open each matched thread (REAL mouse click) and scan history
    // for messages authored by the contact
    const replies = [];
    for (const m of matches.slice(0, 6)) {
      const beforeSig = await paneSignature();
      const handle = await locateAndMark(m.thread.participants);
      if (!handle) {
        replies.push({
          connectionName: m.connection,
          threadName: m.thread.participants,
          lastMessageFromMe: m.thread.lastMessageFromMe,
          snippet: m.thread.lastMessageSnippet,
          replied: !m.thread.lastMessageFromMe,
          theirMessage: m.thread.lastMessageFromMe ? null : m.thread.lastMessageSnippet.replace(/^[^:]{0,60}:\s*/, ''),
        });
        continue;
      }

      await handle.click(); // real mouse click (mousedown/mouseup/click)
      // wait until the pane content actually changes (or ~10s)
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const sig = await paneSignature();
        if (sig !== beforeSig) break;
      }
      await new Promise((r) => setTimeout(r, 1500));

      const scan = await page.evaluate(async (contactName) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const cn = norm(contactName);
        const cnTokens = cn.split(' ').filter((w) => w.length > 1);
        const lastToken = cnTokens[cnTokens.length - 1];

        const findTheirMessage = () => {
          let theirLast = null;
          let lastAuthor = '';
          // Iterate message bodies; the author name lives on the enclosing
          // event <li> (group header). Continuation messages inherit the
          // previous author. Collapsed history markers say
          // "<Name> sent the following messages at ..."
          const bodies = document.querySelectorAll('[class*="event-listitem__body"]');
          bodies.forEach((b) => {
            const eventLi = b.closest('li[class*="message-list__event"]') || b.closest('li') || b.parentElement;
            const liText = norm(eventLi ? eventLi.innerText : '');
            if (liText.includes('sent the following messages')) {
              const markerName = liText.split('sent the following')[0].trim();
              if (markerName && markerName.length > 2 && markerName.length < 60) lastAuthor = markerName;
            }
            const nameEl = eventLi ? eventLi.querySelector('[class*="group__name"]') : null;
            if (nameEl && nameEl.textContent.trim()) lastAuthor = norm(nameEl.textContent);

            const authorIsContact = lastAuthor && (
              lastAuthor === cn || lastAuthor.includes(cn) || cn.includes(lastAuthor) ||
              (cnTokens.length >= 2 && lastAuthor.split(' ').filter((w) => w.length > 1).length >= 2 &&
               lastAuthor.split(' ')[0] === cnTokens[0] && lastAuthor.split(' ').slice(-1)[0] === lastToken)
            );
            if (authorIsContact) {
              const txt = b.textContent.trim();
              // Ignore our own outgoing messages ("You: ...")
              if (txt && txt.length > 1 && !/^you\b/i.test(norm(txt))) theirLast = txt.slice(0, 400);
            }
          });
          return theirLast;
        };

        let theirMsg = findTheirMessage();

        // Scroll the message list up to lazy-load older history
        if (!theirMsg) {
          const listEl = document.querySelector('ul[class*="message-list"]') || document.querySelector('[class*="message-list-content"]');
          for (let i = 0; i < 6 && !theirMsg; i++) {
            if (listEl) listEl.scrollTop = 0;
            else window.scrollBy(0, -900);
            await sleep(1300);
            theirMsg = findTheirMessage();
          }
        }

        return { theirMessage: theirMsg };
      }, m.thread.participants);

      const theirLastFromSnippet = m.thread.lastMessageFromMe
        ? null
        : m.thread.lastMessageSnippet.replace(/^[^:]{0,60}:\s*/, '');

      replies.push({
        connectionName: m.connection,
        threadName: m.thread.participants,
        lastMessageFromMe: m.thread.lastMessageFromMe,
        snippet: m.thread.lastMessageSnippet,
        replied: !m.thread.lastMessageFromMe || !!scan.theirMessage,
        theirMessage: scan.theirMessage || theirLastFromSnippet,
      });
    }

    console.log(`[RAG Reply Scan] ${replies.filter((r) => r.replied).length} replied of ${replies.length} matched threads`);
    return { replies, threadsTotal: threads.length, error: null };
  } catch (err) {
    console.error(`[RAG Reply Scan] Error: ${err.stack || err.message}`);
    return { replies: [], threadsTotal: 0, error: err.message };
  } finally {
    if (page) {
      try { await page.close(); } catch {}
    }
  }
}

/* ── Live conversation: read a thread and send a reply ──────────────
 * Both helpers open the user's saved LinkedIn session, find the thread for
 * one person, and work on the real messaging page. Reading returns the full
 * conversation so the UI can show it and the AI can reply in context.
 */

async function withLivePage(existingBrowser, task, { retry = 0 } = {}) {
  const chromePath = getSystemChromePath();
  const chromeDataDir = liveSearchSessionDir || join(process.cwd(), '.chrome-data');
  if (!chromePath || !existsSync(chromePath)) {
    return { error: 'Chrome browser not found on this machine.' };
  }

  let lastError = null;

  // A campaign tab can close mid-read (protocol error), so a read gets one
  // extra pass. Sends never retry: a message may already have gone out.
  for (let attempt = 0; attempt <= retry; attempt += 1) {
    if (existingBrowser && !existingBrowser.disconnected) {
      try {
        return await task(existingBrowser, true);
      } catch (err) {
        lastError = err;
        // Anything that is not a dead-tab/transport failure is a real answer
        // (auth wall, thread not found) — do not retry it.
        if (!isTransportError(err) && !/closed|disconnected/i.test(err.message || '')) {
          return { error: friendlyLiveError(err) };
        }
        // The profile is still owned by the campaign, so launching a second
        // Chrome would only fail the lock. Retry with a fresh tab instead.
        if (attempt < retry) continue;
        break;
      }
    }

    let launchedHere = false;
    let browser = null;
    try {
      const cached = liveSearchBrowser && !liveSearchBrowser.disconnected ? liveSearchBrowser : null;
      if (cached) {
        browser = cached;
      } else {
        browser = await launchLiveSearchBrowser(chromeDataDir, chromePath);
        liveSearchBrowser = browser;
        launchedHere = true;
      }
      return await task(browser, true);
    } catch (err) {
      lastError = err;
      if (isProfileLockError(err)) break;
      if (!isTransportError(err)) return { error: friendlyLiveError(err) };
      // A dead cached browser would fail the same way again — drop it.
      if (!launchedHere) {
        try { await browser.close(); } catch {}
        if (liveSearchBrowser === browser) liveSearchBrowser = null;
      }
    } finally {
      if (launchedHere) {
        try { await browser.close(); } catch {}
        if (liveSearchBrowser === browser) liveSearchBrowser = null;
      }
    }
  }

  return { error: friendlyLiveError(lastError) };
}

/** Fallback: open a person's profile and press its Message button. */
async function openThreadViaProfile(page, personName, profileUrl) {
  const url = String(profileUrl || '').trim();
  if (!url || !/linkedin\.com\/in\//.test(url)) {
    return {
      code: 'no_thread',
      error: `No LinkedIn message thread with ${personName} yet — the conversation opens once they accept the connection request.`,
    };
  }

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 3500));

  if (await isAuthwallPage(page)) {
    return { error: 'LinkedIn session not active — reconnect your LinkedIn account and try again.' };
  }

  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, a'));
    const button = buttons.find((el) => {
      const text = String(el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!/^message$/i.test(text)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 5 && rect.height > 5;
    });
    if (!button) return false;
    button.click();
    return true;
  });

  if (!clicked) {
    // Messaging is only available with a 1st-degree connection. Pending or
    // withdrawn invitations have no thread, which is a normal state.
    return {
      code: 'no_thread',
      error: `No LinkedIn message thread with ${personName} yet — messaging opens after they accept your invitation.`,
    };
  }

  const navigated = await page.waitForFunction(
    () => /\/messaging\/thread\//.test(location.href),
    { timeout: 15000 },
  ).then(() => true).catch(() => false);

  if (!navigated) {
    return {
      code: 'no_thread',
      error: `LinkedIn did not open a conversation with ${personName}. Open it on LinkedIn to check, then tap Refresh.`,
    };
  }

  // "/messaging/thread/new/" means LinkedIn found no history with this person —
  // the saved profile link is stale or the thread lives under another account.
  if (/\/messaging\/thread\/new\//.test(page.url())) {
    return {
      code: 'no_thread',
      error: `LinkedIn has no message history with ${personName} on this account. If the conversation exists, open it on LinkedIn first, then tap Refresh.`,
    };
  }

  for (let i = 0; i < 12; i += 1) {
    const ready = await page.evaluate(() => Boolean(
      document.querySelector('[class*="message-list"]') ||
      document.querySelector('.msg-form__contenteditable') ||
      document.querySelector('div[contenteditable="true"][role="textbox"]')
    )).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 800));
  }
  await new Promise((r) => setTimeout(r, 1200));
  return { ok: true };
}

/** Open the messaging page and click the thread whose participants match. */
async function openMessagingThread(browser, personName, profileUrl = '') {
  const page = await browser.newPage();
  await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 3500));

  if (await isAuthwallPage(page)) {
    await page.close();
    return { error: 'LinkedIn session not active — reconnect your LinkedIn account and try again.' };
  }

  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const tokens = (s) => norm(s).split(' ').filter((w) => w.length > 1);
  const target = norm(personName);
  const targetTokens = tokens(personName);

  const findAndMark = () => page.evaluate(({ target, targetTokens }) => {
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    document.querySelectorAll('[data-hamzooh-thread]').forEach((el) => el.removeAttribute('data-hamzooh-thread'));
    const isTarget = (text) => {
      const value = norm(text);
      if (!value) return false;
      if (value === target || value.includes(target) || target.includes(value)) return true;
      const parts = value.split(' ').filter((w) => w.length > 1);
      return targetTokens.length >= 2 && parts.length >= 2 &&
        parts[0] === targetTokens[0] && parts[parts.length - 1] === targetTokens[targetTokens.length - 1];
    };
    const items = Array.from(document.querySelectorAll('[class*="participant-names"], li.msg-conversation-listitem'));
    const hit = items.find((el) => isTarget(el.textContent));
    if (!hit) return false;
    const row = hit.closest('li') || hit;
    row.setAttribute('data-hamzooh-thread', '1');
    return true;
  }, { target, targetTokens });

  let found = await findAndMark().catch(() => false);
  if (!found) {
    // Scroll the conversation list until the person shows up. The inbox is
    // long (a few hundred threads) and loads in pages, so keep going while the
    // list actually moves instead of stopping at an arbitrary pass count.
    let stalled = 0;
    for (let i = 0; i < 40 && !found && stalled < 3; i += 1) {
      const moved = await page.evaluate(() => {
        let node = document.querySelector('[class*="conversations-list"]');
        while (node) {
          const st = getComputedStyle(node);
          if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 50) {
            const before = node.scrollTop;
            node.scrollTop += node.clientHeight * 0.9;
            return node.scrollTop > before;
          }
          node = node.parentElement;
        }
        const before = window.scrollY;
        window.scrollBy(0, 1200);
        return window.scrollY > before;
      }).catch(() => false);
      await new Promise((r) => setTimeout(r, 850));
      found = await findAndMark().catch(() => false);
      stalled = moved || found ? 0 : stalled + 1;
    }
  }

  if (!found) {
    // Last resort: open the profile and use its Message button. This works for
    // threads the inbox list never renders (very old, archived or unread-muted).
    const opened = await openThreadViaProfile(page, personName, profileUrl);
    if (opened.error) {
      await page.close().catch(() => {});
      return { code: opened.code || '', error: opened.error };
    }
    return { page };
  }

  const handle = await page.$('[data-hamzooh-thread="1"]');
  if (!handle) {
    await page.close();
    return { error: `Could not open the conversation with ${personName}.` };
  }

  await handle.click();
  // Wait for the message pane to render (composer or message list).
  for (let i = 0; i < 12; i += 1) {
    const ready = await page.evaluate(() => Boolean(
      document.querySelector('[class*="message-list"]') ||
      document.querySelector('.msg-form__contenteditable') ||
      document.querySelector('div[contenteditable="true"][role="textbox"]')
    )).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 800));
  }
  await new Promise((r) => setTimeout(r, 1200));
  return { page };
}

/**
 * Read the whole conversation with one person.
 * Returns { messages: [{ direction: 'in'|'out', author, text, at }], error }
 */export async function readLinkedInThread(personName, existingBrowser = null, profileUrl = '') {
  if (!String(personName || '').trim()) return { messages: [], error: 'A contact name is required.' };

  const result = await withLivePage(existingBrowser, async (browser) => {
    const opened = await openMessagingThread(browser, personName, profileUrl);
    if (opened.error) return { messages: [], error: opened.error, code: opened.code || '' };
    const { page } = opened;
    try {
      const messages = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const collected = [];
        const seen = new Set();        const grab = () => {
          const nodes = Array.from(document.querySelectorAll(
            'li[class*="message-list__event"], li.msg-s-message-list__event, [class*="msg-s-event-listitem"]'
          ));
          nodes.forEach((node) => {
            const bodyEl = node.querySelector('[class*="event-listitem__body"], [class*="msg-s-event-listitem__body"]');
            if (!bodyEl) return;
            const text = String(bodyEl.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text) return;
            const nameEl = node.querySelector('[class*="group__name"], [class*="msg-s-message-group__name"]');
            const headerEl = node.querySelector('[class*="event-listitem__header"], time');
            const key = `${text.slice(0, 80)}|${nameEl ? nameEl.textContent.trim() : ''}`;
            if (seen.has(key)) return;
            seen.add(key);
            const author = nameEl ? nameEl.textContent.replace(/\s+/g, ' ').trim() : '';
            const header = headerEl ? String(headerEl.textContent || headerEl.getAttribute('datetime') || '').replace(/\s+/g, ' ').trim() : '';
            const liText = String(node.innerText || '').replace(/\s+/g, ' ').trim();
            collected.push({ author, header, text, liText });
          });
        };

        grab();
        // Load older history by scrolling the message list to the top.
        const list = document.querySelector('ul[class*="message-list"], [class*="message-list-content"]');
        for (let i = 0; i < 10; i += 1) {
          if (list) list.scrollTop = 0;
          else window.scrollBy(0, -900);
          await sleep(900);
          grab();
        }
        return collected;
      });

      // Read receipts: LinkedIn renders "Seen"/"Delivered" only under the last
      // outgoing message group, and only inside the message list container.
      const receipt = await page.evaluate(() => {
        const list = document.querySelector('ul[class*="message-list"], [class*="message-list-content"]') || document.body;
        const texts = Array.from(list.querySelectorAll('[class*="status"], [class*="timestamp"], [class*="receipt"], [class*="caption"]'))
          .map((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim())
          .filter((text) => text && text.length < 30);
        return {
          seen: texts.some((text) => /\bseen\b/i.test(text)),
          delivered: texts.some((text) => /\bdelivered\b/i.test(text)),
        };
      }).catch(() => ({ seen: false, delivered: false }));

      // Decide direction. LinkedIn prints the sender's real name, so "You" is
      // not reliable — anything not naming the contact came from the signed-in
      // user. Group headers are skipped on continuation messages, so inherit
      // the previous author when a body has none.
      const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const targetName = normName(personName);
      const targetTokens = targetName.split(' ').filter((w) => w.length > 1);
      const isContact = (author) => {
        const value = normName(author);
        if (!value) return false;
        if (value === targetName || value.includes(targetName) || targetName.includes(value)) return true;
        const parts = value.split(' ').filter((w) => w.length > 1);
        return targetTokens.length >= 2 && parts.length >= 2 &&
          parts[0] === targetTokens[0] && parts[parts.length - 1] === targetTokens[targetTokens.length - 1];
      };

      let lastOutgoing = null;
      const cleaned = messages.map((item) => {
        const author = String(item.author || '').replace(/\s+/g, ' ').trim();
        const li = String(item.liText || '');
        let outgoing;
        if (author) {
          outgoing = !isContact(author) && !/\b(?:sent the following messages|said)\b/i.test(author);
          lastOutgoing = outgoing;
        } else if (/^you\b/i.test(li)) {
          outgoing = true;
          lastOutgoing = true;
        } else if (lastOutgoing !== null) {
          outgoing = lastOutgoing;
        } else {
          outgoing = false;
        }
        return {
          direction: outgoing ? 'out' : 'in',
          author: outgoing ? 'You' : (isContact(author) ? personName : (author || personName)),
          text: item.text,
          at: item.header || '',
        };
      });
      // LinkedIn renders newest at the bottom; dedupe consecutive scroll passes.
      const unique = [];
      cleaned.forEach((message) => {
        const prev = unique[unique.length - 1];
        if (prev && prev.text === message.text && prev.direction === message.direction) return;
        unique.push(message);
      });
      return { messages: unique, seenByThem: Boolean(receipt.seen), delivered: Boolean(receipt.delivered), error: null };
    } finally {
      try { await page.close(); } catch {}
    }
  }, { retry: 1 });

  if (result?.error) return { messages: [], error: result.error, code: result.code || '' };
  return {
    messages: result?.messages || [],
    seenByThem: Boolean(result?.seenByThem),
    delivered: Boolean(result?.delivered),
    code: '',
    error: null,
  };
}

/**
 * Send a message in the existing conversation with one person.
 * Returns { ok, sent, error }
 */
export async function sendLinkedInMessage(personName, text, existingBrowser = null, profileUrl = '') {
  const body = String(text || '').trim();
  if (!body) return { ok: false, error: 'Write a message before sending.' };

  const result = await withLivePage(existingBrowser, async (browser) => {
    const opened = await openMessagingThread(browser, personName, profileUrl);
    if (opened.error) return { ok: false, code: opened.code || '', error: opened.error };
    const { page } = opened;
    try {
      const box = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll(
          'div[contenteditable="true"][role="textbox"], .msg-form__contenteditable, [contenteditable="true"]'
        )).filter((el) => {
          const st = getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 20 && rect.height > 10;
        });
        const target = candidates[candidates.length - 1];
        if (!target) return null;
        target.scrollIntoView({ block: 'center' });
        const rect = target.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });

      if (!box) return { ok: false, error: 'LinkedIn message box not found in this conversation.' };

      await page.mouse.click(box.x, box.y);
      await new Promise((r) => setTimeout(r, 600));
      // typing line by line keeps LinkedIn's editor from merging lines
      for (const [index, line] of body.split('\n').entries()) {
        if (index > 0) await page.keyboard.down('Shift'), await page.keyboard.press('Enter'), await page.keyboard.up('Shift');
        await page.keyboard.type(line, { delay: 12 });
      }
      await new Promise((r) => setTimeout(r, 800));

      const clicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll(
          'button.msg-form__send-button, button[type="submit"], .msg-form__send-btn'
        ));
        const button = buttons.find((el) => {
          const st = getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden') return false;
          return el.getBoundingClientRect().width > 5 && !el.disabled;
        });
        if (!button) return false;
        button.click();
        return true;
      });

      if (!clicked) {
        await page.keyboard.press('Enter');
      }
      await new Promise((r) => setTimeout(r, 2500));

      const appeared = await page.evaluate((needle) => {
        const texts = Array.from(document.querySelectorAll('[class*="event-listitem__body"], [class*="msg-s-event-listitem__body"]'))
          .map((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim());
        const probe = needle.replace(/\s+/g, ' ').trim().slice(0, 60);
        return texts.some((text) => text.includes(probe));
      }, body).catch(() => false);

      return appeared
        ? { ok: true, sent: body }
        : {
            ok: false,
            uncertain: true,
            error: 'LinkedIn did not confirm the message in the conversation. Check the thread before trying again.',
          };
    } finally {
      try { await page.close(); } catch {}
    }
  }, { retry: 0 });

  if (result?.error && result.code !== 'no_thread' && /closed the browser tab/i.test(result.error)) {
    return {
      ok: false,
      uncertain: true,
      error: 'LinkedIn closed the tab while sending. The message may or may not have gone out — open the thread on LinkedIn and check before sending again.',
    };
  }
  return result || { ok: false, error: 'LinkedIn messaging failed.' };
}
