/**
 * Targeted LinkedIn Connection Automation - Direct URL Parameter Strategy
 * Target Company: MongoDB Official People Tab
 *
 * User Strategy:
 * Uses direct URL query parameter filtering:
 * https://www.linkedin.com/company/mongodbinc/people/?keywords={role}
 *
 * Workflow:
 * 1. User logs in manually in open Chrome window (cookies saved in .chrome-data).
 * 2. Script navigates role-by-role using ?keywords={role} URL parameter.
 * 3. Sends exactly 10 connection requests WITH PERSONALIZED NOTE per role filter.
 * 4. Repeats for all 5 roles (Recruiter, Talent Acquisition, HR, Hiring Manager, Engineering Manager).
 */

import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Persistent Chrome Profile Directory
const chromeDataDir = join(process.cwd(), '.chrome-data');
if (!existsSync(chromeDataDir)) {
  mkdirSync(chromeDataDir, { recursive: true });
}

// ============================================
// 🔧 CONFIGURATION
// ============================================
const CONFIG = {
  companyName: 'MongoDB',
  basePeopleUrl: 'https://www.linkedin.com/company/mongodbinc/people/',

  connectionNote:
    "Hi {name}, I'm a 2027 B.Tech CSE student actively exploring Software Engineering Intern " +
    'opportunities at MongoDB. I came across the 2027 internship openings and would love to ' +
    'connect and learn more about the opportunities and hiring process. Thanks!',

  connectionsPerFilter: 10,

  roles: [
    'Recruiter',
    'Talent Acquisition',
    'HR',
    'Hiring Manager',
    'Engineering Manager',
  ],

  // Anti-Detection Delays (ms)
  delayBetweenConnections: { min: 20000, max: 35000 },
  delayBetweenRoles: { min: 8000, max: 15000 },
  typingDelay: 25,
};

// ============================================
// 🛠️ HELPERS
// ============================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function waitRandom(min, max, label = '') {
  const ms = randomDelay(min, max);
  if (label) console.log(`   ⏳ ${label} — ${(ms / 1000).toFixed(0)}s wait...`);
  await sleep(ms);
}

function getFirstName(fullName) {
  const cleaned = fullName.replace(/^(Dr\.|Mr\.|Ms\.|Mrs\.)\s+/i, '').trim();
  return cleaned.split(' ')[0] || 'there';
}

function personalizeNote(name) {
  return CONFIG.connectionNote.replace('{name}', getFirstName(name));
}

function ts() {
  return new Date().toLocaleTimeString('en-IN', { hour12: true });
}

/**
 * Handle Connection Modal: Click Add a note -> Type personalized text -> Click Send
 */
async function handleConnectionModal(page, personName) {
  await sleep(2500);

  // 1. Click "Add a note" button inside modal
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
    console.log('      ⚠️  "Add a note" button not found in modal');
    return false;
  }

  await sleep(1500);

  // 2. Focus & clear text area
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
    console.log('      ⚠️  Note text area not found');
    return false;
  }

  await sleep(300);

  // Type note
  const noteText = personalizeNote(personName);
  await page.keyboard.type(noteText, { delay: CONFIG.typingDelay });
  console.log(`      ✍️  Typed note for ${getFirstName(personName)}: "${noteText.substring(0, 50)}..."`);
  await sleep(1500);

  // 3. Click Send button
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
    await sleep(2000);
    return true;
  }

  console.log('      ❌ Send button click failed or disabled');
  return false;
}

/**
 * Navigate to MongoDB People tab with ?keywords={role} parameter
 */
async function navigateToRoleFilterPage(page, roleKeyword) {
  const filterUrl = `${CONFIG.basePeopleUrl}?keywords=${encodeURIComponent(roleKeyword)}`;
  console.log(`\n🔎 Navigating to Filter URL for "${roleKeyword}"...`);
  console.log(`   URL: ${filterUrl}`);

  await page.goto(filterUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);

  // Check if session redirected to login page
  if (page.url().includes('/login') || page.url().includes('/authwall')) {
    console.log('⚠️ Session redirected to login page. Waiting for user login in browser...');
    await page.waitForFunction(
      () => !window.location.href.includes('/login') && !window.location.href.includes('/authwall'),
      { timeout: 180000 }
    );
    await page.goto(filterUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
  }

  console.log('📜 Scrolling down to display filtered member cards...');
  await page.evaluate(async () => {
    window.scrollBy(0, 500);
    await new Promise((r) => setTimeout(r, 1200));
    window.scrollBy(0, 300);
  });
  await sleep(3000);
}

/**
 * Send 10 Connection Requests with notes for the current active filter
 */
async function process10ConnectionsForFilter(page, roleKeyword, sentProfiles, failedProfiles, overallSentRef) {
  let filterSentCount = 0;
  const targetForThisFilter = CONFIG.connectionsPerFilter; // 10

  console.log(`📋 Goal for "${roleKeyword}": Send ${targetForThisFilter} connection notes.`);

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

        list.push({ name: rawName, url: href });
      });

      // Deduplicate
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

  let employees = await getEmployeesFromDOM();
  console.log(`   👥 Found ${employees.length} MongoDB cards visible for filter "${roleKeyword}".`);

  for (const emp of employees) {
    if (filterSentCount >= targetForThisFilter) break;

    const name = emp.name;
    if (sentProfiles.has(name) || failedProfiles.has(name) || sentProfiles.has(emp.url)) {
      continue;
    }

    console.log(`\n   👤 [${roleKeyword}] (${filterSentCount + 1}/${targetForThisFilter}) Target: ${name}`);
    console.log(`      🕐 ${ts()}`);

    let connected = false;

    // Try direct Connect on card
    try {
      const clickResult = await page.evaluate((targetUrl) => {
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
        console.log('      ⚡ Clicked Connect directly on MongoDB card!');
        connected = await handleConnectionModal(page, name);
      } else if (clickResult.status === 'clicked_more') {
        await sleep(1500);
        const dropdownClicked = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('div[role="button"], button, li, span'));
          for (const item of items) {
            const text = (item.textContent || '').trim();
            const aria = (item.getAttribute('aria-label') || '').toLowerCase();
            if (text === 'Connect' || (aria.includes('invite') && aria.includes('connect'))) {
              item.click();
              return true;
            }
          }
          return false;
        });

        if (dropdownClicked) {
          connected = await handleConnectionModal(page, name);
        } else {
          await page.keyboard.press('Escape');
        }
      }
    } catch {
      connected = false;
    }

    if (connected) {
      filterSentCount++;
      overallSentRef.count++;
      sentProfiles.add(name);
      sentProfiles.add(emp.url);
      console.log(`      ✅ [Filter: ${roleKeyword}] (${filterSentCount}/${targetForThisFilter}) SENT NOTE TO ${name}!`);
    } else {
      console.log(`      ⏭️  Skipped ${name} (already connected, pending, or unavailable)`);
      failedProfiles.add(name);
      failedProfiles.add(emp.url);
    }

    // Rate Limiting Delay
    if (filterSentCount < targetForThisFilter) {
      await waitRandom(
        CONFIG.delayBetweenConnections.min,
        CONFIG.delayBetweenConnections.max,
        `Next connection delay for ${roleKeyword}`
      );
    }
  }

  console.log(`\n🎉 Filter "${roleKeyword}" finished: ${filterSentCount}/${targetForThisFilter} connection notes sent!`);
  return filterSentCount;
}

// ============================================
// 🚀 MAIN EXECUTION
// ============================================
async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║  🤖 Direct URL Parameter LinkedIn Connection Bot  ║');
  console.log('║  Company: MongoDB (Official People Tab)           ║');
  console.log('║  Strategy: ?keywords={role} URL Parameter        ║');
  console.log('║  Target per Filter: 10 connections with notes     ║');
  console.log('║  Total Roles: ' + String(CONFIG.roles.length + ' filters').padEnd(36) + '║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');

  console.log('🚀 Step 1: Launching Chrome Browser...');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      executablePath: 'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      userDataDir: chromeDataDir,
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
    console.error(`❌ Browser launch failed: ${err.message}`);
    process.exit(1);
  }

  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  console.log('🔐 Step 2: Checking LinkedIn Login status...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);

  const currentUrl = page.url();
  if (currentUrl.includes('/login') || currentUrl.includes('/authwall') || currentUrl.includes('/checkpoint')) {
    console.log('');
    console.log('  ┌────────────────────────────────────────────────────────┐');
    console.log('  │ 👆 Please LOGIN to LinkedIn in the browser window!    │');
    console.log('  │  Script will automatically resume once you log in.     │');
    console.log('  └────────────────────────────────────────────────────────┘');
    console.log('');

    await page.waitForFunction(
      () =>
        !window.location.href.includes('/login') &&
        !window.location.href.includes('/authwall') &&
        !window.location.href.includes('/checkpoint'),
      { timeout: 300000 }
    );
  }

  console.log('✅ LinkedIn Logged In Successfully!');
  await waitRandom(3000, 5000, 'Feed settle');

  const overallSentRef = { count: 0 };
  const sentProfiles = new Set();
  const failedProfiles = new Set();

  // Step 3: Loop through each filter role using ?keywords={role} URL strategy!
  for (let roleIndex = 0; roleIndex < CONFIG.roles.length; roleIndex++) {
    const role = CONFIG.roles[roleIndex];
    console.log('\n' + '═'.repeat(65));
    console.log(`📌 FILTER [${roleIndex + 1}/${CONFIG.roles.length}]: "${role}" (Target: 10 Connections With Notes)`);
    console.log('═'.repeat(65));

    // Direct URL parameter navigation!
    await navigateToRoleFilterPage(page, role);

    // Send exactly 10 connection requests for this filter
    await process10ConnectionsForFilter(page, role, sentProfiles, failedProfiles, overallSentRef);

    if (roleIndex < CONFIG.roles.length - 1) {
      await waitRandom(
        CONFIG.delayBetweenRoles.min,
        CONFIG.delayBetweenRoles.max,
        `Clearing filter "${role}" -> Moving to next filter URL`
      );
    }
  }

  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║  🎉 AUTOMATION COMPLETE!                          ║');
  console.log('║  Total Connection Requests Sent: ' + String(overallSentRef.count).padEnd(16) + '║');
  console.log('╚═══════════════════════════════════════════════════╝');

  if (sentProfiles.size > 0) {
    console.log('\n📋 Connection Requests Sent To (MongoDB Employees):');
    let idx = 1;
    for (const name of sentProfiles) {
      if (!name.startsWith('http')) {
        console.log(`   ${idx}. ${name}`);
        idx++;
      }
    }
  }

  console.log('\n🖥️  Browser will stay open. Close manually when ready.');
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('💥 Fatal Script Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
