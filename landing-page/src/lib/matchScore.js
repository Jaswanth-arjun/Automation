/**
 * Backwards-compatible entry points for match scoring.
 *
 * The real engine lives in `jobMatch.js` (personalised, evidence-based, cached).
 * These wrappers keep the existing call sites working while guaranteeing that
 * every score now comes from the user's own resume + profile + the job's JD —
 * never from a default or simulated value.
 */
import { getJobMatchScore, scoreJobs } from './jobMatch';

export {
  buildUserEvidence,
  clearMatchCache,
  getActiveResume,
  getProfileReadiness,
  jobVersion,
  normalizeJob,
  scoreJobMatch,
  scoreJobs,
  PROFILE_TODO,
} from './jobMatch';

/** Personalised score for one job. Returns `status: 'incomplete'` when the
 *  profile/resume does not hold enough evidence to score honestly. */
export function calculateMatchScore(profile, job, options = {}) {
  return getJobMatchScore(profile, job, options);
}

/** Personalised scores for a list of jobs (cached per job + profile + resume). */
export function computeJobScores(profile, jobs, options = {}) {
  return scoreJobs(profile, jobs, options);
}
