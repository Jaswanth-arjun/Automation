import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles, Link2, Bot, Crown, ChevronRight, X, Check, ExternalLink } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { adminJobStore } from '../lib/adminJobStore';
import { profileStore, getUserName } from '../lib/api';
import { computeJobScores } from '../lib/matchScore';
import JobAnalyzerModal from '../components/JobAnalyzerModal';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(() => profileStore.get());
  const [adminJobs, setAdminJobs] = useState(() => adminJobStore.getWithFreshDates());

  // Modal states
  const [showJobUrlModal, setShowJobUrlModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

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
  const firstName = displayName.split(' ')[0];

  const scored = useMemo(() => computeJobScores(profile || {}, adminJobs), [profile, adminJobs]);
  const topMatches = [...scored].sort((a, b) => (b.matchResult?.score || 0) - (a.matchResult?.score || 0)).slice(0, 3);

  return (
    <div className="page-overview">
      <section className="dash-hero">
        <h1>Welcome, {firstName} 👋</h1>
      </section>

      {/* 3 Quick Action Cards */}
      <div className="dash-quick-actions">
        <div className="quick-action-card" onClick={() => setShowJobUrlModal(true)}>
          <div className="qa-icon-wrap qa-blue">
            <Link2 size={22} />
          </div>
          <div className="qa-content">
            <strong className="qa-title">Add Job Link</strong>
            <span className="qa-subtitle">Paste a job URL to analyze</span>
          </div>
          <ChevronRight size={18} className="qa-arrow" />
        </div>

        <div className="quick-action-card" onClick={() => navigate('/dashboard/linkedin')}>
          <div className="qa-icon-wrap qa-green">
            <Bot size={22} />
          </div>
          <div className="qa-content">
            <strong className="qa-title">Run Agent Anywhere</strong>
            <span className="qa-subtitle">Start automation from anywhere</span>
          </div>
          <ChevronRight size={18} className="qa-arrow" />
        </div>

        <div className="quick-action-card" onClick={() => setShowUpgradeModal(true)}>
          <div className="qa-icon-wrap qa-purple">
            <Crown size={22} />
          </div>
          <div className="qa-content">
            <strong className="qa-title">Upgrade Plan</strong>
            <span className="qa-subtitle">Unlock more automation</span>
          </div>
          <ChevronRight size={18} className="qa-arrow" />
        </div>
      </div>

      <section className="dash-section">
        <div className="section-header">
          <h2>Top Matches</h2>
          <button className="btn-ghost" onClick={() => navigate('/dashboard/jobs')}>
            View all <ArrowRight size={14} />
          </button>
        </div>
        <div className="top-matches-grid">
          {topMatches.length === 0 && (
            <p style={{ color: '#718096', fontSize: '14px' }}>No jobs posted yet. Jobs an admin posts will show up here.</p>
          )}
          {topMatches.map(job => (
            <article key={job.id} className="match-card" onClick={() => navigate(`/dashboard/jobs/${job.id}`)}>
              <div className="match-card-top">
                <div className="job-card-company-mark">{job.companyMark}</div>
                <div>
                  <h4>{job.title}</h4>
                  <p>{job.company} · {job.location}</p>
                </div>
                <span className="match-badge" style={{
                  color: job.matchResult?.score >= 70 ? '#22a65b' : '#445cf5',
                  background: job.matchResult?.score >= 70 ? '#22a65b14' : '#445cf514',
                }}>
                  {job.matchResult?.score || 0}%
                </span>
              </div>
              <div className="job-card-skills">
                {job.skills?.slice(0, 3).map(s => <span key={s} className="skill-tag">{s}</span>)}
              </div>
            </article>
          ))}
        </div>
      </section>

      {!profile?.fullName && (
        <section className="dash-prompt">
          <Sparkles size={20} />
          <div>
            <strong>Complete your profile</strong>
            <p>Add your skills and experience to unlock personalized job matching.</p>
          </div>
          <button className="btn-accent" onClick={() => navigate('/dashboard/profile')}>Set up profile</button>
        </section>
      )}

      {/* Add Job Link Interactive Modal (Analyzing -> Results Flow) */}
      <JobAnalyzerModal 
        isOpen={showJobUrlModal} 
        onClose={() => setShowJobUrlModal(false)} 
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

