import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';
import { db } from './db.js';

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

export class LinkedInTrackerEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.isRunning = false;
    this.browser = options.existingBrowser || null;
    this.isReusedBrowser = Boolean(options.existingBrowser);
    this.page = null;

    // Use main .chrome-data directory where user's active LinkedIn session lives
    this.chromeDataDir = join(process.cwd(), '.chrome-data');
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
      this.log('âš ï¸ Status sync is already running in background!', 'warning');
      return;
    }

    this.isRunning = true;
    this.emit('status_change', { status: 'syncing' });
    this.log('ðŸ” Starting Connection Status Tracker...', 'info');

    // If no existing browser passed, launch a background Chrome instance with main session dir
    if (!this.browser) {
      const chromePath = this.options.chromePath || getSystemChromePath();

      if (!chromePath || !existsSync(chromePath)) {
        this.log(`âŒ Could not locate Chrome browser at path: ${chromePath || 'Not found'}`, 'error');
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
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--no-default-browser-check',
            '--remote-allow-origins=*',
          ],
          ignoreDefaultArgs: ['--enable-automation'],
        });
      } catch (err) {
        this.log(`âŒ Tracker Browser Launch Failed: ${err.message}`, 'error');
        this.isRunning = false;
        this.emit('status_change', { status: 'idle', error: err.message });
        return;
      }
    }

    try {
      // Create a background page/tab for tracking
      this.page = await this.browser.newPage();

      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      // Verify Login Session
      this.log('ðŸ” Checking active LinkedIn login session for tracking...', 'info');
      await this.page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.sleep(3000);

      const url = this.page.url();
      if (url.includes('/login') || url.includes('/authwall') || url.includes('/checkpoint')) {
        this.log('âš ï¸ LinkedIn Session expired. Please run campaign launcher once or log in to refresh background cookies.', 'warning');
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

      this.log('âœ… Session active! Syncing connection statuses in background...', 'success');

      const allRecords = db.getAllConnections();
      if (allRecords.length === 0) {
        this.log('â„¹ï¸ No tracked connections in database yet.', 'info');
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
      this.log('ðŸ“¬ Step 1/3: Checking Pending Invitations list...', 'info');
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

      this.log(`ðŸ“‹ Found ${pendingCards.length} active pending invitation cards on LinkedIn.`, 'info');

      // Step 2: Check Connections Page (Accepted 1st-degree list)
      this.log('ðŸ¤ Step 2/3: Checking 1st-Degree Accepted Connections list...', 'info');
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

      this.log(`âœ… Loaded ${acceptedList.length} 1st-degree connections from LinkedIn.`, 'info');

      // Step 3: Check LinkedIn Messaging for Read Receipts (Seen) and Replies
      this.log('ðŸ’¬ Step 3/3: Checking LinkedIn Inbox for Read Receipts (Seen) & Replies...', 'info');
      await this.page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.sleep(4000);

      // Deep-scroll the messaging thread list (its own scroll container â€”
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
                name = text.split(' Â· ')[0].split('  ')[0].trim();
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
            this.log(`ðŸŽ‰ Confirmed Accepted Connection: ${record.name} (${record.company})`, 'success');
          } else if (newStatus === 'seen') {
            this.log(`ðŸ‘ï¸ Read Receipt (Seen): ${record.name} opened message thread`, 'info');
          } else if (newStatus === 'replied') {
            this.log(`ðŸ’¬ Reply Received from ${record.name}: "${replySnippet.substring(0, 45)}..."`, 'success');
          } else {
            this.log(`â³ Invitation Status: ${record.name} is Pending`, 'info');
          }
          updatedCount++;
        }
      }

      this.log(`ðŸŽ‰ Background Sync Completed! Updated ${updatedCount} records based on actual LinkedIn data.`, 'success');

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

      this.isRunning = false;
      this.emit('status_change', { status: this.isReusedBrowser ? 'running' : 'completed_sync' });
    } catch (err) {
      this.log(`âš ï¸ Status Sync Error: ${err.message}`, 'warning');
      if (this.page) {
        try { await this.page.close(); } catch {}
        this.page = null;
      }
      if (!this.isReusedBrowser && this.browser) {
        try { await this.browser.close(); } catch {}
        this.browser = null;
      }
      this.isRunning = false;
      this.emit('status_change', { status: this.isReusedBrowser ? 'running' : 'idle', error: err.message });
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
      let location = '';
      for (const l of lines) {
        if (l === name || l.length <= 3 || l.length >= 160) continue;
        if (/^(message|view|connect|follow|past:|current:|education)/i.test(l) || /mutual connection/i.test(l)) continue;
        if (!headline && (l.includes(' at ') || l.includes('|') || /engineer|manager|developer|designer|analyst|scientist|consultant|intern|associate|director|lead|recruiter|architect|founder|specialist|administrator|executive/i.test(l))) {
          headline = l;
          continue;
        }
        if (headline && !location && /,|india|bengaluru|hyderabad|mumbai|delhi|pune|chennai/i.test(l) && !/ at /.test(l)) {
          location = l;
          break;
        }
      }
      out.set(href, { name, url: href, headline, location });    });
  }

  return Array.from(out.values());
})()`;

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
  if (/\/login|\/authwall|\/checkpoint|\/uas\//.test(url)) return true;
  return page.evaluate(() => {
    const body = document.body ? document.body.innerText.slice(0, 2000) : '';
    return /sign in to continue|authwall|session has expired|log in to continue/i.test(body);
  }).catch(() => false);
}

// Persistent dedicated browser for live RAG searches (launched per query,
// closed right after — see the try/finally in each public function)
let liveSearchBrowser = null;

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
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });
}

function isProfileLockError(err) {
  return /user data directory is already in use|Failed to launch|browser process/i.test(err.message || '');
}

export async function searchLiveConnections(keyword, existingBrowser = null) {
  const chromePath = getSystemChromePath();
  const chromeDataDir = join(process.cwd(), '.chrome-data');
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
    // Headless Chrome advertises "HeadlessChrome" in its UA â€” LinkedIn may
    // serve degraded/authwalled markup to it. Mask with a normal UA.
    const ua = await page.evaluate(() => navigator.userAgent);
    await page.setUserAgent(ua.replace(/HeadlessChrome/g, 'Chrome'));
    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keyword)}&origin=FACETED_SEARCH&network=%5B%22F%22%5D`;
    console.log(`[RAG Live Search] Navigating to: ${searchUrl}`);

    // Scrape multiple search pages for deeper coverage (LinkedIn paginates with &page=N)
    let allResults = [];
    for (const pageNo of [1, 2, 3]) {
      const pageUrl = pageNo === 1 ? searchUrl : `${searchUrl}&page=${pageNo}`;
      console.log(`[RAG Live Search] Scraping page ${pageNo}...`);
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await new Promise((r) => setTimeout(r, 3000));

      if (await isAuthwallPage(page)) {
        console.warn('[RAG Live Search] LinkedIn session not active (authwall/login page)');
        return { results: [], error: 'LinkedIn session not active - run the Campaign Launcher once to refresh the login session.' };
      }

      await waitForResults(page);
      await page.evaluate(async () => {
        for (let i = 0; i < 8; i++) {
          window.scrollBy(0, 800);
          await new Promise((r) => setTimeout(r, 600));
        }
      });
      await new Promise((r) => setTimeout(r, 1000));

      const pageResults = await page.evaluate(PEOPLE_SCRAPE_SCRIPT);
      const known = new Set(allResults.map((r) => r.url));
      const fresh = pageResults.filter((r) => !known.has(r.url));
      console.log(`[RAG Live Search] Page ${pageNo}: ${pageResults.length} cards, ${fresh.length} new`);
      allResults = allResults.concat(fresh);
      if (fresh.length === 0) break; // no more pages with results
    }

    const results = allResults;

    console.log(`[RAG Live Search] Found ${results.length} live 1st-degree connections for "${keyword}"`);
    return { results, error: results.length === 0 ? 'Search page loaded but no readable result cards found (LinkedIn may be rate-limiting concurrent automation).' : null };
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
 * lastMessageFromMe === false means the OTHER person sent the last message â†’ they replied.
 */
export async function getLiveMessageThreads(existingBrowser = null) {
  const chromePath = getSystemChromePath();
  const chromeDataDir = join(process.cwd(), '.chrome-data');
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
    const ua = await page.evaluate(() => navigator.userAgent);
    await page.setUserAgent(ua.replace(/HeadlessChrome/g, 'Chrome'));

    console.log('[RAG Live Threads] Navigating to LinkedIn messaging...');
    await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await new Promise((r) => setTimeout(r, 3000));

    if (await isAuthwallPage(page)) {
      console.warn('[RAG Live Threads] âš ï¸ LinkedIn session not active (authwall/login page)');
      return { threads: [], error: 'LinkedIn session not active â€” run the Campaign Launcher once to refresh the login session.' };
    }

    // Wait for thread list to render
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const start = Date.now();
      while (Date.now() - start < 9000) {
        if (
          document.querySelectorAll('[class*="msg-conversation"]').length > 0 ||
          document.querySelectorAll('a[href*="/messaging/thread/"]').length > 0
        ) return true;
        await sleep(500);
      }
      return false;
    }).catch(() => false);

    // Scroll to load more threads
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) {
        window.scrollBy(0, 800);
        await new Promise((r) => setTimeout(r, 800));
      }
    }).catch(() => {});

    const threads = await page.evaluate(`(() => {
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
        seen.set(key, { participants: names, lastMessageSnippet: snippet, lastMessageFromMe: fromMe, threadUrl });
      };

      // Current messaging DOM: conversation cards/list items (no thread hrefs â€” SPA)
      document.querySelectorAll(
        'li.msg-conversation-listitem, .msg-conversation-card, [class*="msg-conversations-container__convo-item"]'
      ).forEach((li) => grab(li, null));

      // Fallback for older layouts: walk thread links
      if (seen.size === 0) {
        document.querySelectorAll('a[href*="/messaging/thread/"]').forEach((a) => {
          const li = a.closest('li') || a.closest('[class*="msg-conversation"]') || a;
          grab(li, a);
        });
      }

      return Array.from(seen.values());
    })()`);

    console.log(`[RAG Live Threads] Found ${threads.length} message threads`);
    return { threads, error: threads.length === 0 ? 'Messaging page loaded but no readable threads found.' : null };
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
  const chromeDataDir = join(process.cwd(), '.chrome-data');
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
    const ua = await page.evaluate(() => navigator.userAgent);
    await page.setUserAgent(ua.replace(/HeadlessChrome/g, 'Chrome'));

    console.log('[RAG Reply Scan] Navigating to LinkedIn messaging...');
    await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 4000));

    if (await isAuthwallPage(page)) {
      return { replies: [], threadsTotal: 0, error: 'LinkedIn session not active â€” run the Campaign Launcher once to refresh the login session.' };
    }

    // Step 1: click the "Connections" filter chip (threads with connections

    // Step 1a: click the "Connections" filter chip (threads with connections
    // only â€” much smaller list)
    await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('button, [role="button"], li'));
      const chip = chips.find((el) => el.textContent.trim().toLowerCase() === 'connections');
      if (chip) chip.click();
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3500));

    // Step 1b: deep-scroll in CHUNKS â€” if the execution context is lost
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
        console.warn(`[RAG Reply Scan] Chunk ${chunk} failed (${e.message}) â€” continuing with collected threads`);
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
    // (strict: full-name containment, or first AND last token both equal â€”
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
    // actually switches to the clicked thread â€” avoids stale reads)
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
