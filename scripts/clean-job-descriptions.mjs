// One-time cleanup: strip scraped site chrome (navigation, footers, cookie
// banners, legal/EEO boilerplate, job metadata blocks) from descriptions that
// were imported before the cleaner existed in lib/job-import.js.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { structureJobDescription, dropHeaderLines } from '../lib/job-import.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, '..', 'data', 'jobs.json');

const dryRun = process.argv.includes('--dry-run');
const jobs = JSON.parse(fs.readFileSync(file, 'utf8'));

let changed = 0;
const next = jobs.map((job) => {
  const cleaned = dropHeaderLines(
    structureJobDescription(job.description || ''),
    job.role || job.title || '',
    job.company || '',
    job.filters?.workMode || job.filters?.location || '',
  );
  if (cleaned && cleaned !== job.description) {
    changed += 1;
    return { ...job, description: cleaned };
  }
  return job;
});

if (dryRun) {
  for (const job of next) {
    console.log(`\n===== ${job.role} — ${job.company} =====\n`);
    console.log(job.description);
  }
  console.log(`\n[dry-run] ${changed}/${jobs.length} descriptions would change.`);
} else {
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  console.log(`Cleaned ${changed}/${jobs.length} job descriptions in ${file}`);
}
