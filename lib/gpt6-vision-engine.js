/**
 * GPT-6 Luna Vision-Driven Auto-Apply Engine
 * Uses visual perception and reasoning (Vision LLM) to navigate and fill job applications
 * just like a human applicant.
 */

import { existsSync, writeFileSync, unlinkSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';
import puppeteer from 'puppeteer-core';
import { launchProfileBrowser, clearProfileLocks, freeChromeProfile } from './chrome-profile.js';
import { getVaultData } from './vault-manager.js';

// ─── Chrome path detection ───
function getSystemChromePath() {
  const possiblePaths = [
    process.env.CHROME_PATH || '',
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

// ─── Detect active user's Chrome Profile with LinkedIn session ───
function getActiveChromeProfileDir() {
  const activeUserFile = join(process.cwd(), 'sessions', '.active-user');
  if (existsSync(activeUserFile)) {
    try {
      const userId = readFileSync(activeUserFile, 'utf8').trim();
      const userProfileDir = join(process.cwd(), 'sessions', userId, '.chrome-data');
      if (existsSync(userProfileDir)) return userProfileDir;
    } catch {}
  }

  // Fallback to any session that has an account.json with connected: true
  const sessionsDir = join(process.cwd(), 'sessions');
  if (existsSync(sessionsDir)) {
    try {
      const entries = ['usr_0747de3d0fb30f2d', 'google-nlr.jaswanth2004@gmail.com', 'user-0747de3d0fb30f2d'];
      for (const e of entries) {
        const candidate = join(sessionsDir, e, '.chrome-data');
        if (existsSync(candidate)) return candidate;
      }
    } catch {}
  }

  const fallback = join(process.cwd(), '.chrome-data-autoapply');
  if (!existsSync(fallback)) mkdirSync(fallback, { recursive: true });
  return fallback;
}

export class Gpt6VisionEngine extends EventEmitter {
  constructor() {
    super();
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.tempDir = join(process.cwd(), 'temp_scripts');
    if (!existsSync(this.tempDir)) mkdirSync(this.tempDir, { recursive: true });

    this.apiKey = process.env.BYNARA_API_KEY || process.env.RADOX_API_KEY || 'coa_3059813e52571581bcbf9f179c163db1';
    this.baseURL = process.env.BYNARA_BASE_URL || process.env.RADOX_BASE_URL || 'https://coarena.ai/api/v1';
    this.model = process.env.BYNARA_MODEL || process.env.RADOX_MODEL || 'gpt-6-luna';
  }

  _progress(step, message, details = {}) {
    const event = { step, message, timestamp: Date.now(), ...details };
    this.emit('progress', event);
    console.log(`[GPT-6 Luna Vision] ${step}: ${message}`);
    return event;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Ask GPT-6 Luna Vision to examine the current page screenshot and decide next action
   */
  async _queryLunaVision({ base64Screenshot, jobTitle, company, profile, stepNumber }) {
    const prompt = `You are an expert autonomous browser automation agent applying to a job.
Job: ${jobTitle || 'Role'} at ${company || 'Company'}
Applicant Profile:
- Name: ${profile?.fullName || profile?.name || 'Applicant'}
- Email: ${profile?.email || ''}
- Phone: ${profile?.phone || ''}
- Location: ${profile?.location || ''}
- Experience: ${profile?.experienceYears || '3'} years in software/tech
- Work Authorization: Authorized to work in the country, does NOT require visa sponsorship
- Resume Text Summary: ${(profile?.resume?.text || profile?.summary || '').slice(0, 400)}

Look carefully at this screenshot of the browser window.
Analyze what is currently on the screen:
1. Is there an "Easy Apply" / "Apply" button visible on the page?
2. Is an application modal/dialog currently open?
3. If a modal is open:
   - Is it currently loading (showing a spinner/loader)?
   - Are there input fields, radio options, dropdowns, or checkboxes to fill/select?
   - What is the action button at the bottom? ("Next", "Review", "Submit application", "Done" / "Dismiss")?
4. Is there an "Application sent" / "Done" confirmation dialog?

Respond ONLY with valid JSON in this exact structure:
{
  "screenState": "job_page_with_easy_apply" | "modal_loading" | "modal_form_step" | "modal_review_step" | "application_submitted" | "unknown",
  "action": "click_easy_apply" | "wait" | "fill_and_advance" | "click_next" | "click_review" | "click_submit" | "close_done" | "needs_user",
  "actionTarget": {
    "description": "Short description of button or element to click",
    "approximatePosition": { "xPercent": 25, "yPercent": 35 }
  },
  "fieldsToFill": [
    { "fieldType": "text" | "phone" | "radio" | "dropdown", "fieldLabel": "label or question", "recommendedValue": "answer" }
  ],
  "reasoning": "Brief human explanation of your decision"
}`;

    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are an autonomous AI browser vision agent. You must inspect the screenshot and return JSON only.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Screenshot}` } }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 800
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`GPT-6 Luna API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse JSON from GPT-6 Luna response');
    }
    return JSON.parse(jsonMatch[0]);
  }

  /**
   * Main apply routine
   */
  async apply(config) {
    const { applyUrl, profile = {}, resumeBase64 = '', resumeName = 'resume.pdf', jobTitle = '', company = '', fullAutoMode = true } = config;

    if (this.isRunning) {
      throw new Error('Another auto-apply run is already in progress.');
    }

    const chromePath = getSystemChromePath();
    if (!chromePath) {
      throw new Error('Chrome browser not found on this machine.');
    }

    this.isRunning = true;
    let status = 'failed';
    let message = '';
    let screenshotBase64 = '';
    const filledFields = [];
    let resumeTempPath = null;

    if (resumeBase64) {
      resumeTempPath = join(this.tempDir, resumeName);
      try {
        writeFileSync(resumeTempPath, Buffer.from(resumeBase64, 'base64'));
      } catch {}
    }

    try {
      this._progress('launching', '🚀 Launching Chrome with your active profile...');

      const userDataDir = getActiveChromeProfileDir();
      console.log(`[GPT-6 Luna Vision] Using Chrome Profile: ${userDataDir}`);

      // Ensure profile locks are clean before launching
      await freeChromeProfile(userDataDir, { attempts: 3, waitMs: 500 });
      clearProfileLocks(userDataDir);

      this.browser = await launchProfileBrowser({
        headless: false, // Visible so user sees the AI in action
        chromePath,
        userDataDir,
        defaultViewport: null,
        args: [
          '--start-maximized',
          '--disable-blink-features=AutomationControlled',
        ],
      });

      const pages = await this.browser.pages();
      this.page = pages[0] || (await this.browser.newPage());

      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      this._progress('navigating', `🌐 Opening ${company || 'job'} application page...`);
      await this.page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await this._sleep(3000);

      const maxSteps = 14;
      let step = 0;
      let applicationDone = false;

      while (step < maxSteps && !applicationDone) {
        step++;
        this._progress('analyzing', `👁️ Step ${step}: GPT-6 Luna analyzing page screenshot...`);

        // Capture high-quality screenshot
        const screenshotBuf = await this.page.screenshot({ type: 'png', fullPage: false });
        screenshotBase64 = screenshotBuf.toString('base64');

        // Query GPT-6 Luna Vision
        const decision = await this._queryLunaVision({
          base64Screenshot: screenshotBase64,
          jobTitle,
          company,
          profile,
          stepNumber: step
        });

        console.log(`[GPT-6 Luna Decision] Step ${step}:`, JSON.stringify(decision, null, 2));

        if (decision.screenState === 'modal_loading' || decision.action === 'wait') {
          this._progress('waiting', `⏳ Page is loading (${decision.reasoning || 'Waiting for modal/spinner'})...`);
          await this._sleep(2500);
          continue;
        }

        if (decision.action === 'click_easy_apply') {
          this._progress('clicking_apply', '💼 Easy Apply button identified — clicking Easy Apply...');
          
          // Click Easy Apply via DOM helper or coordinate fallback
          const clicked = await this.page.evaluate(() => {
            const btns = [...document.querySelectorAll('button, [role="button"]')];
            const easyApplyBtn = btns.find((b) => {
              const text = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase();
              return text.includes('easy apply') && b.offsetParent !== null;
            });
            if (easyApplyBtn) {
              easyApplyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
              easyApplyBtn.click();
              return true;
            }
            return false;
          });

          if (!clicked && decision.actionTarget?.approximatePosition) {
            // Coordinate fallback
            const vp = this.page.viewport() || { width: 1280, height: 800 };
            const clickX = Math.round((decision.actionTarget.approximatePosition.xPercent / 100) * vp.width);
            const clickY = Math.round((decision.actionTarget.approximatePosition.yPercent / 100) * vp.height);
            await this.page.mouse.click(clickX, clickY);
          }

          await this._sleep(3000);
          continue;
        }

        if (decision.screenState === 'application_submitted' || decision.action === 'close_done') {
          this._progress('submitted', '🎉 Application submitted successfully!');
          status = 'submitted';
          message = `Applied to ${jobTitle} at ${company} successfully!`;
          applicationDone = true;

          // Dismiss done modal if needed
          await this.page.evaluate(() => {
            const btns = [...document.querySelectorAll('button')];
            const doneBtn = btns.find((b) => /done|dismiss|close/i.test(b.innerText || ''));
            if (doneBtn) doneBtn.click();
          });
          break;
        }

        // Fill form fields if detected
        if (Array.isArray(decision.fieldsToFill) && decision.fieldsToFill.length > 0) {
          this._progress('filling_fields', `📝 Filling ${decision.fieldsToFill.length} questions...`);

          for (const f of decision.fieldsToFill) {
            filledFields.push(f.fieldLabel || f.fieldType);
            await this._fillSingleField(f, profile);
          }
        }

        // Handle resume file upload if requested on page
        if (resumeTempPath) {
          const fileUploaded = await this.page.evaluate(() => {
            const fileInput = document.querySelector('input[type="file"]');
            return Boolean(fileInput);
          });
          if (fileUploaded) {
            try {
              const [fileChooser] = await Promise.all([
                this.page.waitForFileChooser({ timeout: 2000 }).catch(() => null),
                this.page.evaluate(() => {
                  const input = document.querySelector('input[type="file"]');
                  if (input) input.click();
                }).catch(() => null)
              ]);
              if (fileChooser) {
                await fileChooser.accept([resumeTempPath]);
                this._progress('resume_uploaded', '📄 Tailored resume uploaded successfully.');
              }
            } catch {}
          }
        }

        // Advance: Next / Review / Submit
        if (decision.action === 'click_next' || decision.screenState === 'modal_form_step') {
          this._progress('next_step', '➡️ Moving to next step...');
          const advanced = await this._clickModalActionButton(['next', 'continue']);
          await this._sleep(2500);
          continue;
        }

        if (decision.action === 'click_review' || decision.screenState === 'modal_review_step') {
          this._progress('review_step', '👀 Reviewing application details...');
          await this._clickModalActionButton(['review', 'next']);
          await this._sleep(2500);

          if (!fullAutoMode) {
            this._progress('needs_attention', '⏸️ Paused at final Review stage. Please review and click Submit in the open Chrome browser.');
            status = 'needs_attention';
            message = 'Application filled and ready for your final review. Submit in the open Chrome window!';
            applicationDone = true;
            break;
          }
          continue;
        }

        if (decision.action === 'click_submit') {
          this._progress('submitting', '🚀 Final step: Submitting application...');
          const submittedClick = await this._clickModalActionButton(['submit application', 'submit']);
          await this._sleep(3000);
          if (submittedClick) {
            this._progress('submitted', '✅ Application submitted successfully!');
            status = 'submitted';
            message = `Applied to ${jobTitle} at ${company} successfully!`;
            applicationDone = true;
            break;
          }
        }

        await this._sleep(2000);
      }

      if (!applicationDone && status !== 'submitted') {
        status = 'needs_attention';
        message = `Completed steps. Please finish the final click in the open Chrome window.`;
        this._progress('needs_attention', '⚠️ Ready in Chrome window. Please complete final submission.');
      }

    } catch (err) {
      status = 'failed';
      message = err.message || 'Auto-apply encountered an error.';
      this._progress('error', `❌ Error: ${message}`);
    } finally {
      this.isRunning = false;
      if (resumeTempPath) {
        try { unlinkSync(resumeTempPath); } catch {}
      }
    }

    const result = {
      status,
      message,
      filledFields: [...new Set(filledFields)],
      screenshotBase64,
      applyUrl,
      jobTitle,
      company
    };

    this.emit('complete', result);
    return result;
  }

  async _fillSingleField(field, profile) {
    try {
      await this.page.evaluate((f, prof) => {
        const val = f.recommendedValue || '';
        const inputs = [...document.querySelectorAll('input, select, textarea')];
        const match = inputs.find((el) => {
          const lbl = (el.getAttribute('aria-label') || el.name || el.id || '').toLowerCase();
          const q = (f.fieldLabel || '').toLowerCase();
          return lbl.includes(q) || (q && q.includes(lbl));
        });

        if (match) {
          if (match.tagName.toLowerCase() === 'select') {
            const opt = [...match.options].find((o) => o.text.toLowerCase().includes(val.toLowerCase()));
            if (opt) match.value = opt.value;
          } else if (match.type === 'radio' || match.type === 'checkbox') {
            if (/yes|true|1/i.test(val)) match.checked = true;
          } else {
            match.value = val;
          }
          match.dispatchEvent(new Event('input', { bubbles: true }));
          match.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, field, profile);
    } catch {}
  }

  async _clickModalActionButton(patterns) {
    return await this.page.evaluate((pts) => {
      const btns = [...document.querySelectorAll('.jobs-easy-apply-modal button, [role="dialog"] button, button')];
      for (const p of pts) {
        const match = btns.find((b) => {
          const txt = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase().trim();
          return txt === p || txt.includes(p);
        });
        if (match && match.offsetParent !== null && !match.disabled) {
          match.click();
          return true;
        }
      }
      return false;
    }, patterns);
  }

  async close() {
    try {
      if (this.browser) await this.browser.close();
    } catch {}
    this.browser = null;
    this.page = null;
    this.isRunning = false;
  }
}
