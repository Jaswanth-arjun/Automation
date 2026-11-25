import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Mail, FileText, Sparkles,
  Copy, Check, Send, Download, CheckCircle2,
  AlertCircle, RefreshCw,
  Upload, Eye, EyeOff, ChevronRight, UserCheck, Target, X, Plus, Play, Square, Loader, Zap, Monitor, Pencil,
  Lock, Gem
} from 'lucide-react';
import { DEMO_JOBS } from '../lib/mockData';
import { adminJobStore } from '../lib/adminJobStore';
import { profileStore, applicationStore, resumeStore, api, employeeStore, applyProgressStore, tailorReportStore, campaignPrefsStore, coverLetterStore } from '../lib/api';
import CoverLetterModal from '../components/CoverLetterModal';
import { getSelectedTemplateId } from '../lib/resumeTemplates';
import { downloadCoverLetterPdf, openCoverLetterPdf } from '../lib/coverLetterPdf';
import { calculateAtsScore } from '../lib/atsScore';
import { calculateMatchScore } from '../lib/matchScore';
import { useAuth } from '../lib/auth';
import CampaignStatus from '../components/CampaignStatus';
import { ResumeRichEditor } from '../components/JobAnalyzerModal';
import { keywordAudit, scoreValue, scoreLabel, mapProfileForBackend, extractProfilePdf } from '../components/JobAnalyzerModal.helpers';
import MatchScore from '../components/MatchScore';
import AutoApplyTaskPanel, { AutoApplyActivityFeed } from '../components/AutoApplyTaskPanel';
import { AUTOMATION_PHASES } from '../lib/autoApplyNarrative';

const Linkedin = ({ size = 16, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

function pdfObjectUrl(base64) {
  if (!base64) return '';
  const binary = atob(base64.includes(',') ? base64.split(',')[1] : base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

function downloadPdf(base64, filename) {
  if (!base64) return;
  const link = document.createElement('a');
  link.href = pdfObjectUrl(base64);
  link.download = filename?.toLowerCase().endsWith('.pdf') ? filename : `${filename || 'resume'}.pdf`;
  link.click();
}

/**
 * Deterministic quality check of a tailored resume. These are the things a
 * recruiter and an ATS parser both look for, so the candidate sees what to fix
 * before the PDF is sent out. No AI call, no invented facts.
 */
function buildResumeChecks({ text, pageCount, matchedCount, totalKeywords }) {
  const body = String(text || '');
  const has = (pattern) => pattern.test(body);
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;

  return [
    {
      id: 'contact',
      label: 'Contact block is complete',
      ok: has(/[\w.+-]+@[\w-]+\.[\w.]+/) && has(/(\+?\d[\d\s().-]{8,}\d)/),
      hint: 'Add an email and a phone number at the top — ATS parsers drop resumes without them.',
    },
    {
      id: 'links',
      label: 'Profile links included',
      ok: has(/linkedin\.com|github\.com/i),
      hint: 'Add your LinkedIn or GitHub URL; recruiters open it before they read further.',
    },
    {
      id: 'one-page',
      label: 'Fits on one page',
      ok: pageCount ? pageCount <= 1 : wordCount <= 650,
      hint: 'Trim the oldest bullets so the page stays single-sheet and every keyword stays visible.',
    },
    {
      id: 'metrics',
      label: 'Impact is measurable',
      ok: has(/\d+\s*%|\b\d{2,}\b/),
      hint: 'Turn one bullet into a number — users served, % faster, records handled.',
    },
    {
      id: 'verbs',
      label: 'Bullets lead with action verbs',
      ok: has(/\b(built|develop|design|implement|automate|optimi|led|launch|improv|migrat|deploy|reduc|creat|engineer)/i),
      hint: 'Replace “Responsible for …” with Built / Automated / Reduced.',
    },
    {
      id: 'sections',
      label: 'Core sections present',
      ok: has(/skills/i) && has(/education/i) && has(/project|experience/i),
      hint: 'Keep Skills, Projects or Experience, and Education — ATS reads headings to build its index.',
    },
    {
      id: 'keywords',
      label: totalKeywords ? `Job keywords covered (${matchedCount}/${totalKeywords})` : 'Job keywords covered',
      ok: totalKeywords ? matchedCount / totalKeywords >= 0.9 : true,
      hint: 'Add the remaining keywords from the list where they are honest for you.',
    },
  ];
}

// Tone for the inline auto-apply console header, derived from the live task.
function autoConsoleHeader({ task, applying, result }) {
  const status = task?.status || '';
  const tone = (bg, fg, border, label) => ({ bg, fg, border, label });
  if (status === 'submitted' || result?.status === 'submitted') return tone('#ecfdf5', '#047857', '#bbf7d0', 'Submitted');
  if (status === 'cancelled') return tone('#f4f4f1', '#5b6470', '#e5e5e0', 'Cancelled');
  if (status === 'failed' || result?.status === 'failed') return tone('#fef2f2', '#b91c1c', '#fecaca', 'Failed');
  if (status === 'waiting_for_approval') return tone('#eff6ff', '#1d4ed8', '#dbeafe', 'Action needed');
  if (status === 'waiting_for_user_input') return tone('#fffbeb', '#b45309', '#fde68a', 'Answer needed');
  if (status === 'paused') return tone('#fffbeb', '#b45309', '#fde68a', 'Paused');
  if (result?.status === 'needs_attention') return tone('#fffbeb', '#b45309', '#fde68a', 'Needs you');
  return tone('#eef7f2', '#047857', '#cdeadd', applying ? 'Live' : 'Ready');
}

export default function Apply() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  // Find job from admin store or demo jobs
  const adminJobs = adminJobStore.getWithFreshDates();
  const allJobs = useMemo(() => [...adminJobs, ...DEMO_JOBS], [adminJobs]);
  const job = allJobs.find(j => j.id === jobId);

  const profile = profileStore.get() || {};
  const resumes = resumeStore.getAll();
  const activeResume = resumes.find(r => r.isActive) || resumes[0];
  // Prefer the resume tailored for THIS job (saved with jobUrl/jobId/company),
  // not the stale global active resume from an older job.
  const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const jobLinks = [job?.applyLink, job?.url, jobId].filter(Boolean).map(String);
  const jobResumes = (resumes || []).filter((r) => {
    if (r.jobId && jobId && r.jobId === jobId) return true;
    if (r.jobUrl && jobLinks.some((l) => r.jobUrl === l || String(r.jobUrl).includes(String(jobId)) || l.includes(String(r.jobUrl)))) return true;
    return false;
  });
  const companySlug = normKey(job?.company);
  const companyResume = companySlug.length >= 4
    ? (resumes || []).find((r) => r.name && normKey(r.name).includes(companySlug.slice(0, Math.min(10, companySlug.length))))
    : null;
  const jobResume = jobResumes.length ? jobResumes[jobResumes.length - 1] : (companyResume || null);

  const matchResult = useMemo(
    () => calculateMatchScore(profile, job || {}, { userId: user?.id || user?.email || 'anon' }),
    [profile, job, user],
  );
  const hasMatchScore = typeof matchResult.score === 'number';

  const [activeTab, setActiveTab] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('stage');
    return ['tailor', 'referral', 'linkedin', 'apply'].includes(requested) ? requested : 'tailor';
  }); // 'tailor' | 'referral' | 'linkedin' | 'apply'
  const [copiedNoteIndex, setCopiedNoteIndex] = useState(null);
  const [emailSentIndex, setEmailSentIndex] = useState(null);
  const [isTailoring, setIsTailoring] = useState(false);
  const [tailorResult, setTailorResult] = useState(null);
  const [tailorError, setTailorError] = useState('');
  const [formatId, setFormatId] = useState('recommended');
  const [editorState, setEditorState] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(() => Boolean(applyProgressStore.get(jobId)?.referral));
  const [referralRecipients, setReferralRecipients] = useState(
    () => applyProgressStore.get(jobId)?.referralRecipients || [],
  );

  // Auto-Apply state
  const [autoApplying, setAutoApplying] = useState(false);
  const [autoApplyProgress, setAutoApplyProgress] = useState([]);
  const [autoApplyResult, setAutoApplyResult] = useState(null);
  const [showAutoApplyModal, setShowAutoApplyModal] = useState(false);
  const autoConsoleRef = useRef(null);
  const [autoRunId, setAutoRunId] = useState('');
  const [runLogState, setRunLogState] = useState('idle');
  const [needsUser, setNeedsUser] = useState(null);
  const [extensionReady, setExtensionReady] = useState(false);
  const [autoTask, setAutoTask] = useState(null);
  const [autoTaskError, setAutoTaskError] = useState('');
  const [taskAnswerDrafts, setTaskAnswerDrafts] = useState({});
  const [taskAnswerConsent, setTaskAnswerConsent] = useState({});
  const [taskBusy, setTaskBusy] = useState('');
  const handledTaskTerminalRef = useRef('');
  const [tailoredPdfBase64, setTailoredPdfBase64] = useState(null);
  const [tailoredFileName, setTailoredFileName] = useState('');

  // Backend run pollers must be stopped if this page is left mid-run.
  const activePollsRef = useRef([]);
  useEffect(() => () => {
    activePollsRef.current.forEach((id) => clearInterval(id));
    activePollsRef.current = [];
  }, []);

  // Cover Letter state
  const [coverLetter, setCoverLetter] = useState(() => coverLetterStore.get(jobId));
  const [isGeneratingCoverLetter, setIsGeneratingCoverLetter] = useState(false);
  const [isDownloadingCoverLetter, setIsDownloadingCoverLetter] = useState(false);
  const [showCoverLetterModal, setShowCoverLetterModal] = useState(false);
  const [coverLetterModalMode, setCoverLetterModalMode] = useState('view');

  // Full Auto Mode state - NEW
  const [fullAutoMode, setFullAutoMode] = useState(() => {
    try {
      return localStorage.getItem('hamzooh_full_auto_mode') === 'true';
    } catch {
      return false;
    }
  });

  // Save full auto mode preference
  useEffect(() => {
    try {
      localStorage.setItem('hamzooh_full_auto_mode', fullAutoMode ? 'true' : 'false');
    } catch { }
  }, [fullAutoMode]);

  // A tailored resume only belongs to the job it was generated for. If this job
  // was already tailored, restore that report instead of asking for it again.
  useEffect(() => {
    setTailorError('');
    setEditorState(null);
    setCoverLetter(coverLetterStore.get(jobId));
    setSubmitted(Boolean(applyProgressStore.get(jobId)?.apply));
    // Referral sending is a one-time action per job: once every selected contact
    // has been emailed, reopening this page must not offer "Confirm & Send" again.
    const savedProgress = applyProgressStore.get(jobId) || {};
    setSendSuccess(Boolean(savedProgress.referral));
    setReferralRecipients(savedProgress.referralRecipients || []);
    const saved = tailorReportStore.get(jobId);
    if (saved?.report) {
      const savedFormatId = saved.formatId || saved.report.recommendedId || 'recommended';
      setTailorResult(saved.report);
      setFormatId(savedFormatId);
      setTailoredFileName(saved.resumeName || '');
      setTailoredPdfBase64(jobResume?.pdfBase64 || null);
    } else {
      setTailorResult(null);
      setTailoredPdfBase64(null);
      setTailoredFileName('');
      setFormatId('recommended');
    }
  }, [jobId]);

  // The PDF of a saved tailored resume is kept in the resume store, so attach it
  // once it is available (not needed when a fresh report just generated one).
  useEffect(() => {
    if (!tailoredPdfBase64 && jobResume?.pdfBase64) setTailoredPdfBase64(jobResume.pdfBase64);
  }, [jobResume?.pdfBase64]);

  // Job Tracker "continue" links open a specific stage via ?stage=...
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('stage');
    if (['tailor', 'referral', 'linkedin', 'apply'].includes(requested)) setActiveTab(requested);
  }, [location.search]);

  // Gmail App Password Configuration Modal
  const [showGmailModal, setShowGmailModal] = useState(false);
  const [gmailAppPassInput, setGmailAppPassInput] = useState('');
  const [gmailAuthError, setGmailAuthError] = useState('');
  const [gmailConnected, setGmailConnected] = useState(false);
  const [connectedGmailEmail, setConnectedGmailEmail] = useState('');

  // Fetch connected Gmail status on mount
  useEffect(() => {
    let alive = true;
    api.getGmailConfig()
      .then((cfg) => {
        if (!alive || !cfg) return;
        if (cfg.connected || cfg.configured) {
          setGmailConnected(true);
          setConnectedGmailEmail(cfg.email || '');
          if (cfg.email) {
            localStorage.setItem('hamzooh_gmail_email', cfg.email);
            localStorage.setItem('mailmind_gmail_email', cfg.email);
          }
        }
      })
      .catch((e) => {
        console.warn('Could not load Gmail config:', e);
      });
    return () => { alive = false; };
  }, []);

  // Auto-reply checkbox state
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);

  // LinkedIn connection status for Tab 2
  const liUserId = user?.id || 'demo-user-1';
  const [liConnected, setLiConnected] = useState(false);
  const [liAccount, setLiAccount] = useState(null);
  const [liServerOnline, setLiServerOnline] = useState(false);
  const [liChecking, setLiChecking] = useState(true);
  const [liConnecting, setLiConnecting] = useState(false);
  const [liConnectError, setLiConnectError] = useState('');

  // Campaign Launcher state (embedded in Tab 2 when connected)
  const DEFAULT_ROLES = ['Recruiter', 'Talent Acquisition', 'HR', 'Hiring Manager', 'Engineering Manager'];
  const [liCompany, setLiCompany] = useState(job?.company || '');
  const [liJobRole, setLiJobRole] = useState(job?.title || '');
  const [liRoles, setLiRoles] = useState(DEFAULT_ROLES);
  const [liNewRole, setLiNewRole] = useState('');
  const [liPerRole, setLiPerRole] = useState(10);
  // Stage 1 target: one company-wide referral-message count, independent of liPerRole.
  const [liReferralTarget, setLiReferralTarget] = useState(5);
  const [liUseAI, setLiUseAI] = useState(true);
  const [liWatchLive, setLiWatchLive] = useState(false);
  const [liNote, setLiNote] = useState('');
  const [liStarting, setLiStarting] = useState(false);
  const [liCampaignMsg, setLiCampaignMsg] = useState(null);
  const [liIsRunning, setLiIsRunning] = useState(false);
  const [liCampaign, setLiCampaign] = useState(null);

  // Check LinkedIn connection on mount
  useEffect(() => {
    let alive = true;
    setLiChecking(true);
    api.getLinkedInStatus()
      .then(() => {
        if (!alive) return;
        setLiServerOnline(true);
        return api.getLinkedInAccount(liUserId);
      })
      .then((acc) => {
        if (!alive) return;
        if (acc && acc.connected) {
          setLiConnected(true);
          setLiAccount(acc);
        }
      })
      .catch(() => {
        if (!alive) return;
        setLiServerOnline(false);
      })
      .finally(() => {
        if (alive) setLiChecking(false);
      });
    return () => { alive = false; };
  }, [liUserId]);

  // Poll for LinkedIn connection while connecting (login window open)
  useEffect(() => {
    if (!liConnecting) return;
    const interval = setInterval(async () => {
      try {
        const acc = await api.getLinkedInAccount(liUserId);
        if (acc && acc.connected) {
          setLiConnected(true);
          setLiAccount(acc);
          setLiConnecting(false);
          setLiConnectError('');
        } else if (acc && acc.status === 'cancelled') {
          setLiConnecting(false);
        } else if (acc && acc.status === 'timeout') {
          setLiConnecting(false);
          setLiConnectError('Login timed out. Please try again.');
        } else if (acc && acc.status === 'failed') {
          setLiConnecting(false);
          setLiConnectError(acc.error || 'Login failed. Please try again.');
        }
      } catch { }
    }, 3000);
    return () => clearInterval(interval);
  }, [liConnecting, liUserId]);

  // Handle connect LinkedIn directly from Apply page (opens Chrome login window)
  const handleLiConnect = async () => {
    setLiConnectError('');
    setLiConnecting(true);
    try {
      const res = await api.connectLinkedIn(liUserId);
      if (res.status === 'connected') {
        setLiConnected(true);
        setLiAccount(res.account);
        setLiConnecting(false);
      }
      // if status === 'pending', polling will detect when login completes
    } catch (err) {
      setLiConnecting(false);
      setLiConnectError(err.message || 'Failed to open LinkedIn login window. Make sure the backend server is running.');
    }
  };

  const handleLiCancelConnect = async () => {
    try { await api.disconnectLinkedIn(liUserId); } catch { }
    setLiConnecting(false);
    setLiConnectError('');
  };

  // Auto-set company when job changes
  useEffect(() => {
    if (job?.company) setLiCompany(job.company);
    if (job?.title) setLiJobRole(job.title);
  }, [job?.company, job?.title]);

  // Reuse whatever was configured last (either here or in LinkedIn Automation)
  useEffect(() => {
    const prefs = campaignPrefsStore.get();
    if (!prefs) return;
    if (Array.isArray(prefs.roles) && prefs.roles.length) setLiRoles(prefs.roles);
    if (typeof prefs.perRole === 'number' && prefs.perRole > 0) setLiPerRole(prefs.perRole);
    if (typeof prefs.referralTarget === 'number' && prefs.referralTarget > 0) setLiReferralTarget(prefs.referralTarget);
    if (typeof prefs.useAI === 'boolean') setLiUseAI(prefs.useAI);
    if (typeof prefs.note === 'string') setLiNote(prefs.note);
  }, []);

  // Mirror the live campaign's own settings so re-opening a job shows exactly
  // what is running rather than stale form values.
  useEffect(() => {
    if (!liCampaign) return;
    const config = liCampaign.config || {};
    if (Array.isArray(config.roles) && config.roles.length) setLiRoles(config.roles);
    if (typeof config.perRole === 'number' && config.perRole > 0) setLiPerRole(config.perRole);
    if (typeof config.referralTarget === 'number' && config.referralTarget > 0) setLiReferralTarget(config.referralTarget);
    if (typeof config.useAINotes === 'boolean') setLiUseAI(config.useAINotes);
    if (typeof config.headless === 'boolean') setLiWatchLive(config.headless === false);
    if (typeof config.connectionNote === 'string') setLiNote(config.connectionNote);
  }, [liCampaign?.id]);

  const liAddRole = () => {
    const r = liNewRole.trim();
    if (r && !liRoles.includes(r)) setLiRoles([...liRoles, r]);
    setLiNewRole('');
  };

  const liFlash = (msg, type = 'ok') => {
    setLiCampaignMsg({ msg, type });
    setTimeout(() => setLiCampaignMsg(null), 4000);
  };

  const handleLiStartCampaign = async () => {
    if (!liConnected) { liFlash('Connect your LinkedIn account first', 'err'); return; }
    if (!liCompany.trim()) { liFlash('Enter the target company', 'err'); return; }
    const role = liJobRole.trim();
    if (!role) { liFlash('Enter the target job role so messages can be written for it.', 'err'); return; }
    setLiStarting(true);
    try {
      campaignPrefsStore.save({
        company: liCompany.trim(),
        role: liJobRole.trim(),
        roles: liRoles,
        perRole: liPerRole,
        referralTarget: liReferralTarget,
        useAI: liUseAI,
        note: liNote,
      });
      const profile = profileStore.get() || {};
      const resumes = resumeStore.getAll();
      const activeResume = resumes.find((resume) => resume.isActive) || resumes[0];
      const res = await api.startCampaign({
        userId: liUserId,
        company: liCompany.trim(),
        role,
        roles: liRoles,
        perRole: liPerRole,
        referralTarget: liReferralTarget,
        sendInvites: true,
        useAINotes: liUseAI,
        headless: !liWatchLive,
        connectionNote: liNote.trim(),
        userProfile: {
          ...profile,
          resume: {
            ...(profile.resume || {}),
            text: String(activeResume?.text || profile.resume?.text || '').slice(0, 4000),
          },
        },
      });
      if (res?.campaign) setLiCampaign(res.campaign);
      liFlash(
        res?.reused
          ? '↻ Attached to the campaign already running for this job.'
          : '🚀 Campaign started. It runs in the backend and keeps going if you leave this page.',
        'ok',
      );
      setLiIsRunning(true);
      applyProgressStore.mark(jobId || job?.id, 'linkedin', {
        company: job?.company || '',
        title: job?.title || '',
        roles: liRoles,
      });
    } catch (err) {
      liFlash(err.message || 'Failed to start campaign', 'err');
    }
    setLiStarting(false);
  };

  const handleLiStopCampaign = async () => {
    try {
      if (liCampaign?.id) {
        const res = await api.stopCampaign(liCampaign.id);
        if (res?.campaign) setLiCampaign(res.campaign);
      } else {
        await api.stopLinkedIn();
      }
      liFlash('Campaign stopped. You can resume it from the campaign card.', 'ok');
      setLiIsRunning(false);
    } catch (err) {
      liFlash(err.message || 'Failed to stop', 'err');
    }
  };

  const [employeeList, setEmployeeList] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  // Counts come from the backend so the UI never invents locked contacts.
  const [contactAccess, setContactAccess] = useState(null);

  useEffect(() => {
    if (!job?.company) {
      setEmployeeList([]);
      setContactAccess(null);
      return;
    }
    let cancelled = false;
    setEmployeesLoading(true);
    const companyKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const sameCompany = (employeeCompany) => {
      const left = companyKey(employeeCompany);
      const right = companyKey(job.company);
      return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
    };
    api.getEmployees(job.company)
      .then((rows) => {
        if (cancelled) return;
        const serverRows = Array.isArray(rows) ? rows : [];
        // Never resurrect a locked contact from the browser cache: locked rows
        // arrive masked and cached copies of the same person are skipped.
        const lockedNames = new Set(
          serverRows
            .filter((row) => row.locked)
            .map((row) => String(row.name || '').trim().toLowerCase())
            .filter(Boolean),
        );
        const cached = employeeStore.getAll()
          .filter((emp) => sameCompany(emp.company))
          .filter((emp) => !String(emp.email || '').includes('•'))
          .filter((emp) => !lockedNames.has(String(emp.name || '').trim().toLowerCase()));
        const merged = [...serverRows];
        cached.forEach((emp) => {
          // One row per email id, even when the server matched the same person
          // through a company alias — the candidate must never see duplicates.
          const email = String(emp.email || '').toLowerCase();
          if (!merged.some((row) => String(row.email || '').toLowerCase() === email)) merged.push(emp);
        });
        const list = merged;
        setEmployeeList(list.map((emp) => ({
          ...emp,
          selected: !emp.locked,
          role: emp.role && job.company && !String(emp.role).toLowerCase().includes(job.company.toLowerCase())
            ? `${emp.role} at ${emp.company || job.company}`
            : (emp.role || emp.company || ''),
        })));
        const lockedCount = list.filter((row) => row.locked).length;
        setContactAccess({
          discovered: list.length,
          unlocked: list.length - lockedCount,
          locked: lockedCount,
          cap: lockedCount ? list.length - lockedCount : null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        const cached = employeeStore.getAll()
          .filter((emp) => sameCompany(emp.company))
          .filter((emp) => !String(emp.email || '').includes('•'));
        setEmployeeList(cached.map((emp) => ({ ...emp, selected: true })));
      })
      .finally(() => {
        if (!cancelled) setEmployeesLoading(false);
      });
    return () => { cancelled = true; };
  }, [job?.company, job?.id]);

  const toggleEmployeeSelect = (id) => {
    setEmployeeList(prev => prev.map(e => (e.id === id && !e.locked) ? { ...e, selected: !e.selected } : e));
  };

  const [isDiscovering, setIsDiscovering] = useState(false);
  const handleDiscoverContacts = async () => {
    if (!job?.company || isDiscovering) return;
    setIsDiscovering(true);
    try {
      const res = await api.discoverEmployees({
        company: job.company,
        jobTitle: job.title || '',
        jobUrl: job.applyLink || ''
      });
      if (res && Array.isArray(res.contacts) && res.contacts.length > 0) {
        setEmployeeList(res.contacts.map((emp) => ({
          ...emp,
          selected: !emp.locked,
          role: emp.role || `${emp.company || job.company} Representative`,
        })));
        if (res.contactAccess) setContactAccess(res.contactAccess);
      }
    } catch (err) {
      console.error('Discovery error:', err);
    } finally {
      setIsDiscovering(false);
    }
  };

  const selectedEmployees = employeeList.filter(e => e.selected && !e.locked);
  const lockedContacts = employeeList.filter(e => e.locked);
  const unlockViaPro = () => navigate('/dashboard/subscription?plan=monthly');

  // Referral Email Template Draft (matching reference image format)
  const generateInitialDraft = () => {
    const firstName = (profile.fullName || 'Jaswanth').split(' ')[0];
    const currentTitle = profile.experience?.[0]?.title || 'Java Full Stack Developer Intern';
    const currentCompany = profile.experience?.[0]?.company || 'Model Career Centre - APSSDC';
    const previousTitle = profile.experience?.[1]?.title || 'Java Web Developer';
    const previousCompany = profile.experience?.[1]?.company || 'TaPTaP by Blackbucks';
    const skillsText = (profile.skills || ['API integration', 'Agile delivery', 'Node.js', 'SQL']).slice(0, 3).join(', ');

    return `Hi {{outreachEmployeeName}},

I'm ${firstName}, currently a ${currentTitle} at ${currentCompany}. My work centers on ${skillsText}, and I've also worked as a ${previousTitle} at ${previousCompany}.
My earlier Cloud Engineer role at Model Career Centre - APSSDC and Full Stack Engineer role at YHills gave me experience across application and cloud work, from development through deployment. You can learn more about my background through my LinkedIn profile.

I'm applying for the ${job?.title || 'position'} role at ${job?.company || 'your company'}. If you're comfortable referring me for this position, I'd sincerely appreciate your help with my application.

Here is the link to the job: ${window.location.origin}/dashboard/jobs/${job?.id || ''}

Thanks,
${firstName}`;
  };

  const [emailSubject, setEmailSubject] = useState(() =>
    `Application Referral Request: ${job?.title || 'Role'} at ${job?.company || 'Company'}`
  );
  const [emailBody, setEmailBody] = useState(() => generateInitialDraft());
  const toneIndexRef = useRef(0); // avoids a stale index when tone clicks are rapid
  const [isRewriting, setIsRewriting] = useState(false);

  // Sync draft whenever active job changes
  useEffect(() => {
    if (job) {
      setEmailSubject(`Application Referral Request: ${job.title} at ${job.company}`);
      setEmailBody(generateInitialDraft());
    }
  }, [job?.id, job?.title, job?.company]);

  // Rewrite Message handler (AI tone switcher)
  const handleRewriteMessage = () => {
    setIsRewriting(true);
    setTimeout(() => {
      const firstName = (profile.fullName || 'Jaswanth').split(' ')[0];
      const jobTitle = job?.title || 'Engineering Role';
      const companyName = job?.company || 'your organization';

      const TONES = [
        // Tone 0: Professional & Polite (Reference Image style)
        `Hi {{outreachEmployeeName}},\n\nI'm ${firstName}, currently a ${profile.experience?.[0]?.title || 'Full Stack Developer'}. I noticed the open ${jobTitle} role at ${companyName} and would be thrilled to contribute to your engineering team.\n\nWith my experience in ${(profile.skills || ['full stack development']).slice(0, 4).join(', ')}, I feel confident in my ability to add immediate value. You can check my LinkedIn profile for detailed portfolio projects.\n\nIf you are comfortable providing an employee referral for this opening, it would mean a lot to me!\n\nJob URL: ${window.location.origin}/dashboard/jobs/${job?.id || ''}\n\nWarm regards,\n${firstName}`,

        // Tone 1: Concise & Impactful
        `Hi {{outreachEmployeeName}},\n\nI hope you're having a great week! I'm reaching out because I'm applying for the ${jobTitle} position at ${companyName}.\n\nI have strong hands-on experience in ${(profile.skills || ['software development']).slice(0, 3).join(', ')} and would greatly appreciate an internal referral if you're open to it.\n\nMy profile and resume are attached for your quick reference.\n\nThanks a lot,\n${firstName}`,

        // Tone 2: Default Detailed
        generateInitialDraft()
      ];

      const nextIndex = (toneIndexRef.current + 1) % TONES.length;
      toneIndexRef.current = nextIndex;
      setEmailBody(TONES[nextIndex]);
      setIsRewriting(false);
    }, 450);
  };

  // Handle Confirm & Send to selected employees (Real Email Dispatch via Gmail OAuth)
  const handleConfirmAndSend = async () => {
    if (selectedEmployees.length === 0) {
      alert('Please select at least one company employee to send outreach emails.');
      return;
    }

    setSendingAll(true);
    setGmailAuthError('');

    try {
      const payload = {
        recipients: selectedEmployees.map(e => ({ name: e.name, email: e.email, role: e.role })),
        subject: emailSubject,
        bodyText: emailBody,
        senderEmail: connectedGmailEmail || profile.email || '',
        jobTitle: job?.title,
        company: job?.company,
        resumeBase64: tailoredPdfBase64 || jobResume?.pdfBase64 || activeResume?.pdfBase64 || '',
        resumeFileName: tailoredFileName || jobResume?.name || activeResume?.name || `${(profile.fullName || 'Candidate').split(' ')[0]}_Resume.pdf`,
      };

      const res = await api.sendReferralEmail(payload);

      if (res && res.requireGmailAuth) {
        setSendingAll(false);
        setGmailAuthError(res.message || 'Please connect your Google account under Mail Automation (http://localhost:5173/dashboard/mail) first.');
        return;
      }

      const sentNames = (res?.details || []).map((item) => item.recipientName).filter(Boolean);
      const failed = Array.isArray(res?.failures) ? res.failures : [];
      const allSent = res?.allSent !== false && failed.length === 0;

      // Log the referral as outreach (not an application). The Job Tracker
      // reads this plus the sent-email log to show stage 2 as completed.
      applicationStore.add({
        title: job?.title,
        company: job?.company,
        companyMark: job?.companyMark,
        jobId: job?.id,
        status: 'Outreach',
        stage: 'referral',
        ...(hasMatchScore ? { matchScore: matchResult.score } : {}),
        resumeUsed: tailoredFileName || jobResume?.name || activeResume?.name || `${(profile.fullName || 'User').split(' ')[0]}-resume.pdf`,
        referralSentTo: (sentNames.length ? sentNames : selectedEmployees.map(e => e.name)).join(', ')
      });
      applyProgressStore.mark(jobId || job?.id, 'referral', {
        company: job?.company || '',
        title: job?.title || '',
        referralRecipients: sentNames.length ? sentNames : selectedEmployees.map(e => e.name),
        referralAllSent: allSent,
      });

      setSendingAll(false);
      if (allSent) {
        setReferralRecipients(sentNames.length ? sentNames : selectedEmployees.map(e => e.name));
        setSendSuccess(true);
      } else {
        setGmailAuthError(
          `Sent to ${sentNames.length} of ${selectedEmployees.length}. Failed: ${failed.map(f => f.name || f.email).join(', ') || 'some recipients'}.`,
        );
      }
    } catch (err) {
      console.error('Error sending referral email:', err);
      setSendingAll(false);
      const raw = typeof err === 'string' ? err : err?.message || '';
      let msg = 'Connect Gmail on the Mail page, then send this referral again.';
      const jsonStart = raw.indexOf('{');
      if (jsonStart >= 0) {
        try {
          const data = JSON.parse(raw.slice(jsonStart));
          msg = data.message || data.error || msg;
        } catch {
          msg = raw;
        }
      } else if (raw) {
        msg = raw;
      }
      setGmailAuthError(msg);
    }
  };

  // Handle Copy Note for LinkedIn
  const handleCopyNote = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedNoteIndex(index);
    setTimeout(() => setCopiedNoteIndex(null), 2500);
  };

  // Tailor Resume — generate a real tailored PDF + ATS report for this job
  const handleTailorResume = async () => {
    setIsTailoring(true);
    setTailorError('');
    try {
      const link = job?.applyLink || job?.url || window.location.href;
      const active = activeResume || resumes[0];
      // Prefer the uploaded PDF text (it carries every section, experience
      // included). The structured-field fallback only lists titles and loses
      // internships, which silently dropped the EXPERIENCE section.
      const resumeText = String(active?.text || '').trim()
        || String(profile?.resume?.text || '').trim()
        || [
          profile.skills?.length ? `Skills: ${profile.skills.join(', ')}` : '',
          ...(profile.experience || []).map(e => [e.title, e.company, e.duration, e.description].filter(Boolean).join(' ')),
          ...(profile.education || []).map(ed => [ed.degree, ed.school, ed.graduationYear].filter(Boolean).join(' ')),
          ...(profile.projects || []).map(p => [p.title, p.technologies, p.description].filter(Boolean).join(' ')),
        ].filter(Boolean).join('\n');
      const mappedProfile = mapProfileForBackend(profile || {});
      // Older profiles stored only the PDF's URLs, without the word each link
      // sits on. Re-read the PDF so a certificate lands on its internship and
      // each repo lands on its own project.
      if (!mappedProfile.resume?.linkItems?.length && profile?.resume?.dataUrl) {
        try {
          const stored = await extractProfilePdf(profile);
          if (stored.linkItems?.length) {
            mappedProfile.resume = {
              ...(mappedProfile.resume || {}),
              links: stored.links.length ? stored.links : (mappedProfile.resume?.links || []),
              linkItems: stored.linkItems,
            };
            const savedProfile = profileStore.get() || profile;
            profileStore.save({
              ...savedProfile,
              resume: { ...(savedProfile.resume || {}), links: stored.links, linkItems: stored.linkItems },
            });
          }
        } catch { /* tailor without link context */ }
      }
      const result = await api.tailorExternalJob({
        url: link,
        profile: mappedProfile,
        resumeText,
        template: getSelectedTemplateId(),
      });

      const chosen = result.formats?.find(f => f.id === result.recommendedId) || result.formats?.[0];
      if (!chosen?.pdfBase64) throw new Error('The tailoring engine did not return a PDF for this job.');

      const name = `${(profile?.fullName || 'Candidate').split(' ')[0]}-${(job?.company || 'job').replace(/\s+/g, '-')}-tailored-resume.pdf`;
      setTailorResult(result);
      setFormatId(chosen.id || 'recommended');
      setTailoredPdfBase64(chosen.pdfBase64);
      setTailoredFileName(name);
      resumeStore.add({
        name,
        size: chosen.pageCount ? `${chosen.pageCount} page PDF` : '1 page PDF',
        type: 'application/pdf',
        text: chosen.plainText || result.plainText || '',
        pdfBase64: chosen.pdfBase64,
        jobUrl: link,
        jobId,
        company: job?.company || '',
        title: job?.title || '',
      });
      applyProgressStore.mark(jobId || job?.id, 'tailor', {
        company: job?.company || '',
        title: job?.title || '',
        resumeName: name,
      });
      // Keep the report with the job so it is still there after a refresh,
      // after moving to another stage, or when reopened from Job Tracker.
      tailorReportStore.save(jobId || job?.id, result, {
        formatId: chosen.id || 'recommended',
        resumeName: name,
        jobTitle: job?.title || '',
        company: job?.company || '',
      });
    } catch (err) {
      const raw = err?.message || '';
      let message = 'Could not tailor a resume for this job. Make sure the backend is running and try again.';
      const jsonStart = raw.indexOf('{');
      if (jsonStart >= 0) {
        try { message = JSON.parse(raw.slice(jsonStart)).error || message; } catch { message = raw; }
      } else if (/failed to fetch|networkerror|load failed/i.test(raw)) {
        message = 'Could not reach the tailoring server. Start the backend (npm start), then try again.';
      } else if (/timeout|timed out/i.test(raw)) {
        message = 'The job page took too long to analyze. Try again in a moment.';
      } else if (raw) {
        message = raw;
      }
      setTailorResult(null);
      setTailoredPdfBase64(null);
      setTailoredFileName('');
      setTailorError(message);
    } finally {
      setIsTailoring(false);
    }
  };

  // Open the tailored resume as a real PDF in a new browser tab
  const handleViewTailored = async () => {
    const chosen = tailorResult?.formats?.find(f => f.id === formatId) || tailorResult?.formats?.[0];
    if (!chosen) return;
    if (!chosen.pdfBase64 && !tailoredPdfBase64) return;
    // Anchor clicks survive popup blockers that reject window.open().
    const openUrl = (url) => {
      if (window.open(url, '_blank')) return;
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    };
    if (!chosen.editedHtml) {
      openUrl(pdfObjectUrl(chosen.pdfBase64 || tailoredPdfBase64));
      return;
    }
    // The re-render is async, so grab the tab while the click gesture is live.
    const win = window.open('', '_blank');
    try {
      const rendered = await api.renderEditedResumePdf(chosen.editedHtml);
      const url = pdfObjectUrl(rendered.pdfBase64);
      if (win) win.location.href = url;
      else openUrl(url);
    } catch {
      const url = pdfObjectUrl(chosen.pdfBase64 || tailoredPdfBase64);
      if (win) win.location.href = url;
      else openUrl(url);
    }
  };

  // Download the selected format (re-rendered when the user edited it)
  const handleDownloadTailored = async () => {
    const chosen = tailorResult?.formats?.find(f => f.id === formatId) || tailorResult?.formats?.[0];
    if (!chosen) return;
    if (!chosen.pdfBase64 && !tailoredPdfBase64) return;
    const name = tailoredFileName || 'tailored-resume.pdf';
    if (chosen.editedHtml) {
      try {
        const rendered = await api.renderEditedResumePdf(chosen.editedHtml);
        downloadPdf(rendered.pdfBase64, name);
        return;
      } catch {
        // Fall back to the generated PDF rather than failing the download.
      }
    }
    downloadPdf(chosen.pdfBase64 || tailoredPdfBase64, name);
  };

  // Generate 1-Page Tailored Cover Letter matching the Shine Reference Template
  const handleGenerateCoverLetter = async () => {
    if (isGeneratingCoverLetter) return;
    setIsGeneratingCoverLetter(true);
    try {
      const active = activeResume || resumes[0];
      const resumeContent = String(active?.text || '').trim() || String(profile?.resume?.text || '').trim();
      const res = await api.generateCoverLetter({
        jobTitle: job?.title || '',
        company: job?.company || '',
        jobLocation: job?.location || '',
        jobDescription: job?.description || '',
        profile: mapProfileForBackend(profile || {}),
        resumeText: resumeContent,
      });
      if (res?.coverLetter) {
        setCoverLetter(res.coverLetter);
        coverLetterStore.save(jobId, res.coverLetter);
        setCoverLetterModalMode('view');
        setShowCoverLetterModal(true);
      }
    } catch (err) {
      console.warn('Cover letter generation error:', err);
      alert('Could not generate cover letter. Please try again.');
    } finally {
      setIsGeneratingCoverLetter(false);
    }
  };

  // Cover letter: same Download PDF / View actions as the tailored resume
  const handleDownloadCoverLetter = async () => {
    if (!coverLetter || isDownloadingCoverLetter) return;
    setIsDownloadingCoverLetter(true);
    try {
      await downloadCoverLetterPdf(coverLetter, { company: job?.company || '', jobTitle: job?.title || '' });
    } catch (err) {
      alert('Could not download the cover letter PDF: ' + (err?.message || 'Server error'));
    } finally {
      setIsDownloadingCoverLetter(false);
    }
  };

  const handleViewCoverLetter = async () => {
    if (!coverLetter) return;
    try {
      await openCoverLetterPdf(coverLetter, { company: job?.company || '', jobTitle: job?.title || '' });
    } catch (err) {
      alert('Could not open the cover letter PDF: ' + (err?.message || 'Server error'));
    }
  };

  // Check extension availability and sync answers on mount
  useEffect(() => {
    let alive = true;

    const markReady = () => {
      if (!alive) return;
      setExtensionReady(true);
      fetch('/api/vault/answers').then(r => r.json()).then(data => {
        if (data.answers) {
          window.postMessage({ source: 'hamzooh-app', type: 'HAMZOOH_SYNC_ANSWERS', answers: data.answers }, '*');
        }
      }).catch(() => { });
    };

    // Check DOM attribute set by bridge.js
    if (document.documentElement?.dataset?.hamzoohExtension === '1' || window.__HAMZOOH_EXTENSION__) {
      markReady();
    }

    const onMsg = (event) => {
      if (!alive) return;
      if (event.data?.source === 'hamzooh-extension' && (event.data.type === 'HAMZOOH_PONG' || event.data.type === 'HAMZOOH_ANSWERS_SYNCED')) {
        markReady();
      }
    };
    window.addEventListener('message', onMsg);

    // Send PING immediately and retry every 400ms for 5 seconds
    window.postMessage({ source: 'hamzooh-app', type: 'HAMZOOH_PING' }, '*');
    const interval = setInterval(() => {
      if (!alive) return;
      if (document.documentElement?.dataset?.hamzoohExtension === '1') {
        markReady();
        clearInterval(interval);
      } else {
        window.postMessage({ source: 'hamzooh-app', type: 'HAMZOOH_PING' }, '*');
      }
    }, 400);

    const stopTimer = setTimeout(() => clearInterval(interval), 12000);

    return () => {
      alive = false;
      window.removeEventListener('message', onMsg);
      clearInterval(interval);
      clearTimeout(stopTimer);
    };
  }, []);

  // Keep latest job/match values without re-subscribing on every render
  // (job and matchResult are freshly created objects each render).
  const applyContextRef = useRef({ job, matchResult, hasMatchScore });
  applyContextRef.current = { job, matchResult, hasMatchScore };

  // Listen for extension progress/completion messages
  useEffect(() => {
    const onExtensionMessage = (event) => {
      if (event.data?.source !== 'hamzooh-extension') return;
      const ctx = applyContextRef.current;

      if (event.data.type === 'HAMZOOH_APPLY_PROGRESS') {
        setAutoApplyProgress(prev => [...prev, {
          step: event.data.step,
          message: event.data.message,
          timestamp: event.data.timestamp || Date.now(),
        }]);
      }

      if (event.data.type === 'HAMZOOH_APPLY_COMPLETE') {
        if (event.data.runId) setAutoRunId(event.data.runId);
        setAutoApplyResult({
          status: event.data.status || 'needs_attention',
          message: event.data.message || 'Application process completed.',
          filledFields: [],
          filledCount: event.data.filledCount || 0,
          emptyCount: event.data.emptyCount || 0,
          skipped: event.data.skipped || [],
        });
        setAutoApplying(false);
        if (event.data.status === 'submitted') {
          applicationStore.add({
            title: ctx.job?.title,
            company: ctx.job?.company,
            companyMark: ctx.job?.companyMark,
            jobId: ctx.job?.id,
            status: 'Applied',
            stage: 'apply',
            appliedViaExtension: true,
            ...(ctx.hasMatchScore ? { matchScore: ctx.matchResult.score } : {}),
            resumeUsed: 'Tailored Resume (Extension Auto-Applied)',
          });
          applyProgressStore.mark(jobId || ctx.job?.id, 'apply', {
            company: ctx.job?.company || '',
            title: ctx.job?.title || '',
          });
          setSubmitted(true);
        }
      }

      if (event.data.type === 'HAMZOOH_NEEDS_USER') {
        setNeedsUser({
          reasonCode: event.data.reasonCode || 'NEEDS_USER_GENERIC',
          message: event.data.message || 'The application needs your attention.',
          question: event.data.question || '',
          runId: event.data.runId || '',
        });
      }

      // Structured Phase-0 run log, relayed by bridge.js on demand.
      if (event.data.type === 'HAMZOOH_RUN_LOG') {
        const run = event.data.run;
        if (!run) {
          setRunLogState('error');
          return;
        }
        try {
          const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          const safeName = `${run.company || 'job'}-${run.runId || 'run'}`.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80);
          link.href = url;
          link.download = `hamzooh-run-${safeName}.json`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          setRunLogState('done');
        } catch {
          setRunLogState('error');
        }
      }
    };
    window.addEventListener('message', onExtensionMessage);
    return () => window.removeEventListener('message', onExtensionMessage);
  }, [jobId]);

  // Reattach to a task that survived a page reload or a browser reconnect.
  useEffect(() => {
    if (!extensionReady || !job) return undefined;
    let alive = true;
    const link = [job.applyLink, job.url, job.sourceUrl]
      .map((value) => String(value || '').trim())
      .find((value) => /^https?:\/\//i.test(value)) || '';
    if (!link) return undefined;
    api.getActiveApplicationTask()
      .then((res) => {
        if (!alive || !res?.task) return;
        if (res.task.url !== link) return;
        setAutoTask(res.task);
        setShowAutoApplyModal(true);
        setAutoApplying(!['submitted', 'failed', 'cancelled', 'waiting_for_user_input'].includes(res.task.status));
      })
      .catch(() => { });
    return () => { alive = false; };
  }, [extensionReady, jobId]);

  // Live task state — the modal and controls read genuine backend state.
  useEffect(() => {
    const taskId = autoTask?.id;
    if (!taskId) return undefined;
    let alive = true;
    let timer = null;
    const terminal = new Set(['submitted', 'failed', 'cancelled']);
    const active = new Set(['initializing', 'connecting_browser', 'analyzing_job', 'preparing_application', 'filling_application', 'submitting']);

    const applyTask = (task) => {
      if (!alive || !task) return;
      setAutoTask(task);
      const steps = (task.steps || []).slice(-80).map((step) => ({
        step: step.step,
        message: step.message,
        timestamp: step.at ? new Date(step.at).getTime() : Date.now(),
      }));
      if (steps.length) setAutoApplyProgress(steps);
      setAutoApplying(active.has(task.status));
      if (task.status === 'waiting_for_user_input') setAutoApplying(false);

      if (!terminal.has(task.status)) return;
      if (timer) { clearInterval(timer); timer = null; }
      if (handledTaskTerminalRef.current === task.id) return;
      handledTaskTerminalRef.current = task.id;
      setAutoApplying(false);

      if (task.status === 'submitted') {
        setAutoApplyResult({
          status: 'submitted',
          message: task.result?.message || 'Application submitted and verified by the site.',
          filledFields: [],
          filledCount: task.filledCount || task.review?.filledCount || 0,
          emptyCount: 0,
        });
        setSubmitted(true);
        const ctx = applyContextRef.current;
        applicationStore.add({
          title: ctx.job?.title,
          company: ctx.job?.company,
          companyMark: ctx.job?.companyMark,
          jobId: ctx.job?.id,
          status: 'Applied',
          stage: 'apply',
          appliedViaExtension: true,
          taskId: task.id,
          ...(ctx.hasMatchScore ? { matchScore: ctx.matchResult.score } : {}),
          resumeUsed: task.selectedResume?.name || task.review?.resumeName || 'Tailored Resume (AI agent)',
        });
        applyProgressStore.mark(jobId || ctx.job?.id, 'apply', {
          company: ctx.job?.company || '',
          title: ctx.job?.title || '',
        });
      } else if (task.status === 'cancelled') {
        setAutoApplyResult({ status: 'cancelled', message: task.result?.message || 'Application cancelled. Nothing was submitted.', filledFields: [] });
      } else {
        setAutoApplyResult({
          status: 'failed',
          message: task.result?.message || 'The automation stopped before submission. Review the activity log and try again.',
          filledFields: [],
        });
        setNeedsUser({
          reasonCode: task.result?.reasonCode || 'AUTOMATION_STOPPED',
          message: task.result?.message || 'The automation needs your attention.',
          question: task.result?.question || '',
          runId: task.id,
        });
      }
    };

    const poll = async () => {
      try {
        const res = await api.getApplicationTask(taskId);
        if (alive && res?.task) applyTask(res.task);
      } catch (err) {
        if (alive && (err.status === 404 || err.status === 401)) {
          setAutoTaskError(err.message || 'Could not load this application task.');
          if (timer) { clearInterval(timer); timer = null; }
        }
      }
    };

    poll();
    timer = setInterval(poll, 2000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [autoTask?.id]);

  // Low-latency updates from the backend's existing WebSocket channel; polling
  // above remains the fallback if the socket is unavailable.
  useEffect(() => {
    const taskId = autoTask?.id;
    if (!taskId) return undefined;
    let socket = null;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/linkedin-api`);
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === 'application_task' && payload.data?.taskId === taskId && payload.data?.task) {
            setAutoTask(payload.data.task);
          }
        } catch { }
      };
    } catch {
      socket = null;
    }
    return () => {
      try { socket?.close(); } catch { }
    };
  }, [autoTask?.id]);

  // Handle Direct Apply — Extension-based auto-apply (opens new tab in same browser)
  const handleProceedDirectApply = async (isTrainMode = false) => {
    const link = [job?.applyLink, job?.url, job?.sourceUrl]
      .map((u) => String(u || '').trim())
      .find((u) => /^https?:\/\//i.test(u) && !/\.(png|jpe?g|gif|svg|webp|ico|css|js)(\?|#|$)|\/(?:api\/images|org-theme-logo|favicon)\b/i.test(u)) || '';
    if (!link) {
      alert('This job has no application URL. Add an Apply link on the job, then try Auto Apply again.');
      return;
    }

    if (!extensionReady) {
      alert('Hamzooh Apply extension is not detected. Please load the extension in chrome://extensions (Load unpacked → select the extension folder), then reload this page.');
      return;
    }

    const alreadyApplied = applicationStore.getAll().some((app) => {
      if (app.stage === 'referral' || app.status === 'Outreach') return false;
      if (app.jobId && jobId && app.jobId === jobId) return true;
      return String(app.company || '').toLowerCase() === String(job?.company || '').toLowerCase()
        && String(app.title || '').toLowerCase() === String(job?.title || '').toLowerCase();
    });
    if (alreadyApplied && !window.confirm(
      'You already recorded an application for this role at this company. Start the automation again?',
    )) {
      return;
    }

    if (isTrainMode) {
      setTrainNotice(`🎓 Training Mode Active for ${job?.company || 'this role'}! The job page opened in a new tab. Please fill and submit the application manually — Hamzooh is quietly observing and recording your actions without any automated interference.`);
      setAutoApplying(false);
      setShowAutoApplyModal(false);
      setAutoApplyProgress([]);
      setAutoApplyResult(null);
      setAutoRunId('');
      setRunLogState('idle');
      setNeedsUser(null);
    } else {
      setTrainNotice('');
      setAutoApplying(true);
      setAutoApplyProgress([]);
      setAutoApplyResult(null);
      setShowAutoApplyModal(true);
      setAutoRunId('');
      setRunLogState('idle');
      setNeedsUser(null);
    }

    // Push profile to extension and trigger job open in new tab
    const ANSWERS_KEY = 'hamzooh_apply_answers';
    let savedAnswers = {};
    try { savedAnswers = JSON.parse(localStorage.getItem(ANSWERS_KEY) || '{}'); } catch { }
    try {
      const serverVault = await fetch('http://localhost:3000/api/vault/answers').then((r) => r.json());
      if (serverVault?.answers) {
        savedAnswers = { ...serverVault.answers, ...savedAnswers };
      }
    } catch { }

    // Ensure we have a valid PDF base64 for resume attachment.
    // Priority: just-tailored this session > resume saved for THIS job > global active.
    const jobPdf = jobResume?.pdfBase64 || jobResume?.base64 || '';
    let pdfToAttach = tailoredPdfBase64 || jobPdf || activeResume?.pdfBase64 || activeResume?.base64 || '';
    if (typeof pdfToAttach === 'string' && pdfToAttach.includes(',')) pdfToAttach = pdfToAttach.split(',')[1];
    let fileNameToAttach = tailoredFileName || jobResume?.name || activeResume?.name || `${(profile?.fullName || 'Candidate').split(' ')[0]}-${(job?.company || 'job').replace(/\s+/g, '-')}-resume.pdf`;

    // If no PDF exists yet, generate one on-the-fly before starting auto-apply
    if (!pdfToAttach) {
      try {
        const active = activeResume || resumes[0];
        const result = await api.tailorExternalJob({
          url: link,
          profile: mapProfileForBackend(profile || {}),
          resumeText: String(active?.text || '').trim() || String(profile?.resume?.text || '').trim(),
          template: getSelectedTemplateId(),
        });
        const chosen = result.formats?.[0];
        if (chosen?.pdfBase64) {
          pdfToAttach = chosen.pdfBase64;
          fileNameToAttach = `${(profile?.fullName || 'Candidate').split(' ')[0]}-${(job?.company || 'job').replace(/\s+/g, '-')}-tailored-resume.pdf`;
          resumeStore.add({
            name: fileNameToAttach,
            size: '1 page PDF',
            type: 'application/pdf',
            pdfBase64: pdfToAttach,
            jobUrl: link,
            jobId,
            company: job?.company || '',
            title: job?.title || '',
          });
          setTailoredPdfBase64(pdfToAttach);
          setTailoredFileName(fileNameToAttach);
        }
      } catch (err) {
        console.warn('On-the-fly tailoring warning:', err.message);
      }
    }

    const currentResumeText = jobResume?.text || activeResume?.text || profile?.resume?.text || '';
    const requestId = `apply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const readyPromise = new Promise((resolve) => {
      const onMsg = (event) => {
        if (event.source !== window || event.data?.source !== 'hamzooh-extension'
          || event.data.type !== 'HAMZOOH_APPLY_READY' || event.data.requestId !== requestId) return;
        window.removeEventListener('message', onMsg);
        clearTimeout(timeout);
        resolve(event.data);
      };
      const timeout = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        resolve({ ok: false, error: 'Hamzooh Apply did not respond. Reload the extension, then refresh this page.' });
      }, 20000);
      window.addEventListener('message', onMsg);
    });

    // Send the apply request to the extension
    window.postMessage({
      source: 'hamzooh-app',
      type: 'HAMZOOH_START_APPLY',
      requestId,
      url: link,
      trainMode: isTrainMode === true,
      profile: {
        ...(profile || {}),
        jobLocation: job?.location || job?.filters?.location || '',
        jobSource: job?.source || job?.sourceName || job?.provider || '',
      },
      answers: savedAnswers,
      resumeBase64: pdfToAttach,
      resumeName: fileNameToAttach,
      resumeText: currentResumeText,
      jobTitle: job?.title || '',
      company: job?.company || '',
    }, '*');

    const ready = await readyPromise;
    if (!ready.ok) {
      setAutoApplyResult({
        status: 'failed',
        message: ready.error || 'Failed to open job page. Make sure the Hamzooh Apply extension is loaded.',
        filledFields: [],
      });
      setAutoApplying(false);
      return;
    }
    if (ready.runId) setAutoRunId(ready.runId);

    if (!isTrainMode) {
      // Add initial progress step
      setAutoApplyProgress([{
        step: 'opened',
        message: `🌐 Job page opened in a new tab. Hamzooh is analyzing the form...`,
        timestamp: Date.now(),
      }]);
    }

    // Fallback timeout — if nothing comes back in 5 minutes
    setTimeout(() => {
      setAutoApplying(prev => {
        if (prev) {
          setAutoApplyResult(r => r || {
            status: 'needs_attention',
            message: 'Auto-apply is taking longer than expected. Check the job tab in your browser.',
            filledFields: [],
          });
          return false;
        }
        return prev;
      });
    }, 300000);
  };

  const handleResumeRun = () => {
    setNeedsUser(null);
    setAutoApplying(true);
    setAutoApplyResult(null);
    const onResume = (event) => {
      if (event.data?.source !== 'hamzooh-extension' || event.data.type !== 'HAMZOOH_RESUME_RESULT') return;
      window.removeEventListener('message', onResume);
      if (!event.data.ok) {
        setAutoApplyResult({ status: 'failed', message: event.data.error || 'Could not resume the paused run.' });
        setAutoApplying(false);
      } else {
        setAutoApplyProgress([{ step: 'resumed', message: '▶️ Resuming from the paused step in the job tab…', timestamp: Date.now() }]);
      }
    };
    window.addEventListener('message', onResume);
    window.postMessage({ source: 'hamzooh-app', type: 'HAMZOOH_RESUME_RUN' }, '*');
    setTimeout(() => {
      window.removeEventListener('message', onResume);
      setAutoApplying((value) => {
        if (!value) return value;
        setAutoApplyResult((r) => r || { status: 'needs_attention', message: 'Resume did not respond. Check the job tab.' });
        return false;
      });
    }, 20000);
  };

  // Vision AI auto-apply: the backend opens its own Chrome window, looks at the
  // screen with GPT-6-Luna and performs trusted mouse/keyboard actions.
  // ── Backend train / replay flow ──────────────────────────────────────────
  const loadApplyAnswers = async () => {
    let answers = {};
    try {
      const r = await fetch('http://localhost:3000/api/vault/answers').then((res) => res.json());
      answers = r.answers || {};
    } catch { }
    try { answers = { ...answers, ...JSON.parse(localStorage.getItem('hamzooh_apply_answers') || '{}') }; } catch { }
    return answers;
  };

  const beginBackendRun = () => {
    setAutoApplying(true);
    setAutoApplyProgress([]);
    setAutoApplyResult(null);
    setShowAutoApplyModal(true);
    setNeedsUser(null);
  };

  // A company/social profile page or image/asset URL is never the application, so it is only used
  // when nothing else was stored for this job.
  const PROFILE_PAGE_URL = /^https?:\/\/(?:[a-z0-9-]+\.)?(?:linkedin\.com\/(?:company|in|school|showcase)|facebook\.com|twitter\.com|x\.com|instagram\.com)\b/i;
  const ASSET_URL_RE = /\.(png|jpe?g|gif|svg|webp|ico|css|js)(\?|#|$)|\/(?:api\/images|org-theme-logo|favicon)\b/i;
  const applyLink = () => {
    const candidates = [job?.applyLink, job?.url, job?.sourceUrl]
      .map((u) => String(u || '').trim()).filter((u) => /^https?:\/\//i.test(u));
    return candidates.find((u) => !PROFILE_PAGE_URL.test(u) && !ASSET_URL_RE.test(u))
      || candidates.find((u) => !ASSET_URL_RE.test(u))
      || candidates[0] || '';
  };
  const applyTargetHost = (() => {
    try { return new URL(applyLink()).hostname.replace(/^www\./, ''); } catch { return ''; }
  })();

  const pollBackendRun = (statusPath, kind) => {
    let lastStepCount = 0;
    let consecutiveErrors = 0;
    let poll;
    const stop = () => {
      clearInterval(poll);
      activePollsRef.current = activePollsRef.current.filter((id) => id !== poll);
    };
    poll = setInterval(async () => {
      try {
        const res = await fetch(statusPath);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const status = await res.json();
        consecutiveErrors = 0;
        const run = status.run;
        if (!run) return;
        const newSteps = (run.steps || []).slice(lastStepCount);
        lastStepCount = (run.steps || []).length;
        if (newSteps.length) {
          setAutoApplyProgress((prev) => [...prev, ...newSteps.map((s) => ({
            step: s.step, message: s.message, timestamp: s.t || Date.now(),
          }))].slice(-80));
        }
        if (run.status !== 'RUNNING') {
          stop();
          setAutoApplying(false);
          const isTrain = kind === 'train';
          const finalStatus = run.status === 'SUBMITTED' || run.status === 'TRAINED'
            ? 'submitted' : run.status === 'NEEDS_USER' ? 'needs_attention' : 'failed';
          const filled = run.result?.filledFields || [];
          setAutoApplyResult({
            status: finalStatus,
            message: run.result?.message || `${isTrain ? 'Training' : 'Auto apply'} finished: ${run.status}`,
            filledFields: filled.map((f) => f.label || f),
            filledCount: filled.length,
          });
          if (isTrain && run.result?.blueprint) {
            setTrainNotice(`🎓 AI learned this portal: ${run.result.blueprint.fieldCount || 0} fields across ${run.result.blueprint.steps?.length || 0} steps. Future similar links will auto-fill with your details — no manual help.`);
          } else if (finalStatus === 'needs_attention' && run.result?.message) {
            setNeedsUser({
              reasonCode: run.result.reasonCode || run.status,
              message: run.result.message,
              question: '',
              runId: run.runId,
            });
          }
        }
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= 4) {
          stop();
          setAutoApplying(false);
          setAutoApplyResult({ status: 'failed', message: err.message, filledFields: [] });
        }
      }
    }, 2500);
    activePollsRef.current.push(poll);
  };

  // Guarantee a real resume PDF before the autonomous run starts.
  const ensureApplyResumePdf = async (link) => {
    const jobPdf = jobResume?.pdfBase64 || jobResume?.base64 || '';
    let pdfToAttach = tailoredPdfBase64 || jobPdf || activeResume?.pdfBase64 || activeResume?.base64 || profile?.resume?.dataUrl || '';
    if (typeof pdfToAttach === 'string' && pdfToAttach.includes(',')) pdfToAttach = pdfToAttach.split(',')[1];
    let fileNameToAttach = tailoredFileName || jobResume?.name || activeResume?.name
      || `${(profile?.fullName || 'Candidate').split(' ')[0]}-${(job?.company || 'job').replace(/\s+/g, '-')}-resume.pdf`;

    if (!pdfToAttach) {
      const active = activeResume || resumes[0];
      const result = await api.tailorExternalJob({
        url: link,
        profile: mapProfileForBackend(profile || {}),
        resumeText: String(active?.text || '').trim() || String(profile?.resume?.text || '').trim(),
        template: getSelectedTemplateId(),
      });
      const chosen = result.formats?.[0];
      if (!chosen?.pdfBase64) throw new Error('No resume PDF could be prepared for this application.');
      pdfToAttach = chosen.pdfBase64;
      fileNameToAttach = `${(profile?.fullName || 'Candidate').split(' ')[0]}-${(job?.company || 'job').replace(/\s+/g, '-')}-tailored-resume.pdf`;
      resumeStore.add({
        name: fileNameToAttach,
        size: '1 page PDF',
        type: 'application/pdf',
        pdfBase64: pdfToAttach,
        jobUrl: link,
        jobId,
        company: job?.company || '',
        title: job?.title || '',
      });
      setTailoredPdfBase64(pdfToAttach);
      setTailoredFileName(fileNameToAttach);
    }
    return { pdfToAttach, fileNameToAttach };
  };

  // Autonomous Auto Apply with AI.
  // The Chrome extension executes in the candidate's own tab; the backend owns
  // task state, answer memory and the approval gate.
  const handleAutoApply = async () => {
    const link = applyLink();
    if (!link) { alert('This job has no application URL. Add an Apply link on the job, then try again.'); return; }

    if (autoTask?.id && !['submitted', 'failed', 'cancelled'].includes(autoTask.status)) {
      setShowAutoApplyModal(true);
      setAutoApplying(['initializing', 'connecting_browser', 'analyzing_job', 'preparing_application', 'filling_application', 'submitting'].includes(autoTask.status));
      return;
    }

    if (!extensionReady) {
      alert('Hamzooh Apply is not connected. Load the extension in chrome://extensions (Load unpacked → extension folder), then refresh this page.');
      return;
    }

    const missingProfile = [];
    if (!String(profile?.fullName || '').trim()) missingProfile.push('full name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profile?.email || '').trim())) missingProfile.push('email');
    if (!String(profile?.phone || '').replace(/\D/g, '')) missingProfile.push('phone number');
    if (missingProfile.length) {
      alert(`Complete your profile before Auto Apply: ${missingProfile.join(', ')}.`);
      navigate('/dashboard/profile');
      return;
    }

    const hasAnyResume = Boolean(
      tailoredPdfBase64
      || jobResume?.pdfBase64 || jobResume?.base64
      || activeResume?.pdfBase64 || activeResume?.base64
      || profile?.resume?.dataUrl
      || String(activeResume?.text || profile?.resume?.text || '').trim(),
    );
    if (!hasAnyResume) {
      alert('Upload at least one resume before using Auto Apply with AI.');
      navigate('/dashboard/resume');
      return;
    }

    beginBackendRun();
    setAutoTask(null);
    setAutoTaskError('');
    handledTaskTerminalRef.current = '';

    try {
      const { pdfToAttach, fileNameToAttach } = await ensureApplyResumePdf(link);
      const answers = await loadApplyAnswers();
      const currentResumeText = jobResume?.text || activeResume?.text || profile?.resume?.text || '';

      const resumeFiles = new Map();
      if (pdfToAttach) resumeFiles.set(fileNameToAttach, pdfToAttach);
      (resumes || []).forEach((resume) => {
        const bytes = resume?.pdfBase64 || resume?.base64 || '';
        if (resume?.name && bytes) resumeFiles.set(resume.name, String(bytes).includes(',') ? String(bytes).split(',')[1] : bytes);
      });

      const resumeCandidates = (resumes || [])
        .filter((resume) => resume?.name || resume?.text)
        .map((resume) => ({ name: resume.name || '', size: resume.size || '', text: String(resume.text || '').slice(0, 12000) }));
      if (!resumeCandidates.some((resume) => resume.name === fileNameToAttach)) {
        resumeCandidates.push({ name: fileNameToAttach, size: 'PDF', text: String(currentResumeText).slice(0, 12000) });
      }
      const explicitSelection = (tailoredPdfBase64 || jobResume)
        ? { name: fileNameToAttach, text: String(currentResumeText).slice(0, 12000) }
        : null;

      const start = await api.startAutoApply({
        url: link,
        job: {
          title: job?.title || job?.role || '',
          company: job?.company || '',
          location: job?.location || job?.filters?.location || '',
          description: job?.description || '',
          source: job?.source || job?.sourceName || job?.provider || '',
        },
        profile: mapProfileForBackend(profile || {}),
        resumes: resumeCandidates,
        selectedResume: explicitSelection,
        resumeBase64: pdfToAttach,
        resumeName: fileNameToAttach,
      });

      const task = start.task;
      setAutoTask(task);
      setShowAutoApplyModal(true);
      setAutoApplying(true);
      setAutoApplyResult(null);
      setAutoApplyProgress([{ step: 'task_started', message: `Autopilot task created for ${job?.title || 'this role'}. Connecting to your browser…`, timestamp: Date.now() }]);

      const chosenName = task?.selectedResume?.name;
      const chosenBase64 = resumeFiles.get(chosenName) || pdfToAttach;
      const chosenFileName = chosenName || fileNameToAttach;

      const requestId = `apply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const readyPromise = new Promise((resolve) => {
        const onMsg = (event) => {
          if (event.source !== window || event.data?.source !== 'hamzooh-extension'
            || event.data.type !== 'HAMZOOH_APPLY_READY' || event.data.requestId !== requestId) return;
          window.removeEventListener('message', onMsg);
          clearTimeout(timeout);
          resolve(event.data);
        };
        const timeout = setTimeout(() => {
          window.removeEventListener('message', onMsg);
          resolve({ ok: false, error: 'Hamzooh Apply did not respond. Reload the extension, then refresh this page.' });
        }, 20000);
        window.addEventListener('message', onMsg);
      });

      window.postMessage({
        source: 'hamzooh-app',
        type: 'HAMZOOH_START_APPLY',
        requestId,
        taskId: task.id,
        taskToken: start.token,
        requireApproval: true,
        url: link,
        profile: {
          ...(profile || {}),
          jobLocation: job?.location || job?.filters?.location || '',
          jobSource: job?.source || job?.sourceName || job?.provider || '',
        },
        answers,
        resumeBase64: chosenBase64,
        resumeName: chosenFileName,
        resumeText: currentResumeText,
        jobTitle: job?.title || '',
        company: job?.company || '',
      }, '*');

      const ready = await readyPromise;
      if (!ready.ok) {
        await api.cancelApplicationTask(task.id, ready.error || 'The browser did not start.').catch(() => { });
        setAutoApplying(false);
        setAutoTaskError(ready.error || 'Could not open the job page in your browser.');
        setAutoApplyResult({ status: 'failed', message: ready.error || 'Could not open the job page in your browser.', filledFields: [] });
        return;
      }
      setAutoApplyProgress((previous) => [...previous, {
        step: 'browser_connected',
        message: '🌐 Job tab opened. The agent is reading the page and filling your application…',
        timestamp: Date.now(),
      }]);
    } catch (err) {
      if (err.code === 'TASK_ALREADY_RUNNING' && err.payload?.task) {
        setAutoTask(err.payload.task);
        setShowAutoApplyModal(true);
        setAutoApplying(!['submitted', 'failed', 'cancelled', 'waiting_for_user_input'].includes(err.payload.task.status));
        setAutoTaskError(err.message || 'An application is already running.');
        return;
      }
      setAutoApplying(false);
      setAutoTaskError(err.message || 'Auto Apply could not start.');
      setAutoApplyResult({ status: 'failed', message: err.message || 'Auto Apply could not start.', filledFields: [] });
    }
  };

  const handleTaskDraftChange = (questionId, value) => {
    setTaskAnswerDrafts((previous) => ({ ...previous, [questionId]: value }));
  };

  const handleTaskConsentChange = (questionId, value) => {
    setTaskAnswerConsent((previous) => ({ ...previous, [questionId]: value }));
  };

  const handleTaskAnswer = async (question) => {
    if (!autoTask?.id || !question?.id) return;
    const answer = String(taskAnswerDrafts[question.id] || '').trim();
    if (!answer) return;
    setTaskBusy(`answer:${question.id}`);
    setAutoTaskError('');
    try {
      const res = await api.answerApplicationQuestion(autoTask.id, question.id, {
        answer,
        remember: taskAnswerConsent[question.id] !== false,
        consent: taskAnswerConsent[question.id] !== false,
      });
      if (res?.task) setAutoTask(res.task);
      setTaskAnswerDrafts((previous) => ({ ...previous, [question.id]: '' }));
    } catch (err) {
      setAutoTaskError(err.message || 'Could not save that answer.');
    } finally {
      setTaskBusy('');
    }
  };

  const handleTaskControl = async (action) => {
    if (!autoTask?.id) return;
    setTaskBusy(action);
    setAutoTaskError('');
    try {
      let res;
      if (action === 'approve') res = await api.approveApplicationTask(autoTask.id);
      else if (action === 'cancel') res = await api.cancelApplicationTask(autoTask.id, 'Cancelled by the candidate.');
      else if (action === 'pause') res = await api.pauseApplicationTask(autoTask.id);
      else if (action === 'resume') res = await api.resumeApplicationTask(autoTask.id);
      else if (action === 'mark-submitted') res = await api.markApplicationTaskSubmitted(autoTask.id);
      if (res?.task) setAutoTask(res.task);
      if (action === 'cancel' || action === 'pause' || action === 'resume') {
        window.postMessage({ source: 'hamzooh-app', type: 'HAMZOOH_TASK_CONTROL', action, taskId: autoTask.id }, '*');
      }
      if (action === 'approve') {
        setAutoApplyProgress((previous) => [...previous, {
          step: 'approved',
          message: '✅ You approved submission. The agent is submitting and verifying the site response…',
          timestamp: Date.now(),
        }]);
      }
    } catch (err) {
      setAutoTaskError(err.message || `Could not ${action} this application.`);
    } finally {
      setTaskBusy('');
    }
  };

  // Request the structured Phase-0 log for this run and download it.
  const handleDownloadRunLog = () => {
    setRunLogState('loading');
    window.postMessage({
      source: 'hamzooh-app',
      type: 'HAMZOOH_GET_RUN',
      runId: autoRunId || '',
    }, '*');
    // If the extension never answers, don't leave the button spinning.
    setTimeout(() => {
      setRunLogState((state) => (state === 'loading' ? 'error' : state));
    }, 8000);
  };

  // Close auto-apply modal and cleanup
  // The run console is part of the page now, so bring it into view on start.
  useEffect(() => {
    if (!showAutoApplyModal) return;
    const node = autoConsoleRef.current;
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [showAutoApplyModal]);

  const handleCloseAutoApplyModal = () => {
    setShowAutoApplyModal(false);
    setAutoApplyProgress([]);
  };

  if (!job) {
    return (
      <div className="page-apply" style={{ padding: '40px 20px', maxWidth: '800px', margin: '0 auto' }}>
        <button className="btn-ghost" onClick={() => navigate('/dashboard/jobs')}><ArrowLeft size={16} /> Back to Jobs</button>
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <h3>Job Not Found</h3>
          <p>This job listing may have been removed or updated.</p>
        </div>
      </div>
    );
  }

  const userEmail = connectedGmailEmail || profile.email || localStorage.getItem('hamzooh_gmail_email') || localStorage.getItem('mailmind_gmail_email') || 'Connected Google Account';
  // Banner + sends: just-tailored (this session) > resume saved for this job > global active.
  const effectiveResume = (tailoredPdfBase64 && { name: tailoredFileName, pdfBase64: tailoredPdfBase64 }) || jobResume || activeResume;
  const resumeDisplayName = effectiveResume?.name || `${(profile.fullName || 'Jaswanth').split(' ')[0]}-resume.pdf`;

  // ── Tailoring report derived values ──
  const chosenFormat = tailorResult?.formats?.find(f => f.id === formatId) || tailorResult?.formats?.[0];
  const ats = chosenFormat?.ats || tailorResult?.ats || {};
  const beforeScore = scoreValue(ats.beforeScore);
  const afterScore = scoreValue(ats.afterScore);
  const scoreDelta = tailorResult?.scoreDelta ?? (beforeScore !== null && afterScore !== null ? afterScore - beforeScore : null);
  const audit = keywordAudit(ats);
  const matchedCount = audit.find(a => a.label === 'Matched after')?.values?.length ?? 0;
  const totalKeywords = Array.isArray(ats.jobKeywords) ? ats.jobKeywords.length : null;
  const keywordRows = (Array.isArray(ats.jobKeywords) ? ats.jobKeywords : []).map((keyword) => {
    const exactAfter = (ats.matchedKeywordsAfter || ats.matchedKeywords || []).includes(keyword);
    const partialAfter = (ats.partialKeywordsAfter || []).includes(keyword);
    const exactBefore = (ats.matchedKeywordsBefore || []).includes(keyword);
    const wasRemoved = exactBefore && !exactAfter && !partialAfter;
    let status = 'Missing';
    let tagIcon = '⚠';
    if (exactAfter && exactBefore) { status = 'Already Present'; tagIcon = '✓'; }
    else if (exactAfter && !exactBefore) { status = 'Newly Added'; tagIcon = '＋'; }
    else if (wasRemoved) { status = 'Removed'; tagIcon = '✗'; }
    else if (partialAfter) { status = 'Partial'; tagIcon = '●'; }
    return { keyword, status, tagIcon };
  });
  const reportAdded = keywordRows.filter(r => r.status === 'Newly Added');
  const reportPresent = keywordRows.filter(r => r.status === 'Already Present');
  const reportPartial = keywordRows.filter(r => r.status === 'Partial');
  const reportMissing = keywordRows.filter(r => r.status === 'Missing');
  const reportRemoved = keywordRows.filter(r => r.status === 'Removed');
  const tailoredText = chosenFormat?.editedPlainText || chosenFormat?.plainText || tailorResult?.plainText || '';
  const resumeChecks = buildResumeChecks({
    text: tailoredText,
    pageCount: chosenFormat?.pageCount ?? null,
    matchedCount,
    totalKeywords,
  });
  const failedChecks = resumeChecks.filter((check) => !check.ok);
  // A real ATS score: keyword coverage plus the parsable structure, contact
  // block, links, measurable impact, verbs, length and title alignment. Using
  // keyword overlap alone made every tailored resume show the same number.
  const atsScoreResult = calculateAtsScore({
    resumeText: tailoredText,
    jobKeywords: Array.isArray(ats.jobKeywords) ? ats.jobKeywords : [],
    matchedKeywords: ats.matchedKeywordsAfter || ats.matchedKeywords || [],
    partialKeywords: ats.partialKeywordsAfter || [],
    jobTitle: job?.title || tailorResult?.job?.title || '',
    pageCount: chosenFormat?.pageCount ?? null,
  });
  const atsScore = atsScoreResult.score;
  // Tailor summary card: one label column, one row of same-sized actions per target.
  const tailorGroupLabel = { width: '96px', flexShrink: 0, fontSize: '10.5px', fontWeight: '800', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a8f88' };
  const tailorActionBtn = { padding: '0 13px', height: '34px', fontSize: '12.5px', fontWeight: '700', gap: '6px', borderRadius: '9px' };
  // The right-aligned action of each row (Re-tailor / Regenerate) shares one
  // size so the two rows read as a single block.
  const tailorRowEndBtn = { ...tailorActionBtn, height: '38px', minWidth: '138px', padding: '0 18px', fontSize: '13px', justifyContent: 'center', marginLeft: 'auto' };

  const jobProgress = applyProgressStore.get(jobId || job?.id);
  const resumeReady = Boolean(tailorResult || jobResume);
  const resumeReadyName = tailoredFileName || jobResume?.name || '';
  const STEPS = [
    { key: 'tailor', label: 'Tailor Resume', icon: Sparkles, done: Boolean(tailorResult || jobResume || jobProgress.tailor) },
    { key: 'referral', label: 'Send Referral Request (Email)', icon: Mail, done: sendSuccess || Boolean(jobProgress.referral) },
    { key: 'linkedin', label: 'Connect on LinkedIn', icon: Linkedin, done: liIsRunning || Boolean(jobProgress.linkedin) },
    { key: 'apply', label: 'Direct Apply', icon: Zap, done: submitted || Boolean(jobProgress.apply) },
  ];

  return (
    <div className="page-apply" style={{ maxWidth: '1040px', margin: '0 auto', padding: '30px 20px' }}>
      {/* Back Button */}
      <button className="btn-ghost back-btn" onClick={() => navigate(-1)} style={{ marginBottom: '20px' }}>
        <ArrowLeft size={16} /> Back to Job Details
      </button>

      {/* Header Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #171817 0%, #2a2c2a 100%)',
          color: '#ffffff',
          borderRadius: '18px',
          padding: '26px 28px',
          marginBottom: '28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '20px',
          boxShadow: '0 12px 30px rgba(0,0,0,0.12)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {Boolean(job.companyLogoUrl || job.logo || job.company) && (
            <img
              src={job.companyLogoUrl || job.logo || `https://logos.hunter.io/${(job.company || '').toLowerCase().replace(/[^a-z0-9]/g, '')}.com`}
              alt={job.company}
              onError={(e) => {
                e.target.style.display = 'none';
                if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
              }}
              style={{ width: '56px', height: '56px', borderRadius: '14px', objectFit: 'contain', background: '#ffffff', padding: '6px' }}
            />
          )}
          <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: '#445cf5', color: '#fff', display: (job.companyLogoUrl || job.logo) ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '22px' }}>
            {job.company?.[0] || '?'}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{ background: '#445cf5', color: '#fff', fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '12px', textTransform: 'uppercase' }}>
                HAMZOOH Smart Outreach
              </span>
              {job.category && (
                <span style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '12px' }}>
                  {job.category}
                </span>
              )}
            </div>
            <h1 style={{ fontSize: '22px', fontWeight: '800', margin: '0 0 4px', color: '#ffffff', letterSpacing: '-0.02em' }}>
              {job.title}
            </h1>
            <p style={{ fontSize: '14px', color: '#ccc', margin: 0 }}>
              {job.company} · {job.location} · {job.type || 'Full Time'}
            </p>
          </div>
        </div>

        {/* Match Score Chip */}
        <div style={{ background: 'rgba(255,255,255,0.08)', padding: '12px 18px', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.12)', textAlign: 'right' }}>
          <div style={{ fontSize: '11px', color: '#aaa', textTransform: 'uppercase', fontWeight: '700' }}>Job Match</div>
          {hasMatchScore ? (
            <div style={{ fontSize: '20px', fontWeight: '800', color: matchResult.score >= 70 ? '#22a65b' : matchResult.score >= 40 ? '#d4920a' : '#ef4444' }}>
              {matchResult.score}% Match
            </div>
          ) : (
            <div style={{ fontSize: '12.5px', fontWeight: '700', color: '#fbbf24', maxWidth: 190, lineHeight: 1.4 }}>
              Complete Your Profile to Calculate Match Score
            </div>
          )}
        </div>
      </div>

      {/* Guided application stepper */}
      <div className="apply-flow-steps" role="tablist" aria-label="Application steps">
        {STEPS.map((step, index) => {
          const StepIcon = step.icon;
          return (
            <button
              key={step.key}
              type="button"
              role="tab"
              aria-selected={activeTab === step.key}
              className={`apply-flow-step ${activeTab === step.key ? 'active' : ''} ${step.done ? 'done' : ''}`}
              onClick={() => setActiveTab(step.key)}
            >
              <span className="apply-flow-num">{step.done ? <Check size={12} /> : index + 1}</span>
              <StepIcon size={13} />
              <span className="apply-flow-label">{step.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB CONTENT 1: Referral Request via Email (EXACT MATCH TO REFERENCE IMAGE) */}
      {activeTab === 'referral' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Main Email Composer Card */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 4px 20px rgba(0,0,0,0.04)'
            }}
          >
            {/* Header: Subject + From + Rewrite Message Button */}
            <div
              style={{
                background: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
                padding: '18px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '14px'
              }}
            >
              <div style={{ flex: 1, minWidth: '280px' }}>
                <div style={{ fontSize: '15px', fontWeight: '800', color: '#1a202c', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#00796b' }}>Subject:</span>
                  <input
                    value={emailSubject}
                    onChange={e => setEmailSubject(e.target.value)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      fontWeight: '800',
                      color: '#0f766e',
                      fontSize: '15px',
                      outline: 'none',
                      width: '100%',
                      maxWidth: '520px'
                    }}
                  />
                </div>
                <div style={{ fontSize: '12.5px', color: '#718096', fontStyle: 'italic' }}>
                  From: <span style={{ color: '#4a5568' }}>{userEmail}</span>
                </div>
              </div>

              {/* Rewrite Message Button (Mint Pill Button) */}
              <button
                onClick={handleRewriteMessage}
                disabled={isRewriting}
                style={{
                  background: '#d1fae5',
                  color: '#065f46',
                  border: '1px solid #a7f3d0',
                  borderRadius: '24px',
                  padding: '9px 18px',
                  fontWeight: '800',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 6px rgba(16, 185, 129, 0.12)'
                }}
              >
                <Sparkles size={15} className={isRewriting ? 'spin' : ''} />
                <span>{isRewriting ? 'Rewriting...' : '✨ Rewrite Message'}</span>
              </button>
            </div>

            {/* Editable AI Email Body */}
            <div style={{ padding: '24px' }}>
              <textarea
                value={emailBody}
                onChange={e => setEmailBody(e.target.value)}
                rows={11}
                style={{
                  width: '100%',
                  border: 'none',
                  outline: 'none',
                  fontSize: '14px',
                  lineHeight: '1.7',
                  color: '#2d3748',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  background: 'transparent'
                }}
              />
            </div>

            {/* Attached Resume Banner (Light Teal Box) */}
            <div
              style={{
                margin: '0 24px 24px',
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: '14px',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '14px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: '#d1fae5', color: '#047857', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <FileText size={20} />
                </div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: '#064e3b', lineHeight: '1.4' }}>
                  Your latest profile resume will be automatically attached as a PDF to all outgoing emails.
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => navigate('/dashboard/resume')}
                  style={{
                    background: '#ffffff',
                    border: '1.5px solid #059669',
                    color: '#047857',
                    padding: '7px 14px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: '800',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer'
                  }}
                >
                  <Eye size={14} />
                  <span>{resumeDisplayName}</span>
                </button>

                <button
                  onClick={() => navigate('/dashboard/resume')}
                  style={{
                    background: '#ffffff',
                    border: '1.5px solid #059669',
                    color: '#047857',
                    padding: '7px 14px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: '800',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer'
                  }}
                >
                  <Upload size={14} />
                  <span>Upload New Resume</span>
                </button>
              </div>
            </div>
          </div>

          {/* Target Company Employees Selection (Extracted from Admin PDF/database & Auto-Discovery) */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '24px', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '4px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: '800', color: '#1a202c', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserCheck size={18} style={{ color: '#059669' }} /> Target Employee Outreach Contacts ({selectedEmployees.length} selected)
              </h3>
              <button
                onClick={handleDiscoverContacts}
                disabled={isDiscovering || employeesLoading}
                style={{
                  background: isDiscovering ? '#f1f5f9' : '#ecfdf5',
                  color: isDiscovering ? '#64748b' : '#059669',
                  border: '1px solid #a7f3d0',
                  borderRadius: '20px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: '700',
                  cursor: isDiscovering ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s'
                }}
              >
                <Sparkles size={13} />
                {isDiscovering ? 'Discovering Contacts...' : 'Auto-Discover Contacts'}
              </button>
            </div>
            <p style={{ fontSize: '12.5px', color: '#718096', margin: '0 0 16px' }}>
              Extracted from verified employee records for <strong>{job.company}</strong>. Each employee will receive a personalized version of your referral request.
            </p>

            {contactAccess && contactAccess.locked > 0 && (
              <div style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px',
                padding: '10px 14px', marginBottom: '14px', borderRadius: '12px',
                background: '#fffbeb', border: '1px solid #fde68a'
              }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#92400e' }}>
                  {contactAccess.discovered} employees discovered
                </span>
                <span style={{ fontSize: '11px', color: '#a16207' }}>·</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#047857' }}>
                  {contactAccess.unlocked} unlocked
                </span>
                <span style={{ fontSize: '11px', color: '#a16207' }}>·</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#b45309' }}>
                  {contactAccess.locked} additional locked
                </span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {employeesLoading || isDiscovering ? (
                <div style={{ padding: '16px 20px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', textAlign: 'center' }}>
                  <p style={{ fontSize: '13px', fontWeight: 700, color: '#15803d', margin: 0 }}>
                    🔍 Auto-discovering verified employee & recruiter contacts for {job.company} via Multi-Source Engine (Hunter.io / Mini-Hunter)...
                  </p>
                </div>
              ) : employeeList.length === 0 ? (
                <div style={{ padding: '20px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px', textAlign: 'center' }}>
                  <p style={{ fontSize: '14px', fontWeight: 700, color: '#64748b', margin: '0 0 6px' }}>No contacts found for {job.company}</p>
                  <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 12px' }}>
                    Click below to discover corporate employee contacts and verified recruiter inboxes automatically.
                  </p>
                  <button
                    onClick={handleDiscoverContacts}
                    style={{
                      background: 'linear-gradient(135deg, #059669, #047857)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '20px',
                      padding: '8px 20px',
                      fontSize: '13px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Sparkles size={14} /> Auto-Discover Contacts for {job.company}
                  </button>
                </div>
              ) : null}
              {employeeList.map((emp) => {
                if (emp.locked) {
                  return (
                    <div
                      key={emp.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        flexWrap: 'wrap',
                        padding: '12px 16px',
                        borderRadius: '12px',
                        border: '1px dashed #fcd34d',
                        background: 'linear-gradient(135deg, #fffdf5, #fffbeb)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                        <span style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#fef3c7', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                          <Lock size={15} style={{ color: '#b45309' }} />
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ fontSize: '14px', color: '#1a202c', display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                            <span style={{ filter: 'blur(3.5px)', userSelect: 'none' }}>{emp.name || 'Employee name'}</span>
                            <span style={{ fontSize: '9.5px', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', padding: '2px 7px', borderRadius: '999px' }}>
                              Premium
                            </span>
                          </strong>
                          <span style={{ fontSize: '12px', color: '#92400e', display: 'block', marginTop: '2px' }}>
                            {emp.role || 'Employee'} · <code style={{ filter: 'blur(3px)', userSelect: 'none' }}>{emp.email || '•••••@company.com'}</code>
                          </span>
                        </div>
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '3px 10px', borderRadius: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                        <Lock size={11} /> Locked
                      </span>
                    </div>
                  );
                }
                return (
                  <div
                    key={emp.id}
                    onClick={() => toggleEmployeeSelect(emp.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      borderRadius: '12px',
                      border: emp.selected ? '2px solid #059669' : '1px solid #e2e8f0',
                      background: emp.selected ? '#f0fdf4' : '#fafafa',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <input
                        type="checkbox"
                        checked={emp.selected}
                        onChange={() => { }}
                        style={{ width: '16px', height: '16px', accentColor: '#059669', cursor: 'pointer' }}
                      />
                      <div>
                        <strong style={{ fontSize: '14px', color: '#1a202c', display: 'block' }}>{emp.name}</strong>
                        <span style={{ fontSize: '12px', color: '#718096' }}>
                          {emp.role} · <code style={{ color: '#047857' }}>{emp.email}</code>
                          {emp.details && (
                            <span style={{ marginLeft: '8px', fontSize: '10.5px', color: '#059669', background: '#d1fae5', padding: '1px 6px', borderRadius: '4px', fontWeight: '600' }}>
                              {emp.details}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: '800', color: emp.selected ? '#047857' : '#9ca3af', background: emp.selected ? '#d1fae5' : '#f3f4f6', padding: '3px 10px', borderRadius: '12px' }}>
                      {emp.selected ? 'Selected' : 'Skipped'}
                    </span>
                  </div>
                );
              })}

              {lockedContacts.length > 0 && (
                <div style={{
                  marginTop: '4px',
                  padding: '18px 20px',
                  borderRadius: '14px',
                  border: '1px solid #fde68a',
                  background: 'linear-gradient(135deg, #fffbeb 0%, #fff7ed 100%)',
                  textAlign: 'center'
                }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '13.5px', fontWeight: 800, color: '#92400e' }}>
                    <Gem size={16} /> Unlock More Employee Contacts with Pro
                  </div>
                  <p style={{ margin: '7px auto 12px', maxWidth: '460px', fontSize: '12px', lineHeight: 1.6, color: '#a16207' }}>
                    Discover and unlock more eligible company employees and recruiters to expand your referral
                    opportunities and improve your chances of getting noticed.
                  </p>
                  <button
                    type="button"
                    onClick={unlockViaPro}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '7px',
                      padding: '9px 20px',
                      borderRadius: '999px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                      color: '#fff',
                      fontSize: '12.5px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '0 10px 24px rgba(217, 119, 6, 0.28)'
                    }}
                  >
                    <Gem size={14} /> Upgrade to Pro — Unlock More Contacts
                  </button>
                  <p style={{ margin: '9px 0 0', fontSize: '10.5px', color: '#b45309' }}>
                    {lockedContacts.length} more contact{lockedContacts.length === 1 ? '' : 's'} available on Pro. Pro improves your chances — it never guarantees a referral or an offer.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* HAMZOOH Agent Banner & Configuration Box */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#319795', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '14px' }}>
                🤖
              </div>
              <strong style={{ fontSize: '14.5px', color: '#1a202c' }}>
                HAMZOOH Agent will reach out to {selectedEmployees.length} employees at {job.company}
              </strong>
            </div>

            <div style={{ background: '#e6fffa', border: '1px solid #b2f5ea', borderRadius: '12px', padding: '14px 16px', fontSize: '12.5px', color: '#234e52', lineHeight: '1.5' }}>
              ℹ️ If you confirm and send, your updated message will be saved as your default outreach template. You can edit it anytime from <span style={{ fontWeight: '800', textDecoration: 'underline', cursor: 'pointer' }}>HAMZOOH Agent configuration</span> in your dashboard.
            </div>
          </div>

          {/* Auto-Reply Checkbox Bar */}
          <div
            style={{
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              borderRadius: '12px',
              padding: '14px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px'
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px', fontWeight: '700', color: '#064e3b', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoReplyEnabled}
                onChange={e => setAutoReplyEnabled(e.target.checked)}
                style={{ width: '17px', height: '17px', accentColor: '#059669', cursor: 'pointer' }}
              />
              <span>Let HAMZOOH automatically reply to referrer emails</span>
            </label>

            <span
              onClick={() => navigate('/dashboard/mail')}
              style={{ fontSize: '12.5px', fontWeight: '800', color: '#047857', textDecoration: 'underline', cursor: 'pointer' }}
            >
              Review auto-reply categories →
            </span>
          </div>

          {/* Success Banner if Sent */}
          {sendSuccess && (
            <div style={{ padding: '18px 24px', background: '#d1fae5', border: '1px solid #34d399', borderRadius: '14px', color: '#065f46', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontWeight: '800', fontSize: '14px' }}>
                <CheckCircle2 size={22} style={{ flexShrink: 0 }} />
                <div>
                  <div>
                    {referralRecipients.length
                      ? `All referral emails sent successfully to ${referralRecipients.length} ${referralRecipients.length === 1 ? 'contact' : 'contacts'}: ${referralRecipients.join(', ')}`
                      : 'All referral emails sent successfully with your PDF resume attached.'}
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#047857', marginTop: '3px' }}>
                    This step is complete for this job — you don't need to send it again.
                  </div>
                </div>
              </div>
              <button
                className="btn-ghost"
                onClick={() => navigate('/dashboard/mail')}
                style={{ color: '#065f46', borderColor: '#059669', fontWeight: '800', fontSize: '12px' }}
              >
                View Sent Mails
              </button>
            </div>
          )}

          {/* Connected Gmail Account Indicator */}
          {gmailConnected && !gmailAuthError && (
            <div style={{ padding: '12px 18px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '14px', color: '#166534', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', fontSize: '13px', fontWeight: '600' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }}></span>
                <span>Referral emails will be sent from your connected account: <strong>{connectedGmailEmail || userEmail}</strong></span>
              </div>
              <span style={{ fontSize: '11.5px', color: '#15803d', fontWeight: '800', background: '#dcfce7', padding: '3px 8px', borderRadius: '6px' }}>Gmail API Active</span>
            </div>
          )}

          {/* Inline Error Banner if Gmail Not Connected */}
          {gmailAuthError && (
            <div style={{ padding: '16px 22px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '14px', color: '#991b1b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
              <div style={{ fontSize: '13.5px', fontWeight: '700', flex: 1 }}>
                ⚠️ {typeof gmailAuthError === 'string' ? gmailAuthError : 'Please connect your Google Mail account under Mail Automation first.'}
              </div>
              <button
                className="btn-accent"
                onClick={() => navigate('/dashboard/mail')}
                style={{ background: '#dc2626', borderColor: '#dc2626', fontWeight: '800', fontSize: '12.5px', padding: '8px 16px', borderRadius: '8px' }}
              >
                Connect Gmail in Mail Automation →
              </button>
            </div>
          )}

          {/* Bottom Action Bar (Back Circle + CONFIRM & SEND Pill Button + NEXT Button) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px', paddingTop: '16px' }}>
            <button
              onClick={() => navigate(-1)}
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '50%',
                border: '1px solid #cbd5e0',
                background: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#2d3748',
                boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
              }}
              title="Go Back"
            >
              <ArrowLeft size={18} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {sendSuccess ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: '#ecfdf5',
                    border: '1px solid #a7f3d0',
                    color: '#047857',
                    borderRadius: '30px',
                    padding: '12px 24px',
                    fontSize: '12.5px',
                    fontWeight: '900',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                  }}
                >
                  <CheckCircle2 size={16} /> All Referral Emails Sent
                </span>
              ) : (
                <button
                  onClick={handleConfirmAndSend}
                  disabled={sendingAll || selectedEmployees.length === 0}
                  style={{
                    background: (sendingAll || selectedEmployees.length === 0) ? '#94a3b8' : '#18181b',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '30px',
                    padding: '14px 34px',
                    fontSize: '13px',
                    fontWeight: '900',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: (sendingAll || selectedEmployees.length === 0) ? 'not-allowed' : 'pointer',
                    opacity: (sendingAll || selectedEmployees.length === 0) ? 0.6 : 1,
                    boxShadow: (sendingAll || selectedEmployees.length === 0) ? 'none' : '0 8px 24px rgba(0,0,0,0.2)',
                    transition: 'all 0.2s'
                  }}
                >
                  <span>{sendingAll ? 'Sending Outreach...' : 'CONFIRM & SEND'}</span>
                  <ArrowRight size={16} />
                </button>
              )}

              <button
                onClick={() => setActiveTab('linkedin')}
                style={{
                  background: '#ffffff',
                  color: '#445cf5',
                  border: '2px solid #445cf5',
                  borderRadius: '30px',
                  padding: '14px 28px',
                  fontSize: '13px',
                  fontWeight: '900',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(68, 92, 245, 0.12)',
                  transition: 'all 0.2s'
                }}
                title="Go to 2. Connect on LinkedIn"
              >
                <span>NEXT</span>
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

        </div>
      )}

      {/* TAB CONTENT 2: Connect on LinkedIn with Note */}
      {activeTab === 'linkedin' && (
        <div style={{ background: '#ffffff', border: '1px solid #e5e5e0', borderRadius: '16px', padding: '28px', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
          <div style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#171817', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Linkedin style={{ color: '#0077b5' }} size={20} /> Step 3: Connect on LinkedIn with a Personal Note
            </h2>
            <p style={{ fontSize: '13.5px', color: '#555852', margin: 0, lineHeight: '1.5' }}>
              Connect directly with hiring managers & recruiters at <strong>{job.company}</strong> on LinkedIn using automated outreach campaigns.
            </p>
          </div>

          {/* LinkedIn Connection Status Check */}
          {liChecking ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ width: '40px', height: '40px', border: '3px solid #e2e8f0', borderTop: '3px solid #0077b5', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
              <p style={{ color: '#718096', fontSize: '14px', margin: 0 }}>Checking LinkedIn connection...</p>
            </div>
          ) : !liConnected ? (
            /* NOT CONNECTED — Show Connect Prompt or Connecting State */
            <div style={{
              background: 'linear-gradient(135deg, #f0f7ff 0%, #e8f4fd 100%)',
              border: `2px dashed ${liConnecting ? '#f59e0b' : '#0077b5'}`,
              borderRadius: '16px',
              padding: '40px 32px',
              textAlign: 'center'
            }}>
              <div style={{
                width: '72px', height: '72px', borderRadius: '50%',
                background: liConnecting ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #0077b5, #005885)',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 20px', boxShadow: liConnecting ? '0 8px 24px rgba(245, 158, 11, 0.3)' : '0 8px 24px rgba(0, 119, 181, 0.25)'
              }}>
                {liConnecting ? (
                  <div style={{ width: '36px', height: '36px', border: '3px solid rgba(255,255,255,0.3)', borderTop: '3px solid #fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Linkedin size={36} />
                )}
              </div>

              {liConnecting ? (
                /* CONNECTING STATE — Chrome login window is open */
                <>
                  <h3 style={{ fontSize: '20px', fontWeight: '800', color: '#1a202c', margin: '0 0 8px' }}>
                    🌐 LinkedIn Login Window Opened
                  </h3>
                  <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 8px', maxWidth: '460px', marginLeft: 'auto', marginRight: 'auto', lineHeight: '1.6' }}>
                    A Chrome browser window has opened for LinkedIn login. Please log in with your LinkedIn credentials <strong>(2FA supported)</strong>.
                  </p>
                  <p style={{ fontSize: '13px', color: '#0077b5', fontWeight: '700', margin: '0 0 20px' }}>
                    ⏳ Waiting for login completion... this page will auto-update once connected.
                  </p>
                  <button
                    onClick={handleLiCancelConnect}
                    style={{
                      background: '#ffffff',
                      color: '#dc2626',
                      border: '2px solid #fecaca',
                      borderRadius: '30px',
                      padding: '12px 28px',
                      fontSize: '14px',
                      fontWeight: '700',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    <X size={16} /> Cancel
                  </button>
                </>
              ) : (
                /* NOT CONNECTING — Show Connect Button */
                <>
                  <h3 style={{ fontSize: '20px', fontWeight: '800', color: '#1a202c', margin: '0 0 8px' }}>
                    Please connect your LinkedIn
                  </h3>
                  <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 24px', maxWidth: '460px', marginLeft: 'auto', marginRight: 'auto', lineHeight: '1.6' }}>
                    To launch automated LinkedIn outreach campaigns for <strong>{job.company}</strong>, you need to connect your LinkedIn account first. This allows HAMZOOH to send personalized connection requests to recruiters and hiring managers on your behalf.
                  </p>
                  <button
                    onClick={handleLiConnect}
                    disabled={!liServerOnline}
                    style={{
                      background: liServerOnline ? 'linear-gradient(135deg, #0077b5, #005885)' : '#94a3b8',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '30px',
                      padding: '16px 36px',
                      fontSize: '15px',
                      fontWeight: '800',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: liServerOnline ? 'pointer' : 'not-allowed',
                      boxShadow: liServerOnline ? '0 8px 28px rgba(0, 119, 181, 0.3)' : 'none',
                      transition: 'all 0.2s',
                      letterSpacing: '0.02em',
                      opacity: liServerOnline ? 1 : 0.6
                    }}
                  >
                    <Linkedin size={18} /> Click here to connect your LinkedIn
                  </button>
                  {!liServerOnline && (
                    <p style={{ fontSize: '12px', color: '#dc2626', marginTop: '16px', fontWeight: '600' }}>
                      ⚠️ LinkedIn automation server is offline. Please start the backend first.
                    </p>
                  )}
                  {liConnectError && (
                    <p style={{ fontSize: '13px', color: '#dc2626', marginTop: '16px', fontWeight: '600', maxWidth: '460px', marginLeft: 'auto', marginRight: 'auto' }}>
                      ⚠️ {liConnectError}
                    </p>
                  )}
                </>
              )}
            </div>
          ) : (
            /* CONNECTED — Show Campaign Launcher */
            <div>
              {/* Connected Badge */}
              <div style={{
                background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '12px',
                padding: '14px 20px', marginBottom: '20px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <CheckCircle2 size={20} style={{ color: '#059669' }} />
                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#064e3b' }}>
                    LinkedIn connected as <strong>{liAccount?.memberName || 'LinkedIn Member'}</strong>
                  </span>
                </div>
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#059669', background: '#d1fae5', padding: '4px 12px', borderRadius: '20px' }}>
                  ✓ Connected
                </span>
              </div>

              {/* Campaign Launcher Card */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '24px', background: '#fafafa' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#1a202c', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Target size={18} /> Campaign Launcher
                  </h3>
                  <span style={{
                    fontSize: '11px', fontWeight: '700',
                    color: liIsRunning ? '#059669' : '#64748b',
                    background: liIsRunning ? '#d1fae5' : '#f1f5f9',
                    padding: '4px 12px', borderRadius: '20px'
                  }}>
                    {liIsRunning ? 'Running' : 'Idle'}
                  </span>
                </div>

                {/* Target Company */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>
                    Target Company
                  </label>
                  <input
                    value={liCompany}
                    onChange={(e) => setLiCompany(e.target.value)}
                    placeholder="e.g. Google, Microsoft, Meta or LinkedIn URL"
                    disabled={liIsRunning}
                    style={{
                      width: '100%', padding: '12px 16px', border: '1px solid #e2e8f0',
                      borderRadius: '10px', fontSize: '14px', color: '#1a202c',
                      background: '#ffffff', outline: 'none', fontFamily: 'inherit'
                    }}
                  />
                </div>

                {/* Target Job Role — drives every referral message */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>
                    Target Job Role <em style={{ fontWeight: '400', textTransform: 'none', color: '#94a3b8' }}>every message is written for this role</em>
                  </label>
                  <input
                    value={liJobRole}
                    onChange={(e) => setLiJobRole(e.target.value)}
                    placeholder="e.g. Software Engineer, Data Analyst"
                    disabled={liIsRunning}
                    style={{
                      width: '100%', padding: '12px 16px', border: '1px solid #e2e8f0',
                      borderRadius: '10px', fontSize: '14px', color: '#1a202c',
                      background: '#ffffff', outline: 'none', fontFamily: 'inherit'
                    }}
                  />
                </div>

                {/* Role Filters */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>
                    Role Filters
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                    {liRoles.map((r) => (
                      <span key={r} style={{
                        background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0',
                        borderRadius: '20px', padding: '6px 14px', fontSize: '13px', fontWeight: '700',
                        display: 'inline-flex', alignItems: 'center', gap: '6px'
                      }}>
                        {r}
                        {!liIsRunning && (
                          <button onClick={() => setLiRoles(liRoles.filter((x) => x !== r))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#059669', display: 'flex' }}>
                            <X size={12} />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                  {!liIsRunning && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        value={liNewRole}
                        onChange={(e) => setLiNewRole(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && liAddRole()}
                        placeholder="Add role (e.g. Engineering Manager)"
                        style={{
                          flex: 1, padding: '10px 14px', border: '1px solid #e2e8f0',
                          borderRadius: '10px', fontSize: '13px', outline: 'none', fontFamily: 'inherit'
                        }}
                      />
                      <button onClick={liAddRole} style={{
                        background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px',
                        padding: '10px 16px', fontSize: '13px', fontWeight: '700', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '4px', color: '#1a202c'
                      }}>
                        <Plus size={14} /> Add
                      </button>
                    </div>
                  )}
                </div>

                {/* Connections / Role + AI Notes */}
                <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '160px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '4px' }}>
                      Messages to Network
                    </label>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '6px', lineHeight: '1.2' }}>
                      Existing connections at {job?.company || 'company'}
                    </div>
                    <input
                      type="number" min="1" max="40" value={liReferralTarget}
                      onChange={(e) => setLiReferralTarget(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
                      disabled={liIsRunning}
                      style={{
                        width: '100%', padding: '12px 16px', border: '1px solid #e2e8f0',
                        borderRadius: '10px', fontSize: '14px', outline: 'none', fontFamily: 'inherit'
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: '160px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '4px' }}>
                      New Connection Requests / Role
                    </label>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '6px', lineHeight: '1.2' }}>
                      Invites sent per role filter
                    </div>
                    <input
                      type="number" min="1" max="40" value={liPerRole}
                      onChange={(e) => setLiPerRole(Number(e.target.value) || 10)}
                      disabled={liIsRunning}
                      style={{
                        width: '100%', padding: '12px 16px', border: '1px solid #e2e8f0',
                        borderRadius: '10px', fontSize: '14px', outline: 'none', fontFamily: 'inherit'
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: '160px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '4px' }}>
                      Watch Automation
                    </label>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '6px', lineHeight: '1.2' }}>
                      {liWatchLive ? 'Live browser window opens' : 'Runs silently in background'}
                    </div>
                    <button
                      onClick={() => setLiWatchLive(!liWatchLive)}
                      disabled={liIsRunning}
                      style={{
                        width: '100%', padding: '12px 16px',
                        border: liWatchLive ? '1.5px solid #16a34a' : '1px solid #e2e8f0',
                        borderRadius: '10px', fontSize: '13px', fontWeight: '700',
                        background: liWatchLive ? '#f0fdf4' : '#ffffff',
                        color: liWatchLive ? '#15803d' : '#64748b',
                        cursor: liIsRunning ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                      }}
                    >
                      {liWatchLive ? <Eye size={14} /> : <EyeOff size={14} />}
                      {liWatchLive ? 'Enabled (Watch Live)' : 'Disabled (Background)'}
                    </button>
                  </div>
                </div>

                {/* Custom Note Template */}
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>
                    Custom Note Template <em style={{ fontWeight: '400', textTransform: 'none' }}>({liUseAI ? 'optional — used as fallback' : 'used for everyone'})</em>
                  </label>
                  <textarea
                    rows={3}
                    value={liNote}
                    onChange={(e) => setLiNote(e.target.value)}
                    placeholder={`Hi {name}, I'd love to connect and learn more about opportunities at your company!`}
                    disabled={liIsRunning}
                    style={{
                      width: '100%', padding: '12px 16px', border: '1px solid #e2e8f0',
                      borderRadius: '10px', fontSize: '13px', lineHeight: '1.6',
                      outline: 'none', fontFamily: 'inherit', resize: 'vertical'
                    }}
                  />
                </div>

                {/* Campaign Message */}
                {liCampaignMsg && (
                  <div style={{
                    padding: '12px 16px', borderRadius: '10px', marginBottom: '16px',
                    background: liCampaignMsg.type === 'err' ? '#fef2f2' : '#ecfdf5',
                    color: liCampaignMsg.type === 'err' ? '#991b1b' : '#064e3b',
                    border: `1px solid ${liCampaignMsg.type === 'err' ? '#fecaca' : '#a7f3d0'}`,
                    fontSize: '13px', fontWeight: '700'
                  }}>
                    {liCampaignMsg.msg}
                  </div>
                )}

                {/* Start / Stop Button */}
                <div>
                  {liIsRunning ? (
                    <button
                      onClick={handleLiStopCampaign}
                      style={{
                        width: '100%', padding: '16px', background: '#dc2626', color: '#fff',
                        border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: '800',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                      }}
                    >
                      <Square size={16} /> Stop Campaign
                    </button>
                  ) : (
                    <button
                      onClick={handleLiStartCampaign}
                      disabled={liStarting}
                      style={{
                        width: '100%', padding: '16px',
                        background: '#18181b', color: '#fff',
                        border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: '800',
                        cursor: liStarting ? 'wait' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.15)'
                      }}
                    >
                      <Play size={16} /> {liStarting ? 'Starting...' : 'Start Campaign'}
                    </button>
                  )}
                </div>

                {/* Live stage progress + activity log for this job's campaign */}
                <div style={{ marginTop: '18px' }}>
                  <CampaignStatus
                    variant="full"
                    showLog
                    defaultOpenLog
                    campaignId={liCampaign?.id || ''}
                    company={job?.company || liCompany}
                    filterByCompany
                    watchLive={liWatchLive}
                    onChange={(next) => {
                      setLiCampaign(next);
                      const live = next && ['running', 'queued', 'waiting'].includes(next.status);
                      setLiIsRunning(Boolean(live));
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Bottom Action Bar for LinkedIn Tab */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #e8e8e3' }}>
            <button
              onClick={() => setActiveTab('referral')}
              style={{
                background: '#ffffff',
                color: '#64748b',
                border: '1px solid #cbd5e0',
                borderRadius: '30px',
                padding: '12px 24px',
                fontSize: '13px',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer'
              }}
            >
              <ArrowLeft size={16} /> Back to Referral Email
            </button>

            <button
              onClick={() => setActiveTab('apply')}
              style={{
                background: '#445cf5',
                color: '#ffffff',
                border: 'none',
                borderRadius: '30px',
                padding: '12px 28px',
                fontSize: '13px',
                fontWeight: '800',
                letterSpacing: '0.04em',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(68, 92, 245, 0.2)'
              }}
            >
              <span>Next: Direct Apply</span>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* STAGE 1: Tailor Resume + resume report */}
      {activeTab === 'tailor' && (
        <div style={{ background: '#ffffff', border: '1px solid #e5e5e0', borderRadius: '16px', padding: '28px', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
          <div style={{ marginBottom: '22px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#eef2ff', color: '#3730a3', fontSize: '10.5px', fontWeight: '800', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 10px', borderRadius: '20px', marginBottom: '10px' }}>
              <Sparkles size={12} /> Step 1 · Tailor
            </span>
            <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#171817', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles style={{ color: '#445cf5' }} size={20} /> Tailor Your Resume to This Job
            </h2>
            <p style={{ fontSize: '13.5px', color: '#555852', margin: 0, lineHeight: '1.5' }}>
              Optimize your resume keywords for ATS scanners and align it with the exact requirements of <strong>{job.title}</strong> at <strong>{job.company}</strong>. Your tailored resume is used in the next steps.
            </p>
          </div>

          {/* Tailor action box */}
          {!tailorResult ? (
            <div style={{ border: '2px dashed #445cf5', borderRadius: '14px', padding: '22px 24px', textAlign: 'center', background: '#f8f9ff', marginBottom: '20px' }}>
              <Sparkles size={30} style={{ color: '#445cf5', marginBottom: '8px' }} />
              <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#171817', margin: '0 0 6px' }}>
                Tailor Resume for {job.title}
              </h3>
              <p style={{ fontSize: '13px', color: '#555852', maxWidth: '560px', margin: '0 auto 14px' }}>
                Click below to re-align your resume highlights with the job description and cover more of its keywords.
              </p>
              <button
                className="btn-accent"
                onClick={handleTailorResume}
                disabled={isTailoring}
                style={{ padding: '11px 22px', fontSize: '13.5px', gap: '8px' }}
              >
                {isTailoring ? <RefreshCw size={16} className="spin" /> : <Sparkles size={16} />}
                {isTailoring ? 'Optimizing Resume...' : 'Tailor Resume Now'}
              </button>
            </div>
          ) : (
            <div style={{ border: '1px solid #dcefdf', borderRadius: '14px', background: '#ffffff', marginBottom: '20px', overflow: 'hidden', boxShadow: '0 1px 2px rgba(16, 24, 40, 0.04)' }}>
              {/* Status header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '15px 20px', background: '#f4fbf5', borderBottom: '1px solid #e6f3e9' }}>
                <span style={{ width: '34px', height: '34px', borderRadius: '10px', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <CheckCircle2 size={19} style={{ color: '#059669' }} />
                </span>
                <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                  <div style={{ fontSize: '14.5px', fontWeight: '800', color: '#14532d', lineHeight: 1.3 }}>
                    Resume tailored &amp; optimized
                  </div>
                  <div style={{ fontSize: '12.5px', color: '#4f6b57', lineHeight: 1.45, marginTop: '2px' }}>
                    Aligned with {job.company}'s job keywords. Review the report below, then continue to the referral email.
                  </div>
                </div>
                {totalKeywords ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#ffffff', border: '1px solid #cdebd6', borderRadius: '999px', padding: '5px 12px', fontSize: '11.5px', fontWeight: '700', color: '#15803d', whiteSpace: 'nowrap' }}>
                    <Target size={12} /> {matchedCount}/{totalKeywords} keywords
                  </span>
                ) : null}
              </div>

              {/* Actions, grouped by what they act on */}
              <div style={{ padding: '14px 20px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span style={tailorGroupLabel}>Resume</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', flex: '1 1 260px' }}>
                    <button className="btn-accent" onClick={handleDownloadTailored} style={tailorActionBtn}>
                      <Download size={15} /> Download PDF
                    </button>
                    <button className="btn-ghost" onClick={handleViewTailored} style={tailorActionBtn}>
                      <Eye size={15} /> View
                    </button>
                    <button className="btn-ghost" onClick={() => setEditorState({ formatId, format: chosenFormat })} style={tailorActionBtn}>
                      <Pencil size={15} /> Edit
                    </button>
                    <button className="btn-ghost" onClick={handleTailorResume} disabled={isTailoring} style={tailorRowEndBtn}>
                      {isTailoring ? <RefreshCw size={15} className="spin" /> : <Sparkles size={15} />}
                      {isTailoring ? 'Re-tailoring...' : 'Re-tailor'}
                    </button>
                  </div>
                </div>

                <div style={{ height: '1px', background: '#eef2ee', margin: '12px 0' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span style={tailorGroupLabel}>Cover letter</span>
                  {coverLetter ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', flex: '1 1 260px' }}>
                      <button
                        className="btn-accent"
                        onClick={handleDownloadCoverLetter}
                        disabled={isDownloadingCoverLetter}
                        title="Download this cover letter as a PDF"
                        style={tailorActionBtn}
                      >
                        {isDownloadingCoverLetter ? <RefreshCw size={15} className="spin" /> : <Download size={15} />} Download PDF
                      </button>
                      <button className="btn-ghost" onClick={handleViewCoverLetter} title="Open the cover letter PDF in a new tab" style={tailorActionBtn}>
                        <Eye size={15} /> View
                      </button>
                      <button className="btn-ghost" onClick={() => { setCoverLetterModalMode('edit'); setShowCoverLetterModal(true); }} title="Edit the cover letter text" style={tailorActionBtn}>
                        <Pencil size={15} /> Edit
                      </button>
                      <button
                        className="btn-ghost"
                        onClick={handleGenerateCoverLetter}
                        disabled={isGeneratingCoverLetter}
                        title="Generate a fresh cover letter for this role"
                        style={tailorRowEndBtn}
                      >
                        {isGeneratingCoverLetter ? <RefreshCw size={15} className="spin" /> : <FileText size={15} />}
                        {isGeneratingCoverLetter ? 'Regenerating...' : 'Regenerate'}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <button
                        className="btn-ghost"
                        onClick={handleGenerateCoverLetter}
                        disabled={isGeneratingCoverLetter}
                        title="Generate a 1-page tailored cover letter for this role"
                        style={{ ...tailorActionBtn, color: '#4338ca', borderColor: '#c7d2fe', background: '#f5f3ff' }}
                      >
                        {isGeneratingCoverLetter ? <RefreshCw size={15} className="spin" /> : <FileText size={15} />}
                        {isGeneratingCoverLetter ? 'Generating cover letter...' : 'Generate cover letter'}
                      </button>
                      <span style={{ fontSize: '11.5px', color: '#8a8f88' }}>1 page, written for this role</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tailorError && (
            <div role="alert" style={{ marginBottom: '20px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', color: '#991b1b', fontSize: '12.5px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={15} /> {tailorError}
            </div>
          )}

          {tailorResult && (
            <>
              {/* One score: the job match (profile + resume + JD). Keyword
                  coverage is a resume metric and is shown as counts only. */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '4px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: '800', color: '#171817', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Target size={17} style={{ color: '#445cf5' }} /> Resume Report
                </h3>
                <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: '600' }}>
                  {matchedCount}/{totalKeywords ?? '—'} job keywords covered after tailoring
                </span>
              </div>

              <div className="ats-comparison-card">
                <div className="ats-comparison-side">
                  <MatchScore
                    score={matchResult?.score ?? null}
                    status={matchResult?.status || 'incomplete'}
                    size="small"
                    missingLabels={matchResult?.missingProfileLabels || []}
                  />
                  <div>
                    <strong>Job match</strong>
                    <span>Profile + resume + job description</span>
                  </div>
                </div>
                <div className="ats-comparison-message">
                  {scoreDelta !== null && scoreDelta > 0 && <span className="ats-delta-badge">+{scoreDelta}</span>}
                  <p>{scoreLabel(beforeScore, afterScore)}</p>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>Resume keyword coverage</span>
                </div>
                <div className="ats-comparison-side improved" title={atsScoreResult.summary}>
                  <div>
                    <strong>ATS score</strong>
                    <span>{matchedCount}/{totalKeywords ?? '—'} job keywords · {resumeChecks.filter((check) => check.ok).length}/{resumeChecks.length} resume checks</span>
                  </div>
                  <div className="ats-score-ring after">
                    <svg width="74" height="74" viewBox="0 0 36 36">
                      <path stroke="#dbe3ee" strokeWidth="3.5" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                      <path stroke="#10b981" strokeWidth="3.5" strokeDasharray={`${atsScore}, 100`} strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    </svg>
                    <strong>{atsScore}%</strong>
                  </div>
                </div>
              </div>

              {/* Keyword summary pills */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '14px' }}>
                <div className="keyword-stat-pill stat-present">
                  <span className="keyword-stat-dot" style={{ background: '#10b981' }} />
                  Already Present: <strong>{reportPresent.length}</strong>
                </div>
                <div className="keyword-stat-pill stat-added">
                  <span className="keyword-stat-dot" style={{ background: '#4f46e5' }} />
                  Newly Added: <strong>{reportAdded.length}</strong>
                </div>
                {reportPartial.length > 0 && (
                  <div className="keyword-stat-pill">
                    <span className="keyword-stat-dot" style={{ background: '#f59e0b' }} />
                    Partial: <strong>{reportPartial.length}</strong>
                  </div>
                )}
                {reportRemoved.length > 0 && (
                  <div className="keyword-stat-pill stat-removed">
                    <span className="keyword-stat-dot" style={{ background: '#94a3b8' }} />
                    Removed: <strong>{reportRemoved.length}</strong>
                  </div>
                )}
                {reportMissing.length > 0 && (
                  <div className="keyword-stat-pill stat-missing">
                    <span className="keyword-stat-dot" style={{ background: '#ef4444' }} />
                    Missing: <strong>{reportMissing.length}</strong>
                  </div>
                )}
                <div className="keyword-stat-pill stat-total">
                  <Target size={12} color="#4f46e5" />
                  Total: <strong>{totalKeywords ?? 'N/A'}</strong>
                </div>
              </div>

              <div className="apply-report-grid" style={{ marginTop: '18px' }}>
                {/* Left: keyword audit */}
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '14px', padding: '18px', background: '#fff' }}>
                  <h4 style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: '800', color: '#0f172a' }}>Keyword Analysis</h4>
                  <p style={{ margin: '0 0 12px', fontSize: '11.5px', color: '#64748b', lineHeight: 1.45 }}>
                    Which job-description keywords were already present, newly added, removed, or still missing after tailoring.
                  </p>
                  {!keywordRows.length ? (
                    <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>No keyword audit was returned for this job.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '320px', overflowY: 'auto', paddingRight: '2px' }}>
                      {keywordRows.map(({ keyword, status, tagIcon }) => (
                        <div key={keyword} className={`keyword-row-enhanced keyword-row-${status.toLowerCase().replace(/\s+/g, '-')}`}>
                          <span className="keyword-name">{keyword}</span>
                          <span className={`keyword-status-badge status-${status.toLowerCase().replace(/\s+/g, '-')}`}>
                            {tagIcon} {status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {ats.details && (
                    <p style={{ margin: '10px 0 0', fontSize: '11px', color: '#94a3b8', lineHeight: 1.4 }}>{ats.details}</p>
                  )}
                </div>

                {/* Right: what the tailored PDF still needs, plus the layout
                    that Preview / Edit / Download use. */}
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '14px', padding: '18px', background: '#fff', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <h4 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: '800', color: '#0f172a' }}>Resume check</h4>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.45 }}>
                      What the tailored version still needs before it goes out. Fix the amber items with Edit.
                    </p>
                  </div>

                  {tailorResult?.formats?.length > 1 && (
                    <div>
                      <div style={{ fontSize: '10.5px', fontWeight: '800', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: '6px' }}>
                        Layout
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {tailorResult.formats.map((format) => {
                          const isActive = format.id === (chosenFormat?.id || 'recommended');
                          return (
                            <button
                              key={format.id}
                              type="button"
                              onClick={() => setFormatId(format.id)}
                              title={`Preview, edit and download the ${format.name} layout`}
                              style={{
                                padding: '6px 11px',
                                borderRadius: '8px',
                                fontSize: '11.5px',
                                fontWeight: '800',
                                cursor: 'pointer',
                                border: isActive ? '1px solid #445cf5' : '1px solid #e2e8f0',
                                background: isActive ? '#eef2ff' : '#fff',
                                color: isActive ? '#3730a3' : '#475569',
                              }}
                            >
                              {format.name}
                            </button>
                          );
                        })}
                      </div>
                      <p style={{ margin: '6px 0 0', fontSize: '10.5px', color: '#94a3b8' }}>
                        Preview, edit and download use the selected layout.
                      </p>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                    {resumeChecks.map((check) => (
                      <div key={check.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '7px' }}>
                        {check.ok
                          ? <CheckCircle2 size={14} style={{ color: '#059669', flexShrink: 0, marginTop: 1 }} />
                          : <AlertCircle size={14} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '12px', fontWeight: '700', color: check.ok ? '#334155' : '#92400e' }}>
                            {check.label}
                          </div>
                          {!check.ok && check.hint && (
                            <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.45, marginTop: '1px' }}>
                              {check.hint}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px dashed #e2e8f0', fontSize: '11px', color: failedChecks.length ? '#92400e' : '#047857', fontWeight: '700', lineHeight: 1.5 }}>
                    {failedChecks.length
                      ? `${failedChecks.length} item${failedChecks.length === 1 ? '' : 's'} to fix — edit the resume, then download the PDF again.`
                      : 'Everything checks out — this PDF is ready to attach.'}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Stage navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #e8e8e3' }}>
            <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', maxWidth: '420px', lineHeight: 1.45 }}>
              {tailorResult ? 'Your tailored resume will be attached to referral emails in the next step.' : 'Tailoring is recommended before outreach so recruiters see the most relevant resume.'}
            </p>
            <button
              type="button"
              onClick={() => setActiveTab('referral')}
              style={{ background: '#445cf5', color: '#fff', border: 'none', borderRadius: '30px', padding: '12px 26px', fontSize: '13px', fontWeight: '800', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', boxShadow: '0 4px 14px rgba(68, 92, 245, 0.2)' }}
            >
              <span>Continue to Referral Email</span>
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      )}

      {/* Resume rich-text editor (view/edit tailored resume) */}
      {editorState && (
        <ResumeRichEditor
          plainText={editorState.format?.editedPlainText || editorState.format?.plainText || tailorResult?.plainText || ''}
          initialHtml={editorState.format?.editedHtml || editorState.format?.editableHtml || tailorResult?.editableHtml || ''}
          onClose={() => setEditorState(null)}
          onSave={({ html, text }) => {
            setTailorResult(previous => previous ? {
              ...previous,
              plainText: text,
              formats: (previous.formats || []).map(format => format.id === editorState.formatId
                ? { ...format, editedHtml: html, editedPlainText: text }
                : format),
            } : previous);
            setEditorState(null);
          }}
        />
      )}

      {/* 1-Page Tailored Cover Letter Modal (View & Edit matching reference template) */}
      <CoverLetterModal
        isOpen={showCoverLetterModal}
        mode={coverLetterModalMode}
        coverLetter={coverLetter}
        jobTitle={job?.title}
        company={job?.company}
        onClose={() => setShowCoverLetterModal(false)}
        onSave={(updated) => {
          setCoverLetter(updated);
          coverLetterStore.save(jobId, updated);
        }}
        onRegenerate={handleGenerateCoverLetter}
        isRegenerating={isGeneratingCoverLetter}
      />

      {/* STAGE 4: Direct Apply */}
      {activeTab === 'apply' && (
        <div style={{ background: '#ffffff', border: '1px solid #e5e5e0', borderRadius: '16px', padding: '28px', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
          <div style={{ marginBottom: '22px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#ecfdf5', color: '#047857', fontSize: '10.5px', fontWeight: '800', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 10px', borderRadius: '20px', marginBottom: '10px' }}>
              <Zap size={12} /> Step 4 · Direct Apply
            </span>
            <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#171817', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap style={{ color: '#22a65b' }} size={20} /> Direct Apply with Your Tailored Resume
            </h2>
            <p style={{ fontSize: '13.5px', color: '#555852', margin: 0, lineHeight: '1.5' }}>
              Open the application for <strong>{job.title}</strong> at <strong>{job.company}</strong>, fill the form with your profile, and review before submitting.
            </p>
          </div>

          {/* Auto-apply console: the run surface lives right here, not in a popup */}
          <div ref={autoConsoleRef} style={{ border: '1px solid #e5e5e0', borderRadius: '16px', overflow: 'hidden', marginBottom: '18px', background: '#ffffff' }}>
            {showAutoApplyModal ? (
              <>
            {/* Console header: light surface, status tinted */}
            {(() => {
              const header = autoConsoleHeader({ task: autoTask, applying: autoApplying, result: autoApplyResult });
              const title = autoTask?.status === 'waiting_for_approval' ? 'Review & approve the application'
                : autoTask?.status === 'waiting_for_user_input' ? 'One answer needed to continue'
                  : autoTask?.status === 'paused' ? 'Application paused'
                    : autoTask?.status === 'submitted' ? 'Application submitted'
                      : autoTask?.status === 'cancelled' ? 'Application cancelled'
                        : autoTask?.status === 'failed' ? 'Auto apply stopped'
                          : autoApplying ? 'Auto-applying with AI'
                            : autoApplyResult?.status === 'submitted' ? 'Application submitted'
                              : autoApplyResult?.status === 'needs_attention' ? 'Needs your attention'
                                : 'Auto apply stopped';
              const good = header.fg === '#047857';
              return (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                  padding: '13px 16px', borderBottom: '1px solid #ecece7', background: '#fcfcfa',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '11px', minWidth: 0 }}>
                    <span style={{
                      width: '32px', height: '32px', borderRadius: '10px', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: header.bg, color: header.fg, border: `1px solid ${header.border}`,
                    }}>
                      {autoApplying ? <Loader size={16} className="spin" /> : good ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0, fontSize: '14.5px', fontWeight: '800', color: '#171817' }}>{title}</h3>
                        <span style={{
                          fontSize: '9.5px', fontWeight: '800', letterSpacing: '0.07em', textTransform: 'uppercase',
                          color: header.fg, background: header.bg, border: `1px solid ${header.border}`,
                          borderRadius: '999px', padding: '2px 7px',
                        }}>
                          {header.label}
                        </span>
                      </div>
                      <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {job?.title} · {job?.company}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleCloseAutoApplyModal}
                    aria-label="Close"
                    style={{
                      background: '#ffffff', border: '1px solid #e5e5e0', borderRadius: '9px',
                      width: '30px', height: '30px', flexShrink: 0, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', cursor: 'pointer', color: '#6b7280',
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
              );
            })()}

            {/* Progress Steps */}
            <div style={{ padding: '18px 20px' }}>
              {autoTask && (
                <AutoApplyTaskPanel
                  task={autoTask}
                  busy={taskBusy}
                  error={autoTaskError || (autoApplyResult && autoApplyResult.status !== 'submitted' ? autoApplyResult.message : '')}
                  answerDrafts={taskAnswerDrafts}
                  answerConsent={taskAnswerConsent}
                  onDraftChange={handleTaskDraftChange}
                  onConsentChange={handleTaskConsentChange}
                  onAnswer={handleTaskAnswer}
                  onApprove={() => handleTaskControl('approve')}
                  onCancel={() => handleTaskControl('cancel')}
                  onPause={() => handleTaskControl('pause')}
                  onResume={() => handleTaskControl('resume')}
                  onMarkSubmitted={() => handleTaskControl('mark-submitted')}
                />
              )}

              {autoApplying && !autoTask && (
                <div style={{
                  width: '100%', height: '4px', background: '#e5e7eb', borderRadius: '2px',
                  marginBottom: '20px', overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%', width: '60%', borderRadius: '2px',
                    background: 'linear-gradient(90deg, #059669, #10b981, #059669)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.5s infinite'
                  }} />
                </div>
              )}

              {!autoTask && (
                <div>
                  {autoApplying && (
                    <div style={{
                      display: 'flex', alignItems: 'flex-start', gap: '11px', padding: '13px 15px', borderRadius: '12px',
                      background: '#eff6ff', border: '1px solid #dbeafe', marginBottom: '16px'
                    }}>
                      <span style={{
                        width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0, background: '#ffffff',
                        border: '1px solid #dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        <Loader size={14} className="spin" style={{ color: '#2563eb' }} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                          Working in the tab it opened
                        </div>
                        <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '2px', lineHeight: 1.45 }}>
                          Hamzooh fills the form there and reports each meaningful step below — switch tabs only if it asks you something.
                        </div>
                      </div>
                    </div>
                  )}
                  <AutoApplyActivityFeed steps={autoApplyProgress} />
                </div>
              )}

              {/* Extension Info Note */}
              {autoApplying && !autoTask && autoApplyProgress.length > 0 && (
                <div style={{
                  marginTop: '12px', padding: '12px 16px', borderRadius: '10px',
                  background: '#f0fdf4', border: '1px solid #bbf7d0',
                  fontSize: '12px', color: '#166534', fontWeight: '600'
                }}>
                  💡 If Hamzooh needs something only you can answer, a prompt appears on the job page in the new tab. Switch to that tab to respond — this panel keeps reporting progress.
                </div>
              )}

              {/* NEEDS_USER pause banner */}
              {needsUser && !autoTask && (
                <div style={{
                  marginTop: '16px', padding: '14px 18px', borderRadius: '12px',
                  background: '#fffbeb', border: '1px solid #fde68a'
                }}>
                  <p style={{ margin: 0, fontWeight: '700', fontSize: '13px', color: '#92400e' }}>
                    ⏸ Paused — {needsUser.reasonCode.replace(/_/g, ' ').toLowerCase()}
                  </p>
                  <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#78350f' }}>
                    {needsUser.message}
                  </p>
                  <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#92400e' }}>
                    Fix it in the job tab, then click <strong>Resume after fixing</strong>. Hamzooh never solves CAPTCHA, OTP, MFA or login walls for you.
                  </p>
                  {needsUser.question && (
                    <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#1a202c' }}>
                      Question: {needsUser.question}
                    </p>
                  )}
                </div>
              )}

              {/* Result Message */}
              {autoApplyResult && !autoTask && (
                <div style={{
                  marginTop: '16px', padding: '16px 20px', borderRadius: '12px',
                  background: autoApplyResult.status === 'submitted' ? '#ecfdf5'
                    : autoApplyResult.status === 'needs_attention' ? '#fffbeb'
                      : autoApplyResult.status === 'cancelled' ? '#f3f4f6' : '#fef2f2',
                  border: `1px solid ${autoApplyResult.status === 'submitted' ? '#a7f3d0'
                    : autoApplyResult.status === 'needs_attention' ? '#fde68a'
                      : autoApplyResult.status === 'cancelled' ? '#d1d5db' : '#fecaca'}`
                }}>
                  <p style={{ margin: 0, fontWeight: '700', fontSize: '14px', color: '#1a202c' }}>
                    {autoApplyResult.message}
                  </p>
                  {(autoApplyResult.filledCount > 0 || autoApplyResult.emptyCount > 0) && (
                    <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#6b7280' }}>
                      {autoApplyResult.filledCount > 0 && `${autoApplyResult.filledCount} fields filled`}
                      {autoApplyResult.filledCount > 0 && autoApplyResult.emptyCount > 0 && ' · '}
                      {autoApplyResult.emptyCount > 0 && `${autoApplyResult.emptyCount} need attention`}
                    </p>
                  )}
                  {Array.isArray(autoApplyResult.skipped) && autoApplyResult.skipped.length > 0 && (
                    <ul style={{ margin: '8px 0 0', paddingLeft: '18px', fontSize: '12px', color: '#9a3412' }}>
                      {autoApplyResult.skipped.slice(0, 8).map((item, idx) => (
                        <li key={idx}>{item.field}: {item.reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '12px 20px', borderTop: '1px solid #e5e7eb', background: '#fcfcfb',
              display: 'flex', justifyContent: 'flex-end', gap: '10px'
            }}>
              {(autoApplyResult?.status === 'needs_attention' || autoTask?.status === 'waiting_for_user_input') && (
                <button
                  onClick={() => {
                    const link = [job?.applyLink, job?.url, job?.sourceUrl, autoTask?.url, autoApplyResult?.applyUrl]
                      .map((u) => String(u || '').trim())
                      .find((u) => /^https?:\/\//i.test(u) && !/\.(png|jpe?g|gif|svg|webp|ico|css|js)(\?|#|$)|\/(?:api\/images|org-theme-logo|favicon)\b/i.test(u));
                    if (link) window.open(link, '_blank');
                  }}
                  className="btn-accent"
                  style={{ background: '#d97706', borderColor: '#d97706', fontSize: '13px', padding: '10px 18px', gap: '6px' }}
                >
                  <Monitor size={14} /> Open job tab
                </button>
              )}
              {needsUser && !autoTask && (
                <button
                  onClick={handleResumeRun}
                  className="btn-accent"
                  style={{ fontSize: '13px', padding: '10px 18px', gap: '6px' }}
                  title={`${needsUser.reasonCode}: ${needsUser.message}`}
                >
                  <RefreshCw size={14} /> Resume after fixing
                </button>
              )}
              {(!autoApplying || autoTask) && (
                <button
                  onClick={handleCloseAutoApplyModal}
                  className="btn-ghost"
                  style={{ fontSize: '13px', padding: '10px 18px' }}
                >
                  Close
                </button>
              )}
            </div>
              </>
            ) : (
              <div style={{ padding: '18px 20px 16px', background: 'linear-gradient(180deg, #fbfbfa 0%, #ffffff 100%)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '18px' }}>
                  <span style={{ fontSize: '10px', fontWeight: '800', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9a9f97' }}>Automation preview</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '10.5px', fontWeight: '700', color: '#047857', background: '#ecfdf5', border: '1px solid #bdf0d6', borderRadius: '999px', padding: '3px 10px 3px 8px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 0 3px rgba(16,185,129,0.16)' }} />
                    Live progress shows here
                  </span>
                </div>

                <div style={{ position: 'relative' }}>
                  <div aria-hidden="true" style={{ position: 'absolute', top: '13px', left: '9%', right: '9%', height: '2px', background: 'repeating-linear-gradient(90deg, #d9f0e2 0 9px, transparent 9px 15px)' }} />
                  <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '6px' }}>
                    {AUTOMATION_PHASES.map((phase, index) => (
                      <div key={phase.id} title={phase.detail} style={{ textAlign: 'center', padding: '0 4px' }}>
                        <span style={{
                          width: '28px', height: '28px', borderRadius: '50%', margin: '0 auto',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: '#ffffff',
                          border: index === 3 ? '1.5px solid #10b981' : '1.5px solid #e2e6e1',
                          boxShadow: index === 3 ? '0 0 0 4px rgba(16,185,129,0.10)' : '0 1px 2px rgba(15,23,42,0.04)',
                          fontSize: '11px', fontWeight: '800', color: index === 3 ? '#047857' : '#5b6470',
                        }}>{index + 1}</span>
                        <div style={{ fontSize: '11.5px', fontWeight: '700', color: '#1b1f24', lineHeight: 1.35, marginTop: '8px' }}>{phase.title}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: '6px', marginTop: '16px', fontSize: '11px', color: '#7a8078', textAlign: 'center', flexWrap: 'wrap', lineHeight: 1.5 }}>
                  <Lock size={11} style={{ marginTop: '2px', flexShrink: 0 }} />
                  <span>
                    {applyTargetHost ? <>Opens <strong style={{ color: '#3f463f', fontWeight: 700 }}>{applyTargetHost}</strong> in a new tab · </> : null}
                    you approve every answer before anything is sent.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Final Direct Apply CTA */}
          <div style={{ background: '#171817', color: '#ffffff', borderRadius: '14px', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: '#fff' }}>
                {submitted ? '✅ Application Submitted!' : 'Ready to Submit Direct Application?'}
              </h4>
              <p style={{ fontSize: '12.5px', color: '#aaa', margin: 0 }}>
                {submitted
                  ? `HAMZOOH auto-applied to ${job.company} successfully.`
                  : `Opens the job in a new tab, fills the form, and asks you before submitting.`}
              </p>
            </div>

            <button
              className="btn-accent"
              onClick={handleAutoApply}
              disabled={autoApplying || submitted}
              style={{
                background: submitted ? '#059669' : autoApplying ? '#6b7280' : '#22a65b',
                borderColor: submitted ? '#059669' : autoApplying ? '#6b7280' : '#22a65b',
                fontSize: '14px', padding: '12px 24px', gap: '8px',
                opacity: autoApplying ? 0.7 : 1,
                cursor: (autoApplying || submitted) ? 'not-allowed' : 'pointer'
              }}
            >
              {autoApplying ? (
                <><Loader size={16} className="spin" /> Auto-Applying...</>
              ) : submitted ? (
                <><CheckCircle2 size={16} /> Applied Successfully</>
              ) : (
                <><Zap size={16} /> Auto Apply with AI</>
              )}
            </button>
          </div>

          {/* Stage navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #e8e8e3' }}>
            <button
              type="button"
              onClick={() => setActiveTab('linkedin')}
              style={{ background: '#ffffff', color: '#64748b', border: '1px solid #cbd5e0', borderRadius: '30px', padding: '11px 22px', fontSize: '12.5px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
            >
              <ArrowLeft size={16} /> Back to LinkedIn
            </button>
            <span style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8' }}>Step 4 of 4</span>
          </div>
        </div>
      )}

      {/* Shimmer keyframes for progress bar */}
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.45; transform: scale(0.82); }
        }
      `}</style>

    </div>
  );
}
