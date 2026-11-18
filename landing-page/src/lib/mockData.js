/**
 * Demo / Mock Data
 * Dummy jobs have been cleared so only real admin-posted jobs are displayed.
 */

export const DEMO_JOBS = [];

export const DEMO_APPLICATIONS = [];

export const DEMO_STATS = {
  applications: 0,
  matchedJobs: 0,
  outreach: 0,
  responses: 0,
  interviews: 0,
};

export const DEFAULT_PROFILE = {
  fullName: '',
  email: '',
  phone: '',
  location: '',
  batch: '',
  skills: [],
  education: [],
  experience: [],
  projects: [],
  links: { github: '', linkedin: '', portfolio: '', other: '' },
  preferences: { roles: [], locations: [], jobTypes: [], minExperience: 0 },
  yearsOfExperience: 0,
};
