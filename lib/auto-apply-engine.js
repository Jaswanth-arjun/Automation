/**
 * AutoApplyEngine — Server-side Puppeteer job application automation
 * Supports interactive user input prompts (passwords, OTPs, custom fields) via WebSocket + Vault persistence.
 */

import puppeteer from 'puppeteer-core';
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';
import { findVaultCredential, saveVaultCredential, saveVaultAnswer, getVaultData } from './vault-manager.js';

// ─── Chrome path detection ───
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

const PAGE_WAIT_MS = 2500;
const MAX_PAGES = 10;

export class AutoApplyEngine extends EventEmitter {
  constructor() {
    super();
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.pendingInputs = new Map(); // inputId -> { resolve, reject }
    this.tempDir = join(process.cwd(), 'temp_scripts');
    if (!existsSync(this.tempDir)) mkdirSync(this.tempDir, { recursive: true });
  }

  _progress(step, message, details = {}) {
    const event = { step, message, timestamp: Date.now(), ...details };
    this.emit('progress', event);
    return event;
  }

  /**
   * Called by API server when user provides an input answer in frontend modal
   */
  provideUserInput(inputId, value, saveToVault = true, domain = '', fieldKey = '') {
    const pending = this.pendingInputs.get(inputId);
    if (pending) {
      if (saveToVault && domain) {
        if (fieldKey === 'password' || fieldKey.includes('password')) {
          saveVaultCredential(domain, { password: value });
        } else {
          saveVaultAnswer(fieldKey || domain, value);
        }
      }
      pending.resolve(value);
      this.pendingInputs.delete(inputId);
      return true;
    }
    return false;
  }

  /**
   * Request an input from the user via WebSocket prompt
   */
  async _requestUserInputFromUser(domain, fieldKey, label, inputType, promptMessage, timeoutMs = 120000) {
    const inputId = `input_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    
    this.emit('input_required', {
      inputId,
      domain,
      fieldKey,
      label,
      inputType, // 'password' | 'text' | 'number'
      promptMessage,
      timestamp: Date.now(),
    });

    this._progress('input_required', `🔑 Waiting for your input: ${label}...`, { inputId, label });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingInputs.delete(inputId);
        reject(new Error(`Timed out waiting for input: ${label}`));
      }, timeoutMs);

      this.pendingInputs.set(inputId, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  /**
   * Main auto-apply method
   */
  async apply(config) {
    const { applyUrl, profile, resumeBase64, resumeName, jobTitle, company, askAI } = config;

    if (this.isRunning) {
      throw new Error('Another auto-apply is already in progress.');
    }

    const chromePath = getSystemChromePath();
    if (!chromePath) {
      throw new Error('Chrome browser not found on this machine.');
    }

    this.isRunning = true;
    const filledFields = [];
    let status = 'failed';
    let message = '';
    let screenshotBase64 = '';

    // Write resume to temp file for upload
    let resumeTempPath = null;
    if (resumeBase64) {
      resumeTempPath = join(this.tempDir, resumeName || 'hamzo-auto-resume.pdf');
      try {
        writeFileSync(resumeTempPath, Buffer.from(resumeBase64, 'base64'));
      } catch (err) {
        resumeTempPath = null;
      }
    }

    try {
      this._progress('launching', '🚀 Launching Chrome browser...');

      const userDataDir = join(process.cwd(), '.chrome-data-autoapply');
      if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });

      this.browser = await puppeteer.launch({
        headless: false,
        executablePath: chromePath,
        userDataDir,
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

      const pages = await this.browser.pages();
      this.page = pages[0] || (await this.browser.newPage());

      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      this._progress('navigating', `🌐 Opening ${company} application page...`);

      await this.page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await this._sleep(PAGE_WAIT_MS);

      const pageUrl = this.page.url();
      if (/\/error(\/|$)|\/500(\/|$)/i.test(pageUrl)) {
        throw new Error('Job portal returned an error page.');
      }

      this._progress('finding_form', '🔍 Looking for the application form...');
      await this._clickApplyEntryButton();
      await this._sleep(PAGE_WAIT_MS);

      let pageIndex = 0;
      let submitted = false;

      while (pageIndex < MAX_PAGES && !submitted) {
        pageIndex++;
        const currentUrl = this.page.url();
        const currentDomain = new URL(currentUrl).hostname.replace(/^www\./, '');

        this._progress('filling', `📝 Filling form fields (page ${pageIndex})...`, { page: pageIndex, domain: currentDomain });

        // Check if page requires Password / Login Credentials
        const passwordHandled = await this._handlePasswordFieldIfNeeded(currentDomain, profile);
        if (passwordHandled) {
          filledFields.push('password');
          await this._sleep(PAGE_WAIT_MS);
        }

        // Fill standard text / textarea / select inputs
        const filled = await this._fillFormFields(profile, jobTitle, company);
        filledFields.push(...filled);

        // Fill dropdowns, radios, checkboxes
        const choicesFilled = await this._fillChoiceFields(profile, company);
        filledFields.push(...choicesFilled);

        // Attach resume
        if (resumeTempPath) {
          const attached = await this._attachResume(resumeTempPath);
          if (attached) {
            filledFields.push('resume');
            this._progress('resume_attached', '📎 Resume PDF attached successfully!');
          }
        }

        // Handle unknown required fields with AI
        if (askAI) {
          const aiAnswered = await this._fillUnknownFieldsWithAI(profile, askAI);
          filledFields.push(...aiAnswered);
        }

        await this._sleep(1200);

        // Try to submit or advance to next section/page
        const action = await this._trySubmitOrNext();

        if (action === 'submitted') {
          submitted = true;
          this._progress('submitted', '✅ Application submitted successfully!');
          status = 'submitted';
          message = `Successfully applied to ${jobTitle} at ${company}!`;
        } else if (action === 'next' || action === 'login_submitted') {
          this._progress('page_advanced', `➡️ Moving to next section...`);
          await this._sleep(PAGE_WAIT_MS);
        } else {
          // Check if submit button is available or if there are empty required fields
          const hasEmpty = await this._hasEmptyRequiredFields();
          if (hasEmpty) {
            this._progress('needs_attention', '⚠️ Some required fields need attention.');
            status = 'needs_attention';
            message = `Filled ${filledFields.length} fields. Please review and complete remaining fields in the open Chrome window.`;
          } else {
            const finalSubmit = await this._forceSubmit();
            if (finalSubmit) {
              submitted = true;
              this._progress('submitted', '✅ Application submitted successfully!');
              status = 'submitted';
              message = `Successfully applied to ${jobTitle} at ${company}!`;
            } else {
              status = 'needs_attention';
              message = `Filled ${filledFields.length} fields. Please submit manually in the open browser window.`;
              this._progress('needs_attention', '⚠️ Ready to submit. Please click Submit in Chrome.');
            }
          }
          break;
        }
      }

      try {
        const screenshotBuffer = await this.page.screenshot({ type: 'png', fullPage: false });
        screenshotBase64 = screenshotBuffer.toString('base64');
      } catch {}

    } catch (err) {
      status = 'failed';
      message = err.message || 'Auto-apply failed unexpectedly.';
      this._progress('error', `❌ Error: ${message}`);

      try {
        if (this.page) {
          const screenshotBuffer = await this.page.screenshot({ type: 'png', fullPage: false });
          screenshotBase64 = screenshotBuffer.toString('base64');
        }
      } catch {}
    } finally {
      this.isRunning = false;

      if (resumeTempPath) {
        try { unlinkSync(resumeTempPath); } catch {}
      }

      if (status === 'submitted') {
        setTimeout(async () => {
          try { if (this.browser) await this.browser.close(); } catch {}
          this.browser = null;
          this.page = null;
        }, 5000);
      }
    }

    const result = {
      status,
      message,
      filledFields: [...new Set(filledFields)],
      screenshotBase64,
      applyUrl,
      jobTitle,
      company,
    };

    this.emit('complete', result);
    return result;
  }

  // ─── Handle Password / Login Field ───
  async _handlePasswordFieldIfNeeded(domain, profile) {
    const hasPasswordInput = await this.page.evaluate(() => {
      const pwd = document.querySelector('input[type="password"]');
      return Boolean(pwd && !pwd.disabled && pwd.offsetParent !== null);
    });

    if (!hasPasswordInput) return false;

    // Search vault for saved password for this domain
    let cred = findVaultCredential(domain);
    let passwordVal = cred?.password || profile.password || '';

    if (!passwordVal) {
      // Prompt user in frontend Modal & save to vault
      try {
        const userProvidedPassword = await this._requestUserInputFromUser(
          domain,
          'password',
          `${domain} Password`,
          'password',
          `Please enter your password for ${domain} (${profile.email || 'account'}). It will be saved for future applications.`
        );
        passwordVal = userProvidedPassword;
      } catch (err) {
        console.warn('User canceled password prompt:', err.message);
        return false;
      }
    }

    if (passwordVal) {
      this._progress('filling_password', `🔑 Filling password for ${domain}...`);

      await this.page.evaluate((pwdVal) => {
        const pwd = document.querySelector('input[type="password"]');
        if (pwd) {
          const proto = HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          setter?.call(pwd, pwdVal);
          pwd.dispatchEvent(new Event('input', { bubbles: true }));
          pwd.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, passwordVal);

      await this._sleep(800);

      // Click Sign In / Continue / Log in button after filling password
      const clickedLoginBtn = await this.page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button, input[type="submit"], a')];
        const btn = buttons.find((el) => {
          const text = (el.innerText || el.value || '').trim();
          return /sign in|log in|continue|submit|login|create account/i.test(text);
        });
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });

      if (clickedLoginBtn) {
        await this._sleep(PAGE_WAIT_MS);
      }

      return true;
    }

    return false;
  }

  // ─── Click initial "Apply" entry button ───
  async _clickApplyEntryButton() {
    try {
      const clicked = await this.page.evaluate(() => {
        const buttons = [...document.querySelectorAll('a, button, input[type="submit"]')];
        const applyBtn = buttons.find((el) => {
          const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
          return /^apply(\s+now)?$|^apply for this job$|^apply to this job$|^submit application$/i.test(text)
            && !/sign in with google|sign in with linkedin/i.test(text);
        });
        if (applyBtn) {
          applyBtn.click();
          return true;
        }
        return false;
      });
      if (clicked) {
        await this._sleep(2500);
        try {
          await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
        } catch {}
      }
    } catch {}
  }

  // ─── Fill text/textarea/select form fields ───
  async _fillFormFields(profile, jobTitle, company) {
    const vault = getVaultData();

    return await this.page.evaluate((profile, jobTitle, company, vaultAnswers) => {
      const FIELD_HINTS = [
        { key: 'email', test: /e-?mail/i },
        { key: 'phone', test: /phone|mobile|tel/i },
        { key: 'firstName', test: /first.?name|given.?name|firstname/i },
        { key: 'lastName', test: /last.?name|surname|family.?name|lastname/i },
        { key: 'fullName', test: /^name$|full.?name|your.?name|legal.?name|candidate.?name/i },
        { key: 'location', test: /city|location|address|country|state/i },
        { key: 'linkedin', test: /linkedin/i },
        { key: 'github', test: /github/i },
        { key: 'portfolio', test: /portfolio|website|personal.?url|url/i },
        { key: 'university', test: /university|college|school|institute|alma.?mater/i },
        { key: 'gpa', test: /cgpa|gpa|grade.?point/i },
        { key: 'degree', test: /degree|qualification|major|course|field.?of.?study/i },
        { key: 'graduation', test: /graduat|class.?of|year.?of|expected/i },
        { key: 'salary', test: /salary|compensation|pay|ctc/i },
        { key: 'experience_years', test: /years?.?of.?experience|total.?experience/i },
        { key: 'cover_letter', test: /cover.?letter|additional.?info|why.?do.?you.?want|tell.?us.?about/i },
      ];

      function labelFor(input) {
        const id = input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        const wrapping = input.closest('label');
        const aria = input.getAttribute('aria-label') || '';
        const nearby = input.getAttribute('placeholder') || input.name || input.id || '';
        const heading = input.closest('div, li, fieldset')?.querySelector('label, p, span, legend, div')?.innerText || '';
        return [id?.innerText, wrapping?.innerText, aria, nearby, heading].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      }

      function profileValue(key) {
        const name = profile.fullName || '';
        const [first, ...rest] = name.split(' ').filter(Boolean);
        const education = (profile.education || [])[0] || {};
        const internships = profile.experience || profile.internships || [];
        const map = {
          email: profile.email || '',
          phone: profile.phone || '',
          firstName: first || '',
          lastName: rest.join(' ') || '',
          fullName: name,
          location: profile.location || '',
          linkedin: profile.links?.linkedin || profile.linkedin || '',
          github: profile.links?.github || profile.github || '',
          portfolio: profile.links?.portfolio || '',
          university: education.school || education.university || '',
          gpa: education.gpa || education.detail || education.score || '',
          degree: education.degree || '',
          graduation: education.dates || '',
          salary: '',
          experience_years: String(internships.length || '0'),
          cover_letter: `I am excited to apply for the ${jobTitle} position at ${company}. With my background in ${(profile.skills || []).slice(0, 4).join(', ') || 'software development'}, I am confident in my ability to contribute effectively.`,
        };
        return String(map[key] || '').trim();
      }

      function setNativeValue(input, value) {
        if (input.tagName === 'SELECT') {
          const option = [...input.options].find((item) =>
            item.value === value || item.text.toLowerCase().includes(String(value).toLowerCase()));
          if (option) input.value = option.value;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
        const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const filled = [];
      const inputs = [...document.querySelectorAll('input, textarea, select')].filter((input) => {
        const type = (input.getAttribute('type') || '').toLowerCase();
        if (['hidden', 'password', 'submit', 'button', 'checkbox', 'radio', 'file'].includes(type)) return false;
        if (input.disabled || input.getAttribute('aria-hidden') === 'true') return false;
        return true;
      });

      inputs.forEach((input) => {
        if (input.tagName !== 'SELECT' && input.value && input.value.trim()) return;
        if (input.tagName === 'SELECT') {
          const selected = input.options[input.selectedIndex];
          const text = (selected?.text || input.value || '').trim();
          if (text && !/please select|^select$|^-+$|choose/i.test(text)) return;
        }

        const label = labelFor(input);

        // Check if answer is in saved vault answers
        if (vaultAnswers && vaultAnswers[label.toLowerCase()]) {
          setNativeValue(input, vaultAnswers[label.toLowerCase()]);
          filled.push('saved_vault_' + label.slice(0, 20));
          return;
        }

        const hint = FIELD_HINTS.find((item) => item.test.test(label));
        if (!hint) return;

        const value = profileValue(hint.key);
        if (value) {
          setNativeValue(input, value);
          filled.push(hint.key);
        }
      });

      return filled;
    }, profile, jobTitle, company, vault.customAnswers || {});
  }

  // ─── Fill dropdowns, radios, checkboxes ───
  async _fillChoiceFields(profile, company) {
    return await this.page.evaluate((profile, company) => {
      function questionFor(el) {
        const block = el.closest('fieldset, li, .form-group, [class*="question"], [class*="field"]') || el.parentElement;
        const wider = block?.parentElement;
        const text = [block?.innerText, wider?.innerText, el.getAttribute('aria-label')].filter(Boolean).join(' ');
        return text.replace(/\s+/g, ' ').trim().slice(0, 700);
      }

      function labelFor(input) {
        const id = input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        const wrapping = input.closest('label');
        const aria = input.getAttribute('aria-label') || '';
        const nearby = input.getAttribute('placeholder') || input.name || input.id || '';
        const heading = input.closest('div, li, fieldset')?.querySelector('label, p, span, legend, div')?.innerText || '';
        return [id?.innerText, wrapping?.innerText, aria, nearby, heading].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      }

      function chooseYesNo(question) {
        const q = String(question || '').toLowerCase();
        const comp = String(company || '').toLowerCase();
        if (/employed by|worked (for|at)|contractor|previously employed|ever been employed/.test(q) && (comp && q.includes(comp) || /this company|the company/.test(q))) return 'no';
        if (/currently employed|current employer/.test(q) && !/name of/.test(q)) return 'no';
        if (/convicted|felony|criminal/.test(q)) return 'no';
        if (/export control|denied|debarred/.test(q)) return 'no';
        if (/relative work|family member/.test(q)) return 'no';
        if (/require sponsorship|need sponsorship|visa sponsorship/.test(q)) return 'yes';
        if (/authorized to work/.test(q) && /without sponsorship|no sponsorship/.test(q)) return 'no';
        if (/available|onsite|on-site|start|internship|willing to relocate|able to relocate|18 years|over 18|legally eligible|acknowledge|privacy|agree|consent|terms|i understand/.test(q)) return 'yes';
        if (/gender|hispanic|race|ethnicity|veteran|disability|lgbt/.test(q)) return 'decline';
        return '';
      }

      function optionList(select) {
        return [...select.options].filter((item) => item.value !== '' && !/please select|^select$|^-+$|choose/i.test(item.text.trim()));
      }

      const filled = [];
      const controls = [...document.querySelectorAll('select, input[type="radio"], input[type="checkbox"]')];
      const radioNames = new Set();

      controls.forEach((input) => {
        const type = (input.getAttribute('type') || '').toLowerCase();
        const question = questionFor(input);

        if (type === 'checkbox' && /privacy|acknowledge|agree|terms|consent/i.test(question.toLowerCase())) {
          if (!input.checked) input.click();
          filled.push('agreement_checkbox');
          return;
        }

        if (type === 'radio') {
          if (radioNames.has(input.name)) return;
          radioNames.add(input.name);
        }

        const wanted = chooseYesNo(question);
        if (!wanted) return;

        if (input.tagName === 'SELECT') {
          let option = optionList(input).find((item) => {
            const text = item.text.trim().toLowerCase();
            if (wanted === 'yes') return /^(yes|y)\b/i.test(text);
            if (wanted === 'no') return /^(no|n)\b/i.test(text);
            if (wanted === 'decline') return /decline|prefer not|do not wish/i.test(text);
            return false;
          });
          if (option) {
            input.value = option.value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            filled.push('select_' + wanted);
          }
        } else if (type === 'radio') {
          const group = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(input.name)}"]`)];
          for (const radio of group) {
            const lbl = `${labelFor(radio)} ${radio.value}`.toLowerCase();
            const yes = wanted === 'yes' && /^(yes|y)\b|true|agree/.test(lbl);
            const no = wanted === 'no' && /^(no|n)\b|false|disagree/.test(lbl);
            if (yes || no || lbl.includes(wanted)) {
              radio.checked = true;
              radio.click();
              radio.dispatchEvent(new Event('change', { bubbles: true }));
              filled.push('radio_' + wanted);
              break;
            }
          }
        }
      });

      return filled;
    }, profile, company);
  }

  // ─── Attach resume PDF ───
  async _attachResume(resumeTempPath) {
    try {
      const fileInputs = await this.page.$$('input[type="file"]');
      if (fileInputs.length > 0) {
        let targetInput = fileInputs[0];
        for (const input of fileInputs) {
          const context = await this.page.evaluate((el) => {
            const parent = el.closest('div, fieldset, section, label');
            return (parent?.innerText || '').slice(0, 200).toLowerCase();
          }, input);
          if (/resume|cv|file|document|upload|attach/i.test(context)) {
            targetInput = input;
            break;
          }
        }
        await targetInput.uploadFile(resumeTempPath);
        await this._sleep(1500);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ─── Fill unknown required fields using Gemini AI ───
  async _fillUnknownFieldsWithAI(profile, askAI) {
    const filled = [];
    try {
      const unknowns = await this.page.evaluate(() => {
        function labelFor(input) {
          const id = input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
          const wrapping = input.closest('label');
          const aria = input.getAttribute('aria-label') || '';
          const nearby = input.getAttribute('placeholder') || input.name || input.id || '';
          const heading = input.closest('div, li, fieldset')?.querySelector('label, p, span, legend, div')?.innerText || '';
          return [id?.innerText, wrapping?.innerText, aria, nearby, heading].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        }

        return [...document.querySelectorAll('input, textarea, select')].filter((input) => {
          const type = (input.getAttribute('type') || '').toLowerCase();
          if (['hidden', 'password', 'submit', 'button', 'file', 'checkbox', 'radio'].includes(type)) return false;
          if (input.disabled) return false;
          if (input.tagName === 'SELECT') return false;
          if (input.value && input.value.trim()) return false;
          if (!(input.required || input.getAttribute('aria-required') === 'true')) return false;
          return Boolean(labelFor(input));
        }).slice(0, 5).map((input) => {
          const label = labelFor(input);
          return {
            selector: input.id ? `#${CSS.escape(input.id)}` : `[name="${CSS.escape(input.name || '')}"]`,
            label,
          };
        });
      });

      for (const field of unknowns) {
        if (!field.label) continue;
        try {
          const answer = await askAI(
            `Answer this job application form question concisely for candidate "${profile.fullName || 'Candidate'}": "${field.label}"`
          );
          if (answer) {
            const clean = answer.replace(/^["']|["']$/g, '').trim().slice(0, 500);
            await this.page.evaluate((sel, val) => {
              const el = document.querySelector(sel);
              if (el) {
                const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                setter?.call(el, val);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }, field.selector, clean);
            filled.push('ai_' + field.label.slice(0, 30));
          }
        } catch {}
      }
    } catch {}
    return filled;
  }

  // ─── Try to submit or advance to next section ───
  async _trySubmitOrNext() {
    // Check for Submit button
    const hasSubmit = await this.page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button, input[type="submit"], a')];
      const submit = buttons.find((el) => {
        const text = (el.innerText || el.value || '').trim();
        if (!text) return false;
        if (/sign in with|attach file|paste/i.test(text)) return false;
        return /submit application|^submit$|^apply$|apply now|send application|submit my application/i.test(text);
      });
      if (submit) {
        submit.click();
        return true;
      }
      return false;
    });

    if (hasSubmit) {
      await this._sleep(3000);
      return 'submitted';
    }

    // Check for Next / Continue / Proceed button (including login forms like passport.amazon.jobs)
    const hasNext = await this.page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button, input[type="submit"], a')];
      const next = buttons.find((el) => {
        const text = (el.innerText || el.value || '').trim();
        return /^next$|^continue$|next step|save.?and.?continue|proceed|^sign in$|^log in$/i.test(text);
      });
      if (next) {
        next.click();
        return true;
      }
      return false;
    });

    if (hasNext) {
      await this._sleep(PAGE_WAIT_MS);
      try {
        await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
      } catch {}
      return 'next';
    }

    return 'none';
  }

  async _forceSubmit() {
    const clicked = await this.page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button, input[type="submit"]')];
      const submit = buttons.find((el) => {
        const text = (el.innerText || el.value || '').trim().toLowerCase();
        return text.includes('submit') || text.includes('apply') || text.includes('send');
      });
      if (submit) {
        submit.click();
        return true;
      }
      return false;
    });

    if (clicked) {
      await this._sleep(3000);
      return true;
    }
    return false;
  }

  async _hasEmptyRequiredFields() {
    return await this.page.evaluate(() => {
      return [...document.querySelectorAll('input, textarea, select')].some((input) => {
        const type = (input.getAttribute('type') || '').toLowerCase();
        if (['hidden', 'password', 'submit', 'button', 'file'].includes(type)) return false;
        if (!(input.required || input.getAttribute('aria-required') === 'true')) return false;
        if (type === 'checkbox' || type === 'radio') return false;
        return !String(input.value || '').trim();
      });
    });
  }

  async close() {
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
      this.page = null;
    }
    this.isRunning = false;
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
