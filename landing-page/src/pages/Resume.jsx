import React, { useEffect, useState, useRef } from 'react';
import { Upload, FileText, Trash2, CheckCircle, Clock, Plus, X, Eye, LayoutTemplate } from 'lucide-react';
import { resumeStore, profileStore, api } from '../lib/api';
import { RESUME_TEMPLATES, getSelectedTemplateId, setSelectedTemplateId, DEFAULT_TEMPLATE_ID } from '../lib/resumeTemplates';
import JobAnalyzerModal from '../components/JobAnalyzerModal';

const ANSWERS_KEY = 'hamzo_apply_answers';

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  background: 'rgba(15, 17, 23, 0.55)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

const dialogStyle = {
  background: '#fff',
  borderRadius: 20,
  width: '100%',
  maxWidth: 480,
  padding: 28,
  boxShadow: '0 24px 60px rgba(0, 0, 0, 0.22)',
  border: '1px solid #e5e5e0',
  position: 'relative',
};

function Dialog({ title, onClose, children }) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 20, letterSpacing: '-0.03em' }}>{title}</h3>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close" style={{ border: 0, background: '#f4f3ef', width: 32, height: 32, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={16} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function extensionInstalled() {
  if (window.__HAMZO_EXTENSION__ || document.documentElement.dataset.hamzoExtension === '1') {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 1200);
    const onMessage = (event) => {
      if (event.data?.source === 'hamzo-extension' && event.data.type === 'HAMZO_PONG') {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(true);
      }
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'hamzo-app', type: 'HAMZO_PING' }, '*');
  });
}

function savedAnswers() {
  try { return JSON.parse(localStorage.getItem(ANSWERS_KEY) || '{}'); } catch { return {}; }
}

function pdfObjectUrl(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

function openPdf(base64) {
  if (!base64) return;
  window.open(pdfObjectUrl(base64), '_blank');
}

function downloadPdf(base64, filename) {
  if (!base64) return;
  const link = document.createElement('a');
  link.href = pdfObjectUrl(base64);
  link.download = filename.endsWith('.pdf') ? filename : `${filename.replace(/\.[^.]+$/, '')}.pdf`;
  link.click();
}

/** Small stylised preview of a template's layout (pure CSS, no PDF render). */
function TemplatePreview({ variant }) {
  const line = (width, opacity = 1, height = 4) => (
    <div style={{ height, borderRadius: 2, background: '#d9d7d0', width, opacity, marginBottom: 5 }} />
  );
  const accent = '#445cf5';
  const body = (
    <div style={{ padding: '10px 12px' }}>
      {variant === 'compact' ? (
        <>
          {line('58%', 1, 3)}{line('40%', 0.8, 3)}
          <div style={{ height: 6 }} />
          {line('30%', 1, 3)}{line('92%', 0.8, 3)}{line('86%', 0.8, 3)}{line('78%', 0.8, 3)}{line('90%', 0.8, 3)}{line('64%', 0.8, 3)}
          <div style={{ height: 5 }} />
          {line('34%', 1, 3)}{line('88%', 0.8, 3)}{line('94%', 0.8, 3)}{line('72%', 0.8, 3)}{line('83%', 0.8, 3)}
        </>
      ) : (
        <>
          {line('62%')}{line('44%', 0.85)}
          <div style={{ height: 8 }} />
          {line('32%')}
          {line('90%', 0.85)}{line('80%', 0.85)}{line('64%', 0.85)}
          <div style={{ height: 7 }} />
          {line('38%')}
          {line('84%', 0.85)}{line('92%', 0.85)}{line('70%', 0.85)}
        </>
      )}
    </div>
  );
  const header = variant === 'modern'
    ? <div style={{ height: 22, background: accent, opacity: 0.9 }} />
    : variant === 'classic'
      ? <div style={{ height: 22, background: '#171817', opacity: 0.9 }} />
      : null;
  return (
    <div style={{ aspectRatio: '1 / 1.25', background: '#fff', border: '1px solid #d9d9d2', borderRadius: 8, overflow: 'hidden' }}>
      {header}
      {body}
    </div>
  );
}

export default function ResumeManager() {
  const [resumes, setResumes] = useState(() => resumeStore.getAll());
  const fileRef = useRef(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [jobLink, setJobLink] = useState('');
  const [extensionPrompt, setExtensionPrompt] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [tailored, setTailored] = useState(null);
  const [applyUrl, setApplyUrl] = useState('');
  const [formatId, setFormatId] = useState('recommended');
  const [profileResume, setProfileResume] = useState(() => profileStore.get()?.resume || null);
  const [selectedTemplate, setSelectedTemplate] = useState(() => getSelectedTemplateId());
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.data?.source === 'hamzo-extension' && event.data.type === 'HAMZO_ANSWERS') {
        localStorage.setItem(ANSWERS_KEY, JSON.stringify(event.data.answers || {}));
      }
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'hamzo-app', type: 'HAMZO_GET_ANSWERS' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const pushProfileToExtension = () => {
    const profile = profileStore.get() || {};
    window.postMessage({ source: 'hamzo-app', type: 'HAMZO_SAVE_PROFILE', profile, answers: savedAnswers() }, '*');
  };

  /** Map Profile.jsx field names to the resume backend format */
  const mapProfileForBackend = (profile) => {
    const mapped = { ...profile };
    // Map education: institution→school, graduationYear→dates, branch appended to degree
    if (profile.education?.length) {
      mapped.education = profile.education.map((e) => ({
        degree: [e.degree, e.branch].filter(Boolean).join(' in '),
        school: e.institution || e.school || '',
        dates: e.graduationYear || e.dates || '',
        detail: e.cgpa ? `CGPA: ${e.cgpa}` : (e.detail || ''),
      }));
    }
    // Map experience: duration→dates, description→detail
    if (profile.experience?.length) {
      mapped.experience = profile.experience.map((e) => ({
        title: e.title || '',
        company: e.company || '',
        dates: e.duration || e.dates || '',
        description: e.description || '',
        detail: e.description || e.detail || '',
      }));
    }
    // Map projects: title→name, technologies→stack, link→url, description→detail
    if (profile.projects?.length) {
      mapped.projects = profile.projects.map((p) => ({
        name: p.title || p.name || '',
        stack: p.technologies || p.stack || '',
        url: p.link || p.url || '',
        detail: p.description || p.detail || '',
        linkLabel: (p.link || p.url) ? 'GitHub' : '',
      }));
    }
    // Map links
    if (profile.links) {
      if (!mapped.linkedin && profile.links.linkedin) mapped.linkedin = profile.links.linkedin;
      if (!mapped.github && profile.links.github) mapped.github = profile.links.github;
    }
    return mapped;
  };

  const handleJobLink = async () => {
    setError('');
    setStatus('');
    if (!jobLink.trim()) {
      setError('Paste the job link first.');
      return;
    }
    const profile = profileStore.get() || {};
    const url = jobLink.trim();
    setApplyUrl(url);
    setLinkOpen(false);
    // Push profile to extension if installed, but don't block tailoring
    extensionInstalled().then((ready) => { if (ready) pushProfileToExtension(); });
    setStatus('Reading the job and tailoring a one-page resume…');
    try {
      const mappedProfile = mapProfileForBackend(profile);
      const active = resumes.find((item) => item.isActive) || resumes[0];
      const resumeText = active?.text?.trim() || profile.resume?.text?.trim() || '';
      if (!resumeText) {
        throw new Error('Upload your resume PDF first. Tailoring from profile fields alone can produce an inaccurate resume.');
      }
      const result = await api.tailorExternalJob({
        url,
        profile: mappedProfile,
        resumeText,
        template: selectedTemplate,
      });
      setTailored(result);
      setFormatId(result.recommendedId || 'recommended');
      setJobLink('');
      setStatus('');
    } catch (err) {
      setStatus('');
      const raw = err.message || '';
      let message = 'Could not tailor a resume for that link.';
      if (/failed to fetch|networkerror|load failed|fetch/i.test(raw)) {
        message = 'Could not connect to the server. Make sure the backend is running (npm start) and try again.';
      } else if (/timeout|timed out|aborted/i.test(raw)) {
        message = 'The request timed out. The job page may be slow or unreachable. Try a different link or try again.';
      } else {
        const jsonStart = raw.indexOf('{');
        if (jsonStart >= 0) {
          try { message = JSON.parse(raw.slice(jsonStart)).error || message; } catch { message = raw; }
        } else if (raw) message = raw;
      }
      setError(message);
    }
  };

  const acceptTailored = async () => {
    if (!tailored) return;
    setError('');
    const destination = applyUrl || tailored.job?.applyUrl || tailored.job?.sourceUrl || tailored.job?.url;
    if (!destination || /\/error(\/|$)|\/500(\/|$)/i.test(destination)) {
      setError('That job address is an error page. Paste the Apply page URL from the address bar.');
      return;
    }
    const rawProfile = profileStore.get() || {};
    const profile = mapProfileForBackend(rawProfile);
    if (!profile.fullName) {
      const active = resumes.find((item) => item.isActive) || resumes[0];
      profile.fullName = active?.name?.replace(/\.[^/.]+$/, '') || 'Candidate';
    }
    if (!profile.links) profile.links = {};
    if (!profile.links.linkedin && profile.linkedin) profile.links.linkedin = profile.linkedin;
    const chosen = tailored.formats.find((item) => item.id === formatId) || tailored.formats[0];
    if (!chosen?.pdfBase64) {
      setError('The tailored PDF is missing. Tailor the job link again, then Accept.');
      return;
    }
    const name = `${(profile.fullName || 'resume').split(' ')[0]}-${(tailored.job?.company || 'job').replace(/\s+/g, '-')}-resume.pdf`;
    setResumes(resumeStore.add({
      name,
      size: '1 page PDF',
      type: 'application/pdf',
      text: tailored.plainText || '',
      pdfBase64: chosen.pdfBase64,
      jobUrl: destination,
    }));
    const ready = await new Promise((resolve) => {
      const onMsg = (event) => {
        if (event.source !== window || event.data?.source !== 'hamzo-extension') return;
        if (event.data.type !== 'HAMZO_APPLY_READY') return;
        window.removeEventListener('message', onMsg);
        resolve(event.data);
      };
      window.addEventListener('message', onMsg);
      window.postMessage({
        source: 'hamzo-app',
        type: 'HAMZO_START_APPLY',
        url: destination,
        profile,
        answers: savedAnswers(),
        resumeBase64: chosen.pdfBase64,
        resumeName: name,
      }, '*');
      setTimeout(() => {
        window.removeEventListener('message', onMsg);
        resolve({ ok: false, error: 'Hamzo Apply did not respond. Reload the unpacked extension, then refresh this page.' });
      }, 10000);
    });
    if (!ready.ok) {
      setError(ready.error || 'Reload Hamzo Apply, then Accept again.');
      return;
    }
    window.open(ready.url || destination, '_blank');
    setTailored(null);
    setStatus('The job page opened with your tailored PDF ready to attach. Hamzo Apply will fill the form on that tab.');
  };

  const handleResumeUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    setStatus('');
    try {
      let text = '';
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const body = new FormData();
        body.append('file', file);
        const res = await fetch('/api/resume/extract-text', { method: 'POST', body });
        const data = await res.json();
        text = data.text || '';
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const resumeMeta = {
        fileName: file.name,
        fileSize: `${(file.size / 1024).toFixed(1)} KB`,
        uploadedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        dataUrl,
        fileType: file.type || 'application/pdf',
        text,
      };
      // One master resume everywhere: the Profile section card and the
      // tailoring store stay in sync with whichever page uploaded it.
      const current = profileStore.get() || {};
      profileStore.save({ ...current, resume: resumeMeta });
      setProfileResume(resumeMeta);
      setResumes(resumeStore.add({
        name: file.name,
        size: resumeMeta.fileSize,
        type: file.type,
        text,
      }));
      setStatus('Resume uploaded. Applications will be tailored in your selected template.');
    } catch (err) {
      setError('Could not read that resume. Try a text-based PDF.');
    } finally {
      setUploading(false);
    }
  };

  const viewProfileResume = () => {
    if (!profileResume?.dataUrl) return;
    const win = window.open();
    if (!win) return;
    win.document.write(
      `<iframe src="${profileResume.dataUrl}" frameborder="0" style="border:0; top:0; left:0; bottom:0; right:0; width:100%; height:100%;" allowfullscreen></iframe>`
    );
  };

  const chooseTemplate = (id) => setSelectedTemplate(setSelectedTemplateId(id));

  const handleSetActive = (id) => setResumes(resumeStore.setActive(id));
  const handleRemove = (id) => setResumes(resumeStore.remove(id));

  return (
    <div className="page-resume">
      <header className="page-header">
        <div>
          <h1>Resume</h1>
          <p>Manage your master resume, pick a template, and tailor it for every application.</p>
        </div>
        <div className="header-actions">
          <button className="btn-ghost" onClick={() => { setError(''); setLinkOpen(true); }}>
            <Plus size={16} /> Add job link
          </button>
          <button className="btn-accent" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Upload Resume
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" onChange={handleResumeUpload} style={{ display: 'none' }} />
      </header>

      {/* Master resume — shown from the Profile upload, or uploaded right here */}
      <section className="profile-section">
        <h2>Your resume</h2>
        {profileResume ? (
          <article className="resume-card active" onClick={viewProfileResume} style={{ cursor: 'pointer' }}>
            <div className="resume-card-icon"><FileText size={24} /></div>
            <div className="resume-card-info">
              <strong>{profileResume.fileName}</strong>
              <div className="resume-card-meta">
                <span>{profileResume.fileSize}</span>
                <span><Clock size={12} /> Uploaded on {profileResume.uploadedAt}</span>
              </div>
            </div>
            <div className="resume-card-actions" onClick={(event) => event.stopPropagation()}>
              <span className="status-badge connected"><CheckCircle size={14} /> Master</span>
              <button className="btn-ghost sm" onClick={viewProfileResume}><Eye size={14} /> View</button>
              <button className="btn-ghost sm" onClick={() => fileRef.current?.click()}><Upload size={14} /> Replace</button>
            </div>
          </article>
        ) : (
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              border: '2px dashed #c9c8c0',
              borderRadius: 16,
              background: '#fbfbf8',
              padding: '30px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            <div style={{ width: 52, height: 52, borderRadius: 14, background: '#f0efe9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Upload size={24} />
            </div>
            <strong style={{ fontSize: 16 }}>{uploading ? 'Reading your resume…' : 'Upload your resume'}</strong>
            <p style={{ fontSize: 13, color: '#666', margin: 0, maxWidth: 440, lineHeight: 1.5 }}>
              Upload the master resume here (or from your Profile section). HAMZO tailors it for every application in the template you select below.
            </p>
            <span
              className="btn-accent"
              style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, fontSize: 13 }}
            >
              <Upload size={15} /> {uploading ? 'Uploading…' : 'Upload Resume'}
            </span>
          </div>
        )}
      </section>

      {/* Template gallery — the selected template drives every tailored resume */}
      <section className="profile-section" style={{ marginTop: 20 }}>
        <h2>Resume templates</h2>
        <p style={{ fontSize: 13.5, color: '#666', margin: '4px 0 14px', lineHeight: 1.5 }}>
          Select a template once — every application resume HAMZO tailors will use it until you change it.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {RESUME_TEMPLATES.map((t) => {
            const selected = selectedTemplate === t.id;
            return (
              <div
                key={t.id}
                onClick={() => chooseTemplate(t.id)}
                style={{
                  border: selected ? '2px solid #445cf5' : '1px solid #d9d9d2',
                  borderRadius: 14,
                  background: selected ? '#f4f6ff' : '#fff',
                  padding: 14,
                  cursor: 'pointer',
                  boxShadow: selected ? '0 8px 24px rgba(68, 92, 245, 0.12)' : '0 2px 8px rgba(0, 0, 0, 0.04)',
                  transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
                  position: 'relative',
                }}
              >
                <div style={{ position: 'absolute', top: 20, right: 20, display: 'flex', gap: 6, zIndex: 1 }}>
                  {selected && (
                    <span style={{ fontSize: 10, fontWeight: 800, background: '#445cf5', color: '#fff', padding: '3px 8px', borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <CheckCircle size={11} /> Selected
                    </span>
                  )}
                  {!selected && t.isDefault && (
                    <span style={{ fontSize: 10, fontWeight: 800, background: '#f0efe9', color: '#555852', padding: '3px 8px', borderRadius: 12 }}>
                      Default
                    </span>
                  )}
                </div>
                <TemplatePreview variant={t.id} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                  <LayoutTemplate size={14} />
                  <strong style={{ fontSize: 14.5 }}>{t.name}</strong>
                </div>
                <p style={{ fontSize: 12, color: '#666', margin: '4px 0 0', lineHeight: 1.45 }}>{t.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Tailored + uploaded resume versions */}
      <section className="profile-section" style={{ marginTop: 20 }}>
        <h2>Resume versions</h2>
        {resumes.length === 0 ? (
          <p style={{ fontSize: 13.5, color: '#666', margin: 0 }}>
            Tailored versions appear here after you apply with a job link.
          </p>
        ) : (
          <div className="resume-list">
            {resumes.map(r => (
              <article key={r.id} className={`resume-card ${r.isActive ? 'active' : ''}`} onClick={() => openPdf(r.pdfBase64)} style={{ cursor: r.pdfBase64 ? 'pointer' : 'default' }}>
                <div className="resume-card-icon"><FileText size={24} /></div>
                <div className="resume-card-info">
                  <strong>{r.name}</strong>
                  <div className="resume-card-meta">
                    <span>{r.size}</span>
                    <span><Clock size={12} /> {new Date(r.uploadedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="resume-card-actions" onClick={(event) => event.stopPropagation()}>
                  {r.pdfBase64 && (
                    <button className="btn-ghost sm" onClick={() => downloadPdf(r.pdfBase64, r.name)}>Download PDF</button>
                  )}
                  {r.isActive ? (
                    <span className="status-badge connected"><CheckCircle size={14} /> Active</span>
                  ) : (
                    <button className="btn-ghost sm" onClick={() => handleSetActive(r.id)}>Set Active</button>
                  )}
                  <button className="btn-ghost danger sm" onClick={() => handleRemove(r.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="resume-info">
        <h3>How resume management works</h3>
        <div className="resume-flow">
          <div className="flow-step"><span>1</span><p>Upload your master resume</p></div>
          <div className="flow-arrow">→</div>
          <div className="flow-step"><span>2</span><p>Select the resume template you like</p></div>
          <div className="flow-arrow">→</div>
          <div className="flow-step"><span>3</span><p>Paste an external job link to tailor one page</p></div>
          <div className="flow-arrow">→</div>
          <div className="flow-step"><span>4</span><p>Attached to applications</p></div>
        </div>
      </section>

      {status && <p style={{ marginTop: 16, color: '#047857', fontWeight: 700 }}>{status}</p>}
      {error && <p style={{ marginTop: 16, color: '#b91c1c', fontWeight: 700 }}>{error}</p>}

      <JobAnalyzerModal
        isOpen={linkOpen}
        onClose={() => setLinkOpen(false)}
        onAccepted={() => setResumes(resumeStore.getAll())}
      />

      {extensionPrompt && (
        <Dialog title="Add the Hamzo extension first" onClose={() => setExtensionPrompt(false)}>
          <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.55, color: '#555852' }}>
            Hamzo Apply is already in Chrome. Click the reload icon on that extension card, refresh this Resume page, then store your profile.
          </p>
          <p style={{ margin: '0 0 18px', fontSize: 13, lineHeight: 1.5, color: '#171817' }}>
            Chrome → Extensions → Load unpacked → select <code>d:\Automation\extension</code>
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn-ghost" onClick={() => setExtensionPrompt(false)}>Close</button>
            <button type="button" className="btn-accent" onClick={async () => {
              const ready = await extensionInstalled();
              if (!ready) {
                setExtensionPrompt(false);
                setError('Hamzo Apply is installed, but this tab has not picked it up yet. On chrome://extensions, click the reload icon on Hamzo Apply, then refresh this Resume page and click again.');
                return;
              }
              pushProfileToExtension();
              setExtensionPrompt(false);
              setStatus('Extension connected. Your profile is stored. Paste the job link again.');
            }}>Store my Hamzo details</button>
          </div>
        </Dialog>
      )}

      {tailored && (
        <section className="profile-section" style={{ marginTop: 20 }}>
          <h2>Tailored resume for {tailored.job?.title || 'this job'}{tailored.job?.company ? ` at ${tailored.job.company}` : ''}</h2>
          <p style={{ fontSize: 14, color: '#555852', lineHeight: 1.5 }}>Kept keywords: {(tailored.job?.keywords || []).join(', ') || 'matched to the description'}. Removed: {(tailored.removedKeywords || []).join(', ') || 'none'}. Added: {(tailored.addedKeywords || []).join(', ') || 'none'}.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
            {tailored.formats.map((format) => (
              <button key={format.id} className={format.id === formatId ? 'btn-accent' : 'btn-ghost'} onClick={() => setFormatId(format.id)}>
                {format.name}
              </button>
            ))}
          </div>
          <iframe
            title="Tailored resume"
            src={`${pdfObjectUrl((tailored.formats.find((item) => item.id === formatId) || tailored.formats[0]).pdfBase64)}#toolbar=0&navpanes=0&view=FitV`}
            style={{ width: '100%', maxWidth: 794, height: 1123, display: 'block', margin: '0 auto', border: '1px solid #d9d9d2', borderRadius: 8, background: '#fff' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn-ghost" onClick={() => downloadPdf((tailored.formats.find((item) => item.id === formatId) || tailored.formats[0]).pdfBase64, 'tailored-resume.pdf')}>Download PDF</button>
            <button className="btn-accent" onClick={acceptTailored}>Accept</button>
            <button className="btn-ghost" onClick={() => setTailored(null)}>Decline</button>
          </div>
        </section>
      )}
    </div>
  );
}
