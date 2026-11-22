import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import puppeteer from 'puppeteer-core';

const browserCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : '',
].filter(Boolean);
const browserPath = browserCandidates.find((p) => existsSync(p));

const profile = {
  fullName: 'Nelluru Jaswanth',
  email: 'jaswanth@example.com',
  phone: '9440552825',
  location: 'Bengaluru, India',
  skills: ['Python', 'React', 'Node.js'],
  education: [{ school: 'NIT Trichy', degree: 'B.Tech', graduationYear: '2026' }],
  experience: [{ company: 'Acme Corp', title: 'Software Intern', dates: '2025' }],
  projects: [{ name: 'Hamzooh', link: 'https://github.com/jaswanth/hamzooh' }],
  links: { linkedin: 'https://linkedin.com/in/jaswanth', github: 'https://github.com/jaswanth' },
  workAuthorized: true,
};

// Minimal valid single-page PDF as base64 for upload interception.
const pdfBase64 = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
).toString('base64');

function fixtureUrl(name) {
  const source = join(process.cwd(), 'public', name);
  const dir = mkdtempSync(join(tmpdir(), 'hamzooh-form-'));
  const target = join(dir, name);
  writeFileSync(target, readFileSync(source, 'utf8'), 'utf8');
  return 'file:///' + target.replace(/\\/g, '/');
}

// Copies several fixtures into one temp dir so relative links between them
// resolve, matching a real site's navigation.
function fixtureUrlWith(name, siblings) {
  const dir = mkdtempSync(join(tmpdir(), 'hamzooh-form-'));
  for (const file of [name, ...siblings]) {
    const source = join(process.cwd(), 'public', file);
    writeFileSync(join(dir, file), readFileSync(source, 'utf8'), 'utf8');
  }
  return 'file:///' + join(dir, name).replace(/\\/g, '/');
}

// Installs a chrome.* stub before filler.js runs so the real content script
// executes end to end, with progress events captured in window.__hamzoohEvents.
async function installChromeStub(page) {
  await page.evaluateOnNewDocument((resumeB64) => {
    window.__hamzoohEvents = [];
    window.__hamzoohSubmitted = false;
    const storage = {
      pendingApply: undefined,
      profile: undefined,
      answers: {},
    };
    const listeners = [];
    const runtimeListeners = [];
    const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

    window.chrome = {
      runtime: {
        id: 'test-extension',
        lastError: null,
        sendMessage(message, cb) {
          const reply = (data) => { if (typeof cb === 'function') setTimeout(() => cb(clone(data)), 0); };
          switch (message?.type) {
            case 'HAMZOOH_IS_JOB_TAB': return reply({ ok: true });
            case 'HAMZOOH_ADOPT_TAB': return reply({ ok: true });
            case 'HAMZOOH_GET_RESUME': return reply({ resumeBase64: resumeB64, resumeName: 'jaswanth-tailored-resume.pdf' });
            case 'HAMZOOH_CDP_INPUT': {
              // The real background worker drives Chrome's input domain. Report
              // ok only when the click actually landed, otherwise the filler
              // believes a synthetic click happened and the page never moves.
              if (message.action === 'click') {
                const el = document.elementFromPoint(Number(message.x), Number(message.y));
                if (!el) return reply({ ok: false });
                el.click();
                return reply({ ok: true });
              }
              if (message.action === 'type') {
                const el = document.activeElement;
                if (!el || !('value' in el)) return reply({ ok: false });
                el.value = String(message.text ?? '');
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return reply({ ok: true });
              }
              return reply({ ok: true });
            }
            case 'HAMZOOH_FILLER_PROGRESS':
            case 'HAMZOOH_RUN_EVENT':
              window.__hamzoohEvents.push(clone(message));
              return reply({ ok: true });
            case 'HAMZOOH_PROXY_FETCH': return reply({ ok: true, data: { match: null } });
            default: return reply({ ok: true });
          }
        },
        onMessage: { addListener(fn) { runtimeListeners.push(fn); } },
      },
      storage: {
        local: {
          // MV3 supports both forms: a callback, or a Promise when none is
          // given. filler.js uses both, so the stub must too.
          get(keys, cb) {
            const out = {};
            const list = Array.isArray(keys) ? keys : [keys];
            for (const key of list) out[key] = clone(storage[key]);
            if (typeof cb !== 'function') return Promise.resolve(clone(out));
            setTimeout(() => cb(out), 0);
            return undefined;
          },
          set(patch, cb) {
            const changes = {};
            for (const [key, value] of Object.entries(patch)) {
              changes[key] = { oldValue: clone(storage[key]), newValue: clone(value) };
              storage[key] = clone(value);
            }
            const commit = () => listeners.forEach((fn) => fn(changes, 'local'));
            if (typeof cb !== 'function') {
              return new Promise((resolve) => setTimeout(() => { commit(); resolve(); }, 0));
            }
            setTimeout(() => { commit(); cb(); }, 0);
            return undefined;
          },
        },
        onChanged: { addListener(fn) { listeners.push(fn); } },
      },
    };
  }, pdfBase64);
}

async function runFiller(page, pending) {
  // Kick off the pipeline without awaiting: fillPage blocks on the review
  // overlay until the user (or this test) clicks a decision. runEvent() is
  // silent without a run id, so every run gets one here.
  await page.evaluate((pendingArg) => {
    const pendingApply = { runId: `test-${Date.now()}`, ...pendingArg.pending };
    window.__hamzoohRun = window.__HAMZOOH_TEST_RUN__(pendingArg.profile, pendingArg.answers, pendingApply);
    return true;
  }, pending);
}

// Click an explicit button in Hamzooh's review overlay, if present.
async function clickOverlay(page, id) {
  const start = Date.now();
  while (Date.now() - start < 45000) {
    const clicked = await page.evaluate((targetId) => {
      const btn = document.getElementById(targetId);
      if (!btn) return false;
      btn.click();
      return true;
    }, id);
    if (clicked) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const clickOverlaySubmit = (page) => clickOverlay(page, 'hamzooh-do-submit');

async function snapshotEvents(page) {
  return page.evaluate(() => window.__hamzoohEvents || []);
}

// Counts how many times the in-page answer card asked about a question.
async function questionCardCount(page, fragment) {
  const events = await snapshotEvents(page);
  return events.filter((e) => e.step === 'asking_user' && String(e.message || '').includes(fragment)).length;
}

test('real filler fills layout A, attaches resume, and does not submit without confirmation', async (t) => {
  if (!browserPath) {
    t.skip('No Chrome/Edge executable found');
    return;
  }
  const browser = await puppeteer.launch({ headless: true, executablePath: browserPath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await installChromeStub(page);
    await page.goto(fixtureUrl('mock-apply-form.html'), { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: join(process.cwd(), 'extension', 'filler.js') });

    await runFiller(page, {
      profile,
      answers: {},
      pending: { url: page.url(), jobTitle: 'Frontend Engineer', company: 'Google' },
    });

    // Filler pauses on the review overlay; nothing must be submitted yet.
    assert.equal(await clickOverlay(page, 'hamzooh-do-review'), true, 'review overlay should appear');
    await new Promise((r) => setTimeout(r, 1500));

    const state = await page.evaluate(() => ({
      name: document.getElementById('full_name').value,
      email: document.getElementById('email').value,
      phone: document.getElementById('phone').value,
      linkedin: document.getElementById('linkedin').value,
      university: document.getElementById('university').value,
      hear: document.getElementById('hear').value,
      prev: document.querySelector('input[name="prev"]:checked')?.value || '',
      terms: document.querySelector('input[name="terms"]').checked,
      resumeName: document.getElementById('resume').files?.[0]?.name || '',
      cover: document.getElementById('cover').value,
      page2Visible: !document.getElementById('page-2').hidden,
    }));
    const events = await snapshotEvents(page);

    assert.equal(state.name, 'Nelluru Jaswanth');
    assert.equal(state.email, 'jaswanth@example.com');
    assert.equal(state.phone, '9440552825');
    assert.equal(state.linkedin, 'https://linkedin.com/in/jaswanth');
    assert.equal(state.university, 'NIT Trichy');
    assert.equal(state.hear, 'LinkedIn');
    assert.equal(state.prev, 'No');
    assert.equal(state.terms, true);
    assert.equal(state.resumeName, 'jaswanth-tailored-resume.pdf');
    assert.ok(state.cover.length > 20, 'cover letter text should be generated');
    assert.ok(events.some((e) => e.step === 'resume_attached'), 'resume attach should be reported');
    assert.ok(events.some((e) => e.step === 'confirming'), 'review step should be reached');
  } finally {
    await browser.close();
  }
});

test('real filler fills layout B custom dropdown, required radios, and reports page 2 work auth', async (t) => {
  if (!browserPath) {
    t.skip('No Chrome/Edge executable found');
    return;
  }
  const browser = await puppeteer.launch({ headless: true, executablePath: browserPath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await installChromeStub(page);
    await page.goto(fixtureUrl('mock-apply-form-2.html'), { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: join(process.cwd(), 'extension', 'filler.js') });

    await runFiller(page, {
      profile,
      answers: {},
      pending: { url: page.url(), jobTitle: 'Senior Frontend Engineer', company: 'Anthropic' },
    });

    await page.waitForSelector('#hamzooh-do-submit', { timeout: 20000 }).catch(() => {});
    const state = await page.evaluate(() => ({
      name: document.getElementById('applicant_name').value,
      email: document.getElementById('applicant_email').value,
      phone: document.getElementById('applicant_phone').value,
      portfolio: document.getElementById('portfolio_url').value,
      grad: document.getElementById('grad_year').value,
      source: document.getElementById('source-value').textContent.trim(),
      education: document.querySelector('input[name="education_level"]:checked')?.value || '',
      resumeName: document.getElementById('resume_upload').files?.[0]?.name || '',
      consent: document.querySelector('input[name="consent_data"]').checked,
      step2Visible: document.getElementById('step-2').classList.contains('active'),
      workAuth: document.querySelector('input[name="work_auth_in"]:checked')?.value || '',
      submitted: document.getElementById('success').style.display === 'block',
    }));
    const events = await snapshotEvents(page);

    assert.equal(state.name, 'Nelluru Jaswanth');
    assert.equal(state.email, 'jaswanth@example.com');
    assert.equal(state.phone, '9440552825');
    assert.equal(state.portfolio, 'https://github.com/jaswanth');
    assert.equal(state.grad, '2026');
    assert.equal(state.source, 'LinkedIn');
    assert.equal(state.education, "Bachelor's degree");
    assert.equal(state.resumeName, 'jaswanth-tailored-resume.pdf');
    assert.equal(state.consent, true);
    assert.equal(state.step2Visible, true, 'filler should advance to step 2');
    assert.equal(state.workAuth, 'Yes', 'profile workAuthorized=true should answer work auth');
    assert.equal(state.submitted, false, 'nothing may be submitted before explicit confirmation');
    assert.ok(events.some((e) => e.step === 'confirming'));
  } finally {
    await browser.close();
  }
});

test('clicking overlay Submit actually submits layout B after confirmation', async (t) => {
  if (!browserPath) {
    t.skip('No Chrome/Edge executable found');
    return;
  }
  const browser = await puppeteer.launch({ headless: true, executablePath: browserPath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await installChromeStub(page);
    await page.goto(fixtureUrl('mock-apply-form-2.html'), { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: join(process.cwd(), 'extension', 'filler.js') });

    await runFiller(page, {
      profile,
      answers: {},
      pending: { url: page.url(), jobTitle: 'Senior Frontend Engineer', company: 'Anthropic' },
    });

    const clicked = await clickOverlaySubmit(page);
    assert.equal(clicked, true, 'review overlay must offer a Submit button');

    // Poll from Node: fill + advance + 25s success verification can exceed a
    // single in-page wait budget.
    let complete = null;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const events = await snapshotEvents(page);
      complete = events.filter((e) => e.step === 'complete').pop() || null;
      if (complete) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(complete, 'completion should be reported');
    assert.equal(complete.status, 'submitted');
    assert.match(complete.message, /submitted/i);
    const successShown = await page.evaluate(() => document.getElementById('success').style.display === 'block');
    assert.equal(successShown, true, 'the site confirmation should be visible');
  } finally {
    await browser.close();
  }
});

test('Google-style hidden Material radios are selected and Next advances', async (t) => {
  if (!browserPath) {
    t.skip('No Chrome/Edge executable found');
    return;
  }
  const browser = await puppeteer.launch({ headless: true, executablePath: browserPath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await installChromeStub(page);
    await page.goto(fixtureUrl('mock-apply-google.html'), { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: join(process.cwd(), 'extension', 'filler.js') });

    await runFiller(page, {
      profile: {
        ...profile,
        education: [{ school: 'NIT Trichy', degree: 'B.Tech', graduationYear: '2027' }],
      },
      answers: {},
      pending: { url: page.url(), jobTitle: 'Forward Deployed Engineer Intern', company: 'Google' },
    });

    await clickOverlay(page, 'hamzooh-do-submit');
    await new Promise((r) => setTimeout(r, 3000));

    const state = await page.evaluate(() => ({
      enrolled: document.querySelector('input[name="enrolled"]:checked')?.value || '',
      workauth: document.querySelector('input[name="workauth"]:checked')?.value || '',
      name: document.getElementById('fullname')?.value || '',
      email: document.getElementById('mail')?.value || '',
      cv: document.getElementById('cv')?.files?.[0]?.name || '',
      step2: document.getElementById('step-2')?.classList.contains('active'),
      school: document.getElementById('school')?.value || '',
      grad: document.getElementById('grad')?.value || '',
      submitted: document.getElementById('done')?.style.display === 'block',
      errorShown: document.getElementById('e1')?.classList.contains('show'),
    }));

    assert.equal(state.enrolled, 'Yes', 'enrolment radio must be selected despite hidden input');
    assert.equal(state.workauth, 'Yes', 'work auth radio must use the profile flag');
    assert.equal(state.name, 'Nelluru Jaswanth');
    assert.equal(state.email, 'jaswanth@example.com');
    assert.equal(state.cv, 'jaswanth-tailored-resume.pdf');
    assert.equal(state.errorShown, false, 'validation must pass, not fail');
    assert.equal(state.step2, true, 'Next must advance to step 2');
    assert.equal(state.school, 'NIT Trichy');
    assert.equal(state.grad, '2027');
    assert.equal(state.submitted, true, 'final submit must complete');
  } finally {
    await browser.close();
  }
});

test('sign-in host is not treated as an application form', async (t) => {
  if (!browserPath) {
    t.skip('No Chrome/Edge executable found');
    return;
  }
  const browser = await puppeteer.launch({ headless: true, executablePath: browserPath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await installChromeStub(page);
    await page.goto(fixtureUrl('mock-google-signin.html'), { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: join(process.cwd(), 'extension', 'filler.js') });

    await runFiller(page, {
      profile,
      answers: {},
      pending: { url: page.url(), jobTitle: 'Forward Deployed Engineer Intern', company: 'Google' },
    });

    await new Promise((r) => setTimeout(r, 4000));
    const pagesnapshot = await page.evaluate(() => ({
      identifier: document.getElementById('identifier')?.value || '',
      overlay: !!document.getElementById('hamzooh-do-submit'),
    }));
    const events = await snapshotEvents(page);
    const state = { ...pagesnapshot, events: events.map((e) => e.step) };

    assert.equal(state.identifier, '', 'the filler must never type into a sign-in field');
    assert.equal(state.overlay, false, 'no review overlay on a sign-in page');
    assert.ok(state.events.includes('login_required'), 'a login prompt should be reported instead');
  } finally {
    await browser.close();
  }
});

// Google Careers renders actions as MDC <div> buttons and declares required on
// the radio group wrapper. Both are invisible to a plain button/required scan,
// which is what made the real page stall after the first step.
test('MDC div buttons and group-level aria-required advance through both steps', async (t) => {
  if (!browserPath) {
    t.skip('No Chrome/Edge executable found');
    return;
  }
  const browser = await puppeteer.launch({ headless: true, executablePath: browserPath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await installChromeStub(page);
    await page.goto(fixtureUrl('mock-apply-mdc.html'), { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: join(process.cwd(), 'extension', 'filler.js') });

    // No workAuthorized flag on purpose: the country on the profile must be
    // enough to answer "authorized to work in India?" without a prompt.
    const { workAuthorized, ...profileWithoutFlag } = profile;

    await runFiller(page, {
      profile: {
        ...profileWithoutFlag,
        country: 'India',
        education: [{ school: 'NIT Trichy', degree: 'B.Tech', graduationYear: '2027' }],
      },
      answers: {},
      pending: {
        url: page.url(),
        jobTitle: 'Forward Deployed Engineer Intern',
        company: 'Google',
      },
    });

    // There is one submission path: the candidate approves in the overlay.
    assert.equal(await clickOverlaySubmit(page), true, 'the review overlay must appear');

    let complete = null;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const events = await snapshotEvents(page);
      complete = events.filter((e) => e.step === 'complete').pop() || null;
      if (complete) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    const state = await page.evaluate(() => ({
      enrolled: document.querySelector('input[name="enrolled"]:checked')?.value || '',
      workauth: document.querySelector('input[name="workauth"]:checked')?.value || '',
      name: document.getElementById('fullname')?.value || '',
      school: document.getElementById('school')?.value || '',
      grad: document.getElementById('grad')?.value || '',
      errorShown: document.getElementById('e1')?.classList.contains('show') || false,
      submitted: document.getElementById('done')?.style.display === 'block',
    }));

    assert.ok(complete, 'automation must finish instead of stalling or terminating');
    assert.equal(state.enrolled, 'Yes', 'enrolment must be derived from the future graduation year');
    assert.equal(state.workauth, 'Yes', 'work auth must resolve from the profile country');
    assert.equal(state.name, 'Nelluru Jaswanth');
    assert.equal(state.errorShown, false, 'page validation must not block the step');
    assert.equal(state.school, 'NIT Trichy', 'step 2 must be reached and filled');
    assert.equal(state.grad, '2027');
    assert.equal(complete.status, 'submitted');
    assert.equal(state.submitted, true, 'the approved application should be submitted');
  } finally {
    await browser.close();
  }
});

// Google wraps its MDC button's real navigation in a stretched <a href> inside
// the <div>. Dispatching on the div never reaches the anchor, so the job page
// looks unclickable and the run stops before the form ever opens.
test('job page with a stretched-anchor Apply button opens the real form', async (t) => {
  if (!browserPath) {
    t.skip('No Chrome/Edge executable found');
    return;
  }
  const browser = await puppeteer.launch({ headless: true, executablePath: browserPath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await installChromeStub(page);
    await page.goto(fixtureUrlWith('mock-job-with-anchor-apply.html', ['mock-apply-mdc.html']), {
      waitUntil: 'domcontentloaded',
    });
    await page.addScriptTag({ path: join(process.cwd(), 'extension', 'filler.js') });

    const jobUrl = page.url();
    await runFiller(page, {
      profile: { ...profile, education: [{ school: 'NIT Trichy', degree: 'B.Tech', graduationYear: '2027' }] },
      answers: {},
      pending: { url: jobUrl, jobTitle: 'Forward Deployed Engineer Intern', company: 'Google' },
    });

    // The Apply anchor navigates away; wait for the new document.
    let navigated = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (page.url() !== jobUrl) { navigated = true; break; }
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.equal(navigated, true, 'the stretched Apply anchor must actually navigate');
    assert.match(page.url(), /mock-apply-mdc\.html/);

    // A real extension re-injects the content script on the new page; do the
    // same here and let it fill the form it just opened.
    await page.waitForSelector('#fullname', { timeout: 15000 });
    await page.evaluateOnNewDocument(() => {});
    await page.addScriptTag({ path: join(process.cwd(), 'extension', 'filler.js') });
    await runFiller(page, {
      profile: { ...profile, education: [{ school: 'NIT Trichy', degree: 'B.Tech', graduationYear: '2027' }] },
      answers: {},
      pending: { url: page.url(), jobTitle: 'Forward Deployed Engineer Intern', company: 'Google', applyClicked: true },
    });

    await clickOverlay(page, 'hamzooh-do-review');
    const state = await page.evaluate(() => ({
      name: document.getElementById('fullname')?.value || '',
      enrolled: document.querySelector('input[name="enrolled"]:checked')?.value || '',
    }));
    assert.equal(state.name, 'Nelluru Jaswanth');
    assert.equal(state.enrolled, 'Yes');
  } finally {
    await browser.close();
  }
});

test('an incomplete form never offers submission and reports what is missing', async (t) => {
  if (!browserPath) {
    t.skip('No Chrome/Edge executable found');
    return;
  }
  const browser = await puppeteer.launch({ headless: true, executablePath: browserPath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await installChromeStub(page);
    await page.goto(fixtureUrl('mock-apply-mdc.html'), { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: join(process.cwd(), 'extension', 'filler.js') });

    // No name, email, education or work flag: nothing can answer the radios.
    await runFiller(page, {
      profile: {},
      answers: {},
      pending: {
        url: page.url(),
        jobTitle: 'Forward Deployed Engineer Intern',
        company: 'Google',
      },
    });

    // Nothing can answer the required radios, so the run must ask the candidate
    // instead of clicking through to the submit button.
    const asked = await page.waitForSelector('#hamzooh-answer-input', { timeout: 60000 }).catch(() => null);
    assert.ok(asked, 'an unanswerable required question must be asked, not skipped');
    const submitted = await page.evaluate(() => document.getElementById('done')?.style.display === 'block');
    assert.equal(submitted, false, 'an incomplete form must never be submitted');
    const events = await snapshotEvents(page);
    assert.ok(
      events.some((e) => e.step === 'asking_user'),
      'the run must report that it is waiting on the candidate',
    );
    assert.ok(
      !events.some((e) => e.step === 'complete' && e.status === 'submitted'),
      'no completion may claim a submission for an empty form',
    );
  } finally {
    await browser.close();
  }
});

// The candidate pressed Skip in the in-page card and the same question kept
// coming back on the next pass, which made the automation look stuck. One Skip
// must silence the question for the rest of the application.
test('a skipped question is not asked again on the next pass', async (t) => {
  if (!browserPath) {
    t.skip('No Chrome/Edge executable found');
    return;
  }
  const browser = await puppeteer.launch({ headless: true, executablePath: browserPath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await installChromeStub(page);
    await page.goto(fixtureUrl('mock-apply-mdc.html'), { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: join(process.cwd(), 'extension', 'filler.js') });

    // No work flag and a country the question does not name: nothing can answer
    // "authorized to work in India?", so the card must appear.
    await runFiller(page, {
      profile: { fullName: 'Nelluru Jaswanth', email: 'jaswanth@example.com', country: 'Germany' },
      answers: {},
      pending: { url: page.url(), jobTitle: 'Forward Deployed Engineer Intern', company: 'Google' },
    });

    const card = await page.waitForSelector('#hamzooh-skip-btn', { timeout: 60000 }).catch(() => null);
    assert.ok(card, 'the unanswered required question must be asked first');
    await page.click('#hamzooh-skip-btn');

    // Give the run several passes to prove it does not re-prompt.
    await new Promise((r) => setTimeout(r, 12000));
    const askedAgain = await questionCardCount(page, 'authorized to work in India');
    assert.equal(askedAgain, 1, 'a skipped question must be asked exactly once');
    const skippedEvents = (await snapshotEvents(page)).filter((e) => e.step === 'question_skipped');
    assert.ok(skippedEvents.length >= 1, 'the skip must be recorded');
  } finally {
    await browser.close();
  }
});

// Workday-style required dropdowns show the placeholder "No Selection" until an
// option is committed. That placeholder was read as a real value, so every
// required question was skipped, Next was clicked with the form empty, and the
// page rejected the step.
test('required "No Selection" dropdowns are answered instead of skipped', async (t) => {
  if (!browserPath) {
    t.skip('No Chrome/Edge executable found');
    return;
  }
  const browser = await puppeteer.launch({ headless: true, executablePath: browserPath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await installChromeStub(page);
    await page.goto(fixtureUrl('mock-apply-workday.html'), { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: join(process.cwd(), 'extension', 'filler.js') });

    const { workAuthorized, ...rest } = profile;
    await runFiller(page, {
      profile: { ...rest, country: 'India', workAuthorized: true, requireSponsorship: false },
      answers: {
        'are you currently employed with a government or government agency (including in the last 12 months)?': 'No',
      },
      pending: { url: page.url(), jobTitle: 'Software Engineer', company: 'Workday' },
    });

    assert.equal(await clickOverlaySubmit(page), true, 'the review overlay must appear');

    let complete = null;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const events = await snapshotEvents(page);
      complete = events.filter((e) => e.step === 'complete').pop() || null;
      if (complete) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    const state = await page.evaluate(() => {
      const value = (id) => document.getElementById(id)?.dataset.value || '';
      return {
        name: document.getElementById('full_name')?.value || '',
        email: document.getElementById('email')?.value || '',
        workauth: value('dd-workauth'),
        sponsorship: value('dd-sponsorship'),
        government: value('dd-government'),
        authCountry: value('dd-auth-country'),
        citizenship: value('dd-citizenship'),
        submitted: document.getElementById('done')?.style.display === 'block',
      };
    });

    assert.equal(state.name, 'Nelluru Jaswanth');
    assert.equal(state.email, 'jaswanth@example.com');
    assert.equal(state.workauth, 'Yes', 'work auth must be answered from the profile flag');
    assert.equal(state.sponsorship, 'No', 'sponsorship must be answered from the profile flag');
    assert.equal(state.government, 'No', 'a saved answer must be applied to the dropdown');
    assert.equal(state.authCountry, 'India', 'a country dropdown must get a country, not "Yes"');
    assert.equal(state.citizenship, 'India', 'citizenship must get a country, not "Yes"');
    assert.ok(complete, 'the run must finish instead of stalling on empty dropdowns');
    assert.equal(state.submitted, true, 'the application should be submitted after approval');
  } finally {
    await browser.close();
  }
});

// The only path to submission is the candidate's explicit approval, so a clean
// form must reach the review with nothing missing and submit on that click.
test('a clean form submits only after the candidate approves in the overlay', async (t) => {
  if (!browserPath) {
    t.skip('No Chrome/Edge executable found');
    return;
  }
  const browser = await puppeteer.launch({ headless: true, executablePath: browserPath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await installChromeStub(page);
    await page.goto(fixtureUrl('mock-apply-google.html'), { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: join(process.cwd(), 'extension', 'filler.js') });

    await runFiller(page, {
      profile: { ...profile, education: [{ school: 'NIT Trichy', degree: 'B.Tech', graduationYear: '2027' }] },
      answers: {},
      pending: {
        url: page.url(),
        jobTitle: 'Forward Deployed Engineer Intern',
        company: 'Google',
      },
    });

    assert.equal(await clickOverlaySubmit(page), true, 'the review overlay must appear');

    let complete = null;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const events = await snapshotEvents(page);
      complete = events.filter((e) => e.step === 'complete').pop() || null;
      if (complete) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(complete, 'automation should finish once approved');
    assert.equal(complete.status, 'submitted', 'an approved clean form should be submitted');
    const done = await page.evaluate(() => document.getElementById('done')?.style.display === 'block');
    assert.equal(done, true, 'site confirmation must appear');
  } finally {
    await browser.close();
  }
});
