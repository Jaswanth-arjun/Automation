/**
 * Who may manage a job posting.
 *
 * A listing can be edited or deleted by the person who posted it and by an
 * administrator. Everyone else only ever applies to it.
 */

export function jobOwner(user) {
  if (!user) return null;
  const id = String(user.id || '').trim();
  const email = String(user.email || user.gmailEmail || '').trim();
  if (!id && !email) return null;
  return {
    id,
    email,
    name: String(user.displayName || user.name || '').trim(),
  };
}

export function isAdminUser(user) {
  if (!user) return false;
  return String(user.role || '').toLowerCase() === 'admin';
}

export function isJobOwner(job, user) {
  if (!job || !user) return false;
  const owner = job.postedBy;
  if (!owner) return false;
  const id = String(user.id || '').trim();
  const email = String(user.email || user.gmailEmail || '').trim().toLowerCase();
  return Boolean(
    (owner.id && id && String(owner.id) === id) ||
    (owner.email && email && String(owner.email).toLowerCase() === email),
  );
}

export function canManageJob(job, user) {
  return isAdminUser(user) || isJobOwner(job, user);
}

/** Jobs this user may manage — their own postings, or everything for an admin. */
export function manageableJobs(jobs, user) {
  if (isAdminUser(user)) return jobs;
  return jobs.filter((job) => isJobOwner(job, user));
}
