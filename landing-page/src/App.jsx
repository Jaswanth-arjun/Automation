import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';

import Landing from './pages/Landing';
import Auth from './pages/Auth';
import AuthCallback from './pages/AuthCallback';
import DashboardLayout from './components/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import JobDetail from './pages/JobDetail';
import Profile from './pages/Profile';
import ResumeManager from './pages/Resume';
import Applications from './pages/Applications';
import Apply from './pages/Apply';
import MailAutomation from './pages/MailAutomation';
import LinkedInAutomation from './pages/LinkedInAutomation';
import AdminJobs from './pages/AdminJobs';
import SavedJobs from './pages/SavedJobs';
import Subscription from './pages/Subscription';
import VideoLoader from './components/VideoLoader';
import DashboardRAGEntrance from './components/DashboardRAGEntrance';
import MaintenanceNotice from './components/MaintenanceNotice';

// The admin panel is a separate page served by the API server. While running
// the Vite dev server on :5173, /admin only exists on :3000.
function adminPanelUrl() {
  const { protocol, hostname, port } = window.location;
  return port === '5173' ? `${protocol}//${hostname}:3000/admin` : '/admin';
}

function AdminPanelRedirect() {
  React.useEffect(() => {
    window.location.replace(adminPanelUrl());
  }, []);
  return <div className="ad-boot">Opening the admin panel…</div>;
}

// The copilot belongs to the signed-in dashboard only: it is never shown on the
// public landing/auth pages, even for an authenticated visitor.
function GlobalAssistant() {
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  if (!isAuthenticated) return null;
  if (!pathname.startsWith('/dashboard')) return null;
  // The left-to-right walk-in belongs to Home only. Every other dashboard page
  // (jobs, apply, profile…) shows the seated assistant straight away, with no
  // mascot running across the page — including after a refresh.
  const isHome = pathname === '/dashboard' || pathname === '/dashboard/';
  return <DashboardRAGEntrance walkIn={isHome} />;
}

const CLEANUP_FLAG = 'hamzooh_cleanup_20261125_v3_done';

function clearDashboardLocalData() {
  localStorage.removeItem('hamzooh_admin_jobs');
  localStorage.removeItem('wayin_applications');
  localStorage.removeItem('wayin_apply_progress');
  localStorage.removeItem('wayin_tailor_reports');
  localStorage.removeItem('hamzooh_activity_overlay');
  localStorage.removeItem('wayin_saved_jobs');
  Object.keys(localStorage).forEach((k) => {
    if (k.startsWith('hamzooh_cover_letter_')) localStorage.removeItem(k);
  });
  try {
    const resumes = JSON.parse(localStorage.getItem('wayin_resumes') || '[]');
    const userAdded = resumes.filter(
      (r) => !r.jobUrl && !r.jobId && r.size !== '1 page PDF' && !/-tailored-resume\.pdf$/i.test(r.name || ''),
    );
    localStorage.setItem('wayin_resumes', JSON.stringify(userAdded));
  } catch {}
}

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (typeof window !== 'undefined' && !localStorage.getItem(CLEANUP_FLAG)) {
    clearDashboardLocalData();
    localStorage.setItem(CLEANUP_FLAG, '1');
  }
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('clear_dashboard') === '1') {
      clearDashboardLocalData();
      params.delete('clear_dashboard');
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.location.replace(next);
    }
  }, []);
  if (!isAuthenticated && !loading) return <Navigate to="/" replace />;
  return (
    <>
      {children}
      {/* Loader stays on top until the video plays fully, then fades out */}
      <VideoLoader isLoading={loading} />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="jobs/:id" element={<JobDetail />} />
            <Route path="saved" element={<SavedJobs />} />
            <Route path="saved-jobs" element={<Navigate to="/dashboard/saved" replace />} />
            <Route path="profile" element={<Profile />} />
            <Route path="resume" element={<ResumeManager />} />
            <Route path="applications" element={<Applications />} />
            <Route path="apply/:jobId" element={<Apply />} />
            <Route path="mail" element={<MailAutomation />} />
            <Route path="linkedin" element={<LinkedInAutomation />} />
            <Route path="subscription" element={<Subscription />} />
            <Route path="post-jobs" element={<AdminJobs />} />
          </Route>
          {/* Old SPA admin URL: hand it to the real admin panel. */}
          <Route path="/admin/*" element={<AdminPanelRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <GlobalAssistant />
        <MaintenanceNotice />
      </AuthProvider>
    </BrowserRouter>
  );
}
