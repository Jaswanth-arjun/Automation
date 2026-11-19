import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
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
      </AuthProvider>
    </BrowserRouter>
  );
}
