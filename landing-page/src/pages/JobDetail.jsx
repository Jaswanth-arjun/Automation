import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, MapPin, Clock, Building, Bookmark, CheckCircle, XCircle, ExternalLink,
  ShieldCheck, ShieldAlert, Sparkles, GraduationCap, FolderGit2, Briefcase, Lightbulb,
  Target, Lock, Info, Layers,
} from 'lucide-react';
import MatchScore from '../components/MatchScore';
import CompanyLogo from '../components/CompanyLogo';
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

const dimTone = (score) => (score >= 70 ? 'is-high' : score >= 40 ? 'is-mid' : 'is-low');

function verdictFor(score, status) {
  if (status === 'ineligible') return { label: 'Not eligible for this role', tone: 'is-low' };
  if (score >= 80) return { label: 'Excellent match', tone: 'is-high' };
  if (score >= 65) return { label: 'Strong match', tone: 'is-high' };
  if (score >= 45) return { label: 'Moderate match', tone: 'is-mid' };
  return { label: 'Low match', tone: 'is-low' };
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

  /* ---------- Match analysis derived values ---------- */
  const matchedRequired = matchResult.matchedSkills || [];
  const missingRequired = matchResult.missingSkills || [];
  const matchedPreferred = matchResult.matchedPreferred || [];
  const missingPreferred = matchResult.missingPreferred || [];

  const requiredTotal = matchResult.job?.requiredSkills?.length ?? (matchedRequired.length + missingRequired.length);
  const preferredTotal = matchResult.job?.preferredSkills?.length ?? (matchedPreferred.length + missingPreferred.length);
  const domainSkills = matchResult.job?.domainSkills || 0;
  const domainMatched = matchResult.job?.domainMatched || [];

  const scoreNumber = typeof matchResult.score === 'number' ? matchResult.score : 0;
  const verdict = verdictFor(scoreNumber, matchResult.status);
  const topProject = matchResult.relevantProjects?.[0];

  const summaryLine = [
    requiredTotal
      ? `${matchedRequired.length} of ${requiredTotal} required skills covered`
      : 'No required skills listed in this posting',
    preferredTotal ? `${matchedPreferred.length} of ${preferredTotal} preferred skills` : null,
    topProject ? `best project overlap ${Math.round((topProject.relevance || 0) * 100)}%` : null,
  ].filter(Boolean).join(' · ');

  const dimMeta = {
    required: requiredTotal ? `${matchedRequired.length} of ${requiredTotal} covered` : 'No skills listed',
    preferred: preferredTotal ? `${matchedPreferred.length} of ${preferredTotal} covered` : 'No preferred skills listed',
    experience: `${Number((matchResult.evidenceStats?.yearsOfExperienceExact ?? matchResult.evidenceStats?.yearsOfExperience ?? 0).toFixed(2))} yr evidence`,
    projects: `${matchResult.relevantProjects?.length || 0} relevant project${(matchResult.relevantProjects?.length || 0) === 1 ? '' : 's'}`,
    education: matchResult.education?.degree || 'No degree on file',
    domain: domainSkills ? `${domainMatched.length} of ${domainSkills} role technologies` : 'No technology terms in the JD',
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
            <CompanyLogo
              job={job}
              className="job-card-company-mark large"
              style={{ flexShrink: 0 }}
            />
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
            <header className="jm-head">
              <div className="jm-head-main">
                <span className="jm-head-icon"><Sparkles size={16} /></span>
                <div>
                  <h3>Job match analysis</h3>
                  <p className="jm-sub">
                    Scored from your resume, profile and eligibility against this job description.
                  </p>
                </div>
              </div>
              <span className="jm-head-chip"><Lock size={11} /> Private to your account</span>
            </header>

            <div className="jm-body">
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
                  {/* Score + eligibility */}
                  <div className="jm-hero">
                    <div className="jm-hero-score">
                      <MatchScore
                        score={matchResult.score}
                        status={matchResult.status}
                        size="normal"
                        eligibilityReasons={eligibilityFailures}
                      />
                      <div className="jm-verdict">
                        <span className={`jm-verdict-pill ${verdict.tone}`}>{verdict.label}</span>
                        <p className="jm-verdict-line">{summaryLine}</p>
                      </div>
                    </div>

                    <div className="jm-elig">
                      <div className="jm-elig-head">
                        <span className={`jm-elig-badge ${matchResult.eligibility?.eligible ? 'ok' : 'bad'}`}>
                          {matchResult.eligibility?.eligible ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                          {matchResult.eligibility?.eligible ? 'Eligible to apply' : 'Not eligible — mandatory requirement failed'}
                        </span>
                        <span className="jm-elig-note">Eligibility is scored separately from skills.</span>
                      </div>
                      <ul className="jm-elig-list">
                        {(matchResult.eligibility?.checks || []).map((check) => (
                          <li className={`jm-elig-row ${check.status}`} key={check.label}>
                            <span className="jm-elig-icon">
                              {check.status === 'pass'
                                ? <CheckCircle size={13} />
                                : check.status === 'fail'
                                  ? <XCircle size={13} />
                                  : <Info size={13} />}
                            </span>
                            <span className="jm-elig-text">
                              <b>{check.label}</b>
                              {check.detail}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Weighted dimensions */}
                  <div className="jm-section">
                    <div className="jm-section-head">
                      <h4>Score breakdown</h4>
                      <span>Weighted across the dimensions this posting defines</span>
                    </div>
                    <div className="jm-dims">
                      {(matchResult.breakdown || []).map((dim) => (
                        <div className={`jm-dim ${dimTone(dim.score)}`} key={dim.key}>
                          <div className="jm-dim-head">
                            <span className="jm-dim-label">{dim.label}</span>
                            <span className="jm-dim-score">{dim.score}<small>%</small></span>
                          </div>
                          <div className="jm-bar"><i style={{ width: `${dim.score}%` }} /></div>
                          <div className="jm-dim-foot">
                            <span className="jm-dim-meta">{dimMeta[dim.key] || ''}</span>
                            <span className="jm-dim-weight">{dim.weight}% weight</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Skills */}
                  <div className="jm-section">
                    <div className="jm-section-head">
                      <h4>Skill coverage</h4>
                      <span>Evidence found in your declared skills, resume and profile</span>
                    </div>
                    <div className="jm-grid">
                      <div className="jm-card">
                        <div className="jm-card-head">
                          <span className="jm-card-icon is-required"><Target size={13} /></span>
                          <h5>Required skills</h5>
                          <span className={`jm-card-count ${missingRequired.length ? '' : 'is-done'}`}>
                            {matchedRequired.length}/{requiredTotal || 0}
                          </span>
                        </div>
                        {matchedRequired.length > 0 ? (
                          <div className="jm-tags">
                            {matchedRequired.map((item) => (
                              <span className="jm-tag matched" key={item.skill} title={item.evidence || `Found in ${item.via}`}>
                                <CheckCircle size={11} /> {item.skill}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="jm-muted">None of the required skills appear in your resume or profile yet.</p>
                        )}

                        {missingRequired.length > 0 && (
                          <>
                            <div className="jm-tag-divider"><span>Not evidenced</span></div>
                            <div className="jm-tags">
                              {missingRequired.map((item) => (
                                <span className="jm-tag missing" key={item.skill}><XCircle size={11} /> {item.skill}</span>
                              ))}
                            </div>
                          </>
                        )}

                        {matchedRequired.length > 0 && !missingRequired.length && (
                          <p className="jm-note is-ok"><CheckCircle size={12} /> Every required skill for this role is covered.</p>
                        )}
                      </div>

                      <div className="jm-card">
                        <div className="jm-card-head">
                          <span className="jm-card-icon is-preferred"><Sparkles size={13} /></span>
                          <h5>Preferred skills</h5>
                          <span className="jm-card-count">{matchedPreferred.length}/{preferredTotal || 0}</span>
                        </div>
                        {matchedPreferred.length > 0 ? (
                          <div className="jm-tags">
                            {matchedPreferred.map((item) => (
                              <span className="jm-tag preferred" key={item.skill}>{item.skill}</span>
                            ))}
                          </div>
                        ) : (
                          <p className="jm-muted">
                            {preferredTotal ? 'No preferred skills matched yet.' : 'This posting lists no preferred skills.'}
                          </p>
                        )}

                        {missingPreferred.length > 0 && (
                          <>
                            <div className="jm-tag-divider"><span>Nice to have</span></div>
                            <div className="jm-tags">
                              {missingPreferred.map((item) => (
                                <span className="jm-tag neutral" key={item.skill}>{item.skill}</span>
                              ))}
                            </div>
                          </>
                        )}
                      </div>

                      {domainSkills > 0 && (
                        <div className="jm-card jm-card-wide">
                          <div className="jm-card-head">
                            <span className="jm-card-icon"><Layers size={13} /></span>
                            <h5>Role stack</h5>
                            <span className="jm-card-count">{domainMatched.length}/{domainSkills}</span>
                          </div>
                          {domainMatched.length > 0 && (
                            <div className="jm-tags">
                              {domainMatched.map((skill) => <span className="jm-tag matched" key={skill}><CheckCircle size={11} /> {skill}</span>)}
                            </div>
                          )}
                          {(matchResult.job?.domainMissing || []).length > 0 && (
                            <>
                              <div className="jm-tag-divider"><span>Rest of the stack</span></div>
                              <div className="jm-tags">
                                {(matchResult.job?.domainMissing || []).slice(0, 8).map((skill) => <span className="jm-tag neutral" key={skill}>{skill}</span>)}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Evidence */}
                  <div className="jm-section">
                    <div className="jm-section-head">
                      <h4>Your evidence</h4>
                      <span>What in your profile supports this score</span>
                    </div>
                    <div className="jm-grid jm-grid-3">
                      <div className="jm-card">
                        <div className="jm-card-head">
                          <span className="jm-card-icon"><GraduationCap size={13} /></span>
                          <h5>Education</h5>
                          {typeof matchResult.education?.score === 'number' && (
                            <span className="jm-card-count">{matchResult.education.score}%</span>
                          )}
                        </div>
                        <p className="jm-strong">
                          {matchResult.education?.degree || 'No degree on file'}
                          {matchResult.education?.graduationYear ? ` · ${matchResult.education.graduationYear}` : ''}
                        </p>
                        {matchResult.education?.reason && <p className="jm-muted">{matchResult.education.reason}</p>}
                      </div>

                      <div className="jm-card">
                        <div className="jm-card-head">
                          <span className="jm-card-icon"><FolderGit2 size={13} /></span>
                          <h5>Relevant projects</h5>
                          <span className="jm-card-count">{matchResult.relevantProjects?.length || 0}</span>
                        </div>
                        {matchResult.relevantProjects?.length ? (
                          <ul className="jm-evidence-list">
                            {matchResult.relevantProjects.map((project) => (
                              <li key={project.title} title={project.matchedSkills?.join(', ') || ''}>
                                <span className="jm-evidence-title">{project.title}</span>
                                <span className="jm-evidence-pct">{Math.round((project.relevance || 0) * 100)}%</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="jm-muted">No project overlaps with this job description.</p>
                        )}
                      </div>

                      <div className="jm-card">
                        <div className="jm-card-head">
                          <span className="jm-card-icon"><Briefcase size={13} /></span>
                          <h5>Relevant experience</h5>
                          <span className="jm-card-count">{matchResult.relevantExperience?.length || 0}</span>
                        </div>
                        {matchResult.relevantExperience?.length ? (
                          <ul className="jm-evidence-list">
                            {matchResult.relevantExperience.map((item) => (
                              <li key={`${item.title}-${item.company}`}>
                                <span className="jm-evidence-title">
                                  {item.title}
                                  {item.company ? <small> · {item.company}</small> : null}
                                </span>
                                <span className="jm-evidence-pct">{Math.round((item.relevance || 0) * 100)}%</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="jm-muted">No work experience added yet.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Insights */}
                  <div className="jm-insights">
                    <div className="jm-card jm-insight">
                      <div className="jm-card-head">
                        <span className="jm-card-icon is-required"><Sparkles size={13} /></span>
                        <h5>Why this score</h5>
                      </div>
                      <ul className="jm-list">
                        {(matchResult.reasons || []).map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    </div>
                    <div className="jm-card jm-insight is-improve">
                      <div className="jm-card-head">
                        <span className="jm-card-icon is-preferred"><Lightbulb size={13} /></span>
                        <h5>How to improve your match</h5>
                      </div>
                      <ul className="jm-list">
                        {(matchResult.suggestions || []).map((tip) => <li key={tip}>{tip}</li>)}
                      </ul>
                    </div>
                  </div>

                  <footer className="jm-foot">
                    <div className="jm-foot-chips">
                      <span>{matchResult.evidenceStats?.skills || 0} skills</span>
                      <span>{matchResult.evidenceStats?.projects || 0} projects</span>
                      <span>{matchResult.evidenceStats?.experience || 0} roles</span>
                      <span>{Number((matchResult.evidenceStats?.yearsOfExperienceExact ?? matchResult.evidenceStats?.yearsOfExperience ?? 0).toFixed(2))} yrs</span>
                      <span>{matchResult.evidenceStats?.resumeChars || 0} resume chars</span>
                    </div>
                    <span className="jm-foot-note">
                      Calculated {matchResult.computedAt ? new Date(matchResult.computedAt).toLocaleString() : 'just now'}
                      {matchResult.cached ? ' · cached until your resume, profile or this job changes' : ''}
                    </span>
                  </footer>
                </>
              )}
            </div>
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
