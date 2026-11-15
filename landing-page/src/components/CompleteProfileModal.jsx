import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X, ArrowRight, Sparkles, CheckCircle2, Zap, FileText } from 'lucide-react';
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
      <div className="cpm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Close Button */}
        <button className="cpm-close-btn" onClick={handleLater} title="Close">
          <X size={17} />
        </button>

        {/* ─── Motion Graphic (CSS + SVG Animated Illustration) ─── */}
        <div className="cpm-graphic-wrap">
          <div className="cpm-graphic-glow" />

          <div className="cpm-card-float">
            <svg
              className="cpm-svg-card"
              width="180"
              height="116"
              viewBox="0 0 180 116"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Background Profile Card */}
              <rect
                x="10"
                y="8"
                width="160"
                height="100"
                rx="14"
                fill="#FFFFFF"
                stroke="#E2E8F0"
                strokeWidth="1.5"
              />

              {/* Header colored banner */}
              <rect x="11" y="9" width="158" height="30" rx="13" fill="url(#cpmGradHeader)" />

              {/* Avatar circle */}
              <circle cx="40" cy="38" r="16" fill="#FFFFFF" stroke="#EA580C" strokeWidth="2.5" />
              <path
                d="M40 33C37.79 33 36 34.79 36 37C36 39.21 37.79 41 40 41C42.21 41 44 39.21 44 37C44 34.79 42.21 33 40 33ZM40 43C36.67 43 30 44.67 30 48V50H50V48C50 44.67 43.33 43 40 43Z"
                fill="#EA580C"
              />

              {/* Animated Progress Ring around Avatar */}
              <circle
                cx="40"
                cy="38"
                r="19"
                fill="none"
                stroke="#FDBA74"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />

              {/* Name & Title skeleton lines */}
              <rect x="66" y="24" width="70" height="7" rx="3.5" fill="#FFFFFF" opacity="0.9" />
              <rect x="66" y="35" width="46" height="5" rx="2.5" fill="#FFFFFF" opacity="0.6" />

              {/* Skills skeleton chips */}
              <rect x="22" y="64" width="34" height="12" rx="4" fill="#FFF7ED" stroke="#FFEDD5" />
              <rect x="60" y="64" width="44" height="12" rx="4" fill="#FFF7ED" stroke="#FFEDD5" />
              <rect x="108" y="64" width="38" height="12" rx="4" fill="#FFF7ED" stroke="#FFEDD5" />

              {/* Completion Progress Bar */}
              <rect x="22" y="86" width="136" height="8" rx="4" fill="#F1F5F9" />
              <rect
                x="22"
                y="86"
                width="95"
                height="8"
                rx="4"
                fill="url(#cpmGradBar)"
                className="cpm-ring-progress"
              />

              {/* Scanning light bar */}
              <rect
                x="18"
                y="18"
                width="144"
                height="3"
                rx="1.5"
                fill="url(#cpmScanGlow)"
                className="cpm-scan-line"
              />

              {/* Verified Check Badge (popping in) */}
              <g className="cpm-check-badge">
                <circle cx="145" cy="20" r="11" fill="#16A34A" />
                <path
                  d="M141 20L144 23L149 17"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>

              {/* Floating Sparkle Stars */}
              <g className="cpm-sparkle-1">
                <path
                  d="M17 14L19 19L24 21L19 23L17 28L15 23L10 21L15 19L17 14Z"
                  fill="#F59E0B"
                  transform="scale(0.6) translate(-5, -5)"
                />
              </g>

              <g className="cpm-sparkle-2">
                <path
                  d="M165 80L166.5 83.5L170 85L166.5 86.5L165 90L163.5 86.5L160 85L163.5 83.5L165 80Z"
                  fill="#EA580C"
                  transform="scale(0.8) translate(35, 10)"
                />
              </g>

              <g className="cpm-sparkle-3">
                <circle cx="14" cy="95" r="2.5" fill="#3B82F6" opacity="0.8" />
              </g>

              {/* SVG Gradients */}
              <defs>
                <linearGradient id="cpmGradHeader" x1="11" y1="9" x2="169" y2="39" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#EA580C" />
                  <stop offset="1" stopColor="#F97316" />
                </linearGradient>

                <linearGradient id="cpmGradBar" x1="22" y1="86" x2="158" y2="94" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#EA580C" />
                  <stop offset="1" stopColor="#16A34A" />
                </linearGradient>

                <linearGradient id="cpmScanGlow" x1="18" y1="18" x2="162" y2="18" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#EA580C" stopOpacity="0" />
                  <stop offset="0.5" stopColor="#EA580C" stopOpacity="0.8" />
                  <stop offset="1" stopColor="#F97316" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>

        {/* ─── Badge & Titles ─── */}
        <div className="cpm-badge">
          <Sparkles size={13} />
          <span>Profile Setup • 2 Minutes</span>
        </div>

        <h3 className="cpm-title">Complete Your Profile to Unlock Matches</h3>

        <p className="cpm-desc">
          Add your skills and resume so HAMZO can calculate 90%+ match scores, tailor your ATS resume, and auto-apply on autopilot.
        </p>

        {/* ─── Value Props ─── */}
        <div className="cpm-features">
          <div className="cpm-feature-item">
            <div className="cpm-feature-icon orange">
              <Zap size={13} />
            </div>
            <span>Accurate Job Compatibility Scores</span>
          </div>

          <div className="cpm-feature-item">
            <div className="cpm-feature-icon">
              <FileText size={13} />
            </div>
            <span>Instant AI-Tailored ATS Resume per Role</span>
          </div>

          <div className="cpm-feature-item">
            <div className="cpm-feature-icon green">
              <CheckCircle2 size={13} />
            </div>
            <span>1-Click Auto-Fill & Extension Copilot</span>
          </div>
        </div>

        {/* ─── Action Buttons ─── */}
        <div className="cpm-actions">
          <button className="cpm-primary-btn" onClick={handleGoToProfile}>
            <span>Complete Profile Now</span>
            <ArrowRight size={16} />
          </button>

          <button className="cpm-later-btn" onClick={handleLater}>
            I'll do this later
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
