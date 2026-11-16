import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, MapPin, Clock, Building, Bookmark, CheckCircle, XCircle, ExternalLink,
  ShieldCheck, ShieldAlert, Sparkles, GraduationCap, FolderGit2, Briefcase, Lightbulb,
} from 'lucide-react';
import MatchScore from '../components/MatchScore';
import ApplyOptionsModal from '../components/ApplyOptionsModal';
import { DEMO_JOBS } from '../lib/mockData';
import { adminJobStore } from '../lib/adminJobStore';
import { profileStore } from '../lib/api';
import { calculateMatchScore } from '../lib/matchScore';
import { useAuth } from '../lib/auth';
import { savedJobsStore } from '../lib/savedJobsStore';

function renderFormattedDescription(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={i} style={{ fontSize: '16px', fontWeight: '700', color: '#171817', margin: '22px 0 10px', borderBottom: '1px solid #eee', paddingBottom: '6px' }}>
          {line.replace('## ', '')}
        </h3>
      );
    } else if (line.startsWith('# ')) {
      elements.push(
        <h2 key={i} style={{ fontSize: '18px', fontWeight: '800', color: '#171817', margin: '20px 0 10px' }}>
          {line.replace('# ', '')}
        </h2>
      );
    } else if (line.startsWith('• ') || line.startsWith('- ')) {
      elements.push(
        <div key={i} style={{ display: 'flex', gap: '8px', margin: '5px 0', paddingLeft: '8px', fontSize: '14px', lineHeight: '1.7', color: '#333' }}>
          <span style={{ color: '#445cf5', fontWeight: 'bold' }}>•</span>
          <span>{line.replace(/^[•\-]\s*/, '')}</span>
        </div>
      );
    } else if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: '10px' }} />);
    } else {
      elements.push(
        <p key={i} style={{ fontSize: '14px', lineHeight: '1.7', color: '#333', margin: '5px 0' }}>
          {line}
        </p>
      );
    }
  }
  return elements;
}

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [adminJobs, setAdminJobs] = useState(() => adminJobStore.getWithFreshDates());

  useEffect(() => {
    // Sync backend on mount
    adminJobStore.syncWithBackend();

    const handleUpdate = () => {
      setAdminJobs(adminJobStore.getWithFreshDates());
    };

    window.addEventListener('admin_jobs_updated', handleUpdate);
    return () => window.removeEventListener('admin_jobs_updated', handleUpdate);
  }, []);

  const allJobs = useMemo(() => [...adminJobs, ...DEMO_JOBS], [adminJobs]);
  const job = useMemo(() => allJobs.find(j => j.id === id), [allJobs, id]);

  const { user } = useAuth();
  const [profile, setProfile] = useState(() => profileStore.get() || {});
  const [resumeTick, setResumeTick] = useState(0);
  const [isSaved, setIsSaved] = useState(() => (id ? savedJobsStore.isSaved(id) : false));

  useEffect(() => {
    const handleSavedUpdated = () => {
      if (id) setIsSaved(savedJobsStore.isSaved(id));
    };
    window.addEventListener('saved_jobs_updated', handleSavedUpdated);
    window.addEventListener('storage', handleSavedUpdated);
    return () => {
      window.removeEventListener('saved_jobs_updated', handleSavedUpdated);
      window.removeEventListener('storage', handleSavedUpdated);
    };
  }, [id]);

  useEffect(() => {
    const refreshProfile = () => setProfile(profileStore.get() || {});
    const bump = () => setResumeTick((value) => value + 1);
    window.addEventListener('profile_updated', refreshProfile);
    window.addEventListener('storage', refreshProfile);
    window.addEventListener('resumes_updated', bump);
    return () => {
      window.removeEventListener('profile_updated', refreshProfile);
      window.removeEventListener('storage', refreshProfile);
      window.removeEventListener('resumes_updated', bump);
    };
  }, []);

  const matchResult = useMemo(() => {
    if (!job) return { status: 'incomplete', score: null, missingProfileLabels: [] };
    return calculateMatchScore(profile, job, { userId: user?.id || user?.email || 'anon' });
  }, [profile, job, user, resumeTick]);

  const eligibilityFailures = (matchResult.eligibility?.checks || [])
    .filter((check) => check.status === 'fail')
    .map((check) => check.detail);

  const isAdmin = job?.source === 'admin';

  const handleApply = () => {
    setApplyModalOpen(true);
  };

  if (!job) {
    return (
      <div className="page-job-detail">
        <button className="btn-ghost" onClick={() => navigate('/dashboard/jobs')}><ArrowLeft size={16} /> Back to jobs</button>
        <div className="empty-state">
          <h3>Job not found</h3>
          <p>This job listing may have been removed or is loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-job-detail">
      <button className="btn-ghost back-btn" onClick={() => navigate('/dashboard/jobs')}>
        <ArrowLeft size={16} /> Back to jobs
      </button>

      <div className="job-detail-layout">
        <div className="job-detail-main">
          <div className="job-detail-header">
            {job.companyLogoUrl ? (
              <img src={job.companyLogoUrl} alt={job.company} style={{ width: '52px', height: '52px', borderRadius: '12px', objectFit: 'cover', border: '1px solid #e5e5e0', flexShrink: 0 }} />
            ) : (
              <div className="job-card-company-mark large">{job.companyMark || job.company?.[0] || '?'}</div>
            )}
            <div>
              <h1>{job.title}</h1>
              <p className="job-detail-company">{job.company}</p>
            </div>
          </div>

          <div className="job-detail-meta">
            <span><MapPin size={15} /> {job.location}</span>
            <span><Clock size={15} /> {job.experienceLabel}</span>
            <span><Building size={15} /> {job.type}</span>
            {isAdmin && job.category && (
              <span style={{
                fontSize: '11px', fontWeight: '700', padding: '3px 12px', borderRadius: '20px',
                background: job.category === 'Remote' ? '#e8f5e9' : job.category === 'Freshers' ? '#eef0ff' : '#fff3e0',
                color: job.category === 'Remote' ? '#2e7d32' : job.category === 'Freshers' ? '#445cf5' : '#e65100',
              }}>
                {job.category}
              </span>
            )}
          </div>

          {isAdmin && job.sourceUrl && (
            <a
              className="job-source-link"
              href={job.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={13} /> View the original posting
            </a>
          )}

          {/* Must have / Good to have skills header (for admin jobs) */}
          {isAdmin && (
            <div style={{ margin: '16px 0', padding: '16px', background: '#fafaf7', borderRadius: '10px', border: '1px solid #eee' }}>
              {job.requiredSkills?.length > 0 && (
                <div style={{ marginBottom: '6px', fontSize: '13px' }}>
                  <strong style={{ color: '#171817' }}>Must have skills : </strong>
                  <span style={{ color: '#555' }}>{job.requiredSkills.join(', ')}</span>
                </div>
              )}
              {job.preferredSkills?.length > 0 && (
                <div style={{ fontSize: '13px' }}>
                  <strong style={{ color: '#171817' }}>Good to have skills : </strong>
                  <span style={{ color: '#555' }}>{job.preferredSkills.join(', ')}</span>
                </div>
              )}
            </div>
          )}

          {/* Description — rendered with formatting for admin jobs, plain for demo */}
          <section className="job-section">
            <h3>Description</h3>
            {isAdmin ? (
              <div>{renderFormattedDescription(job.description)}</div>
            ) : (
              <p>{job.description}</p>
            )}
          </section>

          {/* Standard sections for demo jobs */}
          {!isAdmin && job.responsibilities?.length > 0 && (
            <section className="job-section">
              <h3>Responsibilities</h3>
              <ul>{job.responsibilities.map(r => <li key={r}>{r}</li>)}</ul>
            </section>
          )}

          {!isAdmin && job.qualifications?.length > 0 && (
            <section className="job-section">
              <h3>Qualifications</h3>
              <ul>{job.qualifications.map(q => <li key={q}>{q}</li>)}</ul>
            </section>
          )}

          {!isAdmin && (
            <>
              <section className="job-section">
                <h3>Required Skills</h3>
                <div className="job-card-skills">{job.requiredSkills?.map(s => <span key={s} className="skill-tag">{s}</span>)}</div>
              </section>

              {job.preferredSkills?.length > 0 && (
                <section className="job-section">
                  <h3>Preferred Skills</h3>
                  <div className="job-card-skills">{job.preferredSkills.map(s => <span key={s} className="skill-tag secondary">{s}</span>)}</div>
                </section>
              )}
            </>
          )}

          {/* ---------- Personalised match analysis ---------- */}
          <section className="jm-panel" id="match-analysis">
            <h3><Sparkles size={15} /> Job match analysis</h3>
            <p className="jm-sub">
              Calculated for your account only — from your resume text, profile skills, education, projects and
              eligibility against this job description. Nothing here is estimated or shared between users.
            </p>

            {matchResult.status === 'incomplete' ? (
              <div className="jm-empty">
                <MatchScore
                  status="incomplete"
                  missingLabels={matchResult.missingProfileLabels}
                  onComplete={() => navigate('/dashboard/profile')}
                  size="normal"
                />
                <button
                  className="btn-accent"
                  type="button"
                  onClick={() => navigate('/dashboard/profile')}
                >
                  Complete profile to see your score
                </button>
                <p className="jm-muted">
                  No score is shown until the missing details exist — an estimated percentage would be misleading.
                </p>
              </div>
            ) : (
              <>
                <div className="jm-summary">
                  <MatchScore
                    score={matchResult.score}
                    status={matchResult.status}
                    explanation={matchResult.explanation}
                    eligibilityReasons={eligibilityFailures}
                    size="normal"
                  />

                  <div className="jm-elig">
                    <span className={`jm-elig-badge ${matchResult.eligibility?.eligible ? 'ok' : 'bad'}`}>
                      {matchResult.eligibility?.eligible ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                      {matchResult.eligibility?.eligible ? 'Eligible to apply' : 'Not eligible — mandatory requirement failed'}
                    </span>
                    {(matchResult.eligibility?.checks || []).map((check) => (
                      <div className="jm-elig-row" key={check.label}>
                        {check.status === 'pass' ? (
                          <CheckCircle size={13} color="#15803d" />
                        ) : check.status === 'fail' ? (
                          <XCircle size={13} color="#b91c1c" />
                        ) : (
                          <ShieldAlert size={13} color="#b45309" />
                        )}
                        <span><b>{check.label}:</b> {check.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="jm-dims">
                  {(matchResult.breakdown || []).map((dim) => (
                    <div className="jm-dim" key={dim.key}>
                      <div className="jm-dim-head">
                        <span>{dim.label}</span>
                        <span>{dim.score}% · weight {dim.weight}%</span>
                      </div>
                      <div className="jm-bar"><i style={{ width: `${dim.score}%` }} /></div>
                    </div>
                  ))}
                </div>

                <div className="jm-grid">
                  <div className="jm-block">
                    <h4><CheckCircle size={12} /> Matched required skills</h4>
                    {matchResult.matchedSkills?.length ? (
                      <div className="jm-tags">
                        {matchResult.matchedSkills.map((item) => (
                          <span className="jm-tag matched" key={item.skill} title={item.evidence || `Found in ${item.via}`}>
                            {item.skill}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="jm-muted">None of the required skills were found in your resume or profile.</p>
                    )}
                  </div>

                  <div className="jm-block">
                    <h4><XCircle size={12} /> Missing required skills</h4>
                    {matchResult.missingSkills?.length ? (
                      <div className="jm-tags">
                        {matchResult.missingSkills.map((item) => (
                          <span className="jm-tag missing" key={item.skill}>{item.skill}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="jm-muted">You cover every required skill listed.</p>
                    )}
                  </div>

                  <div className="jm-block">
                    <h4><Sparkles size={12} /> Preferred skills matched</h4>
                    {matchResult.matchedPreferred?.length ? (
                      <div className="jm-tags">
                        {matchResult.matchedPreferred.map((item) => (
                          <span className="jm-tag preferred" key={item.skill}>{item.skill}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="jm-muted">No preferred skills matched.</p>
                    )}
                  </div>

                  <div className="jm-block">
                    <h4><GraduationCap size={12} /> Education</h4>
                    <p className="jm-muted">
                      {matchResult.education?.degree || 'No degree on file'}
                      {matchResult.education?.graduationYear ? ` · graduating ${matchResult.education.graduationYear}` : ''}
                      {typeof matchResult.education?.score === 'number' ? ` · ${matchResult.education.score}% fit` : ''}
                    </p>
                    {matchResult.education?.reason && (
                      <p className="jm-muted">{matchResult.education.reason}</p>
                    )}
                  </div>

                  <div className="jm-block">
                    <h4><FolderGit2 size={12} /> Relevant projects</h4>
                    {matchResult.relevantProjects?.length ? (
                      <ul className="jm-list">
                        {matchResult.relevantProjects.map((project) => (
                          <li key={project.title}>
                            <b>{project.title}</b> — {Math.round((project.relevance || 0) * 100)}% overlap
                            {project.matchedSkills?.length ? ` (${project.matchedSkills.slice(0, 4).join(', ')})` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="jm-muted">No project overlaps with this job description.</p>
                    )}
                  </div>

                  <div className="jm-block">
                    <h4><Briefcase size={12} /> Relevant experience</h4>
                    {matchResult.relevantExperience?.length ? (
                      <ul className="jm-list">
                        {matchResult.relevantExperience.map((item) => (
                          <li key={`${item.title}-${item.company}`}>
                            <b>{item.title}</b>{item.company ? ` · ${item.company}` : ''} — {Math.round((item.relevance || 0) * 100)}% overlap
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="jm-muted">No work experience added yet.</p>
                    )}
                  </div>
                </div>

                <div className="jm-reasons">
                  <div className="jm-block">
                    <h4><Sparkles size={12} /> Why this score</h4>
                    <ul className="jm-list">
                      {(matchResult.reasons || []).map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  </div>
                  <div className="jm-block">
                    <h4><Lightbulb size={12} /> How to improve your match</h4>
                    <ul className="jm-list">
                      {(matchResult.suggestions || []).map((tip) => <li key={tip}>{tip}</li>)}
                    </ul>
                  </div>
                </div>

                <p className="jm-foot">
                  Evidence used: {matchResult.evidenceStats?.skills || 0} skills ·{' '}
                  {matchResult.evidenceStats?.projects || 0} projects ·{' '}
                  {matchResult.evidenceStats?.experience || 0} experience entries ·{' '}
                  {matchResult.evidenceStats?.yearsOfExperience || 0} years ·{' '}
                  {matchResult.evidenceStats?.resumeChars || 0} resume characters.
                  Calculated {matchResult.computedAt ? new Date(matchResult.computedAt).toLocaleString() : 'just now'}.
                  {matchResult.cached ? ' Served from cache until your resume, profile or this job description changes.' : ''}
                </p>
              </>
            )}
          </section>
        </div>

        <aside className="job-detail-sidebar">
          <div className="match-detail-card">
            <h3>Match Score</h3>
            <MatchScore
              score={matchResult.score}
              status={matchResult.status}
              explanation={matchResult.explanation}
              missingLabels={matchResult.missingProfileLabels}
              eligibilityReasons={eligibilityFailures}
              onComplete={() => navigate('/dashboard/profile')}
              size="normal"
            />
            {matchResult.matched?.length > 0 && (
              <div className="match-list">
                <h4><CheckCircle size={14} /> Matched</h4>
                <div className="job-card-skills">{matchResult.matched.map(s => <span key={s} className="skill-tag matched">{s}</span>)}</div>
              </div>
            )}
            {matchResult.missing?.length > 0 && (
              <div className="match-list">
                <h4><XCircle size={14} /> Missing</h4>
                <div className="job-card-skills">{matchResult.missing.map(s => <span key={s} className="skill-tag missing">{s}</span>)}</div>
              </div>
            )}
          </div>

          <div className="job-detail-actions">
            <button className="btn-accent full" onClick={handleApply}>
              Apply Now <ExternalLink size={14} style={{ marginLeft: '4px' }} />
            </button>
            <button
              className={`btn-ghost full ${isSaved ? 'saved' : ''}`}
              onClick={() => job?.id && savedJobsStore.toggle(job.id)}
              style={isSaved ? { borderColor: '#ea580c', color: '#ea580c', background: '#fff7ed' } : {}}
            >
              <Bookmark size={16} fill={isSaved ? 'currentColor' : 'none'} />
              {isSaved ? 'Saved' : 'Save Job'}
            </button>
          </div>
        </aside>
      </div>

      {/* Apply Options Modal */}
      <ApplyOptionsModal
        job={job}
        isOpen={applyModalOpen}
        onClose={() => setApplyModalOpen(false)}
      />
    </div>
  );
}

