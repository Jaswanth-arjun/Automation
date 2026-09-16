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
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--no-default-browser-check',
            '--remote-allow-origins=*',
          ],
          ignoreDefaultArgs: ['--enable-automation'],
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

      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      // Verify Login Session
      this.log('🔐 Checking active LinkedIn login session for tracking...', 'info');
      await this.page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.sleep(3000);

      const url = this.page.url();
      if (url.includes('/login') || url.includes('/authwall') || url.includes('/checkpoint')) {
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
      this.log('📬 Step 1/3: Checking Pending Invitations list...', 'info');
      await this.page.goto('https://www.linkedin.com/mynetwork/invites-sent/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.sleep(4000);

      // Scroll to load all sent invitation cards
      await this.page.evaluate(async () => {
        for (let i = 0; i < 4; i++) {
          window.scrollBy(0, 1000);
          await new Promise((r) => setTimeout(r, 1000));
        }
      });
      await this.sleep(2000);

      const pendingCards = await this.page.evaluate(() => {
        const list = [];
        const selectors = [
          '.invitation-card',
          '.mn-invitation-card',
          'li.invitation-card',
          'div.artdeco-card',
          '.mn-invitation-card__title',
        ];

        const cards = Array.from(document.querySelectorAll(selectors.join(',')));
        cards.forEach((card) => {
          const link = card.querySelector('a[href*="/in/"]');
          const nameEl = card.querySelector('.invitation-card__title, .artdeco-entity-lockup__title, .mn-invitation-card__title');
          if (link || nameEl) {
            list.push({
              url: link ? link.href.split('?')[0].replace(/\/$/, '').toLowerCase() : '',
              name: nameEl ? nameEl.textContent.trim().toLowerCase() : '',
            });
          }
        });
        return list;
      });

      this.log(`📋 Found ${pendingCards.length} active pending invitation cards on LinkedIn.`, 'info');

      // Step 2: Check Connections Page (Accepted 1st-degree list)
      this.log('🤝 Step 2/3: Checking 1st-Degree Accepted Connections list...', 'info');
      await this.page.goto('https://www.linkedin.com/mynetwork/invite-connect/connections/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.sleep(4000);

      // Scroll down to load recent 1st degree connections
      await this.page.evaluate(async () => {
        for (let i = 0; i < 5; i++) {
          window.scrollBy(0, 1000);
          await new Promise((r) => setTimeout(r, 1000));
        }
      });
      await this.sleep(2000);

      const acceptedList = await this.page.evaluate(() => {
        const list = [];
        const items = Array.from(document.querySelectorAll('.mn-connection-card, li.mn-connection-card, a.mn-connection-card__link'));
        items.forEach((item) => {
          const link = item.querySelector('a[href*="/in/"]') || (item.tagName === 'A' ? item : null);
          const nameEl = item.querySelector('.mn-connection-card__name, .mn-connection-card__details span');
          if (link || nameEl) {
            list.push({
              url: link ? link.href.split('?')[0].replace(/\/$/, '').toLowerCase() : '',
              name: nameEl ? nameEl.textContent.trim().toLowerCase() : '',
            });
          }
        });
        return list;
      });

      this.log(`✅ Loaded ${acceptedList.length} 1st-degree connections from LinkedIn.`, 'info');

      // Step 3: Check LinkedIn Messaging for Read Receipts (Seen) and Replies
      this.log('💬 Step 3/3: Checking LinkedIn Inbox for Read Receipts (Seen) & Replies...', 'info');
      await this.page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.sleep(4000);

      const chatThreads = await this.page.evaluate(() => {
        const threads = [];
        const items = Array.from(document.querySelectorAll('.msg-conversation-listitem, .msg-conversation-card'));
        items.forEach((item, index) => {
          const nameEl = item.querySelector('.msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names');
          const snippetEl = item.querySelector('.msg-conversation-card__message-snippet-body, .msg-overlay-list-bubble__message-snippet');
          const isUnread = item.classList.contains('msg-conversation-listitem--unread');
          if (nameEl) {
            threads.push({
              index,
              name: nameEl.textContent.trim().toLowerCase(),
              snippet: snippetEl ? snippetEl.textContent.trim() : '',
              isUnread,
            });
          }
        });
        return threads;
      });

      // Strict & Accurate Status Evaluation per Database Record
      let updatedCount = 0;
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
          // Deep thread inspection to check if participant actually sent a reply message
          let threadReply = null;
          try {
            threadReply = await this.page.evaluate(async (idx) => {
              const items = Array.from(document.querySelectorAll('.msg-conversation-listitem, .msg-conversation-card'));
              if (!items[idx]) return null;
              items[idx].click();
              await new Promise((r) => setTimeout(r, 1200));

              const messages = Array.from(document.querySelectorAll('.msg-s-message-list-content .msg-s-message-group, .msg-s-message-list-content .msg-s-event-listitem'));
              let reply = null;

              messages.forEach((msg) => {
                const authorEl = msg.querySelector('.msg-s-message-group__name, .msg-s-message-group__profile-link, .msg-s-event-listitem__author-name');
                const authorName = authorEl ? authorEl.textContent.trim().toLowerCase() : '';
                const bodyEl = msg.querySelector('.msg-s-event-listitem__body, .msg-s-message-group__message-body');
                const text = bodyEl ? bodyEl.textContent.trim() : '';

                // Check if message author is NOT the user (not Nelluru Jaswanth)
                if (authorName && !authorName.includes('jaswanth') && !authorName.includes('nelluru')) {
                  if (text) reply = text;
                }
              });

              return reply;
            }, chatThread.index);
          } catch (e) {
            // Ignore click error
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
      this.log(`⚠️ Status Sync Error: ${err.message}`, 'warning');
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

export async function searchLiveConnections(keyword) {
  const chromePath = getSystemChromePath();
  const chromeDataDir = join(process.cwd(), '.chrome-data');
  if (!chromePath || !existsSync(chromePath)) return [];

  let browser = null;
  try {
    browser = await puppeteer.launch({
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

    const page = await browser.newPage();
    const searchUrl = `https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D&keywords=${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await new Promise((r) => setTimeout(r, 4000));

    await page.evaluate(async () => {
      window.scrollBy(0, 800);
      await new Promise((r) => setTimeout(r, 800));
    });

    const results = await page.evaluate(() => {
      const list = [];
      const items = Array.from(document.querySelectorAll('.reusable-search__result-container, li.reusable-search__result-container, div.entity-result'));
      items.forEach((item) => {
        const titleEl = item.querySelector('.entity-result__title-text a, a[href*="/in/"]');
        const headlineEl = item.querySelector('.entity-result__primary-subtitle');
        const secondaryEl = item.querySelector('.entity-result__secondary-subtitle');
        if (titleEl) {
          const rawName = titleEl.textContent.replace(/View\s+.*'s\s+profile/i, '').trim();
          const name = rawName.split('\n')[0].trim();
          const url = titleEl.href.split('?')[0];
          if (name && !name.includes('LinkedIn Member')) {
            list.push({
              name,
              url,
              headline: headlineEl ? headlineEl.textContent.trim() : '',
              location: secondaryEl ? secondaryEl.textContent.trim() : '',
            });
          }
        }
      });
      return list;
    });

    await page.close();
    await browser.close();
    return results;
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    return [];
  }
}
