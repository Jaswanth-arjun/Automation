import React, { useState, useEffect, useRef } from 'react';
import { Save, Plus, X, Edit3, FileText, Upload, Trash2, Eye, Sparkles, PenLine, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { profileStore, getUserName } from '../lib/api';
import { DEFAULT_PROFILE } from '../lib/mockData';

// Standalone ProfileField component declared outside of Profile to prevent unmounting & focus loss
const ProfileField = ({ label, value, editing, onChange, type = 'text' }) => (
  <div className="form-field">
    <label>{label}</label>
    {editing ? (
      <input
        type={type}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
      />
    ) : (
      <p className="field-display">{value || <span className="placeholder">Not set</span>}</p>
    )}
  </div>
);

export default function Profile() {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState(() => {
    const saved = profileStore.get();
    return saved || { ...DEFAULT_PROFILE, fullName: getUserName(user), email: user?.email || '' };
  });
  const [skillInput, setSkillInput] = useState('');
  const [saved, setSaved] = useState(false);
  const [showEditChoice, setShowEditChoice] = useState(false);
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
    profileStore.save(profile);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
    const locationCandidate = contactLine.split('|').map(part => part.trim()).filter(Boolean).find(part => /[A-Za-z]/.test(part) && !/@|linkedin|github|\d{5,}/i.test(part)) || current.location || '';
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
      section.forEach(line => {
        const clean = cleanPdfText(line);
        if (!clean) return;
        const dateMatch = clean.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*-\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?\d{4})\b/i);
        if (dateMatch) {
          const title = clean.replace(dateMatch[0], '').replace(/\s*[-|]\s*$/, '').trim();
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
    return { ...current, fullName: nameCandidate, email, phone, location: locationCandidate, skills: skills.length ? skills : current.skills, education, experience: experience.length ? experience : current.experience, projects: projects.length ? projects : current.projects, links };
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
      const updated = { ...extracted, resume: { fileName: file.name, fileSize: `${(file.size / 1024).toFixed(1)} KB`, uploadedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), dataUrl, fileType: file.type, text: result.text, links: result.links || [] } };
      profileStore.save(updated);
      setProfile(updated);
      setEditing(false);
      setShowEditChoice(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
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

  return (
    <div className="page-profile">
      <header className="page-header">
        <div>
          <h1>My Profile</h1>
          <p>Your career profile for job matching and automated applications.</p>
        </div>
        <div className="header-actions">
          {saved && <span className="save-indicator">✓ Saved</span>}
          {editing ? (
            <button className="btn-accent" onClick={handleSave}><Save size={16} /> Save Profile</button>
          ) : (
            <button className="btn-ghost" onClick={() => setShowEditChoice(true)}><Edit3 size={16} /> Edit Profile</button>
          )}
        </div>
      </header>

      <div className="profile-sections space-y-6">
        {/* Personal Information */}
        <section className="profile-section">
          <h2>Personal Information</h2>
          <div className="form-grid">
            <ProfileField
              label="Full Name"
              value={profile.fullName}
              editing={editing}
              onChange={val => setProfile(p => ({ ...p, fullName: val }))}
            />
            <ProfileField
              label="Email"
              value={profile.email}
              editing={editing}
              type="email"
              onChange={val => setProfile(p => ({ ...p, email: val }))}
            />
            <ProfileField
              label="Phone"
              value={profile.phone}
              editing={editing}
              type="tel"
              onChange={val => setProfile(p => ({ ...p, phone: val }))}
            />
            <ProfileField
              label="Location"
              value={profile.location}
              editing={editing}
              onChange={val => setProfile(p => ({ ...p, location: val }))}
            />
          </div>
        </section>

        {/* RESUME UPLOAD SECTION (Requires Edit Profile mode to add/upload/replace) */}
        <section className="profile-section">
          <div className="section-header" style={{ marginBottom: '16px' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: '800' }}>
              <FileText size={18} style={{ color: 'var(--accent)' }} /> Resume / CV Document
            </h2>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".pdf,.doc,.docx"
            style={{ display: 'none' }}
          />

          {profile.resume ? (
            <div className="entry-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#eef0ff', color: '#445cf5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', shrink: 0 }}>
                  <FileText size={22} />
                </div>
                <div>
                  <strong style={{ fontSize: '14px', color: '#171817', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {profile.resume.fileName}
                    <span style={{ fontSize: '10px', background: '#e5f5e9', color: '#2a7645', padding: '2px 8px', borderRadius: '12px', fontWeight: 'bold' }}>
                      ✓ Active
                    </span>
                  </strong>
                  <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 0' }}>
                    {profile.resume.fileSize} · Uploaded on {profile.resume.uploadedAt}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button type="button" onClick={handleViewResume} className="btn-ghost sm" style={{ fontSize: '12px' }}>
                  <Eye size={14} /> View
                </button>
                {editing && (
                  <>
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-ghost sm" style={{ fontSize: '12px' }}>
                      <Upload size={14} /> Replace
                    </button>
                    <button type="button" onClick={handleRemoveResume} className="btn-ghost danger sm" style={{ fontSize: '12px' }} title="Delete Resume">
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : editing ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed #d9d9d2',
                borderRadius: '12px',
                padding: '30px 20px',
                textAlign: 'center',
                background: '#fafaf7',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justify: 'center'
              }}
            >
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#eef0ff', color: '#445cf5', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
                <Upload size={22} />
              </div>
              <strong style={{ fontSize: '14px', color: '#171817', display: 'block', marginBottom: '4px' }}>
                Click to upload your resume
              </strong>
              <span style={{ fontSize: '12px', color: '#777', display: 'block', marginBottom: '16px' }}>
                Supports PDF, DOC, DOCX files (Up to 10MB)
              </span>
              <button type="button" className="btn-accent sm" style={{ pointerEvents: 'none' }}>
                <Plus size={14} /> Select Resume File
              </button>
            </div>
          ) : (
            <p className="placeholder">
              No resume uploaded yet. Click <strong>Edit Profile</strong> at the top right to upload your resume.
            </p>
          )}
        </section>

        {/* Skills */}
        <section className="profile-section">
          <h2>Skills</h2>
          {editing && (
            <div className="skill-input-row">
              <input placeholder="Add a skill…" value={skillInput} onChange={e => setSkillInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSkill()} />
              <button className="btn-ghost" onClick={addSkill}><Plus size={16} /></button>
            </div>
          )}
          <div className="job-card-skills">
            {profile.skills.map(s => (
              <span key={s} className="skill-tag">
                {s}
                {editing && <button onClick={() => removeSkill(s)}><X size={12} /></button>}
              </span>
            ))}
            {profile.skills.length === 0 && <p className="placeholder">No skills added yet.</p>}
          </div>
        </section>

        {/* Education */}
        <section className="profile-section">
          <div className="section-header">
            <h2>Education</h2>
            {editing && <button className="btn-ghost sm" onClick={() => addEntry('education')}><Plus size={14} /> Add</button>}
          </div>
          {profile.education.map((e, i) => (
            <div key={i} className="entry-card">
              {editing ? (
                <>
                  <div className="form-grid">
                    <div className="form-field"><label>Institution</label><input value={e.institution} onChange={ev => updateEntry('education', i, 'institution', ev.target.value)} /></div>
                    <div className="form-field"><label>Degree</label><input value={e.degree} onChange={ev => updateEntry('education', i, 'degree', ev.target.value)} /></div>
                    <div className="form-field"><label>Branch</label><input value={e.branch} onChange={ev => updateEntry('education', i, 'branch', ev.target.value)} /></div>
                    <div className="form-field"><label>Year</label><input value={e.graduationYear} onChange={ev => updateEntry('education', i, 'graduationYear', ev.target.value)} /></div>
                    <div className="form-field"><label>CGPA</label><input value={e.cgpa} onChange={ev => updateEntry('education', i, 'cgpa', ev.target.value)} /></div>
                  </div>
                  <button className="btn-ghost danger sm" onClick={() => removeEntry('education', i)}><X size={14} /> Remove</button>
                </>
              ) : (
                <div className="entry-display">
                  <strong>{e.degree || 'Degree'} {e.branch && `in ${e.branch}`}</strong>
                  <p>{e.institution || 'Institution'} {e.graduationYear && `· ${e.graduationYear}`} {e.cgpa && `· ${e.cgpa}`}</p>
                </div>
              )}
            </div>
          ))}
          {profile.education.length === 0 && <p className="placeholder">No education added yet.</p>}
        </section>

        {/* Experience */}
        <section className="profile-section">
          <div className="section-header">
            <h2>Experience</h2>
            {editing && <button className="btn-ghost sm" onClick={() => addEntry('experience')}><Plus size={14} /> Add</button>}
          </div>
          {profile.experience.map((e, i) => (
            <div key={i} className="entry-card">
              {editing ? (
                <>
                  <div className="form-grid">
                    <div className="form-field"><label>Title</label><input value={e.title} onChange={ev => updateEntry('experience', i, 'title', ev.target.value)} /></div>
                    <div className="form-field"><label>Company</label><input value={e.company} onChange={ev => updateEntry('experience', i, 'company', ev.target.value)} /></div>
                    <div className="form-field"><label>Duration</label><input value={e.duration} onChange={ev => updateEntry('experience', i, 'duration', ev.target.value)} /></div>
                  </div>
                  <div className="form-field"><label>Description</label><textarea value={e.description} onChange={ev => updateEntry('experience', i, 'description', ev.target.value)} /></div>
                  <button className="btn-ghost danger sm" onClick={() => removeEntry('experience', i)}><X size={14} /> Remove</button>
                </>
              ) : (
                <div className="entry-display">
                  <strong>{e.title || 'Role'}</strong>
                  <p>{e.company || 'Company'} {e.duration && `· ${e.duration}`}</p>
                  {e.description && <p className="entry-desc">{e.description}</p>}
                </div>
              )}
            </div>
          ))}
          {profile.experience.length === 0 && <p className="placeholder">No experience added yet.</p>}
        </section>

        {/* Projects */}
        <section className="profile-section">
          <div className="section-header">
            <h2>Projects</h2>
            {editing && <button className="btn-ghost sm" onClick={() => addEntry('projects')}><Plus size={14} /> Add</button>}
          </div>
          {profile.projects.map((p, i) => (
            <div key={i} className="entry-card">
              {editing ? (
                <>
                  <div className="form-grid">
                    <div className="form-field"><label>Title</label><input value={p.title} onChange={ev => updateEntry('projects', i, 'title', ev.target.value)} /></div>
                    <div className="form-field"><label>Technologies</label><input value={p.technologies} onChange={ev => updateEntry('projects', i, 'technologies', ev.target.value)} /></div>
                    <div className="form-field"><label>Link</label><input value={p.link} onChange={ev => updateEntry('projects', i, 'link', ev.target.value)} /></div>
                  </div>
                  <div className="form-field"><label>Description</label><textarea value={p.description} onChange={ev => updateEntry('projects', i, 'description', ev.target.value)} /></div>
                  <button className="btn-ghost danger sm" onClick={() => removeEntry('projects', i)}><X size={14} /> Remove</button>
                </>
              ) : (
                <div className="entry-display">
                  <strong>{p.title || 'Project'}</strong>
                  {p.technologies && <div className="job-card-skills small">{p.technologies.split(',').map(t => <span key={t} className="skill-tag">{t.trim()}</span>)}</div>}
                  {p.description && <p className="entry-desc">{p.description}</p>}
                </div>
              )}
            </div>
          ))}
          {profile.projects.length === 0 && <p className="placeholder">No projects added yet.</p>}
        </section>

        {/* Professional Links */}
        <section className="profile-section">
          <h2>Professional Links</h2>
          <div className="form-grid">
            <ProfileField
              label="GitHub"
              value={profile.links?.github}
              editing={editing}
              onChange={val => setProfile(p => ({ ...p, links: { ...(p.links || {}), github: val } }))}
            />
            <ProfileField
              label="LinkedIn"
              value={profile.links?.linkedin}
              editing={editing}
              onChange={val => setProfile(p => ({ ...p, links: { ...(p.links || {}), linkedin: val } }))}
            />
            <ProfileField
              label="Portfolio"
              value={profile.links?.portfolio}
              editing={editing}
              onChange={val => setProfile(p => ({ ...p, links: { ...(p.links || {}), portfolio: val } }))}
            />
          </div>
        </section>
      </div>

      {showEditChoice && (
        <div className="profile-modal-overlay" onMouseDown={event => event.target === event.currentTarget && setShowEditChoice(false)}>
          <div className="profile-choice-modal" role="dialog" aria-modal="true" aria-labelledby="profile-choice-title">
            <button className="profile-modal-close" onClick={() => setShowEditChoice(false)} aria-label="Close"><X size={18} /></button>
            <span className="profile-modal-kicker">UPDATE YOUR PROFILE</span>
            <h2 id="profile-choice-title">How would you like to edit?</h2>
            <p>Enter your details manually, or let HAMZO fill your profile from your resume.</p>
            {extractError && <div className="profile-extract-error">{extractError}</div>}
            <button className="profile-choice-card" onClick={() => { setShowEditChoice(false); setEditing(true); }}>
              <span className="profile-choice-icon manual"><PenLine size={20} /></span><span><strong>Edit manually</strong><small>Update your name, skills, education and experience yourself.</small></span><span className="profile-choice-arrow">→</span>
            </button>
            <button className="profile-choice-card" disabled={extracting} onClick={() => extractInputRef.current?.click()}>
              <span className="profile-choice-icon extract">{extracting ? <Loader2 size={20} className="spin" /> : <Sparkles size={20} />}</span><span><strong>{extracting ? 'Extracting profile…' : 'Extract from your resume'}</strong><small>Choose a PDF file and automatically update your profile.</small></span><span className="profile-choice-arrow">→</span>
            </button>
            <input ref={extractInputRef} type="file" accept=".pdf" onChange={handleExtractResume} hidden />
            <small className="profile-modal-note">PDF resumes with selectable text work best.</small>
          </div>
        </div>
      )}
    </div>
  );
}
