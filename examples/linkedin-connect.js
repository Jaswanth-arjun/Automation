/**
 * Targeted LinkedIn Connection Automation - Direct URL Parameter Strategy
 * Target Company: MongoDB Official People Tab
 *
 * Features:
 * 1. Uses direct URL query parameter filtering:
 *    https://www.linkedin.com/company/mongodbinc/people/?keywords={role}
 * 2. User logs in manually in open Chrome window (cookies saved in .chrome-data).
 * 3. Navigates role-by-role using ?keywords={role} URL parameter.
 * 4. Sends exactly 10 connection requests WITH PERSONALIZED NOTE per role filter.
 * 5. Roles covered: Recruiter, Talent Acquisition, HR, Hiring Manager, Engineering Manager.
 */

import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Persistent Chrome Profile Directory to save login session
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

  // Exactly 10 connection requests per role filter
  connectionsPerFilter: 10,

  roles: [
    'Recruiter',
    'Talent Acquisition',
    'HR',
    'Hiring Manager',
    'Engineering Manager',
  ],

  // Anti-Detection Rate Limiting Delays (ms)
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
 * Safety: modal lo person name verify chestundi — verey person modal vachtey abort.
 */
async function handleConnectionModal(page, personName) {
  await sleep(2000);

  // 0. Modal open ayyinda? 10s varaku wait chey (late load)
  try {
    await page.waitForFunction(() => document.querySelector('div[role="dialog"]'), {
      timeout: 10000,
    });
  } catch {
    console.log('      ⚠️  Connection modal open avvaledu (10s wait)');
    return false;
  }

  await sleep(1000);

  // 0.5 WRONG PERSON CHECK — modal lo target person name undali.
  // Lekapothey (sidebar lo inko person ki tappu ga click ayyi untey) abort + close.
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
    console.log(`      🚫 WRONG PERSON MODAL! Expected "${personName}" — aborting & closing...`);
    await page.keyboard.press('Escape');
    await sleep(1000);
    await page.keyboard.press('Escape');
    await sleep(800);
    return false;
  }

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
 * Fallback: Card lo "Follow"/"Message" matramey unnapudu,
 * profile page open chesi -> 3-dots (More) -> Connect -> note -> send
 * Tarvata people list ki return avthundi (new tab close = back).
 */
async function connectViaProfilePage(browser, profileUrl, personName) {
  const profilePage = await browser.newPage();
  try {
    await profilePage.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    console.log('      🔀 No Connect on card (Follow/Message only). Opening profile page...');
    await profilePage.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4500);

    // Login/authwall check
    if (profilePage.url().includes('/login') || profilePage.url().includes('/authwall')) {
      console.log('      ⚠️  Profile page redirected to login/authwall');
      await profilePage.close();
      return false;
    }

    // 1. Target ONLY the 3-dots (⋯) button in the main profile header card (Image 2)
    //    using native Puppeteer ElementHandle click for 100% reliable dropdown opening!
    const targetHandle = await profilePage.evaluateHandle(() => {
      const mainSection =
        document.querySelector('main section, .scaffold-layout__main section, .pv-top-card') ||
        document.querySelector('main');
      if (!mainSection) return null;

      const buttons = Array.from(mainSection.querySelectorAll('button, div[role="button"]'));

      // Check direct Connect first
      const directConnect = buttons.find((b) => {
        const text = (b.textContent || '').trim();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        return (
          text === 'Connect' ||
          (aria.includes('connect') && !aria.includes('disconnect') && !aria.includes('more'))
        );
      });
      if (directConnect) return { type: 'connect', el: directConnect };

      // Find Message or Follow button on top card to pinpoint exact sibling 3-dots button (Red Circle)
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
    const nativeBtnHandle = await profilePage.evaluateHandle(
      (obj) => (obj ? obj.el : null),
      targetHandle
    );
    const nativeBtn = nativeBtnHandle.asElement();

    if (!nativeBtn || actionType === 'none') {
      console.log('      ⚠️  Connect / 3-dots button not found on profile top card');
      await profilePage.close();
      return false;
    }

    // Native Puppeteer Mouse Click!
    await nativeBtn.click();
    console.log(
      `      ⚡ Profile top card lo ${
        actionType === 'connect' ? 'Connect button' : '3-dots (More)'
      } clicked natively!`
    );

    // 2. Dropdown menu lo Red-Circled "+ Connect" option click natively!
    if (actionType === 'more') {
      await sleep(1800);
      const connectHandle = await profilePage.evaluateHandle(() => {
        const menus = Array.from(
          document.querySelectorAll(
            '.artdeco-dropdown__content--is-open, .artdeco-dropdown__content[aria-hidden="false"], [role="menu"]'
          )
        );
        const scope = menus[0] || document;
        const items = Array.from(
          scope.querySelectorAll(
            'div[role="button"], button, li, div.artdeco-dropdown__item, span'
          )
        );
        for (const item of items) {
          const text = (item.textContent || '').trim();
          const aria = (item.getAttribute('aria-label') || '').toLowerCase();
          if (
            text === 'Connect' ||
            text.includes('Connect') ||
            aria.includes('connect') ||
            item.querySelector('svg[data-test-icon="connect-small"]')
          ) {
            if (!text.includes('Remove') && !text.includes('Disconnect')) {
              item.scrollIntoView({ behavior: 'instant', block: 'center' });
              return item;
            }
          }
        }
        return null;
      });

      const connectNativeBtn = connectHandle.asElement();
      if (connectNativeBtn) {
        await connectNativeBtn.click();
        console.log('      ⚡ Open ayyina Dropdown lo Red-Circled "+ Connect" item clicked natively!');
      } else {
        console.log('      ⚠️ Dropdown lo Red-Circled "+ Connect" option dorakaledu');
        await profilePage.keyboard.press('Escape');
        await profilePage.close();
        return false;
      }
    }

    // 3. Connection modal -> note -> send (same process)
    const sent = await handleConnectionModal(profilePage, personName);

    // 4. Modal/processing complete ayyaka tab close chesi people list ki return
    await sleep(1000);
    await profilePage.close();
    console.log('      ↩️  Returned to People list (profile tab closed)');
    return sent;
  } catch (err) {
    console.log(`      ⚠️  Profile page flow failed: ${err.message}`);
    try {
      await profilePage.close();
    } catch {
      /* ignore */
    }
    return false;
  }
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
    let clickResult = { status: 'no_card' };

    // Try direct Connect on card
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

        // "Pending" button untey -> request already sent, skip (profile open cheyakkarledu)
        for (const btn of buttons) {
          const text = (btn.textContent || '').trim().toLowerCase();
          if (text === 'pending') {
            return { status: 'pending' };
          }
        }

        return { status: 'no_button' };
      }, emp.url);

      if (clickResult.status === 'clicked_connect') {
        console.log('      ⚡ Clicked Connect directly on MongoDB card!');
        connected = await handleConnectionModal(page, name);
      } else if (clickResult.status === 'clicked_more') {
        await sleep(1800);
        const dropdownClicked = await page.evaluate(() => {
          // Open ayyina dropdown menus lo matramey vetakali
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
          connected = await handleConnectionModal(page, name);
        } else {
          await page.keyboard.press('Escape');
        }
      }
    } catch {
      connected = false;
    }

    // Fallback: card lo "Follow"/"Message" matramey untey -> profile open chesi
    // 3-dots (More) -> Connect -> note -> send, then back to list.
    // "Pending" untey skip — profile open cheyakkarledu.
    if (!connected && clickResult.status !== 'pending') {
      connected = await connectViaProfilePage(page.browser(), emp.url, name);
    }

    if (connected) {
      filterSentCount++;
      overallSentRef.count++;
      sentProfiles.add(name);
      sentProfiles.add(emp.url);
      console.log(`      ✅ [Filter: ${roleKeyword}] (${filterSentCount}/${targetForThisFilter}) SENT NOTE TO ${name}!`);
    } else if (clickResult.status === 'pending') {
      console.log(`      ⏸️  ${name} — "Pending" already sent. Profile open cheyaledu, skip.`);
      failedProfiles.add(name);
      failedProfiles.add(emp.url);
      continue;
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

// Crash resilience: script silent ga die avvakunda, error log chesi continue
process.on('uncaughtException', (err) => {
  console.error(`💥 Uncaught Exception (recovering...): ${err.message}`);
});
process.on('unhandledRejection', (reason) => {
  console.error(`💥 Unhandled Rejection (recovering...): ${reason}`);
});

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
  console.log('\n🖥️  Browser open ga untundi. Close cheyandi manual ga.');
  // Don't exit — browser open ga undali, event loop alive ga untundi
});
