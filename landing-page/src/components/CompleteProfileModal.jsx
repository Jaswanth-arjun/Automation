import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X, ArrowRight, ShieldCheck } from 'lucide-react';
import './CompleteProfileModal.css';

export default function CompleteProfileModal({ isOpen, onClose }) {
  const navigate = useNavigate();

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const handleGoToProfile = () => {
    onClose?.();
    navigate('/dashboard/profile');
  };

  const handleLater = () => {
    onClose?.();
  };

  const modalContent = (
    <div className="cpm-overlay" onClick={handleLater} role="dialog" aria-modal="true">
      <div className="cpm-card-modal" onClick={(e) => e.stopPropagation()}>
        {/* ─── Top Canvas with Graphic & Close Button ─── */}
        <div className="cpm-top-canvas">
          {/* Close X Button */}
          <button className="cpm-close-btn" onClick={handleLater} title="Close">
            <X size={15} />
          </button>

          {/* Decorative Sparkle Stars */}
          <svg
            className="cpm-sparkle-star cpm-star-left"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
          </svg>

          <svg
            className="cpm-sparkle-star cpm-star-right"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
          </svg>

          {/* Left: Floating Resume / Profile Card */}
          <div className="cpm-paper-card">
            <div className="cpm-paper-top">
              <div className="cpm-paper-avatar" />
              <div className="cpm-paper-header-lines">
                <div className="cpm-paper-h-line-1" />
                <div className="cpm-paper-h-line-2" />
              </div>
            </div>
            <div className="cpm-paper-body-lines">
              <div className="cpm-orange-bar w-100" />
              <div className="cpm-orange-bar w-85" />
              <div className="cpm-orange-bar w-100" />
              <div className="cpm-orange-bar w-70" />
              <div className="cpm-orange-bar w-55" />
            </div>
          </div>

          {/* Right: Circular 0% Job Match Indicator */}
          <div className="cpm-score-column">
            <div className="cpm-score-ring-outer">
              <div className="cpm-score-ring-inner">
                <span className="cpm-score-number">0%</span>
              </div>
            </div>
            <span className="cpm-score-label">Job match</span>
          </div>
        </div>

        {/* ─── Bottom Actions & Content ─── */}
        <div className="cpm-bottom-content">
          <div className="cpm-pill-badge">
            PROFILE SETUP • 2 MINUTES
          </div>

          <div className="cpm-big-button-wrap">
            <button className="cpm-big-orange-btn" onClick={handleGoToProfile}>
              <span>Complete Profile Now</span>
              <ArrowRight size={17} />
            </button>
          </div>

          <div>
            <button className="cpm-dismiss-link" onClick={handleLater}>
              I’ll do this later
            </button>
          </div>

          <div className="cpm-trust-banner">
            <ShieldCheck size={14} />
            <span>You stay in control and review every application before it is sent.</span>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
