import React, { useEffect, useMemo, useState } from 'react';
import { Briefcase, ChevronDown } from 'lucide-react';
import { api, profileStore } from '../lib/api';

/**
 * Job Profile — lives inside the main Profile page, directly below User Details.
 *
 *   Job Profile
 *     └── Job-Related Questions
 *          ├── Employment & Eligibility
 *          ├── Disability & Voluntary Disclosure (optional)
 *          ├── Education & Academic Information
 *          ├── Employment & Compensation
 *          ├── Additional Application Questions
 *          └── Job Application Preferences
 *
 * Job answers are stored per user in answer memory (server, survives logout).
 * Preferences are stored on the profile itself.
 */

const SENSITIVE_RE = /authori[sz]ed|sponsor|visa|salary|ctc|compensation|disab|accommodat|criminal|background|gender|ethnic|race|veteran|date of birth|\bdob\b|ssn|passport|notice period/i;

const QUESTION_GROUPS = [
  {
    id: 'eligibility',
    title: 'Employment & Eligibility',
    questions: [
      { label: 'Are you legally authorized to work in the country where this job is located?', type: 'yesno', required: true },
      { label: 'Do you require visa sponsorship?', type: 'yesno', required: true },
      { label: 'Work authorization country', type: 'text', placeholder: 'Country you are authorized to work in' },
      { label: 'Citizenship', type: 'text', placeholder: 'Your citizenship' },
      { label: 'Are you currently employed with a government or government agency (including in the last 12 months)?', type: 'yesno' },
      { label: 'Are you willing to undergo a background verification?', type: 'yesno' },
      { label: 'Have you previously worked for this company?', type: 'yesno' },
      { label: 'Have you previously applied to this company?', type: 'yesno' },
      { label: 'Are you currently employed?', type: 'yesno' },
      { label: 'What is your current employment status?', type: 'select', options: ['Student', 'Fresher', 'Employed', 'Unemployed'] },
      { label: 'What is your notice period?', type: 'text', required: true },
      { label: 'What is your earliest available joining date?', type: 'text', placeholder: 'Automatic — next day after you apply' },
    ],
  },
  {
    id: 'disclosure',
    title: 'Disability & Voluntary Disclosure (optional)',
    optional: true,
    questions: [
      { label: 'Do you have a disability?', type: 'select', options: ['Yes', 'No', 'Prefer not to say'] },
      { label: 'Do you require any workplace accommodations?', type: 'yesno' },
      { label: 'Do you wish to disclose your disability status?', type: 'select', options: ['Yes', 'No', 'Prefer not to say'] },
      { label: 'Are you a veteran?', type: 'select', options: ['Yes', 'No', 'Prefer not to say'] },
      { label: 'Gender', type: 'select', options: ['Male', 'Female', 'Non-binary', 'Prefer not to say'] },
      { label: 'Ethnicity', type: 'text' },
    ],
  },
  {
    id: 'education',
    title: 'Education & Academic Information',
    questions: [
      { label: 'Highest educational qualification', type: 'select', options: ['High School', 'Diploma', "Bachelor's Degree", "Master's Degree", 'PhD'] },
      { label: 'Degree and specialization', type: 'text' },
      { label: 'College / University name', type: 'text' },
      { label: 'Graduation year', type: 'text' },
      { label: 'CGPA / Percentage', type: 'text' },
      { label: 'Active backlogs', type: 'number' },
      { label: 'History of backlogs', type: 'yesno' },
    ],
  },
  {
    id: 'compensation',
    title: 'Employment & Compensation',
    questions: [
      { label: 'Total work experience (years)', type: 'number' },
      { label: 'Relevant work experience (years)', type: 'number' },
      { label: 'Current CTC', type: 'text' },
      { label: 'Expected CTC', type: 'text', required: true },
      { label: 'Expected salary', type: 'number' },
      { label: 'Are you willing to negotiate your salary?', type: 'yesno' },
      { label: 'Are you holding any other job offers?', type: 'yesno' },
      { label: 'Have you signed any employment or service agreement?', type: 'yesno' },
    ],
  },
  {
    id: 'additional',
    title: 'Additional Application Questions',
    questions: [
      { label: 'Are you willing to relocate?', type: 'yesno' },
      { label: 'Are you comfortable working onsite?', type: 'yesno' },
      { label: 'Are you comfortable with hybrid or remote work?', type: 'yesno' },
      { label: 'Are you willing to work in shifts?', type: 'yesno' },
      { label: 'Are you comfortable with rotational shifts?', type: 'yesno' },
      { label: 'Are you willing to sign a service agreement or bond?', type: 'yesno' },
      { label: 'Are you comfortable with a probation period?', type: 'yesno' },
      { label: 'How did you hear about this job opportunity?', type: 'text' },
    ],
  },
  {
    id: 'preferences',
    title: 'Job Application Preferences',
    preferences: true,
  },
];

const ALL_QUESTIONS = QUESTION_GROUPS
  .filter((group) => !group.preferences)
  .flatMap((group) => group.questions);

const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Internship', 'Contract', 'Freelance'];
const WORK_MODES = ['Remote', 'Hybrid', 'Onsite'];

const DEFAULT_PREFERENCES = {
  roles: '',
  locations: '',
  employmentTypes: [],
  workMode: '',
  willingToRelocate: '',
  salaryMin: '',
  salaryMax: '',
  currency: 'INR',
  industries: '',
  companyTypes: '',
  immediateJoining: '',
};

const inputStyle = {
  width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1',
  fontSize: '13px', background: '#fff', color: '#0f172a', boxSizing: 'border-box',
};
const labelStyle = { display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' };

function QuestionInput({ question, value, onChange }) {
  if (question.type === 'yesno') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        <option value="">Select…</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    );
  }
  if (question.type === 'select') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        <option value="">Select…</option>
        {(question.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  const htmlType = question.type === 'number' ? 'number' : question.type === 'date' ? 'date' : 'text';
  return <input type={htmlType} value={value} placeholder={question.placeholder || 'Your answer'} onChange={(e) => onChange(e.target.value)} style={inputStyle} />;
}

export default function JobProfileSection({ profile, setProfile }) {
  const [values, setValues] = useState({});
  const [openGroups, setOpenGroups] = useState(() => new Set(QUESTION_GROUPS.map((group) => group.id)));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Preferences live on the profile object so the page's normal Save keeps them.
  const currentProfile = profile || profileStore.get() || {};
  const preferences = { ...DEFAULT_PREFERENCES, ...(currentProfile.jobPreferences || {}) };

  const updatePreference = (key, value) => {
    const next = { ...(currentProfile.jobPreferences || {}), [key]: value };
    if (typeof setProfile === 'function') {
      setProfile((prev) => ({ ...prev, jobPreferences: next }));
    } else {
      profileStore.save({ ...currentProfile, jobPreferences: next });
    }
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listAnswerMemory();
      const entries = res?.answers || [];
      const byQuestion = new Map(entries.map((entry) => [String(entry.question || '').trim().toLowerCase(), entry]));
      const nextValues = {};
      ALL_QUESTIONS.forEach((question) => {
        const entry = byQuestion.get(question.label.toLowerCase());
        if (entry) nextValues[question.label] = entry.sensitive && !entry.answer ? '' : entry.answer || '';
      });
      // Reuse data already in User Details instead of asking for it twice.
      const education = (currentProfile.education || [])[0] || {};
      const setIfEmpty = (label, value) => { if (!nextValues[label] && value) nextValues[label] = String(value); };
      setIfEmpty('Degree and specialization', [education.degree, education.branch].filter(Boolean).join(' '));
      setIfEmpty('College / University name', education.institution || education.school);
      setIfEmpty('Graduation year', education.graduationYear || education.dates);
      setIfEmpty('CGPA / Percentage', education.cgpa);
      setValues(nextValues);
    } catch (err) {
      setError(err.message || 'Could not load your job profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const answeredCount = useMemo(
    () => ALL_QUESTIONS.filter((question) => String(values[question.label] || '').trim()).length,
    [values],
  );

  const prefFilled = useMemo(() => {
    let filled = 0;
    if (String(preferences.roles || '').trim()) filled += 1;
    if (String(preferences.locations || '').trim()) filled += 1;
    if ((preferences.employmentTypes || []).length) filled += 1;
    if (preferences.workMode) filled += 1;
    if (preferences.willingToRelocate) filled += 1;
    if (String(preferences.salaryMin || '').trim() || String(preferences.salaryMax || '').trim()) filled += 1;
    return filled;
  }, [preferences]);

  const completion = Math.round(((answeredCount + prefFilled) / (ALL_QUESTIONS.length + 6)) * 100);

  const toggleGroup = (id) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const savePreferencesToProfile = () => {
    const base = profileStore.get() || currentProfile;
    profileStore.save({ ...base, jobPreferences: { ...(base.jobPreferences || {}), ...preferences } });
  };

  const saveAll = async () => {
    setBusy('saving');
    setError('');
    setNotice('');
    try {
      savePreferencesToProfile();
      const res = await api.listAnswerMemory();
      const byQuestion = new Map((res?.answers || []).map((entry) => [String(entry.question || '').trim().toLowerCase(), entry]));
      let saved = 0;
      for (const question of ALL_QUESTIONS) {
        const value = String(values[question.label] ?? '').trim();
        if (!value) continue;
        const existing = byQuestion.get(question.label.toLowerCase());
        if (existing && String(existing.answer || '').trim() === value) continue;
        if (existing) {
          await api.updateAnswerMemory(existing.id, { answer: value, answerType: question.type, options: question.options || [], consent: true });
        } else {
          await api.saveAnswerMemory({ question: question.label, answer: value, answerType: question.type, options: question.options || [], confirmed: true, consent: true });
        }
        saved += 1;
      }
      setNotice(`Job profile saved — ${saved} answer(s) and your preferences.`);
      await load();
    } catch (err) {
      setError(err.message || 'Could not save your job profile.');
    } finally {
      setBusy('');
    }
  };

  const toggleEmploymentType = (type) => {
    const list = preferences.employmentTypes || [];
    updatePreference('employmentTypes', list.includes(type) ? list.filter((item) => item !== type) : [...list, type]);
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '18px 20px', marginBottom: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ width: '34px', height: '34px', borderRadius: '10px', background: '#eef2ff', color: '#4338ca', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Briefcase size={17} />
        </span>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>Job Profile</div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>Complete this once and the AI reuses it across every job application.</div>
        </div>
        <div style={{ minWidth: '120px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textAlign: 'right' }}>{completion}% complete</div>
          <div style={{ height: '6px', background: '#e2e8f0', borderRadius: '4px', marginTop: '4px', overflow: 'hidden' }}>
            <div style={{ width: `${completion}%`, height: '100%', background: '#0d9488' }} />
          </div>
        </div>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '8px', padding: '8px 12px', fontSize: '12.5px', margin: '12px 0' }}>{error}</div>}
      {notice && <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: '8px', padding: '8px 12px', fontSize: '12.5px', margin: '12px 0' }}>{notice}</div>}

      {loading ? (
        <p style={{ fontSize: '12.5px', color: '#64748b' }}>Loading job profile…</p>
      ) : (
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>
            Job-Related Questions <span style={{ fontWeight: 500, color: '#64748b' }}>({answeredCount}/{ALL_QUESTIONS.length} answered)</span>
          </div>

          {QUESTION_GROUPS.map((group) => {
            const open = openGroups.has(group.id);
            return (
              <div key={group.id} style={{ border: '1px solid #e5e7eb', borderRadius: '10px', marginBottom: '10px', overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '11px 14px', background: '#f8fafc', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#1f2937' }}>
                    {group.title}
                    {group.optional && <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 700, color: '#7c3aed', background: '#f3e8ff', borderRadius: '20px', padding: '2px 8px' }}>OPTIONAL</span>}
                  </span>
                  <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', color: '#64748b' }} />
                </button>

                {open && !group.preferences && (
                  <div style={{ padding: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                    {group.questions.map((question) => (
                      <div key={question.label}>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                          {question.label}
                          {question.required
                            ? <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: 700, color: '#b91c1c' }}>REQUIRED</span>
                            : <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: 700, color: '#94a3b8' }}>OPTIONAL</span>}
                          {SENSITIVE_RE.test(question.label) && <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: 700, color: '#9a3412' }}>PRIVATE</span>}
                        </label>
                        <QuestionInput
                          question={question}
                          value={values[question.label] ?? ''}
                          onChange={(value) => setValues((prev) => ({ ...prev, [question.label]: value }))}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {open && group.preferences && (
                  <div style={{ padding: '14px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
                      <div>
                        <label style={labelStyle}>Preferred job roles</label>
                        <input style={inputStyle} value={preferences.roles} placeholder="Frontend Developer, SDE Intern" onChange={(e) => updatePreference('roles', e.target.value)} />
                      </div>
                      <div>
                        <label style={labelStyle}>Preferred job locations</label>
                        <input style={inputStyle} value={preferences.locations} placeholder="Hyderabad, Bengaluru, Remote" onChange={(e) => updatePreference('locations', e.target.value)} />
                      </div>
                      <div>
                        <label style={labelStyle}>Preferred work mode</label>
                        <select style={inputStyle} value={preferences.workMode} onChange={(e) => updatePreference('workMode', e.target.value)}>
                          <option value="">Select…</option>
                          {WORK_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={labelStyle}>Willing to relocate?</label>
                        <select style={inputStyle} value={preferences.willingToRelocate} onChange={(e) => updatePreference('willingToRelocate', e.target.value)}>
                          <option value="">Select…</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                          <option value="Maybe">Maybe</option>
                        </select>
                      </div>
                      <div>
                        <label style={labelStyle}>Expected salary range</label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input style={inputStyle} type="number" value={preferences.salaryMin} placeholder="Min" onChange={(e) => updatePreference('salaryMin', e.target.value)} />
                          <input style={inputStyle} type="number" value={preferences.salaryMax} placeholder="Max" onChange={(e) => updatePreference('salaryMax', e.target.value)} />
                          <select style={{ ...inputStyle, maxWidth: '92px' }} value={preferences.currency} onChange={(e) => updatePreference('currency', e.target.value)}>
                            <option value="INR">INR</option>
                            <option value="USD">USD</option>
                            <option value="EUR">EUR</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label style={labelStyle}>Immediate joining availability</label>
                        <select style={inputStyle} value={preferences.immediateJoining} onChange={(e) => updatePreference('immediateJoining', e.target.value)}>
                          <option value="">Select…</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                        </select>
                      </div>
                      <div>
                        <label style={labelStyle}>Preferred industries</label>
                        <input style={inputStyle} value={preferences.industries} placeholder="Software, Fintech, EdTech" onChange={(e) => updatePreference('industries', e.target.value)} />
                      </div>
                      <div>
                        <label style={labelStyle}>Preferred company types</label>
                        <input style={inputStyle} value={preferences.companyTypes} placeholder="Startup, MNC, Product" onChange={(e) => updatePreference('companyTypes', e.target.value)} />
                      </div>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label style={labelStyle}>Preferred employment types</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                          {(preferences.employmentTypes || []).length === 0 && <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>None selected</span>}
                          {EMPLOYMENT_TYPES.map((type) => (
                            <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#334155' }}>
                              <input type="checkbox" checked={(preferences.employmentTypes || []).includes(type)} onChange={() => toggleEmploymentType(type)} />
                              {type}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <button type="button" onClick={load} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#334155', borderRadius: '8px', padding: '9px 16px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}>
              Reset
            </button>
            <button type="button" onClick={saveAll} disabled={busy === 'saving'} style={{ background: '#0d9488', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 20px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}>
              {busy === 'saving' ? 'Saving…' : 'Save Job Profile'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
