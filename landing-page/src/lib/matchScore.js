/**
 * Match Score Service
 * Calculates profile/job compatibility score using keyword matching.
 * Architecture-ready for future AI/LLM-based scoring replacement.
 */

export function calculateMatchScore(userProfile, job) {
  if (!userProfile || !job) return { score: 0, explanation: '', matched: [], missing: [] };

  const userSkills = (userProfile.skills || []).map(s => s.toLowerCase().trim());
  const userExperience = (userProfile.experience || []).map(e => (e.title + ' ' + e.description).toLowerCase());
  const userProjects = (userProfile.projects || []).map(p => (p.title + ' ' + p.technologies).toLowerCase());
  const userEducation = (userProfile.education || []).map(e => (e.degree + ' ' + e.branch).toLowerCase());

  const allUserText = [...userSkills, ...userExperience, ...userProjects, ...userEducation].join(' ');

  const requiredSkills = (job.requiredSkills || job.skills || []).map(s => s.toLowerCase().trim());
  const preferredSkills = (job.preferredSkills || []).map(s => s.toLowerCase().trim());

  // Skill matching
  const matched = [];
  const missing = [];
  let reqMatched = 0;

  requiredSkills.forEach(skill => {
    if (userSkills.includes(skill) || allUserText.includes(skill)) {
      matched.push(skill);
      reqMatched++;
    } else {
      missing.push(skill);
    }
  });

  let prefMatched = 0;
  preferredSkills.forEach(skill => {
    if (userSkills.includes(skill) || allUserText.includes(skill)) {
      matched.push(skill);
      prefMatched++;
    }
  });

  // Experience match
  const reqExp = job.experienceMin || 0;
  const userExp = userProfile.yearsOfExperience || 0;
  const expScore = reqExp === 0 ? 1 : Math.min(1, userExp / Math.max(reqExp, 1));

  // Calculate composite score
  const reqScore = requiredSkills.length > 0 ? reqMatched / requiredSkills.length : 0.5;
  const prefScore = preferredSkills.length > 0 ? prefMatched / preferredSkills.length : 0.5;

  const rawScore = (reqScore * 0.55) + (prefScore * 0.2) + (expScore * 0.25);
  const score = Math.round(Math.min(100, Math.max(0, rawScore * 100)));

  // Generate explanation
  let explanation = '';
  if (matched.length > 0) {
    const topMatched = matched.slice(0, 3).map(s => s.charAt(0).toUpperCase() + s.slice(1));
    explanation = `Strong match in ${topMatched.join(', ')}`;
  }
  if (missing.length > 0 && missing.length <= 3) {
    explanation += explanation ? '. ' : '';
    explanation += `Missing: ${missing.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}`;
  }

  return {
    score,
    explanation: explanation || 'Profile compatibility assessment',
    matched: matched.map(s => s.charAt(0).toUpperCase() + s.slice(1)),
    missing: missing.map(s => s.charAt(0).toUpperCase() + s.slice(1)),
  };
}

/**
 * Precompute match scores for a list of jobs against a user profile
 */
export function computeJobScores(userProfile, jobs) {
  return jobs.map(job => ({
    ...job,
    matchResult: calculateMatchScore(userProfile, job),
  }));
}
