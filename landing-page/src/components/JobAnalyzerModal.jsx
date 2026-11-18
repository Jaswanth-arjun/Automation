import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Link2, X, Sparkles, CheckCircle2, Circle, Eye, RefreshCw,
  Check, AlertTriangle, FileText, Calendar, Users, Key, Download
} from 'lucide-react';
import { api, profileStore, resumeStore } from '../lib/api';
import { getSelectedTemplateId } from '../lib/resumeTemplates';
import { adminJobStore } from '../lib/adminJobStore';
import { DEMO_JOBS } from '../lib/mockData';
import { useAuth } from '../lib/auth';
import { jobOwner } from '../lib/jobOwnership';
import { shortenJobTitle } from './jobTitle';
import { mapProfileForBackend, extractResumeLocation, profileResumeText, keywordAudit, scoreValue, scoreLabel, extractProfilePdf } from './JobAnalyzerModal.helpers';
import './JobAnalyzerModal.css';

/* ── helpers ─────────────────────────────────────────────── */

function pdfObjectUrl(base64) {
  if (!base64) return '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
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
  link.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  link.click();
}

// Canonical form of a job link so protocol/case/tracking params do not hide duplicates.
function normalizeJobLinkKey(value) {
  try {
    const url = new URL(String(value));
    url.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'gclid', 'fbclid', 'ref', 'source']
      .forEach((p) => url.searchParams.delete(p));
    let s = url.toString();
    while (s.endsWith('/')) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return String(value || '').trim().toLowerCase();
  }
}

// A job already posted in the portal (by admin/recruiter or earlier import)?
// Match on the saved links first — the role+company pair is re-checked by the
// server when the job is actually added.
function findExistingJob(link) {
  const key = normalizeJobLinkKey(link);
  const all = [...adminJobStore.getWithFreshDates(), ...DEMO_JOBS];
  return all.find((job) => [job.applyLink, job.sourceUrl, job.url]
    .filter(Boolean)
    .map(normalizeJobLinkKey)
    .includes(key));
}

function printResumeHtml(html) {
  const win = window.open('', '_blank');
  if (!win) return;  win.document.write(`<html><head><title>Tailored Resume</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111}body{font-family:"Times New Roman",Times,serif;font-size:10px;line-height:1.18}.resume-page{width:595.28px;min-height:841.89px;padding:8.6px 28.8px 8px;margin:0 auto}.resume-page header{text-align:center;border:0;padding:0;margin:0}.resume-page h1{font-family:"Times New Roman",Times,serif;font-size:16.5px;line-height:1;margin:0 0 3px;text-transform:uppercase}.resume-page h2{font-size:10.5px;line-height:1;border-bottom:1px solid #222;padding:0 0 2px;margin:3.2px 0 2px}.resume-page p{font-size:10px;line-height:1.18;margin:0 0 1px}.resume-page article{margin:0 0 2px}.resume-page .entry-title{display:flex;justify-content:space-between;gap:10px;line-height:1.1}.resume-page .entry-link{margin:0}.resume-page a{color:#1649d8;text-decoration:none}.resume-page .skill-row{display:grid;grid-template-columns:140px 1fr;gap:0;margin:0;line-height:1.12}.resume-page .skill-row b{font-weight:bold}.resume-page i{font-weight:normal} @media print{body{width:595.28px}.resume-page{margin:0}}</style></head><body>${html}</body></html>`);
  win.document.close(); win.focus(); win.print();
}

export function ResumeRichEditor({ plainText, initialHtml = '', onSave, onClose, readOnly = false }) {
  const editorRef = React.useRef(null);
  const savedSelectionRef = React.useRef(null);
  const [fontSize, setFontSize] = React.useState('3');
  const html = initialHtml || String(plainText || '').split(/\n+/).filter(Boolean).map(line => `<p>${line.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]))}</p>`).join('');
  React.useEffect(() => { if (editorRef.current && !editorRef.current.innerHTML.trim()) editorRef.current.innerHTML = html; }, [html]);
  const saveSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount && editorRef.current?.contains(selection.anchorNode)) {
      savedSelectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  };
  const restoreSelection = () => {
    const range = savedSelectionRef.current;
    if (!range) return;
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
  };
  const command = (name, value = null) => { editorRef.current?.focus(); document.execCommand(name, false, value); };
  const selectedAnchor = () => {
    const range = savedSelectionRef.current;
    const nodes = [range?.startContainer, range?.endContainer, range?.commonAncestorContainer, window.getSelection()?.anchorNode];
    for (const node of nodes) {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const anchor = element?.closest?.('a');
      if (anchor) return anchor;
    }
    return null;
  };
  const addLink = () => {
    if (!savedSelectionRef.current) saveSelection();
    const existingAnchor = selectedAnchor();
    const existingUrl = existingAnchor?.getAttribute('href') || '';
    const urlValue = window.prompt(existingUrl ? 'Replace link URL' : 'Paste URL', existingUrl);
    if (!urlValue) return;
    const trimmed = urlValue.trim();
    if (!trimmed || /^(?:javascript|data|vbscript):/i.test(trimmed)) return;
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    // Focusing the editor before restoring the saved range is important:
    // focus can collapse the selection in Chromium, which previously caused
    // the link to be inserted at the caret instead of on the selected name.
    editorRef.current?.focus();
    restoreSelection();
    if (existingAnchor && editorRef.current?.contains(existingAnchor)) {
      // execCommand('createLink') can create a nested anchor or leave the
      // original href untouched when the selected text is already linked.
      // Update the existing anchor directly so replacing LinkedIn/GitHub
      // URLs is deterministic and the edited HTML contains only the new URL.
      existingAnchor.setAttribute('href', url);
      existingAnchor.setAttribute('target', '_blank');
      existingAnchor.setAttribute('rel', 'noopener noreferrer');
      saveSelection();
      return;
    }
    document.execCommand('createLink', false, url);
    saveSelection();
  };
  const save = () => onSave({ html: editorRef.current?.innerHTML || '', text: editorRef.current?.innerText || '' });
  const printResume = () => printResumeHtml(editorRef.current?.innerHTML || '');
  return <div style={editorOverlayStyle} onClick={onClose}>
    <div style={editorDialogStyle} onClick={event => event.stopPropagation()}>
      <style>{`.resume-page{width:100%;margin:0 auto}.resume-page header{text-align:center;border:0;padding:0;margin:0}.resume-page h1{font-family:"Times New Roman",Times,serif;font-size:16.5px;line-height:1;margin:0 0 3px;text-transform:uppercase}.resume-page h2{font-size:10.5px;line-height:1;border-bottom:1px solid #222;padding:0 0 2px;margin:3.2px 0 2px}.resume-page p{font-size:10px;line-height:1.18;margin:0 0 1px}.resume-page article{margin:0 0 2px}.resume-page .entry-title{display:flex;justify-content:space-between;gap:10px;line-height:1.1}.resume-page .entry-link{margin:0}.resume-page a{color:#1649d8;text-decoration:none}.resume-page .skill-row{display:grid;grid-template-columns:140px 1fr;gap:0;margin:0;line-height:1.12}.resume-page i{font-weight:normal}`}</style>
      <div style={editorHeaderStyle}><div><strong>{readOnly ? 'Resume preview' : 'Edit resume'}</strong><span>{readOnly ? 'Read-only view. Use the Edit button to make changes.' : 'Changes are saved to this tailored version.'}</span></div><button onClick={onClose} style={closeButtonStyle}><X size={18} /></button></div>
      {!readOnly && (
        <div style={editorToolbarStyle}>
          <button onClick={() => command('bold')} style={editorToolButton}>Bold</button>
          <button onClick={() => command('italic')} style={editorToolButton}>Italic</button>
          <button onClick={() => command('underline')} style={editorToolButton}>Underline</button>
          <select value={fontSize} onChange={event => { setFontSize(event.target.value); command('fontSize', event.target.value); }} style={editorSelectStyle}><option value="2">Small</option><option value="3">Normal</option><option value="4">Large</option><option value="5">Heading</option></select>
          <button onClick={() => command('formatBlock', 'h2')} style={editorToolButton}>Heading</button>
          <button onClick={() => command('formatBlock', 'p')} style={editorToolButton}>Paragraph</button>
          <button onClick={() => command('insertUnorderedList')} style={editorToolButton}>• List</button>
          <button onMouseDown={event => { event.preventDefault(); saveSelection(); }} onClick={addLink} style={editorToolButton}>Add link</button>
          <button onClick={() => command('justifyLeft')} style={editorToolButton}>Align left</button>
          <button onClick={() => command('justifyCenter')} style={editorToolButton}>Center</button>
        </div>
      )}
      <div style={editorScrollStyle}><div ref={editorRef} contentEditable={!readOnly} suppressContentEditableWarning onMouseUp={saveSelection} onKeyUp={saveSelection} style={{ ...editorPaperStyle, ...(html.includes('resume-page modern') ? { padding: 0 } : {}) }} aria-label={readOnly ? 'Resume preview' : 'Editable resume content'} /></div>
      <div style={editorFooterStyle}>
        <span>{readOnly ? 'This is a preview of your tailored resume.' : 'Tip: select text, then use the toolbar. Use Add link for GitHub or certificate URLs.'}</span>
        <div>
          <button onClick={printResume} className="btn-ghost">Print / Save PDF</button>
          {readOnly ? (
            <button onClick={onClose} className="btn-accent">Close</button>
          ) : (
            <>
              <button onClick={onClose} className="btn-ghost">Cancel</button>
              <button onClick={save} className="btn-accent">Save edits</button>
            </>
          )}
        </div>
      </div>
    </div>
  </div>;
}

/* ── main component ──────────────────────────────────────── */

export default function JobAnalyzerModal({ isOpen, onClose, initialUrl = '', onAccepted, applyMode = false }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState('input');         // 'input' | 'analyzing' | 'result' | 'error'
  const [jobUrl, setJobUrl] = useState(initialUrl);
  const [applyBusy, setApplyBusy] = useState('');    // '' | 'checking' | 'importing'
  const [analysisStep, setAnalysisStep] = useState(0);
  const [tailoredData, setTailoredData] = useState(null);
  const [formatId, setFormatId] = useState('recommended');
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [editorState, setEditorState] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setStep('input');
      setJobUrl(initialUrl || '');
      setApplyBusy('');
      setTailoredData(null);
      setFormatId('recommended');
       setShowPdfPreview(false);
       setEditorState(null);
      setIsSaving(false);
      setErrorMsg('');
      setAnalysisStep(0);
    }
  }, [isOpen, initialUrl]);

  if (!isOpen) return null;

  /* ── Apply with Hamzo: find-or-create the job, then open the apply flow ── */
  const handleApplyWithHamzo = async (e) => {
    if (e) e.preventDefault();
    const link = jobUrl.trim();
    if (!link) return;

    let parsed;
    try {
      parsed = new URL(link);
    } catch {
      setErrorMsg('Enter a valid job link starting with https://');
      return;
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      setErrorMsg('Enter a valid job link starting with https://');
      return;
    }

    setErrorMsg('');
    setApplyBusy('checking');

    // Already in our jobs? Reuse it — never post a duplicate.
    const existing = findExistingJob(link);
    if (existing) {
      onClose();
      navigate(`/dashboard/apply/${existing.id}`);
      return;
    }

    // New job: read it from the link and add it internally, the same way an
    // admin posts from the portal. The server re-checks role+company matches.
    setApplyBusy('importing');
    try {
      const data = await adminJobStore.importFromLink(link);
      const draft = data.job || {};
      const saved = await adminJobStore.add({
        ...draft,
        skills: draft.skills?.length ? draft.skills : [...(draft.requiredSkills || []), ...(draft.preferredSkills || [])],
        applyLink: draft.applyLink || link,
        sourceUrl: data.sourceUrl || link,
        postedBy: jobOwner(user),
      });
      onClose();
      navigate(`/dashboard/apply/${saved.id}`);
    } catch (err) {
      setErrorMsg(err.message || 'That job link could not be read.');
      setApplyBusy('');
    }
  };

  /* ── Actual API call with proper field mapping ── */
  const handleStartAnalysis = async (e) => {
    if (e) e.preventDefault();
    if (!jobUrl || !jobUrl.trim()) return;

    setStep('analyzing');
    setAnalysisStep(0);
    setErrorMsg('');

    // Animate loading steps independently as the real API works
    const t1 = setTimeout(() => setAnalysisStep(1), 2000);
    const t2 = setTimeout(() => setAnalysisStep(2), 5000);

    try {
      const rawProfile = profileStore.get() || {};
      const mappedProfile = mapProfileForBackend(rawProfile);
      const allResumes = resumeStore.getAll();
      const active = allResumes.find(r => r.isActive) || allResumes[0];
      let originalSourceText = active?.text?.trim() || rawProfile.resume?.text?.trim() || '';
      // Older profile records kept the PDF data URL but not extracted text.
      // Recover the text from that already-uploaded PDF instead of asking the
      // user to upload the same resume again.
      if (rawProfile.resume?.dataUrl) {
        const storedPdf = await extractProfilePdf(rawProfile);
        if (!originalSourceText) originalSourceText = storedPdf.text;
        if (storedPdf.links.length || !rawProfile.resume.links?.length) {
          profileStore.save({ ...rawProfile, resume: { ...rawProfile.resume, text: originalSourceText, links: storedPdf.links.length ? storedPdf.links : (rawProfile.resume.links || []), linkItems: storedPdf.linkItems?.length ? storedPdf.linkItems : (rawProfile.resume.linkItems || []) } });
        }
      }
      // Last fallback: use the structured profile fields. This keeps older
      // profiles usable while still preferring the actual PDF text whenever it
      // is available.
      if (!originalSourceText) originalSourceText = profileResumeText(rawProfile).trim();
      if (!originalSourceText) {
        throw new Error('Add a readable resume PDF in Profile before tailoring.');
      }
      const resumeLocation = extractResumeLocation(originalSourceText, rawProfile.location);
      if (resumeLocation) {
        mappedProfile.location = resumeLocation;
        if (rawProfile.location !== resumeLocation) {
          profileStore.save({ ...rawProfile, location: resumeLocation });
        }
      }

      const result = await api.tailorExternalJob({
        url: jobUrl.trim(),
        profile: mappedProfile,
        resumeText: originalSourceText,
        template: getSelectedTemplateId(),
      });

      clearTimeout(t1);
      clearTimeout(t2);
      setAnalysisStep(2);

      setTimeout(() => {
        setTailoredData(result);
        setFormatId(result.recommendedId || 'recommended');
        setStep('result');
      }, 600);

    } catch (err) {
      clearTimeout(t1);
      clearTimeout(t2);
      console.error('Tailor API error:', err);

      // Parse meaningful error message
      const raw = err.message || '';
      let message = 'Could not tailor a resume for that link.';
      const jsonStart = raw.indexOf('{');
      if (jsonStart >= 0) {
        try { message = JSON.parse(raw.slice(jsonStart)).error || message; } catch { message = raw; }
      } else if (/^(?:TypeError:\s*)?failed to fetch$/i.test(raw.trim()) || /^networkerror\b/i.test(raw.trim()) || /^load failed\b/i.test(raw.trim())) {
        message = 'Could not connect to the server. Make sure the backend is running and try again.';
      } else if (/timeout|timed out|aborted/i.test(raw)) {
        message = 'The request timed out. The job page may be slow or unreachable. Try a different link or try again.';
      } else if (raw) {
        message = raw;
      }

      setErrorMsg(message);
      setStep('error');
    }
  };

  /* ── Accept tailored resume — uses actual profile data ── */
  const handleAcceptResume = () => {
    if (!tailoredData) return;
    setIsSaving(true);

    try {
      const rawProfile = profileStore.get() || {};
      const profile = mapProfileForBackend(rawProfile);
      if (!profile.fullName) {
        const allResumes = resumeStore.getAll();
        const active = allResumes.find(r => r.isActive) || allResumes[0];
        profile.fullName = active?.name?.replace(/\.[^/.]+$/, '') || 'Candidate';
      }
       const chosen = tailoredData.formats?.find(f => f.id === formatId) || tailoredData.formats?.[0];
      if (!chosen?.pdfBase64) {
        setErrorMsg('The tailored PDF is missing. Please regenerate.');
        setIsSaving(false);
        return;
      }

      const firstName = (profile.fullName || 'resume').split(' ')[0];
      const company = (tailoredData.job?.company || 'job').replace(/\s+/g, '-');
      const fileName = `${firstName}-${company}-resume.pdf`;

       // Register the job before saving so the saved tailored resume has a valid job id.
       const jobTitle = tailoredData.job?.title || 'Software Engineer';
       const companyName = tailoredData.job?.company || 'Company';
       const location = tailoredData.job?.location || 'Remote';
       const allJobs = [...adminJobStore.getWithFreshDates(), ...DEMO_JOBS];
       let targetJob = allJobs.find(j => j.title?.toLowerCase().trim() === jobTitle.toLowerCase().trim() && j.company?.toLowerCase().trim() === companyName.toLowerCase().trim());
        if (!targetJob) targetJob = adminJobStore.add({ title: jobTitle, company: companyName, companyLogoUrl: tailoredData.job?.logo || '', location, category: 'Freshers', type: 'Full Time', applyLink: tailoredData.job?.applyUrl || jobUrl, skills: tailoredData.job?.keywords || ['Software Development'], description: tailoredData.job?.description ?? tailoredData.jobDescription ?? '' });

       resumeStore.add({
        name: fileName,
         size: chosen.pageCount ? `${chosen.pageCount} page PDF` : 'PDF',
        type: 'application/pdf',
         text: chosen.plainText ?? tailoredData.plainText ?? '',
         editedHtml: chosen.editedHtml || '',
         editedPlainText: chosen.editedPlainText || '',
         pdfBase64: chosen.pdfBase64,
        jobUrl: tailoredData.job?.applyUrl || tailoredData.job?.url || jobUrl,
         jobId: targetJob.id,
         company: companyName,
         title: jobTitle,
      });


      if (onAccepted) onAccepted();
      setIsSaving(false);
      onClose();

      // Navigate to Apply page for this job
      navigate(`/dashboard/apply/${targetJob.id}`);
    } catch (e) {
      console.error(e);
      setErrorMsg('Failed to save resume. Try again.');
      setIsSaving(false);
    }
  };

  /* ── Derived values ── */
  const job = tailoredData?.job || {};
  const shortJobTitle = shortenJobTitle(job.title) || 'Job Role';
  const chosenFormat = tailoredData?.formats?.find(f => f.id === formatId) || tailoredData?.formats?.[0];
  const profile = profileStore.get() || {};
  const ats = chosenFormat?.ats ?? tailoredData?.ats ?? {};
  const beforeScore = scoreValue(ats.beforeScore);
  const afterScore = scoreValue(ats.afterScore);
  const audit = keywordAudit(ats);
  const matchedCount = audit[1].values.length;
  const totalCount = Array.isArray(ats.jobKeywords) ? ats.jobKeywords.length : null;
  const keywordRows = (Array.isArray(ats.jobKeywords) ? ats.jobKeywords : []).map((keyword) => {
    const exactAfter = (ats.matchedKeywordsAfter || ats.matchedKeywords || []).includes(keyword);
    const partialAfter = (ats.partialKeywordsAfter || []).includes(keyword);
    const exactBefore = (ats.matchedKeywordsBefore || []).includes(keyword);
    const wasRemoved = exactBefore && !exactAfter && !partialAfter;
    let status, tagIcon;
    if (exactAfter && exactBefore) { status = 'Already Present'; tagIcon = '✓'; }
    else if (exactAfter && !exactBefore) { status = 'Newly Added'; tagIcon = '＋'; }
    else if (wasRemoved) { status = 'Removed'; tagIcon = '✗'; }
    else if (partialAfter) { status = 'Partial'; tagIcon = '●'; }
    else { status = 'Missing'; tagIcon = '⚠'; }
    return { keyword, status, tagIcon, before: exactBefore, added: exactAfter && !exactBefore };
  });
  const scoreDelta = tailoredData?.scoreDelta ?? ((afterScore !== null && beforeScore !== null) ? afterScore - beforeScore : null);

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div
        style={{
          ...modalDialogStyle,
          maxWidth: step === 'result' ? '860px' : '480px',
        }}
        onClick={e => e.stopPropagation()}
      >

        {/* ==================== STEP 1: INPUT URL ==================== */}
        {step === 'input' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: '#eef2ff', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Link2 size={22} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '19px', fontWeight: '800', color: '#0f172a' }}>Add Job Link</h3>
                  <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                    {applyMode
                      ? 'Paste a valid job link — Hamzo opens the application flow for it'
                      : 'Paste a job URL to analyze & tailor your resume'}
                  </p>
                </div>
              </div>
              <button onClick={onClose} style={closeButtonStyle}><X size={16} /></button>
            </div>

            <form onSubmit={applyMode ? handleApplyWithHamzo : handleStartAnalysis}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', marginBottom: '8px' }}>
                  Job Page URL
                </label>
                <input
                  type="url"
                  placeholder="https://boards.greenhouse.io/... or https://jobs.lever.co/..."
                  value={jobUrl}
                  onChange={e => setJobUrl(e.target.value)}
                  autoFocus
                   style={{
                    width: '100%',
                    padding: '13px 16px',
                    borderRadius: '12px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    background: '#f8fafc',
                    color: '#0f172a'
                  }}
                />
              </div>

              {applyMode && errorMsg && (
                <p style={{ margin: '-8px 0 14px', fontSize: '12px', fontWeight: 600, color: '#b42318', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <AlertTriangle size={13} /> {errorMsg}
                </p>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
                <button
                  type="submit"
                  className="btn-accent"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: applyBusy ? 0.65 : 1 }}
                  disabled={applyBusy !== ''}
                >
                  {applyMode
                    ? (applyBusy === 'checking' ? 'Checking jobs…' : applyBusy === 'importing' ? 'Importing job…' : 'Apply with Hamzo')
                    : 'Analyze & Tailor'}
                  {applyBusy === '' && <Sparkles size={15} />}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ==================== STEP 2: ANALYZING (Real API in progress) ==================== */}
        {step === 'analyzing' && (
          <div style={{ textAlign: 'center', padding: '20px 10px 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#eef2ff', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Link2 size={18} />
                </div>
                <strong style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>Add Job Link</strong>
              </div>
              <button onClick={onClose} style={closeButtonStyle}><X size={16} /></button>
            </div>

            <div style={{ position: 'relative', width: '100px', height: '100px', margin: '30px auto 20px' }}>
              <div style={spinnerRingStyle} />
              <div style={spinnerCenterStyle}>
                <Sparkles size={28} color="#4f46e5" />
              </div>
            </div>

            <h3 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', margin: '0 0 4px' }}>
              Analyzing job...
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 32px' }}>
              Reading the job page and tailoring your resume — this may take 15–30 seconds
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '280px', margin: '0 auto', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {analysisStep > 0
                  ? <CheckCircle2 size={20} color="#4f46e5" fill="#eef2ff" />
                  : <div style={activeDotStyle} />}
                <span style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>
                  Extracting job requirements
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {analysisStep > 1
                  ? <CheckCircle2 size={20} color="#4f46e5" fill="#eef2ff" />
                  : analysisStep === 1
                    ? <div style={activeDotStyle} />
                    : <Circle size={20} color="#cbd5e1" />}
                <span style={{ fontSize: '14px', fontWeight: analysisStep >= 1 ? '700' : '500', color: analysisStep >= 1 ? '#0f172a' : '#94a3b8' }}>
                  Matching with your profile
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {analysisStep >= 2
                  ? <div style={activeDotStyle} />
                  : <Circle size={20} color="#cbd5e1" />}
                <span style={{ fontSize: '14px', fontWeight: analysisStep >= 2 ? '700' : '500', color: analysisStep >= 2 ? '#0f172a' : '#94a3b8' }}>
                  Generating tailored resume
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ==================== ERROR STATE ==================== */}
        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '20px 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <strong style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>Analysis Failed</strong>
              <button onClick={onClose} style={closeButtonStyle}><X size={16} /></button>
            </div>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#fef2f2', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <AlertTriangle size={32} />
            </div>
            <p style={{ fontSize: '14px', color: '#b91c1c', fontWeight: '600', margin: '0 0 8px' }}>{errorMsg}</p>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 24px' }}>
              Make sure the backend server is running and the job URL is a valid public page.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button onClick={() => { setStep('input'); setErrorMsg(''); }} className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <RefreshCw size={14} /> Try Again
              </button>
              <button onClick={onClose} className="btn-accent">Close</button>
            </div>
          </div>
        )}

        {/* ==================== STEP 3: REAL RESULT OUTPUT ==================== */}
        {step === 'result' && tailoredData && (
          <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#eef2ff', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Link2 size={22} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.02em' }}>
                    Job Analysis & Tailored Resume
                  </h2>
                  <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>
                     We've analyzed the job and created a tailored resume for you.
                  </p>
                </div>
              </div>
              <button onClick={onClose} style={closeButtonStyle}><X size={18} /></button>
            </div>

            {/* Job Overview Card */}
            <div style={jobOverviewCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={companyLogoStyle}>
                    <span style={{ fontSize: '20px', fontWeight: '800', color: '#4f46e5' }}>
                      {(job.company || 'C')[0].toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                       {shortJobTitle}
                    </h3>
                    <p style={{ margin: '3px 0 6px', fontSize: '13px', color: '#64748b' }}>
                       {job.company || 'Company'} {job.location ? `· ${job.location}` : ''}
                    </p>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {(job.keywords || []).slice(0, 4).map(kw => (
                        <span key={kw} style={chipStyle}>{kw}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Before/after ATS comparison */}
                <div className="ats-comparison-card">
                  <div className="ats-comparison-side">
                    <div className="ats-score-ring before">
                      <svg width="74" height="74" viewBox="0 0 36 36">
                        <path stroke="#dbe3ee" strokeWidth="3.5" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                        <path stroke="#64748b" strokeWidth="3.5" strokeDasharray={`${beforeScore ?? 0}, 100`} strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                      </svg>
                      <strong>{beforeScore === null ? 'N/A' : `${beforeScore}%`}</strong>
                    </div>
                    <div>
                      <strong>Before</strong>
                      <span>ATS score</span>
                    </div>
                  </div>
                  <div className="ats-comparison-message">
                    {scoreDelta !== null && scoreDelta > 0 && (
                      <span className="ats-delta-badge">+{scoreDelta}%</span>
                    )}
                    <span aria-hidden="true">→</span>
                    <p>{scoreLabel(beforeScore, afterScore)}</p>
                  </div>
                  <div className="ats-comparison-side improved">
                    <div>
                      <strong>After</strong>
                      <span>ATS score</span>
                    </div>
                    <div className="ats-score-ring after">
                      <svg width="74" height="74" viewBox="0 0 36 36">
                        <path stroke="#dbe3ee" strokeWidth="3.5" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                        <path stroke="#10b981" strokeWidth="3.5" strokeDasharray={`${afterScore ?? 0}, 100`} strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                      </svg>
                      <strong>{afterScore === null ? 'N/A' : `${afterScore}%`}</strong>
                    </div>
                  </div>
                </div>
              </div>

              {job.title && job.title !== shortJobTitle && (
                <details style={{ marginTop: '12px', fontSize: '11.5px', color: '#64748b' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: '700', color: '#475569' }}>Full job details</summary>
                  <p style={{ margin: '8px 0 0', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>{job.title}</p>
                </details>
              )}

              {/* Key Details Row */}
              <div style={{ display: 'flex', gap: '16px', marginTop: '16px', paddingTop: '14px', borderTop: '1px dashed #e2e8f0', flexWrap: 'wrap' }}>
                <div className="keyword-stat-pill stat-present">
                  <span className="keyword-stat-dot" style={{ background: '#10b981' }} />
                  Already Present: <strong>{keywordRows.filter(r => r.status === 'Already Present').length}</strong>
                </div>
                <div className="keyword-stat-pill stat-added">
                  <span className="keyword-stat-dot" style={{ background: '#4f46e5' }} />
                  Newly Added: <strong>{keywordRows.filter(r => r.status === 'Newly Added').length}</strong>
                </div>
                {keywordRows.filter(r => r.status === 'Removed').length > 0 && (
                  <div className="keyword-stat-pill stat-removed">
                    <span className="keyword-stat-dot" style={{ background: '#94a3b8' }} />
                    Removed: <strong>{keywordRows.filter(r => r.status === 'Removed').length}</strong>
                  </div>
                )}
                {keywordRows.filter(r => r.status === 'Missing').length > 0 && (
                  <div className="keyword-stat-pill stat-missing">
                    <span className="keyword-stat-dot" style={{ background: '#ef4444' }} />
                    Missing: <strong>{keywordRows.filter(r => r.status === 'Missing').length}</strong>
                  </div>
                )}
                <div className="keyword-stat-pill stat-total">
                  <Key size={12} color="#4f46e5" />
                  Total: <strong>{totalCount ?? 'N/A'}</strong>
                </div>
              </div>
            </div>

            {/* 2 Column Grid */}
            <div className="job-analyzer-grid" style={{ display: 'grid', gap: '20px', marginBottom: '20px' }}>

              {/* LEFT: Your Match Overview */}
              <div style={columnCardStyle}>
                <h4 style={{ margin: '0 0 14px', fontSize: '14.5px', fontWeight: '800', color: '#0f172a' }}>
                  Keyword Analysis
                </h4>
                <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 12px' }}>JD keyword coverage — shows which keywords were added, already present, removed, or still missing after tailoring.</p>
                {!keywordRows.length ? <p style={{ fontSize: '13px', color: '#94a3b8' }}>No keyword audit returned by the server.</p> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {keywordRows.map(({ keyword, status, tagIcon, added }) => (
                      <div key={keyword} className={`keyword-row-enhanced keyword-row-${status.toLowerCase().replace(/\s+/g, '-')}`}>
                        <span className="keyword-name">{keyword}</span>
                        <span className={`keyword-status-badge status-${status.toLowerCase().replace(/\s+/g, '-')}`}>
                          {tagIcon} {status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* RIGHT: Tailored Resume Preview */}
              <div style={columnCardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <h4 style={{ margin: 0, fontSize: '14.5px', fontWeight: '800', color: '#0f172a' }}>
                      Tailored Resume Preview
                    </h4>
                  </div>
                </div>
                <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#64748b' }}>
                   Tailored for {shortJobTitle} at {job.company || 'the company'}
                </p>

                {/* Format Selector (if multiple formats) */}
                {tailoredData.formats?.length > 1 && (
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
                    {tailoredData.formats.map(f => (
                      <button
                        key={f.id}
                        onClick={() => setFormatId(f.id)}
                        style={{
                          padding: '5px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', cursor: 'pointer',
                          border: formatId === f.id ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                          background: formatId === f.id ? '#eef2ff' : '#ffffff',
                          color: formatId === f.id ? '#4f46e5' : '#64748b',
                        }}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* PDF File Box */}
                <div className="job-analyzer-file-box" style={fileBoxStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: '#eef2ff', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <FileText size={18} />
                    </div>
                    <div>
                      <strong style={{ display: 'block', fontSize: '12.5px', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }}>
                        {(profile.fullName || 'Resume').split(' ')[0]}-{(job.company || 'job').replace(/\s+/g, '-')}-resume.pdf
                      </strong>
                       <span style={{ fontSize: '11px', color: '#94a3b8' }}>PDF{chosenFormat?.pageCount ? ` · ${chosenFormat.pageCount} pages` : ''}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => setEditorState({ formatId, format: chosenFormat })}
                      disabled={!chosenFormat?.pdfBase64}
                      style={{ ...previewButtonStyle, opacity: chosenFormat?.pdfBase64 ? 1 : 0.4 }}
                    >
                      <Eye size={13} /> Preview / Edit
                    </button>
                     <button
                       onClick={async () => {
                        const name = `${(profile.fullName || 'resume').split(' ')[0]}-${(job.company || 'job').replace(/\s+/g, '-')}-resume`;
                        // Download the generated PDF directly. Do not route
                        // downloads through the print dialog; the browser's
                        // print preview is only appropriate for the editor's
                        // explicit "Print / Save PDF" action.
                        if (chosenFormat?.editedHtml) {
                          try {
                            const result = await api.renderEditedResumePdf(chosenFormat.editedHtml);
                            downloadPdf(result.pdfBase64, name);
                          } catch (error) {
                            console.error('Edited PDF download failed:', error);
                            setErrorMsg('Could not create the edited PDF. Please try again.');
                          }
                        } else downloadPdf(chosenFormat?.pdfBase64, name);
                      }}
                      disabled={!chosenFormat?.pdfBase64}
                      style={{ ...previewButtonStyle, opacity: chosenFormat?.pdfBase64 ? 1 : 0.4 }}
                    >
                      <Download size={13} /> Download
                    </button>
                  </div>
                </div>

                {/* What's tailored info box */}
                <div style={whatsTailoredBoxStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: '700', color: '#4338ca', marginBottom: '8px' }}>
                    <Sparkles size={14} /> What's tailored?
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '11.5px', color: '#475569', lineHeight: '1.6' }}>
                    {tailoredData.addedKeywords?.length > 0 && (
                      <li>Added {tailoredData.addedKeywords.slice(0, 4).join(', ')}{tailoredData.addedKeywords.length > 4 ? ` +${tailoredData.addedKeywords.length - 4}` : ''}</li>
                    )}
                    {tailoredData.removedKeywords?.length > 0 && (
                      <li>Removed {tailoredData.removedKeywords.slice(0, 4).join(', ')}{tailoredData.removedKeywords.length > 4 ? ` +${tailoredData.removedKeywords.length - 4}` : ''}</li>
                    )}
                    <li>Rephrased summary for this role</li>
                    {(Array.isArray(tailoredData.warnings) ? tailoredData.warnings : tailoredData.warnings ? [tailoredData.warnings] : []).map((warning, i) => <li key={`warning-${i}`}>{warning}</li>)}
                    {tailoredData.baselineSource && <li>Baseline: {tailoredData.baselineSource === 'profile-fallback' ? 'profile fields (no uploaded resume text available)' : tailoredData.baselineSource === 'profile-uploaded-resume-text' ? 'uploaded resume text from profile' : tailoredData.baselineSource}</li>}
                  </ul>
                  {tailoredData.ats && (
                    <details style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #ddd6fe', fontSize: '11px', color: '#475569' }}>
                      <summary style={{ cursor: 'pointer', fontWeight: '700' }}>View full keyword audit</summary>
                      <div style={{ marginTop: '7px' }}>
                        {keywordRows.map(({ keyword, status }) => <div key={keyword}><b>{keyword}:</b> {status}</div>)}
                        {ats.details && <div><b>Details:</b> {ats.details}</div>}
                        {ats.methodology && <div><b>Methodology:</b> {ats.methodology}{ats.version ? ` (${ats.version})` : ''}</div>}
                      </div>
                    </details>
                  )}
                </div>

                {/* Error message if any */}
                {errorMsg && (
                  <p style={{ margin: '10px 0 0', fontSize: '12px', color: '#b91c1c', fontWeight: '600' }}>{errorMsg}</p>
                )}

                {/* Action Buttons */}
                <div className="job-analyzer-actions" style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button
                    onClick={handleAcceptResume}
                    disabled={isSaving || !chosenFormat?.pdfBase64}
                    style={{ ...acceptButtonStyle, opacity: (isSaving || !chosenFormat?.pdfBase64) ? 0.6 : 1 }}
                  >
                    <Check size={16} /> {isSaving ? 'Saving...' : 'Accept & Save Resume'}
                  </button>
                  <button onClick={onClose} style={declineButtonStyle}>
                    <X size={15} /> Decline
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '14px', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: '#64748b' }}>
                <Sparkles size={13} color="#4f46e5" /> Want different results? Regenerate or try a different URL.
              </div>
              <button onClick={() => { setStep('input'); setTailoredData(null); setErrorMsg(''); }} style={regenerateButtonStyle}>
                <RefreshCw size={13} /> Regenerate
              </button>
            </div>
          </div>
         )}

         {editorState && (
           <ResumeRichEditor
             plainText={editorState.format?.plainText || tailoredData?.plainText || ''}
             initialHtml={editorState.format?.editedHtml || editorState.format?.editableHtml || tailoredData?.editableHtml || ''}
             onClose={() => setEditorState(null)}
             onSave={({ html, text }) => {
               setTailoredData(previous => ({
                 ...previous,
                 plainText: text,
                 formats: (previous.formats || []).map(format => format.id === editorState.formatId
                   ? { ...format, editedHtml: html, editedPlainText: text }
                   : format),
               }));
               setEditorState(null);
             }}
           />
         )}

       </div>
    </div>
  );
}

/* ── Inline Styles ─────────────────────────────────────── */

const modalOverlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(15, 23, 42, 0.65)',
  backdropFilter: 'blur(6px)',
  padding: '20px',
};

const editorOverlayStyle = { position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(15,23,42,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px' };
const editorDialogStyle = { width: 'min(1000px, 96vw)', height: 'min(92vh, 900px)', background: '#f1f5f9', borderRadius: '18px', boxShadow: '0 25px 70px rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const editorHeaderStyle = { background: '#fff', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0' };
const editorToolbarStyle = { background: '#fff', padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: '7px', borderBottom: '1px solid #cbd5e1' };
const editorToolButton = { border: '1px solid #cbd5e1', background: '#fff', borderRadius: '7px', padding: '6px 9px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', color: '#334155' };
const editorSelectStyle = { ...editorToolButton };
const editorScrollStyle = { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'auto', padding: '20px 0', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' };
const editorPaperStyle = { width: '595.28px', minWidth: '595.28px', minHeight: '841.89px', margin: '0 auto', padding: '8.6px 28.8px 8px', boxSizing: 'border-box', background: '#fff', color: '#111827', fontFamily: 'Times New Roman, Times, serif', fontSize: '10px', lineHeight: '1.18', boxShadow: '0 2px 10px rgba(15,23,42,.12)', outline: 'none' };
const editorFooterStyle = { background: '#fff', padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', borderTop: '1px solid #cbd5e1', fontSize: '11px', color: '#64748b' };

const modalDialogStyle = {
  background: '#ffffff',
  borderRadius: '24px',
  width: '100%',
  padding: '28px',
  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  border: '1px solid #e2e8f0',
  position: 'relative',
  transition: 'max-width 0.25s ease',
  maxHeight: '90vh',
  overflowY: 'auto',
};

const closeButtonStyle = {
  border: 'none',
  background: '#f1f5f9',
  borderRadius: '50%',
  width: '32px',
  height: '32px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: '#64748b',
};

const spinnerRingStyle = {
  width: '100%',
  height: '100%',
  borderRadius: '50%',
  border: '4px solid #e0e7ff',
  borderTopColor: '#4f46e5',
  animation: 'spin 1s linear infinite',
};

const spinnerCenterStyle = {
  position: 'absolute',
  inset: '10px',
  borderRadius: '50%',
  background: '#eef2ff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const activeDotStyle = {
  width: '20px',
  height: '20px',
  borderRadius: '50%',
  background: '#4f46e5',
  boxShadow: '0 0 0 4px #e0e7ff',
};

const jobOverviewCardStyle = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '16px',
  padding: '20px',
  marginBottom: '20px',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
};

const companyLogoStyle = {
  width: '46px',
  height: '46px',
  borderRadius: '12px',
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const chipStyle = {
  fontSize: '11px',
  fontWeight: '700',
  background: '#ecfdf5',
  color: '#10b981',
  padding: '3px 10px',
  borderRadius: '20px',
};

const columnCardStyle = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '16px',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
};

const fileBoxStyle = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '12px 14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '14px',
};

const previewButtonStyle = {
  border: '1px solid #e2e8f0',
  background: '#ffffff',
  borderRadius: '8px',
  padding: '6px 12px',
  fontSize: '12px',
  fontWeight: '700',
  color: '#334155',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
};

const whatsTailoredBoxStyle = {
  background: '#f5f3ff',
  border: '1px solid #ddd6fe',
  borderRadius: '12px',
  padding: '14px',
  flex: 1,
};

const keywordRowStyle = {
  display: 'flex', alignItems: 'center', gap: '8px', minHeight: '28px',
  padding: '4px 0', borderBottom: '1px solid #f1f5f9', fontSize: '11.5px',
};

const keywordTagStyle = {
  flex: 1, color: '#1e293b', fontWeight: '600', lineHeight: '1.25',
};

const keywordStatusStyle = {
  minWidth: '70px', textAlign: 'center', padding: '3px 7px', borderRadius: '999px',
  fontSize: '10.5px', fontWeight: '800',
};

const keywordStatusColors = {
  Present: { color: '#047857', background: '#d1fae5' },
  Partial: { color: '#a16207', background: '#fef3c7' },
  Targeted: { color: '#4338ca', background: '#e0e7ff' },
  Missing: { color: '#b91c1c', background: '#fee2e2' },
};

const keywordAddedStyle = {
  color: '#4338ca', background: '#e0e7ff', borderRadius: '999px', padding: '3px 6px',
  fontSize: '9.5px', fontWeight: '800',
};

const acceptButtonStyle = {
  flex: 1,
  background: '#10b981',
  color: '#ffffff',
  border: 'none',
  borderRadius: '12px',
  padding: '12px 16px',
  fontSize: '13px',
  fontWeight: '700',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
};

const declineButtonStyle = {
  background: '#ef4444',
  color: '#ffffff',
  border: 'none',
  borderRadius: '12px',
  padding: '12px 16px',
  fontSize: '13px',
  fontWeight: '700',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
};

const regenerateButtonStyle = {
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  borderRadius: '10px',
  padding: '7px 14px',
  fontSize: '12px',
  fontWeight: '700',
  color: '#334155',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
};
