import React, { useEffect, useState, useRef } from 'react';
import { Upload, FileText, Trash2, CheckCircle, Clock, Plus, X } from 'lucide-react';
import EmptyState from '../components/EmptyState';
import { resumeStore, profileStore, api } from '../lib/api';
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

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let text = '';
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      const body = new FormData();
      body.append('file', file);
      try {
        const res = await fetch('/api/resume/extract-text', { method: 'POST', body });
        const data = await res.json();
        text = data.text || '';
      } catch {}
    }
    setResumes(resumeStore.add({
      name: file.name,
      size: (file.size / 1024).toFixed(1) + ' KB',
      type: file.type,
      text,
    }));
  };

  const handleSetActive = (id) => setResumes(resumeStore.setActive(id));
  const handleRemove = (id) => setResumes(resumeStore.remove(id));

  return (
    <div className="page-resume">
      <header className="page-header">
        <div>
          <h1>Resume</h1>
          <p>Manage your master resume and job-specific versions.</p>
        </div>
        <div className="header-actions">
          <button className="btn-ghost" onClick={() => { setError(''); setLinkOpen(true); }}>
            <Plus size={16} /> Add job link
          </button>
          <button className="btn-accent" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Upload Resume
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" onChange={handleUpload} style={{ display: 'none' }} />
      </header>

      {resumes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No resume uploaded"
          description="Upload your master resume to unlock job matching and streamline applications."
          actionLabel="Upload Resume"
          onAction={() => fileRef.current?.click()}
        />
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

      <section className="resume-info">
        <h3>How resume management works</h3>
        <div className="resume-flow">
          <div className="flow-step"><span>1</span><p>Upload your master resume</p></div>
          <div className="flow-arrow">→</div>
          <div className="flow-step"><span>2</span><p>Paste an external job link to tailor one page</p></div>
          <div className="flow-arrow">→</div>
          <div className="flow-step"><span>3</span><p>Attached to applications</p></div>
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
