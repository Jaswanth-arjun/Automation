import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, ArrowRight, Mail, FileText, Sparkles, ExternalLink, 
  Copy, Check, Send, UserPlus, Download, CheckCircle2, 
  MapPin, Clock, Building, Bookmark, AlertCircle, RefreshCw,
  Upload, Eye, ChevronRight, UserCheck, ShieldCheck, Target, X, Plus, Play, Square, Loader, Zap, Monitor
} from 'lucide-react';
import { DEMO_JOBS } from '../lib/mockData';
import { adminJobStore } from '../lib/adminJobStore';
import { profileStore, applicationStore, resumeStore, api, employeeStore } from '../lib/api';
import { calculateMatchScore } from '../lib/matchScore';
import { useAuth } from '../lib/auth';

const Linkedin = ({ size = 16, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

export default function Apply() {
  const { jobId } = useParams();
  const navigate = useNavigate();

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

  const matchResult = useMemo(() => calculateMatchScore(profile, job || {}), [profile, job]);

  const [activeTab, setActiveTab] = useState('referral'); // 'referral' | 'linkedin' | 'tailor'
  const [copiedNoteIndex, setCopiedNoteIndex] = useState(null);
  const [emailSentIndex, setEmailSentIndex] = useState(null);
  const [isTailoring, setIsTailoring] = useState(false);
  const [tailoredDone, setTailoredDone] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  // Auto-Apply state
  const [autoApplying, setAutoApplying] = useState(false);
  const [autoApplyProgress, setAutoApplyProgress] = useState([]);
  const [autoApplyResult, setAutoApplyResult] = useState(null);
  const [showAutoApplyModal, setShowAutoApplyModal] = useState(false);
  const [autoSubmitEnabled, setAutoSubmitEnabled] = useState(false);
  const [extensionReady, setExtensionReady] = useState(false);
  const [tailoredPdfBase64, setTailoredPdfBase64] = useState(null);
  const [tailoredFileName, setTailoredFileName] = useState('');

  // Gmail App Password Configuration Modal
  const [showGmailModal, setShowGmailModal] = useState(false);
  const [gmailAppPassInput, setGmailAppPassInput] = useState('');
  const [gmailAuthError, setGmailAuthError] = useState('');

  // Auto-reply checkbox state
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);

  // LinkedIn connection status for Tab 2
  const { user } = useAuth();
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
  const [liRoles, setLiRoles] = useState(DEFAULT_ROLES);
  const [liNewRole, setLiNewRole] = useState('');
  const [liPerRole, setLiPerRole] = useState(10);
  const [liUseAI, setLiUseAI] = useState(true);
  const [liNote, setLiNote] = useState('');
  const [liStarting, setLiStarting] = useState(false);
  const [liCampaignMsg, setLiCampaignMsg] = useState(null);
  const [liIsRunning, setLiIsRunning] = useState(false);

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
      } catch {}
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
    try { await api.disconnectLinkedIn(liUserId); } catch {}
    setLiConnecting(false);
    setLiConnectError('');
  };

  // Auto-set company when job changes
  useEffect(() => {
    if (job?.company) setLiCompany(job.company);
  }, [job?.company]);

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
    if (!liRoles.length) { liFlash('Add at least one role filter', 'err'); return; }
    if (!liConnected) { liFlash('Connect your LinkedIn account first', 'err'); return; }
    setLiStarting(true);
    try {
      await api.startLinkedIn({
        userId: liUserId,
        company: liCompany,
        roles: liRoles,
        connectionsPerFilter: liPerRole,
        connectionNote: liNote || undefined,
        useAINotes: liUseAI,
        userProfile: profileStore.get() || {},
      });
      liFlash('🚀 Campaign started! Chrome window will open.', 'ok');
      setLiIsRunning(true);
    } catch (err) {
      liFlash(err.message || 'Failed to start campaign', 'err');
    }
    setLiStarting(false);
  };

  const handleLiStopCampaign = async () => {
    try {
      await api.stopLinkedIn();
      liFlash('Stop signal sent', 'ok');
      setLiIsRunning(false);
    } catch (err) {
      liFlash(err.message || 'Failed to stop', 'err');
    }
  };

  const [employeeList, setEmployeeList] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);

  useEffect(() => {
    if (!job?.company) {
      setEmployeeList([]);
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
        const cached = employeeStore.getAll().filter((emp) => sameCompany(emp.company));
        const merged = [...serverRows];
        cached.forEach((emp) => {
          if (!merged.some((row) => row.email === emp.email && sameCompany(row.company))) merged.push(emp);
        });
        const list = merged;
        setEmployeeList(list.map((emp) => ({
          ...emp,
          selected: true,
          role: emp.role && job.company && !emp.role.toLowerCase().includes(job.company.toLowerCase())
            ? `${emp.role} at ${emp.company || job.company}`
            : (emp.role || emp.company || ''),
        })));
      })
      .catch(() => {
        if (cancelled) return;
        const cached = employeeStore.getAll().filter((emp) => sameCompany(emp.company));
        setEmployeeList(cached.map((emp) => ({ ...emp, selected: true })));
      })
      .finally(() => {
        if (!cancelled) setEmployeesLoading(false);
      });
    return () => { cancelled = true; };
  }, [job?.company, job?.id]);

  const toggleEmployeeSelect = (id) => {
    setEmployeeList(prev => prev.map(e => e.id === id ? { ...e, selected: !e.selected } : e));
  };

  const selectedEmployees = employeeList.filter(e => e.selected);

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
  const [currentToneIndex, setCurrentToneIndex] = useState(0);
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

      const nextIndex = (currentToneIndex + 1) % TONES.length;
      setCurrentToneIndex(nextIndex);
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
        senderEmail: profile.email || '',
        jobTitle: job?.title,
        company: job?.company
      };

      const res = await api.sendReferralEmail(payload);

      if (res && res.requireGmailAuth) {
        setSendingAll(false);
        setGmailAuthError(res.message || 'Please connect your Google account under Mail Automation (http://localhost:5173/dashboard/mail) first.');
        return;
      }

      // Log application in store
      applicationStore.add({
        title: job?.title,
        company: job?.company,
        companyMark: job?.companyMark,
        jobId: job?.id,
        matchScore: matchResult.score,
        resumeUsed: tailoredFileName || jobResume?.name || activeResume?.name || `${(profile.fullName || 'User').split(' ')[0]}-resume.pdf`,
        referralSentTo: selectedEmployees.map(e => e.name).join(', ')
      });

      setSendingAll(false);
      setSendSuccess(true);
      setSubmitted(true);
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

  // Handle Tailor Resume — generate a real tailored PDF for this job
  const handleTailorResume = async () => {
    setIsTailoring(true);
    setTailoredDone(false);
    try {
      const link = job?.applyLink || job?.url || window.location.href;
      const active = activeResume || resumes[0];
      const result = await api.tailorExternalJob({
        url: link,
        profile: profile || {},
        resumeText: active?.text || [
          profile.skills?.length ? `Skills: ${profile.skills.join(', ')}` : '',
          ...(profile.experience || []).map(e => `${e.title} at ${e.company}`),
          ...(profile.education || []).map(ed => `${ed.degree} at ${ed.school}`),
        ].join('\n'),
      });

      const chosen = result.formats?.[0] || result.formats?.find(f => f.id === result.recommendedId);
      if (chosen?.pdfBase64) {
        const name = `${(profile?.fullName || 'Candidate').split(' ')[0]}-${(job?.company || 'job').replace(/\s+/g, '-')}-tailored-resume.pdf`;
        setTailoredPdfBase64(chosen.pdfBase64);
        setTailoredFileName(name);
        resumeStore.add({
          name,
          size: '1 page PDF',
          type: 'application/pdf',
          pdfBase64: chosen.pdfBase64,
          jobUrl: link,
          jobId,
          company: job?.company || '',
          title: job?.title || '',
          isActive: true,
        });
        setTailoredDone(true);
      } else {
        throw new Error('No PDF format returned from tailoring engine.');
      }
    } catch (err) {
      console.warn('Tailor resume notice:', err.message);
      const active = activeResume || resumes[0];
      if (active?.pdfBase64 || active?.base64) {
        setTailoredPdfBase64(active.pdfBase64 || active.base64);
        setTailoredFileName(active.name || `${(job?.company || 'job')}-resume.pdf`);
        setTailoredDone(true);
      } else {
        alert('Could not generate tailored PDF resume. Make sure the server is running (npm start).');
      }
    } finally {
      setIsTailoring(false);
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
          window.postMessage({ source: 'hamzo-app', type: 'HAMZO_SYNC_ANSWERS', answers: data.answers }, '*');
        }
      }).catch(() => {});
    };

    // Check DOM attribute set by bridge.js
    if (document.documentElement?.dataset?.hamzoExtension === '1' || window.__HAMZO_EXTENSION__) {
      markReady();
    }

    const onMsg = (event) => {
      if (!alive) return;
      if (event.data?.source === 'hamzo-extension' && (event.data.type === 'HAMZO_PONG' || event.data.type === 'HAMZO_ANSWERS_SYNCED')) {
        markReady();
      }
    };
    window.addEventListener('message', onMsg);

    // Send PING immediately and retry every 400ms for 5 seconds
    window.postMessage({ source: 'hamzo-app', type: 'HAMZO_PING' }, '*');
    const interval = setInterval(() => {
      if (!alive) return;
      if (document.documentElement?.dataset?.hamzoExtension === '1') {
        markReady();
        clearInterval(interval);
      } else {
        window.postMessage({ source: 'hamzo-app', type: 'HAMZO_PING' }, '*');
      }
    }, 400);

    const stopTimer = setTimeout(() => clearInterval(interval), 5000);

    return () => {
      alive = false;
      window.removeEventListener('message', onMsg);
      clearInterval(interval);
      clearTimeout(stopTimer);
    };
  }, []);

  // Listen for extension progress/completion messages
  useEffect(() => {
    const onExtensionMessage = (event) => {
      if (event.data?.source !== 'hamzo-extension') return;

      if (event.data.type === 'HAMZO_APPLY_PROGRESS') {
        setAutoApplyProgress(prev => [...prev, {
          step: event.data.step,
          message: event.data.message,
          timestamp: event.data.timestamp || Date.now(),
        }]);
      }

      if (event.data.type === 'HAMZO_APPLY_COMPLETE') {
        setAutoApplyResult({
          status: event.data.status || 'needs_attention',
          message: event.data.message || 'Application process completed.',
          filledFields: [],
          filledCount: event.data.filledCount || 0,
          emptyCount: event.data.emptyCount || 0,
        });
        setAutoApplying(false);
        if (event.data.status === 'submitted') {
          applicationStore.add({
            title: job?.title,
            company: job?.company,
            companyMark: job?.companyMark,
            jobId: job?.id,
            matchScore: matchResult.score,
            resumeUsed: 'Tailored Resume (Extension Auto-Applied)',
          });
          setSubmitted(true);
        }
      }
    };
    window.addEventListener('message', onExtensionMessage);
    return () => window.removeEventListener('message', onExtensionMessage);
  }, [job, matchResult]);

  // Handle Direct Apply — Extension-based auto-apply (opens new tab in same browser)
  const handleProceedDirectApply = async () => {
    const link = job?.applyLink && job.applyLink.trim() !== '' 
      ? job.applyLink 
      : `https://www.google.com/search?q=${encodeURIComponent(job?.company + ' ' + job?.title + ' apply careers')}`;

    if (!extensionReady) {
      alert('Hamzo Apply extension is not detected. Please load the extension in chrome://extensions (Load unpacked → select the extension folder), then reload this page.');
      return;
    }

    setAutoApplying(true);
    setAutoApplyProgress([]);
    setAutoApplyResult(null);
    setShowAutoApplyModal(true);

    // Push profile to extension and trigger job open in new tab
    const ANSWERS_KEY = 'hamzo_apply_answers';
    let savedAnswers = {};
    try { savedAnswers = JSON.parse(localStorage.getItem(ANSWERS_KEY) || '{}'); } catch {}

    // Listen for the ready response
    const readyPromise = new Promise((resolve) => {
      const onMsg = (event) => {
        if (event.data?.source === 'hamzo-extension' && event.data.type === 'HAMZO_APPLY_READY') {
          window.removeEventListener('message', onMsg);
          resolve(event.data);
        }
      };
      window.addEventListener('message', onMsg);
      setTimeout(() => {
        window.removeEventListener('message', onMsg);
        resolve({ ok: false, error: 'Hamzo Apply did not respond. Reload the extension, then refresh this page.' });
      }, 15000);
    });

    // Ensure we have a valid PDF base64 for resume attachment.
    // Priority: just-tailored this session > resume saved for THIS job > global active.
    const jobPdf = jobResume?.pdfBase64 || jobResume?.base64 || '';
    let pdfToAttach = tailoredPdfBase64 || jobPdf || activeResume?.pdfBase64 || activeResume?.base64 || '';
    let fileNameToAttach = tailoredFileName || jobResume?.name || activeResume?.name || `${(profile?.fullName || 'Candidate').split(' ')[0]}-${(job?.company || 'job').replace(/\s+/g, '-')}-resume.pdf`;

    // If no PDF exists yet, generate one on-the-fly before starting auto-apply
    if (!pdfToAttach) {
      try {
        const active = activeResume || resumes[0];
        const result = await api.tailorExternalJob({
          url: link,
          profile: profile || {},
          resumeText: active?.text || '',
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
            isActive: true,
          });
          setTailoredPdfBase64(pdfToAttach);
          setTailoredFileName(fileNameToAttach);
        }
      } catch (err) {
        console.warn('On-the-fly tailoring warning:', err.message);
      }
    }

    // Send the apply request to the extension
    window.postMessage({
      source: 'hamzo-app',
      type: 'HAMZO_START_APPLY',
      url: link,
      profile: profile || {},
      answers: savedAnswers,
      resumeBase64: pdfToAttach,
      resumeName: fileNameToAttach,
      jobTitle: job?.title || '',
      company: job?.company || '',
      autoSubmit: autoSubmitEnabled,
    }, '*');

    const ready = await readyPromise;
    if (!ready.ok) {
      setAutoApplyResult({
        status: 'failed',
        message: ready.error || 'Failed to open job page. Make sure the Hamzo Apply extension is loaded.',
        filledFields: [],
      });
      setAutoApplying(false);
      return;
    }

    // Add initial progress step
    setAutoApplyProgress([{
      step: 'opened',
      message: `🌐 Job page opened in a new tab. Hamzo is analyzing the form...`,
      timestamp: Date.now(),
    }]);

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

  // Close auto-apply modal and cleanup
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

  const userEmail = profile.email || localStorage.getItem('mailmind_gmail_email') || 'jaswanthnelluru2004@gmail.com';
  // Banner + sends: just-tailored (this session) > resume saved for this job > global active.
  const effectiveResume = (tailoredPdfBase64 && { name: tailoredFileName, pdfBase64: tailoredPdfBase64 }) || jobResume || activeResume;
  const resumeDisplayName = effectiveResume?.name || `${(profile.fullName || 'Jaswanth').split(' ')[0]}-resume.pdf`;

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
              src={job.companyLogoUrl || job.logo || `https://logo.clearbit.com/${(job.company||'').toLowerCase().replace(/[^a-z0-9]/g, '')}.com`} 
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
                HAMZO Smart Outreach
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
          <div style={{ fontSize: '11px', color: '#aaa', textTransform: 'uppercase', fontWeight: '700' }}>Skills Match</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: matchResult.score >= 70 ? '#22a65b' : matchResult.score >= 40 ? '#d4920a' : '#ef4444' }}>
            {matchResult.score}% Match
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div 
        style={{ 
          display: 'flex', 
          gap: '8px', 
          borderBottom: '2px solid #e8e8e3', 
          marginBottom: '28px', 
          overflowX: 'auto',
          paddingBottom: '2px'
        }}
      >
        <button
          onClick={() => setActiveTab('referral')}
          style={{
            padding: '12px 20px',
            border: 'none',
            background: 'none',
            fontSize: '14px',
            fontWeight: activeTab === 'referral' ? '800' : '600',
            color: activeTab === 'referral' ? '#00796b' : '#666660',
            borderBottom: activeTab === 'referral' ? '3px solid #00796b' : '3px solid transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap'
          }}
        >
          <Mail size={16} /> 1. Send Referral Request (Email)
        </button>

        <button
          onClick={() => setActiveTab('linkedin')}
          style={{
            padding: '12px 20px',
            border: 'none',
            background: 'none',
            fontSize: '14px',
            fontWeight: activeTab === 'linkedin' ? '800' : '600',
            color: activeTab === 'linkedin' ? '#445cf5' : '#666660',
            borderBottom: activeTab === 'linkedin' ? '3px solid #445cf5' : '3px solid transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap'
          }}
        >
          <Linkedin size={16} /> 2. Connect on LinkedIn with Note
        </button>

        <button
          onClick={() => setActiveTab('tailor')}
          style={{
            padding: '12px 20px',
            border: 'none',
            background: 'none',
            fontSize: '14px',
            fontWeight: activeTab === 'tailor' ? '800' : '600',
            color: activeTab === 'tailor' ? '#445cf5' : '#666660',
            borderBottom: activeTab === 'tailor' ? '3px solid #445cf5' : '3px solid transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap'
          }}
        >
          <Sparkles size={16} /> 3. Direct Apply with Tailored Resume
        </button>
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

          {/* Target Company Employees Selection (Extracted from Admin PDF/database) */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '24px', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '800', color: '#1a202c', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <UserCheck size={18} style={{ color: '#059669' }} /> Target Employee Outreach Contacts ({selectedEmployees.length} selected)
            </h3>
            <p style={{ fontSize: '12.5px', color: '#718096', margin: '0 0 16px' }}>
              Extracted from verified employee records for <strong>{job.company}</strong>. Each employee will receive a personalized version of your referral request.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {employeesLoading ? (
                <p style={{ fontSize: '13px', color: '#718096', margin: 0 }}>Loading employee contacts…</p>
              ) : employeeList.length === 0 ? (
                <div style={{ padding: '16px 20px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px', textAlign: 'center' }}>
                  <p style={{ fontSize: '14px', fontWeight: 700, color: '#64748b', margin: 0 }}>No contact found</p>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>No target employee contacts exist for {job.company}. Ask admin to add employee contacts or use Direct Apply.</span>
                </div>
              ) : null}
              {employeeList.map((emp) => (
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
                      onChange={() => {}} 
                      style={{ width: '16px', height: '16px', accentColor: '#059669', cursor: 'pointer' }} 
                    />
                    <div>
                      <strong style={{ fontSize: '14px', color: '#1a202c', display: 'block' }}>{emp.name}</strong>
                      <span style={{ fontSize: '12px', color: '#718096' }}>{emp.role} · <code style={{ color: '#047857' }}>{emp.email}</code></span>
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: emp.selected ? '#047857' : '#9ca3af', background: emp.selected ? '#d1fae5' : '#f3f4f6', padding: '3px 10px', borderRadius: '12px' }}>
                    {emp.selected ? 'Selected' : 'Skipped'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* HAMZO Agent Banner & Configuration Box */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#319795', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '14px' }}>
                🤖
              </div>
              <strong style={{ fontSize: '14.5px', color: '#1a202c' }}>
                HAMZO Agent will reach out to {selectedEmployees.length} employees at {job.company}
              </strong>
            </div>

            <div style={{ background: '#e6fffa', border: '1px solid #b2f5ea', borderRadius: '12px', padding: '14px 16px', fontSize: '12.5px', color: '#234e52', lineHeight: '1.5' }}>
              ℹ️ If you confirm and send, your updated message will be saved as your default outreach template. You can edit it anytime from <span style={{ fontWeight: '800', textDecoration: 'underline', cursor: 'pointer' }}>HAMZO Agent configuration</span> in your dashboard.
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
              <span>Let HAMZO automatically reply to referrer emails</span>
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
            <div style={{ padding: '18px 24px', background: '#d1fae5', border: '1px solid #34d399', borderRadius: '14px', color: '#065f46', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: '800', fontSize: '14px' }}>
                <CheckCircle2 size={22} />
                <span>Referral emails sent successfully to {selectedEmployees.map(e => e.name).join(', ')} with PDF resume attached!</span>
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
                title="Go to 2. Connect on LinkedIn with Note"
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
              <Linkedin style={{ color: '#0077b5' }} size={20} /> Option 2: Send Connection Request with Personal Note via LinkedIn
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
                    To launch automated LinkedIn outreach campaigns for <strong>{job.company}</strong>, you need to connect your LinkedIn account first. This allows HAMZO to send personalized connection requests to recruiters and hiring managers on your behalf.
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
                    <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>
                      Connections / Role
                    </label>
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
                    <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>
                      AI Personalized Notes
                    </label>
                    <button
                      onClick={() => setLiUseAI(!liUseAI)}
                      disabled={liIsRunning}
                      style={{
                        width: '100%', padding: '12px 16px',
                        border: liUseAI ? '1.5px solid #a78bfa' : '1px solid #e2e8f0',
                        borderRadius: '10px', fontSize: '13px', fontWeight: '700',
                        background: liUseAI ? '#f5f3ff' : '#ffffff',
                        color: liUseAI ? '#6d28d9' : '#64748b',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                      }}
                    >
                      <Sparkles size={14} /> {liUseAI ? 'Gemini AI On' : 'Template Notes'}
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
                      <Play size={16} /> {liStarting ? 'Starting...' : `Start Campaign (${liRoles.length * liPerRole} requests)`}
                    </button>
                  )}
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
              onClick={() => setActiveTab('tailor')}
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
              <span>Next: Direct Apply / Tailor Resume</span>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* TAB CONTENT 3: Direct Apply by Tailoring Resume */}
      {activeTab === 'tailor' && (
        <div style={{ background: '#ffffff', border: '1px solid #e5e5e0', borderRadius: '16px', padding: '28px', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
          <div style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#171817', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles style={{ color: '#22a65b' }} size={20} /> Option 3: Direct Apply by Tailoring Resume to Job Description
            </h2>
            <p style={{ fontSize: '13.5px', color: '#555852', margin: 0, lineHeight: '1.5' }}>
              Automatically optimize your resume keywords to match the exact requirements of <strong>{job.title}</strong> at <strong>{job.company}</strong>.
            </p>
          </div>

          {/* Skill Alignment Card */}
          <div style={{ background: '#fafaf7', border: '1px solid #e8e8e3', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: '800', color: '#171817', margin: '0 0 12px' }}>
              Required Job Skills vs Your Profile
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {(job.requiredSkills || job.skills || ['Python', 'Node.js', 'SQL', 'REST APIs']).map(skill => {
                const hasSkill = (profile.skills || []).some(s => s.toLowerCase().includes(skill.toLowerCase()));
                return (
                  <span
                    key={skill}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '20px',
                      fontSize: '12px',
                      fontWeight: '700',
                      background: hasSkill ? '#e8f5e9' : '#fff3e0',
                      color: hasSkill ? '#2e7d32' : '#e65100',
                      border: `1px solid ${hasSkill ? '#c8e6c9' : '#ffe0b2'}`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    {hasSkill ? '✓ ' : '⚡ '} {skill}
                  </span>
                );
              })}
            </div>
          </div>

          {/* AI Resume Tailor Action Box */}
          <div style={{ border: '2px dashed #445cf5', borderRadius: '14px', padding: '24px', textAlign: 'center', background: '#f8f9ff', marginBottom: '24px' }}>
            <Sparkles size={32} style={{ color: '#445cf5', marginBottom: '10px' }} />
            <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#171817', margin: '0 0 6px' }}>
              {tailoredDone ? 'Resume Tailored & Optimized!' : 'Tailor Resume for ' + job.title}
            </h3>
            <p style={{ fontSize: '13px', color: '#555852', maxWidth: '540px', margin: '0 auto 16px' }}>
              {tailoredDone 
                ? 'Your resume summary and bullet points have been optimized for ATS scanners and aligned with ' + job.company + '\'s target keywords.'
                : 'Click below to automatically re-align your resume highlights and cover letter to maximize ATS score.'}
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <button
                className="btn-accent"
                onClick={handleTailorResume}
                disabled={isTailoring}
                style={{ padding: '12px 24px', fontSize: '14px', gap: '8px' }}
              >
                {isTailoring ? <RefreshCw size={16} className="spin" /> : <Sparkles size={16} />}
                {isTailoring ? 'Optimizing Resume...' : tailoredDone ? 'Re-Tailor Resume' : 'Tailor Resume Now'}
              </button>

              {tailoredDone && (
                <button
                  className="btn-ghost"
                  onClick={() => {
                    if (!tailoredPdfBase64) return alert('No PDF available to download');
                    const binary = atob(tailoredPdfBase64.includes(',') ? tailoredPdfBase64.split(',')[1] : tailoredPdfBase64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
                    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = tailoredFileName || 'tailored-resume.pdf';
                    a.click();
                  }}
                  style={{ padding: '12px 20px', fontSize: '14px', gap: '8px' }}
                >
                  <Download size={16} /> Download Tailored Resume (PDF)
                </button>
              )}
            </div>
          </div>

          {/* Extension Status & Auto-Submit Settings */}
          <div style={{ background: extensionReady ? '#ecfdf5' : '#fef2f2', border: `1px solid ${extensionReady ? '#a7f3d0' : '#fecaca'}`, borderRadius: '12px', padding: '14px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: extensionReady ? '#059669' : '#dc2626', flexShrink: 0 }} />
              <span style={{ fontSize: '13px', fontWeight: '700', color: extensionReady ? '#064e3b' : '#991b1b' }}>
                {extensionReady ? 'Hamzo Apply extension connected' : 'Extension not detected — load it in chrome://extensions'}
              </span>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: '#064e3b', fontWeight: '600', cursor: 'pointer' }}>
              <input type="checkbox" checked={autoSubmitEnabled} onChange={(e) => setAutoSubmitEnabled(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: '#059669' }} />
              <span>Auto-submit (skip confirmation)</span>
            </label>
          </div>

          {/* Final Direct Apply CTA */}
          <div style={{ background: '#171817', color: '#ffffff', borderRadius: '14px', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: '#fff' }}>
                {submitted ? '✅ Application Submitted!' : 'Ready to Submit Direct Application?'}
              </h4>
              <p style={{ fontSize: '12.5px', color: '#aaa', margin: 0 }}>
                {submitted 
                  ? `HAMZO auto-applied to ${job.company} successfully.`
                  : `Opens the job in a new tab, fills the form, and asks you before submitting.`}
              </p>
            </div>

            <button
              className="btn-accent"
              onClick={handleProceedDirectApply}
              disabled={autoApplying || submitted || !extensionReady}
              style={{ 
                background: submitted ? '#059669' : autoApplying ? '#6b7280' : !extensionReady ? '#94a3b8' : '#22a65b', 
                borderColor: submitted ? '#059669' : autoApplying ? '#6b7280' : !extensionReady ? '#94a3b8' : '#22a65b', 
                fontSize: '14px', padding: '12px 24px', gap: '8px',
                opacity: (autoApplying || !extensionReady) ? 0.7 : 1,
                cursor: (autoApplying || submitted || !extensionReady) ? 'not-allowed' : 'pointer'
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
        </div>
      )}

      {/* ═══ AUTO-APPLY PROGRESS MODAL ═══ */}
      {showAutoApplyModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px'
        }}>
          <div style={{
            background: '#ffffff', borderRadius: '20px', width: '100%', maxWidth: '560px',
            maxHeight: '80vh', overflow: 'hidden', boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
            display: 'flex', flexDirection: 'column'
          }}>
            {/* Modal Header */}
            <div style={{
              background: autoApplyResult?.status === 'submitted' ? 'linear-gradient(135deg, #059669, #10b981)'
                : autoApplyResult?.status === 'failed' ? 'linear-gradient(135deg, #dc2626, #ef4444)'
                : autoApplyResult?.status === 'needs_attention' ? 'linear-gradient(135deg, #d97706, #f59e0b)'
                : 'linear-gradient(135deg, #171817, #2a2c2a)',
              padding: '24px 28px', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {autoApplying ? (
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '12px',
                    background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <Loader size={22} className="spin" />
                  </div>
                ) : autoApplyResult?.status === 'submitted' ? (
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '12px',
                    background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <CheckCircle2 size={22} />
                  </div>
                ) : (
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '12px',
                    background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <AlertCircle size={22} />
                  </div>
                )}
                <div>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: '800' }}>
                    {autoApplying ? 'Auto-Applying...' 
                      : autoApplyResult?.status === 'submitted' ? 'Application Submitted!' 
                      : autoApplyResult?.status === 'needs_attention' ? 'Needs Your Attention'
                      : 'Auto-Apply Failed'}
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', opacity: 0.85 }}>
                    {job?.title} at {job?.company}
                  </p>
                </div>
              </div>
              {!autoApplying && (
                <button onClick={handleCloseAutoApplyModal} style={{
                  background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '10px',
                  width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: '#fff'
                }}>
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Progress Steps */}
            <div style={{ padding: '20px 28px', overflowY: 'auto', flex: 1 }}>
              {autoApplying && (
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {autoApplyProgress.map((step, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px',
                    padding: '10px 14px', borderRadius: '10px',
                    background: i === autoApplyProgress.length - 1 && autoApplying ? '#f0fdf4' : '#f8fafc',
                    border: i === autoApplyProgress.length - 1 && autoApplying ? '1px solid #a7f3d0' : '1px solid #e5e7eb',
                    transition: 'all 0.3s ease'
                  }}>
                    <div style={{
                      width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0,
                      background: step.step === 'error' ? '#fee2e2' 
                        : step.step === 'needs_attention' ? '#fef3c7'
                        : step.step === 'submitted' ? '#d1fae5' 
                        : '#e0f2fe',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '12px'
                    }}>
                      {step.step === 'submitted' ? '✅' 
                        : step.step === 'error' ? '❌'
                        : step.step === 'needs_attention' ? '⚠️'
                        : i === autoApplyProgress.length - 1 && autoApplying ? '⏳' : '✓'}
                    </div>
                    <div>
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: '#1a202c' }}>
                        {step.message}
                      </p>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {new Date(step.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}

                {autoApplying && autoApplyProgress.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '30px', color: '#6b7280' }}>
                    <Loader size={28} className="spin" style={{ marginBottom: '12px', color: '#059669' }} />
                    <p style={{ margin: 0, fontWeight: '600' }}>Opening job page in a new tab...</p>
                    <p style={{ margin: '4px 0 0', fontSize: '12px' }}>Hamzo will fill the form directly in your browser!</p>
                  </div>
                )}
              </div>

              {/* Extension Info Note */}
              {autoApplying && autoApplyProgress.length > 0 && (
                <div style={{
                  marginTop: '12px', padding: '12px 16px', borderRadius: '10px',
                  background: '#f0fdf4', border: '1px solid #bbf7d0',
                  fontSize: '12px', color: '#166534', fontWeight: '600'
                }}>
                  💡 If Hamzo needs additional information, a pop-up will appear directly on the job page in the new tab. Switch to that tab to respond.
                </div>
              )}

              {/* Result Message */}
              {autoApplyResult && (
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
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '16px 28px', borderTop: '1px solid #e5e7eb',
              display: 'flex', justifyContent: 'flex-end', gap: '10px'
            }}>
              {autoApplyResult?.status === 'needs_attention' && (
                <button
                  onClick={() => {
                    const link = job?.applyLink || autoApplyResult?.applyUrl;
                    if (link) window.open(link, '_blank');
                  }}
                  className="btn-accent"
                  style={{ background: '#d97706', borderColor: '#d97706', fontSize: '13px', padding: '10px 18px', gap: '6px' }}
                >
                  <Monitor size={14} /> Complete Manually
                </button>
              )}
              {!autoApplying && (
                <button
                  onClick={handleCloseAutoApplyModal}
                  className="btn-ghost"
                  style={{ fontSize: '13px', padding: '10px 18px' }}
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Shimmer keyframes for progress bar */}
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>

    </div>
  );
}
