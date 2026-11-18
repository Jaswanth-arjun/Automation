import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocumentProxy } from 'unpdf';
import { modernResumeHtml, renderFittedResumePdf } from '../lib/resume-pdf.js';

const fixture = {
  name: 'NELLURU JASWANTH',
  email: 'nellurujaswanth2004@gmail.com',
  phone: '+91 9440552825',
  linkedin: 'https://www.linkedin.com/in/nelluru-jaswanth-a611ba2b3',
  github: 'https://github.com/Jaswanth-arjun/course-automation',
  summary: 'Computer Science undergraduate developing backend services and automation workflows.',
  education: [{ school: 'Institute of Science and Technology', degree: 'B.Tech in Computer Science', dates: '2023 - 2027', detail: 'CGPA: 7.5/10' }],
  internships: [{ title: 'Full Stack Web Development Intern', dates: 'Feb 2025 - May 2025', linkLabel: 'Certificate', url: 'https://example.com/certificate', detail: 'Developed backend services with REST APIs and authentication.' }],
  projects: [
    { name: 'AI-Powered Mobile App for Food Safety & Hygiene Monitoring', stack: 'Full Stack, Python', linkLabel: 'GitHub', url: 'https://github.com/example/food-safety', detail: 'Built an application for food safety and hygiene monitoring.' },
    { name: 'Course Automation AI Agent', stack: 'Full Stack, Python', dates: '2025 - 2026', linkLabel: 'GitHub', url: 'https://github.com/example/course-automation', detail: 'Developed an event-driven course automation platform.' },
    { name: 'Fee Queue Management System', stack: 'PHP, MySQL', detail: 'Built a queue management system with database integration.' },
  ],
  skills: [{ label: 'Backend', value: 'Java, Spring Boot, REST APIs, MySQL, Git, Linux' }],
  extras: [{ label: 'Certifications', value: 'Backend Development Certificate', dates: '2025' }, { label: 'Achievements', value: 'First place in a programming competition.' }],
};

async function inspect(resume, format = 'modern') {
  const rendered = await renderFittedResumePdf({}, resume, format);
  const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(rendered.base64, 'base64')));
  const page = await pdf.getPage(1);
  const items = (await page.getTextContent()).items.filter((item) => item.str.trim());
  const annotations = await page.getAnnotations();
  return { ...rendered, items, annotations };
}

function assertBounds(items) {
  for (const item of items) {
    assert.ok(item.transform[4] >= 21.5, `Left overflow: ${item.str}`);
    assert.ok(item.transform[4] + item.width <= 575, `Right overflow: ${item.str}`);
  }
}

test('Modern contacts fit the page and preserve full clickable destinations', async () => {
  const result = await inspect(fixture);
  assert.equal(result.pageCount, 1);
  assertBounds(result.items);
  for (const url of [fixture.linkedin, fixture.github]) {
    assert.ok(result.annotations.some((item) => item.url === url), `Missing link: ${url}`);
  }
  assert.match(result.text, /github.com\/Jaswanth-arjun\/course-automation/);
  const summary = result.items.find((item) => item.str === 'PROFESSIONAL SUMMARY');
  const github = result.items.find((item) => item.str.includes('github.com/Jaswanth-arjun'));
  assert.ok(summary.transform[5] < github.transform[5] - 15);
});

test('Modern project links align right, preserve dates, and do not hide long titles or stacks', async () => {
  const result = await inspect(fixture);
  const projectLinks = result.items.filter((item) => /\bGitHub$/.test(item.str));
  assert.equal(projectLinks.length, 2);
  for (const item of projectLinks) assert.ok(Math.abs(item.transform[4] + item.width - 574.4) < 0.1);
  for (const project of fixture.projects) assert.ok(result.text.includes(project.name));
  assert.ok(result.text.includes('Full Stack, Python'));
  assert.ok(result.text.includes('2025 - 2026'));
  const expectedUrls = fixture.projects.map((item) => item.url).filter(Boolean);
  for (const url of expectedUrls) assert.ok(result.annotations.some((item) => item.url === url));
  assert.match(result.text, /Intern\s+-\s+Certificate/);
  assert.ok(result.annotations.some((item) => item.url === fixture.internships[0].url));
});

test('Modern very long contacts and names wrap or resize without clipping', async () => {
  const resume = {
    ...fixture,
    name: 'A Very Long Candidate Name With Multiple Surnames',
    email: `${'longemail'.repeat(10)}@example.com`,
    github: `https://github.com/example/${'long-repository-name-'.repeat(12)}`,
  };
  const result = await inspect(resume);
  assert.equal(result.pageCount, 1);
  assertBounds(result.items);
  assert.ok(result.annotations.some((item) => item.url === resume.github));
  assert.ok(result.text.includes('ACHIEVEMENTS'));
});

test('Modern missing optional links leave no dangling separators', async () => {
  const resume = {
    ...fixture, email: '', phone: '', linkedin: '', github: '',
    internships: [{ ...fixture.internships[0], url: '', linkLabel: '', dates: '' }],
    projects: [{ ...fixture.projects[0], url: '', linkLabel: '', dates: '' }],
  };
  const result = await inspect(resume);
  assert.equal(result.pageCount, 1);
  assertBounds(result.items);
  assert.ok(!result.text.includes(' - Certificate'));
  const html = modernResumeHtml({}, result.resume);
  assert.ok(!html.includes('class="contact"'));
  assert.ok(!html.includes(' - <a'));
});

test('Modern editable HTML keeps links right-aligned and escapes user content', () => {
  const html = modernResumeHtml({}, fixture);
  assert.match(html, /class="contact-row"/);
  assert.match(html, / - <a href="https:\/\/example.com\/certificate"/);
  assert.match(html, /class="entry-right"><a href="https:\/\/github.com\/example\/food-safety"/);
  assert.match(html, /class="entry-right">2025 - 2026 \| <a href="https:\/\/github.com\/example\/course-automation"/);
  const unsafe = modernResumeHtml({}, { ...fixture, projects: [{ name: '<script>bad</script>', dates: '<img src=x onerror=bad>', linkLabel: 'GitHub', url: 'javascript:bad' }] });
  assert.ok(!unsafe.includes('<script>bad'));
  assert.ok(!unsafe.includes('<img src=x'));
  assert.ok(!unsafe.includes('href="javascript:'));
});

test('Classic and compact rendering still work', async () => {
  for (const format of ['recommended', 'compact']) {
    const result = await inspect(fixture, format);
    assert.equal(result.pageCount, 1);
    assert.ok(result.text.includes('TECHNICAL SKILLS'));
  }
});
