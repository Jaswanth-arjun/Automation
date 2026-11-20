import React, { useState, useEffect } from 'react';
import { X, Download, Copy, Check, Pencil, Eye, RefreshCw, FileText, Sparkles } from 'lucide-react';

export default function CoverLetterModal({
  isOpen,
  mode = 'view', // 'view' | 'edit'
  coverLetter,
  jobTitle = '',
  company = '',
  onClose,
  onSave,
  onRegenerate,
  isRegenerating = false,
}) {
  const [currentMode, setCurrentMode] = useState(mode);
  const [copied, setCopied] = useState(false);
  const [editedLetter, setEditedLetter] = useState(coverLetter || {});
  const [editedText, setEditedText] = useState('');

  useEffect(() => {
    setCurrentMode(mode);
  }, [mode]);

  useEffect(() => {
    if (coverLetter) {
      setEditedLetter(coverLetter);
      setEditedText(coverLetter.fullText || [
        `Cover Letter\n`,
        coverLetter.applicantName || 'Your Name',
        coverLetter.applicantAddress || 'Your Address',
        `${coverLetter.applicantEmail || 'your.email@example.com'} | ${coverLetter.applicantPhone || '+91 9876543210'}`,
        coverLetter.date || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        `\n${coverLetter.hiringManager || "Hiring Manager's Name"}`,
        coverLetter.companyName || company || 'Company Name',
        coverLetter.companyAddress || 'Company Address',
        `\n${coverLetter.salutation || "Dear Hiring Manager,"}\n`,
        ...(coverLetter.paragraphs || []).map((p) => `${p}\n`),
        coverLetter.signOff || 'Best Regards,',
        coverLetter.applicantName || 'Your Name',
      ].join('\n'));
    }
  }, [coverLetter, company]);

  if (!isOpen || !coverLetter) return null;

  const handleCopy = () => {
    const textToCopy = editedText || coverLetter.fullText || '';
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const handlePrintPdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const name = editedLetter.applicantName || 'Applicant';
    const comp = editedLetter.companyName || company || 'Company';
    const paras = editedLetter.paragraphs || [];

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Cover Letter - ${name} - ${comp}</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 15mm;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              color: #111827;
              line-height: 1.55;
              font-size: 13.5px;
              margin: 0;
              padding: 20px;
              background: #ffffff;
            }
            .cover-card {
              max-width: 680px;
              margin: 0 auto;
              border: 10px solid #facc15;
              padding: 40px 48px;
              box-sizing: border-box;
              min-height: 940px;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
            }
            .title {
              text-align: center;
              font-size: 24px;
              font-weight: 800;
              margin-bottom: 28px;
              color: #000000;
              letter-spacing: -0.02em;
            }
            .meta-block {
              margin-bottom: 18px;
              font-size: 13.5px;
              line-height: 1.45;
              color: #1f2937;
            }
            .salutation {
              margin-bottom: 16px;
              font-weight: 600;
            }
            .paragraph {
              margin-bottom: 14px;
              text-align: justify;
              color: #374151;
            }
            .sign-off {
              margin-top: 24px;
              font-weight: 500;
            }
            .signature-name {
              font-weight: 700;
              margin-top: 6px;
            }
            @media print {
              body { padding: 0; }
              .cover-card { border: 10px solid #facc15 !important; }
            }
          </style>
        </head>
        <body>
          <div class="cover-card">
            <div>
              <div class="title">Cover Letter</div>
              
              <div class="meta-block">
                <div><strong>${name}</strong></div>
                <div>${editedLetter.applicantAddress || ''}</div>
                <div>${editedLetter.applicantEmail || ''} ${editedLetter.applicantPhone ? ` | ${editedLetter.applicantPhone}` : ''}</div>
                <div style="margin-top: 8px; color: #4b5563;">${editedLetter.date || ''}</div>
              </div>

              <div class="meta-block">
                <div>${editedLetter.hiringManager || "Hiring Manager's Name"}</div>
                <div><strong>${comp}</strong></div>
                <div>${editedLetter.companyAddress || ''}</div>
              </div>

              <div class="salutation">
                ${editedLetter.salutation || 'Dear Hiring Manager,'}
              </div>

              ${paras.map((p) => `<div class="paragraph">${p}</div>`).join('')}

              <div class="sign-off">
                <div>${editedLetter.signOff || 'Best Regards,'}</div>
                <div class="signature-name">${name}</div>
              </div>
            </div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleSaveEdit = () => {
    // Parse paragraphs from editedText if in raw text edit mode
    const lines = editedText.split('\n').map((l) => l.trim()).filter(Boolean);
    const updated = {
      ...editedLetter,
      fullText: editedText,
    };
    onSave?.(updated);
    setCurrentMode('view');
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 10000,
      background: 'rgba(15, 23, 42, 0.75)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: '20px',
        width: '100%',
        maxWidth: '850px',
        maxHeight: '92vh',
        boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'fadeIn 0.2s ease-out',
      }}>
        {/* Modal Top Header Bar */}
        <div style={{
          padding: '16px 24px',
          background: 'linear-gradient(135deg, #1e293b, #0f172a)',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '10px',
              background: '#facc15', color: '#854d0e',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold'
            }}>
              <FileText size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                1-Page Tailored Cover Letter
                <span style={{ fontSize: '11px', background: 'rgba(250, 204, 21, 0.25)', color: '#fef08a', padding: '2px 8px', borderRadius: '12px', fontWeight: '700' }}>
                  ATS-Optimized
                </span>
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                {jobTitle || 'Role'} at {company || 'Company'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {currentMode === 'view' ? (
              <>
                <button
                  type="button"
                  onClick={() => setCurrentMode('edit')}
                  style={{
                    background: '#334155', color: '#f8fafc', border: '1px solid #475569',
                    borderRadius: '8px', padding: '7px 14px', fontSize: '12.5px', fontWeight: '600',
                    display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer'
                  }}
                >
                  <Pencil size={14} /> Edit
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  style={{
                    background: copied ? '#059669' : '#334155', color: '#f8fafc', border: '1px solid #475569',
                    borderRadius: '8px', padding: '7px 14px', fontSize: '12.5px', fontWeight: '600',
                    display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer'
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied!' : 'Copy Text'}
                </button>
                <button
                  type="button"
                  onClick={handlePrintPdf}
                  style={{
                    background: '#2563eb', color: '#ffffff', border: 'none',
                    borderRadius: '8px', padding: '7px 16px', fontSize: '12.5px', fontWeight: '700',
                    display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(37,99,235,0.3)'
                  }}
                >
                  <Download size={14} /> Download / Print PDF
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setCurrentMode('view')}
                  style={{
                    background: '#334155', color: '#f8fafc', border: '1px solid #475569',
                    borderRadius: '8px', padding: '7px 14px', fontSize: '12.5px', fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  style={{
                    background: '#059669', color: '#ffffff', border: 'none',
                    borderRadius: '8px', padding: '7px 16px', fontSize: '12.5px', fontWeight: '700',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px'
                  }}
                >
                  <Check size={14} /> Save Changes
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent', border: 'none', color: '#94a3b8',
                cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div style={{
          padding: '28px',
          overflowY: 'auto',
          flex: 1,
          background: '#f8fafc',
          display: 'flex',
          justifyContent: 'center',
        }}>
          {currentMode === 'view' ? (
            /* EXACT TEMPLATE LAYOUT MATCHING IMAGE 2 (Yellow border accent card) */
            <div style={{
              background: '#ffffff',
              border: '10px solid #facc15',
              borderRadius: '6px',
              padding: '40px 48px',
              maxWidth: '680px',
              width: '100%',
              boxShadow: '0 10px 25px rgba(0,0,0,0.06)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              color: '#1f2937',
              fontSize: '13.5px',
              lineHeight: '1.6',
            }}>
              <h2 style={{
                textAlign: 'center',
                fontSize: '24px',
                fontWeight: '800',
                margin: '0 0 28px',
                color: '#000000',
                letterSpacing: '-0.02em',
              }}>
                Cover Letter
              </h2>

              {/* Applicant Header */}
              <div style={{ marginBottom: '18px', lineHeight: '1.45' }}>
                <div style={{ fontWeight: '700', fontSize: '14px', color: '#111827' }}>{editedLetter.applicantName}</div>
                <div>{editedLetter.applicantAddress}</div>
                <div>{editedLetter.applicantEmail} {editedLetter.applicantPhone ? ` | ${editedLetter.applicantPhone}` : ''}</div>
                <div style={{ marginTop: '8px', color: '#6b7280' }}>{editedLetter.date}</div>
              </div>

              {/* Recipient */}
              <div style={{ marginBottom: '20px', lineHeight: '1.45' }}>
                <div>{editedLetter.hiringManager || "Hiring Manager's Name"}</div>
                <div style={{ fontWeight: '700' }}>{editedLetter.companyName || company}</div>
                <div>{editedLetter.companyAddress}</div>
              </div>

              {/* Salutation */}
              <div style={{ marginBottom: '16px', fontWeight: '600', color: '#111827' }}>
                {editedLetter.salutation || 'Dear Hiring Manager,'}
              </div>

              {/* 4 Body Paragraphs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', color: '#374151' }}>
                {(editedLetter.paragraphs || []).map((para, idx) => (
                  <p key={idx} style={{ margin: 0, textAlign: 'justify', lineHeight: '1.6' }}>
                    {para}
                  </p>
                ))}
              </div>

              {/* Sign-off */}
              <div style={{ marginTop: '28px', lineHeight: '1.5' }}>
                <div>{editedLetter.signOff || 'Best Regards,'}</div>
                <div style={{ fontWeight: '700', fontSize: '14px', marginTop: '6px', color: '#111827' }}>
                  {editedLetter.applicantName}
                </div>
              </div>
            </div>
          ) : (
            /* EDIT MODE */
            <div style={{ width: '100%', maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{
                background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px',
                padding: '12px 16px', fontSize: '13px', color: '#1e40af', display: 'flex', alignItems: 'center', gap: '8px'
              }}>
                <Sparkles size={16} />
                <span>You can edit the full text of your cover letter below. Formatting will automatically be preserved when viewing or downloading.</span>
              </div>
              <textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                rows={22}
                style={{
                  width: '100%',
                  padding: '16px 20px',
                  borderRadius: '12px',
                  border: '1.5px solid #cbd5e1',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  lineHeight: '1.6',
                  color: '#0f172a',
                  background: '#ffffff',
                  outline: 'none',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                }}
              />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '14px 24px',
          background: '#ffffff',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            Template: <strong>Standard 1-Page Career Template</strong> (with gold border accent)
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                disabled={isRegenerating}
                style={{
                  background: '#f8fafc', color: '#475569', border: '1px solid #cbd5e1',
                  borderRadius: '8px', padding: '8px 16px', fontSize: '12.5px', fontWeight: '600',
                  display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer'
                }}
              >
                <RefreshCw size={14} className={isRegenerating ? 'spin' : ''} />
                {isRegenerating ? 'Re-Generating...' : 'Re-Generate with AI'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                background: '#e2e8f0', color: '#334155', border: 'none',
                borderRadius: '8px', padding: '8px 18px', fontSize: '12.5px', fontWeight: '700',
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
