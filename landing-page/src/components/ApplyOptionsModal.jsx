import React from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Sparkles, ExternalLink, Briefcase, Building, CheckCircle2, ArrowRight } from 'lucide-react';

export default function ApplyOptionsModal({ job, isOpen, onClose }) {
  const navigate = useNavigate();

  if (!isOpen || !job) return null;

  const handleApplyWithHamzo = () => {
    onClose();
    navigate(`/dashboard/apply/${job.id}`);
  };

  const handleDirectApply = () => {
    onClose();
    const link = job.applyLink && job.applyLink.trim() !== '' 
      ? job.applyLink 
      : `https://www.google.com/search?q=${encodeURIComponent(job.company + ' ' + job.title + ' apply careers')}`;
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 17, 23, 0.65)',
        backdropFilter: 'blur(6px)',
        padding: '20px',
        animation: 'fadeIn 0.2s ease-out',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '20px',
          width: '100%',
          maxWidth: '520px',
          padding: '28px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.2)',
          border: '1px solid #e5e5e0',
          position: 'relative',
          animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header & Close */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {job.companyLogoUrl ? (
              <img
                src={job.companyLogoUrl}
                alt={job.company}
                style={{ width: '46px', height: '46px', borderRadius: '12px', objectFit: 'cover', border: '1px solid #e5e5e0' }}
              />
            ) : (
              <div
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: '12px',
                  background: '#171817',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: '800',
                  fontSize: '18px',
                }}
              >
                {job.company?.[0] || '?'}
              </div>
            )}
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#171817', margin: 0, letterSpacing: '-0.02em' }}>
                Select Application Method
              </h3>
              <p style={{ fontSize: '13px', color: '#666', margin: '2px 0 0' }}>
                {job.title} · <span style={{ fontWeight: '600', color: '#171817' }}>{job.company}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: '#f4f4f0',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#666',
              transition: 'all 0.15s',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Options List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', margin: '20px 0 10px' }}>
          
          {/* OPTION 1: Apply with HAMZO (Highlighted Primary Option) */}
          <div
            onClick={handleApplyWithHamzo}
            style={{
              border: '2px solid #445cf5',
              borderRadius: '14px',
              padding: '20px',
              background: 'linear-gradient(135deg, #ffffff 0%, #f4f6ff 100%)',
              cursor: 'pointer',
              transition: 'transform 0.18s, box-shadow 0.18s',
              position: 'relative',
              boxShadow: '0 8px 24px rgba(68, 92, 245, 0.12)',
            }}
            className="apply-option-card-primary"
          >
            <div style={{ position: 'absolute', top: '14px', right: '14px' }}>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: '800',
                  letterSpacing: '0.05em',
                  background: '#445cf5',
                  color: '#ffffff',
                  padding: '4px 10px',
                  borderRadius: '20px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  textTransform: 'uppercase',
                }}
              >
                <Sparkles size={11} /> Recommended
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: '#445cf5',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Sparkles size={20} />
              </div>
              <strong style={{ fontSize: '16px', fontWeight: '800', color: '#171817' }}>
                Apply with HAMZO
              </strong>
            </div>

            <p style={{ fontSize: '12.5px', color: '#555852', margin: '0 0 14px', lineHeight: '1.5', paddingLeft: '46px' }}>
              Instant AI auto-fill application using your saved HAMZO profile, resume & skills match analysis.
            </p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                background: '#445cf5',
                color: '#ffffff',
                fontWeight: '700',
                fontSize: '13px',
                padding: '11px 16px',
                borderRadius: '10px',
                width: '100%',
                transition: 'background 0.2s',
              }}
            >
              <span>Apply with HAMZO Profile</span>
              <ArrowRight size={15} />
            </div>
          </div>

          {/* OPTION 2: Direct Apply (External Redirect) */}
          <div
            onClick={handleDirectApply}
            style={{
              border: '1px solid #d9d9d2',
              borderRadius: '14px',
              padding: '18px 20px',
              background: '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.18s',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
            }}
            className="apply-option-card-secondary"
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: '#f4f4f0',
                    color: '#171817',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ExternalLink size={16} />
                </div>
                <strong style={{ fontSize: '15px', fontWeight: '700', color: '#171817' }}>
                  Direct Apply
                </strong>
              </div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  color: '#666',
                  background: '#f4f4f0',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                External Link <ExternalLink size={11} />
              </span>
            </div>

            <p style={{ fontSize: '12px', color: '#666', margin: 0, paddingLeft: '42px', lineHeight: '1.4' }}>
              Redirect directly to {job.company}&apos;s official application portal/careers site in a new tab.
            </p>
          </div>

        </div>

        {/* Footer info note */}
        <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '11px', color: '#888' }}>
          🔒 Your information is transmitted securely according to your HAMZO preferences.
        </div>
      </div>
    </div>
  );
}
