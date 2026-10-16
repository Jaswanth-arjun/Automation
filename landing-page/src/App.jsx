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
import VideoLoader from './components/VideoLoader';

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (!isAuthenticated && !loading) return <Navigate to="/auth" replace />;
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
            <Route path="profile" element={<Profile />} />
            <Route path="resume" element={<ResumeManager />} />
            <Route path="applications" element={<Applications />} />
            <Route path="apply/:jobId" element={<Apply />} />
            <Route path="mail" element={<MailAutomation />} />
            <Route path="linkedin" element={<LinkedInAutomation />} />
            <Route path="post-jobs" element={<AdminJobs />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
