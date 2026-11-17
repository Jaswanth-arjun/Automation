import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Link2, Crown, X, Check, ExternalLink, Bookmark } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { adminJobStore } from '../lib/adminJobStore';
import { profileStore, getUserName, getEmailUsername } from '../lib/api';
import { DEMO_JOBS } from '../lib/mockData';
import { computeJobScores } from '../lib/matchScore';
import { savedJobsStore } from '../lib/savedJobsStore';
import JobAnalyzerModal from '../components/JobAnalyzerModal';
import CompleteProfileModal from '../components/CompleteProfileModal';
import ActivityTable from '../components/ActivityTable';
import ConnectAccounts from '../components/ConnectAccounts';
import CompanyLogo from '../components/CompanyLogo';

function isProfileIncomplete(p) {
  if (!p) return true;
  const hasName = Boolean(p.fullName && p.fullName.trim() && p.fullName.trim() !== 'Your Name');
  const hasResume = Boolean(p.resume?.dataUrl || p.resume?.fileName);
  const hasSkills = Boolean(p.skills && p.skills.length > 0);
  return !hasName || !hasResume || !hasSkills;
}

function ScoreCircle({ score = null }) {
  const hasScore = typeof score === 'number' && Number.isFinite(score);
  const safeScore = hasScore ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  // Ring grows into place; the number always shows the real score immediately
  // so a paused tab can never display 0%.
  const [arc, setArc] = useState(0);
  useEffect(() => {
    if (!hasScore) {
      setArc(0);
      return undefined;
    }
    const timer = setTimeout(() => setArc(safeScore), 60);
    return () => clearTimeout(timer);
  }, [hasScore, safeScore]);

  if (!hasScore) {
    return (
      <div
        className="score-circle-badge is-empty"
        title="Complete Your Profile to Calculate Match Score"
        style={{
          width: 42,
          height: 42,
          borderRadius: '50%',
          border: '2px dashed #d8d5cc',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#a8a29a',
          fontSize: 11,
          fontWeight: 800,
          flexShrink: 0,
          background: '#faf9f6',
        }}
      >
        —
      </div>
    );
  }
  const radius = 15;
  const stroke = 3.5;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (arc / 100) * circumference;
  const size = 42;
  const center = size / 2;

  const isHigh = safeScore >= 70;
  const color = isHigh ? '#16a34a' : safeScore >= 40 ? '#ea580c' : '#f97316';
  const track = isHigh ? '#dcfce7' : '#ffedd5';

  return (
    <div
      className="score-circle-badge"
      title={`${safeScore}% match score`}
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={track}
          strokeWidth={stroke}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <span
        style={{
          position: 'absolute',
          fontSize: '11px',
          fontWeight: '800',
          letterSpacing: '-0.02em',
          color: color,
        }}
      >
        {safeScore}%
      </span>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(() => profileStore.get());
  const [adminJobs, setAdminJobs] = useState(() => adminJobStore.getWithFreshDates());

  // Modal states
  const [showJobUrlModal, setShowJobUrlModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showProfilePromptModal, setShowProfilePromptModal] = useState(() => {
    return isProfileIncomplete(profileStore.get());
  });

  const handleDismissProfileModal = () => {
    setShowProfilePromptModal(false);
  };

  useEffect(() => {
    const handleProfileUpdate = () => {
      const currentProfile = profileStore.get();
      setProfile(currentProfile);
      if (!isProfileIncomplete(currentProfile)) {
        setShowProfilePromptModal(false);
      }
    };
    window.addEventListener('profile_updated', handleProfileUpdate);
    window.addEventListener('storage', handleProfileUpdate);
    return () => {
      window.removeEventListener('profile_updated', handleProfileUpdate);
      window.removeEventListener('storage', handleProfileUpdate);
    };
  }, []);

  useEffect(() => {
    adminJobStore.syncWithBackend();
    const refreshJobs = () => setAdminJobs(adminJobStore.getWithFreshDates());
    const refreshProfile = () => setProfile(profileStore.get());
    window.addEventListener('admin_jobs_updated', refreshJobs);
    window.addEventListener('profile_updated', refreshProfile);
    window.addEventListener('storage', refreshProfile);
    return () => {
      window.removeEventListener('admin_jobs_updated', refreshJobs);
      window.removeEventListener('profile_updated', refreshProfile);
      window.removeEventListener('storage', refreshProfile);
    };
  }, []);

  const displayName = getUserName(user, profile);

  const [resumeTick, setResumeTick] = useState(0);
  const [savedJobIds, setSavedJobIds] = useState(() => savedJobsStore.get());

  useEffect(() => {
    const handleSavedUpdated = () => setSavedJobIds(savedJobsStore.get());
    window.addEventListener('saved_jobs_updated', handleSavedUpdated);
    window.addEventListener('storage', handleSavedUpdated);
    return () => {
      window.removeEventListener('saved_jobs_updated', handleSavedUpdated);
      window.removeEventListener('storage', handleSavedUpdated);
    };
  }, []);

  useEffect(() => {
    const bump = () => setResumeTick((value) => value + 1);
    window.addEventListener('resumes_updated', bump);
    return () => window.removeEventListener('resumes_updated', bump);
  }, []);

  // Same feed as the Jobs page (admin postings + demo roles) so Top Matches
  // can never miss the highest scoring job.
  const allJobs = useMemo(() => [...adminJobs, ...DEMO_JOBS], [adminJobs]);

  const scored = useMemo(
    () => computeJobScores(profile || {}, allJobs, { userId: user?.id || user?.email || 'anon' }),
    [profile, allJobs, user, resumeTick],
  );
  const scoredOnly = scored.filter(
    (job) => job.matchResult?.status === 'scored' || job.matchResult?.status === 'ineligible',
  );
  const matchesLocked = scored.length > 0 && scoredOnly.length === 0;
  // Best real score this user has right now, used by the profile modal ring.
  const bestMatchScore = useMemo(() => {
    const values = scoredOnly
      .map((job) => job.matchResult?.score)
      .filter((value) => typeof value === 'number' && Number.isFinite(value));
    return values.length ? Math.max(...values) : null;
  }, [scoredOnly]);
  const topMatches = [...scored]
    .sort((a, b) => {
      const aScored = a.matchResult?.status === 'scored' || a.matchResult?.status === 'ineligible';
      const bScored = b.matchResult?.status === 'scored' || b.matchResult?.status === 'ineligible';
      if (aScored !== bScored) return aScored ? -1 : 1;
      if (aScored && bScored) return (b.matchResult?.score || 0) - (a.matchResult?.score || 0);
      return (a.postedDaysAgo ?? 99) - (b.postedDaysAgo ?? 99);
    })
    .slice(0, 4);

  return (
    <div className="page-overview">
      <section className="dash-hero">
        <h1>Welcome, {displayName} 👋</h1>
        <button
          className="dash-hero-btn"
          onClick={() => setShowJobUrlModal(true)}
          title="Add Job Link"
        >
          <Link2 size={18} />
          <span>Add Job Link</span>
        </button>
      </section>

      <ConnectAccounts />

      <section className="dash-section">
        <div className="section-header">
          <h2>Top Matches</h2>
          <button className="btn-ghost" onClick={() => navigate('/dashboard/jobs')}>
            View all <ArrowRight size={14} />
          </button>
        </div>
        {matchesLocked && (
          <div className="match-locked-banner">
            <span>
              Complete Your Profile to Calculate Match Score — scores are generated only from your own resume,
              skills, education and eligibility.
            </span>
            <button onClick={() => navigate('/dashboard/profile')}>Complete profile</button>
          </div>
        )}
        <div className="top-matches-grid">
          {topMatches.length === 0 && (
            <p style={{ color: '#718096', fontSize: '14px' }}>No jobs posted yet. Jobs an admin posts will show up here.</p>
          )}
          {topMatches.map(job => (
            <article key={job.id} className="match-card" onClick={() => navigate(`/dashboard/jobs/${job.id}`)}>
              <div className="match-card-header-row">
                <CompanyLogo job={job} />
                <ScoreCircle
                  score={
                    job.matchResult?.status === 'scored' || job.matchResult?.status === 'ineligible'
                      ? job.matchResult.score
                      : null
                  }
                />
              </div>
              <div className="match-card-body">
                <h4 title={job.title}>{job.title}</h4>
                <p>{job.company} · {job.location}</p>
              </div>
              <div className="match-card-actions">
                <button
                  className="match-card-apply-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/dashboard/jobs/${job.id}`);
                  }}
                >
                  Apply <ArrowRight size={13} />
                </button>
                <button
                  type="button"
                  className={`match-card-save-btn ${savedJobIds.includes(job.id) ? 'saved' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    savedJobsStore.toggle(job.id);
                  }}
                  title={savedJobIds.includes(job.id) ? 'Remove from saved' : 'Save job'}
                  aria-label="Save job"
                >
                  <Bookmark size={15} fill={savedJobIds.includes(job.id) ? 'currentColor' : 'none'} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <ActivityTable
        jobs={scored}
        matchedCount={scored.length}
        onStartOutreach={() => navigate('/dashboard/jobs')}
      />

      {/* Add Job Link — finds-or-creates the job, then jumps into the apply flow */}
      <JobAnalyzerModal
        isOpen={showJobUrlModal}
        onClose={() => setShowJobUrlModal(false)}
        applyMode
        onAccepted={() => setProfile(profileStore.get())}
      />

      {/* Upgrade Plan Modal */}
      {showUpgradeModal && (
        <div style={modalOverlayStyle} onClick={() => setShowUpgradeModal(false)}>
          <div style={{ ...modalContentStyle, maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#f3e8ff', color: '#9333ea', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Crown size={22} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800' }}>Upgrade to HAMZO Pro</h3>
                  <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Supercharge your job application automation</p>
                </div>
              </div>
              <button onClick={() => setShowUpgradeModal(false)} style={closeBtnStyle}><X size={16} /></button>
            </div>

            <div style={{ background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)', padding: '20px', borderRadius: '14px', color: '#fff', marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.9 }}>PRO PLAN</div>
              <div style={{ fontSize: '28px', fontWeight: '800', margin: '4px 0 2px' }}>$19 <span style={{ fontSize: '14px', fontWeight: '500', opacity: 0.9 }}>/ month</span></div>
              <div style={{ fontSize: '12px', opacity: 0.9 }}>7-day free trial included. Cancel anytime.</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
              {[
                'Unlimited AI Resume Tailoring for any job link',
                'Unlimited 24/7 LinkedIn Automated Connection Requests',
                'Personalized AI Outreach Emails via Gmail',
                'Priority Gemini AI Processing Speed',
                'Chrome Extension Instant Application Auto-fill',
              ].map((feature, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#334155' }}>
                  <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#dcfce7', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Check size={13} />
                  </div>
                  <span>{feature}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setShowUpgradeModal(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>Maybe Later</button>
              <button onClick={() => { alert('Pro features unlocked for your session!'); setShowUpgradeModal(false); }} className="btn-accent" style={{ flex: 1.5, justifyContent: 'center', background: 'linear-gradient(135deg, #ea580c 0%, #d97706 100%)' }}>
                Get Started Free <Crown size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Complete Profile First-Time Modal */}
      <CompleteProfileModal
        isOpen={showProfilePromptModal}
        onClose={handleDismissProfileModal}
        matchScore={bestMatchScore || 92}
      />
    </div>
  );
}

// Inline modal styles
const modalOverlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(15, 23, 42, 0.55)',
  backdropFilter: 'blur(4px)',
  padding: '20px',
};

const modalContentStyle = {
  background: '#ffffff',
  borderRadius: '20px',
  width: '100%',
  maxWidth: '460px',
  padding: '26px',
  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  border: '1px solid #e2e8f0',
};

const closeBtnStyle = {
  border: 'none',
  background: '#f1f5f9',
  borderRadius: '50%',
  width: '30px',
  height: '30px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: '#64748b',
};

