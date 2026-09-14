/**
 * Modular Puppeteer Automation Engine for LinkedIn Connections
 * Emits real-time log, progress, and status events to the Web Application backend.
 */

import puppeteer from 'puppeteer-core';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';

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

    // Ensure Chrome user profile dir
    this.chromeDataDir = join(process.cwd(), '.chrome-data');
    if (!existsSync(this.chromeDataDir)) {
      mkdirSync(this.chromeDataDir, { recursive: true });
    }
  }

  normalizeConfig(rawConfig) {
    const defaultRoles = ['Recruiter', 'Talent Acquisition', 'HR', 'Hiring Manager', 'Engineering Manager'];
    const roles = Array.isArray(rawConfig.roles) && rawConfig.roles.length > 0
      ? rawConfig.roles.map(r => r.trim()).filter(Boolean)
      : defaultRoles;

    let basePeopleUrl = '';
    const compInput = (rawConfig.company || 'MongoDB').trim();
    if (compInput.startsWith('http://') || compInput.startsWith('https://')) {
      basePeopleUrl = compInput.endsWith('/') ? compInput : compInput + '/';
      if (!basePeopleUrl.includes('/people/')) {
        basePeopleUrl = basePeopleUrl.replace(/\/$/, '') + '/people/';
      }
    } else {
      const slug = compInput.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const companySlug = slug || 'mongodbinc';
      basePeopleUrl = `https://www.linkedin.com/company/${companySlug}/people/`;
    }

    const connPerFilter = parseInt(rawConfig.connectionsPerFilter, 10) || 10;

    return {
      companyName: compInput,
      basePeopleUrl,
      roles,
      connectionsPerFilter: connPerFilter,
      delayBetweenConnections: rawConfig.delayBetweenConnections || { min: 20000, max: 35000 },
      delayBetweenRoles: rawConfig.delayBetweenRoles || { min: 8000, max: 15000 },
      typingDelay: 25,
      connectionNote: rawConfig.connectionNote ||
        "Hi {name}, I'm a 2027 B.Tech CSE student actively exploring Software Engineering Intern opportunities. I'd love to connect and learn more about hiring opportunities!",
      useAINotes: rawConfig.useAINotes !== false,
      geminiApiKey: rawConfig.geminiApiKey || process.env.GEMINI_API_KEY || '',
      geminiModel: rawConfig.geminiModel || 'gemini-3.6-flash',
      chromePath: rawConfig.chromePath || 'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
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

  async generateAINote(personName, headline = '', role = '') {
    if (!this.config.useAINotes || !this.config.geminiApiKey) return null;

    try {
      const genAI = new GoogleGenerativeAI(this.config.geminiApiKey);
      const model = genAI.getGenerativeModel({ model: this.config.geminiModel });

      const prompt = `Write a LinkedIn connection request note.

Recipient: ${personName}${headline ? ` — ${headline}` : ''} (works at ${this.config.companyName}; found under "${role}" role filter).
Sender: a student exploring internship opportunities.

Requirements:
- Maximum 250 characters, 2-3 short sentences
- VERY POLITE and respectful tone throughout
- If male recipient, add "sir" after first name (e.g., "Hi Ramesh sir"). If female, add "mam" after first name (e.g., "Hi Priya mam"). Never use Mr./Ms.
- Friendly, professional, and genuine — not generic or robotic
- No emojis, no hashtags, no placeholders, no subject lines

Return ONLY the note text, nothing else.`;

      const result = await model.generateContent(prompt);
      const text = result?.response?.text?.().trim();
      if (!text) throw new Error('Empty AI response');

      const note = text
        .replace(/^["'`\s]+|["'`\s]+$/g, '')
        .split('\n')
        .join(' ')
        .substring(0, 290);
      return note;
    } catch (err) {
      this.log(`⚠️ Gemini AI note fallback for ${personName}: ${err.message}`, 'warning');
      return null;
    }
  }

  personalizeNote(name) {
    const cleaned = name.replace(/^(Dr\.|Mr\.|Ms\.|Mrs\.)\s+/i, '').trim();
    const firstName = cleaned.split(' ')[0] || 'there';
    return this.config.connectionNote.replace('{name}', firstName);
  }

  async handleConnectionModal(page, personName, headline = '', role = '') {
    await this.sleep(2000);

    try {
      await page.waitForFunction(() => document.querySelector('div[role="dialog"]'), { timeout: 10000 });
    } catch {
      this.log(`⚠️ Connection modal did not open for ${personName}`, 'warning');
      return false;
    }

    await this.sleep(1000);

    // Verify correct person in dialog
    const nameMatch = await page.evaluate((expectedName) => {
      const modal = document.querySelector('div[role="dialog"]');
      if (!modal) return { found: false };
      const modalText = (modal.textContent || '').toLowerCase();
      const expected = (expectedName || '').toLowerCase().trim();
      const firstWord = expected.split(' ')[0] || '';
      const ok = modalText.includes(expected) || (firstWord.length > 2 && modalText.includes(firstWord));
      return { found: true, ok };
    }, personName);

    if (nameMatch.found && !nameMatch.ok) {
      this.log(`🚫 Modal opened wrong person! Expected "${personName}" — closing...`, 'warning');
      await page.keyboard.press('Escape');
      await this.sleep(1000);
      await page.keyboard.press('Escape');
      return false;
    }

    // Click "Add a note"
    const addNoteClicked = await page.evaluate(() => {
      const modal = document.querySelector('div[role="dialog"]') || document;
      const buttons = Array.from(modal.querySelectorAll('button, div[role="button"], a[role="button"]'));
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim();
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (text === 'Add a note' || aria.includes('add a note')) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (!addNoteClicked) {
      this.log(`⚠️ "Add a note" button missing in modal for ${personName}`, 'warning');
      return false;
    }

    await this.sleep(1500);

    // Focus textarea
    const noteAreaFound = await page.evaluate(() => {
      const modal = document.querySelector('div[role="dialog"]') || document;
      const textarea = modal.querySelector('textarea, #custom-message, [name="message"]');
      if (textarea) {
        textarea.focus();
        textarea.value = '';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      return false;
    });

    if (!noteAreaFound) {
      this.log(`⚠️ Text area missing in modal for ${personName}`, 'warning');
      return false;
    }

    await this.sleep(300);

    let noteText = await this.generateAINote(personName, headline, role);
    if (noteText) {
      this.log(`🤖 AI generated note for ${personName}: "${noteText.substring(0, 50)}..."`, 'info');
    } else {
      noteText = this.personalizeNote(personName);
    }

    await page.keyboard.type(noteText, { delay: this.config.typingDelay });
    await this.sleep(1500);

    // Click Send button
    const sendClicked = await page.evaluate(() => {
      const modal = document.querySelector('div[role="dialog"]') || document;
      const buttons = Array.from(modal.querySelectorAll('button'));
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();

        if (
          text === 'send' ||
          text === 'send invitation' ||
          text === 'send now' ||
          aria.includes('send invitation') ||
          aria.includes('send now')
        ) {
          if (!btn.disabled) {
            btn.click();
            return true;
          }
        }
      }
      return false;
    });

    if (sendClicked) {
      await this.sleep(2000);
      return { success: true, note: noteText };
    }

    this.log(`❌ Send button click failed for ${personName}`, 'error');
    return false;
  }

  async connectViaProfilePage(browser, profileUrl, personName, headline = '', role = '') {
    const profilePage = await browser.newPage();
    try {
      await profilePage.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      this.log(`🔀 Navigating directly to profile page: ${personName}`, 'info');
      await profilePage.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
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

      // Target Connect or 3-dots
      const targetHandle = await profilePage.evaluateHandle(() => {
        const mainSection =
          document.querySelector('main section, .scaffold-layout__main section, .pv-top-card') ||
          document.querySelector('main');
        if (!mainSection) return null;

        const buttons = Array.from(mainSection.querySelectorAll('button, div[role="button"]'));

        const directConnect = buttons.find((b) => {
          const text = (b.textContent || '').trim();
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          return text === 'Connect' || (aria.includes('connect') && !aria.includes('disconnect') && !aria.includes('more'));
        });
        if (directConnect) return { type: 'connect', el: directConnect };

        const actionBtn = buttons.find((b) => {
          const t = (b.textContent || '').trim().toLowerCase();
          return t === 'message' || t.includes('follow');
        });

        if (!actionBtn) return null;

        let container = actionBtn.parentElement;
        while (container && container !== mainSection) {
          const btns = container.querySelectorAll('button, div[role="button"]');
          if (btns.length >= 2) break;
          container = container.parentElement;
        }

        if (!container) return null;

        const containerButtons = Array.from(container.querySelectorAll('button, div[role="button"]'));
        const dotsBtn = containerButtons.find((b) => {
          const txt = (b.textContent || '').trim().toLowerCase();
          return txt !== 'message' && !txt.includes('follow');
        });

        if (dotsBtn) {
          dotsBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          return { type: 'more', el: dotsBtn };
        }
        return null;
      });

      const actionType = await profilePage.evaluate((obj) => (obj ? obj.type : 'none'), targetHandle);
      const nativeBtnHandle = await profilePage.evaluateHandle((obj) => (obj ? obj.el : null), targetHandle);
      const nativeBtn = nativeBtnHandle.asElement();

      if (!nativeBtn || actionType === 'none') {
        this.log(`⚠️ Connect / 3-dots button not found on ${personName}'s profile`, 'warning');
        await profilePage.close();
        return false;
      }

      await nativeBtn.click();
      this.log(`⚡ Clicked ${actionType === 'connect' ? 'Connect button' : '3-dots (More)'} on ${personName}'s profile`, 'info');

      if (actionType === 'more') {
        await this.sleep(1800);
        const urlParts = profileUrl.replace(/\/$/, '').split('/');
        const targetVanityName = urlParts[urlParts.length - 1];

        if (!profilePage.url().includes('custom-invite')) {
          const targetCustomInviteUrl = `https://www.linkedin.com/preload/custom-invite/?vanityName=${targetVanityName}`;
          await profilePage.goto(targetCustomInviteUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await this.sleep(2500);
        }
      }

      const modalResult = await this.handleConnectionModal(profilePage, personName, headline, role);
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

    this.log('📜 Scrolling down to display member cards...', 'info');
    await page.evaluate(async () => {
      window.scrollBy(0, 500);
      await new Promise((r) => setTimeout(r, 1200));
      window.scrollBy(0, 300);
    });
    await this.sleep(3000);
  }

  async process10ConnectionsForFilter(page, roleKeyword, sentProfiles, failedProfiles) {
    let filterSentCount = 0;
    const targetForThisFilter = this.config.connectionsPerFilter;

    this.log(`📋 Role Filter: "${roleKeyword}" — Goal: ${targetForThisFilter} Connection Requests`, 'info');
    this.updateProgress(roleKeyword, filterSentCount);

    const getEmployeesFromDOM = async () => {
      return await page.evaluate(() => {
        const list = [];
        const cards = Array.from(
          document.querySelectorAll(
            '.org-people-profile-card, li.org-people-profiles-module__profile-item, div.artdeco-card, .org-people-card, li'
          )
        );

        cards.forEach((card) => {
          const link = card.querySelector('a[href*="/in/"]');
          if (!link) return;

          const href = link.href.split('?')[0];
          if (!href || href.includes('/in/ACoAA')) return;

          const nameEl =
            card.querySelector('.org-people-profile-card__profile-title') ||
            card.querySelector('.artdeco-entity-lockup__title') ||
            link;
          const rawName = nameEl ? nameEl.textContent.trim().split('\n')[0].trim() : '';

          if (!rawName || rawName.includes('LinkedIn Member') || rawName.length < 2) return;

          const subEl =
            card.querySelector('.org-people-profile-card__profile-description') ||
            card.querySelector('.artdeco-entity-lockup__subtitle') ||
            card.querySelector('.org-people-profile-card__profile-role');
          const headline = subEl ? subEl.textContent.trim().split('\n')[0].trim().substring(0, 120) : '';

          list.push({ name: rawName, url: href, headline });
        });

        const unique = [];
        const seen = new Set();
        for (const emp of list) {
          if (!seen.has(emp.url)) {
            seen.add(emp.url);
            unique.push(emp);
          }
        }
        return unique;
      });
    };

    let processedInThisFilter = new Set();
    let hasMoreCards = true;

    while (filterSentCount < targetForThisFilter && hasMoreCards && !this.shouldStop) {
      let employees = await getEmployeesFromDOM();

      let unvisited = employees.filter(
        (emp) =>
          !sentProfiles.has(emp.name) &&
          !failedProfiles.has(emp.name) &&
          !sentProfiles.has(emp.url) &&
          !failedProfiles.has(emp.url) &&
          !processedInThisFilter.has(emp.url)
      );

      // Pagination check: "Show more results" button
      if (unvisited.length === 0) {
        this.log(`👇 Target not reached (${filterSentCount}/${targetForThisFilter}). Looking for "Show more results" button...`, 'info');

        const showMoreClicked = await page.evaluate(async () => {
          window.scrollBy(0, 1000);
          await new Promise((r) => setTimeout(r, 1200));

          const buttons = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"], span'));
          for (const btn of buttons) {
            const text = (btn.textContent || '').trim().toLowerCase();
            if (text.includes('show more results') || text === 'show more') {
              btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
              btn.click();
              return true;
            }
          }
          return false;
        });

        if (showMoreClicked) {
          this.log('🔄 Clicked "Show more results"! Waiting 4s for new cards to load...', 'info');
          await this.sleep(4000);

          let freshEmployees = await getEmployeesFromDOM();
          let freshUnvisited = freshEmployees.filter(
            (emp) =>
              !sentProfiles.has(emp.name) &&
              !failedProfiles.has(emp.name) &&
              !sentProfiles.has(emp.url) &&
              !failedProfiles.has(emp.url) &&
              !processedInThisFilter.has(emp.url)
          );

          if (freshUnvisited.length === 0) {
            this.log('ℹ️ No new cards loaded after "Show more results". Moving to next filter.', 'info');
            hasMoreCards = false;
            break;
          } else {
            this.log(`👥 Loaded ${freshUnvisited.length} new cards! Resuming requests...`, 'info');
            unvisited = freshUnvisited;
          }
        } else {
          this.log('ℹ️ "Show more results" button not found (end of list).', 'info');
          hasMoreCards = false;
          break;
        }
      }

      for (const emp of unvisited) {
        if (filterSentCount >= targetForThisFilter || this.shouldStop) break;

        processedInThisFilter.add(emp.url);
        processedInThisFilter.add(emp.name);

        const name = emp.name;
        if (sentProfiles.has(name) || failedProfiles.has(name) || sentProfiles.has(emp.url)) {
          continue;
        }

        this.log(`👤 Target (${filterSentCount + 1}/${targetForThisFilter}): ${name} (${emp.headline || 'Member'})`, 'info');

        let connectedResult = false;
        let clickResult = { status: 'no_card' };

        try {
          clickResult = await page.evaluate((targetUrl) => {
            const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
            let targetCard = null;

            for (const l of links) {
              if (l.href.includes(targetUrl)) {
                let parent = l.parentElement;
                while (parent && parent.tagName !== 'BODY') {
                  if (parent.querySelector('button')) {
                    targetCard = parent;
                    break;
                  }
                  parent = parent.parentElement;
                }
                if (targetCard) break;
              }
            }

            if (!targetCard) return { status: 'no_card' };

            targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const buttons = Array.from(targetCard.querySelectorAll('button, div[role="button"]'));

            for (const btn of buttons) {
              const text = (btn.textContent || '').trim().toLowerCase();
              const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
              if (text === 'pending' || text === 'invitation sent' || aria.includes('pending') || aria.includes('withdraw')) {
                return { status: 'pending' };
              }
            }

            for (const btn of buttons) {
              const text = (btn.textContent || '').trim();
              const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
              if (text === 'Connect' || (aria.includes('invite') && aria.includes('connect'))) {
                btn.click();
                return { status: 'clicked_connect' };
              }
            }

            for (const btn of buttons) {
              const text = (btn.textContent || '').trim().toLowerCase();
              const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
              if (text === 'more' || aria.includes('more actions') || aria.includes('overflow')) {
                btn.click();
                return { status: 'clicked_more' };
              }
            }

            return { status: 'no_button' };
          }, emp.url);

          if (clickResult.status === 'clicked_connect') {
            this.log(`⚡ Clicked Connect directly on card for ${name}`, 'info');
            connectedResult = await this.handleConnectionModal(page, name, emp.headline, roleKeyword);
          } else if (clickResult.status === 'clicked_more') {
            await this.sleep(1800);
            const dropdownClicked = await page.evaluate(() => {
              const menus = Array.from(
                document.querySelectorAll(
                  '.artdeco-dropdown__content.artdeco-dropdown__content--is-open, [role="menu"], .artdeco-dropdown__content--is-open'
                )
              );
              const scopes = menus.length ? menus : Array.from(document.querySelectorAll('.artdeco-dropdown__content, [role="menu"]'));
              for (const scope of scopes) {
                const items = Array.from(scope.querySelectorAll('div[role="button"], button, li, span'));
                for (const item of items) {
                  const text = (item.textContent || '').trim();
                  if (/^connect$/i.test(text)) {
                    item.click();
                    return true;
                  }
                }
              }
              return false;
            });

            if (dropdownClicked) {
              connectedResult = await this.handleConnectionModal(page, name, emp.headline, roleKeyword);
            } else {
              await page.keyboard.press('Escape');
            }
          }
        } catch (err) {
          connectedResult = false;
        }

        if (!connectedResult && clickResult.status !== 'pending') {
          connectedResult = await this.connectViaProfilePage(page.browser(), emp.url, name, emp.headline, roleKeyword);
        }

        if (connectedResult && connectedResult.success) {
          filterSentCount++;
          this.stats.sent++;
          sentProfiles.add(name);
          sentProfiles.add(emp.url);

          const sentRecord = {
            name,
            url: emp.url,
            headline: emp.headline,
            role: roleKeyword,
            note: connectedResult.note || '',
            timestamp: new Date().toLocaleTimeString('en-IN', { hour12: true }),
          };

          this.sentList.push(sentRecord);
          this.emit('sent', sentRecord);
          this.log(`✅ [${roleKeyword}] (${filterSentCount}/${targetForThisFilter}) Note sent to ${name}!`, 'success');
          this.updateProgress(roleKeyword, filterSentCount);
        } else if (clickResult.status === 'pending' || (connectedResult && connectedResult.pending)) {
          this.stats.skipped++;
          this.log(`⏸️ ${name} — "Pending" invitation already active. Skipped.`, 'skip');
          failedProfiles.add(name);
          failedProfiles.add(emp.url);
          this.updateProgress(roleKeyword, filterSentCount);
          continue;
        } else {
          this.stats.failed++;
          this.log(`⏭️ Skipped ${name} (already connected or unavailable)`, 'warning');
          failedProfiles.add(name);
          failedProfiles.add(emp.url);
          this.updateProgress(roleKeyword, filterSentCount);
        }

        if (filterSentCount < targetForThisFilter && !this.shouldStop) {
          await this.waitRandom(
            this.config.delayBetweenConnections.min,
            this.config.delayBetweenConnections.max,
            `Next connection delay for ${roleKeyword}`
          );
        }
      }
    }

    this.log(`🎉 Filter "${roleKeyword}" finished: ${filterSentCount}/${targetForThisFilter} connection notes sent!`, 'success');
    return filterSentCount;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.shouldStop = false;
    this.emit('status_change', { status: 'running' });
    this.log(`🚀 Launching Chrome Browser for ${this.config.companyName}...`, 'info');

    try {
      this.browser = await puppeteer.launch({
        headless: false,
        executablePath: this.config.chromePath,
        userDataDir: this.chromeDataDir,
        defaultViewport: null,
        args: [
          '--start-maximized',
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
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

    const sentProfiles = new Set();
    const failedProfiles = new Set();

    for (let roleIndex = 0; roleIndex < this.config.roles.length; roleIndex++) {
      if (this.shouldStop) break;

      const role = this.config.roles[roleIndex];
      this.log(`\n📌 FILTER [${roleIndex + 1}/${this.config.roles.length}]: "${role}"`, 'info');

      await this.navigateToRoleFilterPage(this.page, role);
      await this.process10ConnectionsForFilter(this.page, role, sentProfiles, failedProfiles);

      if (roleIndex < this.config.roles.length - 1 && !this.shouldStop) {
        await this.waitRandom(
          this.config.delayBetweenRoles.min,
          this.config.delayBetweenRoles.max,
          `Moving to next filter role`
        );
      }
    }

    this.log(`🎉 AUTOMATION COMPLETED! Total Connection Notes Sent: ${this.stats.sent}`, 'success');
    this.isRunning = false;
    this.emit('status_change', { status: 'completed' });
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
