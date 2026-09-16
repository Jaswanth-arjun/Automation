/**
 * Modular Puppeteer Automation Engine for LinkedIn Connections
 * Emits real-time log, progress, and status events to the Web Application backend.
 */

import puppeteer from 'puppeteer-core';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { existsSync, mkdirSync } from 'fs';
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
    const cleanCompany = extractCompanyName(compInput);
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
      companyName: cleanCompany,
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
      geminiModel: rawConfig.geminiModel || 'gemini-1.5-flash',
      chromePath: rawConfig.chromePath || 'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: rawConfig.headless === true,
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
      const honorific = this.detectHonorific(personName, headline);
      const genderInstruction = honorific === 'mam'
        ? 'The recipient is female. Address them as "Hi <FirstName> mam".'
        : 'The recipient is male. Address them as "Hi <FirstName> sir".';

      const genAI = new GoogleGenerativeAI(this.config.geminiApiKey);
      const model = genAI.getGenerativeModel({ model: this.config.geminiModel });

      const prompt = `Write a LinkedIn connection request note.

Recipient: ${personName}${headline ? ` — ${headline}` : ''} (works at ${this.config.companyName}; found under "${role}" role filter).
Sender: a student exploring internship opportunities.
Gender Guidance: ${genderInstruction}

Requirements:
- Maximum 250 characters, 2-3 short sentences
- VERY POLITE and respectful tone throughout
- Follow gender guidance strictly: if male, use "sir" after first name; if female, use "mam" after first name. Never use Mr./Ms.
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
      if (err.message.includes('Quota exceeded') || err.message.includes('429')) {
        this.log(`ℹ️ Gemini API Free Tier Limit hit. Seamlessly using your Personalized Note Template for ${personName}...`, 'info');
      } else {
        this.log(`⚠️ Gemini AI note fallback for ${personName}: ${err.message}`, 'warning');
      }
      return null;
    }
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

  personalizeNote(name, headline = '') {
    const cleaned = name.replace(/^(Dr\.|Mr\.|Ms\.|Mrs\.)\s+/i, '').trim();
    const rawFirstName = cleaned.split(' ')[0] || 'there';
    const firstName = rawFirstName.charAt(0).toUpperCase() + rawFirstName.slice(1).toLowerCase();
    const honorific = this.detectHonorific(cleaned, headline);
    const fullNameWithHonorific = `${firstName} ${honorific}`;

    let note = this.config.connectionNote;
    if (note.includes('{name}')) {
      note = note.replace(/\{name\}/g, fullNameWithHonorific);
    }
    if (note.includes('{honorific}')) {
      note = note.replace(/\{honorific\}/g, honorific);
    }
    return note;
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
      noteText = this.personalizeNote(personName, headline);
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
      for (let i = 0; i < 4; i++) {
        window.scrollBy(0, 800);
        await new Promise((r) => setTimeout(r, 800));
      }
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

      // Pagination check: progressive scrolling & "Show more results" button
      if (unvisited.length === 0) {
        this.log(`👇 Goal not reached yet (${filterSentCount}/${targetForThisFilter}). Scrolling & searching for more member cards...`, 'info');

        let loadedNewCards = false;

        for (let attempt = 1; attempt <= 4; attempt++) {
          if (this.shouldStop) break;

          const scrollResult = await page.evaluate(async () => {
            window.scrollBy(0, 1200);
            await new Promise((r) => setTimeout(r, 1000));
            window.scrollBy(0, 1200);
            await new Promise((r) => setTimeout(r, 1000));

            const buttons = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"], span'));
            for (const btn of buttons) {
              const text = (btn.textContent || '').trim().toLowerCase();
              if (text.includes('show more results') || text === 'show more' || text.includes('see more')) {
                btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                btn.click();
                return true;
              }
            }
            return false;
          });

          if (scrollResult) {
            this.log(`🔄 Clicked "Show more results" button! (Attempt ${attempt})`, 'info');
          } else {
            this.log(`📜 Scrolled down page to trigger infinite card loading... (Attempt ${attempt})`, 'info');
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
            this.log(`👥 Loaded ${freshUnvisited.length} new member cards! Resuming connection requests...`, 'info');
            unvisited = freshUnvisited;
            loadedNewCards = true;
            break;
          }
        }

        if (!loadedNewCards) {
          this.log(`ℹ️ End of available profiles for filter "${roleKeyword}". (${filterSentCount}/${targetForThisFilter} sent)`, 'warning');
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
            company: this.config.companyName,
            url: emp.url,
            headline: emp.headline,
            role: roleKeyword,
            note: connectedResult.note || '',
            status: 'pending',
            timestamp: new Date().toLocaleTimeString('en-IN', { hour12: true }),
            sentDate: new Date().toISOString(),
          };

          db.saveConnection(sentRecord);
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

    const sentProfiles = new Set();
    const failedProfiles = new Set();

    // Pre-populate sentProfiles from database to prevent duplicate connection requests
    const pastRecords = db.getAllConnections();
    pastRecords.forEach((r) => {
      if (r.name) sentProfiles.add(r.name.trim());
      if (r.profileUrl) {
        const cleanUrl = r.profileUrl.split('?')[0].replace(/\/$/, '').toLowerCase();
        sentProfiles.add(cleanUrl);
      }
      if (r.url) {
        const cleanUrl = r.url.split('?')[0].replace(/\/$/, '').toLowerCase();
        sentProfiles.add(cleanUrl);
      }
    });

    if (pastRecords.length > 0) {
      this.log(`📚 Pre-loaded ${pastRecords.length} past connection records from database. Already messaged profiles will be automatically skipped!`, 'info');
    }

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
