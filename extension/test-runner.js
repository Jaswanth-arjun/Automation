/* Phase 0 harness: run 30 real job URLs through the real extension in dry-run
 * mode (fill, never submit) and record a deterministic terminal state for each.
 *
 * Open this page as chrome-extension://<extension-id>/test-runner.html.
 * Add ?autorun=1 to start immediately.
 */
(function () {
  'use strict';

  const RUN_TIMEOUT_MS = 6 * 60 * 1000;
  const POLL_MS = 1200;

  // 30 URLs: public ATS boards (expected to reach the form) plus auth-walled
  // sites (expected to end as LOGIN_REQUIRED/NEEDS_USER, not counted as bugs).
  const URLS = [
    { ats: 'greenhouse', url: 'https://job-boards.greenhouse.io/gitlab/jobs/8638232002', company: 'GitLab', title: 'AI Transformation Owner, CRO' },
    { ats: 'greenhouse', url: 'https://job-boards.greenhouse.io/gitlab/jobs/8771512002', company: 'GitLab', title: 'Backend Engineer, GitLab Orbit' },
    { ats: 'greenhouse', url: 'https://boards.greenhouse.io/figma/jobs/5426468004?gh_jid=5426468004', company: 'Figma', title: 'Account Executive, Enterprise' },
    { ats: 'greenhouse', url: 'https://boards.greenhouse.io/figma/jobs/5579204004?gh_jid=5579204004', company: 'Figma', title: 'Account Executive, Enterprise (Bengaluru)' },
    { ats: 'greenhouse', url: 'https://careers.duolingo.com/jobs/8851677002?gh_jid=8851677002', company: 'Duolingo', title: 'Ad Sales Lead, Programmatic' },
    { ats: 'greenhouse', url: 'https://job-boards.greenhouse.io/discord/jobs/8945798002', company: 'Discord', title: 'Account Executive, Media & Entertainment' },
    { ats: 'greenhouse', url: 'https://stripe.com/jobs/search?gh_jid=8172510', company: 'Stripe', title: 'Abuse Investigator' },
    { ats: 'greenhouse', url: 'https://databricks.com/company/careers/open-positions/job?gh_jid=6918763002', company: 'Databricks', title: 'Account Executive' },

    { ats: 'lever', url: 'https://jobs.lever.co/spotify/2a55d6c9-c564-443a-be3e-a3851db5a93b/apply', company: 'Spotify', title: 'Account Executive - Commercial' },
    { ats: 'lever', url: 'https://jobs.lever.co/spotify/2d67c471-9015-41c0-a041-b982ec4a14fd/apply', company: 'Spotify', title: 'Account Executive - Commercial' },

    { ats: 'ashby', url: 'https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245', company: 'Ramp', title: 'Software Engineer, Security, Cloud' },
    { ats: 'ashby', url: 'https://jobs.ashbyhq.com/linear/d3bc1ced-3ce4-4086-a050-555055dbb1ff', company: 'Linear', title: 'Senior / Staff Fullstack Engineer' },
    { ats: 'ashby', url: 'https://jobs.ashbyhq.com/vanta/7e8b02ec-cf23-41de-87c7-3910459f34a2', company: 'Vanta', title: 'Account Executive, Early Stage' },
    { ats: 'ashby', url: 'https://jobs.ashbyhq.com/openai/8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3', company: 'OpenAI', title: 'Technical Program Manager, Compute' },
    { ats: 'ashby', url: 'https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a', company: 'Notion', title: 'Software Engineer, AI Connections' },
    { ats: 'ashby', url: 'https://jobs.ashbyhq.com/cursor/d02cb5cc-496f-4998-80a7-87c20312c82c', company: 'Cursor', title: 'Field Engineer, Life Sciences' },

    { ats: 'workday', url: 'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Remote/Senior-Automation-Infrastructure-Engineer_JR2025805', company: 'NVIDIA', title: 'Senior Automation Infrastructure Engineer' },
    { ats: 'workday', url: 'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Integration-Engineer--End-to-End-Model---Autonomous-Vehicles_JR2025038', company: 'NVIDIA', title: 'Senior Integration Engineer' },
    { ats: 'workday', url: 'https://salesforce.wd12.myworkdayjobs.com/en-US/External_Career_Site/job/India---Gurgaon/Named-Account-Executive_JR368888', company: 'Salesforce', title: 'Named Account Executive' },
    { ats: 'workday', url: 'https://cisco.wd5.myworkdayjobs.com/en-US/Cisco_Careers/job/San-Jose-California-US/Hardware-Engineer_2021702', company: 'Cisco', title: 'Hardware Engineer' },

    { ats: 'workable', url: 'https://apply.workable.com/j/81B46579FE', company: 'Hugging Face', title: 'Open-Source ML Engineer - EMEA Remote' },
    { ats: 'workable', url: 'https://apply.workable.com/j/19A136F8E2', company: 'Hugging Face', title: 'Open-Source ML Engineer - US Remote' },
    { ats: 'workable', url: 'https://apply.workable.com/j/9E2A4C02C7', company: 'Hugging Face', title: 'Senior ML Engineer, Voice Agents' },
    { ats: 'workable', url: 'https://apply.workable.com/j/DB4D7C0EC8', company: 'Hugging Face', title: 'Senior Open-Source Python Engineer' },

    { ats: 'company', url: 'https://www.shopify.com/careers/apply?job_id=8bb0e0c3-9a04-4c2e-b0f5-1b6f5a9ff0f5', company: 'Shopify', title: 'Senior Software Engineer' },
    { ats: 'company', url: 'https://careers.google.com/jobs/results/1234567890-software-engineer/', company: 'Google', title: 'Software Engineer' },
    { ats: 'company', url: 'https://careers.dhl.com/global/en/search-results', company: 'DHL', title: 'Career search page' },

    { ats: 'linkedin', url: 'https://www.linkedin.com/jobs/view/4000000001/', company: 'LinkedIn', title: 'Easy Apply sample' },
    { ats: 'indeed', url: 'https://www.indeed.com/viewjob?jk=0000000000000000', company: 'Indeed', title: 'Software Engineer' },
    { ats: 'naukri', url: 'https://www.naukri.com/job-listings-software-engineer', company: 'Naukri', title: 'Software Engineer' },
  ];

  const PROFILE = {
    firstName: 'Teja',
    lastName: 'Narra',
    fullName: 'Teja Narra',
    email: 'teja.narra.harness@example.com',
    phone: '+919876543210',
    phoneCountry: 'India (+91)',
    address: '12 MG Road',
    city: 'Hyderabad',
    state: 'Telangana',
    zip: '500001',
    country: 'India',
    location: 'Hyderabad, India',
    linkedin: 'https://www.linkedin.com/in/teja-narra',
    github: 'https://github.com/teja-narra',
    portfolio: 'https://teja-narra.dev',
    company: 'Hamzooh',
    currentCompany: 'Hamzooh',
    jobTitle: 'Senior Software Engineer',
    experience: '7',
    yearsExperience: '7',
    education: "Bachelor's Degree",
    school: 'JNTU Hyderabad',
    degree: 'B.Tech Computer Science',
    graduationYear: '2018',
    workAuthorization: 'Yes',
    authorizedToWork: 'Yes',
    requiresSponsorship: 'No',
    visaStatus: 'Indian citizen — authorized to work in India',
    noticePeriod: '30 days',
    salaryExpectation: '3500000',
    desiredSalary: '3500000',
    gender: 'Male',
    veteranStatus: 'I am not a protected veteran',
    disabilityStatus: 'No, I do not have a disability',
    race: 'Asian',
    hispanic: 'No',
  };

  const ANSWERS = {
    'are you legally authorized to work': 'Yes',
    'will you now or in the future require sponsorship': 'No',
    'do you require sponsorship': 'No',
    'how many years of experience': '7',
    'notice period': '30 days',
    'expected salary': '3500000',
    'current salary': '2800000',
    'desired salary': '3500000',
    'are you willing to relocate': 'Yes',
    'do you have a bachelor': 'Yes',
    'highest level of education': "Bachelor's Degree",
    'why do you want to work': 'I build reliable automation systems and want to work on products at this scale.',
    'pronouns': 'He/Him',
    'gender': 'Male',
    'veteran status': 'I am not a protected veteran',
    'disability status': 'No, I do not have a disability',
    'race': 'Asian',
    'ethnicity': 'Asian',
  };

  // Minimal but valid one-page PDF so the file input accepts the upload.
  function makeResumeBase64() {
    const lines = [
      'Teja Narra',
      'Senior Software Engineer',
      'teja.narra.harness@example.com | +91 98765 43210 | Hyderabad, India',
      '',
      'EXPERIENCE',
      'Hamzooh - Senior Software Engineer (2021 - Present)',
      'Built browser automation, Chrome extensions, and AI-assisted workflows.',
      '',
      'SKILLS',
      'JavaScript, TypeScript, Node.js, Chrome Extensions, Puppeteer, React',
    ];
    const text = lines.map((line, index) => `BT /F1 11 Tf 60 ${720 - index * 16} Td (${line.replace(/[()\\]/g, '')}) Tj ET`).join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((body, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return btoa(pdf);
  }

  const state = {
    running: false,
    stopRequested: false,
    results: [],
    logs: {},
  };

  const $ = (id) => document.getElementById(id);
  const rows = $('rows');
  const logEl = $('log');

  function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    logEl.textContent += `${line}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
          resolve(response || {});
        });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function renderRow(result, index) {
    const tr = document.createElement('tr');
    const statusClass = result.code === 'REVIEW_READY' || result.code === 'SUBMITTED' ? 'pass'
      : ['LOGIN_REQUIRED', 'CAPTCHA', 'MISSING_ANSWER', 'ACCOUNT_CREATION', 'NEEDS_USER_GENERIC'].includes(result.code) ? 'needs' : 'fail';
    tr.className = statusClass;
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${result.ats}</td>
      <td><code>${result.url}</code></td>
      <td><span class="pill ${statusClass === 'pass' ? 'ok' : statusClass === 'needs' ? 'warn' : 'bad'}">${result.status}</span></td>
      <td>${result.code || '—'}</td>
      <td>${result.reachedForm ? '✓' : '✗'}</td>
      <td>${result.fieldsDetected ?? '—'}</td>
      <td>${result.fieldsFilled ?? '—'}</td>
      <td>${result.resumeAttached ? '✓' : '✗'}</td>
      <td>${result.nextClicks ?? '—'}</td>
      <td>${result.reachedReview ? '✓' : '✗'}</td>
      <td>${(result.failureReason || '').slice(0, 160)}</td>`;
    rows.appendChild(tr);
  }

  function summarize(run, meta, timedOut) {
    const steps = run?.steps || [];
    const stepNames = steps.map((s) => s.step);
    const complete = steps.filter((s) => s.step === 'complete').pop();
    const formFilled = steps.filter((s) => s.step === 'form_filled').pop();
    const frameReports = steps.filter((s) => s.step === 'frame_report');
    const maxDetected = Math.max(
      Number(formFilled?.data?.fieldsDetected || 0),
      ...frameReports.map((s) => Number(s.data?.inputs || 0)),
      0,
    );
    const filled = Number(complete?.data?.filledCount ?? formFilled?.data?.filledCount ?? run?.metrics?.filledCount ?? 0);
    const code = run?.reasonCode || complete?.data?.reasonCode || (timedOut ? 'TIMEOUT' : 'NEEDS_USER_GENERIC');
    const reviewReady = Boolean(complete?.data?.reviewReady)
      || code === 'REVIEW_READY'
      || (Boolean(complete?.data?.submitButton) && filled > 0)
      || stepNames.includes('confirming');
    return {
      ats: meta.ats,
      url: meta.url,
      company: meta.company,
      title: meta.title,
      runId: run?.runId || '',
      status: timedOut ? 'TIMEOUT' : (run?.status || 'NEEDS_USER'),
      code,
      reachedForm: stepNames.includes('form_filled') || Boolean(formFilled)
        || frameReports.some((s) => Number(s.data?.inputs || 0) > 0 || s.data?.hasForm),
      fieldsDetected: maxDetected,
      fieldsFilled: filled,
      resumeAttached: Boolean(complete?.data?.resumeAttached ?? formFilled?.data?.resumeAttached) || stepNames.includes('resume_attached'),
      nextClicks: Number(complete?.data?.nextClicks ?? formFilled?.data?.nextClicks ?? 0),
      reachedReview: reviewReady,
      failureReason: timedOut
        ? 'Run exceeded 6 minutes without a terminal state (hang).'
        : (complete?.message || run?.reason || 'No completion event recorded.'),
      durationMs: run?.endedAt && run?.startedAt ? run.endedAt - run.startedAt : null,
    };
  }

  async function runOne(meta) {
    const started = Date.now();
    const open = await send({
      type: 'HAMZOOH_OPEN_JOB',
      url: meta.url,
      dryRun: true,

      profile: PROFILE,
      answers: ANSWERS,
      resumeBase64: makeResumeBase64(),
      resumeName: 'teja-narra-resume.pdf',
      resumeText: 'Teja Narra — Senior Software Engineer. Automation, Chrome extensions, Node.js.',
      jobTitle: meta.title,
      company: meta.company,
    });

    if (!open?.ok || !open.runId) {
      return {
        ats: meta.ats, url: meta.url, company: meta.company, title: meta.title,
        runId: '', status: 'FAILED', code: 'OPEN_FAILED', reachedForm: false,
        fieldsDetected: 0, fieldsFilled: 0, resumeAttached: false, nextClicks: 0,
        reachedReview: false, failureReason: open?.error || 'Background refused to open the job.',
        durationMs: Date.now() - started,
      };
    }

    log(`#${meta.ats} started ${meta.url} (${open.runId})`);
    let run = null;
    let timedOut = false;
    while (Date.now() - started < RUN_TIMEOUT_MS && !state.stopRequested) {
      await sleep(POLL_MS);
      const res = await send({ type: 'HAMZOOH_GET_RUN', runId: open.runId });
      run = res?.run || null;
      if (run && run.status && run.status !== 'RUNNING') break;
    }
    if (!run || run.status === 'RUNNING') timedOut = true;

    const result = summarize(run, meta, timedOut);
    state.logs[open.runId] = run || { runId: open.runId, error: 'no run data' };
    if (open.tabId) {
      try { chrome.tabs.remove(open.tabId); } catch { /* already closed */ }
    }
    log(`   → ${result.status} / ${result.code} · form=${result.reachedForm} filled=${result.fieldsFilled} review=${result.reachedReview}`);
    return result;
  }

  async function runAll() {
    if (state.running) return;
    state.running = true;
    state.stopRequested = false;
    state.results = [];
    state.logs = {};
    rows.innerHTML = '';
    $('run').disabled = true;
    $('stop').disabled = false;
    $('dl-json').disabled = true;
    $('dl-csv').disabled = true;
    $('dl-logs').disabled = true;
    await send({ type: 'HAMZOOH_CLEAR_RUNS' });

    for (let i = 0; i < URLS.length; i += 1) {
      if (state.stopRequested) break;
      $('status').textContent = `Running ${i + 1}/${URLS.length} · ${URLS[i].ats}`;
      let result;
      try {
        result = await runOne(URLS[i]);
      } catch (err) {
        result = {
          ats: URLS[i].ats, url: URLS[i].url, company: URLS[i].company, title: URLS[i].title,
          runId: '', status: 'FAILED', code: 'HARNESS_ERROR', reachedForm: false,
          fieldsDetected: 0, fieldsFilled: 0, resumeAttached: false, nextClicks: 0,
          reachedReview: false, failureReason: err.message, durationMs: null,
        };
        log(`   × harness error: ${err.message}`);
      }
      state.results.push(result);
      renderRow(result, i);
      try {
        await chrome.storage.local.set({ hamzoohHarnessResults: { at: Date.now(), results: state.results } });
      } catch { /* storage best-effort */ }
    }

    state.running = false;
    $('run').disabled = false;
    $('stop').disabled = true;
    $('dl-json').disabled = false;
    $('dl-csv').disabled = false;
    $('dl-logs').disabled = false;
    const pass = state.results.filter((r) => r.code === 'REVIEW_READY').length;
    const needs = state.results.filter((r) => ['LOGIN_REQUIRED', 'CAPTCHA', 'MISSING_ANSWER', 'ACCOUNT_CREATION'].includes(r.code)).length;
    $('status').textContent = `Done · ${state.results.length} runs · ${pass} review-ready · ${needs} need user · ${state.results.length - pass - needs} failed`;
    log($('status').textContent);
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function toCsv(results) {
    const headers = ['ats', 'url', 'status', 'code', 'reachedForm', 'fieldsDetected', 'fieldsFilled', 'resumeAttached', 'nextClicks', 'reachedReview', 'failureReason', 'durationMs'];
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    return [headers.join(','), ...results.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
  }

  $('run').addEventListener('click', runAll);
  $('stop').addEventListener('click', () => {
    state.stopRequested = true;
    $('status').textContent = 'Stopping after the current URL…';
  });
  $('dl-json').addEventListener('click', () => download('hamzooh-phase0-results.json', JSON.stringify(state.results, null, 2)));
  $('dl-csv').addEventListener('click', () => download('hamzooh-phase0-results.csv', toCsv(state.results), 'text/csv'));
  $('dl-logs').addEventListener('click', () => download('hamzooh-phase0-run-logs.json', JSON.stringify(state.logs, null, 2)));

  (async () => {
    try {
      const stored = await chrome.storage.local.get('hamzoohHarnessResults');
      const previous = stored?.hamzoohHarnessResults;
      if (previous?.results?.length) {
        state.results = previous.results;
        state.results.forEach((result, index) => renderRow(result, index));
        $('status').textContent = `Loaded ${state.results.length} previous results (${new Date(previous.at).toLocaleString()})`;
        $('dl-json').disabled = false;
        $('dl-csv').disabled = false;
      }
    } catch { /* ignore */ }
    if (new URLSearchParams(location.search).get('autorun') === '1') runAll();
  })();

  window.__HAMZOOH_HARNESS__ = { URLS, runAll, state };
})();
