import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAtsScore } from '../landing-page/src/lib/atsScore.js';

const JOB_TITLE = 'Software Engineer Intern';
const KEYWORDS = ['AI', 'Go', 'Java', 'JavaScript', 'SQL', 'Kubernetes', 'Git', 'PostgreSQL', 'Python', 'React'];

const STRONG_RESUME = `NELLURI JASWANTH
Hyderabad, India | jaswanth@example.com | +91 98765 43210
linkedin.com/in/jaswanth | github.com/jaswanth

SUMMARY
Software Engineer Intern focused on AI platforms. Built 4 production services.

SKILLS
AI, Go, Java, JavaScript, SQL, Kubernetes, Git, PostgreSQL, Python, React

EXPERIENCE
Software Engineer Intern, Acme (2025)
Built 3 internal tools that cut manual work by 40%.
Automated release checks, reducing failed deploys by 25%.
Optimized SQL queries, improving dashboard load by 60%.
Developed REST APIs used by 1200 users daily.

PROJECTS
Campus Portal
Designed a React dashboard handling 800 sessions per day.

EDUCATION
B.Tech Computer Science, JNTU (2026)`;

test('a strong tailored resume scores 80+ and never a fake 100', () => {
  const ats = calculateAtsScore({
    resumeText: STRONG_RESUME,
    jobKeywords: KEYWORDS,
    matchedKeywords: KEYWORDS,
    jobTitle: JOB_TITLE,
    pageCount: 1,
  });
  assert.ok(ats.score >= 80, `expected 80+, got ${ats.score}`);
  assert.ok(ats.score <= 98, 'estimate stays below 100');
});

test('full keyword coverage alone does not force one fixed score', () => {
  const strong = calculateAtsScore({ resumeText: STRONG_RESUME, jobKeywords: KEYWORDS, matchedKeywords: KEYWORDS, jobTitle: JOB_TITLE, pageCount: 1 });
  // Same keywords, but the resume lost its contact block, links and numbers.
  const thin = calculateAtsScore({
    resumeText: `SUMMARY\nSoftware Engineer Intern who writes code and ships features.\nSKILLS\nAI, Go, Java, JavaScript, SQL, Kubernetes, Git, PostgreSQL, Python, React\nEXPERIENCE\nWorked on internal tools for the team.\nEDUCATION\nB.Tech`,
    jobKeywords: KEYWORDS,
    matchedKeywords: KEYWORDS,
    jobTitle: JOB_TITLE,
    pageCount: 1,
  });
  assert.ok(strong.score > thin.score, 'different resumes must not share one score');
  assert.ok(thin.score < 90, `thin resume should lose points, got ${thin.score}`);
});

test('missing keywords and unchecked sections lower the score', () => {
  const half = calculateAtsScore({
    resumeText: STRONG_RESUME,
    jobKeywords: KEYWORDS,
    matchedKeywords: KEYWORDS.slice(0, 5),
    jobTitle: JOB_TITLE,
    pageCount: 1,
  });
  const full = calculateAtsScore({ resumeText: STRONG_RESUME, jobKeywords: KEYWORDS, matchedKeywords: KEYWORDS, jobTitle: JOB_TITLE, pageCount: 1 });
  assert.ok(full.score > half.score);
});

test('an empty resume scores zero instead of a placeholder number', () => {
  assert.equal(calculateAtsScore({ resumeText: '' }).score, 0);
  assert.equal(calculateAtsScore({ resumeText: '   ' }).score, 0);
});
