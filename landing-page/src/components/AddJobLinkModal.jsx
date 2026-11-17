import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import {
  Link2,
  Globe,
  Sparkles,
  X,
  FileText,
  CheckCircle2,
  ArrowRight,
  Building2,
  Clipboard,
  ChevronDown,
} from 'lucide-react';
import './AddJobLinkModal.css';

const SKILL_BADGES = ['React', 'Node.js', 'Python'];

function TopCanvas({ onClose }) {
  return (
    <div className="ajm-top-canvas">
      <div className="ajm-scene" aria-hidden="true">
        <div className="ajm-glow ajm-glow-indigo" />
        <div className="ajm-glow ajm-glow-cyan" />

        <div className="ajm-url-card">
          <div className="ajm-url-card-icon"><Globe size={16} /></div>
          <div className="ajm-url-pill">
            <Link2 size={10} />
            <span>https://boards.greenhouse.io/acme/roles/…</span>
          </div>
          <div className="ajm-url-card-lines"><i /><i /><i /></div>
        </div>

        <div className="ajm-beam-track">
          <div className="ajm-beam-line" />
          <div className="ajm-beam-lane ajm-lane-scan"><span className="ajm-beam-scan" /></div>
          <div className="ajm-beam-lane ajm-lane-p1"><span className="ajm-beam-particle" /></div>
          <div className="ajm-beam-lane ajm-lane-p2"><span className="ajm-beam-particle" /></div>
          <div className="ajm-beam-lane ajm-lane-p3"><span className="ajm-beam-particle" /></div>
          <div className="ajm-beam-lane ajm-lane-p4"><span className="ajm-beam-particle" /></div>
          <ArrowRight size={12} className="ajm-beam-arrow" />
        </div>

        <div className="ajm-resume-card">
          <div className="ajm-resume-head">
            <FileText size={12} />
            <span>Tailored resume</span>
            <span className="ajm-resume-check"><CheckCircle2 size={12} /></span>
          </div>
          <div className="ajm-resume-lines"><i /><i /><i /></div>
          <div className="ajm-resume-badges">
            {SKILL_BADGES.map((skill, index) => (
              <span key={skill} className={`ajm-skill ajm-skill-${index + 1}`}>{skill}</span>
            ))}
          </div>
        </div>
      </div>

      <button type="button" className="ajm-close" onClick={onClose} aria-label="Close dialog">
        <X size={16} />
      </button>
    </div>
  );
}

TopCanvas.propTypes = {
  onClose: PropTypes.func.isRequired,
};

export default function AddJobLinkModal({ isOpen, onClose, onSubmit, initialUrl = '' }) {
  const [url, setUrl] = useState(initialUrl);
  const [jobDescription, setJobDescription] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [clipboardNote, setClipboardNote] = useState('');
  const inputRef = useRef(null);

  const clipboardAvailable = typeof navigator !== 'undefined'
    && Boolean(navigator.clipboard?.readText);

  useEffect(() => {
    if (!isOpen) return;
    setUrl(initialUrl || '');
    setJobDescription('');
    setTitle('');
    setCompany('');
    setManualOpen(false);
    setClipboardNote('');
  }, [isOpen, initialUrl]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);

    const focusTimer = setTimeout(() => inputRef.current?.focus(), 60);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(focusTimer);
    };
  }, [isOpen, onClose]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
        setClipboardNote('');
      }
    } catch {
      setClipboardNote('Clipboard access is blocked — paste with Ctrl + V.');
      inputRef.current?.focus();
    }
  }, []);

  const handleSubmit = useCallback((event) => {
    event.preventDefault();
    onSubmit({
      url: url.trim(),
      jobDescription: jobDescription.trim(),
      title: title.trim(),
      company: company.trim(),
    });
  }, [onSubmit, url, jobDescription, title, company]);

  if (!isOpen) return null;

  const canSubmit = Boolean(url.trim() || jobDescription.trim());

  return createPortal(
    <div className="ajm-overlay" onClick={onClose}>
      <div
        className="ajm-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ajm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <TopCanvas onClose={onClose} />

        <div className="ajm-content">
          <header className="ajm-header">
            <h2 id="ajm-title" className="ajm-title">Add Job Link</h2>
            <p className="ajm-subtitle">
              Paste any job posting URL to analyze requirements &amp; auto-tailor your resume.
            </p>
          </header>

          <form className="ajm-form" onSubmit={handleSubmit}>
            <label className="ajm-label" htmlFor="ajm-url">Job Page URL</label>
            <div className={`ajm-input-wrap ${clipboardAvailable ? 'has-paste' : ''}`}>
              <Link2 size={15} className="ajm-input-icon" />
              <input
                id="ajm-url"
                ref={inputRef}
                type="url"
                className="ajm-input-field"
                placeholder="https://jobs.lever.co/... or https://boards.greenhouse.io/..."
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                autoFocus
                spellCheck={false}
                autoComplete="off"
              />
              {clipboardAvailable && (
                <button type="button" className="ajm-paste-btn" onClick={handlePaste}>
                  <Clipboard size={12} /> Paste
                </button>
              )}
            </div>
            {clipboardNote && <p className="ajm-inline-note">{clipboardNote}</p>}

            <button
              type="button"
              className={`ajm-accordion-toggle ${manualOpen ? 'is-open' : ''}`}
              onClick={() => setManualOpen((open) => !open)}
              aria-expanded={manualOpen}
              aria-controls="ajm-manual-panel"
            >
              <ChevronDown size={14} className="ajm-accordion-chevron" />
              <span>+ Paste manual job description if URL is private or blocked</span>
            </button>

            <div
              id="ajm-manual-panel"
              className={`ajm-accordion-panel ${manualOpen ? 'is-open' : ''}`}
            >
              <div className="ajm-accordion-inner">
                <label className="ajm-label" htmlFor="ajm-jd">Full job description</label>
                <textarea
                  id="ajm-jd"
                  className="ajm-textarea"
                  rows={4}
                  placeholder="Paste the complete job description here…"
                  value={jobDescription}
                  onChange={(event) => setJobDescription(event.target.value)}
                />
                <div className="ajm-field-row">
                  <div className="ajm-input-wrap">
                    <FileText size={14} className="ajm-input-icon" />
                    <input
                      type="text"
                      className="ajm-input-field"
                      placeholder="Job Title (optional)"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      aria-label="Job Title (optional)"
                    />
                  </div>
                  <div className="ajm-input-wrap">
                    <Building2 size={14} className="ajm-input-icon" />
                    <input
                      type="text"
                      className="ajm-input-field"
                      placeholder="Company Name (optional)"
                      value={company}
                      onChange={(event) => setCompany(event.target.value)}
                      aria-label="Company Name (optional)"
                    />
                  </div>
                </div>
              </div>
            </div>

            <footer className="ajm-actions">
              <button type="button" className="ajm-btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="ajm-btn-primary" disabled={!canSubmit}>
                Analyze &amp; Tailor Resume <Sparkles size={15} />
              </button>
            </footer>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}

AddJobLinkModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  initialUrl: PropTypes.string,
};
