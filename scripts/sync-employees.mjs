/**
 * Push employee contacts from this environment (localhost) into another one
 * (production) without storing a single duplicate.
 *
 *   PROD_URL=https://your-app.example EMPLOYEE_SYNC_TOKEN=... npm run sync:employees
 *   npm run sync:employees -- --url https://your-app.example --token ... --dry-run
 *
 * The production endpoint (POST /api/employees/sync) dedupes by email, keeps
 * an employee's existing serial number and returns how many contacts were
 * imported vs already present, so running this again only sends what is still
 * missing.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const argv = process.argv.slice(2);
const argValue = (name) => {
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  const inline = argv.find((item) => item.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : '';
};

const dryRun = argv.includes('--dry-run');
const baseUrl = (argValue('url') || process.env.EMPLOYEE_SYNC_URL || process.env.PROD_URL
  || process.env.PRODUCTION_URL || '').replace(/\/+$/, '');
const token = argValue('token') || process.env.EMPLOYEE_SYNC_TOKEN || '';
const filePath = argValue('file') || join(process.cwd(), 'data', 'employees.json');
const BATCH_SIZE = Number(argValue('batch') || 500);

if (!dryRun && !baseUrl) {
  console.error('❌ Pass the target app URL: --url https://your-production-domain (or set PROD_URL).');
  process.exit(1);
}

if (!existsSync(filePath)) {
  console.error(`❌ No employee file at ${filePath}.`);
  process.exit(1);
}

let local = [];
try {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  local = Array.isArray(parsed) ? parsed : [];
} catch (err) {
  console.error(`❌ Could not read ${filePath}: ${err.message}`);
  process.exit(1);
}

// Dedupe locally first: one row per email, keeping the lowest serial number.
const byEmail = new Map();
for (const row of local) {
  const email = String(row?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) continue;
  const existing = byEmail.get(email);
  if (!existing || (Number(row.sno) > 0 && (!(Number(existing.sno) > 0) || Number(row.sno) < Number(existing.sno)))) {
    byEmail.set(email, {
      name: String(row.name || '').trim(),
      company: String(row.company || '').trim(),
      role: String(row.role || '').trim(),
      email,
      details: String(row.details || '').trim(),
      sno: Number(row.sno) || 0,
    });
  }
}
const contacts = [...byEmail.values()];

console.log(`📇 ${local.length} local rows → ${contacts.length} distinct employee emails.`);
if (dryRun) {
  console.log(`🔎 Dry run: would POST ${contacts.length} contacts to ${baseUrl || '(no url)'} in batches of ${BATCH_SIZE}. Nothing was sent.`);
  process.exit(0);
}

let imported = 0;
let enriched = 0;
let skipped = 0;
let total = 0;

for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
  const batch = contacts.slice(i, i + BATCH_SIZE);
  let res;
  try {
    res = await fetch(`${baseUrl}/api/employees/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ employees: batch }),
    });
  } catch (err) {
    console.error(`❌ Network error on batch ${i / BATCH_SIZE + 1}: ${err.message}`);
    process.exit(1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`❌ Batch ${i / BATCH_SIZE + 1} failed (${res.status}): ${text.slice(0, 400)}`);
    if (res.status === 401) {
      console.error('   Set EMPLOYEE_SYNC_TOKEN on the target environment and pass the same value with --token.');
    }
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  imported += Number(data.imported) || 0;
  enriched += Number(data.enriched) || 0;
  skipped += Number(data.skipped) || 0;
  total = Number(data.total) || total;
  console.log(`   batch ${Math.floor(i / BATCH_SIZE) + 1}: +${data.imported || 0} new, ${data.enriched || 0} enriched, ${data.skipped || 0} already present.`);
}

console.log(`✅ Sync complete → ${imported} new contacts added, ${enriched} enriched, ${skipped} already present.`);
if (total) console.log(`   Target directory now holds ${total} distinct employee contacts.`);
