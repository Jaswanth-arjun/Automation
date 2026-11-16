import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Edit3, Upload, X, Eye, Briefcase, Building, MapPin, Clock, Link2, Image, FileText, ChevronDown } from 'lucide-react';
import { adminJobStore } from '../lib/adminJobStore';
import { useAuth } from '../lib/auth';
import { jobOwner, manageableJobs, isAdminUser } from '../lib/jobOwnership';

const CATEGORY_OPTIONS = ['Freshers', 'Confidential', 'Remote', 'Full time Permanent Position'];

const LOCATION_OPTIONS = [
  'Remote',
  'Hybrid',
  'On-site',
  'India',
  'Bengaluru, India',
  'Hyderabad, India',
  'Mumbai, India',
  'Pune, India',
  'Delhi, India',
  'Chennai, India',
];

const EMPTY_JOB = {
  title: '',
  company: '',
  companyLogoUrl: '',
  location: 'India',
  category: 'Freshers',
  experienceLabel: '0–1 years',
  experienceMin: 0,
  experienceMax: 1,
  type: 'Full Time',
  applyLink: '',
  requiredSkills: [],
  preferredSkills: [],
  skills: [],
  description: '',
};

export default function AdminJobs() {
  const { user } = useAuth();
  const owner = jobOwner(user);
  const [jobs, setJobs] = useState(() => adminJobStore.getAll());
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_JOB });
  const [reqSkillInput, setReqSkillInput] = useState('');
  const [prefSkillInput, setPrefSkillInput] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importError, setImportError] = useState('');
  const logoInputRef = useRef(null);

  useEffect(() => {
    const refresh = () => setJobs(adminJobStore.getAll());
    window.addEventListener('admin_jobs_updated', refresh);
    return () => window.removeEventListener('admin_jobs_updated', refresh);
  }, []);

  // Postings created before ownership existed are claimed by this account once,
  // so the recruiter keeps control of the jobs they posted.
  useEffect(() => {
    if (!owner) return;
    const flag = `hamzo_claimed_jobs_${owner.id || owner.email}`;
    if (localStorage.getItem(flag)) return;
    localStorage.setItem(flag, '1');
    adminJobStore.claimOwnerless(owner).then(() => setJobs(adminJobStore.getAll()));
  }, [owner?.id, owner?.email]);

  const myJobs = manageableJobs(jobs, user);

  // A new post starts from the link box: that is the whole posting flow.
  useEffect(() => {
    if (formOpen && !editingId) {
      const input = document.querySelector('.admin-import-row input');
      input?.focus();
    }
  }, [formOpen, editingId]);

  const setField = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setField('companyLogoUrl', ev.target.result);
    reader.readAsDataURL(file);
  };

  const addReqSkill = () => {
    const s = reqSkillInput.trim();
    if (s && !form.requiredSkills.includes(s)) {
      setForm(f => ({ ...f, requiredSkills: [...f.requiredSkills, s], skills: [...f.skills, s] }));
      setReqSkillInput('');
    }
  };

  const addPrefSkill = () => {
    const s = prefSkillInput.trim();
    if (s && !form.preferredSkills.includes(s)) {
      setForm(f => ({ ...f, preferredSkills: [...f.preferredSkills, s] }));
      setPrefSkillInput('');
    }
  };

  const removeReqSkill = (s) => setForm(f => ({
    ...f,
    requiredSkills: f.requiredSkills.filter(x => x !== s),
    skills: f.skills.filter(x => x !== s),
  }));

  const removePrefSkill = (s) => setForm(f => ({
    ...f, preferredSkills: f.preferredSkills.filter(x => x !== s),
  }));

  const handleImport = async () => {
    const url = importUrl.trim();
    if (!url) {
      setImportError('Paste the public job link first.');
      return;
    }
    setImporting(true);
    setImportError('');
    setImportMsg('');
    try {
      const data = await adminJobStore.importFromLink(url);
      const job = data.job || {};
      setForm((current) => ({
        ...current,
        ...job,
        skills: job.skills?.length ? job.skills : [...(job.requiredSkills || []), ...(job.preferredSkills || [])],
      }));
      let host = '';
      try { host = new URL(data.sourceUrl || url).hostname.replace(/^www\./, ''); } catch {}
      setImportMsg(`Details imported from ${host || 'the link'} — review the fields below, then publish.`);
    } catch (err) {
      setImportError(err.message || 'That job link could not be read.');
    } finally {
      setImporting(false);
    }
  };

  const handleSubmit = () => {
    if (!form.title.trim() || !form.company.trim()) return;

    if (editingId) {
      adminJobStore.update(editingId, form);
    } else {
      adminJobStore.add({ ...form, postedBy: owner });
    }

    setJobs(adminJobStore.getAll());
    setForm({ ...EMPTY_JOB });
    setEditingId(null);
    setFormOpen(false);
    setSavedMsg(editingId ? 'Job updated successfully!' : 'Job posted successfully!');
    setTimeout(() => setSavedMsg(''), 3000);
  };

  const handleEdit = (job) => {
    setForm({
      title: job.title || '',
      company: job.company || '',
      companyLogoUrl: job.companyLogoUrl || '',
      location: job.location || 'India',
      category: job.category || 'Freshers',
      experienceLabel: job.experienceLabel || '0–1 years',
      experienceMin: job.experienceMin || 0,
      experienceMax: job.experienceMax || 1,
      type: job.type || 'Full Time',
      applyLink: job.applyLink || '',
      requiredSkills: job.requiredSkills || [],
      preferredSkills: job.preferredSkills || [],
      skills: job.skills || [],
      description: job.description || '',
    });
    setEditingId(job.id);
    setFormOpen(true);
  };

  const handleDelete = (id) => {
    adminJobStore.remove(id);
    setJobs(adminJobStore.getAll());
  };

  const handleCancel = () => {
    setForm({ ...EMPTY_JOB });
    setEditingId(null);
    setFormOpen(false);
  };

  return (
    <div className="page-admin-jobs">
      <header className="page-header">
        <div>
          <h1>Post Jobs</h1>
          <p>
            {isAdminUser(user)
              ? 'All job listings — as an administrator you can edit or delete any of them.'
              : 'Paste a link from a company career portal to post a job. Only you and the administrator can edit or delete your postings.'}
          </p>
        </div>
        <div className="header-actions">
          {savedMsg && <span className="save-indicator">✓ {savedMsg}</span>}
          {!formOpen && (
            <button className="btn-accent" onClick={() => { setForm({ ...EMPTY_JOB }); setEditingId(null); setFormOpen(true); }}>
              <Plus size={16} /> New Job Post
            </button>
          )}
        </div>
      </header>

      {/* JOB POSTING FORM */}
      {formOpen && (
        <section className="profile-section admin-job-form" style={{ marginBottom: '28px' }}>
          <div className="section-header" style={{ marginBottom: '20px' }}>
            <h2>{editingId ? 'Edit Job Post' : 'Create New Job Post'}</h2>
            <button className="btn-ghost sm" onClick={handleCancel}><X size={14} /> Cancel</button>
          </div>

          {/* Import straight from a public job link */}
          <div className="admin-import-card">
            <div className="admin-import-head">
              <Link2 size={16} />
              <div>
                <strong>Import from a job link</strong>
                <p>Paste the public job posting URL — role, company, logo, location, skills and the formatted description are filled in automatically.</p>
              </div>
            </div>
            <div className="admin-import-row">
              <input
                value={importUrl}
                onChange={(event) => setImportUrl(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleImport(); } }}
                placeholder="https://careers.company.com/jobs/backend-developer-intern"
              />
              <button type="button" className="btn-accent" onClick={handleImport} disabled={importing}>
                {importing ? 'Reading link…' : 'Fetch details'}
              </button>
            </div>
            {importMsg && <p className="admin-import-ok">{importMsg}</p>}
            {importError && <p className="admin-import-error">{importError}</p>}
          </div>

          {/* Company logo + basic info row */}
          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '20px' }}>
            {/* Logo upload */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <div
                onClick={() => logoInputRef.current?.click()}
                style={{
                  width: '80px', height: '80px', borderRadius: '14px',
                  border: '2px dashed #d9d9d2', background: form.companyLogoUrl ? 'transparent' : '#fafaf7',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', overflow: 'hidden', transition: 'all 0.2s',
                }}
              >
                {form.companyLogoUrl ? (
                  <img src={form.companyLogoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Image size={28} style={{ color: '#999' }} />
                )}
              </div>
              <input type="file" ref={logoInputRef} accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} />
              <span style={{ fontSize: '11px', color: '#888' }}>Company Logo</span>
            </div>

            {/* Title + Company */}
            <div style={{ flex: 1, minWidth: '250px' }}>
              <div className="form-grid">
                <div className="form-field">
                  <label><Briefcase size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '4px' }} />Role / Job Title</label>
                  <input value={form.title} onChange={e => setField('title', e.target.value)} placeholder="e.g. Backend Developer Intern" />
                </div>
                <div className="form-field">
                  <label><Building size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '4px' }} />Company Name</label>
                  <input value={form.company} onChange={e => setField('company', e.target.value)} placeholder="e.g. Crossing Infotech" />
                </div>
              </div>
            </div>
          </div>

          {/* 4 Dropdown selectors */}
          <div className="form-grid" style={{ marginBottom: '20px' }}>
            <div className="form-field">
              <label>Category</label>
              <div style={{ position: 'relative' }}>
                <select value={form.category} onChange={e => setField('category', e.target.value)} className="admin-select">
                  {CATEGORY_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#888' }} />
              </div>
            </div>
            <div className="form-field">
              <label>Work Mode</label>
              <div style={{ position: 'relative' }}>
                <select value={form.location} onChange={e => setField('location', e.target.value)} className="admin-select">
                  {![...LOCATION_OPTIONS].includes(form.location) && form.location && (
                    <option value={form.location}>{form.location}</option>
                  )}
                  {LOCATION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#888' }} />
              </div>
            </div>
            <div className="form-field">
              <label>Job Type</label>
              <div style={{ position: 'relative' }}>
                <select value={form.type} onChange={e => setField('type', e.target.value)} className="admin-select">
                  <option value="Full Time">Full Time</option>
                  <option value="Internship">Internship</option>
                  <option value="Part Time">Part Time</option>
                  <option value="Contract">Contract</option>
                  <option value="Full-time Internship">Full-time Internship</option>
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#888' }} />
              </div>
            </div>
            <div className="form-field">
              <label>Experience</label>
              <div style={{ position: 'relative' }}>
                <select value={form.experienceLabel} onChange={e => {
                  const v = e.target.value;
                  setField('experienceLabel', v);
                  if (v === '0–1 years') { setField('experienceMin', 0); setField('experienceMax', 1); }
                  else if (v === '0–2 years') { setField('experienceMin', 0); setField('experienceMax', 2); }
                  else if (v === '1–3 years') { setField('experienceMin', 1); setField('experienceMax', 3); }
                  else if (v === '2–5 years') { setField('experienceMin', 2); setField('experienceMax', 5); }
                }} className="admin-select">
                  <option value="0–1 years">0–1 years (Fresher)</option>
                  <option value="0–2 years">0–2 years</option>
                  <option value="1–3 years">1–3 years</option>
                  <option value="2–5 years">2–5 years</option>
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#888' }} />
              </div>
            </div>
          </div>

          {/* Apply Link */}
          <div className="form-field" style={{ marginBottom: '20px' }}>
            <label><Link2 size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '4px' }} />Apply Link (External URL)</label>
            <input value={form.applyLink} onChange={e => setField('applyLink', e.target.value)} placeholder="https://careers.example.com/apply/backend-developer" />
          </div>

          {/* Skills */}
          <div className="form-grid" style={{ marginBottom: '20px' }}>
            <div className="form-field">
              <label>Must Have Skills</label>
              <div className="skill-input-row">
                <input placeholder="e.g. Python" value={reqSkillInput} onChange={e => setReqSkillInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addReqSkill()} />
                <button className="btn-ghost" onClick={addReqSkill}><Plus size={16} /></button>
              </div>
              <div className="job-card-skills" style={{ marginTop: '8px' }}>
                {form.requiredSkills.map(s => (
                  <span key={s} className="skill-tag">
                    {s} <button onClick={() => removeReqSkill(s)}><X size={10} /></button>
                  </span>
                ))}
              </div>
            </div>
            <div className="form-field">
              <label>Good to Have Skills</label>
              <div className="skill-input-row">
                <input placeholder="e.g. Flask" value={prefSkillInput} onChange={e => setPrefSkillInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPrefSkill()} />
                <button className="btn-ghost" onClick={addPrefSkill}><Plus size={16} /></button>
              </div>
              <div className="job-card-skills" style={{ marginTop: '8px' }}>
                {form.preferredSkills.map(s => (
                  <span key={s} className="skill-tag secondary">
                    {s} <button onClick={() => removePrefSkill(s)}><X size={10} /></button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="form-field" style={{ marginBottom: '20px' }}>
            <label><FileText size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '4px' }} />Job Description (Detailed)</label>
            <p style={{ fontSize: '11px', color: '#888', margin: '0 0 8px' }}>
              Use headers with <code>##</code>, bullet points with <code>•</code>, and blank lines for paragraph spacing. The description will be rendered with formatted headers and lists.
            </p>
            <textarea
              value={form.description}
              onChange={e => setField('description', e.target.value)}
              placeholder={`## About the opportunity\n\nCompany is offering a Backend Developer Internship...\n\n## Key responsibilities\n\n• Assist with developing backend features\n• Write server-side code using Python, Node.js\n• Develop and test REST API endpoints\n\n## Required skills\n\n• Knowledge of Python, Node.js, Java\n• Understanding of SQL and databases\n• Familiarity with Git\n\n## What you will learn\n\n• Practical backend development workflows\n• REST API development and testing`}
              style={{ minHeight: '320px', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.6' }}
            />
          </div>

          {/* Preview & Submit */}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button className="btn-ghost" onClick={() => setPreviewOpen(!previewOpen)}>
              <Eye size={14} /> {previewOpen ? 'Hide Preview' : 'Preview Post'}
            </button>
            <button className="btn-accent" onClick={handleSubmit} disabled={!form.title.trim() || !form.company.trim()}>
              {editingId ? 'Update Job Post' : 'Publish Job Post'}
            </button>
          </div>

          {/* LIVE PREVIEW */}
          {previewOpen && (
            <div style={{ marginTop: '24px', padding: '24px', background: '#fff', borderRadius: '14px', border: '1px solid #e5e5e0' }}>
              <h3 style={{ fontSize: '13px', color: '#888', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '1px' }}>Live Preview</h3>
              <JobPostPreview form={form} />
            </div>
          )}
        </section>
      )}

      {/* POSTED JOBS LIST */}
      <section>
        <h2 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '16px', color: '#171817' }}>
          Your Posted Jobs ({myJobs.length})
        </h2>

        {myJobs.length === 0 ? (
          <div className="profile-section" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <Briefcase size={40} style={{ color: '#ccc', marginBottom: '12px' }} />
            <p style={{ color: '#888', fontSize: '14px' }}>
              You haven't posted a job yet. Click <strong>"New Job Post"</strong>, paste the job's link from the company career portal and it is ready to publish.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {myJobs.map(job => (
              <div key={job.id} className="profile-section" style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    {job.companyLogoUrl ? (
                      <img src={job.companyLogoUrl} alt={job.company} style={{ width: '44px', height: '44px', borderRadius: '10px', objectFit: 'cover', border: '1px solid #e5e5e0' }} />
                    ) : (
                      <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#eef0ff', color: '#445cf5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '16px' }}>
                        {(job.company || '?')[0]}
                      </div>
                    )}
                    <div>
                      <strong style={{ fontSize: '15px', color: '#171817' }}>{job.title}</strong>
                      <p style={{ fontSize: '13px', color: '#666', margin: '2px 0 0' }}>
                        {job.company} · {job.location} · {job.category} · {job.type}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#999' }}>
                      {new Date(job.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <button className="btn-ghost sm" onClick={() => handleEdit(job)}><Edit3 size={13} /> Edit</button>
                    <button className="btn-ghost danger sm" onClick={() => handleDelete(job.id)}><Trash2 size={13} /></button>
                  </div>
                </div>

                {/* Skills preview */}
                {(job.requiredSkills?.length > 0 || job.preferredSkills?.length > 0) && (
                  <div className="job-card-skills" style={{ marginTop: '12px' }}>
                    {(job.requiredSkills || []).map(s => <span key={s} className="skill-tag">{s}</span>)}
                    {(job.preferredSkills || []).map(s => <span key={'p_' + s} className="skill-tag secondary">{s}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}

/** Renders the formatted job description preview */
function JobPostPreview({ form }) {
  const renderDescription = (text) => {
    if (!text) return <p style={{ color: '#999', fontStyle: 'italic' }}>No description yet.</p>;
    const lines = text.split('\n');
    const elements = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith('## ')) {
        elements.push(<h3 key={i} style={{ fontSize: '16px', fontWeight: '700', color: '#171817', margin: '20px 0 8px', borderBottom: '1px solid #eee', paddingBottom: '6px' }}>{line.replace('## ', '')}</h3>);
      } else if (line.startsWith('# ')) {
        elements.push(<h2 key={i} style={{ fontSize: '18px', fontWeight: '800', color: '#171817', margin: '20px 0 10px' }}>{line.replace('# ', '')}</h2>);
      } else if (line.startsWith('• ') || line.startsWith('- ')) {
        elements.push(<div key={i} style={{ display: 'flex', gap: '8px', margin: '4px 0', paddingLeft: '8px', fontSize: '13.5px', lineHeight: '1.7', color: '#333' }}><span style={{ color: '#445cf5' }}>•</span><span>{line.replace(/^[•\-]\s*/, '')}</span></div>);
      } else if (line.trim() === '') {
        elements.push(<div key={i} style={{ height: '10px' }} />);
      } else {
        elements.push(<p key={i} style={{ fontSize: '13.5px', lineHeight: '1.7', color: '#333', margin: '4px 0' }}>{line}</p>);
      }
      i++;
    }
    return elements;
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
        {form.companyLogoUrl ? (
          <img src={form.companyLogoUrl} alt="" style={{ width: '50px', height: '50px', borderRadius: '12px', objectFit: 'cover', border: '1px solid #e5e5e0' }} />
        ) : (
          <div style={{ width: '50px', height: '50px', borderRadius: '12px', background: '#eef0ff', color: '#445cf5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '20px' }}>
            {(form.company || '?')[0]}
          </div>
        )}
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#171817', margin: 0 }}>{form.title || 'Job Title'}</h2>
          <p style={{ fontSize: '14px', color: '#666', margin: '2px 0 0' }}>{form.company || 'Company Name'}</p>
        </div>
      </div>

      {/* Meta tags */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px', fontSize: '12.5px', color: '#666' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><MapPin size={13} /> {form.location}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={13} /> {form.experienceLabel}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Briefcase size={13} /> {form.type}</span>
        <span style={{
          fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '20px',
          background: form.category === 'Remote' ? '#e8f5e9' : form.category === 'Freshers' ? '#eef0ff' : '#fff3e0',
          color: form.category === 'Remote' ? '#2e7d32' : form.category === 'Freshers' ? '#445cf5' : '#e65100',
        }}>{form.category}</span>
      </div>

      {/* Skills */}
      {form.requiredSkills.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: '700', color: '#171817' }}>Must have skills : </span>
          <span style={{ fontSize: '12px', color: '#555' }}>{form.requiredSkills.join(', ')}</span>
        </div>
      )}
      {form.preferredSkills.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <span style={{ fontSize: '12px', fontWeight: '700', color: '#171817' }}>Good to have skills : </span>
          <span style={{ fontSize: '12px', color: '#555' }}>{form.preferredSkills.join(', ')}</span>
        </div>
      )}

      {/* Formatted description */}
      <div style={{ borderTop: '1px solid #eee', paddingTop: '16px' }}>
        {renderDescription(form.description)}
      </div>
    </div>
  );
}
