// Turns the auto-apply task record into plain-English progress.
//
// The backend records technical step ids ("agent_action", "checkpoint") and
// machine-ish messages. The popup must explain what the automation is doing to
// the candidate, so every raw step is translated here — and steps that only
// describe internals are dropped instead of dumped like terminal output.

export const AUTOMATION_PHASES = [
  { id: 'open', title: 'Opens the application', detail: 'Loads the employer’s posting in a new tab and hands it to your extension.' },
  { id: 'fill', title: 'Fills your details', detail: 'Writes your profile, resume and saved answers into each field.' },
  { id: 'check', title: 'Checks each answer', detail: 'Stops and asks when a required fact is missing — it never guesses.' },
  { id: 'approve', title: 'You approve', detail: 'You see what was filled before anything is sent.' },
  { id: 'submit', title: 'Submits & confirms', detail: 'Sends the approved application and verifies the confirmation page.' },
];

const PHASE_BY_STATUS = {
  initializing: 0,
  connecting_browser: 0,
  analyzing_job: 0,
  preparing_application: 1,
  filling_application: 1,
  waiting_for_user_input: 2,
  waiting_for_approval: 3,
  submitting: 4,
  submitted: 4,
  paused: 1,
  failed: 1,
  cancelled: 1,
};

export function automationPhaseIndex(status) {
  const index = PHASE_BY_STATUS[String(status || '')];
  return Number.isInteger(index) ? index : 0;
}

/** Phases with `done` / `active` / `pending` for the status rail. */
export function automationPhases(status) {
  const current = automationPhaseIndex(status);
  const finished = status === 'submitted';
  return AUTOMATION_PHASES.map((phase, index) => ({
    ...phase,
    state: finished || index < current ? 'done' : index === current ? 'active' : 'pending',
  }));
}

const HIDDEN_STEPS = new Set(['agent_action', 'agent_observe', 'update', 'heartbeat', 'checkpoint']);

function clean(message) {
  return String(message || '')
    .replace(/\s*on element \d+/gi, '')
    .replace(/\bchose (fill|click|select|check|upload_resume|press_key|scroll|wait|done)\b/gi, 'worked on the form')
    .replace(/\bobserved \d+ element\(s\)\b/gi, 'read the page')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentence(value) {
  const text = clean(value).replace(/^[•\-–\s]+/, '');
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function clip(value, max = 180) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const REWRITES = [
  [/^Automation task created for (.+?)\.?$/i, (m) => ['Started your application', `Preparing ${m[1]}.`, 'info']],
  [/^Analyzing the job and your resumes\.?$/i, () => ['Read the job requirements', 'Choosing the resume and details that fit this role best.', 'info']],
  [/^Selected (.+?)\.\s+([\s\S]+)$/i, (m) => [`Using ${m[1]}`, clip(sentence(m[2])), 'success']],
  [/^Selected (.+?)\.?$/i, (m) => [`Using ${m[1]}`, 'Chosen as the closest match for this job.', 'success']],
  [/^Agent observed (\d+) element/i, (m) => ['Read the application form', `${m[1]} fields and controls found on the page.`, 'info']],
  [/^Agent says the form is ready/i, () => ['Checked the whole form', 'Everything required is filled — it is ready for your review.', 'success']],
  [/^Agent said done but (\d+) required field/i, (m) => ['Still filling the form', `${m[1]} required field${m[1] === '1' ? '' : 's'} left, so it kept going instead of stopping.`, 'warn']],
  [/^Agent needs an answer to:\s*([\s\S]+)$/i, (m) => ['It needs one answer from you', clip(sentence(m[1])), 'warn']],
  [/^Agent paused:\s*([\s\S]+)$/i, (m) => ['Paused for you', clip(sentence(m[1])), 'warn']],
  [/^Resume selection fell back/i, () => ['Used the resume you had open', 'Automatic ranking was unavailable, so it attached the supplied file.', 'warn']],
  [/^Autopilot task created for ([\s\S]+)$/i, (m) => ['Started your application', `Preparing ${clean(m[1])}.`, 'info']],
];

/**
 * One meaningful feed item, or null when the step is internal only.
 * `at` stays raw so the UI can render a relative time.
 */
export function friendlyStep(step = {}) {
  const id = String(step.step || step.id || '');
  const level = String(step.level || 'info');
  const at = step.at || step.timestamp || '';
  const raw = String(step.message || '').trim();
  if (!raw) return null;

  const build = (title, detail, tone) => ({
    key: `${id}-${raw.slice(0, 40)}`,
    title,
    detail: clip(detail, 200),
    tone,
    at,
  });

  if (level === 'error' || /error|failed/i.test(id)) {
    return build('Hit a problem', sentence(raw), 'error');
  }

  for (const [pattern, render] of REWRITES) {
    const match = raw.match(pattern);
    if (match) return build(...render(match));
  }

  if (HIDDEN_STEPS.has(id) && level === 'info') return null;

  return build(sentence(raw), '', level === 'warn' ? 'warn' : 'info');
}

/** Newest first, consecutive duplicates collapsed, internal steps removed. */
export function buildActivityFeed(steps = [], limit = 8) {
  const items = [];
  for (const step of steps || []) {
    const item = friendlyStep(step);
    if (!item) continue;
    const previous = items[items.length - 1];
    if (previous && previous.title === item.title) {
      items[items.length - 1] = { ...item, detail: item.detail || previous.detail };
      continue;
    }
    items.push(item);
  }
  return items.slice(-limit).reverse();
}

/** "What is it doing right now" — one sentence per task status. */
export function automationNow(task = {}) {
  const status = String(task.status || 'initializing');
  const checkpoint = task.checkpoint || {};
  const filled = Number(checkpoint.filledCount || task.review?.filledCount || 0);
  const empty = Number(checkpoint.emptyCount || 0);
  switch (status) {
    case 'initializing':
      return { title: 'Getting ready', detail: 'Opening a fresh tab and connecting the Hamzooh extension.', tone: 'info' };
    case 'connecting_browser':
      return { title: 'Connecting to your browser', detail: 'Waiting for the extension to report the application page.', tone: 'info' };
    case 'analyzing_job':
      return { title: 'Reading this job', detail: 'Picking the resume and profile details that fit it best.', tone: 'info' };
    case 'preparing_application':
      return { title: 'Opening the application', detail: 'Finding the form on the employer’s page.', tone: 'info' };
    case 'filling_application':
      return {
        title: 'Filling the form',
        detail: filled
          ? `${filled} field${filled === 1 ? '' : 's'} filled${empty ? ` · ${empty} still empty` : ''}.`
          : 'Writing your details into each field, one at a time.',
        tone: 'info',
      };
    case 'waiting_for_user_input':
      return { title: 'It needs one answer', detail: 'A required question cannot be guessed — answer below and it continues from there.', tone: 'warn' };
    case 'waiting_for_approval':
      return { title: 'Ready for your review', detail: 'Check the summary below, then approve to submit.', tone: 'success' };
    case 'submitting':
      return { title: 'Submitting your application', detail: 'Sending the form you approved.', tone: 'info' };
    case 'submitted':
      return { title: 'Application submitted', detail: 'The employer’s confirmation page was verified.', tone: 'success' };
    case 'paused':
      return { title: 'Paused', detail: 'Everything is saved — resume whenever you are ready.', tone: 'warn' };
    case 'failed':
      return { title: 'Stopped before submitting', detail: 'The reason is listed below; nothing was sent.', tone: 'error' };
    case 'cancelled':
      return { title: 'Cancelled', detail: 'Nothing was submitted to the employer.', tone: 'info' };
    default:
      return { title: 'Working', detail: '', tone: 'info' };
  }
}

export function relativeTime(value) {
  if (!value) return '';
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, (Date.now() - time) / 1000);
  if (seconds < 8) return 'just now';
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}
