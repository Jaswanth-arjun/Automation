import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Save, Plus, X, Edit3, FileText, Upload, Trash2, Eye, Sparkles, Loader2,
  MapPin, Phone, Briefcase, GraduationCap, FolderGit2, Award, Link2,
  Globe, CheckCircle2, AlertCircle, ExternalLink,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { profileStore, resumeStore, candidateStore, getUserName } from '../lib/api';
import { DEFAULT_PROFILE } from '../lib/mockData';
import JobProfileSection from '../components/JobProfileSection';
import './Profile.css';

const BATCH_OPTIONS = ['2024', '2025', '2026', '2027', '2028', 'Other'];

const GithubMark = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
);

const LinkedinMark = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

// Standalone ProfileField component declared outside of Profile to prevent unmounting & focus loss
const ProfileField = ({ label, value, editing, onChange, type = 'text', placeholder, options }) => (
  <div className="pf-field">
    <span className="pf-field-label">{label}</span>
    {editing ? (
      options ? (
        <select value={value || ''} onChange={e => onChange(e.target.value)}>
          <option value="">Select year…</option>
          {options.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          value={value || ''}
          placeholder={placeholder || ''}
          onChange={e => onChange(e.target.value)}
        />
      )
    ) : (
      <span className={`pf-field-value ${value ? '' : 'is-empty'}`}>{value || 'Not set'}</span>
    )}
  </div>
);

const SectionCard = ({ icon: Icon, title, count, subtitle, tone = 'indigo', action, children, id }) => (
  <section className={`pf-card pf-tone-${tone}`} id={id}>
    <header className="pf-card-head">
      <span className="pf-card-icon"><Icon size={16} /></span>
      <div className="pf-card-titles">
        <h2>
          {title}
          {count > 0 && <span className="pf-count">{count}</span>}
        </h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && <div className="pf-card-action">{action}</div>}
    </header>
    <div className="pf-card-body">{children}</div>
  </section>
);

const EmptyBlock = ({ icon: Icon, title, hint, actionLabel, onAction }) => (
  <div className="pf-empty">
    <span className="pf-empty-icon"><Icon size={16} /></span>
    <div className="pf-empty-body">
      <strong>{title}</strong>
      <span>{hint}</span>
    </div>
    {actionLabel && onAction && (
      <button type="button" className="pf-add-btn" onClick={onAction}>
        <Plus size={12} /> {actionLabel}
      </button>
    )}
  </div>
);

const withProtocol = (url) => {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
};

const initialsOf = (name, email) => {
  const clean = String(name || '').trim();
  const source = clean || String(email || '').split('@')[0] || 'ME';
  return source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('') || 'ME';
};

export default function Profile() {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState(() => {
    const saved = profileStore.get();
    return saved || { ...DEFAULT_PROFILE, fullName: getUserName(user), email: user?.email || '' };
  });
  const [skillInput, setSkillInput] = useState('');
  const [saved, setSaved] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');

  const fileInputRef = useRef(null);
  const extractInputRef = useRef(null);

  useEffect(() => {
    if (user && !profile.fullName) {
      setProfile(p => ({ ...p, fullName: user.displayName || '', email: user.email || '' }));
    }
  }, [user]);

  const handleSave = () => {
    const savedProfile = profileStore.save(profile) || profile;
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    // Keep the admin's candidate database in sync with every profile change.
    candidateStore.syncProfile(savedProfile).catch(() => {});
  };

  // Handle Resume File Upload
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const newResume = {
        fileName: file.name,
        fileSize: (file.size / 1024).toFixed(1) + ' KB',
        uploadedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        dataUrl: event.target.result,
        fileType: file.type
      };
      setProfile(p => {
        const updated = { ...p, resume: newResume };
        profileStore.save(updated);
        return updated;
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    };
    reader.readAsDataURL(file);
  };

  const parseResumeText = (text, current, extractedLinks = []) => {
    const source = String(text || '').replace(/\r/g, '');
    const lines = source.split('\n').map(line => line.replace(/\s*\|\s*/g, ' ').replace(/^[-•▪◦]\s*/, '').trim()).filter(Boolean);
    const heading = /^(summary|profile|objective|skills?|technical skills|experience|work experience|professional experience|internships?|education|projects?|personal projects|certifications?|achievements?|contact|links?)\s*:?[\s-]*$/i;
    const email = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || current.email || '';
    const phone = source.match(/(?:\+?\d[\d\s().-]{8,}\d)/)?.[0]?.replace(/\s+/g, ' ').trim() || current.phone || '';
    const topLines = lines.slice(0, 12);
    const nameCandidate = topLines.find(line => /^[A-Za-z][A-Za-z .'-]{2,45}$/.test(line) && !heading.test(line) && !/@|https?:\/\//i.test(line) && !/\d{5,}/.test(line)) || current.fullName;
    const contactLine = lines.find(line => line.includes('@')) || '';
    // The first line after the candidate name is the most reliable location
    // source. Do not use the summary/profile text as a location fallback: old
    // profiles could otherwise save an entire headline as the address.
    const nameIndex = nameCandidate ? lines.findIndex(line => line === nameCandidate) : -1;
    const locationFromHeader = lines.slice(Math.max(0, nameIndex + 1), Math.min(lines.length, (nameIndex >= 0 ? nameIndex + 5 : 5)))
      .map(line => line.replace(/[⋄|•]/g, ' ').replace(/\s+/g, ' ').trim())
      .find(line => /[A-Za-z]/.test(line) && /,/.test(line) && !/@|https?:\/\/|linkedin|github|\+?\d[\d\s().-]{7,}/i.test(line) && !heading.test(line));
    const locationCandidate = locationFromHeader || contactLine.split(/[|⋄]/).map(part => part.trim()).filter(Boolean).find(part => /[A-Za-z]/.test(part) && !/@|linkedin|github|\d{5,}/i.test(part)) || (String(current.location || '').length < 90 && !/engineer|developer|rest api|database|software|intern/i.test(current.location) ? current.location : '');
    const skillCatalog = ['JavaScript', 'TypeScript', 'Python', 'SQL', 'Java', 'C', 'React', 'HTML5', 'HTML', 'CSS3', 'CSS', 'Node.js', 'RESTful APIs', 'API Integration', 'Microservices', 'Django', 'Flask', 'Spring Boot', 'PostgreSQL', 'MySQL', 'MongoDB', 'SQL & NoSQL', 'Database Design', 'Query Optimization', 'AWS', 'Git', 'GitHub', 'Docker', 'Postman', 'GitHub Actions', 'VS Code', 'Code Reviews', 'Debugging', 'Unit & Integration Testing', 'Data Structures & Algorithms', 'OOP', 'Generative AI', 'AI Agents', 'Prompt Engineering', 'Agile/Scrum', 'Version Control', 'Technical Documentation', 'Performance Optimization', 'Lazy Loading', 'Code Splitting', 'PHP', 'Flutter', 'CI'];
    const skills = skillCatalog.filter(skill => new RegExp(`(^|[^a-z])${skill.replace(/[.+]/g, '\\$&')}(?=$|[^a-z])`, 'i').test(source));
    const sectionLines = (names) => {
      const index = lines.findIndex(line => new RegExp(`^(?:${names})\\s*:?[\\s-]*$`, 'i').test(line));
      if (index < 0) return [];
      const result = [];
      for (let i = index + 1; i < lines.length && result.length < 80; i += 1) {
        if (heading.test(lines[i])) break;
        result.push(lines[i]);
      }
      return result;
    };
    const cleanPdfText = (value) => String(value || '')
      .replace(/\s*\|\s*fl\s*\|\s*ows/gi, 'flows')
      .replace(/\s*\|\s*ffi\s*\|\s*cient/gi, 'fficient')
      .replace(/\s*\|\s*fi\s*\|\s*ed/gi, 'fied')
      .replace(/\s*\|\s+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const parseExperience = (section) => {
      const entries = [];
      const months = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*';
      section.forEach(line => {
        const clean = cleanPdfText(line);
        if (!clean) return;
        // Resumes use ASCII hyphen, en dash (–) and em dash (—) interchangeably.
        const dateMatch = clean.match(new RegExp(`\\b(${months}\\s+\\d{4}\\s*[-–—]\\s*(?:(?:${months})\\s+)?\\d{4}|\\d{4}\\s*[-–—]\\s*\\d{4})\\b`, 'i'));
        if (dateMatch) {
          const title = clean.replace(dateMatch[0], '').replace(/\s*[-–—|]\s*$/, '').trim();
          entries.push({ title, company: '', duration: dateMatch[1], description: '' });
        } else if (entries.length) {
          entries[entries.length - 1].description = `${entries[entries.length - 1].description} ${clean}`.trim();
        }
      });
      return entries;
    };
    const parseProjects = (section) => {
      const entries = [];
      section.forEach(line => {
        const clean = cleanPdfText(line);
        if (!clean) return;
        if (/—/.test(clean) || !entries.length) {
          const parts = clean.split(/\s+—\s+/);
          entries.push({ title: parts[0] || clean, description: '', technologies: parts[1] || '', link: '' });
        } else {
          entries[entries.length - 1].description = `${entries[entries.length - 1].description} ${clean}`.trim();
        }
      });
      return entries;
    };
    const educationLines = sectionLines('education');
    const experienceLines = sectionLines('experience|work experience|professional experience|internships?');
    const projectLines = sectionLines('projects?|personal projects');
    const education = [];
    for (let i = 0; i < educationLines.length; i += 2) {
      const degreeLine = cleanPdfText(educationLines[i]);
      const institutionLine = cleanPdfText(educationLines[i + 1] || '');
      education.push({ institution: institutionLine, degree: degreeLine.replace(/\s*\|.*$/, '').replace(/\s+20\d{2}\s*$/, '').trim(), branch: degreeLine.match(/in\s+(.+?)(?:\s*\||\s*$)/i)?.[1] || '', graduationYear: degreeLine.match(/20\d{2}/)?.[0] || '', cgpa: degreeLine.match(/(?:cgpa|percentage)\s*:\s*[^|]+/i)?.[0] || '' });
    }
    const experience = parseExperience(experienceLines);
    const projects = parseProjects(projectLines).map(entry => ({ ...entry, technologies: entry.technologies || skills.filter(skill => `${entry.title} ${entry.description}`.toLowerCase().includes(skill.toLowerCase())).join(', ') }));
    const urls = [...new Set([...(extractedLinks || []), ...(source.match(/https?:\/\/[^\s)]+/gi) || [])])];
    const links = { ...(current.links || {}) };
    urls.forEach(url => {
      const clean = url.replace(/[),.;]+$/, '');
      if (/linkedin/i.test(clean)) links.linkedin = clean;
      else if (/github/i.test(clean)) links.github = clean;
      else if (!links.portfolio) links.portfolio = clean;
    });
    if (/linkedin/i.test(source) && !links.linkedin) links.linkedin = urls.find(url => /linkedin/i.test(url)) || 'https://www.linkedin.com';
    if (/github/i.test(source) && !links.github) links.github = urls.find(url => /github/i.test(url)) || 'https://github.com';
    return { ...current, fullName: nameCandidate, email, phone, location: locationCandidate, batch: current.batch || education.find(item => item.graduationYear)?.graduationYear || '', skills: skills.length ? skills : current.skills, education, experience: experience.length ? experience : current.experience, projects: projects.length ? projects : current.projects, links };
  };

  const handleExtractResume = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setExtracting(true);
    setExtractError('');
    try {
      if (!/\.pdf$/i.test(file.name)) throw new Error('Please select a PDF resume for automatic extraction.');
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/resume/extract-text', { method: 'POST', body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not read this resume.');
      if (!result.text?.trim()) throw new Error('No readable text was found. Please try a text-based PDF.');
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const extracted = parseResumeText(result.text, profile, result.links);
      const updated = { ...extracted, resume: { fileName: file.name, fileSize: `${(file.size / 1024).toFixed(1)} KB`, uploadedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), dataUrl, fileType: file.type, text: result.text, links: result.links || [], linkItems: result.linkItems || [] } };
      profileStore.save(updated);
      // Keep the Resume/Apply pages' active resume in sync with this upload so
      // tailoring always uses the real PDF text (experience included) instead
      // of the short profile-field fallback.
      resumeStore.add({ name: file.name, size: `${(file.size / 1024).toFixed(1)} KB`, type: file.type, text: result.text, pdfBase64: dataUrl, makeActive: true });
      setProfile(updated);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      // Extracted profiles are synced too, so the admin's batch list never lags.
      candidateStore.syncProfile(updated).catch(() => {});
    } catch (error) {
      setExtractError(error.message || 'Could not extract profile details.');
    } finally {
      setExtracting(false);
    }
  };

  // Remove Resume
  const handleRemoveResume = () => {
    setProfile(p => {
      const updated = { ...p, resume: null };
      profileStore.save(updated);
      return updated;
    });
  };

  // View Resume
  const handleViewResume = () => {
    if (profile.resume?.dataUrl) {
      const win = window.open();
      if (win) {
        win.document.write(
          `<iframe src="${profile.resume.dataUrl}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`
        );
      }
    }
  };

  const addSkill = () => {
    if (skillInput.trim() && !profile.skills.includes(skillInput.trim())) {
      setProfile(p => ({ ...p, skills: [...p.skills, skillInput.trim()] }));
      setSkillInput('');
    }
  };

  const removeSkill = (s) => setProfile(p => ({ ...p, skills: p.skills.filter(x => x !== s) }));

  const addEntry = (key) => {
    const templates = {
      education: { institution: '', degree: '', branch: '', graduationYear: '', cgpa: '' },
      experience: { title: '', company: '', duration: '', description: '' },
      projects: { title: '', description: '', technologies: '', link: '' },
    };
    setProfile(p => ({ ...p, [key]: [...p[key], templates[key]] }));
  };

  const updateEntry = (key, idx, field, val) => {
    setProfile(p => {
      const arr = [...p[key]];
      arr[idx] = { ...arr[idx], [field]: val };
      return { ...p, [key]: arr };
    });
  };

  const removeEntry = (key, idx) => {
    setProfile(p => ({ ...p, [key]: p[key].filter((_, i) => i !== idx) }));
  };

  const completeness = useMemo(() => {
    const checks = [
      { key: 'contact', label: 'phone & location', done: Boolean(profile.phone && profile.location) },
      { key: 'resume', label: 'resume', done: Boolean(profile.resume) },
      { key: 'skills', label: '3+ skills', done: (profile.skills || []).length >= 3 },
      { key: 'education', label: 'education', done: (profile.education || []).length > 0 },
      { key: 'experience', label: 'experience', done: (profile.experience || []).length > 0 },
      { key: 'projects', label: 'projects', done: (profile.projects || []).length > 0 },
      { key: 'links', label: 'a profile link', done: Boolean(profile.links?.linkedin || profile.links?.github || profile.links?.portfolio) },
    ];
    const done = checks.filter(check => check.done).length;
    return {
      checks,
      percent: Math.round((done / checks.length) * 100),
      missing: checks.filter(check => !check.done).map(check => check.label),
    };
  }, [profile]);

  const handleCancel = () => {
    const savedProfile = profileStore.get();
    setProfile(savedProfile || { ...DEFAULT_PROFILE, fullName: getUserName(user), email: user?.email || '' });
    setEditing(false);
    setSkillInput('');
  };

  const counts = {
    skills: (profile.skills || []).length,
    experience: (profile.experience || []).length,
    education: (profile.education || []).length,
    projects: (profile.projects || []).length,
  };

  const avatarText = initialsOf(profile.fullName, profile.email);
  const missingHint = completeness.missing.length
    ? `Add ${completeness.missing.slice(0, 3).join(', ')}${completeness.missing.length > 3 ? ` +${completeness.missing.length - 3} more` : ''} to improve job matching.`
    : 'Your profile is complete — great work.';

  return (
    <div className="pf-page">
      <header className="pf-header">
        <div>
          <h1>My Profile</h1>
          <p>HAMZOOH uses these details to match jobs, score your fit and tailor every resume.</p>
        </div>
        <div className="pf-header-actions">
          {saved && (
            <span className="pf-saved"><CheckCircle2 size={14} /> Saved</span>
          )}
          {editing ? (
            <>
              <button type="button" className="pf-btn-ghost" onClick={handleCancel}>Cancel</button>
              <button type="button" className="pf-btn-primary" onClick={handleSave}><Save size={15} /> Save profile</button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="pf-btn-ghost"
                onClick={() => extractInputRef.current?.click()}
                disabled={extracting}
              >
                {extracting ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                {extracting ? 'Extracting…' : 'Auto-fill from resume'}
              </button>
              <button type="button" className="pf-btn-primary" onClick={() => setEditing(true)}>
                <Edit3 size={15} /> Edit profile
              </button>
            </>
          )}
        </div>
      </header>

      {extractError && (
        <div className="pf-alert">
          <AlertCircle size={15} />
          <span>{extractError}</span>
          <button type="button" onClick={() => setExtractError('')} aria-label="Dismiss error"><X size={14} /></button>
        </div>
      )}

      <section className="pf-hero">
        <div className="pf-identity">
          <div className="pf-avatar" aria-hidden="true">{avatarText}</div>
          <div className="pf-identity-body">
            <span className="pf-eyebrow">Candidate profile</span>
            <h2 className="pf-name">{profile.fullName || 'Your name'}</h2>
            <p className="pf-contact">{profile.email || 'Add your email address'}</p>

            <div className="pf-meta">
              {profile.location && (
                <span className="pf-meta-chip" title={profile.location}><MapPin size={12} /> {profile.location}</span>
              )}
              {profile.phone && (
                <span className="pf-meta-chip" title={profile.phone}><Phone size={12} /> {profile.phone}</span>
              )}
              {profile.links?.linkedin && (
                <a className="pf-meta-chip pf-meta-link" href={withProtocol(profile.links.linkedin)} target="_blank" rel="noreferrer" title="LinkedIn profile">
                  <LinkedinMark size={12} /> LinkedIn <ExternalLink size={11} />
                </a>
              )}
              {!profile.location && !profile.phone && !profile.links?.linkedin && (
                <span className="pf-meta-chip pf-meta-muted"><MapPin size={12} /> Add location &amp; phone</span>
              )}
            </div>

            <div className="pf-strength">
              <div className="pf-strength-top">
                <span>Profile strength</span>
                <strong>{completeness.percent}%</strong>
              </div>
              <div className="pf-strength-track">
                <span
                  className={`pf-strength-fill ${completeness.percent === 100 ? 'is-full' : ''}`}
                  style={{ width: `${completeness.percent}%` }}
                />
              </div>
              <span className="pf-strength-hint">{missingHint}</span>
            </div>
          </div>
        </div>

        <div className="pf-stats">
          <div className="pf-stat">
            <span className="pf-stat-label">Skills</span>
            <strong className="pf-stat-value is-indigo">{counts.skills}</strong>
            <span className="pf-stat-caption">Listed skills</span>
          </div>
          <div className="pf-stat">
            <span className="pf-stat-label">Experience</span>
            <strong className="pf-stat-value is-green">{counts.experience}</strong>
            <span className="pf-stat-caption">Roles added</span>
          </div>
          <div className="pf-stat">
            <span className="pf-stat-label">Education</span>
            <strong className="pf-stat-value is-amber">{counts.education}</strong>
            <span className="pf-stat-caption">Degrees added</span>
          </div>
          <div className="pf-stat">
            <span className="pf-stat-label">Projects</span>
            <strong className="pf-stat-value is-violet">{counts.projects}</strong>
            <span className="pf-stat-caption">Projects added</span>
          </div>
        </div>
      </section>

      <div className="pf-layout">
        <div className="pf-main">
        {/* Personal Information */}
        <SectionCard
          icon={Award}
          title="Personal information"
          subtitle="Used on tailored resumes and in outreach emails."
          tone="indigo"
        >
          <div className="pf-field-grid">
            <ProfileField
              label="Full name"
              value={profile.fullName}
              editing={editing}
              placeholder="Your full name"
              onChange={val => setProfile(p => ({ ...p, fullName: val }))}
            />
            <ProfileField
              label="Email"
              value={profile.email}
              editing={editing}
              type="email"
              placeholder="you@example.com"
              onChange={val => setProfile(p => ({ ...p, email: val }))}
            />
            <ProfileField
              label="Phone"
              value={profile.phone}
              editing={editing}
              type="tel"
              placeholder="+91 90000 00000"
              onChange={val => setProfile(p => ({ ...p, phone: val }))}
            />
            <ProfileField
              label="Location"
              value={profile.location}
              editing={editing}
              placeholder="City, Country"
              onChange={val => setProfile(p => ({ ...p, location: val }))}
            />
            <ProfileField
              label="Graduation year / Batch"
              value={profile.batch}
              editing={editing}
              options={BATCH_OPTIONS}
              onChange={val => setProfile(p => ({ ...p, batch: val }))}
            />
          </div>
        </SectionCard>

        {/* Job Profile — job-related questions + application preferences */}
        <JobProfileSection profile={profile} setProfile={setProfile} />

        {/* Education */}
        <SectionCard
          icon={GraduationCap}
          title="Education"
          count={counts.education}
          subtitle="Degrees and coursework that back your applications."
          tone="amber"
          action={editing ? (
            <button type="button" className="pf-add-btn" onClick={() => addEntry('education')}>
              <Plus size={12} /> Add
            </button>
          ) : null}
        >
          {profile.education.map((e, i) => (
            <div key={i} className="pf-entry">
              {editing ? (
                <>
                  <button type="button" className="pf-remove" onClick={() => removeEntry('education', i)} title="Remove education">
                    <Trash2 size={13} />
                  </button>
                  <div className="pf-edit-grid">
                    <div className="pf-field"><span className="pf-field-label">Institution</span><input value={e.institution} onChange={ev => updateEntry('education', i, 'institution', ev.target.value)} placeholder="University or college" /></div>
                    <div className="pf-field"><span className="pf-field-label">Degree</span><input value={e.degree} onChange={ev => updateEntry('education', i, 'degree', ev.target.value)} placeholder="B.Tech" /></div>
                    <div className="pf-field"><span className="pf-field-label">Branch</span><input value={e.branch} onChange={ev => updateEntry('education', i, 'branch', ev.target.value)} placeholder="Computer Science" /></div>
                    <div className="pf-field"><span className="pf-field-label">Year</span><input value={e.graduationYear} onChange={ev => updateEntry('education', i, 'graduationYear', ev.target.value)} placeholder="2026" /></div>
                    <div className="pf-field"><span className="pf-field-label">CGPA</span><input value={e.cgpa} onChange={ev => updateEntry('education', i, 'cgpa', ev.target.value)} placeholder="8.5/10" /></div>
                  </div>
                </>
              ) : (
                <div className="pf-entry-body">
                  <div className="pf-entry-top">
                    <strong>{e.degree || 'Degree'}{e.branch ? ` in ${e.branch}` : ''}</strong>
                    {e.graduationYear && <span className="pf-entry-time">{e.graduationYear}</span>}
                  </div>
                  <p className="pf-entry-sub">
                    {e.institution || 'Institution'}{e.cgpa ? ` · ${e.cgpa}` : ''}
                  </p>
                </div>
              )}
            </div>
          ))}
          {profile.education.length === 0 && (
            <EmptyBlock
              icon={GraduationCap}
              title="No education added"
              hint="Add your degree so every tailored resume includes it."
              actionLabel="Add education"
              onAction={() => { setEditing(true); addEntry('education'); }}
            />
          )}
        </SectionCard>

        {/* Experience */}
        <SectionCard
          icon={Briefcase}
          title="Experience"
          count={counts.experience}
          subtitle="Roles and internships HAMZOOH highlights for matching jobs."
          tone="green"
          action={editing ? (
            <button type="button" className="pf-add-btn" onClick={() => addEntry('experience')}>
              <Plus size={12} /> Add
            </button>
          ) : null}
        >
          {profile.experience.map((e, i) => (
            <div key={i} className="pf-entry">
              {editing ? (
                <>
                  <button type="button" className="pf-remove" onClick={() => removeEntry('experience', i)} title="Remove experience">
                    <Trash2 size={13} />
                  </button>
                  <div className="pf-edit-grid">
                    <div className="pf-field"><span className="pf-field-label">Title</span><input value={e.title} onChange={ev => updateEntry('experience', i, 'title', ev.target.value)} placeholder="Software Engineer Intern" /></div>
                    <div className="pf-field"><span className="pf-field-label">Company</span><input value={e.company} onChange={ev => updateEntry('experience', i, 'company', ev.target.value)} placeholder="Company name" /></div>
                    <div className="pf-field"><span className="pf-field-label">Duration</span><input value={e.duration} onChange={ev => updateEntry('experience', i, 'duration', ev.target.value)} placeholder="Jun 2025 – Aug 2025" /></div>
                  </div>
                  <div className="pf-field pf-field-full"><span className="pf-field-label">Description</span><textarea value={e.description} onChange={ev => updateEntry('experience', i, 'description', ev.target.value)} placeholder="What you built and the impact it had." /></div>
                </>
              ) : (
                <div className="pf-entry-body">
                  <div className="pf-entry-top">
                    <strong>{e.title || 'Role'}</strong>
                    {e.duration && <span className="pf-entry-time">{e.duration}</span>}
                  </div>
                  <p className="pf-entry-sub">{e.company || 'Company'}</p>
                  {e.description && <p className="pf-entry-desc">{e.description}</p>}
                </div>
              )}
            </div>
          ))}
          {profile.experience.length === 0 && (
            <EmptyBlock
              icon={Briefcase}
              title="No experience added"
              hint="Add internships or roles to strengthen your match score."
              actionLabel="Add experience"
              onAction={() => { setEditing(true); addEntry('experience'); }}
            />
          )}
        </SectionCard>

        {/* Projects */}
        <SectionCard
          icon={FolderGit2}
          title="Projects"
          count={counts.projects}
          subtitle="Work that shows how you apply your skills."
          tone="violet"
          action={editing ? (
            <button type="button" className="pf-add-btn" onClick={() => addEntry('projects')}>
              <Plus size={12} /> Add
            </button>
          ) : null}
        >
          {profile.projects.map((project, i) => (
            <div key={i} className="pf-entry">
              {editing ? (
                <>
                  <button type="button" className="pf-remove" onClick={() => removeEntry('projects', i)} title="Remove project">
                    <Trash2 size={13} />
                  </button>
                  <div className="pf-edit-grid">
                    <div className="pf-field"><span className="pf-field-label">Title</span><input value={project.title} onChange={ev => updateEntry('projects', i, 'title', ev.target.value)} placeholder="Project name" /></div>
                    <div className="pf-field"><span className="pf-field-label">Technologies</span><input value={project.technologies} onChange={ev => updateEntry('projects', i, 'technologies', ev.target.value)} placeholder="React, Node.js" /></div>
                    <div className="pf-field"><span className="pf-field-label">Link</span><input value={project.link} onChange={ev => updateEntry('projects', i, 'link', ev.target.value)} placeholder="github.com/you/project" /></div>
                  </div>
                  <div className="pf-field pf-field-full"><span className="pf-field-label">Description</span><textarea value={project.description} onChange={ev => updateEntry('projects', i, 'description', ev.target.value)} placeholder="What it does and what you learned." /></div>
                </>
              ) : (
                <div className="pf-entry-body">
                  <div className="pf-entry-top">
                    <strong>{project.title || 'Project'}</strong>
                    {project.link && (
                      <a className="pf-entry-link" href={withProtocol(project.link)} target="_blank" rel="noreferrer" title="Open project link">
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                  {project.technologies && (
                    <div className="pf-mini-tags">
                      {project.technologies.split(',').filter(Boolean).map(tech => (
                        <span key={tech} className="pf-mini-tag">{tech.trim()}</span>
                      ))}
                    </div>
                  )}
                  {project.description && <p className="pf-entry-desc">{project.description}</p>}
                </div>
              )}
            </div>
          ))}
          {profile.projects.length === 0 && (
            <EmptyBlock
              icon={FolderGit2}
              title="No projects added"
              hint="Add 1–2 projects to show practical, job-ready work."
              actionLabel="Add project"
              onAction={() => { setEditing(true); addEntry('projects'); }}
            />
          )}
        </SectionCard>

        </div>

        <aside className="pf-side">
          {/* Resume / CV document */}
          <SectionCard
            icon={FileText}
            title="Resume / CV"
            subtitle="Master file HAMZOOH tailors for every application."
            tone="indigo"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".pdf,.doc,.docx"
              style={{ display: 'none' }}
            />
            <input ref={extractInputRef} type="file" accept=".pdf" onChange={handleExtractResume} hidden />

            {profile.resume ? (
              <>
                <div className="pf-resume-file">
                  <span className="pf-resume-icon"><FileText size={18} /></span>
                  <div className="pf-resume-body">
                    <strong title={profile.resume.fileName}>{profile.resume.fileName}</strong>
                    <span>{profile.resume.fileSize} · Uploaded {profile.resume.uploadedAt}</span>
                  </div>
                  <span className="pf-badge-active"><CheckCircle2 size={11} /> Active</span>
                </div>
                <div className="pf-resume-actions">
                  <button type="button" className="pf-btn-mini" onClick={handleViewResume}>
                    <Eye size={13} /> View
                  </button>
                  {editing && (
                    <>
                      <button type="button" className="pf-btn-mini" onClick={() => fileInputRef.current?.click()}>
                        <Upload size={13} /> Replace
                      </button>
                      <button type="button" className="pf-btn-mini is-danger" onClick={handleRemoveResume}>
                        <Trash2 size={13} /> Remove
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="pf-resume-empty">
                <span className="pf-resume-empty-icon"><Upload size={18} /></span>
                <strong>No resume uploaded</strong>
                <span>Upload a PDF to auto-fill your profile and tailor resumes.</span>
                <div className="pf-resume-empty-actions">
                  <button type="button" className="pf-btn-primary pf-btn-sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload size={13} /> Upload resume
                  </button>
                  <button type="button" className="pf-btn-ghost pf-btn-sm" onClick={() => extractInputRef.current?.click()} disabled={extracting}>
                    {extracting ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />} Extract details
                  </button>
                </div>
              </div>
            )}
          </SectionCard>

          {/* Skills */}
          <SectionCard
            icon={Sparkles}
            title="Skills"
            count={counts.skills}
            subtitle="Keywords matched against every job post."
            tone="violet"
          >
            {editing && (
              <div className="pf-skill-add">
                <input
                  placeholder="Add a skill…"
                  value={skillInput}
                  onChange={e => setSkillInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                />
                <button type="button" onClick={addSkill} title="Add skill"><Plus size={15} /></button>
              </div>
            )}
            {counts.skills > 0 ? (
              <div className="pf-skill-row">
                {profile.skills.map(skill => (
                  <span key={skill} className="pf-skill">
                    {skill}
                    {editing && (
                      <button type="button" onClick={() => removeSkill(skill)} title={`Remove ${skill}`}>
                        <X size={11} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <EmptyBlock
                icon={Sparkles}
                title="No skills yet"
                hint="Add 3 or more skills to improve match scores."
                actionLabel={editing ? '' : 'Add skills'}
                onAction={() => setEditing(true)}
              />
            )}
          </SectionCard>

          {/* Professional links */}
          <SectionCard
            icon={Link2}
            title="Professional links"
            subtitle="Shown on your profile and tailored resumes."
            tone="green"
          >
            {editing ? (
              <div className="pf-field-grid pf-links-edit">
                <ProfileField
                  label="GitHub"
                  value={profile.links?.github}
                  editing={editing}
                  placeholder="github.com/username"
                  onChange={val => setProfile(p => ({ ...p, links: { ...(p.links || {}), github: val } }))}
                />
                <ProfileField
                  label="LinkedIn"
                  value={profile.links?.linkedin}
                  editing={editing}
                  placeholder="linkedin.com/in/username"
                  onChange={val => setProfile(p => ({ ...p, links: { ...(p.links || {}), linkedin: val } }))}
                />
                <ProfileField
                  label="Portfolio"
                  value={profile.links?.portfolio}
                  editing={editing}
                  placeholder="your-site.com"
                  onChange={val => setProfile(p => ({ ...p, links: { ...(p.links || {}), portfolio: val } }))}
                />
              </div>
            ) : (
              <div className="pf-links">
                {[
                  { key: 'github', label: 'GitHub', icon: GithubMark },
                  { key: 'linkedin', label: 'LinkedIn', icon: LinkedinMark },
                  { key: 'portfolio', label: 'Portfolio', icon: Globe },
                ].map(item => {
                  const value = profile.links?.[item.key] || '';
                  const Icon = item.icon;
                  return value ? (
                    <a
                      key={item.key}
                      className="pf-link"
                      href={withProtocol(value)}
                      target="_blank"
                      rel="noreferrer"
                      title={value}
                    >
                      <span className="pf-link-icon"><Icon size={14} /></span>
                      <span className="pf-link-body">
                        <span>{item.label}</span>
                        <small>{value}</small>
                      </span>
                      <ExternalLink size={13} />
                    </a>
                  ) : (
                    <div key={item.key} className="pf-link is-empty">
                      <span className="pf-link-icon"><Icon size={14} /></span>
                      <span className="pf-link-body">
                        <span>{item.label}</span>
                        <small>Not added</small>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}
