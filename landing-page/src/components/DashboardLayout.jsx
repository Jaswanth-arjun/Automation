import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import TopNav from './TopNav';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { useAuth } from '../lib/auth';
import { candidateStore, profileStore } from '../lib/api';

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();

  // Signing in is the natural sync point: the profile already in storage is
  // pushed to the candidate database so admins see every student, not only
  // the ones who happen to open the Profile page after registering.
  useEffect(() => {
    const profile = profileStore.get();
    const email = profile?.email || user?.email || user?.gmailEmail;
    if (!email) return;
    candidateStore.syncProfile({ ...(profile || {}), email }).catch(() => {});
  }, [user?.id, user?.email]);

  return (
    <div className="dash-layout">
      <TopNav onMenu={() => setSidebarOpen(true)} />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="dash-main">
        <Outlet />
      </main>
      <MobileNav />
    </div>
  );
}
